import { LabReportError, type LabReportErrorCode } from './lab-report-service'

const STATUS: Record<LabReportErrorCode, number> = {
  not_found: 404,
  already_reviewed: 409,
  no_text: 422,
  unreadable: 422,
  too_many_pages: 422,
  no_rows: 422,
  invalid_rows: 400,
}

/** Respuesta para un error del módulo: código estable, sin texto del documento. */
export function labReportErrorResponse(err: unknown): Response | null {
  if (!(err instanceof LabReportError)) return null
  return Response.json({ error: err.code }, { status: STATUS[err.code] })
}

/** Los ids de ruta son UUID; cualquier otra cosa no llega a la base. */
export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
}
