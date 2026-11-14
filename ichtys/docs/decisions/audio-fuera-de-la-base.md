# El audio fuera de la base de datos (nota de diseño)

**Estado:** propuesta. Nada de esto está construido. Viene del plan de robustez (documento del proyecto `claude/robustez-120-plan.md`): con un centro de más de cien personas, lo primero que se llena es la base.

## Qué hay hoy

- Cada grabación se guarda dentro de la base, en la tabla de grabaciones, cifrada con la clave de los datos clínicos (D14).
- Se guarda como texto, y pasa **dos veces** a base64: una antes de cifrar (`apps/web/lib/dictation/audio-store.ts`) y otra al salir del cifrado (`packages/crypto/phi-crypto.ts`). Son 4/3 × 4/3: **unas 1,78 veces el audio** (cuenta de Architect, comprobada en el código; no es una medición sobre la base). Una toma de 4 MB ocupa unos 7,1 MB.
- **Con el tope de 1 GB, la base entera se llena con unas 140 tomas llenas.** Un centro chico que dicte todos los días llega en semanas.
- Una grabación entra entera en el cuerpo de un pedido. La plataforma no acepta cuerpos de más de 4,5 MB, y de ahí sale el tope de 4 MB por toma.
- Los documentos del estudio ya viven en un almacenamiento de archivos (`@vercel/blob`); el audio no.
- La base de producción está en un plan con tope de 1 GB para todo.

## Son dos problemas distintos

Conviene no mezclarlos, porque se arreglan por separado y uno es mucho más urgente.

1. **Dónde vive el audio.** En la base, compite por lugar con las evoluciones, los perfiles y el registro de auditoría. Si la base se llena, deja de andar todo, no solo el dictado.
2. **Cuánto puede pesar una toma.** El tope de 4 MB viene de cómo viaja, no de dónde se guarda. Mover el audio de lugar no lo cambia.

## La objeción más fuerte

**«El audio es lo más sensible que guarda el sistema, y la propuesta es sacarlo del lugar más protegido y ponerlo en un servicio de archivos.»**

Respuesta: lo que sale es el audio **ya cifrado** con nuestra clave, igual que hoy. El servicio de archivos guarda bytes que no puede leer. Quien consiga la dirección de un archivo consigue texto cifrado. La clave, el permiso, el registro de cada escucha y el vencimiento siguen en la aplicación y en la base. Lo que cambia de lugar es el bulto, no la protección.

Lo que sí se pierde: hoy una grabación y su fila se guardan o no se guardan juntas, en una transacción. Con dos lugares puede quedar un archivo sin fila o una fila sin archivo. Hay que diseñarlo (más abajo).

## Qué se propone

### Paso 1: mover el bulto, sin cambiar nada más

- El servidor cifra y sube el resultado al almacenamiento de archivos. **Se suben bytes cifrados, no texto:** hace falta una variante del cifrado que reciba y devuelva bytes, con la misma clave y la misma marca de versión. Así el archivo pesa lo que pesa el audio. Si se reusara la función de hoy, se subiría el mismo texto de 1,78 veces a otro lugar.
- El cifrado de cada archivo se ata al identificador de su grabación: un archivo cambiado por el de otra fila falla al abrirse.
- El nombre del archivo lleva el identificador de la grabación y nada más. Ni código de sujeto ni nombre de estudio. En la fila queda la referencia al archivo, y todo lo que ya tiene: huella, tamaño, duración, quién, vencimiento.
- **El orden importa:** primero se sube el archivo, después se escribe la fila. Si falla lo segundo, queda un archivo suelto, cifrado, que una limpieza borra. Al revés quedaría una fila que promete una grabación que no existe.
- **Borrado por vencimiento:** se borra el archivo y se marca la fila, como hoy se vacía la columna. Si el borrado del archivo falla, la fila no se marca y se reintenta al día siguiente.
- **Los borrados en cascada no borran archivos.** Si se borra un centro, un estudio o un sujeto, la base se lleva las filas y los archivos quedan. Por eso la limpieza no es solo para subidas fallidas: recorre los archivos y borra los que no tienen fila.
- **Lo viejo sigue andando:** las grabaciones que ya están en la base se leen de la base hasta que venzan. A los 30 días no queda ninguna. No hace falta migrar datos.
- El tope de 4 MB por toma no cambia en este paso.
- El depósito de grabaciones sin sujeto (D24) va por el mismo camino.

### Paso 2: una cuota por centro

Con el tamaño de cada grabación ya guardado en su fila, sumar lo que ocupa un centro es una consulta. Un tope por centro, que se pueda cambiar, y un aviso antes de llegar. **La cuenta incluye el depósito de grabaciones sin sujeto:** una grabación retirada sigue ocupando lugar, y si no contara, el depósito sería la forma de no llegar al tope. Hoy no hay ninguno: el límite de pedidos frena el ritmo, no el total.

### Paso 3, solo si hace falta: tomas más largas

Con el corte automático antes del tope (D25) y varias tomas por evolución (D22), una consulta larga ya se puede dictar entera: en varias tomas. Lo que falta para que no se note es que la toma siguiente empiece sola (propuesta de Architect). Eso es más barato y menos riesgoso que cambiar cómo viaja el audio.

Si aun así hiciera falta una toma de más de 4 MB, el camino es subirla en partes, cada una cifrada por el servidor. No propongo que el navegador suba directo al almacenamiento: el audio llegaría ahí sin cifrar con nuestra clave.

## Datos

Una columna nueva, opcional, en la tabla de grabaciones y en la del depósito: la referencia al archivo. La columna del contenido queda, para lo viejo. **Cambia tablas existentes: la migración la confirma Santiago.**

## Cómo se prueba

- Guardar, escuchar y vencer una grabación nueva, con el almacenamiento simulado.
- Una grabación vieja, que sigue en la base, se escucha igual.
- Si falla la subida, no queda fila. Si falla la fila, el archivo suelto lo encuentra la limpieza.
- Si falla el borrado del archivo, la fila no dice que se borró.
- Lo que se sube está cifrado: la prueba mira los bytes que salen.
- En el entorno de prueba, con el almacenamiento real: una grabación de punta a punta.

## Lo que tiene que decidir Santiago

1. **Si se hace ahora o después de la auditoría del 27/11.** Con 140 tomas para llenar la base, no esperaría a un centro grande: el paso 1 va antes de que cualquier centro dicte todos los días. No hace falta para la demo.
2. **Qué almacenamiento.** El que ya usan los documentos es lo más simple. Tiene su costo, que no busqué.
3. **El tope por centro** del paso 2: cuánto y qué pasa al llegar.
4. **La migración.**

## Sin verificar

- Las 1,78 veces salen de leer el código, no de medir la base.
- Si al vencer las grabaciones viejas la base libera el lugar enseguida, o recién cuando pasa la ventana del historial para volver atrás. Es el mismo dato que quedó pendiente en C3.
- Si el almacenamiento que usan los documentos permite archivos privados o solo direcciones difíciles de adivinar. Con el contenido cifrado no es grave, pero hay que saberlo.
- En qué región guarda ese almacenamiento. Si un cliente exige que los datos queden en el país, pesa. Es una pregunta contractual, no técnica.
- El costo.
