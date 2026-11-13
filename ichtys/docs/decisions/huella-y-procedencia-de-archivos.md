# Huella y procedencia de cada archivo; origen de cada valor de laboratorio

**Estado:** propuesta del 2026-11-13 (🧠 Architect, pedido de Santiago/Fable vía Foreman). Cubre la brecha **C4** de [`REGULATORY-BASELINE.md`](../compliance/REGULATORY-BASELINE.md) («archivos sin huella ni procedencia») y el punto 2 de la revisión del #143 (de qué informe y de qué fecha sale cada valor). Base: R3, R5, R6, R8, R11. La implementa 🔨 Builder en PRs chicos, en el orden de la última sección.

**Fuera de alcance:** la ventana de vigencia de un valor de laboratorio (cuántos días sirve para elegibilidad). Esta nota solo **guarda** la fecha. Ninguna regla de screening la lee hasta que Santiago dé la respuesta clínica.

## 1. Qué se guarda hoy de cada archivo subido

Leído en `origin/main` 90592d5.

| Camino | Tabla | Qué guarda | Huella | Quién | Cuándo | Por qué camino | El original |
|---|---|---|---|---|---|---|---|
| Documento suelto (`api/documents/upload`) | `document_versions` | clave y URL del blob, tamaño, versión | **No** | **No en la fila**: solo en `audit_logs.user_id` | `created_at` | **No en la fila** | Sí, en Vercel Blob privado |
| Importación en lote (`api/studies/bulk-import`) | `document_versions` | igual que arriba | **No** | **No en la fila**: solo en auditoría | `created_at` | Solo en `audit_logs.metadata.bulk = true` | Sí, en Vercel Blob privado |
| Informe de laboratorio en PDF (`lab-reports`) | `lab_reports` | transcripción y filas cifradas, nombre del archivo | **No** | `created_by` | `created_at` | `source_kind = pdf_text` | **No se guarda** (lo dice el esquema) |
| Informe de laboratorio como foto (`lab-reports/images`) | `lab_reports` + `lab_report_images` | recortes cifrados, uno por hoja | **No** | `created_by` (en el informe) | `created_at` | `source_kind = image` | **No**: el recorte se hace en el navegador; al servidor solo llega el recorte |
| Audio de dictado | `dictation_audios` | audio cifrado, duración, tamaño | **Sí**: `sha256` de lo recibido, antes de cifrar | `created_by` | `created_at` | implícito (una sola ruta) | Sí, cifrado, 30 días; después queda la constancia |

`dictation_audios` ya resuelve el problema (decisión D14 de [`consulta-dictada.md`](./consulta-dictada.md)) y es el modelo a copiar.

**Qué falta:**
- La huella SHA-256 en documentos, informes de laboratorio y recortes.
- Quién subió y por qué camino, en la fila del archivo. Hoy esos datos están solo en la auditoría.

## 2. Lo que una huella prueba y lo que no (R11)

Esta nota **no cierra «copia fiel»**. Lo que sí deja es esto:

- **Documentos:** se guarda el archivo y su huella. Con eso se puede demostrar que el PDF que se sirve hoy es, byte a byte, el que se subió.
- **Informe de laboratorio en PDF:** el original no se guarda, así que la huella sola no prueba nada. Sirve para que el centro, que tiene el original, lo compare: si el SHA-256 del suyo coincide con el guardado, es el mismo archivo del que salieron los valores. No se puede reconstruir el original a partir de la huella.
- **Foto o escaneo:** el servidor nunca ve la imagen completa, porque el recorte que deja afuera el nombre del paciente se hace en el navegador (R5). La huella del servidor es la **del recorte**. Una huella calculada en el navegador sería la palabra del navegador, no una prueba, y no se propone.

Si Santiago quiere copia fiel de los informes de laboratorio, hay que decidir guardar el original cifrado. Esa decisión cambia la conservación y la minimización, y queda en «Sin resolver».

## 3. Origen y fecha de cada valor de laboratorio

### Hoy

Hay **tres caminos** que escriben `profile.labs`. Todos terminan en `upsertLab`, que reemplaza por nombre.

