import { labFromEvolution } from './lab-source'
import { parseDecimal, upsertLab } from './lab-utils'
import { deniesTerm, HISTORY_TERMS, negatedItems } from './stated-history'
import type { LabObservation, Medication, PatientProfile } from './profile-schema'

export interface ExtractedFacts {
  ageYears?: number
  systolic?: number
  diastolic?: number
  labs: LabObservation[]
  medications: Medication[]
  conditions: string[]
}

/**
 * Extracción heurística Fase 2 — sin LLM, testeable y determinista.
 * Complementa (no reemplaza) extracción NLP futura.
 */
export function extractFactsFromEvolution(
  content: string,
  evolutionId?: string,
): ExtractedFacts {
  // «7 coma 9» dictado → «7,9»: es como una transcripción escribe a veces un decimal.
  const text = content.trim().replace(/(\d+)\s+coma\s+(\d+)/gi, '$1,$2')
  const labs: LabObservation[] = []
  const medications: Medication[] = []
  const conditions: string[] = []

  const ageYears = parseAge(text)

  // «132/84» escrito y «132 sobre 84» dictado: una transcripción devuelve la palabra, no la barra.
  // Una fecha («12/11/2026», «14/12») no es una presión: ni sigue otra barra ni los valores son posibles.
  const bpMatch = text.match(/(?<![\d/])(\d{2,3})\s*(?:\/|sobre)\s*(\d{2,3})(?![\d/])/i)
  // Dictada por separado, como se dice al tomarla: «sistólica 128, diastólica 95».
  const namedBp = text.match(/\bsist[oó]lica\s*(?:de\s*)?(\d{2,3})\b[^\d.]{0,40}?\bdiast[oó]lica\s*(?:de\s*)?(\d{2,3})\b/i)
  const pressure = plausiblePressure(bpMatch) ?? plausiblePressure(namedBp)
  const systolic = pressure?.systolic
  const diastolic = pressure?.diastolic

  const hba1cMatch = text.match(/(?:HbA1c|\bA1c\b|hemoglobina\s+glic(?:osil)?ada)\s*(?:de\s*|:\s*)?(\d{1,2}(?:[.,]\d+)?)(?![\d.,])\s*(?:%|por\s+ciento)?(?!\s*(?:mes|semana|d[ií]a|a[ñn]o))/i)
  // Fuera de 3–20 % no es una HbA1c: es un decimal que la transcripción perdió («79» por «7,9»).
  if (hba1cMatch && parseDecimal(hba1cMatch[1] ?? '0') >= 3 && parseDecimal(hba1cMatch[1] ?? '0') <= 20) {
    labs.push({
      name: 'HbA1c',
      value: parseDecimal(hba1cMatch[1] ?? '0'),
      unit: '%',
      sourceEvolutionId: evolutionId,
    })
  }

  const glucosaMatch = text.match(/glucosa(?:\s+alta|\s+de\s+(\d+[.,]?\d*))/i)
  if (glucosaMatch?.[1]) {
    labs.push({
      name: 'Glucosa',
      value: parseDecimal(glucosaMatch[1]),
      unit: 'mg/dL',
      sourceEvolutionId: evolutionId,
    })
  } else if (/glucosa\s+alta/i.test(text)) {
    conditions.push('Glucosa elevada (texto libre)')
  }

  // Peso, talla e IMC van como observaciones con nombre, junto a los laboratorios: el perfil
  // guarda «un número, su unidad y de dónde salió», y eso es lo que son.
  // «Bajó de peso 12 kilos», «aumento de peso de 10 kg»: es un cambio, no el peso.
  const weight = text.match(/(?<!\bde\s+)\bpeso\s*(?:actual\s*)?(?:de\s*|:\s*)?(\d{2,3}(?:[.,]\d)?)\s*(?:kg|kilos?|kilogramos?)\b/i)
  if (weight && parseDecimal(weight[1]!) >= 25 && parseDecimal(weight[1]!) <= 350) labs.push({ name: 'Peso', value: parseDecimal(weight[1]!), unit: 'kg', sourceEvolutionId: evolutionId })
  const heightCm = parseHeightCm(text)
  if (heightCm !== null) labs.push({ name: 'Talla', value: heightCm, unit: 'cm', sourceEvolutionId: evolutionId })
  const bmi = text.match(/(?:\bIMC\b|\bBMI\b|[ií]ndice\s+de\s+masa\s+corporal)\s*(?:de\s*|:\s*)?(\d{2}(?:[.,]\d{1,2})?)/i)
  if (bmi) labs.push({ name: 'IMC', value: parseDecimal(bmi[1]!), unit: 'kg/m2', sourceEvolutionId: evolutionId })

  const medPatterns: Array<{ pattern: RegExp; name: string }> = [
    { pattern: /metformina(?:\s+(\d+\s*mg))?(?:\s*(c\/\d+h|cada\s+\d+\s*h))?/i, name: 'Metformina' },
    { pattern: /insulina(?:\s+(\w+))?/i, name: 'Insulina' },
    { pattern: /semaglutida|ozempic|wegovy/i, name: 'Semaglutida (GLP-1)' },
    { pattern: /liraglutida|victoza/i, name: 'Liraglutida (GLP-1)' },
  ]

  for (const { pattern, name } of medPatterns) {
    // «Sin insulina», «no recibe metformina», «suspendió la insulina»: no es medicación actual.
    // Se mira cada mención: negada al principio y afirmada después, vale la afirmada.
    const mention = [...text.matchAll(new RegExp(pattern.source, 'gi'))].find((m) => !isMedicationNegatedAt(text, m.index ?? 0))
    if (mention) {
      medications.push({
        name,
        dose: mention[1]?.trim(),
        frequency: mention[2]?.trim(),
      })
    }
  }

  if (/\bDM2\b|diabetes tipo 2|diabetes mellitus tipo 2/i.test(text)) {
    conditions.push('DM2')
  }
  if (/sin GLP-1|sin glp-1/i.test(text)) {
    conditions.push('Sin GLP-1 activo')
  }
  conditions.push(...statedHistory(text))

  return {
    ageYears,
    systolic,
    diastolic,
    labs,
    medications,
    conditions,
  }
}

