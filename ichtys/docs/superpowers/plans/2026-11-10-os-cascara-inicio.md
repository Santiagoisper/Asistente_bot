# Clinical Research OS — cáscara e Inicio: plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** La app de Alphi muestra el menú lateral y el Inicio de la captura, con datos reales o estados honestos, detrás del interruptor `ALPHI_OS`.

**Architecture:** Tres capas, un PR por capa. (1) Marca no sensible de laboratorio pendiente en `patient_profiles`, derivada del perfil en cada escritura. (2) Paquete `@ichtys/integrations`: token EdDSA, cliente con tiempo límite y validación zod. (3) Cáscara, Inicio y páginas nuevas en `apps/web`, que leen de (1) y (2).

**Tech Stack:** Next.js 16 App Router, TypeScript strict, Drizzle + Neon, Clerk, zod 4.6.7, vitest, `node:crypto` (Ed25519), `lucide-react`.

**Spec:** `ichtys/docs/superpowers/specs/2026-11-10-os-cascara-inicio-design.md`

## Global Constraints

- `organization_id` siempre desde el token de Clerk; toda consulta filtra por organización.
- Ningún widget descifra PHI ni muestra un número sin respaldo.
- Montos en USD. Zona horaria de presentación `America/Argentina/Buenos_Aires`.
- TypeScript strict: sin `any` ni `as unknown`. Zod en toda entrada externa.
- Tiempo límite por satélite 2,5 s; caché de respuestas `ok` 60 s; token con `exp` ≤ 60 s.
- Sin push a `main`, sin deploy, sin migraciones contra Neon desde este plan.
- Error en una compuerta: hasta tres vueltas de corrección; a la tercera se frena y se informa.

## Review Focus

1. Perfil sin fila en `patient_profiles`: el conteo de pendientes no falla y da 0.
2. Satélite que responde 200 con cuerpo enorme o no JSON: estado `invalid_response`, sin colgar el Inicio.
3. Usuario sin organización activa en Clerk: el Inicio y el buscador responden vacío o 401, nunca datos ajenos.
4. Búsqueda con comodines (`%`, `_`) o de un carácter: se escapa, y por debajo de 2 caracteres no consulta.
5. Clave de firma ausente o mal formada con URL configurada: estado `not_configured`, no excepción.

---

### Task 1 — Marca de laboratorio pendiente (PR `feat/os-1-datos`)

**Files:** Modify `packages/db/schema/patient-profiles.ts`; Create `packages/db/migrations/0011_lab_review_pending.sql` y entrada en `meta/_journal.json`; Modify `apps/web/lib/subjects/patient-profile-service.ts`; Create `apps/web/lib/subjects/lab-review-marker.ts`, `scripts/backfill-lab-review-pending.ts`; Test `apps/web/lib/subjects/__tests__/lab-review-marker.test.ts`.

**Interfaces — Produces:**
- Columnas `patientProfiles.labReviewPending: boolean`, `patientProfiles.labReviewPendingSince: Date | null`.
- `labReviewMarker(profile: PatientProfile): { labReviewPending: boolean; labReviewPendingSince: Date | null }`.

- [ ] Test: perfil con `pendingLabReview` → `true` y fecha = `extractedAt`; sin él → `false` y `null`; `extractedAt` inválido → `true` y `null`.
- [ ] Implementar el helper y usarlo en las dos escrituras del perfil (`persistPatientProfile`, `refreshPatientProfileFromEvolution`).
- [ ] Migración SQL a mano (patrón del repo desde `0002`), `when` mayor que el de `0010`.
- [ ] Backfill idempotente con `--dry-run` por defecto y `--apply` explícito.
- [ ] `pnpm typecheck && pnpm test`; commit.

### Task 2 — `@ichtys/integrations` (PR `feat/os-2-integraciones`)

**Files:** Create `packages/integrations/{package.json,tsconfig.json,vitest.config.ts,index.ts,token.ts,summary-schema.ts,config.ts,client.ts}` y `__tests__/{token,client}.test.ts`.

