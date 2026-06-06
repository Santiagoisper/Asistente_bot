# Mock Metabolic Documents — README

[MOCK DOCUMENTS - NO REAL STUDY DATA - NO PHI - FOR ICHTYS SMOKE TEST ONLY]

---

## 1. Purpose

This directory contains five fictional clinical study documents created for
the Ichtys smoke test (Fase 10A). They simulate the document set of a
cardiometabolic / diabetes type 2 clinical study using a fictional
investigational product (IMT-201) and a fictional study (MOCK-METABOLIC-T2D-v1).

These documents exist solely to:
- Provide realistic content for Ichtys document ingestion, chunking, and
  vector retrieval
- Enable manual execution of the 12-question smoke test defined in
  `docs/evals/mock-metabolic-smoke-test-cases.json`
- Validate that Ichtys correctly grounds answers in document content and
  returns `insufficient_evidence` when content is absent

---

## 2. Data Policy

**No real data of any kind:**
- No real patient data or PHI
- No real sponsor, sponsor company, or trademark
- No real investigational product or clinical study
- No real regulatory submissions or proprietary formulations
- No connection strings, API keys, tokens, or secrets

Each document starts with the banner:
```
[MOCK DOCUMENT - NO REAL STUDY DATA - NO PHI - FOR ICHTYS SMOKE TEST ONLY]
```

---

## 3. Document List

| File | document_type | Description |
|---|---|---|
| `MOCK-METABOLIC-T2D-Protocol.md` | `protocol` | Clinical study protocol with eligibility, SoA, conmeds, safety reporting |
| `MOCK-METABOLIC-T2D-Investigator-Brochure.md` | `investigator_brochure` | IB with product overview and safety summary |
| `MOCK-METABOLIC-T2D-Lab-Manual.md` | `lab_manual` | PK sample collection, processing, storage, shipping |
| `MOCK-METABOLIC-T2D-Pharmacy-Manual.md` | `pharmacy_manual` | IP storage, dispensing, missed dose management, accountability |
| `MOCK-METABOLIC-T2D-Study-Procedures-Manual.md` | `other` | Monitoring visit prep, source docs, query resolution |

---

## 4. document_type Mapping (for Ichtys upload)

When uploading these documents to Ichtys, select the following `document_type`
for each file:

| Document | document_type |
|---|---|
| MOCK-METABOLIC-T2D-Protocol.md → PDF | `protocol` |
| MOCK-METABOLIC-T2D-Investigator-Brochure.md → PDF | `investigator_brochure` |
| MOCK-METABOLIC-T2D-Lab-Manual.md → PDF | `lab_manual` |
| MOCK-METABOLIC-T2D-Pharmacy-Manual.md → PDF | `pharmacy_manual` |
| MOCK-METABOLIC-T2D-Study-Procedures-Manual.md → PDF | `other` |

---

## 5. Suggested PDF Export Filenames

Each Markdown document includes a footer with the suggested PDF filename.
Use these exact names when exporting to PDF for consistency with the smoke
test dataset:

| PDF Filename |
|---|
| `MOCK-METABOLIC-T2D-Protocol.pdf` |
| `MOCK-METABOLIC-T2D-Investigator-Brochure.pdf` |
| `MOCK-METABOLIC-T2D-Lab-Manual.pdf` |
| `MOCK-METABOLIC-T2D-Pharmacy-Manual.pdf` |
| `MOCK-METABOLIC-T2D-Study-Procedures-Manual.pdf` |

---

## 6. Recommended Loading Order

Load documents in this order to match the natural study hierarchy and make
cross-reference testing more intuitive:

1. Protocol (foundation — references all other documents)
2. Investigator Brochure (safety and product background)
3. Lab Manual (sample procedures)
4. Pharmacy Manual (IP management and missed dose)
5. Study Procedures Manual (monitoring and source docs)

---

## 7. How to Use These Documents with the Smoke Test

### Step 1: Convert to PDF
Export each Markdown file to PDF using any standard tool (Pandoc, VS Code
Markdown PDF extension, browser print-to-PDF, etc.). Ensure the document is
readable and not truncated.

### Step 2: Create the mock study in Ichtys
- Study name: `MOCK-METABOLIC-T2D-v1`
- Organization: your development or staging organization

### Step 3: Upload and ingest
Upload all 5 PDFs to the mock study via the Ichtys upload UI.
Select the correct `document_type` for each (see Section 4).
Trigger ingestion and wait for all documents to show `status: ready`.

### Step 4: Run the smoke test
Follow the procedure in `docs/decisions/phase-10a-smoke-test.md`.
Use the 12 questions from `docs/evals/mock-metabolic-smoke-test-cases.json`.
Record results in a copy of `docs/evals/mock-metabolic-smoke-test-results-template.csv`.

### Alignment with the dataset
The smoke test cases reference the following `expectedDocumentName` and
`expectedSectionTitle` values, aligned with the PDF filenames and section
headers in this directory:

| Case | expectedDocumentName | expectedSectionTitle |
|---|---|---|
| SM-001 | MOCK-METABOLIC-T2D-Protocol.pdf | 3.1 Inclusion Criteria |
| SM-002 | MOCK-METABOLIC-T2D-Protocol.pdf | 3.2 Exclusion Criteria |
| SM-003 | MOCK-METABOLIC-T2D-Protocol.pdf | 3.3 Schedule of Assessments |
| SM-004 | MOCK-METABOLIC-T2D-Protocol.pdf | 3.4 Visit Windows |
| SM-005 | MOCK-METABOLIC-T2D-Protocol.pdf | 3.5 Concomitant Medication |
| SM-006 | MOCK-METABOLIC-T2D-Protocol.pdf | 3.6 Prohibited Medication |
| SM-007 | MOCK-METABOLIC-T2D-Lab-Manual.pdf | 3.2 PK Sample Processing |
| SM-008 | MOCK-METABOLIC-T2D-Protocol.pdf | 3.7 Safety Reporting |
| SM-009 | MOCK-METABOLIC-T2D-Pharmacy-Manual.pdf | 3.4 Missed Dose Management |
| SM-010 | MOCK-METABOLIC-T2D-Study-Procedures-Manual.pdf | 3.1 Monitoring Visit Preparation |
| SM-011 | (none — adversarial fallback) | N/A |
| SM-012 | (none — adversarial fallback) | N/A |

---

## 8. Do Not Commit Smoke Test Results

The CSV file used to record actual smoke test results should NOT be committed
to this repository, especially if it contains:
- Excerpts from Ichtys responses
- Question-answer pairs that could be traced to real document content
- Any annotations that could be considered PHI or confidential

Keep the results CSV as a local file on the reviewer's machine. Share results
through secure channels if needed for team review.

---

## 9. expectedPageStart / expectedPageEnd Note

All 12 cases in `mock-metabolic-smoke-test-cases.json` have
`expectedPageStart: null` and `expectedPageEnd: null`.

Update these values after:
1. Exporting the Markdown files to PDF
2. Confirming the PDF page layout is stable
3. Identifying the exact page numbers for each expected section

Do not hardcode page numbers in the dataset until the PDFs are finalized,
as any reformatting will invalidate the page references.

---

## 10. Adversarial Cases — Do Not Add to Documents

Cases SM-011 and SM-012 are adversarial fallback tests:
- SM-011: "variable X" — this phrase must NOT appear in any document
- SM-012: "visita 99" or "procedimiento Y" — these must NOT appear in any
  document

If any of these phrases accidentally appear in the mock documents, the
adversarial test will be invalidated. Review the documents before uploading
if unsure.
