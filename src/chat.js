import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import * as G from './git.js';
import * as Snapshots from './snapshots.js';
import { AGENTS, invokeAgent } from './agents.js';
import { DATA_DIR, loadConfig } from './config.js';
import { killTree } from './runner.js';
import { canDo, describeRequires, detectRequires } from './capabilities.js';
import { projectRules } from './prompts.js';
import { chatMode, invokeMode, modeText, resolveSlash, setChatMode } from './commands.js';
import * as Compaction from './compaction.js';

const CHATS_DIR = path.join(DATA_DIR, 'chats');
const MAX_HOPS = 4;
const QUOTA_RETRY_MS = 60 * 60_000; // tras una hora se vuelve a intentar con una IA que se quedó sin cuota // cuántas veces seguidas pueden pasarse la palabra las IAs sin que intervengas
const QUOTA_ERROR = /usage limit|rate.?limit|quota|limit reached|resource.?exhausted|too many requests|\b429\b|credits/i;

// Alias que se aceptan al mencionar.
const ALIASES = {
  claude: 'claude',
  codex: 'codex',
  chatgpt: 'codex',
  gpt: 'codex',
  openai: 'codex',
  gemini: 'gemini',
  google: 'gemini',
  antigravity: 'gemini',
  agy: 'gemini',
};
// Errores de sesión: la IA no podrá responder hasta que el usuario vuelva a iniciar sesión.
const AUTH_ERROR = /IneligibleTier|authenticat|not logged in|login required|please log ?in|unauthori[sz]ed|401/i;
const TEAM_ALIASES = new Set(['equipo', 'todos', 'team', 'all']);

const short = (s, n = 160) => {
  const one = String(s ?? '').replace(/\s+/g, ' ').trim();
  return one.length > n ? `${one.slice(0, n)}…` : one;
};

/**
 * Garantía del modo plan: devuelve la copia al commit de antes del turno y borra lo no versionado.
 * Devuelve true si la IA había dejado cambios (archivos o commits propios).
 */
export async function revertPlanWrites(worktree, head) {
  const status = await G.git(worktree, ['status', '--porcelain'], { allowFail: true });
  const now = (await G.git(worktree, ['rev-parse', 'HEAD'], { allowFail: true })).stdout.trim();
  const moved = Boolean(head && now && now !== head);
  if (!status.stdout.trim() && !moved) return false;
  await G.git(worktree, ['reset', '-q', '--hard', head || 'HEAD'], { allowFail: true });
  await G.git(worktree, ['clean', '-fdq'], { allowFail: true });
  return true;
}

/** Menciones del usuario: "@claude haz X" o "@equipo ...". */
export function parseMentions(text, members) {
  const found = new Set();
  for (const m of String(text).matchAll(/@([a-záéíóú][a-z0-9_]*)/gi)) {
    const word = m[1].toLowerCase();
    if (TEAM_ALIASES.has(word)) members.forEach((a) => found.add(a));
    else {
      const id = ALIASES[word] ?? members.find((a) => AGENTS[a]?.handle === word);
      if (id && members.includes(id)) found.add(id);
    }
  }
  return [...found];
}

/**
 * Peticiones de una IA a sus compañeras: una línea que empieza por "@nombre:" y el texto que sigue
 * hasta la siguiente línea en blanco o la siguiente mención.
 */
export function parseDelegations(text, members, self) {
  const lines = String(text).split(/\r?\n/);
  const out = [];
  let current = null;
  for (const line of lines) {
    const m = line.match(/^\s*(?:[-*>]\s*)?\**@([a-zA-Z][a-zA-Z0-9_]*)\**\s*[:,—–-]\s*(.*)$/);
    const target = m && (TEAM_ALIASES.has(m[1].toLowerCase()) ? 'team' : (ALIASES[m[1].toLowerCase()] ?? members.find((a) => AGENTS[a]?.handle === m[1].toLowerCase())));
    if (target) {
      current = { target, text: m[2] };
      out.push(current);
    } else if (current && line.trim()) {
      current.text += `\n${line}`;
    } else {
      current = null;
    }
  }
  const result = [];
  for (const d of out) {
    const targets = d.target === 'team' ? members.filter((a) => a !== self) : [d.target];
    for (const t of targets) {
      if (t !== self && members.includes(t) && d.text.trim()) result.push({ to: t, text: d.text.trim() });
    }
  }
  return result;
}

