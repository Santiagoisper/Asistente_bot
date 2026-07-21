# Roadmap de excelencia — ALPHI / ichtys

**Fecha:** 2026-07-04
**Objetivo:** llevar ALPHI a ser el software clínico documental más profesional y competitivo
del mercado, sin romper el stack que ya funciona.
**Regla de oro (no negociable):** todo componente que toque **PHI** debe ser **BAA/DPA-capable
o self-hosted**. Ante la duda: self-host open-source. Esto filtra el "mejor del mercado"
genérico y lo vuelve correcto para un producto regulado.

> No comprar 15 herramientas hoy. Cada fila tiene **prioridad**: P0 = ahora / barato,
> P1 = pre-producción con PHI (post-inversión), P2 = escala. Secuenciar por ROI y por lo que
> exige compliance, no por FOMO.

---

## Stack actual (lo que NO se toca porque anda)
Next.js 15 · Neon Postgres + pgvector · Clerk Orgs · Vercel Blob · Vercel hosting ·
GitHub Actions · Drizzle · Anthropic SDK (Sonnet/Haiku) + fallback Gemini · Vercel AI SDK ·
pdf-parse/pdfjs · Turborepo/pnpm. **Se agrega y se mejora sobre esto.**

---

## 1. Ingesta & OCR de documentos
Hoy: `pdf-parse`/`pdfjs` → solo PDFs con texto. Gap: protocolos/manuales **escaneados**,
tablas densas, layouts multicolumna, formularios firmados.

| Herramienta | Rol | PHI | Costo | Prioridad |
|---|---|---|---|---|
| **Docling** (IBM, OSS, self-host) | PDFs digitales limpios, tablas con bordes | ✅ self-host | Gratis | **P0** |
| **Reducto** | Tablas complejas, escaneos, manuscritos; **on-prem + SOC2 Type II + HIPAA + zero-retention** | ✅ BAA/on-prem | ~$0.01–0.03/pág | **P1** (el pick regulado) |
| **Azure AI Document Intelligence** | Forms/tablas, BAA disponible | ✅ BAA | ~$0.01–0.05/pág | P1 alt |
| **AWS Textract** / **Google Document AI** | Alternativas cloud con BAA | ✅ BAA | similar | P1 alt |
| **Mistral OCR 3** (batch) | Barato para volumen no-PHI (demo, docs públicos) | ⚠️ no-PHI | $0.001/pág | P2 |
| Tesseract / PaddleOCR / Surya | Baseline OSS | ✅ self-host | Gratis | fallback |

**Recomendación:** Docling self-host para el 80% (PHI-safe, gratis) + **Reducto** para el 20%
difícil (escaneos/tablas) por su HIPAA + on-prem. Veryfi (que apareció en análisis previos) es
para tickets/facturas — **no** para docs clínicos, descartar.

## 2. Calidad RAG (el corazón competitivo)
Hoy: pgvector IVFFlat + retriever propio + guardrails + chunking section-aware. Ya tenés
`reindex-hnsw.ts` en marcha (bien).

