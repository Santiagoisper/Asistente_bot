# RTM — Requirements Traceability Matrix (v0.1 borrador)

**Versión:** 0.1  
**Fecha:** 2026-07-04  
**Estado:** Borrador — OQ Fase 1 clínico + labs OCR URS-007 (29 tests OQ)

---

## Matriz URS → FRS → Test

| URS | FRS | Test / evidencia | Estado |
|-----|-----|------------------|--------|
| URS-001 | FRS-SEC-001, FRS-SEC-002 | OQ-001, OQ-S01–S03, OQ-P01–P02, OQ-SCR01–SCR02 (`*/route.oq.test.ts`) | ✅ OQ |
| URS-002 | FRS-SEC-003, FRS-SEC-004 | `pnpm test:leakage`, SEC-001 | ✅ leakage tests |
| URS-003 | FRS-CRY-001–003 | OQ-003, OQ-S04, CRY-001, `verify-prod-phi.ts`, `e2e:product` PHI | ✅ OQ |
| URS-004 | FRS-AUD-001, FRS-AUD-002 | OQ-007, OQ-S05–S06, OQ-P04, OQ-SCR05 (`*/route.oq.test.ts`) | ✅ OQ |
| URS-005 | FRS-SCR-001–002 | OQ-004–006, OQ-SCR03–SCR04, `screening-engine.test.ts`, `e2e:product` | ✅ OQ + e2e |
| URS-006 | FRS-SCR-003 | OQ-SCR06, code review screening-engine (no LLM) | ✅ OQ |
| URS-007 | NLP-001 (futuro) | OQ-L01–L05, `lab-ocr-parser.test.ts`, labs extract/confirm API | ✅ OQ |
| URS-008 | FRS-CLN-001 | Schema review `subjects` | ✅ |
| URS-009 | FRS-SCR-004 | Spec mock + screening assessments | ✅ e2e |
| URS-010 | — | DATA-RETENTION-POLICY.md | ✅ doc |
| URS-011 | FRS-SD-001–002 | Cron 401/200 + GHA workflow success 2026-07-04 | ✅ |
| URS-012 | FRS-RAG-001–002 | `e2e:product` org RAG patch/restore | ✅ |

## OQ — módulo clínico (Fase 1)

| TC | Descripción | Archivo | Estado |
|----|-------------|---------|--------|
| OQ-001 | Guardar evolución sin auth → 401 | `evolutions/__tests__/route.oq.test.ts` | ✅ |
| OQ-002 | Leer evolución cross-org → 404 | `evolutions/__tests__/route.oq.test.ts` | ✅ |
| OQ-007 | Audit log save evolution sin content | `evolutions/__tests__/route.oq.test.ts` | ✅ |
| OQ-S01 | GET subjects sin auth → 401 | `subjects/__tests__/route.oq.test.ts` | ✅ |
| OQ-S02 | POST subjects sin auth → 401 | `subjects/__tests__/route.oq.test.ts` | ✅ |
| OQ-S03 | GET subjects cross-org → 404 | `subjects/__tests__/route.oq.test.ts` | ✅ |
| OQ-S04 | POST subjects happy path + `encryptProfileJson({})` | `subjects/__tests__/route.oq.test.ts` | ✅ |
| OQ-S05 | Audit `subject.create` sin PHI | `subjects/__tests__/route.oq.test.ts` | ✅ |
| OQ-S06 | Audit `subject.view` metadata `{ count }` | `subjects/__tests__/route.oq.test.ts` | ✅ |
| OQ-P01 | GET profile sin auth → 401 | `profile/__tests__/route.oq.test.ts` | ✅ |
| OQ-P02 | GET profile cross-org → 404 | `profile/__tests__/route.oq.test.ts` | ✅ |
| OQ-P03 | GET profile happy path | `profile/__tests__/route.oq.test.ts` | ✅ |
| OQ-P04 | Audit `profile.view` sin labs/medications | `profile/__tests__/route.oq.test.ts` | ✅ |
| OQ-SCR01 | GET screening sin auth → 401 | `screening/__tests__/route.oq.test.ts` | ✅ |
| OQ-SCR02 | GET screening cross-org → 404 | `screening/__tests__/route.oq.test.ts` | ✅ |
| OQ-SCR03 | Sin spec → `specAvailable: false` | `screening/__tests__/route.oq.test.ts` | ✅ |
| OQ-SCR04 | Con spec → assessments deterministas | `screening/__tests__/route.oq.test.ts` | ✅ |
| OQ-SCR05 | Audit `screening.view` sin criterionText | `screening/__tests__/route.oq.test.ts` | ✅ |
| OQ-SCR06 | Screening no invoca LLM | `screening/__tests__/route.oq.test.ts` | ✅ |

**Total:** 23 tests — `pnpm test:oq` (CI incluido)

## IT — integración DB real (Fase 3)

| TC | Descripción | Archivo | Estado |
|----|-------------|---------|--------|
| IT-001 | Profile cifrado at-rest (sin plaintext) | `tests/integration/phi-clinical.integration.test.ts` | ✅ |
| IT-002 | loadPatientProfile round-trip | `tests/integration/phi-clinical.integration.test.ts` | ✅ |
| IT-003 | evaluateAndPersistScreening snapshot | `tests/integration/phi-clinical.integration.test.ts` | ✅ |
| IT-004 | Aislamiento org en loadPatientProfile | `tests/integration/phi-clinical.integration.test.ts` | ✅ |

## OQ — labs OCR (URS-007)

| TC | Descripción | Archivo | Estado |
|----|-------------|---------|--------|
| OQ-L01 | POST labs/extract sin auth → 401 | `labs/__tests__/route.oq.test.ts` | ✅ |
| OQ-L02 | POST labs/extract cross-org → 404 | `labs/__tests__/route.oq.test.ts` | ✅ |
| OQ-L03 | Extract → pendingLabReview, labs[] vacío | `labs/__tests__/route.oq.test.ts` | ✅ |
| OQ-L04 | Audit lab.extract/confirm sin texto OCR | `labs/__tests__/route.oq.test.ts` | ✅ |
| OQ-L05 | Audit lab.reject sin metadata PHI | `labs/__tests__/route.oq.test.ts` | ✅ |
| OQ-L06 | parseLabOcrText siempre requiresHumanReview | `lab-ocr-parser.test.ts` | ✅ |

**Total OQ:** 29 tests — `pnpm test:oq`

**IT requiere:** `DATABASE_URL` + `PHI_ENCRYPTION_KEY` — skip automático sin env.

## OQ / IQ pendientes

| TC | Descripción | Estado |
|----|-------------|--------|
| IQ schema | Tablas Fase 1 + rag_config | ✅ `pnpm iq:check` |
| IQ completo | MFA roles, DPA/BAA | Legal |

## Referencias

- [URS.md](./URS.md)
- [FRS.md](./FRS.md)
- [CSV-VALIDATION-PLAN.md](./CSV-VALIDATION-PLAN.md)
- `pnpm test:integration` — IT PHI con DB real (local/pre-prod)
- `pnpm validate:product` — gate unificado Etapa 2 (typecheck, test, OQ, integration, leakage, IQ, E2E)
- `pnpm validate:product:ci` — gate CI sin DB
- `pnpm e2e:product` — loop producto mock
- `scripts/verify-prod-phi.ts` — smoke PHI prod
