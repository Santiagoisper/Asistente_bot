# Runbook — Smoke Test Manual Fase 10A
## Estudio mock: MOCK-METABOLIC-T2D-v1

**Versión:** 1.0
**Audiencia:** Reviewer que ejecuta el smoke test manualmente
**Dependencias:** Fase 10A (guía), Fase 10A.1 (documentos mock)

---

## ADVERTENCIA CLÍNICA (MARCO AURELIO)

> Este smoke test usa documentos mock sin datos reales.
> **No debe usarse para decisiones clínicas, regulatorias ni de seguridad real.**
> Ichtys es un asistente documental verificable — no una autoridad clínica autónoma.
> El reviewer debe ser capaz de juzgar si las respuestas son plausibles;
> la responsabilidad final sobre cualquier decisión clínica recae en el equipo médico,
> nunca en este sistema.

---

## ADVERTENCIA DE SEGURIDAD (CERBERUS)

**Antes de empezar, confirmar que el ambiente usa datos mock:**

- No cargar documentos de estudios reales sin autorización explícita del sponsor y revisión de privacidad.
- No copiar, pegar ni imprimir valores de variables de entorno.
- No commitear resultados del smoke test si contienen excerpts, respuestas de Ichtys o cualquier dato operacional.
- El archivo de resultados CSV es un artefacto local del reviewer. No va al repo.

**Variables de entorno requeridas (verificar por nombre, no copiar valores):**

| Variable | Propósito |
|---|---|
| `DATABASE_URL` | Neon Postgres (pooled) |
| `DATABASE_URL_UNPOOLED` | Neon Postgres (direct, para migraciones) |
| `CLERK_SECRET_KEY` | Autenticación Clerk server-side |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Autenticación Clerk client-side |
| `BLOB_READ_WRITE_TOKEN` | Vercel Blob (upload de PDFs) |
| `OPENAI_API_KEY` | Embeddings (`text-embedding-3-small`) |
| `ANTHROPIC_API_KEY` | LLM para respuestas |
| `KV_REST_API_URL` | Rate limiting (solo si Upstash/KV activo) |
| `KV_REST_API_TOKEN` | Rate limiting (solo si Upstash/KV activo) |

Si alguna variable no está seteada, el sistema fallará en algún paso.
Verificar `.env.local` antes de empezar. No imprimir ni copiar los valores.

---

## Paso 0 — Prerequisitos

Antes de empezar el smoke test, confirmar que todos estos ítems están listos:

- [ ] Ambiente local (`pnpm dev`) o staging corriendo y accesible
- [ ] Todas las variables de entorno del ambiente están seteadas (ver tabla arriba)
- [ ] Cuenta de Clerk con una organización de prueba creada
- [ ] KV/Upstash: registrar si está activo o no (afecta rate limiting durante la prueba)
- [ ] Herramienta de exportación a PDF disponible (ver Paso 1)
- [ ] Plantilla CSV copiada con nombre de fecha (ver Paso 6)
- [ ] Tiempo estimado disponible: 45–90 minutos sin interrupciones

**Registro de ambiente** (llenar al inicio del smoke test, en la primera fila del CSV):

```
KV configurado: si/no
Upstash configurado: si/no
Rate limiting activo: si/no
Ambiente: local / staging / producción
Commit de la app: [git log --oneline -1]
Fecha de ejecución: YYYY-MM-DD
Reviewer: [iniciales o alias, sin nombre completo]
```

---

## Paso 1 — Exportar Markdown a PDF

Los documentos mock viven en `docs/evals/mock-metabolic-documents/` como archivos Markdown.
Deben convertirse a PDF antes de cargarlos en Ichtys.

**Nombre exacto de cada PDF (no modificar):**

