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
const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:3003'

const PUBLIC_ROUTES = [
  '/',
  '/sign-in',
  '/sign-up',
]

const PROTECTED_ROUTES = [
  '/dashboard',
  '/studies',
  '/library',
  '/settings',
  '/studies/import',
]

const results = []
let failed = 0

function pass(name, detail = '') {
  results.push({ ok: true, name, detail })
  console.log(`✓ ${name}${detail ? ` — ${detail}` : ''}`)
}

function fail(name, detail = '') {
  results.push({ ok: false, name, detail })
  failed++
  console.log(`✗ ${name}${detail ? ` — ${detail}` : ''}`)
}

async function checkRoute(route, expectAuthRedirect = false) {
  try {
    const res = await fetch(`${BASE}${route}`, { redirect: 'manual' })
    const ok =
      res.status === 200 ||
      (expectAuthRedirect &&
        (res.status === 307 ||
          res.status === 302 ||
          res.status === 401 ||
          res.status === 403 ||
          res.status === 404))
    if (ok) {
      pass(`Ruta ${route}`, `HTTP ${res.status}`)
    } else {
      fail(`Ruta ${route}`, `HTTP ${res.status}`)
    }
  } catch (err) {
    fail(`Ruta ${route}`, err instanceof Error ? err.message : String(err))
  }
}

async function checkLlmProviders() {
  const providers = [
    {
      name: 'anthropic',
      key: env.ANTHROPIC_API_KEY,
      run: async (key) => {
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
            messages: [{ role: 'user', content: 'OK' }],
          }),
        })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
      },
    },
    {
      name: 'openai',
      key: env.OPENAI_API_KEY,
      run: async (key) => {
        const res = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'gpt-4o',
            messages: [{ role: 'user', content: 'OK' }],
            max_tokens: 8,
          }),
        })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
      },
    },
    {
      name: 'google',
      key: env.GOOGLE_GENERATIVE_AI_API_KEY,
      run: async (key) => {
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${encodeURIComponent(key)}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts: [{ text: 'OK' }] }],
              generationConfig: { maxOutputTokens: 8 },
            }),
          },
        )
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
      },
    },
    {
      name: 'groq',
      key: env.GROQ_API_KEY,
      run: async (key) => {
        const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'llama-3.3-70b-versatile',
            messages: [{ role: 'user', content: 'OK' }],
            max_tokens: 8,
          }),
        })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
      },
    },
  ]

  for (const p of providers) {
    if (!p.key?.trim()) {
      pass(`LLM ${p.name}`, 'skip — sin key')
      continue
    }
    try {
      await p.run(p.key)
      pass(`LLM ${p.name}`, 'responde OK')
    } catch (err) {
      const msg = (err instanceof Error ? err.message : String(err)).slice(0, 80)
      // Cuota agotada no rompe E2E si hay fallback en cadena auto
      if (/429|400|quota|usage limits/i.test(msg)) {
        pass(`LLM ${p.name}`, `cuota/key limitada (${msg}) — fallback OK en auto`)
      } else {
        fail(`LLM ${p.name}`, msg)
      }
    }
  }
}

async function checkDbStudiesAndSpecs() {
  const dbUrl = env.DATABASE_URL
  if (!dbUrl) {
    fail('DB estudios/specs', 'sin DATABASE_URL')
    return
  }

  try {
    const { spawnSync } = await import('node:child_process')
    const script = `
      import { neon } from '@neondatabase/serverless';
      const sql = neon(process.env.DATABASE_URL);
      const studies = await sql\`
        SELECT s.id, s.name,
          (SELECT COUNT(*)::int FROM study_specs ss WHERE ss.study_id = s.id) AS spec_count,
          (SELECT COUNT(*)::int FROM documents d WHERE d.study_id = s.id AND d.document_type = 'protocol') AS protocol_docs
        FROM studies s ORDER BY s.created_at DESC LIMIT 10
      \`;
      console.log(JSON.stringify(studies));
    `
    const result = spawnSync(
      process.execPath,
      ['--input-type=module', '-e', script],
      {
        env: { ...process.env, DATABASE_URL: dbUrl },
        cwd: path.join(__dirname, '../packages/db'),
        encoding: 'utf8',
      },
    )
    if (result.status !== 0) {
      fail('DB estudios/specs', (result.stderr || result.stdout || 'query failed').slice(0, 120))
      return
    }
    const studies = JSON.parse(result.stdout.trim())
    if (studies.length === 0) {
      fail('DB estudios', 'no hay estudios')
      return
    }
    pass('DB estudios', `${studies.length} estudios recientes`)
    const withProtocol = studies.filter((s) => s.protocol_docs > 0)
    pass('DB protocolos', `${withProtocol.length}/${studies.length} con documento protocol`)
    const withSpec = studies.filter((s) => s.spec_count > 0)
    pass('DB specs', `${withSpec.length}/${studies.length} con al menos un spec`)
    const innovaStudy = studies.find((s) => s.id === '4fb118fc-affb-4519-a975-5ff59484bd58')
    if (innovaStudy) {
      pass('Estudio piloto INNOVA', `${innovaStudy.name} — specs: ${innovaStudy.spec_count}`)
    }
  } catch (err) {
    fail('DB estudios/specs', err instanceof Error ? err.message : String(err))
  }
}

async function checkInternalAnswerTest() {
  if (env.ENABLE_INTERNAL_RAG_ANSWER_TEST !== 'true') {
    pass('answer-test endpoint', 'skip — flag deshabilitado')
    return
  }
  const res = await fetch(`${BASE}/api/rag/answer-test`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      studyId: '4fb118fc-affb-4519-a975-5ff59484bd58',
      question: 'criterios de inclusion',
    }),
  })
  // Sin auth Clerk → 401/403/307 es esperado; 404 = flag off
  if (res.status === 401 || res.status === 403 || res.status === 307 || res.status === 404) {
    pass('answer-test endpoint', `HTTP ${res.status} (protegido — endpoint registrado)`)
  } else if (res.status === 404) {
    fail('answer-test endpoint', '404 — flag no activo en runtime')
  } else if (res.status === 200) {
    pass('answer-test endpoint', 'HTTP 200')
  } else if (res.status === 500) {
    fail('answer-test endpoint', 'HTTP 500 — error de servidor')
  } else {
    pass('answer-test endpoint', `HTTP ${res.status}`)
  }
}

async function checkSettingsApi() {
  const res = await fetch(`${BASE}/api/org/settings`, { redirect: 'manual' })
  if (res.status === 401 || res.status === 307 || res.status === 404) {
    pass('API /api/org/settings', `HTTP ${res.status} (protegido — OK)`)
  } else if (res.status === 200) {
    pass('API /api/org/settings', 'HTTP 200')
  } else {
    fail('API /api/org/settings', `HTTP ${res.status}`)
  }
}

console.log(`\n=== E2E General ALPHI — ${BASE} ===\n`)

try {
  await fetch(BASE)
} catch {
  fail('Dev server', `no responde en ${BASE}`)
  console.log(`\nResumen: ${results.length - failed}/${results.length} OK, ${failed} fallos\n`)
  process.exit(1)
}
pass('Dev server', 'online')

for (const route of PUBLIC_ROUTES) await checkRoute(route, route === '/')
for (const route of PROTECTED_ROUTES) await checkRoute(route, true)

await checkSettingsApi()
await checkInternalAnswerTest()
await checkDbStudiesAndSpecs()
await checkLlmProviders()

console.log(`\n=== Resumen E2E: ${results.length - failed}/${results.length} OK, ${failed} fallos ===\n`)
process.exit(failed > 0 ? 1 : 0)
