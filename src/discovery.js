import { runProcess } from './runner.js';

const CANDIDATES = [
  { id: 'claude', name: 'Claude Code', command: 'claude', kind: 'integrado' },
  { id: 'codex', name: 'Codex CLI', command: 'codex', kind: 'integrado' },
  { id: 'gemini', name: 'Antigravity CLI', command: 'agy', kind: 'integrado' },
  { id: 'opencode', name: 'OpenCode', command: 'opencode', kind: 'externo' },
  { id: 'aider', name: 'Aider', command: 'aider', kind: 'externo' },
  { id: 'goose', name: 'Goose', command: 'goose', kind: 'externo' },
];
const SAFE_COMMAND = /^[a-zA-Z0-9_.-]+$/;

export async function probeCommand(command) {
  if (!SAFE_COMMAND.test(String(command ?? ''))) throw new Error('Indica un nombre de ejecutable de PATH, sin rutas ni espacios.');
  const result = await runProcess(command, ['--version'], { timeoutMs: 5_000 });
  return {
    command,
    installed: result.code === 0,
    version: result.code === 0 ? (result.stdout || result.stderr).trim().split(/\r?\n/)[0].slice(0, 120) : null,
  };
}

export async function discoverAgents() {
  return Promise.all(CANDIDATES.map(async (candidate) => ({ ...candidate, ...(await probeCommand(candidate.command)) })));
}
