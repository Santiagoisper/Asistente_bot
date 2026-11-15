# Requisitos de usuario del OS (borrador sin aprobar)

**Versión:** 0.1 · **Fecha:** 2026-11-15 · **Estado:** **BORRADOR. Nadie aprobó estos requisitos.** Están escritos después de construir, a partir de decisiones ya registradas y de las reglas de la línea de base. Cierre de la tarea 48 del cronograma.

**Qué es.** La lista de lo que el OS tiene que hacer, dicha desde quien lo usa, con su respaldo y con la fila de [`RTM-OS.md`](./RTM-OS.md) que lo prueba. Completa a [`URS.md`](./URS.md), de julio de 2026, que no cubre el OS.

**La objeción de fondo.** Un requisito escrito después del código describe lo que se hizo; no prueba que eso era lo que hacía falta. Para que valgan como requisitos tienen que revisarlos quienes usan el sistema en un centro y aprobarlos alguien con nombre. Hasta entonces este documento es un inventario ordenado.

**Columna «Respaldo».** *Decisión*: quien dirige el producto lo decidió, con fecha, y consta en el documento enlazado. *Regla*: sale de una regla de la [línea de base](./REGULATORY-BASELINE.md) y ninguna decisión propia lo pide. *Propuesta*: lo eligió quien lo construyó y está marcado como modificable. Un requisito sin decisión no es menos necesario, pero nadie lo eligió.