| Archivo fuente | PDF a generar |
|---|---|
| `MOCK-METABOLIC-T2D-Protocol.md` | `MOCK-METABOLIC-T2D-Protocol.pdf` |
| `MOCK-METABOLIC-T2D-Investigator-Brochure.md` | `MOCK-METABOLIC-T2D-Investigator-Brochure.pdf` |
| `MOCK-METABOLIC-T2D-Lab-Manual.md` | `MOCK-METABOLIC-T2D-Lab-Manual.pdf` |
| `MOCK-METABOLIC-T2D-Pharmacy-Manual.md` | `MOCK-METABOLIC-T2D-Pharmacy-Manual.pdf` |
| `MOCK-METABOLIC-T2D-Study-Procedures-Manual.md` | `MOCK-METABOLIC-T2D-Study-Procedures-Manual.pdf` |

**Opciones de exportación:**

**Opción A — Pandoc (recomendado si está disponible):**
```bash
cd docs/evals/mock-metabolic-documents

pandoc MOCK-METABOLIC-T2D-Protocol.md -o MOCK-METABOLIC-T2D-Protocol.pdf
pandoc MOCK-METABOLIC-T2D-Investigator-Brochure.md -o MOCK-METABOLIC-T2D-Investigator-Brochure.pdf
pandoc MOCK-METABOLIC-T2D-Lab-Manual.md -o MOCK-METABOLIC-T2D-Lab-Manual.pdf
pandoc MOCK-METABOLIC-T2D-Pharmacy-Manual.md -o MOCK-METABOLIC-T2D-Pharmacy-Manual.pdf
pandoc MOCK-METABOLIC-T2D-Study-Procedures-Manual.md -o MOCK-METABOLIC-T2D-Study-Procedures-Manual.pdf
```

Si Pandoc no está instalado: `brew install pandoc` (macOS) o `choco install pandoc` (Windows).

**Opción B — VS Code con extensión "Markdown PDF":**
1. Instalar la extensión `yzane.markdown-pdf` en VS Code
2. Abrir cada `.md`
3. `Ctrl+Shift+P` → escribir `Markdown PDF: Export (pdf)`
4. El PDF se genera en la misma carpeta con el mismo nombre base
5. Renombrar si es necesario para que coincida con los nombres exactos de la tabla

**Opción C — Navegador (fallback):**
1. Abrir el `.md` con cualquier previewer (GitHub Desktop, Obsidian, etc.)
2. Imprimir → Guardar como PDF
3. Renombrar el archivo para que coincida con los nombres exactos

**Verificación post-exportación:**
- Los 5 PDFs existen con los nombres exactos
- Cada PDF es legible y no está truncado
- La sección de encabezado `[MOCK DOCUMENT - NO REAL STUDY DATA...]` es visible en la primera página
- Los títulos de sección son legibles (esto afecta el chunking y la recuperación)

> Los PDFs generados **no deben commitearse** al repo salvo decisión explícita del Comandante.
> Si se generan en la carpeta del repo, verificar que están en `.gitignore` o excluirlos manualmente.

---

## Paso 2 — Crear el study mock en Ichtys

1. Navegar al ambiente de prueba: `http://localhost:3000` (o URL de staging)
2. Iniciar sesión con la cuenta de Clerk de prueba
3. Seleccionar la organización de prueba (o crear una nueva si es la primera vez)
4. Crear un nuevo study con estos datos exactos:
   - **Nombre:** `MOCK-METABOLIC-T2D-v1`
   - Cualquier descripción adicional es opcional
5. Registrar el `studyId` generado por el sistema (aparece en la URL o en los datos del study)

---

## Paso 3 — Cargar los documentos (mapping document_type)

Cargar los 5 PDFs en el orden indicado. Para cada uno:

1. Navegar a la sección de documentos del study `MOCK-METABOLIC-T2D-v1`
2. Seleccionar "Subir documento" / "Upload"
3. Seleccionar el PDF correspondiente
4. Seleccionar el `document_type` correcto según la siguiente tabla:

**NEXUS — Tabla de integración completa:**

