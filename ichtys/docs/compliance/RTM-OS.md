# Matriz de trazabilidad del OS: regla → prueba → evidencia

**Versión:** 0.1 · **Fecha:** 2026-11-15 · **Estado:** borrador, sin revisión de Calidad. Primera parte de la tarea 48 del cronograma.

Cubre lo construido desde noviembre de 2026 (laboratorios, dictado, perfil, elegibilidad, accesos y uso de IA), que la matriz de julio ([`RTM.md`](./RTM.md)) no cubre. Responde a la brecha de R2 anotada en la [línea de base](./REGULATORY-BASELINE.md).

**Cómo leerla.** Cada fila toma un comportamiento que una regla de la línea de base exige y dice qué prueba automática lo fija y qué otra evidencia hay. No afirma conformidad con ninguna norma: dice qué está probado, con qué, y qué no.

- **Prueba:** un archivo del repositorio. Una prueba del propio repositorio comprueba que cada archivo citado acá existe.
- **Evidencia fuera de las pruebas:** lo que se vio en el entorno de prueba o en producción, con fecha. «Ninguna» significa que solo hay pruebas automáticas.
- Lo que una prueba automática no cubre figura en la última columna.

## R3 — Registro de auditoría en la misma transacción

| Comportamiento | Prueba | Evidencia fuera de las pruebas | Sin cubrir |
|---|---|---|---|
| Toda escritura clínica guarda el dato y su registro juntos; si el registro falla, el dato no queda | `apps/web/lib/audit/__tests__/audited-write.test.ts` | Base de prueba, 12/11: mismo identificador de transacción en las dos filas (agenda y perfil) | Las demás tablas contra una base real |
| Ninguna ruta escribe y audita por separado | `apps/web/tests/leakage/audited-writes.test.ts` | Ninguna | La guarda no detecta «escribir y no auditar nunca» |
| El borrado de grabaciones vencidas deja un registro por grabación, en la transacción del borrado | `apps/web/app/api/cron/purge-dictation-audio/__tests__/route.test.ts` | Producción, 13 y 14/11: la tarea respondió 200 (solo el código de respuesta) | Una grabación vencida real que desaparece |
| El borrado elige solo lo vencido, con contenido y no retirado | `apps/web/lib/dictation/__tests__/purge-queries.test.ts` | Ninguna | La prueba mira el SQL que sale, no una base que lo ejecute |
| Anular una evolución registrada en el sujeto equivocado deja registro y no borra | `apps/web/app/api/studies/[id]/subjects/[subjectId]/evolutions/[evolutionId]/void/__tests__/route.test.ts` | Entorno de prueba, 14/11, con datos inventados | Dos personas a la vez |

## R4 — Acceso mínimo, por organización, función y estudio

| Comportamiento | Prueba | Evidencia fuera de las pruebas | Sin cubrir |
|---|---|---|---|
| Toda ruta de la API exige sesión | `apps/web/tests/leakage/api-auth-coverage.test.ts` | Ninguna | — |
| Toda consulta del OS filtra por organización | `apps/web/tests/leakage/os-org-filter.test.ts` | Ninguna | Dos organizaciones reales en la misma base |
| Los listados del OS aplican el alcance por estudio | `apps/web/tests/leakage/os-study-scope.test.ts`, `packages/auth/__tests__/study-scope.test.ts` | Ninguna | El modo estricto encendido, función por función (tarea 27) |
| Los validadores exigen membresía cuando rige el modo estricto | `packages/auth/tests/leakage/validators-enforce-membership.test.ts` | Ninguna | Ídem |
| Cambiar el modo de acceso sigue sus reglas y avisa antes de vencer | `apps/web/lib/access/__tests__/mode-rules.test.ts`, `apps/web/components/access/__tests__/mode-panel.test.tsx` | Entorno de prueba, 14/11: aviso de plazo vencido y de que no tiene vuelta | Producción |
| Coordinar un estudio se comprueba igual en los dos modos | `apps/web/lib/access/__tests__/coordination-guard.test.ts` | Ninguna | Con dos cuentas reales |
| Altas y bajas de membresía | `apps/web/app/api/org/team/memberships/__tests__/route.test.ts` | Ninguna | — |

## R5 — Datos personales: cifrado, minimización, retención

