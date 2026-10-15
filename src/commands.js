import fs from 'node:fs';
import path from 'node:path';
import { AGENTS } from './agents.js';
import { DATA_DIR } from './config.js';

/**
 * Modos de agente por conversación (al estilo de OpenCode):
 * - "build": comportamiento normal; la IA edita archivos (y ejecuta comandos con control total).
 * - "plan": solo lectura; la IA analiza y propone sin editar, también con control total. Cada CLI
 *   recibe su restricción (Claude: permission-mode plan; Codex: sandbox read-only; Antigravity: sin
 *   permisos de edición) y, como garantía común, chat.js deshace lo que quede escrito tras el turno.
 */
export const MODES = {
  build: { id: 'build', name: 'Construir', invoke: 'write' },
  plan: { id: 'plan', name: 'Planificar', invoke: 'plan' },
};
export const DEFAULT_MODE = 'build';

export const chatMode = (chat, override) => (MODES[override] ? override : MODES[chat?.mode] ? chat.mode : DEFAULT_MODE);

/** Valor de `mode` que se pasa a invokeAgent (ver agents.js). */
export const invokeMode = (mode) => MODES[mode]?.invoke ?? 'write';

/** Línea del prompt de chat que explica a la IA el modo de la conversación. */
export function modeText(mode) {
  if (mode !== 'plan') return '';
  return `
MODO PLAN (solo lectura): en esta conversación NO debes crear, modificar ni borrar archivos. Analiza el código, responde y propón un plan concreto (qué archivos tocar y cómo). Si el usuario quiere que lo apliques, que cambie al modo "build" (por ejemplo escribiendo /build).
`;
}

// ---------------------------------------------------------------- Comandos personalizados

// Directorios de comandos: los del proyecto tienen prioridad sobre los globales de AITeam.
export const PROJECT_COMMANDS_DIR = path.join('.aiteam', 'commands');
export const GLOBAL_COMMANDS_DIR = path.join(DATA_DIR, 'commands');
const SAFE_NAME = /^[a-z0-9][a-z0-9_-]{0,47}$/i;
const MAX_TEMPLATE = 50_000;

// Comandos integrados: no se pueden redefinir con archivos.
export const BUILTIN_COMMANDS = {
  equipo: { description: 'Lanza una tarea de equipo completa (planificar, repartir, trabajar en paralelo y revisar).', usage: '/equipo <objetivo>' },
  plan: { description: 'Cambia la conversación al modo plan (solo lectura). Con texto, solo ese mensaje va en modo plan.', usage: '/plan [mensaje]' },
  build: { description: 'Cambia la conversación al modo build (edita archivos). Con texto, solo ese mensaje va en modo build.', usage: '/build [mensaje]' },
  compact: { description: 'Resume ahora los mensajes antiguos de la conversación para aligerar el contexto.', usage: '/compact' },
};

/** Frontmatter sencillo (`clave: valor` entre líneas `---`) y cuerpo de un markdown. */
export function parseFrontmatter(source) {
  const text = String(source ?? '').replace(/^﻿/, '');
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { data: {}, body: text.trim() };
  const data = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^\s*([A-Za-z][\w-]*)\s*:\s*(.*?)\s*$/);
    if (kv) data[kv[1].toLowerCase()] = kv[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return { data, body: m[2].trim() };
}

const ALIASES = { chatgpt: 'codex', gpt: 'codex', openai: 'codex', google: 'gemini', antigravity: 'gemini', agy: 'gemini' };

function resolveAgent(value) {
  const v = String(value ?? '').trim().toLowerCase().replace(/^@/, '');
  if (!v) return null;
  if (AGENTS[v]) return v;
  if (ALIASES[v]) return ALIASES[v];
  return Object.values(AGENTS).find((a) => a.handle === v)?.id ?? null;
}

function readCommand(file, source) {
  const name = path.basename(file, '.md');
  if (!SAFE_NAME.test(name) || BUILTIN_COMMANDS[name.toLowerCase()]) return null;
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
  if (raw.length > MAX_TEMPLATE) return null;
  const { data, body } = parseFrontmatter(raw);
  if (!body) return null;
  return {
    name: name.toLowerCase(),
    description: data.description ?? '',
    agent: resolveAgent(data.agent ?? data.ia),
    mode: MODES[data.mode?.toLowerCase()] ? data.mode.toLowerCase() : null,
    template: body,
    source,
    file,
  };
}

function readDir(dir, source) {
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  return names.filter((n) => n.toLowerCase().endsWith('.md')).map((n) => readCommand(path.join(dir, n), source)).filter(Boolean);
}

/**
 * Comandos disponibles para una conversación. Se buscan en la copia de trabajo (donde las IAs pueden
 * haberlos creado), después en el proyecto original y por último en los globales de AITeam.
 */
