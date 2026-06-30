# HIPAA Security Risk Assessment — Ichtys

**Versión:** 1.0 (borrador)  
**Fecha:** 2026-06-30  
**Estado:** ⏳ Borrador — requiere revisión legal/compliance US  
**Alcance:** Aplicable si sitios US procesan PHI vía Ichtys

---

## 1. Entity classification

| Pregunta | Respuesta |
|----------|-----------|
| ¿Ichtys es Covered Entity? | **No** — es Business Associate del sitio/sponsor |
| ¿Ichtys es Business Associate? | **Sí** — procesa PHI en nombre de sitios de investigación |
| BAA requerido con | Sitios US, Anthropic, OpenAI, Neon, Vercel (según datos) |

---

## 2. ePHI inventory (electronic PHI)

| Sistema | ePHI almacenado | Ubicación |
|---------|-----------------|-----------|
| Neon Postgres | Evoluciones, perfiles, labs (Fase 1+) | Cloud |
| Vercel Blob | PDFs laboratorio (Fase 3) | Cloud |
| Anthropic API | Transient — prompts con extracción clínica | US |
| Logs | **Ninguno** (política explícita) | — |

---

## 3. Security Rule — Safeguards assessment

### Administrative (§164.308)

| Safeguard | Implementado | Gap | Acción |
|-----------|--------------|-----|--------|
| Security management process | Parcial | Risk assessment formal | Este documento |
| Assigned security responsibility | No | Security Officer | Asignar rol |
| Workforce training | No | PHI training | Programa capacitación |
| Access management | Sí | RBAC Clerk | Mantener |
| Security incident procedures | Sí | BREACH-NOTIFICATION | Firmar procedimiento |
| Contingency plan | Parcial | BACKUP-AND-DR | Probar DR anual |
| BAA con vendors | No | DPA-BAA-TRACKER | Firmar BAAs |

### Physical (§164.310)

| Safeguard | Implementado | Notas |
|-----------|--------------|-------|
| Facility access | N/A | Cloud-only; delegado a Neon/Vercel SOC 2 |
| Workstation use | Parcial | Política sitio — fuera de scope Ichtys |
| Device/media controls | Parcial | No almacenamiento local en app |

### Technical (§164.312)

| Safeguard | Implementado | Gap |
|-----------|--------------|-----|
| Access control (unique user ID) | ✅ Clerk userId | — |
| Emergency access | ⬜ | Break-glass pendiente |
| Automatic logoff | Parcial | Clerk session timeout |
| Encryption in transit | ✅ TLS | — |
| Encryption at rest | Parcial | Provider + field-level `@ichtys/crypto` |
| Audit controls | ✅ audit_logs | Extender a módulo PHI |
| Integrity controls | Parcial | GCM auth tag en crypto |
| Authentication | ✅ Clerk | MFA recomendado |
| Transmission security | ✅ HTTPS | — |

---

## 4. Risk register (top 5)

| # | Amenaza | Likelihood | Impact | Risk | Mitigation |
|---|---------|------------|--------|------|------------|
| 1 | Unauthorized PHI access cross-tenant | L | H | M | Leakage tests |
| 2 | PHI in application logs | L | H | M | Logger denylist |
| 3 | Missing BAA with LLM provider | M | H | H | Sign BAA before PHI |
| 4 | OCR misread critical lab | M | M | M | Human confirm |
| 5 | Insider threat (coordinator) | L | M | L | Audit + least privilege |

---

## 5. Remediation plan

| Prioridad | Acción | Due | Owner |
|-----------|--------|-----|-------|
| P0 | Firmar BAA Anthropic + OpenAI | Pre-PHI prod | Legal |
| P0 | Configurar PHI_ENCRYPTION_KEY prod | Pre-PHI prod | Ops |
| P1 | Asignar Security Officer | 2026-07-15 | Management |
| P1 | Workforce PHI training | Pre-PHI prod | Clinical Lead |
| P2 | MFA obligatorio roles clínicos | 2026-08-01 | Admin |
| P2 | Pentest | Pre-PHI prod | Security |

---

## 6. Sign-off

| Role | Name | Date |
|------|------|------|
| Security Officer | | |
| Privacy Officer | | |

---

## 7. Revisión anual

Próxima revisión: 2027-06-30 o tras incidente S1/S2.
