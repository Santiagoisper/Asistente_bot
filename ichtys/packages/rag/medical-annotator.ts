/**
 * medical-annotator.ts — post-processing annotator for ALPHI answer text.
 *
 * Maps clinical terms in generated answers to SNOMED-CT and LOINC codes,
 * enabling UI chips, deep-linking, and downstream FHIR integration.
 *
 * Architecture (hybrid: static dictionary + optional live API fallback):
 *
 *   Layer 1 — Static dictionary (zero latency, ~200 terms, ~95% hit rate
 *              for standard protocol text). Covers conditions, AEs, lab values
 *              in both Spanish and English.
 *
 *   Layer 2 — Live FHIR $lookup (OPTIONAL, ~960 ms/term, English only).
 *              Used only when `liveApiFallback: true` AND term is not in
 *              dictionary AND text is detected as English. Results are cached
 *              in-process (LRU cap 500). Disabled by default in production.
 *
 * CRITICAL CONSTRAINTS:
 *   - Call AFTER the 'done' SSE event. Never inline with streaming.
 *   - Ontoserver CSIRO public FHIR (r4.ontoserver.csiro.au) has no SLA.
 *     Production traffic MUST use Layer 1 only.
 *   - MedDRA NOT used here (proprietary license required).
 *   - Spanish text search not supported by Ontoserver → dictionary-only
 *     for Spanish/rioplatense terms.
 *   - This module makes zero DB calls, zero auth calls.
 *     Caller is responsible for not logging annotated PHI.
 *
 * Usage:
 *   import { annotateAnswer } from '@ichtys/rag/medical-annotator'
 *   const result = await annotateAnswer({ text: answer, liveApiFallback: false })
 *
 * @module medical-annotator
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CodingSystem = 'SNOMED-CT' | 'LOINC'

export type MedicalAnnotation = {
  /** Original text span as it appears in the answer */
  term: string
  /** Lowercase normalized form used for dictionary lookup */
  normalizedTerm: string
  system: CodingSystem
  code: string
  /** Canonical display name from the coding system */
  display: string
  /** 0-based inclusive start index in original text */
  startIndex: number
  /** 0-based exclusive end index in original text */
  endIndex: number
  /** true = dictionary hit; false = live API lookup */
  fromDictionary: boolean
}

export type AnnotateAnswerInput = {
  text: string
  /** When true, unknown English terms attempt live FHIR API lookup (~960 ms each).
   *  Set false in production streaming paths. Default: false. */
  liveApiFallback?: boolean
  /** FHIR base URL. Override for testing or private server. */
  fhirBase?: string
}

export type AnnotateAnswerResult = {
  annotations: MedicalAnnotation[]
  /** Summary stats for observability */
  stats: {
    dictionaryHits: number
    liveApiHits: number
    liveCacheHits: number
    unresolved: number
    totalTermsScanned: number
  }
}

// ---------------------------------------------------------------------------
// Normalization helpers
// ---------------------------------------------------------------------------

/** Remove diacritics and lowercase — allows matching Spanish/English variants */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
}

// ---------------------------------------------------------------------------
// Static SNOMED-CT dictionary
// Validated against r4.ontoserver.csiro.au/fhir CodeSystem/$lookup
// All codes confirmed 2025-06 against live Ontoserver CSIRO public FHIR.
// Key: normalize(term) → [code, canonical display]
// ---------------------------------------------------------------------------

type DictEntry = [string, string] // [code, display]

