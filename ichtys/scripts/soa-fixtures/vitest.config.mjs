import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

export default {
  root,
  test: {
    maxWorkers: 1,
    fileParallelism: false,
    include: ['scripts/soa-fixtures/score.test.ts'],
  },
}
