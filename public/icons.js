// Iconos de línea de AITeam y emblemas vectoriales del catálogo de agentes (estilo Orca + Claude).

const svg = (body, size = 16, extra = '') =>
  `<svg class="i" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"${extra}>${body}</svg>`;

const PATHS = {
  chat: '<path d="M4 5h16v11H9l-5 4z"/>',
  chatPlus: '<path d="M4 5h16v11H9l-5 4z"/><path d="M12 8v5M9.5 10.5h5"/>',
  bolt: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
  boltPlus: '<path d="M11 3 4 13h6l-1 7"/><path d="M17 13v6M14 16h6"/>',
  folder: '<path d="M3 6.5A1.5 1.5 0 0 1 4.5 5H9l2 2h8.5A1.5 1.5 0 0 1 21 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor"/>',
  refresh: '<path d="M20 11a8 8 0 0 0-14.3-4.9L4 8M4 4v4h4M4 13a8 8 0 0 0 14.3 4.9L20 16M20 20v-4h-4"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>',
  fileDiff: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M12 11v4M10 13h4M10 18h4"/>',
  check: '<path d="m5 12 5 5 9-10"/>',
  alert: '<path d="M12 3 2 20h20z"/><path d="M12 10v4M12 17h.01"/>',
  tool: '<path d="M14.7 6.3a4 4 0 0 0 5 5L21 13l-8 8-3-3 8-8M9.5 14.5 3 21"/><path d="M14.7 6.3 17 4"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
  play: '<path d="M7 4v16l13-8z"/>',
  pause: '<rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>',
  xCircle: '<circle cx="12" cy="12" r="9"/><path d="m9 9 6 6M15 9l-6 6"/>',
  checkCircle: '<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
  merge: '<circle cx="6" cy="5" r="2"/><circle cx="6" cy="19" r="2"/><circle cx="18" cy="12" r="2"/><path d="M6 7v10M6 9c0 3 4 3 10 3"/>',
  broom: '<path d="M14 4 8 14M6 14h6l1 7H5z"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
  relay: '<path d="M4 8h12l-3-3M20 16H8l3 3"/>',
  chevRight: '<path d="m9 6 6 6-6 6"/>',
  chevDown: '<path d="m6 9 6 6 6-6"/>',
  power: '<path d="M12 3v9M6.3 6.3a8 8 0 1 0 11.4 0"/>',
  palette: '<path d="M12 3a9 9 0 0 0 0 18c1.1 0 1.5-.8 1.5-1.5 0-.9-.6-1.2-.6-2 0-.9.7-1.5 1.6-1.5H17a4 4 0 0 0 4-4c0-5-4-9-9-9z"/><circle cx="7.5" cy="11" r="1"/><circle cx="10" cy="7" r="1"/><circle cx="15" cy="7.5" r="1"/>',
  diff: '<path d="M8 3v12M5 12l3 3 3-3M16 21V9M13 12l3-3 3 3"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  terminal: '<polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 2.5-3 4"/><path d="M12 17h.01"/>',
  send: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  sidebar: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/>',
  external: '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>',
  star: '<polygon points="12 2 15.1 8.3 22 9.3 17 14.1 18.2 21 12 17.8 5.8 21 7 14.1 2 9.3 8.9 8.3 12 2"/>',
  copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9.5" r="1.5"/><path d="m21 15-5-5L5 20"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18"/>',
  cpu: '<rect x="5" y="5" width="14" height="14" rx="2"/><rect x="9" y="9" width="6" height="6" rx="1"/><path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3"/>',
  brain: '<path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z"/><path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z"/>',
  command: '<path d="M18 3a3 3 0 0 0-3 3v12a3 3 0 0 0 3 3 3 3 0 0 0 3-3 3 3 0 0 0-3-3H6a3 3 0 0 0-3 3 3 3 0 0 0 3 3 3 3 0 0 0 3-3V6a3 3 0 0 0-3-3 3 3 0 0 0-3 3 3 3 0 0 0 3 3h12a3 3 0 0 0 3-3 3 3 0 0 0-3-3z"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  dot: '<circle cx="12" cy="12" r="4" fill="currentColor" stroke="none"/>',
};

