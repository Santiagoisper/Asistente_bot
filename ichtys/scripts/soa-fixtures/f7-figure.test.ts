/**
 * F7 corregido (G22 §3 C3). El gold guarda la geometría de la figura.
 * F8 no se regenera: su hash sigue siendo el de main.
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const FIXTURES = resolve(dirname(fileURLToPath(import.meta.url)), '../../fixtures/soa')

interface FigureCard {
  text: string
  x: number
  width: number
  fontSize: number
}

interface F7Gold {
  document: { sopPages: number[]; figurePages: number[] }
  figure: {
    page: number
    cards: number
    gap: number
    edgeGap: number
    fontSize: number
    separation: string
    marks: number
    timeline: FigureCard[]
  }
}

describe('F7 figura', () => {
  const gold = JSON.parse(readFileSync(resolve(FIXTURES, 'F7.gold.json'), 'utf8')) as F7Gold

  it('17 fichas, 5 pt, 18,4 pt entre orígenes y 13,4 pt de hueco, fuera de la grilla', () => {
    expect(gold.document.sopPages).toEqual([3, 4, 5, 6])
    expect(gold.document.figurePages).toEqual([2])
    expect(gold.figure.page).toBe(2)
    expect(gold.figure.cards).toBe(17)
    expect(gold.figure.fontSize).toBe(5)
    expect(gold.figure.gap).toBe(18.4)
    expect(gold.figure.edgeGap).toBe(13.4)
    expect(gold.figure.separation).toBe('origin')
    expect(gold.figure.marks).toBe(0)
    expect(gold.figure.timeline).toHaveLength(17)
    for (let index = 1; index < gold.figure.timeline.length; index++) {
      const previous = gold.figure.timeline[index - 1]!
      const card = gold.figure.timeline[index]!
      expect(card.x - previous.x).toBeCloseTo(18.4, 2)
      expect(card.x - (previous.x + previous.width)).toBeCloseTo(13.4, 2)
      expect(card.fontSize).toBe(5)
    }
  })
})
