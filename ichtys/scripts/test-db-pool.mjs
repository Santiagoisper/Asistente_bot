#!/usr/bin/env node
/** Verifica conexión Pool/WebSocket a Neon (mismo path que Next.js). */
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const envPath = resolve(root, 'apps/web/.env.local')
for (const line of readFileSync(envPath, 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_0-9]+)=/)
  if (m) process.env[m[1]] = line.slice(m[1].length + 1).replace(/^"|"$/g, '')
}

process.env.WS_NO_BUFFER_UTIL = 'true'
process.env.WS_NO_UTF_8_VALIDATE = 'true'

const require = createRequire(resolve(root, 'packages/db/package.json'))
const { Pool, neonConfig } = require('@neondatabase/serverless')
const ws = require('ws')
neonConfig.webSocketConstructor = ws

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
try {
  const r = await pool.query('SELECT name FROM organizations LIMIT 1')
  console.log('DB Pool OK:', r.rows[0]?.name ?? '(sin orgs)')
} finally {
  await pool.end()
}