**Interfaces — Produces:**
- `type OsModule = 'queries' | 'viaticos' | 'operacion'`
- `signOsToken(input: { module: OsModule; userId: string; orgId: string; privateKeyPem: string; now?: Date }): string`
- `verifyOsToken(token: string, opts: { module: OsModule; publicKeyPem: string; now?: Date }): OsTokenClaims` (lanza `OsTokenError`)
- `moduleSummarySchema` y `type ModuleSummary` (forma del spec §3.5)
- `type ModuleStatus = 'ok' | 'not_configured' | 'unreachable' | 'unauthorized' | 'invalid_response'`
- `fetchModuleSummary(module: OsModule, ctx: { userId: string; orgId: string }, deps?: { fetch?: typeof fetch; env?: Record<string, string | undefined>; now?: () => Date }): Promise<{ module: OsModule; status: ModuleStatus; summary: ModuleSummary | null; fetchedAt: string }>`
- `clearSummaryCache(): void`

- [ ] Tests de token: ida y vuelta; `aud` equivocado; vencido; firma alterada; `exp - iat ≤ 60`.
- [ ] Tests de cliente con servidor HTTP local: válido → `ok`; sin URL → `not_configured`; clave inválida → `not_configured`; 401 → `unauthorized`; 500 y conexión rechazada → `unreachable`; demora > 2,5 s → `unreachable`; no JSON, forma inválida y cuerpo > 256 KB → `invalid_response`; segunda llamada `ok` dentro de 60 s no vuelve a pedir; un error no se guarda.
- [ ] Implementar; `pnpm typecheck && pnpm test`; commit.

### Task 3 — Datos del Inicio y buscador (PR `feat/os-3-interfaz`, sobre 1 y 2)

**Files:** Create `apps/web/lib/os/{context.ts,inicio-data.ts,search.ts,greeting.ts,nav.ts}`, `apps/web/app/api/search/route.ts`; Modify `apps/web/lib/flags.ts`; Tests en `apps/web/lib/os/__tests__/` y `apps/web/tests/leakage/`.

**Interfaces — Produces:**
- `isOsEnabled(): boolean`
- `getOsContext(): Promise<{ userId: string; orgId: string; firstName: string | null } | null>` (`orgId` interno, resuelto desde Clerk)
- `countActiveStudies(orgId)`, `countPendingLabReviews(orgId)`, `listPendingLabReviews(orgId, limit)`, `labOutcomes30d(orgId, now)`, `listPriorityItems(orgId, satelliteAlerts)`, `listStudiesWithReadyDocs(orgId)`
- `type PriorityItem = { id: string; kind: 'lab' | 'ingestion' | 'spec' | 'satellite'; severity: 'high' | 'medium' | 'low'; title: string; detail: string; href: string; since: string | null }`
- `escapeLike(q: string): string`, `searchOs(orgId, q): Promise<{ studies: SearchHit[]; subjects: SearchHit[] }>`
- `greetingFor(now: Date, timeZone?: string): 'Buen día' | 'Buenas tardes' | 'Buenas noches'`
- `OS_NAV: NavItem[]`, `OS_NAME = 'Clinical Research OS'`

- [ ] Tests puros: saludo (05:00–11:59, 12:00–19:59, resto, en hora de Buenos Aires); `escapeLike`; orden de prioridad (severidad, luego antigüedad); interruptor en producción con y sin `ALPHI_OS=on`.
- [ ] Ruta `/api/search`: 401 sin sesión; `q` < 2 → listas vacías sin tocar la base; tope 10 por tipo.
- [ ] Caso de fuga: una organización no recibe estudios ni sujetos de otra por el buscador ni por los conteos.

### Task 4 — Cáscara y páginas (mismo PR que Task 3)

**Files:** Create `apps/web/components/os/{os-shell.tsx,os-sidebar.tsx,os-topbar.tsx,search-box.tsx,widget-card.tsx,module-status-card.tsx,protocol-intelligence.tsx}`; `apps/web/app/(app)/{inicio,laboratorios,integraciones,queries,operacion,viaticos,agenda,visitas,metricas}/page.tsx`; Modify `apps/web/app/(app)/layout.tsx`, `apps/web/app/(app)/dashboard/page.tsx`, `apps/web/package.json` (`lucide-react`).

- [ ] Layout: con el interruptor apagado se renderiza el layout actual sin cambios.
- [ ] Inicio: un componente de servidor por widget, cada uno con su `Suspense` y su límite de error.
- [ ] Estados "Sin conectar", "Sin agenda", "Próximamente" y "No se pudo cargar" con texto propio.
- [ ] Tests happy-dom: ítem activo del menú; tarjeta de módulo en cada `ModuleStatus`.
- [ ] `pnpm typecheck && pnpm lint && pnpm test && pnpm test:leakage`; commit; PR.
