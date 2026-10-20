# Informe Testpilot — OPERACIÓN ALPHI 2.0 (FASE 0 + FASE 1 + pasada FASE 2 + pasada FASE 7 + pasada E2E)

- **Slot**: 05 — testpilot (GLM)
- **Fecha**: 2026-10-19 (re-verificado 13:44 UTC — §0; pasada FASE 2 14:15–14:35 UTC — §7; pasada FASE 7 flujo upload→chat 16:20–16:35 UTC — §8; pasada E2E typecheck+build+tests+capturas 16:45–17:05 UTC — §9)
- **Repo**: Asistente_bot (ichtys/apps/web)
- **Rama**: `feature/alphi-2.0-visual-redesign` (main intacto, sin commits ni push)
- **Alcance**: verificación (build / test / typecheck / capturas visuales) + auditoría de FASE 0 y estado del design system de FASE 1
- **Archivos modificados por este slot**: solo este informe y `docs/capturas/*.png`

---

## 0. Re-verificación (13:43–13:44 UTC)

El builder (slot 03) editó el árbol **en vivo** entre 13:22 y 13:37 mientras yo verificaba. Este informe refleja el estado del árbol a las **13:44 UTC**: re-corregí typecheck y tests sobre el árbol final, y la réplica para capturas se construyó a las 13:33 (incluye todo lo anterior a eso). Los hallazgos H1, H2, H3 y H6 marcados abajo como **RESUELTO** lo están *en árbol sin commitear* (H8 sigue en pie).

---

## 1. Tríada de verificación (FASE 0)

| Verificación | Comando | Resultado |
|---|---|---|
| Typecheck | `npx tsc --noEmit` | ✅ PASS (exit 0, re-corrido 13:43 UTC sobre árbol final) |
| Tests | `npx vitest run` | ⚠️ 270 pass · 1 fail · 4 skip (re-corrido 13:44 UTC sobre árbol final) |
| Build | `npx next build` | ✅ PASS (con `DATABASE_URL` sintético — ver hallazgo H5; réplica de capturas compilada 13:33) |

### 1.1 Tests — detalle

- **Línea base previa**: 212 pass. **Primera corrida (13:22)**: 250. **Árbol final (13:44)**: **270 pass** → **+58 en total**, en tres suites nuevas del builder:
  - `lib/__tests__/visit-window.test.ts` (38): contrato básico (4), falla cerrada (9), invariantes (25 = 5 anchors × 5 combos: orden, ISO, determinismo, ancho).
  - `lib/__tests__/alphi-tokens.test.ts` + `lib/__tests__/asim.test.ts` (20 en conjunto): guard de deriva de la paleta (H2) y porte del validador ASIM desde Asistente-CRF (H3). Ambas verdes.
- **El único fail es preexistente** y no fue causado por el trabajo de ALPHI 2.0: `tests/leakage/api-auth-coverage.test.ts:127` — la ruta `/` es pública en el middleware (commit dac43eb, GTM) pero no está en la lista `EXPECTED_PUBLIC_ROUTES` del tripwire (última edición c40adbb). Igual fallaba antes de esta rama. Ver H4.
- Los 4 skip son deliberados (suites que requieren entorno/credenciales, sin cambios respecto de la base).

### 1.2 Build — detalle

- Primer intento **falla**: `Error: DATABASE_URL is not set. See .env.example.` durante "Collecting page data" (import de DB a nivel módulo en `/api/studies/[id]/specs`). En este host `.env.local` está vacío.
- Reintento con valor sintético (sin credenciales reales): `DATABASE_URL="postgresql://synthetic:synthetic@localhost:5432/synthetic" npx next build` → **exit 0**. Turbopack, compilado en 7.1 s.
- Manifiesto de rutas: `/calidad`, `/consulta`, `/jornada`, `/visita` generadas. **`/protocolo` ya existe** en el árbol final (creada por el builder 13:23:59; servida con HTTP 200 en la réplica de capturas — antes era 404, H1).

---

## 2. Auditoría FASE 1 — estado del design system

### 2.1 Lo que existe

