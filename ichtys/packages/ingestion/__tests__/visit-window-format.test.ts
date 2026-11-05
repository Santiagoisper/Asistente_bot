import { describe, expect, it } from 'vitest'
import { formatVisitWindow } from '../visit-window-format'

describe('formatVisitWindow', () => {
  it('T7: una ventana asimétrica se imprime −2/+3 d', () => {
    expect(formatVisitWindow({ windowDays: 3, windowBefore: 2, windowAfter: 3 })).toBe('\u22122/+3 d')
  })

  it('T8: una spec legada windowDays 3 se imprime ±3 d', () => {
    expect(formatVisitWindow({ windowDays: 3, windowBefore: null, windowAfter: null })).toBe('±3 d')
    expect(formatVisitWindow({ windowDays: 3 })).toBe('±3 d')
  })

  it('sin ventana imprime la raya', () => {
    expect(formatVisitWindow({ windowDays: null, windowBefore: null, windowAfter: null })).toBe('—')
  })
})
