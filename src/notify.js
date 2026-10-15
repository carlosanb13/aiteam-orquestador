// Notificaciones de Windows desde el servidor, para cuando la ventana de AITeam está cerrada.
// Con la ventana abierta, las notificaciones las muestra la propia interfaz.
import { execFile } from 'node:child_process';
import { loadConfig } from './config.js';

// Mismo identificador de aplicación que la ventana y los accesos directos de AITeam (ver launcher/crear-accesos.ps1),
// para que la notificación aparezca con el nombre y el icono de AITeam.
const APP_ID = 'MSEdge.localhost_/';

const SCRIPT = `
$ErrorActionPreference = 'Stop'
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null
$t = [System.Security.SecurityElement]::Escape($env:AITEAM_TITLE)
$b = [System.Security.SecurityElement]::Escape($env:AITEAM_BODY)
$xml = New-Object Windows.Data.Xml.Dom.XmlDocument
$xml.LoadXml("<toast activationType='protocol' launch='http://localhost:4317/'><visual><binding template='ToastGeneric'><text>$t</text><text>$b</text></binding></visual></toast>")
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($env:AITEAM_APPID).Show([Windows.UI.Notifications.ToastNotification]::new($xml))
`;

export function toast(title, body) {
  if (process.platform !== 'win32') return;
  if (loadConfig().notifications?.enabled === false) return;
  execFile(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', SCRIPT],
    {
      windowsHide: true,
      timeout: 15_000,
      env: { ...process.env, AITEAM_TITLE: String(title).slice(0, 120), AITEAM_BODY: String(body).slice(0, 300), AITEAM_APPID: APP_ID },
    },
    (err) => {
      if (err) console.error('No se pudo mostrar la notificación de Windows:', err.message);
    },
  );
}

const short = (s, n = 140) => {
  const one = String(s ?? '').replace(/\s+/g, ' ').trim();
  return one.length > n ? `${one.slice(0, n)}…` : one;
};

/**
 * Vigila conversaciones y tareas y avisa por Windows de lo importante cuando no hay ninguna ventana abierta.
 * hasViewers() dice si alguna ventana de AITeam está conectada (entonces avisa la propia interfaz).
 */
export function watchForNotifications({ chats, orchestrator, agents, hasViewers }) {
  const chatWorking = new Map();
  const runStatus = new Map();
  for (const c of chats.chats.values()) chatWorking.set(c.id, Boolean(c.working));
  for (const r of orchestrator.runs.values()) runStatus.set(r.id, r.status);

  chats.on('chat', (chat) => {
    const was = chatWorking.get(chat.id);
    const now = Boolean(chat.working);
    chatWorking.set(chat.id, now);
    if (!was || now || hasViewers()) return;
    const last = [...chat.messages].reverse().find((m) => m.kind === 'message' || m.kind === 'error');
    if (!last) return;
    if (last.kind === 'error') toast(`AITeam · ${short(chat.title, 60)}`, short(last.text));
    else if (agents[last.from]) toast(`${agents[last.from].name} respondió · ${short(chat.title, 50)}`, short(last.text));
  });

  orchestrator.on('run', (run) => {
    const was = runStatus.get(run.id);
    runStatus.set(run.id, run.status);
    if (was === run.status || hasViewers()) return;
    const goal = short(run.goal, 70);
    if (run.status === 'awaiting_approval') toast('El equipo propone un reparto', `${goal} — revísalo y apruébalo para empezar.`);
    else if (run.status === 'done') toast('Tarea de equipo terminada', goal);
    else if (run.status === 'failed') toast('La tarea de equipo falló', `${goal}: ${short(run.error, 120)}`);
  });
  orchestrator.on('bus-gate', ({ runId, gate }) => {
    if (!hasViewers() && gate.kind === 'escalation' && gate.status === 'pending') toast('Decisión del equipo pendiente', short(gate.question));
  });
  orchestrator.on('bus-message', ({ runId, message }) => {
    if (!hasViewers() && message.kind === 'ask' && message.to === 'user' && message.status === 'pending') toast('Pregunta del equipo', short(message.text));
  });
}
