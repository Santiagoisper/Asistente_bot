# ALPHI — Auditoría de seguridad de Asistente_bot

**Auditor:** SICARIO, slot 06  
**Fecha:** 2026-10-19  
**Alcance:** almacenamiento Blob, autorización/permisos y prompt injection.  
**Método:** revisión estática del código y documentación en `ichtys/`.  
**Referencia revisada:** branch `feature/alphi-2.0-visual-redesign`, HEAD `f40cac5`. El árbol de trabajo ya contenía cambios ajenos a esta auditoría.  
**Limitación:** no se ejecutaron pruebas ni se inspeccionó configuración de Vercel, objetos Blob desplegados, secretos o tráfico real. Los hallazgos describen el código revisado; no confirman el estado de producción.

## Resumen ejecutivo

**No considerar el almacenamiento de documentos clínicos apto para datos sensibles hasta corregir SEC-01 y verificar la remediación en el despliegue.** Las rutas de descarga de la aplicación exigen autenticación y autorización por objeto, pero los PDFs se crean como objetos Blob públicos; el control de la ruta no protege una URL pública conocida. También hay una brecha entre los permisos de escritura documental definidos y los aplicados por las rutas de carga. La defensa de prompt injection es principalmente una instrucción al modelo y el streaming publica texto antes de la evaluación posterior.

## Hallazgos

### SEC-01 — PDFs de estudios almacenados públicamente

**Severidad: Alta — confidencialidad de documentos**

En `ichtys/apps/web/app/api/documents/upload/blob-storage.ts:25-43`, el helper `putPrivateBlobProduction` llama a Vercel Blob con `access: 'public'` (línea 34). El nombre del helper y las políticas del proyecto prometen almacenamiento privado, pero la opción efectiva permite servir el objeto desde su URL pública. Las rutas de carga simple y masiva usan este helper: `ichtys/apps/web/app/api/documents/upload/route.ts:129-159` y `ichtys/apps/web/app/api/studies/bulk-import/route.ts:148-185`.

Las rutas de la aplicación sí aplican controles: la descarga valida acceso al objeto antes de leerlo (`ichtys/apps/web/app/api/document-versions/[documentVersionId]/download/route.ts:63-68`) y responde `private, no-store` (líneas 87-97). Sin embargo, tanto esa lectura (`.../blob-download.ts:21`) como la ingesta (`ichtys/packages/ingestion/pipeline.ts:157-162`) hacen `fetch(blobUrl)` sin autenticación de Blob. Esos controles de la aplicación no restringen el acceso directo a una URL de un objeto público que haya sido conocida o filtrada.

Esto contradice la decisión de carga documental, que exige `access: private` y lecturas detrás de autorización (`ichtys/docs/decisions/document-upload.md:10-12,43-47`), y la política de seguridad (`ichtys/docs/SECURITY.md:35-36,51`). La API de carga no devuelve la URL en su respuesta (`.../upload/route.ts:188-198`), pero eso no convierte el objeto en privado.

**Acción recomendada:** cambiar las dos rutas de escritura a Blob privado y migrar las lecturas de descarga e ingesta a una operación privada autenticada con el token del servidor y la clave del objeto. Planificar migración o eliminación de los objetos ya creados como públicos, invalidar URLs anteriores cuando sea posible y comprobar desde un cliente sin sesión que los objetos ya no se leen. No desplegar solo el cambio de escritura: rompería las lecturas actuales basadas en `fetch(blobUrl)`.

### SEC-02 — Carga documental sin exigir el rol con permiso de escritura

**Severidad: Media — autorización por rol**

