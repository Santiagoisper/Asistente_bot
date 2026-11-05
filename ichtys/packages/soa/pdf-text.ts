/**
 * pdf-text.ts — texto con caja y líneas de tabla por página (ADR-10 §2.2 b.1-2).
 *
 * `ingestion/parser.ts` descarta `transform`/`width`/`height` (defecto D1) y se
 * queda con el texto plano; acá cada ítem conserva su caja en puntos PDF
 * (espacio de usuario SIN rotar, el mismo que usa el gold) y cada borde de
 * celda sale de `getOperatorList` como segmento horizontal o vertical.
 *
 * Librería: `pdfjs-dist` build `legacy` (ver el spike en el mensaje del commit
 * que agrega este archivo): corre en Node puro sin DOM ni canvas, expone
 * `transform` + `getOperatorList` + `page.rotate`.
 */
import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs'
import type { PDFPageProxy } from 'pdfjs-dist/legacy/build/pdf.mjs'
import type { BBox, PageGeom, RuleLine, TextItem } from './types'

/** Tolerancia para considerar un segmento perfectamente H o V, en puntos. */
const AXIS_EPSILON = 0.5

/** Un borde más corto que esto es ruido (guiones, subrayados), no línea de tabla. */
const MIN_RULE_LENGTH = 2

/** Normaliza la rotación de página a 0/90/180/270. */
function normalizeRotate(raw: number): 0 | 90 | 180 | 270 {
  const mod = ((raw % 360) + 360) % 360
  if (mod === 90) return 90
  if (mod === 180) return 180
  if (mod === 270) return 270
  return 0
}

/** Caja axis-aligned de un ítem de texto a partir de su transform [a,b,c,d,e,f] + width/height. */
function textItemBBox(
  transform: readonly number[],
  width: number,
  height: number,
): BBox | null {
  if (transform.length < 6) return null
  const [a, b, c, d, e, f] = transform as [number, number, number, number, number, number]
  if (Math.abs(b) < 1e-6 && Math.abs(c) < 1e-6) {
    // Texto horizontal: avanza en +x desde (e, f) que es la línea de base.
    return [e, f, e + width, f + height]
  }
  if (Math.abs(a) < 1e-6 && Math.abs(d) < 1e-6) {
    // Texto vertical (etiquetas de encabezado giradas): avanza en ±y desde (e, f).
    const x0 = e - height
    const y0 = b > 0 ? f : f - width
    const y1 = b > 0 ? f + width : f
    return [x0, y0, e, y1]
  }
  // Skew real: eje mayor de la caja girada (aproximación axis-aligned).
  const xs = [0, width, -height, 0]
  const ys = [0, 0, height, height]
  let minX = e
  let maxX = e
  let minY = f
  let maxY = f
  for (let i = 0; i < 4; i++) {
    const x = e + a * (xs[i] ?? 0) + c * (ys[i] ?? 0)
    const y = f + b * (xs[i] ?? 0) + d * (ys[i] ?? 0)
    minX = Math.min(minX, x)
    maxX = Math.max(maxX, x)
    minY = Math.min(minY, y)
    maxY = Math.max(maxY, y)
  }
  return [minX, minY, maxX, maxY]
}

/**
 * Extrae los bordes de tabla de una página: cada `constructPath` del operator
 * list trae las coordenadas empaquetadas con opcode inline — 0 = moveTo y
 * 1 = lineTo consumen dos operandos (x, y); closePath no consume ninguno y
 * cierra el subpath (ese tramo de vuelta también es un borde). Un rectángulo
 * dibujado como M+L+L+L+close aporta dos segmentos horizontales y dos
 * verticales.
 */
