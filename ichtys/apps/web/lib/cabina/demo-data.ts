import type {
  CellDef,
  Certainty,
  Condition,
  ConsentItem,
  DemoStudy,
  PatientDef,
  ProcedureDef,
  SheetSection,
  VisitAttributes,
  VisitDef,
  VisitTiming,
  VisitType,
  WindowSpec,
} from './types'

const T1 = 'Rama principal'
const T2 = 'Rescate'

function cond(key: string, expr: string, kind: Condition['kind'] = 'population'): Condition {
  return { kind, key, expr }
}

function attributes(partial: Partial<VisitAttributes> = {}): VisitAttributes {
  return { fasting: false, onSite: true, armOnly: null, ...partial }
}

function timing(
  kind: VisitTiming['kind'],
  value: number | null,
  unit: VisitTiming['unit'],
  recurrence: VisitTiming['recurrence'] = null,
): VisitTiming {
  return { kind, value, unit, anchor: 'v2', recurrence }
}

function visit(
  key: string,
  tableKey: 'T1' | 'T2',
  tableTitle: string,
  label: string,
  visitTiming: VisitTiming,
  window: WindowSpec | null,
  type: VisitType,
  visitAttributes: VisitAttributes,
  annual = false,
): VisitDef {
  return {
    key,
    tableKey,
    tableTitle,
    printedId: key,
    label,
    timing: visitTiming,
    window,
    type,
    attributes: visitAttributes,
    annual,
  }
}

const day = (value: number): VisitTiming => timing('scheduled', value, 'day')
const week = (value: number, kind: VisitTiming['kind'] = 'scheduled'): VisitTiming => timing(kind, value, 'week')
const span = (before: number, after: number): WindowSpec => ({ before, after, unit: 'day' })

const visits: VisitDef[] = [
  visit('V1', 'T1', T1, 'Selección', day(-28), span(7, 3), 'screening', attributes()),
  visit('V2', 'T1', T1, 'Día 1', day(0), span(0, 0), 'standard', attributes({ fasting: true })),
  visit('V4', 'T1', T1, 'Semana 4', week(4), span(2, 3), 'standard', attributes()),
  visit('V7', 'T1', T1, 'Semana 12', week(12), span(3, 7), 'standard', attributes({ fasting: true })),
  visit('V9', 'T1', T1, 'Semana 24', week(24), span(7, 7), 'standard', attributes()),
  visit('V10', 'T1', T1, 'Semana 48', week(48), span(7, 7), 'standard', attributes()),
  visit('V11', 'T1', T1, 'Semana 56', week(56, 'annual'), span(5, 5), 'standard', attributes({ fasting: true }), true),
  visit('FA', 'T1', T1, 'Fin de estudio', week(104), span(7, 14), 'end_of_study', attributes()),
  visit('VDT', 'T1', T1, 'Discontinuación', timing('event', null, null), null, 'early_termination', attributes({ onSite: null })),
  visit(
    'VR',
    'T1',
    T1,
    'Seguimiento',
    timing('recurrent', 12, 'week', { every: 12, unit: 'week', untilWeek: 104 }),
    span(7, 7),
    'follow_up',
    attributes(),
  ),
  visit('R1', 'T2', T2, 'Semana 12', week(12), span(7, 7), 'follow_up', attributes()),
  visit('RA', 'T2', T2, 'Anual', week(108, 'annual'), span(14, 14), 'standard', attributes({ fasting: true }), true),
]

const CORE = ['V1', 'V2', 'V4', 'V7', 'V9', 'V10', 'V11', 'FA', 'R1', 'RA', 'VR']
const ANNUAL = ['V11', 'RA']
const WITH_LAB = ['V2', 'V4', 'V7', 'V9', 'V10', 'V11', 'FA', 'RA']

interface Row {
  key: string
  label: string
  detail: string
  section: SheetSection
  visitKeys: string[]
  order: number
  orderFixed?: boolean
  conditions?: Condition[]
  whenLabel?: string
  tone?: ProcedureDef['tone']
  action?: ProcedureDef['action']
  consultDraft?: string
  page?: number
  quote?: string
  highlights?: string[]
  noteRefs?: string[]
  lowOn?: string[]
  mark?: CellDef['mark']
}

