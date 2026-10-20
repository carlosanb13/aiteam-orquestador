import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { runProcess } from './runner.js';
import { loadConfig, saveConfig } from './config.js';
import { recordClaudeRateLimit, recordCall, touchUsage } from './usage.js';
import { mcpArgs } from './extensions.js';

import { claudeInstallDenyRules, commandsInEvent, isInstallCommand, LEVEL_INFO } from './permissions.js';
import { killTree } from './runner.js';

export const AGENTS = {
  claude: {
    id: 'claude',
    name: 'Claude',
    handle: 'claude',
    vendor: 'Anthropic · Claude Code',
    tagline: 'Arquitectura, refactorizaciones y revisión de código',
    cli: 'claude',
    color: '#d97757',
  },
  codex: {
    id: 'codex',
    name: 'Codex',
    handle: 'codex',
    vendor: 'OpenAI · ChatGPT',
    tagline: 'Implementación rápida, depuración y tests',
    cli: 'codex',
    color: '#10a37f',
  },
  // Google retiró Gemini CLI para cuentas personales (incl. Google AI Pro); su sustituto es Antigravity CLI (agy).
  // El id interno sigue siendo "gemini" para no romper conversaciones y ajustes guardados.
  gemini: {
    id: 'gemini',
    name: 'Antigravity',
    handle: 'antigravity',
    vendor: 'Google · Antigravity CLI',
    tagline: 'Interfaces, imágenes, web y navegador',
    cli: 'agy',
    color: '#4285f4',
  },
};

import { ORCA_CATALOG } from './discovery.js';

const BUILTIN_IDS = new Set(Object.keys(AGENTS));
const CATALOG_BY_ID = new Map(ORCA_CATALOG.map((c) => [c.id, c]));
const SAFE_ID = /^[a-z][a-z0-9_]{1,23}$/;
const SAFE_COMMAND = /^[a-zA-Z0-9_.-]+$/;
const SAFE_ARG = /^[^\r\n\0]{1,120}$/;

function validateCustom(input) {
  const id = String(input.id ?? '').trim().toLowerCase();
  const name = String(input.name ?? '').trim();
  const command = String(input.command ?? '').trim();
  const args = input.args ?? [];
  if (!SAFE_ID.test(id) || BUILTIN_IDS.has(id) || id === 'equipo' || id === 'todos' || id === 'team') throw new Error('Identificador inválido o reservado (2–24 letras, números o guion bajo).');
  if (!name || name.length > 48) throw new Error('El nombre debe tener entre 1 y 48 caracteres.');
  if (!SAFE_COMMAND.test(command)) throw new Error('Indica el nombre del ejecutable disponible en PATH, sin rutas ni espacios.');
  if (!Array.isArray(args) || args.length > 24 || args.some((a) => typeof a !== 'string' || !SAFE_ARG.test(a))) throw new Error('Los argumentos deben ser una lista de opciones válidas.');
  const cat = CATALOG_BY_ID.get(id);
  return {
    id,
    name,
    handle: id,
    vendor: input.vendor || cat?.vendor || 'CLI personalizado',
    tagline: String(input.tagline ?? cat?.tagline ?? '').trim().slice(0, 120),
    cli: command,
    args,
    delivery: input.delivery || cat?.delivery || 'stdin',
    displayCmd: input.displayCmd || cat?.displayCmd || [command, ...args].join(' '),
    color: input.color || cat?.color || '#8b6fd6',
    custom: !cat?.builtin,
    catalogId: cat ? cat.id : undefined,
  };
}