export function icon(name, size = 16, extra = '') {
  return svg(PATHS[name] ?? PATHS.dot, size, extra);
}

// Marcas nativas con máscara CSS + logos vectoriales monocromáticos (blanco y negro) para todo el catálogo de 45 agentes.
const BRAND_MARKS = { claude: 'claude', claude_teams: 'claude', codex: 'openai', gemini: 'antigravity' };

const AGENT_SVGS = {
  openclaude: '<rect x="3.5" y="4.5" width="17" height="15" rx="3"/><path d="M7.5 10l3 2.5-3 2.5M12.5 15h4"/>',
  grok: '<path d="M5 18.5 19 5.5M6.5 5.5h11v11"/><path d="M5.5 13.5 13.5 5.5"/>',
  copilot: '<path d="M5.5 10.5a6.5 6.5 0 0 1 13 0v4a4 4 0 0 1-4 4h-5a4 4 0 0 1-4-4z"/><rect x="7.5" y="10.5" width="3.5" height="2.8" rx="1"/><rect x="13" y="10.5" width="3.5" height="2.8" rx="1"/><path d="M8.5 6.5 10 4h4l1.5 2.5"/>',
  opencode: '<rect x="5.5" y="4" width="13" height="16" rx="2" stroke-width="2"/><rect x="8.5" y="7.5" width="7" height="9" rx="1"/>',
  opencode2: '<rect x="4.5" y="4" width="15" height="16" rx="2.5" stroke-width="2"/><path d="M8.5 8h7v8h-7z"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/>',
  mimo: '<rect x="3.5" y="3.5" width="17" height="17" rx="4"/><path d="M6.5 15.5V8.5l3 4 3-4v7M16 9.5v6"/><circle cx="16" cy="7.2" r="0.9" fill="currentColor"/>',
  ante: '<polygon points="12 4 20 18.5 4 18.5"/><path d="M8.5 14h7M12 4v14.5"/>',
  trae: '<rect x="3.5" y="4.5" width="17" height="15" rx="3"/><path d="M7.5 9.5h4M9.5 9.5v5.5M13.5 12l2.5 3M16 12l-2.5 3"/>',
  muse: '<path d="M7 8.5c-2.3 0-4 1.8-4 4s1.7 4 4 4c2.5 0 4.2-2.7 5-4 .8 1.3 2.5 4 5 4 2.3 0 4-1.8 4-4s-1.7-4-4-4c-2.5 0-4.2 2.7-5 4-.8-1.3-2.5-4-5-4z" stroke-width="2"/>',
  dsh: '<path d="M4 13c1.5-4.5 6-6.5 11-5 2.5.8 4.5 2.5 5 5-1.5 3.5-5.5 5.5-10 5-3.5-.4-5.5-2.2-6-5z"/><circle cx="15.2" cy="11.5" r="1.1" fill="currentColor" stroke="none"/><path d="M4 13 2 10.5M4 13l-2 2.5"/>',
  cursor: '<polygon points="12 2.8 20 7.4 20 16.6 12 21.2 4 16.6 4 7.4"/><path d="M12 12 20 7.4M12 12v9.2M12 12 4 7.4"/><polygon points="12 7 16.5 14.5 12 13 7.5 14.5" fill="currentColor" stroke="none"/>',
  gemini_cli: '<path d="M12 2.8c1.6 5.2 4 7.6 9.2 9.2-5.2 1.6-7.6 4-9.2 9.2-1.6-5.2-4-7.6-9.2-9.2 5.2-1.6 7.6-4 9.2-9.2z"/>',
  qwen: '<polygon points="12 3 19.8 7.5 19.8 16.5 12 21 4.2 16.5 4.2 7.5"/><circle cx="12" cy="12" r="3.2"/><path d="M14.3 14.3 17.5 17.5"/>',
  aider: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><polyline points="7 14.5 10.5 11.5 7 8.5"/><line x1="12" y1="15" x2="17" y2="15"/>',
  kimi: '<path d="M14.5 4.2a8 8 0 1 0 5.3 13.2A6.8 6.8 0 0 1 14.5 4.2z"/><path d="M9 8.5v7M13.5 8.5l-4 3.5 4 3.5"/>',
  goose: '<path d="M6.5 16.5c0-4 3-7 7-7h4.5l-2-3.2c-1-1.5-3-2-4.5-1L8.5 7.2c-2 1.5-3 4-3 7v2.3z"/><circle cx="14.5" cy="7.2" r="0.9" fill="currentColor" stroke="none"/>',
  amp: '<path d="M13.2 2.8 4.8 13.8h6.2l-1.2 7.4 9.4-11H13z"/>',
  cline: '<rect x="4.5" y="6" width="15" height="13" rx="3.5"/><path d="M12 3v3M8.5 11.5h2M13.5 11.5h2M8.5 15.5h7"/>',
  kilo: '<polygon points="12 3 20 8 20 16 12 21 4 16 4 8"/><path d="M9 8v8M15 8l-5 4 5 4"/>',
  kiro: '<path d="M6 19V10a6 6 0 0 1 12 0v9l-2-2-2 2-2-2-2 2-2-2z"/><circle cx="9.8" cy="10.5" r="1" fill="currentColor" stroke="none"/><circle cx="14.2" cy="10.5" r="1" fill="currentColor" stroke="none"/>',
  crush: '<path d="M12 20.2 4.8 13a4.6 4.6 0 0 1 6.5-6.5l.7.7.7-.7a4.6 4.6 0 0 1 6.5 6.5z"/>',
  aug: '<circle cx="9.5" cy="12" r="5.5"/><circle cx="14.5" cy="12" r="5.5"/>',
  droid: '<path d="M6 11a6 6 0 0 1 12 0v6a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2z"/><path d="M8.5 4.5 10 6.5M15.5 4.5 14 6.5"/><circle cx="9.5" cy="11.5" r="1" fill="currentColor" stroke="none"/><circle cx="14.5" cy="11.5" r="1" fill="currentColor" stroke="none"/>',
  vibe: '<path d="M4.5 17.5V6.5h3l4.5 6 4.5-6h3v11h-3v-6l-4.5 5.5L7.5 11.5v6z"/>',
  qoder: '<circle cx="11.5" cy="11.5" r="6.8"/><path d="M12.5 12.5 19 19"/><circle cx="11.5" cy="11.5" r="2.2"/>',
  qoder_cn: '<circle cx="11.5" cy="11.5" r="6.8"/><path d="M12.5 12.5 19 19M8.5 11.5h6"/>',
  zcode: '<rect x="4" y="4" width="16" height="16" rx="3.5"/><path d="M8 8.5h8l-8 7h8"/>',
  pi: '<path d="M5.5 7.5h13M9.5 7.5v10M15 7.5v8a2 2 0 0 0 2 2"/>',
  omp: '<polygon points="4.5 6 12.5 12 4.5 18"/><line x1="13.5" y1="18" x2="19.5" y2="18"/>',
  prime_agent: '<path d="M12 3 4.5 6.5v5.5c0 5 3.2 8.2 7.5 9.5 4.3-1.3 7.5-4.5 7.5-9.5V6.5z"/><path d="M9.8 15.5V8.5h3a2.2 2.2 0 0 1 0 4.4H9.8"/>',
  autohand: '<path d="M8 12V5.5a1.5 1.5 0 0 1 3 0V11m0-6.5a1.5 1.5 0 0 1 3 0V11m0-5a1.5 1.5 0 0 1 3 0v7.5a5.5 5.5 0 0 1-11 0V10a1.5 1.5 0 0 1 2 0z"/>',
  codebuff: '<polygon points="12 3.5 20 8 12 12.5 4 8"/><polyline points="4 12 12 16.5 20 12"/><polyline points="4 16 12 20.5 20 16"/>',
  freebuff: '<polygon points="12 4 19.5 8.5 12 13 4.5 8.5"/><polyline points="4.5 14 12 18.5 19.5 14"/>',
  command_code: '<path d="M16.5 4.5a2.5 2.5 0 0 0-2.5 2.5v10a2.5 2.5 0 1 0 2.5-2.5H7.5A2.5 2.5 0 1 0 10 17V7a2.5 2.5 0 1 0-2.5 2.5h9a2.5 2.5 0 0 0 0-5z"/>',
  continue_cli: '<polyline points="5.5 7 11.5 12 5.5 17"/><polyline points="12.5 7 18.5 12 12.5 17"/>',
  rovo: '<path d="M12 3.5 4 19h5l3-6 3 6h5z"/><circle cx="12" cy="10" r="1.3" fill="currentColor" stroke="none"/>',
  hermes: '<path d="M4 15.5c4-1 8-4.5 11.5-10.5l3.5 2c-2.5 5.5-6.5 9-11 10.5"/><path d="M8 10.5h6M6 14h6"/>',
  devin: '<polygon points="12 3 19.5 7.3 19.5 16.7 12 21 4.5 16.7 4.5 7.3"/><circle cx="12" cy="12" r="2.5"/><path d="M12 3v6.5M19.5 7.3l-5.3 3.2M19.5 16.7l-5.3-3.2M12 21v-6.5M4.5 16.7l5.3-3.2M4.5 7.3l5.3 3.2"/>',
  openclaw: '<path d="M6.5 5c-2 4.5-2 9.5 0 14M12 4c-1.8 5-1.8 11 0 16M17.5 5c-2 4.5-2 9.5 0 14"/>',
  codebuddy: '<circle cx="8.5" cy="9" r="3"/><circle cx="15.5" cy="9" r="3"/><path d="M3.5 19a5 5 0 0 1 10 0M10.5 19a5 5 0 0 1 10 0"/>',
  jcode: '<path d="M8 5H6a2 2 0 0 0-2 2v3a2 2 0 0 1-2 2 2 2 0 0 1 2 2v3a2 2 0 0 0 2 2h2M16 5h2a2 2 0 0 1 2 2v3a2 2 0 0 0 2 2 2 2 0 0 0-2 2v3a2 2 0 0 1-2 2h-2"/><path d="M13 8.5v6a2 2 0 0 1-4 0"/>',
};

