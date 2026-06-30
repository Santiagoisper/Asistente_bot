# Compliance — Ichtys (Fase 0)

Documentación de cumplimiento regulatorio para el módulo de **datos clínicos de sujetos** (evolución, labs, screening). Complementa [`SECURITY.md`](../SECURITY.md) y [`OPERATIONS.md`](../OPERATIONS.md).

**Estado:** Fase 0 — Compliance Foundation  
**Owner:** CINME / Innova Trials  
**Última revisión:** 2026-06-30  
**Próxima revisión:** 2026-09-30 (trimestral)

---

## Objetivo de la Fase 0

Establecer la base **antes de procesar PHI** (Protected Health Information / datos de salud identificables). Ningún dato de paciente real debe ingresar a producción hasta completar los ítems bloqueantes de esta checklist.

---

## Checklist Fase 0

| # | Entregable | Documento | Estado | Bloqueante |
|---|------------|-----------|--------|------------|
| 1 | Clasificación de datos | [DATA-CLASSIFICATION.md](./DATA-CLASSIFICATION.md) | ✅ Documentado | Sí |
| 2 | Política de manejo PHI | [PHI-HANDLING-POLICY.md](./PHI-HANDLING-POLICY.md) | ✅ Documentado | Sí |
| 3 | Pseudonimización | [PSEUDONYMIZATION-POLICY.md](./PSEUDONYMIZATION-POLICY.md) | ✅ Documentado | Sí |
| 4 | Control de acceso (ISMS) | [ACCESS-CONTROL-POLICY.md](./ACCESS-CONTROL-POLICY.md) | ✅ Documentado | Sí |
| 5 | Retención y purga | [DATA-RETENTION-POLICY.md](./DATA-RETENTION-POLICY.md) | ✅ Documentado | Sí |
| 6 | Notificación de brechas | [BREACH-NOTIFICATION-PROCEDURE.md](./BREACH-NOTIFICATION-PROCEDURE.md) | ✅ Documentado | Sí |
| 7 | Backup y DR | [BACKUP-AND-DR.md](./BACKUP-AND-DR.md) | ✅ Documentado | Sí |
| 8 | DPA / BAA con procesadores | [DPA-BAA-TRACKER.md](./DPA-BAA-TRACKER.md) | ⏳ Pendiente firma | **Sí** |
| 9 | DPIA (GDPR) | [DPIA.md](./DPIA.md) | ⏳ Revisión legal | **Sí** (UE) |
| 10 | HIPAA Risk Assessment | [HIPAA-RISK-ASSESSMENT.md](./HIPAA-RISK-ASSESSMENT.md) | ⏳ Revisión legal | **Sí** (US) |
| 11 | Plan validación CSV | [CSV-VALIDATION-PLAN.md](./CSV-VALIDATION-PLAN.md) | ✅ Marco definido | Sí (pre-Fase 1 prod) |
| 12 | Gobernanza IA | [AI-GOVERNANCE.md](./AI-GOVERNANCE.md) | ✅ Documentado | Sí |
| 13 | ISMS overview | [ISMS-OVERVIEW.md](./ISMS-OVERVIEW.md) | ✅ Documentado | Sí |
| 14 | Cifrado field-level PHI | [`@ichtys/crypto`](../../packages/crypto/) | ✅ Implementado | Sí |
| 15 | `PHI_ENCRYPTION_KEY` en prod | Vercel env | ⏳ Pendiente | **Sí** |

**Criterio de salida Fase 0:** ítems 8, 9/10 (según jurisdicción activa) y 15 completados + revisión interna firmada.

---

## Marco regulatorio cubierto

| Marco | Documentos relevantes | Certificación |
|-------|----------------------|---------------|
| FDA 21 CFR Part 11 | CSV-VALIDATION-PLAN, ACCESS-CONTROL, audit trail existente | Validación formal pendiente |
| EMA Annex 11 | CSV-VALIDATION-PLAN, BACKUP-AND-DR | Validación formal pendiente |
| ICH E6 GCP | PHI-HANDLING, PSEUDONYMIZATION, AI-GOVERNANCE | Operacional |
| GDPR | DPIA, DATA-RETENTION, BREACH-NOTIFICATION, DPA-BAA | DPIA pendiente firma |
| HIPAA | HIPAA-RISK-ASSESSMENT, BAA tracker | BAA pendiente |
| ISO 27001 | ISMS-OVERVIEW, ACCESS-CONTROL, BACKUP-AND-DR | ISMS lite (no certificado) |
| ISO 27701 | DPIA, DATA-RETENTION, PSEUDONYMIZATION | Extensión pendiente |
| ISO 42001 | AI-GOVERNANCE | Lite (no certificado) |

---

## Cifrado field-level (implementación técnica)

```bash
# Generar clave (una por entorno; nunca commitear)
node scripts/generate-phi-key.mjs

# Configurar en Vercel / .env.local
PHI_ENCRYPTION_KEY=<64-char-hex>
```

Uso en código (Fase 1+):

```typescript
import { encryptPhiField, decryptPhiField } from '@ichtys/crypto'

const stored = encryptPhiField(evolutionText)
const plain = decryptPhiField(stored)
```

Campos objetivo: `clinical_evolutions.content`, `patient_profiles.profile_json`.

---

## Contactos de cumplimiento

| Rol | Responsabilidad | Asignado |
|-----|-----------------|----------|
| Data Protection Officer (DPO) | GDPR, DPIA | [PENDIENTE] |
| Security Officer | ISMS, incidentes | [PENDIENTE] |
| Quality / CSV Lead | Validación GAMP | [PENDIENTE] |
| Clinical Lead | Uso clínico, GCP | [PENDIENTE] |

---

## Historial de cambios

| Fecha | Cambio |
|-------|--------|
| 2026-06-30 | Creación Fase 0 — documentación + `@ichtys/crypto` |