El control de estudio se aplica en la carga simple (`.../documents/upload/route.ts:116`) y la carga masiva autentica usuario y organización (`.../studies/bulk-import/route.ts:57-58,85`); los controles de pertenencia y límites de archivos/rate limit reducen otros riesgos. Sin embargo, ninguna ruta exige explícitamente el permiso de gestión documental. La función `canManageDocuments` define que monitores e investigadores principales son de solo lectura y que coordinadores en adelante pueden gestionar documentos (`ichtys/packages/auth/roles.ts:38-44`), pero no tiene usos en el código (`rg` no encontró llamadas fuera de su definición). Además, `validateStudyAccess` se invoca sin requisito de rol en la carga simple; la ruta masiva tampoco valida un rol de escritura antes de crear estudios, documentos y trabajos de ingesta.

Por tanto, un miembro autenticado con rol de solo lectura podría alcanzar operaciones de escritura si la autorización por rol no se aplica en otra capa no inspeccionada. No se confirmó una configuración de producción que permita explotarlo.

**Acción recomendada:** hacer cumplir `canManageDocuments` (o una política equivalente, que también excluya explícitamente los roles no autorizados) en ambas rutas antes de almacenar archivos o crear registros. Añadir pruebas de autorización por rol para monitor, investigador principal, coordinador y administrador, además de conservar las pruebas de aislamiento entre organizaciones/estudios.

### SEC-03 — Defensa contra prompt injection basada en instrucciones; el streaming se entrega antes de validarse

**Severidad: Alta — integridad de respuestas clínicas; explotación no demostrada**

El prompt principal ordena tratar los extractos como evidencia e ignorar instrucciones incrustadas (`ichtys/packages/rag/answer-engine.ts:110-123`). Sin embargo, historial, pregunta y extractos se interpolan como texto ordinario dentro del mismo prompt de usuario, sin delimitadores estructurales o una frontera de confianza robusta (`:312-332`). El extractor de protocolos usa la misma clase de defensa declarativa: la instrucción del sistema dice ignorar directivas en páginas (`ichtys/packages/ingestion/spec-extractor.ts:374-382`), pero concatena instrucciones, ejemplos y páginas en el prompt (`:448-463`). La política reconoce que no hay filtrado/sanitización en servidor y que la defensa se apoya en el prompt (`ichtys/docs/SECURITY.md:282-287`).

La ruta de streaming emite tokens mientras el modelo los genera (`ichtys/apps/web/app/api/chat/stream/route.ts:247-261`). La evaluación de confianza ocurre después de completar la emisión (`ichtys/packages/rag/answer-engine.ts:635-662`); incluso si detecta evidencia insuficiente, el texto ya fue enviado. Si esa evaluación falla, el código devuelve `medium` (`:543-544`), en vez de fallar de forma cerrada. La prueba de prompt injection encontrada solo comprueba que el texto del system prompt contenga una instrucción de defensa; no simula un documento malicioso ni una respuesta manipulada (`ichtys/packages/rag/__tests__/answer-engine.test.ts:417-432`).

No encontré llamadas a herramientas ni acciones externas desde este flujo; el riesgo observado es que instrucciones adversarias en documentos o historial manipulen la respuesta clínica, no ejecución arbitraria de herramientas. La validación de índices/citas tampoco demuestra que cada afirmación esté semánticamente sustentada.

**Acción recomendada:** delimitar explícitamente y por separado datos no confiables (pregunta, historial, documentos y ejemplos), mantener instrucciones de sistema aisladas y evaluar resistencia con documentos adversariales realistas. Para streaming, retener la respuesta hasta completar validaciones suficientes o presentar el contenido como provisional y poder suprimirlo antes de mostrarlo; una falla del evaluador debe degradar a respuesta segura sin afirmaciones. Verificar afirmaciones/citas contra evidencia, no solo la presencia de índices.

## Controles observados

- La carga simple rechaza campos de organización aportados por el cliente, valida tipo/tamaño y firma PDF, valida acceso al estudio y aplica rate limit por usuario/organización (`.../documents/upload/route.ts:76-132`).
- La descarga en la aplicación valida el acceso al objeto antes de leerlo, registra el acceso y evita caché (`.../download/route.ts:63-97`). Esto no compensa el acceso público directo señalado en SEC-01.
- La respuesta no devuelve directamente la URL Blob en el endpoint de carga (`.../documents/upload/route.ts:188-198`).
- La ruta de carga masiva limita el lote y tamaño y deriva organización desde Clerk; hace falta añadir el control de rol descrito en SEC-02.

