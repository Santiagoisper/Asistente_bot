# ALPHI 2.0 — Reporte del Builder (slot 03)

> Fecha: 2026-10-19 (§1–§7) · actualizado 2026-10-20 (§8)
> Repo: `Asistente_bot` (monorepo `ichtys/`) · Rama: `feature/alphi-2.0-visual-redesign` → `fix/glm-zai-direct` (§8)
> Commits: `2b0a3ed` (capa visual) · `c81c30e` (tests H2+H3) · E2E sobre HEAD `1c70bdf` (§6) · análisis profundo sobre HEAD `022ec00` (§8)
> Reglas cumplidas: sin push, sin deploy, sin tocar `main`, datos sintéticos, evidencia real capturada de corridas.
> (Reemplaza el borrador previo de este archivo tomado por Foreman; los números finales verificados están acá.)

---

## 1. FASE 0 — Auditoría de paleta (antes → después)

La auditoría encontró **dos fuentes de verdad divergentes**: `app/globals.css` (CSS vars `--alphi-*`) y `tailwind.config.ts` (`colors.alphi`), más una tercera paleta suelta en los colores de Clerk (`app/(app)/layout.tsx`). Se consolidó todo en `globals.css :root` como fuente única.

### Colores de Clerk migrados (layout.tsx)

| Uso | Hex viejo (off-palette) | Hex nuevo (alphi) |
|---|---|---|
| Foreground | `#0D1F3C` | `#192337` (navy) |
| Muted foreground | `#64748B` | `#667085` (muted) |
| Primary | `#0891B2` | `#6855B6` (teal/violeta alphi) |
| Input | `#F8FAFC` | `#F7F8FC` (slate) |

### Paleta consolidada (13 tokens, fuente: `globals.css :root`)

navy `#192337` · teal `#6855B6` (acento violeta; conserva el nombre histórico) · sage `#059669` · amber `#D97706` · rose `#DC2626` · slate `#F7F8FC` · border `#E5E8F0` · muted `#667085` · violet-soft `#F1EDFA` · green-soft `#E9F7F0` · blue-soft `#EAF3FC` · amber-soft `#FFF4E2` · rose-soft `#FCEEF1`

Extras **documentados** solo en tailwind: `navydim #222C42` (hover navy) y `teallit #F1EDFA` (alias legacy de violet-soft).

Referencia visual: https://www.ichtys.com.ar/ (según AGENTS.md del repo).

## 2. FASE 1 — Design system aplicado (commits)

### Commit `2b0a3ed` — capa visual (12 archivos, +260/−59)

- **`app/globals.css`**: `:root` como fuente única de verdad (13 tokens) + utilidades `.alphi-card`, `.alphi-btn-primary/secondary/ghost`, `.alphi-label`, `.alphi-input`, `.alphi-pill`, sombra `alphi-panel`.
- **`tailwind.config.ts`**: `colors.alphi` sincronizado con globals.css; extras documentados en el propio config.
- **`app/(app)/layout.tsx`**: 5 links de navegación nuevos (**Protocolo, Jornada, Visita, Consulta, Calidad** — H1 incluye el acceso a `/protocolo`) + Clerk re-coloreado a la paleta (tabla de arriba).
- **5 páginas stub** con patrón `alphi-card`: `protocolo/`, `jornada/`, `visita/`, `consulta/`, `calidad/` — navegación completa, contenido pendiente.
- **`dashboard/page.tsx`**: caja GCP y layout general en tokens consolidados.
- **`studies/page.tsx`**: pill "Activo" en `green-soft`; tarjetas con hover alphi.
- **`library-client.tsx`** (Biblioteca): 3 puntos normalizados a soft-tokens — badges de estado (approved=green-soft, draft=amber-soft), chip de filtro activo (violet-soft), chips de terminología (SNOMED-CT=violet-soft, LOINC=green-soft).
- **`create-study-form.tsx`**: restyle completo con utilidades alphi (card/btn-primary/secondary/label/input); error en `text-alphi-rose`. **Sin cambios de comportamiento.**

### Commit `c81c30e` — tests H2+H3 (3 archivos, +401)

