# De lo escrito a lo dicho: escuchar el tramo de una frase (nota de diseño)

**Estado:** la primera versión está construida (14/11/2026) y espera la confirmación de Santiago para integrarse: agrega dos nombres a la lista de acciones del registro, que vive en `packages/db`. La segunda versión sigue siendo propuesta. Santiago dijo que sí a tenerlo (14/11/2026 10:08); el cómo es propuesta de Claude.

Viene del estudio de Heidi y Abridge (documento del proyecto `claude/estudio-grabaciones-heidi-abridge.md`). Lo que distingue a Abridge es poder ir de una frase de la nota a su pasaje en la transcripción y de ahí al audio. A nosotros nos sirve más que a ellos: nuestra transcripción corre en el equipo del médico con un modelo chico, y el riesgo es que oiga mal. La forma más directa de comprobarlo es escuchar ese pedazo.

## Qué hay hoy

- El audio se corta por pausas y cada tramo se transcribe por separado (D15). El comienzo y el fin de cada tramo se conocen en el momento de transcribir.
- **Esos tiempos están medidos sobre la grabación entera**, llevada a 16 kHz (`prepareAudio` corta los tramos sobre todas las muestras). El recorte de silencios de D3 ya no se aplica: D15 lo reemplazó y la aplicación no lo llama. Comprobado en el código el 14/11, después de que Architect planteara lo contrario. Si alguna vez se vuelve a recortar antes de cortar los tramos, los tiempos dejan de valer: por eso va con una prueba (ver abajo).
- Esos tiempos se descartan. Al servidor llega el texto final, ya editado por la persona, y la grabación entera de cada toma.
- La grabación se escucha completa, desde la evolución. Cada escucha queda registrada (D14).

## La objeción más fuerte

**«El texto guardado no es lo que se dictó.»** La persona edita antes de guardar: corrige, borra lo que dijo después de «corrijo», reordena. Unir cada frase de la nota final con su tramo de audio es adivinar, y un enlace que apunta al tramo equivocado es peor que no tener enlace: le da a quien verifica una falsa confirmación.

Por eso la propuesta no une la nota con el audio. Une **lo transcrito** con el audio, que es exacto, y deja la comparación entre la nota y lo transcrito a la vista de la persona.

## Qué se propone

### Primera versión: «Lo dictado, tramo por tramo»

Junto a la grabación de cada toma, una lista plegada con los tramos tal como salieron del transcriptor, en orden, cada uno con su tiempo y un botón para escuchar solo ese tramo.

- Quien verifica lee la evolución, abre la lista, encuentra la frase y la escucha.
- Los tramos son lo que el transcriptor escribió, sin las correcciones de la persona. Se dice en pantalla: «Texto del transcriptor, sin corregir».
- **Cómo se reproduce un tramo:** no se mueve el reproductor. Los archivos que entrega el grabador del navegador salen sin índice y muchas veces sin duración, y saltar a un punto no es confiable. Se decodifica la toma, como ya se hace para transcribir, y se reproduce ese pedazo de las muestras (propuesta de Architect). Funciona igual con cualquier formato que el equipo decodifique.
- Lo marcado como repetición sospechosa del transcriptor (D10) se muestra marcado.

### Segunda versión, solo si la primera se usa

Desde una frase de la evolución, proponer el tramo que más se le parece. Con una regla fija, sin modelo: palabras en común, por encima de un umbral. Si no hay un tramo claro, no se propone ninguno. Va después, con una medición de cuántas veces acierta sobre dictados de prueba.

## Datos

- Por cada toma, junto a su grabación: la lista de tramos, cada uno con comienzo y fin en milisegundos y su texto.
- **El texto de los tramos es dato clínico.** Va cifrado, como la evolución.
- **Vence con la grabación.** Cuando se borra el audio a los 30 días, se borran sus tramos. No queda una segunda copia permanente de lo dictado, con errores del transcriptor y todo.
- Es una columna nueva, opcional, en la tabla de grabaciones. Las grabaciones anteriores quedan sin tramos y la pantalla no muestra la lista. **Cambia una tabla existente: la migración la confirma Santiago.**

## Reglas

