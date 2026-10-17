import { icon, emblem, userAvatar, iconizeLine } from './icons.js';

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const state = {
  agents: [],
  runs: [],
  current: null, // run completo
  logs: [],
  view: 'new',
  runDetails: new Map(),
  runChanges: new Map(),
};

const STATUS = {
  planning: ['Planificando', 'run'],
  bidding: ['Negociando', 'run'],
  awaiting_approval: ['Esperando tu aprobación', 'warn'],
  running: ['Trabajando', 'run'],
  reviewing: ['Revisando', 'run'],
  integrating: ['Integrando', 'run'],
  attacking: ['Equipo rojo', 'run'],
  testing: ['Verificando', 'run'],
  paused: ['En pausa', 'warn'],
  done: ['Terminado', 'ok'],
  failed: ['Error', 'err'],
  cancelled: ['Cancelado', 'err'],
  interrupted: ['Interrumpido', 'err'],
};
const TASK_STATUS = {
  pending: ['Pendiente', ''],
  running: ['En curso', 'run'],
  paused: ['En pausa', 'warn'],
  done: ['Hecha', 'ok'],
  failed: ['Falló', 'err'],
  skipped: ['Omitida', 'warn'],
  cancelled: ['Cancelada', 'err'],
};
const STEPS = [
  ['planning', 'Planificar'],
  ['bidding', 'Negociar'],
  ['awaiting_approval', 'Aprobar'],
  ['running', 'Trabajar'],
  ['reviewing', 'Revisar'],
  ['integrating', 'Integrar'],
  ['attacking', 'Atacar'],
  ['testing', 'Verificar'],
  ['done', 'Listo'],
];

// Capacidades especiales de las IAs (ver src/capabilities.js).
const CAP_LABELS = { images: 'imágenes', browser: 'navegador' };
const CAP_TITLES = { images: 'Generar imágenes', browser: 'Usar el navegador' };
const agentInfo = (id) => state.agents.find((a) => a.id === id) ?? { id, name: id, color: '#888' };
const badge = ([label, cls]) => `<span class="badge ${cls}">${esc(label)}</span>`;
const fmtTime = (iso) => new Date(iso).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const fmtDate = (iso) => new Date(iso).toLocaleString('es', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
const agentTag = (id) => {
  const a = agentInfo(id);
  return `<span class="agent-tag">${emblem(id, 18)}${esc(a.name)}</span>`;
};

/** Aviso visible cuando el servidor de AITeam no responde. */
function setOffline(offline) {
  let bar = document.getElementById('offlineBar');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'offlineBar';
    bar.className = 'offline-bar';
    bar.innerHTML = icon('alert') + ' Sin conexión con el servidor de AITeam. Arráncalo con <code>npm start</code> en la carpeta de AITeam; esta página se reconectará sola.';
    document.body.prepend(bar);
  }
  bar.hidden = !offline;
}

