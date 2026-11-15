import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PATIENT_DATA_PURPOSES, PROVIDERS_BY_PURPOSE, type LlmPurpose } from '@ichtys/llm'
import { PROVIDER_OPTIONS } from '../../../components/settings/provider-options'
import { aiDataFlows, flowChoiceNote, PROVIDER_NAMES, SEARCH_VECTOR_ALTERNATIVES, SEARCH_VECTOR_FLOW, SELECTABLE_PROVIDER_NAMES } from '../ai-data-flows'

/**
 * La página de confianza es pública y dice a qué proveedor va cada dato. Estas pruebas hacen
 * que no pueda decir otra cosa que lo que hace el código.
 */
const PURPOSES = Object.keys(PROVIDERS_BY_PURPOSE) as LlmPurpose[]
const source = (path: string) => readFileSync(join(__dirname, '../../../../..', path), 'utf8')
/** Las filas que salen de la tabla del código (todas menos la de vectores de búsqueda). */
const llmFlows = () => aiDataFlows().filter((flow): flow is typeof flow & { purpose: LlmPurpose } => flow.purpose !== 'search-vectors')

describe('aiDataFlows — la página sale de la tabla que decide el destino', () => {
  it('hay una fila por cada clase de dato del código, ni una más ni una menos', () => {
    expect(llmFlows().map((flow) => flow.purpose).sort()).toEqual([...PURPOSES].sort())
    // Más la de vectores de búsqueda, que elige proveedor por otro camino.
    expect(aiDataFlows()).toHaveLength(PURPOSES.length + 1)
  })

  it('cada fila nombra exactamente los proveedores que el código usa para esa clase', () => {
    for (const flow of llmFlows()) {
      expect(flow.providers).toEqual(PROVIDERS_BY_PURPOSE[flow.purpose].map((id) => PROVIDER_NAMES[id]))
      expect(flow.providers.length).toBeGreaterThan(0)
    }
  })

  it('las clases con datos de sujetos figuran como fijas, y solo esas', () => {
    for (const flow of llmFlows()) {
      expect(flow.fixed).toBe(PATIENT_DATA_PURPOSES.includes(flow.purpose))
      // La nota que se lee sale de `choice`: fija si y solo si el código la trata como fija.
      expect(flow.choice === 'fixed').toBe(flow.fixed)
    }
    expect(SEARCH_VECTOR_FLOW.fixed).toBe(false)
  })

  it('lo que lleva datos de sujetos va primero', () => {
    const flows = aiDataFlows()
    const lastFixed = flows.map((flow) => flow.fixed).lastIndexOf(true)
    const firstFree = flows.findIndex((flow) => !flow.fixed)
    expect(lastFixed).toBeLessThan(firstFree)
  })

  it('una fila fija no dice que se puede elegir otro proveedor', () => {
    const note = flowChoiceNote({ purpose: 'clinical-extract', choice: 'fixed' })
    expect(note).toContain('Fijo')
    expect(note).not.toContain('elegir')
  })
})

describe('quién puede cambiar el proveedor de cada uso: lo que dice la página contra cada lugar que llama', () => {
  const choiceOf = (purpose: LlmPurpose) => aiDataFlows().find((flow) => flow.purpose === purpose)!.choice

  it('el asistente sigue lo que la organización eligió en Ajustes', () => {
    expect(choiceOf('answer')).toBe('organization')
    expect(source('apps/web/app/api/chat/stream/route.ts')).toContain('llmProviderPreference: orgRagConfig?.llmProvider')
    expect(flowChoiceNote({ purpose: 'answer', choice: 'organization' })).toContain('La organización puede elegir otro en Ajustes')
  })

  it('los títulos no reciben la preferencia de la organización', () => {
    expect(choiceOf('title')).toBe('installation')
    const persistence = source('apps/web/lib/chat/persistence.ts')
    const call = persistence.slice(persistence.indexOf("purpose: 'title'") - 40, persistence.indexOf("purpose: 'title'") + 80)
    expect(call).not.toContain('providerPreference')
  })

  it('la extracción de protocolos sigue la configuración de la instalación', () => {
    expect(choiceOf('spec')).toBe('installation')
    expect(source('packages/ingestion/pipeline.ts')).toContain('llmProviderPreference: getSpecExtractionProvider()')
    expect(source('packages/ingestion/reextract-spec.ts')).toContain('llmProviderPreference: getSpecExtractionProvider()')
  })

  it('una fila que depende de la instalación no le promete la elección a la organización', () => {
    const note = flowChoiceNote({ purpose: 'spec', choice: 'installation' })
    expect(note).toContain('no lo cambia')
    expect(note).not.toContain('puede elegir otro')
  })
})

