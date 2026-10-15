import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DATA_DIR } from './config.js';

const USAGE_FILE = path.join(DATA_DIR, 'usage.json');

function load() {
  try {
    return JSON.parse(fs.readFileSync(USAGE_FILE, 'utf8'));
  } catch {
    return { claude: null, calls: {} };
  }
}

function save(data) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(USAGE_FILE, JSON.stringify(data, null, 2));
}

const listeners = new Set();
export function onUsageChange(fn) {
  listeners.add(fn);
}
export function touchUsage() {
  changed();
}
function changed() {
  for (const fn of listeners) fn();
}

/** Ventana de uso normalizada: porcentaje 0-100 y fecha de reinicio. Si ya pasó el reinicio, vuelve a 0. */
function windowOf(percent, resetsAtSec) {
  if (percent == null) return null;
  const resetsAt = resetsAtSec ? new Date(resetsAtSec * 1000).toISOString() : null;
  const expired = resetsAt && new Date(resetsAt) < new Date();
  return { percent: expired ? 0 : Math.round(percent), resetsAt: expired ? null : resetsAt, stale: Boolean(expired) };
}

/** Claude Code emite un evento rate_limit_event en cada respuesta; se guarda el último. */
export function recordClaudeRateLimit(info) {
  const w = info?.unifiedWindows;
  if (!w) return;
  const data = load();
  data.claude = {
    updatedAt: new Date().toISOString(),
    session: w.five_hour ? { utilization: w.five_hour.utilization, resetsAt: w.five_hour.resetsAt } : null,
    weekly: w.seven_day ? { utilization: w.seven_day.utilization, resetsAt: w.seven_day.resetsAt } : null,
    status: info.status,
  };
  save(data);
  changed();
}

/** Cuenta las peticiones que AITeam hace a cada IA por día (lo único disponible para Gemini). */
export function recordCall(agentId) {
  const data = load();
  const day = new Date().toISOString().slice(0, 10);
  data.calls ??= {};
  if (data.calls.day !== day) data.calls = { day };
  data.calls[agentId] = (data.calls[agentId] ?? 0) + 1;
  save(data);
}

/** Codex guarda en sus registros de sesión el último estado de límites (ventana de 5 h y semanal). */
function codexSnapshot() {
  const root = path.join(os.homedir(), '.codex', 'sessions');
  if (!fs.existsSync(root)) return null;
  const files = [];
  const walk = (dir, depth) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory() && depth < 4) walk(p, depth + 1);
      else if (e.name.endsWith('.jsonl')) files.push({ p, t: fs.statSync(p).mtimeMs });
    }
  };
  // Solo los meses más recientes, para no recorrer todo el historial.
  const years = fs.readdirSync(root).sort().reverse().slice(0, 1);
  for (const y of years) {
    const months = fs.readdirSync(path.join(root, y)).sort().reverse().slice(0, 2);
    for (const m of months) walk(path.join(root, y, m), 2);
  }
  files.sort((a, b) => b.t - a.t);
  for (const { p } of files.slice(0, 20)) {
    const lines = fs.readFileSync(p, 'utf8').split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      if (!lines[i].includes('"rate_limits"')) continue;
      try {
        const j = JSON.parse(lines[i]);
        const rl = j.payload?.rate_limits ?? j.rate_limits;
        if (rl?.primary || rl?.secondary) return { rl, at: j.timestamp };
      } catch {
        /* línea incompleta */
      }
    }
  }
  return null;
}

export function getUsage() {
  const data = load();
  const calls = data.calls?.day === new Date().toISOString().slice(0, 10) ? data.calls : {};
  const out = {};

  const c = data.claude;
  out.claude = c
    ? {
        session: windowOf(c.session?.utilization * 100, c.session?.resetsAt),
        weekly: windowOf(c.weekly?.utilization * 100, c.weekly?.resetsAt),
        updatedAt: c.updatedAt,
        callsToday: calls.claude ?? 0,
      }
    : { session: null, weekly: null, updatedAt: null, callsToday: calls.claude ?? 0 };

  let codex = null;
  try {
    codex = codexSnapshot();
  } catch {
    codex = null;
  }
  const pick = (minutes) => [codex?.rl.primary, codex?.rl.secondary].find((w) => w?.window_minutes === minutes);
  const five = pick(300) ?? codex?.rl.primary;
  const week = pick(10080) ?? codex?.rl.secondary;
  out.codex = {
    session: five ? windowOf(five.used_percent, five.resets_at) : null,
    weekly: week ? windowOf(week.used_percent, week.resets_at) : null,
    updatedAt: codex?.at ?? null,
    plan: codex?.rl.plan_type ?? null,
    callsToday: calls.codex ?? 0,
  };

  out.gemini = { session: null, weekly: null, updatedAt: null, callsToday: calls.gemini ?? 0, note: 'Gemini CLI no informa de su cuota.' };
  return out;
}
