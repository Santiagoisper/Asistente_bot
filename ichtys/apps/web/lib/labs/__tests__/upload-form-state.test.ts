import { describe, expect, it } from 'vitest'
import { createSubjectError, imagePrepMessage, missingPhotoSteps, missingSteps, orderStudyOptions, subjectCodeProblem, subjectCountLabel, uploadError } from '../upload-form-state'

const base = { studyId: 's1', subjectsState: 'ready' as const, subjectCount: 2, subjectId: 'p1', hasFile: true }

describe('missingSteps — por qué "Leer el estudio" está deshabilitado', () => {
  it('con todo elegido no falta nada', () => {
    expect(missingSteps(base)).toEqual([])
  })

  it('un estudio sin sujetos pide crear el sujeto, no "elegirlo"', () => {
    expect(missingSteps({ ...base, subjectCount: 0, subjectId: '' })).toEqual(['crear el sujeto'])
  })

  it('nombra cada paso que falta, en orden', () => {
    expect(missingSteps({ ...base, subjectId: '', hasFile: false })).toEqual(['elegir el sujeto', 'elegir el PDF'])
    expect(missingSteps({ ...base, studyId: '', hasFile: false })).toEqual(['elegir el estudio', 'elegir el PDF'])
  })

  it('distingue la lista cargando de la lista que falló', () => {
    expect(missingSteps({ ...base, subjectsState: 'loading' })).toEqual(['esperar la lista de sujetos'])
    expect(missingSteps({ ...base, subjectsState: 'error' })).toEqual(['recargar la lista de sujetos'])
  })
})

describe('orden de los estudios', () => {
  it('pone primero los que ya tienen sujetos y conserva el orden alfabético dentro de cada grupo', () => {
    const ordered = orderStudyOptions([
      { id: 'a', subjectCount: 0 },
      { id: 'b', subjectCount: 3 },
      { id: 'c', subjectCount: 0 },
      { id: 'd', subjectCount: 1 },
    ])
    expect(ordered.map((study) => study.id)).toEqual(['b', 'd', 'a', 'c'])
  })
})

describe('textos del formulario', () => {
  it('cuenta sujetos en singular y plural', () => {
    expect([0, 1, 7].map(subjectCountLabel)).toEqual(['sin sujetos', '1 sujeto', '7 sujetos'])
  })

  it('valida el código con el criterio del servidor', () => {
    expect(subjectCodeProblem('001-014')).toBeNull()
    expect(subjectCodeProblem('  AR-07 ')).toBeNull()
    expect(subjectCodeProblem('')).toBe('Escribí el código del sujeto.')
    expect(subjectCodeProblem('7')).toBe('El código tiene entre 2 y 32 caracteres.')
    expect(subjectCodeProblem('x'.repeat(33))).toBe('El código tiene entre 2 y 32 caracteres.')
    expect(subjectCodeProblem('Juan Pérez')).toBe('Usá solo letras, números y guiones.')
  })

  it('explica cada falla al crear el sujeto', () => {
    expect(createSubjectError(409, 'subject_code_exists')).toMatch(/Ya hay un sujeto/)
    expect(createSubjectError(403, null)).toMatch(/Tu rol/)
    expect(createSubjectError(503, 'phi_encryption_not_configured')).toMatch(/cifrado/)
    expect(createSubjectError(500, null)).toMatch(/No se pudo crear/)
  })

  it('explica cada falla al leer el estudio y nunca devuelve un texto vacío', () => {
    expect(uploadError(422, 'no_text')).toMatch(/escaneo/)
    expect(uploadError(422, 'no_rows')).toMatch(/No se encontraron resultados/)
    expect(uploadError(413, null)).toBe('El archivo pesa más de 4 MB.')
    expect(uploadError(403, null)).toMatch(/Tu rol/)
    expect(uploadError(500, 'algo_nuevo')).toBe('No se pudo leer el estudio. Probá de nuevo.')
  })
})

describe('foto o escaneo', () => {
  it('pide la imagen y después la zona marcada en cada hoja', () => {
    expect(missingPhotoSteps([], { pageCount: 0, unmarked: 0 })).toEqual(['elegir la foto o el escaneo'])
    expect(missingPhotoSteps(['crear el sujeto'], { pageCount: 3, unmarked: 2 })).toEqual(['crear el sujeto', 'marcar la zona de resultados en 2 hojas'])
    expect(missingPhotoSteps([], { pageCount: 1, unmarked: 1 })).toEqual(['marcar la zona de resultados en una hoja'])
    expect(missingPhotoSteps([], { pageCount: 2, unmarked: 0 })).toEqual([])
  })

  it('explica cada problema de la imagen y del lector', () => {
    expect(imagePrepMessage('unsupported')).toMatch(/JPG o PNG/)
    expect(imagePrepMessage('pdf_failed')).toMatch(/captura/)
    expect(imagePrepMessage('otro')).toMatch(/No se pudo abrir/)
    expect(uploadError(503, 'reader_unavailable')).toMatch(/no se guardó/)
    expect(uploadError(415, 'bad_image')).toMatch(/JPG o PNG/)
  })
})
