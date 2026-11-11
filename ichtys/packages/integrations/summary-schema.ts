import { z } from 'zod'

export const OS_MODULES = ['queries', 'viaticos', 'operacion'] as const
export type OsModule = (typeof OS_MODULES)[number]

/** Topes de entrada externa: un satélite no puede inflar el Inicio. */
export const MAX_COUNTERS = 20
export const MAX_ALERTS = 50
export const MAX_LABEL_CHARS = 120
export const MAX_DETAIL_CHARS = 500
export const MAX_HREF_CHARS = 2_000

const httpUrl = z
  .string()
  .min(1)
  .max(MAX_HREF_CHARS)
  .refine((value) => {
    try {
      const url = new URL(value)
      return url.protocol === 'https:' || url.protocol === 'http:'
    } catch {
      return false
    }
  }, 'must be an http(s) URL')

const isoInstant = z
  .string()
  .min(1)
  .max(40)
  .refine((value) => !Number.isNaN(Date.parse(value)), 'must be an ISO 8601 instant')

export const moduleCounterSchema = z
  .object({
    /** Clave estable, p. ej. "open_queries". */
    key: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
    label: z.string().min(1).max(MAX_LABEL_CHARS),
    value: z.number().finite(),
    unit: z.enum(['count', 'percent', 'usd']),
  })
  .strict()
export type ModuleCounter = z.infer<typeof moduleCounterSchema>

export const moduleAlertSchema = z
  .object({
    id: z.string().min(1).max(120),
    severity: z.enum(['high', 'medium', 'low']),
    title: z.string().min(1).max(MAX_LABEL_CHARS),
    detail: z.string().max(MAX_DETAIL_CHARS),
    /** Enlace directo dentro del satélite. */
    href: httpUrl,
  })
  .strict()
export type ModuleAlert = z.infer<typeof moduleAlertSchema>

export const moduleSummarySchema = z
  .object({
    module: z.enum(OS_MODULES),
    generatedAt: isoInstant,
    counters: z.array(moduleCounterSchema).max(MAX_COUNTERS),
    alerts: z.array(moduleAlertSchema).max(MAX_ALERTS),
    openHref: httpUrl,
  })
  .strict()
export type ModuleSummary = z.infer<typeof moduleSummarySchema>
