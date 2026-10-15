import crypto from 'node:crypto';

const id = () => crypto.randomUUID();
const now = () => new Date().toISOString();

/** Bus persistido dentro de cada run (data/runs/*.json). */
export class Bus {
  constructor(orchestrator) {
    this.owner = orchestrator;
    this.waiters = new Map();
  }

  init(run) {
    if (!run.messages) run.messages = (run.board ?? []).map((m) => ({ id: id(), threadId: id(), replyTo: null, ts: m.ts, from: m.from, to: m.to, kind: 'note', taskId: null, text: m.text, status: 'sent' }));
    run.gates ??= [];
    run.board ??= [];
  }

  post(run, { from, to = 'all', text, kind = 'note', threadId, replyTo, taskId }) {
    this.init(run);
    const message = { id: id(), threadId: threadId || id(), replyTo: replyTo || null,
      ts: now(), from, to, kind, taskId: taskId || null, text: String(text).slice(0, 8000),
      status: kind === 'ask' ? 'pending' : 'sent' };
    run.messages.push(message);
    run.board.push({ ts: message.ts, from, to, text: message.text });
    this.owner.touch(run);
    this.owner.emit('bus-message', { runId: run.id, message });
    return message;
  }

  threads(run) {
    this.init(run);
    const groups = new Map();
    for (const message of run.messages) {
      if (!groups.has(message.threadId)) groups.set(message.threadId, []);
      groups.get(message.threadId).push(message);
    }
    return [...groups].map(([threadId, messages]) => ({ threadId, messages }));
  }

  ask(run, { from, to, text, taskId, timeoutMs = 300_000 }) {
    if (!to || to === 'all' || to === from) throw new Error('Destinatario de pregunta inválido.');
    const message = this.post(run, { from, to, text, kind: 'ask', taskId });
    const promise = new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.waiters.delete(message.id);
        message.status = 'timed_out';
        this.owner.touch(run);
        this.owner.emit('bus-message', { runId: run.id, message });
        resolve(null);
      }, Math.max(1, Math.min(Number(timeoutMs) || 300_000, 3_600_000)));
      this.waiters.set(message.id, { resolve, timer });
    });
    return { message, promise };
  }

  reply(run, askId, from, text) {
    this.init(run);
    const ask = run.messages.find((m) => m.id === askId && m.kind === 'ask');
    if (!ask) throw new Error('Pregunta desconocida.');
    if (ask.status !== 'pending') throw new Error('Esta pregunta ya está resuelta.');
    if (ask.to !== from) throw new Error('La respuesta debe venir del destinatario.');
    const reply = this.post(run, { from, to: ask.from, text, kind: 'reply', threadId: ask.threadId, replyTo: ask.id, taskId: ask.taskId });
    ask.status = 'answered';
    this.owner.touch(run);
    const waiter = this.waiters.get(askId);
    if (waiter) { clearTimeout(waiter.timer); this.waiters.delete(askId); waiter.resolve(reply); }
    return reply;
  }

  gate(run, { kind = 'decision', question, options, defaultChoice = null }) {
    this.init(run);
    const gate = { id: id(), kind, question, options, default: defaultChoice, status: 'pending', choice: null, decidedBy: null, createdAt: now() };
    run.gates.push(gate);
    this.owner.touch(run);
    this.owner.emit('bus-gate', { runId: run.id, gate });
    return gate;
  }

  decide(run, gateId, choice, decidedBy = 'user') {
    this.init(run);
    const gate = run.gates.find((g) => g.id === gateId);
    if (!gate) throw new Error('Puerta desconocida.');
    if (gate.status !== 'pending') throw new Error('La puerta ya fue resuelta.');
    if (!gate.options.includes(choice)) throw new Error('Opción inválida.');
    Object.assign(gate, { status: 'decided', choice, decidedBy, decidedAt: now() });
    this.owner.touch(run);
    this.owner.emit('bus-gate', { runId: run.id, gate });
    const waiter = this.waiters.get(gate.id);
    if (waiter) { this.waiters.delete(gate.id); waiter.resolve(choice); }
    return gate;
  }

  waitForGate(gate) {
    if (gate.status === 'decided') return Promise.resolve(gate.choice);
    return new Promise((resolve) => this.waiters.set(gate.id, { resolve }));
  }

  cancel(run) {
    for (const item of [...(run.messages ?? []), ...(run.gates ?? [])]) {
      const waiter = this.waiters.get(item.id);
      if (waiter) { clearTimeout(waiter.timer); waiter.resolve(null); this.waiters.delete(item.id); }
      if (item.status === 'pending') item.status = 'cancelled';
    }
  }
}