## Orden sugerido de remediación

1. Hacer privados los objetos y corregir descarga/ingesta como un solo cambio compatible; tratar y verificar los objetos públicos ya existentes.
2. Aplicar y probar el permiso de gestión documental en cargas simples y masivas.
3. Cerrar la ventana de streaming previa a validación y ampliar las pruebas adversariales de prompt injection para chat e ingesta.
4. Ejecutar pruebas y verificación de despliegue en un entorno autorizado; comprobar objetos reales sin credenciales y documentar evidencia antes de declarar los hallazgos cerrados.

---

## Addendum — Fase 2 SICARIO: rediseño ALPHI 2.0

**Fecha:** 2026-10-19  
**Alcance adicional:** revisión estática del diff `f40cac5..0158d4e` (incluye las fases UI/diseño de ALPHI 2.0 y `lib/asim.ts`). Referencia actual: HEAD `0158d4e`. El árbol de trabajo tiene reportes/capturas y otros archivos sin seguimiento; no se consideran parte del diff auditado.  
**Método y límites:** no se ejecutaron pruebas, no se hizo prueba dinámica ni se inspeccionó el despliegue. La revisión cubrió rutas nuevas, layout, componentes modificados y cambios de librería. Este addendum complementa la revisión previa; su alcance no es una auditoría integral de toda la aplicación.

### Resultado de Fase 2

No encontré una regresión nueva de acceso a datos o ejecución de código atribuible al diff revisado: los archivos nuevos son páginas de prototipo con contenido estático sintético, y los cambios existentes se concentran en estilos, navegación y diseño. Las páginas nuevas están bajo el middleware global de Clerk (`ichtys/apps/web/middleware.ts:21-25,27-32`), cuyo matcher cubre rutas de aplicación y API. El contenido de ejemplo se rotula repetidamente como sintético; no vi lecturas de PHI ni llamadas a APIs en esos stubs.

Esto no prueba autorización por rol ni aislamiento futuro para esas pantallas: si reciben datos reales, cada ruta/servicio deberá validar autorización del lado servidor para organización, estudio y rol, sin confiar en que la navegación o la pertenencia al grupo `(app)` baste.

### SEC-04 — Insignia de cumplimiento fija, sin evidencia de verificación

**Severidad: Media — integridad de estado y confianza operativa; riesgo heredado, no introducido por el diff**

La cabecera común muestra una insignia animada `GCP Compliant` de forma incondicional (`ichtys/apps/web/app/(app)/layout.tsx:129-133`). No está conectada a una medición, una fuente de cumplimiento ni una configuración verificable. El diff `f40cac5..0158d4e` no introduce esta insignia; ya existía en la versión base, pero queda presente en la superficie rediseñada.

En una aplicación que maneja información clínica, una señal visual de cumplimiento no sustentada puede inducir a usuarios a asumir que los controles fueron verificados. La apariencia pulsante también se puede interpretar como estado vivo.

**Acción recomendada:** retirar la insignia o sustituirla por un estado explícito `NO VERIFICADO` hasta que exista una fuente verificable, alcance definido y actualización derivada de evidencia real. No usar una afirmación visual de cumplimiento como decoración.

### Hallazgos anteriores sin cambio en esta fase

El diff de Fase 2 no modifica Blob storage, autorización de cargas ni el motor RAG/streaming. Por eso SEC-01 (objetos públicos), SEC-02 (permiso de escritura documental no aplicado en cargas) y SEC-03 (defensa declarativa de prompt injection y streaming antes de validar) permanecen abiertos según la revisión estática anterior. Este addendum no los vuelve a verificar en despliegue ni aporta evidencia de remediación.

### Evidencia de alcance UI

