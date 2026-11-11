/**
 * Geometría del recorte de una foto o un escaneo. El recorte se expresa en
 * fracciones de la imagen (0 a 1) para que no dependa del tamaño en pantalla.
 */
export interface CropRect {
  left: number
  top: number
  right: number
  bottom: number
}

export interface Point {
  x: number
  y: number
}

export const FULL_RECT: CropRect = { left: 0, top: 0, right: 1, bottom: 1 }
/** Un recorte más chico que esto es un toque accidental, no una selección. */
export const MIN_CROP_FRACTION = 0.05
/** Lado mayor de la imagen que se sube: alcanza para leer cifras chicas sin pasar el tope de tamaño. */
export const MAX_OUTPUT_SIDE = 2000

const clamp01 = (value: number): number => (Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0)

/** Rectángulo entre dos puntos de un arrastre, en cualquier dirección. */
export function rectFromDrag(a: Point, b: Point): CropRect {
  const [ax, ay, bx, by] = [clamp01(a.x), clamp01(a.y), clamp01(b.x), clamp01(b.y)]
  return { left: Math.min(ax, bx), top: Math.min(ay, by), right: Math.max(ax, bx), bottom: Math.max(ay, by) }
}

export function isUsableRect(rect: CropRect): boolean {
  return rect.right - rect.left >= MIN_CROP_FRACTION && rect.bottom - rect.top >= MIN_CROP_FRACTION
}

/** Mueve el borde de arriba o el de abajo sin que se crucen. */
export function withEdge(rect: CropRect, edge: 'top' | 'bottom', value: number): CropRect {
  if (edge === 'top') return { ...rect, top: Math.min(clamp01(value), rect.bottom - MIN_CROP_FRACTION) }
  return { ...rect, bottom: Math.max(clamp01(value), rect.top + MIN_CROP_FRACTION) }
}

/** Zona de la imagen original, en píxeles enteros y siempre dentro de la imagen. */
export function cropPixels(rect: CropRect, width: number, height: number): { sx: number; sy: number; sw: number; sh: number } {
  const sx = Math.min(Math.max(0, Math.floor(rect.left * width)), Math.max(0, width - 1))
  const sy = Math.min(Math.max(0, Math.floor(rect.top * height)), Math.max(0, height - 1))
  const sw = Math.max(1, Math.min(width - sx, Math.ceil((rect.right - rect.left) * width)))
  const sh = Math.max(1, Math.min(height - sy, Math.ceil((rect.bottom - rect.top) * height)))
  return { sx, sy, sw, sh }
}

/** Tamaño de salida: nunca agranda; achica si el lado mayor pasa el máximo. */
export function outputSize(sw: number, sh: number, maxSide: number = MAX_OUTPUT_SIDE): { width: number; height: number } {
  const scale = Math.min(1, maxSide / Math.max(sw, sh, 1))
  return { width: Math.max(1, Math.round(sw * scale)), height: Math.max(1, Math.round(sh * scale)) }
}
