import { OS_TIME_ZONE } from './greeting'

const formatters = new Map<string, Intl.DateTimeFormat>()

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('es-AR', {
      timeZone,
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    })
    formatters.set(timeZone, formatter)
  }
  return formatter
}

/**
 * Fecha y hora de un registro, para mostrar: `15/11/2026, 17:38:49`.
 *
 * Siempre en 24 horas y en la hora del sitio. `toLocaleString('es-AR')` no sirve para esto: usa 12
 * horas, hay navegadores que lo imprimen sin «a. m./p. m.», y en una página que se arma en el
 * servidor da la hora UTC. En un registro clínico, «05:38» por las 17:38 es un dato mal mostrado.
 */
export function formatDateTime(instant: Date | string, timeZone: string = OS_TIME_ZONE): string {
  const date = typeof instant === 'string' ? new Date(instant) : instant
  const parts = formatterFor(timeZone).formatToParts(date)
  const read = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? ''
  return `${read('day')}/${read('month')}/${read('year')}, ${read('hour')}:${read('minute')}:${read('second')}`
}
