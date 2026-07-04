# ALPHI / Ichtys — Pitch deck (contenido slide-by-slide)

> Convertir a Google Slides / PowerPoint. **No inflar claims.** Fuentes: PRD, GTM-PACIENTRY-TAKEAWAYS, ROADMAP, demo-metrics.

---

## Slide 1 — Título

**ALPHI (Ichtys)**  
Asistente documental clínico con RAG para ensayos regulados

*Respuestas grounded con citas exactas sobre protocolos, IBs y manuales — solo desde documentos cargados.*

CINME / Innova Trials · Julio 2026

---

## Slide 2 — Problema

Los equipos de sitio (CRC, enfermería, PI) pierden **tiempo crítico** buscando en documentos de **200–400 páginas**:

- Paciente en sala — no pueden salir 15 min a buscar en el PDF
- Monitor pide **evidencia trazable** de una decisión
- Onboarding de staff nuevo en estudios complejos
- AE/SAE — verificar **timelines de reporte** en minutos

*Fuente: PRD §2*

---

## Slide 3 — Categoría (mapa competitivo)

| | Pacientry | ALPHI / Ichtys | CTMS clásico |
|---|-----------|----------------|--------------|
| **Qué hace** | Epicrisis, CIE-11, OCR self-serve | RAG + citas sobre docs de ensayo | Operaciones trial end-to-end |
| **Buyer** | Médico individual | Sponsor / CRO / red | Enterprise pharma |
| **Regulación** | ToS "experimental" | Framework compliance + CSV roadmap | Part 11 maduro |
| **Precio** | USD 0.59/epicrisis, USD 149/mes | Contrato B2B (ver /pricing) | Enterprise |

**Tesis:** categorías distintas; solo se tocan en screening paciente↔ensayo.

---

## Slide 4 — Gap que Pacientry no puede cruzar

- **Trial-ops regulado** exige trazabilidad, audit trail, tenant isolation, validación CSV
- Pacientry declina responsabilidad clínica (ToS experimental) — válido para su mercado
- **ALPHI apuesta al nicho difícil:** grounding-only, citas obligatorias, compliance real (en construcción)

*No decir "certificado Part 11" — decir "framework alineado, validación en progreso"*

---

## Slide 5 — Demo (live o video)

**Estudio mock:** MOCK-METABOLIC-T2D-v1 (sin PHI)

Mostrar en chat:
1. *¿HbA1c 9% cumple inclusión?* → cita §3.1
2. *¿Metformina permitida?* → cita §3.5 con condiciones
3. *¿Procedimientos visita 4?* → cita §3.3

**Diferenciador visible:** botón de cita → documento fuente

---

## Slide 6 — Producto (3 pilares)

1. **Chat RAG** — preguntas operacionales con citas; sin evidencia → insufficient_evidence
2. **Study spec** — extracción estructurada del protocolo (criterios, endpoints, visitas)
3. **Screening orientativo** — reglas deterministas vs spec aprobado; PI decide

Stack: Next.js 15 · Neon/pgvector · Clerk · Vercel · multi-LLM con fallback

---

## Slide 7 — Foso (moat)

- **Grounding-only** — contrato de producto, no marketing
- **13 políticas** compliance documentadas + implementación (AES-256-GCM, audit log)
- **Aislamiento org+study** antes del retrieval — leakage 0% es gate bloqueante
- **Barrera regulatoria** — años para un competidor self-serve sin CSV/GCP

Trust Center público: `/trust`

---

## Slide 8 — Estado honesto + roadmap

**Hoy (Fase 0):**
- MVP funcional en prod · **sin PHI real**
- Features producto ~completos para piloto mock
- CSV formal, DPAs firmados, go-live PHI → **post-inversión**

**Roadmap (ROADMAP.md):**
- Etapa 0: deuda técnica menor (cron SD ✓, admin RAG)
- Etapa 1: gates legales (DPA/BAA, DPIA, HIPAA)
- Etapa 2: CSV IQ/OQ/PQ
- Etapa 3: piloto con PHI

---

## Slide 9 — Métricas (eval interna mock)

| Métrica | Target / estado |
|---------|-----------------|
| Citation correctness | > 90% |
| Leakage cross-study/org | 0% (bloqueante) |
| Latencia P90 chat | < 4 s |
| Smoke demo 6Q | ≥ 5/6 PASS |

*Completar con resultados reales post-`pnpm evals:mock-metabolic` — no inventar pass rate.*

Calculadora ROI: `/roi` (estimaciones operacionales, no clínicas)

---

## Slide 10 — Modelo comercial

- **Unidad:** por estudio activo o sitio/red — no por usuario
- **Buyer:** sponsor, CRO, red
- **Pilot → Enterprise** con DPA/BAA
- Pre-revenue · pricing indicativo en `/pricing`

---

## Slide 11 — Ask

**Capital para:**
1. **Cerrar validación CSV** + gates compliance (DPAs, DPIA, PHI key)
2. **Superficie GTM** (demo, trust, pilotos)
3. **Primer piloto pagado** con sponsor LATAM cardiometabólico

**No ask para:** inflar headcount sin plan CSV; marketing genérico sin producto.

---

## Slide 12 — Contacto

**Santiago Isbert**  
sisbert@cinme.com.ar  

Demo: estudio mock T2D · Trust: asistente-bot-five.vercel.app/trust

*Gracias — Q&A*
