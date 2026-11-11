import { describe, expect, it } from 'vitest'
import { parseLabReportText, rowIsGrounded } from '../lab-report-parser'

/**
 * Formatos reales de laboratorios, reconstruidos con datos ficticios: ningún
 * nombre, documento, fecha ni resultado de estos casos pertenece a un paciente.
 * El lector de PDF entrega cada renglón con sus columnas separadas por
 * tabulación; un renglón que empieza con tabulación está en la columna
 * derecha de la hoja (valores de referencia, interpretación, firma).
 */
const T = '\t'
const line = (...cells: string[]) => cells.join(T)
const right = (text: string) => `${T}${text}`
const summary = (text: string) =>
  parseLabReportText(text).rows.map((row) => [row.analyte, row.printedValue, row.unit, row.needsReview])

describe('formato A — analito en un renglón, "Resultado" en otro', () => {
  const text = [
    'Directora Técnica',
    right('Dra. NOMBRE FICTICIO'),
    line('Paciente:', 'Fecha:'),
    line('GOMEZ, ANA', '03/02/2026 09:15:40'),
    line('Documento:', 'Protocolo:'),
    line('DNI 30111222', '884512'),
    line('Estudio', 'Resultado', 'Valores de referencia'),
    'Trigliceridos',
    'Método: Enzimático',
    line('Resultado', '134 mg/dl mg/dl', 'V.R. Hasta 150 mg/dl'),
    'Colesterol Hdl',
    'Método: Colorimétrico-Enzimático',
    line('Resultado', '52 mg/dl mg/dl', 'Interpretación:'),
    right('Hombres'),
    right('Mayor de 55 mg/dl : Sin riesgo'),
    right('35-55 mg/dl:Riesgo moderado'),
    right('Menor de 35 mg/dl: Alto riesgo'),
    'Colesterol Ldl',
    'Método: Colorimétrico-Enzimático',
    line('Resultado', '88 mg/dl mg/dl', 'Interpretación:'),
    right('Óptimo: Menor a 100 mg/dl'),
    right('Pacientes de alto riesgo'),
    right('meta < 116 mg/dL'),
    line('Este protocolo fue validado electrónicamente. Es copia fiel del original alojado en servidores.', 'Página:', '1'),
  ].join('\n')
  const parsed = parseLabReportText(text)

  it('toma el nombre del renglón de arriba y no deja "Resultado" como analito', () => {
    expect(summary(text)).toEqual([
      ['Trigliceridos', '134', 'mg/dl', false],
      ['Colesterol Hdl', '52', 'mg/dl', false],
      ['Colesterol Ldl', '88', 'mg/dl', false],
    ])
  })

  it('la tabla de interpretación va al rango de referencia, no a filas nuevas', () => {
    expect(parsed.rows[0]?.referenceRange).toBe('Hasta 150 mg/dl')
    expect(parsed.rows[1]?.referenceRange).toContain('Mayor de 55 mg/dl : Sin riesgo')
    expect(parsed.rows[1]?.referenceRange?.length).toBeLessThanOrEqual(120)
    // "Hombres" va antes del valor: sin eso el rango se leería como general.
    expect(parsed.rows[1]?.referenceRange?.startsWith('Hombres: Mayor de 55')).toBe(true)
  })

  it('omite el encabezado con datos personales y conserva los renglones de resultado', () => {
    for (const leaked of ['GOMEZ', '30111222', '884512']) expect(parsed.transcription).not.toContain(leaked)
    expect(parsed.transcription).toContain('Trigliceridos')
    for (const row of parsed.rows) expect(rowIsGrounded(row, parsed.lines)).toBe(true)
  })
})

