import { PATIENT_DATA_PURPOSES, PROVIDERS_BY_PURPOSE, type LlmProviderId, type LlmPurpose } from '@ichtys/llm'

/**
 * Qué proveedor de IA recibe qué dato, para la página de confianza.
 *
 * La página pública no escribe a mano a quién va cada dato: lo arma con la misma tabla que
 * decide el destino en el código (`PROVIDERS_BY_PURPOSE`). Si un día se aprueba otro proveedor
 * para una clase de dato, la página cambia sola y una prueba obliga a mirar lo que dice.
 * Lo único escrito a mano acá es el nombre de cada clase de dato en palabras de quien lee.
 */

export const PROVIDER_NAMES: Record<LlmProviderId, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  google: 'Google',
  groq: 'Groq',
  glm: 'Zhipu (GLM)',
}

/** Qué sale del sistema en cada uso. Una entrada por clase: si se agrega una, esto deja de compilar. */
const DATA_SENT: Record<LlmPurpose, { use: string; data: string }> = {
  'clinical-extract': {
    use: 'Leer una evolución clínica y proponer datos para el perfil',
    data: 'El texto de la evolución, después de reemplazar números de documento, correos y teléfonos. Los nombres propios no se quitan',
  },
  'lab-read': {
    use: 'Leer un informe de laboratorio',
    data: 'Los renglones del informe sin el encabezado con datos personales, o imágenes recortadas del informe',
  },
  'lab-read-control': {
    use: 'Segunda lectura de control de un informe en imagen',
    data: 'Las mismas imágenes recortadas del informe',
  },
  answer: {
    use: 'Responder una pregunta en el asistente',
    data: 'La pregunta, los últimos mensajes de la conversación, fragmentos de los documentos del estudio y partes del protocolo extraído ya aprobado',
  },
  title: {
    use: 'Ponerle título a una conversación',
    data: 'El primer mensaje de la conversación',
  },
  spec: {
    use: 'Extraer criterios y visitas de un protocolo',
    data: 'El texto del protocolo o de la guía',
  },
}

/** El orden en que se leen en la página: primero lo que lleva datos de sujetos. */
const ORDER: readonly LlmPurpose[] = ['clinical-extract', 'lab-read', 'lab-read-control', 'answer', 'spec', 'title']

export interface AiDataFlow {
  purpose: LlmPurpose
  use: string
  data: string
  /** Proveedores a los que va cuando nadie eligió otro. */
  providers: string[]
  /** Datos de sujetos: el destino no cambia con ninguna preferencia. */
  fixed: boolean
}

export function aiDataFlows(): AiDataFlow[] {
  return ORDER.map((purpose) => ({
    purpose,
    use: DATA_SENT[purpose].use,
    data: DATA_SENT[purpose].data,
    providers: PROVIDERS_BY_PURPOSE[purpose].map((id) => PROVIDER_NAMES[id]),
    fixed: PATIENT_DATA_PURPOSES.includes(purpose),
  }))
}

/** Lo que la página dice según si el destino se puede cambiar. */
export function flowChoiceNote(flow: Pick<AiDataFlow, 'fixed'>): string {
  return flow.fixed
    ? 'Fijo: no lo cambia la organización ni la instalación.'
    : 'Por defecto. La organización o la instalación pueden elegir otro; en ese caso va solo al elegido.'
}

/** Los proveedores que una organización o instalación puede elegir en lugar del que va por defecto. */
export const SELECTABLE_PROVIDER_NAMES: readonly string[] = (['anthropic', 'openai', 'google', 'groq'] as const).map((id) => PROVIDER_NAMES[id])
