import { describe, expect, it } from 'vitest'
import { cropPixels, FULL_RECT, isUsableRect, outputSize, rectFromDrag, withEdge } from '../crop-geometry'

describe('recorte de una foto o un escaneo', () => {
  it('arma el rectángulo arrastrando en cualquier dirección y no sale de la imagen', () => {
    expect(rectFromDrag({ x: 0.8, y: 0.9 }, { x: 0.1, y: 0.3 })).toEqual({ left: 0.1, top: 0.3, right: 0.8, bottom: 0.9 })
    expect(rectFromDrag({ x: -0.2, y: 0.5 }, { x: 1.4, y: 2 })).toEqual({ left: 0, top: 0.5, right: 1, bottom: 1 })
    expect(rectFromDrag({ x: Number.NaN, y: 0 }, { x: 0.5, y: 0.5 })).toEqual({ left: 0, top: 0, right: 0.5, bottom: 0.5 })
  })

  it('un toque sin arrastre no es un recorte', () => {
    expect(isUsableRect(rectFromDrag({ x: 0.5, y: 0.5 }, { x: 0.51, y: 0.9 }))).toBe(false)
    expect(isUsableRect(rectFromDrag({ x: 0.1, y: 0.3 }, { x: 0.9, y: 0.95 }))).toBe(true)
    expect(isUsableRect(FULL_RECT)).toBe(true)
  })

  it('los bordes de arriba y de abajo no se cruzan', () => {
    const rect = { left: 0, top: 0.2, right: 1, bottom: 0.6 }
    expect(withEdge(rect, 'top', 0.9).top).toBeCloseTo(0.55)
    expect(withEdge(rect, 'bottom', 0.1).bottom).toBeCloseTo(0.25)
    expect(withEdge(rect, 'top', 0.3)).toEqual({ ...rect, top: 0.3 })
  })

  it('convierte el recorte a píxeles enteros dentro de la imagen', () => {
    expect(cropPixels({ left: 0.1, top: 0.25, right: 0.9, bottom: 0.75 }, 1000, 2000)).toEqual({ sx: 100, sy: 500, sw: 800, sh: 1000 })
    expect(cropPixels(FULL_RECT, 333, 777)).toEqual({ sx: 0, sy: 0, sw: 333, sh: 777 })
    const edge = cropPixels({ left: 0.999, top: 0.999, right: 1, bottom: 1 }, 10, 10)
    expect(edge.sx + edge.sw).toBeLessThanOrEqual(10)
    expect(edge.sw).toBeGreaterThanOrEqual(1)
  })

  it('achica la salida si es muy grande y nunca la agranda', () => {
    expect(outputSize(4000, 3000)).toEqual({ width: 2000, height: 1500 })
    expect(outputSize(800, 600)).toEqual({ width: 800, height: 600 })
    expect(outputSize(1000, 5000, 2000)).toEqual({ width: 400, height: 2000 })
  })
})
