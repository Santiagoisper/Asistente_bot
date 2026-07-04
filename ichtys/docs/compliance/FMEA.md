# FMEA — Failure Mode and Effects Analysis (módulos críticos)

**Versión:** 1.0  
**Fecha:** 2026-07-04  
**Estado:** Aprobado — Etapa 2 CSV  
**Trazabilidad:** [RTM.md](./RTM.md), [CSV-VALIDATION-PLAN.md](./CSV-VALIDATION-PLAN.md)

---

## 1. Alcance

Módulos con impacto en integridad de datos clínicos y decisiones de elegibilidad:

| Módulo | URS | OQ / IT |
|--------|-----|---------|
| Auth + tenant isolation | URS-001, URS-002 | OQ-S01–S03, leakage, IT-004 |
| Cifrado PHI | URS-003 | OQ-003, OQ-S04, IT-001–002, verify:phi-prod |
| Audit trail | URS-004 | OQ-007, OQ-S05–S06, OQ-P04, OQ-SCR05, OQ-L04–L05 |
| Clinical CRUD | URS-008 | OQ-S04–S06, IT-001–002 |
| Screening determinista | URS-005, URS-006, URS-009 | OQ-SCR*, screening-engine.test |
| Labs OCR + human review | URS-007 | OQ-L*, lab-ocr-parser.test |

Out of scope v1: chat RAG como decisión clínica (validación lite).

---

## 2. Matriz FMEA

Escala: Severidad (S) 1–5, Ocurrencia (O) 1–5, Detección (D) 1–5, **RPN = S × O × D**.

| ID | Modo de falla | Causa | Efecto | S | O | D | RPN | Controles / evidencia | CAPA residual |
|----|---------------|-------|--------|---|---|---|-----|----------------------|---------------|
| F-001 | Acceso PHI sin auth | Token inválido / bypass middleware | Exposición ePHI | 5 | 2 | 1 | 10 | Clerk middleware, validatePhiStudyAccess, OQ-001 | Monitoreo audit auth.access_denied |
| F-002 | Leakage cross-tenant | Query sin orgId | Datos de otro sitio | 5 | 2 | 1 | 10 | test:leakage, IT-004 | CI bloqueante leakage |
| F-003 | PHI plaintext en DB | Key ausente / bug encrypt | Brecha at-rest | 5 | 2 | 1 | 10 | @ichtys/crypto, IT-001, iq:check | verify:phi-prod en gate deploy |
| F-004 | PHI en audit_logs | Log de content clínico | Brecha indirecta | 4 | 2 | 1 | 8 | OQ-007, OQ-S05, OQ-L04 | Code review rutas nuevas |
| F-005 | Screening LLM decide | Regresión a LLM en assess | Decisión no determinista | 4 | 1 | 1 | 4 | OQ-SCR06, code review | Prohibir import @ichtys/llm en screening |
| F-006 | Lab OCR sin revisión | Skip pendingLabReview | Valor lab incorrecto en perfil | 4 | 2 | 1 | 8 | OQ-L03, requiresHumanReview literal | UI bloquea hasta confirm |
| F-007 | Valor lab OCR erróneo | Parser heurístico | Screening fail/pass incorrecto | 3 | 3 | 2 | 18 | Human confirm URS-007, confidence high post-confirm | Extender parser + PQ casos lab |
| F-008 | Migración no aplicada | Deploy sin migrate | 500 en prod | 4 | 2 | 2 | 16 | iq:check, OPERATIONS §9 | Checklist pre-deploy schema |
| F-009 | Cron stuck docs | Pipeline colgado | Docs no indexados | 2 | 3 | 2 | 12 | SD cron, URS-011 | Alertas ops |
| F-010 | PII en prompt LLM extracción | Evolución con DNI | Fuga a proveedor LLM | 4 | 3 | 2 | 24 | redactPhiForLlm, detectPossiblePii | PQ caso evolución con PII |

---

## 3. RPN > 15 — acciones

| ID | RPN | Acción |
|----|-----|--------|
| F-010 | 24 | PQ incluye caso PII en evolución; verificar redacción antes de LLM |
| F-007 | 18 | PQ incluye flujo labs OCR confirm/reject; no usar hasta confirm |
| F-008 | 16 | Gate deploy: iq:check + checklist migraciones |

---

## 4. Revisión

| Fecha | Revisor | Cambio |
|-------|---------|--------|
| 2026-07-04 | CSV Lead (borrador IA) | v1.0 inicial post-OQ 29 tests |

Próxima revisión: post-PQ piloto o cambio arquitectónico mayor.
