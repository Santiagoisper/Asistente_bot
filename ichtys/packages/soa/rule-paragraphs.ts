/**
 * Párrafos de reglas para P3 (G26). Solo geometría: las páginas que el
 * localizador rechazó como `synopsis_prose` antes de la primera tabla, y
 * el texto de la primera página de grilla que queda por encima del
 * encabezado. El texto se devuelve y no se loguea (S8).
 */
import type { PageGeom, RawTable, RuleParagraph, ScheduleLocation, TextItem } from './types'

/** Tope de páginas de sinopsis. La página de la grilla, si entra, va aparte. */
export const RULE_PAGE_CAP = 6
/** Tope de caracteres sumados. Al llegar, se corta y no se agregan más. */
export const RULE_CHAR_CAP = 8_000

const FOLIO_RE = /^(página|page)\s+\d+$/i
/** Techos a esta distancia (pt) son la misma línea. */
const LINE_BUCKET = 2
/** Hueco entre la base de una línea y el techo de la siguiente que abre párrafo. */
const PARAGRAPH_GAP = 18

interface Line {
  top: number
  bottom: number
  text: string
}

function linesOf(items: TextItem[]): Line[] {
  const buckets = new Map<number, TextItem[]>()
  for (const item of items) {
    if (item.rotated || item.str.trim().length === 0) continue
    const top = Math.round(item.bbox[3] / LINE_BUCKET) * LINE_BUCKET
    const arr = buckets.get(top) ?? []
    arr.push(item)
    buckets.set(top, arr)
  }
  return [...buckets.entries()]
    .sort((a, b) => b[0] - a[0])
    .flatMap(([top, arr]) => {
      arr.sort((a, b) => a.bbox[0] - b.bbox[0])
      const text = arr
        .map((item) => item.str.trim())
        .filter((part) => part.length > 0)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim()
      if (text.length === 0 || FOLIO_RE.test(text)) return []
      return [{ top, bottom: Math.min(...arr.map((item) => item.bbox[1])), text }]
    })
}

function paragraphsOf(items: TextItem[]): string[] {
  const lines = linesOf(items)
  const out: string[] = []
  let current = ''
  let prevBottom = Infinity
  for (const line of lines) {
    const gap = prevBottom - line.top
    if (current.length > 0 && gap > PARAGRAPH_GAP) {
      out.push(current)
      current = line.text
    } else {
      current = current.length > 0 ? `${current} ${line.text}` : line.text
    }
    prevBottom = line.bottom
  }
  if (current.length > 0) out.push(current)
  return out
}

/**
 * Arma `ruleParagraphs`. `headerTop` es el techo del encabezado de la
 * primera página de la primera tabla (caja de la ficha); el texto con la
 * base por encima de ese techo es el preámbulo de la grilla.
 */
export function collectRuleParagraphs(
  pages: PageGeom[],
  location: ScheduleLocation,
  tables: RawTable[],
): RuleParagraph[] {
  const tablePages = tables.flatMap((table) => table.pages)
  const firstTablePage = tablePages.length > 0 ? Math.min(...tablePages) : Infinity
  const synopsisPages = location.rejected
    .filter((item) => item.reason === 'synopsis_prose' && item.page < firstTablePage)
    .map((item) => item.page)
    .sort((a, b) => a - b)
    .slice(0, RULE_PAGE_CAP)
  const byPage = new Map(pages.map((page) => [page.page, page]))
  const paragraphs: RuleParagraph[] = []
  let chars = 0
  const push = (page: number, text: string) => {
    const clean = text.replace(/\s+/g, ' ').trim()
    if (clean.length === 0 || chars >= RULE_CHAR_CAP) return
    const sliced = clean.slice(0, RULE_CHAR_CAP - chars)
    paragraphs.push({ index: paragraphs.length, page, text: sliced })
    chars += sliced.length
  }
  for (const pageNumber of synopsisPages) {
    const page = byPage.get(pageNumber)
    if (!page) continue
    for (const text of paragraphsOf(page.items)) push(pageNumber, text)
  }
  const first = tables[0]
  const headerPage = first?.pages[0]
  if (
    first &&
    headerPage !== undefined &&
    synopsisPages.length < RULE_PAGE_CAP &&
    chars < RULE_CHAR_CAP
  ) {
    const tops = first.columns.filter((column) => column.page === headerPage).map((column) => column.headerBBox[3])
    const headerTop = tops.length > 0 ? Math.max(...tops) : undefined
    const page = byPage.get(headerPage)
    if (page && headerTop !== undefined) {
      const above = page.items.filter((item) => item.bbox[1] > headerTop + 1)
      for (const text of paragraphsOf(above)) push(headerPage, text)
    }
  }
  return paragraphs
}
