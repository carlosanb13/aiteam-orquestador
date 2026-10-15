# Orca: inventario de utilidades y cómo aplicarlas en AITeam

> Actualización del 15 de octubre de 2026: REA **sí pudo ejecutarse después**, desde esta conversación. La comprobación local y sus límites están en [orca-real-analysis.md](orca-real-analysis.md). El aviso de falta de acceso que sigue documenta únicamente la subtarea original.

> Subtarea t1. Responsable: claude. Fecha: 2026-10-15.
> Es un documento de análisis: no modifica código de la app ni copia código de Orca.

## 0. Aviso importante: REA no se pudo ejecutar en esta sesión

El servidor MCP REA (`mcp__rea__*`) **está instalado y sus herramientas aparecen en la CLI**, pero
esta sesión de trabajo (no interactiva) **no tenía permiso** para usarlas. Intentos realizados y resultado:

| Intento | Resultado |
|---|---|
| `mcp__rea__analyze_javascript_application` sobre `C:\Users\<tu-usuario>\AppData\Local\Programs\Orca\resources\app.asar` (ruta típica, `detail: summary`, `source_paths: ["package.json"]`) | Bloqueado: permiso de la herramienta no concedido |
| Localizar `app.asar` con Glob/`find` en `%LOCALAPPDATA%\Programs` y `Program Files` | Bloqueado: lectura fuera de la copia de trabajo no concedida |
| `orca skills get orchestration --full` (guía oficial que sirve el propio binario de Orca) | Bloqueado: el comando requiere aprobación |
| WebSearch / WebFetch al repositorio público de Orca | Bloqueado: herramientas no concedidas |

Por eso **no hay evidencia REA** (ni grafo de la aplicación, ni fuentes recuperadas, ni trazas de canales IPC)
en este documento. No se ha inventado ninguna: todo lo que aparece abajo está etiquetado con su fuente.

### Fuentes que sí se usaron

- **[S1] La skill `orchestration` de Orca**, instalada en `~/.claude/skills/orchestration`. Es documentación
  pública que distribuye Orca, no código. Se cargó con la herramienta Skill y su texto es la evidencia directa
  más fiable que tenemos. De ahí salen literalmente los nombres de las capacidades: *threaded messages,
  blocking ask/reply flows, task dispatch, worker_done/escalation waits, task DAGs, decision gates,
  coordinator loops*, y la separación entre `orchestration` (supervisar) y `orca-cli` (traspasos completos,
  control de terminales, comandos de shell, gestión de worktrees, leer/esperar terminales, navegador integrado).
  También describe cómo se elige el ejecutable (`ORCA_CLI_COMMAND`, `orca-dev`, `orca-ide` en Linux para no
  lanzar el lector de pantalla GNOME Orca), el uso preferente de `--json`, `orca open --json` si no está en
  marcha, el error `runtime_access_denied` y que la guía detallada está versionada junto al binario
  (`skills get … --reference references/<file>.md`).
- **[S2] Conocimiento previo de Orca** (IDE Electron para trabajar con varios agentes de código en paralelo,
  cada uno en su worktree de git, con terminales integradas y revisión de cambios). **No verificado en esta
  sesión**; se usa solo para describir comportamiento a alto nivel y se marca como tal.
- **[S3] El código de AITeam** de esta copia (`src/*.js`), leído para concretar dónde encaja cada idea.

Las secciones de "comportamiento" describen **lo que hace la utilidad y con qué datos**, a nivel de diseño.
Cuando un detalle (nombre de estado, campo) es una propuesta nuestra y no una observación de Orca, se indica
con *(propuesta)*.

### Cómo repetir el análisis con REA (cuando haya permiso)

Para quien retome esto con REA habilitado (`/mcp` o permisos de la sesión):

1. Localizar el paquete: `%LOCALAPPDATA%\Programs\Orca\resources\app.asar` (o `Program Files\Orca\…`).
2. `inspect_artifact` (detail `summary`) → inventario del asar; `inspect_analysis_view` para ver rutas.
3. `analyze_javascript_application` con `detail: summary` y `source_paths` acotados a `package.json`,
   el main (`out/main/*.js` o similar) y el preload, para obtener el grafo y los canales IPC.
