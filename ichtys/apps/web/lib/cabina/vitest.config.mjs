import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

/** Vitest de la cabina. No carga PostCSS: estas pruebas son TypeScript puro. */
export default {
  root,
  css: { postcss: { plugins: [] } },
  test: {
    include: ['lib/cabina/__tests__/**/*.test.ts'],
    fileParallelism: false,
    maxWorkers: 1,
    minWorkers: 1,
  },
}
