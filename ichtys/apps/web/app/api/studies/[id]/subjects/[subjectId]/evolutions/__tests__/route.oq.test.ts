/**
 * OQ — Operational Qualification tests (CSV Etapa 2).
 * OQ-001: evolución sin auth → 401
 * OQ-002: evolución cross-org → 404
 * OQ-007: audit log sin contenido PHI
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  class MockAccessError extends Error {
    constructor(
      message: string,
      readonly status: 401 | 403 | 404,
    ) {
      super(message)
      this.name = 'AccessError'
    }
  }

  const ORG_ID = crypto.randomUUID()
  const STUDY_ID = crypto.randomUUID()
  const SUBJECT_ID = crypto.randomUUID()
  const USER_ID = 'user_oq_test'
  const EVOLUTION_ID = crypto.randomUUID()

  return {
    AccessError: MockAccessError,
    ORG_ID,
    STUDY_ID,
    SUBJECT_ID,
    USER_ID,
    EVOLUTION_ID,
    validateSubjectAccess: vi.fn(),
    handleApiError: vi
      .fn<(err: unknown) => Response>()
      .mockImplementation((err: unknown) => {
        if (err instanceof MockAccessError) {
          const msg =
            err.status === 401 ? 'Unauthorized' : err.status === 403 ? 'Forbidden' : 'Not Found'
          return new Response(msg, { status: err.status })
        }
        return new Response('Internal Server Error', { status: 500 })
      }),
    writeAuditLog: vi.fn().mockResolvedValue(undefined),
    encryptClinicalContent: vi.fn((text: string) => `enc:${text}`),
    decryptClinicalContent: vi.fn((enc: string) => enc.replace(/^enc:/, '')),
    detectPossiblePii: vi.fn().mockReturnValue([]),
    proposeProfileFromEvolution: vi.fn().mockResolvedValue({ factCount: 2 }),
    dbInsertReturning: vi.fn(),
    dbFindMany: vi.fn(),
    looseInsert: vi.fn(),
    tx: { insert: vi.fn() },
  }
})

vi.mock('@ichtys/auth', () => ({
  validateSubjectAccess: mocks.validateSubjectAccess,
  handleApiError: mocks.handleApiError,
  AccessError: mocks.AccessError,
}))

vi.mock('@ichtys/db', () => ({
  db: {
    // Una escritura por la conexión suelta queda fuera de la transacción.
    insert: mocks.looseInsert,
    query: {
      clinicalEvolutions: {
        findMany: mocks.dbFindMany,
      },
    },
  },
  clinicalEvolutions: {},
  and: vi.fn(),
  desc: vi.fn(),
  eq: vi.fn(),
}))

// La escritura y su auditoría van juntas (R3). Acá se simula el envoltorio: corre
// la escritura con la transacción y, solo si salió bien, asienta la auditoría.
// Que las dos entren de verdad en una transacción se prueba en lib/audit.
vi.mock('../../../../../../../../lib/audit/audited-write', () => ({
  auditedWrite: async <T,>(write: (tx: unknown) => Promise<T>, audit: (result: T) => unknown) => {
    const result = await write(mocks.tx)
    await mocks.writeAuditLog(audit(result))
    return result
  },
}))

vi.mock('../../../../../../../../lib/chat/persistence', () => ({
  writeAuditLog: mocks.writeAuditLog,
}))

vi.mock('../../../../../../../../lib/subjects/phi-fields', () => ({
  encryptClinicalContent: mocks.encryptClinicalContent,
  decryptClinicalContent: mocks.decryptClinicalContent,
  detectPossiblePii: mocks.detectPossiblePii,
  PhiConfigError: class PhiConfigError extends Error {
    constructor(message?: string) {
      super(message)
      this.name = 'PhiConfigError'
    }
  },
}))

vi.mock('../../../../../../../../lib/subjects/patient-profile-service', () => ({
  proposeProfileFromEvolution: mocks.proposeProfileFromEvolution,
}))

import { GET, POST } from '../route'

const CLINICAL_TEXT = 'Metformina 850 mg. HbA1c 8.2%. Sin eventos adversos.'

function makeParams(subjectId = mocks.SUBJECT_ID) {
  return { params: Promise.resolve({ id: mocks.STUDY_ID, subjectId }) }
}

function subjectContext() {
  return {
    orgId: mocks.ORG_ID,
    userId: mocks.USER_ID,
    study: { id: mocks.STUDY_ID },
    subject: {
      id: mocks.SUBJECT_ID,
      subjectCode: 'GZBO-001',
      studyId: mocks.STUDY_ID,
      organizationId: mocks.ORG_ID,
    },
  }
}

// Toda escritura de la ruta entra por la transacción que recibe de auditedWrite.
mocks.tx.insert.mockImplementation(() => ({ values: () => ({ returning: mocks.dbInsertReturning }) }))

beforeEach(() => vi.clearAllMocks())
afterEach(() => vi.clearAllMocks())

describe('OQ-001 — evolución sin autenticación', () => {
  it('POST devuelve 401 cuando validateSubjectAccess falla por Unauthorized', async () => {
    mocks.validateSubjectAccess.mockRejectedValueOnce(new mocks.AccessError('Unauthorized', 401))

    const res = await POST(
      new Request('http://localhost/api/evolutions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: CLINICAL_TEXT }),
      }),
      makeParams(),
    )

    expect(res.status).toBe(401)
    expect(mocks.dbInsertReturning).not.toHaveBeenCalled()
    expect(mocks.writeAuditLog).not.toHaveBeenCalled()
  })

  it('GET devuelve 401 cuando validateSubjectAccess falla por Unauthorized', async () => {
    mocks.validateSubjectAccess.mockRejectedValueOnce(new mocks.AccessError('Unauthorized', 401))

    const res = await GET(new Request('http://localhost/api/evolutions'), makeParams())

    expect(res.status).toBe(401)
    expect(mocks.dbFindMany).not.toHaveBeenCalled()
  })
})

describe('OQ-002 — evolución cross-org / sujeto ajeno', () => {
  it('GET devuelve 404 cuando el sujeto no pertenece a la org activa', async () => {
    mocks.validateSubjectAccess.mockRejectedValueOnce(new mocks.AccessError('Not Found', 404))

    const res = await GET(new Request('http://localhost/api/evolutions'), makeParams())

    expect(res.status).toBe(404)
    expect(mocks.dbFindMany).not.toHaveBeenCalled()
  })

  it('POST devuelve 404 cuando el sujeto no pertenece a la org activa', async () => {
    mocks.validateSubjectAccess.mockRejectedValueOnce(new mocks.AccessError('Not Found', 404))

    const res = await POST(
      new Request('http://localhost/api/evolutions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: CLINICAL_TEXT }),
      }),
      makeParams(),
    )

    expect(res.status).toBe(404)
    expect(mocks.dbInsertReturning).not.toHaveBeenCalled()
  })
})

describe('OQ-007 — audit log sin contenido PHI', () => {
  it('POST registra evolution.create con metadata acotada (sin texto clínico)', async () => {
    mocks.validateSubjectAccess.mockResolvedValueOnce(subjectContext())
    mocks.dbInsertReturning.mockResolvedValueOnce([
      {
        id: mocks.EVOLUTION_ID,
        visitLabel: 'V1',
        createdAt: new Date('2026-07-04T12:00:00Z'),
      },
    ])

    const res = await POST(
      new Request('http://localhost/api/evolutions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: CLINICAL_TEXT, visitLabel: 'V1' }),
      }),
      makeParams(),
    )

    expect(res.status).toBe(201)
    expect(mocks.writeAuditLog).toHaveBeenCalledTimes(1)

    const auditCall = mocks.writeAuditLog.mock.calls[0]?.[0] as {
      action: string
      metadata?: Record<string, unknown>
    }
    expect(auditCall.action).toBe('evolution.create')
    expect(auditCall.metadata).toBeDefined()
    expect(auditCall.metadata).not.toHaveProperty('content')
    expect(auditCall.metadata).not.toHaveProperty('contentEncrypted')
    expect(auditCall.metadata?.contentLength).toBe(CLINICAL_TEXT.length)
    expect(auditCall.metadata?.subjectId).toBe(mocks.SUBJECT_ID)

    const metadataJson = JSON.stringify(auditCall.metadata)
    expect(metadataJson).not.toContain('Metformina')
    expect(metadataJson).not.toContain('HbA1c')
  })

  it('POST de una evolución dictada: el origen, el modelo y su revisión van al registro, sin texto', async () => {
    mocks.validateSubjectAccess.mockResolvedValueOnce(subjectContext())
    mocks.dbInsertReturning.mockResolvedValueOnce([
      { id: mocks.EVOLUTION_ID, visitLabel: 'V1', createdAt: new Date('2026-11-12T12:00:00Z') },
    ])
    const source = { kind: 'dictation', durationSec: 312, model: 'whisper-small', modelRevision: 'rev-abc', corrections: 2, missingBlocks: 3 }
    const res = await POST(
      new Request('http://localhost/api/evolutions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: CLINICAL_TEXT, visitLabel: 'V1', source }),
      }),
      makeParams(),
    )
    expect(res.status).toBe(201)
    const auditCall = mocks.writeAuditLog.mock.calls[0]?.[0] as { metadata?: Record<string, unknown> }
    expect(auditCall.metadata?.source).toEqual(source)
    expect(JSON.stringify(auditCall.metadata)).not.toContain('Metformina')
  })

  it('POST de una evolución dictada: el sujeto confirmado antes de grabar coincide con el de la ruta y queda comprobado en el registro (D23)', async () => {
    mocks.validateSubjectAccess.mockResolvedValueOnce(subjectContext())
    mocks.dbInsertReturning.mockResolvedValueOnce([
      { id: mocks.EVOLUTION_ID, visitLabel: 'V1', createdAt: new Date('2026-11-14T12:00:00Z') },
    ])
    mocks.writeAuditLog.mockClear()
    const source = { kind: 'dictation', durationSec: 40, model: 'whisper-small', modelRevision: 'rev-abc', corrections: 0, missingBlocks: 1, confirmedSubjectCode: 'GZBO-001' }
    const res = await POST(
      new Request('http://localhost/api/evolutions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: CLINICAL_TEXT, visitLabel: 'V1', source }),
      }),
      makeParams(),
    )
    expect(res.status).toBe(201)
    const auditCall = mocks.writeAuditLog.mock.calls[0]?.[0] as { metadata?: { source?: Record<string, unknown> } }
    // El registro dice que se comprobó; el código del sujeto no se copia al registro.
    expect(auditCall.metadata?.source?.subjectConfirmed).toBe(true)
    expect(auditCall.metadata?.source).not.toHaveProperty('confirmedSubjectCode')
    expect(JSON.stringify(auditCall.metadata)).not.toContain('GZBO-001')
  })

  it('POST de un dictado confirmado para OTRO sujeto: 409 y no se guarda nada (D23)', async () => {
    mocks.validateSubjectAccess.mockResolvedValueOnce(subjectContext())
    mocks.writeAuditLog.mockClear()
    mocks.dbInsertReturning.mockClear()
    const source = { kind: 'dictation', durationSec: 40, model: 'm', modelRevision: 'r', corrections: 0, missingBlocks: 0, confirmedSubjectCode: 'GZBO-002' }
    const res = await POST(
      new Request('http://localhost/api/evolutions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: CLINICAL_TEXT, source }),
      }),
      makeParams(),
    )
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'subject_mismatch' })
    expect(mocks.dbInsertReturning).not.toHaveBeenCalled()
    expect(mocks.writeAuditLog).not.toHaveBeenCalled()
  })

  it('POST de un dictado sin sujeto confirmado (cliente anterior): se guarda y el registro no afirma la confirmación', async () => {
    mocks.validateSubjectAccess.mockResolvedValueOnce(subjectContext())
    mocks.dbInsertReturning.mockResolvedValueOnce([
      { id: mocks.EVOLUTION_ID, visitLabel: null, createdAt: new Date('2026-11-14T12:00:00Z') },
    ])
    mocks.writeAuditLog.mockClear()
    const source = { kind: 'dictation', durationSec: 40, model: 'm', modelRevision: 'r', corrections: 0, missingBlocks: 0 }
    const res = await POST(
      new Request('http://localhost/api/evolutions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: CLINICAL_TEXT, source }),
      }),
      makeParams(),
    )
    expect(res.status).toBe(201)
    const auditCall = mocks.writeAuditLog.mock.calls[0]?.[0] as { metadata?: { source?: Record<string, unknown> } }
    expect(auditCall.metadata?.source).not.toHaveProperty('subjectConfirmed')
  })

  it('POST rechaza un código de sujeto confirmado que no sea un texto corto', async () => {
    mocks.validateSubjectAccess.mockResolvedValue(subjectContext())
    for (const confirmedSubjectCode of [true, '', 'X'.repeat(65)]) {
      const source = { kind: 'dictation', durationSec: 40, model: 'm', modelRevision: 'r', corrections: 0, missingBlocks: 0, confirmedSubjectCode }
      const res = await POST(
        new Request('http://localhost/api/evolutions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: CLINICAL_TEXT, source }),
        }),
        makeParams(),
      )
      expect(res.status).toBe(400)
    }
    mocks.validateSubjectAccess.mockReset()
  })

  it('POST rechaza un origen con campos de más o con texto libre', async () => {
    mocks.validateSubjectAccess.mockResolvedValue(subjectContext())
    for (const source of [
      { kind: 'dictation', durationSec: 10, model: 'm', modelRevision: 'r', corrections: 0, missingBlocks: 0, transcript: 'Metformina' },
      { kind: 'otro', durationSec: 10, model: 'm', modelRevision: 'r', corrections: 0, missingBlocks: 0 },
      { kind: 'dictation', durationSec: -1, model: 'm', modelRevision: 'r', corrections: 0, missingBlocks: 0 },
    ]) {
      const res = await POST(
        new Request('http://localhost/api/evolutions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: CLINICAL_TEXT, source }),
        }),
        makeParams(),
      )
      expect(res.status).toBe(400)
    }
    mocks.validateSubjectAccess.mockReset()
  })

  it('GET registra evolution.view con count, sin evoluciones en metadata', async () => {
    mocks.validateSubjectAccess.mockResolvedValueOnce(subjectContext())
    mocks.dbFindMany.mockResolvedValueOnce([
      {
        id: mocks.EVOLUTION_ID,
        visitLabel: 'V1',
        contentEncrypted: 'enc:secret',
        authorUserId: mocks.USER_ID,
        createdAt: new Date('2026-07-04T12:00:00Z'),
      },
    ])

    const res = await GET(new Request('http://localhost/api/evolutions'), makeParams())

    expect(res.status).toBe(200)
    expect(mocks.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'evolution.view',
        metadata: { count: 1 },
      }),
    )
  })
})

describe('OQ-003 — cifrado at-rest en POST', () => {
  it('persiste contentEncrypted vía encryptClinicalContent', async () => {
    mocks.validateSubjectAccess.mockResolvedValueOnce(subjectContext())
    mocks.dbInsertReturning.mockResolvedValueOnce([
      {
        id: mocks.EVOLUTION_ID,
        visitLabel: null,
        createdAt: new Date(),
      },
    ])

    await POST(
      new Request('http://localhost/api/evolutions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: CLINICAL_TEXT }),
      }),
      makeParams(),
    )

    expect(mocks.encryptClinicalContent).toHaveBeenCalledWith(CLINICAL_TEXT)
  })
})

describe('G14-53-2 — el fallo del perfil no se registra crudo', () => {
  it('escribe profile_refresh_failed y omite el marcador del error', async () => {
    const marker = 'PACIENTE_FICTICIO_123_INYECCION_LOG'
    mocks.validateSubjectAccess.mockResolvedValueOnce(subjectContext())
    mocks.dbInsertReturning.mockResolvedValueOnce([
      {
        id: mocks.EVOLUTION_ID,
        visitLabel: null,
        createdAt: new Date('2026-07-04T12:00:00Z'),
      },
    ])
    const profileErr = new Error(`fallo con ${marker}`)
    profileErr.stack = `stack ${marker}\nsegunda`
    Object.assign(profileErr, { detail: marker, cause: { message: marker } })
    mocks.proposeProfileFromEvolution.mockRejectedValueOnce(profileErr)
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    try {
      const res = await POST(
        new Request('http://localhost/api/evolutions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-request-id': 'req-g14-53-2',
          },
          body: JSON.stringify({ content: CLINICAL_TEXT }),
        }),
        makeParams(),
      )

      expect(res.status).toBe(201)
      const body = (await res.json()) as { profileProposal?: string }
      expect(body.profileProposal).toBe('failed')
      const logged = errorSpy.mock.calls
        .map((args) =>
          args
            .map((value) => {
              if (value instanceof Error) return `${value.name} ${value.message} ${value.stack ?? ''}`
              if (value && typeof value === 'object') return JSON.stringify(value)
              return String(value)
            })
            .join(' '),
        )
        .join('\n')
      expect(logged).toContain('profile_refresh_failed')
      expect(logged).toContain('req-g14-53-2')
      expect(logged).not.toContain(marker)
    } finally {
      errorSpy.mockRestore()
    }
  })
})

describe('S4 — evoluciones comparan el estudio de la URL', () => {
  it('GET y POST pasan el id de la URL antes de leer o escribir', async () => {
    const otherStudyId = crypto.randomUUID()
    mocks.validateSubjectAccess.mockResolvedValue(subjectContext())
    const params = { params: Promise.resolve({ id: otherStudyId, subjectId: mocks.SUBJECT_ID }) }

    await GET(new Request('http://localhost/api/evolutions'), params)
    await POST(
      new Request('http://localhost/api/evolutions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'Nota ficticia sin datos de paciente.' }),
      }),
      { params: Promise.resolve({ id: otherStudyId, subjectId: mocks.SUBJECT_ID }) },
    )

    expect(mocks.validateSubjectAccess).toHaveBeenNthCalledWith(1, mocks.SUBJECT_ID, otherStudyId)
    expect(mocks.validateSubjectAccess).toHaveBeenNthCalledWith(2, mocks.SUBJECT_ID, otherStudyId, {
      require: 'clinical.author',
    })
  })
})

describe('Autoría clínica — escribir una evolución pide más que leerla', () => {
  it('POST exige la capacidad clinical.author; GET no', async () => {
    mocks.validateSubjectAccess.mockResolvedValue(subjectContext())

    await GET(new Request('http://localhost/api/evolutions'), makeParams())
    expect(mocks.validateSubjectAccess).toHaveBeenLastCalledWith(mocks.SUBJECT_ID, mocks.STUDY_ID)

    await POST(
      new Request('http://localhost/api/evolutions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'Nota ficticia sin datos de paciente.' }),
      }),
      makeParams(),
    )
    expect(mocks.validateSubjectAccess).toHaveBeenLastCalledWith(mocks.SUBJECT_ID, mocks.STUDY_ID, {
      require: 'clinical.author',
    })
  })

  it('si el validador rechaza por la capacidad, no se escribe nada y la respuesta es 403', async () => {
    mocks.validateSubjectAccess.mockRejectedValue(new mocks.AccessError('Forbidden', 403))
    mocks.handleApiError.mockReturnValue(new Response('Forbidden', { status: 403 }))

    const res = await POST(
      new Request('http://localhost/api/evolutions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'Nota ficticia sin datos de paciente.' }),
      }),
      makeParams(),
    )

    expect(res.status).toBe(403)
    expect(mocks.encryptClinicalContent).not.toHaveBeenCalled()
    expect(mocks.dbInsertReturning).not.toHaveBeenCalled()
  })
})

// Límite de pedidos (docs/decisions/rate-limiting-observability.md): se comprueba después del
// acceso y antes de leer el cuerpo.
const limit = vi.hoisted(() => ({ clinicalRateLimit: vi.fn(async (): Promise<Response | null> => null) }))
vi.mock('../../../../../../../../lib/security/clinical-rate-limit', () => limit)

describe('límite de pedidos — guardar una evolución', () => {
  const request = () =>
    new Request('http://localhost/api/evolutions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: CLINICAL_TEXT }),
    })

  it('cuenta el pedido contra la persona y su organización', async () => {
    mocks.validateSubjectAccess.mockResolvedValueOnce(subjectContext())
    mocks.dbInsertReturning.mockResolvedValueOnce([{ id: mocks.EVOLUTION_ID, createdAt: new Date() }])
    await POST(request(), makeParams())
    expect(limit.clinicalRateLimit).toHaveBeenCalledWith('evolution_write', expect.objectContaining({ orgId: mocks.ORG_ID, userId: mocks.USER_ID }))
  })

  it('con el cupo agotado responde 429 y no guarda ni registra nada', async () => {
    mocks.validateSubjectAccess.mockResolvedValueOnce(subjectContext())
    limit.clinicalRateLimit.mockResolvedValueOnce(new Response(JSON.stringify({ error: 'rate_limited' }), { status: 429, headers: { 'Retry-After': '30' } }))
    const res = await POST(request(), makeParams())
    expect(res.status).toBe(429)
    expect(mocks.tx.insert).not.toHaveBeenCalled()
    expect(mocks.looseInsert).not.toHaveBeenCalled()
    expect(mocks.encryptClinicalContent).not.toHaveBeenCalled()
  })

  it('sin acceso no se cuenta nada', async () => {
    mocks.validateSubjectAccess.mockRejectedValueOnce(new mocks.AccessError('Unauthorized', 401))
    await POST(request(), makeParams())
    expect(limit.clinicalRateLimit).not.toHaveBeenCalled()
  })
})

describe('D22 — cuántas tomas tuvo el dictado queda guardado con la evolución', () => {
  const SOURCE = { kind: 'dictation', durationSec: 60, model: 'whisper-small', modelRevision: 'rev-abc', corrections: 0, missingBlocks: 0 }

  /** Guarda lo que la ruta manda a insertar. */
  function captureInsert(): { values: Array<Record<string, unknown>> } {
    const captured = { values: [] as Array<Record<string, unknown>> }
    mocks.tx.insert.mockImplementationOnce(() => ({
      values: (row: Record<string, unknown>) => {
        captured.values.push(row)
        return { returning: mocks.dbInsertReturning }
      },
    }))
    return captured
  }

  function post(body: unknown): Promise<Response> {
    return POST(
      new Request('http://localhost/api/evolutions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
      makeParams(),
    )
  }

  it('un dictado en tres tomas guarda el tres en la evolución y lo deja en el registro', async () => {
    mocks.validateSubjectAccess.mockResolvedValueOnce(subjectContext())
    mocks.dbInsertReturning.mockResolvedValueOnce([{ id: mocks.EVOLUTION_ID, visitLabel: null, createdAt: new Date() }])
    const captured = captureInsert()

    const res = await post({ content: CLINICAL_TEXT, source: { ...SOURCE, takes: 3 } })

    expect(res.status).toBe(201)
    expect(captured.values).toHaveLength(1)
    expect(captured.values[0]?.dictationTakes).toBe(3)
    const auditCall = mocks.writeAuditLog.mock.calls[0]?.[0] as { metadata?: { source?: Record<string, unknown> } }
    expect(auditCall.metadata?.source?.takes).toBe(3)
  })

  it('una evolución escrita a mano deja el número vacío', async () => {
    mocks.validateSubjectAccess.mockResolvedValueOnce(subjectContext())
    mocks.dbInsertReturning.mockResolvedValueOnce([{ id: mocks.EVOLUTION_ID, visitLabel: null, createdAt: new Date() }])
    const captured = captureInsert()

    const res = await post({ content: CLINICAL_TEXT })

    expect(res.status).toBe(201)
    expect(captured.values[0]?.dictationTakes).toBeNull()
  })

  it('un dictado de una pantalla anterior, que no manda las tomas, se guarda y deja el número vacío', async () => {
    mocks.validateSubjectAccess.mockResolvedValueOnce(subjectContext())
    mocks.dbInsertReturning.mockResolvedValueOnce([{ id: mocks.EVOLUTION_ID, visitLabel: null, createdAt: new Date() }])
    const captured = captureInsert()

    const res = await post({ content: CLINICAL_TEXT, source: SOURCE })

    expect(res.status).toBe(201)
    expect(captured.values[0]?.dictationTakes).toBeNull()
  })

  it.each([0, -1, 1.5, 100, '3'])('rechaza %s como cantidad de tomas y no guarda nada', async (takes) => {
    mocks.validateSubjectAccess.mockResolvedValueOnce(subjectContext())

    const res = await post({ content: CLINICAL_TEXT, source: { ...SOURCE, takes } })

    expect(res.status).toBe(400)
    expect(mocks.tx.insert).not.toHaveBeenCalled()
    expect(mocks.writeAuditLog).not.toHaveBeenCalled()
  })

  it('GET devuelve las tomas de cada evolución, y vacío donde no se dictó o es anterior', async () => {
    mocks.validateSubjectAccess.mockResolvedValueOnce(subjectContext())
    mocks.dbFindMany.mockResolvedValueOnce([
      { id: 'evo-dictada', visitLabel: null, contentEncrypted: 'enc:a', authorUserId: mocks.USER_ID, createdAt: new Date('2026-11-14T12:00:00Z'), dictationTakes: 2 },
      { id: 'evo-a-mano', visitLabel: null, contentEncrypted: 'enc:b', authorUserId: mocks.USER_ID, createdAt: new Date('2026-11-13T12:00:00Z'), dictationTakes: null },
    ])

    const res = await GET(new Request('http://localhost/api/evolutions'), makeParams())
    const body = (await res.json()) as { evolutions: Array<{ id: string; dictationTakes: number | null }> }

    expect(body.evolutions.map((evolution) => [evolution.id, evolution.dictationTakes])).toEqual([
      ['evo-dictada', 2],
      ['evo-a-mano', null],
    ])
  })
})
