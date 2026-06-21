# ADR: Formal Eval Suite (Phase 10B)

**Fecha**: 2026-06-07  
**Estado**: Aceptado  
**Paquete**: `@ichtys/evals`  
**Branch**: `claude/phase-10b-formal-eval-suite`

---

## Contexto

Ichtys es un asistente clínico RAG multi-tenant. Las evaluaciones cualitativas manuales
(Phase 10A smoke test) no son reproducibles ni automatizables. Para pasar a Fase 10B se
necesita un eval suite formal que mida si:

1. Las respuestas están soportadas por evidencia del documento correcto.
2. Las citas apuntan a la sección correcta del documento.
3. El sistema declara `insufficient_evidence` cuando no hay evidencia.
4. El sistema no alucina respuestas cuando la información no existe.
5. Los resultados son reproducibles y auditables.

---

## Decisiones

### 1. Dataset separado del smoke test

**Decisión**: Mantener dos datasets con propósito diferente.

| Archivo | Propósito |
|---|---|
| `docs/evals/mock-metabolic-smoke-test-cases.json` | Manual human review: `reviewerNotes`, `passCriteria` para juicio humano |
| `packages/evals/dataset/mock-metabolic-eval-cases.json` | Runner automático: `expectedEvidenceKeywords`, `forbiddenAnswerKeywords`, flags de scoring |

**Por qué no uno solo**: el reviewer humano necesita contexto clínico (`passCriteria`),
el runner automático necesita campos de scoring (`expectedEvidenceKeywords`). Fusionar ambos
formatos produce un JSON difícil de mantener. Los 12 casos son las mismas preguntas; el
contenido es complementario, no duplicado.

### 2. Pluggable adapter — no HTTP hardcodeado en el runner

**Decisión**: El runner recibe un `AnswerAdapter = (question, studyId) => Promise<AnswerResult>`.

**Por qué**: La capa HTTP (`makeHttpAdapter`) requiere un servidor Clerk vivo y credenciales
en runtime. Los tests unitarios deben ser inmediatos y sin red. Al separar el adapter del
runner, los tests inyectan mocks sin modificar el runner.

### 3. HTTP como modo de ejecución real

**Decisión**: En producción, el adapter llama a `POST /api/rag/answer-test`.

**Por qué**: `generateAnswerForStudy()` invoca `validateStudyAccess()` que llama a `auth()`
de Clerk — requiere sesión activa de Next.js. No se puede invocar desde un CLI sin
modificar la arquitectura de auth. El endpoint `/api/rag/answer-test` (feature-flagged con
`ENABLE_INTERNAL_RAG_ANSWER_TEST=true`) expone la misma funcionalidad vía HTTP con cookies
de Clerk, lo que permite correrlo contra un servidor local o de staging.

### 4. Scoring basado en evidence.sectionTitle, no en document name

**Decisión**: `matchedExpectedSection` verifica `evidence.sectionTitle` (partial match,
case-insensitive). El campo `matchedExpectedDocument` no existe.

**Por qué**: `AnswerResult.evidences` solo expone `documentId` (UUID), no el nombre del
documento. Renombrar el campo `matchedExpectedDocument → matchedExpectedSection` es honesto
con lo que realmente se verifica. Consultar nombres de documentos requeriría una segunda
llamada al backend, lo que está fuera del scope de esta fase.

### 5. Keyword scoring es un proxy, no un oráculo

**Decisión**: `expectedEvidenceKeywords` usa matching de substring case-insensitive contra el
texto de la respuesta y los excerpts de evidencia.

**Limitaciones documentadas**:
- Variación de idioma: la respuesta en español puede usar "7,0%" (coma decimal) pero el
  keyword es "7.0". Se prefieren números sin unidad de medida ("7.0" no "7.0%").
- Sinónimos: "centrifugar" y "centrifugación" son distintos substrings; se usa el stem común
  ("centrifug") para capturar ambos.
- No verifica coherencia semántica — solo presencia de tokens.

El scoring se llama explícitamente `answer_correctness_proxy` en el código.

### 6. Snippets de respuesta limitados a 300 caracteres

**Decisión**: `CaseResult.answerSnippet = result.answer.slice(0, 300)`. El schema no valida
el largo (usar `z.string()` no `z.string().max(300)`); la truncación ocurre en `scoreCase`.

**Por qué**: Los resultados de eval se escriben a disco local (`docs/evals/results/`) que
está gitignoreado. Aun así, limitar los snippets reduce el riesgo de que un resultado con
datos sensibles se commitee accidentalmente. El flag `EVAL_SAVE_FULL_ANSWER=true` (no
implementado en esta fase) podría habilitar respuestas completas en entornos controlados.

### 7. No se impone orden de magnitud en `expectedConfidence`

**Decisión**: `expectedConfidence` es informativo. El PASS/FAIL se determina por
`shouldBeInsufficientEvidence`, no por el nivel de confianza exacto.

**Por qué**: El sistema podría responder con confianza `medium` en lugar de `high` y aun
así ser correcto. Penalizar esto produciría falsos negativos. El criterio bloqueante para
alucinación es que el sistema no devuelva `insufficient_evidence` cuando debería.

---

## Failure taxonomy

| `failureType` | Descripción | Severidad |
|---|---|---|
| `missed_insufficient_evidence` | Sistema inventó una respuesta cuando no debía | **CRÍTICO** |
| `false_insufficient_evidence` | Sistema no encontró evidencia cuando debía | Alto |
| `retrieval_miss` | Cero chunks recuperados cuando se esperaban ≥1 | Alto |
| `answer_unsupported` | Keywords esperados ausentes del answer y excerpts | Medio |
| `wrong_section` | `sectionTitle` no coincide con el esperado | Medio |
| `forbidden_keywords_found` | Respuesta contiene keywords de alucinación | **CRÍTICO** |
| `runtime_error` | Fallo HTTP o de parsing | Operacional |
| `test_setup_error` | Config inválida, caso mal definido | Setup |

---

## Variables de entorno del runner

| Variable | Descripción | Obligatoria |
|---|---|---|
| `EVAL_STUDY_ID` | UUID del study mock cargado en el sistema | Sí |
| `EVAL_BASE_URL` | Base URL del servidor (default: `http://localhost:3000`) | No |
| `EVAL_AUTH_COOKIE` | Cookie de sesión Clerk del browser | Sí |
| `EVAL_OUTPUT_DIR` | Directorio de salida para JSON/CSV (default: `docs/evals/results`) | No |
| `ENABLE_INTERNAL_RAG_ANSWER_TEST` | Debe ser `true` en el servidor | (servidor) |
| `RATE_LIMIT_ENABLED` | Poner en `false` durante evals para evitar throttling | No |

---

## Comando de ejecución

```bash
# En terminal 1: dev server con env vars
ENABLE_INTERNAL_RAG_ANSWER_TEST=true RATE_LIMIT_ENABLED=false pnpm dev

# En terminal 2: runner
EVAL_STUDY_ID=<uuid> \
EVAL_AUTH_COOKIE="<cookie from browser>" \
EVAL_BASE_URL=http://localhost:3000 \
pnpm evals:mock-metabolic
```

Resultados en `docs/evals/results/eval-results-<runId>.{json,csv}`.
