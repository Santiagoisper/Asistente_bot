# ALPHI / Ichtys — Posición regulatoria y de cumplimiento

**Documento para accionistas y due diligence**  
**Fecha:** 2026-07-04  
**Producto:** Asistente documental clínico multi-tenant (RAG + módulo PHI)  
**Sitio piloto previsto:** CINME / Innova Trials  
**Producción:** https://asistente-bot-five.vercel.app  
**Clasificación:** Confidencial — uso interno / inversores

---

## 1. Resumen ejecutivo — dónde estamos parados

ALPHI **no está certificado** bajo ningún marco regulatorio formal. Lo que sí existe es una **base documental y técnica verificable**, construida de forma deliberada antes de procesar PHI real de pacientes — una barrera que la mayoría de competidores self-serve no tienen.

### Posición global (julio 2026)

| Dimensión | Estado | % estimado* |
|-----------|--------|-------------|
| **Producto MVP (features)** | ✅ Cerrado en prod | ~95 % |
| **Fase 0 legal / privacidad** | ✅ Cerrada 2026-07-04 | ~90 % |
| **Validación CSV (Part 11 / Annex 11)** | 🟡 En curso | ~70 % |
| **Go-live PHI real (sitio piloto)** | 🔴 Bloqueado por PQ + VSR | ~0 % ejecutado |
| **Certificaciones ISO** | 🔴 Lite documentado, sin auditor | ~35 % |

\*Porcentaje = madurez del **programa de cumplimiento**, no certificación oficial.

### Mensaje clave para accionistas

> **Tenemos el código, la documentación y las pruebas automatizadas.**  
> **Nos falta cerrar la validación en sitio (PQ), firmar el VSR y asignar roles de gobernanza.**  
> Eso es semanas/meses de proceso humano y piloto — no años de desarrollo.

### Lo que NO debemos decir externamente

- “Certificado FDA Part 11” / “Validado EMA Annex 11”
- “ISO 27001 / 27701 / 42001 certified”
- “100 % compliant GDPR/HIPAA”
- “Listo para cualquier ensayo multicéntrico global”

### Lo que SÍ podemos decir (con evidencia en repo)

- “Framework alineado con Part 11, Annex 11, GCP, GDPR e HIPAA”
- “Fase 0 compliance cerrada; validación CSV IQ/OQ/IT completada con evidencia automatizada”
- “Controles técnicos auditables: aislamiento multi-tenant, cifrado PHI field-level, audit trail, 29 tests OQ en CI”
- “BAAs/DPA firmados con todos los procesadores críticos (Neon, Vercel, Clerk, Anthropic, OpenAI)”

---

## 2. Mapa del programa (4 etapas)

```
Etapa 0 — Features MVP          ████████████████████  CERRADA (2026-07-04)
Etapa 1 — Fase 0 legal/pre-PHI  ██████████████████░░  CERRADA (2026-07-04)
Etapa 2 — Validación CSV/GAMP   ██████████████░░░░░░  EN CURSO (~70 %)
Etapa 3 — Go-live PHI piloto     ░░░░░░░░░░░░░░░░░░░░  PENDIENTE (post-PQ)
Etapa 4 — Escala + ISO formal   ░░░░░░░░░░░░░░░░░░░░  ROADMAP 2026–2027
```

| Etapa | Objetivo | Estado |
|-------|----------|--------|
| **0** | MVP funcional en producción | ✅ Cerrada |
| **1** | Gates legales antes de PHI real | ✅ Cerrada 2026-07-04 |
| **2** | Validación CSV (Part 11 / Annex 11) | 🟡 IQ/OQ/IT OK; PQ y VSR pendientes |
| **3** | Primer sitio con datos reales de sujetos | 🔴 Bloqueada por Etapa 2 |
| **4** | Multi-sitio + certificaciones ISO | 🔴 Planificado |

Referencia: [`ROADMAP.md`](../ROADMAP.md)

---

## 3. Matriz por marco regulatorio

### Leyenda

| Símbolo | Significado |
|---------|-------------|
| ✅ | Completado / evidencia disponible |
| 🟡 | En progreso / parcial |
| 🔴 | No iniciado o bloqueado |
| ⬜ | No aplica certificación formal (solo alineación) |

---

### 3.1 FDA 21 CFR Part 11 (sistemas electrónicos, registros clínicos)

