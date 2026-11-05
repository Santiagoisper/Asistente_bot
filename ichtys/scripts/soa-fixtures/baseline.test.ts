import { describe, expect, it } from 'vitest'
import { EXTRACTOR_SHA, EXTRACTOR_TREE, extractorTreeMatches } from './baseline'

describe('SHA del extractor', () => {
  it('el árbol de ingestion coincide con 090e506 y un árbol inventado no', () => {
    expect(EXTRACTOR_SHA).toBe('090e506c90775e9c6dba0478477405a0106192c1')
    expect(EXTRACTOR_TREE).toBe('60521881832d2545f214b46477819651d849c8c9')
    expect(extractorTreeMatches()).toBe(true)
    expect(extractorTreeMatches('0000000000000000000000000000000000000000')).toBe(false)
  })
})
