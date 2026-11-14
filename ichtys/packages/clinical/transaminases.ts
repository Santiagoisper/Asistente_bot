import { parseDecimal } from './lab-utils'
import { formatClinicalNumber } from './numeric-criteria'
import type { CriterionAssessment, LabObservation, PatientProfile } from './profile-schema'

/**
 * Transaminasas contra «N veces el límite superior normal».
 *
 * El límite superior no es un número fijo: lo imprime cada laboratorio al lado del valor, y
 * cambia con el método y con el laboratorio. Por eso esta regla solo decide con el valor Y el
 * rango de referencia que una persona confirmó al cargar el informe. Si falta alguno de los
 * dos, si el rango no es un solo límite claro (por ejemplo, uno por sexo) o si el criterio
 * pide algo más, queda a revisar y dice por qué. No se usa ningún límite «típico».
 */

const NUMBER = '(\\d+(?:[.,]\\d+)?)'
/**
 * Después del número solo puede venir una unidad de actividad. Cualquier otra palabra pegada
 * («hasta 41 Hombres», «hasta 40 Cinético», «adultos») puede ser un rango por sexo o por edad
 * cortado, o la columna del método: no alcanza para saber que el límite vale para este sujeto.
 */
const UNIT = '(?:\\s*(?:m?U|m?UI|IU)\\s*/\\s*(?:L|mL))?'
const UP_TO = new RegExp(`^(?:hasta|<=|<|≤|menor\\s+(?:a|de|que)|inferior\\s+a)\\s*${NUMBER}${UNIT}$`, 'i')
const BETWEEN = new RegExp(`^${NUMBER}\\s*(?:-|–|a)\\s*${NUMBER}${UNIT}$`, 'i')

/**
 * El límite superior de un rango de referencia impreso: «hasta 40», «10 - 40», «< 41».
 * Devuelve null si el texto no es exactamente un solo límite («Hombres: hasta 41 · Mujeres:
 * hasta 31», «hasta 40 Cinético», «ver informe», «> 60»): ante la duda no se adivina.
 */
export function upperLimitOfNormal(range: string | null | undefined): number | null {
  const text = (range ?? '').trim()
  if (text.length === 0) return null
  // «4.000 - 10.000», «hasta 1.000»: un punto seguido de tres cifras puede ser separador de
  // miles o decimal. Leerlo mal cambia el límite por mil.
  if (/\d\.\d{3}(?!\d)/.test(text)) return null
  const upTo = text.match(UP_TO)
  if (upTo) return parseDecimal(upTo[1]!)
  const between = text.match(BETWEEN)
  if (between) {
    const low = parseDecimal(between[1]!)
    const high = parseDecimal(between[2]!)
    return high > low ? high : null
  }
  return null
}

const ENZYMES = [
  { key: 'ALT', pattern: /\b(?:ALT|ALAT|TGP|GPT)\b|alanina/i },
  { key: 'AST', pattern: /\b(?:AST|ASAT|TGO|GOT)\b|aspartato/i },
] as const
const BOTH = /transaminasas?|aminotransferasas?|transaminases?/i
const MULTIPLE = new RegExp(`${NUMBER}\\s*(?:veces|x|×|times)\\s*(?:(?:el|the|su)\\s+)?(?:l[ií]mite\\s+superior|LSN|ULN|upper\\s+limit)`, 'i')
const INCLUSIVE = /mayor(?:es)?\s+o\s+igual(?:es)?|igual(?:es)?\s+o\s+mayor(?:es)?|≥|>=|greater\s+than\s+or\s+equal|at\s+least/i
/** Actividad enzimática: U/L, UI/L, IU/L. Con otra unidad el valor no se puede comparar con su rango. */
const ACTIVITY_UNIT = /^(?:m?U|m?UI|IU)\s*\/\s*(?:L|mL)$/i