function teamText(members) {
  const cfg = loadConfig();
  return members.map((id) => `- @${AGENTS[id].handle} (${AGENTS[id].name}): ${cfg.agents[id]?.profile ?? ''}`).join('\n');
}

function transcript(messages) {
  return messages
    .filter((m) => m.kind === 'message')
    .map((m) => {
      const who = m.from === 'user' ? 'USUARIO' : m.from === 'system' ? 'SISTEMA' : `@${AGENTS[m.from]?.handle ?? m.from}`;
      const to = m.to?.length ? ` → ${m.to.map((t) => `@${AGENTS[t]?.handle ?? t}`).join(', ')}` : '';
      return `[${who}${to}]\n${m.text}`;
    })
    .join('\n\n');
}

function chatPrompt(chat, agent, request, history, isNewSession, hop, mode) {
  const others = chat.agents.filter((a) => a !== agent && !chat.exhausted?.[a]);
  return `[[KIND:chat]] [[HOP:${hop}]]
Eres @${AGENTS[agent].handle} (${AGENTS[agent].name}) y formas parte de AITeam, un equipo de IAs que conversa en un chat compartido con el usuario y entre sí.

EQUIPO:
${teamText(chat.agents)}

MODO: ${(chat.autonomy ?? loadConfig().autonomy) === 'full'
    ? 'CONTROL TOTAL. Puedes ejecutar comandos, instalar dependencias y herramientas, lanzar servidores, usar la web y tus servidores MCP sin pedir permiso. Úsalo con responsabilidad: nada destructivo fuera del proyecto sin que el usuario lo pida.'
    : 'PROTEGIDO. Trabaja dentro de la copia del proyecto con los permisos del CLI; evita instalaciones y operaciones fuera del proyecto. Si necesitas acceso completo, explícalo al usuario.'}
${modeText(mode)}${projectRules(chat.worktree.path, agent)}
ESPACIO DE TRABAJO: el directorio actual es una copia del proyecto del usuario${chat.repoPath ? ` (${chat.repoPath})` : ''} compartida por todo el equipo en esta conversación. Puedes leer y modificar archivos; tus cambios quedan guardados y tus compañeros los verán. El usuario decidirá después si los aplica a su proyecto.

${isNewSession ? 'CONVERSACIÓN HASTA AHORA' : 'MENSAJES NUEVOS DESDE TU ÚLTIMO TURNO'}:
${history || '(ninguno)'}

TE TOCA RESPONDER A:
[${request.fromLabel}] ${request.text}

Cómo trabajar en equipo:
- Responde en español, de forma directa, como un compañero de trabajo. Si te piden un cambio, hazlo en los archivos y explica brevemente qué hiciste.
${others.length ? `- Si otra IA del equipo es más adecuada para una parte, o quieres que revise lo que hiciste, pídeselo escribiendo una línea aparte que empiece por su mención, por ejemplo:
  @${AGENTS[others[0]].handle}: revisa la función X de src/y.js y corrige lo que veas.
  Esa IA recibirá tu petición y responderá en el chat. Hazlo solo cuando aporte algo; no delegues por delegar.
- Compañeros disponibles: ${others.map((a) => `@${AGENTS[a].handle}`).join(', ')}.` : '- Ahora mismo eres la única IA en esta conversación.'}
- No te menciones a ti mismo y no hagas commits (se hacen automáticamente).`;
}

export class ChatManager extends EventEmitter {
  chats = new Map();
  queues = new Map(); // chatId -> { items: [], running: bool, child }

  constructor({ onTeamTask } = {}) {
    super();
    this.onTeamTask = onTeamTask;
    fs.mkdirSync(CHATS_DIR, { recursive: true });
    for (const file of fs.readdirSync(CHATS_DIR)) {
      if (!file.endsWith('.json')) continue;
      try {
        const chat = JSON.parse(fs.readFileSync(path.join(CHATS_DIR, file), 'utf8'));
        // La cola vive en memoria, pero las peticiones pendientes sobreviven a un reinicio.
        chat.pendingTurns ??= [];
        if (chat.working && !chat.pendingTurns.length) {
          const request = [...chat.messages].reverse().find((m) => m.kind === 'message' && m.from === 'user');
          if (request) chat.pendingTurns.push({ agent: chat.working.agent, request, hop: 0 });
        }
        chat.working = null;
        this.chats.set(chat.id, chat);
      } catch {
        /* archivo dañado */
      }
    }
  }