- **`lib/asim.ts`**: contrato ASIM portado del prototipo Asistente-CRF (era untracked y es dependencia directa de los tests; sin él la rama no compila).
- **`lib/__tests__/asim.test.ts`** (H3, 16 tests): porte de `Asistente-CRF/__tests__/asim.test.ts`. Adaptaciones documentadas en la cabecera del archivo: `ASIMVersion` → `ASIMProtocolVersion` (nombre del tipo ichtys) y el caso `amendment` del prototipo se adapta a `approvedBy`/`approvedAt` (el tipo ichtys no define `amendment`).
- **`lib/__tests__/alphi-tokens.test.ts`** (H2, 4 tests): drift-guard — globals.css y tailwind deben exponer el mismo hex por token compartido; paleta dorada de 13 tokens; extras de tailwind solo los documentados; invariante `teallit === violet-soft`.

## 3. Verificación (evidencia real)

| Corrida | Resultado |
|---|---|
| `tsc --noEmit` (post-cambios) | **PASS**, sin errores |
| `vitest run` (post-cambios) | `Test Files 1 failed \| 23 passed \| 1 skipped (24)` · `Tests 1 failed \| 270 passed \| 4 skipped (275)` |
| Baseline (pre-misión) | typecheck PASS · tests `250 passed / 1 failed / 4 skipped` (255 total, 22 archivos) |

- **Delta: +20 tests, +2 archivos de test, mismo único fallo preexistente.**
- El único fallo (`tests/leakage/api-auth-coverage.test.ts:127` — ruta pública `/` ausente en `EXPECTED_PUBLIC_ROUTES` de middleware) **es preexistente e idéntico al baseline**; no lo introduje ni lo toqué.
- Durante el desarrollo aparecieron 8 errores TS2532/TS2538/TS2322 en mis dos archivos de test (acceso indexado estricto); corregidos con destructuring + guardas. Re-corrida limpia.
- Los 38 tests de `visit-window` ya corrían en el baseline (archivo untracked preexistente en la rama, fuera de mi alcance — ver §4).

## 4. Qué quedó fuera de los commits (a propósito)

- `ichtys/.gitignore` (línea nueva `.env*`): **no es cambio mío de esta misión** — lo dejo sin commitear para que su autor lo revise. Es una mejora de seguridad razonable.
- `lib/visit-window.ts` + `lib/__tests__/visit-window.test.ts`: untracked preexistentes en la rama, fuera del alcance de esta directiva.
- `node_modules/` (untracked, ignorable).

## 5. Flags abiertos / deuda

1. ~~`/studies/import` apunta a un directorio vacío~~ **RETRACTADO en E2E (§6)**: la ruta existe y compila — mi lectura anterior era errónea.
2. ~~`studies/[id]/` también es un directorio vacío~~ **RETRACTADO en E2E (§6)**: las rutas `/studies/[id]/*` existen y compilan.
3. `@ichtys/ui` está vacío (`export {}`) — no hay componentes compartidos reales.
4. `quality.ts` del prototipo CRF no fue portado (fuera de alcance).
5. Scrollbar en `#CBD5E1` — off-palette, menor.
6. Migración de tokens a variables por canal rgb (`rgb(var(--alphi-navy) / <alpha-value>)`) evaluada y **descartada por riesgo** en esta fase (cambiaría el formato de 13 tokens usados en toda la app); queda como endurecimiento futuro para soportar opacidad nativa de Tailwind sobre CSS vars.
7. **Conflicto conocido**: AGENTS.md del repo indica commit→push a `main`→deploy a producción al final de cada stage; las reglas de la misión (sin push / sin deploy / sin tocar `main`) prevalecen.
8. ~~No corrí `build` completo~~ **Cerrado por E2E (§6)**: build PASS con `DATABASE_URL` sintética.

## 6. E2E — verificación final sobre HEAD `1c70bdf` (2026-10-19)

Directiva: "verificar código, tests, build". Corrido sobre el HEAD actual de la rama (incluye mi FASE 0-1 + FASE 3-6 de otros slots).

| Corrida | Comando | Resultado |
|---|---|---|
| Typecheck (10 paquetes) | `corepack pnpm -r typecheck` (`tsc --noEmit` por paquete) | **PASS** — 10/10 sin errores (web, rag, ingestion, db, llm, auth, clinical, crypto, ui, evals) |
| Tests (monorepo completo) | `corepack pnpm -r test` (vitest por paquete) | **547 passed / 1 failed / 4 skipped** — crypto 8 · llm 3 · clinical 16 · db 33 · ingestion 25 · auth 43 · rag 101 · evals 48 · web 270/1/4 |
| Build (app web) | `DATABASE_URL="postgres://synthetic:…@localhost:5432/synthetic" corepack pnpm --filter @ichtys/web build` | **PASS** — "Compiled successfully in 6.4s", 29/29 páginas estáticas, tabla de rutas completa, exit 0 |

