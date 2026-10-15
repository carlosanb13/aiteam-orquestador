import fs from 'node:fs';
import path from 'node:path';

export const DATA_DIR = process.env.AITEAM_DATA_DIR ? path.resolve(process.env.AITEAM_DATA_DIR) : path.resolve(import.meta.dirname, '..', 'data');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');

export const DEFAULT_CONFIG = {
  // "edits": las IAs solo pueden editar archivos en su copia aislada.
  // "full": además pueden ejecutar cualquier comando (tests, instalaciones...) sin pedir permiso.
  autonomy: 'edits',
  taskTimeoutMinutes: 30,
  bus: { askTimeoutMs: 300_000, gateTimeoutMs: 300_000 },
  maxFixRounds: 1,
  // Dictado: "browser" usa el reconocimiento del navegador; "local" usa Whisper en este PC, sin internet.
  speech: { engine: 'browser', model: 'base', language: 'es' },
  notifications: { enabled: true, sound: true },
  // Compactación del historial de las conversaciones (ver compaction.js): cuando lo que se envía a una IA
  // supera `thresholdChars`, los mensajes antiguos se resumen con una IA y se conservan los `keepRecent` últimos.
  // `agent` y `model` eligen quién resume (vacío: la primera IA disponible de la conversación, con su modelo).
  compaction: { enabled: true, thresholdChars: 60_000, keepRecent: 12, agent: '', model: '', timeoutMinutes: 5 },
  // Reglas del proyecto (AGENTS.md o CLAUDE.md) que se añaden al contexto de las IAs; se recortan a este tamaño.
  projectRules: { enabled: true, maxChars: 20_000 },
  customAgents: {},
  agents: {
    claude: {
      enabled: true,
      model: '',
      profile:
        'Arquitectura de software, refactorizaciones grandes, razonamiento sobre bases de código extensas, código limpio y mantenible, revisión de código minuciosa. No genera imágenes.',
      // Capacidades especiales además de programar: "images" (generar imágenes) y "browser" (usar el navegador).
      capabilities: [],
    },
    codex: {
      enabled: true,
      model: '',
      profile:
        'Implementación rápida y precisa, algoritmos, depuración de errores concretos, scripts, tests unitarios y tareas de backend bien acotadas. Puede generar imágenes.',
      capabilities: ['images'],
    },
    gemini: {
      enabled: true,
      model: '',
      profile:
        'Contexto muy largo (leer muchos archivos a la vez), documentación, interfaces y frontend, investigación en la web, generación de imágenes y uso del navegador.',
      capabilities: ['images', 'browser'],
    },
  },
};

function merge(base, override) {
  if (typeof base !== 'object' || base === null || Array.isArray(base)) return override ?? base;
  const out = { ...base };
  for (const [k, v] of Object.entries(override ?? {})) out[k] = merge(base[k], v);
  return out;
}

export function loadConfig() {
  try {
    return merge(DEFAULT_CONFIG, JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')));
  } catch {
    return structuredClone(DEFAULT_CONFIG);
  }
}

export function saveConfig(partial) {
  const next = merge(loadConfig(), partial);
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(next, null, 2));
  return next;
}