- Las rutas nuevas `/jornada`, `/protocolo`, `/visita`, `/consulta` y `/calidad` devuelven contenido estático sintético; por ejemplo, `ichtys/apps/web/app/(app)/jornada/page.tsx:2-8` y `ichtys/apps/web/app/(app)/consulta/page.tsx:2-8`.
- La navegación añadida está en `ichtys/apps/web/app/(app)/layout.tsx:27-56`; no encontré controles ni datos de usuario en esos enlaces.
- Los cambios a formularios y Biblioteca del diff son de clases/estilos y no alteran las llamadas de escritura, consultas o persistencia.
- `ichtys/apps/web/lib/asim.ts` contiene tipos y validaciones de entrada del motor; el diff no añade transporte de datos, almacenamiento ni efectos externos.

## Estado de cierre de la auditoría

La revisión de seguridad del rediseño no encontró una nueva vulnerabilidad de acceso o ejecución en los cambios de Fase 2. Queda un riesgo de confianza visual heredado (SEC-04), y los hallazgos de alta prioridad SEC-01 y SEC-03, junto con SEC-02, siguen abiertos. El resultado es estático y no equivale a aprobación de seguridad del despliegue.

---

## Addendum — Fase 7 SICARIO: permisos y datos en el flujo de chat

**Fecha:** 2026-10-19  
**Alcance:** endpoints `/api/chat`, `/api/chat/stream`, conversaciones e historial, citas, retrieval/spec context, persistencia, logging y selección de proveedor.  
**Referencia revisada:** branch `feature/alphi-2.0-visual-redesign`, HEAD `1c70bdf`.  
**Método y límites:** revisión estática; no ejecuté pruebas ni verifiqué logs, datos de producción, proveedores configurados o despliegue. El código permite persistir texto clínico potencial, pero no se confirmó que haya PHI real en producción.

### Resumen

No confirmé un bypass de autorización entre organizaciones/estudios o entre usuarios dueños de conversaciones en los endpoints revisados. El flujo resuelve organización desde Clerk, valida estudio, valida ownership de conversación y acota SQL de retrieval e historial por tenant. Sí detecté brechas de manejo de datos: una pregunta se registra en logs de desarrollo; la selección de proveedores no es consistente entre rutas y el título automático siempre usa la cadena global; y preguntas/respuestas/citas se persisten como texto sin cifrado de campo ni política de retención visible en el flujo.

### SEC-05 — Preguntas de chat escritas en logs locales de desarrollo

**Severidad: Media — exposición local de datos; activa solo en `NODE_ENV=development`**

`answerEngine` agrega los primeros 80 caracteres de la pregunta a `logLine`, los imprime con `console.log` y los añade a `/tmp/ichtys-rag-scores.log` (`ichtys/packages/rag/answer-engine.ts:384-393`). Las preguntas pueden contener identificadores o detalles clínicos. Esto contradice la política que prohíbe registrar preguntas/PHI (`ichtys/docs/SECURITY.md:275-280,443-453`). El logger estructurado tiene una lista de campos prohibidos, pero esta ruta usa `console.log` directamente y no pasa por esa sanitización.

**Acción recomendada:** quitar el texto de pregunta del log (usar solo request ID, longitud, conteos y scores), eliminar los registros locales existentes según la política de retención y agregar una revisión estática que detecte logging de contenido. No usar datos reales en desarrollo mientras este log exista.

### SEC-06 — El contenido del chat puede salir por rutas de proveedor no gobernadas por la configuración de la organización

**Severidad: Alta si la pregunta/documento contiene PHI o si la selección de proveedor es un límite contractual**

Hay rutas distintas de procesamiento:

