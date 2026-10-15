# Comprobación de OpenCode con REA

Fecha: 15 de octubre de 2026. Se obtuvo una copia superficial y dispersa del [repositorio oficial de OpenCode](https://github.com/anomalyco/opencode) en el commit `a448d5b987d01887e1597269b57ae2f259f5725b`. Se analizó código fuente, no una instalación en ejecución.

REA analizó cuatro archivos seleccionados de `packages/core/src/session`: `revert.ts`, `compaction.ts`, `command.ts` y `run-coordinator.ts`. Dentro de la copia dispersa inventarió 136 archivos, leyó 61 134 bytes, procesó 7096 nodos de sintaxis y produjo 132 hallazgos sin fallos de análisis. El resto del repositorio quedó fuera de alcance; los cero canales IPC corresponden solo a esta selección.

## Funciones observadas

- **Reversión de sesión:** `revert.ts` calcula un límite por mensaje, identifica archivos tocados después, usa instantáneas para restaurarlos y publica eventos de preparación, cancelación y confirmación. La operación puede omitir la restauración de archivos.
- **Comandos:** `command.ts` delega al servicio de comandos activado por plugins. La invocación incluye texto, archivos, agentes y skills y una política de entrega al turno de la sesión.
- **Compactación:** `compaction.ts` distingue activación manual, automática y por desborde de contexto. Comprueba capacidad del modelo, puede usar compactación nativa del proveedor o un agente de resumen y conserva mensajes recientes.
- **Coordinación:** se incluyó `run-coordinator.ts` en el análisis estático; no se verificó su flujo completo ni el comportamiento de la interfaz.

## Relación con AITeam

AITeam ya dispone de instantáneas por turno, comandos personalizados y compactación, con controles en «Herramientas» del chat. La reversión de OpenCode opera a nivel de límite de mensaje y archivos afectados; la de AITeam restaura turnos completos de su copia Git. Son enfoques distintos. No se copió código de OpenCode.

Comando reproducible desde el repositorio local de REA:

```powershell
node scripts/rea.mjs analyze-javascript-application 'C:\Users\<tu-usuario>\Desktop\AITeam\.tools\opencode-source' --source-path packages/core/src/session/revert.ts --source-path packages/core/src/session/compaction.ts --source-path packages/core/src/session/command.ts --source-path packages/core/src/session/run-coordinator.ts --format json
```
