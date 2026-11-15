# Borrado de grabaciones a los 30 días: qué está comprobado y qué no

Fecha: 15/11/2026. Tarea 40 del cronograma. Complementa D14, D22 y D24 de [`consulta-dictada.md`](./consulta-dictada.md).

## Cómo funciona

- Cada grabación guarda su vencimiento al crearse: 30 días (`DICTATION_AUDIO_RETENTION_DAYS`).
- Una tarea diaria (`/api/cron/purge-dictation-audio`, 06:17 UTC, declarada en `vercel.json`) borra el contenido y los tramos de las vencidas, en las dos tablas (grabaciones de sujetos y depósito sin sujeto), y deja un registro por cada una. La fila queda como constancia, con la fecha del borrado.
- La ruta exige un secreto (`CRON_SECRET`). Sin el secreto, o con uno distinto, responde 401 y no borra nada.

## Comprobado

- **Qué borra la consulta** (pruebas automáticas, 15/11): solo las vencidas, solo las que tienen contenido, no las retiradas al depósito; borra grabación y tramos y deja la fecha. Antes de este día esas dos consultas no tenían ninguna prueba: cambiarlas para borrar todo, o lo vigente, pasaba la compuerta.
- **La ruta** (pruebas que ya existían): sin secreto no corre; las dos tablas van en una transacción con la misma hora; un registro por grabación; si falla el depósito, se deshace todo.
- **Qué muestra la pantalla** de una grabación vencida o borrada (pruebas que ya existían, `audio-state`).
- **Base de prueba, lectura del 15/11:** 10 grabaciones de sujetos y 2 del depósito; ninguna vencida, ninguna borrada, ningún registro de borrado. El primer vencimiento es el 13/12/2026.

## Producción, mirado el 15/11/2026 (con el sí de Santiago)

Solo cantidades de pedidos a la ruta por código de respuesta, en el proyecto de despliegue; sin contenido.

- 13/11: un pedido con respuesta 200.
- 14/11: uno con 200 y uno con 401.
- La consulta no separó producción de las vistas previas. Un 200 exige el secreto correcto, y la tarea programada corre solo en producción: **se deduce** que la tarea corre una vez por día y pasa el secreto. El 401 es un pedido sin el secreto; no se sabe de quién.

## El aviso de «no corrió» (15/11/2026)

- Cada corrida autorizada deja un registro `retention.run` con cuántas grabaciones borró de cada tabla, en la misma transacción que el borrado y aunque no haya borrado nada. Un pedido sin el secreto, o una corrida que falla, no deja registro.
- Inicio le muestra a quien administra el centro, con prioridad alta, «El borrado diario de grabaciones no está corriendo» cuando el último registro tiene más de 36 horas o no hay ninguno. Dice cuándo fue la última corrida y que *puede* haber grabaciones vencidas sin borrar; no afirma que las haya. Va arriba de todo en la lista de atención prioritaria. No lleva a ninguna pantalla y dice «Avisá a quien administra la plataforma»: la tarea y su secreto son de la plataforma, y desde el centro no se arreglan.
- En un entorno donde la tarea no corre (el de prueba), el aviso queda a la vista siempre. Es cierto: ahí nada se borra solo.
- Después de desplegar esto por primera vez, el aviso aparece hasta la primera corrida (06:17 UTC).

## Sin comprobar

1. **Que la tarea siga corriendo.** El 13 y el 14/11 respondió 200 (ver arriba). Si el secreto se pierde o cambia, responde 401 y nada se borra; desde el 15/11 eso se ve en Inicio al día siguiente.
2. **Que una grabación vencida de verdad desaparezca**, de punta a punta, contra una base real. Las pruebas miran el SQL que sale; no una base que lo ejecute.
3. **El entorno de prueba no corre la tarea.** Las tareas programadas del proveedor corren solo en el despliegue de producción. Las grabaciones de la base de prueba (inventadas) no se van a borrar solas.

## Cómo cerrarlo

- **(1) Producción, sin tocar datos:** en los registros del despliegue de producción, buscar los pedidos a `/api/cron/purge-dictation-audio`. Tiene que haber uno por día con respuesta 200. Un 401 significa que el secreto no está o no coincide. Lo puede mirar quien tenga acceso al panel del proveedor; no muestra contenido clínico.
- **(2) De punta a punta, en el entorno de prueba,** con una grabación inventada: adelantarle el vencimiento en la base de prueba, llamar a la ruta con el secreto de ese entorno y comprobar que el contenido quedó vacío, que la fecha de borrado está y que hay un registro. Requiere a alguien que tenga el secreto; el secreto no se copia a notas ni a conversaciones.
- **(1) tiene plazo:** la ruta de borrado entró al repositorio el 13/11/2026, así que ninguna grabación puede vencer antes del 13/12/2026 (en la base de prueba se leyó esa fecha; la de producción se deduce, no se miró). Después de esa fecha, una tarea que no corre empieza a incumplir lo que el aviso le dice a quien dicta.

## Pendiente de decisión

- Si el entorno de prueba debe tener su propia corrida (hoy sus grabaciones no vencen nunca en la práctica).
- **A quién le llega.** Hoy, a quien administra cada centro, que no lo puede arreglar y tiene que avisar. Como la tarea es una sola, aparece en todos los centros a la vez. Mejor sería mostrarlo a los operadores de la plataforma (una lista como la del sellado); pide cargar una variable nueva en el despliegue.
- El aviso llega solo a quien abre Inicio con función de administrar el centro. Un aviso que salga a buscar a alguien (correo, mensaje) no existe.
- La campana de pendientes no cuenta este aviso.