describe('formato B — tabla de cuatro columnas, con valor relativo y absoluto', () => {
  const text = [
    right('Página 1 de 7'),
    'Paciente: GOMEZ ANA',
    'Documento: 30111222',
    'Fecha de Nac.: 14/03/1985',
    line('Fecha y Orden:', '03/02/2026 884512'),
    'Hemograma',
    'Método: Impedancia- Citometría de Flujo',
    'Muestra : sangre entera',
    line('Hematíes', '5120000', '/mm3', '4380000-5820000'),
    line('Hemoglobina', '15,2', 'g/dL', '13,2-16,8'),
    line('ADE (RDW):', '13,1', '%', '11,6-14,8'),
    'Diferencial Leucocitario:',
    line('Neutrófilos', '61,3', '%', '4810', '/mm3', 'Adultos:41-69 %'),
    right('2200-6800/mm3'),
    right('Niños:23-61%'),
    line('Basófilos:', '0,6', '%', '47', '/mm3', 'Adultos: 0 - 1 %'),
    right('7-80/mm3.'),
    right('Niños: 0 - 0.8 %'),
    line('Homa', '2,10', 'hasta 2,70'),
    line('Colesterol Total', '168', 'mg/dL', 'Deseable: Menor de 200'),
    right('Limítrofe alto 200 - 239'),
    right('Alto: Mayor o igual de 240'),
    'Observaciones:',
  ].join('\n')
  const parsed = parseLabReportText(text)
  const row = (analyte: string) => parsed.rows.find((entry) => entry.analyte === analyte)

  it('lee cada fila de la tabla y separa el valor absoluto del relativo', () => {
    expect(summary(text)).toEqual([
      ['Hematíes', '5120000', '/mm3', false],
      ['Hemoglobina', '15,2', 'g/dL', false],
      ['ADE (RDW)', '13,1', '%', false],
      ['Neutrófilos', '61,3', '%', false],
      ['Neutrófilos (/mm3)', '4810', '/mm3', true],
      ['Basófilos', '0,6', '%', false],
      ['Basófilos (/mm3)', '47', '/mm3', true],
      ['Homa', '2,10', null, false],
      ['Colesterol Total', '168', 'mg/dL', false],
    ])
  })

  it('los renglones de referencia no se convierten en resultados', () => {
    const names = parsed.rows.map((entry) => entry.analyte)
    for (const noise of ['Niños', 'Limítrofe alto', 'Alto', 'Deseable']) expect(names).not.toContain(noise)
  })

  it('rangos: el de la misma fila y los renglones que siguen', () => {
    expect(row('Hematíes')?.referenceRange).toBe('4380000-5820000')
    expect(row('Homa')?.referenceRange).toBe('hasta 2,70')
    expect(row('Neutrófilos')?.referenceRange).toContain('Adultos:41-69 %')
    expect(row('Neutrófilos')?.referenceRange).toContain('2200-6800/mm3')
    expect(row('Colesterol Total')?.referenceRange).toContain('Limítrofe alto 200 - 239')
  })

  it('sin fecha de nacimiento, documento ni nombre en lo que se guarda', () => {
    for (const leaked of ['GOMEZ', '30111222', '1985', '884512']) expect(parsed.transcription).not.toContain(leaked)
  })
})

describe('formato C — "Valor Hallado:91 mg %" pegado a la etiqueta', () => {
  const text = [
    'Laboratorio de Analisis Clinicos "Ejemplo"',
    line('Protocolo:', '100.001', 'Fecha:', '03/02/2026'),
    line('Paciente:', 'GOMEZ ANA', 'Sexo:', 'Femenino'),
    line('Teléfono:', 'Edad:', '40 Años'),
    'Dosaje de Glucosa Basal en Sangre',
    right('Valores Normales'),
    line('Método:', 'Enzimático'),
    line('Valor Hallado:91 mg %', 'En ayunas: (8 hs sin comer) :'),
    right('Normal: 70 a 99 mg%'),
    right('Prediabetes : 100 a 125 mg%'),
    right('Diabetes: 126 mg % o mas (confirmado al'),
    right('menos por dos pruebas).'),
    'Hemoglobina Glicosilada',
    right('Valores Normales'),
    line('Método:', 'Inmunoturbidimetría'),
    line('Resultado:5.1 %Hbglic', 'Valor de ref.:'),
    right('No diabeticos: 4,0 a 5.7 %'),
    right('Laura Ejemplo'),
    right('Bioquimica'),
    right('MP 0000 ( firma electronica)'),
  ].join('\n')
  const parsed = parseLabReportText(text)

  it('dos resultados, con el nombre del estudio y la unidad tal cual', () => {
    expect(summary(text)).toEqual([
      ['Dosaje de Glucosa Basal en Sangre', '91', 'mg %', false],
      ['Hemoglobina Glicosilada', '5.1', '%Hbglic', false],
    ])
  })

  it('la firma y la matrícula no entran al rango de referencia', () => {
    expect(parsed.rows[0]?.referenceRange).toContain('Normal: 70 a 99 mg%')
    expect(parsed.rows[1]?.referenceRange).toBe('No diabeticos: 4,0 a 5.7 %')
    for (const leaked of ['GOMEZ', '100.001']) expect(parsed.transcription).not.toContain(leaked)
  })
})

