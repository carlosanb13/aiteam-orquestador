/**
 * GET  /api/chats/:id/snapshots          Lista turnos, archivos cambiados y cursor.
 * POST /api/chats/:id/snapshots/undo     Deshace el último turno aplicado.
 * POST /api/chats/:id/snapshots/redo     Rehace el siguiente turno.
 * POST /api/chats/:id/snapshots/restore  Restaura el estado posterior a { turnId }.
 */
import * as Snapshots from './snapshots.js';

export function snapshotRoutes(chats, send, readBody) {
  const chatFor = (id) => {
    const chat = chats.get(id);
    if (!chat) throw new Error('No existe esa conversación.');
    return chat;
  };
  const action = (fn) => async (req, res, m) => {
    const chat = chatFor(m[1]);
    chats.assertIdle(chat);
    const result = await fn(chat, req);
    chats.save(chat);
    send(res, 200, result);
  };
  return [
    ['GET', /^\/api\/chats\/([\w-]+)\/snapshots$/, async (req, res, m) => send(res, 200, await Snapshots.list(chatFor(m[1])))],
    ['POST', /^\/api\/chats\/([\w-]+)\/snapshots\/undo$/, action(Snapshots.undo)],
    ['POST', /^\/api\/chats\/([\w-]+)\/snapshots\/redo$/, action(Snapshots.redo)],
    ['POST', /^\/api\/chats\/([\w-]+)\/snapshots\/restore$/, action(async (chat, req) => Snapshots.restore(chat, (await readBody(req)).turnId))],
  ];
}