const rows: Row[] = [
  {
    key: 'confirm-window',
    label: 'Confirmar fecha y modalidad',
    detail: 'Confirmar que la fecha cae dentro de la ventana y acordar la modalidad con el paciente.',
    section: 'before',
    visitKeys: CORE,
    order: 1,
    whenLabel: 'Hoy',
    page: 21,
    quote: 'Confirmar con el participante que la visita cae dentro de la ventana permitida antes de citarlo.',
    highlights: ['ventana permitida'],
  },
  {
    key: 'fasting-call',
    label: 'Avisar el ayuno',
    detail: 'Ayuno de al menos 8 horas, solo agua, sin ejercicio intenso.',
    section: 'before',
    visitKeys: CORE,
    order: 2,
    whenLabel: '−48 h',
    conditions: [cond('fasting', 'solo si la visita es en ayunas', 'fasting')],
    page: 19,
    quote: 'El participante debe estar en ayunas al menos 8 horas. Se permite agua. No debe hacer ejercicio intenso.',
    highlights: ['ayunas al menos 8 horas'],
    noteRefs: ['N-ayuno'],
  },
  {
    key: 'bring-meds',
    label: 'Pedir medicación y diario',
    detail: 'Pedir que traiga la medicación y el diario de dosis.',
    section: 'before',
    visitKeys: CORE,
    order: 3,
    whenLabel: '−48 h',
    page: 57,
    quote: 'El participante trae a la visita la medicación del estudio y el diario de dosis.',
    highlights: ['diario de dosis'],
  },
  {
    key: 'tablets-ready',
    label: 'Tabletas de cuestionarios',
    detail: 'Dejar las tabletas cargadas y listas antes de que llegue el paciente.',
    section: 'before',
    visitKeys: ['V4', 'V7', 'V9', 'V10', 'V11', 'FA', 'RA'],
    order: 4,
    whenLabel: 'Día',
    page: 70,
    quote: 'Los cuestionarios se completan en la tableta del sitio, antes de cualquier evaluación clínica.',
    highlights: ['antes de cualquier evaluación clínica'],
  },
  {
    key: 'urine-bottles',
    label: 'Frascos de orina de 24 h',
    detail: 'Entregados los 4 frascos de orina de 24 h en la visita anterior.',
    section: 'before',
    visitKeys: ['V11', 'RA'],
    order: 5,
    whenLabel: 'Se hizo en V10',
    conditions: [cond('erc', 'solo ERC')],
    page: 83,
    quote: 'En enfermedad renal crónica se entregan 4 frascos para la recolección de orina de 24 horas.',
    highlights: ['orina de 24 horas'],
    noteRefs: ['N-erc'],
  },
  {
    key: 'consent-check',
    label: 'Consentimiento vigente',
    detail: 'Verificar la versión firmada antes de cualquier procedimiento.',
    section: 'day',
    visitKeys: [...CORE, 'VDT'],
    order: 1,
    page: 21,
    quote: 'Ningún procedimiento de la visita empieza sin un consentimiento vigente y de la versión en curso.',
    highlights: ['consentimiento vigente'],
  },
  {
    key: 'questionnaires',
    label: 'Cuestionarios del paciente',
    detail: 'Antes de cualquier evaluación clínica y antes de hablar con el personal.',
    section: 'day',
    visitKeys: ['V4', 'V7', 'V9', 'V10', 'V11', 'FA', 'RA'],
    order: 2,
    orderFixed: true,
    page: 70,
    quote: 'Los cuestionarios se completan antes de cualquier evaluación clínica y antes de hablar con el personal.',
    highlights: ['antes de cualquier evaluación clínica'],
  },
  {
    key: 'adverse-events',
    label: 'Eventos adversos',
    detail: 'Registrar eventos adversos y, después, las escalas de ánimo.',
    section: 'day',
    visitKeys: [...CORE, 'VDT'],
    order: 3,
    orderFixed: true,
    page: 23,
    quote: 'Los eventos adversos se registran antes de las escalas de ánimo.',
    highlights: ['antes de las escalas de ánimo'],
  },
  {
    key: 'vitals',
    label: 'Signos vitales',
    detail: 'Presión arterial tras 5 minutos sentado.',
    section: 'day',
    visitKeys: CORE,
    order: 4,
    orderFixed: true,
    page: 22,
    quote: 'La presión arterial se mide tras 5 minutos sentado.',
    highlights: ['5 minutos sentado'],
  },
  {
    key: 'ecg',
    label: 'ECG de 12 derivaciones',
    detail: 'Antes de la extracción de sangre.',
    section: 'day',
    visitKeys: ['V1', 'V2', 'V7', 'V11', 'FA', 'RA'],
    order: 5,
    orderFixed: true,
    page: 23,
    quote: 'El ECG se realizará antes de la extracción de sangre, con el participante en decúbito supino durante al menos 10 minutos.',
    highlights: ['antes de la extracción de sangre'],
    noteRefs: ['N-ecg'],
  },
  {
    key: 'draw',
    label: 'Extracción en ayunas',
    detail: 'Laboratorio central. El sitio no informa tubos ni volúmenes: eso está en el manual.',
    section: 'day',
    visitKeys: WITH_LAB,
    order: 6,
    page: 109,
    quote: 'La extracción de la visita se envía al laboratorio central.',
    highlights: ['laboratorio central'],
  },
  {
    key: 'fundus',
    label: 'Fondo de ojo',
    detail: 'Ambos ojos.',
    section: 'day',
    visitKeys: ['V1', 'V11', 'RA'],
    order: 7,
    conditions: [cond('dt2', 'solo DT2')],
    page: 91,
    quote: 'El fondo de ojo de ambos ojos se realiza solo en participantes con diabetes tipo 2.',
    highlights: ['diabetes tipo 2'],
  },
  {
    key: 'dispense',
    label: 'Dispensar y recolectar plumas',
    detail: 'Registrar el movimiento en el sistema de asignación.',
    section: 'day',
    visitKeys: ['V2', 'V4', 'V7', 'V9', 'V10', 'V11', 'R1'],
    order: 8,
    page: 57,
    quote: 'Dispensar y recolectar las plumas, y registrarlo en el sistema de asignación.',
    highlights: ['sistema de asignación'],
  },
  {
    key: 'intensity',
    label: 'Intensidad de medicación',
    detail: 'Registrar antihipertensivos y antihiperglucémicos.',
    section: 'day',
    visitKeys: ['V2', 'V4', 'V7', 'V9', 'V10', 'V11', 'FA', 'RA'],
    order: 9,
    page: 64,
    quote: 'Registrar la intensidad de antihipertensivos y antihiperglucémicos.',
    highlights: ['intensidad de antihipertensivos'],
  },
  {
    key: 'dispense-b',
    label: 'Kit de la rama B',
    detail: 'Entregar el kit que corresponde solo a la rama B.',
    section: 'day',
    visitKeys: ['V2', 'V11', 'RA'],
    order: 10,
    conditions: [cond('arm:B', 'solo rama B', 'arm')],
    page: 58,
    quote: 'El kit de la rama B no se entrega a un participante de la rama A.',
    highlights: ['rama B'],
  },
  {
    key: 'pregnancy-serum',
    label: 'Embarazo en suero',
    detail: 'Test de embarazo en suero.',
    section: 'day',
    visitKeys: ['V1', 'V2', 'V4', 'V7', 'V9', 'V11', 'FA', 'RA'],
    order: 20,
    conditions: [cond('wocbp', 'solo mujer en edad fértil')],
    page: 22,
    quote: 'A una mujer en edad fértil se le realiza test de embarazo en suero antes de continuar la visita.',
    highlights: ['mujer en edad fértil'],
  },
  {
    key: 'pregnancy-urine',
    label: 'Embarazo en orina',
    detail: 'Test de embarazo en orina, además del sérico.',
    section: 'day',
    visitKeys: ['V1', 'V11', 'RA'],
    order: 21,
    conditions: [cond('wocbp', 'solo mujer en edad fértil')],
    page: 22,
    quote: 'En las visitas indicadas, la mujer en edad fértil también realiza test de embarazo en orina.',
    highlights: ['test de embarazo en orina'],
  },
  {
    key: 'contraception-counsel',
    label: 'Consejería anticonceptiva',
    detail: 'Repasar el método anticonceptivo declarado.',
    section: 'day',
    visitKeys: ['V1', 'V11', 'FA'],
    order: 22,
    conditions: [cond('wocbp', 'solo mujer en edad fértil')],
    page: 22,
    quote: 'Se repasa el método anticonceptivo con cada mujer en edad fértil.',
    highlights: ['método anticonceptivo'],
  },
  {
    key: 'heart-failure',
    label: 'Evaluación de insuficiencia cardíaca',
    detail: 'Evaluación clínica reservada a insuficiencia cardíaca.',
    section: 'day',
    visitKeys: ['V1', 'V7', 'V11', 'FA'],
    order: 23,
    conditions: [cond('ic', 'solo IC')],
    page: 40,
    quote: 'La evaluación de insuficiencia cardíaca aplica solo a participantes con ese antecedente.',
    highlights: ['insuficiencia cardíaca'],
  },
  {
    key: 'nt-probnp',
    label: 'NT-proBNP',
    detail: 'Analito reservado a insuficiencia cardíaca.',
    section: 'lab',
    visitKeys: ['V1', 'V11', 'FA'],
    order: 8,
    conditions: [cond('ic', 'solo IC')],
    page: 40,
    quote: 'NT-proBNP se extrae solo si el participante tiene insuficiencia cardíaca.',
    highlights: ['NT-proBNP'],
  },
  {
    key: 'dispense-a',
    label: 'Kit de la rama A',
    detail: 'Entregar el kit que corresponde solo a la rama A.',
    section: 'day',
    visitKeys: ['V2', 'V11', 'RA'],
    order: 24,
    conditions: [cond('arm:A', 'solo rama A', 'arm')],
    page: 58,
    quote: 'El kit de la rama A no se entrega a un participante de la rama B.',
    highlights: ['rama A'],
  },
  {
    key: 'diary-a',
    label: 'Diario de dosis de la rama A',
    detail: 'Revisar el diario específico de la rama A.',
    section: 'med',
    visitKeys: ['V4', 'V7', 'V11'],
    order: 4,
    conditions: [cond('arm:A', 'solo rama A', 'arm')],
    page: 57,
    quote: 'El diario de dosis de la rama A se revisa en las visitas indicadas.',
    highlights: ['rama A'],
  },
  {
    key: 'block-fundus',
    label: 'Fondo de ojo de la selección',
    detail: 'El fondo de ojo de V1 tiene que estar leído antes de esta visita. En la demo figura pendiente.',
    section: 'block',
    visitKeys: ANNUAL,
    order: 1,
    tone: 'red',
    conditions: [cond('dt2', 'solo DT2')],
    page: 28,
    quote: 'El informe del fondo de ojo de la visita de selección debe estar leído antes de la visita anual.',
    highlights: ['antes de la visita anual'],
  },
  {
    key: 'block-insulin',
    label: 'Ajuste de insulina',
    detail: 'Si el paciente recibe insulina, confirmar la reducción pactada en la visita 2.',
    section: 'block',
    visitKeys: ['V2', 'V11', 'RA'],
    order: 2,
    tone: 'red',
    conditions: [cond('dt2', 'solo DT2')],
    page: 65,
    quote: 'Si el participante recibe insulina, confirmar la reducción pactada en la visita 2.',
    highlights: ['reducción pactada'],
  },
  {
    key: 'undef-duration',
    label: 'Duración de la visita',
    detail: 'El protocolo no define cuánto dura la visita. No se inventa: remite al manual.',
    section: 'undefined',
    visitKeys: ANNUAL,
    order: 1,
    tone: 'amber',
    action: 'manual',
  },
  {
    key: 'undef-tubes',
    label: 'Tubos y volúmenes',
    detail: 'El protocolo no lista tubos ni volúmenes por visita.',
    section: 'undefined',
    visitKeys: WITH_LAB,
    order: 2,
    tone: 'amber',
    action: 'manual',
  },
  {
    key: 'undef-temp',
    label: 'Temperatura de almacenamiento',
    detail: 'El protocolo no dice a qué temperatura se guardan las muestras en el sitio.',
    section: 'undefined',
    visitKeys: WITH_LAB,
    order: 3,
    tone: 'amber',
    action: 'manual',
  },
  {
    key: 'sponsor-onsite',
    label: 'Presencial o solo clínica',
    detail: 'La tabla dice «clínica» y el texto no marca esta visita como presencial (inconsistencia I-2).',
    section: 'sponsor',
    visitKeys: ['V11'],
    order: 1,
    tone: 'violet',
    action: 'consult',
    consultDraft:
      'Consulta al patrocinador. En la tabla de actividades la visita V11 figura como clínica, pero el texto no la marca como presencial (inconsistencia I-2, página 21). ¿Debemos tratarla como presencial?',
    page: 21,
    quote: 'La tabla marca la visita como clínica. El texto de la misma página no dice que sea presencial.',
    highlights: ['no dice que sea presencial'],
  },
  {
    key: 'sponsor-coag',
    label: 'Coagulación anual y fin de estudio',
    detail: 'La coagulación aparece en la visita anual y no en la de fin de estudio.',
    section: 'sponsor',
    visitKeys: ['V11', 'FA'],
    order: 2,
    tone: 'violet',
    action: 'consult',
    consultDraft:
      'Consulta al patrocinador. La coagulación figura en la visita anual y no en la visita de fin de estudio. ¿La omisión es intencional?',
    page: 109,
    quote: 'La coagulación figura en la visita anual. La visita de fin de estudio no la repite.',
    highlights: ['no la repite'],
  },
  {
    key: 'hba1c',
    label: 'HbA1c',
    detail: 'Laboratorio central.',
    section: 'lab',
    visitKeys: ['V1', 'V7', 'V11', 'FA', 'RA'],
    order: 1,
    page: 109,
    quote: 'HbA1c se envía al laboratorio central en las visitas marcadas.',
    highlights: ['HbA1c'],
  },
  {
    key: 'glucose',
    label: 'Glucosa en ayunas',
    detail: 'Solo si esta visita exige ayuno.',
    section: 'lab',
    visitKeys: WITH_LAB,
    order: 2,
    conditions: [cond('fasting', 'solo si la visita es en ayunas', 'fasting')],
    page: 109,
    quote: 'La glucosa en ayunas se extrae únicamente en las visitas que exigen ayuno.',
    highlights: ['glucosa en ayunas'],
  },
  {
    key: 'lipids',
    label: 'Perfil lipídico',
    detail: 'Laboratorio central.',
    section: 'lab',
    visitKeys: ['V1', 'V11', 'FA', 'RA'],
    order: 3,
    page: 109,
    quote: 'El perfil lipídico se envía al laboratorio central.',
    highlights: ['perfil lipídico'],
  },
  {
    key: 'renal',
    label: 'Función renal',
    detail: 'Laboratorio central.',
    section: 'lab',
    visitKeys: WITH_LAB,
    order: 4,
    page: 109,
    quote: 'La función renal se envía al laboratorio central.',
    highlights: ['función renal'],
  },
  {
    key: 'coagulation',
    label: 'Coagulación',
    detail: 'Figura en la visita anual. La lectura de la celda no es pareja en todas las páginas.',
    section: 'lab',
    visitKeys: ANNUAL,
    order: 5,
    page: 109,
    quote: 'La celda de coagulación está marcada en la visita anual. El texto no precisa el tubo.',
    highlights: ['no precisa el tubo'],
    lowOn: ['V11'],
  },
  {
    key: 'urine-24',
    label: 'Orina de 24 h',
    detail: 'Recolección completa.',
    section: 'lab',
    visitKeys: ['V10', 'V11', 'RA'],
    order: 6,
    conditions: [cond('erc', 'solo ERC')],
    page: 83,
    quote: 'La orina de 24 horas se recolecta solo en enfermedad renal crónica.',
    highlights: ['orina de 24 horas'],
    noteRefs: ['N-erc'],
  },
  {
    key: 'ketones',
    label: 'Cetonas en orina',
    detail: 'La extracción de esta celda no está segura en todas las visitas.',
    section: 'lab',
    visitKeys: ['V9', 'V10', 'V11', 'FA', 'RA'],
    order: 7,
    page: 110,
    quote: 'Hay una marca en cetonas en orina. En una de las páginas la columna no coincide con el encabezado.',
    highlights: ['no coincide con el encabezado'],
    lowOn: ['V10'],
  },
  {
    key: 'med-banned',
    label: 'Prohibido',
    detail: 'Pramlintida y agonistas del receptor de incretinas.',
    section: 'med',
    visitKeys: CORE,
    order: 1,
    tone: 'red',
    page: 63,
    quote: 'Están prohibidas la pramlintida y los agonistas del receptor de incretinas.',
    highlights: ['pramlintida'],
  },
  {
    key: 'med-record',
    label: 'Registrar',
    detail: 'Intensidad de antihipertensivos.',
    section: 'med',
    visitKeys: CORE,
    order: 2,
    tone: 'amber',
    page: 64,
    quote: 'Registrar la intensidad de los antihipertensivos en cada visita.',
    highlights: ['intensidad de los antihipertensivos'],
  },
  {
    key: 'med-missed',
    label: 'Dosis omitidas',
    detail: 'Tres o más dosis omitidas cuentan como interrupción. Avisar dos semanas antes de reiniciar.',
    section: 'med',
    visitKeys: CORE,
    order: 3,
    page: 61,
    quote: 'Tres o más dosis omitidas cuentan como interrupción. Hay que avisar dos semanas antes de reiniciar.',
    highlights: ['dos semanas antes de reiniciar'],
  },
]

