import { beforeEach, describe, expect, it, vi } from 'vitest'

const SENTINEL = 'sk-ant-provider-raw-ficticio-NO-LOG'

const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
  updates: [] as Array<Record<string, unknown>>,
  runIngestion: vi.fn(),
}))

vi.mock('@ichtys/db', () => ({
  db: {
    query: {
      ingestionJobs: {
        findFirst: (...args: unknown[]) => mocks.findFirst(...args),
      },
    },
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: async () => {
          mocks.updates.push(values)
        },
      }),
    }),
  },
  ingestionJobs: {
    id: 'id',
    organizationId: 'organizationId',
  },
}))

vi.mock('../pipeline', () => ({
  runIngestion: (...args: unknown[]) => mocks.runIngestion(...args),
}))

import { runSingleIngestionJobById } from '../ingestion-jobs'

function flattenLogs(spy: { mock: { calls: unknown[][] } }): string {
  return spy.mock.calls.map((args) => args.map((value) => {
    if (value instanceof Error) return `${value.name} ${value.message} ${value.stack ?? ''}`
    if (value && typeof value === 'object') return JSON.stringify(value)
    return String(value)
  }).join(' ')).join('\n')
}

describe('runSingleIngestionJobById', () => {
  beforeEach(() => {
    mocks.updates.length = 0
    mocks.runIngestion.mockReset()
    mocks.findFirst.mockResolvedValue({
      id: 'job-ficticio',
      organizationId: 'org-ficticia',
      userId: 'user-ficticio',
      studyId: 'study-ficticio',
      documentId: 'doc-ficticio',
      documentVersionId: 'ver-ficticio',
      status: 'pending',
      attemptCount: 0,
      maxAttempts: 1,
      fileName: 'protocolo-ficticio.pdf',
    })
  })

  it('guarda un código y no el mensaje crudo cuando la ingesta falla', async () => {
    mocks.runIngestion.mockRejectedValue(new Error(SENTINEL))
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    try {
      await runSingleIngestionJobById('job-ficticio', 'org-ficticia')
      const stored = mocks.updates.map((values) => String(values.errorMessage ?? '')).join(' ')
      const logged = flattenLogs(spy)

      expect(stored).not.toContain(SENTINEL)
      expect(logged).not.toContain(SENTINEL)
      expect(stored).toContain('ingestion_failed')
      expect(logged).toContain('ingestion_failed')
    } finally {
      spy.mockRestore()
    }
  })
})
