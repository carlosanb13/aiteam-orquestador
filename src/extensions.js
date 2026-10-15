import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DATA_DIR } from './config.js';

const FILE = path.join(DATA_DIR, 'extensions.json');
const RUNTIME = path.join(DATA_DIR, 'mcp-runtime');
const KEY = /^[a-z][a-z0-9_]{1,31}$/;
const TARGETS = new Set(['claude', 'codex']);
const projectKey = (project) => path.resolve(project).toLowerCase();

function read() {
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); }
  catch { return {}; }
}

function write(all) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(all, null, 2));
}

export function listExtensions(project) {
  return read()[projectKey(project)] ?? [];
}

export function saveExtension(project, input) {
  const id = String(input.id ?? '').trim().toLowerCase();
  if (!KEY.test(id)) throw new Error('El identificador debe tener 2–32 letras, números o guion bajo.');
  let url;
  try { url = new URL(String(input.url ?? '')); } catch { throw new Error('URL MCP inválida.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || !/^https:\/\/[a-zA-Z0-9._~:/-]+$/.test(url.toString())) {
    throw new Error('Usa una URL HTTPS sin credenciales, parámetros ni caracteres especiales.');
  }
  const agents = [...new Set((Array.isArray(input.agents) ? input.agents : []).filter((a) => TARGETS.has(a)))];
  if (!agents.length) throw new Error('Elige Claude, Codex o ambos.');
  const record = { id, name: String(input.name ?? id).trim().slice(0, 60), url: url.toString(), agents, enabled: input.enabled !== false };
  const all = read();
  const key = projectKey(project);
  const items = all[key] ?? [];
  const index = items.findIndex((item) => item.id === id);
  if (index >= 0) items[index] = record;
  else items.push(record);
  all[key] = items;
  write(all);
  return record;
}

export function setExtensionEnabled(project, id, enabled) {
  const all = read();
  const key = projectKey(project);
  const item = all[key]?.find((entry) => entry.id === id);
  if (!item) throw new Error('Extensión desconocida.');
  item.enabled = Boolean(enabled);
  write(all);
  return item;
}

export function removeExtension(project, id) {
  const all = read();
  const key = projectKey(project);
  all[key] = (all[key] ?? []).filter((item) => item.id !== id);
  write(all);
  return { ok: true };
}

/** Only enabled remote MCP servers for this project are passed to compatible CLIs. */
export function mcpArgs(agentId, project) {
  if (!project || !TARGETS.has(agentId)) return [];
  const entries = listExtensions(project).filter((item) => item.enabled && item.agents.includes(agentId));
  if (!entries.length) return [];
  if (agentId === 'codex') return entries.flatMap((item) => ['-c', `mcp_servers.${item.id}.url=${JSON.stringify(item.url)}`]);
  const config = { mcpServers: Object.fromEntries(entries.map((item) => [item.id, { type: 'http', url: item.url }])) };
  fs.mkdirSync(RUNTIME, { recursive: true });
  const file = path.join(RUNTIME, `${crypto.createHash('sha256').update(projectKey(project)).digest('hex').slice(0, 16)}.json`);
  fs.writeFileSync(file, JSON.stringify(config));
  return ['--mcp-config', file];
}
