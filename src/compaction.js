import { AGENTS, invokeAgent } from './agents.js';
import { loadConfig } from './config.js';

/**
 * Compactación del historial de una conversación (al estilo de OpenCode).
 *
 * Cuando el historial que se va a enviar a una IA supera el umbral de config.compaction, los mensajes
 * antiguos se resumen con una IA y el resumen se guarda en `chat.compaction`:
 *   { summary, upto, count, at, by }
 * `upto` es el id del último mensaje resumido; a partir de él se envían los mensajes tal cual.
 * Los resúmenes se encadenan: cada compactación resume el resumen anterior más los mensajes nuevos.
 */

const MAX_RECENT = 40; // tope de mensajes recientes que se envían sin resumir (como hacía chat.js)
const MAX_MSG_CHARS = 4000; // cada mensaje se recorta a esto al pedir el resumen
const MAX_SUMMARY_INPUT = 200_000;

export function compactionConfig() {
  const c = loadConfig().compaction ?? {};
  return {
    enabled: c.enabled !== false,
    thresholdChars: Math.max(2000, Number(c.thresholdChars) || 60_000),
    keepRecent: Math.max(2, Number(c.keepRecent) || 12),
    agent: String(c.agent ?? '').trim(),
    model: String(c.model ?? '').trim(),
    timeoutMs: Math.max(1, Number(c.timeoutMinutes) || 5) * 60_000,
  };
}

/** ¿Este texto de historial supera el umbral de compactación? */
export const overThreshold = (text) => String(text ?? '').length > compactionConfig().thresholdChars;

const conversational = (msgs) => msgs.filter((m) => m.kind === 'message');

/** Mensajes posteriores al último resumen. */
function sinceSummary(chat, msgs) {
  const upto = chat.compaction?.upto;
  if (!upto) return msgs;
  const i = msgs.findIndex((m) => m.id === upto);
  if (i >= 0) return msgs.slice(i + 1);
  // El mensaje de corte puede no estar en `msgs` (p. ej. es la petición en curso): se usa la fecha.
  const at = chat.compaction.uptoTs;
  return at ? msgs.filter((m) => m.ts > at) : msgs;
}

function summaryBlock(chat) {
  const s = chat.compaction?.summary;
  return s ? `RESUMEN DE LA CONVERSACIÓN ANTERIOR (compactada; ${chat.compaction.count ?? 0} mensajes resumidos):\n${s}\n\n` : '';
}

function compactPrompt(chat, previous, text) {
  return `[[KIND:compact]]
Resume la siguiente conversación entre un usuario y un equipo de IAs que trabajan sobre un proyecto de software. El resumen sustituirá a estos mensajes en el contexto de las IAs, así que debe permitir continuar el trabajo sin ellos.

Incluye, de forma concisa y en español:
- Qué ha pedido el usuario y qué objetivos siguen abiertos.
- Qué se ha hecho ya: archivos creados o modificados, decisiones de diseño y su motivo.
- Problemas encontrados, cómo se resolvieron y lo que queda pendiente.
- Preferencias o restricciones que haya expresado el usuario.
No inventes nada, no añadas saludos ni conclusiones y no modifiques ningún archivo. Responde solo con el resumen.
${previous ? `\nRESUMEN PREVIO (intégralo en el nuevo):\n${previous}\n` : ''}
MENSAJES A RESUMIR:
${text}`;
}

function summarizers(chat, available) {
  const cfg = compactionConfig();
  const pool = (available?.length ? available : chat.agents).filter((a) => AGENTS[a]);
  const preferred = cfg.agent && AGENTS[cfg.agent] ? [cfg.agent] : [];
  return [...new Set([...preferred.filter((a) => pool.includes(a)), ...pool])];
}

/**
 * Resume los mensajes antiguos de `msgs` (todos menos los `keepRecent` últimos de conversación).
 * Devuelve true si se generó un resumen nuevo.
 */
export async function compact(manager, chat, msgs, { render, available, onEvent, force = false } = {}) {
  const cfg = compactionConfig();
  if (!cfg.enabled && !force) return false;
  const pending = conversational(sinceSummary(chat, msgs));
  const old = pending.slice(0, Math.max(0, pending.length - cfg.keepRecent));
  if (!old.length) return false;

  let text = render(old.map((m) => (m.text?.length > MAX_MSG_CHARS ? { ...m, text: `${m.text.slice(0, MAX_MSG_CHARS)}…` } : m)));
  if (text.length > MAX_SUMMARY_INPUT) text = `…${text.slice(-MAX_SUMMARY_INPUT)}`;
  const prompt = compactPrompt(chat, chat.compaction?.summary, text);

  onEvent?.(`🗜 Compactando ${old.length} mensajes antiguos…`);
  for (const agent of summarizers(chat, available)) {
    const res = await invokeAgent(agent, {
      prompt,
      cwd: chat.worktree.path,
      mode: 'read',
      model: cfg.model || undefined,
      timeoutMs: cfg.timeoutMs,
    }).catch((err) => ({ ok: false, error: err.message }));
    const summary = res.ok ? String(res.text ?? '').trim() : '';
    if (!summary) {
      onEvent?.(`⚠ ${AGENTS[agent]?.name ?? agent} no pudo resumir: ${String(res.error ?? 'respuesta vacía').slice(0, 160)}`);
      continue;
    }
    const last = old.at(-1);
    chat.compaction = {
      summary,
      upto: last.id,
      uptoTs: last.ts,
      count: (chat.compaction?.count ?? 0) + old.length,
      at: new Date().toISOString(),
      by: agent,
      chars: text.length,
    };
    // Las sesiones reanudables conservan el historial antiguo: se descartan para que cada IA empiece
    // una sesión nueva con el resumen en lugar de acumularlo encima de lo que ya tenía.
    chat.sessions = {};
    manager.addMessage(chat, {
      from: 'system',
      kind: 'notice',
      text: `Historial compactado: ${AGENTS[agent]?.name ?? agent} ha resumido ${old.length} mensajes antiguos para aligerar el contexto de las IAs.`,
      meta: { compaction: { count: chat.compaction.count, by: agent } },
    });
    return true;
  }
  return false;
}

/**
 * Historial que se envía a una IA: resumen (si lo hay) + mensajes posteriores.
 * Con `allowCompact`, si supera el umbral se compacta antes de devolverlo.
 */
export async function history(manager, chat, msgs, { render, available, onEvent, allowCompact = true } = {}) {
  const build = () => summaryBlock(chat) + render(conversational(sinceSummary(chat, msgs)).slice(-MAX_RECENT));
  let text = build();
  if (allowCompact && overThreshold(text) && (await compact(manager, chat, msgs, { render, available, onEvent }))) text = build();
  return text;
}