async function api(method, url, body) {
  let res;
  try {
    res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    setOffline(true);
    throw new Error('No hay conexión con el servidor de AITeam (¿está arrancado?).');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Error ${res.status}`);
  return data;
}

// ------------------------------------------------------------ IAs y Catálogo estilo Orca

state.catalog = [];
state.defaultAgent = 'claude';
let orcaFilter = 'all';
let orcaQuery = '';
let editingCmdAgentId = null;

async function loadAgents(refresh = false) {
  const data = await api('GET', `/api/agents${refresh ? '?refresh' : ''}`);
  state.agents = data.agents;
  state.defaultAgent = data.defaultAgent || 'claude';
  $('#mockBadge').hidden = !data.mock;
  renderChips();
}

function renderOrcaRow(item) {
  const editing = editingCmdAgentId === item.id;
  const cmdText = item.displayCmd || item.command;
  return `<div class="orca-agent-row ${item.enabled ? 'is-enabled' : ''}" data-orca-id="${esc(item.id)}">
    <div class="orca-agent-icon" style="--agent-color:${esc(item.color || '#888')}">
      ${emblem(item.id, 22)}
    </div>
    <div class="orca-agent-info">
      <div class="orca-agent-title-line">
        <b class="orca-agent-name">${esc(item.name)}</b>
        ${item.isDefault ? `<span class="orca-badge-default">${icon('star', 11)} Predeterminado</span>` : item.enabled ? `<button type="button" class="orca-make-default ghost" data-orca-default="${esc(item.id)}" title="Establecer como agente predeterminado">${icon('star', 11)} Predeterminar</button>` : ''}
        ${item.installed ? `<span class="orca-badge-installed">Instalado</span>` : ''}
      </div>
      ${
        editing
          ? `<div class="orca-cmd-editor">
              <input type="text" class="mono small-text" data-orca-cmd-input="${esc(item.id)}" value="${esc(cmdText)}" placeholder="Comando y argumentos…" />
              <button type="button" class="small primary" data-orca-cmd-save="${esc(item.id)}">Guardar</button>
              <button type="button" class="small ghost" data-orca-cmd-cancel>Cancelar</button>
            </div>`
          : `<div class="orca-agent-cmd-row">
              <code class="orca-agent-cmd" data-orca-edit-cmd="${esc(item.id)}" title="Clic para personalizar comando (${esc(item.tagline || item.vendor)})">${esc(cmdText)}</code>
              <button type="button" class="orca-cmd-edit-btn ghost" data-orca-edit-cmd="${esc(item.id)}" title="Personalizar comando">${icon('edit', 12)}</button>
            </div>`
      }
    </div>
    <div class="orca-agent-controls">
      <div class="orca-seg-toggle" role="group" aria-label="Estado de ${esc(item.name)}">
        <button type="button" class="orca-seg-btn ${item.enabled ? 'active' : ''}" data-orca-toggle="${esc(item.id)}" data-orca-enable="1">Activado</button>
        <button type="button" class="orca-seg-btn ${!item.enabled ? 'active' : ''}" data-orca-toggle="${esc(item.id)}" data-orca-enable="0">Desactivado</button>
      </div>
      <button type="button" class="orca-ext-btn ghost" data-orca-ext="${esc(item.id)}" title="${esc(item.installCmd ? `Instalar: ${item.installCmd} (o abrir web)` : `Abrir documentación de ${item.name}`)}">
        ${icon('external', 15)}
      </button>
    </div>
  </div>`;
}

function renderOrcaCatalog() {
  const box = $('#agentDiscovery');
  const form = $('#addAgentForm');
  const body = $('#orcaAgentsBody');
  if (!box) return;

  for (const b of document.querySelectorAll('[data-orca-filter]')) {
    b.classList.toggle('active', b.dataset.orcaFilter === orcaFilter);
  }
  if (orcaFilter === 'custom') {
    body.hidden = true;
    form.hidden = false;
    return;
  }
  body.hidden = false;
  form.hidden = true;

  const q = orcaQuery.toLowerCase();
  const filtered = state.catalog.filter((item) => {
    if (orcaFilter === 'installed' && !item.installed) return false;
    if (orcaFilter === 'enabled' && !item.enabled) return false;
    if (!q) return true;
    return (
      item.name.toLowerCase().includes(q) ||
      item.id.toLowerCase().includes(q) ||
      String(item.command ?? '').toLowerCase().includes(q) ||
      String(item.vendor ?? '').toLowerCase().includes(q) ||
      String(item.tagline ?? '').toLowerCase().includes(q)
    );
  });

  const installedList = filtered.filter((x) => x.installed);
  const availableList = filtered.filter((x) => !x.installed);

  let html = '';
  if (installedList.length) {
    html += `
      <div class="orca-sec-header">
        <span>Instalados en este equipo</span>
        <span class="orca-count-pill">${installedList.length} agents</span>
      </div>
      <div class="orca-sec-group">${installedList.map(renderOrcaRow).join('')}</div>`;
  }
  if (availableList.length) {
    html += `
      <div class="orca-sec-header">
        <span>Disponible para instalar</span>
        <span class="orca-count-pill">${availableList.length} agents</span>
      </div>
      <div class="orca-sec-group">${availableList.map(renderOrcaRow).join('')}</div>`;
  }
  if (!html) {
    html = `<p class="muted" style="padding:24px;text-align:center">No se encontraron agentes para «${esc(orcaQuery)}».</p>`;
  }
  box.innerHTML = html;
}

async function openOrcaCatalog() {
  $('#addAgentDlg').showModal();
  const box = $('#agentDiscovery');
  if (!state.catalog.length) box.innerHTML = '<p class="muted" style="padding:18px">Escaneando catálogo de agentes en tu PC…</p>';
  try {
    const { candidates, defaultAgent } = await api('GET', '/api/agents/discover');
    state.catalog = candidates;
    state.defaultAgent = defaultAgent || 'claude';
    const badgeEl = $('#catalogCountBadge');
    if (badgeEl) badgeEl.textContent = String(candidates.length);
    renderOrcaCatalog();
  } catch (err) {
    box.innerHTML = `<p class="error" style="padding:18px">No se pudo cargar el catálogo: ${esc(err.message)}</p>`;
  }
}

$('#addAgentBtn')?.addEventListener('click', openOrcaCatalog);
$('#openCatalogNavBtn')?.addEventListener('click', openOrcaCatalog);
$('#settingsOpenCatalogBtn')?.addEventListener('click', () => {
  $('#settingsDlg')?.close();
  openOrcaCatalog();
});

$('#orcaAgentSearch')?.addEventListener('input', (e) => {
  orcaQuery = e.target.value.trim();
  renderOrcaCatalog();
});

$('#orcaFilterPills')?.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-orca-filter]');
  if (!btn) return;
  orcaFilter = btn.dataset.orcaFilter;
  renderOrcaCatalog();
});

$('#agentDiscovery')?.addEventListener('click', async (e) => {
  const toggleBtn = e.target.closest('[data-orca-toggle]');
  if (toggleBtn) {
    const id = toggleBtn.dataset.orcaToggle;
    const enabled = toggleBtn.dataset.orcaEnable === '1';
    const item = state.catalog.find((x) => x.id === id);
    if (item) item.enabled = enabled;
    renderOrcaCatalog();
    try {
      await api('POST', '/api/agents/catalog', { id, enabled });
      await loadAgents(true);
      if (state.view === 'welcome') showWelcome();
      if (state.view === 'new') showNew();
    } catch (err) {
      alert(err.message);
    }
    return;
  }

  const defBtn = e.target.closest('[data-orca-default]');
  if (defBtn) {
    const id = defBtn.dataset.orcaDefault;
    for (const c of state.catalog) c.isDefault = c.id === id;
    state.defaultAgent = id;
    renderOrcaCatalog();
    try {
      await api('POST', '/api/agents/catalog', { id, enabled: true, makeDefault: true });
      await loadAgents(true);
    } catch (err) {
      alert(err.message);
    }
    return;
  }

  const editBtn = e.target.closest('[data-orca-edit-cmd]');
  if (editBtn) {
    editingCmdAgentId = editBtn.dataset.orcaEditCmd;
    renderOrcaCatalog();
    document.querySelector(`[data-orca-cmd-input="${editingCmdAgentId}"]`)?.focus();
    return;
  }

  if (e.target.closest('[data-orca-cmd-cancel]')) {
    editingCmdAgentId = null;
    renderOrcaCatalog();
    return;
  }

  const saveCmdBtn = e.target.closest('[data-orca-cmd-save]');
  if (saveCmdBtn) {
    const id = saveCmdBtn.dataset.orcaCmdSave;
    const inp = document.querySelector(`[data-orca-cmd-input="${id}"]`);
    const displayCmd = inp ? inp.value.trim() : '';
    editingCmdAgentId = null;
    const item = state.catalog.find((x) => x.id === id);
    if (item && displayCmd) item.displayCmd = displayCmd;
    renderOrcaCatalog();
    if (displayCmd) {
      try {
        await api('POST', '/api/agents/catalog', { id, displayCmd });
        await loadAgents(true);
      } catch (err) {
        alert(err.message);
      }
    }
    return;
  }

  const extBtn = e.target.closest('[data-orca-ext]');
  if (extBtn) {
    const id = extBtn.dataset.orcaExt;
    const item = state.catalog.find((x) => x.id === id);
    if (!item) return;
    if (item.installCmd && !item.installed) {
      navigator.clipboard?.writeText(item.installCmd).catch(() => {});
    }
    if (item.url) window.open(item.url, '_blank', 'noopener');
  }
});

$('#probeAgentCommand')?.addEventListener('click', async () => {
  const command = $('#addAgentForm').elements.command.value.trim();
  const label = $('#agentProbeResult');
  label.textContent = 'Comprobando…';
  try {
    const result = await api('POST', '/api/agents/probe', { command });
    label.textContent = result.installed ? `Instalado: ${result.version}` : 'No se encontró en PATH.';
  } catch (err) { label.textContent = err.message; }
});
$('#cancelAddAgent')?.addEventListener('click', () => {
  orcaFilter = 'all';
  renderOrcaCatalog();
});
$('#addAgentForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.currentTarget;
  const data = new FormData(form);
  const error = $('[data-agent-error]', form);
  error.hidden = true;
  const submit = form.querySelector('[type=submit]');
  submit.disabled = true;
  try {
    await api('POST', '/api/agents', {
      id: data.get('id'), name: data.get('name'), command: data.get('command'),
      args: String(data.get('args') ?? '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean),
      profile: data.get('profile'),
    });
    await loadAgents(true);
    form.reset();
    orcaFilter = 'all';
    await openOrcaCatalog();
    if (state.view === 'new') showNew();
    if (state.view === 'welcome') showWelcome();
  } catch (err) {
    error.textContent = err.message;
    error.hidden = false;
  } finally { submit.disabled = false; }
});

function renderChips() {
  renderTeam();
}

// ------------------------------------------------------------ historial

async function loadRuns() {
  state.runs = await api('GET', '/api/runs');
  renderRunList();
}

function renderRunList() {
  renderSidebar();
}

// ------------------------------------------------------------ nueva tarea

function agentPickHtml() {
  return state.agents
    .map((a) => {
      const usable = a.installed && a.enabled !== false && a.working !== false;
      const note = !a.installed ? 'no instalado' : a.working === false ? 'no responde' : a.enabled === false ? 'desactivado' : esc(a.vendor);
      return `<label><input type="checkbox" name="agents" value="${a.id}" ${usable ? 'checked' : ''} />
        ${emblem(a.id, 26)}<span><b style="color:${a.color}">${esc(a.name)}</b><br><span class="note">${note}</span></span></label>`;
    })
    .join('');
}

function showNew(repo) {
  state.view = 'new';
  state.current = null;
  state.chat = null;
  renderRunList();
  renderChatList();
  const main = $('#main');
  main.innerHTML = '';
  main.append($('#newRunTpl').content.cloneNode(true));

  const goal = $('[name=goal]');
  const goalMic = document.createElement('button');
  goalMic.type = 'button';
  goalMic.className = 'mic-btn small-mic';
  goalMic.innerHTML = icon('mic', 18);
  goalMic.title = 'Dictar el objetivo por voz (Ctrl+M)';
  goal.insertAdjacentElement('afterend', goalMic);
  attachDictation(goal, goalMic);

  const lastRepo = typeof repo === 'string' ? repo : (localStorage.getItem('aiteam.repo') || state.projects[0]?.path || '');
  if (lastRepo) $('[name=repoPath]').value = lastRepo;
  attachFolderPicker($('#newRunForm'), $('[name=repoPath]'));

  $('[data-agent-pick]').innerHTML = agentPickHtml();
  fillLevelSelects($('#newRunForm'));
  $('#newRunForm').elements.autonomy.value = state.defaultAutonomy;
  $('#newRunForm').elements.autonomy.onchange?.();
  const syncCoordinator = () => {
    const chosen = [...document.querySelectorAll('[name=agents]:checked')].map((i) => i.value);
    const sel = $('#coordinatorSel');
    const prev = sel.value;
    sel.innerHTML = chosen.map((id) => `<option value="${id}">${esc(agentInfo(id).name)}</option>`).join('');
    if (chosen.includes(prev)) sel.value = prev;
  };
  $('[data-agent-pick]').addEventListener('change', syncCoordinator);
  syncCoordinator();

  $('#newRunForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const body = {
      repoPath: f.get('repoPath'),
      goal: f.get('goal'),
      agents: f.getAll('agents'),
      coordinator: f.get('coordinator'),
      testCommand: f.get('testCommand'),
      autonomy: f.get('autonomy'),
      review: f.get('review') === 'on',
      autoApprove: f.get('autoApprove') === 'on',
      adversarial: f.get('adversarial') === 'on',
    };
    const btn = e.target.querySelector('button[type=submit]');
    btn.disabled = true;
    $('#formError').hidden = true;
    try {
      await api('POST', '/api/projects', { path: body.repoPath, prepare: true });
      await loadProjects();
      localStorage.setItem('aiteam.repo', body.repoPath);
      const run = await api('POST', '/api/runs', body);
      await loadRuns();
      openRun(run.id);
    } catch (err) {
      $('#formError').textContent = err.message;
      $('#formError').hidden = false;
      btn.disabled = false;
    }
  });
}


// ------------------------------------------------------------ vista de una tarea

async function openRun(id) {
  $('#main').innerHTML = '<section class="panel empty-state" role="status"><h2>Cargando tarea…</h2><p class="muted">Recuperando el plan y la actividad del equipo.</p></section>';
  let run;
  try { run = await api('GET', `/api/runs/${id}`); }
  catch (err) {
    $('#main').innerHTML = `<section class="panel empty-state" role="alert"><h2>No se pudo abrir la tarea</h2><p class="error">${esc(err.message)}</p><button class="primary" id="retryOpenRun">Reintentar</button></section>`;
    $('#retryOpenRun').addEventListener('click', () => openRun(id));
    return;
  }
  state.logs = run.log ?? [];
  delete run.log;
  if (run.status === 'done' && run.integration) {
    try { state.runChanges.set(id, await api('GET', `/api/runs/${id}/changes`)); } catch { /* el resultado sigue disponible */ }
  }
  state.current = run;
  state.chat = null;
  state.view = 'run';
  renderRunList();
  renderChatList();
  renderRun();
}

async function retryTeamRun(run) {
  if (!run?.id) return;
  if (!confirm('Se iniciará un nuevo intento con el mismo objetivo. El trabajo parcial anterior quedará guardado. ¿Continuar?')) return;
  try {
    const next = await api('POST', `/api/runs/${run.id}/retry`);
    await loadRuns();
    if (next.chatId) {
      await loadChats();
      await openChat(next.chatId);
    } else await openRun(next.id);
  } catch (err) { alert(err.message); }
}

function stepClass(run, key) {
  const order = STEPS.map((s) => s[0]);
  const status = run.status;
  if (['failed', 'cancelled', 'interrupted'].includes(status)) {
    const reached = run.tasks.length ? (run.integration ? 'integrating' : run.reviews.length ? 'reviewing' : run.tasks.some((t) => t.assignee) ? 'running' : 'bidding') : 'planning';
    const i = order.indexOf(key);
    const r = order.indexOf(reached);
    return i < r ? 'done' : i === r ? 'failed' : '';
  }
  const i = order.indexOf(key);
  const c = order.indexOf(status);
  if ((key === 'testing' && !run.testCommand) || (key === 'attacking' && !run.adversarial)) return c > i ? 'done' : '';
  return i < c ? 'done' : i === c ? 'current' : '';
}

function renderRun() {
  const run = state.current;
  if (!run) return;
  const openSections = new Set([...document.querySelectorAll('#main details.run-details[open]')].map((d) => d.dataset.section));
  const awaiting = run.status === 'awaiting_approval';
  const active = ['planning', 'bidding', 'running', 'reviewing', 'integrating', 'attacking', 'testing', 'awaiting_approval'].includes(run.status);
  const team = run.activeAgents?.length ? run.activeAgents : run.agents;
  const guidance = awaiting
    ? 'Revisa el reparto, cambia responsables si hace falta y aprueba para que el equipo empiece.'
    : run.status === 'done'
      ? run.integration ? (run.delivery?.status === 'applied' ? 'El equipo terminó y los cambios ya están en tu proyecto.' : 'El equipo terminó. Los detalles indican si quedó algo pendiente.') : 'El equipo terminó. Aquí tienes el resultado.'
      : ['failed', 'cancelled', 'interrupted'].includes(run.status)
        ? 'El trabajo se detuvo. Revisa el error y la actividad para decidir el siguiente paso.'
        : 'El equipo está trabajando. Puedes seguir el plan y la actividad aquí; recibirás el resultado para revisarlo.';

  const tasksRows = run.tasks
    .map((t) => {
      const bids = team
        .map((a) => {
          const b = t.bids?.[a];
          const s = b?.score ?? 0;
          return `<div class="bid ${t.assignee === a ? 'win' : ''}" title="${esc(b?.reason ?? 'sin valoración')}">
            <span>${esc(agentInfo(a).name)}</span>
            <span class="bar"><i style="width:${s * 10}%;background:${agentInfo(a).color}"></i></span>
            <span>${b ? s : '–'}</span></div>`;
        })
        .join('');
      const assignee = awaiting
        ? `<select data-assign="${t.id}">${team.map((a) => `<option value="${a}" ${t.assignee === a ? 'selected' : ''}>${esc(agentInfo(a).name)}</option>`).join('')}</select>`
        : t.assignee
          ? agentTag(t.assignee)
          : '<span class="muted">—</span>';
      return `<tr>
        <td class="mono">${esc(t.id)}</td>
        <td>
          <div class="title">${esc(t.title)} <span class="badge">${esc(t.kind)}</span>${(t.requires ?? []).map((r) => `<span class="badge req" title="Solo pueden hacerla las IAs con esta capacidad">${icon(r === 'images' ? 'palette' : 'folder', 11)} requiere ${esc(CAP_LABELS[r] ?? r)}</span>`).join('')}</div>
          ${t.warning ? `<div class="desc warn-text">${icon('alert', 12)} ${esc(t.warning)}</div>` : ''}
          <details class="desc"><summary>Detalles</summary><div class="desc">${esc(t.description)}</div></details>
          ${t.dependsOn.length ? `<div class="desc">Depende de: ${t.dependsOn.map(esc).join(', ')}</div>` : ''}
          ${t.reassignedFrom?.length ? `<div class="desc">${icon('relay', 12)} Reasignada (antes: ${t.reassignedFrom.map((a) => esc(agentInfo(a).name)).join(', ')})</div>` : ''}
          ${t.summary ? `<div class="summary">${esc(t.summary)}</div>` : ''}
          ${(t.attempts ?? []).length && !['failed', 'skipped'].includes(t.status) ? `<details class="attempts"><summary>${icon('relay', 12)} ${t.attempts.length} intento(s) anterior(es)</summary>${t.attempts.map((x) => `<div class="muted small-text"><b>${esc(agentInfo(x.agent).name)}</b> · ${x.kind === 'network' ? 'error de red' : x.kind === 'quota' ? 'sin cuota' : 'error'}: ${esc(x.error)}</div>`).join('')}</details>` : ''}
          ${t.error && ['failed', 'skipped'].includes(t.status) ? `<div class="summary error">${esc(t.error)}</div>` : ''}
        </td>
        <td><div class="bids">${bids}</div></td>
        <td>${assignee}</td>
        <td>${badge(TASK_STATUS[t.status] ?? [t.status, ''])}</td>
      </tr>`;
    })
    .join('');

  const lanes = [...team, null]
    .map((a) => {
      const name = a ? agentInfo(a).name : 'AITeam';
      const color = a ? agentInfo(a).color : 'var(--muted)';
      const current = a ? run.tasks.find((t) => t.assignee === a && t.status === 'running') : null;
      const exhausted = a && run.exhausted?.[a];
      return `<div class="lane">
        <div class="lane-head"><span class="agent-tag"><span class="dot" style="background:${color}"></span>${esc(name)}</span>
          ${exhausted ? `<span class="badge err" title="${esc(exhausted)}">sin cuota</span>` : `<span class="muted" style="font-size:12px">${current ? esc(`${current.id} en curso`) : ''}</span>`}</div>
        <div class="lane-log" data-lane="${a ?? '_'}"></div>
      </div>`;
    })
    .join('');

  const board = run.board.length
    ? run.board
        .slice()
        .reverse()
        .map((m) => {
          const color = agentInfo(m.from).color ?? 'var(--border)';
          const from = m.from === 'aiteam' ? 'AITeam' : agentInfo(m.from).name;
          const to = m.to === 'all' ? 'todos' : agentInfo(m.to).name;
          return `<div class="msg" style="border-color:${color}"><div class="who">${esc(from)} → ${esc(to)} · ${fmtTime(m.ts)}</div>${esc(m.text)}</div>`;
        })
        .join('')
    : '<p class="muted">Todavía no hay mensajes.</p>';

  const reviews = run.reviews.length
    ? run.reviews
        .map(
          (r) => `<div class="review">
          <div>${agentTag(r.reviewer)} revisó a ${agentTag(r.author)} ${r.round ? `(ronda ${r.round + 1})` : ''}
            ${r.approved === true ? badge(['Aprobado', 'ok']) : r.approved === false ? badge(['Cambios pedidos', 'warn']) : badge(['Falló', 'err'])}</div>
          <div class="desc">${esc(r.summary)}</div>
          ${r.issues.length ? `<ul>${r.issues.map((i) => `<li><b>${esc(i.severity)}</b> ${i.file ? `<code>${esc(i.file)}</code> ` : ''}${esc(i.description)}</li>`).join('')}</ul>` : ''}
        </div>`,
        )
        .join('')
    : '';

  const integ = run.integration;
  const applied = Boolean(run.delivery?.status === 'applied' || state.runChanges.get(run.id)?.applied);
  const result =
    run.status === 'done' && integ
      ? `<section class="panel">
        <h3>${applied ? 'Cambios aplicados al proyecto' : 'Resultado del equipo'}</h3>
        <p>${applied ? 'El equipo terminó y los cambios ya están en tu proyecto.' : esc(run.delivery?.reason ?? 'El equipo terminó; los cambios siguen en su copia de trabajo.')}</p>
        ${run.delivery?.selfUpdate ? '<p class="muted">Reinicia AITeam desde Ajustes para cargar el código nuevo.</p>' : ''}
        ${run.delivery?.chatSync === 'pending' ? `<p class="error">${esc(run.delivery.chatSyncReason)}</p>` : ''}
        ${applied ? '<button id="runProjectFiles">Ver archivos del proyecto</button>' : '<button class="primary" id="runDiff">Resolver cambios pendientes</button>'}
        ${run.tasks?.some((t) => t.summary) ? `<h4>Qué hizo el equipo</h4><ul>${run.tasks.filter((t) => t.summary).map((t) => `<li><b>${esc(t.title)}</b>: ${esc(t.summary)}</li>`).join('')}</ul>` : ''}
        ${(run.delivery?.changes ?? []).length ? `<details><summary>Ver cambios</summary><ul>${run.delivery.changes.map((f) => `<li><code>${esc(f.file)}</code> · +${f.add} / -${f.del}</li>`).join('')}</ul></details>` : ''}
        <p class="muted">Integrado: ${integ.merged.map((a) => esc(agentInfo(a).name)).join(', ') || 'nada'}${
          integ.unmerged.length ? ` · <span class="error">Sin integrar (conflictos): ${integ.unmerged.map((a) => esc(agentInfo(a).name)).join(', ')}</span>` : ''
        }</p>
        ${
          integ.tests
            ? `<p>Verificación: ${integ.tests.passed ? badge(['Pasa', 'ok']) : badge(['Falla', 'err'])} <span class="muted">(${integ.tests.attempts} intento/s)</span></p>
               <details><summary>Salida</summary><pre class="output">${esc(integ.tests.output)}</pre></details>`
            : ''
        }
      </section>`
      : (run.status === 'interrupted' || run.status === 'paused')
        ? `<section class="panel run-outcome"><h3>${run.status === 'paused' ? '⏸ Trabajo en pausa' : 'Trabajo interrumpido'}</h3><p>${run.status === 'paused' ? 'Las subtareas terminadas y sus ramas siguen guardadas intactas. Puedes continuar cuando lo desees.' : 'Las subtareas terminadas y sus ramas siguen guardadas. Puedes continuar desde ellas o empezar otra tarea.'}</p>${!run.cleaned ? `<button id="resumeRun" class="primary">${icon('play', 13)} Reanudar trabajo</button> ` : ''}<button id="retryRun">Empezar de nuevo</button></section>`
        : '';

  $('#main').innerHTML = `
    <section class="panel">
      <div class="run-head">
        <div>
          <p class="goal">${esc(run.goal)}</p>
          <div class="muted mono">${esc(run.repoPath)} · rama base ${esc(run.baseBranch)} · coordinadora ${esc(agentInfo(run.coordinator).name)}</div>
        </div>
        <div class="actions">
          ${badge(STATUS[run.status] ?? [run.status, ''])}
          ${awaiting ? '<button class="primary" id="approveBtn">Aprobar reparto y empezar</button>' : ''}
          <button id="runFiles">Archivos</button>
          ${active ? `<button class="warn" id="pauseBtn" title="Pausar la tarea temporalmente">${icon('pause', 13)} Pausar</button><button class="danger" id="cancelBtn" title="Cancelar la tarea">${icon('stop', 13)} Cancelar</button>` : ''}
          ${(run.status === 'paused' || run.status === 'interrupted') && !run.cleaned ? `<button class="primary" id="resumeRunTopBtn" title="Reanudar el trabajo del equipo">${icon('play', 13)} Reanudar</button>` : ''}
          ${!active && run.status !== 'paused' && Object.keys(run.worktrees).length && !run.cleaned ? '<button id="cleanupBtn" title="Borra las carpetas de trabajo; las ramas se conservan">Limpiar copias</button>' : ''}
        </div>
      </div>
      <div class="pipeline">${STEPS.map(([k, label]) => `<div class="step ${stepClass(run, k)}">${label}</div>`).join('')}</div>
      <p class="muted run-guidance" role="status">${guidance}</p>
      ${run.phase ? `<p class="phase">${esc(run.phase)}</p>` : ''}
      ${run.error ? `<p class="error">${esc(run.error)}</p>` : ''}
      ${run.dirty ? '<p class="muted">' + icon('alert', 13) + ' El repositorio tenía cambios sin commit; las IAs trabajan sobre el último commit.</p>' : ''}
    </section>
    ${result}
    ${(run.messages?.length || run.gates?.length) ? `<section class="panel team-panel"><h3>Colaboración del equipo</h3>${teamConversationHtml(run, 20)}</section>` : ''}
    ${
      run.tasks.length
        ? `<${awaiting ? 'section' : 'details'} class="panel run-details" data-section="plan">${awaiting ? '<h3>Plan y reparto</h3>' : '<summary>Plan y reparto</summary>'}
          ${awaiting ? '<p class="muted">Cada barra es la nota que cada IA se puso para esa subtarea. Puedes cambiar el responsable antes de aprobar.</p>' : ''}
          <table><thead><tr><th>ID</th><th>Subtarea</th><th>Valoraciones</th><th>Responsable</th><th>Estado</th></tr></thead>
          <tbody>${tasksRows}</tbody></table></${awaiting ? 'section' : 'details'}>`
        : '<section class="panel empty-state"><h3>Preparando el plan</h3><p class="muted">Las subtareas aparecerán aquí cuando la coordinadora termine de organizar el trabajo.</p></section>'
    }
    <details class="panel run-details" data-section="technical"><summary>Detalles técnicos del equipo</summary><h3>Actividad</h3><div class="lanes">${lanes}</div><h3>Mensajes entre IAs</h3><div class="board">${board}</div></details>
    ${reviews ? `<details class="panel run-details" data-section="reviews"><summary>Revisiones cruzadas</summary>${reviews}</details>` : ''}
    ${run.attack ? `<details class="panel run-details" data-section="attack"><summary>Pruebas adversariales</summary>${attackHtml(run.attack)}</details>` : ''}
  `;

  for (const section of document.querySelectorAll('#main details.run-details')) {
    section.open = openSections.has(section.dataset.section) || (section.dataset.section === 'plan' && !state.runPlanSeen?.has(run.id));
  }
  (state.runPlanSeen ??= new Set()).add(run.id);

  for (const entry of state.logs) appendLog(entry, false);
  for (const el of document.querySelectorAll('.lane-log')) el.scrollTop = el.scrollHeight;

  $('#approveBtn')?.addEventListener('click', async (e) => {
    e.target.disabled = true;
    const assignments = {};
    for (const sel of document.querySelectorAll('[data-assign]')) assignments[sel.dataset.assign] = sel.value;
    try {
      await api('POST', `/api/runs/${run.id}/approve`, { assignments });
    } catch (err) {
      alert(err.message);
      e.target.disabled = false;
    }
  });
  $('#runDiff')?.addEventListener('click', () => openReview('runs', run.id));
  $('#runProjectFiles')?.addEventListener('click', () => openFiles(run.repoPath, 'archivos del proyecto'));
  $('#retryRun')?.addEventListener('click', () => retryTeamRun(run));
  $('#resumeRun')?.addEventListener('click', async () => {
    try { await api('POST', `/api/runs/${run.id}/resume`); await openRun(run.id); }
    catch (err) { alert(err.message); }
  });
  $('#resumeRunTopBtn')?.addEventListener('click', async () => {
    try { await api('POST', `/api/runs/${run.id}/resume`); await openRun(run.id); }
    catch (err) { alert(err.message); }
  });
  $('#pauseBtn')?.addEventListener('click', async () => {
    try { await api('POST', `/api/runs/${run.id}/pause`); await openRun(run.id); }
    catch (err) { alert(err.message); }
  });
  $('#runFiles')?.addEventListener('click', () =>
    run.integration?.worktree && !run.cleaned
      ? openFiles(run.integration.worktree, 'resultado integrado')
      : openFiles(run.repoPath, 'proyecto original'),
  );
  $('#cancelBtn')?.addEventListener('click', async () => {
    if (confirm('¿Cancelar esta tarea? Se detendrán las IAs que estén trabajando.')) await api('POST', `/api/runs/${run.id}/cancel`);
  });
  $('#cleanupBtn')?.addEventListener('click', async () => {
    if (confirm('¿Borrar las carpetas de trabajo de esta tarea? Las ramas git se conservan.')) {
      try {
        await api('POST', `/api/runs/${run.id}/cleanup`);
      } catch (err) {
        alert(err.message);
      }
    }
  });
  for (const btn of document.querySelectorAll('[data-copy]')) {
    btn.addEventListener('click', () => {
      navigator.clipboard.writeText(btn.previousElementSibling.textContent);
      btn.textContent = 'Copiado';
    });
  }
}

function attackHtml(attack) {
  const findings = attack.findings
    .map((f) => `<li><b>${esc(f.severity)}</b> ${f.file ? `<code>${esc(f.file)}</code> ` : ''}${esc(f.title)}
      <div class="desc">${esc(f.description)}${f.reproduce ? `<br>Cómo provocarlo: ${esc(f.reproduce)}` : ''}</div></li>`)
    .join('');
  return `<section class="panel"><h3>Equipo rojo</h3>
    <div>${attack.attacker ? agentTag(attack.attacker) : ''} ${attack.error ? `<span class="error">${esc(attack.error)}</span>` : esc(attack.summary ?? '')}</div>
    ${findings ? `<ul>${findings}</ul>` : '<p class="muted">Sin hallazgos.</p>'}
    ${attack.fixer ? `<div class="review">${agentTag(attack.fixer)} corrigió: ${esc(attack.fixSummary)}</div>` : ''}
  </section>`;
}

function appendLog(entry, scroll = true) {
  const lane = document.querySelector(`.lane-log[data-lane="${entry.agent ?? '_'}"]`) ?? document.querySelector('.lane-log[data-lane="_"]');
  if (!lane) return;
  const nearBottom = lane.scrollHeight - lane.scrollTop - lane.clientHeight < 40;
  const line = document.createElement('div');
  line.innerHTML = `<span class="t">${fmtTime(entry.ts)}</span> ${iconizeLine(entry.text, esc)}`;
  lane.append(line);
  if (scroll && nearBottom) lane.scrollTop = lane.scrollHeight;
}

// ------------------------------------------------------------ tiempo real

const events = new EventSource('/api/events');
let wasOffline = false;
events.addEventListener('error', () => {
  wasOffline = true;
  setOffline(true);
});
events.addEventListener('open', () => {
  setOffline(false);
  // Tras reiniciar el servidor, se recarga todo por si cambió algo mientras estaba apagado.
  if (wasOffline) location.reload();
});
let runRenderQueued = false;
events.addEventListener('run', (e) => {
  const run = JSON.parse(e.data);
  state.runDetails.set(run.id, run);
  const idx = state.runs.findIndex((r) => r.id === run.id);
  const summary = { id: run.id, goal: run.goal, status: run.status, createdAt: run.createdAt, agents: run.agents, repoPath: run.repoPath, baseBranch: run.baseBranch };
  if (idx >= 0) state.runs[idx] = summary;
  else state.runs.unshift(summary);
  renderRunList();
  const card = document.querySelector(`[data-run-card="${run.id}"]`);
  if (card) { card.innerHTML = runCardHtml(run); hydrateRunCards(); }
  if (state.current?.id === run.id) {
    state.current = run;
    // Agrupa ráfagas de actualizaciones en un solo repintado; respeta un <select> abierto.
    if (!runRenderQueued) {
      runRenderQueued = true;
      setTimeout(() => {
        runRenderQueued = false;
        if (document.activeElement?.matches?.('select[data-assign]')) return;
        renderRun();
      }, 150);
    }
  }
});
events.addEventListener('log', (e) => {
  const { runId, entry } = JSON.parse(e.data);
  if (state.current?.id !== runId) return;
  state.logs.push(entry);
  appendLog(entry);
});

// ------------------------------------------------------------ ajustes (estilo Orca)

const PROVIDER_LOGIN_HINTS = {
  claude: { provider: 'Anthropic', loginCmd: 'claude login' },
  codex: { provider: 'OpenAI', loginCmd: 'codex login' },
  gemini: { provider: 'Google', loginCmd: 'gemini' },
  copilot: { provider: 'GitHub', loginCmd: 'gh auth login' },
  cursor: { provider: 'Anysphere', loginCmd: 'cursor-agent login' },
  opencode: { provider: 'SST', loginCmd: 'opencode auth login' },
};

function selectSettingsTab(tabId) {
  for (const b of document.querySelectorAll('[data-settings-tab]')) {
    b.classList.toggle('active', b.dataset.settingsTab === tabId);
  }
  for (const p of document.querySelectorAll('[data-settings-pane]')) {
    p.hidden = p.dataset.settingsPane !== tabId;
  }
  if (tabId === 'usage') renderSettingsUsagePane();
}

$('#settingsNav')?.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-settings-tab]');
  if (btn) selectSettingsTab(btn.dataset.settingsTab);
});

$('#closeSettingsX')?.addEventListener('click', () => $('#settingsDlg').close());
$('#cancelSettingsBtn')?.addEventListener('click', () => $('#settingsDlg').close());
$('#closeAddAgentX')?.addEventListener('click', () => $('#addAgentDlg').close());

// Cerrar cualquier diálogo al hacer clic fuera de la ventana (en el fondo oscuro).
document.addEventListener('click', (e) => {
  if (e.target.tagName === 'DIALOG' && e.target.open) {
    const r = e.target.getBoundingClientRect();
    const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
    if (!inside) e.target.close();
  }
});

function renderProviderAccounts() {
  const box = $('#providerAccountsList');
  if (!box) return;
  const activeProviders = state.agents.filter((a) => a.enabled !== false);
  box.innerHTML = activeProviders
    .map((a) => {
      const hint = PROVIDER_LOGIN_HINTS[a.id] ?? { provider: a.vendor || 'CLI', loginCmd: `${a.cli || a.id} --help` };
      const statusText = !a.installed ? 'CLI no instalado' : a.working === false ? 'Requiere iniciar sesión' : 'Cuenta conectada';
      const statusCls = !a.installed || a.working === false ? 'err' : 'ok';
      return `<div class="provider-acc-card">
        <div class="provider-acc-left">
          ${emblem(a.id, 22)}
          <div>
            <div class="provider-acc-title"><b>${esc(a.name)}</b> <span class="muted small-text">· ${esc(hint.provider)}</span></div>
            <div class="muted small-text mono">Autenticación: <code>${esc(hint.loginCmd)}</code></div>
          </div>
        </div>
        <div class="provider-acc-right">
          <span class="agent-state-pill ${statusCls}">${statusText}</span>
          <button type="button" class="small ghost" data-copy-login="${esc(hint.loginCmd)}" title="Copiar comando de login">${icon('copy', 12)} Login</button>
          <button type="button" class="small" data-verify-provider="${esc(a.id)}" ${a.installed ? '' : 'disabled'}>Verificar</button>
        </div>
      </div>`;
    })
    .join('');
}

$('#providerAccountsList')?.addEventListener('click', async (e) => {
  const copyBtn = e.target.closest('[data-copy-login]');
  if (copyBtn) {
    navigator.clipboard.writeText(copyBtn.dataset.copyLogin);
    const prev = copyBtn.innerHTML;
    copyBtn.textContent = 'Copiado';
    setTimeout(() => (copyBtn.innerHTML = prev), 1400);
    return;
  }
  const verifyBtn = e.target.closest('[data-verify-provider]');
  if (verifyBtn) {
    const id = verifyBtn.dataset.verifyProvider;
    verifyBtn.disabled = true;
    verifyBtn.textContent = 'Probando…';
    try {
      Object.assign(agentInfo(id), await api('POST', `/api/agents/${id}/test`));
    } catch (err) {
      Object.assign(agentInfo(id), { working: false, error: err.message });
    }
    renderProviderAccounts();
    renderTeam();
  }
});

function renderSettingsUsagePane() {
  const kpi = $('#settingsStatsSummary');
  const metersBox = $('#settingsUsageMeters');
  if (!kpi || !metersBox) return;
  const enabledAgents = state.agents.filter((a) => a.enabled !== false);
  const installedCount = enabledAgents.filter((a) => a.installed).length;
  const totalCallsToday = Object.values(state.usage ?? {}).reduce((acc, u) => acc + (u?.callsToday || 0), 0);
  kpi.innerHTML = `
    <div class="stat-kpi-box"><span class="stat-kpi-val">${installedCount}/${enabledAgents.length}</span><span class="stat-kpi-lbl">Agentes listos</span></div>
    <div class="stat-kpi-box"><span class="stat-kpi-val">${state.chats?.length ?? 0}</span><span class="stat-kpi-lbl">Conversaciones</span></div>
    <div class="stat-kpi-box"><span class="stat-kpi-val">${state.runs?.length ?? 0}</span><span class="stat-kpi-lbl">Tareas en paralelo</span></div>
    <div class="stat-kpi-box"><span class="stat-kpi-val">${totalCallsToday}</span><span class="stat-kpi-lbl">Consultas hoy</span></div>
  `;
  metersBox.innerHTML = enabledAgents
    .map((a) => {
      const u = state.usage?.[a.id];
      const rows = u && (u.session || u.weekly)
        ? meter('Ventana 5 horas', u.session) + meter('Ventana semanal', u.weekly)
        : `<div class="muted small-text">${u?.callsToday ? `${u.callsToday} consultas hoy · ` : ''}Límites gestionados directamente por el CLI (${esc(a.cli || a.id)})</div>`;
      return `<div class="settings-usage-card">
        <div class="settings-usage-head">
          ${emblem(a.id, 18)}
          <b style="color:${a.color}">${esc(a.name)}</b>
          <span class="muted small-text">${u?.callsToday ? `${u.callsToday} turnos hoy` : ''}</span>
        </div>
        ${rows}
      </div>`;
    })
    .join('');
}

$('#settingsRefreshUsageBtn')?.addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  btn.disabled = true;
  btn.textContent = 'Actualizando…';
  try {
    state.usage = await api('POST', '/api/usage/refresh');
    renderTeam();
    renderSettingsUsagePane();
  } finally {
    btn.disabled = false;
    btn.textContent = 'Actualizar cuotas';
  }
});

$('#settingsOpenCmdPaletteBtn')?.addEventListener('click', () => {
  $('#settingsDlg')?.close();
  openCmdPalette();
});

$('#settingsScanPortsBtn')?.addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  const statusEl = $('#settingsPortsStatus');
  btn.disabled = true;
  try {
    const { ports } = await api('GET', '/api/ports');
    if (statusEl) {
      statusEl.innerHTML = ports?.length
        ? `Puertos activos detectados: ${ports.map((p) => `<code>${esc(p.url)}</code>`).join(', ')}`
        : 'No se detectaron servidores locales activos en este momento.';
    }
  } finally {
    btn.disabled = false;
  }
});

$('#uiDensitySel')?.addEventListener('change', (e) => {
  document.documentElement.dataset.density = e.target.value;
  localStorage.setItem('aiteam.density', e.target.value);
});
if (localStorage.getItem('aiteam.density')) {
  document.documentElement.dataset.density = localStorage.getItem('aiteam.density');
}

$('#settingsBtn').addEventListener('click', async () => {
  const [cfg, appInfo] = await Promise.all([api('GET', '/api/config'), api('GET', '/api/app').catch(() => null)]);
  state.config = cfg;
  const form = $('#settingsForm');
  fillLevelSelects(form);
  form.autonomy.value = cfg.autonomy;
  form.autonomy.onchange?.();
  form.taskTimeoutMinutes.value = cfg.taskTimeoutMinutes ?? 30;
  form.maxFixRounds.value = cfg.maxFixRounds ?? 1;

  // Coordinadora y Orquestación
  const coordSel = $('#settingsCoordinatorSel');
  if (coordSel) {
    const defCoord = cfg.orchestration?.defaultCoordinator || cfg.defaultAgent || 'claude';
    coordSel.innerHTML = state.agents
      .filter((a) => a.enabled !== false)
      .map((a) => `<option value="${esc(a.id)}" ${a.id === defCoord ? 'selected' : ''}>${esc(a.name)}</option>`)
      .join('');
  }
  form.orchCrossReview.checked = cfg.orchestration?.crossReview !== false;
  form.orchAdversarial.checked = Boolean(cfg.orchestration?.adversarial);
  form.orchAutoApprove.checked = cfg.orchestration?.autoApprove !== false;

  // Compactación
  form.compactionEnabled.checked = cfg.compaction?.enabled !== false;
  form.compactionThreshold.value = cfg.compaction?.thresholdChars ?? 60000;
  form.compactionKeepRecent.value = cfg.compaction?.keepRecent ?? 12;

  // Git
  form.gitAutoInit.checked = cfg.git?.autoInit !== false;
  form.gitAutoClean.checked = Boolean(cfg.git?.autoCleanWorktrees);
  form.gitBranchPrefix.value = cfg.git?.branchPrefix ?? 'aiteam/';

  // Skills y Reglas
  form.projectRulesEnabled.checked = cfg.projectRules?.enabled !== false;
  form.projectRulesMaxChars.value = cfg.projectRules?.maxChars ?? 20000;
  const recipesBox = $('#settingsRecipesList');
  if (recipesBox && typeof TEAM_RECIPES !== 'undefined') {
    recipesBox.innerHTML = TEAM_RECIPES.map(
      (r, idx) => `<div class="settings-recipe-item">
        <div>
          <b>${esc(r.title)}</b>
          <div class="muted small-text">${esc(r.subtitle)}</div>
        </div>
        <button type="button" class="small ghost" data-run-settings-recipe="${idx}">Usar receta</button>
      </div>`,
    ).join('');
  }

  // Terminal y Web Preview
  form.defaultPreviewUrl.value = cfg.editor?.defaultPreviewUrl || localStorage.getItem('aiteam.previewUrl') || 'http://localhost:3000';

  // Entrada y Apariencia
  form.sendWithEnter.checked = cfg.editor?.sendWithEnter !== false;
  form.spellcheck.checked = cfg.editor?.spellcheck !== false;
  if ($('#uiDensitySel')) {
    $('#uiDensitySel').value = localStorage.getItem('aiteam.density') || cfg.editor?.density || 'comfortable';
  }

  // Info del servidor y Rollback
  const srvInfo = $('#settingsServerInfo');
  if (srvInfo && appInfo) {
    srvInfo.innerHTML = `Carpeta raíz: ${esc(appInfo.root)} · PID: ${esc(appInfo.pid)} · Commit: ${esc((appInfo.head ?? '').slice(0, 8) || 'local')}`;
  }
  const rbCard = $('#settingsRollbackCard');
  if (rbCard) {
    if (appInfo?.rollback?.commit) {
      rbCard.hidden = false;
      const rbDesc = $('#settingsRollbackDesc');
      if (rbDesc) rbDesc.textContent = `Punto de restauración guardado: ${new Date(appInfo.rollback.timestamp).toLocaleString()}`;
      const rbDetails = $('#settingsRollbackDetails');
      if (rbDetails) rbDetails.innerHTML = `Commit: <code>${esc(appInfo.rollback.commit.slice(0, 8))}</code> ${appInfo.rollback.label ? `· ${esc(appInfo.rollback.label)}` : ''}`;
    } else {
      rbCard.hidden = true;
    }
  }

  renderProviderAccounts();
  renderSettingsUsagePane();

  $('#agentSettings').innerHTML = state.agents
    .map((a) => {
      const c = cfg.agents[a.id] ?? {};
      const statusText = !a.installed ? 'No instalada' : a.working === false ? 'Sin sesión' : 'Instalada';
      const statusCls = !a.installed || a.working === false ? 'err' : 'ok';
      return `<div class="agent-setting settings-card" data-agent="${a.id}">
        <div class="agent-setting-head">
          <label class="check agent-enable-label">
            <input type="checkbox" data-k="enabled" ${c.enabled !== false ? 'checked' : ''} />
            ${emblem(a.id, 20)}
            <b style="color:${a.color}">${esc(a.name)}</b>
            <span class="muted small-text">${esc(a.vendor)}</span>
          </label>
          <span class="agent-state-pill ${statusCls}">${statusText}</span>
        </div>
        <label class="form-label" ${a.custom ? 'hidden' : ''}>
          <span>Modelo <em class="muted">(vacío = el predeterminado del CLI)</em></span>
          <input data-k="model" placeholder="Automático del CLI" value="${esc(c.model ?? '')}" />
        </label>
        <label class="form-label">
          <span>En qué destaca <em class="muted">(lo leen las demás IAs al repartirse el trabajo)</em></span>
          <textarea data-k="profile" rows="2">${esc(c.profile ?? '')}</textarea>
        </label>
        <div class="caps"><span class="muted small-text">Capacidades extra (Computer Use / Imágenes):</span>${Object.entries(CAP_LABELS).map(([cap]) => `<label class="check"><input type="checkbox" data-cap="${cap}" ${(c.capabilities ?? []).includes(cap) ? 'checked' : ''} /> ${esc(CAP_TITLES[cap])}</label>`).join('')}</div>
      </div>`;
    })
    .join('');
  $('#settingsDlg').showModal();
});

$('#settingsRecipesList')?.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-run-settings-recipe]');
  if (!btn) return;
  const r = TEAM_RECIPES[Number(btn.dataset.runSettingsRecipe)];
  $('#settingsDlg')?.close();
  if (r) runTeamRecipe(r);
});

$('#saveSettings').addEventListener('click', async (e) => {
  e.preventDefault();
  const form = $('#settingsForm');
  const agents = {};
  for (const box of document.querySelectorAll('.agent-setting')) {
    agents[box.dataset.agent] = {
      enabled: box.querySelector('[data-k=enabled]').checked,
      model: box.querySelector('[data-k=model]').value.trim(),
      profile: box.querySelector('[data-k=profile]').value.trim(),
      capabilities: [...box.querySelectorAll('[data-cap]:checked')].map((x) => x.dataset.cap),
    };
  }
  const density = $('#uiDensitySel')?.value || 'comfortable';
  document.documentElement.dataset.density = density;
  localStorage.setItem('aiteam.density', density);
  if (form.defaultPreviewUrl.value.trim()) {
    localStorage.setItem('aiteam.previewUrl', form.defaultPreviewUrl.value.trim());
  }

  const payload = {
    autonomy: form.autonomy.value,
    taskTimeoutMinutes: Number(form.taskTimeoutMinutes.value) || 30,
    maxFixRounds: Number(form.maxFixRounds.value) || 0,
    orchestration: {
      defaultCoordinator: form.defaultCoordinator?.value || 'claude',
      crossReview: form.orchCrossReview.checked,
      adversarial: form.orchAdversarial.checked,
      autoApprove: form.orchAutoApprove.checked,
    },
    compaction: {
      enabled: form.compactionEnabled.checked,
      thresholdChars: Number(form.compactionThreshold.value) || 60000,
      keepRecent: Number(form.compactionKeepRecent.value) || 12,
    },
    git: {
      autoInit: form.gitAutoInit.checked,
      autoCleanWorktrees: form.gitAutoClean.checked,
      branchPrefix: form.gitBranchPrefix.value.trim() || 'aiteam/',
    },
    projectRules: {
      enabled: form.projectRulesEnabled.checked,
      maxChars: Number(form.projectRulesMaxChars.value) || 20000,
    },
    editor: {
      sendWithEnter: form.sendWithEnter.checked,
      spellcheck: form.spellcheck.checked,
      density,
      defaultPreviewUrl: form.defaultPreviewUrl.value.trim() || 'http://localhost:3000',
    },
    agents,
  };
  const saved = await api('PUT', '/api/config', payload);
  state.config = saved;
  state.defaultAutonomy = saved.autonomy ?? form.autonomy.value;
  $('#settingsDlg').close();
  await loadAgents();
  if (state.view === 'new') showNew();
  if (state.view === 'welcome') showWelcome();
});

// ------------------------------------------------------------ conversaciones (chat de equipo)

state.chats = [];
state.chat = null;
state.live = {}; // actividad en curso de la conversación abierta

async function loadChats() {
  state.chats = await api('GET', '/api/chats');
  renderChatList();
}

function renderChatList() {
  renderSidebar();
}

function attachFolderPicker(root, input, onPick) {
  const btn = root?.querySelector('[data-pick-folder]');
  if (!btn || !input) return;
  btn.addEventListener('click', async () => {
    const prev = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `${icon('folder', 14)} Abriendo…`;
    try {
      const res = await api('POST', '/api/projects/pick');
      if (res.path) {
        input.value = res.path;
        localStorage.setItem('aiteam.repo', res.path);
        const hint = root.querySelector('[data-folder-hint]');
        if (hint) {
          hint.hidden = !res.needs;
          hint.textContent = res.needs === 'git'
            ? 'Esta carpeta aún no tiene git: AITeam la inicializará automáticamente al continuar.'
            : res.needs === 'commit'
              ? 'Este repositorio aún no tiene un primer commit: AITeam creará un punto de partida automáticamente.'
              : '';
        }
        onPick?.(res.path);
      }
    } catch (err) {
      alert(err.message);
    } finally {
      btn.disabled = false;
      btn.innerHTML = prev;
    }
  });
}

const MODEL_OPTIONS = [
  ['', 'Modelo: Automático'],
  ['claude-opus-4-6', 'Claude Opus 4.6'],
  ['claude-sonnet-4-6', 'Claude Sonnet 4.6'],
  ['claude-haiku-4-5', 'Claude Haiku 4.5'],
  ['gpt-5.4', 'GPT-5.4 (Codex)'],
  ['o3', 'OpenAI o3'],
  ['gemini-2.5-pro', 'Gemini 2.5 Pro'],
  ['gemini-2.5-flash', 'Gemini 2.5 Flash'],
];

const EFFORT_OPTIONS = [
  ['auto', 'Esfuerzo: Auto'],
  ['low', 'Esfuerzo: Bajo'],
  ['medium', 'Esfuerzo: Medio'],
  ['high', 'Esfuerzo: Alto'],
  ['max', 'Esfuerzo: Máximo'],
];

/**
 * Conecta soporte de adjuntar imágenes (clic, pegar con Ctrl+V y arrastrar/soltar) a un compositor.
 */
function setupComposerAttachments({ boxEl, inputEl, stripEl, btnEl, fileInputEl }) {
  const list = [];
  const render = () => {
    if (!stripEl) return;
    stripEl.hidden = list.length === 0;
    stripEl.innerHTML = list
      .map(
        (item, idx) => `<div class="attach-thumb" title="${esc(item.name)}">
          <img src="${item.dataUrl}" alt="${esc(item.name)}" />
          <span class="attach-name">${esc(item.name)}</span>
          <button type="button" class="attach-remove" data-rm-attach="${idx}" title="Quitar imagen">${icon('close', 11)}</button>
        </div>`,
      )
      .join('');
  };

  const addFiles = (fileList) => {
    for (const file of fileList ?? []) {
      if (!file.type?.startsWith('image/')) continue;
      if (list.length >= 6) break;
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === 'string') {
          list.push({ name: file.name || `captura-${Date.now()}.png`, dataUrl: reader.result });
          render();
        }
      };
      reader.readAsDataURL(file);
    }
  };

  btnEl?.addEventListener('click', () => fileInputEl?.click());
  fileInputEl?.addEventListener('change', () => {
    addFiles(fileInputEl.files);
    fileInputEl.value = '';
  });
  stripEl?.addEventListener('click', (e) => {
    const rm = e.target.closest('[data-rm-attach]');
    if (!rm) return;
    list.splice(Number(rm.dataset.rmAttach), 1);
    render();
  });
  inputEl?.addEventListener('paste', (e) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const imgs = [];
    for (const it of items) {
      if (it.type?.startsWith('image/')) {
        const f = it.getAsFile();
        if (f) imgs.push(f);
      }
    }
    if (imgs.length) {
      e.preventDefault();
      addFiles(imgs);
    }
  });
  if (boxEl) {
    boxEl.addEventListener('dragover', (e) => {
      if ([...(e.dataTransfer?.items ?? [])].some((i) => i.type?.startsWith('image/'))) {
        e.preventDefault();
        boxEl.classList.add('drag-over');
      }
    });
    boxEl.addEventListener('dragleave', () => boxEl.classList.remove('drag-over'));
    boxEl.addEventListener('drop', (e) => {
      boxEl.classList.remove('drag-over');
      const imgs = [...(e.dataTransfer?.files ?? [])].filter((f) => f.type?.startsWith('image/'));
      if (imgs.length) {
        e.preventDefault();
        addFiles(imgs);
      }
    });
  }

  return {
    get items() {
      return list.slice();
    },
    clear() {
      list.length = 0;
      render();
    },
  };
}

// ---------------------------------------------------------------- Autocomplete de menciones (@) y comandos (/)
function setupComposerAutocomplete({ boxEl, inputEl, isWelcome = false }) {
  if (!boxEl || !inputEl) return;

  let menuEl = boxEl.querySelector('.composer-autocomplete-menu');
  if (menuEl) menuEl.remove();

  menuEl = document.createElement('div');
  menuEl.className = 'composer-autocomplete-menu';
  menuEl.hidden = true;
  boxEl.appendChild(menuEl);

  let activeIndex = 0;
  let currentItems = [];
  let currentMode = null; // 'mention' | 'slash'
  let tokenStart = -1;

  function hide() {
    menuEl.hidden = true;
    menuEl.innerHTML = '';
    currentItems = [];
    currentMode = null;
    tokenStart = -1;
  }

  function getMentionItems(query) {
    const list = [
      {
        type: 'mention',
        token: '@equipo',
        label: 'Todo el equipo',
        desc: 'Todas las IAs analizan y colaboran por turno',
        badge: 'Equipo',
        iconHtml: icon('users', 16),
      },
      {
        type: 'mention',
        token: '@paralelo',
        label: 'Tarea en paralelo',
        desc: 'Divide y ejecuta tareas independientes a la vez',
        badge: 'Paralelo',
        iconHtml: icon('bolt', 16),
      },
    ];

    const currentChatAgents = new Set(state.chat?.agents ?? []);
    for (const a of state.agents) {
      const handle = `@${a.handle || a.id}`;
      const inChat = currentChatAgents.has(a.id);
      list.push({
        type: 'mention',
        token: handle,
        label: a.name,
        desc: a.tagline || a.vendor || (a.installed ? 'Instalada' : 'Configurar'),
        badge: inChat ? 'En chat' : a.installed ? 'Instalada' : 'CLI',
        iconHtml: emblem(a.id, 16),
        installed: a.installed,
        inChat,
      });
    }

    if (!query) return list;
    return list.filter((it) =>
      it.token.toLowerCase().includes(query) ||
      it.label.toLowerCase().includes(query) ||
      (it.desc && it.desc.toLowerCase().includes(query))
    );
  }

  function getSlashItems(query) {
    const list = [
      // Modos y Orquestación
      {
        token: '/plan',
        label: 'Modo Planificar',
        desc: 'Solo lectura: discute arquitectura y planes antes de tocar código',
        badge: 'Modo',
        iconHtml: icon('list', 16),
      },
      {
        token: '/build',
        label: 'Modo Construir',
        desc: 'Modo estándar: permite a las IAs editar y crear archivos',
        badge: 'Modo',
        iconHtml: icon('hammer', 16),
      },
      {
        token: '/equipo',
        label: 'Lanzar Tarea de Equipo',
        desc: 'Planifica, reparte subtareas en paralelo y revisa código',
        badge: 'Orquestación',
        iconHtml: icon('users', 16),
      },
      {
        token: '/compact',
        label: 'Compactar Contexto',
        desc: 'Resume turnos antiguos para aligerar tokens y memoria',
        badge: 'Contexto',
        iconHtml: icon('archive', 16),
      },
      // Control de ejecución
      {
        token: '/pausar',
        label: 'Pausar Tarea',
        desc: 'Pausa el turno o la tarea de equipo en curso',
        badge: 'Control',
        iconHtml: icon('pause', 16),
        action: () => {
          if (state.chat?.working) api('POST', `/api/chats/${state.chat.id}/pause`).catch((err) => alert(err.message));
          else if (state.current?.status && ['planning', 'bidding', 'running', 'reviewing', 'integrating', 'attacking', 'testing'].includes(state.current.status)) {
            api('POST', `/api/runs/${state.current.id}/pause`).catch((err) => alert(err.message));
          }
        },
      },
      {
        token: '/reanudar',
        label: 'Reanudar Tarea',
        desc: 'Continúa el trabajo pausado o los turnos pendientes',
        badge: 'Control',
        iconHtml: icon('play', 16),
        action: () => {
          if (state.chat && (state.chat.paused || state.chat.pendingTurns?.length)) {
            api('POST', `/api/chats/${state.chat.id}/resume`).catch((err) => alert(err.message));
          } else if (state.current && ['paused', 'interrupted'].includes(state.current.status)) {
            api('POST', `/api/runs/${state.current.id}/resume`).then(() => openRun(state.current.id)).catch((err) => alert(err.message));
          }
        },
      },
      // Herramientas y Extensiones
      {
        token: '/mcp',
        label: 'Extensiones MCP',
        desc: 'Conectar y gestionar servidores MCP (HTTPS / Claude / Codex)',
        badge: 'Extensiones',
        iconHtml: icon('puzzle', 16),
        action: () => {
          if (state.chat) openChatTools('extensions');
          else $('#settingsBtn')?.click();
        },
      },
      {
        token: '/skills',
        label: 'Skills y Comandos',
        desc: 'Explorar o crear skills reutilizables (.aiteam/commands)',
        badge: 'Skills',
        iconHtml: icon('command', 16),
        action: () => {
          if (state.chat) openChatTools('commands');
          else openCmdPalette();
        },
      },
      {
        token: '/terminal',
        label: 'Terminal de Proyecto',
        desc: 'Ejecutar comandos en la copia de trabajo aislada',
        badge: 'Terminal',
        iconHtml: icon('terminal', 16),
        action: () => {
          if (state.chat) openChatTools('terminal');
        },
      },
      {
        token: '/versiones',
        label: 'Control de Versiones (Snapshots)',
        desc: 'Deshacer o restaurar turnos anteriores de las IAs',
        badge: 'Snapshots',
        iconHtml: icon('clock', 16),
        action: () => {
          if (state.chat) openChatTools('snapshots');
        },
      },
      {
        token: '/preview',
        label: 'Vista Previa Web',
        desc: 'Navegador interno y detector de puertos de dev server',
        badge: 'Web',
        iconHtml: icon('globe', 16),
        action: () => togglePreviewPanel(),
      },
      {
        token: '/archivos',
        label: 'Explorador de Archivos',
        desc: 'Ver archivos del proyecto o de la copia activa',
        badge: 'Archivos',
        iconHtml: icon('folder', 16),
        action: () => {
          const p = state.chat?.worktree?.path || state.chat?.repoPath || localStorage.getItem('aiteam.repo');
          if (p) openFiles(p);
        },
      },
      {
        token: '/recetas',
        label: 'Paleta de Recetas',
        desc: 'Ejecutar recetas rápidas de equipo (Ctrl+K)',
        badge: 'Recetas',
        iconHtml: icon('zap', 16),
        action: () => openCmdPalette(),
      },
      {
        token: '/rollback',
        label: 'Rollback Inmediato',
        desc: 'Deshacer en 1 clic la última auto-mejora si algo falla',
        badge: 'Seguridad',
        iconHtml: icon('refresh', 16),
        action: () => {
          $('#settingsRollbackBtn')?.click() || $('#settingsBtn')?.click();
        },
      },
      {
        token: '/doctor',
        label: 'Doctor y Diagnóstico',
        desc: 'Diagnosticar estado de agentes, sesión y CLI',
        badge: 'Salud',
        iconHtml: icon('heart', 16),
        action: () => openHelpModal(),
      },
      {
        token: '/ayuda',
        label: 'Ayuda y Atajos',
        desc: 'Ver guía de uso y atajos de teclado',
        badge: 'Guía',
        iconHtml: icon('help', 16),
        action: () => openHelpModal(),
      },
    ];

    if (!query) return list;
    return list.filter((it) =>
      it.token.toLowerCase().includes(query) ||
      it.label.toLowerCase().includes(query) ||
      (it.desc && it.desc.toLowerCase().includes(query))
    );
  }

  function renderList() {
    if (!currentItems.length) {
      hide();
      return;
    }
    if (activeIndex >= currentItems.length) activeIndex = 0;
    if (activeIndex < 0) activeIndex = currentItems.length - 1;

    const title = currentMode === 'mention' ? 'Mencionar IA o equipo (@)' : 'Comandos y herramientas (/)';
    const hint = '↑↓ para navegar · Intro para elegir · Esc para cerrar';

    menuEl.innerHTML = `
      <div class="ac-head">
        <span>${title}</span>
        <span class="ac-hint">${hint}</span>
      </div>
      <div class="ac-list" role="listbox">
        ${currentItems.map((it, idx) => `
          <button type="button" class="ac-item ${idx === activeIndex ? 'ac-active' : ''}" data-ac-idx="${idx}" role="option" aria-selected="${idx === activeIndex}">
            <div class="ac-ico">${it.iconHtml}</div>
            <div class="ac-main">
              <div class="ac-row">
                <span class="ac-label">${esc(it.label)}</span>
                <span class="ac-token">${esc(it.token)}</span>
                ${it.badge ? `<span class="ac-badge">${esc(it.badge)}</span>` : ''}
              </div>
              ${it.desc ? `<div class="ac-desc">${esc(it.desc)}</div>` : ''}
            </div>
          </button>
        `).join('')}
      </div>
    `;
    menuEl.hidden = false;

    const activeItemEl = menuEl.querySelector('.ac-item.ac-active');
    activeItemEl?.scrollIntoView({ block: 'nearest' });
  }

  function selectItem(item) {
    if (!item) return;
    const val = inputEl.value;
    const before = val.slice(0, tokenStart);
    const after = val.slice(inputEl.selectionStart);

    if (item.action) {
      inputEl.value = (before + after).trim();
      hide();
      inputEl.dispatchEvent(new Event('input'));
      item.action();
      return;
    }

    const insertion = item.token + ' ';
    inputEl.value = before + insertion + after;
    const newPos = before.length + insertion.length;
    inputEl.setSelectionRange(newPos, newPos);
    hide();
    inputEl.dispatchEvent(new Event('input'));
    inputEl.focus();
  }

  inputEl.addEventListener('input', () => {
    const cursor = inputEl.selectionStart;
    const textBefore = inputEl.value.slice(0, cursor);

    const mentionMatch = textBefore.match(/(?:^|\s)@([a-zA-Z0-9_-]*)$/);
    const slashMatch = textBefore.match(/(?:^|\s)\/([a-zA-Z0-9_-]*)$/);

    if (mentionMatch) {
      currentMode = 'mention';
      const q = mentionMatch[1].toLowerCase();
      tokenStart = cursor - mentionMatch[1].length - 1;
      currentItems = getMentionItems(q);
      activeIndex = 0;
      renderList();
    } else if (slashMatch) {
      currentMode = 'slash';
      const q = slashMatch[1].toLowerCase();
      tokenStart = cursor - slashMatch[1].length - 1;
      currentItems = getSlashItems(q);
      activeIndex = 0;
      renderList();
    } else {
      hide();
    }
  });

  inputEl.addEventListener('keydown', (e) => {
    if (menuEl.hidden || !currentItems.length) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      activeIndex = (activeIndex + 1) % currentItems.length;
      renderList();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      activeIndex = (activeIndex - 1 + currentItems.length) % currentItems.length;
      renderList();
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      if (!e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        selectItem(currentItems[activeIndex]);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      hide();
    }
  });

  menuEl.addEventListener('mousedown', (e) => {
    const btn = e.target.closest('[data-ac-idx]');
    if (!btn) return;
    e.preventDefault();
    const idx = Number(btn.dataset.acIdx);
    selectItem(currentItems[idx]);
  });

  document.addEventListener('click', (e) => {
    if (!boxEl.contains(e.target)) hide();
  });
}

function showWelcome(initialProject) {
  state.view = 'welcome';
  state.chat = null;
  state.current = null;
  renderSidebar();
  const projects = state.projects ?? [];
  const defaultPath = initialProject || localStorage.getItem('aiteam.repo') || projects[0]?.path || '';
  const defaultName = defaultPath ? defaultPath.split(/[\\/]/).pop() : 'Elegir carpeta…';
  const agents = state.agents.filter((a) => a.installed);
  const savedModel = localStorage.getItem('aiteam.model') || '';
  const savedEffort = localStorage.getItem('aiteam.effort') || 'auto';
  const main = $('#main');
  main.classList.add('welcome-active');
  main.innerHTML = `
    <div class="claude-welcome">
      <div class="welcome-top-bar">
        <span class="welcome-kicker">Nueva sesión</span>
        <div class="welcome-top-actions">
          <button type="button" class="ghost small" id="welcomePreviewBtn" title="Vista previa web en vivo y detector de puertos">${icon('globe', 14)} Vista previa</button>
          <button type="button" class="ghost small" id="welcomeFilesBtn" ${defaultPath ? '' : 'hidden'} title="Explorar archivos del proyecto">${icon('folder', 14)} Archivos</button>
          <button type="button" class="ghost small" id="welcomeCmdBtn" title="Paleta de comandos y recetas (Ctrl+K)">${icon('command', 14)} Recetas</button>
          <button type="button" class="ghost small" id="welcomeHelpBtn" title="Ver cómo funciona AITeam">${icon('help', 14)} Cómo funciona</button>
        </div>
      </div>

      <div class="welcome-stage">
        <div class="welcome-hero">
          <img src="icon-192.png" width="46" height="46" alt="" class="welcome-logo" />
          <h1>¿En qué trabajamos hoy?</h1>
          <p class="muted">Pide un resultado: AITeam coordina a tus IAs y te responde aquí mismo.</p>
        </div>

        <div class="welcome-steps">
          <div class="w-step"><span class="w-num">1</span><div><b>Elige tu carpeta</b><small>En el selector o con Examinar</small></div></div>
          <div class="w-step"><span class="w-num">2</span><div><b>Pide o encarga</b><small>Al equipo, a una IA o en paralelo</small></div></div>
          <div class="w-step"><span class="w-num">3</span><div><b>Recibe el resultado</b><small>Verás la respuesta y los archivos entregados aquí</small></div></div>
        </div>

        <div class="quick-prompts">
          <button type="button" class="prompt-chip" data-quick-prompt="Analiza este proyecto, explícame cómo está organizado y qué mejoras recomiendas." data-quick-target="equipo">
            ${icon('search', 13)} <span>Analizar con todo el equipo</span>
          </button>
          <button type="button" class="prompt-chip" data-quick-prompt="Revisa posibles errores, problemas de rendimiento o casos límite y corrígelos." data-quick-target="parallel">
            ${icon('bolt', 13)} <span>Buscar y corregir fallos en paralelo</span>
          </button>
          <button type="button" class="prompt-chip" data-quick-prompt="Mejora el diseño visual y la facilidad de uso de la interfaz principal." data-quick-target="claude">
            ${icon('palette', 13)} <span>Mejorar diseño e interfaz</span>
          </button>
        </div>
      </div>

      <form class="claude-composer" id="welcomeForm">
        <div class="composer-box pro-composer" id="welcomeComposerBox">
          <div class="composer-attachments" id="welcomeAttachments" hidden></div>
          <div class="composer-main-area">
            <textarea id="welcomeInput" rows="2" placeholder="Describe una tarea, pega una captura (Ctrl+V) o pregunta a tu equipo…"></textarea>
          </div>
          <div class="composer-toolbar">
            <div class="composer-toolbar-left">
              <div class="composer-pill" title="Carpeta del proyecto donde trabajarán las IAs">
                ${icon('folder', 13)}
                <select id="welcomeProjectSel" class="pill-native-select">
                  ${projects.map((p) => `<option value="${esc(p.path)}" ${normPath(p.path) === normPath(defaultPath) ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}
                  ${defaultPath && !projects.some((p) => normPath(p.path) === normPath(defaultPath)) ? `<option value="${esc(defaultPath)}" selected>${esc(defaultName)}</option>` : ''}
                  <option value="__pick__">Examinar carpeta…</option>
                </select>
              </div>
              <div class="composer-pill" title="Qué permisos tienen las IAs">
                ${icon('lock', 13)}
                <select id="welcomeAutonomySel" class="pill-native-select" data-levels></select>
              </div>
              <div class="composer-pill" title="Modelo preferido para la sesión">
                ${icon('cpu', 13)}
                <select id="welcomeModelSel" class="pill-native-select">
                  ${MODEL_OPTIONS.map(([val, lbl]) => `<option value="${esc(val)}" ${val === savedModel ? 'selected' : ''}>${esc(lbl.replace('Automático del CLI', 'Modelo: Auto').replace('Haiku / Flash (rápido)', 'Rápido').replace('Sonnet / Pro (equilibrado)', 'Equilibrado').replace('Opus (máxima capacidad)', 'Opus'))}</option>`).join('')}
                </select>
              </div>
              <div class="composer-pill" title="Modo de ejecución">
                ${icon('bolt', 13)}
                <select id="welcomeTargetSel" class="pill-native-select">
                  <option value="auto">Automático</option>
                  <option value="equipo">Todo el equipo (@equipo)</option>
                  <option value="parallel">En paralelo</option>
                  ${agents.map((a) => `<option value="agent:${esc(a.handle ?? a.id)}">Solo ${esc(a.name)}</option>`).join('')}
                </select>
              </div>
              <div class="composer-pill pill-subtle" title="Nivel de esfuerzo y razonamiento (Claude / Codex)">
                ${icon('brain', 13)}
                <select id="welcomeEffortSel" class="pill-native-select">
                  ${EFFORT_OPTIONS.map(([val, lbl]) => `<option value="${esc(val)}" ${val === savedEffort ? 'selected' : ''}>${esc(lbl.replace('Automático', 'Esfuerzo: Auto'))}</option>`).join('')}
                </select>
              </div>
            </div>
            <div class="composer-toolbar-right">
              <input type="file" id="welcomeAttachInput" accept="image/*" multiple hidden />
              <button type="button" class="composer-tool-btn" id="welcomeAttachBtn" title="Adjuntar imagen o captura (o pega con Ctrl+V)">${icon('image', 16)}</button>
              <button type="button" class="composer-tool-btn" id="welcomeMic" title="Dictar por voz (Ctrl+M)">${icon('mic', 16)}</button>
              <button type="submit" class="composer-send-btn primary" id="welcomeSubmit" title="Empezar sesión (Intro)">
                <span>Empezar</span>
                ${icon('send', 13)}
              </button>
            </div>
          </div>
        </div>
        <p class="error" id="welcomeError" hidden></p>
      </form>
    </div>`;

  fillLevelSelects(main);
  const autSel = $('#welcomeAutonomySel');
  if (autSel) autSel.value = state.defaultAutonomy;

  $('#welcomeModelSel')?.addEventListener('change', (e) => localStorage.setItem('aiteam.model', e.target.value));
  $('#welcomeEffortSel')?.addEventListener('change', (e) => localStorage.setItem('aiteam.effort', e.target.value));

  const projSel = $('#welcomeProjectSel');
  projSel.addEventListener('change', async () => {
    if (projSel.value !== '__pick__') {
      localStorage.setItem('aiteam.repo', projSel.value);
      $('#welcomeFilesBtn').hidden = !projSel.value;
      return;
    }
    try {
      const res = await api('POST', '/api/projects/pick');
      if (res.path) {
        await api('POST', '/api/projects', { path: res.path, prepare: true });
        localStorage.setItem('aiteam.repo', res.path);
        await loadProjects();
        showWelcome(res.path);
      } else {
        projSel.value = defaultPath || '';
      }
    } catch (err) {
      alert(err.message);
      projSel.value = defaultPath || '';
    }
  });

  $('#welcomePreviewBtn')?.addEventListener('click', () => togglePreviewPanel());
  $('#welcomeCmdBtn')?.addEventListener('click', () => openCmdPalette());
  $('#welcomeFilesBtn')?.addEventListener('click', () => {
    if (projSel.value && projSel.value !== '__pick__') openFiles(projSel.value, 'proyecto original');
  });
  $('#welcomeHelpBtn')?.addEventListener('click', openHelpModal);

  const input = $('#welcomeInput');
  const autoResize = (ta) => {
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 180) + 'px';
  };
  input.addEventListener('input', () => autoResize(input));

  const welcomeAttach = setupComposerAttachments({
    boxEl: $('#welcomeComposerBox'),
    inputEl: input,
    stripEl: $('#welcomeAttachments'),
    btnEl: $('#welcomeAttachBtn'),
    fileInputEl: $('#welcomeAttachInput'),
  });
  setupComposerAutocomplete({
    boxEl: $('#welcomeComposerBox'),
    inputEl: input,
    isWelcome: true,
  });
  const mic = attachDictation(input, $('#welcomeMic'));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      $('#welcomeForm').requestSubmit();
    }
  });

  main.querySelectorAll('[data-quick-prompt]').forEach((chip) => {
    chip.addEventListener('click', () => {
      input.value = chip.dataset.quickPrompt;
      autoResize(input);
      const t = chip.dataset.quickTarget;
      const targetSel = $('#welcomeTargetSel');
      if (t === 'parallel') targetSel.value = 'parallel';
      else if (t === 'equipo') targetSel.value = 'equipo';
      else if (t) {
        const opt = [...targetSel.options].find((o) => o.value === `agent:${t}`);
        if (opt) targetSel.value = opt.value;
      }
      input.focus();
    });
  });

  $('#welcomeForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    mic.stop();
    const errEl = $('#welcomeError');
    errEl.hidden = true;
    let repoPath = projSel.value;
    if (!repoPath || repoPath === '__pick__') {
      const picked = await api('POST', '/api/projects/pick');
      if (!picked.path) return;
      repoPath = picked.path;
    }
    const attachments = welcomeAttach.items;
    const rawText = input.value.trim() || (attachments.length ? 'Analiza las imágenes adjuntas.' : '');
    const target = $('#welcomeTargetSel').value;
    const autonomy = $('#welcomeAutonomySel').value || state.defaultAutonomy;
    const model = $('#welcomeModelSel')?.value || '';
    const effort = $('#welcomeEffortSel')?.value || 'auto';
    const btn = $('#welcomeSubmit');
    btn.disabled = true;
    try {
      await api('POST', '/api/projects', { path: repoPath, prepare: true });
      localStorage.setItem('aiteam.repo', repoPath);
      await loadProjects();
      if (target === 'parallel' && rawText && !attachments.length) {
        const chosen = usableAgents();
        const run = await api('POST', '/api/runs', {
          repoPath,
          goal: rawText,
          agents: chosen.length ? chosen : state.agents.filter((a) => a.installed).map((a) => a.id),
          coordinator: chosen[0] ?? 'claude',
          autonomy,
          review: true,
          autoApprove: true,
        });
        await loadRuns();
        return openRun(run.id);
      }
      const chat = await api('POST', '/api/chats', { repoPath, agents: usableAgents(), autonomy });
      if ((autonomy && autonomy !== chat.autonomy) || model || effort !== 'auto') {
        await api('PATCH', `/api/chats/${chat.id}`, { autonomy, model, effort }).catch(() => {});
      }
      welcomeAttach.clear();
      await loadChats();
      await openChat(chat.id);
      if (rawText || attachments.length) {
        const formatted = formatTargetedMessage(rawText, target);
        await api('POST', `/api/chats/${chat.id}/messages`, { text: formatted, attachments, model, effort });
      }
    } catch (err) {
      errEl.textContent = err.message;
      errEl.hidden = false;
      btn.disabled = false;
    }
  });
  input.focus();
}