  list() {
    return [...this.chats.values()]
      .sort((a, b) => (b.updatedAt ?? b.createdAt).localeCompare(a.updatedAt ?? a.createdAt))
      .map((c) => ({ id: c.id, title: c.title, createdAt: c.createdAt, updatedAt: c.updatedAt, agents: c.agents, repoPath: c.repoPath, branch: c.worktree?.branch, working: c.working, pendingCount: c.pendingTurns?.length ?? 0, mode: chatMode(c) }));
  }

  get(id) {
    return this.chats.get(id);
  }

  save(chat) {
    chat.updatedAt = new Date().toISOString();
    fs.writeFileSync(path.join(CHATS_DIR, `${chat.id}.json`), JSON.stringify(chat, null, 2));
    this.emit('chat', chat);
  }

  addMessage(chat, msg) {
    const full = { id: crypto.randomUUID(), ts: new Date().toISOString(), kind: 'message', to: [], ...msg };
    chat.messages.push(full);
    this.save(chat);
    return full;
  }

  isExhausted(chat, agent) {
    const e = chat.exhausted?.[agent];
    if (!e) return false;
    if (Date.now() - new Date(e.at ?? 0).getTime() > QUOTA_RETRY_MS) {
      delete chat.exhausted[agent];
      return false;
    }
    return true;
  }

  available(chat) {
    return chat.agents.filter((a) => !this.isExhausted(chat, a));
  }

  async create({ repoPath, agents, title }) {
    const members = (agents ?? []).filter((a) => AGENTS[a]);
    if (!members.length) throw new Error('Elige al menos una IA.');
    const info = await G.inspectRepo(String(repoPath ?? '').trim());
    const id = `${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${crypto.randomBytes(3).toString('hex')}`;
    const worktree = {
      path: path.join(path.dirname(info.root), `.aiteam-${path.basename(info.root)}`, `chat-${id}`),
      branch: `aiteam/chat-${id}`,
    };
    await G.addWorktree(info.root, worktree.path, worktree.branch, info.baseCommit);
    const chat = {
      id,
      title: short(title, 80) || 'Nueva conversación',
      createdAt: new Date().toISOString(),
      repoPath: info.root,
      baseCommit: info.baseCommit,
      baseBranch: info.baseBranch,
      dirty: info.dirty,
      worktree,
      agents: members,
      sessions: {},
      exhausted: {},
      messages: [],
      working: null,
      pendingTurns: [],
    };
    this.chats.set(id, chat);
    this.addMessage(chat, {
      from: 'system',
      kind: 'notice',
      text: `Conversación creada sobre una copia de ${info.root} (rama ${worktree.branch}). Menciona a ${members.map((a) => `@${AGENTS[a].handle}`).join(', ')} o a @equipo.`,
    });
    return chat;
  }

  update(id, patch) {
    const chat = this.chats.get(id);
    if (!chat) throw new Error('No existe esa conversación.');
    if (patch.autonomy && ['edits', 'full'].includes(patch.autonomy) && patch.autonomy !== chat.autonomy) {
      chat.autonomy = patch.autonomy;
      this.addMessage(chat, {
        from: 'system',
        kind: 'notice',
        text:
          chat.autonomy === 'full'
            ? 'Control total activado: las IAs pueden ejecutar comandos, instalar dependencias y usar sus herramientas sin pedir permiso.'
            : 'Modo protegido: las IAs trabajan en la copia con las restricciones de sus CLI.',
      });
    }
    if (typeof patch.title === 'string' && patch.title.trim()) {
      chat.title = short(patch.title, 80);
      this.save(chat);
    }
    return chat;
  }