- El único fallo sigue siendo el **preexistente H4** (`tests/leakage/api-auth-coverage.test.ts:127`, ruta `/` pública ausente en `EXPECTED_PUBLIC_ROUTES` del middleware) — idéntico al baseline, no lo introduje ni lo toqué; la decisión es del foreman.
- `next build` en este host exige `DATABASE_URL` sintética (sin credenciales reales; coincide con lo reportado por el TestPilot). Nota de entorno: `turbo run …` falla acá ("cannot find binary path" — turbo no encuentra el binario de pnpm), por eso se usó `pnpm -r` directo: mismo efecto, paquete por paquete.
- Los logs de error que aparecen durante los tests (`api.request.failed`, "Proveedor anthropic no configurado") son **fixtures sintéticos esperados** de tests de auth/ingestión que prueban los caminos de fallo — todos los archivos terminan en verde.

### Corrección de flags anteriores

La tabla de rutas del build demuestra que `/studies/import` (○ estática) y `/studies/[id]/{chat,documents,history,spec,subjects}` (ƒ dinámicas) **existen y compilan**. Los flags §5.1/§5.2 de la versión anterior eran lecturas erróneas y quedan retractados arriba.

### Deuda detectada (documentada, NO corregida — requiere directiva)

1. **Cuelgue del chat (FASE 7, raíz conocida)**: `packages/rag/answer-engine.ts` llama `streamText({...})` **sin `abortSignal` ni timeout** — si el proveedor LLM nunca responde, el `for await` cuelga para siempre y el chat se queda girando. Fix ya diseñado y pendiente de directiva: AbortController por proveedor + timeout sobreescribible por env (`LLM_STREAM_TIMEOUT_MS`, espejo del `EMBED_TIMEOUT_MS = 15s` ya existente en el retriever), pasar `abortSignal` a `streamText`, limpiar el timer en `finally`, y tratar `signal.aborted` como elegible-para-fallback en el `catch`; mismo patrón para `generateObject` en `evaluateStreamedAnswerConfidence` y para `answerEngine` no-streaming. El TestPilot ya verificó la cadena completa en código y con tests sintéticos; falta este fix **y** el pase HTTP real (imposible en este host: `.env.local` vacío, sin credenciales).
2. **FASE 2 nunca aplicada**: el mensaje del commit `1c70bdf` dice "FASE 0-6 completas", pero el commit no contiene los class-swaps de FASE 2. La rama tiene FASE 0-1 + 3-6; FASE 2 quedó sin ejecutar por nadie.
3. **H10 (menor, reportado por el TestPilot)**: `/api/documents/[id]/status` sin tests de ruta — deuda aceptada de baja prioridad.

## 7. Siguiente paso sugerido

Review de `2b0a3ed` + `c81c30e` + `1c70bdf` por el Reviewer (slot 04). E2E del Builder: **PASS** con deuda documentada (§6) — pendiente de directiva el fix del timeout del chat (H4 ya no reproduce en `022ec00`; ver §8.1). Los commits están locales en la rama (hoy `fix/glm-zai-direct`); cualquier push requiere aprobación explícita de Santiago.

## 8. ANÁLISIS PROFUNDO — sobre HEAD `022ec00` de `fix/glm-zai-direct` (2026-10-20)

Directiva: "ANÁLISIS PROFUNDO: BUILDER — revisar código, componentes, tests, build." La rama avanzó de `feature/alphi-2.0-visual-redesign` a `fix/glm-zai-direct` (trabajo GLM/Z.AI directo de otros slots); este análisis cubre ese estado, con foco en la integración GLM.

> **Nota de actualización**: al cerrar este reporte, otro slot commiteó el trabajo que estaba sucio como `1ea766e` ("E2E analysis: fix org-llm-keys, spec-extractor, provider-health, chain tests"). Verifiqué ese commit contra los archivos centrales de los hallazgos (a)/(b)/(e) — `keys.ts`, `org-llm-keys.ts`, `provider-health.ts` — y son idénticos línea a línea al árbol sobre el que corrí la verificación. Los hallazgos y números de §8.1 aplican por tanto al HEAD actual `1ea766e`.

### 8.1 Verificación (evidencia real, 2026-10-20)