| Mejora | Herramienta | PHI | Prioridad |
|---|---|---|---|
| Índice IVFFlat → **HNSW** (mejor recall) | pgvector nativo | ✅ | **P0** (ya empezado) |
| **Reranking** post-retrieval | **Voyage rerank-2** (partner recomendado por Anthropic) o **Cohere Rerank**; OSS: **bge-reranker** self-host | ✅ BAA/self-host | **P1** (salto de calidad grande) |
| **Embeddings** de dominio | **Voyage-3** (fuerte en clínico/legal) o OpenAI text-embedding-3-large | ✅ BAA | P1 |
| **Búsqueda híbrida** (vector + BM25) | Postgres `tsvector` nativo, o **ParadeDB pg_search** | ✅ | P1 |
| Chunking semántico + tabla-aware | propio (sale de #1) | ✅ | P1 |

**El reranker es el mejor ROI de calidad**: sube precisión de citas sin tocar arquitectura.

## 3. Capa LLM & gateway
Hoy: cadena multi-proveedor propia (Anthropic + Gemini, keys por org). Sólido.

| Mejora | Herramienta | Prioridad |
|---|---|---|
| **Prompt caching** (baja costo/latencia de extracción) | Anthropic nativo | **P0** |
| Structured outputs robustos | Vercel AI SDK `generateObject` (ya) | — |
| Gateway pro (routing, rate-limit, fallback, cache, budgets) | **Portkey** o **LiteLLM** (self-host) — solo si la cadena propia se vuelve difícil de mantener | P2 |

No metas LangChain/LlamaIndex como orquestador — tu CODEX lo prohíbe y con razón.

## 4. Evaluación & observabilidad (crítico para credibilidad clínica)
Hoy: `packages/evals` + framework propio + `test:leakage`. Es tu activo regulatorio; hay que
profesionalizarlo.

| Herramienta | Rol | PHI | Prioridad |
|---|---|---|---|
| **Langfuse** (OSS self-host) | Tracing + prompt mgmt + evals; data residency total | ✅ self-host (la FOSS no trae cert SOC2, pero los datos quedan en tu infra) | **P1** |
| **Arize Phoenix** (OSS) | Debugging RAG best-in-class: drift de embeddings, relevancia de retrieval, atribución por doc, 50+ métricas (faithfulness/hallucination) | ✅ self-host | **P1** |
| **Braintrust** (self-host hybrid) | Evals con **HIPAA** en el deployment self-host, si querés cert | ✅ | P2 |
| **CI eval gates** | correr regresión de calidad RAG en GitHub Actions (además de leakage) | — | **P0** |

**Recomendación:** Phoenix o Langfuse self-host para PHI + gate de regresión RAG en CI. Esto
es lo que le muestra a un sponsor/auditor que medís calidad sistemáticamente.

## 5. Jobs, orquestación & automatización
Hoy: "enqueue ingestion job" ad-hoc + el cron SD que armamos. Gap: durabilidad, reintentos,
observabilidad de jobs largos (OCR/embeddings de PDFs grandes).

| Necesidad | Herramienta | PHI | Prioridad |
|---|---|---|---|
| **Durable jobs** (ingesta, reintentos, backoff) | **Inngest** (serverless, DX top, Vercel-native) o **Trigger.dev v3** (OSS self-host) | ✅ (self-host Trigger para PHI) | **P1** (reemplaza la cola ad-hoc + absorbe el cron SD) |
| Workflows complejos multi-paso a gran escala | **Temporal** (self-host, potente, pesado) | ✅ | P2 |
| **Automatización de negocio/integración** (notificaciones, glue con sistemas de sponsor, alertas, hand-offs) | **n8n** (self-host = PHI-safe) | ✅ self-host | P1 |

**Distinción honesta:** n8n para **ops/integración** (no-code, glue), NO para el pipeline core
—ese sigue siendo código tipado por contrato CODEX. Inngest/Trigger para el pipeline.

## 6. Infra & cómputo
Hoy: Vercel (web) + Neon (DB). Vos mencionaste Railway.

| Capa | Recomendación | Por qué |
|---|---|---|
| Web/app | **Vercel** (seguir) | Next-native, previews, ya integrado |
| DB | **Neon** (seguir) | serverless, pgvector, branching para tests |
| **Workers long-running / servicios stateful** (OCR self-host, n8n, Langfuse, Temporal) | **Railway** (simple) o **Fly.io** (global, GPU) o **Render** | Vercel serverless tiene timeouts; esto va aparte |
| **GPU** para OCR/rerankers self-host | **Modal**, **Baseten**, **RunPod**, **Replicate** | on-demand, sin mantener GPUs |
| A escala regulada seria | **AWS/GCP con BAA** | cuando el volumen/compliance lo exija |

**Railway sí, pero para lo stateful/long-running — no para reemplazar Vercel.**

## 7. Seguridad, secretos & compliance automation
Hoy: `@ichtys/crypto` field-level, `audit_logs`, políticas escritas. Falta tooling.

| Necesidad | Herramienta | Prioridad |
|---|---|---|
| **Gestión de secretos/claves** (incl. `PHI_ENCRYPTION_KEY`) | **Infisical** (OSS self-host) o **Doppler**; **AWS KMS**/**Vault** para KMS serio | **P0** |
| **Error monitoring** | **Sentry** (BAA disponible) | **P0** |
| **Compliance automation** (SOC 2 / ISO 27001 / HIPAA — evidencia continua) | **Vanta** o **Drata** | **P1** (enorme para venta enterprise + due diligence de inversores) |
| SIEM/audit a escala | **Panther** o Datadog Cloud SIEM | P2 |
| Pentest | **Cobalt** / manual | P1 pre-prod |

**Vanta/Drata es de las cosas de mayor palanca para tu contexto**: automatiza la evidencia
que hoy tenés en 13 .md sueltos, y es lo que un sponsor/inversor quiere ver.

## 8. Datos, analítica & telemetría de producto
| Necesidad | Herramienta | PHI | Prioridad |
|---|---|---|---|
| **Product analytics + feature flags + session replay** | **PostHog** (self-host = PHI-safe) | ✅ self-host | **P0/P1** |
| Warehouse (si escala) | **ClickHouse** / **BigQuery (BAA)** | ✅ BAA | P2 |

## 9. Billing & monetización
Hoy: nada (E2 gate bloqueado por falta de billing).

| Necesidad | Herramienta | Prioridad |
|---|---|---|
| **Billing usage-based** (por documento/spec/estudio — el modelo tipo Pacientry) | **Stripe Billing** (+ metering) | **P1** |
| Paywalls/entitlements | Stripe + lógica propia, o **Schematic**/**Orb** para metering complejo | P2 |

## 10. Frontend / UX / accesibilidad
Hoy: Next + Tailwind. Para "profesional":

| Mejora | Herramienta | Prioridad |
|---|---|---|
| Sistema de componentes de calidad | **shadcn/ui** + Radix (ya en tu paquete `ui`) | **P0** |
| **E2E testing** | **Playwright** | **P0** |
| Component workshop / visual regression | **Storybook** + **Chromatic** | P1 |
| Accesibilidad (WCAG 2.2 AA — exigido en enterprise/salud) | axe + auditoría | P1 |

## 11. DevEx, CI/CD & quality gates
Hoy: GitHub Actions + Turborepo. Sumar:

| Mejora | Herramienta | Prioridad |
|---|---|---|
| **Deps al día + seguridad** | **Renovate** (o Dependabot) | **P0** |
| Turbo **remote cache** (builds rápidos) | Vercel Remote Cache | **P0** |
| Coverage gate | **Codecov** | P1 |
| Versionado de cambios | **Changesets** | P1 |
| Gates en CI: typecheck + lint + test + **leakage (bloqueante)** + **eval RAG** | ya + #4 | **P0** |

## 12. Docs, soporte, status & GTM ops
| Necesidad | Herramienta | Prioridad |
|---|---|---|
| **Docs públicas / developer portal** | **Mintlify** o Docusaurus | P1 |
| **Status page** | **Instatus** / Better Stack | P1 |
| Uptime/synthetics | **Checkly** / Better Stack | **P0** |
| Soporte B2B | **Plain** o **Pylon** | P2 |
| CRM ventas | **Attio** o HubSpot | P1 |

---

## Secuenciación (qué hacer y cuándo)

**Ahora / barato (P0)** — máximo ROI, poco costo, no requiere financiación:
Docling OCR · índice HNSW · prompt caching · Sentry · PostHog · gate de eval RAG en CI ·
Renovate · Turbo remote cache · Playwright · secretos en Infisical/Doppler (`PHI_ENCRYPTION_KEY`).

**Pre-producción con PHI (P1)** — al financiar / antes del go-live regulado:
Reducto (OCR difícil) · reranker (Voyage/Cohere) · Langfuse/Phoenix self-host ·
Inngest/Trigger (jobs) · n8n (integración) · **Vanta/Drata** · Stripe Billing · Railway/Fly
para servicios stateful · pentest.

**Escala (P2)** — con tracción:
Temporal · gateway LLM (Portkey/LiteLLM) · warehouse · SIEM · AWS/GCP con BAA · Braintrust.

## Principio de cierre
Ninguna herramienta te hace "el mejor" sola. Lo que te hace competitivo es la **combinación
de profundidad regulatoria (tu foso) + calidad RAG medible + superficie de producto**. La
tabla de arriba es el objetivo; el orden P0→P1→P2 es el camino sin fundir el presupuesto ni
la deuda operativa.

---

## Sources
- [Top 10 document parsing services for RAG (2026) — Vstorm](https://vstorm.co/llamaindex/top-10-document-parsing-services-for-rag-pipelines-and-llm-applications/)
- [Document Parser Comparison — Reducto](https://llms.reducto.ai/document-parser-comparison)
- [Document Parsing for RAG: Reducto vs LlamaParse vs Docling — Particula](https://particula.tech/blog/document-parsing-rag-reducto-llamaparse-unstructured-docling)
- [Best PDF Parsers for AI and RAG in 2026 — Firecrawl](https://www.firecrawl.dev/blog/best-pdf-parsers)
- [Best self-hosted AI evals tools 2026 — Braintrust](https://www.braintrust.dev/articles/best-self-hosted-ai-evals-tools-2026)
- [Langfuse vs Arize AI/Phoenix — Langfuse](https://langfuse.com/faq/all/best-phoenix-arize-alternatives)
- [Top 7 LLM Observability Tools 2026 — Confident AI](https://www.confident-ai.com/knowledge-base/compare/top-7-llm-observability-tools)
