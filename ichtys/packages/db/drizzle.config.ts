import { defineConfig } from 'drizzle-kit'

/**
 * drizzle-kit usa la conexión UNPOOLED para generar/aplicar migrations.
 */
const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL

if (!url) {
  throw new Error('DATABASE_URL_UNPOOLED (or DATABASE_URL) is not set. See .env.example.')
}

export default defineConfig({
  schema: './schema/index.ts',
  out: './migrations',
  dialect: 'postgresql',
  dbCredentials: { url },
  strict: true,
  verbose: true,
})
