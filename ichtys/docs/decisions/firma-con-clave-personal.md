# Confirmación con clave personal como firma electrónica: nota de diseño

Fecha: 15/11/2026. Tarea 46 del cronograma. **Estado: propuesta, sin construir, sin revisión de Calidad ni de Legales.** Nada de esto afirma conformidad con ninguna norma.

Marcas: **[H]** hecho leído en la fuente citada · **[I]** interpretación de quien escribe · **[O]** opinión o propuesta · **[P]** pendiente de verificar.

## Para qué es

La tarea 47 prevé entregar a la historia clínica del centro lo que una persona revisó en Alphi, por tandas, con «firma al final de cada tanda revisada». Esta nota dice qué tendría que tener esa confirmación para poder llamarse firma electrónica, y qué decidir antes de construirla.

La regla vigente es R7 de la línea de base: ninguna pantalla presenta una acción como «firma» mientras no exista firma electrónica con identidad verificada, significado y vínculo inalterable con el registro.

## Las dos objeciones que hay que resolver primero

**1. La firma que vale puede no ser la de Alphi.** [I] El registro clínico lo firma el profesional en la historia clínica del centro, que es el sistema de origen. Lo que Alphi necesita es dejar constancia de quién revisó y autorizó cada entrega. Si es solo eso, el nombre honesto es «confirmación de envío con reautenticación», no «firma»: llamarla firma sin los controles de abajo incumple R7 y le promete al centro algo que no puede sostener. [H] La guía de la FDA de 2024 dice que la agencia no piensa evaluar contra Part 11 los sistemas de historia clínica electrónica del centro, y sí el dato una vez que entra al sistema de captura del patrocinador (Q1). [I] Alphi no es ninguno de los dos: es un sistema intermedio que transmite, y lo que transmite está en alcance (línea de base, sección 3).

**2. Firmar por tanda es lo que la guía europea desaconseja.** [H] La guía de la EMA pide que la confirmación del investigador sea oportuna, definida por riesgo, y desaconseja firmar libros de datos en bloque; una sola firma al final, en general, no alcanza (6.3). [I] Eso está escrito para la conformidad del investigador con los datos del estudio, no para un envío a la historia clínica, pero el riesgo es el mismo: una firma sobre veinte registros no prueba que la persona miró los veinte. [H] Part 11 ofrece la salida: en un período continuo de acceso controlado, la primera firma usa todos los componentes y las siguientes pueden usar uno solo, que solo esa persona pueda ejecutar (§11.200(a)(1)(i)). [O] Propuesta: **se firma cada registro, no la tanda.** La «tanda» pasa a ser la sesión: la primera firma pide identificación y clave, las siguientes solo la clave, y cada registro queda con su propia firma.

## Qué piden las fuentes

### 21 CFR Part 11 (leído en la edición del 1/4/2024 del CFR, por secciones)

