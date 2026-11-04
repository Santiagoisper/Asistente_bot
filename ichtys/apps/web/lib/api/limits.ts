/**
 * limits.ts — topes de entrada para cuerpos y parámetros externos.
 *
 * Vuelta 2 del delta zod (ADR-8; hallazgo H7 del Reviewer + requisito del
 * Sicario): zod 4.6.7 cierra el OOM de colecciones enormes
 * (GHSA-mrhx-c7xc-m3w5), pero un array SIN .max sigue acumulando un issue
 * por elemento inválido — el DoS sigue vivo. Toda entrada externa de esta
 * app queda acotada en tres capas: bytes del cuerpo (413, ver
 * lib/api/body-limit.ts), cantidad de elementos (.max en los esquemas) y
 * longitud de strings (.max en los campos).
 *
 * Los topes del study spec viven en packages/ingestion/study-spec.ts:
 * un package no puede importar de apps/web (dirección de dependencia).
 */

/** Tope de bytes del cuerpo JSON ANTES de parsearlo (rechazo 413). */
export const MAX_JSON_BODY_BYTES = 256 * 1024

/**
 * Tope de bytes del PATCH de spec: el spec completo editado puede pesar más
 * que un cuerpo típico (hasta 2000 criterios de texto largo, ver
 * MAX_SPEC_ITEMS en @ichtys/ingestion).
 */
export const MAX_SPEC_BODY_BYTES = 2 * 1024 * 1024

/** Pregunta del chat (chars). Las preguntas reales rondan los 2000. */
export const MAX_QUESTION_CHARS = 8_000

/** Labs confirmados por request (OCR de una página de laboratorio). */
export const MAX_LAB_ITEMS = 500

/** Nombre de un lab (p. ej. "Hemoglobina glicada (HbA1c)"). */
export const MAX_LAB_NAME_CHARS = 200

/** Unidad de un lab (p. ej. "mg/dL", "%"). */
export const MAX_LAB_UNIT_CHARS = 50

/** API keys de proveedor LLM cargadas por la org (sk-… ≈ 100-200 chars). */
export const MAX_API_KEY_CHARS = 512

/** Identificadores (uuid) recibidos en body o query — un uuid son 36 chars. */
export const MAX_ID_CHARS = 64

/** Issues de Zod incluidos en una respuesta de error (H7 vuelta 3: la
 *  respuesta del PATCH de spec llegó a 18 MB devolviendo todos). */
export const MAX_ISSUES_IN_RESPONSE = 10
