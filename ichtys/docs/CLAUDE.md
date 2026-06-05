# CLAUDE.md — Ichtys Clinical Document Assistant

Este archivo define las reglas de trabajo para Claude Code en este repositorio.
Leé esto antes de tocar cualquier archivo.

---

## Qué es este producto

Ichtys es un asistente documental clínico multi-tenant. Responde preguntas en lenguaje natural sobre documentos de ensayos clínicos (protocolos, IBs, manuales de laboratorio y farmacia) con respuestas grounded y citas exactas al documento fuente.

Opera en entornos regulados. Los errores acá tienen consecuencias clínicas reales.

---

## Stack

- **Frontend**: Next.js 15 App Router + TypeScript + Tailwind + Vercel AI SDK
- **DB**: Neon Postgres + pgvector (Drizzle ORM)
- **Auth**: Clerk Organizations (multi-tenant B2B)
- **Storage**: Vercel Blob (PDFs)
- **Hosting**: Vercel
- **CI/CD**: GitHub Actions

Ver `docs/ARCHITECTURE.md` para el modelo de datos completo y flujos.

---

## Reglas no negociables

### Seguridad y aislamiento

1. **NUNCA** acceder a datos sin validar `organization_id` y `study_id` server-side
2. **NUNCA** tomar `organization_id` del body del request — siempre desde el token de Clerk
3. **NUNCA** hacer retrieval sin filtrar por `organization_id` + `study_id` primero
4. **NUNCA** servir PDFs con URLs públicas — siempre signed URLs con expiración
5. Todo acceso sensible debe generar una entrada en `audit_logs`

### Answer engine

6. **NUNCA** generar una respuesta sin evidencia recuperada — si no hay chunks suficientes, usar fallback explícito
7. **NUNCA** omitir citas en respuestas del assistant (excepto fallback de "no encontré evidencia")
8. **NUNCA** mezclar documentos de distintos estudios en el mismo contexto de respuesta

### Código

9. **TypeScript strict** — no `any`, no `as unknown`, tipos explícitos siempre
10. **No mocks en paths críticos** (auth, retrieval, citations) salvo tests explícitamente marcados como unit tests
11. **Zod** para validar inputs de API routes y payloads externos
12. Toda función async debe tener manejo de error explícito — no silenciar excepciones
13. **No LangChain ni LlamaIndex** — el pipeline RAG es código propio y explícito

---

## Antes de tocar cualquier capa

Leé estos archivos si no los tenés en contexto:

- `docs/PRD.md` — qué se está construyendo y para quién
- `docs/ARCHITECTURE.md` — modelo de datos, flujos y decisiones técnicas
- `docs/SECURITY.md` — reglas de seguridad expandidas
- `docs/EVALS.md` — cómo se mide la calidad del RAG

---

## Cuándo escribir tests

- **Siempre**: tenant isolation (leakage entre orgs y estudios)
- **Siempre**: auth guards en API routes
- **Siempre**: chunking metadata (que page_start, page_end, section_title se persistan correctamente)
- **Siempre**: fallback de insufficient_evidence en el answer engine
- **Siempre**: que las citas en `citations` apunten a chunks reales de la org/study correcta

Tests de leakage son bloqueantes para release. Si fallan, no se hace deploy.

---

## Estructura de PR

- Un PR = una capa o una feature acotada
- No mezclar schema changes con lógica de negocio
- Incluir descripción de qué cambió y por qué
- Si tocás el schema: incluir migration y verificar contra Neon branch

---

## Convenciones de código

```typescript
// API routes — siempre validar auth y tenant antes de lógica
export async function POST(req: Request) {
  const { userId, orgId } = auth()
  if (!userId || !orgId) return new Response('Unauthorized', { status: 401 })

  const body = await req.json()
  const parsed = InputSchema.safeParse(body)
  if (!parsed.success) return new Response('Bad Request', { status: 400 })

  // Validar que study_id pertenece a esta org
  const { study } = await validateStudyAccess(parsed.data.study_id)

  // ... lógica
}
```

```typescript
// Queries con filtro de tenant — SIEMPRE incluir organization_id
const chunks = await db.query.chunks.findMany({
  where: (c, { eq, and, sql }) => and(
    eq(c.organization_id, orgId),   // ← obligatorio
    eq(c.study_id, studyId),        // ← obligatorio
    sql`${c.embedding} <=> ${queryEmbedding} < 0.25`
  ),
  limit: 8,
  orderBy: (c, { sql }) => sql`${c.embedding} <=> ${queryEmbedding}`
})
```

---

## Qué NO hacer

- No agregar dependencias sin evaluar si son necesarias
- No hacer queries sin filtro de tenant aunque "solo sea para testing"
- No mergear PRs con leakage tests fallando
- No simplificar el answer engine para "que responda algo" cuando no hay evidencia
- No hardcodear `organization_id` o `study_id` en fixtures de test sin aislamiento explícito
- No exponer errores internos en respuestas de API (log server-side, mensaje genérico al cliente)

---

## Comandos útiles

```bash
# Desarrollo
pnpm dev

# Type check
pnpm typecheck

# Tests
pnpm test
pnpm test:leakage    # Tests de tenant isolation (bloqueante)

# DB
pnpm db:generate     # Generar migration desde schema
pnpm db:migrate      # Aplicar migrations
pnpm db:studio       # Drizzle Studio local

# Eval suite
pnpm evals:run       # Correr evaluación completa
pnpm evals:quick     # Eval rápido (20 preguntas)
```

---

## Contexto clínico que necesitás saber

Los usuarios de este producto son coordinadores de investigación clínica (CRCs), investigadores principales (PIs) y monitores. Operan bajo ICH E6 GCP, FDA 21 CFR, y regulaciones de ANMAT (Argentina) / ANVISA (Brasil).

Las preguntas típicas son:
- "¿Este paciente cumple criterios de elegibilidad con HbA1c 9.2%?"
- "¿Cuál es el procedimiento de manejo para las muestras PK de la visita 4?"
- "¿Cuál es el timeline de reporte para un SAE serio inesperado?"
- "¿Está permitida la metformina como medicación concomitante?"

Una respuesta incorrecta con apariencia de certeza es peor que ninguna respuesta. El fallback de "no encontré evidencia suficiente" es una feature, no un bug.