function rulesFromOperatorList(
  fnArray: ArrayLike<number>,
  argsArray: ArrayLike<unknown>,
  page: number,
): RuleLine[] {
  const rules: RuleLine[] = []
  const pushSegment = (x0: number, y0: number, x1: number, y1: number) => {
    const dx = Math.abs(x1 - x0)
    const dy = Math.abs(y1 - y0)
    if (dx < AXIS_EPSILON && dy >= MIN_RULE_LENGTH) {
      rules.push({ page, x0, y0: Math.min(y0, y1), x1, y1: Math.max(y0, y1) })
    } else if (dy < AXIS_EPSILON && dx >= MIN_RULE_LENGTH) {
      rules.push({ page, x0: Math.min(x0, x1), y0, x1: Math.max(x0, x1), y1 })
    }
  }

  for (let i = 0; i < fnArray.length; i++) {
    if (fnArray[i] !== OPS.constructPath) continue
    const args = argsArray[i] as unknown[]
    if (!Array.isArray(args)) continue
    const packed = args[1]
    const coords =
      Array.isArray(packed) && packed[0] instanceof Float32Array
        ? (packed[0] as Float32Array)
        : packed instanceof Float32Array
          ? packed
          : null
    if (!coords) continue

    let curX: number | null = null
    let curY: number | null = null
    let startX: number | null = null
    let startY: number | null = null
    let j = 0
    while (j < coords.length) {
      const op = coords[j]
      if (op === 0 || op === 1) {
        const x = coords[j + 1]
        const y = coords[j + 2]
        if (x === undefined || y === undefined) break
        if (op === 0) {
          curX = x
          curY = y
          startX = x
          startY = y
        } else if (curX !== null && curY !== null) {
          pushSegment(curX, curY, x, y)
          curX = x
          curY = y
        }
        j += 3
      } else {
        // closePath: el tramo de vuelta al inicio del subpath también es un
        // borde (en los rects de grilla, ahí vive el lado izquierdo).
        if (curX !== null && curY !== null && startX !== null && startY !== null) {
          pushSegment(curX, curY, startX, startY)
        }
        curX = null
        curY = null
        startX = null
        startY = null
        j += 1
      }
    }
  }
  return rules
}

/** Geometría de una página: items con caja, bordes, tamaño y rotación. */
async function pageGeometry(page: PDFPageProxy, pageNumber: number): Promise<PageGeom> {
  const view = page.view // [x0, y0, x1, y1] en espacio de usuario sin rotar
  const width = (view[2] ?? 0) - (view[0] ?? 0)
  const height = (view[3] ?? 0) - (view[1] ?? 0)
  const rotate = normalizeRotate(page.rotate ?? 0)

  const content = await page.getTextContent()
  const items: TextItem[] = []
  for (const raw of content.items) {
    if (!('str' in raw) || typeof raw.str !== 'string' || raw.str.length === 0) continue
    if (!('transform' in raw) || !Array.isArray(raw.transform)) continue
    const fontSize = Math.hypot(raw.transform[2] ?? 0, raw.transform[3] ?? 0)
    const bbox = textItemBBox(raw.transform, raw.width ?? 0, raw.height ?? 0)
    if (!bbox || fontSize <= 0) continue
    items.push({ page: pageNumber, str: raw.str, bbox, fontSize })
  }

  const operatorList = await page.getOperatorList()
  const rules = rulesFromOperatorList(operatorList.fnArray, operatorList.argsArray, pageNumber)

  return { page: pageNumber, width, height, rotate, items, rules }
}

/**
 * Carga la geometría de todas las páginas de un PDF. Sin red, sin modelo.
 * Todos los valores quedan en el espacio de usuario SIN rotar, igual que las
 * cajas del gold; la rotación de página se reporta aparte en `rotate`.
 */
export async function loadPageGeometry(pdf: Uint8Array): Promise<PageGeom[]> {
  // pdfjs transfiere el buffer al worker (lo desconecta): copia defensiva.
  const task = getDocument({ data: new Uint8Array(pdf), useSystemFonts: true })
  try {
    const doc = await task.promise
    const pages: PageGeom[] = []
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n)
      try {
        pages.push(await pageGeometry(page, n))
      } finally {
        page.cleanup()
      }
    }
    return pages
  } finally {
    await task.destroy()
  }
}