function formatTargetedMessage(text, target) {
  if (!text) return '';
  if (/^(@\w+|\/\w+)/.test(text)) return text;
  if (target === 'equipo') return `@equipo ${text}`;
  if (target === 'parallel') return `/equipo ${text}`;
  if (target?.startsWith('agent:')) return `@${target.slice(6)} ${text}`;
  return text;
}

function showNewChat() {
  showWelcome();
}

/** Markdown mínimo: bloques de código, `código`, **negrita** y menciones. */
function md(text) {
  const parts = String(text ?? '').split(/```(\w*)\n?([\s\S]*?)```/g);
  let html = '';
  for (let i = 0; i < parts.length; i++) {
    if (i % 3 === 0) {
      html += esc(parts[i])
        .replace(/`([^`\n]+)`/g, '<code>$1</code>')
        .replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>')
        .replace(/(^|\s)@([a-z][a-z0-9_]*)\b/gi, (m, pre, name) => {
          const id = { chatgpt: 'codex', antigravity: 'gemini', agy: 'gemini' }[name.toLowerCase()] ?? name.toLowerCase();
          if (!['equipo', 'todos'].includes(id) && !state.agents.some((a) => a.id === id)) return m;
          const color = state.agents.find((a) => a.id === id)?.color ?? 'var(--accent)';
          return `${pre}<span class="mention" style="color:${color}">@${name}</span>`;
        })
        .replace(/\n/g, '<br>');
    } else if (i % 3 === 2) {
      html += `<pre class="code"><code>${esc(parts[i])}</code></pre>`;
    }
  }
  return html;
}

async function openChat(id) {
  $('#main').innerHTML = '<section class="panel empty-state" role="status"><h2>Cargando conversación…</h2><p class="muted">Recuperando los mensajes y el estado del equipo.</p></section>';
  let chat;
  try { chat = await api('GET', `/api/chats/${id}`); }
  catch (err) {
    $('#main').innerHTML = `<section class="panel empty-state" role="alert"><h2>No se pudo abrir la conversación</h2><p class="error">${esc(err.message)}</p><button class="primary" id="retryOpenChat">Reintentar</button></section>`;
    $('#retryOpenChat').addEventListener('click', () => openChat(id));
    return;
  }
  state.chat = chat;
  state.current = null;
  state.view = 'chat';
  state.live = {};
  localStorage.setItem('aiteam.chat', id);
  renderChatList();
  renderRunList();

  const projName = (chat.repoPath ?? '').split(/[\\/]/).pop() || 'Proyecto';
  const targetKey = `aiteam.target.${id}`;

  const main = $('#main');
  main.classList.remove('welcome-active');
  main.innerHTML = `
    <div class="chat">
      <div class="chat-head" id="chatHead"></div>
      <div class="chat-msgs" id="chatMsgs"></div>
      <form class="claude-composer chat-composer" id="composer">
        <div class="composer-box pro-composer" id="chatComposerBox">
          <div class="composer-target-strip" id="mentionBar"></div>
          <div class="composer-attachments" id="chatAttachments" hidden></div>
          <div class="composer-main-area">
            <textarea id="chatInput" rows="2" placeholder="Describe una tarea o haz una pregunta…"></textarea>
          </div>
          <div class="composer-toolbar">
            <div class="composer-toolbar-left">
              <button type="button" class="composer-pill composer-pill-btn" id="composerProjectBtn" title="${esc(chat.repoPath)} · Clic para ver archivos">
                ${icon('folder', 13)} <span>${esc(projName)}</span>
              </button>
              <div class="composer-pill" title="Nivel de permisos de las IAs">
                ${icon('lock', 13)}
                <select id="composerAutonomy" class="pill-native-select"></select>
              </div>
              <div class="composer-pill" title="Modelo preferido">
                ${icon('cpu', 13)}
                <select id="composerModel" class="pill-native-select"></select>
              </div>
              <div class="composer-pill pill-subtle" title="Nivel de razonamiento profundo">
                ${icon('brain', 13)}
                <select id="composerEffort" class="pill-native-select"></select>
              </div>
              <button type="button" class="composer-pill composer-pill-btn" id="composerToolsBtn" title="Terminal, extensiones MCP y versiones">
                ${icon('terminal', 13)} <span>Herramientas</span>
              </button>
            </div>
            <div class="composer-toolbar-right">
              <input type="file" id="chatAttachInput" accept="image/*" multiple hidden />
              <button type="button" class="composer-tool-btn" id="chatAttachBtn" title="Adjuntar imagen o captura (o pega con Ctrl+V)">${icon('image', 16)}</button>
              <button type="button" class="composer-tool-btn" id="chatMic" title="Dictar por voz (Ctrl+M)" aria-label="Dictar por voz">${icon('mic', 16)}</button>
              <button class="composer-send-btn primary" type="submit" title="Enviar mensaje (Intro)">
                <span>Enviar</span>
                ${icon('send', 13)}
              </button>
            </div>
          </div>
        </div>
      </form>
    </div>`;

  const renderTargetStrip = () => {
    const cur = localStorage.getItem(targetKey) || 'auto';
    const items = [
      { key: 'auto', label: 'Automático', desc: 'Responde la IA más adecuada o la última que habló', iconHtml: icon('chat', 14) },
      { key: 'equipo', label: 'Todo el equipo', desc: 'Todas las IAs responden por turno', iconHtml: icon('users', 14) },
      { key: 'parallel', label: 'Tarea en paralelo', desc: 'Se reparten subtareas y revisan el resultado', iconHtml: icon('bolt', 14) },
      ...chat.agents.map((a) => {
        const info = agentInfo(a);
        return { key: `agent:${info.handle ?? a}`, label: info.name, desc: info.tagline ?? info.vendor ?? '', iconHtml: emblem(a, 16) };
      }),
    ];
    $('#mentionBar').innerHTML =
      `<span class="target-strip-label">¿A quién le hablas?</span>` +
      items
        .map(
          (it) => `<button type="button" class="target-chip ${cur === it.key ? 'selected' : ''}" data-target-mode="${esc(it.key)}" title="${esc(it.desc)}">
            ${it.iconHtml}<span>${esc(it.label)}</span>
          </button>`,
        )
        .join('');
    const input = $('#chatInput');
    if (input) {
      const ph = {
        auto: 'Escribe tu mensaje o pega una imagen (Ctrl+V)…',
        equipo: 'Pregunta a todo el equipo… (todas las IAs darán su punto de vista)',
        parallel: 'Describe el objetivo completo… (se dividirá en subtareas en paralelo)',
      }[cur] || `Escribe a ${cur.replace('agent:', '@')}…`;
      input.placeholder = ph;
    }
  };
  renderTargetStrip();

  $('#mentionBar').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-target-mode]');
    if (!btn) return;
    localStorage.setItem(targetKey, btn.dataset.targetMode);
    renderTargetStrip();
    $('#chatInput')?.focus();
  });

  $('#composerProjectBtn')?.addEventListener('click', () => openFiles(chat.worktree.path, 'copia de la conversación'));
  $('#composerToolsBtn')?.addEventListener('click', openChatTools);

  const input = $('#chatInput');
  const autoResizeChat = (ta) => {
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 200) + 'px';
  };
  input.addEventListener('input', () => autoResizeChat(input));

  const chatAttach = setupComposerAttachments({
    boxEl: $('#chatComposerBox'),
    inputEl: input,
    stripEl: $('#chatAttachments'),
    btnEl: $('#chatAttachBtn'),
    fileInputEl: $('#chatAttachInput'),
  });
  setupComposerAutocomplete({
    boxEl: $('#chatComposerBox'),
    inputEl: input,
    isWelcome: false,
  });
  const draftKey = `aiteam.draft.${id}`;
  input.value = localStorage.getItem(draftKey) ?? '';
  autoResizeChat(input);
  input.addEventListener('input', () => localStorage.setItem(draftKey, input.value));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      $('#composer').requestSubmit();
    }
  });
  const mic = attachDictation(input, $('#chatMic'));
  $('#composer').addEventListener('submit', async (e) => {
    e.preventDefault();
    mic.stop();
    const attachments = chatAttach.items;
    const raw = input.value.trim() || (attachments.length ? 'Analiza las imágenes adjuntas.' : '');
    if (!raw && !attachments.length) return;
    const mode = localStorage.getItem(targetKey) || 'auto';
    const text = formatTargetedMessage(raw, mode);
    const model = $('#composerModel')?.value ?? state.chat?.model ?? '';
    const effort = $('#composerEffort')?.value ?? state.chat?.effort ?? 'auto';
    input.value = '';
    chatAttach.clear();
    localStorage.removeItem(draftKey);
    if (mode === 'parallel') {
      localStorage.setItem(targetKey, 'auto');
      renderTargetStrip();
    }
    try {
      await api('POST', `/api/chats/${id}/messages`, { text, attachments, model, effort });
    } catch (err) {
      input.value = raw;
      alert(err.message);
    }
  });

  renderChat(true);
  input.focus();
}

function syncComposerAutonomy() {
  const sel = $('#composerAutonomy');
  if (!sel || !state.chat) return;
  const cur = state.chat.autonomy ?? state.defaultAutonomy;
  const labels = {
    edits: 'Solo archivos',
    project: 'Comandos',
    full: 'Control total',
  };
  sel.innerHTML = state.levels
    .map((l) => `<option value="${l.id}" ${l.id === cur ? 'selected' : ''}>${esc(labels[l.id] ?? l.label)}</option>`)
    .join('');
  sel.onchange = async () => {
    const value = sel.value;
    if (!value || value === cur) return;
    if (
      value === 'full' &&
      !confirm('Con "Control total" las IAs pueden ejecutar cualquier comando e instalar programas sin pedir permiso. ¿Activarlo en esta conversación?')
    ) {
      sel.value = cur;
      return;
    }
    await api('PATCH', `/api/chats/${state.chat.id}`, { autonomy: value });
  };

  const modelSel = $('#composerModel');
  if (modelSel) {
    const curModel = state.chat.model ?? localStorage.getItem('aiteam.model') ?? '';
    modelSel.innerHTML = MODEL_OPTIONS.map(([val, lbl]) => `<option value="${esc(val)}" ${val === curModel ? 'selected' : ''}>${esc(lbl)}</option>`).join('');
    modelSel.onchange = async () => {
      const model = modelSel.value;
      localStorage.setItem('aiteam.model', model);
      state.chat.model = model;
      await api('PATCH', `/api/chats/${state.chat.id}`, { model }).catch(() => {});
    };
  }

  const effortSel = $('#composerEffort');
  if (effortSel) {
    const curEffort = state.chat.effort ?? localStorage.getItem('aiteam.effort') ?? 'auto';
    effortSel.innerHTML = EFFORT_OPTIONS.map(([val, lbl]) => `<option value="${esc(val)}" ${val === curEffort ? 'selected' : ''}>${esc(lbl)}</option>`).join('');
    effortSel.onchange = async () => {
      const effort = effortSel.value;
      localStorage.setItem('aiteam.effort', effort);
      state.chat.effort = effort;
      await api('PATCH', `/api/chats/${state.chat.id}`, { effort }).catch(() => {});
    };
  }
}

function renderChatHead() {
  const chat = state.chat;
  syncComposerAutonomy();
  const projName = (chat.repoPath ?? '').split(/[\\/]/).pop() || '';
  const members = chat.agents
    .map((a) => {
      const st = chat.exhausted?.[a] ? badge([chat.exhausted[a].kind === 'auth' ? 'sin sesión' : 'sin cuota', 'err']) : chat.working?.agent === a ? badge(['trabajando', 'run']) : '';
      return `<span class="member" title="${esc(agentInfo(a).name)}">${emblem(a, 16)}<span class="member-name">${esc(agentInfo(a).name)}</span>${st}</span>`;
    })
    .join('');
  $('#chatHead').innerHTML = `
    <div class="chat-identity">
      <div class="chat-title-row">
        <span class="chat-title" title="${esc(chat.title)}">${esc(chat.title)}</span>
        <span class="chat-proj-badge" title="${esc(chat.repoPath)}">${esc(projName)}</span>
      </div>
      <div class="members">${members}</div>
    </div>
    <div class="actions chat-actions">
      ${chat.working
        ? `<button class="warn small" id="chatPause" title="Pausar temporalmente las IAs">${icon('pause', 13)} <span>Pausar</span></button>
           <button class="danger small" id="chatStop" title="Detener y cancelar turno">${icon('stop', 13)} <span>Detener</span></button>`
        : (chat.paused || (chat.pendingTurns && chat.pendingTurns.length > 0))
          ? `<button class="primary small" id="chatResumeHead" title="Reanudar el trabajo del equipo">${icon('play', 13)} <span>Reanudar</span></button>`
          : ''}
      <button id="chatPreview" class="ghost small" title="Vista previa web en vivo y servidores locales">${icon('globe', 15)} Vista previa</button>
      <button id="chatFiles" class="ghost small" title="Explorar los archivos de esta copia">${icon('folder', 15)} Archivos</button>
      <button id="chatTools" class="ghost small" title="Terminal, comandos y versiones">${icon('terminal', 15)} Herramientas</button>
      <button id="chatDiff" class="ghost small" title="Abrir los cambios que hayan quedado pendientes">${icon('fileDiff', 15)} Cambios pendientes</button>
      <details class="chat-more">
        <summary aria-label="Más opciones" title="Más opciones">⋯</summary>
        <div class="chat-more-menu">
          <div class="muted small-text">Copia aislada de trabajo</div>
          <div class="mono small-text chat-path">${esc(chat.repoPath)}<br>Rama: ${esc(chat.worktree.branch)}</div>
          <button class="ghost" id="chatHelpMenu">${icon('help', 14)} Cómo funciona esta ventana</button>
          <button class="ghost danger" id="chatDelete" title="Borra la conversación y su copia de trabajo (la rama se conserva)">Eliminar conversación</button>
        </div>
      </details>
    </div>`;
  $('#chatPause')?.addEventListener('click', () => api('POST', `/api/chats/${chat.id}/pause`).catch((err) => alert(err.message)));
  $('#chatResumeHead')?.addEventListener('click', () => api('POST', `/api/chats/${chat.id}/resume`).catch((err) => alert(err.message)));
  $('#chatStop')?.addEventListener('click', () => api('POST', `/api/chats/${chat.id}/stop`).catch((err) => alert(err.message)));
  $('#chatPreview')?.addEventListener('click', () => togglePreviewPanel());
  $('#chatDiff').addEventListener('click', () => openReview('chats', chat.id));
  $('#chatFiles').addEventListener('click', () => openFiles(chat.worktree.path, 'copia de la conversación'));
  $('#chatTools').addEventListener('click', openChatTools);
  $('#chatHelpMenu')?.addEventListener('click', openHelpModal);
  $('#chatDelete').addEventListener('click', async () => {
    if (!confirm('¿Eliminar esta conversación? Se borra su copia de trabajo; la rama git se conserva.')) return;
    await api('DELETE', `/api/chats/${chat.id}`);
    localStorage.removeItem('aiteam.chat');
    await loadChats();
    state.chats.length ? openChat(state.chats[0].id) : showWelcome();
  });
}

function messageHtml(m) {
  if (m.from === 'system') {
    if (m.meta?.runId) return `<div class="run-card" data-run-card="${esc(m.meta.runId)}">${runCardHtml(state.runDetails.get(m.meta.runId) ?? state.runs.find((r) => r.id === m.meta.runId))}</div>`;
    return `<div class="sys ${m.kind === 'error' ? 'error' : ''}">${esc(m.text)}</div>`;
  }
  if (m.from === 'user') {
    const userImgs = Array.isArray(m.meta?.attachments) ? m.meta.attachments : [];
    const userThumbs = userImgs.length && state.chat?.worktree?.path
      ? `<div class="thumbs user-thumbs">${userImgs
          .map((f) => {
            const src = imgUrl(state.chat.worktree.path, f, m.id);
            return `<figure class="thumb checker" title="Clic para ampliar"><img src="${src}" alt="${esc(f)}" loading="lazy" data-zoom="${src}" data-name="${esc(f)}" /></figure>`;
          })
          .join('')}</div>`
      : '';
    return `<div class="bubble-row user"><div class="bubble">${userThumbs}${md(m.text)}<div class="when">${fmtTime(m.ts)}</div></div><div class="avatar">${userAvatar(32)}</div></div>`;
  }
  const a = agentInfo(m.from);
  const to = m.to?.length ? ` <span class="muted">→ ${m.to.map((t) => `<span style="color:${agentInfo(t).color}">@${esc(agentInfo(t).handle ?? t)}</span>`).join(', ')}</span>` : '';
  const meta = m.meta ?? {};
  const images = meta.changed ? messageFiles(meta).filter(isImage) : [];
  const response = String(m.text ?? '').trim();
  const fileCount = meta.files?.length ?? (meta.changed ? messageFiles(meta).length : 0);
  const delivery = meta.delivery;
  const deliveryText = delivery?.status === 'applied'
    ? `Cambios aplicados al proyecto · ${delivery.files} archivo(s)${delivery.selfUpdate ? ' · Reinicia AITeam para cargar el código nuevo' : ''}`
    : delivery?.status === 'pending'
      ? `Cambios pendientes: ${delivery.reason}`
      : fileCount ? `${fileCount} archivo(s) modificados` : '';
  const extras = [
    images.length
      ? `<div class="thumbs">${images
          .map((f) => {
            const src = imgUrl(state.chat.worktree.path, f, m.id);
            return `<figure class="thumb checker" title="Clic para ampliar"><img src="${src}" alt="${esc(f)}" loading="lazy" data-zoom="${src}" data-name="${esc(f)}" onerror="this.closest('figure').remove()" /><figcaption>${esc(f.split('/').pop())}</figcaption></figure>`;
          })
          .join('')}</div>`
      : '',
    meta.changed ? `<details><summary>${icon('file', 13)} Ver cambios (${fileCount || 0} archivos)</summary><pre class="output">${esc(meta.stat)}</pre></details>` : '',
    meta.activity?.length ? `<details><summary>Pasos realizados (${meta.activity.length})</summary><div class="activity">${meta.activity.map((l) => `<div>${iconizeLine(l, esc)}</div>`).join('')}</div></details>` : '',
  ].join('');
  return `<div class="bubble-row agent">
    <div class="avatar">${emblem(m.from, 32)}</div>
    <div class="bubble" style="border-left-color:${a.color}">
      <div class="who"><b style="color:${a.color}">${esc(a.name)}</b>${to} <span class="when">${fmtTime(m.ts)}${meta.durationMs ? ` · ${Math.round(meta.durationMs / 1000)}s` : ''}</span></div>
      ${deliveryText ? `<div class="reply-result"><span>${icon(delivery?.status === 'pending' ? 'alert' : 'check', 12)} ${esc(deliveryText)}</span></div>` : ''}
      <div class="text">${md(response)}</div>
      ${extras}
      <div class="reply-actions">${meta.changed ? `<button class="small" data-chat-files="${esc(state.chat.id)}" data-delivered="${delivery?.status === 'applied' ? 'true' : 'false'}">Ver archivos</button>${delivery?.status === 'pending' ? `<button class="small primary" data-chat-review="${esc(state.chat.id)}">Resolver cambios pendientes</button>` : ''}` : ''}<button class="small ghost" data-chat-adjust="${esc(m.id)}" data-adjust-agent="${esc(m.from)}">Pedir ajustes</button></div>
    </div>
  </div>`;
}

function teamConversationHtml(run, limit = 8) {
  const messages = (run.messages ?? []).filter((m) => m.kind !== 'heartbeat');
  const asks = messages.filter((m) => m.kind === 'ask' && m.to === 'user' && m.status === 'pending');
  const gates = (run.gates ?? []).filter((g) => g.status === 'pending' && g.kind !== 'plan_approval');
  const attention = [
    ...asks.map((m) => `<form class="team-question" data-bus-reply="${esc(run.id)}" data-ask-id="${esc(m.id)}"><b>${esc(agentInfo(m.from).name)} te pregunta:</b><p>${esc(m.text)}</p><div class="actions"><input name="text" required placeholder="Tu respuesta…"><button class="primary small">Responder</button></div></form>`),
    ...gates.map((g) => `<div class="team-question"><b>El equipo necesita una decisión:</b><p>${esc(g.question)}</p><div class="actions">${(g.options ?? []).map((choice) => `<button class="small" data-bus-gate="${esc(run.id)}" data-gate-id="${esc(g.id)}" data-choice="${esc(choice)}">${esc(choice)}</button>`).join('')}</div></div>`),
  ].join('');
  const thread = messages.slice(-limit).map((m) => {
    const from = m.from === 'user' ? 'Tú' : m.from === 'aiteam' ? 'AITeam' : agentInfo(m.from).name;
    const to = m.to === 'all' ? 'equipo' : m.to === 'user' ? 'ti' : agentInfo(m.to).name;
    return `<div class="team-message"><div class="muted small-text">${esc(from)} → ${esc(to)} · ${fmtTime(m.ts)}</div><div>${esc(m.text)}</div></div>`;
  }).join('');
  return `${attention}${messages.length ? `<details class="team-conversation"><summary>Conversación interna del equipo (${messages.length} mensajes)</summary><div>${thread}</div></details>` : ''}`;
}

function runCardHtml(run) {
  if (!run) return '<span class="muted">Cargando tarea del equipo…</span>';
  const total = run.tasks?.length ?? 0;
  const done = run.tasks?.filter((t) => t.status === 'done').length ?? 0;
  const waiting = run.status === 'awaiting_approval';
  const isDone = run.status === 'done';
  const ready = isDone && Boolean(run.integration);
  const applied = ready && (run.delivery?.status === 'applied' || state.runChanges.get(run.id)?.applied);
  const isPaused = run.status === 'paused';
  const isActive = ['planning', 'bidding', 'running', 'reviewing', 'integrating', 'attacking', 'testing'].includes(run.status);
  const failed = ['interrupted', 'failed', 'cancelled'].includes(run.status);
  const lead = applied
    ? 'Cambios aplicados al proyecto'
    : ready
      ? 'Resultado terminado con cambios pendientes'
      : isDone
        ? 'Análisis de equipo completado'
        : waiting
          ? 'El equipo espera tu aprobación'
          : isPaused
            ? 'Tarea en pausa'
            : failed
              ? 'La tarea se detuvo antes de terminar'
              : 'El equipo está trabajando en paralelo';
  const explain = ready
    ? applied
      ? `Se completaron ${done} de ${total} subtareas y los cambios ya están en tu proyecto.`
      : `Se completaron ${done} de ${total} subtareas. ${run.delivery?.reason ?? 'Los cambios siguen en la copia de trabajo.'}`
    : isDone
      ? total
        ? `Se completaron ${done} de ${total} subtareas sin modificar archivos del proyecto.`
        : 'La tarea terminó correctamente.'
      : isPaused
        ? 'La tarea se encuentra pausada temporalmente. Las subtareas terminadas y sus ramas siguen guardadas.'
        : run.status === 'interrupted'
          ? 'La aplicación se cerró mientras trabajaban. Las subtareas terminadas siguen guardadas y puedes reanudar desde ahí.'
          : failed
            ? (run.error || 'No se generó un resultado para aplicar.')
            : total
              ? `${done} de ${total} subtareas completadas. ${run.phase ?? ''}`
              : (run.phase ?? 'Organizando el reparto entre las IAs…');
  const summaries = isDone ? run.tasks?.filter((t) => t.status === 'done' && t.summary).map((t) => `<li><b>${esc(t.title)}</b>: ${esc(t.summary)}</li>`).join('') : '';
  const delivered = isDone ? run.tasks?.filter((t) => t.status === 'done' && t.summary).map((t) => t.title) ?? [] : [];
  const files = run.delivery?.changes ?? state.runChanges.get(run.id)?.files ?? [];
  const previewFiles = files.filter((f) => f.status !== 'D' && isImage(f.file))
    .sort((a, b) => Number(/candidatos?\//i.test(a.file)) - Number(/candidatos?\//i.test(b.file)))
    .slice(0, 3);
  return `<div class="run-card-top"><span class="run-card-kicker">${icon('bolt', 13)} TAREA EN EQUIPO</span>${badge(STATUS[run.status] ?? [run.status, ''])}</div>
    <h3>${esc(lead)}</h3><p>${esc(explain)}</p>
    ${delivered.length ? `<p class="run-deliveries"><b>Entregas:</b> ${esc(delivered.slice(0, 3).join(' · '))}${delivered.length > 3 ? ` · y ${delivered.length - 3} más` : ''}</p>` : ''}
    ${run.delivery?.selfUpdate ? '<p class="muted small-text">Reinicia AITeam desde Ajustes para cargar el código nuevo.</p>' : ''}
    ${run.delivery?.chatSync === 'pending' ? `<p class="error">${esc(run.delivery.chatSyncReason)}</p>` : ''}
    ${ready && files.length ? `<p class="muted small-text">${files.length} archivo(s) ${applied ? 'entregados' : 'pendientes'}</p>` : ''}
    ${previewFiles.length && run.integration?.worktree ? `<div class="run-previews">${previewFiles.map((f) => `<img src="${imgUrl(run.integration.worktree, f.file, run.id)}" alt="${esc(f.file)}" loading="lazy" data-zoom="${imgUrl(run.integration.worktree, f.file, run.id)}" data-name="${esc(f.file)}" />`).join('')}</div>` : ''}
    ${summaries ? `<div class="run-delivery-summary"><b>Qué hizo el equipo</b><ul>${summaries}</ul></div>` : ''}
    ${ready && files.length ? `<details><summary>Ver cambios</summary><ul>${files.map((f) => `<li><code>${esc(f.file)}</code> · +${f.add} / -${f.del}</li>`).join('')}</ul></details>` : ''}
    ${teamConversationHtml(run, 6)}
    <div class="actions">
      ${isActive ? `<button class="small warn" data-run-pause="${esc(run.id)}" title="Pausar la tarea temporalmente">${icon('pause', 13)} Pausar</button><button class="small danger" data-run-cancel="${esc(run.id)}" title="Cancelar la tarea">${icon('stop', 13)} Cancelar</button>` : ''}
      ${ready && !applied ? `<button class="primary small" data-run-review="${esc(run.id)}">Resolver cambios pendientes</button>` : ''}
      ${ready && applied ? `<button class="small" data-run-files="${esc(run.id)}">Ver archivos</button>` : ''}
      ${waiting ? `<button class="primary small" data-open-run="${esc(run.id)}">Aprobar reparto</button>` : ''}
      ${(run.status === 'paused' || run.status === 'interrupted') && !run.cleaned ? `<button class="small primary" data-run-resume="${esc(run.id)}" title="Reanudar tarea">${icon('play', 13)} Reanudar trabajo</button>` : ''}
      ${failed && !isPaused ? `<button class="small" data-run-retry="${esc(run.id)}">Reintentar</button>` : ''}
      <button class="small ghost" data-open-run="${esc(run.id)}">Detalles del equipo</button>
    </div>`;
}

async function hydrateRunCards() {
  const cards = [...document.querySelectorAll('[data-run-card]')];
  await Promise.all(cards.map(async (card) => {
    const id = card.dataset.runCard;
    if (!state.runDetails.has(id)) {
      try { state.runDetails.set(id, await api('GET', `/api/runs/${id}`)); }
      catch { card.innerHTML = '<span class="error">No se pudo cargar el resultado.</span>'; return; }
    }
    const run = state.runDetails.get(id);
    if (run.status === 'done' && run.integration && !state.runChanges.has(id)) {
      try { state.runChanges.set(id, await api('GET', `/api/runs/${id}/changes`)); } catch { /* la tarjeta sigue mostrando el resultado */ }
    }
    if (card.isConnected) card.innerHTML = runCardHtml(state.runDetails.get(id));
  }));
}

function liveHtml() {
  const w = state.chat.working;
  if (!w) return '';
  const a = agentInfo(w.agent);
  const lines = (state.live[w.agent] ?? []).slice(-8);
  return `<div class="bubble-row agent live">
    <div class="avatar">${emblem(w.agent, 32)}</div>
    <div class="bubble" style="border-left-color:${a.color}">
      <div class="who"><b style="color:${a.color}">${esc(a.name)}</b> <span class="typing">pensando y trabajando<span>.</span><span>.</span><span>.</span></span></div>
      <div class="activity" id="liveActivity">${lines.map((l) => `<div>${iconizeLine(l, esc)}</div>`).join('')}</div>
    </div>
  </div>`;
}

/** Oculta avisos del sistema repetidos seguidos (p. ej. cambios de modo/permisos). */
function cleanMessages(messages) {
  const out = [];
  for (const m of messages ?? []) {
    const prev = out[out.length - 1];
    if (m.from === 'system' && !m.meta?.runId && prev?.from === 'system' && !prev?.meta?.runId) {
      if (prev.text === m.text) continue;
      const isPerm = (t) => /^(Control total|Modo seguro|Permisos:)/.test(String(t ?? ''));
      if (isPerm(prev.text) && isPerm(m.text)) {
        out[out.length - 1] = m;
        continue;
      }
    }
    out.push(m);
  }
  return out;
}

function renderChat(forceScroll = false) {
  if (!state.chat || !$('#chatMsgs')) return;
  renderChatHead();
  const box = $('#chatMsgs');
  const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
  const pending = state.chat.pendingTurns?.length ?? 0;
  const isPaused = Boolean(state.chat.paused);
  const recovery = (pending || isPaused) && !state.chat.working
    ? `<div class="recovery-banner ${isPaused ? 'paused-banner' : ''}"><div><b>${isPaused ? '⏸ Tarea en pausa' : 'Trabajo pendiente'}</b><span> ${isPaused ? 'El equipo ha pausado el turno. Los cambios y ramas están a salvo.' : `${pending} turno(s) pendientes guardados. Los archivos parciales siguen en la copia.`}</span></div><button class="small primary" data-resume-chat="${esc(state.chat.id)}">${icon('play', 13)} Reanudar tarea</button></div>`
    : '';
  const visible = cleanMessages(state.chat.messages);
  box.innerHTML = recovery + (visible.length
    ? visible.map(messageHtml).join('')
    : `<section class="empty empty-state chat-empty-guide">
        <h2>Conversación lista</h2>
        <p class="muted">Elige arriba del cuadro de texto si hablas con una IA, con todo el equipo o si prefieres dividir una tarea en paralelo.</p>
        <div class="quick-prompts">
          <button type="button" class="prompt-chip" data-chat-quick="Explícame la estructura de este proyecto y por dónde empezar.">${icon('folder', 14)} <span>Explicar el proyecto</span></button>
          <button type="button" class="prompt-chip" data-chat-quick="@equipo Propongan 3 mejoras prioritarias para este repositorio.">${icon('users', 14)} <span>Pedir ideas a todo el equipo</span></button>
          <button type="button" class="prompt-chip" data-chat-quick="/equipo Revisa errores y mejora la interfaz principal.">${icon('bolt', 14)} <span>Repartir tarea en paralelo</span></button>
        </div>
      </section>`) + liveHtml();
  box.querySelectorAll('[data-chat-quick]').forEach((b) => {
    b.addEventListener('click', () => {
      const inp = $('#chatInput');
      if (inp) { inp.value = b.dataset.chatQuick; inp.focus(); }
    });
  });
  hydrateRunCards();
  if (forceScroll || nearBottom) box.scrollTop = box.scrollHeight;
}

document.addEventListener('click', (e) => {
  const adjust = e.target.closest('[data-chat-adjust]');
  if (adjust) {
    const input = $('#chatInput');
    if (input) {
      const handle = agentInfo(adjust.dataset.adjustAgent).handle ?? adjust.dataset.adjustAgent;
      input.value = `@${handle} Ajusta tu resultado anterior: `;
      input.dispatchEvent(new Event('input'));
      input.focus();
    }
    return;
  }
  const resume = e.target.closest('[data-resume-chat]');
  if (resume) return api('POST', `/api/chats/${resume.dataset.resumeChat}/resume`).catch((err) => alert(err.message));
  const chatReview = e.target.closest('[data-chat-review]');
  if (chatReview) return openReview('chats', chatReview.dataset.chatReview);
  const chatFiles = e.target.closest('[data-chat-files]');
  if (chatFiles && state.chat?.id === chatFiles.dataset.chatFiles) {
    return openFiles(chatFiles.dataset.delivered === 'true' ? state.chat.repoPath : state.chat.worktree.path,
      chatFiles.dataset.delivered === 'true' ? 'archivos del proyecto' : 'copia de la conversación');
  }
  const review = e.target.closest('[data-run-review]');
  if (review) return openReview('runs', review.dataset.runReview);
  const runFiles = e.target.closest('[data-run-files]');
  if (runFiles) {
    const run = state.runDetails.get(runFiles.dataset.runFiles);
    if (run) return openFiles(run.repoPath, 'archivos del proyecto');
  }
  const retry = e.target.closest('[data-run-retry]');
  if (retry) return retryTeamRun(state.runDetails.get(retry.dataset.runRetry));
  const pauseRun = e.target.closest('[data-run-pause]');
  if (pauseRun) {
    return api('POST', `/api/runs/${pauseRun.dataset.runPause}/pause`)
      .then((run) => { state.runDetails.set(run.id, run); renderChat(); })
      .catch((err) => alert(err.message));
  }
  const cancelRun = e.target.closest('[data-run-cancel]');
  if (cancelRun) {
    if (!confirm('¿Cancelar esta tarea del equipo?')) return;
    return api('POST', `/api/runs/${cancelRun.dataset.runCancel}/cancel`)
      .then((run) => { state.runDetails.set(run.id, run); renderChat(); })
      .catch((err) => alert(err.message));
  }
  const resumeRun = e.target.closest('[data-run-resume]');
  if (resumeRun) return api('POST', `/api/runs/${resumeRun.dataset.runResume}/resume`).then((run) => { state.runDetails.set(run.id, run); renderChat(); }).catch((err) => alert(err.message));
  const details = e.target.closest('[data-open-run]');
  if (details) return openRun(details.dataset.openRun);
});

async function refreshTeamConversation(runId) {
  const run = await api('GET', `/api/runs/${runId}`);
  state.runDetails.set(runId, run);
  if (state.current?.id === runId) { state.current = run; renderRun(); }
  const card = document.querySelector(`[data-run-card="${runId}"]`);
  if (card) card.innerHTML = runCardHtml(run);
}

document.addEventListener('submit', async (e) => {
  const form = e.target.closest('[data-bus-reply]');
  if (!form) return;
  e.preventDefault();
  const text = form.elements.text.value.trim();
  if (!text) return;
  form.querySelector('button').disabled = true;
  try {
    await api('POST', `/api/runs/${form.dataset.busReply}/asks/${form.dataset.askId}/reply`, { text });
    await refreshTeamConversation(form.dataset.busReply);
  } catch (err) { alert(err.message); form.querySelector('button').disabled = false; }
});

document.addEventListener('click', async (e) => {
  const button = e.target.closest('[data-bus-gate]');
  if (!button) return;
  button.disabled = true;
  try {
    await api('POST', `/api/runs/${button.dataset.busGate}/gates/${button.dataset.gateId}/decide`, { choice: button.dataset.choice });
    await refreshTeamConversation(button.dataset.busGate);
  } catch (err) { alert(err.message); button.disabled = false; }
});

// Las utilidades avanzadas quedan en una sola vista opcional de la conversación.
const chatToolsDlg = document.createElement('dialog');
chatToolsDlg.className = 'chat-tools-dlg';
chatToolsDlg.innerHTML = `<div class="dialog-head"><div><h2>Herramientas de la conversación</h2><p class="muted small-text">Comandos, terminal y versiones de esta copia de trabajo</p></div><button class="ghost dlg-x" data-close title="Cerrar (Esc)" aria-label="Cerrar">✕</button></div><div id="chatToolsBody"></div>`;
document.body.append(chatToolsDlg);
chatToolsDlg.querySelector('[data-close]').addEventListener('click', () => chatToolsDlg.close());
let chatToolsTab = 'commands';
let chatToolsId = null;

async function openChatTools(initialTab) {
  if (typeof initialTab === 'string' && initialTab) {
    chatToolsTab = initialTab;
  }
  chatToolsId = state.chat.id;
  chatToolsDlg.showModal();
  await renderChatTools();
}

async function renderChatTools() {
  const body = $('#chatToolsBody');
  if (!body || !chatToolsDlg.open) return;
  const id = chatToolsId;
  body.innerHTML = `<div class="seg tools-tabs">${[['commands', 'Comandos'], ['extensions', 'Extensiones'], ['terminal', 'Terminal'], ['snapshots', 'Versiones']].map(([key, label]) => `<button data-tools-tab="${key}" class="${chatToolsTab === key ? 'on' : ''}">${label}</button>`).join('')}</div><div id="toolsContent" class="tools-content"><p class="muted">Cargando…</p></div>`;
  try {
    let html = '';
    if (chatToolsTab === 'commands') {
      const data = await api('GET', `/api/chats/${id}/commands`);
      html = `<h3>Modo de trabajo</h3><p class="muted small-text">Planificar permite discutir un enfoque; Construir permite editar archivos.</p><div class="seg">${[['plan', 'Planificar'], ['build', 'Construir']].map(([key, label]) => `<button data-set-mode="${key}" class="${data.mode === key ? 'on' : ''}">${label}</button>`).join('')}</div><h3>Comandos y plugins del proyecto</h3><p class="muted small-text">Pulsa uno para colocarlo en el mensaje. Las plantillas nuevas se guardan en la copia y puedes aplicarlas al proyecto tras revisarlas.</p>${[...(data.builtin ?? []), ...(data.commands ?? [])].map((c) => `<button class="tool-command" data-insert-command="/${esc(c.name)}"><b>/${esc(c.name)}</b><span class="muted small-text">${esc(c.description ?? '')}</span></button>`).join('') || '<p class="muted">No hay comandos disponibles.</p>'}<details class="command-create"><summary>Crear comando reutilizable</summary><form id="commandForm" class="form"><div class="row"><label><span>Nombre</span><input name="name" required pattern="[a-zA-Z0-9_-]+" placeholder="revisar"></label><label><span>Descripción</span><input name="description" placeholder="Revisa un archivo"></label></div><div class="row"><label><span>IA</span><select name="agent"><option value="">Automática</option>${state.chat.agents.map((a) => `<option value="${esc(a)}">${esc(agentInfo(a).name)}</option>`).join('')}</select></label><label><span>Modo</span><select name="mode"><option value="build">Construir</option><option value="plan">Planificar</option></select></label></div><label><span>Instrucciones (usa $ARGUMENTS o $1)</span><textarea name="template" rows="4" required></textarea></label><button class="primary small">Crear comando</button></form></details>`;
    } else if (chatToolsTab === 'extensions') {
      const data = await api('GET', `/api/chats/${id}/extensions`);
      html = `<h3>Extensiones MCP del proyecto</h3><p class="muted small-text">Activa servidores MCP HTTPS para Claude y Codex en los siguientes turnos. Usa la sesión del CLI correspondiente; AITeam no guarda credenciales aquí.</p><div class="extension-list">${(data.extensions ?? []).map((x) => `<div class="extension-entry"><div><b>${esc(x.name)}</b> <span class="muted small-text">${esc(x.id)} · ${esc(x.agents.join(', '))}</span><div class="muted small-text">${esc(x.url)}</div></div><label class="check"><input type="checkbox" data-extension-toggle="${esc(x.id)}" ${x.enabled ? 'checked' : ''}> Activa</label><button class="small ghost" data-extension-delete="${esc(x.id)}">Quitar</button></div>`).join('') || '<p class="muted">Todavía no hay servidores MCP para este proyecto.</p>'}</div><form id="extensionForm" class="form extension-form"><h4>Añadir servidor MCP</h4><div class="row"><label><span>Nombre</span><input name="name" required placeholder="Documentación"></label><label><span>Identificador</span><input name="id" required pattern="[a-z][a-z0-9_]{1,31}" placeholder="docs"></label></div><label><span>URL HTTPS del servidor</span><input name="url" type="url" required placeholder="https://ejemplo.com/mcp"></label><div class="actions"><label class="check"><input type="checkbox" name="claude" checked> Claude</label><label class="check"><input type="checkbox" name="codex" checked> Codex</label><button class="primary small">Añadir</button></div></form>`;
    } else if (chatToolsTab === 'terminal') {
      const data = await api('GET', `/api/chats/${id}/terminal`);
      html = `<h3>Terminal de la conversación</h3><p class="muted small-text">Los comandos se ejecutan en la copia de trabajo de esta conversación.</p><form id="toolsTerminalForm" class="tools-terminal-form"><input name="command" required placeholder="Escribe un comando…" autocomplete="off"><button class="primary">Ejecutar</button></form><div class="tools-terminal-history">${(data.commands ?? []).slice().reverse().map((c) => `<div class="terminal-entry"><div class="terminal-entry-head"><code>${esc(c.command)}</code> ${badge([c.status ?? 'en curso', c.status === 'running' ? 'run' : c.status === 'failed' ? 'err' : 'ok'])}</div>${c.stdout || c.stderr ? `<pre class="output">${esc([c.stdout, c.stderr].filter(Boolean).join('\n').slice(-12000))}</pre>` : ''}</div>`).join('') || '<p class="muted">Todavía no se han ejecutado comandos.</p>'}</div>`;
    } else {
      const data = await api('GET', `/api/chats/${id}/snapshots`);
      html = `<h3>Versiones de la copia de trabajo</h3><p class="muted small-text">Cada versión guarda los archivos editados durante un turno. Volver a una versión cambia los archivos de esta copia.</p><div class="actions"><button data-snapshot-action="undo" ${data.cursor <= 0 ? 'disabled' : ''}>Deshacer último turno</button><button data-snapshot-action="redo" ${data.cursor >= data.turns.length ? 'disabled' : ''}>Rehacer turno</button></div><div class="tools-snapshots">${(data.turns ?? []).map((t, i) => `<div class="snapshot-entry"><div><b>Turno ${i + 1}</b> ${i < data.cursor ? badge(['actual', 'ok']) : ''}</div><span class="muted small-text">${esc((t.files ?? []).join(', ') || 'Sin archivos cambiados')}</span><button class="small" data-restore-turn="${esc(t.id)}">Volver aquí</button></div>`).join('') || '<p class="muted">Aún no hay versiones guardadas.</p>'}</div>`;
    }
    if (chatToolsId === id && chatToolsDlg.open) $('#toolsContent').innerHTML = html;
  } catch (err) {
    if (chatToolsDlg.open) $('#toolsContent').innerHTML = `<p class="error">${esc(err.message)}</p>`;
  }
}

events.addEventListener('terminal', (e) => {
  const event = JSON.parse(e.data);
  if (event.kind !== 'chats' || event.ownerId !== chatToolsId || !chatToolsDlg.open || chatToolsTab !== 'terminal') return;
  if ($('#toolsTerminalForm input')?.value) return;
  if (event.type === 'exit' || event.type === 'stdout' || event.type === 'stderr') renderChatTools();
});

chatToolsDlg.addEventListener('click', async (e) => {
  const tab = e.target.closest('[data-tools-tab]');
  if (tab) { chatToolsTab = tab.dataset.toolsTab; return renderChatTools(); }
  const toggle = e.target.closest('[data-extension-toggle]');
  if (toggle) {
    try { await api('PATCH', `/api/chats/${chatToolsId}/extensions/${toggle.dataset.extensionToggle}`, { enabled: toggle.checked }); await renderChatTools(); }
    catch (err) { alert(err.message); toggle.checked = !toggle.checked; }
    return;
  }
  const remove = e.target.closest('[data-extension-delete]');
  if (remove) {
    try { await api('DELETE', `/api/chats/${chatToolsId}/extensions/${remove.dataset.extensionDelete}`); await renderChatTools(); }
    catch (err) { alert(err.message); }
    return;
  }
  const command = e.target.closest('[data-insert-command]');
  if (command) {
    $('#chatInput').value = `${command.dataset.insertCommand} `;
    chatToolsDlg.close();
    $('#chatInput').focus();
    return;
  }
  const mode = e.target.closest('[data-set-mode]');
  if (mode) {
    try { await api('PUT', `/api/chats/${chatToolsId}/mode`, { mode: mode.dataset.setMode }); await renderChatTools(); }
    catch (err) { alert(err.message); }
    return;
  }
  const action = e.target.closest('[data-snapshot-action], [data-restore-turn]');
  if (action) {
    const name = action.dataset.snapshotAction ?? 'restore';
    if (!confirm('Esto cambiará los archivos en la copia de trabajo de la conversación. ¿Continuar?')) return;
    try { await api('POST', `/api/chats/${chatToolsId}/snapshots/${name}`, name === 'restore' ? { turnId: action.dataset.restoreTurn } : undefined); await renderChatTools(); }
    catch (err) { alert(err.message); }
  }
});

chatToolsDlg.addEventListener('submit', async (e) => {
  if (e.target.id === 'commandForm') {
    e.preventDefault();
    const f = e.target;
    try {
      await api('POST', `/api/chats/${chatToolsId}/commands`, Object.fromEntries(new FormData(f)));
      await renderChatTools();
    } catch (err) { alert(err.message); }
    return;
  }
  if (e.target.id === 'extensionForm') {
    e.preventDefault();
    const f = e.target;
    try {
      await api('POST', `/api/chats/${chatToolsId}/extensions`, {
        id: f.elements.id.value, name: f.elements.name.value, url: f.elements.url.value,
        agents: ['claude', 'codex'].filter((agent) => f.elements[agent].checked),
      });
      await renderChatTools();
    } catch (err) { alert(err.message); }
    return;
  }
  if (e.target.id !== 'toolsTerminalForm') return;
  e.preventDefault();
  const command = e.target.elements.command.value.trim();
  if (!command) return;
  e.target.querySelector('button').disabled = true;
  try { await api('POST', `/api/chats/${chatToolsId}/terminal`, { command }); await renderChatTools(); }
  catch (err) { alert(err.message); e.target.querySelector('button').disabled = false; }
});

async function showDiff(url) {
  const body = $('#diffBody');
  body.innerHTML = '<p class="muted">Cargando…</p>';
  $('#diffDlg').showModal();
  try {
    const d = await api('GET', url);
    const lines = d.diff
      .split('\n')
      .map((l) => {
        const cls = l.startsWith('+++') || l.startsWith('---') ? 'meta' : l.startsWith('+') ? 'add' : l.startsWith('-') ? 'del' : l.startsWith('@@') ? 'hunk' : l.startsWith('diff ') ? 'file' : '';
        return `<div class="${cls}">${esc(l) || ' '}</div>`;
      })
      .join('');
    body.innerHTML = d.diff.trim()
      ? `<p>Cambios de la rama <code>${esc(d.branch)}</code> respecto a <code>${esc(d.baseBranch)}</code>. Para aplicarlos a tu proyecto:</p>
         <div class="copy-row"><code>cd "${esc(d.repoPath)}" &amp;&amp; git merge ${esc(d.branch)}</code><button class="small" data-copy>Copiar</button></div>
         <pre class="output">${esc(d.stat)}</pre>
         <div class="diff">${lines}</div>`
      : '<p class="muted">Todavía no hay cambios.</p>';
    for (const btn of body.querySelectorAll('[data-copy]')) {
      btn.addEventListener('click', () => {
        navigator.clipboard.writeText(btn.previousElementSibling.textContent);
        btn.textContent = 'Copiado';
      });
    }
  } catch (err) {
    body.innerHTML = `<p class="error">${esc(err.message)}</p>`;
  }
}
$('#diffDlg [data-close]').addEventListener('click', () => $('#diffDlg').close());

events.addEventListener('chat', (e) => {
  const chat = JSON.parse(e.data);
  const summary = { id: chat.id, title: chat.title, createdAt: chat.createdAt, updatedAt: chat.updatedAt, agents: chat.agents, repoPath: chat.repoPath, working: chat.working };
  const idx = state.chats.findIndex((c) => c.id === chat.id);
  if (idx >= 0) state.chats[idx] = summary;
  else state.chats.unshift(summary);
  state.chats.sort((a, b) => (b.updatedAt ?? b.createdAt).localeCompare(a.updatedAt ?? a.createdAt));
  renderChatList();
  if (state.view === 'chat' && state.chat?.id === chat.id) {
    const prevLen = state.chat.messages.length;
    if (!chat.working) state.live = {};
    state.chat = chat;
    renderChat(chat.messages.length > prevLen && chat.messages.at(-1)?.from === 'user');
  }
});
events.addEventListener('chat-activity', (e) => {
  const { chatId, agent, text } = JSON.parse(e.data);
  if (state.view !== 'chat' || state.chat?.id !== chatId) return;
  (state.live[agent] ??= []).push(text);
  const box = $('#liveActivity');
  if (box) {
    box.innerHTML = state.live[agent].slice(-8).map((l) => `<div>${iconizeLine(l, esc)}</div>`).join('');
    const msgs = $('#chatMsgs');
    if (msgs.scrollHeight - msgs.scrollTop - msgs.clientHeight < 160) msgs.scrollTop = msgs.scrollHeight;
  }
});
events.addEventListener('chat-removed', (e) => {
  const { id } = JSON.parse(e.data);
  state.chats = state.chats.filter((c) => c.id !== id);
  renderChatList();
});

// ------------------------------------------------------------ proyectos (barra lateral)

state.projects = [];
state.usage = null;
const normPath = (p) => String(p ?? '').replace(/\//g, '\\').toLowerCase();
const collapsed = new Set(JSON.parse(localStorage.getItem('aiteam.collapsed') ?? '[]'));

async function loadProjects() {
  state.projects = await api('GET', '/api/projects');
  renderSidebar();
}

function usableAgents() {
  return state.agents.filter((a) => a.installed && a.enabled !== false && a.working !== false).map((a) => a.id);
}

let sidebarFilter = '';
let sidebarGroupMode = localStorage.getItem('aiteam.sidebarGroup') || 'folders'; // 'folders' | 'recent'
const expandedTeamAgents = new Set();

$('#sidebarSearch')?.addEventListener('input', (e) => {
  sidebarFilter = e.target.value.trim().toLowerCase();
  renderSidebar();
});
$('#toggleSidebarGroup')?.addEventListener('click', () => {
  sidebarGroupMode = sidebarGroupMode === 'folders' ? 'recent' : 'folders';
  localStorage.setItem('aiteam.sidebarGroup', sidebarGroupMode);
  renderSidebar();
});
$('#homeBtn')?.addEventListener('click', () => showWelcome());
$('#newSessionBtn')?.addEventListener('click', () => showWelcome());
$('#quickTaskBtn')?.addEventListener('click', () => showNew());
$('#tourBtn')?.addEventListener('click', () => openHelpModal());

function renderSidebar() {
  const tree = $('#projectTree');
  if (!tree) return;
  $('#newSessionBtn')?.classList.toggle('active-nav', state.view === 'welcome');
  $('#quickTaskBtn')?.classList.toggle('active-nav', state.view === 'new');
  const grpBtn = $('#toggleSidebarGroup');
  if (grpBtn) grpBtn.textContent = sidebarGroupMode === 'folders' ? 'Carpetas' : 'Recientes';

  // Proyectos guardados + los que aparezcan en conversaciones o tareas nuevas.
  const paths = new Map(state.projects.map((p) => [normPath(p.path), p]));
  for (const item of [...state.chats, ...state.runs]) {
    if (item.repoPath && !paths.has(normPath(item.repoPath))) {
      paths.set(normPath(item.repoPath), { path: item.repoPath, name: item.repoPath.split(/[\\/]/).pop() });
    }
  }
  if (!paths.size) {
    tree.innerHTML = `<div class="sidebar-empty-card">
      <p class="muted small-text">Aún no hay proyectos vinculados.</p>
      <button type="button" class="small ghost" data-empty-add-proj>${icon('folder', 13)} Elegir primera carpeta</button>
    </div>`;
    tree.querySelector('[data-empty-add-proj]')?.addEventListener('click', showAddProject);
    return;
  }

  const q = sidebarFilter;

  if (sidebarGroupMode === 'recent') {
    const allItems = [
      ...state.chats.map((c) => ({ kind: 'chat', ts: c.updatedAt ?? c.createdAt ?? '', item: c })),
      ...state.runs
        .filter((r) => !state.chats.some((c) => c.branch && c.branch === r.baseBranch))
        .map((r) => ({ kind: 'run', ts: r.createdAt ?? '', item: r })),
    ]
      .filter(({ kind, item }) => {
        if (!q) return true;
        const projName = (item.repoPath ?? '').split(/[\\/]/).pop().toLowerCase();
        const text = (kind === 'chat' ? item.title : item.goal) ?? '';
        return text.toLowerCase().includes(q) || projName.includes(q);
      })
      .sort((a, b) => String(b.ts).localeCompare(String(a.ts)));

    if (!allItems.length) {
      tree.innerHTML = '<p class="muted small-text" style="padding:8px">Sin sesiones recientes. Pulsa «Nueva sesión».</p>';
      return;
    }
    tree.innerHTML = `<ul class="run-list recent-flat-list">${allItems
      .map(({ kind, item }) => {
        const projName = (item.repoPath ?? '').split(/[\\/]/).pop() || 'proyecto';
        if (kind === 'chat') {
          return `<li data-chat="${item.id}" class="${state.view === 'chat' && state.chat?.id === item.id ? 'active' : ''}">
            <span class="ico">${icon('chat', 14)}</span>
            <div class="session-item-copy">
              <span class="label">${esc(item.title)}</span>
              <span class="sublabel">${esc(projName)}</span>
            </div>
            ${item.working ? `<span class="dot pulse" style="background:${agentInfo(item.working.agent).color}" title="${esc(agentInfo(item.working.agent).name)} trabajando"></span>` : ''}
          </li>`;
        }
        return `<li data-run="${item.id}" class="${state.view === 'run' && state.current?.id === item.id ? 'active' : ''}">
          <span class="ico">${icon('bolt', 14)}</span>
          <div class="session-item-copy">
            <span class="label">${esc(item.goal)}</span>
            <span class="sublabel">${esc(projName)} · Tarea</span>
          </div>
          ${badge(STATUS[item.status] ?? [item.status, ''])}
        </li>`;
      })
      .join('')}</ul>`;
    return;
  }

  const html = [...paths.values()]
    .map((p) => {
      const key = normPath(p.path);
      const matchProj = !q || p.name.toLowerCase().includes(q) || p.path.toLowerCase().includes(q);
      const chats = state.chats.filter((c) => normPath(c.repoPath) === key && (matchProj || String(c.title ?? '').toLowerCase().includes(q)));
      const runs = state.runs.filter(
        (r) =>
          normPath(r.repoPath) === key &&
          !state.chats.some((c) => c.branch && c.branch === r.baseBranch) &&
          (matchProj || String(r.goal ?? '').toLowerCase().includes(q)),
      );
      if (q && !matchProj && !chats.length && !runs.length) return '';
      const open = q ? true : !collapsed.has(key);
      const totalCount = chats.length + runs.length;
      const items = [
        ...chats.map(
          (c) => `<li data-chat="${c.id}" class="${state.view === 'chat' && state.chat?.id === c.id ? 'active' : ''}">
            <span class="ico">${icon('chat', 14)}</span>
            <div class="session-item-copy">
              <span class="label">${esc(c.title)}</span>
              <span class="sublabel">${esc(p.name)}</span>
            </div>
            ${c.working ? `<span class="dot pulse" style="background:${agentInfo(c.working.agent).color}" title="${esc(agentInfo(c.working.agent).name)} trabajando"></span>` : ''}
          </li>`,
        ),
        ...runs.map(
          (r) => `<li data-run="${r.id}" class="${state.view === 'run' && state.current?.id === r.id ? 'active' : ''}">
            <span class="ico">${icon('bolt', 14)}</span>
            <div class="session-item-copy">
              <span class="label">${esc(r.goal)}</span>
              <span class="sublabel">${esc(p.name)} · Tarea</span>
            </div>
            ${badge(STATUS[r.status] ?? [r.status, ''])}
          </li>`,
        ),
      ].join('');
      return `<div class="project ${open ? 'is-open' : ''}">
        <div class="project-head" data-toggle="${esc(key)}" title="${esc(p.path)}">
          <span class="caret">${icon(open ? 'chevDown' : 'chevRight', 13)}</span>
          <span class="proj-folder-ico">${icon('folder', 14)}</span>
          <span class="project-name">${esc(p.name)}</span>
          ${totalCount ? `<span class="proj-count">${totalCount}</span>` : ''}
          <span class="project-actions">
            <button class="small ghost proj-act icon-act" data-new-chat="${esc(p.path)}" title="Nueva conversación en ${esc(p.name)}">${icon('chatPlus', 14)}</button>
            <button class="small ghost proj-act icon-act" data-new-run="${esc(p.path)}" title="Nueva tarea en paralelo en ${esc(p.name)}">${icon('bolt', 14)}</button>
            <button class="small ghost proj-act icon-act" data-files="${esc(p.path)}" title="Explorar archivos de ${esc(p.name)}">${icon('file', 14)}</button>
          </span>
        </div>
        ${
          open
            ? `<ul class="run-list">${
                items ||
                `<li class="proj-empty-start" data-new-chat="${esc(p.path)}">
                  ${icon('plus', 13)} <span>Iniciar sesión en ${esc(p.name)}</span>
                </li>`
              }</ul>`
            : ''
        }
      </div>`;
    })
    .filter(Boolean)
    .join('');
  tree.innerHTML = html || '<p class="muted small-text" style="padding:4px 8px">No hay sesiones que coincidan con la búsqueda.</p>';
}

$('#projectTree').addEventListener('click', async (e) => {
  const t = e.target.closest('[data-new-chat],[data-new-run],[data-files],[data-toggle],[data-chat],[data-run]');
  if (!t) return;
  e.stopPropagation();
  if (t.dataset.newChat) return newChatFor(t.dataset.newChat, t);
  if (t.dataset.newRun) return showNew(t.dataset.newRun);
  if (t.dataset.files) return openFiles(t.dataset.files, 'proyecto original');
  if (t.dataset.chat) return openChat(t.dataset.chat);
  if (t.dataset.run) return openRun(t.dataset.run);
  if (t.dataset.toggle) {
    const key = t.dataset.toggle;
    collapsed.has(key) ? collapsed.delete(key) : collapsed.add(key);
    localStorage.setItem('aiteam.collapsed', JSON.stringify([...collapsed]));
    renderSidebar();
  }
});

async function newChatFor(repoPath, btn) {
  if (btn) btn.disabled = true;
  try {
    await api('POST', '/api/projects', { path: repoPath, prepare: true });
    localStorage.setItem('aiteam.repo', repoPath);
    const chat = await api('POST', '/api/chats', { repoPath, agents: usableAgents() });
    await loadChats();
    openChat(chat.id);
  } catch (err) {
    alert(err.message);
  } finally {
    if (btn) btn.disabled = false;
  }
}

function showAddProject() {
  state.view = 'addProject';
  state.chat = null;
  state.current = null;
  renderSidebar();
  const main = $('#main');
  main.innerHTML = '';
  main.append($('#addProjectTpl').content.cloneNode(true));
  attachFolderPicker($('#addProjectForm'), $('[name=path]'));
  $('#addProjectForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const path = new FormData(e.target).get('path');
    const errEl = $('[data-form-error]');
    const btn = e.target.querySelector('button[type=submit]');
    errEl.hidden = true;
    btn.disabled = true;
    try {
      const p = await api('POST', '/api/projects', { path, prepare: true });
      localStorage.setItem('aiteam.repo', p.path);
      await loadProjects();
      showWelcome(p.path);
    } catch (err) {
      errEl.textContent = err.message;
      errEl.hidden = false;
      btn.disabled = false;
    }
  });
  $('[name=path]').focus();
}
$('#addProjectBtn').addEventListener('click', showAddProject);
$('#selfDevBtn').addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  btn.disabled = true;
  try {
    const { root } = await api('GET', '/api/app');
    const candidates = state.chats.filter((c) => normPath(c.repoPath) === normPath(root));
    if (candidates.length) return openChat(candidates[0].id);
    if (!usableAgents().length) throw new Error('Ninguna IA está disponible. Revisa el equipo y prueba su conexión.');
    await api('POST', '/api/projects', { path: root, prepare: true });
    await loadProjects();
    await newChatFor(root);
  } catch (err) { alert(err.message); }
  finally { btn.disabled = false; }
});

// ------------------------------------------------------------ equipo y uso (compacto y desplegable)

async function loadUsage() {
  state.usage = await api('GET', '/api/usage');
  renderTeam();
}

function fmtReset(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const sameDay = d.toDateString() === new Date().toDateString();
  return sameDay ? d.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' }) : d.toLocaleString('es', { weekday: 'short', hour: '2-digit', minute: '2-digit' });
}

function meter(label, w) {
  if (!w) return `<div class="meter"><span class="m-label">${label}</span><span class="muted">sin datos</span></div>`;
  const left = Math.max(0, 100 - w.percent);
  const cls = left <= 10 ? 'err' : left <= 30 ? 'warn' : 'ok';
  return `<div class="meter" title="Disponible: ${left}% (usado ${w.percent}%)${w.resetsAt ? ` · se renueva ${fmtReset(w.resetsAt)}` : ''}">
    <span class="m-label">${label}</span>
    <span class="m-bar"><i class="${cls}" style="width:${left}%"></i></span>
    <span class="m-val">${left}% · ${fmtReset(w.resetsAt)}</span>
  </div>`;
}

function renderTeam() {
  const panel = $('#teamPanel');
  if (!panel) return;
  const visibleAgents = state.agents.filter((a) => a.enabled !== false);
  const countEl = $('#activeTeamCount');
  if (countEl) countEl.textContent = `${visibleAgents.filter((a) => a.installed).length}/${visibleAgents.length}`;

  panel.innerHTML = visibleAgents
    .map((a) => {
      const u = state.usage?.[a.id];
      const sessionExhausted = u?.session && u.session.percent >= 100;
      const cls = !a.installed ? 'err' : sessionExhausted ? 'warn' : a.working === true ? 'ok' : a.working === false ? 'err' : 'ok';
      const statusText = !a.installed
        ? 'No instalada'
        : sessionExhausted
          ? 'Sin cuota'
          : a.working === false
            ? 'Sin sesión'
            : 'Lista';
      const statusCls = !a.installed || a.working === false ? 'err' : sessionExhausted ? 'warn' : 'ok';
      const isExpanded = expandedTeamAgents.has(a.id);

      let rightSummary = `<span class="agent-state-pill ${statusCls}">${statusText}</span>`;
      if (a.installed && u?.session) {
        const left = Math.max(0, 100 - u.session.percent);
        const barCls = left <= 10 ? 'err' : left <= 30 ? 'warn' : 'ok';
        rightSummary = `<span class="mini-quota" title="Cuota 5h: ${left}% disponible · Clic para ver detalle">
          <span class="mini-quota-bar"><i class="${barCls}" style="width:${left}%"></i></span>
          <span class="mini-quota-txt">${left}%</span>
        </span>`;
      }

      const meters =
        u && (u.session || u.weekly)
          ? meter('5 horas', u.session) + meter('Semanal', u.weekly)
          : `<div class="meter muted small-text">${u?.callsToday ? `${u.callsToday} consultas hoy · ` : ''}Cuota gestionada por su CLI</div>`;

      return `<div class="team-agent-card ${isExpanded ? 'expanded' : ''}" data-agent-card="${esc(a.id)}">
        <div class="team-row-compact" data-toggle-team-agent="${esc(a.id)}" title="Clic para desplegar cuota y opciones de ${esc(a.name)}">
          <span class="dot ${cls}"></span>
          ${emblem(a.id, 17)}
          <b class="team-agent-name" style="color:${a.color}">${esc(a.name)}</b>
          ${a.isDefault ? `<span class="team-default-star" title="Agente predeterminado">${icon('star', 11)}</span>` : ''}
          <span class="team-row-right">
            ${rightSummary}
            <span class="team-chev">${icon(isExpanded ? 'chevDown' : 'chevRight', 12)}</span>
          </span>
        </div>
        ${
          isExpanded
            ? `<div class="team-agent-drawer">
                ${meters}
                <div class="team-drawer-actions">
                  <span class="muted small-text mono">${esc(a.cli || a.id)}</span>
                  <div class="actions">
                    ${!a.isDefault ? `<button type="button" class="small ghost" data-make-default="${esc(a.id)}" title="Usar como IA predeterminada">${icon('star', 11)} Predeterminar</button>` : ''}
                    <button type="button" class="small ghost" data-test="${esc(a.id)}" ${a.installed ? '' : 'disabled'}>Verificar</button>
                  </div>
                </div>
              </div>`
            : ''
        }
      </div>`;
    })
    .join('');
}

$('#teamPanel').addEventListener('click', async (e) => {
  const toggleRow = e.target.closest('[data-toggle-team-agent]');
  if (toggleRow && !e.target.closest('button')) {
    const id = toggleRow.dataset.toggleTeamAgent;
    expandedTeamAgents.has(id) ? expandedTeamAgents.delete(id) : expandedTeamAgents.add(id);
    renderTeam();
    return;
  }

  const defBtn = e.target.closest('[data-make-default]');
  if (defBtn) {
    const id = defBtn.dataset.makeDefault;
    await api('POST', '/api/agents/catalog', { id, enabled: true, makeDefault: true });
    await loadAgents(true);
    return;
  }

  const testBtn = e.target.closest('[data-test]');
  if (!testBtn) return;
  const id = testBtn.dataset.test;
  testBtn.disabled = true;
  testBtn.textContent = '…';
  try {
    Object.assign(agentInfo(id), await api('POST', `/api/agents/${id}/test`));
  } catch (err) {
    Object.assign(agentInfo(id), { working: false, error: err.message });
  }
  renderTeam();
  loadUsage();
});

$('#refreshUsage').addEventListener('click', async (e) => {
  e.target.disabled = true;
  try {
    state.usage = await api('POST', '/api/usage/refresh');
    renderTeam();
  } finally {
    e.target.disabled = false;
  }
});

events.addEventListener('usage', (e) => {
  state.usage = JSON.parse(e.data);
  renderTeam();
});

// ------------------------------------------------------------ explorador de archivos

const files = { root: null, list: [], changed: {}, open: new Set() };

async function openFiles(root, label) {
  files.root = root;
  $('#filesPanel').hidden = false;
  $('#layout').classList.add('with-files');
  $('#filesRootLabel').textContent = label ?? '';
  $('#filesRootLabel').title = root;
  $('#fileView').hidden = true;
  $('#filesTree').innerHTML = '<p class="muted">Cargando…</p>';
  try {
    const t = await api('GET', `/api/fs/tree?root=${encodeURIComponent(root)}`);
    files.list = t.files;
    files.changed = t.changed;
    renderFiles();
  } catch (err) {
    $('#filesTree').innerHTML = `<p class="error">${esc(err.message)}</p>`;
  }
}

function renderFiles() {
  const filter = $('#filesFilter').value.trim().toLowerCase();
  const list = filter ? files.list.filter((f) => f.toLowerCase().includes(filter)) : files.list;
  // Construye el árbol de carpetas.
  const root = { dirs: new Map(), files: [] };
  for (const f of list) {
    const parts = f.split('/');
    let node = root;
    for (const dir of parts.slice(0, -1)) {
      if (!node.dirs.has(dir)) node.dirs.set(dir, { dirs: new Map(), files: [] });
      node = node.dirs.get(dir);
    }
    node.files.push(f);
  }
  const render = (node, prefix, depth) => {
    let html = '';
    for (const [name, child] of [...node.dirs.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      const p = prefix + name;
      const open = filter || files.open.has(p);
      html += `<div class="ft-dir" data-dir="${esc(p)}" style="padding-left:${depth * 12}px">${icon(open ? 'chevDown' : 'chevRight', 12)} ${icon('folder', 13)} ${esc(name)}</div>`;
      if (open) html += render(child, `${p}/`, depth + 1);
    }
    for (const f of node.files) {
      const st = files.changed[f];
      html += `<div class="ft-file ${st ? 'changed' : ''}" data-file="${esc(f)}" style="padding-left:${depth * 12 + 12}px">${esc(f.split('/').pop())}${st ? ` <span class="badge warn">${esc(st)}</span>` : ''}</div>`;
    }
    return html;
  };
  $('#filesTree').innerHTML = render(root, '', 0) || '<p class="muted">Sin archivos.</p>';
}

$('#filesFilter').addEventListener('input', renderFiles);
$('#filesClose').addEventListener('click', () => {
  $('#filesPanel').hidden = true;
  $('#layout').classList.remove('with-files');
});
$('#filesTree').addEventListener('click', async (e) => {
  const dir = e.target.closest('[data-dir]')?.dataset.dir;
  if (dir) {
    files.open.has(dir) ? files.open.delete(dir) : files.open.add(dir);
    return renderFiles();
  }
  const file = e.target.closest('[data-file]')?.dataset.file;
  if (!file) return;
  const view = $('#fileView');
  view.hidden = false;
  if (isImage(file)) {
    const src = imgUrl(files.root, file);
    view.innerHTML = `<div class="file-view-head"><code>${esc(file)}</code>
        <span>${file.toLowerCase().endsWith('.svg') ? '<button class="small ghost" id="svgCode">Ver código</button>' : ''}
        <button class="small ghost" id="fileViewClose">${icon('close')}</button></span></div>
      <div class="img-preview checker" title="Clic para ampliar"><img src="${src}" alt="${esc(file)}" data-zoom="${esc(src)}" data-name="${esc(file)}" /></div>`;
    $('#fileViewClose').addEventListener('click', () => (view.hidden = true));
    $('#svgCode')?.addEventListener('click', () => showFileCode(file));
    return;
  }
  showFileCode(file);
});

async function showFileCode(file) {
  const view = $('#fileView');
  view.innerHTML = '<p class="muted">Cargando…</p>';
  try {
    const f = await api('GET', `/api/fs/file?root=${encodeURIComponent(files.root)}&path=${encodeURIComponent(file)}`);
    const body = f.binary
      ? '<p class="muted">Archivo binario.</p>'
      : `<pre class="code-view">${f.content
          .split('\n')
          .map((l, i) => `<span class="ln">${i + 1}</span>${esc(l)}`)
          .join('\n')}</pre>${f.truncated ? '<p class="muted">(mostrando solo el principio)</p>' : ''}`;
    view.innerHTML = `<div class="file-view-head"><code>${esc(f.path)}</code><button class="small ghost" id="fileViewClose">${icon('close')}</button></div>${body}`;
    $('#fileViewClose').addEventListener('click', () => (view.hidden = true));
  } catch (err) {
    view.innerHTML = `<p class="error">${esc(err.message)}</p>`;
  }
}

// ------------------------------------------------------------ imágenes

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|ico|bmp|avif)$/i;
const isImage = (p) => IMAGE_EXT.test(p);
const imgUrl = (root, p, v = Date.now()) => `/api/fs/image?root=${encodeURIComponent(root)}&path=${encodeURIComponent(p)}&v=${encodeURIComponent(v)}`;

/** Archivos que tocó un mensaje: los guardados o, en mensajes antiguos, los que aparecen en el resumen de git. */
function messageFiles(meta) {
  if (Array.isArray(meta?.files)) return meta.files;
  return String(meta?.stat ?? '')
    .split('\n')
    .map((l) => l.split('|')[0].trim())
    .filter((f) => f && !/files? changed/.test(f));
}

const imgDlg = document.createElement('dialog');
imgDlg.className = 'wide-dialog img-dialog';
imgDlg.innerHTML = `<div class="dialog-head"><code id="imgName"></code>
  <span><button class="small ghost" id="imgBg">Fondo claro</button> <button class="ghost" data-close>Cerrar</button></span></div>
  <div class="img-stage checker" id="imgStage"><img id="imgBig" alt="" /></div>`;
document.body.append(imgDlg);
imgDlg.querySelector('[data-close]').addEventListener('click', () => imgDlg.close());
imgDlg.addEventListener('click', (e) => e.target === imgDlg && imgDlg.close());
$('#imgBg').addEventListener('click', (e) => {
  const light = $('#imgStage').classList.toggle('light');
  e.target.textContent = light ? 'Fondo oscuro' : 'Fondo claro';
});

// Cualquier imagen con data-zoom se amplía al hacer clic (explorador y chat).
document.addEventListener('click', (e) => {
  const img = e.target.closest('[data-zoom]');
  if (!img) return;
  $('#imgBig').src = img.dataset.zoom;
  $('#imgName').textContent = img.dataset.name ?? '';
  imgDlg.showModal();
});

// ------------------------------------------------------------ revisión por archivo y aplicar

const reviewDlg = document.createElement('dialog');
reviewDlg.className = 'wide-dialog review-dlg';
reviewDlg.innerHTML = `
  <div class="dialog-head">
    <div><h2>Revisar cambios</h2><div class="muted small-text" id="rvSub"></div></div>
    <button class="ghost" data-close>Cerrar</button>
  </div>
  <div class="rv-body">
    <div class="rv-files">
      <div class="rv-files-head"><span id="rvCount" class="muted small-text"></span><button class="small ghost" id="rvAcceptAll">Aceptar todos</button></div>
      <div id="rvList"></div>
    </div>
    <div class="rv-main" id="rvMain"><p class="muted">Elige un archivo.</p></div>
  </div>
  <div class="rv-foot">
    <div id="rvMsg" class="rv-msg"></div>
    <div class="actions">
      <button id="rvSync" class="ghost" hidden title="Trae a esta conversación los cambios nuevos de tu proyecto">Traer cambios del proyecto</button>
      <button id="rvApply" class="primary">Aplicar al proyecto</button>
    </div>
  </div>`;
document.body.append(reviewDlg);
reviewDlg.querySelector('[data-close]').addEventListener('click', () => reviewDlg.close());

const rv = { kind: null, id: null, files: [], selected: null, info: null };

async function openReview(kind, id) {
  Object.assign(rv, { kind, id, selected: null });
  $('#rvMain').innerHTML = '<p class="muted">Elige un archivo.</p>';
  $('#rvMsg').innerHTML = '';
  $('#rvSync').hidden = kind !== 'chats';
  reviewDlg.showModal();
  await loadReview();
  if (rv.files.length) selectReviewFile(rv.files.find((f) => !f.accepted)?.file ?? rv.files[0].file);
}

const rvBase = () => `/api/${rv.kind}/${rv.id}`;

async function loadReview() {
  try {
    rv.info = await api('GET', `${rvBase()}/changes`);
  } catch (err) {
    $('#rvList').innerHTML = `<p class="error">${esc(err.message)}</p>`;
    return;
  }
  rv.files = rv.info.files;
  const accepted = rv.files.filter((f) => f.accepted).length;
  const hasSyntaxErr = Boolean(rv.info.syntaxErrors?.length);
  const jsModified = rv.files.some((f) => /\.(m?js|cjs)$/i.test(f.file) && f.status !== 'D');
  const syntaxBadge = hasSyntaxErr
    ? ` · <span class="badge err" title="Hay errores de sintaxis en el código de las IAs">${icon('alertTriangle', 12)} Sintaxis JS errónea</span>`
    : jsModified
      ? ` · <span class="badge ok" title="Verificado con node --check">${icon('check', 12)} Sintaxis JS verificada</span>`
      : '';

  $('#rvSub').innerHTML = `Se aplicará a tu proyecto en la rama <b>${esc(rv.info.projectBranch)}</b>${
    rv.info.projectDirty ? ' · <span class="error">tiene cambios sin guardar</span>' : ''
  }${syntaxBadge}`;
  $('#rvCount').textContent = rv.files.length ? `${accepted}/${rv.files.length} aceptados` : '';
  $('#rvList').innerHTML = rv.files.length
    ? rv.files
        .map(
          (f) => {
            const fileErr = rv.info.syntaxErrors?.find((s) => s.file === f.file);
            return `<div class="rv-file ${rv.selected === f.file ? 'active' : ''} ${f.accepted ? 'ok' : ''} ${fileErr ? 'syntax-err' : ''}" data-rv-file="${esc(f.file)}" title="${esc(f.file)}${fileErr ? ` (Error: ${esc(fileErr.error)})` : ''}">
              <span class="rv-st st-${f.status}">${esc(f.status)}</span>
              <span class="rv-name">${esc(f.file.split('/').pop())}<span class="muted small-text"> ${esc(f.file.split('/').slice(0, -1).join('/'))}</span></span>
              <span class="rv-n"><span class="add">+${f.add}</span> <span class="del">-${f.del}</span></span>
              <span class="rv-ok">${fileErr ? icon('alertTriangle', 14) : f.accepted ? icon('check', 14) : ''}</span>
            </div>`;
          },
        )
        .join('')
    : '<p class="muted" style="padding:10px">No hay cambios pendientes: todo está aplicado en tu proyecto.</p>';

  if (hasSyntaxErr) {
    const errText = rv.info.syntaxErrors.map((s) => `${s.file} (${s.error})`).join(' · ');
    $('#rvMsg').innerHTML = `<span class="error">${icon('alertTriangle', 14)} <b>Error de sintaxis detectado:</b> ${esc(errText)}</span> <button type="button" class="small danger" id="rvFixSyntax">Pedir al equipo que lo corrija</button>`;
    $('#rvFixSyntax')?.addEventListener('click', async () => {
      if (rv.kind === 'chats' && state.chat) {
        reviewDlg.close();
        const fixPrompt = `Por favor corrige los siguientes errores de sintaxis detectados por la verificación automática antes de aplicar:\n${rv.info.syntaxErrors.map((s) => `- ${s.file}: ${s.error}`).join('\n')}`;
        await api('POST', `/api/chats/${state.chat.id}/messages`, { text: fixPrompt });
      } else {
        alert(`Errores de sintaxis detectados:\n${rv.info.syntaxErrors.map((s) => `${s.file}: ${s.error}`).join('\n')}`);
      }
    });
  } else if (rv.info.projectDirty) {
    $('#rvMsg').innerHTML = `<div class="dirty-warning-box"><span class="error">${icon('alertTriangle', 14)} <b>Tu proyecto tiene cambios locales sin guardar (sin commit).</b></span> <button type="button" class="small primary" id="rvCommitProject">${icon('check', 13)} Guardar mis cambios en un commit</button></div>`;
    $('#rvCommitProject')?.addEventListener('click', async () => {
      try {
        $('#rvCommitProject').disabled = true;
        await api('POST', `${rvBase()}/commit-project`);
        await loadReview();
      } catch (err) {
        alert(err.message);
      }
    });
  } else if (!$('#rvMsg').querySelector('.ok-text')) {
    $('#rvMsg').innerHTML = '';
  }

  $('#rvApply').disabled = !rv.files.length || hasSyntaxErr;
  $('#rvApply').textContent = rv.files.length
    ? hasSyntaxErr
      ? 'Bloqueado por error de sintaxis'
      : `Aplicar al proyecto (${rv.files.length})`
    : 'Aplicar al proyecto';
  $('#rvAcceptAll').hidden = !rv.files.some((f) => !f.accepted);
}

$('#rvList').addEventListener('click', (e) => {
  const el = e.target.closest('[data-rv-file]');
  if (el) selectReviewFile(el.dataset.rvFile);
});

function diffHtml(diff) {
  return diff
    .split('\n')
    .filter((l) => !/^(diff --git|index |similarity|rename (from|to))/.test(l))
    .map((l) => {
      const cls = l.startsWith('+++') || l.startsWith('---') ? 'meta' : l.startsWith('+') ? 'add' : l.startsWith('-') ? 'del' : l.startsWith('@@') ? 'hunk' : '';
      return `<div class="${cls}">${esc(l) || ' '}</div>`;
    })
    .join('');
}

async function selectReviewFile(file) {
  rv.selected = file;
  for (const el of document.querySelectorAll('.rv-file')) el.classList.toggle('active', el.dataset.rvFile === file);
  const f = rv.files.find((x) => x.file === file);
  const main = $('#rvMain');
  main.innerHTML = '<p class="muted">Cargando…</p>';
  let d;
  try {
    d = await api('GET', `${rvBase()}/changes/file?path=${encodeURIComponent(file)}`);
  } catch (err) {
    main.innerHTML = `<p class="error">${esc(err.message)}</p>`;
    return;
  }
  // Carpeta desde la que se sirven las imágenes: la copia de la conversación o el resultado integrado de la tarea.
  const root = rv.kind === 'chats' ? state.chat?.worktree?.path : state.current?.id === rv.id ? state.current.integration?.worktree : null;
  const preview = isImage(file) && f.status !== 'D' && root ? `<div class="img-preview checker rv-img"><img src="${imgUrl(root, file)}" alt="" data-zoom="${imgUrl(root, file)}" data-name="${esc(file)}" /></div>` : '';
  const agents = rv.kind === 'chats' ? (state.chat?.agents ?? []) : [];
  main.innerHTML = `
    <div class="rv-file-head">
      <div><code>${esc(file)}</code> <span class="badge">${esc(f.statusLabel)}</span>${f.from ? ` <span class="muted small-text">(antes ${esc(f.from)})</span>` : ''}</div>
      <div class="actions">
        <button id="rvAccept" class="${f.accepted ? '' : 'ok-btn'}">${f.accepted ? 'Quitar aceptación' : icon('check') + ' Aceptar'}</button>
        <button id="rvReject" class="danger" title="Deshace los cambios de este archivo en la copia de las IAs">${icon('close')} Rechazar</button>
      </div>
    </div>
    ${preview}
    <div class="diff rv-diff">${diffHtml(d.diff) || '<div class="muted">Sin diferencias de texto (archivo binario).</div>'}</div>
    ${
      agents.length
        ? `<form class="rv-ask" id="rvAsk">
            <select name="agent">${agents.map((a) => `<option value="${a}">${esc(agentInfo(a).name)}</option>`).join('')}</select>
            <textarea name="text" rows="2" placeholder="Pedir cambios en este archivo… (ej.: usa una constante en vez de repetir el número)"></textarea>
            <button type="button" class="mic-btn" id="rvMic" title="Dictar por voz">${icon('mic', 18)}</button>
            <button class="primary">Pedir cambios</button>
          </form>`
        : ''
    }`;

  $('#rvAccept').addEventListener('click', async () => {
    await api('POST', `${rvBase()}/changes/accept`, { file, accepted: !f.accepted });
    await loadReview();
    const next = !f.accepted ? rv.files.find((x) => !x.accepted && x.file !== file) : null;
    selectReviewFile(next?.file ?? file);
  });
  $('#rvReject').addEventListener('click', async () => {
    const what = f.status === 'A' ? 'Se borrará este archivo nuevo' : 'Se deshará lo que las IAs cambiaron en este archivo';
    if (!confirm(`${what} (${file}). ¿Rechazarlo?`)) return;
    try {
      await api('POST', `${rvBase()}/changes/reject`, { file });
      await loadReview();
      if (rv.files.length) selectReviewFile((rv.files.find((x) => !x.accepted) ?? rv.files[0]).file);
      else $('#rvMain').innerHTML = '<p class="muted">No quedan cambios.</p>';
    } catch (err) {
      alert(err.message);
    }
  });
  const ask = $('#rvAsk');
  if (ask) {
    attachDictation(ask.text, $('#rvMic'));
    ask.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await api('POST', `${rvBase()}/request-changes`, { file, agent: ask.agent.value, text: ask.text.value });
        reviewDlg.close();
      } catch (err) {
        alert(err.message);
      }
    });
  }
}

$('#rvAcceptAll').addEventListener('click', async () => {
  for (const f of rv.files.filter((x) => !x.accepted)) await api('POST', `${rvBase()}/changes/accept`, { file: f.file });
  await loadReview();
  if (rv.selected) selectReviewFile(rv.selected);
});

$('#rvApply').addEventListener('click', async () => {
  if (rv.info.projectDirty) {
    if (!confirm('Tu proyecto tiene cambios locales sin guardar. ¿Deseas hacer un commit de respaldo automático ahora para poder aplicar los cambios de las IAs?')) {
      return;
    }
    try {
      await api('POST', `${rvBase()}/commit-project`);
      await loadReview();
    } catch (err) {
      alert(`No se pudo hacer commit de los cambios locales: ${err.message}`);
      return;
    }
  }

  const pending = rv.files.filter((f) => !f.accepted).length;
  const msg = pending
    ? `Hay ${pending} archivo(s) sin revisar que también se aplicarán. ¿Aplicar los ${rv.files.length} cambios a tu proyecto (rama ${rv.info.projectBranch})?`
    : `¿Aplicar los ${rv.files.length} cambios a tu proyecto (rama ${rv.info.projectBranch})?`;
  if (!confirm(msg)) return;
  $('#rvApply').disabled = true;
  try {
    const r = await api('POST', `${rvBase()}/apply`, { commitFirst: true });
    if (r.ok) {
      $('#rvMsg').innerHTML = `<span class="ok-text">${icon('checkCircle')} Aplicados ${r.files} archivo(s) a la rama ${esc(r.branch)} de tu proyecto.${
        r.selfUpdate ? ' Punto de restauración creado.' : ''
      }</span>${
        r.selfUpdate ? ' <button class="primary small" id="rvRestart">Reiniciar AITeam ahora</button> <span class="muted small-text">para ver los cambios</span>' : ''
      }`;
      $('#rvRestart')?.addEventListener('click', () => {
        reviewDlg.close();
        restartAITeam();
      });
      await loadReview();
      $('#rvMain').innerHTML = '<p class="muted">Todo aplicado.</p>';
      if (rv.kind === 'runs') {
        state.runChanges.set(rv.id, await api('GET', `/api/runs/${rv.id}/changes`));
        await hydrateRunCards();
        if (state.current?.id === rv.id) renderRun();
      }
    } else if (r.reason === 'syntax') {
      $('#rvMsg').innerHTML = `<span class="error">${icon('alertTriangle', 14)} ${esc(r.error)}</span> <button class="small danger" id="rvFixSyntax">Pedir al equipo que lo corrija</button>`;
      $('#rvFixSyntax')?.addEventListener('click', async () => {
        if (rv.kind === 'chats' && state.chat) {
          reviewDlg.close();
          const fixPrompt = `Por favor corrige los siguientes errores de sintaxis detectados por la verificación automática:\n${(r.syntaxErrors || []).map((s) => `- ${s.file}: ${s.error}`).join('\n')}`;
          await api('POST', `/api/chats/${state.chat.id}/messages`, { text: fixPrompt });
        }
      });
    } else if (r.reason === 'dirty') {
      $('#rvMsg').innerHTML = `<div class="dirty-warning-box"><span class="error">${icon('alertTriangle', 14)} <b>${esc(r.error)}</b></span> <button type="button" class="small primary" id="rvCommitProject">${icon('check', 13)} Guardar mis cambios en un commit</button></div>`;
      $('#rvCommitProject')?.addEventListener('click', async () => {
        try {
          $('#rvCommitProject').disabled = true;
          await api('POST', `${rvBase()}/commit-project`);
          await loadReview();
        } catch (err) {
          alert(err.message);
        }
      });
    } else if (r.reason === 'conflict' && rv.kind === 'chats') {
      $('#rvMsg').innerHTML = `<span class="error">${esc(r.error)}</span> <button class="small" id="rvFix">Que una IA lo resuelva</button>`;
      $('#rvFix').addEventListener('click', syncFromProject);
    } else {
      $('#rvMsg').innerHTML = `<span class="error">${esc(r.error)}</span>`;
    }
  } catch (err) {
    $('#rvMsg').innerHTML = `<span class="error">${esc(err.message)}</span>`;
  } finally {
    $('#rvApply').disabled = !rv.files.length;
  }
});

async function syncFromProject() {
  try {
    const r = await api('POST', `${rvBase()}/sync`);
    if (r.ok) {
      $('#rvMsg').innerHTML = '<span class="ok-text">Esta conversación ya tiene los últimos cambios de tu proyecto.</span>';
      await loadReview();
    } else {
      reviewDlg.close();
    }
  } catch (err) {
    $('#rvMsg').innerHTML = `<span class="error">${esc(err.message)}</span>`;
  }
}
$('#rvSync').addEventListener('click', syncFromProject);

// ------------------------------------------------------------ dictado por voz

const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
const dictationLang = () => (navigator.language?.toLowerCase().startsWith('es') ? navigator.language : 'es-ES');
let activeDictation = null;
state.speech = null; // estado del dictado local (motor, modelos)

async function loadSpeech() {
  try {
    state.speech = await api('GET', '/api/speech');
  } catch {
    state.speech = null;
  }
  renderSpeechSettings();
}

/** ¿Se usa el dictado local (Whisper en este PC)? */
function localDictationReady() {
  const s = state.speech;
  return Boolean(s && s.engine === 'local' && s.available && s.models.find((m) => m.id === s.model)?.installed);
}

function micDenied() {
  alert('AITeam no tiene permiso para usar el micrófono. Permítelo en el icono del candado de la barra de direcciones (o en Configuración de Windows → Privacidad → Micrófono).');
}

// Procesador de audio: entrega los fragmentos de audio crudo del micrófono al hilo principal.
const CAPTURE_WORKLET = URL.createObjectURL(
  new Blob(
    [
      `class Capture extends AudioWorkletProcessor {
        process(inputs) { const ch = inputs[0]?.[0]; if (ch) this.port.postMessage(ch.slice(0)); return true; }
      }
      registerProcessor('aiteam-capture', Capture);`,
    ],
    { type: 'text/javascript' },
  ),
);

/** Convierte audio a 16 kHz (media por bloques; suficiente para voz). */
function downsample(samples, fromRate, toRate = 16000) {
  if (fromRate === toRate) return samples;
  const ratio = fromRate / toRate;
  const out = new Float32Array(Math.floor(samples.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(samples.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = start; j < end; j++) sum += samples[j];
    out[i] = sum / Math.max(1, end - start);
  }
  return out;
}

/**
 * Dictado local: graba, detecta las pausas al hablar y manda cada frase a transcribir a este PC (Whisper).
 * El texto aparece frase a frase, en orden.
 */
async function startLocalDictation(textarea, onState) {
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  } catch {
    micDenied();
    return null;
  }
  const ctx = new AudioContext();
  await ctx.audioWorklet.addModule(CAPTURE_WORKLET);
  const source = ctx.createMediaStreamSource(stream);
  const node = new AudioWorkletNode(ctx, 'aiteam-capture');
  source.connect(node);

  const rate = ctx.sampleRate;
  const frame = Math.round(rate * 0.03); // ventanas de 30 ms para medir el volumen
  let pending = new Float32Array(0);
  let segment = [];
  let segmentLen = 0;
  let speaking = false;
  let silentFrames = 0;
  let noiseFloor = 0.004;
  const MAX_SEGMENT = rate * 24; // frases de hasta ~24 s
  const SILENCE_TO_CUT = Math.round(0.75 / 0.03); // 0,75 s de silencio corta la frase
  const preRoll = []; // un poco de audio previo para no comerse el inicio de la palabra
  let queue = Promise.resolve();
  let inFlight = 0;
  let base = textarea.value && !/\s$/.test(textarea.value) ? `${textarea.value} ` : textarea.value;
  let committed = '';

  const flush = () => {
    if (!segmentLen) return;
    const audio = new Float32Array(segmentLen);
    let o = 0;
    for (const s of segment) {
      audio.set(s, o);
      o += s.length;
    }
    segment = [];
    segmentLen = 0;
    if (audio.length < rate * 0.35) return; // demasiado corto: ruido
    const pcm16k = downsample(audio, rate);
    inFlight++;
    onState('transcribing');
    queue = queue.then(async () => {
      try {
        const res = await fetch('/api/speech/transcribe', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: pcm16k.buffer });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? 'Error al transcribir');
        if (data.text) {
          committed += (committed ? ' ' : '') + data.text;
          textarea.value = base + committed;
          textarea.dispatchEvent(new Event('input'));
          textarea.scrollTop = textarea.scrollHeight;
        }
      } catch (err) {
        alert(`Dictado local: ${err.message}`);
      } finally {
        inFlight--;
        onState(inFlight ? 'transcribing' : 'listening');
      }
    });
  };

  node.port.onmessage = (e) => {
    const merged = new Float32Array(pending.length + e.data.length);
    merged.set(pending);
    merged.set(e.data, pending.length);
    let pos = 0;
    while (merged.length - pos >= frame) {
      const chunk = merged.subarray(pos, pos + frame);
      pos += frame;
      let sum = 0;
      for (let i = 0; i < chunk.length; i++) sum += chunk[i] * chunk[i];
      const rms = Math.sqrt(sum / chunk.length);
      const voiced = rms > Math.max(0.01, noiseFloor * 3);
      if (!speaking) {
        noiseFloor = noiseFloor * 0.95 + rms * 0.05; // se adapta al ruido de la habitación
        preRoll.push(chunk.slice(0));
        if (preRoll.length > 10) preRoll.shift();
        if (voiced) {
          speaking = true;
          silentFrames = 0;
          for (const p of preRoll) {
            segment.push(p);
            segmentLen += p.length;
          }
          preRoll.length = 0;
        }
        continue;
      }
      segment.push(chunk.slice(0));
      segmentLen += chunk.length;
      silentFrames = voiced ? 0 : silentFrames + 1;
      if (silentFrames >= SILENCE_TO_CUT || segmentLen >= MAX_SEGMENT) {
        speaking = false;
        flush();
      }
    }
    pending = merged.slice(pos);
  };

  onState('listening');
  return {
    async stop() {
      flush();
      node.port.onmessage = null;
      source.disconnect();
      stream.getTracks().forEach((t) => t.stop());
      await ctx.close();
      await queue;
    },
  };
}

/** Dictado en un cuadro de texto: local (Whisper, sin internet) o con el reconocimiento del navegador. */
function attachDictation(textarea, btn) {
  const ctl = { stop() {} };
  if (!SpeechRec && !navigator.mediaDevices?.getUserMedia) {
    btn.disabled = true;
    btn.title = 'Este navegador no admite dictado por voz (usa Edge o Chrome).';
    return ctl;
  }
  let rec = null; // reconocimiento del navegador
  let local = null; // dictado local
  const setBtn = (mode) => {
    btn.classList.toggle('rec', mode === 'listening' || mode === 'transcribing');
    btn.classList.toggle('busy', mode === 'transcribing');
    btn.innerHTML = icon(mode === 'idle' ? 'mic' : 'stop', 18);
    btn.title = mode === 'transcribing' ? 'Transcribiendo en este PC…' : mode === 'listening' ? 'Escuchando… (pulsa para terminar)' : 'Dictar por voz (Ctrl+M)';
  };
  const setIdle = () => {
    rec = null;
    local = null;
    setBtn('idle');
    if (activeDictation === ctl) activeDictation = null;
  };
  ctl.stop = () => {
    rec?.stop();
    if (local) local.stop().finally(setIdle);
  };

  const startBrowser = () => {
    if (!SpeechRec) return alert('Este navegador no tiene dictado propio. Activa el dictado local en Ajustes → Dictado por voz.');
    rec = new SpeechRec();
    rec.lang = state.speech?.language && state.speech.language !== 'auto' ? state.speech.language : dictationLang();
    rec.interimResults = true;
    rec.continuous = true;
    const base = textarea.value && !/\s$/.test(textarea.value) ? `${textarea.value} ` : textarea.value;
    rec.onresult = (e) => {
      let finalText = '';
      let interim = '';
      for (const r of e.results) (r.isFinal ? (finalText += r[0].transcript) : (interim += r[0].transcript));
      textarea.value = base + finalText + interim;
      textarea.dispatchEvent(new Event('input'));
      textarea.scrollTop = textarea.scrollHeight;
    };
    rec.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') micDenied();
      else if (!['no-speech', 'aborted'].includes(e.error)) alert(`El dictado se detuvo: ${e.error}`);
    };
    rec.onend = setIdle;
    rec.start();
    setBtn('listening');
  };

  ctl.toggle = async () => {
    if (rec) return rec.stop();
    if (local) {
      const l = local;
      local = null;
      setBtn('transcribing');
      await l.stop();
      return setIdle();
    }
    activeDictation?.stop();
    activeDictation = ctl;
    textarea.focus();
    if (localDictationReady()) {
      local = await startLocalDictation(textarea, (mode) => local && setBtn(mode));
      if (!local) setIdle();
    } else {
      startBrowser();
    }
  };
  btn.addEventListener('click', ctl.toggle);
  textarea._dictation = ctl;
  return ctl;
}

// ---- Ajustes del dictado

function fmtMB(bytes) {
  return `${Math.round(bytes / 1048576)} MB`;
}

function renderSpeechSettings() {
  const box = document.getElementById('speechSettings');
  if (!box) return;
  const s = state.speech;
  if (!s) {
    box.innerHTML = '<p class="muted small-text">No se pudo consultar el dictado.</p>';
    return;
  }
  box.innerHTML = `
    <div class="seg speech-engine">
      <button type="button" data-engine="local" class="${s.engine === 'local' ? 'on' : ''}">${icon('lock')} Local (sin internet)</button>
      <button type="button" data-engine="browser" class="${s.engine !== 'local' ? 'on' : ''}">${icon('mic')} Navegador (Edge)</button>
    </div>
    <p class="muted small-text">${
      s.engine === 'local'
        ? 'Whisper transcribe en este PC: privado, gratis y sin conexión. El texto aparece frase a frase.'
        : 'Usa el servicio de voz de Edge (envía el audio a Microsoft). Muestra el texto mientras hablas.'
    }</p>
    ${s.available ? '' : `<p class="error small-text">${esc(s.error ?? 'Motor de voz no disponible.')}</p>`}
    <div class="speech-models">${s.models
      .map((m) => {
        const d = m.download;
        const pct = d?.total ? Math.round((d.received / d.total) * 100) : 0;
        const action = m.installed
          ? `<label class="check"><input type="radio" name="speechModel" value="${m.id}" ${s.model === m.id ? 'checked' : ''}/> Usar</label>
             <button type="button" class="small ghost" data-del-model="${m.id}" title="Borrar el modelo">${icon('close', 14)}</button>`
          : d && !d.error
            ? `<span class="muted small-text">${d.phase === 'descomprimiendo' ? 'Descomprimiendo…' : `${pct}% · ${fmtMB(d.received)}`}</span>`
            : `<button type="button" class="small" data-get-model="${m.id}">Descargar (${m.size})</button>`;
        return `<div class="speech-model">
          <div><b>${esc(m.label)}</b> <span class="muted small-text">· ${esc(m.note)}</span>
            ${d && !d.error && !m.installed ? `<div class="m-bar"><i class="ok" style="width:${pct}%"></i></div>` : ''}
            ${d?.error ? `<div class="error small-text">${esc(d.error)}</div>` : ''}</div>
          <div class="actions">${action}</div>
        </div>`;
      })
      .join('')}</div>
    <label class="speech-lang"><span class="muted small-text">Idioma</span>
      <select id="speechLang">
        ${[['es', 'Español'], ['en', 'Inglés'], ['auto', 'Detectar automáticamente']].map(([v, l]) => `<option value="${v}" ${s.language === v ? 'selected' : ''}>${l}</option>`).join('')}
      </select>
    </label>`;
}

async function saveSpeech(patch) {
  await api('PUT', '/api/config', { speech: { engine: state.speech.engine, model: state.speech.model, language: state.speech.language, ...patch } });
  await loadSpeech();
}

document.addEventListener('click', async (e) => {
  const box = e.target.closest('#speechSettings');
  if (!box) return;
  const engineBtn = e.target.closest('[data-engine]');
  if (engineBtn) {
    if (engineBtn.dataset.engine === 'local' && !state.speech.models.some((m) => m.installed)) {
      alert('Primero descarga un modelo (recomendado: Whisper base).');
      return;
    }
    return saveSpeech({ engine: engineBtn.dataset.engine });
  }
  const get = e.target.closest('[data-get-model]');
  if (get) {
    get.disabled = true;
    try {
      state.speech = await api('POST', `/api/speech/models/${get.dataset.getModel}/download`);
      renderSpeechSettings();
    } catch (err) {
      alert(err.message);
    }
    return;
  }
  const del = e.target.closest('[data-del-model]');
  if (del && confirm('¿Borrar este modelo de voz? Podrás descargarlo de nuevo.')) {
    state.speech = await api('DELETE', `/api/speech/models/${del.dataset.delModel}`);
    if (state.speech.engine === 'local' && !state.speech.models.find((m) => m.id === state.speech.model)?.installed) await saveSpeech({ engine: 'browser' });
    renderSpeechSettings();
  }
});
document.addEventListener('change', (e) => {
  if (e.target.name === 'speechModel') saveSpeech({ model: e.target.value });
  if (e.target.id === 'speechLang') saveSpeech({ language: e.target.value });
});

events.addEventListener('speech', async (e) => {
  const prev = state.speech;
  state.speech = { ...(prev ?? {}), ...JSON.parse(e.data) };
  // Al terminar la primera descarga, se activa el dictado local automáticamente.
  const justInstalled = state.speech.models.find((m) => m.installed && !prev?.models?.find((p) => p.id === m.id)?.installed);
  if (justInstalled && state.speech.engine !== 'local') {
    await saveSpeech({ engine: 'local', model: justInstalled.id });
    return;
  }
  renderSpeechSettings();
});

// Ctrl+M dicta en el cuadro de texto que tenga el foco (o en el del chat).
document.addEventListener('keydown', (e) => {
  if (!(e.ctrlKey && e.key.toLowerCase() === 'm')) return;
  const target = document.activeElement?._dictation ? document.activeElement : $('#chatInput');
  if (target?._dictation) {
    e.preventDefault();
    target._dictation.toggle();
  }
});

// ------------------------------------------------------------ apariencia

const THEMES = [
  ['oled', 'OLED', '#000000', '#0e0e10'],
  ['oscuro', 'Oscuro', '#141413', '#262624'],
  ['medianoche', 'Medianoche', '#0b1020', '#18213a'],
  ['claro', 'Claro', '#f6f6f4', '#ffffff'],
];
const ACCENTS = [
  ['azul', '#4f7cff'],
  ['violeta', '#8b5cf6'],
  ['esmeralda', '#10b981'],
  ['ambar', '#f59e0b'],
  ['rosa', '#ec4899'],
  ['cian', '#06b6d4'],
];

const THEME_CHROME = {
  oled: { bg: '#000000', text: '#f2f2f4', border: '#1c1c20', dark: true },
  oscuro: { bg: '#1d1d1b', text: '#ecebe7', border: '#34332f', dark: true },
  medianoche: { bg: '#11182b', text: '#e6ebff', border: '#243052', dark: true },
  claro: { bg: '#ffffff', text: '#1d1c1a', border: '#e2e0db', dark: false },
};

function syncWindowTitlebar() {
  const theme = document.documentElement.dataset.theme || 'oscuro';
  const pal = THEME_CHROME[theme] ?? THEME_CHROME.oscuro;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', pal.bg);
  fetch('/api/window-theme', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(pal),
  }).catch(() => {});
}

function setLook(key, value) {
  document.documentElement.dataset[key] = value;
  try {
    localStorage.setItem(`aiteam.${key}`, value);
  } catch {
    /* sin almacenamiento: solo para esta sesión */
  }
  if (key === 'theme') syncWindowTitlebar();
  renderAppearance();
}
syncWindowTitlebar();

function renderAppearance() {
  const theme = document.documentElement.dataset.theme;
  const accent = document.documentElement.dataset.accent;
  const accentColor = ACCENTS.find((a) => a[0] === accent)?.[1] ?? '#4f7cff';
  $('#themeGrid').innerHTML = THEMES.map(
    ([id, label, bg, panel]) => `<button type="button" class="theme-card ${theme === id ? 'on' : ''}" data-theme-pick="${id}">
      <span class="sw"><i style="background:${panel}"></i><i style="background:${bg};display:grid;place-items:center"><i style="width:40%;height:8px;border-radius:4px;background:${accentColor}"></i></i></span>
      <span class="lbl" style="display:block">${label}</span></button>`,
  ).join('');
  $('#accentRow').innerHTML = ACCENTS.map(
    ([id, color]) => `<button type="button" class="accent-dot ${accent === id ? 'on' : ''}" data-accent-pick="${id}" title="${id}" style="background:${color}"></button>`,
  ).join('');
}

$('#themeGrid').addEventListener('click', (e) => {
  const id = e.target.closest('[data-theme-pick]')?.dataset.themePick;
  if (id) setLook('theme', id);
});
$('#accentRow').addEventListener('click', (e) => {
  const id = e.target.closest('[data-accent-pick]')?.dataset.accentPick;
  if (id) setLook('accent', id);
});
$('#settingsBtn').addEventListener('click', renderAppearance);
$('#settingsBtn').addEventListener('click', loadSpeech);

// ------------------------------------------------------------ notificaciones

state.notify = { enabled: true, sound: true };
const prevChatWorking = new Map();
const prevRunStatus = new Map();

/** Sonido suave de dos tonos (sin archivos de audio). */
function chime() {
  try {
    const ctx = new AudioContext();
    const t = ctx.currentTime;
    for (const [i, freq] of [[0, 784], [1, 1046]]) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t + i * 0.14);
      gain.gain.exponentialRampToValueAtTime(0.18, t + i * 0.14 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.14 + 0.35);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t + i * 0.14);
      osc.stop(t + i * 0.14 + 0.4);
    }
    setTimeout(() => ctx.close(), 1200);
  } catch {
    /* sin audio */
  }
}

/** Avisa solo si estás en otra ventana o en otra conversación (no hace falta avisar de lo que ya estás viendo). */
function notifyUser(title, body, open, force = false) {
  if (!state.notify.enabled) return;
  const viewing = document.hasFocus() && !document.hidden;
  if (viewing && !force) return;
  if (state.notify.sound) chime();
  if ('Notification' in window && Notification.permission === 'granted') {
    const n = new Notification(title, { body, icon: 'icon-192.png', tag: title });
    n.onclick = () => {
      window.focus();
      open?.();
      n.close();
    };
  }
}

const firstLine = (text, n = 140) => {
  const one = String(text ?? '').replace(/\s+/g, ' ').trim();
  return one.length > n ? `${one.slice(0, n)}…` : one;
};

function watchChatForNotice(chat) {
  const was = prevChatWorking.get(chat.id);
  prevChatWorking.set(chat.id, Boolean(chat.working));
  if (!was || chat.working) return;
  const last = [...chat.messages].reverse().find((m) => m.kind === 'message' || m.kind === 'error');
  if (!last) return;
  const elsewhere = state.view !== 'chat' || state.chat?.id !== chat.id;
  const open = () => openChat(chat.id);
  if (last.kind === 'error') notifyUser(`AITeam · ${firstLine(chat.title, 60)}`, firstLine(last.text), open, elsewhere);
  else if (agentInfo(last.from)?.name && last.from !== 'user') notifyUser(`${agentInfo(last.from).name} respondió`, firstLine(last.text), open, elsewhere);
}

function watchRunForNotice(run) {
  const was = prevRunStatus.get(run.id);
  prevRunStatus.set(run.id, run.status);
  if (!was || was === run.status) return;
  const elsewhere = state.view !== 'run' || state.current?.id !== run.id;
  const open = () => openRun(run.id);
  const goal = firstLine(run.goal, 80);
  if (run.status === 'awaiting_approval') notifyUser('El equipo propone un reparto', `${goal} — revísalo y apruébalo.`, open, elsewhere);
  else if (run.status === 'done') notifyUser('Tarea de equipo terminada', goal, open, elsewhere);
  else if (run.status === 'failed') notifyUser('La tarea de equipo falló', goal, open, elsewhere);
}

events.addEventListener('chat', (e) => watchChatForNotice(JSON.parse(e.data)));
events.addEventListener('run', (e) => watchRunForNotice(JSON.parse(e.data)));

function renderNotifySettings() {
  $('#notifEnabled').checked = state.notify.enabled;
  $('#notifSound').checked = state.notify.sound;
  const perm = 'Notification' in window ? Notification.permission : 'unsupported';
  $('#notifHint').textContent =
    perm === 'granted'
      ? 'Con la ventana cerrada, AITeam te avisa igualmente con una notificación de Windows.'
      : perm === 'denied'
        ? 'Has bloqueado las notificaciones de esta ventana: actívalas desde el candado de la barra de direcciones. Con la ventana cerrada seguirás recibiendo las de Windows.'
        : 'Al activar o probar, la ventana te pedirá permiso para mostrar notificaciones.';
}

async function saveNotify(patch) {
  state.notify = { ...state.notify, ...patch };
  await api('PUT', '/api/config', { notifications: state.notify });
  renderNotifySettings();
}

$('#notifEnabled').addEventListener('change', async (e) => {
  if (e.target.checked && 'Notification' in window && Notification.permission === 'default') await Notification.requestPermission();
  saveNotify({ enabled: e.target.checked });
});
$('#notifSound').addEventListener('change', (e) => saveNotify({ sound: e.target.checked }));
$('#notifTest').addEventListener('click', async () => {
  if ('Notification' in window && Notification.permission === 'default') await Notification.requestPermission();
  renderNotifySettings();
  notifyUser('AITeam', 'Así te avisaré cuando el equipo termine o necesite algo.', null, true);
});
$('#settingsBtn').addEventListener('click', renderNotifySettings);

// La primera vez que envías algo, se pide permiso para notificar (necesita un gesto tuyo).
document.addEventListener(
  'submit',
  () => {
    if (state.notify.enabled && 'Notification' in window && Notification.permission === 'default') Notification.requestPermission();
  },
  { once: true, capture: true },
);

// ------------------------------------------------------------ reiniciar

/** Reinicia el servidor; la página se recarga sola cuando vuelve. */
async function restartAITeam() {
  let r;
  try {
    r = await fetch('/api/restart', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    if (r.status === 409) {
      if (!confirm('Hay IAs trabajando ahora mismo y su trabajo se cortará. ¿Reiniciar igualmente?')) return false;
      r = await fetch('/api/restart', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"force":true}' });
    }
  } catch {
    return false;
  }
  if (!r.ok) return false;
  showRestarting();
  return true;
}

function showRestarting() {
  let ov = document.getElementById('restartOverlay');
  if (!ov) {
    ov = document.createElement('div');
    ov.id = 'restartOverlay';
    ov.className = 'restart-overlay';
    ov.innerHTML = `<div>${icon('refresh', 28)}<h2>Reiniciando AITeam…</h2><p class="muted">La ventana se recargará sola en unos segundos.</p></div>`;
    document.body.append(ov);
  }
  // Por si el aviso de reconexión no llega: comprueba que el servidor vuelve y recarga.
  const started = Date.now();
  const poll = async () => {
    try {
      const r = await fetch('/api/app', { cache: 'no-store' });
      if (r.ok && Date.now() - started > 800) return location.reload();
    } catch {
      /* todavía arrancando */
    }
    if (Date.now() - started < 30_000) setTimeout(poll, 500);
    else ov.querySelector('p').textContent = 'No ha vuelto a arrancar. Ábrelo desde el acceso directo.';
  };
  setTimeout(poll, 700);
}

$('#restartBtn').addEventListener('click', async () => {
  $('#settingsDlg').close();
  await restartAITeam();
});

// ------------------------------------------------------------ niveles de permisos

state.levels = [];
const LEVEL_ICONS = { edits: 'lock', project: 'tool', full: 'bolt' };
const levelInfo = (id) => state.levels.find((l) => l.id === id) ?? { id, label: id, short: '', guarantees: '' };

async function loadLevels() {
  try {
    state.levels = (await api('GET', '/api/permissions')).levels;
  } catch {
    state.levels = [];
  }
  fillLevelSelects();
}

/** Botones del selector de permisos de la cabecera del chat. */
function levelButtons(current) {
  return state.levels
    .map((l) => {
      const on = current === l.id;
      return `<button type="button" data-mode="${l.id}" class="${on ? `on ${l.id === 'full' ? 'warn-on' : ''}` : ''}" title="${esc(`${l.short}. ${l.guarantees}`)}">${icon(LEVEL_ICONS[l.id] ?? 'lock')} ${esc(l.id === 'project' ? 'Comandos' : l.label)}</button>`;
    })
    .join('');
}

/** Rellena los selectores de permisos (formulario de tareas y Ajustes) y su explicación. */
function fillLevelSelects(root = document) {
  for (const sel of root.querySelectorAll('select[data-levels]')) {
    const value = sel.value || state.defaultAutonomy;
    const isPill = sel.classList.contains('pill-native-select') || sel.classList.contains('pill-select');
    sel.innerHTML = state.levels
      .map((l) => {
        const text = isPill
          ? (l.id === 'edits' ? 'Solo archivos' : l.id === 'project' ? 'Comandos' : 'Control total')
          : `${l.label}: ${l.short}`;
        return `<option value="${l.id}">${esc(text)}</option>`;
      })
      .join('');
    if (value && state.levels.some((l) => l.id === value)) sel.value = value;
    const hint = sel.parentElement?.querySelector('[data-level-hint]');
    const show = () => hint && (hint.textContent = levelInfo(sel.value).guarantees);
    sel.onchange = show;
    show();
  }
}

// ------------------------------------------------------------ apagar

$('#shutdownBtn').addEventListener('click', async () => {
  const busy = state.chats.some((c) => c.working) || state.runs.some((r) => ['planning', 'bidding', 'running', 'reviewing', 'integrating', 'attacking', 'testing'].includes(r.status));
  const msg = busy ? 'Hay IAs trabajando ahora mismo y su trabajo se interrumpirá. ¿Apagar AITeam igualmente?' : '¿Apagar AITeam? Podrás volver a abrirlo con el acceso directo.';
  if (!confirm(msg)) return;
  await api('POST', '/api/shutdown').catch(() => {});
  $('#settingsDlg').close();
  document.body.innerHTML = '<div class="empty"><h1>AITeam está apagado</h1><p>Ábrelo de nuevo desde el acceso directo del escritorio. Ya puedes cerrar esta ventana.</p></div>';
});

// ------------------------------------------------------------ guía rápida / tour

function openHelpModal() {
  let dlg = document.getElementById('helpTourDlg');
  if (!dlg) {
    dlg = document.createElement('dialog');
    dlg.id = 'helpTourDlg';
    dlg.className = 'help-tour-dlg';
    dlg.innerHTML = `
      <div class="dialog-head">
        <div>
          <h2>Cómo funciona AITeam</h2>
          <p class="muted small-text">Tus IAs trabajando en equipo sobre tu código de forma segura</p>
        </div>
        <button class="ghost dlg-x" data-close title="Cerrar (Esc)" aria-label="Cerrar">${icon('close', 16)}</button>
      </div>
      <div class="help-grid">
        <div class="help-card">
          <span class="help-badge">1 · Elige tu carpeta</span>
          <h3>Sin configurar nada complicado</h3>
          <p class="muted">Usa <b>${icon('folder', 13)} Examinar…</b> para seleccionar la carpeta de tu proyecto. Si aún no tenía git, AITeam la prepara sola.</p>
        </div>
        <div class="help-card">
          <span class="help-badge">2 · Elige cómo trabajan</span>
          <h3>Una IA, todas o en paralelo</h3>
          <p class="muted">En la barra sobre el cuadro de texto eliges si responde una IA concreta, si opinan todas (<b>Todo el equipo</b>) o si se dividen subtareas en paralelo (<b>Tarea en paralelo</b>).</p>
        </div>
        <div class="help-card">
          <span class="help-badge">3 · Recibe el resultado</span>
          <h3>Respuesta y archivos en la conversación</h3>
          <p class="muted">Las IAs trabajan en una copia aislada. Al terminar, AITeam incorpora los cambios cuando puede hacerlo con seguridad y te muestra qué hizo. Si queda algo pendiente, puedes resolverlo desde el resultado.</p>
        </div>
        <div class="help-card">
          <span class="help-badge">4 · Permisos claros</span>
          <h3>Tú decides hasta dónde llegan</h3>
          <p class="muted">En la píldora inferior del chat puedes elegir entre <b>Solo editar archivos</b>, <b>Comandos seguros</b> (tests y builds sin instalar nada) o <b>Control total</b>.</p>
        </div>
      </div>
      <div class="dialog-actions">
        <button class="primary" data-close>Entendido, empezar</button>
      </div>`;
    document.body.append(dlg);
    dlg.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => dlg.close()));
  }
  dlg.showModal();
  localStorage.setItem('aiteam.tourSeen', '1');
}

// ------------------------------------------------------------ vista previa web en vivo y detector de puertos

state.activePorts = [];

function normalizePreviewUrl(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return 'http://localhost:3000';
  if (/^:?\d{2,5}(\/.*)?$/.test(s)) return `http://localhost:${s.replace(/^:/, '')}`;
  if (!/^https?:\/\//i.test(s)) return `http://${s}`;
  return s;
}

async function refreshPreviewPorts(autoLoadFirst = false) {
  const strip = $('#previewPortsStrip');
  try {
    const { ports } = await api('GET', '/api/ports');
    state.activePorts = ports ?? [];
    if (strip) {
      if (state.activePorts.length) {
        strip.hidden = false;
        strip.innerHTML =
          `<span class="ports-label"><span class="dot ok"></span> Puertos activos:</span>` +
          state.activePorts
            .map((p) => `<button type="button" class="port-pill" data-port-url="${esc(p.url)}">:${p.port}</button>`)
            .join('');
      } else {
        strip.hidden = false;
        strip.innerHTML = `<span class="muted small-text">Ningún servidor dev detectado en puertos comunes (3000, 5173, 8080…). Escribe una URL arriba.</span>`;
      }
    }
    if (autoLoadFirst && state.activePorts.length && !$('#previewFrame')?.getAttribute('src')) {
      navigatePreview(state.activePorts[0].url);
    }
  } catch {
    /* ignorar */
  }
}

function navigatePreview(rawUrl) {
  const url = normalizePreviewUrl(rawUrl);
  const inp = $('#previewUrlInput');
  const frame = $('#previewFrame');
  if (inp) inp.value = url;
  if (frame) frame.src = url;
  localStorage.setItem('aiteam.previewUrl', url);
}

function openPreviewPanel(initialUrl) {
  const panel = $('#previewPanel');
  if (!panel) return;
  panel.hidden = false;
  $('#layout')?.classList.add('with-preview');
  const saved = initialUrl || localStorage.getItem('aiteam.previewUrl') || '';
  if (saved) navigatePreview(saved);
  refreshPreviewPorts(!saved);
}

function closePreviewPanel() {
  const panel = $('#previewPanel');
  if (!panel) return;
  panel.hidden = true;
  $('#layout')?.classList.remove('with-preview');
}

function togglePreviewPanel(url) {
  const panel = $('#previewPanel');
  if (!panel) return;
  if (panel.hidden) openPreviewPanel(url);
  else if (url) navigatePreview(url);
  else closePreviewPanel();
}

$('#previewCloseBtn')?.addEventListener('click', closePreviewPanel);
$('#previewReloadBtn')?.addEventListener('click', () => {
  const frame = $('#previewFrame');
  if (frame?.src) frame.src = frame.src;
  refreshPreviewPorts(false);
});
$('#previewExternalBtn')?.addEventListener('click', () => {
  const url = normalizePreviewUrl($('#previewUrlInput')?.value || 'http://localhost:3000');
  window.open(url, '_blank', 'noopener');
});
$('#previewUrlInput')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    navigatePreview(e.target.value);
  }
});
$('#previewPortsStrip')?.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-port-url]');
  if (btn) navigatePreview(btn.dataset.portUrl);
});