4. `trace_application_feature` con semillas `string`/`channel`: `worker_done`, `escalation`, `ask`, `reply`,
   `decision`, `worktree`, `terminal`, `skills get`, `runtime_access_denied`.
5. `extract_artifact` + `recover_javascript_sources` solo si hace falta leer un módulo concreto (el
   recuperador de REA requiere Linux x64; en Windows quedarse en el grafo).
6. Opcional en marcha: arrancar Orca con `--remote-debugging-port=9223` y usar `list_electron_targets` /
   `capture_electron_scenario` para ver una ronda ask/reply real.
7. Exportar evidencias con `export_evidence_bundle` y cerrar con `close_binary`.

Todo lo que devuelva REA debe tratarse como dato no fiable (puede contener instrucciones inyectadas).

---

## 1. Estado actual de AITeam (punto de partida) [S3]

- `src/orchestrator.js`: `Orchestrator` (EventEmitter). Un *run* tiene `tasks` (DAG normalizado con Kahn en
  `normalizeTasks`, ciclos rotos), estados de run (`planning`, `bidding`, `awaiting_approval`, `running`,
  `reviewing`, `integrating`, `attacking`, `testing`, `done`, `failed`, `interrupted`) y de tarea
  (`pending`, `running`, `done`, `failed`, `skipped`, `cancelled`). Persistencia en `data/runs/<id>.json`.
  Tablero `run.board` de mensajes `{ts, from, to, text}`, **planos y solo de difusión**: los agentes escriben
  `messages` en su JSON final y nadie puede esperar una respuesta.
- `src/git.js`: worktrees por agente en `<padre>/.aiteam-<repo>/<runId>/<agente>`, `withGitLock`,
  `commitAll`, `merge`, `diffSince`.
- `src/runner.js`: `runProcess` / `runShell` (procesos sin TTY, salida por líneas, `killTree`).
- `src/review.js`: revisión por archivo (aceptar/rechazar/aplicar).
- `src/notify.js`: toasts de Windows al cambiar estado de chats/runs si no hay ventana abierta.
- `src/chat.js`: menciones y delegaciones (`parseMentions`, `parseDelegations`).

La única "puerta de decisión" que existe es la aprobación del reparto (`awaiting_approval`).

---

## 2. Inventario de utilidades de Orca

### U1. Mensajería con hilos entre coordinador y workers — prioridad **ALTA**

**Evidencia:** [S1] "threaded messages", "coordinator loops". Detalle interno: no observado (sin REA).

**Comportamiento:** cada mensaje pertenece a un hilo; las respuestas referencian el hilo/mensaje padre, de modo
que una conversación coordinador↔worker sobre una duda concreta no se mezcla con el resto. El coordinador
consulta y espera por hilo. Las órdenes se dan por CLI con salida `--json` para que el agente las procese.

**Formato propuesto para AITeam** *(propuesta)*:
```json
{ "id": "m_7f3a", "threadId": "m_7f3a", "replyTo": null, "ts": "…",
  "from": "codex", "to": "claude", "kind": "note|ask|reply|worker_done|escalation|decision",
  "taskId": "t3", "text": "…", "status": "open|answered|expired" }
```
Un mensaje raíz tiene `threadId === id`; una respuesta hereda el `threadId` y pone `replyTo`.

**Aplicación en AITeam:**
- `src/orchestrator.js`: sustituir `run.board` (array plano) por un bus `run.messages` con hilos; mantener
  `board` como vista derivada para compatibilidad con la UI actual. `post()` pasa a devolver el `id`.
- `src/prompts.js`: `boardText()` agrupa por hilo y muestra solo los hilos que afectan al agente.
- `src/chat.js`: las delegaciones (`parseDelegations`) se modelan como hilos con `kind: ask`.
- Lo implementa **t3 (codex)**.

### U2. Ask/reply bloqueante — prioridad **ALTA**

**Evidencia:** [S1] "blocking ask/reply flows".