describe('lo que se envía: las frases que el código tiene que sostener', () => {
  const dataOf = (purpose: string) => aiDataFlows().find((flow) => flow.purpose === purpose)!.data

  it('el título manda también el nombre del estudio', () => {
    expect(source('apps/web/lib/chat/persistence.ts')).toContain('`Study: ${params.studyName}\\nQuestion: ${params.question}`')
    expect(dataOf('title')).toContain('el nombre del estudio')
  })

  it('la evolución: no promete quitar todo dato personal y dice que los nombres quedan', () => {
    expect(dataOf('clinical-extract')).toContain('No se garantiza que se quite todo dato personal')
    expect(dataOf('clinical-extract')).toContain('los nombres propios no se quitan')
    // Lo que el código reemplaza hoy: 7 u 8 cifras seguidas, correos y un formato de teléfono.
    const redact = source('packages/clinical/phi-redact.ts')
    expect(redact.match(/result = result\.replace\(/g)).toHaveLength(3)
  })

  it('el laboratorio en imagen: dice que puede ir la hoja entera', () => {
    expect(source('apps/web/components/labs/photo-upload.tsx')).toContain('sheet.whole ? FULL_RECT : sheet.rect')
    expect(dataOf('lab-read')).toContain('la hoja entera')
  })

  it('lo que escribe la persona puede llevar datos de un paciente, y la página lo dice', () => {
    for (const purpose of ['answer', 'title', 'search-vectors']) expect(dataOf(purpose)).toContain('datos de un paciente')
  })
})

describe('los vectores de búsqueda eligen proveedor por otro camino', () => {
  const config = source('packages/ingestion/embedding-config.ts')

  it('van a OpenAI por defecto, y la instalación puede configurar Google o Groq', () => {
    expect(config).toContain("export type EmbeddingProvider = 'groq' | 'openai' | 'google'")
    // Sin ninguna clave configurada, el selector devuelve OpenAI.
    expect(config).toMatch(/if \(process\.env\.GROQ_API_KEY\?\.trim\(\)\) return 'groq'\n  return 'openai'/)
    expect(SEARCH_VECTOR_FLOW.providers).toEqual(['OpenAI'])
    expect([...SEARCH_VECTOR_ALTERNATIVES].sort()).toEqual(['Google', 'Groq'])
  })

  it('la fila dice que una organización no lo cambia desde Ajustes', () => {
    expect(flowChoiceNote(SEARCH_VECTOR_FLOW)).toContain('una organización no lo cambia desde Ajustes')
  })
})

describe('cambio controlado: sumar un proveedor obliga a mirar la página', () => {
  it('hoy todo lo que va a un modelo de lenguaje va, por defecto, a un solo proveedor', () => {
    // Si esto falla es porque cambió PROVIDERS_BY_PURPOSE. Antes de tocar esta prueba: revisar
    // la página de confianza entera, el registro de proveedores y el inventario de IA (R6, R9).
    const providers = [...new Set(llmFlows().flatMap((flow) => flow.providers))]
    expect(providers).toEqual(['Anthropic'])
  })
})

describe('cambio controlado: qué clases tienen el destino fijo', () => {
  it('hoy son fijas las tres que llevan datos de sujetos', () => {
    // Si esto falla es porque cambió PATIENT_DATA_PURPOSES: la página pasaría a decir otra cosa
    // sobre qué puede elegir una organización. Revisar la página antes de tocar esta prueba.
    expect(aiDataFlows().filter((flow) => flow.fixed).map((flow) => flow.purpose)).toEqual(['clinical-extract', 'lab-read', 'lab-read-control'])
  })
})

describe('los proveedores que se pueden elegir son los que ofrece la pantalla de ajustes', () => {
  it('la lista de la página coincide con las opciones de ajustes', () => {
    const offered = PROVIDER_OPTIONS.map((option) => option.value).filter((value) => value !== 'auto')
    expect(SELECTABLE_PROVIDER_NAMES).toEqual(offered.map((id) => PROVIDER_NAMES[id]))
  })
})

describe('la página no escribe a mano a quién va cada dato', () => {
  const page = readFileSync(join(__dirname, '../../../app/trust/page.tsx'), 'utf8')

  it('arma la tabla con aiDataFlows', () => {
    expect(page).toContain('aiDataFlows()')
  })

  it('no conserva las frases que el código dejó de sostener', () => {
    for (const stale of ['sin evoluciones clínicas', 'Inferencia LLM (extracción clínica, chat)', 'zero-retention', 'Embeddings RAG']) {
      expect(page).not.toContain(stale)
    }
  })

  it('no dice «cumple», y cada vez que nombra una certificación es para decir que no la tiene', () => {
    expect(page).not.toMatch(/\bcumple\b/i)
    const lines = page.split('\n').filter((line) => /certificad|certificación/i.test(line))
    for (const line of lines) expect(line).toMatch(/\bno\b|≠/i)
  })


})