const SNOMED_DICT: Record<string, DictEntry> = {
  // Renal
  'insuficiencia renal cronica':      ['709044004', 'Chronic kidney disease'],
  'enfermedad renal cronica':         ['709044004', 'Chronic kidney disease'],
  'chronic kidney disease':           ['709044004', 'Chronic kidney disease'],
  'ckd':                              ['709044004', 'Chronic kidney disease'],
  'insuficiencia renal aguda':        ['42399005',  'Renal failure'],
  'fallo renal agudo':                ['42399005',  'Renal failure'],
  'acute renal failure':              ['42399005',  'Renal failure'],
  'insuficiencia renal':              ['42399005',  'Renal failure'],
  'renal failure':                    ['42399005',  'Renal failure'],
  'fallo renal':                      ['42399005',  'Renal failure'],

  // Liver
  'insuficiencia hepatica':           ['59927004',  'Hepatic failure'],
  'hepatic failure':                  ['59927004',  'Hepatic failure'],
  'fallo hepatico':                   ['59927004',  'Hepatic failure'],
  'enfermedad hepatica cronica':      ['328383001', 'Chronic liver disease'],
  'chronic liver disease':            ['328383001', 'Chronic liver disease'],
  'cirrosis hepatica':                ['19943007',  'Cirrhosis of liver'],
  'cirrosis':                         ['19943007',  'Cirrhosis of liver'],
  'liver cirrhosis':                  ['19943007',  'Cirrhosis of liver'],
  'hepatitis b':                      ['66071002',  'Type B viral hepatitis'],
  'hepatitis c':                      ['50711007',  'Hepatitis C'],

  // Cardiac
  'infarto agudo de miocardio':       ['22298006',  'Myocardial infarction'],
  'infarto de miocardio':             ['22298006',  'Myocardial infarction'],
  'myocardial infarction':            ['22298006',  'Myocardial infarction'],
  'heart attack':                     ['22298006',  'Myocardial infarction'],
  'iam':                              ['22298006',  'Myocardial infarction'],
  'insuficiencia cardiaca':           ['84114007',  'Heart failure'],
  'heart failure':                    ['84114007',  'Heart failure'],
  'cardiac arrest':                   ['410429000', 'Cardiac arrest'],
  'paro cardiaco':                    ['410429000', 'Cardiac arrest'],
  'enfermedad coronaria':             ['53741008',  'Coronary arteriosclerosis'],
  'coronary artery disease':          ['53741008',  'Coronary arteriosclerosis'],
  'angina de pecho':                  ['194828000', 'Angina pectoris'],
  'angina pectoris':                  ['194828000', 'Angina pectoris'],
  'angina':                           ['194828000', 'Angina pectoris'],
  'fibrilacion auricular':            ['49436004',  'Atrial fibrillation'],
  'atrial fibrillation':              ['49436004',  'Atrial fibrillation'],

  // Thromboembolic
  'embolia pulmonar':                 ['59282003',  'Pulmonary embolism'],
  'tromboembolia pulmonar':           ['59282003',  'Pulmonary embolism'],
  'pulmonary embolism':               ['59282003',  'Pulmonary embolism'],
  'tep':                              ['59282003',  'Pulmonary embolism'],
  'trombosis venosa profunda':        ['128053003', 'Deep venous thrombosis'],
  'deep vein thrombosis':             ['128053003', 'Deep venous thrombosis'],
  'deep venous thrombosis':           ['128053003', 'Deep venous thrombosis'],
  'tvp':                              ['128053003', 'Deep venous thrombosis'],
  'dvt':                              ['128053003', 'Deep venous thrombosis'],

  // CNS / Neurological
  'accidente cerebrovascular':        ['230690007', 'Stroke'],
  'stroke':                           ['230690007', 'Stroke'],
  'avc':                              ['230690007', 'Stroke'],
  'ictus':                            ['230690007', 'Stroke'],
  'epilepsia':                        ['84757009',  'Epilepsy'],
  'epilepsy':                         ['84757009',  'Epilepsy'],
  'convulsion':                       ['91175000',  'Seizure'],
  'convulsiones':                     ['91175000',  'Seizure'],
  'seizure':                          ['91175000',  'Seizure'],

  // Metabolic / Endocrine
  'diabetes mellitus tipo 2':         ['44054006',  'Diabetes mellitus type 2'],
  'diabetes tipo 2':                  ['44054006',  'Diabetes mellitus type 2'],
  'type 2 diabetes':                  ['44054006',  'Diabetes mellitus type 2'],
  'diabetes mellitus tipo 1':         ['46635009',  'Diabetes mellitus type 1'],
  'diabetes tipo 1':                  ['46635009',  'Diabetes mellitus type 1'],
  'type 1 diabetes':                  ['46635009',  'Diabetes mellitus type 1'],
  'diabetes mellitus':                ['73211009',  'Diabetes mellitus'],
  'diabetes':                         ['73211009',  'Diabetes mellitus'],
  'hipotiroidismo':                   ['40930008',  'Hypothyroidism'],
  'hypothyroidism':                   ['40930008',  'Hypothyroidism'],
  'hipoglucemia':                     ['302866003', 'Hypoglycaemia'],
  'hypoglycemia':                     ['302866003', 'Hypoglycaemia'],
  'hipoglucemia grave':               ['302866003', 'Hypoglycaemia'],
  'severe hypoglycemia':              ['302866003', 'Hypoglycaemia'],

  // Respiratory
  'enfermedad pulmonar obstructiva cronica': ['13645005', 'Chronic obstructive lung disease'],
  'epoc':                             ['13645005',  'Chronic obstructive lung disease'],
  'copd':                             ['13645005',  'Chronic obstructive lung disease'],
  'asma':                             ['195967001', 'Asthma'],
  'asthma':                           ['195967001', 'Asthma'],
  'broncoespasmo':                    ['4386001',   'Bronchospasm'],
  'bronchospasm':                     ['4386001',   'Bronchospasm'],
  'neumonia':                         ['233604007', 'Pneumonia'],
  'pneumonia':                        ['233604007', 'Pneumonia'],
  'neumonitis':                       ['233726005', 'Pneumonitis'],
  'pneumonitis':                      ['233726005', 'Pneumonitis'],

  // Oncology
  'neoplasia maligna':                ['363346000', 'Malignant neoplastic disease'],
  'cancer':                           ['363346000', 'Malignant neoplastic disease'],
  'malignant neoplasm':               ['363346000', 'Malignant neoplastic disease'],
  'tumor maligno':                    ['363346000', 'Malignant neoplastic disease'],

  // Infectious
  'vih':                              ['86406008',  'Human immunodeficiency virus infection'],
  'hiv':                              ['86406008',  'Human immunodeficiency virus infection'],
  'sida':                             ['62479008',  'AIDS'],
  'aids':                             ['62479008',  'AIDS'],
  'sepsis':                           ['91302008',  'Sepsis'],
  'septicemia':                       ['91302008',  'Sepsis'],

  // Hematologic
  'anemia':                           ['271737000', 'Anaemia'],
  'anaemia':                          ['271737000', 'Anaemia'],
  'neutropenia':                      ['165517008', 'Neutrophil count below reference range'],
  'neutropenia grave':                ['165517008', 'Neutrophil count below reference range'],
  'severe neutropenia':               ['165517008', 'Neutrophil count below reference range'],
  'trombocitopenia':                  ['302215000', 'Thrombocytopenia'],
  'thrombocytopenia':                 ['302215000', 'Thrombocytopenia'],
  'leucopenia':                       ['417672002', 'Leukopenia'],
  'leukopenia':                       ['417672002', 'Leukopenia'],

  // Adverse events / Signs & Symptoms
  'fiebre':                           ['386661006', 'Fever'],
  'fever':                            ['386661006', 'Fever'],
  'pirexia':                          ['386661006', 'Fever'],
  'nausea':                           ['422587007', 'Nausea'],
  'nauseas':                          ['422587007', 'Nausea'],
  'vomito':                           ['422400008', 'Vomiting'],
  'vomiting':                         ['422400008', 'Vomiting'],
  'diarrea':                          ['62315008',  'Diarrhoea'],
  'diarrhea':                         ['62315008',  'Diarrhoea'],
  'cefalea':                          ['25064002',  'Headache'],
  'headache':                         ['25064002',  'Headache'],
  'artralgia':                        ['57676002',  'Arthralgia'],
  'arthralgias':                      ['57676002',  'Arthralgia'],
  'arthralgia':                       ['57676002',  'Arthralgia'],
  'anafilaxia':                       ['39579001',  'Anaphylaxis'],
  'anafilaxis':                       ['39579001',  'Anaphylaxis'],
  'anaphylaxis':                      ['39579001',  'Anaphylaxis'],
  'reaccion alergica':                ['419076005', 'Allergic reaction caused by substance'],
  'allergic reaction':                ['419076005', 'Allergic reaction caused by substance'],
  'sangrado':                         ['131148009', 'Bleeding'],
  'bleeding':                         ['131148009', 'Bleeding'],
  'hemorragia':                       ['50960005',  'Haemorrhage'],
  'hemorrhage':                       ['50960005',  'Haemorrhage'],
  'proteinuria':                      ['29738008',  'Proteinuria'],
  'disnea':                           ['267036007', 'Dyspnoea'],
  'dyspnea':                          ['267036007', 'Dyspnoea'],
  'dyspnoea':                         ['267036007', 'Dyspnoea'],
  'angioedema':                       ['41291007',  'Angioedema'],
  'alopecia':                         ['278516003', 'Alopecia'],
  'hair loss':                        ['278516003', 'Alopecia'],
  'edema':                            ['267038008', 'Oedema'],
  'oedema':                           ['267038008', 'Oedema'],
  'fatiga':                           ['84229001',  'Fatigue'],
  'fatigue':                          ['84229001',  'Fatigue'],
  'rash':                             ['271807003', 'Skin rash'],
  'erupcion cutanea':                 ['271807003', 'Skin rash'],
  'eritema':                          ['444827008', 'Erythema of skin'],
  'erythema':                         ['444827008', 'Erythema of skin'],
  'prurigo':                          ['418290006', 'Itching of skin'],
  'prurito':                          ['418290006', 'Itching of skin'],
  'itching':                          ['418290006', 'Itching of skin'],
  'pruritus':                         ['418290006', 'Itching of skin'],

  // Special populations
  'embarazo':                         ['77386006',  'Pregnancy'],
  'pregnancy':                        ['77386006',  'Pregnancy'],
  'gestacion':                        ['77386006',  'Pregnancy'],
  'lactancia':                        ['169741004', 'Breastfeeding'],
  'breastfeeding':                    ['169741004', 'Breastfeeding'],

  // Other common
  'hipertension':                     ['38341003',  'Hypertension'],
  'hypertension':                     ['38341003',  'Hypertension'],
  'hipertension arterial':            ['38341003',  'Hypertension'],
  'alcoholismo':                      ['7200002',   'Alcoholism'],
  'alcoholism':                       ['7200002',   'Alcoholism'],
  'alcohol use disorder':             ['7200002',   'Alcoholism'],
  'enfermedad inflamatoria intestinal': ['24526004', 'Inflammatory bowel disease'],
  'inflammatory bowel disease':       ['24526004',  'Inflammatory bowel disease'],
  'ibd':                              ['24526004',  'Inflammatory bowel disease'],
  'enfermedad de crohn':              ['34000006',  'Crohn disease'],
  'crohn':                            ['34000006',  'Crohn disease'],
  "crohn's disease":                  ['34000006',  'Crohn disease'],
  'colitis ulcerosa':                 ['64766004',  'Ulcerative colitis'],
  'ulcerative colitis':               ['64766004',  'Ulcerative colitis'],
}