| Ítem | Estado | Evidencia |
|------|--------|-----------|
| Plan de validación CSV (GAMP 5) | ✅ | `CSV-VALIDATION-PLAN.md` v1.0 |
| URS / FRS / RTM | ✅ v1.0 | Trazabilidad URS-001..012 |
| FMEA / risk assessment | ✅ | `FMEA.md` |
| Audit trail | ✅ | `audit_logs` + política |
| Control de acceso / firmas electrónicas | 🟡 | Clerk auth; e-sign formal limitado |
| IQ (instalación) | ✅ | `pnpm iq:check` 11/11 |
| OQ (operacional) | ✅ | 29 tests automatizados CI |
| IT (integración DB) | ✅ | 4 tests Neon real |
| PQ (rendimiento en sitio) | 🔴 | Protocolo listo; **no ejecutado** |
| VSR (informe resumen validación) | 🔴 | Borrador; **sin firmas** |
| **Validación formal Part 11** | 🔴 | **No completada** |

**Madurez estimada:** ~70 % del camino CSV; **0 % certificación FDA** (FDA no certifica software — la califica el sponsor con CSV).

**Próximo hito:** PQ piloto CINME (10 casos clínicos + 4 RAG) → firma VSR.

---

### 3.2 EMA Annex 11 (UE — sistemas computarizados)

| Ítem | Estado | Notas |
|------|--------|-------|
| Marco CSV compartido con Part 11 | ✅ | Mismo paquete GAMP |
| Backup / DR documentado | ✅ | `BACKUP-AND-DR.md` |
| Segregación de funciones | 🟡 | Diseñada; roles no asignados |
| Validación formal Annex 11 | 🔴 | Igual que Part 11 — PQ + VSR pendientes |

**Madurez estimada:** ~65 % (mismo carril que Part 11; sin informe de calificación UE firmado).

---

### 3.3 ICH E6 GCP (Good Clinical Practice)

| Ítem | Estado | Notas |
|------|--------|-------|
| Política manejo PHI / ALCOA+ | ✅ | `PHI-HANDLING-POLICY.md` |
| Pseudonimización | ✅ | `PSEUDONYMIZATION-POLICY.md` |
| Retención de registros | ✅ | `DATA-RETENTION-POLICY.md` |
| Gobernanza IA (no decisión clínica automática) | ✅ | Rule engine determinista; LLM no decide elegibilidad |
| Capacitación GCP usuarios piloto | 🔴 | Responsabilidad del sitio |
| SOP operativos del centro | 🔴 | Fuera del software |
| **Cumplimiento GCP del sitio** | ⬜ | ALPHI **apoya**, no **sustituye** al centro |

**Madurez estimada:** ~60 % en **alineación del producto**; el GCP operacional del sitio es independiente.

---

### 3.4 GDPR (Unión Europea)

| Ítem | Estado | Evidencia |
|------|--------|-----------|
| DPIA | ✅ Aprobado 2026-07-04 | `DPIA.md` |
| DPA con procesadores | ✅ | Neon, Vercel, Clerk, Anthropic, OpenAI, Upstash |
| Política retención / minimización | ✅ | `DATA-RETENTION-POLICY.md` |
| Procedimiento brechas (72h) | ✅ | `BREACH-NOTIFICATION-PROCEDURE.md` |
| Cifrado y pseudonimización | ✅ | `@ichtys/crypto` + políticas |
| DPO designado | 🔴 | Pendiente asignación |
| Registro de actividades de tratamiento (Art. 30) | 🟡 | Parcial en docs |
| Procedimiento derechos interesados (Art. 15–22) | 🟡 | Política existe; operación no probada |
| **Certificación GDPR** | ⬜ | **No existe** — cumplimiento demostrable, no sello |

**Madurez estimada:** ~80 % documentación; ~50 % operacionalización.

---

### 3.5 HIPAA (Estados Unidos)

| Ítem | Estado | Evidencia |
|------|--------|-----------|
| Security Risk Assessment | ✅ Aprobado 2026-07-04 | `HIPAA-RISK-ASSESSMENT.md` |
| BAA con procesadores PHI | ✅ | Tracker 100 % procesadores críticos |
| Cifrado at-rest PHI | ✅ | AES-256-GCM field-level |
| Access controls | ✅ | Clerk + RBAC org/study |
| Security Officer designado | 🔴 | Pendiente |
| Workforce training HIPAA | 🔴 | No implementado |
| Auditoría HHS / OCR | ⬜ | No solicitada |
| **Certificación HIPAA** | ⬜ | **No existe** — cumplimiento organizacional |

