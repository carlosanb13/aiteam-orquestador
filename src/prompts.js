import fs from 'node:fs';
import path from 'node:path';
import { AGENTS } from './agents.js';
import { loadConfig } from './config.js';
import { CAPABILITY_IDS, agentCapabilities, capabilitiesText, describeRequires } from './capabilities.js';

const agentNames = () => Object.fromEntries(Object.values(AGENTS).map((a) => [a.id, a.name]));

// ---------------------------------------------------------------- Reglas del proyecto (AGENTS.md / CLAUDE.md)

const RULE_FILES = ['AGENTS.md', 'CLAUDE.md'];
// Archivos que el propio CLI ya carga por su cuenta: no se repiten en el prompt.
const NATIVE_RULES = { claude: 'CLAUDE.md', codex: 'AGENTS.md' };

/** Archivos de reglas del proyecto que existen en `dir` (AGENTS.md y/o CLAUDE.md, en ese orden). */
export function findProjectRules(dir) {
  if (!dir) return [];
  return RULE_FILES.map((name) => ({ name, file: path.join(dir, name) })).filter(({ file }) => {
    try {
      return fs.statSync(file).isFile();
    } catch {
      return false; // no existe
    }
  });
}

/**
 * Bloque de contexto con las reglas del proyecto que aplican a `agentId`, o '' si no hay ninguna.
 * Se incluyen todos los archivos presentes salvo el que su CLI ya carga por su cuenta (así Claude
 * recibe AGENTS.md y conserva CLAUDE.md, Codex al revés); si dos archivos son idénticos, va solo uno.
 */
export function projectRules(dir, agentId) {
  const cfg = loadConfig().projectRules ?? {};
  if (cfg.enabled === false) return '';
  const native = NATIVE_RULES[agentId];
  let nativeText = null;
  if (native) {
    try {
      nativeText = fs.readFileSync(path.join(dir, native), 'utf8').trim();
    } catch {
      /* no existe */
    }
  }
  const seen = new Set(nativeText ? [nativeText] : []);
  const parts = [];
  for (const found of findProjectRules(dir)) {
    if (found.name === native) continue;
    let text;
    try {
      text = fs.readFileSync(found.file, 'utf8').trim();
    } catch {
      continue;
    }
    if (!text || seen.has(text)) continue;
    seen.add(text);
    parts.push({ name: found.name, text });
  }
  if (!parts.length) return '';
  let budget = cfg.maxChars ?? 20_000;
  const blocks = parts.map(({ name, text }) => {
    const body = text.length > budget ? `${text.slice(0, Math.max(0, budget))}\n…(recortado)` : text;
    budget = Math.max(0, budget - text.length);
    return `REGLAS DEL PROYECTO (${name}; síguelas mientras no contradigan estas instrucciones):\n${body}`;
  });
  return `\n${blocks.join('\n\n')}\n`;
}

const JSON_RULE = `Termina SIEMPRE tu respuesta con un bloque JSON válido delimitado exactamente así:
<<<JSON
{ ... }
JSON>>>`;

function teamDescription(agentIds) {
  const cfg = loadConfig();
  return agentIds
    .map((id) => `- ${id} (${AGENTS[id].name}, ${AGENTS[id].vendor}): ${cfg.agents[id]?.profile ?? ''}`)
    .join('\n');
}

function boardText(run, forAgent) {
  const msgs = run.board.filter((m) => m.to === 'all' || m.to === forAgent || m.from === forAgent).slice(-25);
  if (!msgs.length) return '(sin mensajes todavía)';
  return msgs.map((m) => `[${m.from} → ${m.to}] ${m.text}`).join('\n');
}

function planText(run) {
  return run.tasks
    .map((t) => `- ${t.id} [${t.status}] "${t.title}" → ${t.assignee ?? 'sin asignar'}${t.dependsOn.length ? ` (depende de ${t.dependsOn.join(', ')})` : ''}`)
    .join('\n');
}

export function planPrompt(run, files) {
  return `[[KIND:plan]]
Eres el coordinador de un equipo de IAs que trabajan EN PARALELO, cada una en su propia copia (rama git) del mismo repositorio. Al final se fusionan todas las ramas.

OBJETIVO DEL USUARIO:
${run.goal}

EQUIPO DISPONIBLE:
${teamDescription(run.agents)}

CAPACIDADES ESPECIALES (además de programar, que hacen todas):
${capabilitiesText(run.agents, agentNames())}

ARCHIVOS DEL REPOSITORIO:
${files || '(repositorio vacío)'}
${projectRules(run.repoPath, run.coordinator)}
Puedes leer archivos del repositorio para entender el contexto, pero NO modifiques nada.

Divide el objetivo en entre 2 y 8 subtareas concretas. Reglas:
- Cada subtarea debe poder hacerse de forma autónoma y, en lo posible, tocar archivos distintos a las demás para evitar conflictos al fusionar.
- Usa "dependsOn" solo cuando una subtarea necesite de verdad el resultado de otra.
- "kind" es una etiqueta corta del tipo de trabajo (arquitectura, backend, frontend, tests, documentación, depuración, investigación...).
- "requires" lista las capacidades especiales imprescindibles para la subtarea (${CAPABILITY_IDS.join(", ")}). Por ejemplo, generar un logo como imagen PNG requiere "images"; dibujar un logo como SVG con código no requiere nada. Si una subtarea mezcla generar una imagen con otras cosas, separa la generación de la imagen en su propia subtarea.
- No asignes responsables: el equipo lo negociará después.
- Escribe los títulos y descripciones en español; las descripciones deben ser lo bastante detalladas para que otra IA las ejecute sin más contexto.

${JSON_RULE}
Formato: {"tasks":[{"id":"t1","title":"...","description":"...","kind":"...","dependsOn":[],"requires":[]}]}`;
}

