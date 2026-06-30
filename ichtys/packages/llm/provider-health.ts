import type { OrgLlmApiKeys } from './keys'
import type { LlmProviderId } from './types'
import { createLanguageModel, getModelId } from './provider'

export type ProviderHealthStatus = 'ok' | 'quota_exceeded' | 'invalid_key' | 'error' | 'not_configured'

export interface ProviderHealthResult {
  provider: LlmProviderId
  status: ProviderHealthStatus
  message: string | null
  modelId: string | null
}

function classifyError(err: unknown): { status: ProviderHealthStatus; message: string } {
  const msg = err instanceof Error ? err.message : String(err)
  if (/quota|usage limits|rate limit|resource_exhausted|insufficient_quota|billing/i.test(msg)) {
    return { status: 'quota_exceeded', message: msg.slice(0, 180) }
  }
  if (/invalid.*key|authentication|401|403|unauthorized|api key not valid/i.test(msg)) {
    return { status: 'invalid_key', message: msg.slice(0, 180) }
  }
  return { status: 'error', message: msg.slice(0, 180) }
}

async function probeAnthropic(apiKey: string, modelId: string): Promise<void> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: modelId,
      max_tokens: 8,
      messages: [{ role: 'user', content: 'ping' }],
    }),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 160)}`)
}

async function probeOpenAI(apiKey: string, modelId: string): Promise<void> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: modelId,
      messages: [{ role: 'user', content: 'ping' }],
      max_tokens: 8,
    }),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 160)}`)
}

async function probeGoogle(apiKey: string, modelId: string): Promise<void> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: 'ping' }] }],
        generationConfig: { maxOutputTokens: 8 },
      }),
    },
  )
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 160)}`)
}

async function probeGroq(apiKey: string, modelId: string): Promise<void> {
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: modelId,
      messages: [{ role: 'user', content: 'ping' }],
      max_tokens: 8,
    }),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 160)}`)
}

async function probeGlm(apiKey: string, modelId: string): Promise<void> {
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': process.env.NEXT_PUBLIC_APP_URL ?? 'https://asistente-bot-five.vercel.app',
      'X-Title': 'ALPHI',
    },
    body: JSON.stringify({
      model: modelId,
      messages: [{ role: 'user', content: 'ping' }],
      max_tokens: 8,
    }),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 160)}`)
}

export async function checkProviderHealth(
  provider: LlmProviderId,
  orgKeys?: OrgLlmApiKeys | null,
): Promise<ProviderHealthResult> {
  const modelId = getModelId(provider, 'answer')
  const model = createLanguageModel(provider, 'answer', orgKeys)
  void model

  const { resolveKeyForProvider } = await import('./keys')
  const apiKey = resolveKeyForProvider(provider, orgKeys)
  if (!apiKey) {
    return { provider, status: 'not_configured', message: null, modelId: null }
  }

  try {
    switch (provider) {
      case 'anthropic':
        await probeAnthropic(apiKey, modelId)
        break
      case 'openai':
        await probeOpenAI(apiKey, modelId)
        break
      case 'google':
        await probeGoogle(apiKey, modelId)
        break
      case 'groq':
        await probeGroq(apiKey, modelId)
        break
      case 'glm':
        await probeGlm(apiKey, modelId)
        break
    }
    return { provider, status: 'ok', message: null, modelId }
  } catch (err) {
    const { status, message } = classifyError(err)
    return { provider, status, message, modelId }
  }
}

export interface OpenAiUsageSummary {
  available: boolean
  monthToDateUsd: number | null
  periodLabel: string
  message: string | null
}

/** Gasto aproximado del mes (OpenAI). No expone saldo restante — ver billing dashboard. */
export async function fetchOpenAiUsageSummary(apiKey: string): Promise<OpenAiUsageSummary> {
  const now = new Date()
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  const startTime = Math.floor(start.getTime() / 1000)
  const endTime = Math.floor(now.getTime() / 1000)

  try {
    const res = await fetch(
      `https://api.openai.com/v1/organization/costs?start_time=${startTime}&end_time=${endTime}`,
      { headers: { Authorization: `Bearer ${apiKey}` } },
    )
    const body = await res.text()
    if (!res.ok) {
      return {
        available: false,
        monthToDateUsd: null,
        periodLabel: 'mes actual',
        message: `No se pudo leer uso (${res.status}). Revisá billing en OpenAI.`,
      }
    }
    const json = JSON.parse(body) as {
      data?: Array<{ results?: Array<{ amount?: { value?: number } }> }>
    }
    let total = 0
    for (const bucket of json.data ?? []) {
      for (const row of bucket.results ?? []) {
        total += row.amount?.value ?? 0
      }
    }
    return {
      available: true,
      monthToDateUsd: total,
      periodLabel: 'mes actual (UTC)',
      message: null,
    }
  } catch (err) {
    return {
      available: false,
      monthToDateUsd: null,
      periodLabel: 'mes actual',
      message: err instanceof Error ? err.message.slice(0, 120) : 'Error al consultar uso',
    }
  }
}

export async function checkAllProviderHealth(
  orgKeys?: OrgLlmApiKeys | null,
): Promise<ProviderHealthResult[]> {
  const providers: LlmProviderId[] = ['anthropic', 'openai', 'google', 'groq', 'glm']
  const results: ProviderHealthResult[] = []
  for (const provider of providers) {
    results.push(await checkProviderHealth(provider, orgKeys))
  }
  return results
}
