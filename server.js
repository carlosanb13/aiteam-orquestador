import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { Orchestrator } from './src/orchestrator.js';
import { ChatManager } from './src/chat.js';
import * as G from './src/git.js';
import os from 'node:os';
import { AGENTS, MOCK, checkAgent, invokeAgent } from './src/agents.js';
import { getUsage, onUsageChange } from './src/usage.js';
import * as Projects from './src/projects.js';
import { loadConfig, saveConfig } from './src/config.js';

const PORT = Number(process.env.PORT) || 4317;
const HOST = '127.0.0.1';
const PUBLIC = path.resolve(import.meta.dirname, 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };

const orchestrator = new Orchestrator();
const clients = new Set();

function broadcast(type, data) {
  const payload = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) res.write(payload);
}
orchestrator.on('run', (run) => broadcast('run', run));
orchestrator.on('log', (entry) => broadcast('log', entry));

const chats = new ChatManager({
  onTeamTask: ({ repoPath, goal, agents, baseRef }) =>
    orchestrator.create({ repoPath, goal, agents, baseRef, coordinator: agents[0], review: true }),
});
chats.on('chat', (chat) => broadcast('chat', chat));
chats.on('activity', (a) => broadcast('chat-activity', a));
chats.on('removed', (r) => broadcast('chat-removed', r));
onUsageChange(() => broadcast('usage', getUsage()));

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
  }
  return roots;
}

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 1_000_000) throw new Error('Petición demasiado grande.');
  }
  return raw ? JSON.parse(raw) : {};
}

let agentCache = null;
async function agentStatus(refresh = false) {
  if (!agentCache || refresh) {
    const cfg = loadConfig();
    agentCache = await Promise.all(
      Object.values(AGENTS).map(async (a) => ({ ...a, ...cfg.agents[a.id], ...(await checkAgent(a.id)) })),
    );
  }
  return agentCache;
}

const routes = [
  ['GET', /^\/api\/agents$/, async (req, res, _m, url) => send(res, 200, { mock: MOCK, agents: await agentStatus(url.searchParams.has('refresh')) })],
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
  ['POST', /^\/api\/projects$/, async (req, res) => send(res, 201, await Projects.addProject((await readBody(req)).path))],
  [
    'DELETE',
    /^\/api\/projects$/,
    async (req, res) => {
      Projects.removeProject((await readBody(req)).path);
      send(res, 200, { ok: true });
    },
  ],
  ['GET', /^\/api\/fs\/tree$/, async (req, res, m, url) => send(res, 200, await Projects.listTree(url.searchParams.get('root'), allowedRoots()))],
  ['GET', /^\/api\/fs\/file$/, (req, res, m, url) => send(res, 200, Projects.readFile(url.searchParams.get('root'), url.searchParams.get('path'), allowedRoots()))],
  ['PATCH', /^\/api\/chats\/([\w-]+)$/, async (req, res, m) => send(res, 200, chats.update(m[1], await readBody(req)))],
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
  [
    'GET',
    /^\/api\/runs\/([\w-]+)$/,
    (req, res, m) => {
      const run = orchestrator.get(m[1]);
      run ? send(res, 200, run) : send(res, 404, { error: 'No existe esa tarea.' });
    },
  ],
  ['POST', /^\/api\/runs\/([\w-]+)\/approve$/, async (req, res, m) => send(res, 200, orchestrator.approve(m[1], (await readBody(req)).assignments))],
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
  ['POST', /^\/api\/chats\/([\w-]+)\/messages$/, async (req, res, m) => send(res, 201, chats.post(m[1], (await readBody(req)).text))],
  ['POST', /^\/api\/chats\/([\w-]+)\/stop$/, (req, res, m) => send(res, 200, { ok: Boolean(chats.stop(m[1])) })],
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

server.listen(PORT, HOST, () => {
  console.log(`AITeam en http://localhost:${PORT}${MOCK ? '  (modo simulación: no se llama a ninguna IA)' : ''}`);
});
