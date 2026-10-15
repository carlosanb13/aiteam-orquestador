// Iconos de línea de AITeam y marcas de los servicios conectados.

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
  dot: '<circle cx="12" cy="12" r="4" fill="currentColor" stroke="none"/>',
};

export function icon(name, size = 16, extra = '') {
  return svg(PATHS[name] ?? PATHS.dot, size, extra);
}

// Los SVG conservan la geometría original; CSS los presenta en blanco o negro.
const BRAND_MARKS = { claude: 'claude', codex: 'openai', gemini: 'antigravity' };
export function emblem(id, size = 28) {
  const brand = BRAND_MARKS[id];
  if (!brand) return `<span class="emblem fallback" style="width:${size}px;height:${size}px">${svg(PATHS.user, size * 0.6)}</span>`;
  return `<span class="emblem brand-emblem brand-${brand}" style="width:${size}px;height:${size}px" aria-hidden="true"></span>`;
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
