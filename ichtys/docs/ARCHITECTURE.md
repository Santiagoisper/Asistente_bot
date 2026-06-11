# ARCHITECTURE — Ichtys Clinical Document Assistant
## v1.0 — MVP

---

## Principios arquitecturales

1. **Grounding estricto**: toda respuesta del assistant debe estar anclada en chunks recuperados. Sin evidencia → sin respuesta, no "respuesta probable".
2. **Tenant isolation primero**: el filtro por `organization_id` + `study_id` ocurre antes del retrieval, no después. Un bug acá es un failure catastrófico.
3. **Trazabilidad completa**: cada respuesta lleva su cadena de evidencia. Cada acción queda en el audit log.
4. **Pipeline explícito**: sin frameworks de orquestación en MVP. Código propio, legible, debuggeable.
5. **Simplicidad operacional**: menos capas = menos puntos de falla = menos deuda de infraestructura.

---

## Stack

| Capa | Tecnología | Razón |
|---|---|---|
| Frontend | Next.js 15 App Router + TypeScript | SSR, streaming nativo, Vercel-native |
| Streaming chat | Vercel AI SDK (`streamText`, `generateObject`) | Integración limpia con App Router |
| Styling | Tailwind CSS | Velocidad, mobile-first |
| Auth | Clerk Organizations | Multi-tenant B2B out-of-the-box, roles, invites |
| Database | Neon Postgres (serverless) | Branching para tests, scale-to-zero, compatible pgvector |
| Vector search | pgvector (extensión en Neon) | Embeddings + similarity search en la misma DB |
| File storage | Vercel Blob | Upload de PDFs, acceso controlado, signed URLs |
| Hosting | Vercel | Preview deployments, GitHub integration, AI SDK native |
| CI/CD | GitHub Actions | Tests, lint, typecheck, migration checks, deploy gates |
| Source control | GitHub | Monorepo, PR reviews, Claude Code Action |

---

## Modelo de datos

El modelo SQL canónico vive como migrations versionadas en `packages/db/migrations`
y como schema Drizzle en `packages/db/schema`. Tablas core:

- `organizations` — tenant raíz (1:1 con Clerk Org vía `clerk_org_id`)
- `sites` — sitios dentro de una org
- `studies` — unidad de aislamiento de documentos
- `documents` / `document_versions` / `pages` — registro documental + versionado + texto por página
- `chunks` — unidad de retrieval con `embedding VECTOR(1536)` + metadata de tenant
- `conversations` / `messages` / `citations` — chat + evidencia trazable
- `audit_logs` — append-only

Índices clave:
- `chunks_embedding_idx` — IVFFlat (`vector_cosine_ops`)
- `chunks_org_study_idx` — `(organization_id, study_id)` para el filtro de tenant
- `audit_logs_org_idx` / `audit_logs_study_idx`

---

## Flujo de datos

### Ingestion pipeline

```
User uploads PDF
    → POST /api/documents/upload (validate type/size/auth)
    → Store to Vercel Blob (signed key)
    → Create document_version (status: pending)
    → Enqueue ingestion job
Ingestion job
    → status: processing
    → parse por página (pdf-parse / pdfjs)
    → detectar secciones → chunk (section-aware, fallback 800–1200 tok, overlap 128)
    → embeddings (batch)
    → persistir pages + chunks + embeddings
    → status: ready + audit log
GET /api/documents/:id/status → polling desde el frontend
```

### RAG pipeline (chat)

```
POST /api/chat
    → validate auth + active org + study membership (Clerk)
    → validate study_id ∈ org
    → load conversation history (últimos 10 turnos, tenant-filtered)
      — contexto para interpretar la pregunta; NUNCA evidencia
    → embed question
    → pgvector search WHERE organization_id=$org AND study_id=$study
      ORDER BY embedding <=> $q LIMIT 8
    → filtrar por similarity threshold (>= 0.30, calibrado para text-embedding-3-small)
    → assemble context → LLM con grounded prompt
    → parse structured response (answer + citations + confidence)
    → insufficient_evidence → fallback explícito
    → persistir message + citations + audit log
    → stream al cliente (Vercel AI SDK)
```

---

## Seguridad

Ver `docs/SECURITY.md` para la versión expandida. Reglas no negociables:

1. Todo acceso a datos validado server-side
2. `organization_id` siempre desde el token de Clerk
3. `study_id` validado contra membresía del usuario
4. PDFs servidos con signed URLs (expiración corta)
5. Audit log en toda acción sensible

---

## Chunking strategy

```
Priority 1: Section-aware (chunk = sección si entra en ventana de tokens)
Priority 2: Token window fallback (800–1200 tok, overlap 128)
Metadata obligatorio: organization_id, study_id, document_id, document_version_id,
                      document_type, page_start, page_end, section_title, token_count
```

---

## Answer engine — prompt base

```
You are a clinical research assistant for study site operations.
1. Answer ONLY based on the provided document excerpts.
2. Every claim must reference a specific citation [1], [2], ...
3. If excerpts are insufficient → explicit "insufficient evidence" message.
4. Be concise: direct answer first, then cite.
5. Never speculate or infer beyond the text.
```

---

## CI/CD

Workflows en `.github/workflows/`: `ci.yml` (typecheck/lint/test + leakage),
`db-check.yml` (drift de migrations contra Neon branch), `preview.yml`
(deploy de preview en PRs vía Vercel).

---

## Variables de entorno

Ver `.env.example`. Claves: Clerk, Neon (`DATABASE_URL`/`_UNPOOLED`), Vercel
Blob, Anthropic (LLM), OpenAI (embeddings), `NEXT_PUBLIC_APP_URL`.

---

## Riesgos y mitigaciones

| Riesgo | Severidad | Mitigación |
|---|---|---|
| Leakage entre tenants en retrieval | Crítico | Filtro org+study ANTES del vector search; tests en CI |
| Respuesta sin evidencia que parece confiable | Alto | Confidence score; fallback explícito; prompt estricto |
| PDF mal parseado → citas incorrectas | Alto | Ingestion QA; estado visible; retry manual |
| Latencia alta en retrieval | Medio | IVFFlat; top-k limitado; streaming |
| Deuda de migración de DB | Medio | Drizzle + migrations versionadas + Neon branch por feature |
| Costo de embeddings en bulk | Bajo | Batch; modelo pequeño (text-embedding-3-small) |

---

## Orden de implementación recomendado

1. Repo + CI base + entornos Vercel
2. Auth (Clerk) + middleware + org/study routing
3. Schema DB + migrations (Neon)
4. Upload + Vercel Blob + document registry
5. Ingestion pipeline (parser → chunker → embedder)
6. Retrieval layer (pgvector + filtros)
7. Answer engine (prompt + citas)
8. Chat UI + citation panel + PDF viewer
9. Admin screens + roles
10. Eval suite + tests de leakage
11. Analytics + audit dashboard
