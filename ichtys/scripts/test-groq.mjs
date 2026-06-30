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
    const k = t.slice(0, i).trim()
    let v = t.slice(i + 1).trim()
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1)
    }
    out[k] = v
  }
  return out
}

const env = loadEnv(envPath)
const key = env.GROQ_API_KEY?.trim()

if (!key) {
  console.log('RESULT: GROQ_API_KEY no está en apps/web/.env.local')
  console.log('Obtené una key gratis en https://console.groq.com/keys')
  process.exit(2)
}

console.log(`RESULT: GROQ_API_KEY presente (longitud ${key.length})`)
console.log('Probando llama-3.3-70b-versatile...')

const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    model: 'llama-3.3-70b-versatile',
    messages: [{ role: 'user', content: 'Responde únicamente la palabra OK' }],
    max_tokens: 16,
    temperature: 0,
  }),
})

const body = await res.text()
if (!res.ok) {
  console.log(`RESULT: HTTP ${res.status}`)
  console.log(body.slice(0, 800))
  process.exit(1)
}

const json = JSON.parse(body)
const text = json.choices?.[0]?.message?.content?.trim() ?? '(sin contenido)'
console.log('RESULT: OK — Groq respondió:', text)
console.log('Modelo usado:', json.model ?? 'n/a')
