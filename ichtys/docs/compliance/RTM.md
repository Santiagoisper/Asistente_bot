# RTM — Requirements Traceability Matrix (v0.1 borrador)

**Versión:** 0.1  
**Fecha:** 2026-07-04  
**Estado:** Borrador — actualizar al cerrar OQ

---

## Matriz URS → FRS → Test

| URS | FRS | Test / evidencia | Estado |
|-----|-----|------------------|--------|
| URS-001 | FRS-SEC-001, FRS-SEC-002 | OQ-001 (`route.oq.test.ts`) | ✅ OQ |
| URS-002 | FRS-SEC-003, FRS-SEC-004 | `pnpm test:leakage`, SEC-001 | ✅ leakage tests |
| URS-003 | FRS-CRY-001–003 | OQ-003, CRY-001, `verify-prod-phi.ts`, `e2e:product` PHI | ✅ parcial |
| URS-004 | FRS-AUD-001, FRS-AUD-002 | OQ-007 (`route.oq.test.ts`) | ✅ OQ |
| URS-005 | FRS-SCR-001–002 | OQ-004–006, `screening-engine.test.ts`, `e2e:product` | ✅ unit + e2e |
| URS-006 | FRS-SCR-003 | Code review screening-engine (no LLM) | ✅ |
| URS-007 | NLP-001 (futuro) | OCR flow manual | ⬜ |
| URS-008 | FRS-CLN-001 | Schema review `subjects` | ✅ |
| URS-009 | FRS-SCR-004 | Spec mock + screening assessments | ✅ e2e |
| URS-010 | — | DATA-RETENTION-POLICY.md | ✅ doc |
| URS-011 | FRS-SD-001–002 | Cron 401/200 + GHA workflow success 2026-07-04 | ✅ |
| URS-012 | FRS-RAG-001–002 | `e2e:product` org RAG patch/restore | ✅ |

## OQ pendientes (prioridad)

| TC | Descripción | Estado |
|----|-------------|--------|
| OQ-001 | Guardar evolución sin auth → 401 | ✅ `pnpm test:oq` |
| OQ-002 | Leer evolución cross-org → 404 | ✅ `pnpm test:oq` |
| OQ-007 | Audit log save evolution sin content | ✅ `pnpm test:oq` |
| IQ schema | Tablas Fase 1 + rag_config | ✅ `pnpm iq:check` |
| IQ completo | MFA roles, DPA/BAA | Legal |

## Referencias

- [URS.md](./URS.md)
- [FRS.md](./FRS.md)
- [CSV-VALIDATION-PLAN.md](./CSV-VALIDATION-PLAN.md)
- `pnpm e2e:product` — loop producto mock
- `scripts/verify-prod-phi.ts` — smoke PHI prod