export function mergeProfileWithFacts(
  current: PatientProfile,
  facts: ExtractedFacts,
  evolutionId: string,
): PatientProfile {
  let labs = [...current.labs]
  for (const lab of facts.labs) {
    labs = upsertLab(labs, labFromEvolution(lab, evolutionId))
  }

  const medNames = new Set(current.medications.map((m) => m.name.toLowerCase()))
  const medications = [...current.medications]
  for (const med of facts.medications) {
    if (!medNames.has(med.name.toLowerCase())) {
      medications.push(med)
      medNames.add(med.name.toLowerCase())
    }
  }

  const conditionSet = new Set(current.conditions.map((c) => c.toLowerCase()))
  const conditions = [...current.conditions]
  for (const c of facts.conditions) {
    if (!conditionSet.has(c.toLowerCase())) {
      conditions.push(c)
      conditionSet.add(c.toLowerCase())
    }
  }

  return {
    version: 1,
    demographics: {
      ageYears: facts.ageYears ?? current.demographics?.ageYears,
    },
    vitals: {
      systolic: facts.systolic ?? current.vitals?.systolic,
      diastolic: facts.diastolic ?? current.vitals?.diastolic,
      bloodPressureLabel:
        facts.systolic && facts.diastolic
          ? `${facts.systolic}/${facts.diastolic}`
          : current.vitals?.bloodPressureLabel,
    },
    labs,
    medications,
    conditions,
    lastUpdatedAt: new Date().toISOString(),
    lastEvolutionId: evolutionId,
  }
}

/** Negación entre el comienzo del tramo y la palabra: «sin», «niega», «no recibe», «suspendió». */
// El cierre no usa \b: después de una vocal acentuada («suspendió», «está») JavaScript no ve límite de palabra.
const NEGATION_BEFORE = /\b(?:sin|niega|nunca|descarta|suspendi[oó]|suspende|no\s+(?:recibe|toma|usa|utiliza|presenta|refiere|tiene|registra|est[aá]|cursa|tuvo|ha\s+tenido|present[oó]|padeci[oó]))(?![a-záéíóúñ])[^.;,]*$/i

/**
 * Para la medicación la negación tiene que estar pegada al nombre («sin insulina», «no recibe
 * insulina ni metformina», «suspendió la metformina»). «Sin cambios en metformina» o «sin
 * intolerancia a la metformina» niegan otra cosa: la metformina sigue siendo medicación actual.
 */
const MEDICATION_NEGATION =
  /\b(?:sin|niega|nunca\s+(?:recibi[oó]|us[oó]|tom[oó])|no\s+(?:recibe|toma|usa|utiliza)|suspendi[oó]|suspende|se\s+suspende)\s+(?:(?:el\s+|la\s+)?(?:uso|tratamiento|consumo)\s+(?:de|con)\s+)?(?:(?:la|el)\s+)?(?:[a-záéíóúñ0-9-]+\s+(?:ni|o|y)\s+(?:(?:la|el)\s+)?)*$/i

