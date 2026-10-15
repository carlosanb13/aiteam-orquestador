# Comprobación local de Orca con REA

Fecha: 15 de octubre de 2026. Esta comprobación complementa el inventario anterior de [Orca](orca.md).

## Artefacto y alcance

REA se ejecutó desde `C:\Users\<tu-usuario>\Desktop\AITeam\rea` sobre la instalación local `C:\Users\<tu-usuario>\AppData\Local\Programs\orca\resources\app.asar` (SHA-256 `84d79df52b12a6b3dafd01da5dbc550c67cd28bda3eb26bbba797e6ac12fe3c9`). Primero se inventarió `package.json`; después se analizaron cinco archivos seleccionados:

- `out/cli/handlers/orchestration/message-send-handler.js`
- `out/cli/handlers/orchestration/question-handler.js`
- `out/cli/handlers/orchestration/gate-handlers.js`
- `out/cli/handlers/orchestration/dispatch-handlers.js`
- `out/shared/orchestration-ask-timeout.js`

Comando reproducible:

```powershell
node scripts/rea.mjs analyze-javascript-application 'C:\Users\<tu-usuario>\AppData\Local\Programs\orca\resources\app.asar' --source-path out/cli/handlers/orchestration/message-send-handler.js --source-path out/cli/handlers/orchestration/question-handler.js --source-path out/cli/handlers/orchestration/gate-handlers.js --source-path out/cli/handlers/orchestration/dispatch-handlers.js --source-path out/shared/orchestration-ask-timeout.js --format json
```

REA inventarió 5754 archivos, leyó 19 028 bytes de los cinco elegidos, analizó 2123 nodos de sintaxis y produjo 80 hallazgos. Los otros 5749 archivos quedaron fuera del análisis de código. No se observaron canales IPC porque esta selección no contiene las entradas de Electron; no significa que Orca carezca de ellos.

## Comportamiento observado

- El envío de mensajes admite un identificador de hilo y eventos de ciclo de vida como `worker_done`. Para este último, el cliente espera la confirmación de entrega y reintenta brevemente si la aplicación no está disponible.
- Una pregunta usa `orchestration.ask`. Se crea con `--question` o se reanuda con `--resume`, pero no ambas opciones a la vez. Si vence la espera del cliente y se recibió el identificador, la pregunta permanece pendiente y se vuelve a esperar con ese mismo identificador; no se duplica.
- Las puertas de decisión se crean y resuelven desde la identidad del coordinador; también existe una operación de listado.
- El despacho de trabajo incluye una operación de vista previa (`dispatch-show`) que usa la misma identidad de coordinador que el despacho real.

Estas son observaciones estáticas del cliente CLI empaquetado, no una prueba de una ejecución completa del flujo en Orca. No copiamos código de Orca a AITeam.

## Aplicación en AITeam

AITeam ya tenía bus persistente, preguntas, puertas y despacho por subtareas. En esta revisión se añadió una vista opcional de los mensajes del equipo y controles para responder preguntas o decidir puertas desde el chat y la vista de la tarea. También se corrigió la vista de la tarea para mostrar si el resultado ya está aplicado. Queda una diferencia conocida: en AITeam, cuando vence una pregunta, el agente continúa sin respuesta; Orca conserva una pregunta pendiente que se puede reanudar por identificador.