function compile(source: Row[]): { procedures: ProcedureDef[]; cells: CellDef[] } {
  const procedures: ProcedureDef[] = []
  const cells: CellDef[] = []
  for (const row of source) {
    procedures.push({
      key: row.key,
      label: row.label,
      detail: row.detail,
      section: row.section,
      visitKeys: row.visitKeys,
      order: row.order,
      orderFixed: row.orderFixed ?? false,
      conditions: row.conditions ?? [],
      whenLabel: row.whenLabel,
      tone: row.tone,
      action: row.action ?? null,
      consultDraft: row.consultDraft,
    })
    if (row.page === undefined || row.quote === undefined) continue
    for (const visitKey of row.visitKeys) {
      const low = row.lowOn?.includes(visitKey) ?? false
      const certainty: Certainty = low ? 'low' : 'high'
      cells.push({
        visitKey,
        procedureKey: row.key,
        mark: row.mark ?? (row.conditions && row.conditions.length > 0 ? 'conditional' : 'x'),
        page: row.page,
        certainty,
        noteRefs: row.noteRefs ?? [],
        quote: row.quote,
        highlights: row.highlights ?? [],
        howRead: low
          ? 'La marca está en la página, pero la columna o el texto no cierran. Certeza baja: hay que revisarla.'
          : 'Marca leída en la columna de la visita y confirmada por el texto. Dos fuentes coinciden.',
        sourceLabel: row.noteRefs && row.noteRefs.length > 0 ? 'Tabla de actividades y nota al pie' : 'Tabla de actividades y texto',
      })
    }
  }
  return { procedures, cells }
}

