import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import * as G from './git.js';
import * as P from './prompts.js';
import { AGENTS, invokeAgent, isNetworkError } from './agents.js';
import { CAPABILITIES, canDo, describeRequires, detectRequires, missingFor } from './capabilities.js';
import { DATA_DIR, loadConfig } from './config.js';
import { killTree, runShell } from './runner.js';
import { Bus } from './bus.js';

const RUNS_DIR = path.join(DATA_DIR, 'runs');
const ACTIVE = new Set(['planning', 'bidding', 'running', 'reviewing', 'integrating', 'attacking', 'testing']);
const LOAD_PENALTY = 1.5;
const CAPABLE_RETRY_DELAY_MS = 45_000; // espera antes de reintentar con la única IA capaz tras un error de red
const MAX_ATTEMPTS_PER_TASK = 3;
const QUOTA_ERROR = /usage limit|rate.?limit|quota|limit reached|resource.?exhausted|too many requests|\b429\b|credits/i;

const short = (s, n = 400) => {
  const one = String(s ?? '').replace(/\s+/g, ' ').trim();
  return one.length > n ? `${one.slice(0, n)}…` : one;
};

class Cancelled extends Error {}

/** Ordena las tareas respetando dependencias y elimina dependencias inválidas o cíclicas. */
function normalizeTasks(raw) {
  const tasks = [];
  const seen = new Set();
  for (const [i, t] of (Array.isArray(raw) ? raw : []).entries()) {
    let id = String(t.id ?? `t${i + 1}`).trim().replace(/\s+/g, '_');
    if (seen.has(id)) id = `${id}_${i + 1}`;
    seen.add(id);
    tasks.push({
      id,
      title: short(t.title ?? `Subtarea ${i + 1}`, 140),
      description: String(t.description ?? t.title ?? ''),
      kind: short(t.kind ?? 'general', 40),
      dependsOn: Array.isArray(t.dependsOn) ? t.dependsOn.map(String) : [],
      // Capacidades imprescindibles; si el plan no las declaró, se deducen del texto.
      requires: Array.isArray(t.requires)
        ? [...new Set(t.requires.map(String).filter((r) => CAPABILITIES[r]))]
        : detectRequires(`${t.title ?? ''} ${t.description ?? ''}`),
    });
  }
  const ids = new Set(tasks.map((t) => t.id));
  for (const t of tasks) t.dependsOn = [...new Set(t.dependsOn.filter((d) => ids.has(d) && d !== t.id))];

  // Kahn: lo que quede sin ordenar está en un ciclo y pierde sus dependencias.
  const ordered = [];
  const done = new Set();
  let progress = true;
  while (progress && ordered.length < tasks.length) {
    progress = false;
    for (const t of tasks) {
      if (!done.has(t.id) && t.dependsOn.every((d) => done.has(d))) {
        ordered.push(t);
        done.add(t.id);
        progress = true;
      }
    }
  }
  for (const t of tasks) {
    if (!done.has(t.id)) {
      t.dependsOn = t.dependsOn.filter((d) => done.has(d));
      ordered.push(t);
      done.add(t.id);
    }
  }
  return ordered.map((t) => ({ ...t, status: 'pending', assignee: null, bids: {}, summary: null, error: null }));
}

export class Orchestrator extends EventEmitter {
  runs = new Map();
  procs = new Map();
  saveTimers = new Map();
  bus = new Bus(this);

  constructor() {
    super();
    fs.mkdirSync(RUNS_DIR, { recursive: true });
    for (const file of fs.readdirSync(RUNS_DIR)) {
      if (!file.endsWith('.json')) continue;
      try {
        const run = JSON.parse(fs.readFileSync(path.join(RUNS_DIR, file), 'utf8'));
        run.exhausted ??= {};
        this.bus.init(run);
        for (const m of run.messages) if (m.kind === 'ask' && m.status === 'pending') m.status = 'interrupted';
        for (const g of run.gates) if (g.status === 'pending' && g.kind !== 'plan_approval') g.status = 'interrupted';
        if (ACTIVE.has(run.status)) {
          run.status = 'interrupted';
          run.error = 'El servidor se detuvo mientras esta tarea estaba en curso.';
          for (const t of run.tasks) if (t.status === 'running') t.status = 'failed';
        }
        this.runs.set(run.id, run);
      } catch {
        /* archivo dañado: se ignora */
      }
    }
  }

  // ------------------------------------------------------------ utilidades

  list() {
    return [...this.runs.values()]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((r) => ({ id: r.id, goal: r.goal, status: r.status, createdAt: r.createdAt, agents: r.agents, repoPath: r.repoPath, baseBranch: r.baseBranch }));
  }

  get(id) {
    return this.runs.get(id);
  }

  publicRun(run) {
    const { log, ...rest } = run;
    return rest;
  }