export function syncRegisteredAgents() {
  const cfg = loadConfig();
  for (const id of Object.keys(AGENTS)) {
    if (!BUILTIN_IDS.has(id)) delete AGENTS[id];
  }
  // Agentes del catálogo de Orca activados por el usuario
  for (const [id, aCfg] of Object.entries(cfg.agents ?? {})) {
    if (BUILTIN_IDS.has(id)) continue;
    const cat = CATALOG_BY_ID.get(id);
    if (cat && aCfg?.enabled) {
      AGENTS[id] = {
        id: cat.id,
        name: cat.name,
        handle: cat.id,
        vendor: cat.vendor,
        tagline: cat.tagline,
        cli: aCfg.command || cat.command,
        args: Array.isArray(aCfg.args) && aCfg.args.length ? aCfg.args : cat.defaultArgs,
        delivery: aCfg.delivery || cat.delivery || 'stdin',
        displayCmd: aCfg.displayCmd || cat.displayCmd,
        color: cat.color || '#8b6fd6',
        custom: true,
        catalogId: cat.id,
      };
    }
  }
  // Agentes personalizados creados manualmente
  for (const item of Object.values(cfg.customAgents ?? {})) {
    try {
      const agent = validateCustom(item);
      if (cfg.agents?.[agent.id]?.enabled !== false) AGENTS[agent.id] = agent;
    } catch { /* configuración antigua o dañada */ }
  }
}

syncRegisteredAgents();

export function addCustomAgent(input) {
  const agent = validateCustom(input);
  saveConfig({
    customAgents: { [agent.id]: agent },
    agents: { [agent.id]: { enabled: true, model: '', profile: String(input.profile ?? agent.tagline ?? '').trim().slice(0, 1000), capabilities: [] } },
  });
  syncRegisteredAgents();
  return AGENTS[agent.id] ?? agent;
}

export function configureCatalogAgent(id, { enabled, command, args, displayCmd, makeDefault } = {}) {
  const cfg = loadConfig();
  const cat = CATALOG_BY_ID.get(id);
  const existing = AGENTS[id] || cfg.customAgents?.[id];
  if (!cat && !existing) throw new Error(`Agente desconocido: ${id}`);
  const prev = cfg.agents?.[id] ?? {};
  const nextAgentCfg = {
    ...prev,
    enabled: typeof enabled === 'boolean' ? enabled : (prev.enabled ?? true),
    profile: prev.profile || cat?.tagline || existing?.tagline || '',
    capabilities: prev.capabilities ?? [],
  };
  if (command && SAFE_COMMAND.test(command.trim())) nextAgentCfg.command = command.trim();
  if (Array.isArray(args)) nextAgentCfg.args = args.map((s) => String(s).trim()).filter(Boolean);
  if (typeof displayCmd === 'string' && displayCmd.trim()) {
    nextAgentCfg.displayCmd = displayCmd.trim();
    const parts = displayCmd.trim().split(/\s+/);
    if (parts[0] && SAFE_COMMAND.test(parts[0])) nextAgentCfg.command = parts[0];
  }
  const patch = { agents: { [id]: nextAgentCfg } };
  if (makeDefault) patch.defaultAgent = id;
  else if (cfg.defaultAgent === id && nextAgentCfg.enabled === false) patch.defaultAgent = 'claude';
  saveConfig(patch);
  syncRegisteredAgents();
  return { id, enabled: nextAgentCfg.enabled, defaultAgent: loadConfig().defaultAgent };
}

export const MOCK = process.argv.includes('--mock') || process.env.AITEAM_MOCK === '1';

const short = (s, n = 160) => {
  const one = String(s ?? '').replace(/\s+/g, ' ').trim();
  return one.length > n ? `${one.slice(0, n)}…` : one;
};

function tail(text, n = 1500) {
  const t = String(text ?? '').trim();
  return t.length > n ? `…${t.slice(-n)}` : t;
}

// ---------------------------------------------------------------- Claude Code

