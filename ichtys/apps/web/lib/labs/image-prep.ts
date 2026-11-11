import { cropPixels, outputSize, type CropRect } from './crop-geometry'
import { MAX_LAB_IMAGE_BYTES, MAX_LAB_IMAGES } from './lab-report-content'

/**
 * Preparación de fotos y escaneos en el navegador. Todo esto corre en el
 * equipo de quien carga: del equipo sale solo la zona recortada, nunca la
 * hoja entera con el encabezado.
 */

export interface SourcePage {
  id: string
  /** URL local (blob:) de la hoja completa. Hay que liberarla con `releasePage`. */
  url: string
  width: number
  height: number
}

export type ImagePrepCode = 'unsupported' | 'decode_failed' | 'pdf_failed' | 'too_large'

export class ImagePrepError extends Error {
  constructor(readonly code: ImagePrepCode) {
    super(`image prep: ${code}`)
    this.name = 'ImagePrepError'
  }
}

const PDFJS_BASE = '/vendor/pdfjs-3.11.174'
/** Ancho al que se dibuja cada hoja de un PDF escaneado. */
const PDF_RENDER_WIDTH = 1700
/** Lado mayor de la copia de trabajo de una foto. */
const MAX_WORKING_SIDE = 2600
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp']

let sequence = 0
const nextId = (): string => `hoja-${(sequence += 1)}`

function canvasOf(width: number, height: number): { canvas: HTMLCanvasElement; context: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw new ImagePrepError('decode_failed')
  // Fondo blanco: un PNG con transparencia saldría negro al pasar a JPEG.
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, width, height)
  return { canvas, context }
}

function toBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new ImagePrepError('decode_failed'))), 'image/jpeg', quality)
  })
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new ImagePrepError('decode_failed'))
    image.src = url
  })
}

async function pageFromCanvas(canvas: HTMLCanvasElement): Promise<SourcePage> {
  const blob = await toBlob(canvas, 0.92)
  return { id: nextId(), url: URL.createObjectURL(blob), width: canvas.width, height: canvas.height }
}

/** Foto: se endereza según la orientación de la cámara y se deja una copia de trabajo. */
async function pageFromImage(file: File): Promise<SourcePage> {
  let source: ImageBitmap | HTMLImageElement
  let temporaryUrl: string | null = null
  try {
    if (typeof createImageBitmap === 'function') {
      source = await createImageBitmap(file, { imageOrientation: 'from-image' })
    } else {
      temporaryUrl = URL.createObjectURL(file)
      source = await loadImage(temporaryUrl)
    }
  } catch {
    if (temporaryUrl) URL.revokeObjectURL(temporaryUrl)
    throw new ImagePrepError('decode_failed')
  }
  try {
    const size = outputSize(source.width, source.height, MAX_WORKING_SIDE)
    const { canvas, context } = canvasOf(size.width, size.height)
    context.drawImage(source, 0, 0, size.width, size.height)
    return await pageFromCanvas(canvas)
  } finally {
    if ('close' in source) source.close()
    if (temporaryUrl) URL.revokeObjectURL(temporaryUrl)
  }
}

interface PdfJsPage {
  getViewport(options: { scale: number }): { width: number; height: number }
  render(options: { canvasContext: CanvasRenderingContext2D; viewport: unknown }): { promise: Promise<void> }
}
interface PdfJsDocument {
  numPages: number
  getPage(index: number): Promise<PdfJsPage>
  destroy(): Promise<void>
}
interface PdfJsLib {
  GlobalWorkerOptions: { workerSrc: string }
  getDocument(source: { data: Uint8Array }): { promise: Promise<PdfJsDocument> }
}

let pdfjsLoading: Promise<PdfJsLib> | null = null

/** Carga el lector de PDF del navegador una sola vez, desde la propia aplicación. */
function loadPdfJs(): Promise<PdfJsLib> {
  pdfjsLoading ??= new Promise<PdfJsLib>((resolve, reject) => {
    const existing = (window as unknown as { pdfjsLib?: PdfJsLib }).pdfjsLib
    if (existing) {
      resolve(existing)
      return
    }
    const script = document.createElement('script')
    script.src = `${PDFJS_BASE}/pdf.min.js`
    script.async = true
    script.onload = () => {
      const lib = (window as unknown as { pdfjsLib?: PdfJsLib }).pdfjsLib
      if (!lib) {
        reject(new ImagePrepError('pdf_failed'))
        return
      }
      lib.GlobalWorkerOptions.workerSrc = `${PDFJS_BASE}/pdf.worker.min.js`
      resolve(lib)
    }
    script.onerror = () => reject(new ImagePrepError('pdf_failed'))
    document.head.appendChild(script)
  }).catch((err: unknown) => {
    pdfjsLoading = null
    throw err
  })
  return pdfjsLoading
}

/** PDF escaneado: cada hoja se dibuja como imagen para poder recortarla. */
async function pagesFromPdf(file: File, limit: number): Promise<{ pages: SourcePage[]; skipped: number }> {
  let document_: PdfJsDocument | null = null
  const pages: SourcePage[] = []
  try {
    const lib = await loadPdfJs()
    document_ = await lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise
    const count = Math.min(document_.numPages, limit)
    for (let index = 1; index <= count; index += 1) {
      const page = await document_.getPage(index)
      const base = page.getViewport({ scale: 1 })
      const viewport = page.getViewport({ scale: PDF_RENDER_WIDTH / Math.max(1, base.width) })
      const { canvas, context } = canvasOf(Math.round(viewport.width), Math.round(viewport.height))
      await page.render({ canvasContext: context, viewport }).promise
      pages.push(await pageFromCanvas(canvas))
    }
    return { pages, skipped: Math.max(0, document_.numPages - count) }
  } catch (err) {
    pages.forEach(releasePage)
    throw err instanceof ImagePrepError ? err : new ImagePrepError('pdf_failed')
  } finally {
    await document_?.destroy().catch(() => undefined)
  }
}

/** Hojas de un archivo: una foto es una hoja; un PDF, una por página (hasta `limit`). */
export async function pagesFromFile(file: File, limit: number = MAX_LAB_IMAGES): Promise<{ pages: SourcePage[]; skipped: number }> {
  if (limit <= 0) return { pages: [], skipped: 1 }
  const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
  if (isPdf) return pagesFromPdf(file, limit)
  if (!IMAGE_TYPES.includes(file.type)) throw new ImagePrepError('unsupported')
  return { pages: [await pageFromImage(file)], skipped: 0 }
}

export function releasePage(page: SourcePage): void {
  URL.revokeObjectURL(page.url)
}

/** Recorta la zona marcada y la deja como JPEG por debajo del tope de tamaño. */
export async function cropPageToJpeg(page: SourcePage, rect: CropRect): Promise<Blob> {
  const image = await loadImage(page.url)
  const { sx, sy, sw, sh } = cropPixels(rect, image.naturalWidth, image.naturalHeight)
  let size = outputSize(sw, sh)
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const { canvas, context } = canvasOf(size.width, size.height)
    context.drawImage(image, sx, sy, sw, sh, 0, 0, size.width, size.height)
    for (const quality of [0.9, 0.8, 0.7]) {
      const blob = await toBlob(canvas, quality)
      if (blob.size <= MAX_LAB_IMAGE_BYTES) return blob
    }
    size = { width: Math.max(1, Math.round(size.width * 0.75)), height: Math.max(1, Math.round(size.height * 0.75)) }
  }
  throw new ImagePrepError('too_large')
}
