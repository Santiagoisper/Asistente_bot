# EVALS — Ichtys

Cómo medimos la calidad del RAG. El paquete `@ichtys/evals` implementa el
runner (`runner.ts`) y las métricas (`metrics.ts`); este documento define el
formato del dataset, la rúbrica de scoring y los targets de latencia.

> Estado: **placeholder estructural**. La estructura es estable; los umbrales
> finos y el dataset completo se completan en el paso de evals (ver
> `docs/ARCHITECTURE.md` → orden de implementación, paso 10).

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
pnpm evals:run     # dataset completo
pnpm evals:quick   # subset de 20 (smoke)
```

El runner sale con código ≠ 0 si la tasa de leakage no es 0%. CI lo trata como
gate de release.

---

## 5. Relación con tests unitarios

- `pnpm test:leakage` → tests deterministas de aislamiento (DB/retriever).
- `pnpm evals:run` → evaluación end-to-end del answer engine sobre el dataset.

Ambos son complementarios; ambos bloquean release si fallan en aislamiento.
