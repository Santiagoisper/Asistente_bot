# URS — User Requirements Specification (v0.1 borrador)

**Producto:** ALPHI / Ichtys — módulo clínico de sujetos  
**Versión:** 0.1  
**Fecha:** 2026-07-04  
**Estado:** Borrador — pendiente revisión QA / Clinical Lead  
**Trazabilidad:** Ver [RTM.md](./RTM.md)

---

## 1. Propósito

Definir requisitos de usuario para el procesamiento de datos clínicos de sujetos en ensayos, alineados con ICH E6 GCP, GDPR y HIPAA (cuando aplique).

## 2. Alcance

In scope: autenticación, aislamiento multi-tenant, cifrado PHI, evoluciones clínicas, screening determinista, audit trail, pseudonimización.

Out of scope v1: chat RAG como decisión clínica, SNOMED annotator como sistema validado.

## 3. Requisitos

| ID | Requisito | Prioridad | Criterio de aceptación |
|----|-----------|-----------|------------------------|
| URS-001 | Solo usuarios autenticados acceden a PHI | Must | 401/403 sin sesión Clerk válida |
| URS-002 | Aislamiento por organización y estudio | Must | 0% leakage en `pnpm test:leakage` |
| URS-003 | Evolución y perfil cifrados at-rest | Must | Payload `v1:...` en DB; round-trip idéntico |
| URS-004 | Audit log sin contenido PHI | Must | `audit_logs.metadata` sin texto clínico |
| URS-005 | Score elegibilidad por criterio | Must | pass / fail / unknown por regla |
| URS-006 | LLM no decide elegibilidad final | Must | Rule engine determinista (`screening-engine`) |
| URS-007 | Confirmación humana OCR labs | Must | `requiresHumanReview` antes de persistir |
| URS-008 | Pseudónimo sujeto sin PII directa | Must | Schema sin name/DNI; solo `subject_code` |
| URS-009 | Trazabilidad criterio → protocolo | Must | `sourcePages` en assessments |
| URS-010 | Retención según sponsor | Must | Política en DATA-RETENTION-POLICY.md |
| URS-011 | Recuperación docs atascados en ingesta | Should | Cron SD marca stuck >60 min como error |
| URS-012 | Config RAG por org sin redeploy | Should | Sliders threshold/topK en `/settings` |

## 4. Usuarios objetivo

| Rol | Necesidad principal |
|-----|---------------------|
| CRC / Enfermería | Registrar evolución, ver screening |
| Study Admin | Gestionar sujetos, aprobar specs |
| Monitor | Solo lectura auditada |
| Org Admin | Keys LLM, config RAG |

## 5. Aprobaciones (pendiente)

| Rol | Nombre | Fecha | Firma |
|-----|--------|-------|-------|
| Clinical Lead | | | |
| Quality / CSV Lead | | | |
| Security Officer | | | |