  save(run) {
    clearTimeout(this.saveTimers.get(run.id));
    this.saveTimers.set(
      run.id,
      setTimeout(() => fs.writeFileSync(path.join(RUNS_DIR, `${run.id}.json`), JSON.stringify(run, null, 2)), 250),
    );
  }

  touch(run) {
    run.updatedAt = new Date().toISOString();
    this.save(run);
    this.emit('run', this.publicRun(run));
  }

  log(run, agent, text) {
    const entry = { ts: new Date().toISOString(), agent, text: String(text) };
    run.log.push(entry);
    if (run.log.length > 3000) run.log.splice(0, run.log.length - 3000);
    this.save(run);
    this.emit('log', { runId: run.id, entry });
  }

  post(run, from, to, text) {
    return this.bus.post(run, { from, to, text: short(text, 2000) });
  }

  setStatus(run, status, phase) {
    run.status = status;
    run.phase = phase ?? null;
    this.log(run, null, `— ${phase ?? status}`);
    this.touch(run);
  }

  checkCancelled(run) {
    if (run.cancelled) throw new Cancelled();
  }

  track(run, child) {
    if (!this.procs.has(run.id)) this.procs.set(run.id, new Set());
    const set = this.procs.get(run.id);
    set.add(child);
    child.on('close', () => set.delete(child));
  }

  async call(run, agentId, prompt, { cwd, mode = 'read', label }) {
    this.checkCancelled(run);
    this.log(run, agentId, `▶ ${label}`);
    const res = await invokeAgent(agentId, {
      prompt,
      cwd,
      mode,
      onEvent: (msg) => this.log(run, agentId, msg),
      onSpawn: (child) => this.track(run, child),
    });
    this.checkCancelled(run);
    const secs = Math.round((res.durationMs ?? 0) / 1000);
    if (!res.ok) {
      this.log(run, agentId, `✖ ${label}: ${res.error} (${secs}s)`);
      if (QUOTA_ERROR.test(res.error) && !run.exhausted[agentId]) {
        run.exhausted[agentId] = short(res.error, 300);
        this.post(run, 'aiteam', 'all', `${AGENTS[agentId].name} se ha quedado sin cuota; el resto del equipo asume su trabajo.`);
      }
      return { ...res, json: null };
    }
    const json = P.extractJson(res.text);
    this.log(run, agentId, `✔ ${label} (${secs}s)`);
    return { ...res, json };
  }

  /** IAs que pueden trabajar ahora: las que respondieron a la negociación y no se han quedado sin cuota. */
  available(run) {
    const pool = run.activeAgents.length ? run.activeAgents : run.agents;
    return pool.filter((a) => !run.exhausted[a]);
  }

  fallbackAgent(run, preferred) {
    const pool = this.available(run);
    return pool.includes(preferred) ? preferred : pool[0];
  }

  /** Pide algo a `preferred` y, si falla, al resto del equipo por orden. */
  async callWithFallback(run, preferred, makePrompt, opts) {
    const order = [preferred, ...this.available(run).filter((a) => a !== preferred)].filter(Boolean);
    let last = null;
    for (const agent of order) {
      if (run.exhausted[agent]) continue;
      if (agent !== preferred) this.log(run, agent, `↪ Asume "${opts.label}"`);
      last = await this.call(run, agent, makePrompt(agent), opts);
      if (last.ok) return { ...last, agent };
    }
    return { ...(last ?? { ok: false, error: 'No queda ninguna IA disponible.' }), agent: null };
  }