describe('formato D — "Analito : valor unidad"', () => {
  const text = [
    line('Av. Ejemplo', '100 | Tel:(011) 5555-0100 | Ciudad'),
    right('Página: 1'),
    line('Paciente:', 'GOMEZ, ANA', 'Protocolo Nº:', '884512'),
    line('Obra Social:', 'OSEJ', 'DNI:', '30111222'),
    'HEMOGRAMA',
    'METODO:CONTADOR HEMATOLOGICO',
    line('Hematocrito', ':', '40 %'),
    line('Hematíes', ':', '4.510.000 /mm3'),
    line('Leucocitos', ':', '7.200 por mm3'),
    line('RECUENTO DE PLAQUETAS', ':', '248.000 /mm3', 'V.R: Mayor de 150.000 /mm3'),
    line('GLUCEMIA', ':', '90 mg/dl'),
    right('Método: Enzimático'),
    right('V.R: de 60 a 110 mg/dl'),
    line('HEMOGLOBINA GLICOSILADA HBA 1C', ':', '5,1 %', 'Método: Inmunoturbidimétrico,'),
    right('V.R: No diabéticos: 4.0 - 6.0 %'),
    right('Diab. controlados: 6.0 - 8.0 %'),
    line('TSH - TIROTROFINA', ':', '1,35 μUI/ml'),
    right('Método: Quimioluminiscencia'),
    right('V.R: Adultos : 0,40 a 4,00 μUI/ml'),
    right('1-11 meses 0,8-6,2 μUI/ml'),
    'Protocolo validado electrónicamente',
  ].join('\n')
  const parsed = parseLabReportText(text)
  const row = (analyte: string) => parsed.rows.find((entry) => entry.analyte === analyte)

  it('siete resultados; la dirección del laboratorio no es uno de ellos', () => {
    expect(summary(text)).toEqual([
      ['Hematocrito', '40', '%', false],
      ['Hematíes', '4.510.000', '/mm3', false],
      ['Leucocitos', '7.200', 'por mm3', true],
      ['RECUENTO DE PLAQUETAS', '248.000', '/mm3', true],
      ['GLUCEMIA', '90', 'mg/dl', false],
      ['HEMOGLOBINA GLICOSILADA HBA 1C', '5,1', '%', false],
      ['TSH - TIROTROFINA', '1,35', 'μUI/ml', false],
    ])
    expect(row('Hematíes')?.value).toBe(4510000)
  })

  it('el rango viene de la misma fila o de los renglones de abajo, sin el método', () => {
    expect(row('RECUENTO DE PLAQUETAS')?.referenceRange).toBe('Mayor de 150.000 /mm3')
    expect(row('GLUCEMIA')?.referenceRange).toBe('de 60 a 110 mg/dl')
    expect(row('HEMOGLOBINA GLICOSILADA HBA 1C')?.referenceRange).toBe('No diabéticos: 4.0 - 6.0 % · Diab. controlados: 6.0 - 8.0 %')
    expect(row('TSH - TIROTROFINA')?.referenceRange).toBe('Adultos : 0,40 a 4,00 μUI/ml · 1-11 meses 0,8-6,2 μUI/ml')
  })

  it('sin nombre, documento ni número de protocolo', () => {
    for (const leaked of ['GOMEZ', '30111222', '884512']) expect(parsed.transcription).not.toContain(leaked)
  })
})