// ------------------------------------------------------------ paleta de comandos (Ctrl+K) y recetas de equipo

const TEAM_RECIPES = [
  {
    id: 'recipe-audit',
    title: 'Receta · Auditoría de Seguridad y Bugs',
    subtitle: 'Todo el equipo (@equipo) busca vulnerabilidades, errores y casos límite',
    target: 'equipo',
    prompt: 'Realicen una auditoría exhaustiva de seguridad, vulnerabilidades, fugas de datos y casos límite en este proyecto, priorizando los hallazgos más críticos.',
    ico: 'shield',
  },
  {
    id: 'recipe-refactor',
    title: 'Receta · Refactorizar + Tests en Paralelo',
    subtitle: 'Divide el trabajo en subtareas paralelas (/equipo) y verifica el resultado',
    target: 'parallel',
    prompt: 'Identifiquen los módulos más complejos o frágiles, refactorícenlos para mejorar su mantenibilidad y añadan pruebas automatizadas para cubrir los casos clave.',
    ico: 'bolt',
  },
  {
    id: 'recipe-pr',
    title: 'Receta · Revisión Pre-PR / Control de Calidad',
    subtitle: 'Revisión cruzada entre todas las IAs antes de integrar cambios',
    target: 'equipo',
    prompt: 'Revisen el estado actual del repositorio buscando posibles regresiones, código duplicado, problemas de rendimiento o mejoras antes de publicar.',
    ico: 'fileDiff',
  },
  {
    id: 'recipe-ux',
    title: 'Receta · Pulido de Interfaz y Experiencia de Usuario',
    subtitle: 'Mejora visual, diseño responsivo y facilidad de uso',
    target: 'auto',
    prompt: 'Analiza y mejora la interfaz de usuario, cuidando la consistencia visual, accesibilidad, estados vacíos y facilidad de uso.',
    ico: 'palette',
  },
  {
    id: 'recipe-docs',
    title: 'Receta · Documentar Arquitectura y Guía Rápida',
    subtitle: 'Explica la estructura del proyecto y genera documentación clara',
    target: 'equipo',
    prompt: 'Analicen la arquitectura completa de este proyecto y generen o actualicen su documentación técnica y guía de inicio rápido.',
    ico: 'file',
  },
];

