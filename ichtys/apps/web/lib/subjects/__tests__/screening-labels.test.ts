import { describe, expect, it } from 'vitest'
import { criterionStatusLabel } from '../screening-labels'

/**
 * El estado de cada criterio, como lo lee el médico. El motor usa pass, fail y unknown; en una
 * exclusión, «pass» quiere decir que el criterio no excluye al sujeto, no que «pasa».
 */
describe('criterionStatusLabel', () => {
  it.each([
    ['inclusion', 'pass', 'cumple'],
    ['inclusion', 'fail', 'no cumple'],
    ['inclusion', 'unknown', 'a revisar'],
    ['exclusion', 'pass', 'no excluye'],
    ['exclusion', 'fail', 'excluye'],
    ['exclusion', 'unknown', 'a revisar'],
  ] as const)('%s + %s → «%s»', (kind, status, label) => {
    expect(criterionStatusLabel(kind, status)).toBe(label)
  })

  it('ningún rótulo queda en inglés', () => {
    for (const kind of ['inclusion', 'exclusion'] as const) {
      for (const status of ['pass', 'fail', 'unknown'] as const) {
        expect(criterionStatusLabel(kind, status)).not.toMatch(/pass|fail|unknown/i)
      }
    }
  })
})
