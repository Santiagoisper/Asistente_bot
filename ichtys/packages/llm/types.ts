export type LlmProviderId = 'anthropic' | 'openai' | 'google' | 'groq' | 'glm'

/**
 * `auto` = la lista de proveedores aprobada para esa clase de dato
 * (`PROVIDERS_BY_PURPOSE`). Hoy es un solo proveedor para todas.
 * Embeddings siguen en OpenAI independientemente.
 */
export type LlmProviderPreference = LlmProviderId | 'auto'

/**
 * `lab-read`: lectura de informes de laboratorio (texto o imagen). Pide un modelo que lea bien cifras.
 * `lab-read-control`: segunda lectura de la misma imagen, con otro modelo del mismo proveedor.
 */
export type LlmPurpose = 'answer' | 'spec' | 'title' | 'clinical-extract' | 'lab-read' | 'lab-read-control'

/**
 * Proveedores a los que va un pedido cuando nadie eligió uno.
 *
 * Fue una cadena de respaldo (Anthropic → OpenAI → Google → Groq): si uno
 * fallaba, el mismo contenido salía al siguiente. Eso mandaba consultas,
 * historial e informes de laboratorio a proveedores que la página de confianza
 * no declara para esos datos. Decisión de Santiago del 2026-11-12: se
 * restringe. Si el proveedor no responde, la función falla con un diagnóstico
 * claro; el dato no sale a otro lado.
 *
 * 'glm' sigue en LlmProviderId solo para reconocer preferencias legadas
 * guardadas (se migran a 'anthropic' al leer).
 */
export const AUTO_PROVIDER_CHAIN: readonly LlmProviderId[] = ['anthropic']

/**
 * A qué proveedores puede ir cada clase de dato. Es la única tabla que decide
 * el destino cuando rige `auto`, y la única que hay que tocar el día que otro
 * proveedor se evalúe y se apruebe para una clase (cambio controlado: R6 y R9
 * de docs/compliance/REGULATORY-BASELINE.md; actualizar también la página de
 * confianza y el registro de proveedores).
 */
export const PROVIDERS_BY_PURPOSE: Record<LlmPurpose, readonly LlmProviderId[]> = {
  // Texto de evoluciones clínicas (redactado antes de salir).
  'clinical-extract': ['anthropic'],
  // Informes de laboratorio: renglones de texto o imágenes recortadas.
  'lab-read': ['anthropic'],
  'lab-read-control': ['anthropic'],
  // Consulta de la persona, historial de la conversación y fragmentos de documentos.
  answer: ['anthropic'],
  // Primer mensaje de una conversación.
  title: ['anthropic'],
  // Texto de protocolos y guías.
  spec: ['anthropic'],
}

/**
 * Clases de dato con información de sujetos. Para estas no vale la preferencia
 * de la organización ni la de la instalación: van siempre a la lista de arriba.
 */
export const PATIENT_DATA_PURPOSES: readonly LlmPurpose[] = ['clinical-extract', 'lab-read', 'lab-read-control']
