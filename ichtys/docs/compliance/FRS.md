# FRS — Functional Requirements Specification (v0.1 borrador)

**Producto:** ALPHI / Ichtys  
**Versión:** 1.0  
**Fecha:** 2026-07-04  
**Estado:** Aprobado — derivado de URS v1.0  
**Trazabilidad:** Ver [RTM.md](./RTM.md)

---

## 1. Autenticación y acceso (SEC)

| ID | URS | Requisito funcional | Implementación |
|----|-----|---------------------|----------------|
| FRS-SEC-001 | URS-001 | Middleware Clerk protege rutas no públicas | `apps/web/middleware.ts` |
| FRS-SEC-002 | URS-001 | APIs PHI validan rol mínimo study_admin/CRC | `validatePhiStudyAccess()` |
| FRS-SEC-003 | URS-002 | Queries filtran por `organization_id` del JWT | `@ichtys/auth`, Drizzle |
| FRS-SEC-004 | URS-002 | Tests leakage cross-tenant/study | `pnpm test:leakage` |

## 2. Cifrado PHI (CRY)

| ID | URS | Requisito funcional | Implementación |
|----|-----|---------------------|----------------|
| FRS-CRY-001 | URS-003 | AES-256-GCM field-level | `@ichtys/crypto/phi-crypto.ts` |
| FRS-CRY-002 | URS-003 | Key desde `PHI_ENCRYPTION_KEY` en prod | Vercel env (verificado 2026-07-04) |
| FRS-CRY-003 | URS-003 | Error explícito si key ausente | `phi-fields.ts`, UI subjects |

## 3. Clinical CRUD (CLN)

| ID | URS | Requisito funcional | Implementación |
|----|-----|---------------------|----------------|
| FRS-CLN-001 | URS-008 | POST subject con `subject_code` único por org+study | `/api/studies/[id]/subjects` |
| FRS-CLN-002 | URS-003 | Perfil vacío cifrado al crear sujeto | `encryptProfileJson({})` |
| FRS-CLN-003 | URS-004 | Audit `subject.create` sin PHI | `writeAuditLog` metadata |

## 4. Screening (SCR)

| ID | URS | Requisito funcional | Implementación |
|----|-----|---------------------|----------------|
| FRS-SCR-001 | URS-005 | HbA1c rango inclusión/exclusión | `screening-engine.ts` |
| FRS-SCR-002 | URS-005 | Exclusión pancreatitis vía conditions | `assessConditionCriterion` |
| FRS-SCR-003 | URS-006 | Sin llamada LLM en assessScreening | Pure functions + tests |
| FRS-SCR-004 | URS-009 | Criterios con `sourcePages` del spec | `study-spec` + spec store |

## 5. Audit (AUD)

| ID | URS | Requisito funcional | Implementación |
|----|-----|---------------------|----------------|
| FRS-AUD-001 | URS-004 | Tabla `audit_logs` append-only | `@ichtys/db/schema/audit-logs` |
| FRS-AUD-002 | URS-004 | Acciones subject.view/create sin content | API routes subjects |

## 6. Ingesta / ops (SD)

| ID | URS | Requisito funcional | Implementación |
|----|-----|---------------------|----------------|
| FRS-SD-001 | URS-011 | Cron recupera docs stuck > threshold | `/api/cron/recover-stuck-docs` |
| FRS-SD-002 | URS-011 | Auth Bearer `CRON_SECRET` | Vercel + GitHub Actions |

## 7. RAG config (T2)

| ID | URS | Requisito funcional | Implementación |
|----|-----|---------------------|----------------|
| FRS-RAG-001 | URS-012 | PATCH org settings threshold 0.05–0.95 | `updateOrgRagConfig` |
| FRS-RAG-002 | URS-012 | PATCH org settings topK 1–20 | `/settings` UI sliders |

## 8. Labs OCR (OCR)

| ID | URS | Requisito funcional | Implementación |
|----|-----|---------------------|----------------|
| FRS-OCR-001 | URS-007 | Parser determinista texto lab + redacción PII encabezado | `@ichtys/clinical/lab-ocr-parser.ts` |
| FRS-OCR-002 | URS-007 | Extract guarda `pendingLabReview.requiresHumanReview` | `POST .../labs/extract` |
| FRS-OCR-003 | URS-007 | Confirm mergea a `profile.labs` | `POST .../labs/confirm` |
| FRS-OCR-004 | URS-007 | Reject descarta pending sin persistir | `POST .../labs/reject` |
| FRS-OCR-005 | URS-007 | Audit sin texto OCR en metadata | `lab.extract` / `lab.confirm` |
