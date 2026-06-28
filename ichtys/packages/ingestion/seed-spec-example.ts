import type { ApprovedSpecExample } from './spec-extractor'

/**
 * seed-spec-example.ts — spec canónico de bootstrap para el flywheel few-shot.
 *
 * Problema: getApprovedSpecExamples() retorna [] para la primera org. El prompt
 * del extractor tiene una sección <approved_examples> que queda vacía. Sin
 * ejemplos, el modelo tiene que inferir el formato de salida desde cero.
 *
 * Solución: un spec canónico de un ensayo Fase III en español (realista,
 * genérico, sin datos de patrocinadores reales). Se usa SOLO cuando no hay
 * specs aprobados reales en la org. Es compile-time — no toca la DB, no
 * requiere migración, 0 tokens extra cuando hay specs reales.
 *
 * Actualizable sin migración: editar este archivo y redeploy.
 */
export const SEED_SPEC_EXAMPLE: ApprovedSpecExample = {
  protocolCode: 'SEED-EJEMPLO-F3',
  spec: {
    identification: {
      protocolCode: 'SEED-EJEMPLO-F3',
      title:
        'Estudio de fase III, aleatorizado, doble ciego, controlado con placebo, para evaluar la eficacia y seguridad del fármaco X en pacientes adultos con enfermedad Y moderada a grave',
      phase: '3',
      sourcePages: [1, 2],
    },
    inclusionCriteria: [
      {
        number: '1',
        text: 'Edad entre 18 y 75 años en el momento de la firma del consentimiento informado.',
        sourcePages: [24],
        confidence: 'high',
      },
      {
        number: '2',
        text: 'Diagnóstico confirmado de enfermedad Y de al menos 6 meses de evolución según los criterios diagnósticos internacionales vigentes.',
        sourcePages: [24],
        confidence: 'high',
      },
      {
        number: '3',
        text: 'Puntuación en la escala validada Z ≥ 12 puntos en la visita de selección.',
        sourcePages: [24, 25],
        confidence: 'high',
      },
      {
        number: '4',
        text: 'Capacidad para comprender y firmar el consentimiento informado y cumplir con los procedimientos del estudio según criterio del investigador.',
        sourcePages: [25],
        confidence: 'high',
      },
    ],
    exclusionCriteria: [
      {
        number: '1',
        text: 'Uso de cualquier tratamiento biológico para la enfermedad Y en las 12 semanas previas a la aleatorización.',
        sourcePages: [26],
        confidence: 'high',
      },
      {
        number: '2',
        text: 'Infección activa clínicamente significativa, incluida tuberculosis activa, en el criterio del investigador.',
        sourcePages: [26],
        confidence: 'high',
      },
      {
        number: '3',
        text: 'Embarazo, lactancia o intención de quedar embarazada durante el período del estudio.',
        sourcePages: [26],
        confidence: 'high',
      },
      {
        number: '4',
        text: 'Antecedentes de hipersensibilidad conocida al fármaco X o a cualquiera de sus excipientes.',
        sourcePages: [26, 27],
        confidence: 'high',
      },
      {
        number: '5',
        text: 'Disfunción hepática grave (Child-Pugh clase C) o insuficiencia renal severa (TFGe < 30 mL/min/1,73 m²) en la visita de selección.',
        sourcePages: [27],
        confidence: 'high',
      },
    ],
    endpoints: [
      {
        type: 'primary',
        objective:
          'Evaluar la eficacia del fármaco X versus placebo en la reducción de la actividad de la enfermedad Y a la semana 24.',
        endpoint:
          'Proporción de pacientes que alcanzan respuesta clínica (reducción ≥ 50% en la puntuación de la escala Z) a la semana 24.',
        sourcePages: [18, 19],
        confidence: 'high',
      },
      {
        type: 'secondary',
        objective: 'Evaluar el efecto del fármaco X sobre la remisión clínica.',
        endpoint:
          'Proporción de pacientes en remisión clínica (puntuación Z ≤ 4) a las semanas 12 y 24.',
        sourcePages: [19],
        confidence: 'high',
      },
      {
        type: 'secondary',
        objective: 'Evaluar la seguridad y tolerabilidad del fármaco X.',
        endpoint:
          'Incidencia de eventos adversos (EA), eventos adversos graves (EAG) y discontinuaciones por EA hasta la semana 52.',
        sourcePages: [19, 20],
        confidence: 'high',
      },
      {
        type: 'exploratory',
        objective: 'Explorar el perfil farmacocinético del fármaco X en la población de estudio.',
        endpoint:
          'Concentraciones plasmáticas del fármaco X en visitas seleccionadas (PK de estado estacionario).',
        sourcePages: [20],
        confidence: 'medium',
      },
    ],
    visits: [
      {
        name: 'Visita 1 (Selección)',
        label: 'Semana -4',
        day: -28,
        windowDays: 3,
        procedures: [
          'Consentimiento informado',
          'Historia clínica y examen físico completo',
          'Signos vitales',
          'Electrocardiograma (ECG)',
          'Analítica de laboratorio (hematología, bioquímica, orina)',
          'Test de embarazo (mujeres en edad fértil)',
          'Puntuación escala Z',
          'Imagen diagnóstica (si aplica)',
        ],
        sourcePages: [45, 46],
        confidence: 'high',
      },
      {
        name: 'Visita 2 (Aleatorización)',
        label: 'Semana 0',
        day: 1,
        windowDays: 0,
        procedures: [
          'Confirmación de criterios de elegibilidad',
          'Aleatorización y dispensación del fármaco en estudio',
          'Signos vitales',
          'Analítica de laboratorio',
          'Puntuación escala Z',
          'Registro de medicación concomitante',
        ],
        sourcePages: [46],
        confidence: 'high',
      },
      {
        name: 'Visita 3',
        label: 'Semana 4',
        day: 29,
        windowDays: 3,
        procedures: [
          'Signos vitales',
          'Examen físico dirigido',
          'Analítica de laboratorio',
          'Puntuación escala Z',
          'Evaluación de eventos adversos',
          'Registro de medicación concomitante',
          'Recuento y dispensación del fármaco en estudio',
        ],
        sourcePages: [46, 47],
        confidence: 'high',
      },
      {
        name: 'Visita 6 (Evaluación primaria)',
        label: 'Semana 24',
        day: 169,
        windowDays: 7,
        procedures: [
          'Signos vitales',
          'Examen físico completo',
          'Analítica de laboratorio (incluye PK)',
          'Puntuación escala Z',
          'Evaluación de eventos adversos',
          'Cuestionarios de calidad de vida (PRO)',
          'Recuento y dispensación del fármaco en estudio',
        ],
        sourcePages: [47, 48],
        confidence: 'high',
      },
      {
        name: 'Visita de seguimiento',
        label: 'Semana 28',
        day: 197,
        windowDays: 7,
        procedures: [
          'Signos vitales',
          'Examen físico',
          'Analítica de laboratorio',
          'Puntuación escala Z',
          'Evaluación de eventos adversos',
        ],
        sourcePages: [48],
        confidence: 'high',
      },
    ],
  },
}
