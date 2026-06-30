# Plan de validación CSV — Ichtys (GAMP 5)

**Versión:** 1.0  
**Fecha:** 2026-06-30  
**Clasificación GAMP:** Categoría 4 (software configurable) → 5 para módulos custom (rule engine, NLP)  
**Estado:** Marco definido — ejecución IQ/OQ/PQ pre-producción PHI

---

## 1. Alcance

### In scope (validación requerida)

| Módulo | URS ref | Riesgo |
|--------|---------|--------|
| Tenant isolation + auth | SEC-001 | Crítico |
| Audit trail | AUD-001 | Crítico |
| Field-level PHI encryption | CRY-001 | Crítico |
| Clinical evolution CRUD | CLN-001 | Crítico |
| NLP extraction | NLP-001 | Alto |
| Rule engine / screening score | SCR-001 | Crítico |
| OCR lab pipeline | OCR-001 | Alto |

### Out of scope v1 validación formal

- Chat RAG sobre documentos (ya en piloto — validación lite)
- SNOMED annotator (decision support, no decisión clínica)

---

## 2. Documentos de validación

| Documento | Descripción | Estado |
|-----------|-------------|--------|
| **VMP** — Validation Master Plan | Este documento + anexos | ✅ Marco |
| **URS** — User Requirements Specification | Requisitos de usuario | ⬜ Fase 1 |
| **FRS** — Functional Requirements Specification | Requisitos funcionales derivados | ⬜ Fase 1 |
| **DS** — Design Specification | Arquitectura técnica | Parcial (ARCHITECTURE.md) |
| **RA** — Risk Assessment | DPIA + HIPAA + FMEA módulos | Parcial |
| **IQ** — Installation Qualification | Env, keys, DB schema | ⬜ Pre-prod PHI |
| **OQ** — Operational Qualification | Tests funcionales | ⬜ Pre-prod PHI |
| **PQ** — Performance Qualification | UAT con sitio piloto | ⬜ Pre-prod PHI |
| **RTM** — Requirements Traceability Matrix | URS → FRS → Tests | ⬜ Fase 1 |
| **VSR** — Validation Summary Report | Aprobación final | ⬜ |

---

## 3. User Requirements (URS) — borrador

| ID | Requisito | Prioridad | Criterio de aceptación |
|----|-----------|-----------|------------------------|
| URS-001 | Solo usuarios autenticados acceden a PHI | Must | 401 sin auth |
| URS-002 | Aislamiento por org y study | Must | 0% leakage tests |
| URS-003 | Evolución clínica cifrada at-rest | Must | DB muestra payload v1:... |
| URS-004 | Audit log sin contenido PHI | Must | Metadata only en audit_logs |
| URS-005 | Score elegibilidad por criterio | Must | pass/fail/unknown por regla |
| URS-006 | LLM no decide elegibilidad final | Must | Rule engine determinista |
| URS-007 | Confirmación humana OCR labs | Must | requiresHumanReview flow |
| URS-008 | Pseudónimo sujeto sin PII directa | Must | Schema sin name/dni |
| URS-009 | Trazabilidad criterio → protocolo | Must | Citation a sourcePages |
| URS-010 | Retención según sponsor | Must | Política documentada |

---

## 4. Estrategia de testing

| Tipo | Herramienta | Cobertura |
|------|-------------|-----------|
| Unit | Vitest | crypto, rule engine, NLP parser |
| Integration | Vitest + test DB | API routes PHI |
| Leakage | `pnpm test:leakage` | Cross-tenant/study |
| E2E | Manual + Playwright (futuro) | Flujo screening completo |
| UAT | Sitio piloto CINME | PQ |

---

## 5. IQ checklist (pre-prod PHI)

- [ ] `PHI_ENCRYPTION_KEY` configurada en Vercel production
- [ ] Migraciones Fase 1 aplicadas en prod
- [ ] BAAs/DPA firmados (ver tracker)
- [ ] MFA habilitado para roles clínicos
- [ ] Backup PITR Neon verificado
- [ ] Rate limiting activo
- [ ] `ENABLE_INTERNAL_RAG_ANSWER_TEST=false` en prod

---

## 6. OQ test cases (muestra)

| TC | Descripción | Resultado esperado |
|----|-------------|-------------------|
| OQ-001 | Guardar evolución sin auth | 401 |
| OQ-002 | Leer evolución cross-org | 404 |
| OQ-003 | Round-trip encrypt/decrypt | Texto idéntico |
| OQ-004 | Regla HbA1c 7-10%, valor 8.2 | pass |
| OQ-005 | Regla HbA1c 7-10%, valor 6.5 | fail |
| OQ-006 | Metformina no mencionada | unknown |
| OQ-007 | Audit log en save evolution | Row sin content |

---

## 7. Desviaciones y cambios

Toda desviación durante IQ/OQ/PQ se registra en log de validación con:
- ID, descripción, impacto, CAPA, cierre

Cambios post-validación: change control form + impact assessment.

---

## 8. Aprobación para producción PHI

Producción PHI requiere VSR firmado por:
- Quality / CSV Lead
- Clinical Lead  
- Security Officer

---

## 9. Referencias

- FDA 21 CFR Part 11
- EMA Annex 11
- GAMP 5 (ISPE)
- ICH E6(R3) — data integrity
