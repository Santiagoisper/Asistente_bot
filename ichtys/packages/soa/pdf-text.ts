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

/**
 * Topes de lectura (S5, paridad con ingestion — evidencia/B4-sicario.md):
 * se aplican ANTES de leer contenido, con rechazo controlado (fail-closed).
 */
const MAX_PDF_BYTES = 50 * 1024 * 1024 // subida máxima: 50 MB por archivo
const MAX_PAGES = 300 // páginas por documento
const PAGE_TIMEOUT_MS = 10_000 // cuelgue por página hostil

export type PdfLimitCode = 'file_too_large' | 'too_many_pages' | 'page_timeout'

/** Rechazo por tope de lectura: código estable para manejo upstream. */
export class PdfLimitError extends Error {
  readonly code: PdfLimitCode

  constructor(code: PdfLimitCode, detail: string) {
    super(`pdf_${code}: ${detail}`)
    this.name = 'PdfLimitError'
    this.code = code
  }
}

/** Carrera contra el reloj: una página hostil que cuelga corta con código. */
async function withPageTimeout<T>(work: Promise<T>, pageNumber: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new PdfLimitError('page_timeout', `página ${pageNumber} excede ${PAGE_TIMEOUT_MS} ms`)),
      PAGE_TIMEOUT_MS,
    )
  })
  try {
    return await Promise.race([work, timeout])
  } finally {
    clearTimeout(timer)
  }
}

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
    // Texto vertical (etiquetas giradas ±90°): avanza en ±y desde (e, f) y
    // el cuerpo del glifo va en ∓x según el signo de c (con b < 0 la caja
    // crece hacia +x, no hacia −x).
    const x0 = c > 0 ? e : e - height
    const x1 = c > 0 ? e + height : e
    const y0 = b > 0 ? f : f - width
    const y1 = b > 0 ? f + width : f
    return [x0, y0, x1, y1]
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
    const rotated = Math.abs(raw.transform[1] ?? 0) >= 1e-6 || Math.abs(raw.transform[2] ?? 0) >= 1e-6
    items.push({ page: pageNumber, str: raw.str, bbox, fontSize, rotated })
  }

  const operatorList = await page.getOperatorList()
  const rules = rulesFromOperatorList(operatorList.fnArray, operatorList.argsArray, pageNumber)

  return { page: pageNumber, width, height, rotate, items, rules }
}

/**
 * Carga la geometría de todas las páginas de un PDF. Sin red, sin modelo.
 * Todos los valores quedan en el espacio de usuario SIN rotar, igual que las
 * cajas del gold; la rotación de página se reporta aparte en `rotate`.
 *
 * Topes S5 antes de leer (K3): buffer, cantidad de páginas y tiempo por
 * página; sobre el tope lanza `PdfLimitError` (código estable), nunca un
 * cuelgue ni un crash. `getDocument` endurecido: sin fuentes del sistema ni
 * de documento (solo se lee texto/posición, no se renderiza) y sin logs de
 * la librería. `isEvalSupported` no se pasa: pdfjs-dist 6 lo eliminó de la
 * API junto con el eval de font programs (el endurecimiento ya viene de
 * fábrica en la versión fijada).
 */
export async function loadPageGeometry(pdf: Uint8Array): Promise<PageGeom[]> {
  if (pdf.byteLength > MAX_PDF_BYTES) {
    throw new PdfLimitError('file_too_large', `${pdf.byteLength} bytes > ${MAX_PDF_BYTES}`)
  }
  // pdfjs transfiere el buffer al worker (lo desconecta): copia defensiva.
  const task = getDocument({
    data: new Uint8Array(pdf),
    disableFontFace: true,
    useSystemFonts: false,
    verbosity: 0,
  })
  try {
    const doc = await task.promise
    if (doc.numPages > MAX_PAGES) {
      throw new PdfLimitError('too_many_pages', `${doc.numPages} páginas > ${MAX_PAGES}`)
    }
    const pages: PageGeom[] = []
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await withPageTimeout(doc.getPage(n), n)
      try {
        pages.push(await withPageTimeout(pageGeometry(page, n), n))
      } finally {
        page.cleanup()
      }
    }
    return pages
  } finally {
    await task.destroy()
  }
}
