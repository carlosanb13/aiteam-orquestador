import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { Orchestrator } from './src/orchestrator.js';
import { ChatManager } from './src/chat.js';
import { snapshotRoutes } from './src/routes-snapshots.js';
import { busRoutes } from './src/routes-bus.js';
import * as G from './src/git.js';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { AGENTS, MOCK, addCustomAgent, checkAgent, configureCatalogAgent, invokeAgent, syncRegisteredAgents } from './src/agents.js';
import { discoverAgents, probeCommand } from './src/discovery.js';
import * as Extensions from './src/extensions.js';
import { getUsage, onUsageChange } from './src/usage.js';
import * as Projects from './src/projects.js';
import * as Review from './src/review.js';
import { runReviewTarget, saveRunReview } from './src/run-review.js';
import { LEVEL_INFO, LEVELS } from './src/permissions.js';
import * as Speech from './src/speech.js';
import { watchForNotifications } from './src/notify.js';
import { loadConfig, saveConfig } from './src/config.js';

const PORT = Number(process.env.PORT) || 4317;
const HOST = '127.0.0.1';
const APP_ROOT = path.resolve(import.meta.dirname);
const LOG_FILE = path.join(APP_ROOT, 'data', 'servidor.log');
const ROLLBACK_FILE = path.join(APP_ROOT, 'data', 'last-rollback.json');

function getLastRollback() {
  try {
    if (fs.existsSync(ROLLBACK_FILE)) {
      return JSON.parse(fs.readFileSync(ROLLBACK_FILE, 'utf8'));
    }
  } catch {}
  return null;
}

function saveLastRollback(info) {
  try {
    fs.mkdirSync(path.dirname(ROLLBACK_FILE), { recursive: true });
    fs.writeFileSync(ROLLBACK_FILE, JSON.stringify(info, null, 2), 'utf8');
  } catch (e) {
    console.error('Error guardando info de rollback:', e);
  }
}

function clearLastRollback() {
  try {
    if (fs.existsSync(ROLLBACK_FILE)) fs.unlinkSync(ROLLBACK_FILE);
  } catch {}
}

/** ¿Hay alguna IA trabajando? (reiniciar o apagar cortaría su trabajo) */
function teamBusy() {
  const activeRun = [...orchestrator.runs.values()].some((r) => ['planning', 'bidding', 'running', 'reviewing', 'integrating', 'attacking', 'testing'].includes(r.status));
  const activeChat = [...chats.chats.values()].some((c) => c.working);
  return activeRun || activeChat;
}

/**
 * Reinicia el servidor: lanza uno nuevo en segundo plano (espera a que este libere el puerto) y termina.
 * La ventana se reconecta y se recarga sola.
 */
function restartServer() {
  fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
  // En Windows el registro puede estar bloqueado por la consola que lanzó este servidor: se usa otro archivo.
  let log = 'ignore';
  for (const file of [LOG_FILE, LOG_FILE.replace(/\.log$/, '-reinicio.log')]) {
    try {
      log = fs.openSync(file, 'a');
      break;
    } catch {
      /* siguiente */
    }
  }
  const args = [path.join(APP_ROOT, 'server.js'), ...process.argv.slice(2)];
  const child = spawn(process.execPath, args, {
    cwd: APP_ROOT,
    detached: true,
    windowsHide: true,
    stdio: ['ignore', log, log],
    env: { ...process.env, AITEAM_RESTARTED: '1' },
  });
  child.unref();
  console.log('Reiniciando AITeam…');
  setTimeout(() => process.exit(0), 200);
}
const PUBLIC = path.resolve(import.meta.dirname, 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };

const orchestrator = new Orchestrator();
const clients = new Set();

function broadcast(type, data) {
  const payload = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) res.write(payload);
}
orchestrator.on('run', (run) => broadcast('run', run));
orchestrator.on('log', (entry) => broadcast('log', entry));