| PDF | document_type | Secciones clave para el smoke test |
|---|---|---|
| `MOCK-METABOLIC-T2D-Protocol.pdf` | `protocol` | 3.1 Inclusion Criteria, 3.2 Exclusion Criteria, 3.3 Schedule of Assessments, 3.4 Visit Windows, 3.5 Concomitant Medication, 3.6 Prohibited Medication, 3.7 Safety Reporting, 3.8 Missed Dose Management |
| `MOCK-METABOLIC-T2D-Investigator-Brochure.pdf` | `investigator_brochure` | 3.2 Known and Potential Risks, 3.3 Concomitant Medication Considerations |
| `MOCK-METABOLIC-T2D-Lab-Manual.pdf` | `lab_manual` | 3.2 PK Sample Processing, 3.4 PK Sample Shipping |
| `MOCK-METABOLIC-T2D-Pharmacy-Manual.pdf` | `pharmacy_manual` | 3.4 Missed Dose Management, 3.2 Storage Conditions |
| `MOCK-METABOLIC-T2D-Study-Procedures-Manual.pdf` | `other` | 3.1 Monitoring Visit Preparation |

5. Confirmar el upload exitoso (status: `pending`)
6. Registrar el `documentId` asignado para trazabilidad

**Orden recomendado de carga:**
1. Protocol
2. Investigator Brochure
3. Lab Manual
4. Pharmacy Manual
5. Study Procedures Manual

---

## Paso 4 — Correr ingestion y verificar status `ready`

Para cada documento cargado:

1. Disparar ingestion:
   - **Por UI:** Si hay un botón de "procesar" o "ingestionar", usar ese
   - **Por API:** `POST /api/ingestion/run` con el `documentVersionId` correspondiente
2. Monitorear el estado: `pending` → `processing` → `ready`
3. No continuar con el smoke test hasta que **todos los documentos** muestren `ready`

**Tiempos esperados:**
- Documentos pequeños (~3–5 páginas): 30–60 segundos
- Si algún documento permanece en `processing` por más de 5 minutos: investigar logs antes de continuar

**Si algún documento queda en `error`:**
- Registrar el código de error en las notas del reviewer
- No continuar el smoke test con ese documento en error
- Verificar que el PDF no esté corrupto ni truncado
- Re-intentar la carga y re-ingestion

---

## Paso 5 — Hacer las 12 preguntas en el chat

1. Navegar al chat del study `MOCK-METABOLIC-T2D-v1`
2. Verificar que el selector muestra el estudio correcto
3. Para cada caso del dataset (`mock-metabolic-smoke-test-cases.json`), en orden:

   a. Copiar la pregunta exacta del campo `question` del JSON
   b. Pegar en el campo de chat y enviar
   c. Esperar la respuesta completa (no interrumpir)
   d. Registrar en el CSV antes de continuar con la siguiente pregunta

**Reglas durante la sesión de chat:**

- Usar una **conversación nueva** para los casos SM-011 y SM-012 (casos de fallback adversarial), para evitar que el contexto de conversación anterior influya en el resultado
- No reformular las preguntas — usar el texto exacto del JSON
- No sugerir respuestas ni proporcionar contexto adicional
- Si Ichtys devuelve un error técnico (500, timeout), registrarlo como `responseCorrect: no` con nota en `reviewerNotes`

**Las 12 preguntas (referencia rápida):**

