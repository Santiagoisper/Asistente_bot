# ADR-004: Medical Annotation — SNOMED-CT + LOINC Mapping Architecture

**Status:** Accepted  
**Date:** 2025-06  
**Authors:** Engineering  
**Context:** ALPHI answer post-processing

---

## Context

ALPHI answers reference clinical concepts — exclusion criteria ("insuficiencia renal crónica"), adverse events ("neutropenia grado 3"), lab thresholds ("ALT > 3× ULN") — that have standardized codes in SNOMED-CT (conditions, AEs) and LOINC (lab values). Surfacing these codes inline enables:

- UI chips linking to reference databases (e.g., SNOMED Browser, LOINC.org)
- Downstream FHIR resource generation for site integrations
- Semantic search within the platform ("show all answers mentioning renal failure")
- Protocol deviation flagging against coded safety criteria

This ADR documents the investigation, live API tests, and resulting architecture.

---

## Investigation: Live API Research

We tested two public FHIR endpoints against a corpus of 50 clinical trial terms.

### SNOMED-CT — Ontoserver CSIRO (r4.ontoserver.csiro.au)

| Endpoint | Description | Result |
|---|---|---|
| `CodeSystem/$lookup?system=http://snomed.info/sct&code={code}` | Validate a known code | ✓ Works, ~960 ms |
| `ValueSet/$expand?url=...%3Ffhir_vs%3Decl%2F{ECL}&filter={text}` | Text search within hierarchy | ✓ Works for English only |
| `ValueSet/$expand` with Spanish filter | Spanish text search | ✗ No results |

**Critical findings:**
- Average latency: **968 ms per request** (measured over 17 calls, range 932–1060 ms)  
- Spanish term search returns zero results — Ontoserver index is English-only  
- `$expand` with broad ECL (`<<404684003`) returns nearest alphabetical descendants, not best semantic match. Example: "diabetes mellitus" → top hit is "Gestational diabetes mellitus", not the generic code. This makes live text search unreliable for common terms.
- No SLA, no authentication, rate limits unknown — public research server only

### LOINC — Ontoserver CSIRO + NLM FHIR

| Endpoint | Description | Result |
|---|---|---|
| `CodeSystem/$lookup?system=http://loinc.org&code={code}` | Validate a known LOINC code | ✓ Works, ~940 ms |
| NLM FHIR `/api/loinc_items/v3/search` | Text search | ✓ Works, English only |

**Critical finding:** LOINC codes are stable and well-known. Every lab test appearing in clinical trial protocols maps to a small set of canonical LOINC codes. There is no practical need for live text search — the universe of relevant LOINC codes is finite and enumerable.

### MedDRA — Excluded

MedDRA (Medical Dictionary for Regulatory Activities) is the standard for adverse event coding in clinical trials (used in IND/NDA filings, safety databases, EudraVigilance). However:

- **No free API.** MedDRA requires a license from MSSO (~$3,000+/year). No public FHIR endpoint exists.
- **Not FHIR-native.** No public FHIR CodeSystem resource for MedDRA.
- **Partial overlap with SNOMED-CT.** SNOMED-CT covers ~80% of common AEs at the clinical level (e.g., anaphylaxis, neutropenia, thrombocytopenia), though the code hierarchy differs from MedDRA SOC/PT/LLT structure.

**Decision:** Use SNOMED-CT as the AE coding system for now. Document the gap. If a MedDRA license is acquired, add a `MEDDRA_DICT` layer with the same annotator interface.

---

## Decision: Hybrid Dictionary + Optional Live API Fallback

### Layer 1 — Static Dictionary (production default)

A hand-curated, API-validated dictionary of ~200 terms covering the vocabulary of clinical trial protocols in Spanish and English. Terms mapped to SNOMED-CT (conditions, AEs, signs/symptoms) and LOINC (lab values).

**Validation process:** Every code in the dictionary was confirmed against the live Ontoserver CSIRO `CodeSystem/$lookup` endpoint. No code is included without a successful live confirmation.

**Coverage analysis (validated against 50-term test corpus):**

| Category | Terms | Coverage |
|---|---|---|
| Exclusion criteria (conditions) | 10 | 10/10 (100%) |
| Adverse events (symptoms/signs) | 11 | 11/11 (100%) |
| Lab — Kidney | 4 | 4/4 (100%) |
| Lab — Liver | 6 | 6/6 (100%) |
| Lab — Hematology | 5 | 5/5 (100%) |
| Lab — Coagulation | 3 | 3/3 (100%) |
| Lab — Metabolic/Glucose/Lipids | 6 | 6/6 (100%) |

Estimated hit rate on standard Phase II/III protocol text: **~95%**.

**Performance:** Synchronous text scan, longest-match wins, word-boundary aware. Under 1 ms for typical answers (300–800 tokens).

**Spanish support:** Full. The dictionary explicitly includes Spanish/rioplatense variants (e.g., "insuficiencia renal crónica", "trombosis venosa profunda", "globulos blancos") because ALPHI answers are often in Spanish and Ontoserver cannot search Spanish terms via live API.

