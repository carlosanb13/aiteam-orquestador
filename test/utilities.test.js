import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { Bus } from '../src/bus.js';
import * as snapshots from '../src/snapshots.js';
import { createProjectCommand, parseFrontmatter, expandTemplate, listCommands, resolveSlash } from '../src/commands.js';
import { history as compactHistory } from '../src/compaction.js';
import * as terminal from '../src/terminal.js';

const temp = (t) => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aiteam-test-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true })); return dir; };
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

test('bus agrupa hilos, resuelve preguntas, expira y decide puertas', async () => {
  const events = []; const bus = new Bus({ touch() {}, emit: (...args) => events.push(args) });
  const run = { id: 'run-1' };
  const { message, promise } = bus.ask(run, { from: 'claude', to: 'codex', text: '¿Listo?', timeoutMs: 100 });
  assert.throws(() => bus.reply(run, message.id, 'gemini', 'sí'));
  const reply = bus.reply(run, message.id, 'codex', 'sí');
  assert.equal(await promise, reply);
  assert.equal(bus.threads(run)[0].messages.length, 2);
  assert.equal(message.status, 'answered');
  const expiring = bus.ask(run, { from: 'codex', to: 'gemini', text: '¿Ahora?', timeoutMs: 5 });
  assert.equal(await expiring.promise, null);
  assert.equal(expiring.message.status, 'timed_out');
  const gate = bus.gate(run, { question: '¿Continuar?', options: ['sí', 'no'] });
  const waiting = bus.waitForGate(gate);
  assert.throws(() => bus.decide(run, gate.id, 'quizá'));
  bus.decide(run, gate.id, 'sí');
  assert.equal(await waiting, 'sí');
  assert.equal(gate.status, 'decided');
  assert.ok(events.some(([name]) => name === 'bus-gate'));
});

test('instantáneas crean, deshacen y rehacen un turno', async (t) => {
  const cwd = temp(t); git(cwd, 'init');
  fs.writeFileSync(path.join(cwd, 'file.txt'), 'original');
  git(cwd, 'add', '-A'); git(cwd, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-m', 'initial');
  const chat = { id: 'chat-test', worktree: { path: cwd } };
  const turn = await snapshots.beforeTurn(chat);
  fs.writeFileSync(path.join(cwd, 'file.txt'), 'nuevo');
  git(cwd, 'add', '-A'); git(cwd, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-m', 'edit');
  await snapshots.afterTurn(chat, turn);
  assert.deepEqual((await snapshots.list(chat)).turns[0].files, ['file.txt']);
  await snapshots.undo(chat);
  assert.equal(fs.readFileSync(path.join(cwd, 'file.txt'), 'utf8'), 'original');
  await snapshots.redo(chat);
  assert.equal(fs.readFileSync(path.join(cwd, 'file.txt'), 'utf8'), 'nuevo');
});

test('comandos leen frontmatter, expanden argumentos y desconocidos quedan intactos', (t) => {
  const dir = temp(t); const commands = path.join(dir, '.aiteam', 'commands'); fs.mkdirSync(commands, { recursive: true });
  fs.writeFileSync(path.join(commands, 'revisa.md'), '---\ndescription: Revisar\nagent: codex\nmode: plan\n---\nRevisa $1 con $ARGUMENTS');
  assert.equal(parseFrontmatter('---\ndescription: Hola\n---\nCuerpo').data.description, 'Hola');
  assert.equal(expandTemplate('A: $1; todo: $ARGUMENTS', '"dos palabras" extra'), 'A: dos palabras; todo: "dos palabras" extra');
  assert.deepEqual(resolveSlash({ worktree: { path: dir } }, '/revisa archivo hoy'), { kind: 'custom', command: 'revisa', text: 'Revisa archivo con archivo hoy', agent: 'codex', mode: 'plan' });
  assert.equal(resolveSlash({ worktree: { path: dir } }, '/aiteam_test_comando_inexistente_7f2c'), null);
});

test('un comando creado desde la app queda en la copia y se puede ejecutar', (t) => {
  const cwd = temp(t);
  const chat = { worktree: { path: cwd } };
  createProjectCommand(chat, { name: 'auditar', description: 'Audita un archivo', agent: 'codex', mode: 'plan', template: 'Audita $1' });
  assert.equal(listCommands({ worktree: cwd })[0].name, 'auditar');
  assert.equal(resolveSlash(chat, '/auditar src/app.js').text, 'Audita src/app.js');
  assert.throws(() => createProjectCommand(chat, { name: '../salir', template: 'x' }));
});

test('compactación supera el umbral y conserva mensajes recientes', async (t) => {
  const dir = temp(t);
  const msgs = Array.from({ length: 5 }, (_, i) => ({ id: String(i), ts: new Date(2020, 0, i + 1).toISOString(), kind: 'message', text: 'x'.repeat(600) }));
  const chat = { agents: ['codex'], worktree: { path: dir } }; let calls = 0;
  const text = await compactHistory({ addMessage() {} }, chat, msgs, { render: (items) => items.map((m) => m.text).join('\n'), config: { enabled: true, thresholdChars: 2000, keepRecent: 2, agent: '', model: '', timeoutMs: 1000 }, summarize: async () => { calls++; return { ok: true, text: 'Resumen simulado' }; } });
  assert.equal(calls, 1); assert.equal(chat.compaction.count, 3);
  assert.match(text, /Resumen simulado/); assert.equal((text.match(/x{600}/g) ?? []).length, 2);
});

const waitExit = (entry, events) => new Promise((resolve, reject) => { const started = Date.now(); const poll = () => { if (events.some((e) => e.commandId === entry.id && e.type === 'exit')) return resolve(); if (Date.now() - started > 30_000) return reject(new Error('terminal timeout')); setTimeout(poll, 10); }; poll(); });
test('terminal ejecuta, cancela y recorta salida', async (t) => {
  const cwd = temp(t); const events = []; const emit = (_, e) => events.push(e); const ownerId = `test-${Date.now()}`;
  const previousDir = process.env.AITEAM_TERMINALS_DIR;
  process.env.AITEAM_TERMINALS_DIR = path.join(cwd, 'terminal-history');
  t.after(() => { if (previousDir === undefined) delete process.env.AITEAM_TERMINALS_DIR; else process.env.AITEAM_TERMINALS_DIR = previousDir; });
  const command = process.platform === 'win32' ? "Write-Output 'ok'" : "printf ok";
  const done = terminal.execute({ kind: 'chats', ownerId, cwd, actor: 'user', command, emit });
  await waitExit(done, events); assert.equal(done.status, 'done'); assert.match(done.stdout, /ok/);
  const long = process.platform === 'win32' ? "Write-Output ('x' * 90000)" : "yes x | head -c 90000";
  const bounded = terminal.execute({ kind: 'chats', ownerId, cwd, actor: 'user', command: long, emit });
  await waitExit(bounded, events); assert.ok(bounded.stdout.length <= 80000);
  const slow = process.platform === 'win32' ? 'Start-Sleep -Seconds 10' : 'sleep 10';
  const running = terminal.execute({ kind: 'chats', ownerId, cwd, actor: 'user', command: slow, emit });
  assert.equal(terminal.cancel('chats', ownerId, running.id), true);
  await waitExit(running, events); assert.equal(running.status, 'cancelled');
});