  /** Mensaje del usuario. Devuelve el mensaje guardado. */
  post(id, text) {
    const chat = this.chats.get(id);
    if (!chat) throw new Error('No existe esa conversación.');
    text = String(text ?? '').trim();
    if (!text) throw new Error('Escribe un mensaje.');

    // Comandos "/": /equipo, /plan, /build, /compact y los personalizados de .aiteam/commands (ver commands.js).
    const slash = resolveSlash(chat, text);
    let mode;
    let meta;
    if (slash?.kind === 'team') {
      // /equipo <objetivo> lanza una tarea de equipo completa (planificar, negociar, paralelo, revisión).
      const msg = this.addMessage(chat, { from: 'user', text });
      this.launchTeamTask(chat, slash.goal).catch((err) =>
        this.addMessage(chat, { from: 'system', kind: 'error', text: `No se pudo lanzar la tarea de equipo: ${err.message}` }),
      );
      return msg;
    }
    if (slash?.kind === 'compact') {
      const msg = this.addMessage(chat, { from: 'user', text });
      this.enqueue(chat, { run: () => this.compactNow(chat) });
      return msg;
    }
    if (slash?.kind === 'mode' && !slash.text) {
      const msg = this.addMessage(chat, { from: 'user', text });
      setChatMode(this, chat, slash.mode);
      return msg;
    }
    if (slash?.kind === 'mode') {
      // "/plan texto": solo este mensaje va en ese modo.
      text = slash.text;
      mode = slash.mode;
    }
    if (slash?.kind === 'custom') {
      meta = { command: slash.command, input: text };
      mode = slash.mode ?? undefined;
      text = slash.agent && chat.agents.includes(slash.agent) && !parseMentions(slash.text, chat.agents).length ? `@${AGENTS[slash.agent].handle} ${slash.text}` : slash.text;
    }

    let targets = parseMentions(text, chat.agents);
    if (!targets.length) {
      // Sin mención: responde quien habló por última vez (o la primera IA de la conversación).
      const last = [...chat.messages].reverse().find((m) => m.kind === 'message' && AGENTS[m.from]);
      targets = [last?.from && chat.agents.includes(last.from) ? last.from : chat.agents[0]];
    }
    if (chat.title === 'Nueva conversación') chat.title = short(text.replace(/@\w+/g, ''), 60) || chat.title;
    const msg = this.addMessage(chat, { from: 'user', text, to: targets, ...(mode || meta ? { meta: { ...meta, ...(mode && { mode }) } } : {}) });
    for (const agent of targets) this.enqueue(chat, { agent, request: msg, hop: 0, mode });
    return msg;
  }

  async launchTeamTask(chat, goal) {
    if (!this.onTeamTask) throw new Error('No disponible.');
    const run = await this.onTeamTask({ repoPath: chat.repoPath, goal, agents: this.available(chat), baseRef: chat.worktree.branch, autonomy: chat.autonomy ?? loadConfig().autonomy });
    this.addMessage(chat, {
      from: 'system',
      kind: 'notice',
      text: `Tarea de equipo lanzada: «${short(goal, 120)}». Las IAs van a planificar, negociar el reparto y trabajar en paralelo.`,
      meta: { runId: run.id },
    });
  }

  enqueue(chat, item, { restore = false, front = false } = {}) {
    if (!this.queues.has(chat.id)) this.queues.set(chat.id, { items: [], running: false, child: null });
    const q = this.queues.get(chat.id);
    if (front) q.items.unshift(item);
    else q.items.push(item);
    if (item.agent && !restore) {
      chat.pendingTurns ??= [];
      const pending = { agent: item.agent, request: item.request, hop: item.hop, relayedFrom: item.relayedFrom, mode: item.mode };
      if (front) chat.pendingTurns.unshift(pending);
      else chat.pendingTurns.push(pending);
      this.save(chat);
    }
    this.pump(chat);
  }

  resume(id) {
    const chat = this.get(id);
    if (!chat) throw new Error('No existe esa conversación.');
    if (chat.working || this.queues.get(id)?.running) throw new Error('El equipo ya está trabajando.');
    const pending = chat.pendingTurns ?? [];
    if (!pending.length) throw new Error('No hay turnos pendientes para recuperar.');
    const q = { items: pending.map((item) => ({ ...item })), running: false, child: null };
    this.queues.set(id, q);
    this.pump(chat);
    return { resumed: pending.length };
  }

  stop(id) {
    const chat = this.chats.get(id);
    if (!chat) throw new Error('No existe esa conversación.');
    const q = this.queues.get(id);
    if (q) {
      q.items = [];
      q.stopped = true;
      if (q.child) {
        q.child.cancelled = true;
        killTree(q.child);
      }
    }
    // Detener es explícito: los turnos pendientes pueden reanudarse más tarde.
    this.save(chat);
    return chat;
  }

