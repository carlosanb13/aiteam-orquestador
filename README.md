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
- **Modo seguro / Control total** por conversación: en modo seguro solo editan archivos; con control total pueden ejecutar comandos, instalar dependencias y usar todas sus herramientas sin pedir permiso.

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
public/                interfaz web
```