const chats = new ChatManager({
  onTeamTask: ({ repoPath, goal, agents, baseRef, autonomy }) =>
    orchestrator.create({ repoPath, goal, agents, baseRef, autonomy, coordinator: agents[0], review: true }),
});
chats.on('chat', (chat) => broadcast('chat', chat));
chats.on('activity', (a) => broadcast('chat-activity', a));
chats.on('removed', (r) => broadcast('chat-removed', r));
onUsageChange(() => broadcast('usage', getUsage()));
Speech.onSpeechChange((status) => broadcast('speech', status));
watchForNotifications({ chats, orchestrator, agents: AGENTS, hasViewers: () => clients.size > 0 });

function reviewTarget(kind, id, { mustBeIdle = false } = {}) {
  if (kind === 'chats') {
    const t = chats.reviewTarget(id);
    if (mustBeIdle) chats.assertIdle(t.chat);
    return t;
  }
  const run = orchestrator.get(id);
  if (!run) throw new Error('No existe esa tarea.');
  if (run.status !== 'done' || !run.integration?.branch) throw new Error('La tarea todavía no tiene un resultado integrado.');
  return runReviewTarget(run);
}

function saveReview(kind, t) {
  if (kind === 'chats') return chats.saveReview(t);
  saveRunReview(t, (run) => orchestrator.touch(run));
}

function knownPaths() {
  return [...orchestrator.runs.values()].map((r) => r.repoPath).concat([...chats.chats.values()].map((c) => c.repoPath));
}

/** Carpetas que se pueden explorar: proyectos y las copias de trabajo de conversaciones y tareas. */
function allowedRoots() {
  const roots = Projects.listProjects(knownPaths()).map((p) => p.path);
  for (const c of chats.chats.values()) roots.push(c.worktree.path);
  for (const r of orchestrator.runs.values()) {
    for (const w of Object.values(r.worktrees ?? {})) roots.push(w.path);
    if (r.integration?.worktree) roots.push(r.integration.worktree);
    for (const previous of r.previousIntegrations ?? []) if (previous.worktree) roots.push(previous.worktree);
  }
  return roots;
}