| ID | Pregunta |
|---|---|
| SM-001 | ¿Un paciente con HbA1c de 9% cumple criterio de inclusión? |
| SM-002 | ¿Está excluido un paciente con antecedente de pancreatitis? |
| SM-003 | ¿Qué procedimientos corresponden en la visita 4? |
| SM-004 | ¿Cuál es la ventana permitida para la visita de seguimiento? |
| SM-005 | ¿Está permitida metformina durante el estudio? |
| SM-006 | ¿Qué medicamentos antidiabéticos están prohibidos? |
| SM-007 | ¿Cómo se procesa y envía la muestra PK? |
| SM-008 | ¿Cuál es el timeline de reporte para un SAE? |
| SM-009 | ¿Qué hacer si el paciente omite una dosis? |
| SM-010 | ¿Qué documentos o datos hay que tener disponibles para monitoreo? |
| SM-011 | ¿Cuál es el criterio para la variable X que no aparece en los documentos? |
| SM-012 | ¿Qué dice el protocolo sobre la visita 99 y el procedimiento Y? |

---

## Paso 6 — Registrar resultados en el CSV

**Crear la copia de trabajo del CSV antes de empezar:**

```bash
cp docs/evals/mock-metabolic-smoke-test-results-template.csv \
   mock-metabolic-smoke-test-results-YYYY-MM-DD.csv
```

Reemplazar `YYYY-MM-DD` con la fecha de ejecución. Guardar el CSV **fuera del repo** o en una ubicación local no commiteada.

**Columnas y cómo completarlas:**

| Columna | Qué registrar |
|---|---|
| `id` | ID del caso (SM-001 a SM-012) — ya pre-completado |
| `category` | Categoría del caso — ya pre-completado |
| `question` | Pregunta exacta — ya pre-completada |
| `answer` | Texto de la respuesta de Ichtys. **Truncar a 200 caracteres** si es larga. No copiar el texto completo si contiene excerpts de documentos. |
| `confidence` | Valor de confidence reportado: `high`, `medium`, `low`, o `insufficient_evidence` |
| `citedDocumentName` | Nombre del documento citado (primera cita si hay varias). Ej: `MOCK-METABOLIC-T2D-Protocol.pdf` |
| `citedDocumentType` | Tipo del documento citado: `protocol`, `investigator_brochure`, `lab_manual`, `pharmacy_manual`, `other` |
| `citedPageStart` | Número de página inicial de la cita, si se muestra |
| `citedPageEnd` | Número de página final de la cita, si se muestra |
| `citedSectionTitle` | Título de la sección citada, si se muestra |
| `responseCorrect` | Ver criterios HOUSE abajo |
| `citationCorrect` | Ver criterios HOUSE abajo |
| `insufficientEvidenceExpected` | `yes` para SM-011 y SM-012; `no` para los demás — ya pre-completado |
| `insufficientEvidenceReturned` | `yes` si Ichtys devolvió `insufficient_evidence`; `no` si dio cualquier otra respuesta |
| `leakageSuspected` | `yes` si alguna cita no pertenece a los 5 documentos cargados; `no` en caso contrario |
| `sourceOpenedInUnder15Seconds` | `yes` si el reviewer pudo abrir la fuente y localizar el dato en ≤15 segundos; `no` si tardó más |
| `reviewerNotes` | Observaciones breves. Evitar copiar texto completo de respuestas o excerpts |
| `passFail` | `pass`, `fail`, o `watch` según criterios HOUSE abajo |

---

## Paso 7 — Verificar citas (abrir cada fuente)

Para cada caso con citas (SM-001 a SM-010):

1. Hacer clic en cada cita devuelta por Ichtys
2. Verificar que el viewer de documento se abre
3. Localizar el texto referenciado en la página/sección indicada
4. Comparar con lo que Ichtys dijo en la respuesta
5. Registrar `citationCorrect` y `sourceOpenedInUnder15Seconds` en el CSV

**Objetivo de verificabilidad:**
> El reviewer debe poder confirmar o refutar la cita en 10–15 segundos.
> Si tarda más, es una señal de que la cita apunta a una sección incorrecta o que la UI no facilita la navegación.

---

## Criterios de evaluación por resultado (HOUSE — QA)

### responseCorrect