**Comportamiento:** un worker puede preguntar algo al coordinador (o a otro worker) y **quedar en espera**
hasta recibir la respuesta o hasta un tiempo límite; el coordinador ve las preguntas pendientes y responde
en el mismo hilo. Es lo que evita que un agente adivine una interfaz que está definiendo otro.

**Flujo** *(propuesta adaptada a AITeam, cuyos agentes son procesos CLI de una sola ejecución)*:
1. El agente termina su turno con `{"ask": {"to": "codex", "text": "¿firma de bus.post?"}}` en el JSON.
2. El orquestador crea el mensaje `kind: ask`, pone la tarea en estado nuevo `waiting_reply` y **no** la
   cuenta como terminada; la sesión del agente (`session` en `invokeAgent`) se conserva.
3. Cuando llega la respuesta (de otro agente en su JSON `replies`, o del usuario desde la UI), se reanuda la
   misma sesión con un prompt "Respuesta a tu pregunta: …".
4. Tiempo límite (p. ej. 10 min) → `status: expired`, se reanuda con "sin respuesta, decide tú y documéntalo".

**Archivos:** `src/orchestrator.js` (estado `waiting_reply`, cola de reanudación), `src/agents.js`
(reanudar con la sesión existente — ya existe el parámetro `session`), `src/prompts.js` (instrucciones del
campo `ask`). Para evitar bloqueos mutuos: un agente no puede preguntar a quien le está preguntando a él
(detección de ciclo en el grafo de esperas). **t3**.

### U3. Despacho de tareas y eventos `worker_done` / `escalation` — prioridad **ALTA**

**Evidencia:** [S1] "task dispatch, worker_done/escalation waits".

**Comportamiento:** el coordinador despacha una tarea a un worker y luego **espera eventos**: `worker_done`
(terminó, con resumen) o `escalation` (no puede seguir: falta información, permiso, conflicto, cuota). Las
esperas son explícitas y admiten tiempo límite, en vez de sondear.

**Aplicación en AITeam:**
- Hoy `runTask` resuelve una promesa con el resultado del proceso. Propuesta: emitir eventos tipados en el bus
  `{kind: 'worker_done', taskId, agent, summary}` y `{kind: 'escalation', taskId, agent, reason, needs}`.
- Las escaladas sustituyen el actual "falla y reintenta con otra IA" en los casos no técnicos: el JSON final
  del agente puede traer `"escalate": {"reason": "…", "needs": "decision|info|permission"}`; la tarea pasa a
  `escalated` y aparece en la UI y en `notify.js`.
- Mapear errores existentes: `QUOTA_ERROR` → escalada `needs: quota` (ya hay `run.exhausted`).
- Archivos: `src/orchestrator.js`, `src/prompts.js` (`taskPrompt`), `src/notify.js`. **t3**.

### U4. DAG de tareas — prioridad **MEDIA** (ya existe en gran parte)

**Evidencia:** [S1] "task DAGs"; la skill menciona referencias aparte para "expanded DAG work".

**Comportamiento:** las tareas tienen dependencias y se lanzan cuando sus predecesoras terminan; el DAG se
puede **ampliar en marcha** (un worker propone subtareas nuevas).

**Situación en AITeam:** `normalizeTasks` ya ordena y rompe ciclos, y el planificador asigna. Falta:
- Ampliación en caliente: aceptar `"newTasks": [...]` en el JSON de un worker, renormalizar y, si cambia el
  reparto, pasar por una puerta de decisión (U5).
- Que una tarea fallida bloquee solo a sus descendientes (hoy se marcan `skipped`; correcto) y que una
  escalada **pause** a los descendientes en vez de saltarlos.
- Archivos: `src/orchestrator.js`. **t3**.

### U5. Puertas de decisión (decision gates) — prioridad **ALTA**

**Evidencia:** [S1] "decision gates"; además la skill describe *gates* condicionales que obligan a cargar una
referencia antes de actuar (colocación remota, recuperación incierta, ampliación del DAG).

**Comportamiento:** puntos del flujo en los que el sistema se detiene y exige una decisión explícita (humana o
del coordinador) entre opciones enumeradas antes de continuar; la decisión queda registrada.