function send(res, status, body) {
  // Un error después de haber respondido no debe tumbar el servidor.
  if (res.headersSent) return console.error('Respuesta ya enviada:', body?.error ?? body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

/** Cuerpo binario (audio del dictado). */
async function readRaw(req, limit = 40 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error('Audio demasiado largo.');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function readBody(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 25_000_000) throw new Error('Petición demasiado grande.');
  }
  return raw ? JSON.parse(raw) : {};
}

const DEV_PORTS = [3000, 3001, 3002, 4000, 4173, 4200, 4321, 5000, 5173, 5174, 5500, 8000, 8080, 8081, 8888, 9000];
async function scanLocalPorts() {
  const checks = await Promise.all(
    DEV_PORTS.filter((p) => p !== PORT).map(
      (port) =>
        new Promise((resolve) => {
          const s = new net.Socket();
          let open = false;
          s.setTimeout(140);
          s.once('connect', () => {
            open = true;
            s.destroy();
            resolve({ port, url: `http://localhost:${port}` });
          });
          s.once('timeout', () => {
            s.destroy();
            resolve(null);
          });
          s.once('error', () => {
            s.destroy();
            resolve(null);
          });
          s.connect(port, '127.0.0.1');
        }),
    ),
  );
  return checks.filter(Boolean);
}

let agentCache = null;
async function agentStatus(refresh = false) {
  if (!agentCache || refresh) {
    syncRegisteredAgents();
    const cfg = loadConfig();
    const defId = cfg.defaultAgent || 'claude';
    agentCache = await Promise.all(
      Object.values(AGENTS).map(async (a) => ({
        ...a,
        ...cfg.agents[a.id],
        isDefault: a.id === defId,
        ...(await checkAgent(a.id)),
      })),
    );
  }
  return agentCache;
}

const routes = [
  ...busRoutes(orchestrator, send, readBody, broadcast),
  ...snapshotRoutes(chats, send, readBody),
  ...(await import('./src/routes-terminal.js')).terminalRoutes(chats, orchestrator, send, readBody, broadcast),
  ['GET', /^\/api\/ports$/, async (_req, res) => send(res, 200, { ports: await scanLocalPorts() })],
  ['GET', /^\/api\/agents$/, async (req, res, _m, url) => {
    const cfg = loadConfig();
    send(res, 200, { mock: MOCK, defaultAgent: cfg.defaultAgent || 'claude', agents: await agentStatus(url.searchParams.has('refresh')) });
  }],
  ['GET', /^\/api\/agents\/discover$/, async (req, res) => {
    const cfg = loadConfig();
    const defId = cfg.defaultAgent || 'claude';
    const raw = await discoverAgents();
    const candidates = raw.map((item) => {
      const aCfg = cfg.agents?.[item.id] ?? {};
      const enabled = item.builtin ? aCfg.enabled !== false : Boolean(aCfg.enabled);
      return {
        ...item,
        enabled,
        isDefault: item.id === defId,
        displayCmd: aCfg.displayCmd || item.displayCmd,
        customCommand: aCfg.command || '',
      };
    });
    send(res, 200, { defaultAgent: defId, candidates });
  }],
  ['POST', /^\/api\/agents\/catalog$/, async (req, res) => {
    const body = await readBody(req);
    const out = configureCatalogAgent(body.id, body);
    agentCache = null;
    send(res, 200, out);
  }],
  ['POST', /^\/api\/agents\/probe$/, async (req, res) => send(res, 200, await probeCommand((await readBody(req)).command))],
  ['POST', /^\/api\/agents$/, async (req, res) => {
    const agent = addCustomAgent(await readBody(req));
    agentCache = null;
    send(res, 201, { agent });
  }],
  [
    'POST',
    /^\/api\/agents\/(\w+)\/test$/,
    async (req, res, m) => {
      if (!AGENTS[m[1]]) return send(res, 404, { error: 'IA desconocida.' });
      const result = await checkAgent(m[1], { live: true });
      if (agentCache) Object.assign(agentCache.find((a) => a.id === m[1]), result);
      send(res, 200, result);
    },
  ],
  [
    'POST',
    /^\/api\/shutdown$/,
    (req, res) => {
      send(res, 200, { ok: true });
      console.log('Apagado solicitado desde la app.');
      setTimeout(() => process.exit(0), 300);
    },
  ],
  // ---- Revisión por archivo y aplicar al proyecto (conversaciones y tareas de equipo)
  ['GET', /^\/api\/(chats|runs)\/([\w-]+)\/changes$/, async (req, res, m) => send(res, 200, await Review.listChanges(reviewTarget(m[1], m[2])))],
  ['GET', /^\/api\/(chats|runs)\/([\w-]+)\/changes\/file$/, async (req, res, m, url) => send(res, 200, await Review.fileDiff(reviewTarget(m[1], m[2]), url.searchParams.get('path')))],
  [
    'POST',
    /^\/api\/(chats|runs)\/([\w-]+)\/changes\/accept$/,
    async (req, res, m) => {
      const { file, accepted } = await readBody(req);
      const t = reviewTarget(m[1], m[2]);
      if (accepted === false) Review.unaccept(t, file);
      else await Review.accept(t, file);
      saveReview(m[1], t);
      send(res, 200, { ok: true });
    },
  ],
  [
    'POST',
    /^\/api\/(chats|runs)\/([\w-]+)\/changes\/reject$/,
    async (req, res, m) => {
      const t = reviewTarget(m[1], m[2], { mustBeIdle: true });
      const changed = await Review.reject(t, (await readBody(req)).file);
      saveReview(m[1], t);
      send(res, 200, { ok: true, changed });
    },
  ],
  [
    'POST',
    /^\/api\/(chats|runs)\/([\w-]+)\/apply$/,
    async (req, res, m) => {
      const body = await readBody(req).catch(() => ({}));
      const t = reviewTarget(m[1], m[2], { mustBeIdle: true });
      const label = m[1] === 'chats' ? `la conversación «${t.chat.title}»` : `la tarea «${t.run.goal.slice(0, 80)}»`;
      const result = await Review.apply(t, `AITeam: aplica los cambios de ${label}`, body);
      if (result.ok) {
        saveReview(m[1], t);
        if (t.chat) chats.noticeApplied(t.chat, result);
        // Si se aplicó al propio AITeam, hace falta reiniciar para cargar el código nuevo.
        result.selfUpdate = path.resolve(t.repoPath).toLowerCase() === APP_ROOT.toLowerCase();
        if (result.selfUpdate && result.before) {
          saveLastRollback({ before: result.before, timestamp: new Date().toISOString(), label });
        }
      }
      send(res, 200, result);
    },
  ],
  [
    'POST',
    /^\/api\/(chats|runs)\/([\w-]+)\/commit-project$/,
    async (req, res, m) => {
      const body = await readBody(req).catch(() => ({}));
      const t = reviewTarget(m[1], m[2], { mustBeIdle: true });
      const message = body.message || 'AITeam: guardado automático del proyecto antes de aplicar cambios';
      const result = await Review.commitProject(t, message);
      send(res, 200, result);
    },
  ],
  [
    'POST',
    /^\/api\/chats\/([\w-]+)\/sync$/,
    async (req, res, m) => {
      const t = reviewTarget('chats', m[1], { mustBeIdle: true });
      const result = await Review.syncFromProject(t);
      if (!result.ok) chats.resolveSyncConflicts(t.chat, result.conflicts);
      else chats.save(t.chat);
      send(res, 200, result);
    },
  ],
  ['POST', /^\/api\/chats\/([\w-]+)\/request-changes$/, async (req, res, m) => send(res, 201, chats.requestChanges(m[1], await readBody(req)))],
  [
    'POST',
    /^\/api\/restart$/,
    async (req, res) => {
      const { force } = await readBody(req).catch(() => ({}));
      if (teamBusy() && !force) return send(res, 409, { error: 'Hay IAs trabajando; si reinicias ahora se cortará su trabajo.', busy: true });
      restartServer();
      send(res, 200, { ok: true });
    },
  ],
  [
    'POST',
    /^\/api\/app\/rollback$/,
    async (req, res) => {
      const info = getLastRollback();
      if (!info?.before) return send(res, 400, { error: 'No hay ninguna auto-mejora previa para revertir.' });
      const body = await readBody(req).catch(() => ({}));
      if (teamBusy() && !body.force) {
        return send(res, 409, { error: 'Hay IAs trabajando; si reviertes ahora se cortará su trabajo.', busy: true });
      }
      console.log(`Revertiendo AITeam al commit ${info.before}...`);
      const reset = await G.git(APP_ROOT, ['reset', '--hard', info.before], { allowFail: true });
      if (!reset.ok) {
        return send(res, 500, { error: `Error al revertir: ${reset.stderr || reset.stdout}` });
      }
      clearLastRollback();
      send(res, 200, { ok: true, restoredCommit: info.before });
      console.log('Rollback completado con éxito. Reiniciando servidor...');
      setTimeout(() => restartServer(), 300);
    },
  ],
  ['GET', /^\/api\/app$/, async (req, res) => {
    const head = await G.git(APP_ROOT, ['rev-parse', 'HEAD'], { allowFail: true });
    const rollback = getLastRollback();
    send(res, 200, {
      root: APP_ROOT,
      pid: process.pid,
      startedAt: STARTED_AT,
      head: head.ok ? head.stdout.trim() : null,
      rollback: rollback ? { commit: rollback.before, timestamp: rollback.timestamp, label: rollback.label } : null,
    });
  }],
  // ---- Dictado local (Whisper)
  ['GET', /^\/api\/speech$/, (req, res) => send(res, 200, Speech.speechStatus())],
  ['POST', /^\/api\/speech\/models\/(\w+)\/download$/, async (req, res, m) => send(res, 200, await Speech.downloadModel(m[1]))],
  ['DELETE', /^\/api\/speech\/models\/(\w+)$/, (req, res, m) => send(res, 200, Speech.deleteModel(m[1]))],
  [
    'POST',
    /^\/api\/speech\/transcribe$/,
    async (req, res) => {
      // Audio mono Float32 a 16 kHz, en crudo.
      const buf = await readRaw(req);
      const samples = new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.length / 4));
      const started = Date.now();
      const text = await Speech.transcribe(Float32Array.from(samples));
      send(res, 200, { text, ms: Date.now() - started });
    },
  ],
  ['GET', /^\/api\/usage$/, (req, res) => send(res, 200, getUsage())],
  [
    'POST',
    /^\/api\/usage\/refresh$/,
    async (req, res) => {
      // Una consulta mínima a Claude (modelo pequeño) devuelve su estado de límites actualizado.
      if (!MOCK) await invokeAgent('claude', { prompt: 'Responde solo: OK', cwd: os.tmpdir(), mode: 'read', model: 'haiku', timeoutMs: 90_000 });
      send(res, 200, getUsage());
    },
  ],
  ['GET', /^\/api\/projects$/, (req, res) => send(res, 200, Projects.listProjects(knownPaths()))],
  [
    'POST',
    /^\/api\/projects$/,
    async (req, res) => {
      const body = await readBody(req);
      send(res, 201, body.prepare ? await Projects.prepareProject(body.path) : await Projects.addProject(body.path));
    },
  ],
  [
    'POST',
    /^\/api\/projects\/pick$/,
    async (req, res) => {
      const script = [
        '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
        'Add-Type -AssemblyName System.Windows.Forms',
        '$f = New-Object System.Windows.Forms.FolderBrowserDialog',
        '$f.Description = "Selecciona la carpeta de tu proyecto"',
        '$f.ShowNewFolderButton = $true',
        'if ($f.ShowDialog() -eq "OK") { Write-Output $f.SelectedPath }',
      ].join('; ');
      const child = spawn('powershell.exe', ['-NoProfile', '-STA', '-Command', script], { windowsHide: false });
      let out = '';
      child.stdout.on('data', (d) => (out += d.toString('utf8')));
      child.on('close', async () => {
        const picked = out.trim();
        if (!picked) return send(res, 200, { path: null });
        const check = await Projects.checkFolder(picked);
        send(res, 200, { path: picked, ...check });
      });
    },
  ],
  [
    'DELETE',
    /^\/api\/projects$/,
    async (req, res) => {
      Projects.removeProject((await readBody(req)).path);
      send(res, 200, { ok: true });
    },
  ],
  ['GET', /^\/api\/fs\/tree$/, async (req, res, m, url) => send(res, 200, await Projects.listTree(url.searchParams.get('root'), allowedRoots()))],
  [
    'GET',
    /^\/api\/fs\/image$/,
    (req, res, m, url) => {
      const img = Projects.readImage(url.searchParams.get('root'), url.searchParams.get('path'), allowedRoots());
      // Las imágenes vienen de lo que generan las IAs: sin scripts ni recursos externos (importa en los SVG).
      res.writeHead(200, {
        'Content-Type': img.type,
        'Cache-Control': 'no-store',
        'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; img-src data:; sandbox",
        'X-Content-Type-Options': 'nosniff',
      });
      res.end(img.data);
    },
  ],
  ['GET', /^\/api\/fs\/file$/, (req, res, m, url) => send(res, 200, Projects.readFile(url.searchParams.get('root'), url.searchParams.get('path'), allowedRoots()))],
  ['PATCH', /^\/api\/chats\/([\w-]+)$/, async (req, res, m) => send(res, 200, chats.update(m[1], await readBody(req)))],
  ['GET', /^\/api\/permissions$/, (req, res) => send(res, 200, { levels: LEVELS.map((id) => ({ id, ...LEVEL_INFO[id] })) })],
  [
    'POST',
    /^\/api\/window-theme$/,
    async (req, res) => {
      const { bg = '#1d1d1b', text = '#ecebe7', border = '#34332f', dark = true } = await readBody(req);
      const toColorRef = (hex) => {
        const h = String(hex).replace('#', '').trim();
        if (h.length !== 6) return 0x001b1d1d;
        const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
        return (b << 16) | (g << 8) | r;
      };
      const capRef = toColorRef(bg);
      const txtRef = toColorRef(text);
      const brdRef = toColorRef(border);
      const darkVal = dark ? 1 : 0;
      const appIdPath = path.join(APP_ROOT, 'launcher', 'AppId.cs').replace(/'/g, "''");
      const ps = `Add-Type -Path '${appIdPath}'; [AITeamAppId]::ColorWindowsTitled('AITeam', ${capRef}, ${txtRef}, ${brdRef}, ${darkVal}) | Out-Null`;
      spawn('powershell.exe', ['-NoProfile', '-WindowStyle', 'Hidden', '-Command', ps], { windowsHide: true }).unref();
      send(res, 200, { ok: true });
    },
  ],
  ['GET', /^\/api\/config$/, (req, res) => send(res, 200, loadConfig())],
  [
    'PUT',
    /^\/api\/config$/,
    async (req, res) => {
      const cfg = saveConfig(await readBody(req));
      agentCache = null;
      send(res, 200, cfg);
    },
  ],
  ['GET', /^\/api\/runs$/, (req, res) => send(res, 200, orchestrator.list())],
  ['POST', /^\/api\/runs$/, async (req, res) => send(res, 201, await orchestrator.create(await readBody(req)))],
  ['POST', /^\/api\/runs\/([\w-]+)\/retry$/, async (req, res, m) => {
    const old = orchestrator.get(m[1]);
    if (!old) return send(res, 404, { error: 'No existe esa tarea.' });
    if (!['failed', 'interrupted', 'cancelled'].includes(old.status)) return send(res, 400, { error: 'La tarea todavía está en curso o ya tiene un resultado.' });
    const run = await orchestrator.create({
      repoPath: old.repoPath, baseRef: old.baseBranch, goal: old.goal, agents: old.agents,
      coordinator: old.coordinator, review: old.review, adversarial: old.adversarial,
      testCommand: old.testCommand, autoApprove: old.autoApprove,
      autonomy: old.autonomy,
    });
    const chat = [...chats.chats.values()].find((c) => c.worktree?.branch === old.baseBranch);
    if (chat) chats.addMessage(chat, { from: 'system', kind: 'notice', text: 'El equipo vuelve a intentar la tarea. El intento anterior sigue guardado para consulta.', meta: { runId: run.id } });
    send(res, 201, { id: run.id, chatId: chat?.id ?? null });
  }],
  ['POST', /^\/api\/runs\/([\w-]+)\/resume$/, async (req, res, m) => send(res, 200, await orchestrator.resume(m[1]))],
  [
    'GET',
    /^\/api\/runs\/([\w-]+)$/,
    (req, res, m) => {
      const run = orchestrator.get(m[1]);
      run ? send(res, 200, run) : send(res, 404, { error: 'No existe esa tarea.' });
    },
  ],
  ['POST', /^\/api\/runs\/([\w-]+)\/approve$/, async (req, res, m) => send(res, 200, orchestrator.approve(m[1], (await readBody(req)).assignments))],
  ['POST', /^\/api\/runs\/([\w-]+)\/pause$/, (req, res, m) => send(res, 200, orchestrator.pause(m[1]))],
  ['POST', /^\/api\/runs\/([\w-]+)\/cancel$/, (req, res, m) => send(res, 200, orchestrator.cancel(m[1]))],
  [
    'GET',
    /^\/api\/runs\/([\w-]+)\/diff$/,
    async (req, res, m, url) => {
      const run = orchestrator.get(m[1]);
      if (!run) return send(res, 404, { error: 'No existe esa tarea.' });
      const branch = url.searchParams.get('branch') || run.integration?.branch;
      if (!branch) return send(res, 400, { error: 'Todavía no hay cambios integrados.' });
      const diff = await G.diffSince(run.repoPath, run.baseCommit, branch, 400_000);
      send(res, 200, { ...diff, branch, baseBranch: run.baseBranch, repoPath: run.repoPath });
    },
  ],
  ['GET', /^\/api\/chats$/, (req, res) => send(res, 200, chats.list())],
  ['POST', /^\/api\/chats$/, async (req, res) => send(res, 201, await chats.create(await readBody(req)))],
  [
    'GET',
    /^\/api\/chats\/([\w-]+)$/,
    (req, res, m) => {
      const chat = chats.get(m[1]);
      chat ? send(res, 200, chat) : send(res, 404, { error: 'No existe esa conversación.' });
    },
  ],
  ['DELETE', /^\/api\/chats\/([\w-]+)$/, async (req, res, m) => send(res, 200, await chats.remove(m[1]))],
  ['POST', /^\/api\/chats\/([\w-]+)\/messages$/, async (req, res, m) => {
    const body = await readBody(req);
    send(res, 201, chats.post(m[1], body.text, body));
  }],
  ['POST', /^\/api\/chats\/([\w-]+)\/stop$/, (req, res, m) => send(res, 200, { ok: Boolean(chats.stop(m[1])) })],
  ['POST', /^\/api\/chats\/([\w-]+)\/pause$/, (req, res, m) => send(res, 200, { ok: Boolean(chats.pause(m[1])) })],
  ['POST', /^\/api\/chats\/([\w-]+)\/resume$/, (req, res, m) => send(res, 200, chats.resume(m[1]))],
  ['GET', /^\/api\/chats\/([\w-]+)\/extensions$/, (req, res, m) => {
    const chat = chats.get(m[1]);
    if (!chat) return send(res, 404, { error: 'No existe esa conversación.' });
    send(res, 200, { extensions: Extensions.listExtensions(chat.repoPath) });
  }],
  ['POST', /^\/api\/chats\/([\w-]+)\/extensions$/, async (req, res, m) => {
    const chat = chats.get(m[1]);
    if (!chat) return send(res, 404, { error: 'No existe esa conversación.' });
    send(res, 201, Extensions.saveExtension(chat.repoPath, await readBody(req)));
  }],
  ['PATCH', /^\/api\/chats\/([\w-]+)\/extensions\/([a-z][a-z0-9_]+)$/, async (req, res, m) => {
    const chat = chats.get(m[1]);
    if (!chat) return send(res, 404, { error: 'No existe esa conversación.' });
    send(res, 200, Extensions.setExtensionEnabled(chat.repoPath, m[2], (await readBody(req)).enabled));
  }],
  ['DELETE', /^\/api\/chats\/([\w-]+)\/extensions\/([a-z][a-z0-9_]+)$/, (req, res, m) => {
    const chat = chats.get(m[1]);
    if (!chat) return send(res, 404, { error: 'No existe esa conversación.' });
    send(res, 200, Extensions.removeExtension(chat.repoPath, m[2]));
  }],
  ['GET', /^\/api\/chats\/([\w-]+)\/diff$/, async (req, res, m) => send(res, 200, await chats.diff(m[1]))],
  ['POST', /^\/api\/runs\/([\w-]+)\/cleanup$/, async (req, res, m) => send(res, 200, await orchestrator.cleanup(m[1]))],
  [
    'GET',
    /^\/api\/events$/,
    (req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      res.write(': conectado\n\n');
      clients.add(res);
      const ping = setInterval(() => res.write(': ping\n\n'), 25_000);
      req.on('close', () => {
        clearInterval(ping);
        clients.delete(res);
      });
    },
  ],
];

