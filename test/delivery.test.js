import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { deliverChanges } from '../src/delivery.js';

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

test('entrega cambios automáticamente y conserva pendientes si el proyecto está ocupado', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aiteam-delivery-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const repo = path.join(root, 'repo');
  const worktree = path.join(root, 'worktree');
  fs.mkdirSync(repo);
  git(repo, 'init');
  fs.writeFileSync(path.join(repo, 'base.txt'), 'base');
  git(repo, 'add', '-A');
  git(repo, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-m', 'base');
  git(repo, 'worktree', 'add', '-b', 'agent-work', worktree);

  fs.writeFileSync(path.join(worktree, 'result.txt'), 'entregado');
  git(worktree, 'add', '-A');
  git(worktree, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-m', 'result');
  const target = { repoPath: repo, branch: 'agent-work', worktree, review: {} };
  const first = await deliverChanges(target, 'Entrega de prueba');
  assert.equal(first.status, 'applied');
  assert.equal(first.files, 1);
  assert.equal(fs.readFileSync(path.join(repo, 'result.txt'), 'utf8'), 'entregado');
  assert.equal((await deliverChanges(target, 'Repetida')).status, 'applied');

  fs.writeFileSync(path.join(repo, 'base.txt'), 'cambio local sin guardar');
  fs.writeFileSync(path.join(worktree, 'second.txt'), 'pendiente');
  git(worktree, 'add', '-A');
  git(worktree, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-m', 'second');
  const blocked = await deliverChanges(target, 'Entrega pendiente');
  assert.equal(blocked.status, 'pending');
  assert.match(blocked.reason, /sin guardar/);
  assert.equal(fs.existsSync(path.join(repo, 'second.txt')), false);
});
