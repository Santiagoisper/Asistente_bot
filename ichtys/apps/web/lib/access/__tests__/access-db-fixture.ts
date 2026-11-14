import { getTableColumns } from 'drizzle-orm'
import { and, eq, gt, isNotNull, isNull, or, type Cond } from './access-operators'

/**
 * Base de datos de mentira para las pruebas de «Equipo y accesos»
 * (docs/decisions/study-membership.md, paso 5).
 *
 * El objetivo no es burlar las consultas una por una sino dejar correr la
 * cadena entera — Clerk, `resolveOrProvisionOrganization`, `loadAccessSubject`,
 * `validateStudyAccess`, `canEnterStudy` — sobre filas de prueba. Para eso el
 * fake tiene que poder EVALUAR las condiciones de drizzle: los operadores que
 * usan los módulos bajo prueba se reemplazan por otros con la misma firma cuya
 * estructura se puede inspeccionar, y el `where()` del fake los aplica de
 * verdad contra las filas. Las tablas y columnas sí son las reales del schema
 * (vienen de `importOriginal`), así que columna y condición siempre coinciden.
 *
 * La transacción es de mentira pero conserva la propiedad que importa (R3):
 * si el callback lanza — por ejemplo, porque el registro de auditoría falla —
 * el estado de antes se restaura, como haría el rollback de la base.
 */

type Row = Record<string, unknown>

// Los operadores (y su tipo) se re-exportan para quien ya importa el fixture;
// viven aparte para que los mocks hoisted puedan cargarlos sin ciclo.
export { eq, and, or, isNull, isNotNull, gt } from './access-operators'
export type { Cond } from './access-operators'

export interface AuditCall {
  via: 'tx'
  values: Row
}

export interface ClerkMemberRow {
  role: string
  publicUserData: { userId: string; firstName?: string | null; lastName?: string | null; identifier?: string }
}

/** Lo que devuelve `auth()` de Clerk: sin sesión, todo null. */
export interface FixtureAuth {
  userId: string | null
  orgId: string | null
  orgRole: string | null
}

/** Fila de `organizations`: el plazo del modo abierto muta en los tests de la ruta de modo. */
export interface FixtureOrg extends Row {
  id: string
  clerkOrgId: string
  name: string
  accessMode: 'open' | 'enforced'
  accessOpenUntil: Date | null
}

/** Estado visible por los tests. `resetFixture()` lo vuelve al default. */
export const fx = {
  /** Lo que devuelve `auth()` de Clerk. */
  auth: { userId: 'user-1', orgId: 'org_clerk_1', orgRole: 'org:admin' } as FixtureAuth,
  /** Fila de `organizations`. `accessMode` decide open/enforced. */
  org: { id: 'org-1', clerkOrgId: 'org_clerk_1', name: 'Centro Uno', accessMode: 'open', accessOpenUntil: null } as FixtureOrg,
  /** `org` como tabla: los UPDATE de la ruta de modo mutan esta fila. */
  orgRows: [] as FixtureOrg[],
  studyRows: [] as Row[],
  memberFunctionRows: [] as Row[],
  membershipRows: [] as Row[],
  evolutionRows: [] as Row[],
  /** Con qué criterio sobre las anuladas se pidieron los autores de evoluciones (D24). */
  evolutionAuthorPolicies: [] as string[],
  clerkMembers: [] as ClerkMemberRow[],
  /** Registros de auditoría que llegaron por la transacción (insertAuditLog). */
  audits: [] as AuditCall[],
  transactions: 0,
  /** Simula que la tabla de auditoría no se puede escribir: la transacción revierte. */
  failAudit: false,
  /** Total que informa Clerk además de la página: mayor que la lista ⇒ truncated. */
  clerkTotalCount: undefined as number | undefined,
}

export function resetFixture(): void {
  fx.auth = { userId: 'user-1', orgId: 'org_clerk_1', orgRole: 'org:admin' } as FixtureAuth
  fx.org = { id: 'org-1', clerkOrgId: 'org_clerk_1', name: 'Centro Uno', accessMode: 'open', accessOpenUntil: null } as FixtureOrg
  fx.orgRows = [fx.org]
  fx.studyRows = [{ id: 'study-1', organizationId: 'org-1', name: 'Metabólica' }]
  fx.memberFunctionRows = []
  fx.membershipRows = []
  fx.evolutionRows = []
  fx.evolutionAuthorPolicies = []
  fx.clerkMembers = [
    { role: 'org:admin', publicUserData: { userId: 'user-1', firstName: 'Ana', lastName: 'Admin', identifier: 'ana@centro.test' } },
    { role: 'org:principal_investigator', publicUserData: { userId: 'user-2', firstName: 'Beto', lastName: 'Médico', identifier: 'beto@centro.test' } },
    { role: 'org:study_admin', publicUserData: { userId: 'user-3', firstName: 'Carla', identifier: 'carla@centro.test' } },
  ]
  fx.audits = []
  fx.transactions = 0
  fx.failAudit = false
  fx.clerkTotalCount = undefined
}