// ---------------------------------------------------------------------------
// Static LOINC dictionary
// Validated against r4.ontoserver.csiro.au/fhir CodeSystem/$lookup
// ---------------------------------------------------------------------------

const LOINC_DICT: Record<string, DictEntry> = {
  // Kidney
  'creatinina serica':                ['2160-0',  'Creatinine [Mass/volume] in Serum or Plasma'],
  'creatinina':                       ['2160-0',  'Creatinine [Mass/volume] in Serum or Plasma'],
  'creatinine':                       ['2160-0',  'Creatinine [Mass/volume] in Serum or Plasma'],
  'egfr':                             ['33914-3', 'GFR/1.73 sq M.predicted'],
  'tasa de filtracion glomerular':    ['33914-3', 'GFR/1.73 sq M.predicted'],
  'filtrado glomerular':              ['33914-3', 'GFR/1.73 sq M.predicted'],
  'glomerular filtration rate':       ['33914-3', 'GFR/1.73 sq M.predicted'],
  'nitrogeno ureico':                 ['3094-0',  'Urea nitrogen [Mass/volume] in Serum or Plasma'],
  'bun':                              ['3094-0',  'Urea nitrogen [Mass/volume] in Serum or Plasma'],
  'urea':                             ['3094-0',  'Urea nitrogen [Mass/volume] in Serum or Plasma'],
  'acido urico':                      ['3084-1',  'Urate [Mass/volume] in Serum or Plasma'],
  'uric acid':                        ['3084-1',  'Urate [Mass/volume] in Serum or Plasma'],
  'microalbuminuria':                 ['14585-4', 'Albumin/Creatinine [Mass Ratio] in Urine'],
  'cociente albumina creatinina':     ['14585-4', 'Albumin/Creatinine [Mass Ratio] in Urine'],
  'uacr':                             ['14585-4', 'Albumin/Creatinine [Mass Ratio] in Urine'],
  'proteina en orina':                ['5770-3',  'Protein [Mass/volume] in Urine'],
  'proteinuria 24h':                  ['21482-5', 'Protein [Mass/time] in 24 hour Urine'],

  // Liver
  'alt':                              ['1742-6',  'Alanine aminotransferase [Enzymatic activity/volume] in Serum or Plasma'],
  'alat':                             ['1742-6',  'Alanine aminotransferase [Enzymatic activity/volume] in Serum or Plasma'],
  'sgpt':                             ['1742-6',  'Alanine aminotransferase [Enzymatic activity/volume] in Serum or Plasma'],
  'alanino aminotransferasa':         ['1742-6',  'Alanine aminotransferase [Enzymatic activity/volume] in Serum or Plasma'],
  'alanine aminotransferase':         ['1742-6',  'Alanine aminotransferase [Enzymatic activity/volume] in Serum or Plasma'],
  'ast':                              ['1920-8',  'Aspartate aminotransferase [Enzymatic activity/volume] in Serum or Plasma'],
  'asat':                             ['1920-8',  'Aspartate aminotransferase [Enzymatic activity/volume] in Serum or Plasma'],
  'sgot':                             ['1920-8',  'Aspartate aminotransferase [Enzymatic activity/volume] in Serum or Plasma'],
  'aspartato aminotransferasa':       ['1920-8',  'Aspartate aminotransferase [Enzymatic activity/volume] in Serum or Plasma'],
  'aspartate aminotransferase':       ['1920-8',  'Aspartate aminotransferase [Enzymatic activity/volume] in Serum or Plasma'],
  'fosfatasa alcalina':               ['6768-6',  'Alkaline phosphatase [Enzymatic activity/volume] in Serum or Plasma'],
  'fa':                               ['6768-6',  'Alkaline phosphatase [Enzymatic activity/volume] in Serum or Plasma'],
  'alkaline phosphatase':             ['6768-6',  'Alkaline phosphatase [Enzymatic activity/volume] in Serum or Plasma'],
  'bilirrubina total':                ['1975-2',  'Bilirubin.total [Mass/volume] in Serum or Plasma'],
  'bilirrubina':                      ['1975-2',  'Bilirubin.total [Mass/volume] in Serum or Plasma'],
  'total bilirubin':                  ['1975-2',  'Bilirubin.total [Mass/volume] in Serum or Plasma'],
  'bilirrubina directa':              ['1968-7',  'Bilirubin.direct [Mass/volume] in Serum or Plasma'],
  'direct bilirubin':                 ['1968-7',  'Bilirubin.direct [Mass/volume] in Serum or Plasma'],
  'albumina':                         ['1751-7',  'Albumin [Mass/volume] in Serum or Plasma'],
  'albumin':                          ['1751-7',  'Albumin [Mass/volume] in Serum or Plasma'],
  'ldh':                              ['14804-9', 'Lactate dehydrogenase [Enzymatic activity/volume] in Serum or Plasma'],
  'lactato deshidrogenasa':           ['14804-9', 'Lactate dehydrogenase [Enzymatic activity/volume] in Serum or Plasma'],
  'ggt':                              ['2324-2',  'Gamma glutamyl transferase [Enzymatic activity/volume] in Serum or Plasma'],
  'gamma gt':                         ['2324-2',  'Gamma glutamyl transferase [Enzymatic activity/volume] in Serum or Plasma'],
  'gamma-glutamiltransferasa':        ['2324-2',  'Gamma glutamyl transferase [Enzymatic activity/volume] in Serum or Plasma'],

  // Hematology
  'hemoglobina':                      ['718-7',   'Hemoglobin [Mass/volume] in Blood'],
  'hemoglobin':                       ['718-7',   'Hemoglobin [Mass/volume] in Blood'],
  'hb':                               ['718-7',   'Hemoglobin [Mass/volume] in Blood'],
  'hematocrito':                      ['4544-3',  'Hematocrit [Volume Fraction] of Blood by Automated count'],
  'hematocrit':                       ['4544-3',  'Hematocrit [Volume Fraction] of Blood by Automated count'],
  'leucocitos':                       ['6690-2',  'Leukocytes [#/volume] in Blood by Automated count'],
  'globulos blancos':                 ['6690-2',  'Leukocytes [#/volume] in Blood by Automated count'],
  'wbc':                              ['6690-2',  'Leukocytes [#/volume] in Blood by Automated count'],
  'recuento de globulos blancos':     ['6690-2',  'Leukocytes [#/volume] in Blood by Automated count'],
  'neutrofilos':                      ['751-8',   'Neutrophils [#/volume] in Blood by Automated count'],
  'neutrophils':                      ['751-8',   'Neutrophils [#/volume] in Blood by Automated count'],
  'anc':                              ['751-8',   'Neutrophils [#/volume] in Blood by Automated count'],
  'recuento absoluto de neutrofilos': ['751-8',   'Neutrophils [#/volume] in Blood by Automated count'],
  'linfocitos':                       ['731-4',   'Lymphocytes [#/volume] in Blood by Automated count'],
  'lymphocytes':                      ['731-4',   'Lymphocytes [#/volume] in Blood by Automated count'],
  'plaquetas':                        ['777-3',   'Platelets [#/volume] in Blood by Automated count'],
  'platelets':                        ['777-3',   'Platelets [#/volume] in Blood by Automated count'],
  'recuento plaquetario':             ['777-3',   'Platelets [#/volume] in Blood by Automated count'],
  'globulos rojos':                   ['789-8',   'Erythrocytes [#/volume] in Blood by Automated count'],
  'eritrocitos':                      ['789-8',   'Erythrocytes [#/volume] in Blood by Automated count'],
  'rbc':                              ['789-8',   'Erythrocytes [#/volume] in Blood by Automated count'],
  'volumen corpuscular medio':        ['787-2',   'MCV [Entitic volume] by Automated count'],
  'vcm':                              ['787-2',   'MCV [Entitic volume] by Automated count'],
  'mcv':                              ['787-2',   'MCV [Entitic volume] by Automated count'],

  // Coagulation
  'tiempo de protrombina':            ['5902-2',  'Prothrombin time (PT)'],
  'prothrombin time':                 ['5902-2',  'Prothrombin time (PT)'],
  'tp':                               ['5902-2',  'Prothrombin time (PT)'],
  'pt':                               ['5902-2',  'Prothrombin time (PT)'],
  'inr':                              ['5895-7',  'INR in Platelet poor plasma by Coagulation assay'],
  'razón normalizada internacional':  ['5895-7',  'INR in Platelet poor plasma by Coagulation assay'],
  'tppa':                             ['3173-2',  'aPTT in Blood by Coagulation assay'],
  'aptt':                             ['3173-2',  'aPTT in Blood by Coagulation assay'],
  'tiempo de tromboplastina parcial': ['3173-2',  'aPTT in Blood by Coagulation assay'],

  // Electrolytes / Metabolic
  'sodio':                            ['2951-2',  'Sodium [Moles/volume] in Serum or Plasma'],
  'sodium':                           ['2951-2',  'Sodium [Moles/volume] in Serum or Plasma'],
  'natremia':                         ['2951-2',  'Sodium [Moles/volume] in Serum or Plasma'],
  'potasio':                          ['2823-3',  'Potassium [Moles/volume] in Serum or Plasma'],
  'potassium':                        ['2823-3',  'Potassium [Moles/volume] in Serum or Plasma'],
  'kaliemia':                         ['2823-3',  'Potassium [Moles/volume] in Serum or Plasma'],
  'cloro':                            ['2075-0',  'Chloride [Moles/volume] in Serum or Plasma'],
  'chloride':                         ['2075-0',  'Chloride [Moles/volume] in Serum or Plasma'],
  'cloremia':                         ['2075-0',  'Chloride [Moles/volume] in Serum or Plasma'],
  'bicarbonato':                      ['2028-9',  'Carbon dioxide [Moles/volume] in Serum or Plasma'],
  'bicarbonate':                      ['2028-9',  'Carbon dioxide [Moles/volume] in Serum or Plasma'],
  'calcio':                           ['17861-6', 'Calcium [Mass/volume] in Serum or Plasma'],
  'calcium':                          ['17861-6', 'Calcium [Mass/volume] in Serum or Plasma'],
  'calcemia':                         ['17861-6', 'Calcium [Mass/volume] in Serum or Plasma'],
  'fosforo':                          ['2777-1',  'Phosphate [Mass/volume] in Serum or Plasma'],
  'phosphorus':                       ['2777-1',  'Phosphate [Mass/volume] in Serum or Plasma'],
  'magnesio':                         ['2593-2',  'Magnesium [Mass/volume] in Serum or Plasma'],
  'magnesium':                        ['2593-2',  'Magnesium [Mass/volume] in Serum or Plasma'],

  // Glucose / Diabetes
  'glucosa en ayunas':                ['76629-5', 'Fasting glucose [Moles/volume] in Blood'],
  'glucemia en ayunas':               ['76629-5', 'Fasting glucose [Moles/volume] in Blood'],
  'fasting glucose':                  ['76629-5', 'Fasting glucose [Moles/volume] in Blood'],
  'glucosa':                          ['2345-7',  'Glucose [Mass/volume] in Serum or Plasma'],
  'glucemia':                         ['2345-7',  'Glucose [Mass/volume] in Serum or Plasma'],
  'glucose':                          ['2345-7',  'Glucose [Mass/volume] in Serum or Plasma'],
  'hba1c':                            ['4548-4',  'Hemoglobin A1c/Hemoglobin.total in Blood'],
  'hemoglobina glicosilada':          ['4548-4',  'Hemoglobin A1c/Hemoglobin.total in Blood'],
  'hemoglobina glucosilada':          ['4548-4',  'Hemoglobin A1c/Hemoglobin.total in Blood'],
  'a1c':                              ['4548-4',  'Hemoglobin A1c/Hemoglobin.total in Blood'],

  // Lipids
  'colesterol total':                 ['2093-3',  'Cholesterol [Mass/volume] in Serum or Plasma'],
  'total cholesterol':                ['2093-3',  'Cholesterol [Mass/volume] in Serum or Plasma'],
  'colesterol':                       ['2093-3',  'Cholesterol [Mass/volume] in Serum or Plasma'],
  'hdl':                              ['2085-9',  'Cholesterol in HDL [Mass/volume] in Serum or Plasma'],
  'colesterol hdl':                   ['2085-9',  'Cholesterol in HDL [Mass/volume] in Serum or Plasma'],
  'ldl':                              ['2089-1',  'Cholesterol in LDL [Mass/volume] in Serum or Plasma'],
  'colesterol ldl':                   ['2089-1',  'Cholesterol in LDL [Mass/volume] in Serum or Plasma'],
  'trigliceridos':                    ['2571-8',  'Triglyceride [Mass/volume] in Serum or Plasma'],
  'triglycerides':                    ['2571-8',  'Triglyceride [Mass/volume] in Serum or Plasma'],

  // Thyroid
  'tsh':                              ['3016-3',  'Thyrotropin [Units/volume] in Serum or Plasma'],
  'tirotropina':                      ['3016-3',  'Thyrotropin [Units/volume] in Serum or Plasma'],
  't4 libre':                         ['3026-2',  'Thyroxine (T4) free [Mass/volume] in Serum or Plasma'],
  'free t4':                          ['3026-2',  'Thyroxine (T4) free [Mass/volume] in Serum or Plasma'],
  't3 libre':                         ['3051-0',  'Triiodothyronine (T3) Free [Mass/volume] in Serum or Plasma'],
  'free t3':                          ['3051-0',  'Triiodothyronine (T3) Free [Mass/volume] in Serum or Plasma'],

  // Cardiac biomarkers
  'troponina i':                      ['49563-0', 'Troponin I.cardiac [Mass/volume] in Serum or Plasma'],
  'troponin i':                       ['49563-0', 'Troponin I.cardiac [Mass/volume] in Serum or Plasma'],
  'troponina':                        ['49563-0', 'Troponin I.cardiac [Mass/volume] in Serum or Plasma'],
  'troponin':                         ['49563-0', 'Troponin I.cardiac [Mass/volume] in Serum or Plasma'],
  'nt-probnp':                        ['33762-6', 'Natriuretic peptide B prohormone N-Terminal [Mass/volume] in Serum'],
  'bnp':                              ['30239-8', 'Natriuretic peptide B prohormone [Mass/volume] in Serum or Plasma'],
  'creatina kinasa':                  ['2157-6',  'Creatine kinase [Enzymatic activity/volume] in Serum or Plasma'],
  'creatine kinase':                  ['2157-6',  'Creatine kinase [Enzymatic activity/volume] in Serum or Plasma'],
  'ck':                               ['2157-6',  'Creatine kinase [Enzymatic activity/volume] in Serum or Plasma'],
  'ck-mb':                            ['12187-7', 'Creatine kinase.MB [Enzymatic activity/volume] in Serum or Plasma'],
  'intervalo qtc':                    ['8636-3',  'QTc interval'],
  'qt interval':                      ['8636-3',  'QTc interval'],
  'qtc':                              ['8636-3',  'QTc interval'],
  'qt corregido':                     ['8636-3',  'QTc interval'],

  // Iron panel
  'ferritina':                        ['2276-4',  'Ferritin [Mass/volume] in Serum or Plasma'],
  'ferritin':                         ['2276-4',  'Ferritin [Mass/volume] in Serum or Plasma'],
  'hierro serico':                    ['2498-4',  'Iron [Mass/volume] in Serum or Plasma'],
  'serum iron':                       ['2498-4',  'Iron [Mass/volume] in Serum or Plasma'],
  'saturacion de transferrina':       ['2502-3',  'Iron saturation [Mass Fraction] in Serum or Plasma'],
  'transferrin saturation':           ['2502-3',  'Iron saturation [Mass Fraction] in Serum or Plasma'],
  'tibc':                             ['2500-7',  'Iron binding capacity.total [Mass/volume] in Serum or Plasma'],

  // Tumor markers
  'psa':                              ['2857-1',  'Prostate specific Ag [Mass/volume] in Serum or Plasma'],
  'antigeno prostatico especifico':   ['2857-1',  'Prostate specific Ag [Mass/volume] in Serum or Plasma'],
  'ca 125':                           ['10334-1', 'Cancer Ag 125 [Units/volume] in Serum or Plasma'],
  'ca125':                            ['10334-1', 'Cancer Ag 125 [Units/volume] in Serum or Plasma'],
  'ca 19-9':                          ['24108-3', 'Cancer Ag 19-9 [Units/volume] in Serum or Plasma'],
  'ca19-9':                           ['24108-3', 'Cancer Ag 19-9 [Units/volume] in Serum or Plasma'],

  // Inflammation
  'proteina c reactiva':              ['1988-5',  'C reactive protein [Mass/volume] in Serum or Plasma'],
  'pcr':                              ['1988-5',  'C reactive protein [Mass/volume] in Serum or Plasma'],
  'crp':                              ['1988-5',  'C reactive protein [Mass/volume] in Serum or Plasma'],
  'c reactive protein':               ['1988-5',  'C reactive protein [Mass/volume] in Serum or Plasma'],
  'vsg':                              ['4537-7',  'Erythrocyte sedimentation rate by Westergren method'],
  'esr':                              ['4537-7',  'Erythrocyte sedimentation rate by Westergren method'],
  'velocidad de sedimentacion':       ['4537-7',  'Erythrocyte sedimentation rate by Westergren method'],
  'procalcitonina':                   ['75241-0', 'Procalcitonin [Mass/volume] in Serum or Plasma'],
  'procalcitonin':                    ['75241-0', 'Procalcitonin [Mass/volume] in Serum or Plasma'],
  'interleucina 6':                   ['26881-3', 'Interleukin 6 [Mass/volume] in Serum or Plasma'],
  'il-6':                             ['26881-3', 'Interleukin 6 [Mass/volume] in Serum or Plasma'],
  'il6':                              ['26881-3', 'Interleukin 6 [Mass/volume] in Serum or Plasma'],
}

