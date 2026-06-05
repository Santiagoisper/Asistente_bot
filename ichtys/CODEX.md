# CODEX — Ichtys Engineering Codex

Reglas operativas de ingeniería para este monorepo. Complementa `docs/CLAUDE.md`
(reglas para agentes) y `docs/ARCHITECTURE.md` (modelo de datos y flujos).

---

## Layout del monorepo

```
ichtys/
├── apps/web          # Next.js 15 App Router (UI + API routes)
├── packages/db       # Drizzle schema, client, migrations  (@ichtys/db)
├── packages/auth     # Tenant guards y roles               (@ichtys/auth)
├── packages/ingestion# PDF → pages → chunks → embeddings   (@ichtys/ingestion)
├── packages/rag      # Retrieval + answer engine + guardrails (@ichtys/rag)
├── packages/evals    # Eval framework + dataset clínico     (@ichtys/evals)
└── packages/ui       # Componentes compartidos              (@ichtys/ui)
```

Gestión: **pnpm workspaces + Turborepo**. Cada package declara sus deps; nada
de imports cruzados por path relativo entre packages — siempre por nombre
(`@ichtys/*`).

---

## Boundaries no negociables (resumen)

1. `organization_id` **siempre** del token de Clerk, nunca del body.
2. Retrieval **siempre** filtra por `organization_id` + `study_id` antes del
   vector search.
3. Sin evidencia recuperada → fallback `insufficient_evidence`, no respuesta.
4. Toda acción sensible → `audit_logs`.
5. TypeScript strict, Zod en bordes de API, sin `any`.

Ver `docs/CLAUDE.md` y `docs/SECURITY.md` para la lista completa.

---

## Flujo de trabajo

- Una rama por capa/feature acotada. No mezclar schema changes con lógica.
- Antes de PR: `pnpm typecheck && pnpm lint && pnpm test`.
- Si tocás schema: `pnpm db:generate` + revisar la migration + `pnpm db:check`.
- Tests de leakage (`pnpm test:leakage`) son **bloqueantes** para merge.

---

## Comandos

```bash
pnpm dev            # Todos los dev servers (turbo)
pnpm typecheck      # tsc --noEmit en todos los packages
pnpm lint
pnpm test
pnpm test:leakage   # Tenant/study isolation (bloqueante)
pnpm db:generate    # Generar migration desde schema Drizzle
pnpm db:migrate     # Aplicar migrations a Neon
pnpm db:check       # Validar drift schema/migrations contra Neon branch
pnpm db:studio      # Drizzle Studio
pnpm evals:run      # Eval suite completa
pnpm evals:quick    # Eval rápido (20 preguntas)
```

---

## Estado del scaffold

Este repositorio fue inicializado en PASO 1 con la estructura completa y
stubs tipados. Cada archivo marca con `// TODO(paso-N)` lo que falta
implementar en pasos posteriores. Los stubs compilan y respetan los
boundaries de seguridad: no introducen queries sin filtro de tenant ni
respuestas sin evidencia.
