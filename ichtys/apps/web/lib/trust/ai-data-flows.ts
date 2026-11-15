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

/**
 * Quién puede cambiar el proveedor de cada uso. Sale de mirar cada lugar que llama al modelo:
 * - `fixed`: datos de sujetos; no vale ninguna preferencia (`PATIENT_DATA_PURPOSES`).
 * - `organization`: sigue lo que la organización eligió en Ajustes (el asistente).
 * - `installation`: sigue solo la configuración de la instalación; lo que elija una
 *   organización en Ajustes no lo cambia (protocolos y títulos).
 */
export type ProviderChoice = 'fixed' | 'organization' | 'installation'

const DATA_SENT: Record<LlmPurpose, { use: string; data: string; choice: ProviderChoice }> = {
  'clinical-extract': {
    use: 'Leer una evolución clínica y proponer datos para el perfil',
    data: 'El texto de la evolución, después de reemplazar algunos formatos de documento (7 u 8 cifras seguidas), los correos y algunos formatos de teléfono. No se garantiza que se quite todo dato personal, y los nombres propios no se quitan',
    choice: 'fixed',
  },
  'lab-read': {
    use: 'Leer un informe de laboratorio',
    data: 'Si es texto: los renglones del informe, sin los del encabezado que se reconocen como datos personales por su rótulo. Si es imagen: la zona que la persona recorta, que puede incluir parte del encabezado o ser la hoja entera',
    choice: 'fixed',
  },
  'lab-read-control': {
    use: 'Segunda lectura de control de un informe en imagen',
    data: 'Las mismas imágenes que la primera lectura',
    choice: 'fixed',
  },
  answer: {
    use: 'Responder una pregunta en el asistente',
    data: 'La pregunta, los últimos mensajes de la conversación, fragmentos de los documentos del estudio y partes del protocolo extraído ya aprobado. Si quien escribe incluye datos de un paciente, esos datos van también',
    choice: 'organization',
  },
  title: {
    use: 'Ponerle título a una conversación',
    data: 'El primer mensaje de la conversación y el nombre del estudio. Si el mensaje incluye datos de un paciente, esos datos van también',
    choice: 'installation',
  },
  spec: {
    use: 'Extraer criterios y visitas de un protocolo',
    data: 'El texto del protocolo o de la guía',
    choice: 'installation',
  },
}

/** El orden en que se leen en la página: primero lo que lleva datos de sujetos. */
const ORDER: readonly LlmPurpose[] = ['clinical-extract', 'lab-read', 'lab-read-control', 'answer', 'spec', 'title']

export interface AiDataFlow {
  /** Clase de dato del código, o `search-vectors` para los vectores de búsqueda, que eligen proveedor por otro camino. */
  purpose: LlmPurpose | 'search-vectors'
  use: string
  data: string
  /** Proveedores a los que va cuando nadie eligió otro. */
  providers: string[]
  choice: ProviderChoice
  /** Datos de sujetos: el destino no cambia con ninguna preferencia. */
  fixed: boolean
}

/**
 * Los vectores de búsqueda no pasan por `PROVIDERS_BY_PURPOSE`: su proveedor lo decide la
 * configuración de la instalación (`packages/ingestion/embedding-config.ts`). Va OpenAI si la
 * instalación tiene su clave; si no, Google; si no, Groq.
 */
export const SEARCH_VECTOR_FLOW: AiDataFlow = {
  purpose: 'search-vectors',
  use: 'Buscar en los documentos del estudio',
  data: 'Los fragmentos de cada documento, al cargarlo, y cada pregunta que se escribe en el asistente. Si la pregunta incluye datos de un paciente, esos datos van también',
  providers: ['OpenAI'],
  choice: 'installation',
  fixed: false,
}

/** Los otros proveedores de vectores que una instalación puede configurar. */
export const SEARCH_VECTOR_ALTERNATIVES: readonly string[] = ['Google', 'Groq']

export function aiDataFlows(): AiDataFlow[] {
  const llm = ORDER.map((purpose): AiDataFlow => ({
    purpose,
    use: DATA_SENT[purpose].use,
    data: DATA_SENT[purpose].data,
    providers: PROVIDERS_BY_PURPOSE[purpose].map((id) => PROVIDER_NAMES[id]),
    choice: DATA_SENT[purpose].choice,
    fixed: PATIENT_DATA_PURPOSES.includes(purpose),
  }))
  return [...llm, SEARCH_VECTOR_FLOW]
}

/** Lo que la página dice según quién puede cambiar el destino. */
export function flowChoiceNote(flow: Pick<AiDataFlow, 'choice' | 'purpose'>): string {
  if (flow.purpose === 'search-vectors') {
    return `Por defecto. La instalación puede configurar ${SEARCH_VECTOR_ALTERNATIVES.join(' o ')} en su lugar; una organización no lo cambia desde Ajustes.`
  }
  switch (flow.choice) {
    case 'fixed':
      return 'Fijo: no lo cambia la organización ni la instalación.'
    case 'organization':
      return 'Por defecto. La organización puede elegir otro en Ajustes; en ese caso va solo al elegido.'
    case 'installation':
      return 'Por defecto. Lo define la configuración de la instalación; lo que una organización elija en Ajustes no lo cambia.'
  }
}

/** Los proveedores que una organización puede elegir en Ajustes para el asistente. */
export const SELECTABLE_PROVIDER_NAMES: readonly string[] = (['anthropic', 'openai', 'google', 'groq'] as const).map((id) => PROVIDER_NAMES[id])