export function bidPrompt(run, agentId) {
  const tasks = run.tasks
    .map((t) => `- id: ${t.id}\n  título: ${t.title}\n  tipo: ${t.kind}${t.requires?.length ? `\n  requiere: ${describeRequires(t.requires)}` : ''}\n  descripción: ${t.description}`)
    .join('\n');
  return `[[KIND:bid]]
Formas parte de un equipo de IAs que va a repartirse un trabajo. Tú eres "${agentId}" (${AGENTS[agentId].name}).

OBJETIVO: ${run.goal}

EQUIPO (incluyéndote):
${teamDescription(run.agents)}

SUBTAREAS:
${tasks}

Puntúa de 0 a 10 lo adecuado que eres TÚ para cada subtarea, comparándote honestamente con el resto del equipo. Un 10 significa "soy claramente el mejor del equipo para esto"; un 0, "otro lo haría mucho mejor". No inflar las notas: el reparto se hace con ellas y también se reparte la carga para trabajar en paralelo.
Tus capacidades especiales: ${agentCapabilities(agentId).length ? describeRequires(agentCapabilities(agentId)) : 'ninguna (solo programar, leer y escribir archivos)'}. Si una subtarea requiere una capacidad que no tienes, ponle 0.
Puntúa también lo adecuado que eres para REVISAR código de otros en este proyecto.
No modifiques ningún archivo.

${JSON_RULE}
Formato: {"bids":[{"taskId":"t1","score":7,"reason":"motivo breve"}],"review":{"score":6,"reason":"motivo breve"}}`;
}

export function taskPrompt(run, task, agentId) {
  const deps = task.dependsOn
    .map((id) => run.tasks.find((t) => t.id === id))
    .filter(Boolean)
    .map((t) => `- ${t.id} (${t.assignee}): ${t.summary ?? 'sin resumen'}`)
    .join('\n');
  return `[[KIND:task]]
Eres "${agentId}" (${AGENTS[agentId].name}) dentro de un equipo de IAs que trabaja en paralelo sobre el mismo proyecto. Estás en TU copia aislada del repositorio (directorio actual); tus cambios se revisarán y se fusionarán con los del resto al final.

OBJETIVO GENERAL: ${run.goal}

PLAN DEL EQUIPO:
${planText(run)}

TABLERO DE MENSAJES DEL EQUIPO:
${boardText(run, agentId)}
${deps ? `\nTRABAJO PREVIO DEL QUE DEPENDES (ya está fusionado en tu copia):\n${deps}\n` : ''}${projectRules(run.worktrees?.[agentId]?.path ?? run.repoPath, agentId)}
TU SUBTAREA AHORA: ${task.id} — ${task.title}
${task.description}

Instrucciones:
- Haz la subtarea completa editando los archivos necesarios en el directorio actual.
- Céntrate en tu subtarea; no hagas el trabajo asignado a otros salvo lo imprescindible para que el tuyo funcione.
- No hagas commits: el aiteamdor los hace por ti.
- Si algo afecta a otro miembro del equipo (una interfaz, un nombre de función, un archivo compartido), avísale en "messages".

${JSON_RULE}
Formato: {"summary":"qué hiciste y qué archivos tocaste","messages":[{"to":"all|claude|codex|gemini","text":"..."}]}`;
}

export function reviewPrompt(run, authorId, reviewerId, diff) {
  const done = run.tasks.filter((t) => t.assignee === authorId).map((t) => `- ${t.title}: ${t.summary ?? ''}`).join('\n');
  return `[[KIND:review]]
Eres "${reviewerId}" (${AGENTS[reviewerId].name}) y debes revisar el trabajo que "${authorId}" ha hecho para el equipo.

OBJETIVO GENERAL: ${run.goal}

SUBTAREAS DE ${authorId}:
${done}

TABLERO DE MENSAJES:
${boardText(run, reviewerId)}

CAMBIOS (${diff.stat ? 'resumen' : 'sin cambios'}):
${diff.stat}

DIFF:
${diff.diff}

Revisa errores, bugs, casos límite, incoherencias con el resto del plan y problemas de seguridad. No modifiques archivos.
Aprueba ("approved": true) si no hay problemas de severidad "alta" o "media". Sé concreto: archivo y qué cambiar.

${JSON_RULE}
Formato: {"approved":true,"summary":"valoración breve","issues":[{"severity":"alta|media|baja","file":"ruta","description":"qué está mal y cómo arreglarlo"}]}`;
}

