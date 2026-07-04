# VSR — Validation Summary Report

**Producto:** ALPHI / Ichtys — módulo clínico + asistente documental  
**Versión:** 1.0  
**Fecha:** 2026-07-04  
**Estado:** Borrador para firma post-PQ

---

## 1. Resumen ejecutivo

| Fase | Resultado | Evidencia |
|------|-----------|-----------|
| **IQ** | PASS | `pnpm iq:check` 11/11; PHI key prod; schema Fase 1 |
| **OQ** | PASS | `pnpm test:oq` 29 tests CI |
| **IT** | PASS | `pnpm test:integration` 4 tests (Neon) |
| **PQ** | Pendiente ejecución | [PQ.md](./PQ.md) — piloto CINME |
| **Legal Fase 0** | PASS | DPA/BAA, DPIA, HIPAA RA aprobados 2026-07-04 |

**Conclusión preliminar:** El sistema está **calificado para OQ/IQ** y listo para **ejecución PQ**. Go-live PHI real requiere PQ PASS + firmas §6.

---

## 2. Alcance validado

In scope: auth, tenant isolation, cifrado PHI, evoluciones, subjects, profile, screening determinista, labs OCR human-in-the-loop, audit trail, cron SD, org RAG config.

Out of scope v1: chat RAG como sistema validado de decisión clínica; OCR PDF escaneado (Azure DI); SNOMED annotator formal.

---

## 3. Desviaciones

| ID | Descripción | Impacto | Estado |
|----|-------------|---------|--------|
| — | Ninguna crítica registrada en OQ/IT | — | — |

Ver [VALIDATION-DEVIATION-LOG.md](./VALIDATION-DEVIATION-LOG.md) para registro continuo.

---

## 4. Trazabilidad

Matriz completa: [RTM.md](./RTM.md) — URS-001 a URS-012 con evidencia OQ/IT/e2e.

Risk assessment: [FMEA.md](./FMEA.md), [HIPAA-RISK-ASSESSMENT.md](./HIPAA-RISK-ASSESSMENT.md), [DPIA.md](./DPIA.md).

---

## 5. Ambiente validado

| Componente | Versión / ref |
|------------|---------------|
| App prod | https://asistente-bot-five.vercel.app |
| Repo | `Santiagoisper/Asistente_bot` main |
| DB | Neon `fragrant-sun-79639780` |
| Commit referencia OQ | `9b98004` (URS-007) + docs `569acea` |

---

## 6. Aprobaciones (pendiente post-PQ)

| Rol | Nombre | Fecha | Firma |
|-----|--------|-------|-------|
| Quality / CSV Lead | | | |
| Clinical Lead | | | |
| Security Officer | | | |

---

## 7. Próximos pasos

1. Ejecutar [PQ.md](./PQ.md) con 5 usuarios piloto.
2. Registrar resultados y desviaciones.
3. Firmar este VSR.
4. Go-live Etapa 3 — PHI real bajo protocolo del sitio.