/** Palabras de un criterio de transaminasas que no piden nada más que el valor contra su límite. */
const CRITERION_WORDS = new Set(
  ('alt alat tgp gpt ast asat tgo got alanina aspartato aminotransferasa aminotransferasas transaminasa transaminasas transaminase transaminases ' +
    'o or y and u e mayor mayores superior superiores igual iguales a al de del el la los las que veces x times the than greater limite upper limit of normal ' +
    'lsn uln valor valores nivel niveles serica sericas serico sericos serum level levels su es son por encima above mas').split(' '),
)

function asksBeyondTheLimit(criterionText: string): boolean {
  const words = criterionText
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .split(/[^a-z]+/)
    .filter((word) => word.length > 0)
  return words.some((word) => !CRITERION_WORDS.has(word))
}

/**
 * «ALT o AST», «ALT y/o AST», «ALT/AST»: el criterio dice de forma expresa que alcanza con
 * una sola enzima por encima. Se mira solo lo que une a las dos enzimas, para no leer el «o»
 * de «mayor o igual» ni la barra de un alias. Con «y», con una coma o con «transaminasas» a secas el criterio no lo
 * dice: ahí una sola por encima no se decide sola.
 */
const EITHER = /^(?:o|u|or|y\s*\/\s*o|e\s*\/\s*o|and\s*\/\s*or|\/)$/i
function saysEitherIsEnough(criterionText: string): boolean {
  const spans = ENZYMES.flatMap((enzyme) => {
    const found = enzyme.pattern.exec(criterionText)
    return found ? [{ start: found.index, end: found.index + found[0].length }] : []
  }).sort((a, b) => a.start - b.start)
  if (spans.length < 2) return false
  // Lo que une a las dos enzimas, sin los alias entre paréntesis («ALT (TGP/GPT) y AST»): tiene
  // que ser exactamente un «o». Una barra o una «o» adentro de un paréntesis no las une.
  const joint = criterionText
    .slice(spans[0]!.end, spans[1]!.start)
    .replace(/\([^)]*\)/g, ' ')
    .trim()
  return EITHER.test(joint)
}

/** «Relación AST/ALT», «índice de De Ritis»: nombra una enzima pero no es su valor. */
const RATIO = /relaci[oó]n|ratio|cociente|[ií]ndice/i
const isEnzymeValue = (name: string, enzyme: (typeof ENZYMES)[number]): boolean =>
  enzyme.pattern.test(name) && !RATIO.test(name) && ENZYMES.every((other) => other === enzyme || !other.pattern.test(name))

type Reading =
  | { key: string; kind: 'no-value' }
  | { key: string; kind: 'several' }
  | { key: string; kind: 'no-limit'; lab: LabObservation }
  | { key: string; kind: 'measured'; lab: LabObservation; limit: number; exceeds: boolean }