export function fixPrompt(run, agentId, review) {
  const issues = review.issues.map((i) => `- [${i.severity}] ${i.file ?? ''}: ${i.description}`).join('\n');
  return `[[KIND:fix]]
Eres "${agentId}" (${AGENTS[agentId].name}). "${review.reviewer}" ha revisado tu trabajo para el objetivo "${run.goal}" y ha encontrado estos problemas:
${issues}

Valoración: ${review.summary ?? ''}

Corrige los problemas en los archivos del directorio actual (tu copia aislada). Si crees que alguno no es correcto, no lo cambies y explícalo. No hagas commits.

${JSON_RULE}
Formato: {"summary":"qué corregiste","messages":[{"to":"${review.reviewer}","text":"..."}]}`;
}

export function conflictPrompt(run, files) {
  return `[[KIND:conflict]]
Estás integrando el trabajo de varias IAs para el objetivo "${run.goal}". Al fusionar sus ramas han aparecido conflictos en:
${files.map((f) => `- ${f}`).join('\n')}

PLAN DEL EQUIPO:
${planText(run)}

Abre cada archivo, resuelve los marcadores de conflicto (<<<<<<<, =======, >>>>>>>) conservando la intención de ambos lados y deja el código coherente. No hagas commits.

${JSON_RULE}
Formato: {"summary":"cómo resolviste cada conflicto"}`;
}

export function testFixPrompt(run, command, output) {
  return `[[KIND:testfix]]
El equipo ha integrado su trabajo para el objetivo "${run.goal}", pero el comando de verificación falla.

COMANDO: ${command}
SALIDA (final):
${output.slice(-12_000)}

Corrige el código del directorio actual para que el comando pase. No hagas commits.

${JSON_RULE}
Formato: {"summary":"qué corregiste"}`;
}

export function adversarialPrompt(run, attacker, diff) {
  return `[[KIND:attack]]
Eres "${attacker}" (${AGENTS[attacker].name}) y actúas como EQUIPO ROJO: tu trabajo es intentar ROMPER lo que el equipo acaba de construir, antes de que llegue al usuario.

OBJETIVO QUE SE IMPLEMENTÓ: ${run.goal}

CAMBIOS INTEGRADOS (resumen):
${diff.stat}

DIFF:
${diff.diff}

El directorio actual contiene el resultado integrado. Léelo con espíritu adversarial y busca:
- Vulnerabilidades de seguridad (inyecciones, rutas sin validar, secretos expuestos, permisos excesivos, deserialización insegura...).
- Entradas que lo rompan: vacías, enormes, Unicode raro, tipos inesperados, concurrencia, errores de red o de disco.
- Errores de lógica, condiciones de carrera y casos límite que nadie ha probado.
- Incoherencias entre las partes que hicieron distintas IAs.
No modifiques archivos. Para cada hallazgo indica cómo reproducirlo. No inventes problemas: si algo está bien, no lo reportes.

${JSON_RULE}
Formato: {"summary":"valoración general","findings":[{"severity":"alta|media|baja","file":"ruta","title":"resumen corto","description":"qué falla y por qué","reproduce":"cómo provocarlo","fix":"cómo arreglarlo"}]}`;
}

export function adversarialFixPrompt(run, attacker, findings) {
  const list = findings
    .map((f) => `- [${f.severity}] ${f.file}: ${f.title}\n  ${f.description}\n  Cómo provocarlo: ${f.reproduce}\n  Sugerencia: ${f.fix}`)
    .join('\n');
  return `[[KIND:fix]]
"${attacker}" ha atacado el resultado del equipo para el objetivo "${run.goal}" y ha encontrado estos problemas:
${list}

Corrige los problemas reales en los archivos del directorio actual. Si alguno no es un problema real, no lo cambies y explícalo. Si es razonable, añade tests que cubran los casos encontrados. No hagas commits.

${JSON_RULE}
Formato: {"summary":"qué corregiste y qué descartaste"}`;
}

/** Extrae el último bloque JSON de la respuesta de una IA. */
export function extractJson(text) {
  if (!text) return null;
  const candidates = [];
  for (const m of text.matchAll(/<<<JSON\s*([\s\S]*?)\s*JSON>>>/g)) candidates.push(m[1]);
  for (const m of text.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)) candidates.push(m[1]);
  for (const c of candidates.reverse()) {
    try {
      return JSON.parse(c);
    } catch {
      /* siguiente */
    }
  }
  // Último recurso: el último objeto {...} equilibrado del texto.
  for (let start = text.lastIndexOf('{'); start >= 0; start = start > 0 ? text.lastIndexOf('{', start - 1) : -1) {
    const end = matchingBrace(text, start);
    if (end < 0) continue;
    try {
      const value = JSON.parse(text.slice(start, end + 1));
      if (value && typeof value === 'object') return value;
    } catch {
      /* seguir buscando */
    }
  }
  return null;
}

function matchingBrace(text, start) {
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (ch === '\\') i++;
      else if (ch === '"') inString = false;
    } else if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return i;
  }
  return -1;
}
