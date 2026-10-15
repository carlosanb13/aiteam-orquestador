# AITeam

Un equipo de IAs en tu PC. AITeam usa tus suscripciones de **Claude Pro**, **ChatGPT Plus** y **Google AI Pro** a través de sus CLIs oficiales (Claude Code, Codex CLI y Gemini CLI) para que trabajen juntas en un mismo proyecto:

1. **Planificar**: una IA coordinadora divide tu objetivo en subtareas, con sus dependencias.
2. **Negociar**: cada IA se pone una nota del 0 al 10 para cada subtarea, comparándose con las demás según sus puntos fuertes. Gana la mejor nota, y se penaliza acumular carga para que trabajen en paralelo.
3. **Aprobar**: ves el reparto con las notas y los motivos, y puedes cambiar responsables antes de empezar (o activar el inicio automático).
4. **Trabajar**: cada IA trabaja en su propia copia aislada del repo (un *worktree* de git en su propia rama). Cuando una subtarea depende del trabajo de otra IA, ese trabajo se trae antes a su copia.
5. **Comunicarse**: un tablero de mensajes compartido. Cada IA puede avisar a las demás (por ejemplo, "he cambiado la firma de esta función") y todas leen el tablero antes de cada subtarea.
6. **Revisar**: revisión cruzada. La IA mejor valorada para revisar (que no sea la autora) revisa cada rama; si encuentra problemas, la autora los corrige.
7. **Integrar y verificar**: se fusionan todas las ramas en `aiteam/<id>/integracion`, una IA resuelve los conflictos y, si das un comando de verificación (`npm test`, por ejemplo), se ejecuta y se intenta corregir si falla.

Tu rama principal nunca se toca: tú decides si fusionas el resultado.

## Requisitos

- Node.js 22 o superior y git.
- Los CLIs que quieras usar, instalados y con la sesión iniciada con tu suscripción:
  - `claude` (Claude Code): `npm i -g @anthropic-ai/claude-code`, y ejecutar `claude` una vez para iniciar sesión.
  - `codex` (Codex CLI): `npm i -g @openai/codex`, y luego `codex login` con tu cuenta de ChatGPT.
  - `gemini` (Gemini CLI): `npm i -g @google/gemini-cli`; ejecuta `gemini` e inicia sesión con la cuenta de Google que tiene AI Pro.

## Uso

```bash
npm start          # http://localhost:4317
npm run mock       # modo simulación: no llama a ninguna IA, para probar la interfaz
```

En la barra superior, **Probar** comprueba que cada IA responde con tu sesión (gasta muy poca cuota).

El proyecto sobre el que trabajen tiene que ser un repositorio git con al menos un commit. Las IAs parten del último commit; los cambios sin commit no los ven.

## Ajustes

- **Autonomía**: por defecto las IAs solo pueden editar archivos en su copia. En modo *control total* también pueden ejecutar comandos sin pedir permiso (Claude con `bypassPermissions`, Codex sin sandbox, Gemini en `yolo`). Úsalo solo si confías en lo que les pides.
- **Perfiles**: el texto de "en qué destaca" cada IA es lo que leen las demás al negociar. Ajústalo según tu experiencia.
- **Modelo**: opcional, por IA (por ejemplo `opus`, `gpt-5-codex`, `gemini-2.5-pro`).

## Dónde queda todo

- Las copias de trabajo se crean junto a tu proyecto, en `../.aiteam-<proyecto>/<id>/`. El botón **Limpiar copias** las borra (las ramas se conservan).
- El historial de ejecuciones y los ajustes se guardan en `data/`.

## Estructura

```
server.js              servidor HTTP + eventos en tiempo real (SSE)
src/agents.js          adaptadores de cada CLI (y modo simulación)
src/orchestrator.js    fases: planificar, negociar, trabajar, revisar, integrar
src/prompts.js         instrucciones que recibe cada IA en cada fase
src/git.js             worktrees, commits y fusiones
public/                interfaz web
```