  /** /compact o la API: resume ya los mensajes antiguos. Se ejecuta en la cola, entre turnos. */
  async compactNow(chat) {
    const emit = (text) => this.emit('activity', { chatId: chat.id, agent: 'system', text });
    try {
      const done = await Compaction.compact(this, chat, chat.messages, { render: transcript, available: this.available(chat), onEvent: emit, force: true });
      if (!done) this.addMessage(chat, { from: 'system', kind: 'notice', text: 'No hay mensajes antiguos suficientes para compactar (o ninguna IA pudo resumirlos).' });
    } catch (err) {
      this.addMessage(chat, { from: 'system', kind: 'error', text: `No se pudo compactar el historial: ${err.message}` });
    }
  }

  // Las IAs de una conversación hablan por turnos: comparten la misma copia del proyecto.
  async pump(chat) {
    const q = this.queues.get(chat.id);
    if (q.running) return;
    q.running = true;
    q.stopped = false;
    try {
      while (q.items.length) {
        const item = q.items.shift();
        try {
          await (item.run ? item.run() : this.turn(chat, item, q));
          if (item.agent) {
            const index = (chat.pendingTurns ?? []).findIndex((pending) => pending.agent === item.agent && pending.request?.id === item.request?.id && pending.hop === item.hop);
            if (index >= 0) chat.pendingTurns.splice(index, 1);
            this.save(chat);
          }
        } catch (err) {
          this.addMessage(chat, { from: 'system', kind: 'error', text: `El turno se interrumpió: ${short(err.message, 300)}. Puedes reanudarlo desde esta conversación.` });
          break;
        }
        if (q.stopped) break;
      }
    } finally {
      q.running = false;
      chat.working = null;
      this.save(chat);
    }
  }

