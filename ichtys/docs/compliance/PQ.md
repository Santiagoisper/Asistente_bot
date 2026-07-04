# PQ — Performance Qualification (UAT piloto)

**Versión:** 1.0  
**Fecha:** 2026-07-04  
**Estado:** Protocolo listo — ejecución piloto CINME/Innova  
**Sitio piloto:** INNOVA TRIALS (org demo → piloto interno 5 usuarios)  
**Referencia operativa:** [pilot-cinme-checklist.md](../evals/pilot-cinme-checklist.md)

---

## 1. Objetivo

Demostrar que el sistema cumple URS en condiciones operativas representativas del uso real del sitio piloto, **después** de IQ + OQ automatizados.

---

## 2. Prerequisitos

| Prerequisito | Evidencia |
|--------------|-----------|
| Fase 0 legal cerrada | [README.md](./README.md), DPA-BAA tracker ✅ |
| IQ schema + env | `pnpm iq:check` 11/11 |
| OQ automatizado | `pnpm test:oq` 29/29 en CI |
| IT DB | `pnpm test:integration` 4/4 |
| Gate producto | `pnpm validate:product` 7/7 |
| Prod desplegado | https://asistente-bot-five.vercel.app |
| Estudio mock o piloto | MOCK-METABOLIC-T2D-v1 + spec aprobado |

---

## 3. Casos PQ — módulo clínico (PHI)

| PQ-ID | URS | Escenario | Pasos | Resultado esperado | Pass/Fail |
|-------|-----|-----------|-------|-------------------|-----------|
| PQ-C01 | URS-001 | Login requerido | Abrir `/studies/.../subjects` sin sesión | Redirect login / 401 API | |
| PQ-C02 | URS-008 | Crear sujeto | POST subject code único | 201, perfil vacío cifrado | |
| PQ-C03 | URS-003 | Evolución clínica | Guardar texto con HbA1c 8.2% | Evolución cifrada; perfil actualizado | |
| PQ-C04 | URS-005 | Screening | Abrir screening con spec aprobado | Assessments pass/fail/unknown coherentes | |
| PQ-C05 | URS-006 | No LLM en screening | Verificar assessments = reglas perfil | Sin variación entre recargas | |
| PQ-C06 | URS-007 | Labs OCR extract | Pegar texto lab → extract | pendingLabReview; labs[] vacío | |
| PQ-C07 | URS-007 | Labs OCR confirm | Confirmar revisión | labs en perfil; pending cleared | |
| PQ-C08 | URS-007 | Labs OCR reject | Reject tras extract | pending cleared; labs sin cambio | |
| PQ-C09 | URS-004 | Audit | Revisar audit_logs post PQ-C02–C08 | Sin content PHI en metadata | |
| PQ-C10 | URS-002 | Aislamiento | Usuario org B intenta sujeto org A | 404 / sin datos | |

---

## 4. Casos PQ — RAG documental (lite)

| PQ-ID | Escenario | Criterio |
|-------|-----------|----------|
| PQ-R01 | 10 preguntas elegibilidad | ≥80% con citas útiles |
| PQ-R02 | Pregunta sin evidencia | `insufficient_evidence`, sin invención |
| PQ-R03 | Apertura cita | Página correcta < 15s |
| PQ-R04 | Leakage manual | 0 cross-study en prueba deliberada |

Detalle en [pilot-cinme-checklist.md](../evals/pilot-cinme-checklist.md).

---

## 5. Criterio de aceptación PQ

PQ **PASS** si:

- 10/10 casos PQ-C01–C10 PASS
- PQ-R01–R04 según checklist piloto (≥80% citas, 0 leakage)
- 0 desviaciones críticas abiertas en [VALIDATION-DEVIATION-LOG.md](./VALIDATION-DEVIATION-LOG.md)

---

## 6. Roles

| Rol | Responsabilidad |
|-----|-----------------|
| CRC / Enfermería | Ejecutar PQ-C02–C08 |
| Monitor | PQ-C10, PQ-R04 |
| CSV Lead | Consolidar evidencia, firmar PQ |
| Clinical Lead | Aprobar casos clínicos |

---

## 7. Evidencia a archivar

- Capturas / CSV anonimizado (no commitear PHI en git)
- Fecha, ejecutor, versión deploy (commit hash)
- Resultado global: PASS / FAIL
