/**
 * Con qué proveedor y modelo se generó una respuesta del asistente (regla R6).
 *
 * El motor informa cada llamada que hizo. La que escribe la respuesta es la de tipo `chat_answer`;
 * las de evaluación (`chat_eval`) no la escriben. Si no hubo ninguna (sin evidencia no se llama a
 * ningún modelo), no hay nada que anotar: `null`.
 *
 * Se anota el modelo que el proveedor dijo que respondió, que es lo que vale como evidencia; si el
 * proveedor no lo informó, el que se pidió.
 */
export function answerModel(
  usageEvents: ReadonlyArray<{ kind: string; provider: string; model: string; responseModel?: string | null }> | undefined,
): { provider: string; model: string } | null {
  const event = (usageEvents ?? []).filter((entry) => entry.kind === 'chat_answer').at(-1)
  return event ? { provider: event.provider, model: event.responseModel || event.model } : null
}