**Aplicación en AITeam** *(propuesta)*: generalizar `awaiting_approval` a un objeto
```json
{ "id": "g_12", "kind": "plan|dag_change|merge_conflict|escalation|destructive",
  "question": "…", "options": [{"id": "a", "label": "…"}], "default": "a",
  "status": "open|decided|expired", "decidedBy": "user|coordinator", "choice": null }
```
- Puertas iniciales: aprobar plan (ya existe), cambio de DAG, conflicto de integración sin resolver,
  operación destructiva (descartar worktree, `discardChanges`), escalada.
- Archivos: `src/orchestrator.js` (`run.gates`, método `decide(runId, gateId, choice)`), API en el servidor,
  `src/notify.js` (toast "Decisión pendiente"). UI en **t7**; lógica en **t3**.

### U6. Bucle del coordinador — prioridad **MEDIA**

**Evidencia:** [S1] "coordinator loops".

**Comportamiento:** el coordinador itera: despachar lo listo → esperar el siguiente evento (done, escalation,
ask) → reaccionar (responder, reasignar, abrir puerta) → repetir, hasta vaciar el DAG.

**Aplicación:** reestructurar el bucle de `running` de `orchestrator.js` en torno a una cola de eventos del
bus en lugar de `Promise.all` por oleadas, para que una pregunta pueda resolverse mientras otras tareas siguen.
**t3**.

### U7. Worktree por agente y traspasos (handoff) — prioridad **MEDIA**

**Evidencia:** [S1] separa `orca-cli` para "full ownership handoffs … another worktree" y "Orca worktree
management". [S2] cada agente trabaja en su worktree, creado y listado desde la app.

**Comportamiento:** crear/listar/eliminar worktrees asociados a un agente o tarea; **traspasar** una tarea a
otro agente con su worktree (cambio de propietario sin supervisión) frente a **orquestar** (seguir supervisando).

**Situación en AITeam:** `git.js` ya crea worktrees por agente y run (`addWorktree`/`removeWorktree`). Falta:
- Traspaso: reasignar una tarea en curso a otra IA **conservando su worktree y cambios**, en lugar de
  reiniciarla (útil con `QUOTA_ERROR`). Archivos: `src/orchestrator.js`, `src/git.js` (un worktree por
  tarea en vez de por agente cuando haya traspaso, o `commitAll` + nueva rama desde la del anterior).
- Listado de worktrees huérfanos de runs interrumpidos con opción de limpiar (puerta `destructive`).
  `src/git.js` (`git worktree list --porcelain`), `src/projects.js`.

### U8. Terminales integradas por worktree y lectura/espera de salida — prioridad **ALTA**

**Evidencia:** [S1] "terminal control, lightweight terminal prompts, shell commands … reading or waiting on
terminals". [S2] Orca abre terminales (PTY) asociadas a cada worktree.