  async turn(chat, { agent, request, hop, relayedFrom, mode: modeOverride }, q) {
    if (this.isExhausted(chat, agent)) {
      const requires = detectRequires(request.text);
      const alt = this.available(chat).find((a) => a !== agent && canDo(a, requires));
      if (!alt) {
        this.addMessage(chat, {
          from: 'system',
          kind: 'error',
          text: requires.length
            ? `${AGENTS[agent].name} no está disponible y ninguna otra IA de la conversación puede hacer esto (requiere ${describeRequires(requires)}).`
            : `${AGENTS[agent].name} no está disponible y no queda nadie más.`,
        });
        return;
      }
      relayedFrom = agent;
      agent = alt;
    }
    chat.working = { agent, since: new Date().toISOString() };
    this.save(chat);

    const freshSession = () => ({ id: agent === 'claude' ? crypto.randomUUID() : null, resume: false, seen: 0 });
    let session = chat.sessions[agent] ?? freshSession();
    const msgs = chat.messages.filter((m) => m.id !== request.id);
    const delta = transcript(msgs.slice(session.seen).filter((m) => m.from !== agent));
    // Si lo nuevo desde su último turno ya es enorme, se le manda el historial compactado completo.
    const isNew = !session.resume || AGENTS[agent]?.custom || Compaction.overThreshold(delta);
    const mode = chatMode(chat, modeOverride);
    const fromLabel = request.from === 'user' ? 'USUARIO' : `@${AGENTS[request.from]?.handle ?? request.from}`;
    const req = {
      fromLabel,
      text: relayedFrom
        ? `${request.text}\n\n(NOTA DEL SISTEMA: esta petición iba dirigida a @${AGENTS[relayedFrom].handle}, pero se ha quedado sin cuota. Ahora te corresponde a ti: hazla tú como si te la hubieran pedido directamente.)`
        : request.text,
    };

    const activity = [];
    const onEvent = (text) => {
      activity.push(text);
      if (activity.length > 300) activity.shift();
      this.emit('activity', { chatId: chat.id, agent, text });
    };
    const full = await Compaction.history(this, chat, msgs, { render: transcript, available: this.available(chat), onEvent, allowCompact: isNew });
    // Si se envía el historial completo (compactado o no), reanudar la sesión antigua lo duplicaría
    // encima de su contexto: se abre una nueva.
    if (isNew && session.resume) session = freshSession();

    // Modo plan: lo pendiente se guarda antes del turno para poder deshacer después cualquier escritura
    // de la IA, sea cual sea su CLI (Antigravity y los conectores personalizados no tienen modo de solo lectura).
    const readOnly = mode === 'plan';
    let planHead = null;
    if (readOnly) {
      await G.commitAll(chat.worktree.path, '[aiteam] cambios pendientes antes del modo plan').catch(() => {});
      planHead = (await G.git(chat.worktree.path, ['rev-parse', 'HEAD'], { allowFail: true })).stdout.trim() || null;
    }

    let snapshotId = null;
    try { snapshotId = await Snapshots.beforeTurn(chat); }
    catch (err) { this.emit('activity', { chatId: chat.id, agent: 'system', text: `Aviso: no se pudo crear la instantánea: ${err.message}` }); }
    let res;
    try {
      res = await invokeAgent(agent, {
        prompt: chatPrompt(chat, agent, req, isNew ? full : delta, isNew, hop, mode),
        fallbackPrompt: chatPrompt(chat, agent, req, full, true, hop, mode),
        cwd: chat.worktree.path,
        repoPath: chat.repoPath,
        mode: invokeMode(mode),
        autonomy: chat.autonomy ?? loadConfig().autonomy,
        session,
        onEvent,
        onSpawn: (child) => (q.child = child),
      });
    } finally {
      q.child = null;
      if (snapshotId) {
        try { await Snapshots.afterTurn(chat, snapshotId); }
        catch (err) { this.emit('activity', { chatId: chat.id, agent: 'system', text: `Aviso: no se pudo cerrar la instantánea: ${err.message}` }); }
      }
      this.save(chat);
    }

    if (readOnly && (await revertPlanWrites(chat.worktree.path, planHead))) {
      onEvent('↩ Modo plan: se han deshecho los cambios en archivos.');
      this.addMessage(chat, { from: 'system', kind: 'notice', text: `${AGENTS[agent].name} intentó modificar archivos en modo plan; se han deshecho los cambios. Usa /build si quieres aplicarlos.` });
    }

    if (!res.ok) {
      if (res.cancelled || q.stopped) {
        this.addMessage(chat, { from: 'system', kind: 'notice', text: `Detenido: ${AGENTS[agent].name} no terminó su respuesta.` });
        await G.commitAll(chat.worktree.path, `[${agent}] cambios parciales (detenido)`).catch(() => {});
        return;
      }
      const quota = QUOTA_ERROR.test(res.error ?? '');
      const auth = !quota && AUTH_ERROR.test(res.error ?? '');
      if (quota || auth) chat.exhausted[agent] = { reason: short(res.error, 300), at: new Date().toISOString(), kind: quota ? 'quota' : 'auth' };
      this.addMessage(chat, {
        from: 'system',
        kind: 'error',
        text: `${AGENTS[agent].name} ${quota ? 'se ha quedado sin cuota' : auth ? 'no tiene la sesión iniciada' : 'no pudo responder'}: ${short(res.error, 400)}`,
        meta: { activity },
      });
      // Relevo: si se quedó sin cuota, otra IA atiende la misma petición.
      const requires = detectRequires(request.text);
      const alt = (quota || auth) && !relayedFrom ? this.available(chat).find((a) => a !== agent && canDo(a, requires)) : null;
      if ((quota || auth) && !relayedFrom && !alt && requires.length) {
        this.addMessage(chat, {
          from: 'system',
          kind: 'notice',
          text: `Ninguna otra IA de la conversación puede encargarse (requiere ${describeRequires(requires)}). Vuelve a pedírselo a ${AGENTS[agent].name} cuando esté disponible.`,
        });
      }
      if (alt) {
        this.addMessage(chat, { from: 'system', kind: 'notice', text: `${AGENTS[alt].name} se encarga en su lugar.` });
        this.enqueue(chat, { agent: alt, request, hop, relayedFrom: agent, mode: modeOverride }, { front: true });
      }
      return;
    }

    chat.sessions[agent] = {
      id: res.sessionId ?? session.id,
      resume: true,
      seen: chat.messages.length,
    };
    const changed = await G.commitAll(chat.worktree.path, `[${agent}] ${short(request.text, 60)}`);
    let stat = '';
    let files = [];
    if (changed) {
      stat = (await G.git(chat.worktree.path, ['show', '--stat', '--format=', 'HEAD'], { allowFail: true })).stdout.trim();
      const names = await G.git(chat.worktree.path, ['show', '--name-only', '--diff-filter=AM', '--format=', 'HEAD'], { allowFail: true });
      files = names.stdout.split('\n').map((s) => s.trim()).filter(Boolean);
    }

    const delegations = parseDelegations(res.text, chat.agents, agent);
    const reply = this.addMessage(chat, {
      from: agent,
      to: delegations.map((d) => d.to),
      text: res.text.trim() || '(sin texto)',
      meta: { activity, changed, stat, files, durationMs: res.durationMs, replyTo: request.id, sessionReset: res.sessionReset ?? false },
    });
    chat.sessions[agent].seen = chat.messages.length;

    if (q.stopped) return;
    for (const d of delegations) {
      if (hop + 1 > MAX_HOPS) {
        this.addMessage(chat, {
          from: 'system',
          kind: 'notice',
          text: `Las IAs llevan ${MAX_HOPS} intercambios seguidos; se hace una pausa para que decidas cómo seguir. Menciona a @${AGENTS[d.to].handle} si quieres que continúe.`,
        });
        break;
      }
      // Las delegaciones heredan el modo de la petición original (p. ej. un /plan de un solo mensaje).
      this.enqueue(chat, { agent: d.to, request: { ...reply, text: d.text, from: agent, id: reply.id }, hop: hop + 1, mode: modeOverride });
    }
  }

