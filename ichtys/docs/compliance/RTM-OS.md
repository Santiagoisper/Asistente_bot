# Matriz de trazabilidad del OS: regla → prueba → evidencia

**Versión:** 0.3 · **Fecha:** 2026-11-15 · **Estado:** borrador, sin revisión de Calidad. Tarea 48 del cronograma; faltan los requisitos de usuario y el índice de cumplimiento.

Cubre el OS (agenda, sujetos, laboratorios, dictado, perfil, elegibilidad, accesos), la carga de documentos y el asistente con sus citas, que la matriz de julio ([`RTM.md`](./RTM.md)) no cubre. Responde a la brecha de R2 anotada en la [línea de base](./REGULATORY-BASELINE.md).

**Cómo leerla.** Cada fila toma un comportamiento que una regla de la línea de base exige y dice qué prueba automática lo fija y qué otra evidencia hay. No afirma conformidad con ninguna norma: dice qué está probado, con qué, y qué no.

- **Prueba:** un archivo del repositorio. Una prueba del propio repositorio comprueba que cada archivo citado acá existe.
- **Evidencia fuera de las pruebas:** lo que se vio en el entorno de prueba o en producción, con fecha y con el PR o la nota donde consta. «Ninguna» significa que solo hay pruebas automáticas.
- **Cada fila dice lo que su prueba comprueba, no lo que la regla pide.** Donde la prueba cubre menos que la regla, la diferencia está en «Sin cubrir». La versión 0.1 decía de más en siete filas; lo marcaron las revisiones.
- Lo que una prueba automática no cubre figura en la última columna.

## R3 — Registro de auditoría en la misma transacción

