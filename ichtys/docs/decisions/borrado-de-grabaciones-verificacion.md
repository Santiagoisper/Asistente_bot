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

## Sin comprobar

1. **Que la tarea corra en producción y pase el secreto.** Es el riesgo principal: si el secreto falta o no coincide, la tarea responde 401 todos los días, nadie se entera y nada se borra. No se miró producción.
2. **Que una grabación vencida de verdad desaparezca**, de punta a punta, contra una base real. Las pruebas miran el SQL que sale; no una base que lo ejecute.
3. **El entorno de prueba no corre la tarea.** Las tareas programadas del proveedor corren solo en el despliegue de producción. Las grabaciones de la base de prueba (inventadas) no se van a borrar solas.

## Cómo cerrarlo

- **(1) Producción, sin tocar datos:** en los registros del despliegue de producción, buscar los pedidos a `/api/cron/purge-dictation-audio`. Tiene que haber uno por día con respuesta 200. Un 401 significa que el secreto no está o no coincide. Lo puede mirar quien tenga acceso al panel del proveedor; no muestra contenido clínico.
- **(2) De punta a punta, en el entorno de prueba,** con una grabación inventada: adelantarle el vencimiento en la base de prueba, llamar a la ruta con el secreto de ese entorno y comprobar que el contenido quedó vacío, que la fecha de borrado está y que hay un registro. Requiere a alguien que tenga el secreto; el secreto no se copia a notas ni a conversaciones.
- **(1) tiene plazo:** hasta el 11/12/2026 no vence ninguna grabación en ninguna base (la función se integró el 12/11). Después de esa fecha, una tarea que no corre empieza a incumplir lo que el aviso le dice a quien dicta.

## Pendiente de decisión

- Si el entorno de prueba debe tener su propia corrida (hoy sus grabaciones no vencen nunca en la práctica).
- Un aviso cuando la tarea no corrió o respondió error: hoy una falla es silenciosa.
