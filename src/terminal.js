import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, loadConfig } from './config.js';
import { killTree } from './runner.js';

const DIR = path.join(DATA_DIR, 'terminals');
const MAX_OUTPUT = 80_000;
const MAX_HISTORY = 100;
const active = new Map();
const keyFor = (kind, id) => `${kind}-${id}`;
const fileFor = (kind, id) => path.join(DIR, `${keyFor(kind, id)}.json`);
const tail = (value) => value.length > MAX_OUTPUT ? value.slice(-MAX_OUTPUT) : value;

function readHistory(kind, id) {
  try { return JSON.parse(fs.readFileSync(fileFor(kind, id), 'utf8')); }
  catch (err) { if (err.code === 'ENOENT') return []; throw err; }
}

function saveHistory(kind, id, entry) {
  const items = readHistory(kind, id);
  const index = items.findIndex((item) => item.id === entry.id);
  if (index < 0) items.push(entry);
  else items[index] = entry;
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(fileFor(kind, id), JSON.stringify(items.slice(-MAX_HISTORY), null, 2));
}

export function history(kind, id) {
  const items = readHistory(kind, id);
  for (const session of active.values()) {
    if (session.kind === kind && session.ownerId === id) {
      const index = items.findIndex((item) => item.id === session.entry.id);
      if (index < 0) items.push(session.entry);
      else items[index] = session.entry;
    }
  }
  return items.slice(-MAX_HISTORY);
}

/** Resolve the cwd from server-owned objects, never from a request body. */
export function worktreeFor(chats, orchestrator, kind, id, agent) {
  let cwd;
  let autonomy;
  if (kind === 'chats') {
    const chat = chats.get(id);
    if (!chat) throw new Error('No existe esa conversación.');
    cwd = chat.worktree?.path;
    autonomy = chat.autonomy ?? loadConfig().autonomy;
  } else if (kind === 'runs') {
    const run = orchestrator.get(id);
    if (!run) throw new Error('No existe esa tarea.');
    if (!agent || !Object.hasOwn(run.worktrees ?? {}, agent)) throw new Error('Indica un agente con copia de trabajo.');
    cwd = run.worktrees[agent]?.path;
    autonomy = run.autonomy ?? loadConfig().autonomy;
  } else throw new Error('Tipo de terminal desconocido.');
  if (!cwd || !fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) throw new Error('La copia de trabajo no está disponible.');
  return { cwd: fs.realpathSync(cwd), autonomy };
}

/** One command per spawn; output is streamed and retained as a bounded history entry. */
export function execute({ kind, ownerId, cwd, autonomy, command, actor = 'user', emit = () => {} }) {
  if (actor !== 'user' && autonomy !== 'full') throw new Error('Las IAs no pueden ejecutar comandos en modo seguro.');
  if (typeof command !== 'string' || !command.trim() || command.length > 20_000) throw new Error('Comando vacío o demasiado largo.');
  if (!['chats', 'runs'].includes(kind) || !/^[\w-]+$/.test(ownerId)) throw new Error('Terminal desconocida.');
  const id = randomUUID();
  const entry = { id, command, cwd, actor, startedAt: new Date().toISOString(), status: 'running', stdout: '', stderr: '', code: null };
  const shell = process.platform === 'win32' ? 'powershell.exe' : 'sh';
  const args = process.platform === 'win32' ? ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command] : ['-c', command];
  let child;
  try {
    child = spawn(shell, args, { cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (err) {
    entry.status = 'failed';
    entry.stderr = err.message;
    entry.finishedAt = new Date().toISOString();
    saveHistory(kind, ownerId, entry);
    emit('terminal', { kind, ownerId, commandId: id, type: 'exit', status: 'failed', error: err.message });
    return entry;
  }
  const session = { kind, ownerId, child, entry };
  active.set(id, session);
  const event = (type, extra = {}) => emit('terminal', { kind, ownerId, commandId: id, type, ...extra });
  event('start', { command, cwd, actor });
  for (const stream of ['stdout', 'stderr']) {
    child[stream].setEncoding('utf8');
    child[stream].on('data', (chunk) => {
      entry[stream] = tail(entry[stream] + chunk);
      event(stream, { text: chunk });
    });
  }
  child.on('error', (err) => { entry.stderr = tail(entry.stderr + `\n${err.message}`); event('stderr', { text: err.message }); });
  child.on('close', (code, signal) => {
    entry.code = code;
    entry.signal = signal;
    entry.status = entry.status === 'cancelled' ? 'cancelled' : code === 0 ? 'done' : 'failed';
    entry.finishedAt = new Date().toISOString();
    active.delete(id);
    saveHistory(kind, ownerId, entry);
    event('exit', { code, signal, status: entry.status });
  });
  return entry;
}

export function cancel(kind, ownerId, commandId) {
  const session = active.get(commandId);
  if (!session || session.kind !== kind || session.ownerId !== ownerId) return false;
  session.entry.status = 'cancelled';
  killTree(session.child);
  return true;
}

/** For !command: append this returned text to the next user request sent to ChatManager.post. */
export function shellContext(chatId, commandId) {
  const entry = history('chats', chatId).find((item) => item.id === commandId);
  if (!entry) throw new Error('Comando desconocido.');
  const output = tail(`${entry.stdout}${entry.stderr ? `\n[stderr]\n${entry.stderr}` : ''}`);
  return `Resultado de !${entry.command} (salida ${entry.status}, código ${entry.code ?? 'sin código'}):\n\`\`\`text\n${output}\n\`\`\``;
}