export function claudeArgs(mode, autonomy, model, session, extra = [], effort = '') {
  const args = ['-p', '--output-format', 'stream-json', '--verbose'];
  // Sesión propia por conversación: la primera vez se crea con un id fijo y después se reanuda.
  if (session?.id) args.push(session.resume ? '--resume' : '--session-id', session.id);
  if (mode === 'write') {
    if (autonomy === 'full') args.push('--permission-mode', 'bypassPermissions');
    else if (autonomy === 'project') {
      // Comandos permitidos, pero Claude Code deniega por sí mismo cualquier instalación conocida.
      args.push('--permission-mode', 'acceptEdits', '--allowedTools', 'Bash', 'PowerShell', '--disallowedTools', ...claudeInstallDenyRules());
    } else args.push('--permission-mode', 'acceptEdits');
  } else if (mode === 'plan') {
    // Modo plan: el propio Claude Code solo permite herramientas y comandos de lectura (sin Bash que escriba),
    // aunque la autonomía sea total. Además, chat.js deshace cualquier cambio que quede en la copia.
    args.push('--permission-mode', 'plan', '--disallowedTools', 'Edit', 'Write', 'NotebookEdit');
  } else {
    args.push('--permission-mode', 'default', '--disallowedTools', 'Edit', 'Write', 'NotebookEdit');
  }
  if (model) args.push('--model', model);
  if (effort && ['low', 'medium', 'high', 'max'].includes(effort)) args.push('--effort', effort === 'max' ? 'high' : effort);
  args.push(...extra);
  return args;
}

function claudeLine(line, state, onEvent) {
  let ev;
  try {
    ev = JSON.parse(line);
  } catch {
    return;
  }
  if (ev.type === 'assistant') {
    for (const c of ev.message?.content ?? []) {
      if (c.type === 'text' && c.text.trim()) onEvent(short(c.text));
      if (c.type === 'tool_use') {
        const i = c.input ?? {};
        onEvent(`🔧 ${c.name} ${short(i.command ?? i.file_path ?? i.pattern ?? i.description ?? '', 120)}`);
      }
    }
  } else if (ev.type === 'rate_limit_event') {
    recordClaudeRateLimit(ev.rate_limit_info);
  } else if (ev.type === 'result') {
    state.final = ev;
  }
}

function claudeResult(res, state) {
  const r = state.final;
  if (!r) return { ok: false, error: tail(res.stderr || res.stdout) || 'Claude no devolvió resultado.' };
  if (r.is_error) return { ok: false, error: short(r.result ?? r.subtype ?? 'error', 1500) };
  return { ok: true, text: r.result ?? '', sessionId: r.session_id };
}

// ---------------------------------------------------------------- Codex CLI

// "Protegido" y "Comandos en el proyecto" usan el mismo sandbox de Codex (workspace-write);
// en el segundo, AITeam además detiene a Codex si intenta instalar algo (ver GUARDED_AGENTS).
export function codexArgs(mode, autonomy, model, session, extra = [], effort = '') {
  const resuming = session?.resume && session.id;
  const args = resuming ? ['exec', 'resume', '--json', '--skip-git-repo-check'] : ['exec', '--json', '--skip-git-repo-check'];
  if (mode === 'write' && autonomy === 'full') args.push('--dangerously-bypass-approvals-and-sandbox');
  else if (resuming) args.push('-c', `sandbox_mode=${mode === 'write' ? 'workspace-write' : 'read-only'}`);
  else args.push('-s', mode === 'write' ? 'workspace-write' : 'read-only');
  // El sandbox "elevated" de Windows no puede escribir en las copias de trabajo; el no elevado sí.
  if (process.platform === 'win32') args.push('-c', 'windows.sandbox=unelevated');
  if (model) args.push('-m', model);
  if (effort && ['low', 'medium', 'high', 'max'].includes(effort)) args.push('-c', `model_reasoning_effort=${effort === 'max' ? 'high' : effort}`);
  args.push(...extra);
  if (resuming) args.push(session.id);
  args.push('-');
  return args;
}

function codexLine(line, state, onEvent) {
  let ev;
  try {
    ev = JSON.parse(line);
  } catch {
    return;
  }
  const item = ev.item;
  if (ev.type === 'item.completed' && item) {
    if (item.type === 'agent_message') {
      state.lastMessage = item.text;
      onEvent(short(item.text));
    } else if (item.type === 'command_execution') {
      onEvent(`🔧 ${short(item.command, 120)} → ${item.exit_code ?? '?'}`);
    } else if (item.type === 'file_change') {
      onEvent(`✏️ ${(item.changes ?? []).map((c) => c.path).join(', ')}`);
    } else if (item.type === 'error') {
      onEvent(`⚠ ${short(item.message, 200)}`);
    }
  } else if (ev.type === 'turn.failed' || ev.type === 'error') {
    state.error = ev.error?.message ?? ev.message ?? 'error';
  } else if (ev.type === 'thread.started') {
    state.sessionId = ev.thread_id;
  }
}

