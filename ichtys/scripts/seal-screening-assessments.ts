/**
 * Sellado de las evaluaciones de elegibilidad anteriores al cifrado (brecha C3, regla R5).
 *
 * Desde el 14/11/2026 cada instantánea nueva de `screening_assessments` se guarda cifrada
 * (`apps/web/lib/subjects/screening-crypto.ts`). Este script cifra las filas anteriores,
 * que quedaron en claro. Es un trabajo de operación que se hace una vez por base: por eso
 * es un script y no una ruta de la aplicación.
 *
 * Qué hace con `--apply`:
 *   - Exige `--confirm-host <host>` igual al host de DATABASE_URL: quien lo corre confirma a
 *     qué base apunta. El host sale en la corrida sin `--apply`. Si no coincide, no escribe.
 *   - Antes de la primera tanda comprueba que hay clave y que es la de esa base (descifra
 *     perfiles y evaluaciones ya selladas). Si no puede comprobarlo, no escribe nada.
 *   - Elige las filas por la forma del dato (una columna que no es un sobre), en tandas,
 *     con `FOR UPDATE SKIP LOCKED` para no chocar con una evaluación que se esté guardando.
 *   - Sella, abre lo sellado y lo compara con el original. Si una fila no vuelve igual, la
 *     tanda entera se cancela y la corrida termina.
 *   - Escribe solo `assessments` y `summary`. No toca fechas, versión del protocolo ni nada más.
 *   - En la misma transacción deja un registro de auditoría por organización: `admin.action`,
 *     metadata `screening_assessments_encrypted_at_rest`, con cantidades y el responsable
 *     pasado en `--operator`. El registro dice que se cifró y que el contenido no cambió.
 *
 * Se puede repetir: una fila ya sellada no se vuelve a elegir. No imprime contenido clínico,
 * solo cantidades. Sin `--apply` no escribe ni lee contenido: cuenta.
 *
 * Lo que no resuelve: lo que estuvo en claro sigue en el historial y en los respaldos de la
 * base hasta que venza su retención (ver C3 en docs/compliance/REGULATORY-BASELINE.md).
 *
 * Uso:
 *   npx tsx@4.19.2 scripts/seal-screening-assessments.ts
 *       cuenta y muestra el host de destino; no escribe
 *   npx tsx@4.19.2 scripts/seal-screening-assessments.ts --apply --operator <userId> --confirm-host <host>
 *       escribe
 *   ... --batch <n>   filas por tanda (por defecto 200)
 *
 * `--operator` es el identificador de usuario de quien responde por la corrida, el mismo que
 * figura en el resto de los registros de auditoría; no un nombre.
 *
 * Requiere DATABASE_URL y PHI_ENCRYPTION_KEY (se leen de apps/web/.env.local si no están en
 * el entorno). Primero en la base de prueba; en producción, con autorización expresa.
 *
 * Salida: 0 sin nada pendiente; 2 si quedaron filas en claro (bloqueadas por otra escritura)
 * o columnas con un sobre que no es de esta versión; 1 si la corrida falló o no se pudo empezar.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const envPath = join(__dirname, '../apps/web/.env.local')
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eqIdx = trimmed.indexOf('=')
    if (eqIdx === -1) continue
    const key = trimmed.slice(0, eqIdx)
    const value = trimmed.slice(eqIdx + 1)
    if (!process.env[key]) process.env[key] = value
  }
}

const TAG = '[seal-screening-assessments]'
const DEFAULT_BATCH = 200
const KEY_SAMPLES = 5

/** Valor del argumento que sigue a `flag`, o null si falta. */
function readArg(argv: string[], flag: string): string | null {
  const idx = argv.indexOf(flag)
  if (idx === -1) return null
  const value = argv[idx + 1]
  return value && !value.startsWith('--') ? value : null
}

