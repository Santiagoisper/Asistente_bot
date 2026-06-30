#!/usr/bin/env node
/**
 * Prueba local Fase 1: sujeto + evolución cifrada contra Neon branch aislado.
 * No requiere Clerk — valida migración + crypto + persistencia.
 *
 * Usage: node scripts/test-subjects-local-flow.mjs
 */
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(resolve(dirname(fileURLToPath(import.meta.url)), '../packages/db/package.json'))
const { neon } = require('@neondatabase/serverless')
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')

function encryptPhi(plaintext, hexKey) {
  const key = Buffer.from(hexKey, 'hex')
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return ['v1', iv.toString('base64url'), tag.toString('base64url'), encrypted.toString('base64url')].join(':')
}

function decryptPhi(payload, hexKey) {
  const [, ivB64, tagB64, ctB64] = payload.split(':')
  const key = Buffer.from(hexKey, 'hex')
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64url'))
  decipher.setAuthTag(Buffer.from(tagB64, 'base64url'))
  return Buffer.concat([
    decipher.update(Buffer.from(ctB64, 'base64url')),
    decipher.final(),
  ]).toString('utf8')
}

function loadEnvFile(path) {
  if (!existsSync(path)) return
  const text = readFileSync(path, 'utf8')
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    const key = trimmed.slice(0, eq)
    let val = trimmed.slice(eq + 1)
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1)
    }
    if (!process.env[key]) process.env[key] = val
  }
}

loadEnvFile(resolve(root, 'apps/web/.env.local'))

const DATABASE_URL = process.env.DATABASE_URL
const PHI_KEY = process.env.PHI_ENCRYPTION_KEY

if (!DATABASE_URL) {
  console.error('FAIL: DATABASE_URL missing in apps/web/.env.local')
  process.exit(1)
}
if (!PHI_KEY) {
  console.error('FAIL: PHI_ENCRYPTION_KEY missing — run: node scripts/generate-phi-key.mjs')
  process.exit(1)
}

const sql = neon(DATABASE_URL)
const SUBJECT_CODE = `GZBO-LOCAL-${Date.now().toString(36).toUpperCase()}`
const EVOLUTION_TEXT =
  'Paciente en screening. Metformina 850 mg c/12h. HbA1c 8.2%. Sin contraindicaciones aparentes.'

async function main() {
  console.log('=== Ichtys Fase 1 — prueba local ===')
  console.log(`Sujeto de prueba: ${SUBJECT_CODE}`)

  const tables = await sql`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name IN ('subjects', 'clinical_evolutions', 'patient_profiles')
  `
  if (tables.length < 3) {
    console.error('FAIL: faltan tablas Fase 1 — corré la migración 0005')
    process.exit(1)
  }
  console.log('OK: tablas subjects, clinical_evolutions, patient_profiles')

  const studies = await sql`
    SELECT s.id AS study_id, s.organization_id, s.name
    FROM studies s
    WHERE s.name = 'GZBO'
    LIMIT 1
  `
  const study = studies[0]
  if (!study) {
    console.error('FAIL: no se encontró estudio GZBO en la DB')
    process.exit(1)
  }
  console.log(`OK: estudio GZBO (${study.study_id})`)

  const profileEnc = encryptPhi('{}', PHI_KEY)
  const contentEnc = encryptPhi(EVOLUTION_TEXT, PHI_KEY)

  const inserted = await sql`
    WITH new_subject AS (
      INSERT INTO subjects (organization_id, study_id, subject_code, status)
      VALUES (${study.organization_id}, ${study.study_id}, ${SUBJECT_CODE}, 'screening')
      RETURNING id, subject_code
    ),
    new_profile AS (
      INSERT INTO patient_profiles (organization_id, study_id, subject_id, profile_encrypted)
      SELECT ${study.organization_id}, ${study.study_id}, id, ${profileEnc}
      FROM new_subject
      RETURNING subject_id
    ),
    new_evo AS (
      INSERT INTO clinical_evolutions (
        organization_id, study_id, subject_id, author_user_id, visit_label, content_encrypted
      )
      SELECT
        ${study.organization_id},
        ${study.study_id},
        id,
        'local-test-script',
        'Screening',
        ${contentEnc}
      FROM new_subject
      RETURNING id, content_encrypted
    )
    SELECT ns.id AS subject_id, ns.subject_code, ne.content_encrypted
    FROM new_subject ns
    CROSS JOIN new_evo ne
  `

  const row = inserted[0]
  if (!row) {
    console.error('FAIL: insert no devolvió filas')
    process.exit(1)
  }

  const decrypted = decryptPhi(row.content_encrypted, PHI_KEY)
  if (decrypted !== EVOLUTION_TEXT) {
    console.error('FAIL: round-trip decrypt no coincide')
    process.exit(1)
  }
  console.log('OK: evolución guardada cifrada y leída correctamente')
  console.log(`OK: excerpt descifrado: "${decrypted.slice(0, 60)}…"`)

  await sql`DELETE FROM subjects WHERE id = ${row.subject_id}`
  console.log('OK: cleanup — sujeto de prueba eliminado')

  console.log('\n=== RESULTADO: PASS — Fase 1 lista para probar en UI ===')
  console.log('Abrí http://localhost:3000 → Estudio GZBO → Sujetos')
}

main().catch((err) => {
  console.error('FAIL:', err instanceof Error ? err.message : err)
  process.exit(1)
})
