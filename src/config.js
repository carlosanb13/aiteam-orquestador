import fs from 'node:fs';
import path from 'node:path';

export const DATA_DIR = path.resolve(import.meta.dirname, '..', 'data');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');

export const DEFAULT_CONFIG = {
  // "edits": las IAs solo pueden editar archivos en su copia aislada.
  // "full": además pueden ejecutar cualquier comando (tests, instalaciones...) sin pedir permiso.
  autonomy: 'edits',
  taskTimeoutMinutes: 30,
  maxFixRounds: 1,
  agents: {
    claude: {
      enabled: true,
      model: '',
      profile:
        'Arquitectura de software, refactorizaciones grandes, razonamiento sobre bases de código extensas, código limpio y mantenible, revisión de código minuciosa.',
    },
    codex: {
      enabled: true,
      model: '',
      profile:
        'Implementación rápida y precisa, algoritmos, depuración de errores concretos, scripts, tests unitarios y tareas de backend bien acotadas.',
    },
    gemini: {
      enabled: true,
      model: '',
      profile:
        'Contexto muy largo (leer muchos archivos a la vez), documentación, interfaces y frontend, investigación en la web, generación de imágenes y uso del navegador.',
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
