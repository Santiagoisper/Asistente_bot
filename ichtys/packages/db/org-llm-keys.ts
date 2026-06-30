import { eq } from 'drizzle-orm'
import { db } from './client'
import { decryptJson, encryptJson } from './org-llm-crypto'
import { organizations } from './schema/organizations'

export type OrgLlmKeyProvider = 'anthropic' | 'openai' | 'google' | 'groq' | 'openrouter'

export type OrgLlmApiKeys = Partial<Record<OrgLlmKeyProvider, string>>

export type OrgLlmKeySource = 'org' | 'platform' | 'none'

export interface OrgLlmKeyStatus {
  provider: OrgLlmKeyProvider
  configured: boolean
  source: OrgLlmKeySource
  hint: string | null
}

const ENV_MAP: Record<OrgLlmKeyProvider, string> = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  google: 'GOOGLE_GENERATIVE_AI_API_KEY',
  groq: 'GROQ_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
}

export function maskApiKey(key: string): string {
  const trimmed = key.trim()
  if (trimmed.length <= 8) return '••••••••'
  return `••••${trimmed.slice(-4)}`
}

function envKey(provider: OrgLlmKeyProvider): string | undefined {
  if (provider === 'google') {
    return (
      process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim() ||
      process.env.GOOGLE_API_KEY?.trim() ||
      undefined
    )
  }
  const name = ENV_MAP[provider]
  return name ? process.env[name]?.trim() || undefined : undefined
}

export function resolveLlmApiKey(
  provider: OrgLlmKeyProvider,
  orgKeys?: OrgLlmApiKeys | null,
): string | undefined {
  const orgKey = orgKeys?.[provider]?.trim()
  if (orgKey) return orgKey
  return envKey(provider)
}

export function getOrgLlmKeySource(
  provider: OrgLlmKeyProvider,
  orgKeys?: OrgLlmApiKeys | null,
): OrgLlmKeySource {
  if (orgKeys?.[provider]?.trim()) return 'org'
  if (envKey(provider)) return 'platform'
  return 'none'
}

export function buildOrgLlmKeyStatuses(orgKeys?: OrgLlmApiKeys | null): OrgLlmKeyStatus[] {
  const providers: OrgLlmKeyProvider[] = ['anthropic', 'openai', 'google', 'groq', 'openrouter']
  return providers.map((provider) => {
    const source = getOrgLlmKeySource(provider, orgKeys)
    const key = resolveLlmApiKey(provider, orgKeys)
    return {
      provider,
      configured: Boolean(key),
      source,
      hint: key ? maskApiKey(key) : null,
    }
  })
}

export async function getOrgLlmApiKeys(orgId: string): Promise<OrgLlmApiKeys> {
  const rows = await db
    .select({ encrypted: organizations.llmApiKeysEncrypted })
    .from(organizations)
    .where(eq(organizations.id, orgId))
    .limit(1)

  const encrypted = rows[0]?.encrypted
  if (!encrypted) return {}

  try {
    return decryptJson<OrgLlmApiKeys>(encrypted)
  } catch {
    console.error(`[org-llm-keys] Failed to decrypt keys for org ${orgId}`)
    return {}
  }
}

export async function updateOrgLlmApiKeys(
  orgId: string,
  patch: Partial<Record<OrgLlmKeyProvider, string | null>>,
): Promise<OrgLlmApiKeys> {
  const current = await getOrgLlmApiKeys(orgId)
  const next: OrgLlmApiKeys = { ...current }

  for (const [rawProvider, value] of Object.entries(patch)) {
    const provider = rawProvider as OrgLlmKeyProvider
    if (value === null || value === '') {
      delete next[provider]
      continue
    }
    const trimmed = value.trim()
    if (trimmed.length < 8) {
      throw new Error(`Invalid API key for ${provider}`)
    }
    next[provider] = trimmed
  }

  const encrypted = Object.keys(next).length > 0 ? encryptJson(next) : null

  await db
    .update(organizations)
    .set({ llmApiKeysEncrypted: encrypted, updatedAt: new Date() })
    .where(eq(organizations.id, orgId))

  return next
}
