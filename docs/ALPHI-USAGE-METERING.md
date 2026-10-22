# ALPHI — Consumo y cuota mensual (modelo híbrido)

Estado: **etapas 1, 2 y 3 implementadas en código y migración 0009 aplicada en producción (2026-10-22)**. Ninguna organización tiene plan/cupo asignado todavía (`plan_name`/`monthly_budget_micros` en null) — hasta que se asigne uno, el consumo se mide pero no se limita. Etapa 4 (cobro) pendiente.

## Modelo de negocio (decisión: opción C, híbrido)

- El cliente paga una **cuota mensual** que incluye un **presupuesto de consumo de unos 100 USD**
  del modelo de la plataforma (decisión del 2026-10-21; el valor se asigna por organización).
- El cliente ve cuánto lleva consumido y cuánto le queda.
- Si agota el cupo, puede **cargar su propia clave** de modelo (ya existe en Ajustes) y seguir usando
  ALPHI; ese consumo no descuenta del cupo.
- Sin cupo definido (organización sin plan) no se limita nada.

## Por qué el cupo es en dólares y no en tokens

Un token de embedding cuesta una fracción de un token de respuesta del chat. Sumar tokens mezclaría
cosas que valen muy distinto. Se guardan los tokens **y** el costo estimado de cada llamada; el cupo
se mide en costo estimado.

## Qué se mide

Una fila en `usage_events` por llamada a un modelo (LLM o embeddings): organización, estudio, usuario,
tipo de operación, proveedor, modelo, tokens de entrada y salida, **costo estimado (micro-USD)** y
**quién pagó** (`platform` u `org`).

**Nunca** se guarda contenido (preguntas, respuestas, texto de documentos): solo conteos. La tabla es
append-only y sin claves foráneas, como `audit_logs`, para conservar el historial de facturación.

Tipos (`usage_events.kind`): `chat_answer`, `chat_eval`, `chat_title`, `spec_extraction`,
`clinical_extraction`, `embedding_document`, `embedding_query`.

El cupo del mes (calendario UTC) = suma de `cost_micros` de los eventos con `key_source = 'platform'`.
Importes en micro-USD: 1 USD = 1 000 000 (100 USD = `100000000`).

## Dónde se registra cada tipo (etapa 2)

`runWithLlmFallback` (`packages/llm/fallback.ts`) devuelve `usage` (tokens reales de
`generateText`/`generateObject`/`streamText`) y `keySource` (clave de la org o de la plataforma)
junto al resultado de la llamada. Cada caller con contexto de organización/estudio llama a
`recordUsage` después:

| Tipo | Dónde se mide |
|---|---|
| `chat_answer` / `chat_eval` | `packages/rag/answer-engine.ts` devuelve `usageEvents`; lo registran `answer-orchestrator.ts` (ruta sin streaming) y `/api/chat/stream/route.ts` (streaming) |
| `chat_title` | `apps/web/lib/chat/persistence.ts` → `generateAndPersistConversationTitle` |
| `spec_extraction` | `packages/ingestion/spec-extractor.ts` (una fila por llamada interna: localizador + cada grupo) |
| `clinical_extraction` | `apps/web/lib/subjects/patient-profile-service.ts` → `extractFactsWithLlm` |
| `embedding_document` / `embedding_query` | `packages/ingestion/embedder.ts` → `embedBatch` (una fila por lote real al proveedor) |

Si el caller no pasa `orgId` (p. ej. un test unitario), no se registra nada — no es un error.

## Pantalla de consumo y tope (etapa 3)

- **Pantalla "Consumo"**: nueva ruta `/usage` (link en la barra de navegación, visible para cualquier
  rol de la org — es transparencia de consumo, no administración). Lee `GET /api/org/usage`
  (`apps/web/app/api/org/usage/route.ts`), que junta `getQuotaStatus` + `getUsageSummary` y convierte
  todo a USD. Muestra la barra del cupo, el aviso a partir de `QUOTA_WARNING_RATIO` (80 % por defecto)
  y el desglose por tipo con quién pagó cada llamada.
- **Tope al agotar el cupo**: `runWithLlmFallback` (`packages/llm/fallback.ts`) recibe un flag
  `platformKeyBlocked`; cuando está activo, ignora cualquier proveedor cuya única clave disponible sea
  la de la plataforma — solo sigue funcionando si la organización cargó su propia clave. Si ningún
  proveedor queda disponible, lanza `LlmQuotaExceededError`.
  - `answer-orchestrator.ts` (ruta sin streaming) y `/api/chat/stream/route.ts` (streaming, la ruta
    real) calculan `platformKeyBlocked = !canUsePlatformKey(quotaStatus)` antes de llamar al answer
    engine y lo propagan también a la generación del título.
  - El cliente recibe un mensaje claro y accionable (no un error genérico): en streaming, un frame SSE
    `{type:'error', code:'quota_exceeded', message:'...'}`; en la ruta sin streaming, un `402` con
    `{error:'quota_exceeded', message:'...'}`.
  - **Alcance de esta etapa**: el tope aplica a chat (`chat_answer`, `chat_eval`, `chat_title`), que es
    el consumo recurrente y de mayor volumen. `spec_extraction`, `clinical_extraction` y los dos tipos
    de `embedding_*` siguen **midiéndose** (etapa 2) pero no están gateados todavía — son llamadas de
    ingesta/background, de menor volumen, y bloquearlas sin aviso podría dejar un documento a medio
    procesar. Si el negocio lo pide, extenderlas es agregar `platformKeyBlocked` a esos callers (el
    mecanismo ya existe).

