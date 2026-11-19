'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

export function reextractErrorText(status: number, payload: { message?: string; error?: string } = {}): string {
  // La ruta manda frases para la persona en `message` (cuota) o en `error` (404, 422);
  // los códigos sueltos («quota_exceeded») no se muestran.
  if (payload.message) return payload.message
  if (payload.error && /\s/.test(payload.error)) return payload.error
  if (status === 401) return 'Sesión expirada. Volvé a iniciar sesión.'
  if (status === 403 || status === 404) return 'Tu rol no puede reintentar la extracción en este estudio.'
  if (status === 402) return 'La cuota mensual de IA de tu organización está agotada.'
  if (status === 429) return 'Hiciste muchos pedidos seguidos. Esperá un minuto e intentá de nuevo.'
  return 'No se pudo completar la re-extracción. Intentá de nuevo en unos minutos.'
}

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
      const payload = ((await res.json().catch(() => null)) ?? {}) as {
        message?: string
        error?: string
        richness?: number
        status?: string
      }
      if (!res.ok) {
        // Antes se mostraba el código interno del error, o «Error de red» si la respuesta
        // no era JSON (auditoría 19/11, H-21).
        setIsError(true)
        setMessage(reextractErrorText(res.status, payload))
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
