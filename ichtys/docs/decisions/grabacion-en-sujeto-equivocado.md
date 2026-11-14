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
  - **Edad y presión arterial: tampoco, y es peor (hallazgo del 14/11, al diseñar la corrección).** Aceptar una propuesta **pisa** la edad y la presión arterial del perfil con las de la evolución (`mergeProfileWithExtraction`), sin guardar origen ni el valor anterior. Si la evolución era de otra persona, la edad del perfil puede ser la de esa persona, y la edad decide criterios de inclusión. El aviso las nombra desde el PR que corrige su texto; el primero (#174) hablaba solo de medicaciones y condiciones.
  - **Medicaciones y condiciones: no.** No guardan origen. De esas solo se puede decir que se aceptó una propuesta de esa evolución, no cuáles quedaron. Hay dos salidas: agregarles origen, que es la misma idea de C4, o que el aviso diga con todas las letras que la lista de medicaciones y condiciones puede estar incompleta. La segunda no necesita cambiar datos y es la que propongo para la primera versión.

### 3. La grabación pasa al depósito

- Cada toma de esa evolución pasa a un depósito de grabaciones sin sujeto asignado, en la misma operación que anula la evolución. O pasa todo, o no pasa nada.
- **El plazo no se reinicia.** Vence el mismo día que iba a vencer: la fecha se copia, no se vuelve a calcular. Pasar al depósito no puede ser una forma de guardar un audio más tiempo.
- En el sujeto A queda la constancia sin contenido: hubo una grabación, de tanto, con tal huella, y se retiró tal día por tal motivo.
- **Quién la escucha (propuesta):** quien la grabó y quien coordina el estudio, y además tiene que seguir teniendo acceso a ese estudio: la grabación sigue siendo de un estudio, y quien ya no está en él no la escucha. Cada escucha queda registrada, como hoy.

### 4. El aviso

- A quien escribió la evolución, si no fue quien declaró el error: «Una evolución tuya en el sujeto X se marcó como registrada en el sujeto equivocado. La grabación está en tus grabaciones sin sujeto hasta el día tal.»
- **A verificar:** hoy no hay un sistema de avisos entre personas dentro de Alphi. Lo mínimo es una lista «Grabaciones sin sujeto» en Inicio para quien tiene alguna. Si alcanza con eso o hace falta un correo, es parte de la decisión.

### 4 bis. Retirar del perfil lo que entró desde la evolución anulada

**Estado: propuesta de Claude (14/11/2026), en construcción por pasos. Santiago puede cambiar cualquiera de estos puntos.**

El punto 2 dice «la persona corrige el perfil». Hasta hoy eso no tiene camino: el perfil solo se escribe aceptando propuestas y confirmando laboratorios; no hay forma de sacar un dato. Sin esto, el aviso de la ficha no se va nunca y la elegibilidad sigue calculándose con datos de otra persona.

- **Quién:** quien hoy puede escribir el perfil de ese sujeto (la misma capacidad que acepta una propuesta, `clinical.author`). Coordinar el estudio alcanza para anular la evolución, no para decidir qué dato clínico sale del perfil.
- **Sobre qué:** una evolución anulada de ese sujeto. La acción no existe para evoluciones vigentes: no es un editor general del perfil.
- **Qué sale:**
  - **Laboratorios cuyo origen es esa evolución: todos, sin elegir.** Son de otra persona por definición.
  - **Edad y presión arterial:** la persona marca si salen. No guardan origen. Si salen, quedan vacías: el valor anterior fue pisado al aceptar la propuesta y no está guardado; lo vuelve a aportar una evolución vigente.
  - **Medicaciones y condiciones:** la persona elige de la lista actual. No guardan origen, así que Alphi no puede decir cuáles vinieron de ahí.
- **Una persona decide y confirma** (R6). Alphi lista y no marca nada por su cuenta, salvo los laboratorios, que tienen origen.
- **Lo retirado no se destruye.** Pasa a `retiredFacts`, dentro del perfil cifrado, con de qué evolución era, quién lo retiró y cuándo. Una corrección no puede tapar lo que había. La elegibilidad no lee ese campo.
- **Registro** en la misma transacción que la escritura (R3): cuántos laboratorios, medicaciones y condiciones salieron y si salieron edad y presión; nunca los valores ni los nombres.
- **El aviso se va** cuando esa evolución tiene una entrada en `retiredFacts` y no quedan laboratorios de ese origen. Una entrada sin nada retirado vale: dice «revisé y no había nada que sacar».
- **Una revisión que no saca nada es una declaración explícita** (observación de Architect, #178): la persona tiene que decir «revisé y no hay nada de esa evolución». Sin esa declaración no se registra ninguna revisión y el aviso sigue. Si declara que no hay nada y sí hay, tampoco se registra. El registro marca las revisiones vacías para poder contarlas.
- **La declaración vale solo mientras su casilla está a la vista** (observación de Architect, #179): si la persona elige algo, o aparece un laboratorio de ese origen, la declaración se borra; cuando la casilla vuelve, vuelve sin marcar.
- **La presión que se ofrece retirar es la guardada en números** (observación de Architect, #179): la etiqueta puede haber quedado vieja, y los números son los que usa la elegibilidad y los que salen. La etiqueta se muestra solo si no hay números. La ficha, fuera de este formulario, sigue mostrando la etiqueta: ese defecto es aparte y sigue abierto.
- **El código del sujeto no lo confirma la persona; lo manda la pantalla.** No es la misma garantía que D23. Protege contra una pestaña vieja o una ruta cruzada, no contra estar mirando al sujeto equivocado. Acá alcanza porque la acción solo existe sobre una evolución ya anulada de ese sujeto, y el botón lo nombra.
- **La elegibilidad** se recalcula sola la próxima vez que se lee: lee el perfil.
- **No hay «deshacer» en pantalla.** Lo retirado queda guardado; devolverlo es volver a cargarlo por el camino normal.

**Por qué en dos pasos.** El esquema del perfil descarta las claves que no conoce. Si el código que escribe `retiredFacts` llegara junto con el que lo lee, cualquier versión anterior que escribiera el perfil lo borraría sin avisar. Primero entra el lector (y un guardián que recorre el esquema), después quien escribe.

**Para Calidad:** si retirar un dato del perfil necesita un motivo escrito además de la referencia a la evolución anulada, y si quien retira puede ser la misma persona que escribió la evolución.

### 5. Lo que esta versión no hace

**No pasa la grabación al sujeto correcto.** Mover un registro clínico de una persona a otra es justo lo que Alphi no hace solo. El camino es: la persona escribe o dicta la evolución en el sujeto correcto, con el audio del depósito a mano para escucharlo. Si después se quiere adjuntar ese audio a la evolución nueva, es otra decisión, con su propio registro.

## Datos

Dos tablas nuevas y una columna opcional en la tabla de grabaciones (migración `0021`). La tabla de evoluciones no cambia. La migración la confirma Santiago.

- **Anulaciones de evoluciones:** una fila por evolución anulada. Evolución, organización, estudio, sujeto, motivo (lista cerrada; hoy solo «sujeto equivocado»), nota corta cifrada, quién y cuándo. La fila de la evolución no se modifica: que está anulada se sabe porque existe esta fila.
- **Grabaciones sin sujeto:** una fila por toma. Organización, estudio, de qué grabación y de qué evolución vino, formato, tamaño, duración, huella, contenido cifrado, quién la grabó, cuándo vence, cuándo se borró, quién declaró el error y cuándo. Sin columna de sujeto.

El contenido cifrado se copia a la tabla nueva y se vacía en la original, en la misma transacción. La fila original queda, con la fecha en que se retiró (la columna nueva): así no se confunde con una grabación vencida, que lleva su fecha de borrado, y el borrado diario no la toma por pendiente. **La fila original no se borra nunca:** la del depósito cuelga de ella, y borrarla se la llevaría.

El borrado diario de grabaciones vencidas tiene que recorrer también el depósito, con la misma regla.

### Una sola forma de leer evoluciones

**Construido (PR #171):** `apps/web/lib/subjects/evolution-reader.ts` es el único lector, sin valor por defecto para las anuladas, con su test guardián. Lo que sigue es el motivo.

Antes leían evoluciones tres lugares: la ruta de evoluciones, el servicio del equipo (para contar autores) y el depósito de grabaciones. Con una tabla de anulaciones, cada lector tiene que saltear las anuladas, y el próximo que se agregue se lo va a olvidar. Por eso: **una única función de lectura de evoluciones vigentes**, y una prueba que falle si alguien consulta la tabla de evoluciones por fuera de ella (propuesta de Architect).

## Registro

En la misma transacción que el cambio: una entrada por la anulación y una por cada grabación retirada. Con quién, cuándo, evolución, sujeto de origen y motivo de la lista. Sin el texto de la nota y sin el código del sujeto.

## Cómo se prueba

- La anulación y el traslado van juntos: si falla el traslado de una toma, la evolución no queda anulada.
- Una evolución anulada no entra en las propuestas, y su propuesta pendiente se retira.
- **La propuesta que llega tarde (observación de Architect, #173):** la propuesta se escribe unos segundos después de guardar la evolución, mientras espera al modelo. Si en ese rato alguien la anula, la anulación no la encuentra y la propuesta aparece después. Por eso **aceptar una propuesta exige que su evolución siga vigente**: si está anulada, la ruta responde 409 `evolution_voided`, el perfil no se toca y la pantalla lo dice. Descartarla sigue pudiéndose.
- Nadie lee evoluciones por fuera de la función de lectura de vigentes.
- El plazo de la grabación no cambia al pasar al depósito: una grabación trasladada el día 29 se borra el día 30, no el 59.
- Quien perdió el acceso al estudio no escucha la grabación del depósito, aunque la haya grabado.
- Quien no escribió la evolución ni coordina el estudio no puede declarar ni escuchar.
- La constancia en el sujeto de origen no trae contenido.
- Otra organización no ve nada de esto.

## Lo que tiene que decidir Santiago

1. **Quién declara y quién escucha.** Propuesta: autor y coordinación del estudio.
   - **Construido así (PR #173):** quien escribió la evolución la puede declarar siempre que conserve acceso al sujeto, **aunque hoy ya no tenga la función de escribir evoluciones**. No es un olvido: la responsabilidad por lo que escribió no se le va con el cambio de función. A quien no la escribió se le exige coordinar el estudio, y esa comprobación va antes de cualquier respuesta que dependa de lo que mandó.
2. **Si el texto de la evolución anulada se puede abrir** desde la historia del sujeto equivocado, o solo lo ve quien la escribió y coordinación. Es una pregunta para Calidad: una corrección no debe tapar el original, pero ese original habla de otra persona.
   - **Pendiente, para que no quede resuelto de hecho (observación de Architect en el #171):** la lectura de la historia ya trae las anuladas con su marca, y hoy devolvería también su texto descifrado a cualquiera que pueda ver la historia de ese sujeto. No expone nada mientras no exista la forma de anular. Santiago respondió «todo sí» el 14/11, leído como «el texto se puede abrir, plegado»; la consulta a Calidad sigue abierta. **El PR que agregue la anulación tiene que aplicar lo que se decida en la ruta**, no en la pantalla: si el texto de una anulada no le corresponde a quien lo pide, no viaja.
   - **Aplicado en la ruta (PR de la ruta de anulación, 14/11), con el criterio más estrecho mientras Calidad no responda:** el texto de una evolución anulada viaja solo a quien la escribió y a quien coordina el estudio. A cualquier otra persona con acceso a la historia le llega la marca, la fecha y `contentWithheld: true`, sin el texto. Es **más estrecho** que la lectura de «todo sí»; ampliarlo es cambiar una condición, y estrecharlo después de haberlo mostrado no se puede deshacer. Lo decide Santiago con la respuesta de Calidad.
3. **El aviso:** lista en Inicio, correo, o las dos.
4. **Si el depósito se llama «Grabaciones sin sujeto»** en pantalla.
5. **Medicaciones y condiciones:** si alcanza con que el aviso diga que su lista puede estar incompleta, o si se les agrega origen ahora.
6. **La migración** `0021`.
7. **Si anular es definitivo.** Así está diseñado. La alternativa es una revocación con su propio registro; si se quiere, hay que decirlo antes de aplicar la migración, porque cambia la tabla.

## Sin verificar

- Qué pasa con una evolución anulada en lo que no lee la tabla pero usa su contenido: lo ya propuesto a la guía de visitas y lo que el asistente haya indexado, si indexa algo de las evoluciones. No lo revisé.
- Si la grabación es documento fuente. Si lo es, anular y retirar tienen reglas que acá no están escritas. Es la misma pregunta abierta de D14.