| Punto | Qué pide [H] | Qué implica para Alphi [I] |
|---|---|---|
| §11.50 | El registro firmado muestra el nombre del firmante, fecha y hora, y el significado de la firma (revisión, aprobación, responsabilidad, autoría); esos datos se controlan igual que el registro y aparecen en toda forma legible | La firma se ve junto al registro en pantalla, en la exportación y en lo que se entrega. Un significado por tipo de firma, escrito |
| §11.70 | La firma queda ligada a su registro de modo que no pueda recortarse, copiarse ni pasarse a otro por medios ordinarios | Huella del contenido exacto que se firmó, guardada con la firma. Si el contenido cambia, la firma deja de valer y se ve |
| §11.100(a) | Única por persona; no se reutiliza ni se reasigna | Una cuenta, una persona. Una cuenta dada de baja no vuelve a otra persona |
| §11.100(b) | Antes de asignar la firma, la organización verifica la identidad de la persona | Es un paso del centro, con constancia. El sistema no lo resuelve solo |
| §11.100(c) | Quien usa firmas electrónicas certifica ante la FDA que equivalen a la manuscrita | Obligación de la entidad regulada cuando el registro es de los que exige la FDA. [P] A quién le toca en cada estudio (patrocinador, centro) |
| §11.200(a)(1) | Al menos dos componentes distintos (por ejemplo, identificación y clave). Serie en sesión continua: la primera con todos, las siguientes con al menos uno. Fuera de una sesión continua: todos cada vez | Define qué pedir en cada firma y qué es «la misma sesión» |
| §11.200(a)(2) y (3) | Solo la usa su dueño; usarla otro exige la colaboración de dos o más personas | Nadie del equipo técnico puede firmar por otro ni restablecer la clave de firma sin dejar rastro y sin que el dueño intervenga |
| §11.300 | Combinación única, revisión periódica, baja de lo comprometido, salvaguardas contra el uso no autorizado con aviso inmediato | Bloqueo por intentos fallidos, registro y aviso de cada intento fallido de firma |
| §11.10(e), (g), (j) | Registro de auditoría seguro y con hora; control de quién puede firmar; política escrita que hace responsable a cada persona de lo firmado | La capacidad de firmar es una función asignada. La política es un documento del centro |

### Guía de la FDA, «Electronic Systems, Electronic Records, and Electronic Signatures in Clinical Investigations: Q&A» (octubre de 2024, revisión 1)

- [H] Part 11 no impone un método: valen tarjetas, biometría, firma digital y combinaciones de usuario y clave (Q24).
- [H] Tampoco fija cómo verificar la identidad; menciona documento oficial, preguntas de seguridad, credenciales con varios factores u observación por video (Q26).
- [H] La FDA no certifica sistemas ni métodos de firma (Q28). [I] Por eso, y por regla propia, Alphi no dice «certificado».
- [H] La carta que certifica la equivalencia se presenta antes o al momento del primer uso; una carta puede cubrir a toda la organización (Q29).
- [H] En una sesión continua, la primera firma usa todos los componentes y las repetidas pueden usar uno (Q23).

### Guía de la EMA sobre sistemas informatizados y datos electrónicos en ensayos clínicos (EMA/INS/GCP/112288/2023; adoptada el 7/3/2023, en vigor seis meses después de publicarse)

- [H] Una firma electrónica tiene que dar autenticación con alto grado de certeza, no repudio y un vínculo que no se pueda romper: si el contenido cambia, la firma queda inválida a la vista. Se registra fecha, hora y zona horaria (4.8).
- [H] Si se firma una parte o un documento aparte, hace falta el mismo vínculo entre lo firmado y donde está la firma (4.8).
- [H] En un sistema cerrado (el dueño conoce a todos los usuarios y controla el acceso) no aplica el reglamento europeo de identificación electrónica; la función de firma se prueba en la validación del sistema (4.8).
- [H] La hora se toma sola, en UTC o contra una referencia externa, y el usuario no la puede cambiar (5.5).
- [H] Usuario y clave es el mínimo aceptable; en general se espera autenticación de dos factores; la cuenta se bloquea tras un número de intentos fallidos (A4.12, A4.13). Las cuentas son individuales; compartirlas es inaceptable (A3.5, A4.16). Cierre de sesión por inactividad, con nueva autenticación (A4.17).
- [H] Sobre repetir usuario y clave en el momento de firmar: la guía no lo trata en lo que se leyó.

### Ley argentina 25.506

- [H] Distingue firma digital de firma electrónica. Si una firma electrónica es desconocida, quien la invoca tiene que probar que es válida (art. 5).
- [I] Una confirmación con clave dentro de Alphi sería firma electrónica, no digital: si alguien la desconoce, la prueba la carga el centro. Por eso el rastro (quién, cuándo, qué contenido exacto, desde qué sesión) vale tanto como la clave.
- [P] No se leyó la ley de historia clínica (26.529) ni lo que diga sobre la firma de registros clínicos electrónicos.

