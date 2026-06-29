# EVALS — Ichtys

Cómo medimos la calidad del RAG. El paquete `@ichtys/evals` implementa el
runner (`runner.ts`) y las métricas (`metrics.ts`); este documento define el
formato del dataset, la rúbrica de scoring y los targets de latencia.

> Estado: **Fase 10B activa**. El eval runner automatizado está implementado con
> dataset formal de 12 casos mock metabólicos. Ver `docs/decisions/formal-eval-suite.md`
> para arquitectura, variables de entorno y comando de ejecución.

---

## Por qué

En un asistente clínico, "responde algo plausible" no alcanza. Una respuesta
incorrecta con apariencia de certeza es peor que ninguna. Medimos grounding,
corrección de citas, aislamiento (leakage) y latencia.

---

## 1. Dataset format

El dataset vive en `packages/evals/dataset/` como archivos JSON. Cada caso
sigue el tipo `EvalCase` (`packages/evals/metrics.ts`):

```jsonc
{
  "id": "elig-hba1c-001",
  "organizationId": "<uuid org de fixture>",
  "studyId": "<uuid study de fixture>",
  "question": "¿Un paciente con HbA1c 9.2% cumple el criterio de inclusión?",

  // Esperado (uno u otro, según el caso):
  "expectedAnswer": "Sí; el protocolo exige HbA1c ≥ 7.0% y ≤ 10.5%.",
  "expectedDocumentIds": ["<uuid documento protocolo>"],
  "expectInsufficientEvidence": false,

  // Metadata para slicing de métricas:
  "jtbd": "eligibility",          // eligibility | pre_visit | conmeds | labs | safety | monitoring
  "adversarial": false            // true para casos de leakage cross-tenant/cross-study
}
```

Reglas del dataset:

- **~100 casos** cubriendo los 6 Jobs to Be Done (PRD §4).
- **Casos adversariales de leakage**: la respuesta correcta vive en otro
  study/org, por lo que el resultado correcto es `insufficient_evidence`
  (`expectInsufficientEvidence: true`, `adversarial: true`).
- IDs de org/study provienen de **fixtures aisladas**, nunca hardcodeados sin
  aislamiento (CLAUDE.md).

---

## 2. Scoring rubric

| Métrica | Definición | Cómo se computa | Target |
|---|---|---|---|
| **Groundedness** | Cada afirmación de la respuesta se apoya en una cita recuperada | LLM-judge sobre (respuesta, citas) → soportada / no soportada; fallback correcto cuenta como grounded | maximizar |
| **Citation correctness** | Las citas apuntan a la fuente esperada | `|citas ∩ expectedDocumentIds| / |expectedDocumentIds|` por caso, promediado | > 90% |
| **Cited answer rate** | Respuestas no-fallback con ≥1 cita | proporción de casos con citas no vacías | > 90% |
| **Cross-tenant leakage rate** | Evidencia de otra organización | casos adversariales donde aparece un chunk de otra org | **0% (bloqueante)** |
| **Cross-study leakage rate** | Evidencia de otro estudio | casos adversariales donde aparece un chunk de otro study | **0% (bloqueante)** |
| **Fallback correctness** | El fallback dispara cuando (y solo cuando) corresponde | `expectInsufficientEvidence === (confidence==='insufficient_evidence')` | maximizar |

Escala por caso: cada métrica produce 0..1; se agregan a tasas globales
(`AggregateMetrics`). Gate de release: **leakage = 0%**.

---

## 3. Latency targets

Alineado con los NFR del PRD (§8). Medidos end-to-end sobre `/api/chat`.

| Métrica | Target |
|---|---|
| Respuesta P50 | < 2.5 s |
| Respuesta P90 | < 4 s (NFR) |
| Retrieval (embed + pgvector search) P90 | < 800 ms |
| Time-to-first-token (streaming) P90 | < 1.5 s |

Mitigaciones de latencia (ARCHITECTURE.md): índice IVFFlat, top-k limitado (8),
streaming de la respuesta vía Vercel AI SDK.

---

## 4. Comandos

```bash
pnpm evals:run              # dataset completo (requiere servidor + env vars)
pnpm evals:quick            # subset de 5 casos (smoke rápido)
pnpm evals:mock-metabolic   # alias — mismo que evals:run
```

El runner sale con código ≠ 0 si hay FAILs o ERRORs. Resultados en `docs/evals/results/`.

Variables de entorno requeridas:
```bash
EVAL_STUDY_ID=<uuid del study cargado>
EVAL_AUTH_COOKIE=<cookie de sesión Clerk>
EVAL_BASE_URL=http://localhost:3000  # o URL de staging
ENABLE_INTERNAL_RAG_ANSWER_TEST=true  # en el servidor
RATE_LIMIT_ENABLED=false              # en el servidor, para evitar throttling
```

Ver `docs/decisions/formal-eval-suite.md` para el diseño completo.

---

## 5. Fase 10B — Eval runner automatizado

El runner automatizado vive en `packages/evals/`. Arquitectura:

