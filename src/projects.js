import fs from 'node:fs';
import path from 'node:path';
import * as G from './git.js';
import { DATA_DIR } from './config.js';

const PROJECTS_FILE = path.join(DATA_DIR, 'projects.json');
const MAX_FILE_BYTES = 512 * 1024;

const norm = (p) => path.resolve(p).toLowerCase();

function load() {
  try {
    return JSON.parse(fs.readFileSync(PROJECTS_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function save(list) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(PROJECTS_FILE, JSON.stringify(list, null, 2));
}

/** Proyectos guardados más los que aparecen en conversaciones y tareas. */
export function listProjects(extraPaths = []) {
  const saved = load();
  const seen = new Set(saved.map((p) => norm(p.path)));
  for (const p of extraPaths) {
    if (p && !seen.has(norm(p))) {
      saved.push({ path: p, name: path.basename(p), addedAt: null });
      seen.add(norm(p));
    }
  }
  return saved.map((p) => ({ ...p, exists: fs.existsSync(p.path) }));
}

export async function addProject(rawPath) {
  const info = await G.inspectRepo(String(rawPath ?? '').trim());
  const list = load();
  if (!list.some((p) => norm(p.path) === norm(info.root))) {
    list.push({ path: info.root, name: path.basename(info.root), addedAt: new Date().toISOString() });
    save(list);
  }
  return { path: info.root, name: path.basename(info.root) };
}

export function removeProject(p) {
  save(load().filter((x) => norm(x.path) !== norm(p)));
}

/** Solo se puede explorar dentro de carpetas que AITeam conoce (proyectos y sus copias de trabajo). */
function assertAllowed(root, allowedRoots) {
  if (!allowedRoots.some((r) => norm(r) === norm(root))) throw new Error('Carpeta no permitida.');
}

/** Archivos del árbol (respeta .gitignore): versionados y nuevos sin ignorar. */
export async function listTree(root, allowedRoots) {
  assertAllowed(root, allowedRoots);
  const res = await G.git(root, ['ls-files', '--cached', '--others', '--exclude-standard'], { allowFail: true });
  const files = [...new Set(res.stdout.split('\n').map((s) => s.trim()).filter(Boolean))].filter((f) => fs.existsSync(path.join(root, f)));
  files.sort((a, b) => a.localeCompare(b));
  const status = await G.git(root, ['status', '--porcelain'], { allowFail: true });
  const changed = {};
  for (const line of status.stdout.split('\n')) {
    if (line.length > 3) changed[line.slice(3).trim().replace(/^"|"$/g, '')] = line.slice(0, 2).trim();
  }
  return { root, files: files.slice(0, 5000), truncated: files.length > 5000, changed };
}

export function readFile(root, rel, allowedRoots) {
  assertAllowed(root, allowedRoots);
  const full = path.resolve(root, rel);
  if (!norm(full).startsWith(norm(root) + path.sep.toLowerCase()) && norm(full) !== norm(root)) throw new Error('Ruta no permitida.');
  const stat = fs.statSync(full);
  if (!stat.isFile()) throw new Error('No es un archivo.');
  const buf = fs.readFileSync(full, { length: MAX_FILE_BYTES });
  const slice = buf.subarray(0, MAX_FILE_BYTES);
  const binary = slice.includes(0);
  return {
    path: rel,
    size: stat.size,
    binary,
    truncated: stat.size > MAX_FILE_BYTES,
    content: binary ? '' : slice.toString('utf8'),
  };
}
