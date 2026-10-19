'use client'

import { useRouter } from 'next/navigation'
import React, { useState } from 'react'

export function CreateStudyForm() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [protocolNumber, setProtocolNumber] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    setLoading(true)
    setError(null)

    try {
      const res = await fetch('/api/studies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          protocolNumber: protocolNumber.trim() || undefined,
        }),
      })
      if (!res.ok) {
        const detail = res.status === 401
          ? 'Sesión expirada. Volvé a iniciar sesión.'
          : res.status >= 500
            ? 'Error del servidor al crear el estudio. Revisá la consola del servidor.'
            : 'No se pudo crear el estudio. Intentá de nuevo.'
        setError(detail)
        return
      }
      const study = (await res.json()) as { id: string }
      router.push(`/studies/${study.id}/documents`)
      router.refresh()
    } catch (err) {
      console.error('[CreateStudyForm]', err)
      setError('No se pudo conectar con el servidor. ¿Está corriendo pnpm dev?')
    } finally {
      setLoading(false)
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="alphi-btn-primary"
      >
        + Nuevo estudio
      </button>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="alphi-card space-y-3 p-4">
      <h2 className="text-sm font-semibold text-alphi-navy">Nuevo estudio</h2>

      <div className="space-y-1">
        <label htmlFor="study-name" className="alphi-label">
          Nombre *
        </label>
        <input
          id="study-name"
          type="text"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Ej: Estudio de tirzepatida fase 3"
          className="alphi-input w-full"
        />
      </div>

      <div className="space-y-1">
        <label htmlFor="protocol-number" className="alphi-label">
          Número de protocolo (opcional)
        </label>
        <input
          id="protocol-number"
          type="text"
          value={protocolNumber}
          onChange={(e) => setProtocolNumber(e.target.value)}
          placeholder="Ej: J1I-MC-GZBP"
          className="alphi-input w-full"
        />
      </div>

      {error && <p className="text-xs font-medium text-alphi-rose">{error}</p>}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={loading || !name.trim()}
          className="alphi-btn-primary disabled:opacity-50"
        >
          {loading ? 'Creando...' : 'Crear y subir documentos'}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="alphi-btn-secondary"
        >
          Cancelar
        </button>
      </div>
    </form>
  )
}
