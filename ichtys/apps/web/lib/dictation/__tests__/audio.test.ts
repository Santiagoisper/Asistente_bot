import { describe, expect, it } from 'vitest'
import { mixToMono, resampleLinear } from '../audio'

describe('audio del dictado', () => {
  it('mezcla dos canales promediándolos y deja uno solo como está', () => {
    const left = new Float32Array([1, 0, -1])
    const right = new Float32Array([0, 0, 1])
    expect(Array.from(mixToMono([left, right]))).toEqual([0.5, 0, 0])
    expect(mixToMono([left])).toBe(left)
    expect(mixToMono([]).length).toBe(0)
  })

  it('remuestrea a 16 kHz conservando la duración', () => {
    const second = new Float32Array(48_000).fill(0.25)
    const out = resampleLinear(second, 48_000, 16_000)
    expect(out.length).toBe(16_000)
    expect(out[8_000]).toBeCloseTo(0.25, 5)
  })

  it('a la misma frecuencia no copia nada', () => {
    const samples = new Float32Array([0.1, 0.2])
    expect(resampleLinear(samples, 16_000, 16_000)).toBe(samples)
  })
})