async function runTeamRecipe(recipe) {
  if (state.view === 'chat' && state.chat) {
    const inp = $('#chatInput');
    const targetKey = `aiteam.target.${state.chat.id}`;
    localStorage.setItem(targetKey, recipe.target);
    if (inp) {
      inp.value = recipe.prompt;
      inp.dispatchEvent(new Event('input'));
      inp.focus();
    }
    openChat(state.chat.id);
    return;
  }
  if (state.view !== 'welcome') showWelcome();
  const inp = $('#welcomeInput');
  const sel = $('#welcomeTargetSel');
  if (sel) sel.value = recipe.target;
  if (inp) {
    inp.value = recipe.prompt;
    inp.focus();
  }
}

let cmdSelectedIdx = 0;
let cmdFilteredItems = [];

function buildCmdPaletteItems() {
  const items = [];
  for (const r of TEAM_RECIPES) {
    items.push({
      group: 'Recetas de Equipo (1 clic)',
      title: r.title,
      subtitle: r.subtitle,
      ico: r.ico,
      badge: r.target === 'parallel' ? 'Paralelo' : r.target === 'equipo' ? '@equipo' : 'IA',
      run: () => runTeamRecipe(r),
    });
  }

  items.push(
    {
      group: 'Acciones rápidas',
      title: 'Nueva sesión de equipo',
      subtitle: 'Ir a la pantalla de inicio para elegir carpeta, modelo o modo',
      ico: 'plus',
      badge: 'Vista',
      run: () => showWelcome(),
    },
    {
      group: 'Acciones rápidas',
      title: 'Nueva tarea en paralelo',
      subtitle: 'Dividir un objetivo grande en subtareas simultáneas con revisión cruzada',
      ico: 'bolt',
      badge: 'Paralelo',
      run: () => showNew(),
    },
    {
      group: 'Acciones rápidas',
      title: 'Abrir / Cerrar Vista previa web en vivo',
      subtitle: 'Previsualizar servidor local (localhost:3000, 5173…) junto al chat',
      ico: 'globe',
      badge: 'Preview',
      run: () => togglePreviewPanel(),
    },
    {
      group: 'Acciones rápidas',
      title: 'Catálogo de Agentes (45 IAs estilo Orca)',
      subtitle: 'Activar o desactivar CLIs, personalizar comandos y elegir predeterminado',
      ico: 'cpu',
      badge: '45 agents',
      run: () => openOrcaCatalog(),
    },
  );

  if (state.view === 'chat' && state.chat) {
    items.push(
      {
        group: 'Conversación actual',
        title: 'Resolver cambios pendientes del proyecto',
        subtitle: state.chat.title,
        ico: 'fileDiff',
        badge: 'Diff',
        run: () => openReview('chats', state.chat.id),
      },
      {
        group: 'Conversación actual',
        title: 'Explorar archivos de esta conversación',
        subtitle: state.chat.worktree?.path ?? '',
        ico: 'folder',
        badge: 'Archivos',
        run: () => openFiles(state.chat.worktree.path, 'copia de la conversación'),
      },
      {
        group: 'Conversación actual',
        title: 'Abrir Herramientas (Terminal, Comandos, MCP y Versiones)',
        subtitle: 'Ejecutar comandos o restaurar snapshots de esta copia',
        ico: 'terminal',
        badge: 'Tools',
        run: () => openChatTools(),
      },
    );
  }

  for (const p of state.projects ?? []) {
    items.push({
      group: 'Proyectos vinculados',
      title: `Proyecto: ${p.name}`,
      subtitle: p.path,
      ico: 'folder',
      badge: 'Abrir',
      run: () => showWelcome(p.path),
    });
  }

  for (const c of (state.chats ?? []).slice(0, 12)) {
    const projName = (c.repoPath ?? '').split(/[\\/]/).pop() || '';
    items.push({
      group: 'Sesiones recientes',
      title: c.title,
      subtitle: `${projName} · Conversación`,
      ico: 'chat',
      badge: 'Sesión',
      run: () => openChat(c.id),
    });
  }

  for (const [id, label] of THEMES) {
    items.push({
      group: 'Apariencia y Ajustes',
      title: `Cambiar tema a ${label}`,
      subtitle: 'Actualiza el aspecto visual al instante',
      ico: 'palette',
      badge: 'Tema',
      run: () => setLook('theme', id),
    });
  }
  items.push({
    group: 'Apariencia y Ajustes',
    title: 'Abrir Ajustes de AITeam',
    subtitle: 'Permisos, voz local Whisper, notificaciones y servidor',
    ico: 'settings',
    badge: 'Ajustes',
    run: () => $('#settingsBtn')?.click(),
  });

  return items;
}