### Layer 2 — Live FHIR Fallback (optional, disabled by default)

For novel English terms not in the dictionary, an async `ValueSet/$expand` call to Ontoserver can attempt a lookup. 

**Constraints:**
- Disabled by default (`liveApiFallback: false`)
- English only — Spanish terms are skipped
- Max 5 parallel calls per invocation (rate limit protection)
- 3-second timeout per call with hard abort
- Results cached in-process LRU (500 entries cap)
- Best-match selection: exact display match → prefix match → first result (to mitigate the ECL alphabetical-bias issue)

**When to enable:** Development/review workflows where a coordinator submits an unusual term (new protocol-specific biomarker, rare condition). Never in production streaming paths.

---

## Architecture: Post-Processing Only

**Rule: Never call `annotateAnswer` inline with streaming.**

```
SSE stream:   start → token → token → ... → done
                                              ↓
                                   annotateAnswer(fullAnswer)
                                              ↓
                                   annotations appended to UI
```

Rationale: 968 ms per SNOMED lookup × 5 terms = 4.8 s added latency if inline. Even dictionary scanning adds a synchronous step mid-stream. The coordinator sees the answer immediately; annotation chips appear within 100 ms after `done` (dictionary) or up to 5 s (live API).

---

## Implementation

### File

`packages/rag/medical-annotator.ts`  
Export path: `@ichtys/rag/medical-annotator`

### Key exports

```typescript
// Async — dictionary + optional live API fallback
annotateAnswer(input: AnnotateAnswerInput): Promise<AnnotateAnswerResult>

// Sync — dictionary only, < 1 ms
annotateAnswerSync(text: string): MedicalAnnotation[]

// Types
MedicalAnnotation = {
  term: string          // original text span
  normalizedTerm: string
  system: 'SNOMED-CT' | 'LOINC'
  code: string
  display: string       // canonical name
  startIndex: number
  endIndex: number
  fromDictionary: boolean
}
```

### Scan algorithm

1. Normalize text (lowercase + NFD diacritic strip)
2. Sort dictionary keys longest → shortest (ensures "insuficiencia renal crónica" wins over "insuficiencia renal")
3. For each key: `indexOf` scan with word-boundary check (`\W` before and after)
4. Skip overlapping spans (first/longest match wins)
5. Return annotations sorted by position

### Integration pattern (server-side, post-stream)

```typescript
// In the SSE route, after the 'done' event is enqueued:
import { annotateAnswerSync } from '@ichtys/rag/medical-annotator'

const annotations = annotateAnswerSync(fullAnswer)
enqueue({ type: 'annotations', annotations })
```

### Integration pattern (client-side)

The `StreamDoneFrame` (or a new `StreamAnnotationsFrame`) delivers the annotation array. The `ChatMessage` component maps annotations to inline `<MedicalChip>` spans using `startIndex`/`endIndex` offsets.

---

## Consequences

**Positive:**
- Zero latency on the streaming critical path (dictionary-only default)
- Full Spanish + English support without a language-detection dependency
- Codes are pre-validated — no risk of serving wrong SNOMED codes (the original problem discovered during research: many "obvious" codes map to wrong concepts)
- Stateless, no DB, no auth — clean separation from tenant-sensitive logic
- Extensible: add MedDRA layer, RxNorm (drugs), ICD-10 without breaking the interface

**Negative / Known gaps:**
- Dictionary requires manual maintenance as protocol vocabulary evolves
- MedDRA codes not available (license cost)
- Live API (Layer 2) depends on a public server with no SLA
- ECL text search quality is mediocre for common terms — dictionary quality is strictly better
- No confidence score per annotation (fuzzy matches not supported)

---

## Rejected Alternatives

| Alternative | Why rejected |
|---|---|
| Pure live SNOMED API for all terms | 968 ms/term × 5 = 4.8 s; Spanish unsupported; ECL top-hit quality poor |
| LLM entity extraction (Haiku) + lookup | Adds a second LLM call per answer; dictionary is faster and more reliable for known protocol terms |
| MedDRA for AEs | License cost; no public API |
| ICD-10 instead of SNOMED-CT | ICD-10 has better MedDRA alignment but WHO API is rate-limited and has no FHIR interface |
| RxNorm for drug mentions | Out of scope for v1; drug names in ALPHI answers are already protocol-specific |

---

## Open Questions

1. **Dictionary maintenance cadence.** Who owns the dictionary? Suggested: quarterly review aligned with new protocol onboarding.
2. **UI design for chips.** Inline highlight vs. annotation sidebar. Decision deferred to Product.
3. **MedDRA acquisition.** If ALPHI integrates with safety databases (VigiBase, Oracle Argus), MedDRA becomes necessary. Estimated cost: $3,000–$8,000/year depending on license tier.
4. **Annotation persistence.** Should annotations be stored in DB alongside the message, or computed on-demand? If stored, add a `message_annotations` table linked to `chat_messages`.
