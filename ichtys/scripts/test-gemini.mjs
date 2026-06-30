import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const envPath = path.join(__dirname, '../apps/web/.env.local')
const env = {}
for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
  const t = line.trim()
  if (!t || t.startsWith('#')) continue
  const i = t.indexOf('=')
  if (i === -1) continue
  env[t.slice(0, i).trim()] = t.slice(i + 1).trim()
}

const key = env.GOOGLE_GENERATIVE_AI_API_KEY
if (!key) {
  console.log('Sin GOOGLE_GENERATIVE_AI_API_KEY')
  process.exit(2)
}

console.log('Key length:', key.length, '| prefix:', key.slice(0, 6) + '...')

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
console.log('HTTP', res.status)
console.log(body.slice(0, 500))