function codexResult(res, state) {
  // Un turno fallido (p. ej. límite de uso) cuenta como error aunque antes haya dicho algo.
  if (state.error) return { ok: false, error: short(state.error, 1500) };
  if (state.lastMessage == null) return { ok: false, error: tail(res.stderr || res.stdout) || 'Codex no devolvió respuesta.' };
  return { ok: true, text: state.lastMessage, sessionId: state.sessionId };
}

// ---------------------------------------------------------------- Antigravity CLI (Gemini)

export function agyArgs(mode, autonomy, model, session) {
  // El prompt va por stdin como NDJSON; "-p=" (vacío) activa el modo no interactivo.
  const args = ['--input-format', 'stream-json', '--output-format', 'stream-json'];
  if (mode === 'write') {
    if (autonomy === 'full') args.push('--dangerously-skip-permissions');
    // Sin preguntar, pero con el sandbox de terminal de Antigravity, que corta la red (no se puede instalar nada).
    else if (autonomy === 'project') args.push('--dangerously-skip-permissions', '--sandbox');
    else args.push('--mode', 'accept-edits');
  }
  if (session?.resume && session.id) args.push('--conversation', session.id);
  if (model) args.push('--model', model);
  args.push('-p=');
  return args;
}

const AGY_QUIET_STEPS = new Set(['user_input', 'agent_response', 'planner_response', 'checkpoint']);

function agyLine(line, state, onEvent) {
  let ev;
  try {
    ev = JSON.parse(line);
  } catch {
    return;
  }
  if (ev.event === 'init') {
    state.sessionId = ev.conversation_id;
  } else if (ev.event === 'step_update') {
    const st = ev.step_update ?? {};
    if (st.step_type === 'agent_response' && st.text_delta) {
      state.text = (state.text ?? '') + st.text_delta;
    } else if (st.state === 'DONE' && st.step_type && !AGY_QUIET_STEPS.has(st.step_type)) {
      const detail = st.title ?? st.summary ?? st.tool_name ?? st.command ?? st.file_path ?? '';
      onEvent(`🔧 ${st.step_type.replace(/_/g, ' ')} ${short(detail, 120)}`);
    }
    if (st.step_type === 'agent_response' && st.state === 'DONE' && state.text?.trim()) {
      onEvent(short(state.text));
      state.text = '';
    }
  } else if (ev.event === 'result') {
    state.final = ev.result;
  }
}

function agyResult(res, state) {
  const r = state.final;
  if (!r) {
    const err = res.stderr.match(/Error[^\n]*/)?.[0];
    return { ok: false, error: short(err ?? (tail(res.stderr || res.stdout) || 'Antigravity no devolvió respuesta.'), 1500) };
  }
  if (r.status !== 'SUCCESS') {
    const msg = typeof r.error === 'string' ? r.error : (r.error?.message ?? JSON.stringify(r.error ?? r.status));
    return { ok: false, error: short(msg, 1500) };
  }
  return { ok: true, text: r.response ?? '', sessionId: r.conversation_id ?? state.sessionId };
}

// ---------------------------------------------------------------- Simulación

