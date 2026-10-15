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
  done: ['Terminado', 'ok'],
  failed: ['Error', 'err'],
  cancelled: ['Cancelado', 'err'],
  interrupted: ['Interrumpido', 'err'],
};
const TASK_STATUS = {
  pending: ['Pendiente', ''],
  running: ['En curso', 'run'],
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

// ------------------------------------------------------------ IAs

async function loadAgents(refresh = false) {
  const data = await api('GET', `/api/agents${refresh ? '?refresh' : ''}`);
  state.agents = data.agents;
  $('#mockBadge').hidden = !data.mock;
  renderChips();
}

$('#addAgentBtn').addEventListener('click', () => $('#addAgentDlg').showModal());
$('#cancelAddAgent').addEventListener('click', () => $('#addAgentDlg').close());
$('#addAgentForm').addEventListener('submit', async (e) => {
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
    $('#addAgentDlg').close();
    form.reset();
    if (state.view === 'new') showNew();
    if (state.view === 'newChat') showNewChat();
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

  const lastRepo = typeof repo === 'string' ? repo : localStorage.getItem('aiteam.repo');
  if (lastRepo) $('[name=repoPath]').value = lastRepo;

  $('[data-agent-pick]').innerHTML = agentPickHtml();
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
      review: f.get('review') === 'on',
      autoApprove: f.get('autoApprove') === 'on',
      adversarial: f.get('adversarial') === 'on',
    };
    const btn = e.target.querySelector('button[type=submit]');
    btn.disabled = true;
    $('#formError').hidden = true;
    try {
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
  const run = await api('GET', `/api/runs/${id}`);
  state.logs = run.log ?? [];
  delete run.log;
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
  const result =
    run.status === 'done' && integ
      ? `<section class="panel">
        <h3>Resultado listo para revisar</h3>
        <p>El equipo terminó e integró sus cambios. Todavía no están aplicados a tu proyecto.</p>
        <button class="primary" id="runDiff">Ver resultado y aplicar</button>
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
      : run.status === 'interrupted'
        ? `<section class="panel run-outcome"><h3>Sin resultado aplicado</h3><p>La app se detuvo durante el trabajo. Las copias parciales siguen guardadas, pero no hay un resultado integrado para aplicar.</p><button id="retryRun" class="primary">Volver a intentar</button></section>`
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
          ${active ? '<button class="danger" id="cancelBtn">Cancelar</button>' : ''}
          ${!active && Object.keys(run.worktrees).length && !run.cleaned ? '<button id="cleanupBtn" title="Borra las carpetas de trabajo; las ramas se conservan">Limpiar copias</button>' : ''}
        </div>
      </div>
      <div class="pipeline">${STEPS.map(([k, label]) => `<div class="step ${stepClass(run, k)}">${label}</div>`).join('')}</div>
      ${run.phase ? `<p class="phase">${esc(run.phase)}</p>` : ''}
      ${run.error ? `<p class="error">${esc(run.error)}</p>` : ''}
      ${run.dirty ? '<p class="muted">' + icon('alert', 13) + ' El repositorio tenía cambios sin commit; las IAs trabajan sobre el último commit.</p>' : ''}
    </section>
    ${result}
    ${
      run.tasks.length
        ? `<${awaiting ? 'section' : 'details'} class="panel run-details" data-section="plan">${awaiting ? '<h3>Plan y reparto</h3>' : '<summary>Plan y reparto</summary>'}
          ${awaiting ? '<p class="muted">Cada barra es la nota que cada IA se puso para esa subtarea. Puedes cambiar el responsable antes de aprobar.</p>' : ''}
          <table><thead><tr><th>ID</th><th>Subtarea</th><th>Valoraciones</th><th>Responsable</th><th>Estado</th></tr></thead>
          <tbody>${tasksRows}</tbody></table></${awaiting ? 'section' : 'details'}>`
        : ''
    }
    <details class="panel run-details" data-section="technical"><summary>Detalles técnicos del equipo</summary><h3>Actividad</h3><div class="lanes">${lanes}</div><h3>Mensajes entre IAs</h3><div class="board">${board}</div></details>
    ${reviews ? `<details class="panel run-details" data-section="reviews"><summary>Revisiones cruzadas</summary>${reviews}</details>` : ''}
    ${run.attack ? `<details class="panel run-details" data-section="attack"><summary>Pruebas adversariales</summary>${attackHtml(run.attack)}</details>` : ''}
  `;

  for (const section of document.querySelectorAll('#main details.run-details')) section.open = openSections.has(section.dataset.section);

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
  $('#retryRun')?.addEventListener('click', () => retryTeamRun(run));
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

// ------------------------------------------------------------ ajustes

$('#settingsBtn').addEventListener('click', async () => {
  const cfg = await api('GET', '/api/config');
  const form = $('#settingsForm');
  form.autonomy.value = cfg.autonomy;
  form.taskTimeoutMinutes.value = cfg.taskTimeoutMinutes;
  form.maxFixRounds.value = cfg.maxFixRounds;
  $('#agentSettings').innerHTML = state.agents
    .map((a) => {
      const c = cfg.agents[a.id] ?? {};
      return `<div class="agent-setting" data-agent="${a.id}">
        <label class="check"><input type="checkbox" data-k="enabled" ${c.enabled !== false ? 'checked' : ''} /> <b style="color:${a.color}">${esc(a.name)}</b> <span class="muted">${esc(a.vendor)}</span></label>
        <label ${a.custom ? 'hidden' : ''}><span>Modelo <em class="muted">(vacío = el predeterminado del CLI)</em></span><input data-k="model" value="${esc(c.model ?? '')}" /></label>
        <label><span>En qué destaca (lo leen las demás IAs al negociar)</span><textarea data-k="profile" rows="2">${esc(c.profile ?? '')}</textarea></label>
        <div class="caps"><span class="muted small-text">Además de programar, puede:</span>${Object.entries(CAP_LABELS).map(([cap, label]) => `<label class="check"><input type="checkbox" data-cap="${cap}" ${(c.capabilities ?? []).includes(cap) ? 'checked' : ''} /> ${esc(CAP_TITLES[cap])}</label>`).join('')}</div>
      </div>`;
    })
    .join('');
  $('#settingsDlg').showModal();
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
  await api('PUT', '/api/config', {
    autonomy: form.autonomy.value,
    taskTimeoutMinutes: Number(form.taskTimeoutMinutes.value) || 30,
    maxFixRounds: Number(form.maxFixRounds.value) || 0,
    agents,
  });
  $('#settingsDlg').close();
  await loadAgents();
  if (state.view === 'new') showNew();
  if (state.view === 'newChat') showNewChat();
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

function showNewChat() {
  state.view = 'newChat';
  state.chat = null;
  state.current = null;
  renderChatList();
  renderRunList();
  const main = $('#main');
  main.innerHTML = '';
  main.append($('#newChatTpl').content.cloneNode(true));
  const lastRepo = localStorage.getItem('aiteam.repo');
  if (lastRepo) $('[name=repoPath]').value = lastRepo;
  $('[data-agent-pick]').innerHTML = agentPickHtml();
  $('#newChatForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const btn = e.target.querySelector('button[type=submit]');
    const errEl = $('[data-form-error]');
    btn.disabled = true;
    errEl.hidden = true;
    try {
      localStorage.setItem('aiteam.repo', f.get('repoPath'));
      const chat = await api('POST', '/api/chats', { repoPath: f.get('repoPath'), agents: f.getAll('agents') });
      await loadChats();
      openChat(chat.id);
    } catch (err) {
      errEl.textContent = err.message;
      errEl.hidden = false;
      btn.disabled = false;
    }
  });
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
  const chat = await api('GET', `/api/chats/${id}`);
  state.chat = chat;
  state.current = null;
  state.view = 'chat';
  state.live = {};
  localStorage.setItem('aiteam.chat', id);
  renderChatList();
  renderRunList();

  $('#main').innerHTML = `
    <div class="chat">
      <div class="chat-head" id="chatHead"></div>
      <div class="chat-msgs" id="chatMsgs"></div>
      <form class="composer" id="composer">
        <div class="mention-bar" id="mentionBar"></div>
        <div class="composer-row">
          <textarea id="chatInput" rows="2" placeholder="Escribe a tu equipo… usa @nombre, @equipo o /equipo objetivo"></textarea>
          <button type="button" class="mic-btn" id="chatMic" title="Dictar por voz (Ctrl+M)" aria-label="Dictar por voz">${icon('mic', 18)}</button>
          <button class="primary" type="submit">Enviar</button>
        </div>
        <div class="muted hint">Intro envía · Mayús+Intro salto de línea · Ctrl+M para dictar · Sin mención responde la última IA que habló.</div>
      </form>
    </div>`;

  $('#mentionBar').innerHTML =
    chat.agents
      .map((a) => {
        const info = agentInfo(a);
        return `<button type="button" class="mention-btn" data-mention="${esc(info.handle ?? a)}" title="${esc(info.vendor ?? '')}">
          ${emblem(a, 22)}<span><b>@${esc(info.handle ?? a)}</b><small>${esc(info.tagline ?? '')}</small></span></button>`;
      })
      .join('') +
    `<button type="button" class="mention-btn" data-mention="equipo" title="Todas las IAs de la conversación">${icon('user', 18)}<span><b>@equipo</b><small>Todas responden por turnos</small></span></button>
     <button type="button" class="mention-btn" data-mention="/equipo" title="Planificar, repartir y trabajar en paralelo">${icon('bolt', 18)}<span><b>/equipo</b><small>Tarea en paralelo con revisión</small></span></button>`;
  $('#mentionBar').addEventListener('click', (e) => {
    const m = e.target.closest('[data-mention]')?.dataset.mention;
    if (!m) return;
    const input = $('#chatInput');
    input.value = m.startsWith('/') ? `${m} ${input.value.replace(/^\/equipo\s*/, '')}` : `${input.value}${input.value && !input.value.endsWith(' ') ? ' ' : ''}@${m} `;
    input.focus();
  });

  const input = $('#chatInput');
  const draftKey = `aiteam.draft.${id}`;
  input.value = localStorage.getItem(draftKey) ?? '';
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
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    localStorage.removeItem(draftKey);
    try {
      await api('POST', `/api/chats/${id}/messages`, { text });
    } catch (err) {
      input.value = text;
      alert(err.message);
    }
  });

  renderChat(true);
  input.focus();
}

function renderChatHead() {
  const chat = state.chat;
  const members = chat.agents
    .map((a) => {
      const st = chat.exhausted?.[a] ? badge([chat.exhausted[a].kind === 'auth' ? 'sin sesión' : 'sin cuota', 'err']) : chat.working?.agent === a ? badge(['trabajando', 'run']) : '';
      return `<span class="member">${agentTag(a)} ${st}</span>`;
    })
    .join('');
  $('#chatHead').innerHTML = `
    <div>
      <div class="chat-title">${esc(chat.title)}</div>
      <div class="muted mono small-text">${esc(chat.repoPath)} · copia en rama ${esc(chat.worktree.branch)}</div>
      <div class="members">${members}</div>
    </div>
    <div class="actions">
      ${chat.working ? '<button class="danger" id="chatStop">Detener</button>' : ''}
      <div class="seg" id="chatAutonomy" title="Qué pueden hacer las IAs en esta conversación">
        <button type="button" data-mode="edits" class="${(chat.autonomy ?? state.defaultAutonomy) !== 'full' ? 'on' : ''}" title="Solo editan archivos en la copia">${icon('lock')} Seguro</button>
        <button type="button" data-mode="full" class="${(chat.autonomy ?? state.defaultAutonomy) === 'full' ? 'on warn-on' : ''}" title="Pueden ejecutar comandos e instalar cosas">${icon('bolt')} Control total</button>
      </div>
      <button id="chatFiles">${icon('folder')} Archivos</button>
      <button id="chatDiff" class="primary">${icon('fileDiff')} Revisar cambios</button>
      <button class="ghost" id="chatDelete" title="Borra la conversación y su copia de trabajo (la rama se conserva)">Eliminar</button>
    </div>`;
  $('#chatStop')?.addEventListener('click', () => api('POST', `/api/chats/${chat.id}/stop`));
  $('#chatDiff').addEventListener('click', () => openReview('chats', chat.id));
  $('#chatFiles').addEventListener('click', () => openFiles(chat.worktree.path, 'copia de la conversación'));
  $('#chatAutonomy').addEventListener('click', async (e) => {
    const value = e.target.closest('[data-mode]')?.dataset.mode;
    if (!value || value === (chat.autonomy ?? state.defaultAutonomy)) return;
    if (
      value === 'full' &&
      !confirm('Con "Control total" las IAs pueden ejecutar cualquier comando en tu PC (instalar programas, lanzar servidores, borrar archivos…) sin pedirte permiso. ¿Activarlo en esta conversación?')
    ) {
      return;
    }
    await api('PATCH', `/api/chats/${chat.id}`, { autonomy: value });
  });
  $('#chatDelete').addEventListener('click', async () => {
    if (!confirm('¿Eliminar esta conversación? Se borra su copia de trabajo; la rama git se conserva.')) return;
    await api('DELETE', `/api/chats/${chat.id}`);
    localStorage.removeItem('aiteam.chat');
    await loadChats();
    state.chats.length ? openChat(state.chats[0].id) : showNewChat();
  });
}

function messageHtml(m) {
  if (m.from === 'system') {
    if (m.meta?.runId) return `<div class="run-card" data-run-card="${esc(m.meta.runId)}">${runCardHtml(state.runDetails.get(m.meta.runId) ?? state.runs.find((r) => r.id === m.meta.runId))}</div>`;
    return `<div class="sys ${m.kind === 'error' ? 'error' : ''}">${esc(m.text)}</div>`;
  }
  if (m.from === 'user') {
    return `<div class="bubble-row user"><div class="bubble">${md(m.text)}<div class="when">${fmtTime(m.ts)}</div></div><div class="avatar">${userAvatar(34)}</div></div>`;
  }
  const a = agentInfo(m.from);
  const to = m.to?.length ? ` <span class="muted">→ ${m.to.map((t) => `<span style="color:${agentInfo(t).color}">@${esc(agentInfo(t).handle ?? t)}</span>`).join(', ')}</span>` : '';
  const meta = m.meta ?? {};
  const images = meta.changed ? messageFiles(meta).filter(isImage) : [];
  const extras = [
    images.length
      ? `<div class="thumbs">${images
          .map((f) => {
            const src = imgUrl(state.chat.worktree.path, f, m.id);
            return `<figure class="thumb checker" title="Clic para ampliar"><img src="${src}" alt="${esc(f)}" loading="lazy" data-zoom="${src}" data-name="${esc(f)}" onerror="this.closest('figure').remove()" /><figcaption>${esc(f.split('/').pop())}</figcaption></figure>`;
          })
          .join('')}</div>`
      : '',
    meta.changed ? `<details><summary>${icon('file', 13)} Archivos cambiados</summary><pre class="output">${esc(meta.stat)}</pre></details>` : '',
    meta.activity?.length ? `<details><summary>Actividad (${meta.activity.length})</summary><div class="activity">${meta.activity.map((l) => `<div>${iconizeLine(l, esc)}</div>`).join('')}</div></details>` : '',
  ].join('');
  return `<div class="bubble-row agent">
    <div class="avatar">${emblem(m.from, 34)}</div>
    <div class="bubble" style="border-left-color:${a.color}">
      <div class="who"><b style="color:${a.color}">${esc(a.name)}</b>${to} <span class="when">${fmtTime(m.ts)}${meta.durationMs ? ` · ${Math.round(meta.durationMs / 1000)}s` : ''}</span></div>
      <div class="text">${md(m.text)}</div>
      ${extras}
    </div>
  </div>`;
}

function runCardHtml(run) {
  if (!run) return '<span class="muted">Cargando resultado del equipo…</span>';
  const total = run.tasks?.length ?? 0;
  const done = run.tasks?.filter((t) => t.status === 'done').length ?? 0;
  const waiting = run.status === 'awaiting_approval';
  const ready = run.status === 'done' && run.integration;
  const failed = ['interrupted', 'failed', 'cancelled'].includes(run.status);
  const lead = ready ? 'Resultado listo para revisar' : waiting ? 'El equipo espera tu aprobación' : failed ? 'La tarea terminó sin resultado aplicable' : 'El equipo está trabajando';
  const explain = ready
    ? `Completó ${done} de ${total} subtareas. Sus cambios están guardados y pendientes de aplicar.`
    : run.status === 'interrupted'
      ? 'La app se detuvo durante el trabajo. No se integraron ni aplicaron los cambios parciales.'
      : failed ? (run.error || 'No se generó un resultado para aplicar.')
        : total ? `${done} de ${total} subtareas completadas. ${run.phase ?? ''}` : (run.phase ?? 'Organizando el trabajo…');
  const summaries = ready ? run.tasks?.filter((t) => t.status === 'done' && t.summary).map((t) => `<li><b>${esc(t.title)}</b>: ${esc(t.summary)}</li>`).join('') : '';
  const files = state.runChanges.get(run.id)?.files ?? [];
  const previewFiles = files.filter((f) => f.status !== 'D' && isImage(f.file))
    .sort((a, b) => Number(/candidatos?\//i.test(a.file)) - Number(/candidatos?\//i.test(b.file)))
    .slice(0, 3);
  return `<div class="run-card-top"><span class="run-card-kicker">TRABAJO EN EQUIPO</span>${badge(STATUS[run.status] ?? [run.status, ''])}</div>
    <h3>${esc(lead)}</h3><p>${esc(explain)}</p>
    ${ready && files.length ? `<p class="muted small-text">${files.length} archivo(s) modificados</p>` : ''}
    ${previewFiles.length && run.integration?.worktree ? `<div class="run-previews">${previewFiles.map((f) => `<img src="${imgUrl(run.integration.worktree, f.file, run.id)}" alt="${esc(f.file)}" loading="lazy" data-zoom="${imgUrl(run.integration.worktree, f.file, run.id)}" data-name="${esc(f.file)}" /></div>`).join('')}</div>` : ''}
    ${summaries ? `<details><summary>Qué hizo el equipo</summary><ul>${summaries}</ul></details>` : ''}
    <div class="actions">
      ${ready ? `<button class="primary small" data-run-review="${esc(run.id)}">Ver resultado y aplicar</button>` : ''}
      ${waiting ? `<button class="primary small" data-open-run="${esc(run.id)}">Revisar reparto</button>` : ''}
      ${failed ? `<button class="small" data-run-retry="${esc(run.id)}">Volver a intentar</button>` : ''}
      <button class="small ghost" data-open-run="${esc(run.id)}">Detalles técnicos</button>
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
    <div class="avatar">${emblem(w.agent, 34)}</div>
    <div class="bubble" style="border-left-color:${a.color}">
      <div class="who"><b style="color:${a.color}">${esc(a.name)}</b> <span class="typing">trabajando<span>.</span><span>.</span><span>.</span></span></div>
      <div class="activity" id="liveActivity">${lines.map((l) => `<div>${iconizeLine(l, esc)}</div>`).join('')}</div>
    </div>
  </div>`;
}

function renderChat(forceScroll = false) {
  if (!state.chat || !$('#chatMsgs')) return;
  renderChatHead();
  const box = $('#chatMsgs');
  const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
  box.innerHTML = state.chat.messages.map(messageHtml).join('') + liveHtml();
  hydrateRunCards();
  if (forceScroll || nearBottom) box.scrollTop = box.scrollHeight;
}

document.addEventListener('click', (e) => {
  const review = e.target.closest('[data-run-review]');
  if (review) return openReview('runs', review.dataset.runReview);
  const retry = e.target.closest('[data-run-retry]');
  if (retry) return retryTeamRun(state.runDetails.get(retry.dataset.runRetry));
  const details = e.target.closest('[data-open-run]');
  if (details) return openRun(details.dataset.openRun);
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

function renderSidebar() {
  const tree = $('#projectTree');
  if (!tree) return;
  // Proyectos guardados + los que aparezcan en conversaciones o tareas nuevas.
  const paths = new Map(state.projects.map((p) => [normPath(p.path), p]));
  for (const item of [...state.chats, ...state.runs]) {
    if (item.repoPath && !paths.has(normPath(item.repoPath))) {
      paths.set(normPath(item.repoPath), { path: item.repoPath, name: item.repoPath.split(/[\\/]/).pop() });
    }
  }
  if (!paths.size) {
    tree.innerHTML = '<p class="muted small-text" style="padding:0 6px">Añade la carpeta de un proyecto para empezar.</p>';
    return;
  }
  tree.innerHTML = [...paths.values()]
    .map((p) => {
      const key = normPath(p.path);
      const chats = state.chats.filter((c) => normPath(c.repoPath) === key);
      const runs = state.runs.filter((r) => normPath(r.repoPath) === key && !chats.some((c) => c.branch && c.branch === r.baseBranch));
      const open = !collapsed.has(key);
      const items = [
        ...chats.map(
          (c) => `<li data-chat="${c.id}" class="${state.view === 'chat' && state.chat?.id === c.id ? 'active' : ''}">
            <span class="ico">${icon('chat', 14)}</span><span class="label">${esc(c.title)}</span>
            ${c.working ? `<span class="dot pulse" style="background:${agentInfo(c.working.agent).color}" title="${esc(agentInfo(c.working.agent).name)} trabajando"></span>` : ''}
          </li>`,
        ),
        ...runs.map(
          (r) => `<li data-run="${r.id}" class="${state.view === 'run' && state.current?.id === r.id ? 'active' : ''}">
            <span class="ico">${icon('bolt', 14)}</span><span class="label">${esc(r.goal)}</span>${badge(STATUS[r.status] ?? [r.status, ''])}
          </li>`,
        ),
      ].join('');
      return `<div class="project">
        <div class="project-head" data-toggle="${esc(key)}" title="${esc(p.path)}">
          <span class="caret">${icon(open ? 'chevDown' : 'chevRight', 13)}</span>
          <span class="project-name">${esc(p.name)}</span>
          <span class="project-actions">
            <button class="small ghost" data-new-chat="${esc(p.path)}" title="Nueva conversación">${icon('chatPlus', 15)}</button>
            <button class="small ghost" data-new-run="${esc(p.path)}" title="Nueva tarea de equipo (en paralelo)">${icon('boltPlus', 15)}</button>
            <button class="small ghost" data-files="${esc(p.path)}" title="Ver archivos">${icon('folder', 15)}</button>
          </span>
        </div>
        ${open ? `<ul class="run-list">${items || '<li class="muted small-text" style="cursor:default">Sin conversaciones todavía.</li>'}</ul>` : ''}
      </div>`;
    })
    .join('');
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
  $('#addProjectForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const path = new FormData(e.target).get('path');
    const errEl = $('[data-form-error]');
    errEl.hidden = true;
    try {
      const p = await api('POST', '/api/projects', { path });
      await loadProjects();
      await newChatFor(p.path);
    } catch (err) {
      errEl.textContent = err.message;
      errEl.hidden = false;
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
    await api('POST', '/api/projects', { path: root });
    await loadProjects();
    await newChatFor(root);
  } catch (err) { alert(err.message); }
  finally { btn.disabled = false; }
});

// ------------------------------------------------------------ equipo y uso

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
  const cls = w.percent >= 90 ? 'err' : w.percent >= 70 ? 'warn' : 'ok';
  return `<div class="meter" title="Usado ${w.percent}%${w.resetsAt ? ` · se reinicia ${fmtReset(w.resetsAt)}` : ''}">
    <span class="m-label">${label}</span>
    <span class="m-bar"><i class="${cls}" style="width:${w.percent}%"></i></span>
    <span class="m-val">${left}% libre${w.resetsAt ? ` · ${fmtReset(w.resetsAt)}` : ''}</span>
  </div>`;
}

function renderTeam() {
  const panel = $('#teamPanel');
  if (!panel) return;
  panel.innerHTML = state.agents
    .map((a) => {
      const u = state.usage?.[a.id];
      const cls = !a.installed ? 'err' : a.working === true ? 'ok' : a.working === false ? 'err' : 'unk';
      const title = !a.installed
        ? 'CLI no instalado'
        : a.working === false
          ? `No responde: ${a.error ?? ''}`
          : a.working === true
            ? `Funciona (${a.version})`
            : `Instalado (${a.version}). Pulsa "Probar" para comprobar la sesión.`;
      const meters =
        u && (u.session || u.weekly)
          ? meter('Sesión', u.session) + meter('Semana', u.weekly)
          : `<div class="meter muted small-text">${u?.note ?? 'Sin datos de uso todavía.'}${u?.callsToday ? ` · ${u.callsToday} peticiones hoy` : ''}</div>`;
      return `<div class="team-agent">
        <div class="team-row" title="${esc(title)}">
          <span class="dot ${cls}"></span>${emblem(a.id, 18)}<b style="color:${a.color}">${esc(a.name)}</b>
          <button class="small ghost" data-test="${a.id}" ${a.installed ? '' : 'disabled'}>Probar</button>
        </div>
        ${meters}
      </div>`;
    })
    .join('');
}

$('#teamPanel').addEventListener('click', async (e) => {
  const id = e.target.dataset?.test;
  if (!id) return;
  e.target.disabled = true;
  e.target.textContent = '…';
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
  $('#rvSub').textContent = `Se aplicará a tu proyecto en la rama ${rv.info.projectBranch}${rv.info.projectDirty ? ' · tiene cambios sin guardar' : ''}`;
  $('#rvCount').textContent = rv.files.length ? `${accepted}/${rv.files.length} aceptados` : '';
  $('#rvList').innerHTML = rv.files.length
    ? rv.files
        .map(
          (f) => `<div class="rv-file ${rv.selected === f.file ? 'active' : ''} ${f.accepted ? 'ok' : ''}" data-rv-file="${esc(f.file)}" title="${esc(f.file)}">
            <span class="rv-st st-${f.status}">${esc(f.status)}</span>
            <span class="rv-name">${esc(f.file.split('/').pop())}<span class="muted small-text"> ${esc(f.file.split('/').slice(0, -1).join('/'))}</span></span>
            <span class="rv-n"><span class="add">+${f.add}</span> <span class="del">-${f.del}</span></span>
            <span class="rv-ok">${f.accepted ? icon('check', 14) : ''}</span>
          </div>`,
        )
        .join('')
    : '<p class="muted" style="padding:10px">No hay cambios pendientes: todo está aplicado en tu proyecto.</p>';
  $('#rvApply').disabled = !rv.files.length;
  $('#rvApply').textContent = rv.files.length ? `Aplicar al proyecto (${rv.files.length})` : 'Aplicar al proyecto';
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
  const pending = rv.files.filter((f) => !f.accepted).length;
  const msg = pending
    ? `Hay ${pending} archivo(s) sin revisar que también se aplicarán. ¿Aplicar los ${rv.files.length} cambios a tu proyecto (rama ${rv.info.projectBranch})?`
    : `¿Aplicar los ${rv.files.length} cambios a tu proyecto (rama ${rv.info.projectBranch})?`;
  if (!confirm(msg)) return;
  $('#rvApply').disabled = true;
  try {
    const r = await api('POST', `${rvBase()}/apply`);
    if (r.ok) {
      $('#rvMsg').innerHTML = `<span class="ok-text">${icon('checkCircle')} Aplicados ${r.files} archivo(s) a la rama ${esc(r.branch)} de tu proyecto.</span>${
        r.selfUpdate ? ' <button class="primary small" id="rvRestart">Reiniciar AITeam ahora</button> <span class="muted small-text">para ver los cambios</span>' : ''
      }`;
      $('#rvRestart')?.addEventListener('click', () => {
        reviewDlg.close();
        restartAITeam();
      });
      await loadReview();
      $('#rvMain').innerHTML = '<p class="muted">Todo aplicado.</p>';
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

function setLook(key, value) {
  document.documentElement.dataset[key] = value;
  try {
    localStorage.setItem(`aiteam.${key}`, value);
  } catch {
    /* sin almacenamiento: solo para esta sesión */
  }
  renderAppearance();
}

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

// ------------------------------------------------------------ apagar

$('#shutdownBtn').addEventListener('click', async () => {
  const busy = state.chats.some((c) => c.working) || state.runs.some((r) => ['planning', 'bidding', 'running', 'reviewing', 'integrating', 'attacking', 'testing'].includes(r.status));
  const msg = busy ? 'Hay IAs trabajando ahora mismo y su trabajo se interrumpirá. ¿Apagar AITeam igualmente?' : '¿Apagar AITeam? Podrás volver a abrirlo con el acceso directo.';
  if (!confirm(msg)) return;
  await api('POST', '/api/shutdown').catch(() => {});
  $('#settingsDlg').close();
  document.body.innerHTML = '<div class="empty"><h1>AITeam está apagado</h1><p>Ábrelo de nuevo desde el acceso directo del escritorio. Ya puedes cerrar esta ventana.</p></div>';
});

// ------------------------------------------------------------ arranque

await loadAgents();
{
  const cfg = await api('GET', '/api/config');
  state.defaultAutonomy = cfg.autonomy;
  state.notify = { enabled: cfg.notifications?.enabled !== false, sound: cfg.notifications?.sound !== false };
}
await Promise.all([loadRuns(), loadChats(), loadProjects(), loadUsage(), loadSpeech()]);
// Estado inicial para detectar cambios (y no avisar de lo que ya había pasado).
for (const c of state.chats) prevChatWorking.set(c.id, Boolean(c.working));
for (const r of state.runs) prevRunStatus.set(r.id, r.status);
const lastChat = localStorage.getItem('aiteam.chat');
if (lastChat && state.chats.some((c) => c.id === lastChat)) openChat(lastChat);
else if (state.chats.length) openChat(state.chats[0].id);
else showAddProject();