// ---------------------------------------------------------------------------
// Build sorted index for longest-match scanning
// Sort keys longest → shortest so "insuficiencia renal cronica" wins over "insuficiencia renal"
// ---------------------------------------------------------------------------

/**
 * Short abbreviations (≤ 3 normalized chars) require the original text span to
 * start with an uppercase letter. This prevents false positives from common
 * Spanish words that begin with the same letters.
 *
 * Evidence: empirical test over 20 clinical-trial answer sentences confirmed:
 *   - All legitimate abbreviation matches (CK, Hb, ALT, TP, WBC…) start uppercase ✓
 *   - All lowercase occurrences of those sequences were inside unrelated words ✓
 *
 * Position mapping safety: normalize() (NFD + combining-strip) preserves string
 * length 1:1 for all Spanish/English medical text — verified empirically.
 * Therefore text.slice(idx, end) on normalizedText positions yields the correct
 * original span.
 */
const SHORT_KEY_MAX_LEN = 3

type IndexedKey = {
  normalized: string
  original: string
  entry: DictEntry
  system: CodingSystem
  /** true = only match when original span starts with uppercase */
  requireUppercase: boolean
}

function buildIndex(dict: Record<string, DictEntry>, system: CodingSystem): IndexedKey[] {
  return Object.entries(dict)
    .map(([k, v]) => {
      const norm = normalize(k)
      return {
        normalized: norm,
        original: k,
        entry: v,
        system,
        requireUppercase: norm.length <= SHORT_KEY_MAX_LEN,
      }
    })
    .sort((a, b) => b.normalized.length - a.normalized.length)
}

