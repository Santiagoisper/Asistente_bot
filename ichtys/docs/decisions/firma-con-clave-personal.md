# Confirmación con clave personal como firma electrónica: nota de diseño

Fecha: 15/11/2026. Tarea 46 del cronograma. **Estado: propuesta, sin construir, sin revisión de Calidad ni de Legales. Decisiones 1 a 5 tomadas (la 4, con una salvedad abierta); la 6 abierta.** Nada de esto afirma conformidad con ninguna norma.

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

**Respuesta del 15/11/2026, 06:04:** quien dirige el producto aceptó lo propuesto en las tres primeras («sí, así»).

**Decisiones 4 y 5, tomadas el 15/11/2026 por quien construye, por delegación expresa de quien dirige el producto (06:43 y 06:49 de ese día).** Son reversibles y él las ve en su lista. La 6 no se decide acá: es de Calidad y Legales.

**Dónde consta esa delegación.** No fue por la sala del equipo: fueron dos mensajes directos de quien dirige el producto a quien construye. [H] Quedó asentada ese mismo día por el Foreman, el agente que coordina el equipo, en el registro de pendientes y decisiones del proyecto (Notion, base «Pendientes y decisiones — BOPE-OS», entrada del 15/11/2026 con las siete decisiones tomadas por delegación, última edición 07:14): su punto 6 nombra las decisiones 4, 5 y 6 de esta nota, con el mismo sentido que la tabla de abajo. También figura en la bitácora del proyecto, bloque «06:50 a 09:30» de ese día. De la decisión 4, el asiento dice quién verifica y que queda en el registro de auditoría; que la constancia de cómo se verificó es del centro lo agrega esta nota. [P] Los dos mensajes originales no están en un lugar que otra persona pueda abrir: lo que se puede verificar es el asiento, no el mensaje.

| Decisión | Queda así |
|---|---|
| 1 | Se llama **«confirmación de envío»**, no firma, mientras la firma clínica que vale sea la del profesional en la historia clínica. Se construye con los mismos controles |
| 2 | **Por registro**, con sesión de firma. No por tanda |
| 3 | **Camino A** (reautenticar en el proveedor de identidad) si lo permite para todas las formas de ingreso; **B** (clave propia, con migración) si no. Ver «Lo que se comprobó del proveedor de identidad» |
| 4 | **Quien administra la organización** verifica la identidad de la persona antes de darle la capacidad de confirmar. Dar y quitar esa capacidad queda en el registro de auditoría, con quién la dio. La constancia de cómo verificó (documento, en persona) es del centro, fuera del sistema. **Tiene una salvedad abierta: ver abajo** |
| 5 | **Comprobación propia, que vale en los dos modos.** No se apoya en el validador de siempre, que en modo abierto no restringe a nadie. Motivo: el modo estricto no está encendido en ninguna organización, y una confirmación que solo existiera ahí no existiría para nadie |
| 6 | **Sin decidir.** A quién le toca la carta a la FDA es pregunta para Calidad y Legales |

Lo que estas respuestas no deciden: si la premisa de la 1 es cierta en cada centro (qué firma vale en su historia clínica), que es pregunta para el centro y para Calidad.

### Salvedad abierta de la decisión 4: quien da la capacidad puede dársela a sí mismo

La marcó la revisión del 15/11/2026. [I] Tal como está escrita, nada impide que quien administra la organización se dé a sí mismo la capacidad de confirmar, ni que se la dé a otra persona sin que nadie más lo vea. En el primer caso, quien verifica la identidad y quien recibe la capacidad son la misma persona: esa verificación no verifica nada. [H] §11.100(b) pide que la organización verifique la identidad antes de asignar la firma (tabla de arriba); [I] una persona que se verifica sola no es lo que ese punto espera. El registro de auditoría lo dejaría a la vista después, pero no lo impide.

[O] **Propuesta, sin decidir.** Es de la revisión de arquitectura; la decide quien dirige el producto:

- Nadie se da la capacidad a sí mismo: se la da otra persona que administre la organización.
- El registro guarda quién la dio y a quién, y una prueba exige que sean personas distintas. Si se acepta, se suma a «Pruebas que la construcción tiene que traer».
- **Organización con una sola persona que administra: sin resolver.** Dos salidas posibles: que se la dé quien administra la plataforma, o que no se pueda dar hasta que haya dos. Cada una cambia quién puede confirmar en un centro chico, y eso no lo elige quien construye.

Mientras no se decida, la decisión 4 queda como está en la tabla, con este hueco a la vista. Se resuelve antes de construir.

