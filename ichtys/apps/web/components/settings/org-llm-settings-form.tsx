'use client'

import { useEffect, useState } from 'react'

type LlmProvider = 'auto' | 'anthropic' | 'openai' | 'google' | 'groq' | 'glm'

type LlmKeyProvider = 'anthropic' | 'openai' | 'google' | 'groq' | 'openrouter'

type LlmKeyStatus = {
  provider: LlmKeyProvider
  configured: boolean
  source: 'org' | 'platform' | 'none'
  hint: string | null
}

type ProviderHealth = {
  provider: string
  status: 'ok' | 'quota_exceeded' | 'invalid_key' | 'error' | 'not_configured'
  message: string | null
  modelId: string | null
}

type OpenAiUsage = {
  available: boolean
  monthToDateUsd: number | null
  periodLabel: string
  message: string | null
}

type SettingsPayload = {
  llmProvider: LlmProvider
  providers: Record<string, boolean>
  envDefaultProvider: LlmProvider
  autoChain: string[]
  billingUrls: Record<string, string>
  llmKeys: LlmKeyStatus[]
  openAiUsage: OpenAiUsage | null
}

const PROVIDER_OPTIONS: { value: LlmProvider; label: string; description: string }[] = [
  {
    value: 'auto',
    label: 'Automático (recomendado)',
    description:
      'Claude → OpenAI → Gemini → Groq → GLM. Si uno falla, prueba el siguiente.',
  },
  { value: 'anthropic', label: 'Claude (Anthropic)', description: 'Solo Claude Sonnet 4.5.' },
  { value: 'openai', label: 'OpenAI (GPT)', description: 'Solo GPT-4o.' },
  { value: 'google', label: 'Gemini (Google)', description: 'Solo Gemini 2.0 Flash.' },
  { value: 'groq', label: 'Groq (gratis)', description: 'Solo Llama 3.3.' },
  { value: 'glm', label: 'GLM 5.2 (OpenRouter)', description: 'Solo GLM vía OpenRouter.' },
]

const KEY_FIELDS: { id: LlmKeyProvider; label: string; env: string }[] = [
  { id: 'anthropic', label: 'Claude (Anthropic)', env: 'ANTHROPIC_API_KEY' },
  { id: 'openai', label: 'OpenAI', env: 'OPENAI_API_KEY' },
  { id: 'google', label: 'Gemini (Google)', env: 'GOOGLE_GENERATIVE_AI_API_KEY' },
  { id: 'groq', label: 'Groq', env: 'GROQ_API_KEY' },
  { id: 'openrouter', label: 'GLM (OpenRouter)', env: 'OPENROUTER_API_KEY' },
]

const HEALTH_LABELS: Record<ProviderHealth['status'], string> = {
  ok: '✓ Operativo',
  quota_exceeded: '⚠ Sin cuota',
  invalid_key: '✗ Key inválida',
  error: '✗ Error',
  not_configured: '— Sin configurar',
}

