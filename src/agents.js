import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { runProcess } from './runner.js';
import { loadConfig, saveConfig } from './config.js';
import { recordClaudeRateLimit, recordCall, touchUsage } from './usage.js';

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

const BUILTIN_IDS = new Set(Object.keys(AGENTS));
const SAFE_ID = /^[a-z][a-z0-9_]{1,23}$/;
const SAFE_COMMAND = /^[a-zA-Z0-9_.-]+$/;
const SAFE_ARG = /^[a-zA-Z0-9_./:=+-]+$/;

function validateCustom(input) {
  const id = String(input.id ?? '').trim().toLowerCase();
  const name = String(input.name ?? '').trim();
  const command = String(input.command ?? '').trim();
  const args = input.args ?? [];
  if (!SAFE_ID.test(id) || BUILTIN_IDS.has(id) || id === 'equipo' || id === 'todos' || id === 'team') throw new Error('Identificador inválido o reservado (2–24 letras, números o guion bajo).');
  if (!name || name.length > 48) throw new Error('El nombre debe tener entre 1 y 48 caracteres.');
  if (!SAFE_COMMAND.test(command)) throw new Error('Indica el nombre del ejecutable disponible en PATH, sin rutas ni espacios.');
  if (!Array.isArray(args) || args.length > 20 || args.some((a) => typeof a !== 'string' || !SAFE_ARG.test(a))) throw new Error('Los argumentos deben ser una lista de opciones simples, sin espacios ni caracteres de shell.');
  return { id, name, handle: id, vendor: 'CLI personalizado', tagline: String(input.tagline ?? '').trim().slice(0, 120), cli: command, args, color: '#8b6fd6', custom: true };
}

for (const item of Object.values(loadConfig().customAgents ?? {})) {
  try { const agent = validateCustom(item); AGENTS[agent.id] = agent; } catch { /* configuración antigua o dañada */ }
}

