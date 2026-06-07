# Mock Metabolic T2D — Real Eval Summary

**Fecha:** 2026-06-07  
**Branch:** `claude/phase-10b-1-real-eval-run`  
**Fase:** 10B.1 — Real Eval Run  
**Estado:** PARCIAL — infraestructura completa, pendiente cookie de sesión Clerk

---

## Setup completado en esta sesión

| Componente | Estado | Detalle |
|---|---|---|
| Org en DB | ✅ | `2d67f024-ff70-42fa-b73a-4a0500229855` |
| Study en DB | ✅ | `508fa9c9-dbb9-49aa-abd5-7f7fe968bbc6` — MOCK-METABOLIC-T2D-v1 |
| 5 document_versions | ✅ | status=ready |
| 58 chunks con embeddings | ✅ | Generados con text-embedding-3-small via seed-mock-chunks.ts |
| Dev server | ✅ | Arranca en localhost:3000 con ENABLE_INTERNAL_RAG_ANSWER_TEST=true |
| Endpoint answer-test | ✅ | Responde — bloqueado por Clerk middleware sin cookie |
| Eval runner | ✅ | Validado contra 58 chunks reales |
| Auth cookie | ❌ BLOQUEANTE | Requiere sesión Clerk del browser |

**Bloqueador único:** `EVAL_AUTH_COOKIE` — necesita cookie `__session` de una sesión Clerk activa en el browser del reviewer.

---

## Estado de la DB

```
studyId:  508fa9c9-dbb9-49aa-abd5-7f7fe968bbc6
orgId:    2d67f024-ff70-42fa-b73a-4a0500229855
clerkOrg: org_3Emh0j274SoeBVmpICF4gnlWlVR

Documentos:
  Protocol v1.0            [protocol]               → status=ready
  Investigator Brochure v2 [investigator_brochure]  → status=ready
  Lab Manual v1.0          [lab_manual]             → status=ready
  Pharmacy Manual v1.0     [pharmacy_manual]        → status=ready
  Study Procedures Manual  [other]                  → status=ready

Chunks: 58 total con embeddings 1536-dim (text-embedding-3-small)
  Protocol:                  14 chunks
  Investigator Brochure:     10 chunks
  Lab Manual:                11 chunks
  Pharmacy Manual:           11 chunks
  Study Procedures Manual:   12 chunks
```

---

## Cómo ejecutar la eval real (runbook completo)

### Prerequisito único: obtener cookie de sesión Clerk

1. Arrancar el dev server:
   ```bash
   pnpm dev
   ```
2. Abrir browser → `http://localhost:3000/sign-in`
3. Iniciar sesión con cuenta Clerk de `org_3Emh0j274SoeBVmpICF4gnlWlVR`
4. Abrir DevTools → Application → Cookies → `localhost:3000`
5. Copiar el valor de la cookie `__session`

> **Nunca imprimir, commitear, ni guardar el valor de la cookie.**

### Ejecutar eval

Terminal 1 — servidor activo:
```bash
# .env.local ya tiene ENABLE_INTERNAL_RAG_ANSWER_TEST=true
pnpm dev
```

Terminal 2 — eval runner:
```bash
EVAL_STUDY_ID=508fa9c9-dbb9-49aa-abd5-7f7fe968bbc6 \
EVAL_AUTH_COOKIE="__session=<pegar-valor-copiado>" \
EVAL_BASE_URL=http://localhost:3000 \
pnpm evals:mock-metabolic
```

### Resultado esperado

```
EVAL SUITE — MOCK METABOLIC T2D
────────────────────────────────────────────
Run:         <uuid>
Study:       508fa9c9-dbb9-49aa-abd5-7f7fe968bbc6
Total:       12
PASS:        ≥10 (estimado — depende de retrieval quality)
FAIL:        ≤2
Pass rate:   ≥83%
```

Resultados se guardan en: `docs/evals/results/eval-results-<runId>.{json,csv}` (gitignoreado)

---

## Evaluación de adversariales esperada

| Caso | Pregunta | Esperado | Motivo |
|---|---|---|---|
| SM-011 | Variable X (no existe) | `insufficient_evidence` | CRÍTICO — alucinación si falla |
| SM-012 | Visita 99 + procedimiento Y | `insufficient_evidence` | CRÍTICO — alucinación si falla |

---

## Evaluación de leakage

- Los 58 chunks pertenecen TODOS a `studyId=508fa9c9-...` y `orgId=2d67f024-...`
- No hay chunks de otros estudios ni orgs en la DB de dev
- Leakage esperado: **0**

---

## Failure types esperados en primera ejecución

| Tipo | Probabilidad | Causa probable |
|---|---|---|
| `answer_unsupported` | Media | Keyword matching puede fallar si respuesta usa sinónimos |
| `wrong_section` | Baja | Chunks de sección correcta pero sectionTitle con formato distinto |
| `retrieval_miss` | Muy baja | 58 chunks cubren todas las secciones esperadas |
| `missed_insufficient_evidence` | Muy baja | SM-011/012 preguntan por contenido inexistente — debería retornar fallback |
| `runtime_error` | Baja | Si auth cookie expira durante la corrida |

---

## Decisión de mando actual

**No se puede emitir decisión de avance a viewer/document jump** hasta ejecutar la eval real.

Una vez ejecutada:
- Si adversariales pasan (SM-011, SM-012 → `insufficient_evidence`) y leakage = 0: **avanzar a viewer**
- Si adversariales fallan: **detener — corregir answer engine antes de avanzar**
- Si leakage > 0: **detener todo — priorizar seguridad**

---

## Archivos creados/modificados en esta sesión

| Archivo | Acción |
|---|---|
| `scripts/seed-mock-chunks.ts` | CREADO — inserta 58 chunks con embeddings reales |
| `scripts/check-study-state.ts` | CREADO — script diagnóstico temporal |
| `apps/web/.env.local` | MODIFICADO — `ENABLE_INTERNAL_RAG_ANSWER_TEST=true` |
| `docs/evals/mock-metabolic-real-eval-summary.md` | CREADO — este archivo |

---

## Checks de calidad

| Check | Resultado |
|---|---|
| `pnpm typecheck` | 7/7 packages ✅ |
| `pnpm lint` | 7/7 packages ✅ |
| `pnpm test` | 48/48 tests ✅ |

---

*No incluye: cookie, secrets, respuestas de LLM, excerpts de documentos, embeddings, PHI.*
