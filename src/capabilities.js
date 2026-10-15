// Capacidades especiales de cada IA (además de programar), para no dar trabajo a quien no puede hacerlo.
import { loadConfig } from './config.js';

export const CAPABILITIES = {
  images: { label: 'Generar imágenes', short: 'imágenes', hint: 'crear imágenes rasterizadas (PNG/JPG) con un generador de imágenes' },
  browser: { label: 'Usar el navegador', short: 'navegador', hint: 'abrir páginas web, hacer clic, capturas de pantalla de sitios' },
};

export const CAPABILITY_IDS = Object.keys(CAPABILITIES);

export function agentCapabilities(agentId) {
  const caps = loadConfig().agents?.[agentId]?.capabilities;
  return Array.isArray(caps) ? caps.filter((c) => CAPABILITIES[c]) : [];
}

export function canDo(agentId, requires = []) {
  const caps = agentCapabilities(agentId);
  return requires.every((r) => caps.includes(r));
}

export const missingFor = (agentId, requires = []) => requires.filter((r) => !agentCapabilities(agentId).includes(r));

export const describeRequires = (requires = []) => requires.map((r) => CAPABILITIES[r]?.short ?? r).join(', ');

/** Requisitos deducidos del texto de una petición (cuando nadie los declaró). */
export function detectRequires(text) {
  const t = String(text ?? '').toLowerCase();
  const out = [];
  if (
    /generador de im[aá]genes|generar? (una |la |el |las |los )?(imagen|im[aá]genes|ilustraci|foto|png|jpe?g)|(crea|haz|dibuja|genera)\w* (una |la |el )?(imagen|ilustraci[oó]n|foto)|text[- ]to[- ]image|\.(png|jpe?g|webp) (generad|nuev)/.test(t)
  ) {
    out.push('images');
  }
  if (/(abre|abrir|navega|navegar|visita|visitar) (la |el |una |un )?(web|p[aá]gina|sitio|url)|captura de pantalla de (la|una|el) (web|p[aá]gina|sitio)|usa(r)? el navegador/.test(t)) {
    out.push('browser');
  }
  return out;
}

/** Texto para las instrucciones de las IAs: qué capacidades existen y quién las tiene. */
export function capabilitiesText(agentIds, names) {
  return CAPABILITY_IDS.map((c) => {
    const who = agentIds.filter((a) => agentCapabilities(a).includes(c)).map((a) => names[a] ?? a);
    return `- ${c}: ${CAPABILITIES[c].hint}. Pueden: ${who.length ? who.join(', ') : 'ninguna IA del equipo'}.`;
  }).join('\n');
}