| ID | Requisito | Respaldo | Matriz | Construido |
|---|---|---|---|---|
| OS-01 | Lo que la IA extrae de una evolución queda como propuesta; entra al perfil cuando una persona la acepta | Decisión, 12/11/2026 (línea de base, C2) | R6 | Sí |
| OS-02 | La elegibilidad y el asistente usan solo el protocolo extraído que una persona aprobó | Decisión del 12/11/2026: avisar, y exigir la aprobación cuando exista la pantalla de equipo. La exigencia se adelantó en el código el 14/11 y se integró con confirmación expresa el 15/11/2026 (PR #195; línea de base, C5) | R6 | Sí |
| OS-03 | Con el protocolo en borrador, la guía de dictado igual aparece y avisa que viene de un protocolo sin aprobar | Decisión, 12/11/2026 ([`consulta-dictada.md`](../decisions/consulta-dictada.md), D18) | R6 | Sí; sin fila propia en la matriz |
| OS-04 | Cada clase de dato va a un solo proveedor de IA; si no responde, la función falla | Decisión, 12/11/2026 (línea de base, brecha documental 9) | R6 | Sí |
| OS-05 | El dictado se transcribe en el equipo de quien dicta: el audio no va a ningún proveedor | Decisión, 12/11/2026 (D1) | Sin fila | Sí. **Sin prueba citada en la matriz** |
| OS-06 | La grabación se guarda cifrada, atada a su evolución, y se borra a los 30 días; queda la constancia | Decisión, 12/11 y 14/11/2026 (D14) | R3, R5 | Sí |
| OS-07 | Antes de grabar, la pantalla nombra al sujeto y pide confirmarlo | Decisión, 14/11/2026 (D23) | Sin fila | Sí. Tiene prueba (`apps/web/components/subjects/__tests__/recording-notice.test.tsx`: nombra al sujeto en el texto y en el botón, y «No es este sujeto» no graba), todavía sin fila en la matriz |
| OS-08 | Una grabación hecha en el sujeto equivocado se retira a un depósito sin sujeto, y quien la hizo la ve en su inicio, en «Grabaciones sin sujeto». La decisión dice «se avisa al médico»: lo construido es esa lista, no un aviso enviado; no hay un sistema de avisos entre personas | Decisión, 14/11/2026 ([`grabacion-en-sujeto-equivocado.md`](../decisions/grabacion-en-sujeto-equivocado.md)) | R3, R5 | Sí |
| OS-09 | Quién puede declarar ese error en una evolución ajena: la coordinación del centro o más | Propuesta, por delegación del 14/11/2026 (mismo documento) | R4 | Sí |
| OS-10 | Lo que la evolución anulada dejó en el perfil lo retira una persona; lo retirado se conserva con quién y cuándo | Propuesta (mismo documento) | R6 | Sí |
| OS-11 | No hay firma, ni envío a la historia clínica del centro | Decisión, 12/11/2026 (D9) | R7 | Sí, con una guarda sobre el texto de la aplicación |
| OS-12 | El acceso se decide por organización, función y estudio | Decisión, 11 y 12/11/2026 ([`study-membership.md`](../decisions/study-membership.md), M1 a M17) | R4 | Sí; el modo estricto no está encendido |
| OS-13 | El modo abierto tiene un plazo; pasado el plazo no se vuelve del estricto al abierto, y el cambio lo hace una persona | Decisión (mismo documento) | R4 | Sí |
| OS-14 | Un informe de laboratorio llega al perfil cuando una persona lo confirma, con la fecha de la muestra que ella confirmó o declaró desconocida | Regla R6. La ventana de vigencia de un valor espera una respuesta clínica ([`huella-y-procedencia-de-archivos.md`](../decisions/huella-y-procedencia-de-archivos.md)) | R6, R10 | Sí |
| OS-15 | Cada valor de laboratorio guarda de dónde salió: informe confirmado, texto pegado o evolución | Propuesta de Architect, 13/11/2026 (mismo documento) | R6 | Sí; la ficha todavía no lo muestra |
| OS-16 | Toda escritura clínica deja registro de quién, qué y cuándo, sin el contenido clínico, en la misma transacción | Regla R3 | R3 | Sí, con lo que la matriz declara sin cubrir |
| OS-17 | Los datos clínicos se guardan cifrados campo por campo, incluidas las notas de la agenda y el resultado de elegibilidad | Regla R5 | R5 | Sí; sin prueba que recorra cada campo |
| OS-18 | La agenda muestra los turnos en la hora del centro, y quien no puede ver sujetos no ve a quién corresponde cada turno | Regla R4 y R10. **Sin decisión registrada** | R4, R5, R10 | Sí |
| OS-19 | El asistente responde con citas del documento y dice que no hay evidencia cuando no la hay | Regla R6. Diseño: [`answer-engine-v1.md`](../decisions/answer-engine-v1.md) | R6 | Sí |
| OS-20 | Si el borrado de grabaciones vencidas no corrió, quien administra lo ve en el inicio | Decisión, 15/11/2026 (construir el aviso e integrarlo) | R3 | Sí (PR #200) |
| OS-21 | Firma con clave personal | Diseño en [`firma-con-clave-personal.md`](../decisions/firma-con-clave-personal.md); **seis decisiones pendientes** | — | No |
| OS-22 | Huella de cada archivo recibido, con quién lo subió y por qué camino entró (documentos, informes y recortes) | Propuesta de Architect, 13/11/2026 ([`huella-y-procedencia-de-archivos.md`](../decisions/huella-y-procedencia-de-archivos.md), paso 4). Pide una migración | — | No (línea de base, brecha C4). Los pasos 1 a 3 de esa nota, el origen y la fecha de muestra de cada valor, están en OS-14 y OS-15 |
| OS-23 | El código de un sujeto es el del estudio: no un documento ni iniciales | Decisión, 15/11/2026: formato fijo, a propuesta de quien construye. La regla concreta (ni solo números ni solo letras) es una propuesta modificable | R5 | Sí, para sujetos nuevos |
| OS-24 | El rótulo de visita de una evolución se elige de una lista | Decisión, 15/11/2026: lista cerrada. Qué lista (las visitas del protocolo, o una corta sin cronograma) es una propuesta modificable | R5 | Sí, para evoluciones nuevas |
| OS-25 | El nombre de un turno de la agenda se guarda cifrado | Decisión, 15/11/2026 | — | No: pide una migración |
| OS-26 | Cada respuesta y cada propuesta de la IA guarda con qué proveedor y modelo se generó | Regla R6. Decisión del 15/11/2026: delegada a quien construye, que eligió construirlo | — | No: pide una migración |

## Lo que falta para que esto sea una especificación de requisitos

1. Que lo lean quienes usan el sistema en un centro (investigación, coordinación, regulatorio) y digan qué falta: esta lista sale de lo construido, y lo que nadie pidió construir no aparece.
2. Aprobación con nombre y fecha.
3. Criterio de aceptación por requisito. Hoy el criterio es la fila de la matriz; OS-05 y OS-07 no tienen fila y OS-03 no tiene una propia.
4. Prioridad. No se asignó ninguna.