| Pieza | Estado | Ubicación |
|---|---|---|
| Paleta Tailwind `alphi` (navy `#0D1F3C`, teal `#0891B2`, sage, amber, rose, slate, border, muted) + sombras + animaciones | ✅ Commiteada (HEAD) | `tailwind.config.ts` |
| Tokens CSS (`@layer base`, variables `--alphi-*`) + tipografía + scrollbar | ⚠️ Sin commitear (cambios del builder en curso) | `app/globals.css` |
| Librería de componentes: `.alphi-card`, `.alphi-btn-primary/secondary/ghost`, `.alphi-input`, `.alphi-label`, `.alphi-pill`, `.alphi-typing-dot`, `.alphi-footnote`, `.alphi-answer-text` | ⚠️ Sin commitear | `app/globals.css` |
| Overrides de Clerk (popovers forzados a paleta ALPHI) | ⚠️ Sin commitear | `app/globals.css` |
| Nav nueva (jornada / protocolo / visita / consulta / calidad) | ⚠️ Sin commitear | `app/(app)/layout.tsx` |
| Páginas nuevas: jornada (9 líneas), visita (12), consulta (9), calidad (9) | ⚠️ Sin commitear | `app/(app)/*/page.tsx` |
| Página `/protocolo` + primera adopción de la librería (`.alphi-card`, `.alphi-label`) | ⚠️ Sin commitear (nueva 13:23:59) | `app/(app)/protocolo/page.tsx` |
| Guard de deriva de paleta (globals.css ⇄ tailwind.config.ts) | ⚠️ Sin commitear (nueva 13:37) | `lib/__tests__/alphi-tokens.test.ts` |

### 2.2 Adopción real (medición, árbol final 13:44)

- jornada / visita / consulta / calidad usan **solo 3 clases alphi cada una**: `bg-alphi-slate` (fondo), `text-alphi-navy` (título), `text-alphi-muted` (subtítulo). Son esqueletos de prototipo, todas con "datos sintéticos".
- **`/protocolo` es el primer consumidor real de la librería**: usa `.alphi-card` y `.alphi-label` (antes la librería no tenía adoptantes).
- `/visita` ya consume el motor de ventanas: muestra `visitWindow?.windowStart – windowEnd` (integración real, no maqueta).
- **Las variables soft** (`--alphi-violet-soft`, `--alphi-green-soft`, `--alphi-blue-soft`, `--alphi-amber-soft`, `--alphi-rose-soft`) siguen definidas y **sin ningún uso** en `app/` ni `components/`.
- **El design system ahora tiene red**: `alphi-tokens.test.ts` fija la paleta y falla si `globals.css` y `tailwind.config.ts` divergen (responde a H2 y al gap de "sin tests de design system" de la primera corrida).

### 2.3 Veredicto FASE 1 (árbol final)

**Sólidamente empezada y saneada**: paleta unificada con guard (H2 resuelto), librería con primer consumidor (`/protocolo`), motor de ventanas con 38 tests, tripwire de paleta en CI. Deuda restante: variables soft sin uso, páginas esqueleto salvo protocolo/visita, y **todo sin commitear** (H8).

---

## 3. Hallazgos

**H1 — Link roto `/protocolo` (medio). → ✅ RESUELTO en árbol sin commitear (13:23:59).** El nav de `layout.tsx` linkeaba `/protocolo` pero la ruta no existía (404 en la primera corrida). El builder creó `app/(app)/protocolo/page.tsx`; verificada con HTTP 200 en la réplica de capturas + screenshot (§6).

**H2 — Paleta doble y divergente (medio, bloqueante de FASE 1). → ✅ RESUELTO en árbol sin commitear (13:37).** Original: `globals.css` y `tailwind.config.ts` definían hex distintos para los mismos tokens (navy `#192337` vs `#0D1F3C`; teal `#6855B6` —violeta— vs `#0891B2` —cyan—; etc.). El builder unificó ambas fuentes (navy/muted ahora `#192337`/`#667085` en las dos) y agregó `lib/__tests__/alphi-tokens.test.ts` como guard de deriva: si vuelven a divergir, CI rompe. Verificado en la corrida 13:44 (20 tests nuevos verdes).

**H3 — `asim.ts` portado sin tests (medio). → ✅ RESUELTO en árbol sin commitear (13:37).** `lib/__tests__/asim.test.ts` portado desde Asistente-CRF con ajustes documentados en el propio archivo (renombrado de tipo + adaptación del caso `amendment`). Pasa en la corrida 13:44.

