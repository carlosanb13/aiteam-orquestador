const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const state = {
  agents: [],
  runs: [],
  current: null, // run completo
  logs: [],
  view: 'new',
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

const agentInfo = (id) => state.agents.find((a) => a.id === id) ?? { id, name: id, color: '#888' };
const badge = ([label, cls]) => `<span class="badge ${cls}">${esc(label)}</span>`;
const fmtTime = (iso) => new Date(iso).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const fmtDate = (iso) => new Date(iso).toLocaleString('es', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
const agentTag = (id) => {
  const a = agentInfo(id);
  return `<span class="agent-tag"><span class="dot" style="background:${a.color}"></span>${esc(a.name)}</span>`;
};

async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
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

function renderChips() {
  $('#agentChips').innerHTML = state.agents
    .map((a) => {
      const cls = !a.installed ? 'err' : a.working === true ? 'ok' : a.working === false ? 'err' : 'unk';
      const title = !a.installed
        ? 'CLI no instalado'
        : a.working === false
          ? `No responde: ${a.error ?? ''}`
          : a.working === true
            ? `Funciona (${a.version})`
            : `Instalado (${a.version}). Pulsa "Probar" para comprobar la sesión.`;
      return `<span class="chip" title="${esc(title)}">
        <span class="dot ${cls}"></span><span style="color:${a.color};font-weight:600">${esc(a.name)}</span>
        <button class="small ghost" data-test="${a.id}" ${a.installed ? '' : 'disabled'}>Probar</button>
      </span>`;
    })
    .join('');
}

$('#agentChips').addEventListener('click', async (e) => {
  const id = e.target.dataset?.test;
  if (!id) return;
  e.target.disabled = true;
  e.target.textContent = '…';
  try {
    const r = await api('POST', `/api/agents/${id}/test`);
    Object.assign(agentInfo(id), r);
  } catch (err) {
    Object.assign(agentInfo(id), { working: false, error: err.message });
  }
  renderChips();
});

// ------------------------------------------------------------ historial

async function loadRuns() {
  state.runs = await api('GET', '/api/runs');
  renderRunList();
}

function renderRunList() {
  const list = $('#runList');
  if (!state.runs.length) {
    list.innerHTML = '<li class="muted" style="cursor:default">Aún no hay tareas.</li>';
    return;
  }
  list.innerHTML = state.runs
    .map(
      (r) => `<li data-id="${r.id}" class="${state.view === 'run' && state.current?.id === r.id ? 'active' : ''}">
        <div class="goal">${esc(r.goal)}</div>
        <div class="meta">${badge(STATUS[r.status] ?? [r.status, ''])} ${fmtDate(r.createdAt)}</div>
      </li>`,
    )
    .join('');
}

$('#runList').addEventListener('click', (e) => {
  const li = e.target.closest('li[data-id]');
  if (li) openRun(li.dataset.id);
});

// ------------------------------------------------------------ nueva tarea

function agentPickHtml() {
  return state.agents
    .map((a) => {
      const usable = a.installed && a.enabled !== false && a.working !== false;
      const note = !a.installed ? 'no instalado' : a.working === false ? 'no responde' : a.enabled === false ? 'desactivado' : esc(a.vendor);
      return `<label><input type="checkbox" name="agents" value="${a.id}" ${usable ? 'checked' : ''} />
        <span><b style="color:${a.color}">${esc(a.name)}</b><br><span class="note">${note}</span></span></label>`;
    })
    .join('');
}

function showNew() {
  state.view = 'new';
  state.current = null;
  state.chat = null;
  renderRunList();
  renderChatList();
  const main = $('#main');
  main.innerHTML = '';
  main.append($('#newRunTpl').content.cloneNode(true));

  const lastRepo = localStorage.getItem('aiteam.repo');
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

$('#newRunBtn').addEventListener('click', showNew);

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
          <div class="title">${esc(t.title)} <span class="badge">${esc(t.kind)}</span></div>
          <details class="desc"><summary>Detalles</summary><div class="desc">${esc(t.description)}</div></details>
          ${t.dependsOn.length ? `<div class="desc">Depende de: ${t.dependsOn.map(esc).join(', ')}</div>` : ''}
          ${t.reassignedFrom?.length ? `<div class="desc">↪ Reasignada (antes: ${t.reassignedFrom.map((a) => esc(agentInfo(a).name)).join(', ')})</div>` : ''}
          ${t.summary ? `<div class="summary">${esc(t.summary)}</div>` : ''}
          ${t.error ? `<div class="summary error">${esc(t.error)}</div>` : ''}
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
        <h3>Resultado</h3>
        <p>Todo el trabajo integrado está en la rama <code>${esc(integ.branch)}</code>. <button class="small" id="runDiff">Ver cambios</button> Si te convence, fusiónalo en tu rama:</p>
        <div class="copy-row"><code>cd "${esc(run.repoPath)}" &amp;&amp; git diff ${esc(run.baseBranch)}...${esc(integ.branch)}</code><button class="small" data-copy>Copiar</button></div>
        <div class="copy-row"><code>cd "${esc(run.repoPath)}" &amp;&amp; git merge ${esc(integ.branch)}</code><button class="small" data-copy>Copiar</button></div>
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
          ${active ? '<button class="danger" id="cancelBtn">Cancelar</button>' : ''}
          ${!active && Object.keys(run.worktrees).length && !run.cleaned ? '<button id="cleanupBtn" title="Borra las carpetas de trabajo; las ramas se conservan">Limpiar copias</button>' : ''}
        </div>
      </div>
      <div class="pipeline">${STEPS.map(([k, label]) => `<div class="step ${stepClass(run, k)}">${label}</div>`).join('')}</div>
      ${run.phase ? `<p class="phase">${esc(run.phase)}</p>` : ''}
      ${run.error ? `<p class="error">${esc(run.error)}</p>` : ''}
      ${run.dirty ? '<p class="muted">⚠ El repositorio tenía cambios sin commit; las IAs trabajan sobre el último commit.</p>' : ''}
    </section>
    ${result}
    ${
      run.tasks.length
        ? `<section class="panel"><h3>Plan y reparto</h3>
          ${awaiting ? '<p class="muted">Cada barra es la nota que cada IA se puso para esa subtarea. Puedes cambiar el responsable antes de aprobar.</p>' : ''}
          <table><thead><tr><th>ID</th><th>Subtarea</th><th>Valoraciones</th><th>Responsable</th><th>Estado</th></tr></thead>
          <tbody>${tasksRows}</tbody></table></section>`
        : ''
    }
    <section class="panel"><h3>Actividad en vivo</h3><div class="lanes">${lanes}</div></section>
    <section class="panel"><h3>Tablero del equipo</h3><div class="board">${board}</div></section>
    ${reviews ? `<section class="panel"><h3>Revisiones cruzadas</h3>${reviews}</section>` : ''}
    ${run.attack ? attackHtml(run.attack) : ''}
  `;

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
  $('#runDiff')?.addEventListener('click', () => showDiff(`/api/runs/${run.id}/diff`));
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
  line.innerHTML = `<span class="t">${fmtTime(entry.ts)}</span> ${esc(entry.text)}`;
  lane.append(line);
  if (scroll && nearBottom) lane.scrollTop = lane.scrollHeight;
}

// ------------------------------------------------------------ tiempo real

const events = new EventSource('/api/events');
let runRenderQueued = false;
events.addEventListener('run', (e) => {
  const run = JSON.parse(e.data);
  const idx = state.runs.findIndex((r) => r.id === run.id);
  const summary = { id: run.id, goal: run.goal, status: run.status, createdAt: run.createdAt, agents: run.agents, repoPath: run.repoPath };
  if (idx >= 0) state.runs[idx] = summary;
  else state.runs.unshift(summary);
  renderRunList();
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
        <label><span>Modelo <em class="muted">(vacío = el predeterminado del CLI)</em></span><input data-k="model" value="${esc(c.model ?? '')}" /></label>
        <label><span>En qué destaca (lo leen las demás IAs al negociar)</span><textarea data-k="profile" rows="2">${esc(c.profile ?? '')}</textarea></label>
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
  const list = $('#chatList');
  if (!state.chats.length) {
    list.innerHTML = '<li class="muted" style="cursor:default">Aún no hay conversaciones.</li>';
    return;
  }
  list.innerHTML = state.chats
    .map(
      (c) => `<li data-id="${c.id}" class="${state.view === 'chat' && state.chat?.id === c.id ? 'active' : ''}">
        <div class="goal">${esc(c.title)}</div>
        <div class="meta">${c.working ? badge([`${agentInfo(c.working.agent).name} trabajando`, 'run']) : ''} ${fmtDate(c.updatedAt ?? c.createdAt)}</div>
      </li>`,
    )
    .join('');
}

$('#chatList').addEventListener('click', (e) => {
  const li = e.target.closest('li[data-id]');
  if (li) openChat(li.dataset.id);
});

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

$('#newChatBtn').addEventListener('click', showNewChat);

/** Markdown mínimo: bloques de código, `código`, **negrita** y menciones. */
function md(text) {
  const parts = String(text ?? '').split(/```(\w*)\n?([\s\S]*?)```/g);
  let html = '';
  for (let i = 0; i < parts.length; i++) {
    if (i % 3 === 0) {
      html += esc(parts[i])
        .replace(/`([^`\n]+)`/g, '<code>$1</code>')
        .replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>')
        .replace(/(^|\s)@(claude|codex|chatgpt|gemini|equipo|todos)\b/gi, (m, pre, name) => {
          const id = { chatgpt: 'codex' }[name.toLowerCase()] ?? name.toLowerCase();
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
          <textarea id="chatInput" rows="2" placeholder="Escribe a tu equipo… (@claude, @codex, @gemini, @equipo · /equipo objetivo lanza una tarea de equipo en paralelo)"></textarea>
          <button class="primary" type="submit">Enviar</button>
        </div>
        <div class="muted hint">Intro envía · Mayús+Intro salto de línea · Sin mención responde la última IA que habló.</div>
      </form>
    </div>`;

  $('#mentionBar').innerHTML =
    chat.agents.map((a) => `<button type="button" class="small mention-btn" data-mention="${a}" style="color:${agentInfo(a).color}">@${a}</button>`).join('') +
    `<button type="button" class="small mention-btn" data-mention="equipo">@equipo</button>
     <button type="button" class="small mention-btn" data-mention="/equipo">/equipo</button>`;
  $('#mentionBar').addEventListener('click', (e) => {
    const m = e.target.dataset?.mention;
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
  $('#composer').addEventListener('submit', async (e) => {
    e.preventDefault();
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
      const st = chat.exhausted?.[a] ? badge(['sin cuota', 'err']) : chat.working?.agent === a ? badge(['trabajando', 'run']) : '';
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
      <button id="chatDiff">Ver cambios</button>
      <button class="ghost" id="chatDelete" title="Borra la conversación y su copia de trabajo (la rama se conserva)">Eliminar</button>
    </div>`;
  $('#chatStop')?.addEventListener('click', () => api('POST', `/api/chats/${chat.id}/stop`));
  $('#chatDiff').addEventListener('click', () => showDiff(`/api/chats/${chat.id}/diff`));
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
    const run = m.meta?.runId ? ` <a href="#" data-open-run="${m.meta.runId}">Ver la tarea de equipo →</a>` : '';
    return `<div class="sys ${m.kind === 'error' ? 'error' : ''}">${esc(m.text)}${run}</div>`;
  }
  if (m.from === 'user') {
    return `<div class="bubble-row user"><div class="bubble">${md(m.text)}<div class="when">${fmtTime(m.ts)}</div></div></div>`;
  }
  const a = agentInfo(m.from);
  const to = m.to?.length ? ` <span class="muted">→ ${m.to.map((t) => `<span style="color:${agentInfo(t).color}">@${esc(t)}</span>`).join(', ')}</span>` : '';
  const meta = m.meta ?? {};
  const extras = [
    meta.changed ? `<details><summary>📝 Archivos cambiados</summary><pre class="output">${esc(meta.stat)}</pre></details>` : '',
    meta.activity?.length ? `<details><summary>Actividad (${meta.activity.length})</summary><div class="activity">${meta.activity.map((l) => `<div>${esc(l)}</div>`).join('')}</div></details>` : '',
  ].join('');
  return `<div class="bubble-row agent">
    <div class="avatar" style="background:${a.color}">${esc(a.name[0])}</div>
    <div class="bubble" style="border-left-color:${a.color}">
      <div class="who"><b style="color:${a.color}">${esc(a.name)}</b>${to} <span class="when">${fmtTime(m.ts)}${meta.durationMs ? ` · ${Math.round(meta.durationMs / 1000)}s` : ''}</span></div>
      <div class="text">${md(m.text)}</div>
      ${extras}
    </div>
  </div>`;
}

function liveHtml() {
  const w = state.chat.working;
  if (!w) return '';
  const a = agentInfo(w.agent);
  const lines = (state.live[w.agent] ?? []).slice(-8);
  return `<div class="bubble-row agent live">
    <div class="avatar" style="background:${a.color}">${esc(a.name[0])}</div>
    <div class="bubble" style="border-left-color:${a.color}">
      <div class="who"><b style="color:${a.color}">${esc(a.name)}</b> <span class="typing">trabajando<span>.</span><span>.</span><span>.</span></span></div>
      <div class="activity" id="liveActivity">${lines.map((l) => `<div>${esc(l)}</div>`).join('')}</div>
    </div>
  </div>`;
}

function renderChat(forceScroll = false) {
  if (!state.chat || !$('#chatMsgs')) return;
  renderChatHead();
  const box = $('#chatMsgs');
  const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
  box.innerHTML = state.chat.messages.map(messageHtml).join('') + liveHtml();
  for (const link of box.querySelectorAll('[data-open-run]')) {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      openRun(link.dataset.openRun);
    });
  }
  if (forceScroll || nearBottom) box.scrollTop = box.scrollHeight;
}

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
    box.innerHTML = state.live[agent].slice(-8).map((l) => `<div>${esc(l)}</div>`).join('');
    const msgs = $('#chatMsgs');
    if (msgs.scrollHeight - msgs.scrollTop - msgs.clientHeight < 160) msgs.scrollTop = msgs.scrollHeight;
  }
});
events.addEventListener('chat-removed', (e) => {
  const { id } = JSON.parse(e.data);
  state.chats = state.chats.filter((c) => c.id !== id);
  renderChatList();
});

// ------------------------------------------------------------ arranque

await loadAgents();
await Promise.all([loadRuns(), loadChats()]);
const lastChat = localStorage.getItem('aiteam.chat');
if (lastChat && state.chats.some((c) => c.id === lastChat)) openChat(lastChat);
else if (state.chats.length) openChat(state.chats[0].id);
else showNewChat();