export function assessTransaminaseCriterion(
  criterion: { number: string; text: string; sourcePages?: number[] },
  kind: 'inclusion' | 'exclusion',
  profile: PatientProfile,
): CriterionAssessment | null {
  if (kind !== 'exclusion') return null
  const multiple = criterion.text.match(MULTIPLE)
  if (!multiple) return null
  const asked = BOTH.test(criterion.text) ? [...ENZYMES] : ENZYMES.filter((enzyme) => enzyme.pattern.test(criterion.text))
  if (asked.length === 0) return null

  const times = parseDecimal(multiple[1]!)
  const inclusive = INCLUSIVE.test(criterion.text)
  const readings: Reading[] = asked.map((enzyme) => {
    const found = profile.labs.filter((entry) => isEnzymeValue(entry.name, enzyme))
    const lab = found[0]
    if (!lab) return { key: enzyme.key, kind: 'no-value' }
    // Dos valores de la misma enzima bajo nombres distintos: elegir uno sería adivinar cuál vale.
    if (found.length > 1) return { key: enzyme.key, kind: 'several' }
    // Un valor sin unidad se compara igual: el valor y su rango salen de la misma fila del mismo
    // informe, así que comparten unidad. Lo que frena es una unidad escrita que no sea de actividad.
    const upper = upperLimitOfNormal(lab.referenceRange)
    if (upper === null || (lab.unit !== undefined && !ACTIVITY_UNIT.test(lab.unit.trim()))) return { key: enzyme.key, kind: 'no-limit', lab }
    const limit = times * upper
    return { key: enzyme.key, kind: 'measured', lab, limit, exceeds: inclusive ? lab.value >= limit : lab.value > limit }
  })

  const shown = (lab: LabObservation, key: string) => `${key} ${formatClinicalNumber(lab.value)}${lab.unit ? ` ${lab.unit}` : ''}`
  const multipleText = `${formatClinicalNumber(times).replace(/,0$/, '')} veces su límite superior`
  const measured = readings.flatMap((reading) =>
    reading.kind === 'measured'
      ? [`${shown(reading.lab, reading.key)} ${reading.exceeds ? 'supera' : 'no supera'} ${multipleText} (${formatClinicalNumber(reading.limit)})`]
      : [],
  )
  const noValue = readings.filter((reading) => reading.kind === 'no-value').map((reading) => reading.key)
  const noLimit = readings.flatMap((reading) => (reading.kind === 'no-limit' ? [shown(reading.lab, reading.key)] : []))
  const exceeded = readings.some((reading) => reading.kind === 'measured' && reading.exceeds)
  const several = readings.filter((reading) => reading.kind === 'several').map((reading) => reading.key)
  const complete = noValue.length === 0 && noLimit.length === 0 && several.length === 0
  // «ALT > 5 veces o AST > 3 veces», «… o mayor a 200»: la regla compara un solo múltiplo. Con
  // cualquier otro número en el criterio, aplicar el primero a todo despeja o activa de más.
  const severalNumbers = (criterion.text.match(/\d+(?:[.,]\d+)?/g) ?? []).length > 1
  const asksMore = asksBeyondTheLimit(criterion.text) || severalNumbers
  const allExceed = complete && readings.every((reading) => reading.kind === 'measured' && reading.exceeds)
  // Con una sola enzima pedida, o con un «o» expreso, una por encima alcanza. Si no, hacen falta todas.
  const oneIsEnough = asked.length === 1 || saysEitherIsEnough(criterion.text)
  const activated = oneIsEnough ? exceeded : allExceed
  const undecidedMix = exceeded && !activated

  const status = asksMore ? 'unknown' : activated ? 'fail' : complete && !exceeded ? 'pass' : 'unknown'
  const gaps = [
    noValue.length > 0 ? `Falta ${noValue.join(' y ')} en el perfil: se resuelve al cargar el laboratorio.` : '',
    noLimit.length > 0
      ? `${noLimit.join(' y ')} sin un rango de referencia del laboratorio que dé un solo límite: no se puede calcular cuánto es ${multipleText}.`
      : '',
    several.length > 0 ? `Hay más de un valor de ${several.join(' y de ')} en el perfil: no se elige uno, hay que revisar cuál vale.` : '',
  ].filter((part) => part.length > 0)
  const facts = measured.length > 0 ? `${measured.join('; ')}.` : ''
  const reason =
    status === 'fail'
      ? `${facts} Activaría este criterio de exclusión.`
      : status === 'pass'
        ? `${facts} No activa este criterio de exclusión.`
        : [
            facts,
            ...gaps,
            undecidedMix ? 'El criterio no dice si alcanza con una sola enzima por encima: no se decide solo.' : '',
            severalNumbers ? 'El criterio trae más de un número y el sistema compara un solo múltiplo: revisarlo antes de decidir.' : '',
            asksMore && !severalNumbers ? 'El criterio pide además algo que el sistema no comprueba: revisarlo antes de decidir.' : '',
          ]
            .filter((part) => part.length > 0)
            .join(' ')

  return {
    criterionNumber: criterion.number,
    criterionText: criterion.text,
    kind,
    status,
    reason,
    sourcePages: criterion.sourcePages,
    // Se pide el laboratorio solo si con él alcanza: nada superado y el criterio no pide más.
    ...(status === 'unknown' && !asksMore && !exceeded && noValue.length > 0 && several.length === 0 ? { missing: ['transaminases' as const] } : {}),
  }
}