const { procedures, cells } = compile(rows)

function consent(label: string, state: ConsentItem['state'], page: number | null): ConsentItem {
  return { label, state, page }
}

const patients: PatientDef[] = [
  {
    id: '0042',
    code: '0042',
    anchorOffsetDays: -387,
    arm: 'B',
    conditions: { dt2: true, erc: true, ic: false, wocbp: false },
    consents: [
      consent('Principal, versión 4, firmado el día de la visita 2', 'vigente', null),
      consent('Muestra genética (opcional)', 'vigente', 92),
      consent('¿Biomarcadores llevan formulario aparte? No lo dice el protocolo.', 'revisar', null),
    ],
  },
  {
    id: '0031',
    code: '0031',
    anchorOffsetDays: -28,
    arm: 'A',
    conditions: { dt2: false, erc: false, ic: false, wocbp: false },
    consents: [consent('Principal, versión 4', 'vigente', 21)],
  },
  {
    id: '0008',
    code: '0008',
    anchorOffsetDays: -83,
    arm: 'A',
    conditions: { dt2: false, erc: false, ic: false, wocbp: true },
    consents: [
      consent('Principal, versión 4', 'vigente', 21),
      consent('Test de embarazo explicado', 'vigente', 22),
    ],
  },
  {
    id: '0023',
    code: '0023',
    anchorOffsetDays: -173,
    arm: 'B',
    conditions: { dt2: false, erc: true, ic: false, wocbp: false },
    consents: [consent('Principal, versión 3. Hay una versión 4 vigente.', 'revisar', 21)],
  },
  {
    id: '0017',
    code: '0017',
    anchorOffsetDays: -88,
    arm: 'B',
    conditions: { dt2: true, erc: false, ic: false, wocbp: false },
    consents: [consent('Principal, versión 4', 'vigente', 21)],
  },
]

