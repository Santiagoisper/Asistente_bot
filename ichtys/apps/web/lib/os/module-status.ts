import type { ModuleCounter, ModuleStatus, OsModule } from '@ichtys/integrations'

export type StatusTone = 'ok' | 'idle' | 'warn' | 'error'

export interface StatusCopy {
  label: string
  tone: StatusTone
  /** Qué significa y qué hacer, en una línea. */
  hint: string
}

export const MODULE_TITLES: Record<OsModule, string> = {
  queries: 'Queries',
  viaticos: 'Viáticos',
  operacion: 'Operación',
}

export const MODULE_ROUTES: Record<OsModule, string> = {
  queries: '/queries',
  viaticos: '/viaticos',
  operacion: '/operacion',
}

const COPY: Record<ModuleStatus, StatusCopy> = {
  ok: { label: 'Conectado', tone: 'ok', hint: 'Datos al día.' },
  not_configured: {
    label: 'Sin conectar',
    tone: 'idle',
    hint: 'Este sistema todavía no está enlazado con el OS.',
  },
  unreachable: {
    label: 'Sin respuesta',
    tone: 'error',
    hint: 'El sistema no respondió a tiempo. Se reintenta al recargar.',
  },
  unauthorized: {
    label: 'Acceso rechazado',
    tone: 'error',
    hint: 'El sistema no aceptó la credencial del OS. Revisar la clave pública configurada.',
  },
  invalid_response: {
    label: 'Respuesta inválida',
    tone: 'warn',
    hint: 'El sistema respondió con un formato que el OS no reconoce.',
  },
}

export function statusCopy(status: ModuleStatus): StatusCopy {
  return COPY[status]
}

const count = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 })
const percent = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 1 })
const usd = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2, minimumFractionDigits: 0 })

/** Los montos van siempre en dólares estadounidenses y se rotulan como tales. */
export function formatCounter(counter: Pick<ModuleCounter, 'value' | 'unit'>): string {
  if (counter.unit === 'usd') return `USD ${usd.format(counter.value)}`
  if (counter.unit === 'percent') return `${percent.format(counter.value)} %`
  return count.format(counter.value)
}
