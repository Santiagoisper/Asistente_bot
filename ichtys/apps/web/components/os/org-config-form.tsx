'use client'

import { useRouter } from 'next/navigation'
import { useId, useState } from 'react'
import type { OsModule } from '@ichtys/integrations'
import { orgConfigError } from '../../lib/os/org-config-messages'

const focusRing = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-os-accent'
const fieldClass = `min-h-11 w-full rounded-lg border border-alphi-border bg-white px-3 text-sm text-os-ink disabled:bg-os-ground ${focusRing}`
const buttonClass = `inline-flex min-h-11 items-center rounded-lg bg-os-accent px-5 text-sm font-semibold text-white hover:bg-os-accentdim disabled:opacity-50 ${focusRing}`

const ZONES = ['America/Argentina/Buenos_Aires', 'America/Bogota', 'America/Lima', 'America/Mexico_City', 'America/Santiago', 'America/Sao_Paulo', 'America/New_York', 'Europe/Madrid']

interface Note {
  text: string
  failed: boolean
}

async function save(body: Record<string, unknown>): Promise<Note> {
  try {
    const response = await fetch('/api/os/org-config', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    if (response.ok) return { text: 'Guardado.', failed: false }
    const payload: unknown = await response.json().catch(() => null)
    return { text: orgConfigError(response.status, typeof payload === 'object' && payload !== null ? (payload as { error?: unknown }).error : null), failed: true }
  } catch {
    return { text: 'No se pudo guardar. Revisá la conexión y probá de nuevo.', failed: true }
  }
}

function NoteLine({ note }: { note: Note | null }) {
  return (
    <p aria-live="polite" className={`min-h-5 text-sm ${note?.failed ? 'font-semibold text-[#8C1D3A]' : 'text-os-accentdim'}`}>
      {note?.text ?? ''}
    </p>
  )
}

function ModuleRow({ module, title, baseUrl, enabled }: { module: OsModule; title: string; baseUrl: string; enabled: boolean }) {
  const router = useRouter()
  const id = useId()
  const [url, setUrl] = useState(baseUrl)
  const [on, setOn] = useState(enabled)
  const [saving, setSaving] = useState(false)
  const [note, setNote] = useState<Note | null>(null)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setSaving(true)
    setNote(null)
    const result = await save({ kind: 'module', module, baseUrl: url, enabled: on })
    setNote(result)
    setSaving(false)
    if (!result.failed) router.refresh()
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-2 py-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex min-w-0 flex-1 flex-col gap-1.5 text-sm font-semibold text-os-ink" htmlFor={`${id}-url`}>
          {title} — dirección del sistema
          <input id={`${id}-url`} className={fieldClass} type="url" inputMode="url" maxLength={300} placeholder="https://" autoComplete="off" value={url} onChange={(event) => setUrl(event.target.value)} />
        </label>
        <label className="flex min-h-11 items-center gap-2 text-sm font-semibold text-os-ink" htmlFor={`${id}-on`}>
          <input id={`${id}-on`} type="checkbox" className="h-5 w-5" checked={on} onChange={(event) => setOn(event.target.checked)} />
          Encendido
        </label>
        <button type="submit" disabled={saving} className={buttonClass}>
          {saving ? 'Guardando…' : 'Guardar'}
        </button>
      </div>
      <NoteLine note={note} />
    </form>
  )
}

function TimeZoneRow({ timeZone, effective }: { timeZone: string; effective: string }) {
  const router = useRouter()
  const id = useId()
  const [zone, setZone] = useState(timeZone)
  const [saving, setSaving] = useState(false)
  const [note, setNote] = useState<Note | null>(null)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setSaving(true)
    setNote(null)
    const result = await save({ kind: 'time_zone', timeZone: zone })
    setNote(result)
    setSaving(false)
    if (!result.failed) router.refresh()
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-2 py-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex min-w-0 flex-1 flex-col gap-1.5 text-sm font-semibold text-os-ink" htmlFor={`${id}-zone`}>
          Zona horaria del centro
          <input id={`${id}-zone`} className={fieldClass} list={`${id}-zones`} maxLength={64} placeholder={effective} autoComplete="off" value={zone} onChange={(event) => setZone(event.target.value)} />
          <datalist id={`${id}-zones`}>
            {ZONES.map((option) => (
              <option key={option} value={option} />
            ))}
          </datalist>
        </label>
        <button type="submit" disabled={saving} className={buttonClass}>
          {saving ? 'Guardando…' : 'Guardar'}
        </button>
      </div>
      <p className="text-sm text-os-subtle">
        {timeZone ? `La Agenda de este centro usa ${effective}.` : `Sin zona propia: la Agenda usa la de la instalación (${effective}).`} Dejala vacía para volver a la de la instalación.
      </p>
      <NoteLine note={note} />
    </form>
  )
}

/** Lo que un administrador puede configurar de su centro: módulos conectados y zona horaria. */
export function OrgConfigForm({
  modules,
  timeZone,
  effectiveTimeZone,
}: {
  modules: Array<{ module: OsModule; title: string; baseUrl: string; enabled: boolean }>
  timeZone: string
  effectiveTimeZone: string
}) {
  return (
    <div className="divide-y divide-alphi-border px-5">
      {modules.map((entry) => (
        <ModuleRow key={entry.module} {...entry} />
      ))}
      <TimeZoneRow timeZone={timeZone} effective={effectiveTimeZone} />
    </div>
  )
}
