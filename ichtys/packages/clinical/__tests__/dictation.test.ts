import { describe, expect, it } from 'vitest'
import {
  applySpokenCorrections,
  buildDictationDraft,
  collapseRepetitions,
  CORRECTION_WORDS,
  DICTATION_BLOCKS,
  DICTATION_CORRECTION_EXAMPLE,
  DICTATION_GUIDE_STEPS,
  dictationGuideScript,
  joinSegmentTexts,
  mergeDictationAddition,
  segmentSpeech,
  NOT_MENTIONED,
  splitIntoBlocks,
  trimSilence,
} from '../dictation'
import { extractFactsFromEvolution } from '../extract-facts'

const RATE = 16_000
function tone(seconds: number, amplitude = 0.3): Float32Array {
  const out = new Float32Array(Math.round(seconds * RATE))
  for (let i = 0; i < out.length; i++) out[i] = amplitude * Math.sin((2 * Math.PI * 220 * i) / RATE)
  return out
}
function join(...parts: Float32Array[]): Float32Array {
  const out = new Float32Array(parts.reduce((sum, part) => sum + part.length, 0))
  let offset = 0
  for (const part of parts) { out.set(part, offset); offset += part.length }
  return out
}
const silence = (seconds: number) => new Float32Array(Math.round(seconds * RATE))

describe('recorte de silencios', () => {
  it('acorta un silencio largo y conserva una pausa corta', () => {
    const result = trimSilence(join(tone(1), silence(3), tone(1)), RATE)
    expect(result.removedSec).toBeGreaterThan(2.5)
    expect(result.samples.length / RATE).toBeGreaterThan(2.2)
    expect(result.samples.length / RATE).toBeLessThan(2.5)
  })

  it('no toca las pausas normales entre palabras ni un audio sin silencios', () => {
    const spoken = join(tone(1), silence(0.4), tone(1))
    expect(trimSilence(spoken, RATE).samples).toBe(spoken)
    expect(trimSilence(tone(2), RATE).removedSec).toBe(0)
  })

  it('recorta el silencio del principio y del final sin perder la voz', () => {
    const result = trimSilence(join(silence(2), tone(1), silence(2)), RATE)
    expect(result.samples.length / RATE).toBeGreaterThan(1)
    expect(result.samples.length / RATE).toBeLessThan(1.7)
  })

  it('un audio vacío vuelve igual', () => {
    expect(trimSilence(new Float32Array(0), RATE).removedSec).toBe(0)
  })
})

describe('correcciones dictadas', () => {
  it('un valor corregido reemplaza al anterior y quedan los dos a la vista', () => {
    const result = applySpokenCorrections('Presión arterial 140 sobre 90. Corrijo: 130 sobre 85. Frecuencia cardíaca 72.')
    expect(result.text).toBe('Presión arterial 130 sobre 85. Frecuencia cardíaca 72.')
    expect(result.corrections).toEqual([{ original: 'Presión arterial 140 sobre 90', corrected: 'Presión arterial 130 sobre 85', marker: 'Corrijo' }])
  })

  it('una frase corregida entera reemplaza a la anterior', () => {
    const result = applySpokenCorrections('Toma metformina 500 mg. Perdón, toma metformina 850 mg cada 12 horas.')
    expect(result.text).toBe('Toma metformina 850 mg cada 12 horas.')
    expect(result.corrections[0]?.original).toBe('Toma metformina 500 mg')
  })

  it('una marca sin nada antes o sin texto nuevo no borra nada', () => {
    expect(applySpokenCorrections('Corrijo: peso 78 kg.').corrections).toEqual([])
    expect(applySpokenCorrections('Peso 78 kg. Corrijo.').text).toBe('Peso 78 kg.')
  })

  it('sin marcas el texto no cambia', () => {
    const text = 'Paciente estable. Sin eventos adversos.'
    expect(applySpokenCorrections(text)).toEqual({ text, corrections: [] })
  })
})