function renderCmdPaletteList() {
  const listEl = $('#cmdPaletteList');
  const q = ($('#cmdPaletteInput')?.value ?? '').trim().toLowerCase();
  const all = buildCmdPaletteItems();
  cmdFilteredItems = q
    ? all.filter((it) => it.title.toLowerCase().includes(q) || it.subtitle.toLowerCase().includes(q) || it.group.toLowerCase().includes(q))
    : all;

  if (cmdSelectedIdx >= cmdFilteredItems.length) cmdSelectedIdx = Math.max(0, cmdFilteredItems.length - 1);
  if (!cmdFilteredItems.length) {
    listEl.innerHTML = `<p class="muted" style="padding:22px;text-align:center">No hay comandos ni sesiones que coincidan con «${esc(q)}».</p>`;
    return;
  }

  let html = '';
  let lastGroup = '';
  cmdFilteredItems.forEach((it, idx) => {
    if (it.group !== lastGroup) {
      lastGroup = it.group;
      html += `<div class="cmd-group-title">${esc(it.group)}</div>`;
    }
    html += `<button type="button" class="cmd-item ${idx === cmdSelectedIdx ? 'active' : ''}" data-cmd-idx="${idx}">
      <span class="cmd-item-ico">${icon(it.ico, 16)}</span>
      <span class="cmd-item-copy">
        <b>${esc(it.title)}</b>
        <small>${esc(it.subtitle)}</small>
      </span>
      ${it.badge ? `<span class="cmd-item-badge">${esc(it.badge)}</span>` : ''}
    </button>`;
  });
  listEl.innerHTML = html;
  listEl.querySelector('.cmd-item.active')?.scrollIntoView({ block: 'nearest' });
}

