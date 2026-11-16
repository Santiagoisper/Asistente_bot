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

function toDate(instant: Date | string): Date {
  return typeof instant === 'string' ? new Date(instant) : instant
}

/** Lo que marca el reloj de esa zona en ese instante, parte por parte (`'day'`, `'hour'`…). */
function clockIn(date: Date, timeZone: string): (part: Intl.DateTimeFormatPartTypes) => string {
  const parts = formatterFor(timeZone).formatToParts(date)
  return (type) => parts.find((part) => part.type === type)?.value ?? ''
}

/**
 * Fecha y hora de un registro, para mostrar: `15/11/2026, 17:38:49`.
 *
 * Siempre en 24 horas y en la hora del centro. `toLocaleString('es-AR')` no sirve para esto: usa 12
 * horas, hay navegadores que lo imprimen sin «a. m./p. m.», y en una página que se arma en el
 * servidor da la hora UTC. En un registro clínico, «05:38» por las 17:38 es un dato mal mostrado.
 *
 * La zona es obligatoria y la pasa quien llama: es la de la organización (`loadOrgTimeZone`), la
 * misma que usan la Agenda y el Inicio. Una página del servidor la carga; un componente del
 * navegador la recibe de su página. Nunca la del navegador, y sin valor por defecto: con uno,
 * una pantalla que se olvida de pasarla queda en esa zona y ninguna prueba lo nota mientras
 * todos los centros estén en la misma.
 */
export function formatDateTime(instant: Date | string, timeZone: string): string {
  const clock = clockIn(toDate(instant), timeZone)
  return `${clock('day')}/${clock('month')}/${clock('year')}, ${clock('hour')}:${clock('minute')}:${clock('second')}`
}

/**
 * Diferencia de esa zona con UTC en ese instante: `UTC−3`, `UTC+5:30`, `UTC`. Es la de ese día
 * (una zona con cambio de hora no tiene una sola). Se calcula con el reloj de la zona, no con el
 * nombre que le da cada sistema, que cambia con el idioma y con la versión.
 */
export function utcOffsetLabel(instant: Date | string, timeZone: string): string {
  const date = toDate(instant)
  const clock = clockIn(date, timeZone)
  const asUtc = Date.UTC(Number(clock('year')), Number(clock('month')) - 1, Number(clock('day')), Number(clock('hour')), Number(clock('minute')), Number(clock('second')))
  const wholeSeconds = Math.floor(date.getTime() / 1000) * 1000
  const minutes = Math.round((asUtc - wholeSeconds) / 60_000)
  if (minutes === 0) return 'UTC'
  const absolute = Math.abs(minutes)
  const rest = absolute % 60
  return `UTC${minutes < 0 ? '−' : '+'}${Math.floor(absolute / 60)}${rest ? `:${String(rest).padStart(2, '0')}` : ''}`
}

/**
 * La hora de un registro con su zona a la vista: `15/11/2026, 17:38:49 (UTC−3)`. Para el
 * registro de auditoría: quien audita no tiene que adivinar en qué hora está la traza.
 */
export function formatDateTimeWithZone(instant: Date | string, timeZone: string): string {
  return `${formatDateTime(instant, timeZone)} (${utcOffsetLabel(instant, timeZone)})`
}
