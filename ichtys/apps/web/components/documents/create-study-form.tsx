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
        setError('No se pudo crear el estudio. Intentá de nuevo.')
        return
      }
      const study = (await res.json()) as { id: string }
      router.push(`/studies/${study.id}/documents`)
      router.refresh()
    } catch {
      setError('Error de red. Revisá tu conexión.')
    } finally {
      setLoading(false)
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
      >
        + Nuevo estudio
      </button>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3 rounded-lg border border-gray-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-gray-800">Nuevo estudio</h2>

      <div className="space-y-1">
        <label htmlFor="study-name" className="text-xs font-medium text-gray-600">
          Nombre *
        </label>
        <input
          id="study-name"
          type="text"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Ej: Estudio de tirzepatida fase 3"
          className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      <div className="space-y-1">
        <label htmlFor="protocol-number" className="text-xs font-medium text-gray-600">
          Número de protocolo (opcional)
        </label>
        <input
          id="protocol-number"
          type="text"
          value={protocolNumber}
          onChange={(e) => setProtocolNumber(e.target.value)}
          placeholder="Ej: J1I-MC-GZBP"
          className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {error && <p className="text-xs text-red-600">{error}</p>}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={loading || !name.trim()}
          className="rounded-md bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-40"
        >
          {loading ? 'Creando...' : 'Crear y subir documentos'}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-md border border-gray-300 px-4 py-1.5 text-sm text-gray-600 hover:bg-gray-50"
        >
          Cancelar
        </button>
      </div>
    </form>
  )
}
