# ISMS Overview — Ichtys (ISO 27001 Lite)

**Versión:** 1.0  
**Fecha:** 2026-06-30  
**Estado:** ISMS lite — no certificado ISO 27001

---

## 1. Contexto

Ichtys procesa documentos de ensayos clínicos y (Fase 1+) datos de salud pseudonimizados. El ISMS lite establece controles mínimos alineados con ISO 27001 Annex A mientras se evalúa certificación formal.

---

## 2. Alcance del ISMS

**In scope:**
- Aplicación web Ichtys (Next.js en Vercel)
- Base de datos Neon Postgres
- Almacenamiento Vercel Blob
- Integraciones IA (Anthropic, OpenAI)
- Autenticación Clerk

**Out of scope:**
- Infraestructura física de sitios de investigación
- EMR/HCE de terceros (integración futura)

---

## 3. Políticas del ISMS

| Política | Documento |
|----------|-----------|
| Clasificación de datos | [DATA-CLASSIFICATION.md](./DATA-CLASSIFICATION.md) |
| Manejo PHI | [PHI-HANDLING-POLICY.md](./PHI-HANDLING-POLICY.md) |
| Control de acceso | [ACCESS-CONTROL-POLICY.md](./ACCESS-CONTROL-POLICY.md) |
| Retención | [DATA-RETENTION-POLICY.md](./DATA-RETENTION-POLICY.md) |
| Brechas | [BREACH-NOTIFICATION-PROCEDURE.md](./BREACH-NOTIFICATION-PROCEDURE.md) |
| Backup/DR | [BACKUP-AND-DR.md](./BACKUP-AND-DR.md) |
| Seguridad técnica | [SECURITY.md](../SECURITY.md) |
| Gobernanza IA | [AI-GOVERNANCE.md](./AI-GOVERNANCE.md) |
| Procesadores | [DPA-BAA-TRACKER.md](./DPA-BAA-TRACKER.md) |

---

## 4. Controles Annex A (resumen)

| Control | Estado | Evidencia |
|---------|--------|-----------|
| A.5 Políticas de seguridad | ✅ | docs/compliance/ |
| A.6 Organización | ⬜ | Roles pendientes asignar |
| A.8 Gestión de activos | Parcial | DATA-CLASSIFICATION |
| A.9 Control de acceso | ✅ | Clerk RBAC + validateStudyAccess |
| A.10 Criptografía | ✅ | TLS + @ichtys/crypto |
| A.12 Seguridad operaciones | Parcial | OPERATIONS.md, CI |
| A.13 Seguridad comunicaciones | ✅ | HTTPS, private Blob |
| A.14 Adquisición/desarrollo | Parcial | PR review, CI, leakage tests |
| A.16 Gestión incidentes | ✅ | BREACH-NOTIFICATION |
| A.17 Continuidad | Parcial | BACKUP-AND-DR |
| A.18 Cumplimiento | ⬜ | DPIA/HIPAA borrador |

---

## 5. Ciclo PDCA

```
Plan   → Políticas compliance + risk assessments
Do     → Implementación técnica + capacitación
Check  → Audits E2E, eval suite, leakage tests
Act    → CAPA post-incidente, actualización políticas
```

Auditoría E2E reciente: [`docs/audits/ALPHI_E2E_Audit_2026-06-28.md`](../audits/ALPHI_E2E_Audit_2026-06-28.md)

---

## 6. Métricas de seguridad

| KPI | Target | Fuente |
|-----|--------|--------|
| Cross-tenant leakage | 0% | test:leakage |
| Audit write failure rate | 0% en prod | Logs |
| Mean time to contain (S1) | < 4h | Incident register |
| BAA coverage procesadores PHI | 100% | DPA-BAA-TRACKER |
| PHI in logs | 0 | Logger tests |

---

## 7. Roadmap certificación

| Fase | Objetivo | Timeline |
|------|----------|----------|
| Actual | ISMS lite documentado | 2026-06 |
| +6 meses | SOC 2 Type I readiness | 2026-12 |
| +12 meses | ISO 27001 gap assessment | 2027-06 |
| +18 meses | ISO 27701 extension (si UE activa) | 2027-12 |

---

## 8. Responsables ISMS

| Rol | Asignado |
|-----|----------|
| ISMS Manager / Security Officer | [PENDIENTE] |
| DPO | [PENDIENTE] |
| Internal Auditor | [PENDIENTE] |

---

## 9. Revisión de management

Revisión trimestral de:
- Incidentes y near-misses
- Estado DPA/BAA
- Resultados eval suite y leakage tests
- Cambios regulatorios (ICH E6 R3, GDPR, FDA)

Próxima revisión: **2026-09-30**
