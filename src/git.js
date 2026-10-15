import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export function git(cwd, args, { allowFail = false } = {}) {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd, maxBuffer: 64 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
      const result = { ok: !err, stdout: stdout.toString(), stderr: stderr.toString() };
      if (err && !allowFail) {
        reject(new Error(`git ${args.join(' ')} falló: ${result.stderr || err.message}`));
      } else {
        resolve(result);
      }
    });
  });
}

// Las operaciones que tocan .git del repo principal (worktrees, ramas) se serializan.
let gitQueue = Promise.resolve();
export function withGitLock(fn) {
  const next = gitQueue.then(fn, fn);
  gitQueue = next.catch(() => {});
  return next;
}

export async function inspectRepo(repoPath) {
  if (!repoPath || !fs.existsSync(repoPath)) throw new Error('La carpeta del proyecto no existe.');
  const top = await git(repoPath, ['rev-parse', '--show-toplevel'], { allowFail: true });
  if (!top.ok) throw new Error('La carpeta no es un repositorio git. Ejecuta "git init" y haz un primer commit.');
  const head = await git(repoPath, ['rev-parse', 'HEAD'], { allowFail: true });
  if (!head.ok) throw new Error('El repositorio no tiene commits. Haz un primer commit antes de empezar.');
  const branch = await git(repoPath, ['rev-parse', '--abbrev-ref', 'HEAD']);
  const status = await git(repoPath, ['status', '--porcelain']);
  return {
    root: path.resolve(top.stdout.trim()),
    baseCommit: head.stdout.trim(),
    baseBranch: branch.stdout.trim(),
    dirty: status.stdout.trim().length > 0,
  };
}

export async function listFiles(repoPath, limit = 400) {
  const res = await git(repoPath, ['ls-files'], { allowFail: true });
  const files = res.stdout.split('\n').filter(Boolean);
  const shown = files.slice(0, limit);
  if (files.length > limit) shown.push(`... (${files.length - limit} archivos más)`);
  return shown.join('\n');
}

export function addWorktree(repoRoot, worktreePath, branch, baseCommit) {
  return withGitLock(async () => {
    fs.mkdirSync(path.dirname(worktreePath), { recursive: true });
    await git(repoRoot, ['worktree', 'add', '-b', branch, worktreePath, baseCommit]);
  });
}

export async function removeWorktree(repoRoot, worktreePath) {
  return withGitLock(() => git(repoRoot, ['worktree', 'remove', '--force', worktreePath], { allowFail: true }));
}

/** Hace commit de todo lo que haya cambiado. Devuelve true si había cambios. */
export async function commitAll(worktree, message) {
  await git(worktree, ['add', '-A']);
  const staged = await git(worktree, ['diff', '--cached', '--quiet'], { allowFail: true });
  if (staged.ok) return false;
  await git(worktree, [
    '-c', 'user.name=AITeam',
    '-c', 'user.email=aiteam@localhost',
    'commit', '-q', '--no-verify', '-m', message,
  ]);
  return true;
}

/** Fusiona una rama. Si hay conflictos, los deja en el árbol y devuelve la lista. */
export async function merge(worktree, branch, message) {
  const res = await git(
    worktree,
    ['-c', 'user.name=AITeam', '-c', 'user.email=aiteam@localhost', 'merge', '--no-ff', '--no-edit', '-m', message, branch],
    { allowFail: true },
  );
  if (res.ok) return { ok: true, conflicts: [] };
  return { ok: false, conflicts: await conflictedFiles(worktree), output: res.stdout + res.stderr };
}

export async function conflictedFiles(worktree) {
  const res = await git(worktree, ['diff', '--name-only', '--diff-filter=U'], { allowFail: true });
  return res.stdout.split('\n').map((s) => s.trim()).filter(Boolean);
}

/** Descarta cambios sin commit (lo que dejó a medias una IA que falló). */
export async function discardChanges(worktree) {
  await git(worktree, ['reset', '-q', '--hard', 'HEAD'], { allowFail: true });
  await git(worktree, ['clean', '-fdq'], { allowFail: true });
}

export function abortMerge(worktree) {
  return git(worktree, ['merge', '--abort'], { allowFail: true });
}

export async function finishMerge(worktree) {
  await git(worktree, ['add', '-A']);
  await git(worktree, ['-c', 'user.name=AITeam', '-c', 'user.email=aiteam@localhost', 'commit', '-q', '--no-edit', '--no-verify']);
}

export async function diffSince(repoRoot, baseCommit, branch, maxChars = 80_000) {
  const stat = await git(repoRoot, ['diff', '--stat', `${baseCommit}..${branch}`], { allowFail: true });
  const full = await git(repoRoot, ['diff', `${baseCommit}..${branch}`], { allowFail: true });
  let diff = full.stdout;
  if (diff.length > maxChars) diff = `${diff.slice(0, maxChars)}\n... (diff truncado)`;
  return { stat: stat.stdout.trim(), diff };
}

export async function hasCommitsSince(repoRoot, baseCommit, branch) {
  const res = await git(repoRoot, ['rev-list', '--count', `${baseCommit}..${branch}`], { allowFail: true });
  return Number(res.stdout.trim()) > 0;
}
