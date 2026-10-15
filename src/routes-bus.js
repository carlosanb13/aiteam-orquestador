/**
 * GET  /api/runs/:id/threads                 Lista hilos y mensajes del bus.
 * POST /api/runs/:id/asks/:askId/reply      {text}: responde como usuario.
 * POST /api/runs/:id/gates/:gateId/decide   {choice, assignments?}: resuelve una puerta.
 * SSE /api/events: bus-message {runId,message}, bus-gate {runId,gate}.
 */
export function busRoutes(orchestrator, send, readBody, broadcast) {
  orchestrator.on('bus-message', (event) => broadcast('bus-message', event));
  orchestrator.on('bus-gate', (event) => broadcast('bus-gate', event));
  const runFor = (id) => {
    const run = orchestrator.get(id);
    if (!run) throw new Error('No existe esa tarea.');
    return run;
  };
  return [
    ['GET', /^\/api\/runs\/([\w-]+)\/threads$/, (req, res, m) => send(res, 200, { threads: orchestrator.bus.threads(runFor(m[1])) })],
    ['POST', /^\/api\/runs\/([\w-]+)\/asks\/([\w-]+)\/reply$/, async (req, res, m) => {
      const body = await readBody(req);
      const text = String(body.text ?? '').trim();
      if (!text) throw new Error('La respuesta está vacía.');
      send(res, 200, orchestrator.bus.reply(runFor(m[1]), m[2], 'user', text));
    }],
    ['POST', /^\/api\/runs\/([\w-]+)\/gates\/([\w-]+)\/decide$/, async (req, res, m) => {
      const run = runFor(m[1]);
      const body = await readBody(req);
      const gate = run.gates?.find((g) => g.id === m[2]);
      if (!gate) throw new Error('Puerta desconocida.');
      if (gate.kind === 'plan_approval') {
        if (body.choice === 'approve') return send(res, 200, orchestrator.approve(run.id, body.assignments ?? {}));
        if (body.choice === 'cancel') return send(res, 200, orchestrator.cancel(run.id));
      }
      send(res, 200, orchestrator.bus.decide(run, gate.id, body.choice));
    }],
  ];
}