/** Mock de '@clerk/nextjs/server': la sesión sale del fixture, los miembros también. */
export function clerkServerMock() {
  return {
    auth: async () => ({ ...fx.auth }),
    clerkClient: async () => ({
      organizations: {
        // La misma llamada sirve a listOrgMembers (paginado) y findOrgMember (por userId).
        getOrganizationMembershipList: async (params: { limit?: number; offset?: number; userId?: string[] }) => {
          if (params.userId) {
            const wanted = params.userId[0]
            const data = fx.clerkMembers.filter((m) => m.publicUserData.userId === wanted)
            return { data, totalCount: data.length }
          }
          const start = params.offset ?? 0
          const limit = params.limit ?? 100
          const page = fx.clerkMembers.slice(start, start + limit)
          return { data: page, totalCount: fx.clerkTotalCount ?? fx.clerkMembers.length }
        },
        getOrganization: async () => ({ name: fx.org.name }),
      },
    }),
  }
}

/** Tabla del schema → array del fixture donde viven sus filas (resuelto en cada uso). */
const TABLE_STORE: Record<string, string> = {
  organizations: 'orgRows',
  memberFunctions: 'memberFunctionRows',
  studyMemberships: 'membershipRows',
  studies: 'studyRows',
  clinicalEvolutions: 'evolutionRows',
}

/** Construye el módulo '@ichtys/db' de mentira sobre el real (`importOriginal`). */
/**
 * El lector único de evoluciones, sobre `fx.evolutionRows`. Las evoluciones ya no se leen con
 * una consulta suelta (D24): quien las necesita llama al lector, y el fixture responde por él.
 */
export function evolutionReaderMock() {
  return {
    listEvolutionAuthors: async (orgId: string, policy: string): Promise<string[]> => {
      fx.evolutionAuthorPolicies.push(policy)
      const authors = fx.evolutionRows.filter((row) => row['organizationId'] === orgId).map((row) => row['authorUserId'] as string)
      return [...new Set(authors)]
    },
  }
}