**H4 — Tripwire de fuga "/" (preexistente, decisión pendiente).** `/` es pública en el middleware desde el commit GTM (dac43eb) y el test de cobertura de auth la reprueba porque no está en `EXPECTED_PUBLIC_ROUTES`. No lo arreglé: elegir entre sacar `/` del middleware o autorizarla concientemente en la lista es decisión de seguridad (carril sicario/reviewer + foreman). Mientras no se resuelva, la batería queda en rojo por ese único caso.

**H5 — Build exige `DATABASE_URL` (bajo, ambiente).** La importación de DB a nivel módulo hace que `next build` falle sin la variable aunque no toque la base. En Vercel/CI está provista; en bancos de prueba hace falta exportarla (sintética alcanza). Sugerencia: documentarlo en el README del repo o mover la conexión a lazy init.

**H6 — Stamp de versión divergente (bajo, trazabilidad). → ✅ RESUELTO en árbol sin commitear (13:31).** El motor reportaba `version: '1.0.0'` mientras el prototipo canónico de Asistente-CRF reporta `'visit-window-motor v0.1.0 (TS mirror)'`. El builder alineó `lib/visit-window.ts` al stamp canónico y actualizó el test que lo pinea (`visit-window.test.ts:18`). Internamente consistente y trazable entre repos.

**H7 — Deprecación Next 16: middleware → proxy (bajo, futuro).** El build tira warning: la convención "middleware" está deprecada a favor de "proxy". No bloquea; anotado para backlog.

**H8 — Trabajo del builder sin commitear (informative).** Toda la capa visual de FASE 1 (globals.css, layout, 4 páginas) y los tests nuevos viven sin commitear en la rama feature. La suite se ejecutó y pasa (era "tests escritos pero no corridos" al momento del STOP anterior — ahora verificados). Falta el commit del builder para dejar la rama coherente.

---

## 4. Cobertura de tests — delta

| Suite | Antes | Árbol final (13:44) |
|---|---|---|
| Total repo | 212 pass / 1 fail / 4 skip | **270 pass** / 1 fail / 4 skip |
| visit-window | 0 (no existía) | 38 pass |
| alphi-tokens (guard de paleta) | 0 | ✅ verde |
| asim (porte desde CRF) | 0 | ✅ verde |

Piso de AGENTS.md (≥60 tests de unidad): 270 ✅ (el único fail es el H4, ajeno a esta rama).

---

## 5. Recomendaciones (por destinatario, actualizadas 13:44)

- **Builder (03)**: H1/H2/H3/H6 ya resueltos por él mismo — queda **commitear la capa visual** (H8) para dejar la rama coherente.
- **Architect (02)**: revisar y refrendar la unificación de paleta hecha por el builder (H2) y el stamp canónico adoptado (H6); decidir destino de las variables soft sin uso.
- **Foreman (01)**: arbitrar H4 (autorizar o revertir la ruta pública "/") — desbloquea la batería en verde. Confirmar dónde vive el master plan (no encontré `docs/ALPHI-2.0-*` en este repo; usé como referencia el de Asistente-CRF + el informe del reviewer).

---

## 6. Capturas visuales (nuevo, 13:40 UTC)

**Método.** Sin credenciales reales de Clerk disponibles (y sin permiso de usarlas), monté una **réplica efímera en `/tmp/webcap`**: copia de la app sin `middleware.ts` (guard de auth removido), construida con `DATABASE_URL` sintético y servida con `next start -p 3100`. Navegué con Chromium headless (Playwright del caché del host; librerías NSS extraídas en `/tmp` porque el sandbox no las tiene). Viewport 1440×900, fullPage. **El árbol del repo no fue tocado** para esto; la réplica se destruyó al terminar.

**Resultado** — 6 capturas en `docs/capturas/`:

