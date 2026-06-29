/**
 * bulk-import-protocols.mjs — importa en masa todos los PDFs de un directorio.
 *
 * Crea un estudio por cada protocolo y dispara la ingestión completa
 * (chunks + embeddings + study spec). Útil para onboarding inicial sin UI.
 *
 * Uso:
 *   node scripts/bulk-import-protocols.mjs --dir ./protocolos
 *   node scripts/bulk-import-protocols.mjs --dir ./protocolos --base-url http://localhost:3000
 *
 * Requiere una sesión activa de Clerk (logueate en BASE_URL primero) y
 * CLERK_SECRET_KEY en apps/web/.env.local. Sin dependencias externas (Node 18+).
 */
import { readFileSync, readdirSync, existsSync } from 'fs'
import { join, dirname, basename } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')

function getArg(flag, fallback) {
  const idx = process.argv.indexOf(flag)
  return idx !== -1 && process.argv[idx + 1] ? process.argv[idx + 1] : fallback
}

const DIR = getArg('--dir', null)
const BASE_URL = getArg('--base-url', 'http://localhost:3000')

if (!DIR) {
  console.error('Falta --dir <ruta>. Ejemplo: node scripts/bulk-import-protocols.mjs --dir ./protocolos')
  process.exit(1)
}

const envContent = readFileSync(join(ROOT, 'apps/web/.env.local'), 'utf8')
function getEnv(key) {
  const line = envContent.split('\n').find((l) => l.startsWith(key + '='))
  return line ? line.slice(key.length + 1).trim() : undefined
}

const CLERK_SECRET_KEY = getEnv('CLERK_SECRET_KEY')
const USER_ID = getArg('--user-id', getEnv('EVAL_USER_ID'))

async function getSessionToken() {
  if (!CLERK_SECRET_KEY) throw new Error('CLERK_SECRET_KEY no encontrado en apps/web/.env.local')
  if (!USER_ID) throw new Error('Falta --user-id <id> (o EVAL_USER_ID en .env.local)')

  const sessRes = await fetch(`https://api.clerk.com/v1/sessions?user_id=${USER_ID}&limit=5`, {
    headers: { Authorization: `Bearer ${CLERK_SECRET_KEY}` },
  })
  if (!sessRes.ok) throw new Error(`Sessions API failed: ${sessRes.status} ${await sessRes.text()}`)
  const sessions = await sessRes.json()
  const list = Array.isArray(sessions) ? sessions : sessions.data || []
  const active = list.filter((s) => s.status === 'active')
  if (!active.length) throw new Error(`Sin sesiones activas. Logueate en ${BASE_URL}/sign-in primero.`)

  const tokenRes = await fetch(`https://api.clerk.com/v1/sessions/${active[0].id}/tokens`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${CLERK_SECRET_KEY}`, 'Content-Type': 'application/json' },
  })
  if (!tokenRes.ok) throw new Error(`Token API failed: ${tokenRes.status} ${await tokenRes.text()}`)
  const { jwt } = await tokenRes.json()
  return jwt
}

async function main() {
  const dirPath = DIR.startsWith('/') ? DIR : join(process.cwd(), DIR)
  if (!existsSync(dirPath)) throw new Error(`Directorio no encontrado: ${dirPath}`)

  const pdfs = readdirSync(dirPath).filter((f) => f.toLowerCase().endsWith('.pdf'))
  if (pdfs.length === 0) throw new Error(`No hay PDFs en ${dirPath}`)

  console.log(`Encontrados ${pdfs.length} protocolos en ${dirPath}`)
  console.log('Obteniendo token de sesión Clerk...')
  const token = await getSessionToken()
  console.log('Token obtenido.\n')

  const form = new FormData()
  for (const f of pdfs) {
    const buf = readFileSync(join(dirPath, f))
    form.append('files', new Blob([buf], { type: 'application/pdf' }), basename(f))
  }

  console.log('Subiendo lote a /api/studies/bulk-import...')
  const res = await fetch(`${BASE_URL}/api/studies/bulk-import`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  })

  if (!res.ok) {
    console.error(`Bulk import falló (${res.status}): ${await res.text()}`)
    process.exit(1)
  }

  const data = await res.json()
  console.log(`\n=== Resumen (batch ${data.batchId}) ===`)
  console.log(`Encolados: ${data.queued}/${data.total}`)
  for (const item of data.items) {
    const tag = item.status === 'error' ? `ERROR (${item.error})` : `jobId=${item.jobId} studyId=${item.studyId}`
    console.log(`  ${item.fileName}: ${tag}`)
  }
  console.log('\nSeguí el progreso en:')
  console.log(`  ${BASE_URL}/studies/import`)
  console.log(`  GET ${BASE_URL}/api/studies/bulk-import/${data.batchId}`)
}

main().catch((e) => {
  console.error(e.message)
  process.exit(1)
})