| Comportamiento | Prueba | Evidencia fuera de las pruebas | Sin cubrir |
|---|---|---|---|
| Los campos clínicos se guardan cifrados | `apps/web/lib/subjects/__tests__/phi-fields.test.ts` | Ninguna | Custodia y rotación de la clave |
| Las evaluaciones de elegibilidad se guardan cifradas | `apps/web/lib/subjects/__tests__/screening-crypto.test.ts` | Base de prueba y producción, 14/11: filas en claro 28 → 0 y 5 → 0, medido con una consulta directa | Las copias anteriores al sellado en el historial de la base |
| El sellado de lo anterior toca solo dos columnas y lo corre un operador | `apps/web/lib/subjects/__tests__/screening-seal.test.ts`, `apps/web/app/api/os/screening-seal/__tests__/route.test.ts` | Ídem | Más de una organización contra una base real |
| Antes de enviar una evolución a un modelo se reemplazan documento, correo y un formato de teléfono | `packages/clinical/__tests__/phi-redact.test.ts` | Ninguna | **Los nombres propios no se quitan.** Otros formatos de documento y de teléfono |
| Una grabación vence a los 30 días y la pantalla lo muestra | `apps/web/lib/dictation/__tests__/audio-state.test.ts` | Base de prueba, 15/11: primer vencimiento el 13/12 | Que el borrado ocurra de punta a punta |
| Una grabación retirada del sujeto equivocado pasa a un depósito sin sujeto, con el mismo plazo | `apps/web/app/api/dictation-audios/unassigned/__tests__/route.test.ts`, `apps/web/lib/dictation/__tests__/unassigned-list.test.ts` | Entorno de prueba, 14/11 | — |

## R6 — IA bajo supervisión humana

| Comportamiento | Prueba | Evidencia fuera de las pruebas | Sin cubrir |
|---|---|---|---|
| Lo que la IA extrae de una evolución queda como propuesta hasta que una persona la acepta | `apps/web/app/api/studies/[id]/subjects/[subjectId]/profile/proposals/__tests__/routes.test.ts` | Entorno de prueba, 12/11 | Producción |
| La elegibilidad se evalúa solo contra un protocolo extraído que una persona aprobó | `apps/web/app/api/studies/[id]/subjects/[subjectId]/screening/__tests__/route.oq.test.ts`, `apps/web/lib/subjects/__tests__/spec-notice.test.ts` | Entorno de prueba, 15/11: con solo un borrador, la pantalla dice que espera aprobación | El camino con protocolo aprobado, en pantalla |
| El asistente no recibe un protocolo extraído sin aprobar | `apps/web/lib/rag/__tests__/spec-context-approved.test.ts` | Ninguna | Una pregunta real al asistente |
| Un informe de laboratorio no entra al perfil sin que una persona lo confirme | `apps/web/app/api/studies/[id]/subjects/[subjectId]/lab-reports/__tests__/routes.test.ts` | Entorno de prueba, 14/11, con informes inventados | Informes reales (piloto, tarea 37) |
| La fecha de la muestra la confirma una persona; nunca es la fecha de carga | `packages/clinical/__tests__/lab-sample-date.test.ts`, `apps/web/lib/labs/__tests__/sample-date-field.test.ts` | Entorno de prueba, 14/11 | Informes reales; lectura por imagen |
| Cada valor de laboratorio guarda de dónde salió | `packages/clinical/__tests__/lab-source.test.ts` | Entorno de prueba, 14/11 (texto pegado y evolución) | La ficha todavía no muestra el origen |
| Cada clase de dato va a un solo proveedor; si no responde, la función falla y el dato no sale a otro | `packages/llm/__tests__/chain.test.ts`, `apps/web/lib/settings/__tests__/provider-guard.test.ts` | Ninguna | Qué proveedor responde en producción, por pedido |

## R7 — Sin firma aparente

| Comportamiento | Prueba | Evidencia fuera de las pruebas | Sin cubrir |
|---|---|---|---|
| Ninguna pantalla presenta una acción como «firma» | **Ninguna** | Ninguna | Falta la guarda sobre el texto de la interfaz. El diseño de la firma está en [`firma-con-clave-personal.md`](../decisions/firma-con-clave-personal.md) |

## R10 y R11 — Hora del servidor; afirmar solo lo probado

| Comportamiento | Prueba | Evidencia fuera de las pruebas | Sin cubrir |
|---|---|---|---|
| La fecha de muestra futura la rechaza el servidor, con su propia hora | `apps/web/app/api/studies/[id]/subjects/[subjectId]/lab-reports/__tests__/routes.test.ts` | Ninguna | — |
| Respaldo con restauración probada | **Ninguna** | Ninguna | Sin evidencia de una restauración (línea de base, sección 5) |

## Lo que esta matriz todavía no cubre

- **R1, R2, R8 y R9** son reglas de proceso y de proveedores: se sostienen con documentos y registros, no con pruebas del código. Van en el índice de cumplimiento, que no está escrito.
- Agenda, alta de sujetos, carga de documentos, el asistente y sus citas: tienen pruebas, pero no están volcadas acá.
- Los requisitos de usuario del OS (lo que sería la actualización de [`URS.md`](./URS.md)) no están escritos. Esta matriz parte de las reglas de la línea de base, no de requisitos de usuario aprobados.
- Ninguna fila pasó por Calidad.