## Diseño propuesto [O]

1. **Qué se firma.** Un registro por vez: la versión exacta que se va a entregar. La firma guarda la huella SHA-256 de ese contenido en forma canónica, el identificador y la versión del registro. La huella se calcula sobre el **texto en claro**, no sobre lo cifrado: el cifrado cambia en cada guardado aunque el contenido sea el mismo. «Forma canónica» es una regla fija y escrita antes de construir: para lo estructurado, una serialización canónica (por ejemplo la del RFC 8785); para el texto, saltos de línea unificados y Unicode normalizado (NFC).
2. **Qué significa.** Un texto fijo por tipo, a la vista antes de firmar y guardado con la firma. Para la entrega: «Revisé este registro y autorizo su envío a la historia clínica». No dice «apruebo el contenido clínico» si eso lo firma el profesional en la historia clínica.
3. **Con qué se firma.** Dos caminos; hay que elegir uno (decisión 3):
   - **A. Reautenticación en el proveedor de identidad** en el momento de firmar (clave y, si está activo, segundo factor). No agrega secretos a Alphi. [P] Hay que comprobar que el proveedor permite pedirla para cada forma de ingreso (quien entra con una cuenta de terceros no tiene clave propia), en el plan contratado y en la instancia de producción, que hoy es una de desarrollo (tarea 23).
   - **B. Clave de firma propia de Alphi**, distinta de la de ingreso: se guarda solo su derivación con sal, vence, se bloquea por intentos, y restablecerla exige a la persona y a quien administra. Pide una tabla nueva: la migración la confirma Santiago.
4. **Sesión de firma.** La primera firma pide los dos componentes; las siguientes, dentro de un plazo corto y sin cerrar la sesión, uno. Al vencer el plazo o cerrar, se vuelve a pedir todo.
5. **La firma no se mueve ni sobrevive a un cambio.** Al leer un registro firmado se recalcula la huella. Si no coincide, la pantalla muestra «firma inválida: el contenido cambió después de firmar» y el registro no se entrega.
6. **Dónde se ve.** Nombre, fecha, hora (UTC y local) y significado, junto al registro, en la exportación y en el mensaje a la historia clínica.
7. **Quién puede firmar.** Una capacidad propia, asignada por estudio; no viene con la de escribir. **Cuidado con el modo abierto:** hoy, fuera del modo estricto, pedir una capacidad en el validador no restringe a nadie (pasó con la anulación de evoluciones). La firma necesita su propia comprobación, que valga en los dos modos, o existir solo en modo estricto. Con el validador de siempre, en modo abierto firmaría cualquiera con acceso clínico.
8. **Rastro.** Cada firma y cada intento fallido, en la misma transacción que la entrega, sin contenido clínico.
9. **Lo que no hace la IA.** Nada generado por IA se firma solo ni se marca como firmado (R6).
10. **Firmar y después anular.** Un registro firmado, o ya entregado, puede anularse después (registrado en el sujeto equivocado). La firma no se borra: lo que hubo queda a la vista. La anulación se muestra junto a la firma, y si el registro ya se entregó, la historia clínica del centro tiene que recibir el aviso. Cómo se le avisa depende del contrato de entregas (tarea 47).
11. **Lo que queda del lado del centro.** Verificar la identidad antes de dar la capacidad de firmar; la política que hace responsable a cada persona; la carta a la FDA cuando corresponda; la validación de la función con sus pruebas.

## Pruebas que la construcción tiene que traer

