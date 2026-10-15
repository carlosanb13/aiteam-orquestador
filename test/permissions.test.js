import test from 'node:test';
import assert from 'node:assert/strict';
import { claudeArgs, codexArgs, agyArgs } from '../src/agents.js';
import { claudeInstallDenyRules, commandsInEvent, isInstallCommand, normalizeLevel } from '../src/permissions.js';
import { quoteWindowsArg } from '../src/runner.js';
import * as terminal from '../src/terminal.js';

test('detecta instalaciones, también en comandos compuestos y con envoltorios', () => {
  for (const cmd of [
    'npm install left-pad',
    'npm i -D vitest',
    'cd web && npm ci',
    'npx create-vite app',
    'pnpm add zod',
    'yarn add react',
    'pip install requests',
    'python -m pip install requests',
    'py -m pip install x',
    'winget install Git.Git',
    'choco install nodejs',
    'cmd /c npm install x',
    'powershell -NoProfile -Command npm install x',
    '"C:\\Program Files\\nodejs\\npm.cmd" install x',
    'C:\\nodejs\\npm.cmd install x',
    'npm.cmd install x',
    'Install-Module PSReadLine',
    'echo hola; cargo install ripgrep',
  ]) {
    assert.equal(isInstallCommand(cmd), true, cmd);
  }
});

test('no confunde comandos normales con instalaciones', () => {
  for (const cmd of ['npm test', 'npm run build', 'npm init -y', 'node --version', 'git status', 'pip --version', 'go test ./...', 'cargo build', 'npm run install-hooks', 'echo npm install']) {
    assert.equal(isInstallCommand(cmd), false, cmd);
  }
});

test('Claude en «Comandos en el proyecto»: comandos permitidos e instalaciones denegadas', () => {
  const args = claudeArgs('write', 'project', '', null);
  assert.ok(args.includes('acceptEdits'));
  const allow = args.indexOf('--allowedTools');
  assert.deepEqual(args.slice(allow + 1, allow + 3), ['Bash', 'PowerShell']);
  const deny = args.slice(args.indexOf('--disallowedTools') + 1);
  assert.ok(deny.includes('Bash(npm install:*)'));
  assert.ok(deny.includes('PowerShell(pip install:*)'));
  // "npm i" casaría también con "npm init": no se usa como regla de Claude (lo cubre la vigilancia de AITeam).
  assert.ok(!claudeInstallDenyRules().includes('Bash(npm i:*)'));
  assert.ok(!args.includes('bypassPermissions'));
});

test('Claude conserva los otros dos niveles', () => {
  assert.ok(claudeArgs('write', 'edits', '', null).includes('acceptEdits'));
  assert.ok(!claudeArgs('write', 'edits', '', null).includes('--allowedTools'));
  assert.ok(claudeArgs('write', 'full', '', null).includes('bypassPermissions'));
});

test('Codex: «Protegido» y «Comandos» usan el sandbox; solo «Control total» lo quita', () => {
  for (const level of ['edits', 'project']) {
    const args = codexArgs('write', level, '', null);
    assert.equal(args[args.indexOf('-s') + 1], 'workspace-write', level);
    assert.ok(!args.includes('--dangerously-bypass-approvals-and-sandbox'), level);
  }
  assert.ok(codexArgs('write', 'full', '', null).includes('--dangerously-bypass-approvals-and-sandbox'));
});

test('Antigravity: «Comandos» sin preguntas pero con su sandbox (sin red)', () => {
  const project = agyArgs('write', 'project', '', null);
  assert.ok(project.includes('--dangerously-skip-permissions') && project.includes('--sandbox'));
  const edits = agyArgs('write', 'edits', '', null);
  assert.ok(edits.includes('accept-edits') && !edits.includes('--dangerously-skip-permissions'));
  const full = agyArgs('write', 'full', '', null);
  assert.ok(full.includes('--dangerously-skip-permissions') && !full.includes('--sandbox'));
});

test('extrae los comandos de los eventos de cada CLI', () => {
  const claude = JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: 'npm install x' } }] } });
  const codex = JSON.stringify({ type: 'item.started', item: { type: 'command_execution', command: 'powershell -Command "npm i x"' } });
  assert.deepEqual(commandsInEvent(claude), ['npm install x']);
  assert.deepEqual(commandsInEvent(codex), ['powershell -Command "npm i x"']);
  assert.equal(isInstallCommand(commandsInEvent(codex)[0]), true);
  assert.deepEqual(commandsInEvent('no es json'), []);
});

test('en Windows, los argumentos con espacios van entre comillas', () => {
  assert.equal(quoteWindowsArg('Bash(npm install:*)'), '"Bash(npm install:*)"');
  assert.equal(quoteWindowsArg('--sandbox'), '--sandbox');
  assert.equal(quoteWindowsArg('windows.sandbox=unelevated'), 'windows.sandbox=unelevated');
  assert.equal(quoteWindowsArg('url="https://x"'), 'url="https://x"');
});

test('la terminal de AITeam aplica los mismos niveles a las IAs', () => {
  const base = { kind: 'chats', ownerId: 'c1', cwd: process.cwd(), actor: 'claude' };
  assert.throws(() => terminal.execute({ ...base, autonomy: 'edits', command: 'npm test' }), /protegido/);
  assert.throws(() => terminal.execute({ ...base, autonomy: 'project', command: 'npm install x' }), /instalar/);
  assert.equal(normalizeLevel('project'), 'project');
  assert.equal(normalizeLevel('raro', 'edits'), 'edits');
});
