import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import * as G from './git.js';

const prefix = (chat) => `refs/aiteam/snapshots/${chat.id}`;
const valid = (s) => /^[\w-]+$/.test(s);

async function capture(chat, turn, phase) {
  if (!valid(chat.id) || !valid(turn)) throw new Error('Identificador de instantánea inválido.');
  const cwd = chat.worktree.path;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aiteam-snapshot-'));
  try {
    const env = { GIT_INDEX_FILE: path.join(dir, 'index') };
    const indexPath = (await G.git(cwd, ['rev-parse', '--git-path', 'index'])).stdout.trim();
    const sourceIndex = path.isAbsolute(indexPath) ? indexPath : path.resolve(cwd, indexPath);
    if (fs.existsSync(sourceIndex)) fs.copyFileSync(sourceIndex, env.GIT_INDEX_FILE);
    await G.gitWithEnv(cwd, ['read-tree', 'HEAD'], env);
    await G.gitWithEnv(cwd, ['add', '-A'], env);
    const tree = (await G.gitWithEnv(cwd, ['write-tree'], env)).stdout.trim();
    const head = (await G.git(cwd, ['rev-parse', 'HEAD'])).stdout.trim();
    const commit = (await G.git(cwd, ['-c', 'user.name=AITeam', '-c', 'user.email=aiteam@localhost', 'commit-tree', tree, '-p', head, '-m', `AITeam snapshot ${turn} ${phase}`])).stdout.trim();
    await G.git(cwd, ['update-ref', `${prefix(chat)}/${turn}/${phase}`, commit]);
    return commit;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

export async function list(chat) {
  if (Array.isArray(chat.snapshotTurns)) return { turns: chat.snapshotTurns, cursor: Math.min(chat.snapshotCursor ?? chat.snapshotTurns.length, chat.snapshotTurns.length) };
  const out = await G.git(chat.worktree.path, ['for-each-ref', '--format=%(refname) %(objectname)', `${prefix(chat)}/`]);
  const entries = new Map();
  for (const line of out.stdout.trim().split('\n').filter(Boolean)) {
    const [ref, oid] = line.split(' ');
    const match = ref.match(/\/([^/]+)\/(before|after)$/);
    if (!match) continue;
    const item = entries.get(match[1]) ?? { id: match[1] };
    item[match[2]] = oid;
    entries.set(match[1], item);
  }
  const turns = [...entries.values()].filter((e) => e.before && e.after).sort((a, b) => a.id.localeCompare(b.id));
  for (const item of turns) {
    const diff = await G.git(chat.worktree.path, ['diff', '--name-only', item.before, item.after]);
    item.files = diff.stdout.split('\n').filter(Boolean);
  }
  chat.snapshotTurns = turns;
  return { turns, cursor: Math.min(chat.snapshotCursor ?? turns.length, turns.length) };
}

export async function beforeTurn(chat) {
  const { turns, cursor } = await list(chat);
  for (const item of turns.slice(cursor)) {
    await G.git(chat.worktree.path, ['update-ref', '-d', `${prefix(chat)}/${item.id}/before`]);
    await G.git(chat.worktree.path, ['update-ref', '-d', `${prefix(chat)}/${item.id}/after`]);
  }
  chat.snapshotTurns = turns.slice(0, cursor);
  const id = `${Date.now().toString().padStart(13, '0')}-${crypto.randomBytes(4).toString('hex')}`;
  await capture(chat, id, 'before');
  return id;
}

export async function afterTurn(chat, id) {
  const after = await capture(chat, id, 'after');
  const before = (await G.git(chat.worktree.path, ['rev-parse', `${prefix(chat)}/${id}/before`])).stdout.trim();
  const diff = await G.git(chat.worktree.path, ['diff', '--name-only', before, after]);
  chat.snapshotTurns ??= [];
  chat.snapshotTurns.push({ id, before, after, files: diff.stdout.split('\n').filter(Boolean) });
  chat.snapshotCursor = chat.snapshotTurns.length;
}

export async function remove(chat) {
  if (!valid(chat.id)) return;
  const refs = await G.git(chat.worktree.path, ['for-each-ref', '--format=%(refname)', `${prefix(chat)}/`]);
  for (const ref of refs.stdout.split('\n').filter(Boolean)) await G.git(chat.worktree.path, ['update-ref', '-d', ref]);
}

async function restoreOid(chat, oid) {
  const cwd = chat.worktree.path;
  const status = await G.git(cwd, ['status', '--porcelain']);
  if (status.stdout.trim()) throw new Error('La copia tiene cambios sin guardar; termina o guarda esos cambios antes de restaurar.');
  const original = (await G.git(cwd, ['rev-parse', 'HEAD'])).stdout.trim();
  const tree = (await G.git(cwd, ['rev-parse', `${oid}^{tree}`])).stdout.trim();
  try {
    await G.git(cwd, ['read-tree', '--reset', '-u', tree]);
    await G.git(cwd, ['clean', '-fd']);
    await G.commitAll(cwd, 'AITeam: restaura instantánea');
  } catch (err) {
    await G.git(cwd, ['reset', '--hard', original], { allowFail: true });
    throw err;
  }
}

export async function restore(chat, turnId) {
  const { turns } = await list(chat);
  const index = turns.findIndex((t) => t.id === turnId);
  if (index < 0) throw new Error('No existe ese turno.');
  await restoreOid(chat, turns[index].after);
  chat.snapshotCursor = index + 1;
  return list(chat);
}

export async function undo(chat) {
  const { turns, cursor } = await list(chat);
  if (!cursor) throw new Error('No hay turnos para deshacer.');
  await restoreOid(chat, turns[cursor - 1].before);
  chat.snapshotCursor = cursor - 1;
  return list(chat);
}

export async function redo(chat) {
  const { turns, cursor } = await list(chat);
  if (cursor >= turns.length) throw new Error('No hay turnos para rehacer.');
  await restoreOid(chat, turns[cursor].after);
  chat.snapshotCursor = cursor + 1;
  return list(chat);
}