| Comportamiento | Prueba | Evidencia fuera de las pruebas | Sin cubrir |
|---|---|---|---|
| La escritura y su registro corren en una sola transacción; si el registro falla, la transacción se rechaza | `apps/web/lib/audit/__tests__/audited-write.test.ts` | Base de prueba: mismo identificador de transacción en las dos filas, para agenda y perfil (línea de base, sección 5) | La prueba fija el contrato; que la base deshaga de verdad el dato no se prueba contra una base real. Las demás tablas |
| Ninguna ruta escribe y audita por separado | `apps/web/tests/leakage/audited-writes.test.ts` | Ninguna | La guarda no detecta «escribir y no auditar nunca» |
| El borrado de grabaciones vencidas deja un registro por grabación, en la transacción del borrado | `apps/web/app/api/cron/purge-dictation-audio/__tests__/route.test.ts` | Producción, 13 y 14/11: la tarea respondió 200, solo el código de respuesta ([nota](../decisions/borrado-de-grabaciones-verificacion.md)) | Una grabación vencida real que desaparece |
| El borrado elige solo lo vencido, con contenido y no retirado | `apps/web/lib/dictation/__tests__/purge-queries.test.ts` | Ninguna | La prueba mira el SQL que sale, no una base que lo ejecute |
| Anular una evolución registrada en el sujeto equivocado deja registro y no borra | `apps/web/app/api/studies/[id]/subjects/[subjectId]/evolutions/[evolutionId]/void/__tests__/route.test.ts` | Entorno de prueba, 14/11, con datos inventados (PR #180) | Dos personas a la vez |
| Agendar o cambiar un turno escribe un registro que no lleva el título ni las notas | `apps/web/app/api/studies/[id]/agenda/__tests__/routes.test.ts` | Base de prueba: mismo identificador de transacción en las dos filas (línea de base, sección 5) | — |
| El alta de un sujeto registra solo su código; el listado, solo la cantidad. Un código repetido responde 409 y no deja registro | `apps/web/app/api/studies/[id]/subjects/__tests__/route.oq.test.ts` | Ninguna | — |
| Cada pregunta al asistente y cada respuesta, con sus citas, se guardan con su registro en una sola transacción; si el registro falla, no queda nada | `apps/web/lib/chat/__tests__/persistence-audit.test.ts`, `apps/web/app/api/chat/stream/__tests__/route.test.ts` | Ninguna | La base está simulada: la reversión real no se prueba |
| Ver las citas de una respuesta exige dejar registro: si el registro falla, la ruta responde error | `apps/web/app/api/citations/[messageId]/__tests__/route.test.ts` | Ninguna | — |

## R4 — Acceso mínimo, por organización, función y estudio

| Comportamiento | Prueba | Evidencia fuera de las pruebas | Sin cubrir |
|---|---|---|---|
| Toda ruta de la API pasa por una guarda del servidor: sesión, o un secreto propio en las tareas programadas; las rutas públicas son una lista revisada | `apps/web/tests/leakage/api-auth-coverage.test.ts` | Ninguna | La prueba mira que la guarda esté, no que cada guarda rechace |
| Toda consulta del OS filtra por organización | `apps/web/tests/leakage/os-org-filter.test.ts` | Ninguna | Dos organizaciones reales en la misma base |
| Los listados del OS aplican el alcance por estudio | `apps/web/tests/leakage/os-study-scope.test.ts`, `packages/auth/__tests__/study-scope.test.ts` | Ninguna | El modo estricto encendido, función por función (tarea 27) |
| Los validadores exigen membresía cuando rige el modo estricto | `packages/auth/tests/leakage/validators-enforce-membership.test.ts` | Ninguna | Ídem |
| Cambiar el modo de acceso sigue sus reglas y avisa antes de vencer | `apps/web/lib/access/__tests__/mode-rules.test.ts`, `apps/web/components/access/__tests__/mode-panel.test.tsx` | Entorno de prueba, 14/11: aviso de plazo vencido y de que no tiene vuelta (PR #153) | Producción |
| Quién coordina un estudio se decide con una regla propia en los dos modos, y ningún archivo la reemplaza por el atajo que en modo abierto no restringe | `apps/web/lib/access/__tests__/permissions.test.ts`, `apps/web/lib/access/__tests__/coordination-guard.test.ts` | Ninguna | Con dos cuentas reales |
| Dar acceso a un estudio exige poder administrarlo, en los dos modos; un estudio de otra organización responde igual que uno inexistente | `apps/web/app/api/org/team/memberships/__tests__/route.test.ts` | Ninguna | Las bajas |
| Sin permiso sobre el estudio no se agenda nada; un turno de otro estudio u otra organización responde como inexistente | `apps/web/app/api/studies/[id]/agenda/__tests__/routes.test.ts`, `apps/web/lib/agenda/__tests__/agenda-service.test.ts` | Ninguna | Con dos cuentas reales |
| Un turno no se puede atar a un sujeto de otro estudio | `apps/web/lib/agenda/__tests__/agenda-service.test.ts` | Ninguna | — |
| Sujetos: sin sesión responde 401; con un estudio ajeno, 404; la ruta compara el estudio de la dirección antes de registrar | `apps/web/app/api/studies/[id]/subjects/__tests__/route.oq.test.ts`, `apps/web/app/api/studies/[id]/subjects/[subjectId]/__tests__/study-binding.test.ts` | Ninguna | Con dos organizaciones reales |
| Subir un documento: quien no gestiona documentos recibe 403 antes de que se lea el archivo; en modo estricto decide la función, no el rol histórico | `apps/web/app/api/documents/upload/__tests__/route.test.ts` | Ninguna | El modo estricto encendido en un entorno |
| El asistente busca solo en fragmentos de la organización y el estudio de quien pregunta | `packages/rag/tests/leakage/retriever-leakage.test.ts` | Ninguna | La prueba mira el filtro de la consulta y datos simulados, no dos organizaciones en una base |
| La organización sale de la sesión: un pedido al asistente que la trae en el cuerpo o en la dirección se rechaza | `apps/web/app/api/chat/__tests__/route.test.ts`, `apps/web/lib/rag/__tests__/answer-orchestrator.test.ts` | Ninguna | — |
| Las citas de una respuesta solo las ve quien hizo la conversación; para otra persona u otra organización, 404 | `apps/web/app/api/citations/[messageId]/__tests__/route.test.ts` | Ninguna | — |

## R5 — Datos personales: cifrado, minimización, retención

| Comportamiento | Prueba | Evidencia fuera de las pruebas | Sin cubrir |
|---|---|---|---|
| El cifrado de campo cifra y descifra de ida y vuelta | `packages/crypto/__tests__/phi-crypto.test.ts` | Ninguna | Que cada campo clínico pase por ese cifrado al guardarse: no hay una prueba que lo recorra tabla por tabla. Custodia y rotación de la clave |
| Las evaluaciones de elegibilidad se guardan cifradas | `apps/web/lib/subjects/__tests__/screening-crypto.test.ts` | Base de prueba y producción, 14/11: filas en claro 28 → 0 y 5 → 0, medido con una consulta directa (línea de base, C3; PR #164 y #167) | Las copias anteriores al sellado en el historial de la base |
| El sellado de lo anterior toca solo dos columnas y lo corre un operador | `apps/web/lib/subjects/__tests__/screening-seal.test.ts`, `apps/web/app/api/os/screening-seal/__tests__/route.test.ts` | Ídem | Más de una organización contra una base real |
| Antes de enviar una evolución a un modelo se reemplazan documento, correo y un formato de teléfono | `packages/clinical/__tests__/phi-redact.test.ts` | Ninguna | **Los nombres propios no se quitan.** Otros formatos de documento y de teléfono |
| Una grabación pasada de su vencimiento, o ya borrada, no se entrega y figura como vencida | `apps/web/lib/dictation/__tests__/audio-state.test.ts` | Base de prueba, 15/11: primer vencimiento el 13/12 ([nota](../decisions/borrado-de-grabaciones-verificacion.md)) | **Que el plazo sea de 30 días no tiene prueba propia.** Que el borrado ocurra de punta a punta |
| Una grabación retirada del sujeto equivocado pasa a un depósito sin sujeto, con el mismo plazo | `apps/web/app/api/dictation-audios/unassigned/__tests__/route.test.ts`, `apps/web/lib/dictation/__tests__/unassigned-list.test.ts` | Entorno de prueba, 14/11 (PR #181 y #183) | — |
| Las notas de un turno se guardan cifradas; quien no puede ver sujetos no recibe código, sujeto ni notas | `apps/web/lib/agenda/__tests__/agenda-service.test.ts` | Ninguna | — |
| Un sujeto nuevo nace con el perfil cifrado | `apps/web/app/api/studies/[id]/subjects/__tests__/route.oq.test.ts` | Ninguna | La prueba mira que se llame al cifrado, no lo guardado |
| Un documento subido va a un depósito privado, nunca público; sin credencial del depósito la subida falla en vez de escribir en otro lado | `apps/web/app/api/documents/upload/__tests__/blob-storage.test.ts` | Ninguna | La configuración del depósito en producción |
| La respuesta de citas no expone vectores, organización ni el fragmento completo | `apps/web/app/api/citations/[messageId]/__tests__/route.test.ts` | Ninguna | — |
| Los errores de subida, ingesta y asistente no dejan el mensaje crudo del proveedor en el registro técnico ni en la respuesta | `apps/web/app/api/documents/upload/__tests__/route.test.ts`, `apps/web/app/api/ingestion/run/__tests__/route.test.ts`, `apps/web/app/api/chat/stream/__tests__/route.test.ts` | Ninguna | — |

## R6 — IA bajo supervisión humana

| Comportamiento | Prueba | Evidencia fuera de las pruebas | Sin cubrir |
|---|---|---|---|
| Aceptar o descartar una propuesta para el perfil exige acceso, y una propuesta ya resuelta o de una evolución anulada no se aplica | `apps/web/app/api/studies/[id]/subjects/[subjectId]/profile/proposals/__tests__/routes.test.ts` | Entorno de prueba, 12/11 (línea de base, C2) | Que nada llegue al perfil sin pasar por la propuesta lo sostiene la guarda de escritura única (`apps/web/tests/leakage/audited-writes.test.ts`), no esta prueba. Producción |
| La elegibilidad se evalúa solo contra un protocolo extraído que una persona aprobó | `apps/web/app/api/studies/[id]/subjects/[subjectId]/screening/__tests__/route.oq.test.ts`, `apps/web/lib/subjects/__tests__/spec-notice.test.ts` | Entorno de prueba, 15/11: con solo un borrador, la pantalla dice que espera aprobación (PR #195) | El camino con protocolo aprobado, en pantalla |
| El asistente no recibe un protocolo extraído sin aprobar | `apps/web/lib/rag/__tests__/spec-context-approved.test.ts` | Ninguna | Una pregunta real al asistente |
| Un informe de laboratorio llega al perfil recién cuando una persona lo confirma, y no se confirma con una lectura ambigua sin decidir | `apps/web/lib/labs/__tests__/pdf-pipeline.e2e.test.ts` | Entorno de prueba, 14/11, con informes inventados (PR #194) | La base está simulada en esa prueba. Informes reales (piloto, tarea 37) |
| La fecha de la muestra la confirma una persona; nunca es la fecha de carga | `packages/clinical/__tests__/lab-sample-date.test.ts`, `apps/web/lib/labs/__tests__/sample-date-field.test.ts` | Entorno de prueba, 14/11 (PR #194) | Informes reales; lectura por imagen |
| Cada valor de laboratorio guarda de dónde salió | `packages/clinical/__tests__/lab-source.test.ts` | Entorno de prueba, 14/11, texto pegado y evolución (PR #158) | La ficha todavía no muestra el origen |
| Sin elección de nadie, cada pedido va a un solo proveedor: no hay respaldo entre proveedores | `packages/llm/__tests__/chain.test.ts` | Ninguna | Qué proveedor responde en producción, por pedido |
| El asistente no da una respuesta útil sin evidencia: sin fragmentos suficientes, o con citas que no existen, responde que no hay evidencia | `packages/rag/__tests__/answer-engine.test.ts` | Ninguna | La calidad de las respuestas con protocolos reales: esta matriz no cita ninguna evaluación |
| Las citas salen de los fragmentos recibidos: documento, versión y páginas no se inventan | `packages/rag/__tests__/answer-engine.test.ts` | Ninguna | Que la cita sostenga lo que la respuesta afirma |

## R7 — Sin firma aparente

| Comportamiento | Prueba | Evidencia fuera de las pruebas | Sin cubrir |
|---|---|---|---|
| Ninguna pantalla presenta una acción como «firma» | **Ninguna** | Ninguna | Falta la guarda sobre el texto de la interfaz. El diseño de la firma está en [`firma-con-clave-personal.md`](../decisions/firma-con-clave-personal.md) |

## R10 y R11 — Hora del servidor; afirmar solo lo probado

| Comportamiento | Prueba | Evidencia fuera de las pruebas | Sin cubrir |
|---|---|---|---|
| Una fecha de muestra inválida la rechaza el servidor al confirmar | `apps/web/app/api/studies/[id]/subjects/[subjectId]/lab-reports/__tests__/routes.test.ts` | Ninguna | Que la hora usada sea la del servidor en UTC no tiene prueba propia |
| Respaldo con restauración probada | **Ninguna** | Ninguna | Sin evidencia de una restauración (línea de base, sección 5) |
| Un turno se guarda como instante a partir de la hora del sitio, y una fecha u hora inválida se rechaza en vez de inventar un instante | `apps/web/lib/agenda/__tests__/agenda-time.test.ts`, `apps/web/lib/agenda/__tests__/agenda-service.test.ts` | Ninguna | Un centro en otra zona horaria |

## Lo que esta matriz todavía no cubre

- **R1, R2, R8 y R9** son reglas de proceso y de proveedores: se sostienen con documentos y registros, no con pruebas del código. Van en el índice de cumplimiento, que no está escrito.
- De la ingesta de documentos (lectura del PDF, partición, vectores, extracción del protocolo) solo está volcado el acceso y el depósito. La exactitud de lo extraído no tiene fila: se sostiene con la aprobación de una persona (R6, fila del protocolo aprobado).
- El modelo y la versión por respuesta (R6) no tienen fila: falta abrir la prueba que lo fije, si existe.
- Los requisitos de usuario del OS (lo que sería la actualización de [`URS.md`](./URS.md)) no están escritos. Esta matriz parte de las reglas de la línea de base, no de requisitos de usuario aprobados.
- Ninguna fila pasó por Calidad.
