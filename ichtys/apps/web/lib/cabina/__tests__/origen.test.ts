import { describe, expect, it } from 'vitest'
import { quoteParts, unresolvedKeys } from '../origen'

describe('dudas de la hoja', () => {
  it('una certeza baja o una duda marcada bloquean hasta que se revisan', () => {
    const items = [
      { procedureKey: 'ecg', certainty: 'high' as const },
      { procedureKey: 'coagulation', certainty: 'low' as const },
      { procedureKey: 'ketones', certainty: 'high' as const },
    ]
    expect(unresolvedKeys(items, new Set(), new Set())).toEqual(['coagulation'])
    expect(unresolvedKeys(items, new Set(['coagulation']), new Set())).toEqual([])
    expect(unresolvedKeys(items, new Set(), new Set(['ketones']))).toEqual(['coagulation', 'ketones'])
    expect(unresolvedKeys(items, new Set(['coagulation', 'ketones']), new Set(['ketones']))).toEqual([])
  })
})

describe('cita textual', () => {
  it('marca la frase del protocolo dentro de la cita', () => {
    const parts = quoteParts(
      'El ECG se realizará antes de la extracción de sangre, con el participante en decúbito.',
      ['antes de la extracción de sangre'],
    )
    expect(parts.filter((part) => part.hit).map((part) => part.text)).toEqual(['antes de la extracción de sangre'])
    expect(parts.map((part) => part.text).join('')).toBe('El ECG se realizará antes de la extracción de sangre, con el participante en decúbito.')
  })
})