function isMedicationNegatedAt(text: string, index: number): boolean {
  return MEDICATION_NEGATION.test(text.slice(0, index))
}

function isNegatedAt(text: string, index: number): boolean {
  const before = text.slice(0, index)
  const clauseStart = Math.max(before.lastIndexOf('.'), before.lastIndexOf(';'), before.lastIndexOf(','), before.lastIndexOf('\n')) + 1
  return NEGATION_BEFORE.test(before.slice(clauseStart))
}

function parseHeightCm(text: string): number | null {
  const spoken = text.match(/\b(?:talla|altura|estatura)\s*(?:de\s*|:\s*)?1\s*metro\s*(?:con\s*)?(\d{1,2})\b/i)
  if (spoken) return 100 + Number.parseInt(spoken[1]!, 10)
  const written = text.match(/\b(?:talla|altura|estatura)\s*(?:de\s*|:\s*)?(\d{3}|\d[.,]\d{1,2})\s*(cm|cent[ií]metros?|m\b|metros?)/i)
  if (!written) return null
  const value = parseDecimal(written[1]!)
  const centimetres = /^c/i.test(written[2]!) ? value : value * 100
  return centimetres >= 50 && centimetres <= 250 ? Math.round(centimetres * 10) / 10 : null
}

/**
 * La edad sale solo de una frase que habla de la edad. «Diabetes hace 10 años» o «metformina
 * desde hace 2 años» traen un número y la palabra «años», y no son la edad de nadie.
 */
function parseAge(text: string): number | undefined {
  const who = '(?:paciente|var[oó]n|mujer|hombre|masculino|femenin[oa]|se[ñn]ora?|sujeto|participante)'
  const adjectives = '(?:\\s+(?:masculino|femenin[oa]|var[oó]n|mujer|hombre|adult[oa]|de\\s+sexo\\s+(?:masculino|femenino)))*'
  // «N años de algo» que no sea «de edad» es la duración de ese algo.
  const notADuration = '(?!\\s+de\\s+(?!edad))'
  const patterns = [
    /\bedad\s*(?:de\s*|:\s*)?(\d{1,3})\b/i,
    // «Desde los 20 años de edad», «a los 40 años de edad»: es cuándo pasó algo.
    /(?<!\b(?:desde|a|hasta)\s+los\s+)\b(\d{1,3})\s*a[ñn]os\s+de\s+edad\b/i,
    // «Paciente de 58 años», «paciente femenina de 61 años», «paciente que tiene 52 años».
    new RegExp(`\\b${who}${adjectives}\\s+(?:de|(?:que\\s+)?tiene)\\s+(\\d{1,3})\\s*a[ñn]os\\b${notADuration}`, 'i'),
    // «Tiene 58 años.» al empezar la frase: el sujeto es el paciente.
    new RegExp(`(?:^|[.;\\n])\\s*tiene\\s+(\\d{1,3})\\s*a[ñn]os\\b${notADuration}`, 'i'),
    // «Paciente masculino, 58 años, consulta por…».
    new RegExp(`\\b${who}${adjectives}\\s*,\\s*(\\d{1,3})\\s*a[ñn]os\\s*(?=[.;,\\n]|$)`, 'i'),
  ]
  for (const pattern of patterns) {
    const match = text.match(pattern)
    if (!match) continue
    const age = Number.parseInt(match[1]!, 10)
    if (age >= 1 && age <= 120) return age
  }
  return undefined
}

function plausiblePressure(match: RegExpMatchArray | null): { systolic: number; diastolic: number } | undefined {
  if (!match) return undefined
  const systolic = Number.parseInt(match[1]!, 10)
  const diastolic = Number.parseInt(match[2]!, 10)
  return systolic >= 60 && systolic <= 260 && diastolic >= 30 && diastolic <= 160 && systolic > diastolic ? { systolic, diastolic } : undefined
}

const PANCREATITIS_STATED =
  /^(?:(?:antecedentes?\s+(?:personal(?:es)?\s+)?|historia\s+|episodios?\s+|diagn[oó]stico\s+)de\s+)?pancreatitis\b|\b(?:tuvo|ha\s+tenido|present[oó]|curs[oó]|padeci[oó]|sufri[oó]|internad[oa]\s+por|internaci[oó]n\s+por|antecedentes?\s+(?:personal(?:es)?\s+)?de|historia\s+de|episodios?\s+de|diagn[oó]stico\s+de)\s+(?:una?\s+)?pancreatitis\b/i
