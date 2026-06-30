#!/usr/bin/env node
/**
 * Generates a PHI_ENCRYPTION_KEY for field-level encryption (AES-256-GCM).
 *
 * Usage:
 *   node scripts/generate-phi-key.mjs
 *
 * Store the output in Vercel env (production/preview) and local .env.local.
 * NEVER commit the key. Rotate per docs/compliance/BACKUP-AND-DR.md §6.
 */

import { randomBytes } from 'node:crypto'

const key = randomBytes(32).toString('hex')

console.log('PHI_ENCRYPTION_KEY (64 hex chars — store securely, do not commit):')
console.log(key)