function openCmdPalette() {
  const dlg = $('#cmdPaletteDlg');
  if (!dlg) return;
  if (dlg.open) {
    dlg.close();
    return;
  }
  const inp = $('#cmdPaletteInput');
  if (inp) inp.value = '';
  cmdSelectedIdx = 0;
  renderCmdPaletteList();
  dlg.showModal();
  inp?.focus();
}

$('#openCmdPaletteBtn')?.addEventListener('click', openCmdPalette);
$('#cmdPaletteInput')?.addEventListener('input', () => {
  cmdSelectedIdx = 0;
  renderCmdPaletteList();
});
$('#cmdPaletteInput')?.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    cmdSelectedIdx = (cmdSelectedIdx + 1) % Math.max(1, cmdFilteredItems.length);
    renderCmdPaletteList();
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    cmdSelectedIdx = (cmdSelectedIdx - 1 + Math.max(1, cmdFilteredItems.length)) % Math.max(1, cmdFilteredItems.length);
    renderCmdPaletteList();
  } else if (e.key === 'Enter' && cmdFilteredItems[cmdSelectedIdx]) {
    e.preventDefault();
    const chosen = cmdFilteredItems[cmdSelectedIdx];
    $('#cmdPaletteDlg')?.close();
    chosen.run();
  }
});
$('#cmdPaletteList')?.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-cmd-idx]');
  if (!btn) return;
  const chosen = cmdFilteredItems[Number(btn.dataset.cmdIdx)];
  $('#cmdPaletteDlg')?.close();
  chosen?.run();
});