const PREGNANCY_STATED =
  /\bembarazada\b|\bcursa(?:ndo)?\s+(?:un\s+)?embarazo\b|\b(?:embarazo|gestaci[oó]n)\s+de\s+\d+\s+semanas\b|\b(?:test|prueba)\s+de\s+embarazo\b.*\bpositiv[oa]\b|^embarazo\s+en\s+curso$/i
const LACTATION_STATED = /\b(?:en|cursa)\s+(?:per[ií]odo\s+de\s+)?lactancia\b|\bamamantando\b|\blactancia\s+(?:materna\s+)?en\s+curso\b/i
const LACTATION_DENIED_VERB = /^(?:paciente\s+)?no\s+(?:amamanta|da\s+(?:de\s+lactar|el\s+pecho))$/i
const STATED: Record<string, { pattern: RegExp; as: string }> = {
  pancreatitis: { pattern: PANCREATITIS_STATED, as: 'Antecedente de pancreatitis' },
  embarazo: { pattern: PREGNANCY_STATED, as: 'Embarazo en curso' },
  lactancia: { pattern: LACTATION_STATED, as: 'Lactancia en curso' },
}

/**
 * Antecedentes que el médico dice de forma expresa, con su negación. Salen con un texto
 * fijo para que la regla de elegibilidad los reconozca sin interpretar: lo negado como
 * «Sin …», lo afirmado como «Antecedente de …» o «… en curso».
 *
 * Tres resultados por tramo, no dos. Se anota «Sin …» solo si el tramo entero es la
 * negación (la misma prueba que usa la elegibilidad) y nada en el resto de la frase la desdice. Se anota la afirmación solo si el
 * tramo la dice y nada la niega. Todo lo demás no se anota: «se solicita test de embarazo»,
 * «sin dolor por la pancreatitis de 2019» o «test de embarazo negativo» nombran la palabra,
 * y lo que dicen sobre el estado tiene que decidirlo una persona. Sin anotación el criterio
 * queda a revisar, que es el lado seguro.
 */
/**
 * «Nombre del apartado: contenido». El borrador del dictado arma así cada renglón, y a mano
 * también se escribe «Antecedentes: …». El nombre no es parte de lo que se dijo: con él
 * adelante, «Sin antecedentes de pancreatitis» dejaba de ser una negación pura.
 *
 * No se saca si lo de adelante nombra un antecedente o un estado («Pancreatitis crónica: sin
 * dolor»: ahí ES el dato) ni si es una negación («Niega: pancreatitis»): en esos casos
 * sacarlo cambiaría lo que dice la frase.
 */
const LINE_LABEL = /^\s*([a-záéíóúñ][a-záéíóúñ ]{1,58}):\s+/i
const NEGATION_LABEL = /^(?:sin|niega|descarta|nunca|no)(?![a-záéíóúñ])/i

function withoutLineLabel(line: string): string {
  const match = line.match(LINE_LABEL)
  if (!match) return line
  const label = match[1]!
  if (NEGATION_LABEL.test(label) || HISTORY_TERMS.some((term) => term.mention.test(label))) return line
  return line.slice(match[0].length)
}

function statedHistory(text: string): string[] {
  const found: string[] = []
  const sentences = text
    .split('\n')
    .map(withoutLineLabel)
    .flatMap((line) => line.split(/[.;]+/))
  for (const sentence of sentences) {
    const segments = sentence.split(',').map((segment) => segment.trim()).filter((segment) => segment.length > 0)
    const isDenial = segments.map((segment) => negatedItems(segment) !== null || LACTATION_DENIED_VERB.test(segment))
    segments.forEach((segment, position) => {
      // Lo que sigue en la misma frase puede desdecir la negación («…, pero tuvo una en 2019»).
      // Vale solo si la frase termina ahí o si todo lo que sigue también es una negación.
      const nothingTakesItBack = isDenial.slice(position + 1).every(Boolean)
      for (const term of HISTORY_TERMS) {
        const index = segment.search(term.mention)
        if (index < 0) continue
        const denied = deniesTerm(segment, term) || (term.label === 'lactancia' && LACTATION_DENIED_VERB.test(segment))
        if (denied) {
          if (nothingTakesItBack) found.push(term.deniedAs)
        } else if (!isNegatedAt(segment, index) && STATED[term.label]!.pattern.test(segment)) {
          found.push(STATED[term.label]!.as)
        }
      }
    })
  }
  return [...new Set(found)]
}
