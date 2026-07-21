# MANUAL COMPLETO — ALPHI / ICHTYS
## Análisis de producto · Auditoría de seguridad · Camino a mercado

**Fecha:** 2026-07-08
**Autor:** Auditoría técnica automatizada (Claude) sobre el repo `Santiagoisper/Asistente_bot`
**Alcance:** todo el monorepo `ichtys/` + infraestructura del repo raíz
**Metodología:** análisis estático + auditoría de dependencias + ejecución de la batería completa de calidad, en **3 ciclos de detección → corrección → re-análisis** (los fixes de esta sesión quedaron aplicados en el working tree, listos para commit)

---

## Índice

1. [Resumen ejecutivo](#1-resumen-ejecutivo)
2. [Parte I — El producto](#2-parte-i--el-producto)
3. [Parte II — Arquitectura técnica](#3-parte-ii--arquitectura-técnica)
4. [Parte III — Auditoría de seguridad](#4-parte-iii--auditoría-de-seguridad)
5. [Parte IV — Bitácora de los ciclos de corrección](#5-parte-iv--bitácora-de-los-ciclos-de-corrección)
6. [Parte V — Estado de calidad](#6-parte-v--estado-de-calidad)
7. [Parte VI — Compliance y regulatorio](#7-parte-vi--compliance-y-regulatorio)
8. [Parte VII — Todo lo que falta para salir al mercado](#8-parte-vii--todo-lo-que-falta-para-salir-al-mercado)
9. [Parte VIII — Roadmap recomendado](#9-parte-viii--roadmap-recomendado)
10. [Apéndices](#10-apéndices)

---

## 1. Resumen ejecutivo

**ALPHI** (código: Ichtys) es un asistente documental clínico multi-tenant con RAG: responde preguntas operacionales en lenguaje natural sobre documentos de ensayos clínicos (protocolos, IBs, manuales de laboratorio y farmacia) con **respuestas grounded y citas exactas** al documento fuente. Corre en producción en Vercel (`asistente-bot-five.vercel.app`) con una organización piloto (INNOVA TRIALS).

### Veredicto de la auditoría

| Dimensión | Estado | Nota |
|---|---|---|
| Arquitectura de seguridad (diseño) | 🟢 Excelente | Multi-tenancy con defensa en profundidad real, PHI cifrado, prompt-injection considerado |
| Implementación de seguridad (código) | 🟢 Muy buena | Tras esta sesión: 0 CVEs high, headers, magic bytes, gate de leakage real |
| Calidad / tests | 🟢 Fuerte | **598 tests verdes** (494 unit + 75 leakage + 29 OQ), typecheck y lint limpios |
| Compliance documental | 🟢 Inusualmente maduro | Fase 0 cerrada con DPA/BAA/DPIA/HIPAA firmados 2026-07-04 |
| Validación formal (CSV/GAMP 5) | 🟡 En curso | IQ ✅, OQ ✅, **PQ piloto y VSR pendientes** |
| Preparación go-to-market comercial | 🔴 Incompleta | **No hay billing**, onboarding self-serve ni soporte formalizado |

### Hallazgo más grave de la sesión (ya corregido)

La suite `test:leakage` — que la doctrina del repo declara **bloqueante para release** — estaba **completamente vacía**: los 4 packages apuntaban a un directorio `tests/leakage/` inexistente con `--passWithNoTests`, así que CI la mostraba verde sin ejecutar ni un test. Se reconstruyó con **75 tests reales** y se eliminó el flag para que un gate vacío falle fuerte.

### Qué se corrigió hoy (resumen)

- ✅ Suite de leakage reconstruida: 75 tests (retriever, auth boundary, invariantes de schema, cobertura de auth en 34 rutas API + tripwire del middleware).
- ✅ Vulnerabilidades de dependencias: **de 10 (3 high) a 2 low** — drizzle-orm 0.38→0.45.2 (SQLi GHSA-gpj5-g38j-94v9), undici, form-data, postcss, jsondiffpatch.
- ✅ Security headers globales (HSTS, X-Frame-Options DENY, nosniff, CSP frame-ancestors, Referrer-Policy, Permissions-Policy) — verificados en runtime.
- ✅ Validación de magic bytes `%PDF-` en upload (el MIME del cliente es falsificable) + test nuevo.
- ✅ Comparación constant-time del `CRON_SECRET` (`timingSafeEqual`).
- ✅ Gate de supply chain en CI (`pnpm audit --audit-level high`) + Dependabot semanal.
- ✅ Limpieza: archivo `nul` (nombre reservado de Windows), temporales, `.gitignore` raíz reforzado, `turbo.json` outputs, `console.log` fuera del retriever.
- ✅ `SECURITY.md` sincronizado con la realidad del código (drift de 4 MiB vs 50 MB, capa de headers, ubicación de la suite de leakage).

---

## 2. Parte I — El producto

### 2.1 Qué es

Asistente documental clínico B2B multi-tenant. El usuario carga los PDFs del estudio (protocolo de 200–400 páginas, IB, manuales) y pregunta en lenguaje natural: *"¿Este paciente cumple criterios con HbA1c 9.2%?"*, *"¿Cuál es el timeline de reporte de un SAE?"*. ALPHI responde **solo desde los documentos cargados**, siempre con cita exacta (documento, página, sección), y si no tiene evidencia suficiente **lo dice** — el fallback honesto es una feature, no un bug.

> Propuesta de valor (PRD): «La fuente trazable es el producto, no el chat.»

### 2.2 Problema y usuarios

Los equipos de sitio pierden tiempo crítico buscando en documentos extensos durante operaciones en vivo (paciente en sala, monitor pidiendo evidencia, onboarding de staff, evento adverso con timeline en minutos).

| Usuario | Necesidad |
|---|---|
| CRC (primario) | Elegibilidad, visitas, labs, medicación concomitante |
| Research Nurse | Manejo de muestras, timing, procedimientos |
| Research Assistant | Orientación rápida de tareas de visita |
| Site Manager | Consistencia del equipo, onboarding |
| PI / Sub-I | Verificación con evidencia |
| Monitor / CRA | Trazabilidad de las respuestas |
| Sponsor / Admin | Gobernanza, aislamiento por tenant |

**Referencia de mercado:** Peter the Protocol Reader (Care Access / Reify Health). ALPHI apunta a superarlo en precisión de citas, trazabilidad y profundidad clínica para estudios metabólicos/cardiometabólicos en LATAM (ANMAT/ANVISA).

### 2.3 Funcionalidad en producción hoy

- Web app multi-tenant (organizations → studies → documents) con Clerk Organizations y roles (`org_admin`, `study_admin`, …, `read_only_monitor` como mínimo privilegio por defecto).
- Upload de PDFs por estudio → ingestion (parse por página → chunking con metadata → embeddings) → estado por versión de documento.
- Chat RAG grounded con citas obligatorias, streaming, historial por estudio, visor de citas.
- **Extracción de specs** (criterios de elegibilidad) con numeración anidada preservada (`"(iii)(a)"`), aprobación, diff entre versiones, export, re-extracción batch.
- **Módulo clínico (Fase 0–2.5):** sujetos pseudonimizados, evoluciones, perfiles, labs con extracción asistida + confirmación humana, screening asistido con badges de confianza — PHI cifrado at-rest (AES-256-GCM) y pre-redacción de PHI antes del LLM.
- Multi-LLM por organización: `LLM_PROVIDER=auto` (Claude → OpenAI → Gemini → Groq → GLM), keys por org cifradas en DB, UI en `/settings` con sliders de RAG (threshold/topK).
- Bulk import de protocolos con cola persistida (`ingestion_jobs`) y recuperación de documentos trabados (cron horario con `CRON_SECRET`).
- Páginas GTM públicas: `/pricing`, `/trust`, `/terms`, `/privacy`, `/roi`.
- Audit log append-only en toda acción sensible (incluyendo accesos denegados).

### 2.4 Modelo de negocio (estado)

- Pricing público en `/pricing` — pero **no existe billing** (E2 del backlog está bloqueado por esto). Hoy no se puede cobrar ni gatear features por plan.
- Un solo tenant real (INNOVA TRIALS). El JIT org provisioning técnico existe, pero no hay flujo comercial de alta.

---

## 3. Parte II — Arquitectura técnica

### 3.1 Stack

| Capa | Tecnología |
|---|---|
| Frontend | Next.js 15 App Router + TypeScript strict + Tailwind + Vercel AI SDK |
| Auth | Clerk Organizations (multi-tenant B2B) |
| DB | Neon Postgres + pgvector, Drizzle ORM (ahora 0.45.2) |
| Storage | Vercel Blob (privado; acceso solo vía endpoint autenticado) |
| LLM | Multi-provider propio en `@ichtys/llm` (sin LangChain — pipeline RAG explícito, regla de la casa) |
| Embeddings | `text-embedding-3-small` (1536 dim) — OpenAI en prod |
| Hosting | Vercel (`ichtys/vercel.json`), deploy automático al pushear `main` |
| CI/CD | GitHub Actions (`.github/workflows/ci.yml` + db-check + preview + cron recover-stuck-docs) |
| Rate limiting | Upstash Redis / Vercel KV REST, sliding window por usuario |

### 3.2 Monorepo (`ichtys/`, pnpm + turbo)

| Package | Rol |
|---|---|
| `apps/web` | Next.js app: UI + 34 rutas API |
| `packages/auth` | `validateStudyAccess`, object-level access (documento/versión/página/mensaje/conversación/sujeto), roles, JIT org provisioning, api-errors |
| `packages/db` | Schema Drizzle (17 tablas), cliente Neon, migraciones, cifrado de keys LLM por org |
| `packages/ingestion` | Parse PDF (pdfjs), chunking, embedder, cola bulk, recuperación de stuck docs, spec-extractor (siempre Claude) |
| `packages/rag` | Retriever pgvector (filtro tenant en SQL), answer engine (puro), guardrails, anotador médico, query expander |
| `packages/llm` | Abstracción multi-provider + health checks + resolución de keys por org |
| `packages/crypto` | AES-256-GCM field-level para PHI (`v1:iv:tag:ciphertext`) |
| `packages/clinical` | Pre-redacción PHI, extract-merge de perfiles clínicos |
| `packages/ui` | Componentes compartidos |
| `packages/evals` | Suite de evaluación RAG (48 tests + datasets) |

### 3.3 Modelo de tenancy (el corazón de la seguridad)

```
organization (Clerk Org) → studies → documents → document_versions → pages → chunks
                         → conversations → messages → citations
                         → subjects → clinical_evolutions / patient_profiles / screening_assessments
```

- La identidad del tenant llega **siempre** del token de Clerk (`auth().orgId` → UUID interno); jamás del body/query/headers.
- La unidad de aislamiento de contenido es el **study**; el retrieval filtra `organization_id + study_id` **dentro del WHERE de SQL, antes** del ranking vectorial (verificado en código y ahora blindado por tests de leakage).
- Objetos fuera de la org devuelven **404, no 403** (anti-enumeración).
- `ingestion_jobs` es org-scoped con `study_id` nullable por diseño (el job de bulk-import crea el estudio después).

### 3.4 Flujo de ingestion

`POST /api/documents/upload` (Zod + rechazo de org params + MIME + **magic bytes** + límite 50 MB) → Blob privado con key no adivinable → fila `documents` + `document_versions(pending)` → `POST /api/ingestion/run` valida object-access y dispara pipeline → parse → pages → chunks (con org/study en cada fila) → embeddings → `status=ready`. Errores con códigos sanitizados, nunca stack traces. En dev, blob mock escribe a `%TEMP%/ichtys-dev-blobs/`.

### 3.5 Flujo de respuesta (RAG)

`POST /api/chat` → `validateStudyAccess` → rate limit → audit `rag.answer.requested` → retriever (SQL tenant-filtered, top-K, threshold por org) → answer engine **puro** (sin DB/Clerk; prompt instruye ignorar instrucciones embebidas en documentos) → evidencia copiada verbatim del chunk (nunca inferida; sin evidencia → `insufficient_evidence`) → persistencia transaccional de mensaje + citas → audit `rag.answer.completed`. Confianza `high|medium|low` sin evidencia = violación de invariante → degrada a fallback.

### 3.6 Observabilidad

Logger estructurado JSON con allowlist de campos; **prohibido** loggear question/answer/chunks/embeddings/tokens (PHI y secretos). Audit log obligatorio: si el insert de auditoría falla, la operación falla (500) — no hay éxito sin auditoría.

---

## 4. Parte III — Auditoría de seguridad

### 4.1 Metodología

1. Revisión de documentación de seguridad y verificación **contra el código real** (los docs pueden mentir).
2. Búsqueda de secretos en working tree + historia de git (patrones sk-ant/sk_live/pk_live/AKIA/PEM/ghp/xoxb).
3. `pnpm audit --prod` (dependencias).
4. Revisión de: middleware, 34 rutas API, retriever, upload, cron, crypto PHI, org settings, headers HTTP, sinks XSS (`dangerouslySetInnerHTML`/`eval`), SQL crudo (`sql.raw`).
5. Ejecución de la batería completa (3 ciclos, ver Parte IV).
6. Verificación runtime de headers con server de producción local + curl.

### 4.2 Fortalezas verificadas (no solo declaradas)

| Control | Evidencia |
|---|---|
| Tenancy server-side ejemplar | `validateStudyAccess` + object-access por tipo de recurso; org SIEMPRE del token |
| Filtro tenant en SQL vectorial | `retriever.ts` arma `WHERE org+study+embedding IS NOT NULL` antes del `ORDER BY` de distancia |
| Rechazo activo de org params del cliente | 400 si `organization_id`/`organizationId`/`orgId` aparece en query/body/FormData |
| Anti-enumeración | 404 (no 403) cuando el recurso existe pero es de otra org |
| PHI cifrado at-rest | AES-256-GCM correcto: IV aleatorio 12B, auth tag, formato versionado, key 32B validada |
| Keys LLM por org cifradas | `organizations.llm_api_keys_encrypted` + `ORG_LLM_KEYS_ENCRYPTION_SECRET`; UI muestra keys enmascaradas |
| Sin secretos en git | Historia limpia; solo `.env.example` trackeado; matches de patrones eran mocks de tests/documentación |
| Sin sinks XSS ni SQL crudo | 0 `dangerouslySetInnerHTML`, 0 `eval`, 0 `sql.raw` en código propio |
| Errores sanitizados | Códigos internos nunca llegan al cliente; provider errors descartados |
| Prompt injection considerado | Chunks tratados como evidencia, no instrucciones; system prompt defensivo |
| Audit trail obligatorio | Falla de auditoría = falla de la operación |
| Roles con mínimo privilegio | Rol desconocido de Clerk → `read_only_monitor` |

### 4.3 Hallazgos y estado

| ID | Severidad | Hallazgo | Estado |
|---|---|---|---|
| H-01 | 🔴 Alta | Suite `test:leakage` vacía con `--passWithNoTests` — gate bloqueante de release corriendo en vacío en CI | ✅ **Corregido**: 75 tests reales en 4 packages; flag eliminado |
| H-02 | 🔴 Alta | 10 CVEs en deps de prod: drizzle-orm **SQLi** (GHSA-gpj5-g38j-94v9), form-data CRLF, undici DoS + 7 | ✅ **Corregido**: quedan 2 LOW sin patch en la línea v4 del AI SDK (riesgo aceptado, ver §4.5) |
| H-03 | 🟠 Media | Sin security headers HTTP (no HSTS, no X-Frame-Options, no nosniff, no Referrer/Permissions-Policy) | ✅ **Corregido** en `next.config.ts`; verificado en runtime |
| H-04 | 🟠 Media | Upload validaba solo `file.type` (controlado por el cliente) — un binario arbitrario con MIME `application/pdf` entraba al Blob | ✅ **Corregido**: magic bytes `%PDF-` + test de spoofing |
| H-05 | 🟡 Baja | `CRON_SECRET` comparado con `!==` (no constant-time) | ✅ **Corregido**: `timingSafeEqual` |
| H-06 | 🟡 Baja | Drift docs/código: SECURITY.md declaraba límite 4 MiB; el código permite 50 MB | ✅ **Corregido**: doc sincronizado + caveat del límite de plataforma (~4.5 MB Vercel) |
| H-07 | 🟡 Baja | `console.log` en el retriever (path de producción) + 12 warnings no-console | ✅ Retriever limpio; quedan 7 warnings en ingestion/auth/rag (logs operativos) — migrar al logger estructurado (P2) |
| H-08 | 🟡 Baja | Sin gate de supply chain: una CVE nueva entraba silenciosa | ✅ **Corregido**: `pnpm audit --audit-level high` en CI + Dependabot semanal |
| H-09 | 🟡 Baja | Archivo `nul` (nombre reservado Windows) y temporales sueltos en el repo | ✅ **Corregido**: eliminados + `.gitignore` reforzado |
| H-10 | 🔵 Info | Rate limiting **fail-open** (sin Redis → requests pasan) — decisión consciente de disponibilidad | 📋 Documentado: verificar `KV_*`/`UPSTASH_*` configurados en Vercel prod (ver §8.1) |
| H-11 | 🔵 Info | CSP completa (script-src con nonces) ausente — solo `frame-ancestors 'none'` | 📋 Pendiente P1: requiere validación en staging con dominios de Clerk |
| H-12 | 🔵 Info | CI no ejecuta `pnpm build` (config de Next rota se detectaría recién en Vercel) | 📋 Pendiente P2: requiere Clerk publishable key de test en GH Secrets |

### 4.4 Detalle de los fixes aplicados

1. **Suite de leakage (H-01)** — 4 archivos nuevos:
   - `packages/rag/tests/leakage/retriever-leakage.test.ts` (5 tests): chunks de otra org con score MÁS ALTO nunca aparecen; ídem cross-study; contrato del WHERE; filtro documentType no debilita tenancy; chunks sin embedding excluidos.
   - `packages/auth/tests/leakage/study-access-leakage.test.ts` (5): 401 sin sesión/org antes de tocar DB; el WHERE de studies lleva la org interna del token; 404 genérico cross-org; mínimo privilegio con rol desconocido.
   - `packages/db/tests/leakage/tenant-schema-invariants.test.ts` (29): toda tabla tenant-scoped tiene `organization_id NOT NULL` (y `study_id NOT NULL` donde aplica) — si una migración lo relaja, rompe acá.
   - `apps/web/tests/leakage/api-auth-coverage.test.ts` (36): **toda** ruta `app/api/**/route.ts` debe referenciar un guard de auth conocido (allowlist explícita para delegaciones); tripwire del allowlist público de `middleware.ts` (una ruta pública nueva exige actualización consciente del test; ninguna ruta `/api` pública salvo `/api/cron(.*)`).
2. **Dependencias (H-02)** — `drizzle-orm ^0.45.2` en 4 packages + `drizzle-kit ^0.31.10`; overrides pnpm: `undici 6.27.0`, `form-data >=4.0.6`, `postcss >=8.5.10`, `jsondiffpatch >=0.7.2`. Batería completa verde tras el upgrade.
3. **Headers (H-03)** — HSTS 2 años + preload, nosniff, DENY, `frame-ancestors 'none'`, Referrer strict-origin-when-cross-origin, Permissions-Policy restrictiva, DNS-Prefetch off. Verificados con curl sobre `next start`.
4. **Magic bytes (H-04)** — `hasPdfMagicBytes()` lee los primeros 5 bytes reales; fixture de tests actualizado a PDFs con firma; test nuevo: MIME pdf + contenido no-PDF → 415.
5. **Cron (H-05)** — comparación constant-time con check de longitud previo.
6. **CI/Supply chain (H-08)** — step de audit + `.github/dependabot.yml` (npm en `/ichtys` + github-actions, semanal, agrupado minor/patch).

### 4.5 Riesgos aceptados (documentados)

| Riesgo | Justificación | Mitigación vigente | Salida |
|---|---|---|---|
| `ai@4.3.19` — filetype whitelist bypass (LOW, GHSA-rwvc-j5jr-mgvh) | Patch solo en AI SDK v5 (major breaking) | ALPHI valida PDF por magic bytes propio; el vector del advisory no aplica al flujo actual | Migración a AI SDK v5 (P1) |
| `@ai-sdk/provider-utils@2.2.8` — resource consumption (LOW) | Sin patch en la línea 2.x | Rate limiting + timeouts de 15s en embeddings | Migración a AI SDK v5 (P1) |
| Rate limit fail-open | Disponibilidad clínica > bloqueo duro | Logs de `rate_limit.blocked`; límites por endpoint | Alerta si Redis no responde (P1) |
| JIT org provisioning | Cualquier org válida de Clerk se auto-provisiona | Clerk controla la creación de orgs; sin invitación no hay org | Revisar al abrir self-serve (P0 GTM) |

---

## 5. Parte IV — Bitácora de los ciclos de corrección

> Requisito de la orden: mínimo 2 loops de encontrar error → corregir → re-analizar. Se ejecutaron **3**.

### Ciclo 1 — Análisis inicial (detección)

| Check | Resultado |
|---|---|
| `pnpm typecheck` | ✅ 10/10 |
| `pnpm lint` | ✅ 0 errores (13 warnings no-console) |
| `pnpm test` | ✅ 181 (web) + suites de packages |
| `pnpm test:leakage` | 🔴 **"No test files found"** — gate vacío (H-01) |
| `pnpm audit --prod` | 🔴 **10 CVEs (3 high)** (H-02) |
| Revisión de código | 🔴 H-03, H-04, H-05, H-06, H-07, H-09 |

**Correcciones:** suite de leakage nueva (4 archivos), remoción de `--passWithNoTests`, upgrade drizzle + overrides pnpm, y el paquete completo de hardening.

### Ciclo 2 — Re-análisis (el loop encontró errores nuevos, incluidos míos)

| Error detectado | Causa | Corrección |
|---|---|---|
| 8 fallos en `api-auth-coverage` | Mi lista de tokens no incluía `validateSubjectAccess`/`validateDocumentPageAccess` (helpers reales de las rutas clínicas) | Tokens agregados tras verificar que esos helpers validan org/study |
| 1 fallo en invariantes de schema | `ingestion_jobs.study_id` es nullable **por diseño** (bulk-import crea el estudio después; `onDelete: set null`) | Test corregido: la tabla es org-scoped; decisión documentada en el propio test |
| 1 error de typecheck | `match[1]` posiblemente `undefined` en mi tripwire (strict mode) | Type guard con `.filter` |

**Resultado del re-análisis completo:** typecheck 10/10 · lint 0 errores · **494 unit + 75 leakage + 29 OQ = 598 tests verdes** · audit: 2 LOW.

### Ciclo 3 — Verificación de producción

| Check | Resultado |
|---|---|
| `pnpm build` (producción) | ✅ 41.9s, todas las rutas compiladas |
| Headers en runtime (`next start` + curl) | ✅ los 6 headers presentes en respuesta 200 |
| `pnpm audit --prod --audit-level high` (gate nuevo de CI) | ✅ exit 0 |

---

## 6. Parte V — Estado de calidad

### 6.1 Tests por package (post-sesión)

| Package | Unit | Leakage | Notas |
|---|---|---|---|
| `@ichtys/web` | 217 | 36 | Incluye 4 tests de integración contra DB real (PHI cifrado round-trip, aislamiento org) |
| `@ichtys/rag` | 101 | 5 | Answer engine, guardrails, anotador, retriever |
| `@ichtys/evals` | 48 | — | Métricas RAG |
| `@ichtys/auth` | 43 | 5 | Incluye el test nuevo de PDF spoofeado |
| `@ichtys/db` | 33 | 29 | Cifrado keys org + invariantes de schema |
| `@ichtys/ingestion` | 25 | — | Parser, chunker, cola |
| `@ichtys/clinical` | 16 | — | Redacción PHI, extract-merge |
| `@ichtys/crypto` | 8 | — | AES-GCM |
| `@ichtys/llm` | 3 | — | Providers |
| **Total** | **494** | **75** | **+ 29 OQ = 598** |

### 6.2 Gates de CI (`.github/workflows/ci.yml`)

`install --frozen-lockfile` → `typecheck` → `lint` → `test` → `test:oq` → `test:leakage` (ahora con dientes) → `audit --audit-level high` (nuevo). Falta `build` (ver H-12).

### 6.3 Validación de producto (scripts operativos)

`pnpm validate:product` · `pnpm iq:check` (11/11) · `pnpm test:oq` (29) · `pnpm verify:phi-prod` · `pnpm evals:direct` · `pnpm e2e:product` — runbooks en `docs/OPERATIONS.md`.

---

## 7. Parte VI — Compliance y regulatorio

### 7.1 Estado por etapa (de `ROADMAP.md` + `docs/compliance/`)

| Etapa | Contenido | Estado |
|---|---|---|
| 0 — Features | 10/10 en prod | ✅ Cerrada (2026-07-04) |
| 1 — Compliance Fase 0 (pre-PHI) | 15 entregables: políticas, DPA/BAA firmados, DPIA aprobado, HIPAA RA, PHI key en prod | ✅ Cerrada (2026-07-04) |
| 2 — Validación CSV / GAMP 5 | URS/FRS/RTM v1.0 ✅ · FMEA ✅ · IQ ✅ · OQ ✅ · **PQ piloto 🟡 pendiente** · **VSR 🟡 borrador, firma post-PQ** | 🟡 En curso |
| 3 — Go-live piloto con PHI real | Primer sitio, DR probado en vivo, breach notification activo | ⬜ Bloqueada por Etapa 2 |
| 4 — Escala | Multi-sitio, ISO 27001/27701/42001 certificadas, billing | ⬜ Futuro |

### 7.2 Gaps regulatorios concretos

1. **PQ (Performance Qualification) piloto** — protocolo listo en `compliance/PQ.md`; falta ejecutarlo con usuarios reales en el sitio piloto.
2. **VSR (Validation Summary Report)** — borrador listo; firma humana post-PQ.
3. **Roles de compliance sin asignar** — DPO, Security Officer, CSV Lead y Clinical Lead figuran `[PENDIENTE]` en `compliance/README.md`. Sin nombres, el ISMS es papel.
4. **Certificaciones formales** — ISO 27001/27701/42001 hoy son "lite" (alineadas, no certificadas). Comunicación a inversores ya corregida a «framework alineado, validación en progreso» (regla de honestidad en AGENTS.md).
5. **Part 11 completo** — audit trail existe; revisar requisitos de e-signature/session timeout si el piloto lo exige.
6. **DR drill en vivo** — `BACKUP-AND-DR.md` documenta; Etapa 3 exige probarlo de verdad (restore de Neon + blobs + rotación PHI key).

---

## 8. Parte VII — Todo lo que falta para salir al mercado

### 8.1 P0 — Bloqueantes técnicos/seguridad (antes del piloto con PHI)

| # | Ítem | Detalle | Esfuerzo |
|---|---|---|---|
| 1 | **Verificar rate limiting activo en prod** | Fail-open: si `KV_*`/`UPSTASH_*` no están en Vercel, hoy NO hay rate limiting real. Chequear con `iq:check` y agregar alerta | Horas |
| 2 | **Upload directo a Blob (presigned)** | Vercel corta el body en ~4.5 MB; protocolos de 200–400 páginas lo superan seguro. Sin esto, el caso de uso central falla con archivos reales | 2–4 días |
| 3 | **Monitoreo y alerting de producción** | No hay Sentry/APM ni alertas (solo logs JSON y cron). Mínimo: error tracking + alerta de 5xx + uptime check | 1–2 días |
| 4 | **Ejecutar PQ piloto + firmar VSR** | Único bloqueante regulatorio duro restante (Etapa 2 → 3) | Semanas (humano) |
| 5 | **Asignar roles de compliance** | DPO / Security Officer / CSV Lead / Clinical Lead con nombre y apellido | Decisión |
| 6 | **DR drill real** | Restore completo en ambiente aparte, cronometrado y documentado | 1 día |
| 7 | **Commit + deploy de los fixes de esta sesión** | Todo el hardening está en working tree sin commitear | Minutos |

### 8.2 P0 — Bloqueantes comerciales (para VENDER, no solo operar)

| # | Ítem | Detalle |
|---|---|---|
| 1 | **Billing** | No existe. Stripe + gate por plan (E2 espera esto). Sin billing no hay revenue ni límites por tier |
| 2 | **Onboarding de clientes** | Alta de org nueva es manual/JIT técnico. Definir: invitación, trial, contrato, provisioning, DPA por cliente |
| 3 | **Soporte y SLA** | Canal de soporte, tiempos de respuesta comprometidos, proceso de incidentes cara al cliente (el breach procedure interno ya existe) |
| 4 | **Contratos comerciales** | MSA/Order Form + DPA propio para clientes (los DPA/BAA firmados son con NUESTROS procesadores; falta el papel hacia el cliente) |
| 5 | **Decisión de jurisdicción piloto** | UE vs US vs LATAM define qué marco se activa primero (nota explícita del ROADMAP: decisión CINME/Innova) |

### 8.3 P1 — Seguridad avanzada (primeros 60 días post-piloto)

1. **CSP completa** con nonces (script-src/connect-src con dominios Clerk/Vercel) validada en staging.
2. **Migración AI SDK v5** — elimina las 2 CVEs LOW residuales.
3. **Pen test externo** — obligatorio antes de escalar con PHI multi-cliente; también habilita ventas enterprise.
4. **MFA obligatorio** para roles admin (política en Clerk) + timeout de sesión alineado a Part 11.
5. **Escaneo de secretos en CI** (gitleaks/trufflehog) — hoy la historia está limpia; mantenerla así automáticamente.
6. **Alerting de rate-limit degradado** (Redis caído → hoy silencio).
7. **Rotación de PHI key ensayada** (el runbook §6 de BACKUP-AND-DR existe; ejecutarlo una vez).

### 8.4 P1 — Producto/Ingeniería

1. **E2E en CI** (hoy `e2e:product` es manual) + `pnpm build` en CI (H-12).
2. **PDF export server-side** (E3) si el PI/monitor lo exige en el piloto.
3. **T3-LCS** — matching del diff de specs con inserciones en el medio.
4. **Migraciones automáticas en deploy** — hoy son manuales contra Neon (incidente 2026-06-28: columna faltante rompió prod). Mínimo: check de drift en CI que bloquee deploy si hay migración pendiente (`db-check.yml` existe — verificar que corra contra prod branch).
5. **Logs no-console → logger estructurado** (7 warnings restantes).
6. **Next 16 / eslint 10** — upgrades mayores pendientes (no urgentes).

### 8.5 P2 — Escala y GTM ampliado

- Multi-idioma (es/pt para ANMAT/ANVISA — hoy la UI mezcla es/en).
- Docs de usuario final / help center / videos de onboarding.
- Status page pública + página de seguridad para procurement (los materiales de `/trust` son la base).
- SSO enterprise (SAML/OIDC vía Clerk) para sponsors grandes.
- ISO 27001 certificada (Etapa 4) — abre puertas enterprise.
- Data residency por región si un sponsor lo exige (Neon multi-región).
- Programa de early adopters con métricas de adopción (los audit logs ya dan la telemetría base).

---

## 9. Parte VIII — Roadmap recomendado

```
AHORA (esta semana)
├─ Commit + push + deploy del hardening de esta sesión
├─ Verificar KV/Upstash en Vercel prod (rate limiting real)
├─ Asignar los 4 roles de compliance
└─ Arrancar PQ piloto (el protocolo ya está escrito)

MES 1 — Cierre técnico pre-piloto
├─ Upload directo a Blob (presigned) ← desbloquea PDFs reales
├─ Sentry + alertas + uptime
├─ DR drill cronometrado
└─ PQ en ejecución con usuarios del sitio piloto

MES 2 — Go-live piloto (Etapa 3)
├─ Firma VSR → PHI real habilitado
├─ Piloto con INNOVA TRIALS en producción
├─ CSP completa + MFA admin + gitleaks en CI
└─ Diseño de billing (pricing ya público en /pricing)

MES 3–4 — Comercialización
├─ Billing + gate por plan (E2)
├─ Onboarding self-serve + contratos cliente (MSA/DPA)
├─ Pen test externo
├─ Migración AI SDK v5
└─ Segundo y tercer sitio (multi-org real)

MES 5+ — Escala (Etapa 4)
├─ ISO 27001 certificación
├─ SSO enterprise, multi-idioma completo
└─ Features del uso real del piloto
```

**Camino crítico:** igual que dice el ROADMAP interno — el cuello de botella no es código: es **PQ→VSR** (regulatorio, semanas de calendario humano) y **billing** (comercial). Todo lo demás puede avanzar en paralelo.

---

## 10. Apéndices

### A. Archivos modificados en esta sesión (working tree, sin commitear)

**Seguridad/código:**
- `ichtys/apps/web/app/api/documents/upload/route.ts` — magic bytes `%PDF-`
- `ichtys/apps/web/app/api/cron/recover-stuck-docs/route.ts` — `timingSafeEqual`
- `ichtys/apps/web/next.config.ts` — security headers globales
- `ichtys/packages/rag/retriever.ts` — sin `console.log`

**Tests (nuevos):**
- `ichtys/packages/rag/tests/leakage/retriever-leakage.test.ts`
- `ichtys/packages/auth/tests/leakage/study-access-leakage.test.ts`
- `ichtys/packages/db/tests/leakage/tenant-schema-invariants.test.ts`
- `ichtys/apps/web/tests/leakage/api-auth-coverage.test.ts`
- `ichtys/packages/auth/__tests__/validate-study-access.test.ts` — fixture PDF real + test spoofing

**Dependencias:**
- `ichtys/package.json` — pnpm overrides (undici/form-data/postcss/jsondiffpatch)
- `ichtys/packages/{auth,db,ingestion,rag}/package.json` — drizzle-orm ^0.45.2 (+drizzle-kit ^0.31.10 en db) y `test:leakage` sin `--passWithNoTests` (también en `apps/web`)
- `ichtys/pnpm-lock.yaml`

**Infra/config:**
- `.github/workflows/ci.yml` — gate `pnpm audit --audit-level high`
- `.github/dependabot.yml` — nuevo
- `.gitignore` — output/, tmp/, *.log, nul, _tmp_*
- `ichtys/turbo.json` — outputs de test
- `ichtys/docs/SECURITY.md` — sincronizado con el código
- Eliminados: `ichtys/nul`, `ichtys/_tmp_17_c209dabefab4679aaf7e81807b143936`

> Nota: `AGENTS.md` y `ichtys/docs/pitch/ALPHI-SHAREHOLDER-REPORT-2026.html` ya estaban modificados antes de esta sesión (no los toqué).

### B. Comandos operativos

```bash
# Calidad (los 3 gates que corrí en los ciclos)
pnpm typecheck && pnpm lint && pnpm test
pnpm test:leakage        # 75 tests — bloqueante de release
pnpm test:oq             # 29 tests OQ (GAMP 5)
pnpm audit --prod --audit-level high

# Validación de producto / prod
pnpm validate:product
pnpm iq:check            # 11 checks de instalación (env prod)
pnpm verify:phi-prod
pnpm build               # build de producción

# Cierre de fase (doctrina AGENTS.md)
# auditoría → commit → push main → vercel --prod --yes
```

### C. Variables de entorno críticas (ver `.env.example`)

| Grupo | Variables | Nota |
|---|---|---|
| Auth | `CLERK_SECRET_KEY`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | En prod deben ser `sk_live_`/`pk_live_` |
| DB | `DATABASE_URL` (pooled), `DATABASE_URL_UNPOOLED` (migraciones) | Migraciones NUNCA automáticas en deploy |
| Storage | `BLOB_READ_WRITE_TOKEN` | Blob privado |
| PHI | `PHI_ENCRYPTION_KEY` | 32 bytes hex; rotación per BACKUP-AND-DR §6 |
| LLM | `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, … + `ORG_LLM_KEYS_ENCRYPTION_SECRET` | Extracción de specs SIEMPRE Claude |
| Rate limit | `KV_*` o `UPSTASH_*` | **Sin esto, fail-open = sin límites** |
| Cron | `CRON_SECRET` | Vercel + GitHub Secrets |

### D. Números finales de la sesión

| Métrica | Antes | Después |
|---|---|---|
| Tests de leakage ejecutándose | **0** | **75** |
| Tests totales verdes | ~523 | **598** |
| CVEs en deps de prod | 10 (3 high) | **2 low** (riesgo aceptado documentado) |
| Security headers | 0 | **6** (verificados en runtime) |
| Gates de CI | 5 | **6** (+ audit) |
| Ciclos detección→fix→re-análisis | — | **3** |

---

*Manual generado el 2026-07-08. Próxima revisión sugerida: al cerrar PQ (Etapa 2) o ante cualquier cambio en el modelo de tenancy.*