1. **¿Firma o confirmación?** Si la firma que vale es la del profesional en la historia clínica, lo de Alphi se llama «confirmación de envío» y se construye con los mismos controles, sin el nombre.
2. **¿Por registro o por tanda?** Propuesta: por registro, con sesión de firma.
3. **¿Camino A o B?** A si el proveedor de identidad lo permite para todas las formas de ingreso; B si no. B pide migración.
4. **¿Quién verifica la identidad** de quien va a firmar en cada centro, y dónde queda la constancia?
5. **¿La firma existe solo en modo estricto**, o se construye con una comprobación propia que valga también en modo abierto?
6. **¿A quién le toca la carta a la FDA** en los estudios que la requieran? Es pregunta para Calidad y Legales.

## Lo que se comprobó del proveedor de identidad (15/11/2026)

Leído en la documentación pública del proveedor, sin probarlo en ninguna instancia:

- [H] Ofrece **reverificación**: el servidor pregunta si la persona verificó sus credenciales dentro de una ventana de tiempo y, si no, responde con un error que el navegador convierte en un pedido de verificación. La versión instalada (`@clerk/nextjs` 7.x) la trae.
- [H] Hay niveles fijos. Uno pide el primer factor dentro de los últimos 10 minutos; otro, primer y segundo factor dentro de los últimos 10 minutos; otros dos usan ventanas más largas.
- [I] **Encaja con la sesión de confirmación, pero no es idéntica a lo que propone esta nota.** La nota dice «la primera pide los dos componentes, las siguientes uno». El proveedor no pide un componente por cada confirmación: deja pasar todas las que caigan dentro de la ventana y vuelve a pedir al vencer. Para Part 11 §11.200(a)(1)(i) eso es más flojo que «un componente cada vez». Si se quiere un componente por registro, hace falta el camino B o algo propio encima del A.
- [P] **Sin comprobar:** que quien entra con una cuenta de terceros (sin clave propia en el proveedor) pueda reverificar, y con qué. Que funcione en el plan contratado. Y la instancia de producción sigue siendo una de desarrollo (tarea 23): ahí no se puede dar por bueno nada.

**Consecuencia para la decisión 3:** el camino A existe. No se elige todavía entre A y B: falta probar la reverificación con una cuenta real de cada forma de ingreso, y decidir si la ventana de tiempo alcanza o se pide un componente por registro.

## Qué falta para poder construirla

En orden, y ninguno depende de quien construye:

1. **El contrato de entregas a la historia clínica (tarea 47).** La confirmación se guarda en la misma transacción que la entrega; sin entrega no hay qué confirmar. Ese contrato espera las respuestas de quienes tienen el código de la historia clínica del centro.
2. **La instancia de producción del proveedor de identidad (tarea 23).**
3. **La prueba de reverificación** con cuentas reales, que cierra la decisión 3.

Y, sin orden respecto de esos tres: **la salvedad abierta de la decisión 4** (quién le da la capacidad a quien administra, y qué pasa en una organización con una sola persona que administra). La decide quien dirige el producto.

Lo que sí existe ya y se va a reusar: la huella del contenido en forma canónica (`apps/web/lib/audit/fingerprint.ts`). Le falta unificar saltos de línea y normalizar Unicode en el texto, que esta nota pide; se agrega al construir.

## Lo que no se leyó o no se pudo comprobar

- Las fuentes se leyeron con una herramienta que extrae y resume el texto; no se cotejó cada frase contra el original. Antes de citar esta nota hacia afuera, alguien tiene que leer las secciones marcadas.
- De la guía de la EMA no se leyeron completos los anexos 1, 2 y 3.
- No se leyeron: los anexos de la Disposición ANMAT 7516/2025, ICH E6(R3), la ley 26.529, el reglamento europeo de identificación electrónica, ni el borrador del Anexo 22.
- Qué permite el proveedor de identidad en reautenticación: leído en su documentación el 15/11/2026, sin probar (ver arriba).
- Qué firma hoy la historia clínica del centro y con qué método: sin comprobar (figura entre los pedidos a ese equipo, tarea 45).

## Fuentes

- 21 CFR Part 11, edición del 1/4/2024: https://govinfo.gov/content/pkg/CFR-2024-title21-vol1/pdf/CFR-2024-title21-vol1-part11.pdf
- FDA, guía de octubre de 2024: https://fda.gov/media/166215/download
- EMA/INS/GCP/112288/2023: https://www.ema.europa.eu/en/documents/regulatory-procedural-guideline/guideline-computerised-systems-electronic-data-clinical-trials_en.pdf
- Ley 25.506, texto actualizado: https://www.argentina.gob.ar/normativa/nacional/ley-25506-70749/texto
- Proveedor de identidad, reverificación: https://clerk.com/docs/guides/secure/reverification