**Madurez estimada:** ~75 % documentación/contratos; ~40 % programa operativo continuo.

---

### 3.6 ISO 27001 (Seguridad de la información)

| Ítem | Estado | Evidencia |
|------|--------|-----------|
| ISMS lite documentado | ✅ | `ISMS-OVERVIEW.md` |
| Políticas Annex A (subset) | 🟡 | ~60 % controles con evidencia |
| Roles ISMS (Manager, Auditor interno) | 🔴 | Pendientes |
| Auditoría externa / certificación | 🔴 | Roadmap 2027 |
| SOC 2 Type I readiness | 🟡 | Objetivo 2026-12 |

**Madurez estimada:** ~35 % camino a certificación; ~55 % controles técnicos ya implementados.

Controles Annex A (resumen):

| Control | Estado |
|---------|--------|
| A.5 Políticas | ✅ |
| A.6 Organización | 🔴 roles pendientes |
| A.8 Activos | 🟡 |
| A.9 Acceso | ✅ |
| A.10 Criptografía | ✅ |
| A.12 Operaciones | 🟡 |
| A.13 Comunicaciones | ✅ |
| A.14 Desarrollo | 🟡 |
| A.16 Incidentes | ✅ |
| A.17 Continuidad | 🟡 |
| A.18 Cumplimiento | 🟡 |

---

### 3.7 ISO 27701 (Privacidad — extensión 27001)

| Ítem | Estado |
|------|--------|
| PIMS / extensión formal | 🔴 No iniciada |
| Piezas reutilizables (DPIA, retención, pseudonimización) | ✅ |
| Roadmap extensión | 🟡 Objetivo 2027-12 (si UE activa) |

**Madurez estimada:** ~25 % (documentos base; sin SGIP montado).

---

### 3.8 ISO 42001 (Gestión de sistemas IA)

| Ítem | Estado |
|------|--------|
| Política gobernanza IA | ✅ `AI-GOVERNANCE.md` (lite) |
| Inventario de sistemas IA | 🟡 Parcial |
| Evaluación riesgos IA (FMEA módulos LLM) | ✅ |
| Certificación 42001 | 🔴 No planificada antes de 27001 |

**Madurez estimada:** ~30 % (lite operacional; sin SMSI IA formal).

---

## 4. Evidencia técnica verificable (julio 2026)

Auditoría automatizada: [`ALPHI_FULL_AUDIT_2026-07-04.md`](../audits/ALPHI_FULL_AUDIT_2026-07-04.md)

| Gate | Resultado | Fecha |
|------|-----------|-------|
| `validate:product` | **7/7 OK** | 2026-07-04 |
| OQ tests módulo clínico | **29/29 PASS** | CI en cada push |
| IT tests PHI (Neon) | **4/4 PASS** | 2026-07-04 |
| IQ env + schema | **11/11 OK** | 2026-07-04 |
| E2E RAG eval (SM-001..012) | **12/12 PASS** | 2026-07-04 |
| Smoke PHI producción | **OK** (create + delete) | 2026-07-04 |
| GitHub CI `main` | **Verde** | commit `007b50f` |
| Cross-tenant leakage | **0 fallos** | test suite |

### Procesadores con contratos firmados

| Proveedor | DPA | BAA |
|-----------|-----|-----|
| Neon (DB) | ✅ | ✅ |
| Vercel (hosting) | ✅ | ✅ |
| Clerk (auth) | ✅ | N/A |
| Anthropic (LLM) | ✅ | ✅ |
| OpenAI (embeddings) | ✅ | ✅ |
| Upstash (rate limit) | ✅ | N/A |

PDFs archivados fuera de git (repositorio seguro sponsor).

---

## 5. Bloqueadores actuales (camino crítico)

| # | Bloqueador | Impacto | Owner sugerido | Estimación |
|---|------------|---------|----------------|------------|
| 1 | **PQ no ejecutado** (5 usuarios piloto) | Bloquea VSR y go-live PHI | Clinical Lead + QA | 2–4 semanas |
| 2 | **VSR sin firmas** (Quality, Clinical, Security) | Bloquea declaración “sistema calificado” | CSV Lead | 1 semana post-PQ |
| 3 | **Roles compliance sin asignar** (DPO, Security Officer, CSV Lead) | Debilidad en due diligence ISO/GDPR | Board / CINME | Inmediato |
| 4 | **Design Specification parcial** | Gap GAMP vs URS/FRS | Engineering + QA | 2–3 semanas |
| 5 | **Chat RAG out of scope CSV v1** | Parte del producto en “validación lite” | Product + QA | Decisión con inversores |