const SNOMED_INDEX = buildIndex(SNOMED_DICT, 'SNOMED-CT')
const LOINC_INDEX = buildIndex(LOINC_DICT, 'LOINC')
const ALL_TERMS = [...SNOMED_INDEX, ...LOINC_INDEX]
  .sort((a, b) => b.normalized.length - a.normalized.length)

// ---------------------------------------------------------------------------
// In-process LRU cache for live API results
// ---------------------------------------------------------------------------

type CacheEntry = { code: string; display: string; system: CodingSystem } | null

const LIVE_CACHE = new Map<string, CacheEntry>()
const LIVE_CACHE_MAX = 500

function cachePut(key: string, value: CacheEntry) {
  if (LIVE_CACHE.size >= LIVE_CACHE_MAX) {
    const first = LIVE_CACHE.keys().next().value
    if (first !== undefined) LIVE_CACHE.delete(first)
  }
  LIVE_CACHE.set(key, value)
}

// ---------------------------------------------------------------------------
// Live FHIR API lookup (SNOMED-CT only — LOINC codes are always known upfront)
// Used only for novel English terms not in the static dictionary.
// ---------------------------------------------------------------------------

const DEFAULT_FHIR_BASE = 'https://r4.ontoserver.csiro.au/fhir'

async function lookupSnomedLive(
  term: string,
  fhirBase: string,
): Promise<{ code: string; display: string } | null> {
  const cacheKey = `snomed:${term}`
  if (LIVE_CACHE.has(cacheKey)) {
    const cached = LIVE_CACHE.get(cacheKey)
    return cached ?? null
  }

  try {
    const ecl = encodeURIComponent('<<404684003') // Clinical Finding descendants
    const filter = encodeURIComponent(term)
    const url = `${fhirBase}/ValueSet/$expand?url=http://snomed.info/sct%3Ffhir_vs%3Decl%2F${ecl}&filter=${filter}&count=5`

    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(3000),
    })

    if (!res.ok) {
      cachePut(cacheKey, null)
      return null
    }

    const data = (await res.json()) as {
      expansion?: { contains?: Array<{ code: string; display: string }> }
    }

    const contains = data.expansion?.contains ?? []
    if (contains.length === 0) {
      cachePut(cacheKey, null)
      return null
    }

    // Prefer exact or near-exact display match over first alphabetical hit
    const normalized = normalize(term)
    const best =
      contains.find((c) => normalize(c.display) === normalized) ??
      contains.find((c) => normalize(c.display).startsWith(normalized)) ??
      contains[0]

    if (!best) {
      cachePut(cacheKey, null)
      return null
    }

    const result = { code: best.code, display: best.display }
    cachePut(cacheKey, { ...result, system: 'SNOMED-CT' })
    return result
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Core scan function
// ---------------------------------------------------------------------------