document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    openCmdPalette();
  }
});

// ------------------------------------------------------------ arranque

await loadAgents();
{
  const cfg = await api('GET', '/api/config');
  state.defaultAutonomy = cfg.autonomy;
  state.notify = { enabled: cfg.notifications?.enabled !== false, sound: cfg.notifications?.sound !== false };
}
await loadLevels();
await Promise.all([loadRuns(), loadChats(), loadProjects(), loadUsage(), loadSpeech()]);
// Estado inicial para detectar cambios (y no avisar de lo que ya había pasado).
for (const c of state.chats) prevChatWorking.set(c.id, Boolean(c.working));
for (const r of state.runs) prevRunStatus.set(r.id, r.status);
showWelcome();
if (!localStorage.getItem('aiteam.tourSeen') && !navigator.webdriver && !/Headless/i.test(navigator.userAgent)) {
  setTimeout(() => openHelpModal(), 400);
}

// ------------------------------------------------------------ Rollback de auto-mejora
$('#settingsRollbackBtn')?.addEventListener('click', async () => {
  if (!confirm('¿Deseas revertir AITeam a la versión anterior a la auto-mejora? Se restaurarán los archivos y el servidor se reiniciará automáticamente.')) return;
  $('#settingsDlg')?.close();
  try {
    const res = await api('POST', '/api/app/rollback');
    if (res.ok) {
      showRestarting();
    }
  } catch (err) {
    alert(`Error al revertir: ${err.message}`);
  }
});

// ------------------------------------------------------------ Live Error Doctor (reparación asistida)
let lastDoctorError = null;
let doctorToast = null;

function ensureDoctorToast() {
  if (doctorToast) return doctorToast;
  doctorToast = document.createElement('div');
  doctorToast.id = 'liveDoctorToast';
  doctorToast.className = 'live-doctor-toast';
  doctorToast.hidden = true;
  document.body.append(doctorToast);
  return doctorToast;
}

function handleLiveDoctorError(err, source, lineno, colno) {
  const message = err?.message || String(err || 'Error inesperado');
  const now = Date.now();
  if (lastDoctorError && lastDoctorError.message === message && now - lastDoctorError.time < 5000) return;
  lastDoctorError = { message, source, lineno, colno, stack: err?.stack || '', time: now };

  const toast = ensureDoctorToast();
  toast.innerHTML = `
    <div class="doctor-icon">${icon('alertTriangle', 18)}</div>
    <div class="doctor-content">
      <div class="doctor-title">AITeam Error Doctor</div>
      <div class="doctor-msg" title="${esc(message)}">${esc(message)}</div>
      <div class="doctor-src muted small-text">${esc(source ? `${source.split('/').pop()}:${lineno || ''}` : 'en ejecución')}</div>
    </div>
    <div class="doctor-actions">
      <button type="button" class="primary small" id="doctorFixBtn">${icon('bolt', 13)} Corregir con el equipo</button>
      <button type="button" class="ghost icon-only-sm" id="doctorCloseBtn" title="Descartar">${icon('close', 14)}</button>
    </div>
  `;
  toast.hidden = false;

  toast.querySelector('#doctorCloseBtn')?.addEventListener('click', () => {
    toast.hidden = true;
  });

  toast.querySelector('#doctorFixBtn')?.addEventListener('click', async () => {
    toast.hidden = true;
    try {
      const { root } = await api('GET', '/api/app');
      let targetChat = state.chats.find((c) => normPath(c.repoPath) === normPath(root));
      if (!targetChat) {
        await api('POST', '/api/projects', { path: root, prepare: true });
        await loadProjects();
        targetChat = await api('POST', '/api/chats', { repoPath: root, agents: usableAgents() });
        await loadChats();
      }
      openChat(targetChat.id);
      const stackSnippet = lastDoctorError.stack ? `\n\nStack:\n\`\`\`\n${lastDoctorError.stack.slice(0, 1500)}\n\`\`\`` : '';
      const prompt = `🚨 **Error detectado por el Live Error Doctor**:\n\n**Mensaje**: \`${lastDoctorError.message}\`\n**Ubicación**: \`${lastDoctorError.source || 'app'}:${lastDoctorError.lineno || ''}\`${stackSnippet}\n\nPor favor analicen el archivo, ubiquen la causa del problema y apliquen la corrección correspondiente para mantener el sistema 100% estable.`;
      
      const input = $('#chatInput');
      if (input) {
        input.value = prompt;
        input.focus();
        $('#chatForm')?.dispatchEvent(new Event('submit', { cancelable: true }));
      }
    } catch (e) {
      alert(`No se pudo enviar al equipo: ${e.message}`);
    }
  });
}

window.addEventListener('error', (e) => {
  if (e.filename && !e.filename.includes(location.host) && !e.filename.includes('127.0.0.1')) return;
  handleLiveDoctorError(e.error || e.message, e.filename, e.lineno, e.colno);
});

window.addEventListener('unhandledrejection', (e) => {
  handleLiveDoctorError(e.reason || 'Promesa rechazada');
});



