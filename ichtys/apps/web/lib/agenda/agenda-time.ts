/**
 * Fechas de la Agenda. Un turno se guarda como instante (UTC) y se muestra en
 * la hora del sitio. "Hoy" es el día del sitio, no el del servidor.
 */
export const DEFAULT_SITE_TIMEZONE = 'America/Argentina/Buenos_Aires'

/** La zona pedida si es una zona IANA válida; si no, la de respaldo. */
export function resolveTimeZone(candidate: unknown, fallback: string): string {
  const zone = typeof candidate === 'string' ? candidate.trim() : ''
  if (!zone) return fallback
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: zone })
    return zone
  } catch {
    return fallback
  }
}

/** Zona de la instalación. La de cada centro sale de su organización (`loadOrgTimeZone`). */
export function siteTimeZone(): string {
  return resolveTimeZone(process.env.SITE_TIMEZONE, DEFAULT_SITE_TIMEZONE)
}

const DAY_KEY = /^(\d{4})-(\d{2})-(\d{2})$/
const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/

/** "2026-11-16": un día real del calendario. */
export function isDayKey(value: string): boolean {
  const match = DAY_KEY.exec(value)
  if (!match) return false
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])]
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

export function isTimeOfDay(value: string): boolean {
  return TIME.test(value)
}

function partsInZone(instant: Date, timeZone: string): { year: number; month: number; day: number; hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(instant)
  const read = (type: string): number => Number(parts.find((part) => part.type === type)?.value ?? '0')
  return { year: read('year'), month: read('month'), day: read('day'), hour: read('hour'), minute: read('minute') }
}

const pad = (value: number): string => String(value).padStart(2, '0')

/** Día del calendario del sitio en el que cae un instante. */
export function dayKeyInZone(instant: Date, timeZone: string): string {
  const { year, month, day } = partsInZone(instant, timeZone)
  return `${year}-${pad(month)}-${pad(day)}`
}

export function timeInZone(instant: Date, timeZone: string): string {
  const { hour, minute } = partsInZone(instant, timeZone)
  return `${pad(hour)}:${pad(minute)}`
}

/** Instante que corresponde a un día y una hora del sitio. */
export function zonedToUtc(dayKey: string, time: string, timeZone: string): Date {
  if (!isDayKey(dayKey) || !isTimeOfDay(time)) throw new RangeError('fecha u hora inválida')
  const [year, month, day] = dayKey.split('-').map(Number) as [number, number, number]
  const [hour, minute] = time.split(':').map(Number) as [number, number]
  const wanted = Date.UTC(year, month - 1, day, hour, minute)
  // Se corrige dos veces: alcanza para cualquier cambio de hora.
  let guess = wanted
  for (let pass = 0; pass < 2; pass += 1) {
    const seen = partsInZone(new Date(guess), timeZone)
    guess += wanted - Date.UTC(seen.year, seen.month - 1, seen.day, seen.hour, seen.minute)
  }
  return new Date(guess)
}

export function addDays(dayKey: string, days: number): string {
  const [year, month, day] = dayKey.split('-').map(Number) as [number, number, number]
  const date = new Date(Date.UTC(year, month - 1, day + days))
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`
}

/** Principio y fin (exclusivo) de un día del sitio, como instantes. */
export function dayRange(dayKey: string, timeZone: string): { start: Date; end: Date } {
  return { start: zonedToUtc(dayKey, '00:00', timeZone), end: zonedToUtc(addDays(dayKey, 1), '00:00', timeZone) }
}

/** Los siete días, de lunes a domingo, de la semana que contiene al día. */
export function weekOf(dayKey: string): string[] {
  const [year, month, day] = dayKey.split('-').map(Number) as [number, number, number]
  const weekday = (new Date(Date.UTC(year, month - 1, day)).getUTCDay() + 6) % 7
  const monday = addDays(dayKey, -weekday)
  return Array.from({ length: 7 }, (_, index) => addDays(monday, index))
}

const WEEKDAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'] as const
const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'] as const

/** "lunes 16 de noviembre" */
export function dayLabel(dayKey: string): string {
  const [year, month, day] = dayKey.split('-').map(Number) as [number, number, number]
  return `${WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()]} ${day} de ${MONTHS[month - 1]}`
}

/** "lun 16" */
export function shortDayLabel(dayKey: string): string {
  const [year, month, day] = dayKey.split('-').map(Number) as [number, number, number]
  return `${WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()]!.slice(0, 3)} ${day}`
}