export function OrgLlmSettingsForm({ canEdit = true }: { canEdit?: boolean }) {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [settings, setSettings] = useState<SettingsPayload | null>(null)
  const [selected, setSelected] = useState<LlmProvider>('auto')
  const [keyInputs, setKeyInputs] = useState<Partial<Record<LlmKeyProvider, string>>>({})
  const [clearKeys, setClearKeys] = useState<Partial<Record<LlmKeyProvider, boolean>>>({})
  const [health, setHealth] = useState<ProviderHealth[] | null>(null)
  const [openAiUsage, setOpenAiUsage] = useState<OpenAiUsage | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function loadSettings() {
    const res = await fetch('/api/org/settings')
    if (!res.ok) throw new Error('load failed')
    const data = (await res.json()) as SettingsPayload
    setSettings(data)
    setSelected(data.llmProvider)
    setOpenAiUsage(data.openAiUsage)
  }

  useEffect(() => {
    void (async () => {
      try {
        await loadSettings()
      } catch {
        setError('No se pudo cargar la configuración.')
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
      const llmApiKeys: Partial<Record<LlmKeyProvider, string | null>> = {}
      for (const field of KEY_FIELDS) {
        if (clearKeys[field.id]) {
          llmApiKeys[field.id] = null
          continue
        }
        const value = keyInputs[field.id]?.trim()
        if (value) llmApiKeys[field.id] = value
      }

      const res = await fetch('/api/org/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          llmProvider: selected,
          ...(Object.keys(llmApiKeys).length > 0 ? { llmApiKeys } : {}),
        }),
      })
      const payload = (await res.json()) as { error?: string; llmProvider?: LlmProvider }
      if (!res.ok) {
        setError(payload.error ?? 'No se pudo guardar.')
        return
      }
      setMessage('Configuración guardada.')
      setKeyInputs({})
      setClearKeys({})
      await loadSettings()
    } catch {
      setError('Error de red al guardar.')
    } finally {
      setSaving(false)
    }
  }

  async function handleTestProviders(): Promise<void> {
    setTesting(true)
    setError(null)
    try {
      const res = await fetch('/api/org/settings', { method: 'POST' })
      const payload = (await res.json()) as {
        health?: ProviderHealth[]
        openAiUsage?: OpenAiUsage | null
        error?: string
      }
      if (!res.ok) {
        setError(payload.error ?? 'No se pudo probar proveedores.')
        return
      }
      setHealth(payload.health ?? null)
      if (payload.openAiUsage) setOpenAiUsage(payload.openAiUsage)
      setMessage('Prueba de proveedores completada.')
    } catch {
      setError('Error de red al probar proveedores.')
    } finally {
      setTesting(false)
    }
  }

  function keyStatus(id: LlmKeyProvider): LlmKeyStatus | undefined {
    return settings?.llmKeys.find((k) => k.provider === id)
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
          Elegí qué motor usar para chat y specs. Las keys las cargás abajo — no hace falta programar.
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
                disabled={!canEdit}
              />
              <span>
                <span className="block text-sm font-medium text-alphi-navy">{opt.label}</span>
                <span className="block text-xs text-alphi-muted">{opt.description}</span>
              </span>
            </label>
          ))}
        </div>

        {settings && (
          <p className="mt-3 text-xs text-alphi-muted">
            Cadena auto: {settings.autoChain.join(' → ')}
          </p>
        )}
      </div>

      <div className="rounded-lg border border-alphi-border bg-white p-4">
        <h2 className="text-sm font-semibold text-alphi-navy">API keys de tu organización</h2>
        <p className="mt-1 text-xs text-alphi-muted">
          Las keys que guardés acá aplican solo a tu org y tienen prioridad sobre las del servidor.
          Dejá el campo vacío para no cambiar una key existente. Marcá &quot;Quitar&quot; para volver a
          la key de plataforma.
        </p>

        <div className="mt-4 space-y-4">
          {KEY_FIELDS.map((field) => {
            const status = keyStatus(field.id)
            return (
              <div key={field.id} className="space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <label htmlFor={`key-${field.id}`} className="text-sm font-medium text-alphi-navy">
                    {field.label}
                  </label>
                  {status && (
                    <span className="text-[11px] text-alphi-muted">
                      {status.configured
                        ? `${status.hint} (${status.source === 'org' ? 'tu org' : 'plataforma'})`
                        : 'Sin key'}
                    </span>
                  )}
                </div>
                <input
                  id={`key-${field.id}`}
                  type="password"
                  autoComplete="off"
                  disabled={!canEdit || clearKeys[field.id]}
                  placeholder={
                    status?.configured ? 'Nueva key (opcional)' : `Pegá tu ${field.env}`
                  }
                  value={keyInputs[field.id] ?? ''}
                  onChange={(e) =>
                    setKeyInputs((prev) => ({ ...prev, [field.id]: e.target.value }))
                  }
                  className="w-full rounded-md border border-alphi-border px-3 py-2 text-sm"
                />
                {status?.source === 'org' && canEdit && (
                  <label className="flex items-center gap-2 text-xs text-alphi-muted">
                    <input
                      type="checkbox"
                      checked={Boolean(clearKeys[field.id])}
                      onChange={(e) =>
                        setClearKeys((prev) => ({ ...prev, [field.id]: e.target.checked }))
                      }
                    />
                    Quitar key de la org (usar plataforma)
                  </label>
                )}
              </div>
            )
          })}
        </div>
      </div>

      <div className="rounded-lg border border-alphi-border bg-white p-4">
        <h2 className="text-sm font-semibold text-alphi-navy">Estado y uso</h2>
        <p className="mt-1 text-xs text-alphi-muted">
          Ningún proveedor expone el saldo restante de forma confiable vía API. Mostramos gasto
          aproximado de OpenAI (mes actual) y el resultado de la última prueba de conexión.
        </p>

        {openAiUsage && (
          <div className="mt-3 rounded-md bg-alphi-slate px-3 py-2 text-xs">
            <p className="font-medium text-alphi-navy">OpenAI — {openAiUsage.periodLabel}</p>
            {openAiUsage.available && openAiUsage.monthToDateUsd !== null ? (
              <p className="text-alphi-muted">
                Gasto acumulado: <strong>USD {openAiUsage.monthToDateUsd.toFixed(2)}</strong>
              </p>
            ) : (
              <p className="text-alphi-muted">{openAiUsage.message ?? 'Uso no disponible vía API.'}</p>
            )}
            <a
              href={settings?.billingUrls?.openai ?? 'https://platform.openai.com/settings/organization/billing'}
              className="text-alphi-teal underline"
              target="_blank"
              rel="noreferrer"
            >
              Ver billing en OpenAI →
            </a>
          </div>
        )}

        {health && (
          <ul className="mt-3 space-y-1 text-xs text-alphi-muted">
            {health.map((h) => (
              <li key={h.provider}>
                <strong>{h.provider}</strong>: {HEALTH_LABELS[h.status]}
                {h.message ? ` — ${h.message.slice(0, 100)}` : ''}
              </li>
            ))}
          </ul>
        )}

        <button
          type="button"
          className="mt-3 rounded-md border border-alphi-border px-3 py-2 text-sm hover:bg-alphi-slate"
          disabled={testing || !canEdit}
          onClick={() => void handleTestProviders()}
        >
          {testing ? 'Probando…' : 'Probar conexión de proveedores'}
        </button>
      </div>

      <button
        type="button"
        className="alphi-btn-primary text-sm"
        disabled={saving || !canEdit}
        onClick={() => void handleSave()}
      >
        {saving ? 'Guardando…' : 'Guardar configuración'}
      </button>

      {message && <p className="text-xs text-alphi-teal">{message}</p>}
      {error && settings && <p className="text-xs text-red-600">{error}</p>}
    </div>
  )
}