function readBatchSize(argv: string[]): number | null {
  if (!argv.includes('--batch')) return DEFAULT_BATCH
  const parsed = Number(readArg(argv, '--batch'))
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 1000 ? parsed : null
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply')
  const operator = readArg(process.argv, '--operator')
  const batchSize = readBatchSize(process.argv)
  if (apply && !operator) {
    console.error(`${TAG} --apply exige --operator <userId>: quién responde por la corrida.`)
    process.exitCode = 1
    return
  }
  if (apply && !readArg(process.argv, '--confirm-host')) {
    console.error(`${TAG} --apply exige --confirm-host <host>: el host de la base, como lo muestra la corrida sin --apply.`)
    process.exitCode = 1
    return
  }
  if (batchSize === null) {
    console.error(`${TAG} --batch tiene que ser un entero entre 1 y 1000.`)
    process.exitCode = 1
    return
  }

  const { PhiConfigError } = await import('../apps/web/lib/subjects/phi-fields')
  const { sealScreeningJson } = await import('../apps/web/lib/subjects/screening-crypto')
  const { checkKeyAgainstStored, countRowsByOrg, databaseHostOf, planRowSeal, sealAuditEntry } = await import(
    '../apps/web/lib/subjects/screening-seal'
  )

  // A qué base apunta: se confirma antes de abrirla. Sin usuario ni contraseña.
  const host = databaseHostOf(process.env.DATABASE_URL)
  if (host === null) {
    console.error(`${TAG} DATABASE_URL falta o no es una dirección: no se abre ninguna base.`)
    process.exitCode = 1
    return
  }
  if (apply && readArg(process.argv, '--confirm-host')?.toLowerCase() !== host) {
    console.error(`${TAG} --confirm-host no coincide con la base de destino (${host}): no se escribe nada.`)
    process.exitCode = 1
    return
  }

  // Si falta la clave se corta acá, antes de abrir la base y de la primera tanda.
  if (apply) {
    try {
      sealScreeningJson({ probe: true })
    } catch (err) {
      if (!(err instanceof PhiConfigError)) throw err
      console.error(`${TAG} falta PHI_ENCRYPTION_KEY: no se escribe nada.`)
      process.exitCode = 1
      return
    }
  }

  const { count, db, eq, patientProfiles, screeningAssessments, sql } = await import('../packages/db/index')
  const { insertAuditLog } = await import('../apps/web/lib/audit/audited-write')

  const cols = screeningAssessments
  // La forma del dato decide: un sobre es un objeto con `enc` y `ciphertext`.
  const assessmentsIsEnvelope = sql`(jsonb_typeof(${cols.assessments}) = 'object' AND jsonb_exists(${cols.assessments}, 'enc') AND jsonb_exists(${cols.assessments}, 'ciphertext'))`
  const summaryIsEnvelope = sql`(jsonb_typeof(${cols.summary}) = 'object' AND jsonb_exists(${cols.summary}, 'enc') AND jsonb_exists(${cols.summary}, 'ciphertext'))`
  const hasPlainColumn = sql`(NOT ${assessmentsIsEnvelope} OR NOT ${summaryIsEnvelope})`
  const hasForeignEnvelope = sql`((${assessmentsIsEnvelope} AND ${cols.assessments}->>'enc' IS DISTINCT FROM 'phi.v1') OR (${summaryIsEnvelope} AND ${cols.summary}->>'enc' IS DISTINCT FROM 'phi.v1'))`
  const assessmentsSealed = sql`(${assessmentsIsEnvelope} AND ${cols.assessments}->>'enc' = 'phi.v1')`

  const countPlainByOrg = () =>
    db
      .select({ organizationId: cols.organizationId, rows: count() })
      .from(cols)
      .where(hasPlainColumn)
      .groupBy(cols.organizationId)
  const countWhere = async (where?: ReturnType<typeof sql>): Promise<number> => {
    const base = db.select({ n: count() }).from(cols)
    const [row] = await (where ? base.where(where) : base)
    return row?.n ?? 0
  }
  const sum = (counts: { rows: number }[]) => counts.reduce((total, c) => total + c.rows, 0)

  const plainBefore = await countPlainByOrg()
  const pendingBefore = sum(plainBefore)
  const total = await countWhere()

  if (!apply) {
    console.log(
      JSON.stringify({
        mode: 'dry-run',
        host,
        rows: total,
        plain: pendingBefore,
        organizationsWithPlain: plainBefore.length,
        foreignEnvelope: await countWhere(hasForeignEnvelope),
      }),
    )
    return
  }

  if (pendingBefore > 0) {
    // La clave de la corrida tiene que ser la de esta base: sellar con otra deja las filas
    // ilegibles para la aplicación.
    const profileSamples = await db
      .select({ payload: patientProfiles.profileEncrypted })
      .from(patientProfiles)
      .limit(KEY_SAMPLES)
    const sealedSamples = await db
      .select({ payload: sql<string>`${cols.assessments}->>'ciphertext'` })
      .from(cols)
      .where(assessmentsSealed)
      .limit(KEY_SAMPLES)
    const keyCheck = checkKeyAgainstStored([...profileSamples, ...sealedSamples].map((s) => s.payload))
    if (keyCheck !== 'ok') {
      console.error(
        keyCheck === 'mismatch'
          ? `${TAG} la clave de este entorno no descifra lo que la base ya tiene cifrado: no se escribe nada.`
          : `${TAG} la base no tiene nada cifrado contra qué comprobar la clave: no se escribe nada.`,
      )
      process.exitCode = 1
      return
    }
  }

  let sealed = 0
  let batches = 0
  const organizations = new Set<string>()

  for (;;) {
    const written = await db.transaction(async (tx) => {
      const rows = await tx
        .select({
          id: cols.id,
          organizationId: cols.organizationId,
          assessments: cols.assessments,
          summary: cols.summary,
        })
        .from(cols)
        .where(hasPlainColumn)
        .orderBy(cols.id)
        .limit(batchSize)
        .for('update', { skipLocked: true })

      const writtenRows: { organizationId: string }[] = []
      for (const row of rows) {
        // Tira si lo sellado no vuelve igual: la transacción se revierte y la tanda no queda.
        const plan = planRowSeal(row)
        if (Object.keys(plan.set).length === 0) continue
        // Solo las columnas selladas. Ninguna otra columna de la fila se toca.
        await tx.update(cols).set(plan.set).where(eq(cols.id, row.id))
        writtenRows.push({ organizationId: row.organizationId })
      }
      // Dato y registro en la misma transacción (R3): un registro por organización.
      for (const orgCount of countRowsByOrg(writtenRows)) {
        await insertAuditLog(tx, sealAuditEntry(orgCount, operator ?? ''))
      }
      return writtenRows
    })

    if (written.length === 0) break
    sealed += written.length
    batches += 1
    for (const row of written) organizations.add(row.organizationId)
  }

  const remaining = sum(await countPlainByOrg())
  const foreignEnvelope = await countWhere(hasForeignEnvelope)
  console.log(
    JSON.stringify({
      mode: 'apply',
      host,
      rows: total,
      plainBefore: pendingBefore,
      sealed,
      batches,
      organizations: organizations.size,
      remaining,
      foreignEnvelope,
    }),
  )
  if (remaining > 0 || foreignEnvelope > 0) process.exitCode = 2
}

main().catch((err: unknown) => {
  // Sin contenido: el nombre del error y, si es de ida y vuelta, la fila y la columna.
  const name = err instanceof Error ? err.name : 'error'
  const detail =
    err instanceof Error && err.name === 'ScreeningSealRoundTripError' ? ` ${err.message}. La tanda no se escribió.` : ''
  console.error(`${TAG} falló: ${name}.${detail}`)
  process.exitCode = 1
})