| Ruta | Archivo | HTTP | Tamaño | Observación |
|---|---|---|---|---|
| /jornada | `jornada.png` | 200 | 63.9 KB | Verificada visualmente: página real estilizada, nav ALPHI, tarjetas con datos sintéticos |
| /visita | `visita.png` | 200 | 66.9 KB | — |
| /consulta | `consulta.png` | 200 | 57.5 KB | — |
| /calidad | `calidad.png` | 200 | 59.5 KB | — |
| /protocolo | `protocolo.png` | 200 | 59.8 KB | Nueva página del builder (H1) renderizando |
| /sign-in | `sign-in.png` | 200 | **5.8 KB** | **Cuerpo vacío**: sin claves reales de Clerk el componente no dibuja. La captura documenta el estado, no es un render del login real |

- `/` (landing) **no capturada**: en la réplica de esa pasada devolvía 500 (necesita más variables de entorno). Registrado tal cual.
- Las capturas reflejan el árbol a las 13:33–13:40 UTC (incluye las ediciones del builder hasta 13:31; el guard de paleta de 13:37 no cambia pixeles).

---

## 7. FASE 2 — pasada de verificación (14:15–14:35 UTC)

**Alcance real.** En el árbol no existe una implementación dedicada de "FASE 2": el último trabajo del builder es FASE 0+1 (HEAD `0158d4e`, commit del propio informe del builder, 13:42 UTC; antes `c81c30e` y `2b0a3ed`). Esta pasada = re-correr la tríada **sobre el árbol commiteado** + capturar las páginas reales que antes quedaban en 500 + reportar lo nuevo.

### 7.1 Tríada sobre el árbol commiteado (HEAD 0158d4e)

| Verificación | Resultado |
|---|---|
| Typecheck (`npx tsc --noEmit`) | ✅ exit 0 (14:18 UTC) |
| Tests (`npx vitest run`) | ⚠️ **270 pass · 1 fail · 4 skip** (14:19 UTC) — el fail sigue siendo H4 (preexistente, ajeno a la rama) |
| Build (`DATABASE_URL` sintético) | ✅ exit 0 (14:25 UTC) |

### 7.2 H8 → ✅ RESUELTO

Los tres commits del builder (`2b0a3ed` capa visual: layout, globals.css, 5 páginas, restyle de dashboard/library/studies/create-study-form; `c81c30e` asim.ts + tests + guard de paleta; `0158d4e` informe) dejan commiteada toda la capa que §2.1 marcaba "Sin commitear". Las filas de §2.1 quedan superadas: paleta, tokens, librería, overrides de Clerk, nav, páginas y guard de deriva ahora viven en la rama.

### 7.3 Hallazgo nuevo — H9 → ✅ RESUELTO en `1c70bdf` (ver §8.4)

**H9 — Rama incompleta para un clon fresco (alto, bloqueante de fusión).** La página `/visita` está **commiteada** importando `computeVisitWindow` desde `@/lib/visit-window`, pero **`lib/visit-window.ts` (56 líneas) y su suite `lib/__tests__/visit-window.test.ts` (38 tests) siguen sin trackear** (`git status`: untracked). En el árbol de trabajo actual todo pasa porque los archivos existen en disco; pero un `git clone` + checkout de la rama **rompe el build y pierde 38 tests**. Fix mínimo: `git add lib/visit-window.ts lib/__tests__/visit-window.test.ts` + commit (le corresponde al builder).

### 7.4 Adopción de la librería — medición sobre árbol commiteado

Instancias de clases `alphi-*` por archivo: `library-client.tsx` ≈51 · `app/(app)/dashboard/page.tsx` ≈41 · `app/(app)/studies/page.tsx` ≈23 · `components/studies/create-study-form.tsx` ≈10. Las páginas reales ya no son esqueletos: el restyle de FASE 1 llegó a las tres pantallas principales. En el manifiesto del build, `/studies/import` figura ahora como ○ (Static).

### 7.5 Capturas de las páginas reales (5 nuevas, 14:31 UTC)

**Método (extensión del §6).** Las cinco páginas reales guardan la base detrás del `orgId` de `await auth()`. Sin credenciales de Clerk (y sin permiso de usarlas), la réplica efímera agrega un **stub propio de `auth()`** (`/tmp/webcap/lib/auth-stub.ts`, solo en la réplica — el repo no fue tocado) que devuelve sesión nula `{ orgId: null, userId: null, orgRole: null }`. Verificado en fuente: las cinco páginas ante sesión nula renderizan su estado vacío/restringido sin tocar la base. El servidor se levantó con `DATABASE_URL` sintético caído (sin base real).

