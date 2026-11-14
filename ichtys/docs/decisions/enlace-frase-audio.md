# De lo escrito a lo dicho: escuchar el tramo de una frase (nota de diseño)

**Estado:** propuesta. Nada de esto está construido. Santiago dijo que sí a tenerlo (14/11/2026 10:08); el cómo es propuesta de Claude.

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

## Lo que tiene que decidir Santiago

1. **Si alcanza con la primera versión** para la demo y la auditoría.
2. **La migración** de la columna nueva.
3. Si la lista de tramos la ve todo el que puede escuchar la grabación, o solo quien verifica (monitor, coordinación).

## Sin verificar

- Que decodificar una toma larga para escuchar un tramo no tarde demasiado en un equipo lento. Una toma de cuatro megas se decodifica entera aunque se quiera oír cinco segundos.
- Que el tiempo de un tramo, medido a 16 kHz, coincida al oído con la grabación original. La cuenta dice que sí; con micrófono no se probó.
- Cuánto ocupa la lista de una toma larga.