1. Cambiar un carácter del contenido firmado invalida la firma, a la vista, y bloquea la entrega. Y al revés: guardar, releer y recalcular sin cambiar nada da la misma huella.
2. La firma de un registro no vale para otro, aunque el contenido sea igual.
3. La primera firma de una sesión sin los dos componentes se rechaza; la segunda con uno se acepta; vencido el plazo se piden los dos. **Cerrar la sesión también:** después de salir y volver a entrar, la primera firma pide los dos, aunque el plazo no haya vencido.
4. Una persona sin la capacidad de firmar no firma, tenga la función que tenga.
5. Intentos fallidos: se registran, bloquean tras el límite y avisan.
6. Nombre, fecha, hora y significado aparecen en pantalla, en la exportación y en lo entregado.
7. La hora la pone el servidor; la que mande el navegador se ignora.
8. Ninguna pantalla usa la palabra «firma» fuera de este circuito (guarda sobre el texto de la interfaz).
9. La firma y la entrega van en una transacción: no queda una sin la otra.
10. La huella es estable: el mismo contenido, vuelto a serializar (otro orden de campos, otros espacios), da la misma huella. Sin esto habría firmas que se muestran inválidas sin que nadie haya cambiado nada.

11. En modo abierto, una persona sin la capacidad de firmar tampoco firma.
12. Un registro firmado que después se anula conserva su firma, muestra la anulación junto a ella y, si ya se había entregado, genera el aviso a la historia clínica.

**Si se elige el camino B (clave de firma propia), además:**

13. La clave no se guarda en claro ni de forma reversible: solo su derivación, con una sal distinta por persona. Dos personas con la misma clave no dejan el mismo valor guardado.
14. La clave vence: pasada la fecha, no firma hasta que se cambia.
15. Se bloquea tras el límite de intentos fallidos y el bloqueo no lo levanta la misma persona sola.
16. Restablecerla exige a la persona y a quien administra: ninguno de los dos puede hacerlo solo, y queda registro de los dos.
17. Quien administra no puede leer la clave ni firmar con ella.

## Decisiones para Santiago

1. **¿Firma o confirmación?** Si la firma que vale es la del profesional en la historia clínica, lo de Alphi se llama «confirmación de envío» y se construye con los mismos controles, sin el nombre.
2. **¿Por registro o por tanda?** Propuesta: por registro, con sesión de firma.
3. **¿Camino A o B?** A si el proveedor de identidad lo permite para todas las formas de ingreso; B si no. B pide migración.
4. **¿Quién verifica la identidad** de quien va a firmar en cada centro, y dónde queda la constancia?
5. **¿La firma existe solo en modo estricto**, o se construye con una comprobación propia que valga también en modo abierto?
6. **¿A quién le toca la carta a la FDA** en los estudios que la requieran? Es pregunta para Calidad y Legales.

## Lo que no se leyó o no se pudo comprobar

- Las fuentes se leyeron con una herramienta que extrae y resume el texto; no se cotejó cada frase contra el original. Antes de citar esta nota hacia afuera, alguien tiene que leer las secciones marcadas.
- De la guía de la EMA no se leyeron completos los anexos 1, 2 y 3.
- No se leyeron: los anexos de la Disposición ANMAT 7516/2025, ICH E6(R3), la ley 26.529, el reglamento europeo de identificación electrónica, ni el borrador del Anexo 22.
- Qué permite el proveedor de identidad en reautenticación: sin comprobar.
- Qué firma hoy la historia clínica del centro y con qué método: sin comprobar (figura entre los pedidos a ese equipo, tarea 45).

## Fuentes

- 21 CFR Part 11, edición del 1/4/2024: https://govinfo.gov/content/pkg/CFR-2024-title21-vol1/pdf/CFR-2024-title21-vol1-part11.pdf
- FDA, guía de octubre de 2024: https://fda.gov/media/166215/download
- EMA/INS/GCP/112288/2023: https://www.ema.europa.eu/en/documents/regulatory-procedural-guideline/guideline-computerised-systems-electronic-data-clinical-trials_en.pdf
- Ley 25.506, texto actualizado: https://www.argentina.gob.ar/normativa/nacional/ley-25506-70749/texto
