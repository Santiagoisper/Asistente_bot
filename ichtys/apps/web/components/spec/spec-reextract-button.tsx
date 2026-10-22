'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

export function SpecReextractButton({ studyId }: { studyId: string }) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [isError, setIsError] = useState(false)

  async function handleClick(): Promise<void> {
    if (loading) return
    setLoading(true)
    setMessage(null)
    setIsError(false)
    try {
      const res = await fetch(`/api/studies/${encodeURIComponent(studyId)}/spec/reextract`, {
        method: 'POST',
      })
      const payload = (await res.json()) as {
        message?: string
        error?: string
        richness?: number
        status?: string
      }
      if (!res.ok) {
        setIsError(true)
        setMessage(payload.error ?? 'No se pudo completar la re-extracción.')
        return
      }
      setMessage(
        payload.message ??
          `Re-extracción completada (${payload.richness ?? '?'} ítems).`,
      )
      router.refresh()
    } catch {
      setIsError(true)
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
        {loading ? 'Reintentando (2–5 min)…' : 'Reintentar extracción'}
      </button>
      {message && (
        <p className={['mt-2 text-xs', isError ? 'text-alphi-rose' : 'text-alphi-muted'].join(' ')}>
          {message}
        </p>
      )}
    </div>
  )
}