---

## 6. Roadmap hacia hitos clave

| Hito | Prerequisitos | Estado |
|------|---------------|--------|
| **H1 — Cierre CSV Etapa 2** | PQ PASS + VSR firmado | 🟡 En curso |
| **H2 — Go-live PHI piloto (1 sitio)** | H1 + backup/DR probado + breach procedure activo | 🔴 Pendiente |
| **H3 — SOC 2 Type I readiness** | ISMS operativo + roles asignados | 🟡 Q4 2026 |
| **H4 — ISO 27001 gap assessment** | H3 + auditor externo | 🔴 H1 2027 |
| **H5 — ISO 27701 extension** | H4 + operación UE activa | 🔴 H2 2027 |
| **H6 — Multi-sitio / escala** | H2 + billing + soporte | 🔴 Post-piloto |

**Nota:** Las fechas de negocio (firma procesadores, sitio piloto, jurisdicción UE vs US) dependen de decisiones de CINME/Innova Trials, no solo de ingeniería.

---

## 7. Riesgos para accionistas

| Riesgo | Probabilidad | Impacto | Mitigación |
|--------|--------------|---------|------------|
| Retraso PQ por disponibilidad usuarios piloto | Media | Alto | Agendar ventana CINME; protocolo ya escrito |
| Due diligence inversor exige certificación ISO | Alta | Medio | Posicionar “ISMS lite + CSV en curso”; roadmap SOC2/ISO |
| Competidor claim “AI para trials” sin CSV | Alta | Bajo (a mediano plazo) | Barrera: años replicar documentación + tests + BAAs |
| Breach PHI pre-go-live | Baja | Crítico | Sin PHI real hasta PQ+VSR; cifrado y leakage tests |
| Cambio regulatorio (ICH E6 R3) | Media | Medio | Revisión trimestral programada (2026-09-30) |

---

## 8. Ventaja competitiva (tesis para accionistas)

1. **Profundidad vs velocidad:** Herramientas genéricas (ChatGPT, Notion AI, etc.) optimizan time-to-market, no trazabilidad GCP ni CSV.
2. **Evidencia en repo:** 29 tests OQ, RTM, FMEA, gate unificado — auditable por QA de un sponsor.
3. **Contratos procesadores:** BAAs/DPA cerrados antes de PHI — requisito bloqueante para pharma seria.
4. **Barrera de tiempo:** Replicar este paquete compliance + validación = **12–24 meses** para un entrante sin equipo QA/CSV dedicado.

---

## 9. Glosario rápido

| Término | Qué significa para ALPHI |
|---------|-------------------------|
| **CSV** | Computer System Validation — proceso GAMP para demostrar que el sistema hace lo que debe |
| **IQ/OQ/IT/PQ** | Instalación / Operacional / Integración / Rendimiento (en sitio real) |
| **VSR** | Informe final que resume toda la validación — requiere firmas |
| **PHI** | Protected Health Information — datos de salud identificables |
| **BAA / DPA** | Contratos legales con procesadores (HIPAA / GDPR) |
| **ISMS lite** | Sistema de gestión de seguridad documentado, sin certificación ISO |

---

## 10. Referencias internas

| Documento | Ruta |
|-----------|------|
| Compliance overview | `docs/compliance/README.md` |
| Roadmap programa | `docs/ROADMAP.md` |
| Plan CSV | `docs/compliance/CSV-VALIDATION-PLAN.md` |
| VSR (borrador) | `docs/compliance/VSR.md` |
| PQ (protocolo) | `docs/compliance/PQ.md` |
| Auditoría jul 2026 | `docs/audits/ALPHI_FULL_AUDIT_2026-07-04.md` |
| One-pager due diligence | `docs/pitch/compliance-one-pager.md` |

---

## 11. Aprobación del documento

| Rol | Nombre | Fecha | Firma |
|-----|--------|-------|-------|
| CEO / Sponsor | | | |
| Quality / CSV Lead | | | |
| Legal / DPO | | | |

---

*Última actualización: 2026-07-04. Revisión trimestral programada: 2026-09-30.*
