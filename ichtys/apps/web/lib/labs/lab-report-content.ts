import { z } from 'zod'

/** Topes de entrada externa del módulo de Carga de laboratorios. */
/** La plataforma corta el cuerpo de un pedido en 4,5 MB: por encima de eso el archivo no llega al servidor. */
export const MAX_LAB_PDF_BYTES = 4 * 1024 * 1024
export const MAX_LAB_PDF_PAGES = 20
export const MAX_LAB_ROWS = 500
/** Fotos y escaneos: hasta seis hojas recortadas por informe. */
export const MAX_LAB_IMAGES = 6
export const MAX_LAB_IMAGE_BYTES = 1_500_000
export const LAB_IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/webp'] as const
export type LabImageMime = (typeof LAB_IMAGE_MIMES)[number]
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

export const labConfirmSchema = z
  .object({
    rows: z.array(labRowInputSchema).min(1).max(MAX_LAB_ROWS),
    /** Informe leído de una imagen: quien confirma declara que comparó los valores con la imagen. */
    comparedWithImage: z.boolean().optional(),
  })
  .strict()

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
    /** Las dos lecturas no coinciden: hay que decidir antes de confirmar. */
    mustDecide: z.boolean().optional(),
    /** Lo que leyó la otra lectura, cuando difiere. */
    alternative: z.string().max(60).nullable().optional(),
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
    /** De dónde salió el texto. Ausente en informes anteriores: PDF con texto. */
    source: z.enum(['pdf_text', 'image']).optional(),
    /** Hojas de imagen guardadas mientras el informe está pendiente. */
    imagePages: z.number().int().min(0).max(MAX_LAB_IMAGES).optional(),
    /** Quién leyó: `first` y `second` nombran el lector ("reglas", "openai"…); `second` null = una sola lectura. */
    readers: z
      .object({
        first: z.string().max(40),
        second: z.string().max(40).nullable(),
        agreed: z.number().int().nonnegative(),
        disagreements: z.number().int().nonnegative(),
      })
      .strict()
      .optional(),
  })
  .strict()
export type LabReportContent = z.infer<typeof labReportContentSchema>
