import { MAX_LAB_PDF_BYTES } from './lab-report-content'

/**
 * Lógica de la pantalla "Cargar estudio de laboratorio", separada del
 * componente para poder probarla: qué falta para poder leer el estudio y qué
 * decirle a la persona cuando algo no sale.
 */

export const MAX_LAB_PDF_MB = MAX_LAB_PDF_BYTES / (1024 * 1024)

export type SubjectsState = 'loading' | 'ready' | 'error'

export interface UploadFormSnapshot {
  studyId: string
  subjectsState: SubjectsState
  subjectCount: number
  subjectId: string
  hasFile: boolean
}

/** Lo que falta para habilitar "Leer el estudio", en el orden en que se resuelve. */
export function missingSteps(form: UploadFormSnapshot): string[] {
  const missing: string[] = []
  if (!form.studyId) missing.push('elegir el estudio')
  else if (form.subjectsState === 'loading') missing.push('esperar la lista de sujetos')
  else if (form.subjectsState === 'error') missing.push('recargar la lista de sujetos')
  else if (form.subjectCount === 0) missing.push('crear el sujeto')
  else if (!form.subjectId) missing.push('elegir el sujeto')
  if (!form.hasFile) missing.push('elegir el PDF')
  return missing
}

/** Los estudios con sujetos van primero; dentro de cada grupo se conserva el orden recibido. */
export function orderStudyOptions<T extends { subjectCount: number }>(options: T[]): T[] {
  return [...options.filter((option) => option.subjectCount > 0), ...options.filter((option) => option.subjectCount === 0)]
}

export function subjectCountLabel(count: number): string {
  if (count === 0) return 'sin sujetos'
  return count === 1 ? '1 sujeto' : `${count} sujetos`
}

/** Mismo criterio que el servidor: 2 a 32 caracteres, letras, números y guiones. */
export function subjectCodeProblem(code: string): string | null {
  const value = code.trim()
  if (value.length === 0) return 'Escribí el código del sujeto.'
  if (value.length < 2 || value.length > 32) return 'El código tiene entre 2 y 32 caracteres.'
  if (!/^[A-Za-z0-9-]+$/.test(value)) return 'Usá solo letras, números y guiones.'
  return null
}

/** Mensaje para una respuesta fallida al crear el sujeto. */
export function createSubjectError(status: number, code: unknown): string {
  if (status === 409 || code === 'subject_code_exists') return 'Ya hay un sujeto con ese código en este estudio.'
  if (status === 400) return 'Usá solo letras, números y guiones (2 a 32 caracteres).'
  if (status === 401 || status === 403) return 'Tu rol no puede crear sujetos en este estudio.'
  if (status === 503) return 'El cifrado de datos clínicos no está configurado. Avisá a quien administra el sistema.'
  return 'No se pudo crear el sujeto. Probá de nuevo.'
}

/** Mensaje para una respuesta fallida al leer el estudio. Nunca muestra texto del documento. */
export function uploadError(status: number, code: unknown): string {
  const known: Record<string, string> = {
    no_text: 'Ese PDF es un escaneo: no tiene texto seleccionable. Cargalo desde «Foto o escaneo».',
    no_rows: 'No se encontraron resultados en ese PDF. Revisá que sea un informe de laboratorio.',
    too_many_pages: 'El informe tiene más de 20 páginas. Subí solo las hojas de resultados.',
    unreadable: 'No se pudo leer ese PDF. Probá descargarlo de nuevo del laboratorio.',
    not_pdf: 'El archivo no es un PDF.',
    bad_image: 'La imagen no se pudo usar. Probá con una foto JPG o PNG, o con el PDF del escaneo.',
    reader_unavailable: 'El lector de imágenes no está respondiendo. Probá de nuevo en unos minutos; el estudio no se guardó.',
  }
  if (typeof code === 'string' && known[code]) return known[code]
  if (status === 413) return `El archivo pesa más de ${MAX_LAB_PDF_MB} MB.`
  if (status === 504) return 'La lectura tardó demasiado. Probá con menos hojas o recortando solo la tabla.'
  if (status === 401 || status === 403) return 'Tu rol no puede cargar estudios para este sujeto.'
  if (status === 404) return 'No se encontró ese sujeto. Recargá la página y probá de nuevo.'
  if (status === 503) return 'El cifrado de datos clínicos no está configurado. Avisá a quien administra el sistema.'
  return 'No se pudo leer el estudio. Probá de nuevo.'
}

/** Mensaje para un problema al preparar la foto o el escaneo en el navegador. */
export function imagePrepMessage(code: string): string {
  if (code === 'unsupported') return 'Ese formato no se puede leer acá. Usá una foto JPG o PNG, o el PDF del escaneo.'
  if (code === 'pdf_failed') return 'No se pudo abrir ese PDF. Probá sacarle una captura a la hoja de resultados y subila como imagen.'
  if (code === 'too_large') return 'La zona marcada es demasiado grande para subir. Marcá solo la tabla de resultados.'
  return 'No se pudo abrir esa imagen. Probá con otra foto.'
}

export interface PhotoSnapshot {
  pageCount: number
  /** Hojas en las que todavía no se marcó la zona ni se declaró que no hay datos personales. */
  unmarked: number
}

/** Lo que falta en "Foto o escaneo", después de lo que falte del estudio y el sujeto. */
export function missingPhotoSteps(target: string[], photo: PhotoSnapshot): string[] {
  const missing = [...target]
  if (photo.pageCount === 0) missing.push('elegir la foto o el escaneo')
  else if (photo.unmarked > 0) missing.push(photo.unmarked === 1 ? 'marcar la zona de resultados en una hoja' : `marcar la zona de resultados en ${photo.unmarked} hojas`)
  return missing
}
