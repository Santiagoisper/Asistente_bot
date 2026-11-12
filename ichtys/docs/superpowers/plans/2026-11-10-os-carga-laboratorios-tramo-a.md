# Carga de laboratorios, tramo A (PDF digital): plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Subir el PDF digital de un laboratorio, ver los campos propuestos junto a la transcripción y confirmarlos.

**Architecture:** Intérprete determinista en `@ichtys/clinical`; contenido clínico cifrado en `lab_reports.content_encrypted`; catálogo de analitos en claro; cuatro rutas bajo el sujeto; dos pantallas nuevas sobre la cáscara del OS.

**Tech Stack:** Next.js 16, Drizzle + Neon, `@ichtys/crypto`, `parsePdf` de `@ichtys/ingestion`, zod, vitest.

**Spec:** `ichtys/docs/superpowers/specs/2026-11-10-os-carga-laboratorios-design.md`

## Global Constraints

- Un valor pasa al registro solo con confirmación humana.
- Se guarda el valor impreso como texto; el número interpretado va aparte y puede ser nulo.
- Toda fila propuesta cita un renglón que contiene su valor impreso carácter por carácter.
- Encabezado identificatorio tapado antes de guardar. Ninguna llamada a un modelo.
- Tope de archivo 10 MB y 20 páginas. No se guarda el archivo.
- `organization_id` desde Clerk; rol con `canAccessPhiData`; auditoría sin valores.
- Sin push a `main`, sin deploy, sin migraciones contra Neon.

## Review Focus

1. PDF de varias columnas donde el texto sale desordenado: las filas dudosas quedan en "Revisar", no en "Leído".
2. Renglón con dos números (valor y rango sin paréntesis): el primero es el valor, el resto el rango.
3. Doble clic en "Confirmar": la segunda llamada recibe 409 y no duplica analitos ni valores.
4. Valor no numérico ("Negativo", "Trazas"): se conserva impreso, número nulo, no bloquea confirmar.
5. Analito con el mismo nombre que difiere en mayúsculas o acentos: una sola entrada en el catálogo.

---

### Task 1 — Intérprete de renglones (`packages/clinical`)

**Files:** Create `lab-report-parser.ts`, `__tests__/lab-report-parser.test.ts`; Modify `index.ts`.

**Produces:**
- `parsePrintedNumber(printed: string): { value: number | null; ambiguous: boolean }`
- `normalizeAnalyteKey(name: string): string`
- `parseLabReportText(text: string): { transcription: string; lines: string[]; rows: ParsedLabRow[]; unparsedLines: number[]; piiRedactedCount: number }`
- `type ParsedLabRow = { analyte: string; printedValue: string; value: number | null; unit: string | null; referenceRange: string | null; sourceLine: number; needsReview: boolean; reviewReason: string | null }`
- `rowIsGrounded(row, lines): boolean`

- [ ] Tests con los casos de la tabla §5 del spec; `7.300` y `1.025` → `needsReview` con motivo.
- [ ] Implementar; `pnpm --filter @ichtys/clinical test`.

### Task 2 — Datos (`packages/db`)

**Files:** Create `schema/lab-reports.ts`, `migrations/0012_lab_reports.sql` (+ journal); Modify `schema/index.ts`, `schema/enums.ts`.

**Produces:** tablas `labAnalytes`, `labReports`; `labReportStatus`, `labReportSourceKind`.

### Task 3 — Servicio y rutas (`apps/web`)

**Files:** Create `lib/labs/lab-report-content.ts` (esquema zod del contenido cifrado), `lib/labs/lab-report-service.ts`, cuatro `route.ts` y sus tests.

**Produces:**
- `createLabReportFromPdf({ orgId, studyId, subjectId, userId, fileName, data })`
- `loadLabReport({ orgId, studyId, subjectId, reportId })`
- `confirmLabReport({ ..., userId, rows })`, `rejectLabReport({ ..., userId })`
- `LabReportError` con códigos `not_found`, `already_reviewed`, `no_text`, `no_rows`, `invalid_rows`.

### Task 4 — Pantallas

**Files:** Create `app/(app)/laboratorios/cargar/page.tsx`, `components/labs/upload-form.tsx`, `components/labs/review-client.tsx`, `app/(app)/studies/[id]/subjects/[subjectId]/labs/[reportId]/page.tsx`; Modify `lib/os/inicio-data.ts`, `app/(app)/laboratorios/page.tsx`.

- [ ] Compuerta completa y `next build`; commit; PR.
