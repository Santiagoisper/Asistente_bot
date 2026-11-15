/**
 * Formato del código de un sujeto (decisión del 15/11/2026).
 *
 * El código se guarda en claro y se muestra en el inicio, en laboratorios y en la exportación. Tiene
 * que ser el código del estudio, no un dato de la persona. La regla frena los dos errores más
 * probables: cargar un documento (solo números) o iniciales o un nombre (solo letras).
 *
 * Lo que no frena: iniciales seguidas de un número («JP-1973»), o un documento escrito con guiones.
 * Ninguna regla de formato distingue eso de un código legítimo; depende de quien lo carga.
 *
 * Vale para el alta. Los sujetos que ya existen conservan su código.
 */
export const SUBJECT_CODE_EXAMPLE = '001-014 o GZBO-001'

export type SubjectCodeProblem = 'empty' | 'length' | 'characters' | 'only_digits' | 'no_digit'

export function subjectCodeFormatProblem(code: string): SubjectCodeProblem | null {
  const value = code.trim()
  if (value.length === 0) return 'empty'
  if (value.length < 2 || value.length > 32) return 'length'
  if (!/^[A-Za-z0-9-]+$/.test(value)) return 'characters'
  if (!/\d/.test(value)) return 'no_digit'
  // Sin letras, tiene que ser números separados por guiones («001-014»), no una tira de números.
  if (!/[A-Za-z]/.test(value) && !/^\d+(-\d+)+$/.test(value)) return 'only_digits'
  return null
}

export const SUBJECT_CODE_MESSAGES: Record<SubjectCodeProblem, string> = {
  empty: 'Escribí el código del sujeto.',
  length: 'El código tiene entre 2 y 32 caracteres.',
  characters: 'Usá solo letras, números y guiones.',
  only_digits: `Un código de solo números puede ser un documento. Usá el código del estudio, por ejemplo ${SUBJECT_CODE_EXAMPLE}.`,
  no_digit: `Un código sin números puede ser un nombre o iniciales. Usá el código del estudio, por ejemplo ${SUBJECT_CODE_EXAMPLE}.`,
}