describe('formato E — tabla con unidad que empieza con número', () => {
  const text = [
    line('Paciente :', 'GOMEZ ANA', 'Página', '1 de 3'),
    line('Protocolo Nº :', '884512', 'Ingreso :', '03/02/2026 09:15'),
    line('Determinación', 'Resultado', 'Unidad', 'Valores de Referencia'),
    line('RECUENTO DE PLAQUETAS', '231', '10e9/L', '182-369'),
    'Método: Impedancia con enfoque hidrodinámico',
    line('COLESTEROL TOTAL', '176', 'mg/dL', 'Valor deseable: menor a 200'),
    line('Método: Enzimático-Colorimétrico', 'Valor límite: de 200 a 239'),
    line('Tipo de muestra: Suero.', 'Valor elevado: mayor a 240'),
    'COLESTEROL HDL',
    'Método:Enzimático colorimétrico homogéneo',
    line('HDL Colesterol', '44', 'mg/dL', 'Hombres: mayor a 40'),
    right('Mujeres: mayor a 50'),
    line('Índice de Castelli (Col.Total/Col.HDL)', '4,0', 'hasta 4,5'),
  ].join('\n')
  const parsed = parseLabReportText(text)

  it('cuatro resultados, con unidad "10e9/L" y un índice sin unidad', () => {
    expect(summary(text)).toEqual([
      ['RECUENTO DE PLAQUETAS', '231', '10e9/L', false],
      ['COLESTEROL TOTAL', '176', 'mg/dL', false],
      ['HDL Colesterol', '44', 'mg/dL', false],
      ['Índice de Castelli (Col.Total/Col.HDL)', '4,0', null, false],
    ])
  })

  it('los valores de referencia que siguen al método se suman al rango', () => {
    expect(parsed.rows[0]?.referenceRange).toBe('182-369')
    expect(parsed.rows[1]?.referenceRange).toBe('Valor deseable: menor a 200 · Valor límite: de 200 a 239 · Valor elevado: mayor a 240')
    expect(parsed.rows[2]?.referenceRange).toBe('Hombres: mayor a 40 · Mujeres: mayor a 50')
    expect(parsed.rows[3]?.referenceRange).toBe('hasta 4,5')
  })
})

describe('texto sin columnas — renglones de referencia que parecen resultados', () => {
  it('un intervalo o una comparación no es un resultado', () => {
    const text = ['Glucosa 92 mg/dl', 'Normal: 70 a 99 mg%', 'Niños: 0 - 0.8 %', 'Deseable: Menor de 200', 'como meta < 70 mg/dL', 'Con 8 hs de ayuno'].join('\n')
    expect(summary(text)).toEqual([['Glucosa', '92', 'mg/dl', false]])
  })

  it('un analito que termina en una letra sigue siendo un analito', () => {
    expect(summary('Vitamina A 45 ug/dL\nHepatitis B Anticore: No reactivo')).toEqual([
      ['Vitamina A', '45', 'ug/dL', false],
      ['Hepatitis B Anticore', 'No reactivo', null, false],
    ])
  })
})

