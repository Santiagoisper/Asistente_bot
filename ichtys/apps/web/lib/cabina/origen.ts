export interface CertaintyRow {
  procedureKey: string
  certainty: 'high' | 'low' | null
}

export function unresolvedKeys(items: CertaintyRow[], reviewed: ReadonlySet<string>, doubted: ReadonlySet<string>): string[] {
  return items
    .filter((item) => (item.certainty === 'low' || doubted.has(item.procedureKey)) && !reviewed.has(item.procedureKey))
    .map((item) => item.procedureKey)
}

export function quoteParts(quote: string, highlights: string[]): Array<{ text: string; hit: boolean }> {
  const needles = highlights
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .sort((left, right) => right.length - left.length)
  if (needles.length === 0 || quote.length === 0) return [{ text: quote, hit: false }]
  const ranges: Array<{ start: number; end: number }> = []
  for (const needle of needles) {
    let from = 0
    while (from < quote.length) {
      const index = quote.indexOf(needle, from)
      if (index < 0) break
      const end = index + needle.length
      if (!ranges.some((range) => index < range.end && end > range.start)) ranges.push({ start: index, end })
      from = end
    }
  }
  ranges.sort((left, right) => left.start - right.start)
  if (ranges.length === 0) return [{ text: quote, hit: false }]
  const parts: Array<{ text: string; hit: boolean }> = []
  let cursor = 0
  for (const range of ranges) {
    if (range.start > cursor) parts.push({ text: quote.slice(cursor, range.start), hit: false })
    parts.push({ text: quote.slice(range.start, range.end), hit: true })
    cursor = range.end
  }
  if (cursor < quote.length) parts.push({ text: quote.slice(cursor), hit: false })
  return parts
}
