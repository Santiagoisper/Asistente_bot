'use client'

import { useRouter } from 'next/navigation'
import { Camera, ImagePlus, Trash2 } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { FULL_RECT, type CropRect } from '../../lib/labs/crop-geometry'
import { cropPageToJpeg, ImagePrepError, pagesFromFile, releasePage, type SourcePage } from '../../lib/labs/image-prep'
import { MAX_LAB_IMAGES, MAX_LAB_PDF_BYTES } from '../../lib/labs/lab-report-content'
import { imagePrepMessage, MAX_LAB_PDF_MB, missingPhotoSteps, uploadError } from '../../lib/labs/upload-form-state'
import { ImageCropper } from './image-cropper'

interface Sheet {
  page: SourcePage
  rect: CropRect
  /** La persona marcó una zona en esta hoja. */
  marked: boolean
  /** La persona declaró que la hoja no muestra nombre ni documento y va entera. */
  whole: boolean
}

interface Props {
  /** Estudio y sujeto elegidos, o null si todavía falta alguno. */
  target: { studyId: string; subjectId: string } | null
  /** Lo que falta del estudio y el sujeto, para decirlo junto al botón. */
  missingTarget: string[]
  /** La imagen recortada se conserva después de revisar (política de conservación). */
  evidenceKept: boolean
}

const buttonClass =
  'inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-lg border-[1.5px] border-os-accent bg-white px-4 text-sm font-semibold text-os-accentdim hover:bg-os-tint focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-os-accent'

/**
 * Carga de un informe como foto o escaneo. Cada hoja se recorta acá, en el
 * navegador: del equipo sale solo la zona marcada. El programa la lee dos
 * veces y lo que no coincide queda para decidir en la revisión.
 */
