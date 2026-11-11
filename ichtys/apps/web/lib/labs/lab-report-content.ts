import { z } from 'zod'

/** Topes de entrada externa del módulo de Carga de laboratorios. */
/** La plataforma corta el cuerpo de un pedido en 4,5 MB: por encima de eso el archivo no llega al servidor. */
export const MAX_LAB_PDF_BYTES = 4 * 1024 * 1024
export const MAX_LAB_PDF_PAGES = 20
export const MAX_LAB_ROWS = 500
const MAX_TRANSCRIPTION_CHARS = 400_000

const nullableText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .transform((value) => (value === null || value.length === 0 ? null : value))

/**
 * Fila tal como la deja quien revisa. `value` es la lectura numérica elegida
 * por la persona (o null); el servidor verifica que sea una lectura posible
 * del valor impreso. `sourceLine` null significa "cargada a mano".
 */
export const labRowInputSchema = z
  .object({
    analyte: z.string().trim().min(1).max(120),
    printedValue: z.string().trim().min(1).max(60),
    value: z.number().finite().nullable(),
    unit: nullableText(20),
    referenceRange: nullableText(120),
    sourceLine: z.number().int().nonnegative().nullable(),
  })
  .strict()
export type LabRowInput = z.infer<typeof labRowInputSchema>

export const labConfirmSchema = z.object({ rows: z.array(labRowInputSchema).min(1).max(MAX_LAB_ROWS) }).strict()

export const labReportRowSchema = z
  .object({
    id: z.string().min(1).max(64),
    analyte: z.string().min(1).max(120),
    printedValue: z.string().min(1).max(60),
    value: z.number().finite().nullable(),
    unit: z.string().max(20).nullable(),
    referenceRange: z.string().max(120).nullable(),
    sourceLine: z.number().int().nonnegative().nullable(),
    /** read: leído del informe · review: requiere decisión · manual: cargado por una persona. */
    status: z.enum(['read', 'review', 'manual']),
    /** El analito no estaba en el catálogo de la organización al leer el informe. */
    isNewField: z.boolean(),
    reviewReason: z.string().max(200).nullable(),
  })
  .strict()
export type LabReportRow = z.infer<typeof labReportRowSchema>

/** Contenido clínico del informe. Se guarda cifrado en lab_reports.content_encrypted. */
export const labReportContentSchema = z
  .object({
    version: z.literal(1),
    fileName: z.string().max(200),
    transcription: z.string().max(MAX_TRANSCRIPTION_CHARS),
    unparsedLines: z.array(z.number().int().nonnegative()).max(3_000),
    piiRedactedCount: z.number().int().nonnegative(),
    rows: z.array(labReportRowSchema).max(MAX_LAB_ROWS),
  })
  .strict()
export type LabReportContent = z.infer<typeof labReportContentSchema>
