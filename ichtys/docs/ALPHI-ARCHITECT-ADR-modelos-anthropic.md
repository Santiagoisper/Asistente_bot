# ADR: Alphi sobre Anthropic — mapa de modelos, cadena de proveedores y tratamiento de datos

**Status:** Accepted
**Date:** 2026-10-22
**Authors:** Builder (decisión del Foreman)
**Context:** Operación "Alphi full Anthropic" (PR #34)

---

## Contexto

El chat de producción colgaba 300 s (43 timeouts de Vercel, 7 usuarios) porque la
generación estaba forzada a un proveedor gratuito sin saldo (`LLM_PROVIDER=glm`):
el stream nunca terminaba y la función moría antes de persistir la respuesta del
assistant. Santiago pidió "el programa entero en base a Anthropic". Este ADR fija
las decisiones de modelos y de tratamiento de datos que salen de eso.

## Decisión

### 1. Mapa de modelos por propósito (todos con override por env)

| Propósito | Default | Env de override | Precio (MTok in/out) |
|---|---|---|---|
| answer (chat, streaming) | `claude-sonnet-5-5` | `ANSWER_MODEL` | $2 / $10 |
| title (títulos de conversación) | `claude-haiku-5-5` | `TITLE_MODEL` | $0.10 / $0.50 |
| clinical-extract | `claude-sonnet-5-5` | `CLINICAL_EXTRACTION_MODEL` | $2 / $10 |
| spec / SoA (extracción de cronograma) | `claude-opus-5-5` | `SPEC_EXTRACTION_MODEL` | $4 / $20 |

El spec/SoA usa el modelo más capaz porque es el reclamo #1 del producto y la
precisión manda; el costo queda acotado porque solo se envía el rango de páginas
del cronograma (~US$0,20 por protocolo).

### 2. Cadena de proveedores: respaldo cruzado SOLO en `auto` (decisión de tratamiento de datos)

**La preferencia explícita de proveedor — de la organización o de `LLM_PROVIDER` —
es una cadena de 1, sin respaldo cruzado.** Los datos de una organización solo van
al proveedor que esa organización eligió; si ese proveedor falla, la operación falla
con un error claro en español, pero los datos NUNCA se derivan a otro proveedor que
la org no autorizó.

`auto` (default cuando nadie eligió) es la única cadena multi-proveedor:
`anthropic → openai → google → groq → glm`, con Anthropic primero y GLM solo como
red final de último recurso.

**El anti-cuelgue no es la cadena: es el timeout.** Toda llamada LLM tiene timeout
propio (`LLM_CALL_TIMEOUT_MS`, default 90 s) y todo stream corta al primer token
(`LLM_STREAM_FIRST_TOKEN_TIMEOUT_MS`, default 45 s) y entre tokens
(`LLM_STREAM_IDLE_TIMEOUT_MS`, default 60 s), con `AbortSignal` real pasado al SDK
para cortar el HTTP y no seguir consumiendo. El corte de 300 s de Vercel nunca debe
volver a ser el mecanismo que termina una llamada.

Historia: la regla anterior ("ningún proveedor queda solo, anthropic siempre de
respaldo") se definió el mismo día como regla anti-cuelgue. El Foreman la revirtió
el 2026-10-22: la propiedad de los datos manda sobre la disponibilidad, y el
timeout ya cubre el cuelgue que motivaba la regla vieja.

### 3. Prompt caching

`packages/llm/anthropic-cache.ts` inyecta `cache_control: {type: 'ephemeral'}` en
el system block de cada POST `/v1/messages` (el SDK v4 del repo no soporta partes
de system con providerOptions). Apagable con `ANTHROPIC_PROMPT_CACHING=0`. Bodies
de más de 1 MB o con documentos PDF embebidos pasan intactos.

## Consecuencias

- Una org que explícitamente eligió GLM/OpenAI/Groq/Google queda a merced de ese
  proveedor (con timeout y error claro). Es deliberado: quien elige, elige.
- El medidor de consumo (`recordUsage`/`reportUsage`, precios en
  `packages/db/usage-pricing.ts`) sigue registrando todo lo que se cobre.
- Si Santiago algún día quiere eliminar GLM del stack productivo por completo,
  el cambio es acotado (quitarlo de `AUTO_PROVIDER_CHAIN` y del enum de
  preferencias) y debe hacerse en un solo commit para no romper el typecheck.
