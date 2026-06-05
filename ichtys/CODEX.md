# CODEX — Reglas de scope para el agente secundario

Este archivo define qué puede y qué no puede hacer un **agente de codegen
secundario** (Codex / cualquier asistente que no sea el dueño de la
arquitectura) trabajando en este repositorio.

Las reglas de producto y seguridad viven en `docs/CLAUDE.md`,
`docs/ARCHITECTURE.md` y `docs/SECURITY.md`. Este CODEX es el **contrato de
límites**: define el sandbox.

> **REGLA 0 — Lectura obligatoria.** Antes de proponer o aplicar CUALQUIER
> cambio, leé `docs/ARCHITECTURE.md` (modelo de datos + flujos) y
> `docs/CLAUDE.md` (reglas no negociables). Si el cambio toca seguridad,
> también `docs/SECURITY.md`. No se acepta un diff de un agente que no pueda
> citar la sección de ARCHITECTURE.md que lo respalda.

---

## 1. Qué PODÉS tocar (con criterio)

| Área | Permitido |
|---|---|
| `apps/web/components/**` | Sí — UI nueva, siempre tipada y mobile-first |
| `apps/web/app/(app)/**` páginas | Sí — composición de UI sobre datos ya validados |
| `packages/ui/**` | Sí — primitivas compartidas |
| Implementar `TODO(paso-N)` | Sí — completá el stub respetando su firma y contratos |
| Tests (`**/tests/**`, `*.test.ts`) | Sí — sumá cobertura, especialmente de aislamiento |
| `packages/evals/dataset/**` | Sí — sumá casos clínicos / adversariales |

## 2. Qué NO PODÉS tocar sin aprobación explícita

| Área | Por qué |
|---|---|
| `packages/db/schema/**` y `migrations/**` | Cambios de schema = decisión arquitectural + migration revisada |
| `packages/auth/**` | Es el boundary de tenant; un error acá es catastrófico |
| `packages/rag/retriever.ts` | El filtro org+study antes del vector search es sagrado |
| `packages/rag/guardrails.ts` | La lógica de fallback no se "ablanda" para responder más |
| `middleware.ts`, `next.config.ts`, `turbo.json`, `tsconfig*` | Config de plataforma |
| `.github/workflows/**` | Gates de CI/CD |
| Stack (deps mayores, frameworks) | El stack está **bloqueado** (ver ARCHITECTURE.md) |

Si una tarea **requiere** tocar algo de la columna izquierda, NO lo hagas:
abrí una propuesta describiendo el cambio y esperá aprobación.

---

## 3. Contratos que DEBÉS respetar

Son invariantes verificables. Romper uno = el diff se rechaza.

1. **Tenant boundary**: ninguna query lee datos sin filtrar por
   `organization_id` Y `study_id`. El `organization_id` se obtiene de
   `validateStudyAccess()` (token de Clerk), nunca del body/query/headers.
2. **Retrieval**: todo paso por `retrieve()` de `@ichtys/rag`. Prohibido
   construir vector search ad-hoc sin el filtro de tenant.
3. **Answer engine**: sin evidencia suficiente → fallback
   `insufficient_evidence`. Nunca generar respuesta sin citas (salvo el
   fallback). Nunca mezclar documentos de estudios distintos en un contexto.
4. **API routes**: patrón fijo `auth → Zod → validateStudyAccess → lógica`.
   Errores internos nunca se exponen al cliente (mensaje genérico + log
   server-side).
5. **Audit**: toda acción sensible escribe en `audit_logs` (incluye accesos
   denegados).
6. **Tipos**: TypeScript strict. Sin `any`, sin `as unknown`. Zod en todo
   borde externo.
7. **Sin orquestadores**: nada de LangChain/LlamaIndex. El pipeline RAG es
   código propio (ARCHITECTURE.md principio 4).

---

## 4. Definition of Done para un diff del agente

Antes de entregar, el cambio DEBE:

- [ ] Citar la sección de `docs/ARCHITECTURE.md` que lo respalda.
- [ ] Pasar `pnpm typecheck && pnpm lint && pnpm test`.
- [ ] No introducir queries sin filtro de tenant (ni en tests).
- [ ] Mantener verde `pnpm test:leakage` (bloqueante).
- [ ] No tocar ningún archivo de la sección 2 sin aprobación previa.
- [ ] Ser acotado: un PR = una capa/feature (ver `docs/CLAUDE.md`).

---

## 5. Layout (referencia rápida)

```
apps/web          # Next.js 15 App Router (UI + API routes)
packages/db       # Drizzle schema, client, migrations   (@ichtys/db)   [bloqueado]
packages/auth     # Tenant guards y roles                (@ichtys/auth) [bloqueado]
packages/ingestion# PDF → pages → chunks → embeddings    (@ichtys/ingestion)
packages/rag      # Retrieval + answer engine + guardrails (@ichtys/rag) [parcial bloqueado]
packages/evals    # Eval framework + dataset clínico      (@ichtys/evals)
packages/ui       # Componentes compartidos               (@ichtys/ui)
```

Gestión: pnpm workspaces + Turborepo. Imports entre packages SIEMPRE por nombre
(`@ichtys/*`), nunca por path relativo cruzado.

---

## 6. Comandos

```bash
pnpm dev | build | typecheck | lint | test
pnpm test:leakage   # aislamiento de tenant (bloqueante)
pnpm db:generate | db:migrate | db:check | db:studio
pnpm evals:run | evals:quick
```
