import { spawn } from 'node:child_process';

const isWindows = process.platform === 'win32';

/** Entorno para los CLIs hijos: sin variables que los hagan creer que están anidados. */
function childEnv(extra = {}) {
  const env = { ...process.env, ...extra };
  delete env.CLAUDECODE;
  delete env.CLAUDE_CODE_ENTRYPOINT;
  return env;
}

/** Mata un proceso y todos sus hijos (en Windows el CLI corre bajo cmd.exe). */
export function killTree(child) {
  if (!child || child.exitCode !== null || child.killed) return;
  if (isWindows) {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
  } else {
    child.kill('SIGTERM');
  }
}

/**
 * Ejecuta un comando, le pasa `input` por stdin y llama a `onLine` por cada línea de stdout.
 * Devuelve { code, stdout, stderr, timedOut, cancelled }.
 */
export function runProcess(cmd, args, { cwd, input, timeoutMs = 0, onLine, onSpawn, env } = {}) {
  return new Promise((resolve) => {
    // Los CLIs instalados con npm en Windows son shims .cmd: necesitan shell.
    const child = spawn(cmd, args, {
      cwd,
      shell: isWindows,
      windowsHide: true,
      env: childEnv(env),
    });
    onSpawn?.(child);

    let stdout = '';
    let stderr = '';
    let pending = '';
    let timedOut = false;
    let timer = null;

    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        timedOut = true;
        killTree(child);
      }, timeoutMs);
    }

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      if (!onLine) return;
      pending += chunk;
      const lines = pending.split(/\r?\n/);
      pending = lines.pop();
      for (const line of lines) if (line.trim()) onLine(line);
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
      if (stderr.length > 200_000) stderr = stderr.slice(-100_000);
    });
    child.on('error', (err) => {
      stderr += `\n${err.message}`;
    });
    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      if (onLine && pending.trim()) onLine(pending);
      resolve({ code, stdout, stderr, timedOut, cancelled: child.cancelled === true });
    });

    if (input != null) child.stdin.end(input, 'utf8');
    else child.stdin.end();
  });
}

/** Ejecuta un comando de shell libre (p. ej. el comando de tests del usuario). */
export function runShell(command, { cwd, timeoutMs = 600_000, onSpawn } = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, { cwd, shell: true, windowsHide: true, env: childEnv() });
    onSpawn?.(child);
    let output = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child);
    }, timeoutMs);
    const collect = (chunk) => {
      output += chunk;
      if (output.length > 200_000) output = output.slice(-100_000);
    };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    child.on('error', (err) => collect(`\n${err.message}`));
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, output: output.toString(), timedOut });
    });
  });
}
