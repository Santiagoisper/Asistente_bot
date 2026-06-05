# EVALS — Ichtys

Cómo medimos la calidad del RAG. El paquete `@ichtys/evals` implementa el
runner y las métricas; este documento define qué medimos y qué bloquea release.

---

## Por qué

En un asistente clínico, "responde algo plausible" no alcanza. Medimos:

- que la respuesta esté **anclada** en las citas (groundedness),
- que las **citas sean correctas** (apuntan a la fuente real),
- que **nunca haya leakage** entre tenants/estudios,
- que el fallback de **insufficient_evidence** dispare cuando corresponde.

---

## Dataset

`packages/evals/dataset/` — ~100 preguntas clínicas reales (PRD §14: dataset
desde el día 1), cubriendo los Jobs to Be Done:

1. Elegibilidad (criterios inclusión/exclusión)
2. Instrucciones de visita
3. Medicación concomitante / prohibida
4. Manejo de muestras y labs (PK)
5. Safety reporting (SAE / SUSAR timelines)
6. Preparación de monitoreo / closeout

Cada caso (`EvalCase`) declara: `organizationId`, `studyId`, `question`, y
opcionalmente `expectedAnswer`, `expectedDocumentIds`, o
`expectInsufficientEvidence`.

Incluye **casos adversariales de leakage**: preguntas cuya respuesta correcta
vive en otro study/org y por lo tanto deben devolver `insufficient_evidence`.

---

## Métricas (PRD §9)

| Métrica | Definición | Target |
|---|---|---|
| Grounded answer rate | % de respuestas ancladas en citas | maximizar |
| Citation correctness rate | % de citas que apuntan a la fuente esperada | >90% |
| Cited answer rate | % de respuestas con ≥1 cita (no fallback) | >90% |
| Cross-tenant leakage rate | evidencia de otra org | **0% (bloqueante)** |
| Cross-study leakage rate | evidencia de otro study | **0% (bloqueante)** |

---

## Comandos

```bash
pnpm evals:run     # dataset completo
pnpm evals:quick   # subset de 20 (smoke)
```

El runner sale con código ≠ 0 si la tasa de leakage no es 0%. CI lo trata como
gate de release.

---

## Relación con tests unitarios

- `pnpm test:leakage` → tests deterministas de aislamiento (DB/retriever).
- `pnpm evals:run` → evaluación end-to-end del answer engine sobre el dataset.

Ambos son complementarios; ambos bloquean release si fallan en aislamiento.
