# Grabación guardada en el sujeto equivocado (nota de diseño de D24)

**Estado:** propuesta. Nada de esto está construido. La decisión de fondo es de Santiago (14/11/2026 10:45): «se pasa a una base de audios no identificados, y se avisa al médico que se ha grabado en un sujeto equivocado». Lo demás es propuesta de Claude y está marcado como tal.

La primera barrera ya existe: antes de grabar se confirma el sujeto y el servidor lo comprueba (D23). Esta nota es para cuando igual pasó.

## El problema completo

Cuando alguien dicta en el sujeto equivocado no queda mal un audio: quedan mal tres cosas.

1. **La grabación**, atada a ese sujeto.
2. **La evolución escrita**, que dice cosas de otra persona en la historia de este sujeto.
3. **Lo que Alphi propuso a partir de esa evolución** para el perfil y la elegibilidad. Si alguien ya lo aceptó, el perfil de este sujeto tiene datos de otro.

La decisión de Santiago habla de la primera. Las otras dos son consecuencia y no se pueden dejar afuera: mover el audio y dejar en el perfil de este sujeto los datos de otro sería peor que no hacer nada.

## La objeción más fuerte

**«Sacar la grabación del sujeto rompe lo único que permite verificar ese texto.»** La evolución anulada queda a la vista en el sujeto A, pero su grabación ya no está ahí. Un monitor que quiera saber qué se dijo no la encuentra.

Respuesta: la grabación no se pierde ni se desata. El depósito guarda de qué evolución salió, y la evolución anulada dice dónde quedó su grabación. Quien tiene permiso la sigue pudiendo escuchar, desde el depósito, con su registro. Lo que cambia es que deja de aparecer como parte de la historia de A.

Segunda objeción, de nombre: **«audios no identificados» no es cierto.** Una voz y lo que se dice identifican a una persona. El depósito es de audios *sin sujeto asignado*, y se trata como dato clínico identificable: mismo cifrado, mismo plazo, mismo registro de escuchas. La pantalla no debería decir «no identificado».

## Qué se propone

### 1. Declarar el error

Una acción sobre la evolución: «Se registró en el sujeto equivocado». Pide un motivo corto y una confirmación que nombra al sujeto, como D23.

- **Quién puede (propuesta):** quien escribió la evolución, o quien coordina el estudio. Nadie más.
- **No tiene vuelta atrás.** La base admite una sola anulación por evolución y no hay forma de revocarla sin borrar esa fila, que sería tapar un registro. Si se declaró por error, se corrige con una evolución nueva que lo diga. Architect pidió que esto se decida a sabiendas antes de aplicar la migración: es el punto 7 de lo que tiene que decidir Santiago.

### 2. La evolución se anula, no se borra

- El texto original no se toca ni se oculta para siempre: una corrección no puede tapar lo que estaba escrito.
- Queda a la vista en la historia de A, plegada, con la marca «Registrada por error en este sujeto», quién lo declaró y cuándo. Abrirla muestra el texto original.
- **Deja de leerse como vigente:** no entra en lo que Alphi lee para proponer datos del perfil, y su propuesta pendiente, si la hay, se retira.
- **Anular la evolución no cambia la elegibilidad por sí solo.** La elegibilidad no lee evoluciones: lee el perfil (corrección de Architect, comprobada en el código). Lo único que la cambia es sacar del perfil lo que entró desde esa evolución.
- **Si su propuesta ya se había aceptado**, Alphi no deshace nada solo. Muestra en el sujeto un aviso que no se va hasta que alguien lo resuelva: «El perfil incluye datos aceptados desde una evolución anulada». La persona corrige el perfil, y recién entonces la elegibilidad se vuelve a calcular.
  - **Laboratorios: se pueden listar uno por uno.** Cada valor guarda de qué evolución vino (`packages/clinical/lab-source.ts`).
  - **Medicaciones y condiciones: no.** No guardan origen. De esas solo se puede decir que se aceptó una propuesta de esa evolución, no cuáles quedaron. Hay dos salidas: agregarles origen, que es la misma idea de C4, o que el aviso diga con todas las letras que la lista de medicaciones y condiciones puede estar incompleta. La segunda no necesita cambiar datos y es la que propongo para la primera versión.

### 3. La grabación pasa al depósito

- Cada toma de esa evolución pasa a un depósito de grabaciones sin sujeto asignado, en la misma operación que anula la evolución. O pasa todo, o no pasa nada.
- **El plazo no se reinicia.** Vence el mismo día que iba a vencer: la fecha se copia, no se vuelve a calcular. Pasar al depósito no puede ser una forma de guardar un audio más tiempo.
- En el sujeto A queda la constancia sin contenido: hubo una grabación, de tanto, con tal huella, y se retiró tal día por tal motivo.
- **Quién la escucha (propuesta):** quien la grabó y quien coordina el estudio, y además tiene que seguir teniendo acceso a ese estudio: la grabación sigue siendo de un estudio, y quien ya no está en él no la escucha. Cada escucha queda registrada, como hoy.

