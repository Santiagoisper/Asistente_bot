/**
 * La fecha de la muestra de un informe de laboratorio (C4, decisiones D2 y D3 de
 * docs/decisions/huella-y-procedencia-de-archivos.md).
 *
 * El lector **propone**; la confirma una persona. Solo propone desde un renglón que diga
 * extracción, toma o muestra. Emisión, informe, recepción, ingreso y validación son otras
 * fechas, y un «Fecha:» a secas no dice cuál es. El rótulo puede venir sin la palabra «fecha»
 * («Toma de muestra: …», «Extracción: …») o abreviado («F. extracción: …»). Nunca se completa con la fecha de carga: una
 * fecha inventada haría pasar por vigente un valor viejo.
 *
 * Puro y sin dependencias: lo usan el navegador y el servidor.
 */
const SAMPLE_DATE_LINE =
  /^\s*(?:fecha\s*(?:y\s+hora\s+)?|f\.\s*)?(?:de\s+)?(?:la\s+)?(?:extracci[oó]n|toma(?:\s+de\s+(?:la\s+)?muestra)?|muestra)\s*[:.]?\s*(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})(?:\s+\d{1,2}[:.]\d{2}(?::\d{2})?(?:\s*hs?\.?)?)?\s*$/i

const pad = (value: number): string => String(value).padStart(2, '0')

/** `YYYY-MM-DD` si día, mes y año forman una fecha que existe. El orden es día/mes/año. */
function isoDate(day: number, month: number, year: number): string | null {
  const fullYear = year < 100 ? 2000 + year : year
  const date = new Date(Date.UTC(fullYear, month - 1, day))
  if (date.getUTCFullYear() !== fullYear || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null
  return `${fullYear}-${pad(month)}-${pad(day)}`
}

/**
 * La fecha de muestra que traen los renglones del informe, o `null`. Si hay dos distintas no
 * elige: no propone ninguna y la persona la escribe. Con `today` (`YYYY-MM-DD`) descarta las
 * que no se podrían confirmar (futuras o anteriores a 1900).
 */
export function proposeSampleDate(lines: readonly string[], today?: string): string | null {
  const found = new Set<string>()
  for (const line of lines) {
    const match = SAMPLE_DATE_LINE.exec(line)
    if (!match) continue
    const iso = isoDate(Number(match[1]), Number(match[2]), Number(match[3]))
    // Con `today`, no se propone lo que después no se podría confirmar: «24/09/98» leído como 2098.
    if (iso && (today === undefined || acceptableSampleDate(iso, today))) found.add(iso)
  }
  return found.size === 1 ? [...found][0]! : null
}

/**
 * Lo que una persona puede confirmar como fecha de muestra: `YYYY-MM-DD`, que exista, no
 * futura y no anterior a 1900. `today` es `YYYY-MM-DD`; se acepta hasta el día siguiente porque
 * quien confirma puede estar en una zona horaria donde ya es mañana.
 */
export function acceptableSampleDate(value: string, today: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return false
  const iso = isoDate(Number(match[3]), Number(match[2]), Number(match[1]))
  if (iso !== value || Number(match[1]) < 1900) return false
  const latest = latestSampleDate(today)
  return latest !== null && value <= latest
}

/**
 * La última fecha de muestra que se acepta: el día siguiente a `today` (día UTC). Es el mismo
 * límite para el validador y para el calendario de la pantalla: si el calendario ofreciera menos,
 * quien está en una zona horaria adelantada no podría elegir la fecha de hoy.
 */
export function latestSampleDate(today: string): string | null {
  const limit = new Date(`${today}T00:00:00Z`)
  if (Number.isNaN(limit.getTime())) return null
  limit.setUTCDate(limit.getUTCDate() + 1)
  return limit.toISOString().slice(0, 10)
}