async function mockInvoke(agentId, { prompt, cwd, mode, onEvent }) {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  onEvent?.('(simulación) pensando…');
  await wait(600 + Math.random() * 900);
  const kind = prompt.match(/\[\[KIND:(\w+)\]\]/)?.[1];
  // AITEAM_MOCK_FAIL=codex simula que esa IA se queda sin cuota al trabajar (para probar el relevo).
  if (kind === 'task' && process.env.AITEAM_MOCK_FAIL === agentId) {
    return {
      ok: false,
      // AITEAM_MOCK_FAIL_KIND=network simula un corte de red en lugar de falta de cuota.
      error: process.env.AITEAM_MOCK_FAIL_KIND === 'network' ? 'read tcp 192.0.2.10:55922: wsarecv: A connection attempt failed (simulación).' : "You've hit your usage limit (simulación).",
    };
  }
  let json;
  if (kind === 'compact') {
    return { ok: true, text: `(simulación) Resumen hecho por ${agentId}: el usuario y el equipo han hablado de varios cambios en el proyecto.` };
  }
  if (kind === 'chat') {
    if (mode === 'write' && cwd) fs.appendFileSync(path.join(cwd, `chat-demo-${agentId}.txt`), `${new Date().toISOString()}\n`);
    await wait(500 + Math.random() * 800);
    const hop = Number(prompt.match(/\[\[HOP:(\d+)\]\]/)?.[1] ?? 0);
    const mate = prompt.match(/Compañeros disponibles: @(\w+)/)?.[1];
    let text = `(simulación) Soy ${agentId}. He leído la conversación y he dejado un cambio en chat-demo-${agentId}.txt.`;
    if (hop === 0 && mate) text += `\n\n@${mate}: revisa lo que acabo de hacer, por favor.`;
    return { ok: true, text, sessionId: `mock-${agentId}` };
  }
  if (kind === 'plan') {
    json = {
      tasks: [
        { id: 't1', title: 'Diseñar la estructura del módulo', description: 'Crear la estructura base.', kind: 'arquitectura', dependsOn: [] },
        { id: 't2', title: 'Implementar la lógica principal', description: 'Escribir la lógica.', kind: 'backend', dependsOn: ['t1'] },
        { id: 't3', title: 'Escribir la documentación', description: 'Documentar el uso.', kind: 'documentación', dependsOn: [] },
        { id: 't4', title: 'Añadir tests', description: 'Cubrir los casos principales.', kind: 'tests', dependsOn: ['t2'] },
        { id: 't5', title: 'Generar el logo como imagen PNG', description: 'Usar el generador de imágenes.', kind: 'diseño', dependsOn: [], requires: ['images'] },
      ],
    };
  } else if (kind === 'bid') {
    const ids = [...prompt.matchAll(/^- id: (\S+)/gm)].map((m) => m[1]);
    json = {
      bids: ids.map((id) => ({ taskId: id, score: Math.round(3 + Math.random() * 7), reason: `(simulación) ${agentId} se ve capaz.` })),
      review: { score: Math.round(4 + Math.random() * 6), reason: '(simulación)' },
    };
  } else if (kind === 'attack') {
    json = {
      summary: '(simulación) He intentado romperlo con entradas vacías y enormes.',
      findings: [{ severity: 'media', file: 'chat-demo.txt', title: 'Entrada vacía', description: '(simulación) no se valida.', reproduce: 'Pasar ""', fix: 'Validar la entrada.' }],
    };
  } else if (kind === 'review') {
    const approved = Math.random() > 0.4;
    json = {
      approved,
      issues: approved ? [] : [{ severity: 'media', file: 'aiteam-demo.txt', description: '(simulación) falta un caso límite.' }],
      summary: approved ? 'Todo correcto.' : 'Hay un detalle que corregir.',
    };
  } else {
    if (mode === 'write' && cwd) {
      fs.appendFileSync(path.join(cwd, `aiteam-demo-${agentId}.txt`), `${new Date().toISOString()} ${agentId}\n`);
      onEvent?.(`✏️ aiteam-demo-${agentId}.txt`);
    }
    await wait(800 + Math.random() * 1500);
    json = {
      summary: `(simulación) ${agentId} completó su parte.`,
      messages: [{ to: 'all', text: `(simulación) ${agentId}: he dejado mis cambios en aiteam-demo-${agentId}.txt` }],
    };
  }
  return { ok: true, text: `Hecho.\n<<<JSON\n${JSON.stringify(json, null, 2)}\nJSON>>>` };
}

// ---------------------------------------------------------------- API pública

/**
 * Invoca una IA en modo no interactivo.
 * mode: "read" (solo lectura) | "plan" (solo lectura, también con control total; ver commands.js)
 *       | "write" (puede editar en `cwd`).
 * Devuelve { ok, text, error, sessionId, durationMs }.
 */
