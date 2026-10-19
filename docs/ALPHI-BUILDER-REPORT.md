# ALPHI 2.0 — Reporte del Builder (slot 03)

> Fecha: 2026-10-19
> Repo: `Asistente_bot` (monorepo `ichtys/`) · Rama: `feature/alphi-2.0-visual-redesign`
> Commits: `2b0a3ed` (capa visual) · `c81c30e` (tests H2+H3) · E2E verificado sobre HEAD `1c70bdf` (ver §6)
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

Review de `2b0a3ed` + `c81c30e` + `1c70bdf` por el Reviewer (slot 04). E2E del Builder: **PASS** con deuda documentada (§6) — pendiente de directiva el fix del timeout del chat y la decisión sobre H4. Los commits están locales en `feature/alphi-2.0-visual-redesign`; cualquier push requiere aprobación explícita de Santiago.

— Builder, slot 03 · BOPE-OS
