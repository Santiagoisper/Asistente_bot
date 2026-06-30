# ADR-005 — Field-level PHI encryption (Fase 0)

**Estado:** Aceptado  
**Fecha:** 2026-06-30  
**Contexto:** Fase 0 Compliance Foundation — preparación para módulo de sujetos (Fase 1)

---

## Decisión

Implementar cifrado field-level AES-256-GCM en paquete `@ichtys/crypto` para campos D5 (PHI clínico) antes de persistir en Neon Postgres.

---

## Formato

```
v1:<iv_b64url>:<authTag_b64url>:<ciphertext_b64url>
```

- Algoritmo: AES-256-GCM
- IV: 12 bytes aleatorios por operación
- Clave: `PHI_ENCRYPTION_KEY` — 32 bytes (64 hex chars)
- Generación: `node scripts/generate-phi-key.mjs`

---

## Campos objetivo (Fase 1)

| Tabla | Campo |
|-------|-------|
| `clinical_evolutions` | `content` |
| `patient_profiles` | `profile_json` |

---

## Lo que NO ciframos en field-level

- IDs, timestamps, subject_code (D4 — pseudónimo operacional)
- Audit logs (nunca contienen contenido)
- Embeddings (D5 prohibido en embeddings)

Neon encryption-at-rest del proveedor es capa adicional, no sustituto.

---

## Rotación

Ver [BACKUP-AND-DR.md](../compliance/BACKUP-AND-DR.md) §6 — requiere job de re-cifrado.

---

## Alternativas consideradas

| Opción | Descartada porque |
|--------|-------------------|
| pgcrypto en Postgres | Acopla clave a DB; rotación más difícil en serverless |
| Cifrado solo Blob | PHI principal vive en Postgres jsonb/text |
| Sin cifrado field-level | Insuficiente para HIPAA/GDPR con PHI en DB compartida |

---

## Tests

`packages/crypto/__tests__/phi-crypto.test.ts` — round-trip, tamper detection, key validation.