### 4. El aviso

- A quien escribió la evolución, si no fue quien declaró el error: «Una evolución tuya en el sujeto X se marcó como registrada en el sujeto equivocado. La grabación está en tus grabaciones sin sujeto hasta el día tal.»
- **A verificar:** hoy no hay un sistema de avisos entre personas dentro de Alphi. Lo mínimo es una lista «Grabaciones sin sujeto» en Inicio para quien tiene alguna. Si alcanza con eso o hace falta un correo, es parte de la decisión.

### 5. Lo que esta versión no hace

**No pasa la grabación al sujeto correcto.** Mover un registro clínico de una persona a otra es justo lo que Alphi no hace solo. El camino es: la persona escribe o dicta la evolución en el sujeto correcto, con el audio del depósito a mano para escucharlo. Si después se quiere adjuntar ese audio a la evolución nueva, es otra decisión, con su propio registro.

## Datos

Dos tablas nuevas y una columna opcional en la tabla de grabaciones (migración `0021`). La tabla de evoluciones no cambia. La migración la confirma Santiago.

- **Anulaciones de evoluciones:** una fila por evolución anulada. Evolución, organización, estudio, sujeto, motivo (lista cerrada; hoy solo «sujeto equivocado»), nota corta cifrada, quién y cuándo. La fila de la evolución no se modifica: que está anulada se sabe porque existe esta fila.
- **Grabaciones sin sujeto:** una fila por toma. Organización, estudio, de qué grabación y de qué evolución vino, formato, tamaño, duración, huella, contenido cifrado, quién la grabó, cuándo vence, cuándo se borró, quién declaró el error y cuándo. Sin columna de sujeto.

El contenido cifrado se copia a la tabla nueva y se vacía en la original, en la misma transacción. La fila original queda, con la fecha en que se retiró (la columna nueva): así no se confunde con una grabación vencida, que lleva su fecha de borrado, y el borrado diario no la toma por pendiente. **La fila original no se borra nunca:** la del depósito cuelga de ella, y borrarla se la llevaría.

El borrado diario de grabaciones vencidas tiene que recorrer también el depósito, con la misma regla.

### Una sola forma de leer evoluciones

Hoy leen evoluciones tres lugares: la ruta de evoluciones, el servicio del equipo (para contar autores) y el depósito de grabaciones. Con una tabla de anulaciones, cada lector tiene que saltear las anuladas, y el próximo que se agregue se lo va a olvidar. Por eso: **una única función de lectura de evoluciones vigentes**, y una prueba que falle si alguien consulta la tabla de evoluciones por fuera de ella (propuesta de Architect).

## Registro

En la misma transacción que el cambio: una entrada por la anulación y una por cada grabación retirada. Con quién, cuándo, evolución, sujeto de origen y motivo de la lista. Sin el texto de la nota y sin el código del sujeto.

## Cómo se prueba

- La anulación y el traslado van juntos: si falla el traslado de una toma, la evolución no queda anulada.
- Una evolución anulada no entra en las propuestas, y su propuesta pendiente se retira.
- Nadie lee evoluciones por fuera de la función de lectura de vigentes.
- El plazo de la grabación no cambia al pasar al depósito: una grabación trasladada el día 29 se borra el día 30, no el 59.
- Quien perdió el acceso al estudio no escucha la grabación del depósito, aunque la haya grabado.
- Quien no escribió la evolución ni coordina el estudio no puede declarar ni escuchar.
- La constancia en el sujeto de origen no trae contenido.
- Otra organización no ve nada de esto.

## Lo que tiene que decidir Santiago

1. **Quién declara y quién escucha.** Propuesta: autor y coordinación del estudio.
2. **Si el texto de la evolución anulada se puede abrir** desde la historia del sujeto equivocado, o solo lo ve quien la escribió y coordinación. Es una pregunta para Calidad: una corrección no debe tapar el original, pero ese original habla de otra persona.
3. **El aviso:** lista en Inicio, correo, o las dos.
4. **Si el depósito se llama «Grabaciones sin sujeto»** en pantalla.
5. **Medicaciones y condiciones:** si alcanza con que el aviso diga que su lista puede estar incompleta, o si se les agrega origen ahora.
6. **La migración** `0021`.
7. **Si anular es definitivo.** Así está diseñado. La alternativa es una revocación con su propio registro; si se quiere, hay que decirlo antes de aplicar la migración, porque cambia la tabla.

## Sin verificar

- Qué pasa con una evolución anulada en lo que no lee la tabla pero usa su contenido: lo ya propuesto a la guía de visitas y lo que el asistente haya indexado, si indexa algo de las evoluciones. No lo revisé.
- Si la grabación es documento fuente. Si lo es, anular y retirar tienen reglas que acá no están escritas. Es la misma pregunta abierta de D14.
