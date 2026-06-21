/**
 * upload-mock-docs.mjs — sube los 5 PDFs mock al study MOCK-METABOLIC-T2D-v1
 * Sin dependencias externas — usa fetch nativo de Node 18+.
 * Uso: node scripts/upload-mock-docs.mjs
 */
import { readFileSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')

// Load env from apps/web/.env.local
const envContent = readFileSync(join(ROOT, 'apps/web/.env.local'), 'utf8')
function getEnv(key) {
  const line = envContent.split('\n').find(l => l.startsWith(key + '='))
  return line ? line.slice(key.length + 1).trim() : undefined
}

const CLERK_SECRET_KEY = getEnv('CLERK_SECRET_KEY')
const BASE_URL = 'http://localhost:3000'
const STUDY_ID = '508fa9c9-dbb9-49aa-abd5-7f7fe968bbc6'
const USER_ID = 'user_3EmgnPBW1ZSD46DJIjZa4Oiad6e'
const DOCS_DIR = join(ROOT, 'docs/evals/mock-metabolic-documents')

const DOCUMENTS = [
  { file: 'MOCK-METABOLIC-T2D-Protocol.pdf', type: 'protocol', name: 'MOCK Protocol v1.0' },
  { file: 'MOCK-METABOLIC-T2D-Investigator-Brochure.pdf', type: 'investigator_brochure', name: 'MOCK Investigator Brochure v2.0' },
  { file: 'MOCK-METABOLIC-T2D-Lab-Manual.pdf', type: 'lab_manual', name: 'MOCK Lab Manual v1.0' },
  { file: 'MOCK-METABOLIC-T2D-Pharmacy-Manual.pdf', type: 'pharmacy_manual', name: 'MOCK Pharmacy Manual v1.0' },
  { file: 'MOCK-METABOLIC-T2D-Study-Procedures-Manual.pdf', type: 'other', name: 'MOCK Study Procedures Manual v1.0' },
]

async function getSessionToken() {
  // 1. Get active sessions for user
  const sessRes = await fetch(
    `https://api.clerk.com/v1/sessions?user_id=${USER_ID}&limit=5`,
    { headers: { Authorization: `Bearer ${CLERK_SECRET_KEY}` } }
  )
  if (!sessRes.ok) throw new Error(`Sessions API failed: ${sessRes.status} ${await sessRes.text()}`)
  const sessions = await sessRes.json()

  const activeSessions = sessions.filter ? sessions.filter(s => s.status === 'active') : (sessions.data || sessions).filter(s => s.status === 'active')
  if (!activeSessions.length) {
    throw new Error('No active sessions. Log in at http://localhost:3000/sign-in first.')
  }

  const sessionId = activeSessions[0].id
  console.log(`Using session: ${sessionId}`)

  // 2. Create a session token
  const tokenRes = await fetch(
    `https://api.clerk.com/v1/sessions/${sessionId}/tokens`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${CLERK_SECRET_KEY}`,
        'Content-Type': 'application/json',
      },
    }
  )
  if (!tokenRes.ok) throw new Error(`Token API failed: ${tokenRes.status} ${await tokenRes.text()}`)
  const { jwt } = await tokenRes.json()
  return jwt
}

async function uploadDocument(token, doc) {
  const filePath = join(DOCS_DIR, doc.file)
  if (!existsSync(filePath)) {
    console.error(`  File not found: ${filePath}`)
    return null
  }

  const fileBuffer = readFileSync(filePath)
  const blob = new Blob([fileBuffer], { type: 'application/pdf' })

  const form = new FormData()
  form.append('file', blob, doc.file)
  form.append('studyId', STUDY_ID)
  form.append('documentType', doc.type)
  form.append('name', doc.name)

  const res = await fetch(`${BASE_URL}/api/documents/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  })

  if (!res.ok) {
    const text = await res.text()
    console.error(`  Upload failed (${res.status}): ${text}`)
    return null
  }

  const data = await res.json()
  console.log(`  Uploaded → documentVersionId: ${data.documentVersionId}`)
  return data.documentVersionId
}

async function runIngestion(token, documentVersionId) {
  const res = await fetch(`${BASE_URL}/api/ingestion/run`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ documentVersionId }),
  })

  if (!res.ok) {
    const text = await res.text()
    console.error(`  Ingestion failed (${res.status}): ${text}`)
    return
  }

  console.log(`  Ingestion queued ✓`)
}

async function main() {
  console.log('Getting Clerk session token...')
  const token = await getSessionToken()
  console.log('Token obtained.\n')

  const results = []
  for (const doc of DOCUMENTS) {
    console.log(`Uploading: ${doc.file}`)
    const dvId = await uploadDocument(token, doc)
    if (dvId) {
      await runIngestion(token, dvId)
      results.push({ file: doc.file, documentVersionId: dvId })
    }
    console.log('')
  }

  console.log('=== Summary ===')
  for (const r of results) {
    console.log(`  ${r.file}: ${r.documentVersionId}`)
  }
  console.log('\nIngestion started for all documents.')
  console.log('Check status in 1-2 min at Neon SQL Editor:')
  console.log(`  SELECT name, status, error_message FROM document_versions ORDER BY created_at;`)
}

main().catch(e => { console.error(e.message); process.exit(1) })
