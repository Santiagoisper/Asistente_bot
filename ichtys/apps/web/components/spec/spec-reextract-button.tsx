'use client'

import { useState } from 'react'

export function SpecReextractButton({ studyId }: { studyId: string }) {
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  async function handleClick(): Promise<void> {
    setLoading(true)
    setMessage(null)
    try {
      const res = await fetch(`/api/studies/${encodeURIComponent(studyId)}/spec/reextract`, {
        method: 'POST',
      })
      const payload = (await res.json()) as {
        message?: string
        error?: string
        richness?: number
      }
      if (!res.ok) {
        setMessage(payload.error ?? 'No se pudo completar la re-extracción.')
        return
      }
      setMessage(
        payload.message ??
          `Re-extracción completada (${payload.richness ?? '?'} ítems). Actualizá la página.`,
      )
    } catch {
      setMessage('Error de red al iniciar la re-extracción.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div>
      <button
        type="button"
        className="alphi-btn-secondary text-sm"
        disabled={loading}
        onClick={() => void handleClick()}
      >
        {loading ? 'Extrayendo (2–5 min)…' : 'Re-extraer spec completo'}
      </button>
      {message && <p className="mt-2 text-xs text-alphi-muted">{message}</p>}
    </div>
  )
}
