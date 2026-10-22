# ADR-01: Mapa de modelos Anthropic por uso (ALPHI full Anthropic)

**Status:** Proposed
**Date:** 2026-10-22
**Deciders:** Foreman, builder, sicario

## Contexto
Operación "Alphi full Anthropic": todo el runtime de producto pasa a la API paga de
Anthropic (`ANTHROPIC_API_KEY`). Hoy el código usa el ID viejo `claude-sonnet-4-6`.
IDs vigentes confirmados con la skill `claude-api` (no inventados): `claude-opus-5-5`,
`claude-sonnet-5-5`, `claude-haiku-5-5`. Builder ya propuso en el chat del equipo:
chat=sonnet-5-5, título/eval=haiku-5-5, clínico=sonnet-5-5, spec/SoA a coordinar con
sicario (sicario aún no publicó su propuesta en el chat/tablero).

## Decisión (recomendación del architect)
| Uso | Modelo | Effort | Por qué |
|---|---|---|---|
| Chat Alphi (streaming, latencia visible al usuario) | `claude-sonnet-5-5` | `low`/`medium` explícito | Coincide con builder. Bajar effort explícito: el default de sonnet-5-5 es `high`, innecesario para respuestas conversacionales y agrega latencia que la UI ya sufrió (timeout de 300s). |
| Título / eval interno | `claude-haiku-5-5` | `medium` (default) | Tarea barata y de bajo riesgo, coincide con builder. |
| Clínico (contenido sensible, texto visible al profesional) | `claude-sonnet-5-5` | `high` | Coincido con builder como piso. Si en etapa de pruebas la precisión no alcanza, escalar puntualmente a `claude-opus-5-5` para ese uso puntual — no de entrada, por costo. |
| Spec / SoA (extracción desde PDF nativo) | A confirmar con sicario | `high` | Extracción de tablas de cronograma es sensible a errores (Santiago ya dijo "desprolijo, teme que se haya leído mal"). Recomiendo `claude-sonnet-5-5` con `output_config.format` (structured outputs) en vez de forzar `tool_choice`, que ya no existe en 5.5. Si la precisión de tabla falla en pruebas reales, escalar a `claude-opus-5-5` sólo para esta ruta. |

## Riesgos de migración desde `claude-sonnet-4-6`
1. **Forced tool_choice eliminado** en sonnet-5-5/opus-5.5 (`tool_choice: any|tool` → 400).
   Si `packages/llm` o el extractor de spec fuerzan tool choice para obtener JSON,
   hay que migrar a `auto` + `strict: true` o a `output_config.format`. Builder y sicario
   deben confirmar si su código actual fuerza tool choice.
2. **Prefill de assistant eliminado** en sonnet-5-5 (400). Si algún prompt usa prefill
   para forzar formato de salida, migrar a structured outputs.
3. **Thinking adaptativo por defecto** (ya no `budget_tokens`); si queda código viejo
   seteando `budget_tokens` en sonnet-5-5 falla con 400.
4. **Timeout real de stream**: la deuda ya documentada por builder (`streamText` sin
   `abortSignal`/timeout) es crítica para que la UI de chat (mi responsabilidad visual)
   no vuelva a colgar 300s. Pido que el timeout propio sea menor al límite de Vercel y
   que el estado de error se refleje claro en pantalla (no un spinner infinito).
5. **Barra de subida al 97%→"finalizado" mentiroso**: no es un tema de modelo, pero
   afecta directamente a mi prioridad 2 (pantalla de subida). Necesito que builder
   expone el estado real de etapas (parse/embed/ready) vía polling para que la UI no
   mienta — ya lo tiene diseñado según el chat.
6. **Gap de información**: sicario todavía no publicó su propuesta de modelo para
   spec/SoA en el chat ni en TABLERO.md. Este ADR queda con esa celda abierta hasta que
   sicario confirme.

## Consecuencias
- Un solo proveedor (Anthropic) simplifica caché de prompts (el caché es por modelo).
- Chat más barato/rápido con sonnet-5-5 a effort bajo; clínico y spec más caros por
  effort alto, aceptable dado "tokens pagos donde se deba" (instrucción de Santiago).
- UI de chat y de subida deben reflejar estados reales (streaming real, etapas reales),
  no aproximaciones — ya lo tomo en mi Etapa 2.

## Action items
1. [ ] Builder/sicario confirman si su código fuerza `tool_choice` o usa prefill → migrar.
2. [ ] Sicario confirma modelo/effort para spec/SoA → cierro la celda abierta.
3. [ ] Builder confirma timeout de stream + estados reales de subida (bloqueante para mi Etapa 2 UI).