export function PhotoUpload({ target, missingTarget, evidenceKept }: Props) {
  const router = useRouter()
  const id = useId()
  const [sheets, setSheets] = useState<Sheet[]>([])
  const [opening, setOpening] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const latest = useRef<Sheet[]>([])
  latest.current = sheets

  // Al salir de la pantalla se liberan las copias locales de las hojas.
  useEffect(() => () => latest.current.forEach((sheet) => releasePage(sheet.page)), [])

  async function addFiles(files: FileList | null) {
    if (!files || files.length === 0 || opening || busy) return
    setOpening(true)
    setError(null)
    setNotice(null)
    const added: Sheet[] = []
    let skipped = 0
    try {
      for (const file of Array.from(files)) {
        const room = MAX_LAB_IMAGES - latest.current.length - added.length
        if (room <= 0) {
          skipped += 1
          continue
        }
        const result = await pagesFromFile(file, room)
        skipped += result.skipped
        added.push(...result.pages.map((page) => ({ page, rect: FULL_RECT, marked: false, whole: false })))
      }
    } catch (err) {
      setError(imagePrepMessage(err instanceof ImagePrepError ? err.code : 'decode_failed'))
    } finally {
      if (added.length > 0) setSheets((current) => [...current, ...added])
      if (skipped > 0) setNotice(`Se admiten hasta ${MAX_LAB_IMAGES} hojas por estudio: quedaron afuera ${skipped}. Subí solo las hojas con resultados.`)
      setOpening(false)
    }
  }

  function change(pageId: string, patch: Partial<Sheet>) {
    setSheets((current) => current.map((sheet) => (sheet.page.id === pageId ? { ...sheet, ...patch } : sheet)))
  }

  function remove(pageId: string) {
    setSheets((current) => {
      current.filter((sheet) => sheet.page.id === pageId).forEach((sheet) => releasePage(sheet.page))
      return current.filter((sheet) => sheet.page.id !== pageId)
    })
  }

  const unmarked = sheets.filter((sheet) => !sheet.marked && !sheet.whole).length
  const missing = missingPhotoSteps(missingTarget, { pageCount: sheets.length, unmarked })
  const ready = missing.length === 0 && target !== null && !busy && !opening

  async function submit() {
    if (!ready || !target) return
    setBusy(true)
    setError(null)
    try {
      const body = new FormData()
      let total = 0
      for (const [index, sheet] of sheets.entries()) {
        const blob = await cropPageToJpeg(sheet.page, sheet.whole ? FULL_RECT : sheet.rect)
        total += blob.size
        body.append('image', new File([blob], `hoja-${index + 1}.jpg`, { type: 'image/jpeg' }))
      }
      if (total > MAX_LAB_PDF_BYTES) {
        setError(`Las hojas juntas pesan más de ${MAX_LAB_PDF_MB} MB. Quitá una hoja o marcá solo la tabla de resultados.`)
        return
      }
      const response = await fetch(`/api/studies/${target.studyId}/subjects/${target.subjectId}/lab-reports/images`, { method: 'POST', body })
      const payload: unknown = await response.json().catch(() => null)
      if (response.status === 201 && typeof payload === 'object' && payload !== null && typeof (payload as { reportId?: unknown }).reportId === 'string') {
        router.push(`/studies/${target.studyId}/subjects/${target.subjectId}/labs/${(payload as { reportId: string }).reportId}`)
        return
      }
      setError(uploadError(response.status, typeof payload === 'object' && payload !== null ? (payload as { error?: unknown }).error : null))
    } catch (err) {
      setError(err instanceof ImagePrepError ? imagePrepMessage(err.code) : 'No se pudo subir la imagen. Revisá la conexión y probá de nuevo.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 rounded-2xl border-2 border-dashed border-[#9CC9C1] bg-[#F2FAF8] px-4 py-5">
        <p className="text-sm text-os-ink">
          <span className="font-semibold">Foto o escaneo del informe.</span> En cada hoja marcá solo la tabla de resultados: lo que queda sombreado no sale de este equipo.
        </p>
        <div className="flex flex-wrap gap-2">
          <label className={buttonClass} htmlFor={`${id}-files`}>
            <ImagePlus aria-hidden="true" className="h-4 w-4" />
            {sheets.length === 0 ? 'Elegir foto o PDF escaneado' : 'Agregar otra hoja'}
            <input
              id={`${id}-files`}
              type="file"
              multiple
              accept="image/jpeg,image/png,image/webp,application/pdf,.pdf"
              className="sr-only"
              disabled={opening || busy || sheets.length >= MAX_LAB_IMAGES}
              onChange={(event) => {
                void addFiles(event.target.files)
                event.target.value = ''
              }}
            />
          </label>
          <label className={buttonClass} htmlFor={`${id}-camera`}>
            <Camera aria-hidden="true" className="h-4 w-4" />
            Sacar una foto
            <input
              id={`${id}-camera`}
              type="file"
              accept="image/*"
              capture="environment"
              className="sr-only"
              disabled={opening || busy || sheets.length >= MAX_LAB_IMAGES}
              onChange={(event) => {
                void addFiles(event.target.files)
                event.target.value = ''
              }}
            />
          </label>
        </div>
        <p className="text-sm text-os-subtle">
          JPG, PNG o PDF escaneado. Hasta {MAX_LAB_IMAGES} hojas.{' '}
          {evidenceKept
            ? 'La zona recortada se guarda cifrada junto al estudio, para poder volver a verla.'
            : 'La zona recortada se guarda cifrada solo hasta que el estudio se confirma o se rechaza.'}
        </p>
        {opening ? <p role="status" className="text-sm font-semibold text-os-accentdim">Abriendo las hojas…</p> : null}
      </div>

      {notice ? <p role="status" className="rounded-xl bg-[#FFF1D6] px-4 py-3 text-sm text-[#6B4200]">{notice}</p> : null}

      {sheets.length > 0 ? (
        <ol className="flex flex-col gap-5">
          {sheets.map((sheet, index) => (
            <li key={sheet.page.id} className="flex flex-col gap-3 rounded-2xl border border-alphi-border bg-white p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-semibold text-os-ink">
                  Hoja {index + 1} de {sheets.length}
                  <span className={`ml-2 rounded-full px-2.5 py-1 text-xs ${sheet.marked || sheet.whole ? 'bg-os-tint text-os-accentdim' : 'bg-[#FFF1D6] text-[#6B4200]'}`}>
                    {sheet.whole ? 'Va entera' : sheet.marked ? 'Zona marcada' : 'Falta marcar la zona'}
                  </span>
                </p>
                <button
                  type="button"
                  disabled={busy}
                  className="inline-flex min-h-11 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold text-[#8C1D3A] hover:bg-[#FBE3E7] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-os-accent"
                  onClick={() => remove(sheet.page.id)}
                >
                  <Trash2 aria-hidden="true" className="h-4 w-4" />
                  Quitar hoja
                </button>
              </div>
              <p className="text-sm text-os-subtle">Arrastrá sobre la imagen para marcar la tabla de resultados. Dejá afuera el nombre, el documento y la obra social.</p>
              <ImageCropper
                page={sheet.page}
                label={`Hoja ${index + 1} del informe`}
                rect={sheet.whole ? FULL_RECT : sheet.rect}
                marked={sheet.marked && !sheet.whole}
                disabled={busy || sheet.whole}
                onChange={(rect) => change(sheet.page.id, { rect, marked: true })}
              />
              <label className="flex cursor-pointer items-start gap-2 text-sm text-os-ink">
                <input
                  type="checkbox"
                  className="mt-0.5 h-5 w-5 shrink-0 accent-[#0B7A6E] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-os-accent"
                  checked={sheet.whole}
                  disabled={busy}
                  onChange={(event) => change(sheet.page.id, { whole: event.target.checked })}
                />
                <span>Esta hoja no muestra nombre, documento ni obra social: subirla entera.</span>
              </label>
            </li>
          ))}
        </ol>
      ) : null}

      {error ? (
        <p role="alert" className="rounded-xl bg-[#FBE3E7] px-4 py-3 text-sm text-[#8C1D3A]">
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-md text-sm text-os-subtle">
          El programa lee la imagen dos veces. Lo que no coincide queda marcado para que lo decidas mirando la imagen, y nada pasa al registro hasta que confirmes.
        </p>
        <div className="flex flex-col items-end gap-1.5">
          <button
            type="button"
            disabled={!ready}
            aria-describedby={missing.length > 0 ? `${id}-missing` : undefined}
            className="inline-flex min-h-11 items-center justify-center rounded-lg bg-os-accent px-5 text-sm font-semibold text-white hover:bg-os-accentdim disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-os-accent"
            onClick={() => void submit()}
          >
            {busy ? 'Leyendo el estudio…' : 'Leer el estudio'}
          </button>
          {busy ? (
            <p role="status" className="text-sm text-os-subtle">Son dos lecturas: puede tardar hasta un minuto.</p>
          ) : missing.length > 0 ? (
            <p id={`${id}-missing`} className="text-sm text-os-subtle">
              Falta {missing.join(' y ')}.
            </p>
          ) : null}
        </div>
      </div>
    </div>
  )
}