// Cortes de red momentáneos: merecen un reintento con la misma IA antes de dar la tarea por fallida.
const NETWORK_ERROR =
  /ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|EPIPE|wsarecv|wsasend|socket hang up|fetch failed|network (error|is unreachable)|connection attempt failed|failed to respond|connection (was )?(reset|closed|refused)|TLS handshake timeout|\b50[234]\b|service unavailable|overloaded/i;
const NETWORK_RETRY_DELAY_MS = 8000;

export const isNetworkError = (error) => NETWORK_ERROR.test(String(error ?? '')) && !/usage limit|rate.?limit|quota/i.test(String(error ?? ''));

export async function invokeAgent(agentId, options) {
  let res = await invokeOnce(agentId, options);
  if (!res.ok && !res.cancelled && isNetworkError(res.error)) {
    options.onEvent?.(`↻ Error de red (${res.error.slice(0, 80)}…); se reintenta en ${NETWORK_RETRY_DELAY_MS / 1000} s.`);
    await new Promise((r) => setTimeout(r, NETWORK_RETRY_DELAY_MS));
    res = { ...(await invokeOnce(agentId, options)), networkRetried: true };
  }
  // Si no se pudo reanudar la sesión (borrada, caducada...), se empieza una nueva con todo el contexto.
  if (!res.ok && options.session?.resume && !res.cancelled && !/usage limit|rate.?limit|quota/i.test(res.error ?? '') && !isNetworkError(res.error)) {
    options.onEvent?.('↻ No se pudo reanudar la sesión; se abre una nueva.');
    const fresh = await invokeOnce(agentId, { ...options, prompt: options.fallbackPrompt ?? options.prompt, session: { id: agentId === 'claude' ? crypto.randomUUID() : null, resume: false } });
    return { ...fresh, sessionReset: true };
  }
  return res;
}

async function invokeOnce(agentId, { prompt, cwd, repoPath, mode = 'read', onEvent, onSpawn, timeoutMs, session, model: modelOverride, effort = '', autonomy: autonomyOverride }) {
  const started = Date.now();
  if (MOCK) return { ...(await mockInvoke(agentId, { prompt, cwd, mode, onEvent })), durationMs: Date.now() - started };

  const config = loadConfig();
  const agentCfg = config.agents[agentId] ?? {};
  const autonomy = autonomyOverride ?? config.autonomy;
  const model = modelOverride || agentCfg.model?.trim() || '';
  const timeout = timeoutMs ?? config.taskTimeoutMinutes * 60_000;
  const state = {};
  const emit = (msg) => onEvent?.(msg);

  const adapter = ADAPTERS[agentId] ?? (AGENTS[agentId]?.custom ? customAdapter : null);
  if (!adapter) throw new Error(`IA desconocida: ${agentId}`);
  const args = adapter.args({ mode, autonomy, model, effort, session, prompt, agent: AGENTS[agentId], extra: mcpArgs(agentId, repoPath) });
  // En «Comandos en el proyecto», AITeam vigila los comandos de las IAs cuyo CLI no bloquea instalaciones
  // por sí mismo y las detiene en cuanto intentan instalar algo.
  const guard = mode === 'write' && autonomy === 'project' && GUARDED_AGENTS(agentId);
  let child = null;
  const onLine = (line) => {
    if (guard && !state.blocked) {
      const cmd = commandsInEvent(line).find(isInstallCommand);
      if (cmd) {
        state.blocked = cmd;
        emit(`⛔ AITeam detiene a ${AGENTS[agentId].name}: intentó instalar (${cmd.slice(0, 80)}).`);
        if (child) killTree(child);
        return;
      }
    }
    adapter.line?.(line, state, emit);
  };

  recordCall(agentId);
  const input = adapter.input ? adapter.input(prompt, AGENTS[agentId]) : prompt;
  const res = await runProcess(AGENTS[agentId].cli, args, {
    cwd,
    input,
    timeoutMs: timeout,
    onLine,
    onSpawn: (c) => {
      child = c;
      onSpawn?.(c);
    },
  });
  if (state.blocked) {
    return {
      ok: false,
      policyBlocked: true,
      error: `AITeam detuvo a ${AGENTS[agentId].name}: intentó instalar dependencias (\`${state.blocked.slice(0, 120)}\`) y el nivel «${LEVEL_INFO.project.label}» no lo permite. Si de verdad hace falta, activa «Control total».`,
      durationMs: Date.now() - started,
    };
  }
  if (agentId === 'codex') touchUsage(); // Codex acaba de escribir su estado de límites en sus registros
  const durationMs = Date.now() - started;
  if (res.cancelled) return { ok: false, cancelled: true, error: 'Cancelado.', durationMs };
  if (res.timedOut) return { ok: false, error: `Tiempo agotado (${Math.round(timeout / 60_000)} min).`, durationMs };

  const out = adapter.result(res, state);
  return { ...out, durationMs };
}