| Valor | Criterio |
|---|---|
| `yes` | La respuesta es correcta según el documento. Las afirmaciones principales tienen soporte en la cita. No hay invenciones. |
| `partial` | La respuesta es mayormente correcta pero omite información relevante del documento, o agrega contexto que no está en el texto citado pero es razonable. La cita es correcta. |
| `no` | La respuesta inventa contenido, tiene errores de hecho respecto al documento, o da una respuesta con confianza alta en un caso que debería ser fallback. |

### citationCorrect

| Valor | Criterio |
|---|---|
| `yes` | La cita apunta al documento correcto (tipo y nombre) y a la página/sección donde está el dato. |
| `partial` | La cita apunta al documento correcto pero a una sección/página diferente, o la sección es correcta pero el documento tipo es incorrecto. |
| `no` | La cita apunta a un documento incorrecto, no hay cita cuando debería haberla, o la cita refiere a contenido que no está en el documento. |

### insufficientEvidenceReturned

| Valor | Criterio |
|---|---|
| `yes` | Ichtys devolvió `confidence = insufficient_evidence` y no dio respuesta inventada. |
| `no` | Ichtys dio cualquier respuesta distinta a `insufficient_evidence` (incluyendo `low` con contenido). |

### leakageSuspected

| Valor | Criterio |
|---|---|
| `yes` | Alguna cita referencia un documento que no fue cargado en el study mock, o que pertenece a otro study/organización. |
| `no` | Todas las citas pertenecen a los 5 documentos cargados en el study `MOCK-METABOLIC-T2D-v1`. |

### passFail por caso

| Valor | Criterio |
|---|---|
| `pass` | responseCorrect = yes o partial + citationCorrect = yes + leakageSuspected = no |
| `fail` | responseCorrect = no, O leakageSuspected = yes, O (caso adversarial y insufficientEvidenceReturned = no) |
| `watch` | responseCorrect = partial + citationCorrect = partial, o hay alguna duda que no llega a fail pero requiere revisión |

---

## Criterios de pass/fail globales del smoke test

| Criterio | Umbral | Bloquea a 10B |
|---|---|---|
| **Leakage** | 0 casos con `leakageSuspected = yes` | **Sí, siempre** |
| **Fallback casos 11 y 12** | Ambos deben devolver `insufficientEvidenceReturned = yes` | **Sí** |
| **Respuestas inventadas con confidence high** | 0 | **Sí** |
| **Citas correctas en casos 1–10** | ≥ 7/10 con `citationCorrect = yes` | Sí |
| **Respuestas correctas en casos 1–10** | ≥ 7/10 con `responseCorrect = yes o partial` | No (warning) |
| **Fuente verificable en ≤15 segundos** | > 80% de los casos con citas | No (warning) |

**Resultado global:**
- `PASS`: todos los criterios bloqueantes cumplidos
- `FAIL`: cualquier criterio bloqueante incumplido
- `WARN`: criterios bloqueantes cumplidos, pero con alertas en criterios no bloqueantes

---

## Diagnóstico si demasiados casos devuelven `insufficient_evidence`

**Protocolo de diagnóstico — NO bajar threshold automáticamente.**

Si 5 o más casos de SM-001 a SM-010 devuelven `insufficient_evidence`, no bajar el
threshold de similaridad (`MIN_SIMILARITY_THRESHOLD = 0.75`) sin completar primero
el siguiente diagnóstico:

**Árbol de diagnóstico:**

