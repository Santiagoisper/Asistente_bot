export const OS_TIME_ZONE = 'America/Argentina/Buenos_Aires'

export type Greeting = 'Buen día' | 'Buenas tardes' | 'Buenas noches'

/** Hora local (0-23) en la zona horaria de presentación. */
export function localHour(now: Date, timeZone: string = OS_TIME_ZONE): number {
  const hour = new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', hourCycle: 'h23' }).format(now)
  return Number(hour)
}

/** 05:00–11:59 día, 12:00–19:59 tardes, resto noches. */
export function greetingFor(now: Date, timeZone: string = OS_TIME_ZONE): Greeting {
  const hour = localHour(now, timeZone)
  if (hour >= 5 && hour < 12) return 'Buen día'
  if (hour >= 12 && hour < 20) return 'Buenas tardes'
  return 'Buenas noches'
}

/** "martes 10 de noviembre" en la zona horaria de presentación. */
export function longDate(now: Date, timeZone: string = OS_TIME_ZONE): string {
  return new Intl.DateTimeFormat('es-AR', { timeZone, weekday: 'long', day: 'numeric', month: 'long' }).format(now)
}

/** "hace 3 días", "hace 2 h", "recién". Para antigüedad de pendientes. */
export function sinceLabel(since: Date | null, now: Date): string {
  if (!since) return 'sin fecha'
  const minutes = Math.floor((now.getTime() - since.getTime()) / 60_000)
  if (minutes < 60) return 'recién'
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `hace ${hours} h`
  const days = Math.floor(hours / 24)
  return days === 1 ? 'hace 1 día' : `hace ${days} días`
}