| Camino | Función | ¿Guarda de dónde salió? |
|---|---|---|
| Informe confirmado (PDF o foto) | `confirmLabReport` (`lib/labs/lab-report-service.ts`) | **No.** Conoce `reportId` pero arma `{ name, value, unit }` y lo descarta |
| Texto pegado y revisado | `confirmLabOcrReview` (`lib/subjects/lab-review-service.ts`) | **No** |
| Propuesta desde una evolución, aceptada | `extract-facts.ts` / `extract-merge.ts` | **Sí**, `sourceEvolutionId` |

**Fecha de la muestra:** no existe como dato.
- El parser (`KEPT_HEADER_DATE`, en `packages/clinical/lab-report-parser.ts`) conserva en la transcripción cualquier renglón «Fecha …». Mezcla extracción, toma y muestra con emisión, recepción y validación.
- Si el renglón trae hora después de la fecha («Fecha: 24/09/2026 08:02»), no coincide con el patrón y, si está en el encabezado, se tapa como un renglón más (verificado contra la expresión).
- En una foto, el recorte puede dejar afuera el encabezado entero, con la fecha incluida.

### Decisiones

| # | Decisión | Por qué |
|---|---|---|
| D1 | Cada valor de `profile.labs` lleva un **origen** con una sola forma: `source: { kind: 'lab_report', reportId } \| { kind: 'evolution', evolutionId } \| { kind: 'pasted_text' }`. `sourceEvolutionId` se sigue leyendo en perfiles viejos y se traduce a `{ kind: 'evolution' }`; no se agregan campos paralelos | Un solo lugar para preguntar «¿de dónde salió?». Hoy hay un campo para un camino y nada para los otros dos |
| D2 | Cada valor lleva **`sampleDate`**: fecha `YYYY-MM-DD`, o `null` si no se sabe. **Nunca** se completa con la fecha de carga ni con la de emisión | Dato faltante no es dato. Una fecha inventada haría pasar por vigente un valor viejo cuando exista la ventana |
| D3 | La fecha **la propone** el lector (solo un renglón de extracción, toma o muestra; nunca emisión ni validación) y **la confirma una persona** en la pantalla de revisión del informe, junto a los valores. Si el informe no la trae, la persona la puede escribir o dejarla en «desconocida» | R6 y L18: lo que propone una máquina no queda como dato sin una persona |
| D4 | Una fecha por informe, la misma para todas sus filas. Si una persona necesita fechas distintas, sube dos informes | Simple y alcanza para el caso real. Fechas por fila serían otro PR, con otra pantalla |
| D5 | Los perfiles viejos se leen igual: un valor sin `source` se muestra «sin origen registrado» y sin `sampleDate` como «fecha desconocida». No se rellena hacia atrás | No se inventa procedencia |
| D6 | **No cambia la regla de reemplazo**: el último valor confirmado gana, como hoy. Ninguna regla de screening lee `sampleDate` | La orden es guardar el dato; la vigencia la decide Santiago |

### Dos trampas de esquema que la implementación tiene que cubrir

- `labObservationSchema` es un `z.object` común: **descarta en silencio las claves que no conoce**. Hay que agregar `source` y `sampleDate` al esquema en el mismo PR que los escribe. Cualquier camino que rearme el valor a mano (como `confirmLabReport` hoy) los pierde sin error.
- `labReportContentSchema` es `.strict()` con `version: z.literal(1)`: **rechaza cualquier clave nueva**.
  - `sampleDate` entra como campo **opcional** de la versión 1, sin subir a `version: 2`. Así los informes ya guardados se siguen leyendo.
  - Lo que se lea antes que lo que se escriba: si se vuelve atrás a un código anterior al lector tolerante, los informes que ya tengan `sampleDate` dejan de abrirse.
  - Por eso el primer PR de abajo solo **acepta** el campo, y el que lo **escribe** va recién después. Una vuelta atrás nunca puede pasar de ese primer PR.

## 4. Tablas que toca y migración

| Cambio | Dónde | Migración |
|---|---|---|
| Huella, quién y camino en documentos | `document_versions`: `sha256 text`, `uploaded_by text`, `upload_channel text` (`single` \| `bulk_import`) | **Sí**: `0019`, columnas nulas, `ADD COLUMN IF NOT EXISTS` |
| Huella del archivo recibido en informes de laboratorio | `lab_reports`: `source_sha256 text` (del PDF tal como llegó, antes de leerlo). Quién y camino ya están (`created_by`, `source_kind`) | Sí, en la misma `0019` |
| Huella de cada recorte | `lab_report_images`: `sha256 text` (del recorte recibido, antes de cifrar) | Sí, en la misma `0019` |
| Origen y fecha de cada valor | dentro de `patient_profiles.profile_encrypted` (JSON cifrado) | **No**: es zod en `packages/clinical` |
| Fecha confirmada del informe | dentro de `lab_reports.content_encrypted` | **No**. Va cifrada: una fecha de muestra de un paciente es dato de salud (R5) y no va en columna en claro |

