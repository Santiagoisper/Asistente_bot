#!/usr/bin/env node
/** Seed GZBO-001 + evolución en branch local de prueba. */
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createCipheriv, randomBytes } from 'node:crypto'
import { createRequire } from 'node:module'

const require = createRequire(resolve(dirname(fileURLToPath(import.meta.url)), '../packages/db/package.json'))
const { neon } = require('@neondatabase/serverless')

const envPath = resolve(dirname(fileURLToPath(import.meta.url)), '../apps/web/.env.local')
for (const line of readFileSync(envPath, 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_0-9]+)=/)
  if (!m) continue
  process.env[m[1]] = line.slice(m[1].length + 1).replace(/^"|"$/g, '')
}

function encryptPhi(plaintext, hexKey) {
  const key = Buffer.from(hexKey, 'hex')
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), enc.toString('base64url')].join(':')
}

const sql = neon(process.env.DATABASE_URL)
const study = (await sql`SELECT id AS study_id, organization_id FROM studies WHERE name = 'GZBO' LIMIT 1`)[0]
if (!study) throw new Error('Estudio GZBO no encontrado')

await sql`DELETE FROM subjects WHERE subject_code = 'GZBO-001' AND study_id = ${study.study_id}`

const text =
  'Paciente en screening. Metformina 850 mg c/12h. HbA1c 8.2%. Antecedente DM2. Sin GLP-1 activo.'
const contentEnc = encryptPhi(text, process.env.PHI_ENCRYPTION_KEY)
const profileEnc = encryptPhi('{}', process.env.PHI_ENCRYPTION_KEY)

await sql`
  WITH ns AS (
    INSERT INTO subjects (organization_id, study_id, subject_code, status)
    VALUES (${study.organization_id}, ${study.study_id}, 'GZBO-001', 'screening')
    RETURNING id
  ),
  prof AS (
    INSERT INTO patient_profiles (organization_id, study_id, subject_id, profile_encrypted)
    SELECT ${study.organization_id}, ${study.study_id}, id, ${profileEnc} FROM ns
    RETURNING subject_id
  )
  INSERT INTO clinical_evolutions (
    organization_id, study_id, subject_id, author_user_id, visit_label, content_encrypted
  )
  SELECT ${study.organization_id}, ${study.study_id}, subject_id, 'local-setup', 'Screening', ${contentEnc}
  FROM prof
`

console.log('OK: GZBO-001 + evolución Screening creados en branch ichtys-local-phase1-test')