| Ruta | Archivo | HTTP | Tamaño | Contenido verificado en el HTML servido |
|---|---|---|---|---|
| /dashboard | `dashboard.png` | 200 | 100.9 KB | Hero navy "Bienvenido de vuelta" + "ALPHI - Clinical Document Intelligence" + `bg-alphi-navy`/`shadow-alphi-panel` |
| /library | `library.png` | 200 | 54.1 KB | Tarjetas `.alphi-card`, texto `text-alphi-muted` |
| /studies | `studies.png` | 200 | 53.4 KB | Título "Estudios", `alphi-card`, `text-alphi-navy` |
| /settings | `settings.png` | 200 | 49.0 KB | Aviso ámbar de solo lectura (`org_admin`/`study_admin`), footer ALPHI completo |
| /admin | `admin.png` | 200 | 36.4 KB | "Acceso restringido" + "Administración" (doble guard, nunca llega a la base) |

- **Verificación de contenido**: además del PNG, se confirmó con `curl` que el HTML servido contiene los textos/clases esperados (columna de la derecha). No son páginas de error: 36–100 KB vs ~19 KB de una página de error de Next.
- **Qué muestran**: estados vacíos estilizados (sin datos, sesión nula, base sintética caída). Documentan el diseño de la capa visual, no contenido real.
- `/` con sesión nula hace **307 → /sign-in**: comportamiento correcto; la vieja `home.png` (página de error 500 del build anterior al stub) fue **retirada**. La nota de §6 sobre `/` queda superada.
- `sign-in.png` mantiene su caveat del §6 (cuerpo vacío sin claves de Clerk).

### 7.6 Inventario final de capturas (11 PNG)

jornada · visita · consulta · calidad · protocolo (páginas del builder, 14:23) + sign-in (cuerpo vacío documentado) + dashboard · library · studies · settings · admin (páginas reales en estado vacío, 14:31). Todas en `docs/capturas/`.

### 7.7 Arrastrados (sin cambios)

H4 (pendiente de arbitraje), H5 (documentar `DATABASE_URL` en bancos de prueba), H7 (middleware→proxy), `ichtys/.gitignore` con línea `.env*` sin commitear, `node_modules/` raíz sin trackear.

### 7.8 Recomendación principal de esta pasada

**Builder (03): commitear `lib/visit-window.ts` + su suite (H9).** Es el único bloqueante real para que la rama sea clonable y fusionable. Con eso, la rama queda: tríada verde (salvo H4 preexistente), capa visual commiteada, 38 tests del motor recuperados en git.

---

## 8. FASE 7 — verificación del flujo completo upload → parse → embed → chat (16:20–16:35 UTC)

**Alcance real y método.** El pedido es el flujo de punta a punta: subir un documento, parsearlo, vectorizarlo y consultarlo por chat. En este host ese flujo **no puede ejecutarse de verdad por HTTP**: `.env.local` está vacío (sin claves de Clerk, sin token de Vercel Blob, sin Postgres+pgvector, sin API keys de OpenAI/Anthropic) y no hay autorización de deploy. La verificación fue **por etapas, con datos sintéticos**: (a) auditoría de continuidad de la cadena en código, con evidencia archivo:línea en cada eslabón, y (b) ejecución de las suites de tests de cada etapa (todas con mocks / DB sintética). No se reporta un "pase end-to-end" que no corrió.

### 8.1 La cadena en código — continuidad verificada

