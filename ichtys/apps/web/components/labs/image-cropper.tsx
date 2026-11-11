'use client'

import { useId, useRef, useState, type PointerEvent } from 'react'
import { isUsableRect, rectFromDrag, withEdge, type CropRect, type Point } from '../../lib/labs/crop-geometry'
import type { SourcePage } from '../../lib/labs/image-prep'

interface Props {
  page: SourcePage
  label: string
  rect: CropRect
  /** true cuando la persona ya marcó una zona. */
  marked: boolean
  disabled: boolean
  onChange: (rect: CropRect) => void
}

const percent = (value: number): string => `${(value * 100).toFixed(2)}%`

/**
 * Hoja de un informe con la zona de resultados marcada encima. Se marca
 * arrastrando; los dos deslizadores mueven el borde de arriba y el de abajo
 * para quien usa teclado. Lo que queda sombreado no sale del equipo.
 */
export function ImageCropper({ page, label, rect, marked, disabled, onChange }: Props) {
  const id = useId()
  const frame = useRef<HTMLDivElement>(null)
  const [start, setStart] = useState<Point | null>(null)
  const [draft, setDraft] = useState<CropRect | null>(null)
  const shown = draft ?? rect

  function pointOf(event: PointerEvent<HTMLDivElement>): Point | null {
    const box = frame.current?.getBoundingClientRect()
    if (!box || box.width === 0 || box.height === 0) return null
    return { x: (event.clientX - box.left) / box.width, y: (event.clientY - box.top) / box.height }
  }

  function begin(event: PointerEvent<HTMLDivElement>) {
    if (disabled || event.button !== 0) return
    const point = pointOf(event)
    if (!point) return
    event.currentTarget.setPointerCapture?.(event.pointerId)
    setStart(point)
    setDraft(rectFromDrag(point, point))
  }

  function move(event: PointerEvent<HTMLDivElement>) {
    if (!start) return
    const point = pointOf(event)
    if (point) setDraft(rectFromDrag(start, point))
  }

  function end(event: PointerEvent<HTMLDivElement>) {
    if (!start) return
    const point = pointOf(event)
    const next = point ? rectFromDrag(start, point) : draft
    setStart(null)
    setDraft(null)
    // Un toque sin arrastre no cambia lo que ya estaba marcado.
    if (next && isUsableRect(next)) onChange(next)
  }

  return (
    <div className="flex flex-col gap-2">
      <div
        ref={frame}
        role="img"
        aria-label={`${label}. ${marked ? 'Zona de resultados marcada.' : 'Sin zona marcada.'}`}
        className={`relative select-none overflow-hidden rounded-xl border border-alphi-border bg-white ${disabled ? '' : 'cursor-crosshair'}`}
        style={{ touchAction: 'none' }}
        onPointerDown={begin}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={() => {
          setStart(null)
          setDraft(null)
        }}
      >
        <img src={page.url} alt="" draggable={false} className="pointer-events-none block w-full" />
        {marked || draft ? (
          <>
            <div className="pointer-events-none absolute inset-x-0 top-0 bg-[#0D1F3C]/60" style={{ height: percent(shown.top) }} />
            <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-[#0D1F3C]/60" style={{ height: percent(1 - shown.bottom) }} />
            <div className="pointer-events-none absolute left-0 bg-[#0D1F3C]/60" style={{ top: percent(shown.top), height: percent(shown.bottom - shown.top), width: percent(shown.left) }} />
            <div className="pointer-events-none absolute right-0 bg-[#0D1F3C]/60" style={{ top: percent(shown.top), height: percent(shown.bottom - shown.top), width: percent(1 - shown.right) }} />
            <div
              data-testid="crop-selection"
              className="pointer-events-none absolute border-2 border-[#19C3A6]"
              style={{ left: percent(shown.left), top: percent(shown.top), width: percent(shown.right - shown.left), height: percent(shown.bottom - shown.top) }}
            />
          </>
        ) : null}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-xs font-semibold text-os-subtle" htmlFor={`${id}-top`}>
          Cortar desde arriba
          <input
            id={`${id}-top`}
            type="range"
            min={0}
            max={95}
            step={1}
            disabled={disabled}
            value={Math.round(rect.top * 100)}
            className="h-11 w-full accent-[#0B7A6E]"
            onChange={(event) => onChange(withEdge(rect, 'top', Number(event.target.value) / 100))}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-semibold text-os-subtle" htmlFor={`${id}-bottom`}>
          Cortar desde abajo
          <input
            id={`${id}-bottom`}
            type="range"
            min={0}
            max={95}
            step={1}
            disabled={disabled}
            value={Math.round((1 - rect.bottom) * 100)}
            className="h-11 w-full accent-[#0B7A6E]"
            onChange={(event) => onChange(withEdge(rect, 'bottom', 1 - Number(event.target.value) / 100))}
          />
        </label>
      </div>
    </div>
  )
}