Reglas para la `0019`:
- Las columnas son **nulas** y las filas viejas quedan en `null`, que se lee «no se registró». No se calcula hacia atrás: los PDF están en el blob, pero recalcular la huella hoy no prueba lo que llegó entonces.
- Se aplica **a mano, con SQL idempotente, antes del código**. Nunca con `db:migrate` (el journal está desordenado, #76; R8).
- `packages/db` es el carril de **Fable**: la escribe Fable o alguien con su OK explícito. La huella se calcula igual que en `lib/dictation/audio-store.ts` (`createHash('sha256')` sobre los bytes recibidos). No se crea otro helper; `lib/audit/fingerprint.ts` es para JSON, no para archivos.

## 5. Pruebas que lo demuestran

Cada prueba asierta el valor exacto, nunca «no es otra cosa» (L27).

**Huella:**
1. Un PDF de prueba fijo se sube por las dos rutas de documentos y por la de laboratorio. La fila guarda **el SHA-256 hexadecimal exacto** del archivo, calculado aparte en la prueba. La auditoría de la misma transacción lleva la misma huella.
2. Se cambia un byte del archivo y la huella es otra.
3. En la foto, cada recorte guarda la huella exacta de los bytes recibidos, no la de lo cifrado.
4. `uploaded_by` es el usuario de la sesión. `upload_channel` vale `single` en la ruta suelta y `bulk_import` en el lote.

**Origen y fecha:**
5. Al confirmar un informe con fecha confirmada `2026-09-24`, cada valor del perfil sale con `source = { kind: 'lab_report', reportId: <ese id> }` y `sampleDate = '2026-09-24'`, exactos.
6. Un informe confirmado sin fecha deja `sampleDate: null`, y no la fecha de carga.
7. Un informe cuyo único renglón es «Fecha de emisión: …» no propone fecha de muestra.
8. Los tres caminos que escriben `profile.labs` dejan su `source` correcto, una prueba por camino (L24).
9. **Ida y vuelta cifrada:** se extiende `lib/subjects/__tests__/patient-profile-roundtrip.test.ts` para que `source` y `sampleDate` sobrevivan cifrar → guardar → leer. Es la prueba que atrapa la trampa del `z.object`.
10. Un perfil guardado antes del cambio se lee sin error: el valor con `sourceEvolutionId` sale como `{ kind: 'evolution' }`, y los demás como «sin origen».
11. **Guarda de alcance:** el mismo perfil con `sampleDate` de hace 2 días y de hace 2 años da **exactamente el mismo estado y motivo** en todas las reglas de screening. Si alguien conecta la fecha a una regla sin la decisión de Santiago, esta prueba se pone en rojo.

## 6. Orden sugerido de PRs (Builder)

1. **Lector tolerante:** `labObservationSchema` acepta `source` y `sampleDate` opcionales, y `labReportContentSchema` acepta `sampleDate` opcional. Incluye las pruebas 9 y 10. Sin migración.
2. **Origen en los tres caminos** (pruebas 5 a 8, todavía sin fecha). Sin migración.
3. **Fecha propuesta y confirmada** en la pantalla de revisión del informe (pruebas 5, 6, 7 y 11). Con pantalla, así que L1, L2 y L6: captura a 1360px mirada.
4. **`0019` + huella, quién y camino** (pruebas 1 a 4). Aplicar la `0019` antes de integrar. Carril de Fable.

## Sin resolver (para Santiago)

- **Ventana de vigencia** de un valor de laboratorio para elegibilidad (pendiente desde el #143). Esta nota solo deja el dato listo.
- **Un informe viejo subido después pisa a uno más nuevo**, porque hoy gana el último confirmado y D6 lo mantiene. Con la fecha guardada se podría elegir el más reciente por muestra, pero eso ya es decidir cuál vale, y queda para la misma conversación que la vigencia.
- **Guardar o no el original** del informe de laboratorio, cifrado, para sostener copia fiel. Hoy solo se guarda la transcripción o el recorte.
