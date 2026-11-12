# Clinical Research OS — Subproyecto 2: Carga de laboratorios

**Fecha:** 2026-11-10
**Estado:** boceto aprobado por Santiago; especificación para su revisión
**Boceto:** https://claude.ai/artifact/Q9749e6fpwRUFGaNHsCUYw
**Depende de:** subproyecto 1 (PR #79, #80, #81)

---

## 1. Propósito

Que el asistente de investigación suba el estudio de laboratorio de un sujeto y el programa lea los
valores y llene los campos, en lugar de tipearlos. Una persona confirma mirando el original.

### Lo que dijo Santiago

- Se sube un PDF o una foto y el programa llena los campos solo.
- Si un analito no existe como campo, el programa lo crea con lo que dice el estudio.
- La transcripción es tal cual y queda guardada en el programa.
- Primera versión: solo dentro de este programa, con su apartado. Alpha CR u otra pantalla, después.
- Fotos y escaneos: se recorta el encabezado antes de subir; al modelo le llega solo la tabla.
- Práctico para el asistente: botones que se entiendan.

### Reglas que no se negocian

1. **Un valor pasa al registro solo cuando una persona lo confirma.** Es el requisito ya validado
   (URS-007). El programa propone; no decide.
2. **Tal cual.** Cada valor se guarda como está impreso (texto), más el número interpretado aparte.
   Nunca se guarda solo el número interpretado.
3. **Nada identificatorio.** Los renglones de encabezado con nombre, documento u obra social se tapan
   antes de guardar la transcripción y antes de cualquier llamada a un modelo.
4. **Sin inventar.** Un valor propuesto tiene que aparecer, carácter por carácter, en el renglón de
   la transcripción que cita. Si no aparece, no se propone.

---

## 2. Alcance

Se entrega en dos tramos. Cada tramo queda usable por sí solo.

### Tramo A — PDF digital, de punta a punta

- Subir un PDF con texto seleccionable para un sujeto.
- Extraer el texto localmente (sin modelo), tapar el encabezado, interpretar los renglones.
- Pantalla de revisión: transcripción a la izquierda, campos a la derecha; al enfocar un campo se
  resalta su renglón.
- Editar, agregar o quitar campos; confirmar o rechazar el estudio.
- Catálogo de analitos por organización: lo desconocido entra como "campo nuevo".
- Al confirmar, los valores numéricos se suman al perfil del sujeto (los usa el motor de screening).
- Inicio y Laboratorios cuentan y listan estos estudios pendientes.

### Tramo B — Fotos y escaneos

- Recorte en el navegador antes de subir: del equipo sale solo la zona marcada.
- Lectura con modelo de visión sobre la imagen recortada, con la regla 4 aplicada contra la
  transcripción que el propio modelo devuelve y que la persona ve junto a la imagen.
- Pasada de modelo sobre texto para PDF que el lector de reglas interpreta mal.
- Unir sinónimos en el catálogo (Hemoglobina, Hb, HGB), siempre por decisión de una persona.

### Fuera

- Escribir en Alpha CR u otro sistema (subproyecto 10).
- Unidades convertidas, rangos por edad o sexo, alertas clínicas por valor fuera de rango.
- Códigos LOINC.

---

## 3. Diseño (tramo A)

### 3.1 Datos — migración `0012`

**`lab_analytes`** — catálogo por organización. No es dato de paciente.

| Columna | Nota |
|---|---|
| `id`, `organization_id` | |
| `name` | Como figuró impreso la primera vez |
| `normalized_key` | Minúsculas, sin acentos, espacios colapsados. Único por organización |
| `unit` | Última unidad vista, puede ser nula |
| `created_by`, `created_at` | |

**`lab_reports`** — un estudio subido para un sujeto.

| Columna | Nota |
|---|---|
| `id`, `organization_id`, `study_id`, `subject_id` | |
| `status` | `pending_review`, `confirmed` o `rejected` |
| `source_kind` | `pdf_text` (tramo A) o `image` (tramo B) |
| `content_encrypted` | JSON cifrado con `@ichtys/crypto`: nombre de archivo, transcripción, renglones no interpretados y filas |
| `row_count` | Cantidad de filas; operativo, no clínico |
| `created_by`, `created_at`, `reviewed_by`, `reviewed_at` | |

Todo valor clínico vive dentro de `content_encrypted`. Las columnas en claro son operativas.

Cada fila dentro del contenido cifrado:

```ts
type LabReportRow = {
  id: string
  analyte: string            // nombre tal cual figura
  printedValue: string       // "13,5", "7.300", "< 0,5", "Negativo"
  value: number | null       // interpretado; null si no es numérico o es ambiguo
  unit: string | null
  referenceRange: string | null   // tal cual: "12,0 - 16,0"
  sourceLine: number | null  // índice del renglón en la transcripción
  status: 'read' | 'review' | 'new_field' | 'manual'
  reviewReason: string | null
}
```

**No se guarda el archivo original.** El PDF trae nombre y documento; guardarlo cambiaría la
clasificación de datos del sistema, que hoy es pseudonimizado. Se guarda la transcripción con el
encabezado tapado. Ver §6.

### 3.2 Lectura

1. `parsePdf` (ya existe en `@ichtys/ingestion`) extrae el texto por página. Sin texto → se rechaza
   con un mensaje que explica que ese archivo es un escaneo.
2. `redactLabHeaderPii` (ya existe) tapa los renglones de encabezado.
3. Intérprete de renglones nuevo en `@ichtys/clinical` (`lab-report-parser.ts`), determinista:
   analito, valor impreso, unidad, rango. Lo que no reconoce queda en la transcripción y se cuenta
   como "renglón no interpretado", a la vista de quien revisa.
4. Interpretación del número en formato argentino: `13,5` → 13.5; `1.234,5` → 1234.5.
   **Ambiguo:** un punto seguido de exactamente tres dígitos y sin coma (`7.300`, `1.025`) puede ser
   miles o decimal. Se propone la lectura como miles y la fila queda en `review` con el motivo
   escrito. La decisión es de la persona.
5. Cada analito se busca en el catálogo por `normalized_key`. Si no está, la fila es `new_field`.

### 3.3 Rutas

Todas bajo `/api/studies/[id]/subjects/[subjectId]/lab-reports`, con `validateSubjectAccess`
(organización, estudio, sujeto y permiso de datos de sujetos) y registro en `audit_logs`.

| Ruta | Qué hace | Auditoría |
|---|---|---|
| `POST /` | Recibe el PDF (multipart, tope 10 MB, 20 páginas), lee y crea el estudio en `pending_review` | `lab.extract` |
| `GET /[reportId]` | Devuelve el estudio descifrado para revisar | `subject.view` |
| `POST /[reportId]/confirm` | Recibe las filas finales, valida, actualiza catálogo y perfil, pasa a `confirmed` | `lab.confirm` |
| `POST /[reportId]/reject` | Pasa a `rejected` | `lab.reject` |

Un estudio `confirmed` o `rejected` no se puede volver a confirmar ni rechazar (409).
La auditoría registra conteos e ids, nunca valores.

### 3.4 Pantallas

- **`/laboratorios/cargar`** — elegir estudio y sujeto, elegir el PDF, botón "Leer el estudio".
- **`/studies/[id]/subjects/[subjectId]/labs/[reportId]`** — revisión, como el boceto: transcripción
  a la izquierda; a la derecha la tabla de campos con estado (Leído, Revisar, Campo nuevo), edición
  en línea, "Agregar campo", "Rechazar estudio" y "Confirmar N valores". Confirmar queda deshabilitado
  mientras haya filas en `review` sin tocar.
- **`/laboratorios`** — suma los estudios pendientes y el botón "Cargar estudio".

### 3.5 Al confirmar

En una transacción: se guardan las filas finales, se crean en el catálogo los analitos nuevos, el
estudio pasa a `confirmed` con usuario y hora. Después, las filas con número se suman a `labs` del
perfil del sujeto con `mergeConfirmedLabs` (mismo camino que la confirmación actual).

---

## 4. Seguridad

- `organization_id` desde el token de Clerk; toda consulta filtra por organización, estudio y sujeto.
- Datos de sujetos solo para roles con `canAccessPhiData`.
- El archivo se valida con `validatePdfUpload` y los topes de `parsePdf`. No se guarda.
- Ninguna llamada a un modelo en el tramo A.
- Errores de lectura devuelven un código estable, nunca texto del documento.

---

## 5. Pruebas

| Qué | Cómo |
|---|---|
| Intérprete de renglones | Vitest con renglones sintéticos: decimales con coma, miles con punto, ambiguos, `<` y `>`, valores no numéricos, rangos con guion y con "a", renglones que no son resultados |
| Regla "sin inventar" | Toda fila propuesta cita un renglón que contiene su valor impreso |
| Encabezado | Nombre, documento y obra social no aparecen en lo que se guarda |
| Rutas | Sin sesión, otra organización, rol sin permiso, estudio ya confirmado, archivo sin texto, archivo que no es PDF |
| Catálogo | Analito nuevo se crea una vez; el mismo con otra mayúscula o acento no se duplica |
| Fuga | Las consultas nuevas entran al tripwire de organización |

Compuerta: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:leakage`, `pnpm test:oq`, `next build`.

---

## 6. Decisiones que quedan para Santiago

1. **Archivo original.** Esta versión no lo guarda. Si se quiere conservar como documento fuente,
   hay que decidir dónde, con qué acceso y actualizar la clasificación de datos y la DPIA.
2. **Lectura ambigua de miles.** Hoy se propone "miles" y se obliga a revisar. Alternativa: aprender
   por analito (leucocitos y plaquetas son miles; densidad urinaria es decimal).
3. **Trazabilidad (RTM/OQ).** Este módulo amplía el alcance del requisito URS-007; los documentos de
   validación se actualizan en el subproyecto 9.