| Corrida | Comando | Resultado |
|---|---|---|
| Typecheck (10 paquetes) | `corepack pnpm -r typecheck` | **PASS** — 10/10 |
| Tests sin `DATABASE_URL` | `corepack pnpm -r test` | **FAIL en colección** — `apps/web/lib/rag/__tests__/answer-orchestrator.test.ts`: `DATABASE_URL is not set` (`packages/db/client.ts:27`); la corrida `-r` aborta en apps/web (ver §8.2-i) |
| Tests con `DATABASE_URL` sintética | `DATABASE_URL="postgres://synthetic:synthetic@localhost:5432/synthetic" corepack pnpm -r test` | **556 passed / 4 skipped / 0 failed** — crypto 8 · llm 5 · clinical 16 · db 35 · ingestion 29 · auth 43 · rag 101 · evals 48 · web 271 |
| Build (app web) | `DATABASE_URL="postgres://synthetic:…" corepack pnpm --filter @ichtys/web build` | **PASS** — compila, tabla de rutas completa |

- **H4 (§6) ya no reproduce**: el fail de `tests/leakage/api-auth-coverage.test.ts` (ruta `/` pública) no aparece en este HEAD — 0 failed con URL sintética. §6 correspondía a `1c70bdf`.
- Delta contra §6: +9 passed (547→556); llm 3→5, db 33→35, ingestion 25→29, web 270→271. Los logs `[spec-extractor] FAILED … No 'studySpecs' export is defined on the '@ichtys/db' mock` en ingestion son caminos negativos esperados (archivos en verde).

### 8.2 Hallazgos (a–i)

a) **Precedencia invertida para GLM — deliberada, con trade-off**: para GLM la key de plataforma gana sobre la de org (`packages/llm/keys.ts:20-27`), al revés que el resto. Reflejada en `packages/db/org-llm-keys.ts` y documentada en la UI. Trade-off multi-tenant: mientras exista `GLM_API_KEY` global, ninguna organización usa su clave GLM propia.
b) **Lógica de keys duplicada en dos paquetes**: `packages/llm/keys.ts` y `packages/db/org-llm-keys.ts` reimplementan la misma precedencia (preview→GLM→ZAI→org). Hoy consistentes; riesgo de drift ante cambios futuros.
c) **Cadena efectiva = solo GLM; fallback nominal**: `AUTO_PROVIDER_CHAIN = ['glm']`; `runWithLlmFallback` hardcodea 'glm' sin fallback real; loop de proveedores de `answerEngineStream` muerto; `isProviderQuotaError`/`isProviderFallbackError` sin cadena que los use.
d) **Parámetros muertos**: `_preference` en `resolveProviderChain`, `_orgKeys` en `getModelId`/`getGlmBaseUrl`.
e) **Probes de salud secuenciales y sin timeout**: `checkAllProviderHealth` itera 5 proveedores con await secuencial, sin AbortSignal; prueba 5 proveedores cuando solo GLM se usa.
f) **Deuda §6.1 confirmada de punta a punta (chat/stream)**: la ruta no propaga `req.signal` y `answerEngineStream` llama `streamText` sin `abortSignal` ni timeout (`packages/rag/answer-engine.ts:592`); hasta 3 llamadas GLM por pregunta (stream + confianza + título), ninguna con timeout. Fix diseñado en §6; pendiente de directiva.
g) **Patrones buenos**: strip de evidencias `spec:` antes de persistir, regla anti prompt-injection en SYSTEM_PROMPT, invariantes `insufficient_evidence`, sanitización de errores cliente/servidor, quota Z.AI → `quota_exceeded`.
h) **Trabajo sucio de otro slot — regla aplicada**: durante el análisis había 9 archivos fuente (+122/−18), 2 docs y ~30 capturas e2e sin commitear; los dejé fuera de mis commits. Ese estado fue commiteado por su autor como `1ea766e` mientras escribía este reporte; al momento de commitear esto no queda trabajo sucio ajeno en la rama (solo este reporte).
i) **Tests de apps/web exigen `DATABASE_URL` en colección**: `answer-orchestrator.test.ts` (de `8779d48`) pasó a romperse cuando `7137752` cambió su import de `import type { DocumentType }` a import de valor `{ getOrgLlmApiKeys, getOrgRagConfig }` de `@ichtys/db`, arrastrando `client.ts:27` a la colección. `pnpm -r test` aborta en cualquier entorno sin la variable. Fix sugerido (pendiente de directiva): mock de `@ichtys/db` en ese test o import diferido.

— Builder, slot 03 · BOPE-OS