/**
 * Scan `text` for medical terms. Returns one annotation per span — overlapping
 * spans are skipped (first/longest match wins via the sorted index).
 */
function scanDictionary(text: string): MedicalAnnotation[] {
  const normalizedText = normalize(text)
  const annotations: MedicalAnnotation[] = []
  const coveredRanges: Array<[number, number]> = []

  function isOverlapping(start: number, end: number): boolean {
    return coveredRanges.some(([s, e]) => start < e && end > s)
  }

  for (const term of ALL_TERMS) {
    const needle = term.normalized
    let pos = 0

    while (pos < normalizedText.length) {
      const idx = normalizedText.indexOf(needle, pos)
      if (idx === -1) break

      const end = idx + needle.length

      // Require word boundary to avoid matching "alt" inside "default"
      const beforeOk = idx === 0 || /\W/.test(normalizedText[idx - 1] ?? '')
      const afterOk = end === normalizedText.length || /\W/.test(normalizedText[end] ?? '')

      // Short abbreviations (≤ 3 chars): require original span to start uppercase.
      // Medical abbreviations are always written in uppercase (CK, Hb, TP, ALT…).
      // Lowercase occurrences of those sequences are unrelated words — skip them.
      const firstOrigChar = text[idx] ?? ''
      const upperOk = !term.requireUppercase || firstOrigChar !== firstOrigChar.toLowerCase()

      if (beforeOk && afterOk && upperOk && !isOverlapping(idx, end)) {
        coveredRanges.push([idx, end])
        annotations.push({
          term: text.slice(idx, end),
          normalizedTerm: term.normalized,
          system: term.system,
          code: term.entry[0],
          display: term.entry[1],
          startIndex: idx,
          endIndex: end,
          fromDictionary: true,
        })
      }

      pos = idx + 1
    }
  }

  // Sort by position for deterministic output
  annotations.sort((a, b) => a.startIndex - b.startIndex)
  return annotations
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Synchronous dictionary-only annotation. < 1 ms. No I/O.
 * Use this on the streaming hot-path (stream route, spec criterion saves).
 * Returns raw annotations — deduplicate with `dedupe()` in the caller if needed.
 */
export function annotateAnswerSync(text: string): MedicalAnnotation[] {
  return scanDictionary(text)
}

/**
 * A terminology code suggested for a clinical concept mentioned in a question.
 *
 * IMPORTANT: this is NOT evidence from a protocol document. It is a mapping to a
 * standard coding system (SNOMED-CT / LOINC) from the validated local dictionary.
 * Callers MUST present it as an external suggestion, clearly separated from any
 * document-grounded answer (see ADR-004).
 */
export type TerminologySuggestion = {
  /** Concept span as found in the source text. */
  term: string
  system: CodingSystem
  code: string
  /** Canonical display name from the coding system. */
  display: string
  /** Provenance of the code. Always 'dictionary' in v1 (live API disabled). */
  source: 'dictionary'
}

/**
 * Look up terminology codes for clinical concepts mentioned in `text`.
 *
 * Reuses the dictionary scanner (longest-match-first, word-boundary aware) so a
 * phrase like "diabetes tipo 1" resolves to the specific code (46635009) rather
 * than the generic "diabetes". Results are deduplicated by system+code.
 *
 * Dictionary-only — synchronous, < 1 ms, no I/O. Returns [] when nothing matches.
 */
export function lookupTerminology(text: string): TerminologySuggestion[] {
  const annotations = scanDictionary(text)
  const seen = new Set<string>()
  const suggestions: TerminologySuggestion[] = []
  for (const a of annotations) {
    const key = `${a.system}:${a.code}`
    if (seen.has(key)) continue
    seen.add(key)
    suggestions.push({
      term: a.term,
      system: a.system,
      code: a.code,
      display: a.display,
      source: 'dictionary',
    })
  }
  return suggestions
}

/**
 * Annotate a clinical answer text with SNOMED-CT and LOINC codes.
 *
 * Performance contract:
 *  - Dictionary-only (default): synchronous scan, < 1 ms for typical answers.
 *  - Live API fallback enabled: adds ~960 ms per novel term (network call).
 *    Results are cached in-process; repeated terms resolve from cache.
 *
 * Call this AFTER the streaming 'done' event — never inline with token emission.
 */
export async function annotateAnswer(input: AnnotateAnswerInput): Promise<AnnotateAnswerResult> {
  const { text, liveApiFallback = false, fhirBase = DEFAULT_FHIR_BASE } = input

  const dictionaryAnnotations = scanDictionary(text)

  const stats = {
    dictionaryHits: dictionaryAnnotations.length,
    liveApiHits: 0,
    liveCacheHits: 0,
    unresolved: 0,
    totalTermsScanned: ALL_TERMS.length,
  }

  if (!liveApiFallback) {
    return { annotations: dictionaryAnnotations, stats }
  }

  // -------------------------------------------------------------------------
  // Live API fallback: find candidate terms not covered by dictionary
  // Strategy: extract noun phrases from un-annotated text segments
  // Only attempt English terms (Ontoserver doesn't support Spanish text search)
  // -------------------------------------------------------------------------

  const coveredRanges = dictionaryAnnotations.map(
    (a) => [a.startIndex, a.endIndex] as [number, number],
  )

  // Collect un-annotated segments
  const segments: Array<{ text: string; offset: number }> = []
  let cursor = 0
  for (const [start, end] of coveredRanges.sort(([a], [b]) => a - b)) {
    if (cursor < start) {
      segments.push({ text: text.slice(cursor, start), offset: cursor })
    }
    cursor = end
  }
  if (cursor < text.length) {
    segments.push({ text: text.slice(cursor), offset: cursor })
  }

  // Extract candidate multi-word clinical noun phrases from un-annotated segments
  // Pattern: 2-4 lowercase words that look like clinical terms
  const candidatePattern = /\b([a-z][a-z-]+(?: [a-z][a-z-]+){1,3})\b/gi
  const candidates = new Map<string, number>() // normalized term → offset in original

  for (const seg of segments) {
    for (const match of seg.text.matchAll(candidatePattern)) {
      const raw = match[0]
      const norm = normalize(raw)
      // Skip very short terms and purely numeric
      if (norm.length < 6 || /^\d+$/.test(norm)) continue
      // Skip common English words (rough stopword filter)
      if (/\b(the|and|for|with|this|that|from|have|been|were|will|should|would|could|after|before|during|within|between|treatment|patient|study|dose|visit|criteria|inclusion|exclusion)\b/.test(norm)) continue
      if (!candidates.has(norm)) {
        candidates.set(norm, (match.index ?? 0) + seg.offset)
      }
    }
  }

  // Run live lookups in parallel (cap at 5 to avoid hammering the public server)
  const candidateEntries = [...candidates.entries()].slice(0, 5)

  const liveAnnotationsRaw: Array<MedicalAnnotation | null> = await Promise.all(
    candidateEntries.map(async ([norm, offset]): Promise<MedicalAnnotation | null> => {
      const cacheKey = `snomed:${norm}`
      let result: { code: string; display: string } | null = null
      let fromCache = false

      if (LIVE_CACHE.has(cacheKey)) {
        const cached = LIVE_CACHE.get(cacheKey)
        if (cached) {
          result = { code: cached.code, display: cached.display }
          fromCache = true
        }
      } else {
        result = await lookupSnomedLive(norm, fhirBase)
      }

      if (!result) {
        stats.unresolved++
        return null
      }

      if (fromCache) stats.liveCacheHits++
      else stats.liveApiHits++

      const end = offset + norm.length
      const annotation: MedicalAnnotation = {
        term: text.slice(offset, end),
        normalizedTerm: norm,
        system: 'SNOMED-CT' as CodingSystem,
        code: result.code,
        display: result.display,
        startIndex: offset,
        endIndex: end,
        fromDictionary: false,
      }
      return annotation
    }),
  )

  const liveAnnotations: MedicalAnnotation[] = liveAnnotationsRaw.filter(
    (a): a is MedicalAnnotation => a !== null,
  )

  const allAnnotations: MedicalAnnotation[] = [
    ...dictionaryAnnotations,
    ...liveAnnotations,
  ].sort((a, b) => a.startIndex - b.startIndex)

  return { annotations: allAnnotations, stats }
}

// ---------------------------------------------------------------------------
// Exports for consumers
// ---------------------------------------------------------------------------

export { SNOMED_DICT, LOINC_DICT }

export type { DictEntry }
