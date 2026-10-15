/**
 * POST /api/{chats|runs}/:id/terminal          {command, agent?}: execute in the known worktree.
 * POST /api/{chats|runs}/:id/terminal/:commandId/cancel  Cancel a running command.
 * GET  /api/{chats|runs}/:id/terminal          Bounded command and output history.
 * GET  /api/chats/:id/terminal/:commandId/context  Text to append to the next chat turn (!command).
 * SSE /api/events: terminal {kind,ownerId,commandId,type:start|stdout|stderr|exit,...}.
 */
import * as Terminal from './terminal.js';

export function terminalRoutes(chats, orchestrator, send, readBody, broadcast) {
  const root = /^\/api\/(chats|runs)\/([\w-]+)\/terminal$/;
  return [
    ['POST', root, async (req, res, m) => {
      const body = await readBody(req);
      const { cwd, autonomy } = Terminal.worktreeFor(chats, orchestrator, m[1], m[2], body.agent);
      if (m[1] === 'chats') chats.assertIdle(chats.get(m[2]));
      // HTTP requests represent the human user; agents must call execute with actor set explicitly.
      send(res, 202, Terminal.execute({ kind: m[1], ownerId: m[2], cwd, autonomy, command: body.command, emit: broadcast }));
    }],
    ['GET', root, (req, res, m) => {
      Terminal.worktreeFor(chats, orchestrator, m[1], m[2], new URL(req.url, 'http://localhost').searchParams.get('agent'));
      send(res, 200, { commands: Terminal.history(m[1], m[2]) });
    }],
    ['POST', /^\/api\/(chats|runs)\/([\w-]+)\/terminal\/([\w-]+)\/cancel$/, (req, res, m) => {
      send(res, 200, { cancelled: Terminal.cancel(m[1], m[2], m[3]) });
    }],
    ['GET', /^\/api\/chats\/([\w-]+)\/terminal\/([\w-]+)\/context$/, (req, res, m) => {
      Terminal.worktreeFor(chats, orchestrator, 'chats', m[1]);
      send(res, 200, { text: Terminal.shellContext(m[1], m[2]) });
    }],
  ];
}