describe('bloques de la evolución dictada', () => {
  it('reparte lo dictado por encabezado y marca lo que falta', () => {
    const blocks = splitIntoBlocks('Visita de selección del sujeto. Motivo: control. Signos vitales: presión 130 sobre 85. Plan. Citar en dos semanas.')
    const byId = Object.fromEntries(blocks.map((block) => [block.id, block.text]))
    expect(byId.apertura).toBe('Visita de selección del sujeto.')
    expect(byId.motivo).toBe('Control.')
    expect(byId.vitales).toBe('Presión 130 sobre 85.')
    expect(byId.plan).toBe('Citar en dos semanas.')
    expect(byId.eventos).toBeNull()
  })

  it('el encabezado vale con o sin acentos y solo al empezar la frase', () => {
    const blocks = splitIntoBlocks('Medicacion actual: metformina. Evaluación: el plan terapéutico sigue igual.')
    const byId = Object.fromEntries(blocks.map((block) => [block.id, block.text]))
    expect(byId.medicacion).toBe('Metformina.')
    expect(byId.evaluacion).toBe('El plan terapéutico sigue igual.')
    expect(byId.plan).toBeNull()
  })

  it('el borrador escribe «No mencionado» en cada bloque sin dictar y cuenta las correcciones', () => {
    const draft = buildDictationDraft('Motivo: control.  Signos vitales: presión 140 sobre 90. Corrijo: 130 sobre 85. Plan: laboratorio.')
    expect(draft.text).toContain('Motivo de la visita: Control.')
    expect(draft.text).toContain('Signos vitales: Presión 130 sobre 85.')
    expect(draft.text).toContain(`Eventos adversos: ${NOT_MENTIONED}`)
    expect(draft.text).not.toContain('Apertura')
    expect(draft.corrections).toHaveLength(1)
    expect(draft.missing).toContain('eventos')
    expect(draft.missing).not.toContain('motivo')
  })

  it('transcripción real de un navegador (voz sintética, Whisper small): encabezados y marca deformados', () => {
    // Texto devuelto por el navegador el 12/11/2026 para apps/web/lib/dictation/__tests__/fixtures/dictado-sintetico.wav.
    const draft = buildDictationDraft(
      'Visita de selección del sufeto demo. Motivos control químico inicial. Medicación actual. Metformina 850 miliramos cada 12 horas. Signos y tales. Presión material 140 sobre 90. Corijo 132 sobre 84. Fecuencia carría K72. Eventos a besos. NIN1. Plan solicitar laboratorio y citar en dos semanas.',
    )
    const byId = Object.fromEntries(draft.blocks.map((block) => [block.id, block.text]))
    expect(byId.apertura).toBe('Visita de selección del sufeto demo.')
    expect(byId.motivo).toBe('Control químico inicial.')
    expect(byId.medicacion).toBe('Metformina 850 miliramos cada 12 horas.')
    expect(byId.vitales).toBe('Presión material 132 sobre 84. Fecuencia carría K72.')
    expect(byId.eventos).toBe('NIN1.')
    expect(byId.plan).toBe('Solicitar laboratorio y citar en dos semanas.')
    expect(draft.corrections).toEqual([{ original: 'Presión material 140 sobre 90', corrected: 'Presión material 132 sobre 84', marker: 'Corijo' }])
  })

  it('límite conocido: un encabezado muy deformado no abre su bloque y queda avisado como «No mencionado»', () => {
    // Mismo audio, decodificador en precisión completa (12/11/2026): «Eventos adversos» llegó como «Entos a besos».
    // No se ensancha la tolerancia para alcanzarlo: abriría bloques con palabras comunes. Lo dictado queda en el bloque
    // anterior, a la vista, y el bloque sin título figura entre los faltantes para que la persona lo revise.
    const draft = buildDictationDraft(
      'Signos y tales. Presión material 132 sobre 84. Fecuencia cardíaca 72. Entos a besos. Nín 1. Plan. Solicitar laboratorio y citar en dos semanas.',
    )
    const byId = Object.fromEntries(draft.blocks.map((block) => [block.id, block.text]))
    expect(byId.eventos).toBeNull()
    expect(byId.vitales).toContain('Entos a besos. Nín 1.')
    expect(draft.missing).toContain('eventos')
    expect(byId.plan).toBe('Solicitar laboratorio y citar en dos semanas.')
  })

  it('una palabra parecida a un encabezado corto no abre un bloque', () => {
    const byId = Object.fromEntries(splitIntoBlocks('Motivo: control. Plano de la sala entregado. Pan sin sal.').map((block) => [block.id, block.text]))
    expect(byId.plan).toBeNull()
    expect(byId.motivo).toBe('Control. Plano de la sala entregado. Pan sin sal.')
  })

  describe('bucles del transcriptor', () => {
    it('una frase repetida muchas veces queda una sola y se informa', () => {
      const loop = Array.from({ length: 12 }, () => 'en el primer piso de la sala,').join(' ')
      const { text, repetitions } = collapseRepetitions(`Se completan los formularios. ${loop} Plan: control en dos semanas.`)
      expect(text).toBe('Se completan los formularios. en el primer piso de la sala, Plan: control en dos semanas.')
      expect(repetitions).toEqual([{ phrase: 'en el primer piso de la sala', times: 12 }])
    })

    it('ignora mayúsculas, acentos y puntuación al comparar', () => {
      const { repetitions } = collapseRepetitions('Signos vitales. signos vitales, SIGNOS VITALES. Presión 120 sobre 80. Signos vitales bien.')
      expect(repetitions).toEqual([])
      const three = collapseRepetitions('Se evalúa al paciente. Se evalua al paciente, SE EVALÚA AL PACIENTE. Plan.')
      expect(three.repetitions).toEqual([{ phrase: 'Se evalúa al paciente', times: 3 }])
    })

    it('dos veces no es un bucle, y una palabra repetida tampoco', () => {
      expect(collapseRepetitions('Sin dolor abdominal. Sin dolor abdominal. Plan.').repetitions).toEqual([])
      expect(collapseRepetitions('sí sí sí sí, refiere mejoría').repetitions).toEqual([])
    })

    it('el borrador avisa el bucle y no lo deja en el texto', () => {
      const loop = Array.from({ length: 5 }, () => 'se indica reposo relativo').join(' ')
      const draft = buildDictationDraft(`Motivo: control. ${loop}. Plan: volver en un mes.`)
      expect(draft.repetitions).toHaveLength(1)
      expect(draft.text.match(/reposo relativo/g)).toHaveLength(1)
    })
  })

  describe('texto corrido', () => {
    const narrative =
      'En el día de la fecha concurre al centro en ayunas a realizar la visita número 4 del estudio. Se evalúan cambios en procedimientos y en medicamentos. ' +
      'Refiere buena tolerancia. Se completa el cuestionario en papel. Signos vitales. Sistólica 128, diastólica 95, frecuencia cardíaca 73.'

    it('si casi no se nombraron apartados, respeta el texto y no agrega renglones', () => {
      const draft = buildDictationDraft(narrative)
      expect(draft.layout).toBe('narrative')
      expect(draft.text).not.toContain(NOT_MENTIONED)
      expect(draft.text).not.toMatch(/^Apertura:/)
      expect(draft.text.split('\n')).toEqual([
        'En el día de la fecha concurre al centro en ayunas a realizar la visita número 4 del estudio. Se evalúan cambios en procedimientos y en medicamentos. Refiere buena tolerancia. Se completa el cuestionario en papel.',
        'Signos vitales: Sistólica 128, diastólica 95, frecuencia cardíaca 73.',
      ])
    })

    it('los apartados que no se oyeron quedan como lista de control, fuera del texto', () => {
      const draft = buildDictationDraft(narrative)
      expect(draft.missing).toContain('plan')
      expect(draft.missing).not.toContain('vitales')
    })

    it('quien nombra los apartados sigue recibiendo el borrador por bloques', () => {
      const draft = buildDictationDraft('Motivo: control. Medicación actual: metformina. Signos vitales: 120 sobre 80. Plan: laboratorio.')
      expect(draft.layout).toBe('blocks')
      expect(draft.text).toContain(`Examen físico: ${NOT_MENTIONED}`)
    })
  })

  describe('la guía que lee el médico y lo que el sistema reconoce son lo mismo', () => {
    const draft = buildDictationDraft(dictationGuideScript())

    it('dictar la guía entera llena todos los apartados, cada frase en el suyo', () => {
      expect(draft.layout).toBe('blocks')
      expect(draft.missing).toEqual([])
      for (const block of DICTATION_BLOCKS) {
        const got = draft.blocks.find((candidate) => candidate.id === block.id)?.text
        expect(got, block.title).toBe(block.example)
      }
    })

    it('lo que la guía manda decir para abrir un apartado, lo abre', () => {
      for (const step of DICTATION_GUIDE_STEPS) {
        if (!step.say) continue
        const blocks = splitIntoBlocks(`${step.say}. Texto de prueba.`)
        expect(blocks.filter((block) => block.text !== null).map((block) => block.title), step.say).toEqual([step.title])
      }
    })

    it('«Evolución» abre Evolución y no Evaluación, aunque estén a dos letras', () => {
      const blocks = splitIntoBlocks('Evolución. Refiere mejoría. Evaluación. Estable.')
      const byId = Object.fromEntries(blocks.map((block) => [block.id, block.text]))
      expect(byId.evolucion).toBe('Refiere mejoría.')
      expect(byId.evaluacion).toBe('Estable.')
    })

    it('una frase que termina como un encabezado largo no lo abre', () => {
      const blocks = splitIntoBlocks('Eventos adversos. Ninguno desde la última visita.')
      const byId = Object.fromEntries(blocks.map((block) => [block.id, block.text]))
      expect(byId.eventos).toBe('Ninguno desde la última visita.')
      expect(byId.evolucion).toBeNull()
    })

    it('de la guía dictada salen los datos: edad, presión y medicación', () => {
      const facts = extractFactsFromEvolution(draft.text)
      expect(facts.ageYears).toBe(58)
      expect([facts.systolic, facts.diastolic]).toEqual([132, 84])
      expect(facts.medications.map((medication) => medication.name)).toEqual(['Metformina'])
    })

    it('cada palabra de corrección que enseña la guía funciona', () => {
      for (const word of CORRECTION_WORDS) {
        const { corrections } = applySpokenCorrections(`Presión arterial 140 sobre 90. ${word}, 132 sobre 84.`)
        expect(corrections, word).toHaveLength(1)
      }
      const example = applySpokenCorrections(DICTATION_CORRECTION_EXAMPLE)
      expect(example.text).toBe('Presión arterial 132 sobre 84.')
    })

    it('«Sin novedades» alcanza para que un apartado no figure como faltante', () => {
      const blocks = splitIntoBlocks('Examen físico. Sin novedades.')
      expect(blocks.find((block) => block.id === 'examen')?.text).toBe('Sin novedades.')
    })
  })

  // Santiago, 12/11 22:05, con micrófono: desde «Laboratorio» todo quedó en un solo renglón.
  // Al leer de corrido el transcriptor separa con comas, no con puntos, y un apartado solo se
  // reconocía al comienzo de una frase.
  describe('apartados dictados sin pausa: el transcriptor separa con comas', () => {
    const run =
      'Laboratorio, se toman muestras según el protocolo, impresión clínica, paciente estable, criterios o desvíos, sin desvíos al protocolo, plan, continúa con el mismo tratamiento, próxima visita en cuatro semanas.'
    const byId = (text: string) => Object.fromEntries(splitIntoBlocks(text).map((block) => [block.id, block.text]))

    it('cada apartado abre su bloque aunque venga después de una coma', () => {
      expect(byId(run)).toMatchObject({
        laboratorio: 'Se toman muestras según el protocolo.',
        evaluacion: 'Paciente estable.',
        criterios: 'Sin desvíos al protocolo.',
        plan: 'Continúa con el mismo tratamiento.',
        proxima: 'En cuatro semanas.',
      })
    })

    it('también con dos puntos: «Plan: …, próxima visita: …»', () => {
      expect(byId('Plan: continúa igual, próxima visita: en un mes.')).toMatchObject({ plan: 'Continúa igual.', proxima: 'En un mes.' })
    })

    it('el nombre de un apartado en medio de una frase sigue siendo texto', () => {
      const blocks = byId('Evolución. Refiere buena tolerancia, sin eventos adversos. En la próxima visita se evalúa el plan de alimentación.')
      expect(blocks.evolucion).toBe('Refiere buena tolerancia, sin eventos adversos. En la próxima visita se evalúa el plan de alimentación.')
      expect(blocks.eventos).toBeNull()
      expect(blocks.proxima).toBeNull()
      expect(blocks.plan).toBeNull()
    })

    it('después de una coma, una palabra suelta solo abre apartado si está sola', () => {
      // «motivo por el cual», «evolución favorable» y «plan de alimentación» son texto.
      const blocks = byId('Evaluación. Se suspende la dosis, motivo por el cual se cita antes, evolución favorable, plan de alimentación adecuado.')
      expect(blocks.evaluacion).toBe('Se suspende la dosis, motivo por el cual se cita antes, evolución favorable, plan de alimentación adecuado.')
      expect(blocks.motivo).toBeNull()
      expect(blocks.evolucion).toBeNull()
      expect(blocks.plan).toBeNull()
    })

    it('los decimales no se parten: ni con coma ni con punto', () => {
      expect(byId('Laboratorio. Hemoglobina glicosilada 7,9 %. Creatinina 0.9 mg/dL, sin cambios.').laboratorio).toBe(
        'Hemoglobina glicosilada 7,9 %. Creatinina 0.9 mg/dL, sin cambios.',
      )
      expect(applySpokenCorrections('Glucemia 1.10 gramos. Corrijo, 1.01 gramos.').text).toBe('Glucemia 1.01 gramos.')
    })

    it('«Sin eventos adversos» es una frase, no el encabezado con una palabra de más: no desaparece', () => {
      const blocks = byId('Evolución. Buena tolerancia. Sin eventos adversos. Signos vitales. Presión 120 sobre 80.')
      expect(blocks.evolucion).toBe('Buena tolerancia. Sin eventos adversos.')
      expect(blocks.eventos).toBeNull()
    })

    it('una corrección dicha sin pausa cambia solo el dato corregido', () => {
      const { text, corrections } = applySpokenCorrections('Signos vitales, presión arterial 140 sobre 90, corrijo, 132 sobre 84, frecuencia cardíaca 72.')
      expect(text).toBe('Signos vitales, presión arterial 132 sobre 84, frecuencia cardíaca 72.')
      expect(corrections).toEqual([{ original: 'presión arterial 140 sobre 90', corrected: 'presión arterial 132 sobre 84', marker: 'corrijo' }])
    })

    it('una corrección que nombra el dato cambia ese dato y no el que se dijo último', () => {
      const { text } = applySpokenCorrections('Presión arterial 140 sobre 90, frecuencia cardíaca 72. Corrijo, presión arterial 132 sobre 84.')
      expect(text).toBe('Presión arterial 132 sobre 84, frecuencia cardíaca 72.')
    })

    it('el borrador de un dictado leído de corrido queda completo', () => {
      const draft = buildDictationDraft(dictationGuideScript().replace(/\. /g, ', '))
      expect(draft.layout).toBe('blocks')
      expect(draft.missing).toEqual([])
    })
  })

  // Santiago, 12/11 22:27: leyó la guía (75 s) y se perdieron unos veinte segundos del principio.
  describe('el audio se corta por las pausas, no por ventanas fijas', () => {
    const seconds = (segments: Array<{ start: number; end: number }>) => segments.map((s) => [+(s.start / RATE).toFixed(2), +(s.end / RATE).toFixed(2)])

    it('cada cosa dicha entre dos pausas es un tramo', () => {
      const audio = join(silence(0.5), tone(2), silence(1.2), tone(1), silence(2), tone(3), silence(0.4))
      const segments = segmentSpeech(audio, RATE)
      expect(segments).toHaveLength(3)
      // Cada tramo lleva 0,16 s de aire a cada lado (ocho cuadros de 20 ms).
      expect(seconds(segments)).toEqual([
        [0.34, 2.66],
        [3.54, 4.86],
        [6.54, 9.86],
      ])
    })

    it('una pausa corta, de tomar aire, no corta el tramo', () => {
      const segments = segmentSpeech(join(tone(2), silence(0.4), tone(2), silence(1.5), tone(1)), RATE)
      expect(segments).toHaveLength(2)
      expect(seconds(segments)[0]).toEqual([0, 4.56])
    })

    it('un clic no es un tramo, y el silencio solo tampoco', () => {
      expect(segmentSpeech(join(silence(1), tone(0.06), silence(1), tone(2)), RATE)).toHaveLength(1)
      expect(segmentSpeech(silence(5), RATE)).toEqual([])
      expect(segmentSpeech(new Float32Array(0), RATE)).toEqual([])
    })

    it('ningún tramo pasa de lo que el modelo escucha, y no se pierde audio al partirlo', () => {
      const segments = segmentSpeech(tone(70), RATE)
      expect(segments.length).toBeGreaterThanOrEqual(3)
      for (const segment of segments) expect((segment.end - segment.start) / RATE).toBeLessThanOrEqual(28)
      expect(segments[0]!.start).toBe(0)
      expect(segments[segments.length - 1]!.end).toBe(70 * RATE)
      for (let i = 1; i < segments.length; i++) expect(segments[i]!.start).toBe(segments[i - 1]!.end)
    })

    it('el piso de silencio se adapta: con voz fuerte, un fondo ruidoso sigue siendo pausa', () => {
      const noisy = (secs: number) => tone(secs, 0.03)
      const loud = (secs: number) => tone(secs, 0.6)
      expect(segmentSpeech(join(loud(2), noisy(1.5), loud(2)), RATE)).toHaveLength(2)
    })

    it('los tramos no se pisan', () => {
      const segments = segmentSpeech(join(tone(1), silence(0.72), tone(1), silence(0.72), tone(1)), RATE, { padSec: 0.5 })
      for (let i = 1; i < segments.length; i++) expect(segments[i]!.start).toBeGreaterThanOrEqual(segments[i - 1]!.end)
    })

    it('lo transcripto de cada tramo se une como frases: la pausa es la que separa', () => {
      expect(joinSegmentTexts([' Motivo de la visita', 'control programado.', '', ' . ', 'Presión arterial 132 sobre 84,'])).toBe(
        'Motivo de la visita. Control programado. Presión arterial 132 sobre 84.',
      )
    })

    it('una guía leída con pausas queda completa aunque el modelo no ponga ni un punto', () => {
      const perSegment = DICTATION_GUIDE_STEPS.flatMap((step) => (step.say ? [step.say.toLowerCase(), step.example.replace(/\.$/, '').toLowerCase()] : [step.example]))
      const draft = buildDictationDraft(joinSegmentTexts(perSegment))
      expect(draft.layout).toBe('blocks')
      expect(draft.missing).toEqual([])
    })

    it('el plural no impide reconocer el apartado: «Exámenes físicos», «Impresiones clínicas»', () => {
      const blocks = Object.fromEntries(
        splitIntoBlocks('Signos vitales. Presión 120 sobre 80. Exámenes físicos. Sin hallazgo. Laboratorios. Se toma muestra. Impresiones clínicas. Paciente estable.').map((block) => [block.id, block.text]),
      )
      expect(blocks).toMatchObject({ vitales: 'Presión 120 sobre 80.', examen: 'Sin hallazgo.', laboratorio: 'Se toma muestra.', evaluacion: 'Paciente estable.' })
    })
  })

  describe('agregar lo que faltó, dictándolo', () => {
    const first = buildDictationDraft('Motivo de la visita. Control programado. Signos vitales. Presión arterial 132 sobre 84. Plan. Continúa igual.')

    it('lo agregado va a su apartado: llena el que decía «No mencionado» y suma al que ya tenía texto', () => {
      const addition = buildDictationDraft('Laboratorio. Hemoglobina glicosilada 7,9 %. Signos vitales. Peso 78 kilos.')
      const merged = mergeDictationAddition(first.text, addition)
      expect(merged).toContain('Laboratorio y estudios: Hemoglobina glicosilada 7,9 %.')
      expect(merged).toContain('Signos vitales: Presión arterial 132 sobre 84. Peso 78 kilos.')
      expect(merged).toContain('Motivo de la visita: Control programado.')
      expect(merged).toContain(`Examen físico: ${NOT_MENTIONED}`)
      expect(merged.match(/Signos vitales:/g)).toHaveLength(1)
    })

    it('respeta lo que la persona corrigió a mano y lo que escribió fuera de la plantilla', () => {
      const edited = first.text.replace('Control programado.', 'Control programado, adelantado una semana.') + '\nNota: acompaña la hija.'
      const merged = mergeDictationAddition(edited, buildDictationDraft('Eventos adversos. Ninguno.'))
      expect(merged).toContain('Motivo de la visita: Control programado, adelantado una semana.')
      expect(merged).toContain('Eventos adversos: Ninguno.')
      expect(merged.split('\n').at(-1)).toBe('Nota: acompaña la hija.')
    })

    it('sobre un texto corrido, lo nuevo se agrega debajo', () => {
      const merged = mergeDictationAddition('Paciente estable, sin cambios.', buildDictationDraft('Próxima visita. En cuatro semanas.'))
      expect(merged).toBe('Paciente estable, sin cambios.\nPróxima visita: En cuatro semanas.')
    })

    it('un agregado sin voz no cambia nada, y sobre un cuadro vacío es el borrador entero', () => {
      const empty = buildDictationDraft('')
      expect(mergeDictationAddition(first.text, empty)).toBe(first.text)
      expect(mergeDictationAddition('', first)).toBe(first.text)
    })
  })
})
