/**
 * A qué apartado va cada medición del perfil **al mostrarla**. El perfil guarda peso, talla o
 * frecuencia cardíaca junto a los laboratorios; la historia clínica del centro los tiene en
 * «Signos vitales» y «Antropometría» (relevado el 14/11/2026). Se clasifica por el nombre y
 * solo para la pantalla: lo guardado y lo que lee la elegibilidad no cambian.
 * Sin dependencias: lo importan componentes de cliente.
 */
export type MeasurementSection = 'vitales' | 'antropometria' | 'laboratorio'

const plain = (text: string): string =>
  text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

/** Nombres exactos, ya normalizados. Exactos a propósito: «peso molecular» no es antropometría. */
const ANTHROPOMETRY: ReadonlySet<string> = new Set([
  'peso',
  'peso corporal',
  'talla',
  'altura',
  'estatura',
  'imc',
  'indice de masa corporal',
  'cintura',
  'p cintura',
  'perimetro de cintura',
  'circunferencia de cintura',
  'perimetro abdominal',
  'circunferencia abdominal',
])

const VITALS: ReadonlySet<string> = new Set([
  'fc',
  'frecuencia cardiaca',
  'fr',
  'frecuencia respiratoria',
  'temperatura',
  'temperatura corporal',
  'saturacion',
  'saturacion de oxigeno',
  'spo2',
  'sat o2',
  'sato2',
  'pulso',
])

/** Unidades que a veces vienen escritas dentro del nombre: «Peso (kg)», «Temperatura °C». */
const UNIT_TOKENS: ReadonlySet<string> = new Set(['kg', 'g', 'cm', 'm', 'mts', 'm2', 'c', 'lpm', 'rpm', 'bpm'])

/** El nombre sin la unidad del final. Solo saca palabras del final, y nunca la única que hay. */
function withoutUnit(key: string): string {
  const words = key.split(' ')
  while (words.length > 1 && UNIT_TOKENS.has(words[words.length - 1]!)) words.pop()
  return words.join(' ')
}

export function measurementSection(name: string): MeasurementSection {
  const key = withoutUnit(plain(name))
  if (ANTHROPOMETRY.has(key)) return 'antropometria'
  if (VITALS.has(key)) return 'vitales'
  return 'laboratorio'
}