import { AGENT_ORIGINAL_ICONS } from './agent-icons.js';

export function emblem(id, size = 28) {
  const brand = BRAND_MARKS[id];
  if (brand) {
    return `<span class="emblem brand-emblem brand-${brand}" style="width:${size}px;height:${size}px" aria-hidden="true"></span>`;
  }
  const original = AGENT_ORIGINAL_ICONS?.[id];
  if (original) {
    return `<span class="emblem orca-original-emblem" style="width:${size}px;height:${size}px" aria-hidden="true"><img src="${original}" width="${Math.round(size * 0.82)}" height="${Math.round(size * 0.82)}" alt="" /></span>`;
  }
  if (AGENT_SVGS[id]) {
    return `<span class="emblem custom-emblem mono-svg-emblem" style="width:${size}px;height:${size}px" aria-hidden="true">${svg(AGENT_SVGS[id], Math.round(size * 0.78))}</span>`;
  }
  const label = String(id ?? '?').replace(/[^a-z0-9]/gi, '').slice(0, 2).toUpperCase() || 'AI';
  return `<span class="emblem fallback mono-emblem" style="width:${size}px;height:${size}px;font-size:${Math.max(9, Math.round(size * 0.38))}px" aria-hidden="true">${label}</span>`;
}

export function userAvatar(size = 28) {
  return `<span class="emblem user-emblem" style="width:${size}px;height:${size}px">${svg(PATHS.user, Math.round(size * 0.58))}</span>`;
}

/** Sustituye el marcador inicial (emoji) de una línea de actividad por un icono. */
const LINE_MARKERS = [
  ['🔧', 'tool'],
  ['✏️', 'edit'],
  ['⚠', 'alert'],
  ['▶', 'play'],
  ['✔', 'checkCircle'],
  ['✖', 'xCircle'],
  ['🔀', 'merge'],
  ['📁', 'folder'],
  ['🧹', 'broom'],
  ['ℹ', 'info'],
  ['↪', 'relay'],
  ['↻', 'refresh'],
  ['✅', 'checkCircle'],
  ['—', 'chevRight'],
];
export function iconizeLine(text, escapeFn) {
  const t = String(text ?? '');
  for (const [mark, name] of LINE_MARKERS) {
    if (t.startsWith(mark)) {
      const rest = t.slice(mark.length).replace(/^️/, '').trimStart();
      return `<span class="li-ico li-${name}">${icon(name, 13)}</span>${escapeFn(rest)}`;
    }
  }
  return escapeFn(t);
}
