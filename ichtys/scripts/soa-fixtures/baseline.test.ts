import { describe, expect, it } from 'vitest'
import { extractorTreeMatches } from './baseline'

describe('SHA del extractor', () => {
  it('un árbol inventado no coincide', () => {
    expect(extractorTreeMatches('0000000000000000000000000000000000000000')).toBe(false)
  })
})
