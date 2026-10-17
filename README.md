# AITeam

**Tus IAs trabajando como un equipo.** AITeam junta en una sola app las suscripciones que ya pagas (**Claude Pro**, **ChatGPT Plus** y **Google AI Pro**) a través de sus CLIs oficiales (Claude Code, Codex CLI y Antigravity CLI). Hablan entre ellas, se reparten el trabajo según en qué destaca cada una, se revisan y se pasan el relevo cuando a una se le acaba la cuota.

AITeam es el **orquestador**: las capacidades (programar, ejecutar comandos, instalar dependencias, buscar en la web, usar sus servidores MCP…) las aporta cada IA con su propio CLI. AITeam las conecta, les da contexto compartido y coordina el trabajo.

### Añadir otra IA

Pulsa **+ IA** en la sección «Equipo y uso». Puedes registrar un CLI instalado en `PATH` que reciba el mensaje completo por `stdin` y escriba su respuesta en texto por `stdout`. Indica un identificador estable para mencionarlo con `@identificador`; aparecerá en chats, reparto de tareas y revisión cruzada. Inicia sesión con el propio CLI antes de pulsar **Probar**. Esta primera integración admite argumentos fijos sencillos, sin espacios ni caracteres de shell; no requiere claves API en AITeam.

Los conectores personalizados reciben el contexto completo en cada turno y no reanudan sesiones internas. Sus permisos para leer, editar y ejecutar comandos los determina el propio CLI. Las integraciones de Claude, Codex y Antigravity conservan sus sesiones y formatos originales.

### Mejorar AITeam desde AITeam

El botón **Mejorar AITeam** abre o retoma un chat del equipo sobre el repositorio de la propia aplicación. Puedes pedir cambios, dejar que las IAs se revisen y usar **Ver cambios** antes de **Aplicar al proyecto**. El chat se crea desde el último commit, así que guarda en git los cambios locales que quieras incluir antes de abrir uno nuevo. Tras aplicar cambios del servidor, reinicia AITeam desde Ajustes.

## Qué puedes hacer

### 💬 Chat de equipo
Un chat único donde hablas con todas a la vez:

- Menciona a `@claude`, `@codex` (o `@chatgpt`), `@antigravity` (o `@gemini`) o `@equipo`. Sin mención responde la última IA que habló.
- **Se llaman entre sí como compañeras**: si una IA escribe `@codex: revisa la función X`, Codex recibe la petición y contesta en el mismo chat. Tras 4 intercambios seguidos entre ellas, AITeam pausa para que decidas.
- **Contexto compartido**: todas ven la conversación. Además, cada IA reanuda su propia sesión del CLI, así que recuerda lo que hizo en turnos anteriores.
- **Relevo automático**: si una se queda sin cuota, otra atiende la misma petición.
- Trabajan sobre una **copia aislada** del proyecto (una rama git propia de la conversación). Con **Ver cambios** revisas el diff y, si te convence, lo fusionas.
- `/equipo <objetivo>` lanza una tarea de equipo completa a partir de lo hecho en la conversación.
- **Tres niveles de permisos** por conversación y por tarea (ver [Permisos](#permisos)): *Protegido*, *Comandos en el proyecto* y *Control total*.

### ✅ Revisar y aplicar
- **Revisar cambios** muestra cada archivo que tocaron las IAs con su diff (e imágenes). Puedes **Aceptar**, **Rechazar** (deshace ese archivo en la copia) o **Pedir cambios** a una IA concreta sobre ese archivo.
- **Aplicar al proyecto** fusiona el trabajo en la rama actual de tu proyecto. No toca nada si tienes cambios sin guardar; si hay conflictos, deshace la fusión y una IA puede resolverlos (**Traer cambios del proyecto**).

### 🎙️ Dictado por voz
Botón de micrófono (o **Ctrl+M**) en el chat, en el formulario de tareas y al pedir cambios. Dos motores (Ajustes → Dictado por voz):
- **Local, sin internet**: Whisper ejecutado en tu PC con [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx) (el mismo motor que usa Orca). Privado y gratis; detecta las pausas y escribe frase a frase. Modelos tiny (116 MB), base (208 MB, recomendado) o small (640 MB), que se descargan una sola vez. Corrige automáticamente los nombres del equipo (Claude, Codex, Antigravity, AITeam).
- **Navegador**: el reconocimiento de voz de Edge (en la nube de Microsoft).

### 🔔 Notificaciones
Te avisa cuando una IA termina de responder, el equipo propone un reparto o algo falla, con un sonido suave. Con la ventana abierta usa las notificaciones de la ventana; con la ventana cerrada, notificaciones de Windows (el servidor sigue en segundo plano).

### 🎨 Apariencia
Temas **OLED** (negro puro), **Oscuro**, **Medianoche** y **Claro**, con seis colores de acento (Ajustes → Apariencia). Emblemas propios para cada IA (no son los logos oficiales, que son marcas registradas).

### ⚡ Tareas de equipo (en paralelo)
1. **Planificar**: una IA coordinadora divide el objetivo en subtareas con dependencias.
2. **Negociar**: cada IA se pone una nota del 0 al 10 para cada subtarea, comparándose con las demás. Gana la mejor nota, y se penaliza acumular carga para que trabajen en paralelo.
3. **Aprobar**: ves notas y motivos, y puedes cambiar responsables (o empezar sin esperar).
4. **Trabajar en paralelo**, cada una en su worktree de git. El trabajo del que depende una subtarea se trae antes a su copia.
5. **Tablero de mensajes**: se avisan de cambios que afectan a otras.
6. **Revisión cruzada** con ronda de corrección.
7. **Integrar** todas las ramas; una IA resuelve conflictos.
8. **Equipo rojo** (opcional): una IA intenta romper el resultado (vulnerabilidades, casos límite, incoherencias) y otra corrige lo que encuentre.
9. **Verificar** con tu comando de tests e intentar arreglarlo si falla.

Si una IA falla o se queda sin cuota, sus subtareas pasan a la siguiente mejor valorada.

### 📊 Uso de tus suscripciones
En la barra lateral ves cuánto te queda de cada una:

- **Claude**: ventana de 5 h y semanal (de los eventos de límites que emite Claude Code).
- **ChatGPT/Codex**: ventana de 5 h y semanal (de los registros locales de Codex).
- **Gemini**: su CLI no expone la cuota; se muestran las peticiones de hoy.

### 📁 Proyectos y archivos
Barra lateral por proyectos con sus conversaciones y tareas, y un explorador de archivos con visor (del proyecto, de la copia de una conversación o del resultado integrado de una tarea).

Tu rama principal nunca se toca: tú decides qué fusionas.

## Utilidades inspiradas en Orca y OpenCode

- **Resultados en el chat:** las respuestas largas muestran primero un resumen, archivos modificados y acciones para revisar o pedir ajustes. El texto completo y la actividad técnica quedan desplegables.
- **Recuperación:** los turnos de chat pendientes se guardan en disco y se pueden reanudar sin perder la copia. Una tarea de equipo interrumpida puede continuar desde sus subtareas terminadas y las ramas conservadas; «Empezar de nuevo» crea un intento separado.
- **Conexión guiada:** «+ IA» detecta CLIs habituales instalados y permite comprobar un comando antes de registrarlo. Los conectores externos siguen necesitando aceptar el mensaje por stdin y responder por stdout; detectar una instalación no garantiza que sea compatible.
- **Extensiones por proyecto:** Herramientas → Extensiones permite activar servidores MCP HTTPS para Claude y Codex, únicamente en ese proyecto y en los turnos siguientes. Las sesiones y la autenticación pertenecen a cada CLI. Antigravity todavía no recibe estas extensiones desde AITeam.
- **Comandos reutilizables:** Herramientas → Comandos permite crear plantillas en `.aiteam/commands/` dentro de la copia. Se incluyen en la revisión de cambios antes de aplicarse al proyecto.

Los permisos de comandos individuales dentro de un CLI dependen de ese proveedor. AITeam controla el modo protegido o total por conversación y por tarea, pero aún no intercepta cada llamada interna a herramientas para solicitar aprobación una por una.

- **Bus de equipo:** cada tarea conserva hilos de mensajes entre agentes. Las preguntas admiten respuesta y tiempo límite; las puertas de decisión detienen un paso hasta elegir una opción. El tablero muestra la actividad de la tarea.
- **Instantáneas por turno:** en una conversación puedes consultar los turnos y deshacer, rehacer o restaurar el estado de los archivos de un turno. Guarda o termina cambios pendientes antes de restaurar.
- **Terminal de la copia:** ejecuta comandos en la copia de una conversación o en la copia de un agente de una tarea. La salida se transmite en directo, se puede cancelar y queda en un historial acotado.
- **Modos Plan y Build:** `/plan` pide análisis sin editar archivos; `/build` vuelve a permitir cambios. `/plan <mensaje>` o `/build <mensaje>` aplica el modo solo a ese mensaje. El modo es independiente del ajuste de autonomía.
- **Comandos personalizados:** crea `.aiteam/commands/nombre.md` en el proyecto. Puede empezar con frontmatter `description`, `agent` y `mode`; el cuerpo es la plantilla. Usa `$ARGUMENTS` para todos los argumentos o `$1`, `$2` para cada uno. Por ejemplo:

  ```md
  ---
  description: Revisa un archivo
  agent: codex
  mode: plan
  ---
  Revisa $1 con este contexto: $ARGUMENTS
  ```

  Después escribe `/nombre archivo contexto` en el chat. Los comandos del proyecto tienen prioridad sobre los globales.
- **Reglas y contexto:** `AGENTS.md` (o `CLAUDE.md`) aporta instrucciones del proyecto a los agentes. Cuando el historial supera el umbral configurado, AITeam resume los mensajes antiguos y conserva los recientes; `/compact` lo solicita manualmente.

Las preguntas al usuario esperan hasta cinco minutos y, al vencer, el agente continúa con su propio criterio. Las escaladas esperan hasta cinco minutos y continúan por defecto; ambos tiempos se ajustan con `bus.askTimeoutMs` y `bus.gateTimeoutMs` en la configuración. Las preguntas y decisiones se responden mediante la API del bus.

Las funciones se seleccionaron a partir de la documentación disponible de Orca y OpenCode. Ahora hay comprobaciones acotadas con REA de [Orca](docs/rea/orca-real-analysis.md) y [OpenCode](docs/rea/opencode.md). El [inventario anterior](docs/rea/orca.md) conserva las hipótesis y límites de la primera revisión de Orca.



## Requisitos

- Node.js 22 o superior y git.
- Los CLIs que quieras usar, instalados y con la sesión iniciada con tu suscripción:
  - **Claude Code**: `npm i -g @anthropic-ai/claude-code`, y ejecutar `claude` una vez para iniciar sesión.
  - **Codex CLI**: `npm i -g @openai/codex`, y luego `codex login` con tu cuenta de ChatGPT.
  - **Antigravity CLI** (`agy`, sustituto de Gemini CLI para cuentas personales): en PowerShell `irm https://antigravity.google/cli/install.ps1 | iex`; ejecuta `agy` una vez e inicia sesión con la cuenta de Google que tiene AI Pro.

## Acceso directo (Windows)

```powershell
powershell -ExecutionPolicy Bypass -File launchercrear-accesos.ps1
```

Crea **AITeam** en el escritorio y en el menú Inicio. Al abrirlo arranca el servidor en segundo plano (sin ventanas de consola) si no está en marcha, y abre la app en su propia ventana. Para tenerlo en la barra de tareas: clic derecho sobre el acceso → *Mostrar más opciones* → *Anclar a la barra de tareas* (o, con la app abierta, clic derecho en su icono de la barra → *Anclar*). Para apagarlo: **Ajustes → Apagar**. El registro del servidor queda en `data/servidor.log`.

El script asigna a los accesos el mismo identificador de aplicación que la ventana de AITeam (`MSEdge.localhost_/`), para que el icono anclado no se duplique al abrirlo. Si ya lo tenías anclado, vuelve a ejecutarlo.

`launcher/crear-icono.ps1` regenera el icono.

## Uso

```bash
npm start          # http://localhost:4317
npm run mock       # modo simulación: no llama a ninguna IA, para probar la interfaz
```

1. **+ Añadir** un proyecto (carpeta de un repositorio git con al menos un commit).
2. Abre una conversación (💬+) o una tarea de equipo (⚡+) desde el proyecto.
3. **Probar** en el panel de equipo comprueba que cada IA responde con tu sesión.

> Puedes usar AITeam para mejorar AITeam: añade esta misma carpeta como proyecto. Las IAs trabajan en una copia aparte, así que la app sigue funcionando; cuando te guste el resultado, fusiona la rama y reinicia.

## Primera prueba real

1. En **Equipo y uso**, pulsa **Probar** para comprobar que la IA elegida responde con tu sesión iniciada.
2. Añade un repositorio git como proyecto y crea un chat nuevo desde ese proyecto.
3. Pide un cambio pequeño y concreto, por ejemplo: «Añade una línea al README que explique para qué sirve este proyecto».
4. Abre **Revisar cambios** y examina el diff del archivo. Si hace falta, usa **Pedir cambios** antes de aceptarlo.
5. Cuando el resultado te convenza, pulsa **Aplicar al proyecto** y comprueba el cambio en tu repositorio.
6. Si el cambio afecta al servidor de AITeam, reinícialo desde **Ajustes** para probar la versión aplicada.

## Permisos

| Nivel | Qué pueden hacer las IAs | Cómo se aplica |
|---|---|---|
| **Protegido** | Editar archivos en su copia | Claude: `acceptEdits`. Antigravity: `--mode accept-edits`. Codex: sandbox `workspace-write` (puede ejecutar comandos dentro de él). |
| **Comandos en el proyecto** | Ejecutar tests, builds y servidores, sin instalar nada | Claude: `--allowedTools Bash PowerShell` y `--disallowedTools` con las órdenes de instalación (npm/pip/winget…). Antigravity: `--sandbox` (sin red, las instalaciones fallan). Codex y otros CLIs: AITeam vigila cada comando y **detiene a la IA** si intenta instalar. La terminal de AITeam aplica la misma regla. |
| **Control total** | Cualquier cosa | Claude: `bypassPermissions`. Codex: sin sandbox. Antigravity: `--dangerously-skip-permissions`. |

Límites conocidos, comprobados en Windows: ningún nivel salvo *Protegido* en Claude y Antigravity impide que **un comando** escriba fuera de la carpeta del proyecto; y el sandbox de Codex en Windows (modo *unelevated*) no bloquea la red ni la escritura fuera de la carpeta. La interfaz lo explica junto a cada nivel.

## Ajustes

- **Autonomía por defecto** (cada conversación puede cambiarla).
- **Perfiles**: el texto de "en qué destaca" cada IA es lo que leen las demás al negociar y al decidir a quién pedir ayuda.
- **Modelo** opcional por IA.

## Notas de plataforma

- En Windows, Codex se ejecuta con el sandbox no elevado (`windows.sandbox=unelevated`), porque el elevado no puede escribir en las copias de trabajo. No se cambia tu configuración global.
- Las copias de trabajo se crean junto a tu proyecto, en `../.aiteam-<proyecto>/`.
- Historial, ajustes y datos de uso se guardan en `data/` (no se versiona).

## Estructura

```
server.js              servidor HTTP + eventos en tiempo real (SSE)
src/agents.js          adaptadores de cada CLI, sesiones y modo simulación
src/chat.js            chat de equipo: menciones, delegación entre IAs, relevo
src/orchestrator.js    tareas de equipo: planificar, negociar, paralelo, revisar, equipo rojo, integrar
src/prompts.js         instrucciones que recibe cada IA en cada fase
src/usage.js           uso de sesión y semanal de cada suscripción
src/projects.js        proyectos y explorador de archivos
src/git.js             worktrees, commits y fusiones
src/bus.js             hilos, preguntas y puertas de decisión
src/routes-bus.js      API del bus
src/snapshots.js       instantáneas por turno y restauración
src/routes-snapshots.js API de instantáneas
src/commands.js        modos y comandos personalizados
src/routes-commands.js API de comandos
src/compaction.js      resumen del historial
src/terminal.js        ejecución e historial de terminal
src/routes-terminal.js API de terminal
test/                  pruebas automáticas con node:test
public/                interfaz web
```