| # | Etapa | Evidencia (archivo:línea) |
|---|---|---|
| 1 | **Subida** — el cliente arma `FormData` y hace XHR `POST /api/documents/upload` | `components/documents/upload-zone.tsx:116` |
| 2 | La ruta valida sesión y estudio (`validateStudyAccess`), aplica rate limit de ventana deslizante `upload:${userId}:${orgId}`, rechaza no-PDF (415 por tipo y por magic bytes `%PDF-`), límite 50 MB (413), sube a Blob privado con key `clinical-documents/${uuid}/${sanitized}` y en una transacción crea `documents` + `documentVersions` (`status:'pending'`, versión 1) + `auditLogs` `document.upload`; responde 202 con `{documentId, documentVersionId}` | `app/api/documents/upload/route.ts` |
| 3 | **Disparo de ingesta** — el cliente parsea `documentVersionId` de la respuesta del upload y hace `POST /api/ingestion/run` (silencioso si falla; reintento manual en la tabla de documentos) | `upload-zone.tsx:121-141`; reintento en `documents-status-list.tsx:194` |
| 4 | La ruta valida acceso a la versión, responde 202 inmediatamente y corre el pipeline en background (`after()`, `maxDuration` 300) | `app/api/ingestion/run/route.ts` |
| 5 | **Parse → chunk → embed → index** — `runIngestion` descarga el PDF autorizado, parsea (`:229`), troza en páginas/chunks (`:230`), los persiste con scope org/estudio, e indexa (`:286` → `indexer.ts`: chunks con `embedding IS NULL` → `embedBatch` → update con `{embedding, tokenCount}`, con auditoría `embeddings.started/completed/failed`); extrae el spec del protocolo (`:304`/`:330`) y marca `status:'ready'` (`:353`). Todo error queda sanitizado a un código (`IngestionErrorCode`, p. ej. `ingestion_internal_error`) | `packages/ingestion/pipeline.ts` |
| 6 | **Chat** — la ruta valida estudio (`:119`), audita `rag.answer.requested` (`:173`) y delega al orquestador | `app/api/chat/route.ts:119,173` |
| 7 | El orquestador recupera chunks relevantes (`:99`) y genera la respuesta (`:115`) | `lib/rag/answer-orchestrator.ts:99,115` |
| 8 | La búsqueda usa pgvector con distancia coseno (`<=>`), scope org/estudio, topK acotado | `packages/rag/retriever.ts:141` |
| 9 | El motor de respuesta (`generateObject`/`streamText` de `ai`) ancla la respuesta **exclusivamente** a los chunks recuperados, con citas `[n]`; cadena de proveedor anthropic→google por org; errores sanitizados (`llm_provider_error`) | `packages/rag/answer-engine.ts` |
| 10 | La respuesta vuelve como `{answer, citations, retrievalCount}` con auditoría `rag.answer.completed/failed` | `app/api/chat/route.ts` |

**Consistencia de dimensiones (eslabón crítico embed↔retrieve).** Escritura y lectura importan la **misma constante** `EMBEDDING_DIMENSIONS` desde `@ichtys/db` (`packages/ingestion/embedder.ts:2` y `packages/rag/retriever.ts:7`). Modelo default `text-embedding-3-small` (1536 dims; override por env `EMBEDDING_MODEL`). Un vector de otra dimensión se detecta y sanitiza como `embedding_dimension_mismatch` en ambos extremos: no hay forma de escribir embeddings que la lectura no pueda comparar.

### 8.2 Suites ejecutadas por etapa — todas verdes (2026-10-19, 16:30 UTC)

| Etapa del flujo | Suite | Resultado |
|---|---|---|
| parse + chunk + embed + index + pipeline completo | `packages/ingestion` (6 archivos: parser, chunker, embedder, indexer, pipeline, spec-extractor) | ✅ **25/25** (16:30:13) |
| retrieval pgvector + leakage cross-org + generación anclada | `packages/rag` (5 archivos: answer-engine 52, medical-annotator 28, retriever 8, terminology-answer 8, retriever-leakage 5) | ✅ **101/101** (16:30:24) |
| rutas de chat y citas + orquestador | `apps/web` (4 archivos: chat route 29, citations route 10, answer-orchestrator 13, terminology-intent 4) | ✅ **56/56** (16:30:36) |

**Total: 182 tests verdes** sobre los archivos que implementan el flujo. La salida de vitest muestra stack traces tipo `FAILED ... provider leaked sensitive embedding internals`: son los **casos negativos esperados** (tests que verifican que los errores NO filtran internals), no fallas. Los 5 tests de leakage confirman que el retrieval no cruza organizaciones ni estudios.

### 8.3 Límite honesto del end-to-end real