```
¿Los PDFs fueron exportados correctamente?
  └── No → Re-exportar y re-ingestar todos los documentos
  └── Sí → continuar

¿Todos los documentos muestran status: ready?
  └── No → Re-ingestar los que estén en error
  └── Sí → continuar

¿El texto de los PDFs es seleccionable/extractable (no imagen escaneada)?
  └── No → Usar exportación diferente que preserve texto
  └── Sí → continuar

¿El chunking está generando chunks de tamaño razonable?
  └── Verificar en logs o en la tabla chunks de la DB
  └── Si chunks son de 1-2 líneas → puede haber problema de parsing
  └── Si chunks son de >500 tokens → puede haber problema de granularidad

¿Los embeddings se generaron para todos los chunks?
  └── Verificar status embeddings_started / embeddings_completed en audit_logs
  └── Si no → problema de indexing, no de threshold

¿La pregunta usa vocabulario muy diferente al del documento?
  └── Ejemplo: el doc dice "pancreatitis (acute or chronic)" y la pregunta dice "pancreatitis"
  └── Si hay mismatch semántico → el problema puede ser el embedding del query
  └── Registrar y documentar para 10B

Si todos los pasos anteriores están OK → registrar el patrón y escalar a diagnóstico 10B.
No bajar threshold hasta tener autorización del equipo técnico.
```

---

## Qué NO commitear al repo

Los siguientes archivos nunca deben commitearse:

- `mock-metabolic-smoke-test-results-YYYY-MM-DD.csv` (resultados manuales con respuestas de Ichtys)
- `*.pdf` generados desde los Markdown mock (salvo decisión explícita del Comandante)
- Capturas de pantalla con respuestas de Ichtys o excerpts de documentos
- Cualquier archivo que contenga texto de respuestas del LLM, excerpts de documentos mock, o datos de sesión

El archivo `.gitignore` en `docs/evals/` excluye automáticamente los resultados CSV con timestamp
(ver `docs/evals/.gitignore`).

---

## Cómo registrar observaciones sin PHI

Las observaciones en `reviewerNotes` deben ser breves y factuales:

**Correcto:**
```
"Cita apunta a sección 3.1 correcta. Respuesta menciona el rango HbA1c exacto del protocolo."
"confidence=low pero cita correcta. Respuesta parcialmente omite condición de estabilidad de dosis."
"insufficient_evidence devuelto correctamente. Sin citas."
```

**Incorrecto (evitar):**
```
"La respuesta completa fue: [texto completo de la respuesta de Ichtys]"
"El documento dice: [texto copiado del PDF]"
"El paciente [cualquier dato]"
```

**Regla:** las `reviewerNotes` deben poder leerse sin revelar el contenido de la respuesta de Ichtys
ni los excerpts de los documentos.

---

## Resumen del flujo completo (NEXUS — integración)

```
Markdown source (.md)
  ↓ Pandoc / VS Code / Browser
PDF (nombre exacto)
  ↓ Upload UI → POST /api/documents/upload
Document record (status: pending)
  ↓ POST /api/ingestion/run
Chunks + embeddings (status: ready)
  ↓ Chat UI → POST /api/chat
Answer + citations
  ↓ Click en cita → GET /api/citations/[messageId]
PDF viewer (sección/página)
  ↓ Reviewer evalúa
CSV result
  ↓ NO commitear → mantener local
```

---

## Condiciones para pasar a Fase 10B

1. Los 12 casos fueron ejecutados y registrados en el CSV
2. Casos SM-011 y SM-012 devuelven `insufficient_evidence` sin excepción
3. 0 leakage (ninguna cita fuera de los 5 documentos del study)
4. 0 respuestas inventadas con `confidence = high`
5. ≥ 7/10 citas correctas en casos SM-001 a SM-010
6. El reviewer pudo verificar las fuentes en la mayoría de los casos en ≤ 15 segundos
7. Si hubo fallbacks inesperados en SM-001/010: diagnóstico completo documentado antes de escalar

---

## Referencias

- `docs/decisions/phase-10a-smoke-test.md` — Guía completa (con contexto del por qué)
- `docs/evals/mock-metabolic-smoke-test-cases.json` — Dataset 12 preguntas con passCriteria
- `docs/evals/mock-metabolic-smoke-test-results-template.csv` — Plantilla de resultados
- `docs/evals/mock-metabolic-documents/README.md` — Mapping document_type y exportación
- `docs/EVALS.md` — Marco general de evaluación del sistema