routes.unshift(...(await import('./src/routes-commands.js')).default({ chats, send, readBody })); // modos, comandos, reglas y compactación

function serveStatic(req, res, url) {
  const rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).replace(/^\/+/, '');
  const file = path.resolve(PUBLIC, rel);
  if (!file.startsWith(PUBLIC) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(404);
    return res.end('No encontrado');
  }
  // Sin caché: la interfaz cambia a menudo (las propias IAs la mejoran) y siempre debe verse la última versión.
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  // Solo se aceptan peticiones de la propia app (evita que otra web local dispare acciones).
  const origin = req.headers.origin;
  if (req.method !== 'GET' && origin && origin !== `http://${HOST}:${PORT}` && origin !== `http://localhost:${PORT}`) {
    return send(res, 403, { error: 'Origen no permitido.' });
  }
  for (const [method, pattern, handler] of routes) {
    const m = url.pathname.match(pattern);
    if (m && req.method === method) {
      try {
        return await handler(req, res, m, url);
      } catch (err) {
        return send(res, 400, { error: err.message });
      }
    }
  }
  if (url.pathname.startsWith('/api/')) return send(res, 404, { error: 'Ruta no encontrada.' });
  serveStatic(req, res, url);
});

const STARTED_AT = new Date().toISOString();

// Tras un reinicio, el servidor anterior puede tardar un momento en liberar el puerto: se reintenta.
let listenAttempts = 0;
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE' && process.env.AITEAM_RESTARTED && listenAttempts++ < 40) {
    setTimeout(() => server.listen(PORT, HOST), 250);
    return;
  }
  console.error(err.code === 'EADDRINUSE' ? `El puerto ${PORT} ya está en uso: ¿AITeam ya está abierto?` : err);
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  console.log(`AITeam en http://localhost:${PORT}${MOCK ? '  (modo simulación: no se llama a ninguna IA)' : ''}`);
});
