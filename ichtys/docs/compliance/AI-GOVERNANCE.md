# Gobernanza de IA — Ichtys (ISO 42001 Lite)

**Versión:** 1.0  
**Fecha:** 2026-06-30

---

## 1. Alcance de sistemas IA

| Sistema | Modelo | Propósito | Impacto clínico |
|---------|--------|-----------|-----------------|
| Answer engine RAG | Claude (Anthropic) | Q&A protocolo | Bajo — grounded, no PHI en docs |
| Study spec extraction | Claude | Extraer criterios | Medio — human review obligatorio |
| NLP clinical extraction (Fase 2) | Claude Haiku | Extraer meds/labs de evolución | **Alto** — alimenta rule engine |
| OCR labs (Fase 3) | Azure DI + fallback | Extraer valores lab | **Alto** — human confirm |
| Rule engine (Fase 2) | Determinista (código) | Scoring elegibilidad | **Alto** — no es ML |
| Embeddings | OpenAI text-embedding-3-small | Retrieval docs | Bajo — solo D2 |

---

## 2. Principios

1. **Human-in-the-loop** para objetos críticos (spec approval, OCR confirm, inclusión sujeto)
2. **LLM extract, rules decide** — el modelo no es juez de elegibilidad
3. **Grounding** — RAG solo responde con evidencia recuperada
4. **Transparency** — usuario ve confidence, citas, unknowns
5. **No training on customer data** — API providers con zero-retention
6. **Fail safe** — `unknown` > falso positivo

---

## 3. Registro de modelos

| ID | Provider | Model | Version | Uso | Retención datos |
|----|----------|-------|---------|-----|-----------------|
| AI-001 | Anthropic | claude-sonnet-* | API latest pinned | Answer engine | Zero (confirmar BAA) |
| AI-002 | Anthropic | claude-haiku-* | API latest pinned | Spec/NLP extract | Zero |
| AI-003 | OpenAI | text-embedding-3-small | Fixed | Embeddings D2 | Zero |
| AI-004 | Azure | prebuilt-document | TBD Fase 3 | OCR labs | Configurable |

Actualizar al cambiar versión de modelo en producción.

---

## 4. Evaluación y monitoreo

| Métrica | Frecuencia | Umbral alerta |
|---------|------------|---------------|
| Grounded answer rate (RAG) | Por release | < 85% |
| Citation correctness | Eval suite | < 90% |
| NLP extraction accuracy | Mensual (Fase 2) | < 95% en meds críticos |
| OCR field accuracy | Por batch (Fase 3) | < 90% en analitos primarios |
| False pass rate (screening) | Continuo | > 0% — **bloqueante** |

Eval suite existente: [`docs/EVALS.md`](../EVALS.md). Extender con casos PHI sintéticos en Fase 2.

---

## 5. Sesgo y equidad

- Diccionario NLP incluirá términos en español rioplatense (patrón medical-annotator)
- Validar extracción en protocolos EN/ES/PT
- No usar datos demográficos sensibles en scoring automatizado

---

## 6. Incidentes IA

| Tipo | Ejemplo | Respuesta |
|------|---------|-----------|
| Hallucination RAG | Respuesta sin cita | Guardrails + eval gate |
| Extraction miss | No detectó metformina | unknown + alerta UI |
| Extraction false positive | Detectó fármaco inexistente | Human override + feedback loop |
| OCR misread | Creatinina 1.2 → 12 | Human confirm gate |

Registrar en registro de incidentes IA [PENDIENTE].

---

## 7. Change control IA

Cambio de modelo o prompt en módulos CLN/NLP/SCR requiere:
1. Impact assessment
2. Re-run eval suite afectado
3. Aprobación Clinical Lead + Quality

---

## 8. Transparencia al usuario

UI debe mostrar:
- "Score orientativo — decisión final del investigador"
- Origen de cada dato (evolución, OCR, manual)
- Confidence por criterio
- Disclaimer en sugerencias SNOMED externas (ya implementado)

---

## 9. Revisión

Semestral o ante cambio de modelo mayor.