- `/api/chat` usa `generateAnswerForStudy`, que recupera con la clave de embeddings del servidor cuando no se pasa una clave y llama a `answerEngine` sin `llmProviderPreference` ni `llmApiKeys` (`ichtys/apps/web/app/api/chat/route.ts:190-194`; `ichtys/apps/web/lib/rag/answer-orchestrator.ts:96-119`). El motor aplica entonces la preferencia global y claves del servidor (`ichtys/packages/llm/fallback.ts:53-75`; `.../provider.ts:12-20`).
- `/api/chat/stream` sí lee configuración y claves por organización, pero ante errores sustituye la configuración por `null`/`{}` (`ichtys/apps/web/app/api/chat/stream/route.ts:165-168`) y continúa con defaults globales. En modo `auto`, la cadena puede enviar la misma pregunta/contexto a varios proveedores sucesivos (`ichtys/packages/llm/types.ts:3-15`; `.../fallback.ts:77-84`).
- El título automático del chat recibe `question` y `studyName` y llama a `runWithLlmFallback({ purpose: 'title' })` sin preferencia ni claves de organización (`ichtys/apps/web/app/api/chat/stream/route.ts:170-176`; `ichtys/apps/web/lib/chat/persistence.ts:249-266`). Por tanto, incluso cuando la respuesta usa proveedor/org keys seleccionados, el título puede procesarse con el proveedor global.

La ruta del navegador que consume `/api/chat/stream` está en `ichtys/apps/web/components/chat/chat-client.tsx:210`; el helper `sendChatQuestion` conserva también una llamada a `/api/chat` (`.../chat-api.ts:51-59`), aunque no encontré consumidores actuales de ese helper. No hay evidencia en este análisis de qué proveedor se encuentra activo en producción ni de una transferencia efectiva a un proveedor no aprobado.

**Acción recomendada:** definir una política de proveedores permitidos por organización y aplicarla en todas las tareas que reciben texto (respuesta, título y embeddings); si no se puede leer la configuración, fallar de forma cerrada en vez de cambiar a defaults. Deshabilitar fallback cruzado entre procesadores para datos clínicos salvo autorización explícita. Hacer visible/auditable el proveedor efectivo sin registrar contenido y retirar o actualizar la ruta no streaming si ya no debe ser usada.

### SEC-07 — Preguntas, respuestas y extractos de citas se persisten sin cifrado de campo ni ciclo de retención visible

**Severidad: Alta si se permite ingresar PHI; en otro caso, riesgo de privacidad y retención**

Los handlers persisten cada pregunta y respuesta en `messages.content` (`ichtys/apps/web/lib/chat/persistence.ts:123-141,152-175`) y guardan `citations.excerpt` en texto (`:216-229`). El esquema usa columnas `text` (`ichtys/packages/db/schema/conversations.ts:192-253`); estas inserciones no pasan por el cifrado de campo. La implementación de cifrado PHI observada se aplica a evoluciones clínicas y perfiles, no al chat (`ichtys/apps/web/lib/subjects/phi-fields.ts:10-34`; `ichtys/docs/SECURITY.md:457-478`). Las rutas no muestran una comprobación de PHI ni una política de borrado/expiración del historial.

El documento de seguridad dice que la pregunta puede contener PHI y declara PHI de producción bloqueada hasta completar gates (`.../SECURITY.md:276,478-479`), pero el flujo acepta y persiste texto arbitrario. No se comprobó cifrado de disco del proveedor de base de datos ni el estado real de esos gates; por eso el hallazgo es sobre controles de aplicación ausentes, no sobre la configuración del almacenamiento subyacente.

**Acción recomendada:** mientras PHI no esté habilitada, aplicar y comunicar una restricción efectiva de no ingresar PHI en el chat; antes de habilitarla, clasificar qué campos pueden contenerla, cifrar pregunta/respuesta/extractos en reposo con manejo de claves/rotación, definir retención y borrado verificable y asegurar que lectura/exportación respete permisos de organización, estudio y usuario.

### Controles de autorización confirmados en código