export function makeDbMock(actual: Record<string, unknown>): Record<string, unknown> {
  // Mapa columna real → nombre de propiedad TS en la fila de prueba.
  const columnKeys = new Map<unknown, string>()
  // Tabla real → clave del fixture (dinámica: resetFixture reasigna los arrays).
  const tableStoreKeys = new Map<unknown, string>()
  for (const [schemaKey, storeKey] of Object.entries(TABLE_STORE)) {
    const table = actual[schemaKey]
    if (!table) continue
    for (const [tsKey, column] of Object.entries(getTableColumns(table as Parameters<typeof getTableColumns>[0]))) {
      columnKeys.set(column, tsKey)
    }
    tableStoreKeys.set(table, storeKey)
  }
  const auditLogs = actual['auditLogs']

  const keyOf = (column: unknown): string => {
    const key = columnKeys.get(column)
    if (!key) throw new Error('fixture: columna desconocida en la condición')
    return key
  }

  const matches = (cond: Cond, row: Row): boolean => {
    switch (cond.kind) {
      case 'eq':
        return row[keyOf(cond.column)] === cond.value
      case 'and':
        return cond.conds.every((child) => matches(child, row))
      case 'or':
        return cond.conds.some((child) => matches(child, row))
      case 'isNull':
        return row[keyOf(cond.column)] === null || row[keyOf(cond.column)] === undefined
      case 'isNotNull':
        return row[keyOf(cond.column)] !== null && row[keyOf(cond.column)] !== undefined
      case 'gt': {
        const left = row[keyOf(cond.column)]
        const a = left instanceof Date ? left.getTime() : (left as number)
        const b = cond.value instanceof Date ? cond.value.getTime() : (cond.value as number)
        return typeof a === 'number' && a > b
      }
    }
  }

  const storeOf = (table: unknown): Row[] => {
    const storeKey = tableStoreKeys.get(table)
    if (!storeKey) return []
    return (fx as unknown as Record<string, Row[]>)[storeKey] ?? []
  }

  const execute = (store: Row[], cond: Cond | undefined, limit?: number, projection?: unknown): Promise<Row[]> => {
    let rows = store.filter((row) => (cond ? matches(cond, row) : true))
    if (limit !== undefined) rows = rows.slice(0, limit)
    // Sin proyección, referencias (drizzle devuelve las filas); con proyección,
    // objetos nuevos como haría el select con alias. El update muta referencias.
    return Promise.resolve(projection ? rows.map((row) => applyProjection(row, projection)) : rows)
  }

  /** Lo que drizzle haría con `select({ alias: columna })`: alias ← valor de la columna. */
  const applyProjection = (row: Row, projection: unknown): Row => {
    if (!projection || typeof projection !== 'object') return { ...row }
    return Object.fromEntries(Object.entries(projection).map(([key, column]) => [key, row[keyOf(column)]]))
  }

  const makeQuery = (table: unknown, projection?: unknown) => {
    if (!tableStoreKeys.has(table)) throw new Error('fixture: consulta sobre una tabla no preparada')
    return {
      where: (cond: Cond) => {
        const base = execute(storeOf(table), cond, undefined, projection)
        const chain = {
          limit: (n: number) => execute(storeOf(table), cond, n, projection),
          then: <T1 = Row[], T2 = never>(
            onfulfilled?: ((value: Row[]) => T1 | PromiseLike<T1>) | null,
            onrejected?: ((reason: unknown) => T2 | PromiseLike<T2>) | null,
          ) => base.then(onfulfilled, onrejected),
        }
        return chain
      },
    }
  }

  // Índice único parcial de member_functions: una fila vigente por persona y función.
  const conflictsWithActive = (store: Row[], vals: Row): boolean =>
    store.some(
      (row) =>
        row['organizationId'] === vals['organizationId'] &&
        row['userId'] === vals['userId'] &&
        row['functionKey'] === vals['functionKey'] &&
        (row['revokedAt'] === null || row['revokedAt'] === undefined),
    )

  const doInsert = (store: Row[], vals: Row, projection?: unknown): Promise<Row[]> => {
    const row = { id: crypto.randomUUID(), createdAt: new Date(), ...vals }
    store.push(row)
    return Promise.resolve([applyProjection(row, projection)])
  }

  // Los builders de drizzle son thenables perezosos: se ejecutan al.await-earse
  // o al llamar returning/onConflictDoNothing. Cada `then` dispara su propia
  // corrida para no ejecutar dos veces la misma cadena.
  const makeTx = () => ({
    insert: (table: unknown) => ({
      values: (vals: Row) => {
        const run = (noop: boolean, projection?: unknown): Promise<Row[]> => {
          if (table === auditLogs) {
            if (fx.failAudit) return Promise.reject(new Error('audit unavailable'))
            fx.audits.push({ via: 'tx', values: vals })
            return Promise.resolve([])
          }
          if (noop && conflictsWithActive(storeOf(table), vals)) return Promise.resolve([])
          return doInsert(storeOf(table), vals, projection)
        }
        const step = (noop: boolean) => ({
          onConflictDoNothing: () => step(true),
          returning: (projection?: unknown) => run(noop, projection),
          then: <T1 = Row[], T2 = never>(
            onfulfilled?: ((value: Row[]) => T1 | PromiseLike<T1>) | null,
            onrejected?: ((reason: unknown) => T2 | PromiseLike<T2>) | null,
          ) => run(noop).then(onfulfilled, onrejected),
        })
        return step(false)
      },
    }),
    update: (table: unknown) => ({
      set: (vals: Row) => ({
        where: (cond: Cond) => {
          const run = (projection?: unknown): Promise<Row[]> =>
            execute(storeOf(table), cond).then((rows) => {
              for (const row of rows) Object.assign(row, vals)
              return rows.map((row) => applyProjection(row, projection))
            })
          return {
            returning: (projection?: unknown) => run(projection),
            then: <T1 = Row[], T2 = never>(
              onfulfilled?: ((value: Row[]) => T1 | PromiseLike<T1>) | null,
              onrejected?: ((reason: unknown) => T2 | PromiseLike<T2>) | null,
            ) => run().then(onfulfilled, onrejected),
          }
        },
      }),
    }),
    select: (projection?: unknown) => ({ from: (table: unknown) => makeQuery(table, projection) }),
  })

  const fakeDb = {
    select: (projection?: unknown) => ({ from: (table: unknown) => makeQuery(table, projection) }),
    selectDistinct: (projection?: unknown) => ({ from: (table: unknown) => makeQuery(table, projection) }),
    query: {
      // findFirst evalúa la condición: resolve-org busca por clerk_org_id y la
      // ruta de modo relee por id tras perder la carrera del plazo.
      organizations: {
        findFirst: ({ where }: { where?: Cond }) => execute(storeOf(actual['organizations']), where, 1).then((rows) => rows[0]),
      },
      studies: { findFirst: ({ where }: { where?: Cond }) => execute(fx.studyRows, where, 1).then((rows) => rows[0]) },
    },
    transaction: async <T>(run: (tx: unknown) => Promise<T>): Promise<T> => {
      fx.transactions += 1
      const snapshot = structuredClone({
        orgRows: fx.orgRows,
        studyRows: fx.studyRows,
        memberFunctionRows: fx.memberFunctionRows,
        membershipRows: fx.membershipRows,
        evolutionRows: fx.evolutionRows,
        audits: fx.audits,
      })
      try {
        return await run(makeTx())
      } catch (err) {
        Object.assign(fx, snapshot)
        // El clon restauró orgRows con otra referencia: `org` vuelve a apuntar
        // a la fila de la tabla, no a la mutada y descartada.
        fx.org = fx.orgRows[0] ?? fx.org
        throw err
      }
    },
  }

  return {
    ...actual,
    db: fakeDb,
    // Operadores inspeccionables: los módulos bajo prueba los reciben por acá
    // (team-service) o por 'drizzle-orm' (validadores de packages/auth).
    and,
    eq,
    or,
    gt,
    isNull,
    isNotNull,
  }
}