## Precios (estimados, revisar)

`packages/db/usage-pricing.ts` tiene una tabla de USD por millón de tokens. Es una **estimación**, no
la factura del proveedor:

| Modelo | Entrada | Salida | Nota |
|---|---|---|---|
| GLM-5.x (Z.ai) | 1,40 | 4,40 | Fuentes secundarias contradictorias (0,98 / 3,08 vs 1,40 / 4,40): se usa la mayor. **Confirmar en docs.z.ai** |
| Gemini Embedding | 0,15 | — | Anuncio oficial de Google |
| claude-sonnet / haiku | 3 / 1 | 15 / 5 | Conocimiento previo, no re-verificado |
| gpt-4o / gpt-4o-mini | 2,50 / 0,15 | 10 / 0,60 | Conocimiento previo, no re-verificado |
| text-embedding-3-small | 0,02 | — | Conocimiento previo, no re-verificado |
| gemini-2.0-flash | 0,10 | 0,40 | Conocimiento previo, no re-verificado |
| llama-3.3-70b / 3.1-8b (Groq) | 0,59 / 0,05 | 0,79 / 0,08 | Conocimiento previo, no re-verificado |
| **Modelo desconocido** | 3 | 15 | Tarifa conservadora ALTA a propósito |

Corregir un precio sin redeploy de código: variable de entorno `USAGE_PRICE_OVERRIDES_JSON`, p. ej.
`{"glm-5": {"inputPerMTok": 0.98, "outputPerMTok": 3.08}}`. El costo se guarda al momento del evento:
cambiar los precios no reescribe el historial.

## Etapas (un PR por capa, según `CLAUDE.md`)

| Etapa | Contenido | Estado |
|---|---|---|
| 1 | Tabla `usage_events`, columnas `organizations.plan_name` / `monthly_budget_micros`, migración `0009`, módulo `packages/db/usage.ts` + `usage-pricing.ts` y tests (70 en el paquete) | Hecha, **migración aplicada en producción** |
| 2 | Enganchar cada llamada a un modelo para registrar el consumo (chat ×3, título, spec, perfil clínico, embeddings de documentos y de consultas) | Hecha, **sin cupo visible para el cliente aún** (eso es la etapa 3) |
| 3 | Pantalla "Consumo" para el cliente (barra del cupo, desglose por tipo, aviso al 80 %) y tope cuando el cupo se agota (mensaje claro: cargar clave propia o ampliar plan) | Hecha |
| 4 | Cobro automático de la cuota (Stripe u otro) | Pendiente; requiere decisiones comerciales |

## Cómo aplicar la migración (acción manual) — ✅ ya aplicada en producción el 2026-10-22

La migración `0009_usage_metering.sql` solo **agrega** objetos nuevos y es idempotente
(`IF NOT EXISTS`). No modifica ni borra datos. Las migraciones **no** se aplican en el deploy
(ver `ichtys/docs/OPERATIONS.md` §9, incidente del 2026-06-28). Las variables de conexión a la base de
producción están marcadas como secretas en Vercel y **no pueden leerse desde la CLI**, así que se aplica
pegando el SQL en el editor de Neon (o con `drizzle-kit migrate` desde un equipo con acceso):

1. Preferible: probar primero en una branch de Neon.
2. Aplicar en producción **antes** de desplegar código que use las tablas nuevas.
3. Confirmar: `SELECT column_name FROM information_schema.columns WHERE table_name = 'usage_events';`

Asignar el cupo de 100 USD a una organización (después de aplicar la migración):

```sql
UPDATE organizations
SET plan_name = 'Profesional', monthly_budget_micros = 100000000
WHERE id = '<uuid-de-la-organizacion>';
```

## Decisiones pendientes

1. ~~**Qué pasa al agotar el cupo**~~ — implementado en etapa 3: se bloquea solo el uso con clave de
   la plataforma para chat, con mensaje claro. Alternativa aún abierta: permitir sobreconsumo facturado
   aparte en lugar de bloquear.
2. **Aviso al cliente:** al 80 % (valor por defecto, `QUOTA_WARNING_RATIO`) — ya visible en `/usage`.
3. **Margen:** el cupo mide costo estimado del proveedor; el precio de la cuota mensual al cliente
   puede ser mayor. Esa relación es comercial y no está en el código.
4. **Cobro:** manual (factura mensual) o automático.

## Privacidad

- No se guarda texto del usuario ni de documentos en `usage_events`.
- `recordUsage()` nunca lanza ni registra detalles del error de la base: la medición no puede
  degradar el producto ni filtrar datos.
- Toda consulta del módulo filtra por `organization_id`.