// CLIs que no bloquean instalaciones por sí mismos en «Comandos en el proyecto» (ver src/permissions.js).
const GUARDED_AGENTS = (agentId) => agentId !== 'claude' && agentId !== 'gemini';

const ADAPTERS = {
  claude: { args: ({ mode, autonomy, model, effort, session, extra }) => claudeArgs(mode, autonomy, model, session, extra, effort), line: claudeLine, result: claudeResult },
  openclaude: { args: ({ mode, autonomy, model, effort, session, extra }) => claudeArgs(mode, autonomy, model, session, extra, effort), line: claudeLine, result: claudeResult },
  codex: { args: ({ mode, autonomy, model, effort, session, extra }) => codexArgs(mode, autonomy, model, session, extra, effort), line: codexLine, result: codexResult },
  gemini: { args: ({ mode, autonomy, model, session }) => agyArgs(mode, autonomy, model, session), line: agyLine, result: agyResult,
    input: (prompt) => `${JSON.stringify({ event: 'user', message: { content: prompt } })}\n` },
};

const stripAnsi = (s) => String(s ?? '').replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, '');

// Adaptador universal para agentes del catálogo de Orca y CLIs personalizados (soporta entrega por stdin o argv).
const customAdapter = {
  args: ({ agent, model, prompt }) => {
    const base = [...(agent.args ?? [])];
    if (model && !base.includes('--model') && !base.includes('-m')) base.push('--model', model);
    if (agent.delivery === 'argv') base.push(prompt);
    return base;
  },
  input: (prompt, agent) => (agent?.delivery === 'argv' ? '' : prompt),
  line: (line, _state, emit) => {
    const clean = stripAnsi(line).trim();
    if (!clean) return;
    if (clean.startsWith('{')) {
      try {
        const j = JSON.parse(clean);
        const txt = j.text ?? j.content ?? j.message ?? j.delta;
        if (typeof txt === 'string' && txt.trim()) emit(short(txt));
        return;
      } catch { /* texto normal */ }
    }
    emit(short(clean));
  },
  result: (res) => {
    const out = stripAnsi(res.stdout).trim();
    return res.code === 0 && out
      ? { ok: true, text: out }
      : { ok: false, error: tail(stripAnsi(res.stderr || res.stdout)) || `El CLI terminó con código ${res.code}.` };
  },
};

/** Comprueba si el CLI está instalado y, opcionalmente, si responde (consume un poco de cuota). */
export async function checkAgent(agentId, { live = false } = {}) {
  if (!AGENTS[agentId]) throw new Error(`IA desconocida: ${agentId}`);
  if (MOCK) return { installed: true, version: 'simulación', working: live ? true : null };
  const res = await runProcess(AGENTS[agentId].cli, ['--version'], { timeoutMs: 12_000 });
  const installed = res.code === 0 || (AGENTS[agentId].custom && !/not recognized|not found|ENOENT/i.test(res.stderr) && res.code != null);
  const version = installed ? (stripAnsi(res.stdout || res.stderr).trim().split('\n')[0] || 'instalado') : null;
  if (!installed || !live) return { installed, version, working: null };
  const probe = await invokeAgent(agentId, {
    prompt: 'Responde únicamente con la palabra OK.',
    cwd: process.cwd(),
    mode: 'read',
    timeoutMs: 120_000,
  });
  return { installed, version, working: probe.ok, error: probe.ok ? undefined : probe.error };
}