export function addCustomAgent(input) {
  const agent = validateCustom(input);
  if (AGENTS[agent.id]) throw new Error('Ya existe una IA con ese identificador.');
  saveConfig({
    customAgents: { [agent.id]: agent },
    agents: { [agent.id]: { enabled: true, model: '', profile: String(input.profile ?? '').trim().slice(0, 1000), capabilities: [] } },
  });
  AGENTS[agent.id] = agent;
  return agent;
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

function claudeArgs(mode, autonomy, model, session) {
  const args = ['-p', '--output-format', 'stream-json', '--verbose'];
  // Sesión propia por conversación: la primera vez se crea con un id fijo y después se reanuda.
  if (session?.id) args.push(session.resume ? '--resume' : '--session-id', session.id);
  if (mode === 'write') {
    args.push('--permission-mode', autonomy === 'full' ? 'bypassPermissions' : 'acceptEdits');
  } else if (mode === 'plan') {
    // Modo plan: el propio Claude Code solo permite herramientas y comandos de lectura (sin Bash que escriba),
    // aunque la autonomía sea total. Además, chat.js deshace cualquier cambio que quede en la copia.
    args.push('--permission-mode', 'plan', '--disallowedTools', 'Edit', 'Write', 'NotebookEdit');
  } else {
    args.push('--permission-mode', 'default', '--disallowedTools', 'Edit', 'Write', 'NotebookEdit');
  }
  if (model) args.push('--model', model);
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

function codexArgs(mode, autonomy, model, session) {
  const resuming = session?.resume && session.id;
  const args = resuming ? ['exec', 'resume', '--json', '--skip-git-repo-check'] : ['exec', '--json', '--skip-git-repo-check'];
  if (mode === 'write' && autonomy === 'full') args.push('--dangerously-bypass-approvals-and-sandbox');
  else if (resuming) args.push('-c', `sandbox_mode=${mode === 'write' ? 'workspace-write' : 'read-only'}`);
  else args.push('-s', mode === 'write' ? 'workspace-write' : 'read-only');
  // El sandbox "elevated" de Windows no puede escribir en las copias de trabajo; el no elevado sí.
  if (process.platform === 'win32') args.push('-c', 'windows.sandbox=unelevated');
  if (model) args.push('-m', model);
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

function agyArgs(mode, autonomy, model, session) {
  // El prompt va por stdin como NDJSON; "-p=" (vacío) activa el modo no interactivo.
  const args = ['--input-format', 'stream-json', '--output-format', 'stream-json'];
  if (mode === 'write') {
    if (autonomy === 'full') args.push('--dangerously-skip-permissions');
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
      error: process.env.AITEAM_MOCK_FAIL_KIND === 'network' ? 'read tcp 192.168.1.61:55922: wsarecv: A connection attempt failed (simulación).' : "You've hit your usage limit (simulación).",
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

async function invokeOnce(agentId, { prompt, cwd, mode = 'read', onEvent, onSpawn, timeoutMs, session, model: modelOverride, autonomy: autonomyOverride }) {
  const started = Date.now();
  if (MOCK) return { ...(await mockInvoke(agentId, { prompt, cwd, mode, onEvent })), durationMs: Date.now() - started };

  const config = loadConfig();
  const agentCfg = config.agents[agentId] ?? {};
  const autonomy = autonomyOverride ?? config.autonomy;
  const model = modelOverride ?? agentCfg.model?.trim();
  const timeout = timeoutMs ?? config.taskTimeoutMinutes * 60_000;
  const state = {};
  const emit = (msg) => onEvent?.(msg);

  const adapter = ADAPTERS[agentId] ?? (AGENTS[agentId]?.custom ? customAdapter : null);
  if (!adapter) throw new Error(`IA desconocida: ${agentId}`);
  const args = adapter.args({ mode, autonomy, model, session, agent: AGENTS[agentId] });
  const onLine = (line) => adapter.line?.(line, state, emit);

  recordCall(agentId);
  const input = adapter.input?.(prompt) ?? prompt;
  const res = await runProcess(AGENTS[agentId].cli, args, { cwd, input, timeoutMs: timeout, onLine, onSpawn });
  if (agentId === 'codex') touchUsage(); // Codex acaba de escribir su estado de límites en sus registros
  const durationMs = Date.now() - started;
  if (res.cancelled) return { ok: false, cancelled: true, error: 'Cancelado.', durationMs };
  if (res.timedOut) return { ok: false, error: `Tiempo agotado (${Math.round(timeout / 60_000)} min).`, durationMs };

  const out = adapter.result(res, state);
  return { ...out, durationMs };
}

const ADAPTERS = {
  claude: { args: ({ mode, autonomy, model, session }) => claudeArgs(mode, autonomy, model, session), line: claudeLine, result: claudeResult },
  codex: { args: ({ mode, autonomy, model, session }) => codexArgs(mode, autonomy, model, session), line: codexLine, result: codexResult },
  gemini: { args: ({ mode, autonomy, model, session }) => agyArgs(mode, autonomy, model, session), line: agyLine, result: agyResult,
    input: (prompt) => `${JSON.stringify({ event: 'user', message: { content: prompt } })}\n` },
};
// Contrato sencillo: el CLI recibe el prompt completo por stdin y devuelve texto por stdout.
// Se ejecuta por turno sin sesión propia; cada prompt contiene el contexto del chat.
const customAdapter = {
  args: ({ agent }) => agent.args,
  result: (res) => res.code === 0 && res.stdout.trim()
    ? { ok: true, text: res.stdout.trim() }
    : { ok: false, error: tail(res.stderr || res.stdout) || `El CLI terminó con código ${res.code}.` },
};

/** Comprueba si el CLI está instalado y, opcionalmente, si responde (consume un poco de cuota). */
export async function checkAgent(agentId, { live = false } = {}) {
  if (!AGENTS[agentId]) throw new Error(`IA desconocida: ${agentId}`);
  if (MOCK) return { installed: true, version: 'simulación', working: live ? true : null };
  const res = await runProcess(AGENTS[agentId].cli, ['--version'], { timeoutMs: 20_000 });
  const installed = res.code === 0 || (AGENTS[agentId].custom && !/not recognized|not found|ENOENT/i.test(res.stderr) && res.code != null);
  const version = installed ? (res.stdout.trim().split('\n')[0] || 'instalado') : null;
  if (!installed || !live) return { installed, version, working: null };
  const probe = await invokeAgent(agentId, {
    prompt: 'Responde únicamente con la palabra OK.',
    cwd: process.cwd(),
    mode: 'read',
    timeoutMs: 120_000,
  });
  return { installed, version, working: probe.ok, error: probe.ok ? undefined : probe.error };
}