- **`types.ts`** — Zod schemas para `FormalEvalCase`, `CaseResult`, `EvalSuiteResult`
- **`scoring.ts`** — Funciones de scoring puras (sin I/O, completamente testeables)
- **`metrics.ts`** — Aggregation y re-exports; mantiene API legada de Phase 10A
- **`runner.ts`** — Runner con `AnswerAdapter` pluggable (HTTP en prod, mock en tests)
- **`dataset/mock-metabolic-eval-cases.json`** — 12 casos formalizados

**Datasets y sus propósitos:**

| Archivo | Propósito |
|---|---|
| `docs/evals/mock-metabolic-smoke-test-cases.json` | Manual: `reviewerNotes`, `passCriteria` para review humano |
| `packages/evals/dataset/mock-metabolic-eval-cases.json` | Automático: keywords, flags de scoring |

**Failure types** (de más a menos crítico):
- `missed_insufficient_evidence` — sistema inventó respuesta cuando no debía (alucinación crítica)
- `forbidden_keywords_found` — respuesta contiene markers de alucinación
- `false_insufficient_evidence` — sistema no encontró evidencia cuando debía
- `retrieval_miss` — cero chunks recuperados cuando se esperaban ≥1
- `answer_unsupported` — keywords esperados ausentes
- `wrong_section` — sectionTitle no coincide
- `runtime_error` / `test_setup_error`

---

## 6. Fase 10A — Smoke test manual

Antes del eval runner automatizado, se ejecuta un smoke test manual estructurado
con un estudio mock metabólico (diabetes tipo 2). Este smoke test verifica que
Ichtys funciona correctamente de extremo a extremo con evidencia verificable.

**Archivos de Fase 10A / 10A.1:**

| Archivo | Descripción |
|---|---|
| `docs/decisions/phase-10a-smoke-test.md` | Guía completa de ejecución manual |
| `docs/evals/mock-metabolic-smoke-test-cases.json` | Dataset de 12 preguntas con criterios de evaluación (v1.1) |
| `docs/evals/mock-metabolic-smoke-test-results-template.csv` | Plantilla para registrar resultados |
| `docs/evals/mock-metabolic-documents/` | Documentos mock listos para cargar en Ichtys |
| `docs/evals/mock-metabolic-documents/README.md` | Instrucciones de uso, mapping de tipos y carga |
| `docs/evals/mock-metabolic-smoke-test-runbook.md` | Runbook ejecutable: PDF export → upload → ingestion → chat → CSV |
| `docs/evals/.gitignore` | Excluye resultados CSV con timestamp y PDFs generados |

**Criterios bloqueantes para pasar a 10B:**
- 0 leakage cross-tenant y cross-study
- Casos 11 y 12 devuelven `insufficient_evidence`
- 0 respuestas inventadas con confianza `high` o `medium`
- ≥7/10 citas correctas en casos 1–10

**Política de datos:** nunca commitear resultados con datos de estudios reales,
excerpts bajo NDA, ni información de pacientes. El CSV de resultados es un
artefacto local del reviewer.

---

## 6. Codificación clínica (SNOMED-CT / LOINC)

Cuando el usuario pide el código de terminología de un concepto, el RAG puro
respondía `insufficient_evidence` (el protocolo no contiene códigos). El camino
híbrido de terminología (ver `terminology-answer.ts` y `terminology-intent.ts`)
compone dos bloques: lo que dice el protocolo + una codificación **sugerida**,
marcada explícitamente como externa al documento.

Casos de referencia (verificar en el chat, ruta `/api/chat/stream`):

| # | Pregunta | Comportamiento esperado |
|---|----------|--------------------------|
| T-01 | "diabetes tipo 1, ¿no tenés referencia en SNOMED-CT?" | Confianza ≠ `insufficient_evidence`; tarjeta con `SNOMED-CT 46635009` marcada "Sugerencia externa" + disclaimer |
| T-02 | "¿Lo podés asociar ahora a un código de SNOMED-CT?" | Igual que T-01; reusa el concepto de la conversación si el protocolo lo menciona |
| T-03 | "¿Cuál es el código SNOMED de la insuficiencia renal crónica?" | Sugiere `709044004` con disclaimer; cita el protocolo si lo menciona |
| T-04 | "¿Qué código LOINC corresponde a HbA1c?" | Sugiere el código LOINC del diccionario; disclaimer presente |
| T-05 | "¿Cuál es el código SNOMED de <biomarcador inexistente>?" | `insufficient_evidence` con mensaje específico (ni protocolo ni diccionario) |

Invariantes (cubiertos por unit tests):
- El código siempre se presenta como sugerencia externa, nunca como contenido del protocolo.
- La confianza nunca es `high` para una sugerencia de terminología (máximo `medium`).
- El disclaimer acompaña siempre a los códigos.

Tests: `packages/rag/__tests__/terminology-answer.test.ts`,
`apps/web/lib/rag/__tests__/terminology-intent.test.ts`.

---

## 7. Relación con tests unitarios

- `pnpm test:leakage` → tests deterministas de aislamiento (DB/retriever).
- `pnpm evals:run` → evaluación end-to-end del answer engine sobre el dataset.

Ambos son complementarios; ambos bloquean release si fallan en aislamiento.