No se ejecutó el flujo completo contra servicios reales: requeriría Clerk (sesión), Vercel Blob (PDFs), Postgres+pgvector (chunks/vectores) y claves OpenAI/Anthropic (embeddings/respuesta) — nada de eso existe en este host y no hay autorización de deploy. Lo que sí quedó verificado: la cadena **existe y está conectada de punta a punta** (§8.1, cada eslabón con evidencia) y **cada etapa pasa sus pruebas con datos sintéticos** (§8.2). El pase real queda pendiente para un entorno con servicios (preview de Vercel o VPS) antes de fusionar a main, si se quiere evidencia completa.

### 8.4 H9 → ✅ RESUELTO (HEAD `1c70bdf`)

El builder commiteó `lib/visit-window.ts` (56 líneas) + `lib/__tests__/visit-window.test.ts` (38 tests) en `1c70bdf` ("FASE 0-6 completas"). La rama ahora es clonable sin romper el build ni perder los 38 tests del motor. La recomendación de §7.8 queda cumplida.

### 8.5 Hallazgo nuevo — H10 (menor)

**H10 — Rutas del flujo sin tests de ruta directos, en particular `/api/documents/[id]/status`.** Los handlers de ruta del flujo — upload, ingestion/run y sobre todo `/api/documents/[id]/status` (la que la tabla de documentos consulta por polling del estado del pipeline) — no tienen suites de ruta propias. La cobertura llega por vía indirecta: las validaciones de acceso viven en `@ichtys/auth` (testeado), el pipeline en `packages/ingestion` (25 tests) y el orquestador en `apps/web` (13 tests). La lógica de ruta restante es delgada (validar uuid, elegir última versión por `documentId/orgId/studyId`), así que el riesgo es bajo — pero status es el único eslabón del flujo con **cero** tests encima de su lógica propia.

### 8.6 Recomendaciones de esta pasada

- **Builder (03), baja prioridad**: suite para `/api/documents/[id]/status` (H10). Opcional: tests de ruta para upload/ingestion-run.
- **Foreman (01) / Santiago**: para la evidencia end-to-end real hace falta un entorno con servicios (Clerk + Blob + Postgres/pgvector + claves LLM). Sugerido: preview de Vercel o VPS con datos sintéticos, antes de cualquier fusión a main.

---

## 9. Pasada E2E — typecheck, build, tests, capturas (16:45–17:05 UTC)

Re-ejecución completa sobre el repo real (`feature/alphi-2.0-visual-redesign`, HEAD `1c70bdf`, sin modificar nada del árbol salvo este informe y `docs/capturas/`) + capturas nuevas de las 25 rutas de la app.

### 9.1 Verificación en el repo real

| Chequeo | Resultado |
|---|---|
| `npx tsc --noEmit` | ✅ EXIT=0, sin errores |
| Suite completa (`npx vitest run`) | ✅ **270 pass / 1 fail / 4 skip** — 24 archivos, 1.75 s, arranque 16:45:26. La única falla es **H4, preexistente en main** (`tests/leakage/api-auth-coverage.test.ts:127`, ruta pública `/` no incluida en la revisión). `visit-window` 38/38 incluidos (H9 sigue resuelto). |
| `next build` (DATABASE_URL sintético) | ✅ EXIT=0. Manifiesto real: **11 rutas estáticas** (calidad, consulta, jornada, pricing, privacy, protocolo, roi, studies/import, terms, trust, visita) + **12 dinámicas** (dashboard, library, settings, sign-in, sign-up, studies, studies/[id]/{chat,documents,history,spec,subjects}, subjects/[subjectId]) + Middleware. Conteos idénticos a §7 porque el HEAD no cambió (`1c70bdf`, 14:21:35 UTC). |

### 9.2 Capturas E2E — método (réplica aislada en `/tmp/e2epilot`)

Misma técnica probada en §7, extendida a toda la app:

1. **Copia aislada** de `apps/web` en `/tmp/e2epilot` (rsync sin `node_modules`/`.next`, symlink al `node_modules` real, sin `middleware.ts`, `tsconfig.base.json` copiado dentro). **El árbol del repo queda intacto** — todos los `sed` tocan solo la copia; `app/api` excluido de toda reescritura.
2. **Dos stubs**: `auth()` devuelve sesión nula (no inventa sesión); los validadores de `@ichtys/auth` lanzan `AccessError` **404** "Study not found or access denied". 16 imports de páginas reescritos a estos stubs.
3. **Por qué 404 y no 401** (decisión documentada, verificada empíricamente): la ruta real de un usuario sin sesión es middleware → redirect a sign-in, que depende de Clerk y no es reproducible sin credenciales. Y el layout `studies/[id]` solo atrapa `AccessError` con `status === 404` — un 401 escapa como 500 genérico (confirmado en el primer intento). Con 404, las páginas `[id]` ejercitan su **rama real de UI** "Estudio no disponible" en vez de un error de framework.
4. Build de la réplica EXIT=0 + `next start -p 3021`; capturas con Playwright/Chromium 1440×900, fullPage, `networkidle`+500 ms.

### 9.3 Resultados — 25 rutas verificadas por HTTP + 25 capturas

**Verificación curl (estado, tamaño, título):**

| Grupo | Rutas | Resultado |
|---|---|---|
| Raíz | `/` | **307 → /sign-in** — redirección real sin sesión (`app/page.tsx` con `userId` nulo) |
| Públicas (11) | calidad 31125 B, consulta 30078 B, jornada 31191 B, pricing 35881 B, privacy 33013 B, protocolo 29888 B, roi 20388 B, terms 32430 B, trust 47235 B, visita 30421 B, studies/import 30987 B | **200 todas**, títulos correctos ("Precios — Ichtys/ALPHI", "Política de privacidad — Ichtys/ALPHI", "Términos de servicio — Ichtys/ALPHI", "Trust Center — Ichtys/ALPHI"; resto título default) |
| Auth | `/sign-in`, `/sign-up` | **200**, 10634 B (Clerk sin claves renderiza mínimo — limitación conocida) |
| App shell (5) | dashboard 35866 B, library 29425 B, settings 29559 B, studies 30639 B, admin 28584 B | **200 todas** — renderizan su estado sin sesión, sin 5xx y sin DB |
| Estudio `[id]` (6) | chat, documents, history, spec, subjects, subjects/S-001 | **200 todas**, 29.5–30 KB, `Estudio no disponible` presente ×1 — la card real del layout |

**Capturas:** 25 archivos `e2e-*.png` en `docs/capturas/` (17:01), **todas http 200, ninguna menor a 5 KB**. Detalles: `e2e-home.png` muestra sign-in (post-redirect, por eso home/sign-in/sign-up son de 5854 B); las 6 `[id]` son PNGs idénticos (41306 B) — el layout corta antes de montar los children, mismo card de no-acceso, esperado por diseño; las más pesadas son `e2e-trust.png` (329 KB) y `e2e-dashboard.png` (101 KB). Las 11 capturas de FASE 2 quedan intactas.

### 9.4 Hallazgo nuevo — H11 (menor)

**H11 — `studies/[id]/layout.tsx` solo atrapa `AccessError` 404; un 401 escapa como 500.** El catch del layout filtra `err.status === 404` y re-lanza todo lo demás. Hoy el middleware protege las rutas antes, así que el 401 nunca llega al layout en producción — pero si el middleware se relaja, se desactiva o queda un gap, un usuario sin sesión recibiría un 500 genérico en las 6 páginas de estudio en vez de la card o un redirect. Verificado empíricamente en la réplica (primer intento con stub 401 → 500 en las 6 rutas). **Sugerencia al builder (03), baja prioridad**: atrapar 401/403 igual que 404 (redirect a sign-in para 401, card para el resto).

### 9.5 Notas honestas

- Sin DB ni credenciales reales: las capturas muestran **ramas sin sesión**. No se inventó sesión ni datos en pantalla; los stubs solo replican lo que el paquete real haría con sesión nula.
- `dashboard` renderizó **○ estático** en la réplica (efecto del stub: sin dependencia dinámica) vs **ƒ dinámico** en el build real de §9.1 — diferencia esperada del método, no un cambio del código.
- La réplica y el servidor :3021 fueron desmontados al terminar (puerto liberado); el repo real no contiene ningún artefacto de esta pasada salvo el informe y los PNGs.
- H4 (falla preexistente en main) y H10 (§8.5) siguen en pie; nada nuevo bloqueante.

---

*Generado por testpilot slot 05. Datos sintéticos; sin deploy; sin push a main; sin invención de evidencia.*