export const demoStudy: DemoStudy = {
  code: 'FIC-002',
  phase: 'Fase 3',
  title: 'Estudio de demostración',
  visits,
  procedures,
  cells,
  notes: [
    {
      ref: 'N-ayuno',
      tableKey: 'T1',
      text: 'Ayuno de al menos 8 horas. Solo agua. Sin ejercicio intenso.',
      page: 19,
      conditions: [cond('fasting', 'solo si la visita es en ayunas', 'fasting')],
    },
    {
      ref: 'N-erc',
      tableKey: 'T1',
      text: 'Orina de 24 horas solo en enfermedad renal crónica. Son 4 frascos.',
      page: 83,
      conditions: [cond('erc', 'solo ERC')],
    },
    {
      ref: 'N-ecg',
      tableKey: 'T1',
      text: 'Nota c: el ECG va antes de la extracción, en decúbito, al menos 10 minutos.',
      page: 23,
      conditions: [],
    },
  ],
  rules: [
    {
      id: 'R-orden',
      text: 'El orden de los pasos 2 a 5 está fijado. Los demás pasos de la visita no tienen un orden fijado.',
      page: 23,
      conditions: [],
    },
    {
      id: 'R-ventana',
      text: 'Una visita fuera de la ventana es una desviación y se consulta antes de seguir.',
      page: 21,
      conditions: [],
    },
  ],
  inconsistencies: [
    {
      id: 'I-2',
      kind: 'onsite',
      description: 'La tabla dice clínica y el texto no marca la visita V11 como presencial.',
      pages: [21],
    },
    {
      id: 'I-coag',
      kind: 'missing-at-end',
      description: 'La coagulación está en la visita anual y no en el fin de estudio.',
      pages: [109],
    },
  ],
  patients,
  answers: [
    {
      id: 'ayuno',
      patterns: ['puedo comer', 'ayuno', 'en ayunas', 'desayun'],
      answer: 'No puede comer. El ayuno es de al menos 8 horas, solo agua, sin ejercicio intenso.',
      page: 19,
    },
    {
      id: 'agua',
      patterns: ['agua', 'puedo tomar', 'liquido', 'líquido'],
      answer: 'Durante el ayuno se permite agua. No se permite otra bebida.',
      page: 19,
    },
    {
      id: 'extraccion',
      patterns: ['extraigo', 'extracción', 'extraccion', 'sangre', 'tubo', 'laboratorio'],
      answer: 'Se extrae para el laboratorio central. Tubos y volúmenes no están en el protocolo: están en el manual de laboratorio.',
      page: 109,
    },
    {
      id: 'ventana',
      patterns: ['ventana', 'se pasa', 'tarde', 'desvi'],
      answer: 'Si la visita cae fuera de la ventana, es una desviación. Se consulta antes de seguir con los procedimientos.',
      page: 21,
    },
    {
      id: 'fondo',
      patterns: ['fondo de ojo', 'fondo', 'retina'],
      answer: 'El fondo de ojo de ambos ojos corresponde solo si el participante tiene diabetes tipo 2.',
      page: 91,
    },
    {
      id: 'embarazo',
      patterns: ['embarazo', 'embarazada', 'edad fértil', 'edad fertil'],
      answer: 'A una mujer en edad fértil se le hace test de embarazo antes de continuar la visita.',
      page: 22,
    },
    {
      id: 'medicacion',
      patterns: ['medicacion', 'medicación', 'insulina', 'pramlintida', 'prohib'],
      answer: 'Están prohibidas la pramlintida y los agonistas del receptor de incretinas. Si usa insulina, confirmar la reducción pactada en la visita 2.',
      page: 63,
    },
    {
      id: 'consentimiento',
      patterns: ['consentimiento', 'firmar', 'consent'],
      answer: 'Tiene que haber un consentimiento vigente, de la versión en curso, antes de cualquier procedimiento.',
      page: 21,
    },
  ],
}
