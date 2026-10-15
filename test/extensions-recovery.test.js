import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const data = fs.mkdtempSync(path.join(os.tmpdir(), 'aiteam-features-'));
process.env.AITEAM_DATA_DIR = data;
test.after(() => fs.rmSync(data, { recursive: true, force: true }));
const Extensions = await import('../src/extensions.js');
const { ChatManager } = await import('../src/chat.js');
const { Orchestrator } = await import('../src/orchestrator.js');

test('MCP se habilita por proyecto y solo para los agentes elegidos', () => {
  const project = path.join(data, 'proyecto');
  Extensions.saveExtension(project, { id: 'docs', name: 'Documentación', url: 'https://example.com/mcp', agents: ['claude', 'codex'] });
  assert.equal(Extensions.listExtensions(project).length, 1);
  assert.deepEqual(Extensions.mcpArgs('gemini', project), []);
  assert.match(Extensions.mcpArgs('codex', project).join(' '), /mcp_servers\.docs\.url/);
  const claudeArgs = Extensions.mcpArgs('claude', project);
  assert.equal(claudeArgs[0], '--mcp-config');
  assert.equal(JSON.parse(fs.readFileSync(claudeArgs[1], 'utf8')).mcpServers.docs.url, 'https://example.com/mcp');
  Extensions.setExtensionEnabled(project, 'docs', false);
  assert.deepEqual(Extensions.mcpArgs('claude', project), []);
  assert.throws(() => Extensions.saveExtension(project, { id: 'bad', url: 'http://example.com', agents: ['claude'] }));
});

test('un turno pendiente queda disponible para reanudar después de reiniciar', () => {
  const id = 'chat-recovery';
  const file = path.join(data, 'chats', `${id}.json`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const request = { id: 'message-1', kind: 'message', from: 'user', text: '@codex termina la vista' };
  fs.writeFileSync(file, JSON.stringify({ id, title: 'Prueba', messages: [request], agents: ['codex'], worktree: { path: data }, working: { agent: 'codex' }, pendingTurns: [{ agent: 'codex', request, hop: 0 }] }));
  const manager = new ChatManager();
  assert.equal(manager.get(id).working, null);
  assert.equal(manager.get(id).pendingTurns.length, 1);
  manager.pump = () => {};
  assert.equal(manager.resume(id).resumed, 1);
  assert.equal(manager.queues.get(id).items[0].request.id, request.id);
});

test('reanudar una tarea conserva subtareas terminadas', async () => {
  const manager = new Orchestrator();
  const run = { id: 'run-recovery', status: 'interrupted', cleaned: false, tasks: [{ id: 'a', status: 'done' }, { id: 'b', status: 'failed', error: 'corte' }], activeAgents: ['codex'], integration: { branch: 'parcial', worktree: path.join(data, 'parcial') }, log: [], cancelled: true, error: 'corte' };
  manager.runs.set(run.id, run);
  let resumed = false;
  manager.wrap = () => { resumed = true; };
  await manager.resume(run.id);
  clearTimeout(manager.saveTimers.get(run.id));
  assert.equal(run.tasks[0].status, 'done');
  assert.equal(run.tasks[1].status, 'pending');
  assert.equal(run.cancelled, false);
  assert.equal(run.previousIntegrations[0].branch, 'parcial');
  assert.equal(run.integrationRevision, 1);
  assert.equal(resumed, true);
});
