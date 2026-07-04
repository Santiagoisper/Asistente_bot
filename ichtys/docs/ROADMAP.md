# ROADMAP — ALPHI / ichtys (a finalización)

**Fecha:** 2026-07-04
**Fuentes:** `docs/compliance/README.md`, `docs/compliance/CSV-VALIDATION-PLAN.md`,
`docs/OPERATIONS.md §10`, `CODEX.md`, handoff 2026-07-04.

## Reframe

Los 10 features del handoff ya están en producción (`b33a7fe`); el roadmap de features de
`OPERATIONS.md §10` está prácticamente cerrado. **Lo que queda hasta la finalización no es
código en su mayoría — es regulatorio y de validación**, porque ALPHI va a tocar PHI real
(FDA 21 CFR Part 11, EMA Annex 11, GDPR, HIPAA, ISO 27001/42001).

Dos carriles en paralelo:
- **Ingeniería** — Claude ayuda directo.
- **Compliance / Legal / QA** — Claude redacta borradores; las firmas son humanas.

---

## Etapa 0 — Cierre de features (CASI HECHO)

10/10 implementados y en prod. Queda deuda técnica operativa:

| Item | Estado | Nota |
|---|---|---|
| SD — scheduler stuck docs | ✅ Hecho | `CRON_SECRET` en Vercel + GitHub; workflow horario verificado |
| T2 — Admin UI config RAG | ✅ Hecho | sliders threshold/topK en `/settings` (`13b9d05`) |
| E3 — PDF server-side | Opcional | hoy HTML/Ctrl+P; PDF real solo si el PI/monitor lo exige (cruza Etapa 2) |
| T3-LCS — matching del diff | Bajo | inserciones en el medio |
| E2 — gate por plan | Bloqueado | requiere billing (no existe aún) |

Estimación: Etapa 0 **cerrada** salvo ítems opcionales (E3, T3-LCS, E2).

## Etapa 1 — Compliance Fase 0: gates bloqueantes (PRE-PHI)

**Ningún dato de paciente real entra a prod hasta cerrar esto.** (`docs/compliance/README.md`)

| # | Bloqueante | Carril |
|---|---|---|
| 8 | DPA/BAA firmados con procesadores (Neon, Vercel, Anthropic, Clerk) | Legal |
| 9 | DPIA (GDPR) — revisión legal (si UE) | Legal |
| 10 | HIPAA Risk Assessment — revisión legal (si US) | Legal |
| 15 | `PHI_ENCRYPTION_KEY` en prod (Vercel) | ✅ Hecho (2026-07-04) |
| — | Revisión interna firmada = criterio de salida | Interno |

El resto de la checklist Fase 0 (clasificación de datos, políticas PHI, pseudonimización,
retención, backup/DR, cifrado field-level) ya está documentado/implementado.

## Etapa 2 — Validación CSV / GAMP 5 (PRE-PRODUCCIÓN PHI)

Corazón de 21 CFR Part 11 / EMA Annex 11 (`CSV-VALIDATION-PLAN.md`). Secuencia:

1. **Docs Fase 1:** URS → FRS → RTM (matriz de trazabilidad). Hoy borrador.
2. **Risk Assessment** por módulo (FMEA). Parcial.
3. **IQ** — Installation Qualification: env, keys, schema DB en prod.
4. **OQ** — Operational Qualification: tests funcionales de módulos críticos —
   tenant isolation (SEC-001), audit (AUD-001), cifrado PHI (CRY-001),
   clinical CRUD (CLN-001), rule engine/screening (SCR-001), OCR labs (OCR-001).
5. **PQ** — Performance Qualification: UAT con **sitio piloto real**.
6. **VSR** — Validation Summary Report firmado = producto validado.

Chat RAG y annotator SNOMED → "validación lite" (decision support, no decisión clínica;
out of scope de validación formal v1). Claude aporta en OQ (tests) y trazabilidad.

## Etapa 3 — Fase 1 producción con PHI / Go-live piloto

Con Etapas 1 y 2 cerradas: primer sitio piloto con datos reales, backup/DR probado en vivo,
procedimiento de notificación de brechas activo, monitoreo operativo (`OPERATIONS.md`).

## Etapa 4 — Escala y post-go-live

Multi-sitio; certificaciones formales hoy "lite" → ISO 27001 certificado, 27701, ISO 42001;
features nuevas del uso real (E3 PDF trazable, billing para E2).

---

## Camino crítico

El cuello de botella **no es el código** — es la firma de DPA/BAA (#8) y la revisión legal
DPIA/HIPAA (#9/#10), de terceros y lentas. **Arrancar esos trámites YA, en paralelo** con la
ingeniería (Etapa 0) y la redacción de docs de validación (Etapa 2). Esperar a terminar el
código para recién mover lo legal estira el proyecto meses por algo que no depende de teclear.

## Límite de visibilidad

Este roadmap cubre el marco técnico/regulatorio visible en el repo. **No incluye el timeline
de negocio** (cuándo firma cada procesador, qué sitio piloto, jurisdicción activa UE vs US).
Eso define fechas reales y es decisión de CINME / Innova Trials.

---

### Orden recomendado de ejecución
1. ~~Deploy SD + T2 (Etapa 0)~~ — **cerrado** 2026-07-04.
2. Iniciar trámites legales Etapa 1 (#8/#9/#10) en paralelo — **hoy**.
3. ~~Setear `PHI_ENCRYPTION_KEY` en prod (Etapa 1 #15)~~ — **hecho**.
4. Redactar URS/FRS/RTM (Etapa 2) — borradores v0.1 en curso.
5. OQ tests → PQ piloto → VSR → go-live (Etapas 2–3).