- El servidor no confía en lo que llega: cantidad de tramos con tope, texto con tope, tiempos en orden, sin superponerse y dentro de la duración de la grabación. Lo que no cumple se rechaza entero y la evolución se guarda igual, con su grabación y sin tramos.
- Un archivo subido también pasa por el corte en tramos, así que también los tiene.
- Escuchar un tramo es escuchar la grabación: mismo permiso y mismo registro. El registro no lleva el texto del tramo.
- Con varias tomas (D22), cada toma tiene su lista.

## Cómo se prueba

- Las cuentas de tiempo y las validaciones, sin navegador.
- **Un audio con un silencio largo al principio:** el primer tramo tiene que apuntar a su tiempo real en la grabación, no a cero. Es la prueba que sostiene que el botón reproduce lo que dice.
- Que los tramos se borren con la grabación.
- Que otra organización no los pueda leer.
- Con micrófono, por una persona: que el botón de un tramo reproduzca ese pedazo y no otro. Es lo único que una prueba automática no cubre.

## Lo que quedó construido (primera versión)

- **Quién arma los tramos:** el navegador, al transcribir. El transcriptor devuelve lo que escribió para cada tramo y la pantalla le pone el tiempo (`dictatedSegments`, en `packages/clinical/dictation/segments.ts`). Si los textos no corresponden uno a uno con los tramos, no hay lista: no se adivina cuál es cuál.
- **Cuándo viajan:** después de guardar la grabación de esa toma, en un pedido aparte (`PUT …/evolutions/[evolutionId]/audio/segments?take=N`). Solo quien escribió la evolución, y una sola vez por toma. Si no se guardan, la grabación queda igual y la pantalla no ofrece la lista.
- **El servidor no confía:** `validateDictatedSegments` comprueba contra la duración de la grabación **guardada**, no contra lo que diga el pedido. Lo guardado se vuelve a comprobar al leer.
- **Quién los lee:** quien puede escuchar la grabación (`GET` en la misma ruta). Decisión de Claude por el mensaje de Santiago del 14/11 19:30: escuchar un tramo es escuchar la grabación, y una lista que viera menos gente que la grabación no protegería nada. Si Santiago prefiere que la vea solo quien verifica, se cambia en la ruta.
- **Registro:** `evolution.audio.segments.store` y `evolution.audio.segments.read`, con la cantidad de tramos y sin el texto. Reproducir un tramo pide la grabación, que deja su propio `evolution.audio.listen`. La lista plegada no pide nada.
- **Vencimiento y D24:** el borrado por vencimiento ya vaciaba la columna, y el retiro al depósito ya se la lleva (migraciones 0021 y 0022). Los tramos de una grabación vencida o retirada no se entregan.
- **En pantalla:** «Lo dictado, tramo por tramo», plegado, junto a cada grabación que los tiene. Cada tramo con su minuto, su texto, la marca «Posible repetición del transcriptor» (D10) y un botón que reproduce ese pedazo decodificando la toma.

- **Safari y iPad (planteo de Architect):** el audio se habilita al principio del clic, antes de esperar la grabación, y hay una sola salida de audio para toda la pantalla. Safari solo deja sonar lo que se habilita dentro del gesto de la persona y limita cuántas salidas puede haber abiertas. Hecho por lectura del comportamiento documentado del navegador; **sin probar en un iPad**.

## Lo que tiene que decidir Santiago

1. **Si alcanza con la primera versión** para la demo y la auditoría. Construida; la segunda no se empieza sin que lo diga.
2. **La migración** de la columna nueva: aplicada (0022).
3. Si la lista de tramos la ve todo el que puede escuchar la grabación, o solo quien verifica (monitor, coordinación). Quedó lo primero; se puede cambiar.
4. **Confirmar la integración**: el cambio toca `packages/db/schema/enums.ts` (dos nombres de acción, sin migración).

## Sin verificar

- Que decodificar una toma larga para escuchar un tramo no tarde demasiado en un equipo lento. Una toma de cuatro megas se decodifica entera aunque se quiera oír cinco segundos.
- Que el tiempo de un tramo, medido a 16 kHz, coincida al oído con la grabación original. La cuenta dice que sí; con micrófono no se probó.
- Cuánto ocupa la lista de una toma larga.
