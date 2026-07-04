/**
 * IDs determinísticos del tenant demo mock T2D (smoke test / pitch inversores).
 * Deben coincidir entre seed scripts, eval runner y upload-mock-docs.mjs.
 */
export const DEMO_CLERK_ORG_ID =
  process.env['DEMO_CLERK_ORG_ID'] ?? 'org_3Emh0j274SoeBVmpICF4gnlWlVR'

export const DEMO_ORG_ID = '2d67f024-ff70-42fa-b73a-4a0500229855'
export const DEMO_ORG_NAME = 'Ichtys Dev Org'

export const DEMO_STUDY_ID = '508fa9c9-dbb9-49aa-abd5-7f7fe968bbc6'
export const DEMO_STUDY_NAME = 'MOCK-METABOLIC-T2D-v1'
export const DEMO_PROTOCOL_NUMBER = 'MOCK-001'

export type DemoDocType =
  | 'protocol'
  | 'investigator_brochure'
  | 'lab_manual'
  | 'pharmacy_manual'
  | 'other'

export interface DemoDocumentDef {
  docId: string
  dvId: string
  mdFile: string
  pdfName: string
  displayName: string
  docType: DemoDocType
}

export const DEMO_DOCUMENTS: DemoDocumentDef[] = [
  {
    docId: 'a0000000-0000-0000-0000-000000000001',
    dvId: 'b0000000-0000-0000-0000-000000000001',
    mdFile: 'MOCK-METABOLIC-T2D-Protocol.md',
    pdfName: 'MOCK-METABOLIC-T2D-Protocol.pdf',
    displayName: 'Protocol v1.0',
    docType: 'protocol',
  },
  {
    docId: 'a0000000-0000-0000-0000-000000000002',
    dvId: 'b0000000-0000-0000-0000-000000000002',
    mdFile: 'MOCK-METABOLIC-T2D-Investigator-Brochure.md',
    pdfName: 'MOCK-METABOLIC-T2D-Investigator-Brochure.pdf',
    displayName: 'Investigator Brochure v2',
    docType: 'investigator_brochure',
  },
  {
    docId: 'a0000000-0000-0000-0000-000000000003',
    dvId: 'b0000000-0000-0000-0000-000000000003',
    mdFile: 'MOCK-METABOLIC-T2D-Lab-Manual.md',
    pdfName: 'MOCK-METABOLIC-T2D-Lab-Manual.pdf',
    displayName: 'Lab Manual v1.0',
    docType: 'lab_manual',
  },
  {
    docId: 'a0000000-0000-0000-0000-000000000004',
    dvId: 'b0000000-0000-0000-0000-000000000004',
    mdFile: 'MOCK-METABOLIC-T2D-Pharmacy-Manual.md',
    pdfName: 'MOCK-METABOLIC-T2D-Pharmacy-Manual.pdf',
    displayName: 'Pharmacy Manual v1.0',
    docType: 'pharmacy_manual',
  },
  {
    docId: 'a0000000-0000-0000-0000-000000000005',
    dvId: 'b0000000-0000-0000-0000-000000000005',
    mdFile: 'MOCK-METABOLIC-T2D-Study-Procedures-Manual.md',
    pdfName: 'MOCK-METABOLIC-T2D-Study-Procedures-Manual.pdf',
    displayName: 'Study Procedures Manual',
    docType: 'other',
  },
]

/** Blob placeholders — demo usa chunks desde Markdown, no PDFs en Blob. */
export function demoBlobKey(dvId: string): string {
  return `demo/mock-metabolic/${dvId}.pdf`
}

export function demoBlobUrl(dvId: string): string {
  return `mock://demo/${dvId}`
}