  /** Las marcas del agente se procesan tras su turno; la respuesta reanuda esa subtarea. */
  async handleSignals(run, task, agent, response) {
    const signals = [];
    for (const m of response.json?.messages ?? []) {
      if (m?.text && !m.kind) this.post(run, agent, String(m.to ?? 'all'), m.text);
      else if (m?.kind) signals.push(m);
    }
    for (const line of String(response.text ?? '').split(/\r?\n/)) {
      const match = line.match(/^\[\[(ASK|ESCALATE):([^:\]]+):([^\]]+)\]\]\s*(.+)$/);
      if (match) signals.push({ kind: match[1].toLowerCase(), to: match[2], text: match[4], threadId: match[3] });
    }
    for (const signal of signals) {
      const to = String(signal.to ?? 'user');
      const text = String(signal.text ?? '').trim();
      if (!text) continue;
      if (signal.kind === 'escalate' || signal.kind === 'escalation') {
        this.bus.post(run, { from: agent, to: 'user', text, kind: 'escalation', taskId: task.id });
        const gate = this.bus.gate(run, { kind: 'escalation', question: text, options: ['continue', 'cancel'] });
        task.status = 'escalated';
        this.touch(run);
        const choice = await this.bus.waitForGate(gate);
        if (choice !== 'continue') throw new Error(`Escalación de ${task.id} cancelada.`);
        task.status = 'running';
      } else if (signal.kind === 'ask') {
        if (to !== 'user' && !run.agents.includes(to)) throw new Error('Destinatario de pregunta desconocido.');
        const { message, promise } = this.bus.ask(run, { from: agent, to, text, taskId: task.id });
        task.status = 'waiting_reply';
        this.touch(run);
        if (to !== 'user') {
          const answer = await this.call(run, to, `[[KIND:reply]]\n${agent} pregunta sobre ${task.id}: ${text}\nResponde brevemente en español.`, { cwd: run.repoPath, label: `Responder a ${agent}` });
          this.bus.reply(run, message.id, to, answer.ok ? (answer.json?.answer ?? answer.text) : `No pude responder: ${answer.error}`);
        }
        const reply = await promise;
        task.status = 'running';
        this.touch(run);
        if (!reply) throw new Error(`La pregunta de ${task.id} agotó el tiempo de espera.`);
        const wt = run.worktrees[agent];
        response = await this.call(run, agent, `[[KIND:resume]]\nContinúa ${task.id} en esta copia. Respuesta de ${to}: ${reply.text}\nTermina con el bloque JSON de resumen habitual.`, { cwd: wt.path, mode: 'write', label: `${task.id}: continuar tras respuesta` });
        if (!response.ok) throw new Error(response.error);
        for (const m of response.json?.messages ?? []) if (m?.text && !m.kind) this.post(run, agent, String(m.to ?? 'all'), m.text);
      }
    }
    return response;
  }

  wrap(run, fn) {
    fn().catch((err) => {
      if (err instanceof Cancelled) return;
      run.error = err.message;
      this.setStatus(run, 'failed', `Error: ${err.message}`);
    });
  }

  // ------------------------------------------------------------ API pública

  async create(input) {
    const goal = String(input.goal ?? '').trim();
    if (!goal) throw new Error('Describe el objetivo.');
    const agents = (input.agents ?? []).filter((a) => AGENTS[a]);
    if (!agents.length) throw new Error('Elige al menos una IA.');
    const info = await G.inspectRepo(String(input.repoPath ?? '').trim());
    // Desde un chat, la tarea parte del trabajo ya hecho en esa conversación (su rama).
    if (input.baseRef) {
      info.baseCommit = (await G.git(info.root, ['rev-parse', input.baseRef])).stdout.trim();
      info.baseBranch = input.baseRef;
      info.dirty = false;
    }
    const coordinator = agents.includes(input.coordinator) ? input.coordinator : agents[0];

    const stamp = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '');
    const run = {
      id: `${stamp}-${crypto.randomBytes(2).toString('hex')}`,
      createdAt: new Date().toISOString(),
      goal,
      repoPath: info.root,
      baseCommit: info.baseCommit,
      baseBranch: info.baseBranch,
      dirty: info.dirty,
      agents,
      activeAgents: [],
      coordinator,
      testCommand: String(input.testCommand ?? '').trim(),
      autoApprove: Boolean(input.autoApprove),
      review: input.review !== false,
      adversarial: Boolean(input.adversarial),
      attack: null,
      status: 'planning',
      phase: null,
      tasks: [],
      reviewScores: {},
      exhausted: {},
      reviews: [],
      board: [],
      messages: [],
      gates: [],
      log: [],
      worktrees: {},
      integration: null,
      error: null,
    };
    this.runs.set(run.id, run);
    if (info.dirty) {
      this.log(run, null, '⚠ El repositorio tiene cambios sin commit: las IAs parten del último commit y no los verán.');
    }
    this.touch(run);
    this.wrap(run, () => this.planAndBid(run));
    return this.publicRun(run);
  }

  approve(id, assignments = {}) {
    const run = this.runs.get(id);
    if (!run) throw new Error('No existe esa tarea.');
    if (run.status !== 'awaiting_approval') throw new Error('Este plan no está esperando aprobación.');
    const gate = run.gates?.find((g) => g.kind === 'plan_approval' && g.status === 'pending');
    if (gate) this.bus.decide(run, gate.id, 'approve');
    for (const t of run.tasks) {
      const a = assignments[t.id];
      if (a && run.agents.includes(a)) t.assignee = a;
    }
    this.wrap(run, () => this.execute(run));
    return this.publicRun(run);
  }

  cancel(id) {
    const run = this.runs.get(id);
    if (!run) throw new Error('No existe esa tarea.');
    run.cancelled = true;
    this.bus.cancel(run);
    for (const child of this.procs.get(id) ?? []) {
      child.cancelled = true;
      killTree(child);
    }
    for (const t of run.tasks) if (t.status === 'running' || t.status === 'pending') t.status = 'cancelled';
    this.setStatus(run, 'cancelled', 'Cancelado por el usuario');
    return this.publicRun(run);
  }

  async cleanup(id) {
    const run = this.runs.get(id);
    if (!run) throw new Error('No existe esa tarea.');
    if (ACTIVE.has(run.status)) throw new Error('Cancela la tarea antes de limpiar sus copias.');
    const paths = Object.values(run.worktrees).map((w) => w.path);
    if (run.integration?.worktree) paths.push(run.integration.worktree);
    for (const p of paths) await G.removeWorktree(run.repoPath, p);
    run.cleaned = true;
    this.log(run, null, '🧹 Copias de trabajo eliminadas (las ramas se conservan).');
    this.touch(run);
    return this.publicRun(run);
  }

  // ------------------------------------------------------------ fases

  async planAndBid(run) {
    // 1. Planificación
    this.setStatus(run, 'planning', `${AGENTS[run.coordinator].name} está dividiendo el objetivo en subtareas`);
    const files = await G.listFiles(run.repoPath);
    const plan = await this.callWithFallback(run, run.coordinator, () => P.planPrompt(run, files), { cwd: run.repoPath, label: 'Planificar' });
    if (!plan.ok) throw new Error(`Ninguna IA pudo planificar: ${plan.error}`);
    run.coordinator = plan.agent;
    run.tasks = normalizeTasks(plan.json?.tasks);
    if (!run.tasks.length) throw new Error('El coordinador no devolvió subtareas válidas.');
    this.post(run, run.coordinator, 'all', `He dividido el objetivo en ${run.tasks.length} subtareas.`);

    // 2. Negociación: cada IA se puntúa para cada subtarea.
    this.setStatus(run, 'bidding', 'Las IAs están valorando quién es mejor para cada subtarea');
    const results = await Promise.all(
      run.agents.map(async (a) => [a, await this.call(run, a, P.bidPrompt(run, a), { cwd: run.repoPath, label: 'Valorar subtareas' })]),
    );
    for (const [agent, res] of results) {
      if (!res.ok || !Array.isArray(res.json?.bids)) {
        this.post(run, 'aiteam', 'all', `${AGENTS[agent].name} no está disponible y queda fuera del reparto.`);
        continue;
      }
      run.activeAgents.push(agent);
      for (const bid of res.json.bids) {
        const task = run.tasks.find((t) => t.id === String(bid.taskId));
        if (!task) continue;
        // Quien no tiene la capacidad que pide la subtarea no puede quedársela, diga lo que diga su nota.
        const missing = missingFor(agent, task.requires);
        task.bids[agent] = missing.length
          ? { score: 0, reason: `No puede: requiere ${describeRequires(missing)}.` }
          : { score: Math.max(0, Math.min(10, Number(bid.score) || 0)), reason: short(bid.reason, 300) };
      }
      run.reviewScores[agent] = {
        score: Math.max(0, Math.min(10, Number(res.json.review?.score) || 0)),
        reason: short(res.json.review?.reason, 300),
      };
    }
    if (!run.activeAgents.length) throw new Error('Ninguna IA respondió a la negociación.');
    run.coordinator = this.fallbackAgent(run, run.coordinator);

    // 3. Reparto: mejor puntuación, penalizando la carga para trabajar en paralelo.
    const load = Object.fromEntries(run.activeAgents.map((a) => [a, 0]));
    for (const task of run.tasks) {
      let best = null;
      const capable = run.activeAgents.filter((a) => canDo(a, task.requires));
      if (task.requires.length && !capable.length) {
        task.warning = `Ninguna IA del equipo tiene la capacidad necesaria (${describeRequires(task.requires)}); revisa las capacidades en Ajustes.`;
      }
      for (const a of capable.length ? capable : run.activeAgents) {
        const score = (task.bids[a]?.score ?? 0) - LOAD_PENALTY * load[a];
        if (!best || score > best.score || (score === best.score && load[a] < load[best.agent])) best = { agent: a, score };
      }
      task.assignee = best.agent;
      load[best.agent]++;
    }
    const summary = run.activeAgents
      .map((a) => `${AGENTS[a].name}: ${run.tasks.filter((t) => t.assignee === a).map((t) => t.id).join(', ') || '—'}`)
      .join(' · ');
    this.post(run, 'aiteam', 'all', `Reparto acordado → ${summary}`);

    if (run.autoApprove) {
      await this.execute(run);
    } else {
      this.bus.gate(run, { kind: 'plan_approval', question: '¿Aprobar el reparto y empezar?', options: ['approve', 'cancel'] });
      this.setStatus(run, 'awaiting_approval', 'Revisa el reparto y apruébalo para empezar');
    }
  }

  worktreeFor(run, agent) {
    if (run.worktrees[agent]) return run.worktrees[agent];
    const base = path.join(path.dirname(run.repoPath), `.aiteam-${path.basename(run.repoPath)}`, run.id);
    run.worktrees[agent] = { path: path.join(base, agent), branch: `aiteam/${run.id}/${agent}`, mergedTasks: [] };
    return run.worktrees[agent];
  }

  async ensureWorktree(run, agent) {
    const wt = this.worktreeFor(run, agent);
    if (!fs.existsSync(wt.path)) {
      await G.addWorktree(run.repoPath, wt.path, wt.branch, run.baseCommit);
      this.log(run, agent, `📁 Copia aislada: ${wt.path} (rama ${wt.branch})`);
    }
    return wt;
  }

  /** Mejor IA disponible para una subtarea según las valoraciones, excluyendo las que ya fallaron en ella. */
  bestAlternative(run, task) {
    const candidates = this.available(run).filter((a) => !task.failedBy.includes(a) && canDo(a, task.requires));
    if (!candidates.length) return null;
    const load = (a) => run.tasks.filter((t) => t.assignee === a && (t.status === 'pending' || t.status === 'running')).length;
    return candidates.reduce((best, a) => {
      const s = (task.bids[a]?.score ?? 0) - LOAD_PENALTY * load(a);
      const b = (task.bids[best]?.score ?? 0) - LOAD_PENALTY * load(best);
      return s > b ? a : best;
    });
  }

  reassign(run, task, reason) {
    const from = task.assignee;
    const to = this.bestAlternative(run, task);
    if (!to) return false;
    task.assignee = to;
    task.status = 'pending';
    task.reassignedFrom = [...(task.reassignedFrom ?? []), from];
    this.post(run, 'aiteam', 'all', `${task.id} pasa de ${AGENTS[from].name} a ${AGENTS[to].name} (${reason}).`);
    return true;
  }

  async execute(run) {
    this.setStatus(run, 'running', 'Las IAs están trabajando en paralelo');
    for (const t of run.tasks) {
      t.failedBy ??= [];
      t.requires ??= [];
    }
    for (const agent of new Set(run.tasks.map((t) => t.assignee))) await this.ensureWorktree(run, agent);
    this.touch(run);

    const terminal = (t) => !['pending', 'running'].includes(t.status);
    const running = new Map(); // agente -> promesa de su subtarea en curso

    // Planificador: cada IA hace una subtarea a la vez; una subtarea arranca cuando sus dependencias han terminado.
    while (true) {
      if (run.cancelled) {
        for (const t of run.tasks) if (t.status === 'pending') t.status = 'cancelled';
        await Promise.allSettled(running.values());
        break;
      }
      for (const t of run.tasks) {
        if (t.status !== 'pending') continue;
        const deps = t.dependsOn.map((d) => run.tasks.find((x) => x.id === d));
        if (deps.some((d) => terminal(d) && d.status !== 'done')) {
          t.status = 'skipped';
          t.error = 'Una subtarea de la que dependía no se completó.';
          this.touch(run);
        } else if (run.exhausted[t.assignee] && !this.reassign(run, t, 'se quedó sin cuota')) {
          t.status = 'failed';
          t.error = t.requires.length
            ? `Requiere ${describeRequires(t.requires)} y ninguna IA capaz está disponible.`
            : 'No queda ninguna IA disponible para esta subtarea.';
          this.touch(run);
        }
      }
      for (const t of run.tasks) {
        if (t.status !== 'pending' || running.has(t.assignee)) continue;
        if (t.notBefore && Date.parse(t.notBefore) > Date.now()) continue; // reintento programado
        if (!t.dependsOn.every((d) => run.tasks.find((x) => x.id === d).status === 'done')) continue;
        const agent = t.assignee;
        running.set(
          agent,
          this.runTask(run, t).finally(() => running.delete(agent)),
        );
      }
      if (!running.size) {
        // Si solo quedan reintentos programados, se espera a que llegue su hora.
        const waits = run.tasks.filter((t) => t.status === 'pending' && t.notBefore).map((t) => Date.parse(t.notBefore));
        if (!waits.length) break;
        await new Promise((r) => setTimeout(r, Math.max(500, Math.min(...waits) - Date.now())));
        continue;
      }
      await Promise.race(running.values());
    }
    this.checkCancelled(run);
    for (const t of run.tasks) {
      if (t.status === 'pending') {
        t.status = 'skipped';
        t.error = 'No se pudo programar (dependencias sin completar).';
      }
    }

    const done = run.tasks.filter((t) => t.status === 'done').length;
    this.post(run, 'aiteam', 'all', `Ejecución terminada: ${done}/${run.tasks.length} subtareas completadas.`);
    if (!done) throw new Error('Ninguna subtarea se completó.');

    if (run.review) await this.reviewPhase(run);
    await this.integrate(run);
  }

  /** Ejecuta una subtarea en la copia de su responsable; si falla, la pasa a la siguiente mejor IA. */
  async runTask(run, task) {
    const agent = task.assignee;
    const wt = await this.ensureWorktree(run, agent);
    const deps = task.dependsOn.map((d) => run.tasks.find((t) => t.id === d));
    task.status = 'running';
    task.startedAt = new Date().toISOString();
    task.error = null;
    task.notBefore = null;
    this.touch(run);

    let res;
    try {
      await this.mergeDependencies(run, agent, deps);
      res = await this.call(run, agent, P.taskPrompt(run, task, agent), { cwd: wt.path, mode: 'write', label: `${task.id}: ${task.title}` });
    } catch (err) {
      if (!(err instanceof Cancelled)) throw err;
      task.status = 'cancelled';
      return;
    }

    if (!res.ok) {
      await G.discardChanges(wt.path);
      task.failedBy.push(agent);
      const network = isNetworkError(res.error);
      // Historial de intentos: la interfaz los muestra como "intento anterior" si la subtarea sigue con otra IA.
      task.attempts = [...(task.attempts ?? []), { agent, error: short(res.error, 400), kind: run.exhausted[agent] ? 'quota' : network ? 'network' : 'error', at: new Date().toISOString() }];
      const reason = run.exhausted[agent] ? 'se quedó sin cuota' : network ? 'tuvo un error de red' : 'falló';
      if (task.failedBy.length >= MAX_ATTEMPTS_PER_TASK) {
        task.status = 'failed';
        task.error = res.error;
      } else if (!this.reassign(run, task, reason)) {
        if (network && task.requires.length && !run.exhausted[agent]) {
          // Es la única IA capaz (p. ej. de generar imágenes) y el fallo es de red: se espera y se le vuelve a dar.
          task.status = 'pending';
          task.notBefore = new Date(Date.now() + CAPABLE_RETRY_DELAY_MS).toISOString();
          this.post(run, 'aiteam', 'all', `${task.id} requiere ${describeRequires(task.requires)}: se reintenta con ${AGENTS[agent].name} en ${CAPABLE_RETRY_DELAY_MS / 1000} s (error de red).`);
        } else {
          task.status = 'failed';
          task.error = task.requires.length
            ? `Requiere ${describeRequires(task.requires)} y ninguna otra IA capaz está disponible. Último error de ${AGENTS[agent].name}: ${short(res.error, 300)}`
            : res.error;
        }
      }
      this.touch(run);
      return;
    }
    res = await this.handleSignals(run, task, agent, res);
    task.summary = short(res.json?.summary ?? res.text, 1500);
    task.changed = await G.commitAll(wt.path, `[${agent}] ${task.id}: ${task.title}`);
    if (!task.changed) this.log(run, agent, `ℹ ${task.id} terminó sin modificar archivos.`);
    task.status = 'done';
    task.finishedAt = new Date().toISOString();
    this.bus.post(run, { from: agent, to: run.coordinator, text: task.summary, kind: 'worker_done', taskId: task.id });
    this.touch(run);
  }

  /** Antes de empezar una subtarea, trae a la copia del agente el trabajo de las subtareas de otros de las que depende. */
  async mergeDependencies(run, agent, deps) {
    const wt = run.worktrees[agent];
    wt.mergedTasks ??= [];
    for (const dep of deps) {
      if (dep.assignee === agent || wt.mergedTasks.includes(dep.id)) continue;
      const other = run.worktrees[dep.assignee];
      const res = await G.merge(wt.path, other.branch, `AITeam: trae el trabajo de ${dep.assignee}`);
      if (!res.ok) {
        this.log(run, agent, `⚠ Conflicto al traer el trabajo de ${dep.assignee}: ${res.conflicts.join(', ')}`);
        await this.call(run, agent, P.conflictPrompt(run, res.conflicts), { cwd: wt.path, mode: 'write', label: 'Resolver conflictos' });
        if (!(await this.resolved(wt.path, res.conflicts))) {
          await G.abortMerge(wt.path);
          this.log(run, agent, `✖ No se pudieron resolver los conflictos con ${dep.assignee}; se continúa sin su trabajo.`);
          continue;
        }
        await G.finishMerge(wt.path);
      }
      wt.mergedTasks.push(dep.id);
      this.log(run, agent, `🔀 Trabajo de ${dep.assignee} incorporado.`);
    }
  }

  /** Los archivos siguen marcados como en conflicto hasta el `git add`; lo que cuenta es que no queden marcadores. */
  resolved(worktree, files) {
    for (const f of files) {
      const p = path.join(worktree, f);
      if (fs.existsSync(p) && /^(<{7}|>{7}) /m.test(fs.readFileSync(p, 'utf8'))) return false;
    }
    return true;
  }

  pickReviewer(run, author, exclude = []) {
    const candidates = this.available(run).filter((a) => a !== author && !exclude.includes(a));
    if (!candidates.length) return null;
    return candidates.reduce((best, a) => ((run.reviewScores[a]?.score ?? 0) > (run.reviewScores[best]?.score ?? 0) ? a : best));
  }

  async reviewPhase(run) {
    this.setStatus(run, 'reviewing', 'Revisión cruzada: cada IA revisa el trabajo de otra');
    const cfg = loadConfig();
    const jobs = [];
    for (const [author, wt] of Object.entries(run.worktrees)) {
      if (!(await G.hasCommitsSince(run.repoPath, run.baseCommit, wt.branch))) continue;
      const reviewer = this.pickReviewer(run, author);
      if (!reviewer) {
        this.log(run, author, 'ℹ No hay otra IA disponible para revisar este trabajo.');
        continue;
      }
      jobs.push({ author, reviewer, wt });
    }

    // Cada revisor hace sus revisiones de una en una; revisores distintos trabajan en paralelo.
    const byReviewer = Map.groupBy(jobs, (j) => j.reviewer);
    await Promise.all(
      [...byReviewer.values()].map(async (list) => {
        for (const job of list) await this.reviewLoop(run, job, cfg.maxFixRounds);
      }),
    );
  }

  async reviewLoop(run, { author, reviewer, wt }, maxFixRounds) {
    const triedReviewers = [];
    for (let round = 0; ; round++) {
      const diff = await G.diffSince(run.repoPath, run.baseCommit, wt.branch);
      const res = await this.call(run, reviewer, P.reviewPrompt(run, author, reviewer, diff), {
        cwd: wt.path,
        label: `Revisar el trabajo de ${AGENTS[author].name}${round ? ` (ronda ${round + 1})` : ''}`,
      });
      if (!res.ok || !res.json) {
        // Si el revisor falla, otra IA disponible repite la misma ronda.
        triedReviewers.push(reviewer);
        const next = this.pickReviewer(run, author, triedReviewers);
        if (next) {
          this.log(run, next, `↪ Asume la revisión del trabajo de ${AGENTS[author].name}`);
          reviewer = next;
          round--;
          continue;
        }
        run.reviews.push({ author, reviewer, round, approved: null, summary: `La revisión falló: ${res.error ?? 'respuesta sin JSON'}`, issues: [] });
        this.touch(run);
        return;
      }
      const review = {
        author,
        reviewer,
        round,
        approved: Boolean(res.json.approved),
        summary: short(res.json.summary, 1000),
        issues: (Array.isArray(res.json.issues) ? res.json.issues : []).map((i) => ({
          severity: String(i.severity ?? 'media'),
          file: i.file ? String(i.file) : '',
          description: short(i.description, 800),
        })),
      };
      run.reviews.push(review);
      this.post(
        run,
        reviewer,
        author,
        review.approved ? `Revisado y aprobado. ${review.summary}` : `He encontrado ${review.issues.length} problema(s): ${review.summary}`,
      );
      if (review.approved || round >= maxFixRounds) return;

      // Corrige la autora; si no puede (p. ej. sin cuota), lo hace otra IA en la misma copia.
      const fix = await this.callWithFallback(run, author, (a) => P.fixPrompt(run, a, review), {
        cwd: wt.path,
        mode: 'write',
        label: `Corregir lo que señaló ${AGENTS[reviewer].name}`,
      });
      if (!fix.ok) return;
      for (const m of fix.json?.messages ?? []) if (m?.text) this.post(run, fix.agent, String(m.to ?? reviewer), m.text);
      await G.commitAll(wt.path, `[${fix.agent}] correcciones tras la revisión de ${reviewer}`);
    }
  }

  async integrate(run) {
    this.setStatus(run, 'integrating', 'Fusionando el trabajo de todas las IAs');
    const base = path.join(path.dirname(run.repoPath), `.aiteam-${path.basename(run.repoPath)}`, run.id);
    const integration = {
      branch: `aiteam/${run.id}/integracion`,
      worktree: path.join(base, '_integracion'),
      merged: [],
      unmerged: [],
      tests: null,
    };
    run.integration = integration;
    if (!fs.existsSync(integration.worktree)) {
      await G.addWorktree(run.repoPath, integration.worktree, integration.branch, run.baseCommit);
    }
    const resolver = this.fallbackAgent(run, run.coordinator);

    for (const [agent, wt] of Object.entries(run.worktrees)) {
      this.checkCancelled(run);
      if (!(await G.hasCommitsSince(run.repoPath, run.baseCommit, wt.branch))) continue;
      const res = await G.merge(integration.worktree, wt.branch, `AITeam: integra el trabajo de ${agent}`);
      if (res.ok) {
        integration.merged.push(agent);
        this.log(run, null, `🔀 Integrado el trabajo de ${AGENTS[agent].name}.`);
        continue;
      }
      this.log(run, null, `⚠ Conflictos al integrar ${AGENTS[agent].name}: ${res.conflicts.join(', ')}`);
      const fix = await this.callWithFallback(run, resolver, () => P.conflictPrompt(run, res.conflicts), {
        cwd: integration.worktree,
        mode: 'write',
        label: `Resolver conflictos al integrar a ${AGENTS[agent].name}`,
      });
      if (fix.ok && this.resolved(integration.worktree, res.conflicts)) {
        await G.finishMerge(integration.worktree);
        integration.merged.push(agent);
        this.log(run, fix.agent, `🔀 Conflictos resueltos; integrado el trabajo de ${AGENTS[agent].name}.`);
      } else {
        await G.abortMerge(integration.worktree);
        integration.unmerged.push(agent);
        this.post(run, 'aiteam', 'all', `No se pudo integrar automáticamente el trabajo de ${AGENTS[agent].name}; queda en su rama ${wt.branch}.`);
      }
      this.touch(run);
    }

    if (run.adversarial) await this.adversarialPhase(run);
    if (run.testCommand) await this.verify(run, this.fallbackAgent(run, run.coordinator));

    const ok = !integration.unmerged.length && integration.tests?.passed !== false;
    this.setStatus(run, 'done', ok ? 'Terminado: el resultado está listo para revisar' : 'Terminado con avisos: revisa los detalles');
  }

  /** Equipo rojo: una IA intenta romper el resultado integrado y otra corrige lo que encuentre. */
  async adversarialPhase(run) {
    const pool = this.available(run);
    if (!pool.length) return;
    this.setStatus(run, 'attacking', 'Fase adversarial: una IA intenta romper el resultado');
    const integration = run.integration;
    const byReview = [...pool].sort((a, b) => (run.reviewScores[b]?.score ?? 0) - (run.reviewScores[a]?.score ?? 0));
    const diff = await G.diffSince(run.repoPath, run.baseCommit, integration.branch);
    if (!diff.diff.trim()) return;

    const attack = await this.callWithFallback(run, byReview[0], (a) => P.adversarialPrompt(run, a, diff), {
      cwd: integration.worktree,
      label: 'Atacar el resultado (equipo rojo)',
    });
    if (!attack.ok || !attack.json) {
      run.attack = { attacker: attack.agent, error: attack.error ?? 'respuesta sin JSON', findings: [] };
      this.touch(run);
      return;
    }
    const findings = (Array.isArray(attack.json.findings) ? attack.json.findings : []).map((f) => ({
      severity: String(f.severity ?? 'media'),
      file: String(f.file ?? ''),
      title: short(f.title, 200),
      description: short(f.description, 1000),
      reproduce: short(f.reproduce, 600),
      fix: short(f.fix, 600),
    }));
    run.attack = { attacker: attack.agent, summary: short(attack.json.summary, 1000), findings, fixer: null, fixSummary: null };
    const serious = findings.filter((f) => /alta|media|high|medium|crít|crit/i.test(f.severity));
    this.post(
      run,
      attack.agent,
      'all',
      findings.length ? `Equipo rojo: ${findings.length} hallazgo(s), ${serious.length} importantes. ${run.attack.summary}` : `Equipo rojo: no he conseguido romperlo. ${run.attack.summary}`,
    );
    this.touch(run);
    if (!serious.length) return;

    // Corrige otra IA distinta del atacante (si la hay), para no corregirse a sí misma.
    const fixerPref = pool.find((a) => a !== attack.agent) ?? attack.agent;
    const fix = await this.callWithFallback(run, fixerPref, () => P.adversarialFixPrompt(run, attack.agent, serious), {
      cwd: integration.worktree,
      mode: 'write',
      label: 'Corregir los hallazgos del equipo rojo',
    });
    if (fix.ok) {
      await G.commitAll(integration.worktree, `[${fix.agent}] corrige los hallazgos del equipo rojo`);
      run.attack.fixer = fix.agent;
      run.attack.fixSummary = short(fix.json?.summary ?? fix.text, 1500);
      this.post(run, fix.agent, attack.agent, `Hallazgos corregidos: ${run.attack.fixSummary}`);
    } else {
      await G.discardChanges(integration.worktree);
    }
    this.touch(run);
  }

  async verify(run, fixer) {
    this.setStatus(run, 'testing', `Verificando con: ${run.testCommand}`);
    const integration = run.integration;
    const exec = () =>
      runShell(run.testCommand, {
        cwd: integration.worktree,
        timeoutMs: 15 * 60_000,
        onSpawn: (child) => this.track(run, child),
      });
    let res = await exec();
    let attempts = 1;
    this.log(run, null, `${res.code === 0 ? '✔' : '✖'} Verificación (código ${res.code})`);
    if (res.code !== 0) {
      this.checkCancelled(run);
      this.post(run, 'aiteam', 'all', 'La verificación ha fallado; se intenta corregir.');
      const fix = await this.callWithFallback(run, fixer, () => P.testFixPrompt(run, run.testCommand, res.output), {
        cwd: integration.worktree,
        mode: 'write',
        label: 'Corregir la verificación',
      });
      if (fix.ok) await G.commitAll(integration.worktree, `[${fix.agent}] corrige la verificación`);
      else await G.discardChanges(integration.worktree);
      res = await exec();
      attempts++;
      this.log(run, null, `${res.code === 0 ? '✔' : '✖'} Verificación tras la corrección (código ${res.code})`);
    }
    integration.tests = { passed: res.code === 0, attempts, output: res.output.slice(-6000) };
    this.touch(run);
  }
}
