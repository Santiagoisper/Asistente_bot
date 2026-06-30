'use client'

import { useEffect, useState } from 'react'

type LlmProvider = 'anthropic' | 'google' | 'auto'

type SettingsPayload = {
  llmProvider: LlmProvider
  providers: { anthropic: boolean; google: boolean }
  envDefaultProvider: LlmProvider
}

const PROVIDER_OPTIONS: { value: LlmProvider; label: string; description: string }[] = [
  {
    value: 'auto',
    label: 'Automático (recomendado)',
    description: 'Usa Claude por defecto. Si la cuota de Anthropic se agota, cambia a Gemini automáticamente.',
  },
  {
    value: 'anthropic',
    label: 'Claude (Anthropic)',
    description: 'Siempre Anthropic. Falla si no hay cuota o API key.',
  },
  {
    value: 'google',
    label: 'Gemini (Google)',
    description: 'Siempre Google Gemini. Útil mientras Claude está sin tokens.',
  },
]

export function OrgLlmSettingsForm({ canEdit = true }: { canEdit?: boolean }) {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [settings, setSettings] = useState<SettingsPayload | null>(null)
  const [selected, setSelected] = useState<LlmProvider>('auto')
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch('/api/org/settings')
        if (!res.ok) {
          setError('No se pudo cargar la configuración.')
          return
        }
        const data = (await res.json()) as SettingsPayload
        setSettings(data)
        setSelected(data.llmProvider)
      } catch {
        setError('Error de red al cargar ajustes.')
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  async function handleSave(): Promise<void> {
    setSaving(true)
    setMessage(null)
    setError(null)
    try {
      const res = await fetch('/api/org/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ llmProvider: selected }),
      })
      const payload = (await res.json()) as { error?: string; llmProvider?: LlmProvider }
      if (!res.ok) {
        setError(payload.error ?? 'No se pudo guardar.')
        return
      }
      setMessage('Configuración guardada.')
      if (payload.llmProvider) setSelected(payload.llmProvider)
    } catch {
      setError('Error de red al guardar.')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <p className="text-sm text-alphi-muted">Cargando ajustes…</p>
  }

  if (error && !settings) {
    return <p className="text-sm text-red-600">{error}</p>
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-alphi-border bg-white p-4">
        <h2 className="text-sm font-semibold text-alphi-navy">Proveedor de IA (LLM)</h2>
        <p className="mt-1 text-xs text-alphi-muted">
          Afecta el chat y la extracción de specs. Las embeddings siguen usando OpenAI.
        </p>

        <div className="mt-4 space-y-3">
          {PROVIDER_OPTIONS.map((opt) => (
            <label
              key={opt.value}
              className={`flex cursor-pointer gap-3 rounded-lg border p-3 transition-colors ${
                selected === opt.value
                  ? 'border-alphi-teal bg-alphi-teal/5'
                  : 'border-alphi-border hover:border-alphi-teal/40'
              }`}
            >
              <input
                type="radio"
                name="llmProvider"
                value={opt.value}
                checked={selected === opt.value}
                onChange={() => setSelected(opt.value)}
                className="mt-1"
              />
              <span>
                <span className="block text-sm font-medium text-alphi-navy">{opt.label}</span>
                <span className="block text-xs text-alphi-muted">{opt.description}</span>
              </span>
            </label>
          ))}
        </div>

        {settings && (
          <div className="mt-4 rounded-md bg-alphi-slate px-3 py-2 text-xs text-alphi-muted">
            <p>
              Claude: {settings.providers.anthropic ? 'API key configurada' : 'sin API key en servidor'}
            </p>
            <p>
              Gemini: {settings.providers.google ? 'API key configurada' : 'sin API key en servidor'}
            </p>
            <p className="mt-1">Default global del servidor: {settings.envDefaultProvider}</p>
          </div>
        )}

        <button
          type="button"
          className="alphi-btn-primary mt-4 text-sm"
          disabled={saving || !canEdit}
          onClick={() => void handleSave()}
        >
          {saving ? 'Guardando…' : 'Guardar proveedor'}
        </button>

        {message && <p className="mt-2 text-xs text-alphi-teal">{message}</p>}
        {error && settings && <p className="mt-2 text-xs text-red-600">{error}</p>}
      </div>
    </div>
  )
}