describe('detalles de informes reales', () => {
  const header = [line('Paciente:', 'Fecha:'), line('GOMEZ, ANA', '03/02/2026 09:15:40')]

  it('valor y unidad pegados, con segundo valor en otra unidad', () => {
    const parsed = parseLabReportText([...header, line('Hemoglobina', '14,1', 'g/dL', '12,0-16,0'), line('Neutrófilos', '61,3%', '4810/mm3', 'Adultos:41-69 %')].join('\n'))
    expect(parsed.rows.map((row) => [row.analyte, row.printedValue, row.unit, row.needsReview])).toEqual([
      ['Hemoglobina', '14,1', 'g/dL', false],
      ['Neutrófilos', '61,3', '%', false],
      ['Neutrófilos (/mm3)', '4810', '/mm3', true],
    ])
    expect(parsed.rows.every((row) => rowIsGrounded(row, parsed.lines))).toBe(true)
  })

  it('"H.C.M." es un analito, no una historia clínica; "HC: 1234" sí se omite', () => {
    const parsed = parseLabReportText([...header, line('V.C.M.', '88,4', 'fL', '81,0-95,0'), line('H.C.M.', '30,1', 'pg', '26,7-32,5'), 'HC: 445566', 'H.C. N° 445566'].join('\n'))
    expect(summary([...header, line('V.C.M.', '88,4', 'fL'), line('H.C.M.', '30,1', 'pg')].join('\n')).map((row) => row[0])).toEqual(['V.C.M.', 'H.C.M.'])
    expect(parsed.rows.map((row) => row.analyte)).toEqual(['V.C.M.', 'H.C.M.'])
    expect(parsed.transcription).not.toContain('445566')
  })

  it('un dato personal en una columna posterior se tapa sin perder el resultado', () => {
    const parsed = parseLabReportText([...header, line('Glucosa', '92', 'mg/dL', 'Paciente: GOMEZ ANA')].join('\n'))
    expect(parsed.rows.map((row) => [row.analyte, row.printedValue, row.referenceRange])).toEqual([['Glucosa', '92', null]])
    expect(parsed.transcription).not.toContain('GOMEZ')
    expect(parsed.transcription).toContain('[omitido]')
  })

  it('la dirección, la fecha y la hora no son resultados', () => {
    const text = [...header, line('Glucosa', '92', 'mg/dL', '70-100'), 'Av. Siempreviva 742, CABA', line('Emitido', '03/02/2026'), line('Hora de toma', '09:15'), line('Orden', '12-3456')].join('\n')
    expect(summary(text)).toEqual([['Glucosa', '92', 'mg/dL', false]])
  })

  it('el número de página y la firma no entran al rango ni quedan como renglones sin leer', () => {
    const parsed = parseLabReportText(
      [...header, line('Cloro', '102', 'mEq/L', '98-106'), right('Página3 de7'), line('Validado por: Bioq. NOMBRE FICTICIO', 'M.N. 9999'), 'Este informe no reemplaza la consulta médica. La firma digital vale como original desde el 01/01/2020 en todo el país.'].join('\n'),
    )
    expect(parsed.rows[0]?.referenceRange).toBe('98-106')
    expect(parsed.unparsedLines).toEqual([])
  })

  it('un renglón con números y columnas que no se pudo leer queda marcado', () => {
    const parsed = parseLabReportText([...header, line('Glucosa', '92', 'mg/dL'), line('Relación A/G', 'ver 1,2 aprox')].join('\n'))
    expect(parsed.unparsedLines).toHaveLength(1)
  })

  it('si la referencia no entra completa, termina en "…"', () => {
    const parsed = parseLabReportText(
      [...header, line('TSH', '2,10', 'μUI/mL', '0-30 días: 1.3-10'), right('2-12 meses: 1.0-6.8'), right('1-5 años: 0.7-5.7'), right('6-10 años: 0.6-5.0'), right('11-18 años: 0.5-4.3'), right('Adultos: 0.27 a 4.20')].join('\n'),
    )
    expect(parsed.rows[0]?.referenceRange).toBe('0-30 días: 1.3-10 · 2-12 meses: 1.0-6.8 · 1-5 años: 0.7-5.7 · 6-10 años: 0.6-5.0 · 11-18 años: 0.5-4.3 …')
  })

  it('"Mujeres" se antepone a su valor y un nombre suelto no', () => {
    const parsed = parseLabReportText([...header, line('Ferritina', '80', 'ng/mL', 'Hombres:'), right('30 a 400'), right('Mujeres'), right('13 a 150'), right('NOMBRE FICTICIO'), right('Bioquímica')].join('\n'))
    expect(parsed.rows[0]?.referenceRange).toBe('Hombres: 30 a 400 · Mujeres: 13 a 150')
  })

  it('un valor suelto con la misma unidad es la referencia, no un segundo resultado', () => {
    const parsed = parseLabReportText([...header, line('Trigliceridos', '134 mg/dl', '150 mg/dl')].join('\n'))
    expect(parsed.rows.map((row) => [row.analyte, row.printedValue, row.referenceRange])).toEqual([['Trigliceridos', '134', '150 mg/dl']])
  })

  it('si entre el título y "Resultado" hay un pie o un salto de página, el nombre queda para revisar', () => {
    const near = parseLabReportText([...header, 'Glucemia', 'Método: Enzimático', line('Resultado', '92 mg/dl')].join('\n'))
    expect(near.rows.map((row) => [row.analyte, row.needsReview])).toEqual([['Glucemia', false]])

    const far = parseLabReportText(
      [...header, 'Glucemia', line('Resultado', '92 mg/dl'), 'Uremia', 'Informe firmado digitalmente', 'Calle Falsa 742, CABA', ...header, line('Resultado', '30 mg/dl')].join('\n'),
    )
    expect(far.rows.map((row) => [row.analyte, row.printedValue, row.needsReview])).toEqual([
      ['Glucemia', '92', false],
      ['Calle Falsa 742, CABA', '30', true],
    ])
    expect(far.rows[1]?.reviewReason).toMatch(/renglón más arriba/)
  })

  it('"Cama", "Sala" o "Legajo" con un número no cortan el encabezado', () => {
    const parsed = parseLabReportText([line('Cama', '4'), line('Legajo', '5521'), ...header, line('Glucosa', '92', 'mg/dL')].join('\n'))
    expect(parsed.rows.map((row) => row.analyte)).toEqual(['Glucosa'])
    expect(parsed.transcription).not.toContain('GOMEZ')
  })
})