export function listCommands({ worktree, repoPath } = {}) {
  const found = new Map();
  const dirs = [
    [worktree, 'project'],
    [repoPath, 'project'],
  ];
  for (const [root, source] of dirs) {
    if (!root) continue;
    for (const c of readDir(path.join(root, PROJECT_COMMANDS_DIR), source)) if (!found.has(c.name)) found.set(c.name, c);
  }
  for (const c of readDir(GLOBAL_COMMANDS_DIR, 'global')) if (!found.has(c.name)) found.set(c.name, c);
  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Crea un comando reutilizable en la copia; se aplica al proyecto solo tras la revisión. */
export function createProjectCommand(chat, input) {
  const name = String(input.name ?? '').trim().toLowerCase();
  const description = String(input.description ?? '').trim().replace(/\r?\n/g, ' ').slice(0, 160);
  const template = String(input.template ?? '').trim();
  const agent = resolveAgent(input.agent);
  const mode = String(input.mode ?? 'build').toLowerCase();
  if (!SAFE_NAME.test(name) || BUILTIN_COMMANDS[name]) throw new Error('Nombre de comando inválido o reservado.');
  if (!template || template.length > MAX_TEMPLATE) throw new Error('Escribe una plantilla de hasta 50 000 caracteres.');
  if (input.agent && !agent) throw new Error('IA desconocida.');
  if (!MODES[mode]) throw new Error('Modo desconocido.');
  const dir = path.join(chat.worktree.path, PROJECT_COMMANDS_DIR);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${name}.md`);
  if (fs.existsSync(file)) throw new Error('Ya existe un comando con ese nombre.');
  fs.writeFileSync(file, `---\ndescription: ${description}\n${agent ? `agent: ${agent}\n` : ''}mode: ${mode}\n---\n${template}\n`);
  return { name, description, agent, mode, template, source: 'project' };
}

/** Divide los argumentos como una shell sencilla: respeta "comillas" y 'comillas'. */
export function splitArgs(input) {
  const out = [];
  for (const m of String(input ?? '').matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}

/** Sustituye $ARGUMENTS (todo el texto) y $1, $2… (argumentos sueltos) en la plantilla. */
export function expandTemplate(template, args) {
  const text = String(args ?? '').trim();
  const parts = splitArgs(text);
  let usedArgs = false;
  let out = String(template).replace(/\$ARGUMENTS\b/g, () => {
    usedArgs = true;
    return text;
  });
  out = out.replace(/\$(\d+)\b/g, (_, n) => {
    usedArgs = true;
    return parts[Number(n) - 1] ?? '';
  });
  // Si la plantilla no usa argumentos pero el usuario escribió algo, se añade al final para no perderlo.
  if (!usedArgs && text) out += `\n\n${text}`;
  return out.trim();
}

/**
 * Interpreta un mensaje que empieza por "/". Devuelve:
 * - null si no es un comando (o es uno desconocido: se envía tal cual);
 * - { kind: 'team', goal }                       → /equipo
 * - { kind: 'mode', mode, text? }                 → /plan, /build (con texto: solo ese mensaje)
 * - { kind: 'compact' }                           → /compact
 * - { kind: 'custom', command, text, agent, mode } → comando de .aiteam/commands
 */
export function resolveSlash(chat, input) {
  const m = String(input ?? '').match(/^\/([a-z0-9][\w-]*)(?:\s+([\s\S]*))?$/i);
  if (!m) return null;
  const name = m[1].toLowerCase();
  const rest = (m[2] ?? '').trim();
  if (name === 'equipo') return rest ? { kind: 'team', goal: rest } : null;
  if (name === 'plan' || name === 'build') return { kind: 'mode', mode: name, text: rest || null };
  if (name === 'compact' || name === 'compactar') return { kind: 'compact' };
  const command = listCommands({ worktree: chat?.worktree?.path, repoPath: chat?.repoPath }).find((c) => c.name === name);
  if (!command) return null;
  return { kind: 'custom', command: command.name, text: expandTemplate(command.template, rest), agent: command.agent, mode: command.mode };
}

/** Cambia el modo de una conversación y deja constancia en el chat. */
export function setChatMode(chats, chat, mode) {
  if (!MODES[mode]) throw new Error('Modo desconocido: usa "plan" o "build".');
  if (chatMode(chat) === mode) return chat;
  chat.mode = mode;
  chats.addMessage(chat, {
    from: 'system',
    kind: 'notice',
    text:
      mode === 'plan'
        ? 'Modo plan: las IAs analizan y proponen, pero no editan archivos. Escribe /build para volver a construir.'
        : 'Modo build: las IAs vuelven a editar archivos en la copia de esta conversación.',
    meta: { mode },
  });
  return chat;
}