**Comportamiento:**
- Una terminal persistente por worktree, con historial de salida en un búfer.
- **Leer** la salida (últimas N líneas / desde un cursor) y **esperar** hasta que aparezca un patrón, el
  proceso termine o pase un tiempo; esto lo usa tanto el humano como el coordinador ("espera a que pasen los
  tests del worker 2").
- Enviar entrada/prompts ligeros a la terminal.

**Aplicación en AITeam** *(propuesta)*:
- `src/runner.js`: nuevo módulo de sesiones (`node-pty` si se acepta la dependencia; si no, `child_process`
  con `shell: true` y sin TTY) con `{ id, cwd, buffer: anillo de ~2000 líneas, cursor, status }` y
  funciones `open(cwd)`, `write(id, data)`, `read(id, {since})`, `waitFor(id, {pattern, exit, timeoutMs})`,
  `close(id)`; reutilizar `killTree`.
- `src/orchestrator.js`: una terminal por worktree de run; `runShell(run.testCommand)` puede pasar por ella
  para que la salida de tests sea visible en vivo.
- `src/chat.js`: comandos `!comando` (estilo OpenCode) ejecutados en la terminal del worktree del chat.
- Seguridad: solo `cwd` dentro de worktrees conocidos (ver `assertAllowed` en `projects.js`).
- Lo implementa **t6 (codex)**; UI en **t7**.

### U9. Revisión de diffs por worktree — prioridad **MEDIA** (ya existe en gran parte)

**Evidencia:** [S2] Orca muestra los cambios de cada worktree para revisarlos antes de integrarlos.
No verificado con REA.

**Situación en AITeam:** `src/review.js` ya hace revisión por archivo con aceptar/rechazar/aplicar y
`git.js#diffSince` alimenta la revisión cruzada. Mejoras inspiradas:
- Diff **en vivo** por agente mientras trabaja (no solo al final): `git diff` periódico del worktree
  disparado por el evento de fin de turno. `src/review.js`, `src/orchestrator.js`.
- Comentarios en línea del humano que se envían como mensaje del bus al agente autor (U1).

### U10. Notificaciones — prioridad **MEDIA**

**Evidencia:** [S2] Orca avisa cuando un agente termina o necesita atención. [S1] las esperas
`worker_done`/`escalation` son los eventos naturales para notificar.

**Aplicación:** `src/notify.js` ya vigila runs y chats. Añadir avisos para: `ask` dirigido al usuario,
`escalation`, puerta de decisión abierta, terminal que termina con error. Tipar los toasts por `kind` del bus
para que el usuario pueda silenciarlos por tipo (`config.notifications.kinds`). Depende de t3.

### U11. Otras utilidades destacables

| Utilidad | Evidencia | Aplicación en AITeam | Prioridad |
|---|---|---|---|
| CLI con salida `--json` estable para que los agentes controlen la app | [S1] "Prefer `--json`" | Exponer el bus (ask/reply/done) también como CLI o endpoint HTTP local para que un agente lo use **durante** su turno, no solo al final (`server.js` + `orchestrator.js`) | Media |
| Guía de uso servida por el binario y versionada con él | [S1] `skills get orchestration` | Generar las instrucciones de protocolo de `prompts.js` desde un único sitio versionado, en vez de repetirlas en cada prompt | Baja |
| Resolución explícita del ejecutable y errores de acceso diferenciados | [S1] `ORCA_CLI_COMMAND`, `runtime_access_denied` | En `agents.js#checkAgent`, distinguir "CLI no instalada" de "bloqueada por sandbox/permisos" y no reintentar con otra IA en el segundo caso | Baja |
| Navegador integrado controlable | [S1] "the built-in browser" | Fuera de alcance de este objetivo | Baja |

---

## 3. Resumen de prioridades y reparto

| # | Utilidad | Prioridad | Archivos principales | Subtarea |
|---|---|---|---|---|
| U1 | Mensajes con hilos | Alta | orchestrator.js, prompts.js, chat.js | t3 |
| U2 | Ask/reply bloqueante | Alta | orchestrator.js, agents.js, prompts.js | t3 |
| U3 | worker_done / escalation | Alta | orchestrator.js, prompts.js, notify.js | t3 |
| U5 | Puertas de decisión | Alta | orchestrator.js, notify.js (+UI) | t3, t7 |
| U8 | Terminal por worktree + leer/esperar | Alta | runner.js, orchestrator.js, chat.js | t6, t7 |
| U4 | DAG ampliable en marcha | Media | orchestrator.js | t3 |
| U6 | Bucle del coordinador por eventos | Media | orchestrator.js | t3 |
| U7 | Traspaso conservando worktree | Media | orchestrator.js, git.js | t3 |
| U9 | Diff en vivo por agente | Media | review.js, orchestrator.js | t7 |
| U10 | Notificaciones por tipo de evento | Media | notify.js, config.js | t3/t8 |
| U11 | Bus accesible por CLI/HTTP, errores de acceso | Media/Baja | server.js, agents.js | — |

## 4. Limitaciones

- Sin REA, sin la guía completa del binario y sin acceso web, **no se han verificado** formatos internos,
  nombres de canales IPC ni estados reales de Orca. Los formatos de §2 son propuestas compatibles con lo que
  la documentación de Orca [S1] afirma que existe, diseñadas para AITeam.
- Recomendación: repetir los pasos de §0 con REA habilitado y anotar aquí las diferencias antes de que t3/t6
  congelen sus interfaces.
