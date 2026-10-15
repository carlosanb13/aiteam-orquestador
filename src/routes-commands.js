import { BUILTIN_COMMANDS, DEFAULT_MODE, MODES, chatMode, listCommands, setChatMode } from './commands.js';
import { compactionConfig } from './compaction.js';
import { findProjectRules } from './prompts.js';

/**
 * API de modos, comandos personalizados, reglas del proyecto y compactación (ver commands.js y compaction.js).
 * Devuelve rutas con el mismo formato que las de server.js: [método, patrón, manejador].
 *
 *   GET  /api/chats/:id/commands  → { mode, modes, builtin, commands }
 *   GET  /api/chats/:id/mode      → { mode }
 *   PUT  /api/chats/:id/mode      { mode: "plan" | "build" } → { mode }
 *   GET  /api/chats/:id/context   → { mode, rules, compaction }
 *   POST /api/chats/:id/compact   → resume ya los mensajes antiguos (en la cola de la conversación)
 */
export default function commandRoutes({ chats, send, readBody }) {
  const chatOr404 = (res, id) => {
    const chat = chats.get(id);
    if (!chat) send(res, 404, { error: 'No existe esa conversación.' });
    return chat;
  };
  const publicCommand = ({ name, description, agent, mode, template, source }) => ({ name, description, agent, mode, template, source });

  return [
    ['GET', /^\/api\/chats\/([\w-]+)\/commands$/, (req, res, m) => {
      const chat = chatOr404(res, m[1]);
      if (!chat) return;
      send(res, 200, {
        mode: chatMode(chat),
        modes: Object.values(MODES),
        builtin: Object.entries(BUILTIN_COMMANDS).map(([name, c]) => ({ name, ...c })),
        commands: listCommands({ worktree: chat.worktree.path, repoPath: chat.repoPath }).map(publicCommand),
      });
    }],
    ['GET', /^\/api\/chats\/([\w-]+)\/mode$/, (req, res, m) => {
      const chat = chatOr404(res, m[1]);
      if (chat) send(res, 200, { mode: chatMode(chat), default: DEFAULT_MODE });
    }],
    ['PUT', /^\/api\/chats\/([\w-]+)\/mode$/, async (req, res, m) => {
      const chat = chatOr404(res, m[1]);
      if (!chat) return;
      setChatMode(chats, chat, String((await readBody(req)).mode ?? '').toLowerCase());
      send(res, 200, { mode: chatMode(chat) });
    }],
    ['GET', /^\/api\/chats\/([\w-]+)\/context$/, (req, res, m) => {
      const chat = chatOr404(res, m[1]);
      if (!chat) return;
      const rules = findProjectRules(chat.worktree.path);
      const c = chat.compaction;
      send(res, 200, {
        mode: chatMode(chat),
        rules: rules.length ? { file: rules.map((r) => r.name).join(', '), files: rules.map((r) => r.name) } : null,
        compaction: { ...compactionConfig(), state: c ? { summary: c.summary, count: c.count, at: c.at, by: c.by } : null },
      });
    }],
    ['POST', /^\/api\/chats\/([\w-]+)\/compact$/, (req, res, m) => {
      const chat = chatOr404(res, m[1]);
      if (!chat) return;
      chats.enqueue(chat, { run: () => chats.compactNow(chat) });
      send(res, 202, { ok: true });
    }],
  ];
}
