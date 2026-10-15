// Niveles de permisos de las IAs y cómo se aplican en cada CLI.
//
// Lo que cada nivel garantiza se comprobó a mano con cada CLI en Windows (oct. 2026):
// - Claude Code respeta las reglas --allowedTools / --disallowedTools (p. ej. deniega "npm install").
// - Codex con -s workspace-write ejecuta comandos, pero su sandbox "unelevated" (el único que funciona aquí)
//   no bloquea ni la red ni la escritura fuera de la carpeta.
// - Antigravity con --sandbox bloquea la red (las instalaciones fallan), pero no la escritura fuera de la carpeta.
// Por eso, en «Comandos en el proyecto» AITeam vigila además cada comando y detiene a la IA si intenta instalar.

export const LEVELS = ['edits', 'project', 'full'];

export const LEVEL_INFO = {
  edits: {
    label: 'Protegido',
    short: 'Solo editan archivos en su copia',
    guarantees: 'Claude y Antigravity no ejecutan comandos. Codex sí puede ejecutarlos dentro de su sandbox, que en Windows no bloquea la red.',
  },
  project: {
    label: 'Comandos en el proyecto',
    short: 'Ejecutan tests, builds y servidores, sin instalar nada',
    guarantees:
      'Bloquea las instalaciones conocidas (npm/pip/winget…): Claude por reglas de permisos, Antigravity por su sandbox sin red y AITeam detiene a cualquier IA que lo intente. No garantiza que un comando no escriba fuera de la carpeta del proyecto.',
  },
  full: {
    label: 'Control total',
    short: 'Pueden ejecutar e instalar cualquier cosa',
    guarantees: 'Sin restricciones: pueden instalar programas, usar la red y tocar cualquier archivo de tu PC.',
  },
};

export const normalizeLevel = (value, fallback = 'edits') => (LEVELS.includes(value) ? value : fallback);

// Órdenes que instalan software o descargan paquetes. Prefijos de palabras completas.
export const INSTALL_PREFIXES = [
  'npm install', 'npm i', 'npm add', 'npm ci', 'npm update', 'npm exec', 'npx',
  'pnpm add', 'pnpm install', 'pnpm i', 'pnpm dlx', 'pnpm update',
  'yarn add', 'yarn install', 'yarn dlx', 'yarn global',
  'bun add', 'bun install', 'bun i', 'bunx',
  'pip install', 'pip3 install', 'python -m pip', 'python3 -m pip', 'py -m pip',
  'uv add', 'uv pip install', 'uv tool install', 'uvx', 'pipx install', 'poetry add', 'poetry install', 'conda install',
  'cargo install', 'cargo add', 'go install', 'go get',
  'gem install', 'bundle install', 'composer require', 'composer install',
  'dotnet add', 'dotnet tool install', 'nuget install',
  'winget', 'choco', 'scoop', 'apt', 'apt-get', 'brew', 'snap install',
  'install-module', 'install-package', 'install-script',
];

// Prefijos sin ambigüedad para las reglas de Claude Code ("npm i" también casaría con "npm init").
const CLAUDE_DENY_PREFIXES = INSTALL_PREFIXES.filter((p) => !['npm i', 'pnpm i', 'bun i', 'apt'].includes(p));

/** Reglas --disallowedTools de Claude Code para el nivel «Comandos en el proyecto». */
export function claudeInstallDenyRules() {
  return CLAUDE_DENY_PREFIXES.flatMap((p) => [`Bash(${p}:*)`, `PowerShell(${p}:*)`]);
}

const ESCAPED = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const INSTALL_RE = new RegExp(`^(?:${INSTALL_PREFIXES.map((p) => ESCAPED(p).replace(/ /g, '\\s+')).join('|')})(?:\\s|$)`, 'i');

/**
 * ¿Instala algo este comando? Revisa cada parte de un comando compuesto (&&, ||, ;, |, saltos de línea)
 * y quita envoltorios habituales (cmd /c, powershell -Command, sudo, rutas a ejecutables).
 */
export function isInstallCommand(command) {
  const text = String(command ?? '');
  const parts = text.split(/&&|\|\||[;|\n\r]/);
  for (let part of parts) {
    part = part
      .trim()
      .replace(/^(?:(?:cmd(?:\.exe)?\s+\/[cdsk]\s+)|(?:(?:powershell|pwsh)(?:\.exe)?\s+(?:-\w+\s+)*-(?:c|command)\s+)|(?:sudo\s+)|(?:&\s+))+/i, '')
      .replace(/^"[^"]*[\\/]([^"\\/]+)"/, '$1') // "C:\Program Files\nodejs\npm.cmd" install → npm.cmd install
      .replace(/^["'`]+|["'`]+$/g, '')
      .replace(/^(?:[a-z]:)?[\\/][^\s]*[\\/]/i, '') // C:\ruta\npm.cmd install → npm.cmd install
      .replace(/^(\w+)\.(?:cmd|exe|bat|ps1)\b/i, '$1');
    if (INSTALL_RE.test(part)) return true;
  }
  return false;
}

/** Comandos que lanza una IA, sacados de una línea de eventos de su CLI (Claude, Codex o Antigravity). */
export function commandsInEvent(line) {
  let ev;
  try {
    ev = JSON.parse(line);
  } catch {
    return [];
  }
  const out = [];
  // Claude Code: herramienta Bash/PowerShell en un mensaje del asistente.
  for (const c of ev?.message?.content ?? []) {
    if (c?.type === 'tool_use' && typeof c.input?.command === 'string') out.push(c.input.command);
  }
  // Codex: el comando aparece al empezar (item.started), antes de ejecutarse.
  if (ev?.item?.type === 'command_execution' && typeof ev.item.command === 'string') out.push(ev.item.command);
  // Antigravity: pasos de terminal.
  const st = ev?.step_update;
  for (const v of [st?.command, st?.command_line, st?.tool_input?.command, st?.args?.command, st?.input?.CommandLine, st?.input?.command]) {
    if (typeof v === 'string') out.push(v);
  }
  return out;
}

/** Texto para las instrucciones de las IAs según el nivel. */
export function levelPromptText(level) {
  if (level === 'full') {
    return 'CONTROL TOTAL. Puedes ejecutar comandos, instalar dependencias y herramientas, lanzar servidores, usar la web y tus servidores MCP sin pedir permiso. Úsalo con responsabilidad: nada destructivo fuera del proyecto sin que el usuario lo pida.';
  }
  if (level === 'project') {
    return 'COMANDOS EN EL PROYECTO. Puedes ejecutar comandos dentro de la carpeta del proyecto (tests, builds, linters, servidores de desarrollo), pero NO instalar dependencias ni programas (npm install, pip install, winget…) ni tocar nada fuera de la carpeta. Si un intento de instalación aparece, AITeam te detendrá. Si de verdad hace falta instalar algo, dilo y pide al usuario que active «Control total».';
  }
  return 'PROTEGIDO. Solo edita archivos dentro de la copia del proyecto; no ejecutes comandos ni instales nada. Si necesitas ejecutar o instalar algo, explícalo y pide al usuario que cambie el nivel de permisos.';
}
