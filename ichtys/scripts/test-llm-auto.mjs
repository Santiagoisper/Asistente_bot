import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const envPath = path.join(__dirname, '../apps/web/.env.local')

function loadEnv(file) {
  const out = {}
  if (!fs.existsSync(file)) return out
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const i = t.indexOf('=')
    if (i === -1) continue
    out[t.slice(0, i).trim()] = t.slice(i + 1).trim()
  }
  return out
}

const env = loadEnv(envPath)

async function tryAnthropic() {
  const key = env.ANTHROPIC_API_KEY
  if (!key) return 'skip'
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-5',
      max_tokens: 8,
      messages: [{ role: 'user', content: 'Responde solo: OK' }],
    }),
  })
  const body = await res.text()
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${body.slice(0, 120)}`)
  return JSON.parse(body).content?.[0]?.text?.trim() ?? 'OK'
}

async function tryOpenAI() {
  const key = env.OPENAI_API_KEY
  if (!key) return 'skip'
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'Responde solo: OK' }],
      max_tokens: 8,
    }),
  })
  const body = await res.text()
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${body.slice(0, 120)}`)
  return JSON.parse(body).choices?.[0]?.message?.content?.trim() ?? 'OK'
}

async function tryGemini() {
  const key = env.GOOGLE_GENERATIVE_AI_API_KEY
  if (!key) return 'skip'
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${encodeURIComponent(key)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: 'Responde solo: OK' }] }],
        generationConfig: { maxOutputTokens: 8 },
      }),
    },
  )
  const body = await res.text()
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${body.slice(0, 120)}`)
  return JSON.parse(body).candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? 'OK'
}

async function tryGroq() {
  const key = env.GROQ_API_KEY
  if (!key) return 'skip'
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'user', content: 'Responde solo: OK' }],
      max_tokens: 8,
    }),
  })
  const body = await res.text()
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${body.slice(0, 120)}`)
  return JSON.parse(body).choices?.[0]?.message?.content?.trim() ?? 'OK'
}

const steps = [
  ['anthropic (claude-sonnet-4-5)', tryAnthropic],
  ['openai (gpt-4o)', tryOpenAI],
  ['google (gemini-2.0-flash)', tryGemini],
  ['groq (llama-3.3-70b)', tryGroq],
]

console.log('Cadena auto: Claude → OpenAI → Gemini → Groq\n')
let winner = null
for (const [label, fn] of steps) {
  try {
    const out = await fn()
    if (out === 'skip') {
      console.log(`[${label}] skip — sin key`)
      continue
    }
    console.log(`[${label}] OK → ${out}`)
    winner = label
    break
  } catch (err) {
    console.log(`[${label}] FAIL → ${(err instanceof Error ? err.message : String(err)).slice(0, 140)}`)
  }
}

if (winner) {
  console.log(`\nPrimer proveedor usable: ${winner}`)
} else {
  console.log('\nNingún proveedor respondió.')
  process.exit(1)
}
