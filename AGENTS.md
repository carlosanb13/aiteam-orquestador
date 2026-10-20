# AGENTS.md — Memoria de Arquitectura de AITeam

Bienvenido a **AITeam**. Este documento describe la arquitectura, principios de diseño, protocolos de colaboración multi-agente y reglas de seguridad para todas las IAs que colaboren en el desarrollo y la auto-mejora de este proyecto.

---

## 1. Visión y Propósito

AITeam es un entorno de desarrollo colaborativo local donde múltiples herramientas de IA (Claude Code, OpenAI Codex, Antigravity, OpenCode, Gemini CLI, Cursor, GitHub Copilot CLI, etc.) trabajan **en simultáneo como un equipo coordinado**.

El objetivo principal **no es solo abrir una terminal**: es proporcionar un entorno estructurado donde las IAs puedan:
- **Comunicarse y coordinarse entre sí**.
- **Delegarse tareas y subtareas en paralelo**.
- **Hacer revisión cruzada de código (Cross-Review)** antes de entregar.
- **Ejecutar pruebas adversariales (Equipo Rojo)** donde una IA busca vulnerabilidades y fallos y otra los resuelve.
- **Aprovechar al máximo las suscripciones oficiales del usuario** ejecutando directamente sus CLIs instalados, sin intermediarios ni cargos por token de terceros.

---

## 2. Arquitectura del Sistema

El proyecto está diseñado con una arquitectura ligera, rápida y 100% local en Node.js (ES Modules), sin pasos pesados de compilación (`build/bundle`), de forma que los cambios se reflejan inmediatamente:

```
aiteam/
├── server.js              # Servidor HTTP/SSE local (127.0.0.1:4317) y rutas de API REST
├── AGENTS.md              # Este archivo: memoria técnica compartida para las IAs
├── src/
│   ├── agents.js          # Catálogo de 45 agentes de IA, invocación segura de CLIs y perfiles
│   ├── chat.js            # Gestor de conversaciones multi-agente, historial y turnos
│   ├── config.js          # Carga y persistencia de configuración de usuario en data/config.json
│   ├── discovery.js       # Detección automática de CLIs instalados en el sistema (PATH / directorios comunes)
│   ├── git.js             # Envoltura de Git: creación y gestión de git worktrees aislados
│   ├── notify.js          # Notificaciones nativas de escritorio (Windows PowerShell / Web Notifications)
│   ├── orchestrator.js    # Motor de tareas paralelas: planificación, subasta, ejecución e integración
│   ├── permissions.js     # Niveles de autonomía y seguridad (edits, project, full)
│   ├── projects.js        # Gestión de carpetas de proyectos y árbol de archivos
│   ├── prompts.js         # Inyección de contexto, reglas del proyecto (AGENTS.md) y protocolos
│   ├── review.js          # Revisión de cambios, pre-apply syntax check (node --check) y fusión
│   ├── routes-bus.js      # Rutas del bus de comunicación entre agentes
│   ├── routes-commands.js # Modos, comandos personalizados y reglas dinámicas
│   ├── routes-snapshots.js# Snapshots y reversión turno a turno
│   ├── routes-terminal.js # Terminal aislada y extensiones MCP (Model Context Protocol)
│   ├── speech.js          # Transcripción local de voz (Whisper con sherpa-onnx)
│   └── usage.js           # Monitor de límites de uso y cuotas de IA
└── public/                # Frontend web en Vanilla JS + CSS3 nativo
    ├── index.html         # Marcado semántico, diálogos nativos <dialog>
    ├── app.js             # Lógica cliente, SSE, compositor, revisión y Live Error Doctor
    ├── style.css          # Sistema de diseño sobrio, monocromático, temas claro y oscuro
    └── icons.js           # Iconos de línea y emblemas genéricos de las IAs (círculo de color con su inicial)
```

---

## 3. Principios Fundamentales para las IAs

Cuando trabajes modificando AITeam o el proyecto del usuario, cumple rigurosamente las siguientes directrices:

### A. Aislamiento Estricto (Worktrees)
- **Nunca edites directamente sobre la rama principal del usuario**.
- Todas las modificaciones se realizan dentro del `worktree` asignado a tu sesión.
- El usuario revisa los cambios mediante la interfaz de **Revisar y aplicar cambios** antes de incorporarlos.

### B. Verificación de Sintaxis Obligatoria (Pre-Apply Self-Check)
- Antes de dar por terminado un turno o aplicar cambios, verifica la sintaxis de los archivos JavaScript modificados con `node --check <archivo>`.
- `src/review.js` bloquea la aplicación de código si detecta errores de sintaxis (`syntaxErrors`).

### C. Seguridad y Puntos de Restauración (Rollback)
- Cuando AITeam se auto-mejora (los cambios se aplican al propio repositorio de AITeam), el servidor registra automáticamente el commit anterior en `data/last-rollback.json`.
- En caso de regresión o fallo, el usuario dispone de un botón de **Rollback en 1 clic** en **Ajustes > Sistema** que restaura el commit previo de forma instantánea mediante `git reset --hard`.

### D. Interceptación de Errores en Vivo (Live Error Doctor)
- `public/app.js` cuenta con un centinela de errores en tiempo de ejecución (`window.onerror` y `unhandledrejection`).
- Cuando se produce una excepción no controlada, la interfaz muestra un aviso con el botón **Corregir con el equipo**, que traslada el mensaje de error y el stacktrace al equipo de IAs para su diagnóstico y resolución.

### E. Estética Visual: Monocromía y Claridad
- Toda la interfaz mantiene una estética limpia, monocromática y profesional (blanco, gris y negro puro `currentColor`).
- Cada IA se representa con un icono genérico propio (un círculo de color con su inicial). No añadas logotipos de marcas de terceros: son marcas registradas de sus dueños.
- Solo se utilizan colores en badges funcionales de estado semántico (`ok`, `err`, `warn`) y en el círculo que identifica a cada IA.

---

## 4. Colaboración Multi-Agente: Protocolo de Equipo

1. **Reparto de Tareas**: La IA coordinadora asigna subtareas a cada agente según sus fortalezas (por ejemplo: análisis de arquitectura, frontend, lógica de backend, tests unitarios).
2. **Revisión Cruzada**: Un agente no debe aprobar su propio trabajo sin que otro agente del equipo valide la solución.
3. **Equipo Rojo (Adversarial)**: Si el modo adversarial está activo, un agente asume el rol de auditor buscando fallos de borde, concurrencia o regresiones, y el agente autor aplica las correcciones.
4. **Mensajería Interna**: Utiliza el bus de mensajería para solicitar información o consultar dependencias entre agentes antes de entregar.