  /** Objetivo de revisión (ver review.js) de una conversación. */
  reviewTarget(id) {
    const chat = this.chats.get(id);
    if (!chat) throw new Error('No existe esa conversación.');
    chat.review ??= {};
    return { repoPath: chat.repoPath, branch: chat.worktree.branch, worktree: chat.worktree.path, review: chat.review, chat };
  }

  assertIdle(chat) {
    if (chat.working || this.queues.get(chat.id)?.items.length) throw new Error('Espera a que las IAs terminen su turno.');
  }

  saveReview(target) {
    target.chat.review = target.review;
    this.save(target.chat);
  }

  /** Pide a una IA cambios sobre un archivo concreto, como si el usuario lo escribiera en el chat. */
  requestChanges(id, { file, agent, text }) {
    const chat = this.chats.get(id);
    if (!chat) throw new Error('No existe esa conversación.');
    if (!chat.agents.includes(agent)) throw new Error('Esa IA no está en la conversación.');
    if (!String(text ?? '').trim()) throw new Error('Escribe qué quieres que cambie.');
    return this.post(id, `@${AGENTS[agent].handle} sobre \`${file}\`: ${String(text).trim()}`);
  }

  noticeApplied(chat, result) {
    this.addMessage(chat, {
      from: 'system',
      kind: 'notice',
      text: `Cambios aplicados a tu proyecto (rama ${result.branch}): ${result.files} archivo(s). Si es el propio AITeam, reinícialo para ver los cambios.`,
    });
  }

  /** Conflictos al traer los cambios del proyecto: los resuelve la primera IA disponible. */
  resolveSyncConflicts(chat, conflicts) {
    const agent = this.available(chat)[0];
    if (!agent) throw new Error('No hay ninguna IA disponible para resolver los conflictos.');
    const msg = this.addMessage(chat, {
      from: 'system',
      kind: 'notice',
      text: `Hay conflictos entre esta conversación y cambios recientes de tu proyecto (${conflicts.join(', ')}). ${AGENTS[agent].name} los va a resolver.`,
    });
    this.enqueue(chat, {
      agent,
      hop: MAX_HOPS,
      request: {
        id: msg.id,
        from: 'user',
        text: `Al traer a esta copia los últimos cambios del proyecto han aparecido conflictos de fusión en: ${conflicts.join(', ')}. Abre esos archivos, resuelve los marcadores de conflicto (<<<<<<<, =======, >>>>>>>) conservando la intención de ambos lados y deja el código coherente. No hagas commits.`,
      },
    });
  }

  async diff(id) {
    const chat = this.chats.get(id);
    if (!chat) throw new Error('No existe esa conversación.');
    return { ...(await G.diffSince(chat.repoPath, chat.baseCommit, chat.worktree.branch, 400_000)), branch: chat.worktree.branch, baseBranch: chat.baseBranch, repoPath: chat.repoPath };
  }

  async remove(id) {
    const chat = this.chats.get(id);
    if (!chat) throw new Error('No existe esa conversación.');
    this.stop(id);
    await Snapshots.remove(chat);
    await G.removeWorktree(chat.repoPath, chat.worktree.path);
    fs.rmSync(path.join(CHATS_DIR, `${id}.json`), { force: true });
    this.chats.delete(id);
    this.emit('removed', { id });
  }
}