- Ambos endpoints de chat resuelven `orgId` desde Clerk mediante `validateStudyAccess(studyId)` y rechazan identificadores de organización enviados por cliente (`ichtys/apps/web/app/api/chat/route.ts:86-123`; `.../chat/stream/route.ts:77-111`).
- Al recibir `conversationId`, `getOrCreateConversation` compara `organizationId`, `studyId` y `userId`; un desacuerdo devuelve acceso denegado (`ichtys/apps/web/lib/chat/persistence.ts:40-78`). El historial se consulta con filtros de conversación, organización y estudio (`:96-120`).
- Las conversaciones listadas quedan acotadas por organización, estudio y usuario (`ichtys/apps/web/lib/chat/history.ts:51-73`); el endpoint de mensajes valida ownership y después consulta con los tres límites (`.../conversations/[conversationId]/messages/route.ts:48-68`).
- El endpoint de citas valida el mensaje, vuelve a comprobar que su conversación pertenezca al usuario/org actual y obtiene las citas por mensaje, org y estudio (`.../citations/[messageId]/route.ts:36-64`).
- El SQL vectorial incluye `organizationId` y `studyId` antes de ordenar/limitar resultados (`ichtys/packages/rag/retriever.ts:143-171`); el spec contextual recibe ambos IDs derivados del caller (`ichtys/apps/web/lib/rag/spec-context.ts:202-216`).

Estos controles soportan la conclusión de que no se observó exposición cross-tenant en la ruta examinada. No verifican permisos de rol más finos, configuración efectiva de Clerk/DB, ni autorización del proveedor externo.

### Prioridad de remediación de Fase 7

1. Eliminar inmediatamente el texto de pregunta de `answerEngine` logs y evitar usar datos sensibles en entornos de desarrollo.
2. Unificar la política de proveedor y claves para chat, títulos y embeddings; no cambiar silenciosamente a proveedores globales ante fallos de configuración.
3. Definir el límite de datos permitido en chat y, antes de PHI, cifrado de mensajes/citas y retención/borrado auditables.
4. Mantener las validaciones tenant/user existentes y añadir pruebas de regresión para accesos cruzados, fallas de configuración de proveedor y ausencia de contenido sensible en logs.

No corrí esas pruebas como parte de esta auditoría estática.

## Addendum 2026-10-21 — SEC-01: remediación en código (rama `feature/alphi-2-clinical-workspace`)

**Estado: remediado en código, NO verificado en despliegue. SEC-01 sigue abierto en producción.**

Cambios (verificados con tests unitarios, `typecheck` y suites existentes en verde; datos sintéticos):

- `apps/web/app/api/documents/upload/blob-storage.ts`: la subida usa `access: 'private'`.
- Nuevo `packages/ingestion/blob-read.ts` (`openStoredBlob`): lectura server-side con `get(..., { access: 'private' })` autenticado. Lo usan la descarga (`.../download/blob-download.ts`) y la ingesta (`pipeline.ts`), sin duplicar lógica.
- Fallback: si el objeto es legado (público) se lee con `fetch` plano y se registra un aviso en el log. Es transitorio hasta migrar los objetos existentes.
- Tests de regresión: `packages/ingestion/__tests__/blob-read.test.ts` y `apps/web/app/api/documents/upload/__tests__/blob-storage.test.ts`.

Pendiente (requiere decisión y acción de quien administra producción; no se hizo):

1. Confirmar si el store de Vercel Blob de producción es público o privado. El modo de acceso depende del store: si es público, las subidas con `access: 'private'` fallarán (falla cerrada) hasta crear un store privado y rotar `BLOB_READ_WRITE_TOKEN`. Esto no fue verificado contra el SDK en un store real.
2. Migrar o eliminar los objetos ya creados como públicos y actualizar `blob_url` en `document_versions`.
3. Verificar en despliegue, con un PDF sintético, que la URL directa no responde sin credenciales y que descarga e ingesta funcionan por los endpoints.
4. Tras (1)-(3), retirar el fallback legado de `blob-read.ts` y alinear `ichtys/docs/SECURITY.md` (secciones sobre Blob privado) con la evidencia obtenida.
