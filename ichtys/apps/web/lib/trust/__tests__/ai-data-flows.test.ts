import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PATIENT_DATA_PURPOSES, PROVIDERS_BY_PURPOSE, type LlmPurpose } from '@ichtys/llm'
import { PROVIDER_OPTIONS } from '../../../components/settings/provider-options'
import { aiDataFlows, flowChoiceNote, PROVIDER_NAMES, SELECTABLE_PROVIDER_NAMES } from '../ai-data-flows'

/**
 * La página de confianza es pública y dice a qué proveedor va cada dato. Estas pruebas hacen
 * que no pueda decir otra cosa que lo que hace el código.
 */
const PURPOSES = Object.keys(PROVIDERS_BY_PURPOSE) as LlmPurpose[]

describe('aiDataFlows — la página sale de la tabla que decide el destino', () => {
  it('hay una fila por cada clase de dato del código, ni una más ni una menos', () => {
    expect(aiDataFlows().map((flow) => flow.purpose).sort()).toEqual([...PURPOSES].sort())
  })

  it('cada fila nombra exactamente los proveedores que el código usa para esa clase', () => {
    for (const flow of aiDataFlows()) {
      expect(flow.providers).toEqual(PROVIDERS_BY_PURPOSE[flow.purpose].map((id) => PROVIDER_NAMES[id]))
      expect(flow.providers.length).toBeGreaterThan(0)
    }
  })

  it('las clases con datos de sujetos figuran como fijas, y solo esas', () => {
    for (const flow of aiDataFlows()) expect(flow.fixed).toBe(PATIENT_DATA_PURPOSES.includes(flow.purpose))
  })

  it('lo que lleva datos de sujetos va primero', () => {
    const flows = aiDataFlows()
    const lastFixed = flows.map((flow) => flow.fixed).lastIndexOf(true)
    const firstFree = flows.findIndex((flow) => !flow.fixed)
    expect(lastFixed).toBeLessThan(firstFree)
  })

  it('una fila fija no dice que se puede elegir otro proveedor, y una libre sí', () => {
    expect(flowChoiceNote({ fixed: true })).toContain('Fijo')
    expect(flowChoiceNote({ fixed: true })).not.toContain('elegir')
    expect(flowChoiceNote({ fixed: false })).toContain('pueden elegir otro')
  })
})

describe('cambio controlado: sumar un proveedor obliga a mirar la página', () => {
  it('hoy todos los datos van, por defecto, a un solo proveedor', () => {
    // Si esto falla es porque cambió PROVIDERS_BY_PURPOSE. Antes de tocar esta prueba: revisar
    // la página de confianza entera, el registro de proveedores y el inventario de IA (R6, R9).
    const providers = [...new Set(aiDataFlows().flatMap((flow) => flow.providers))]
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

  it('dice que los nombres propios no se quitan antes de enviar una evolución', () => {
    expect(aiDataFlows().find((flow) => flow.purpose === 'clinical-extract')!.data).toContain('Los nombres propios no se quitan')
  })
})
