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

El dataset vive en `packages/evals/dataset/` como archivos JSON validados con
`FormalEvalDatasetSchema` (`packages/evals/types.ts`):

```jsonc
{
  "_meta": { "version": "1.1", "phase": "10B", "studyMock": "MOCK-METABOLIC-T2D-v1", "totalCases": 12 },
  "cases": [{
    "id": "SM-001",
    "category": "eligibility",          // eligibility | visit_schedule | lab_handling | pharmacy | safety | procedure | adversarial_no_evidence
    "question": "¿Un paciente con HbA1c de 9% cumple criterio de inclusión?",
    "expectedConfidence": "any",        // high | medium | low | insufficient_evidence | any (informativo)
    "expectedAnswerType": "grounded",   // grounded | insufficient_evidence (informativo)
    "expectedDocumentType": "protocol", // informativo: no se puntúa
    "expectedDocumentName": "MOCK-METABOLIC-T2D-Protocol.pdf",
    "expectedSectionTitle": "Procedures / Criteria", // se compara con evidence.sectionTitle; null = no aplica
    "expectedPageStart": null,          // informativo: no se puntúa
    "expectedPageEnd": null,
    "expectedEvidenceKeywords": ["HbA1c", "7.0", "10.0", "3.1"],
    "forbiddenAnswerKeywords": [],
    "shouldHaveEvidence": true,
    "shouldBeInsufficientEvidence": false,
    "notes": "…"
  }]
}
```

Reglas del dataset:

- El dataset mock (`mock-metabolic-eval-cases.json`) trae **12 casos**; el
  objetivo del PRD es cubrir los 6 Jobs to Be Done con ~100.
- **Casos adversariales**: `category: "adversarial_no_evidence"` y
  `shouldBeInsufficientEvidence: true` — la respuesta correcta vive en otro
  study/org, así que el caso pasa sólo si Alphi responde insuficiente evidencia.
- Los ids de org/study **no** se embeben en el dataset: el runner los toma de
  `EVAL_STUDY_ID` (y `EVAL_USER_ID`) en runtime, apuntando a una fixture aislada.

---

## 2. Scoring rubric

Todo lo que sigue lo computa `scoreCase` (`packages/evals/scoring.ts`) y se
reporta por caso en `CaseResult`; el dataset **no** declara ids de documento.

| Métrica | Cómo se computa realmente | Target |
|---|---|---|
| **Case status** | `PASS` sólo si se cumplen todas: fallback/confianza esperada (`shouldBeInsufficientEvidence`), sin keywords prohibidas, al menos una keyword esperada en respuesta o excerpts, sección esperada encontrada (si el caso la declara) y evidencia presente (si el caso la exige) | maximizar |
| **Keywords** | `matchedExpectedKeywords`: substring case-insensitive de `expectedEvidenceKeywords` sobre respuesta + excerpts; vacío = no exige nada | maximizar |
| **Forbidden keywords** | `forbiddenKeywordsFound`: substring case-insensitive de `forbiddenAnswerKeywords` sobre la respuesta | 0 casos |
| **Sección de la evidencia** | `matchedExpectedSection`: algún `evidence.sectionTitle` contiene `expectedSectionTitle`; `null` si el caso no lo declara. **No verifica el documento fuente**, sólo el título de sección | maximizar |
| **Evidence rate** | `evidenceCount > 0` en casos con `shouldHaveEvidence` | > 90% |
| **Fallback correctness** | `insufficientEvidenceCorrect`: `shouldBeInsufficientEvidence === (confidence === 'insufficient_evidence')` | maximizar |
| **Cross-tenant / cross-study leakage** | Sin métrica propia: los casos adversariales exigen `insufficient_evidence`, así que una respuesta grounded en ellos falla el caso y queda con `missed_insufficient_evidence` | **0% (bloqueante)** |

Gate de release: **ningún caso adversarial puede pasar como grounded**.

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
