/**
 * K3 + R6 — topes de lectura S5 ANTES de abrir contenido (paridad con
 * ingestion, evidencia/B4-sicario.md): buffer ≤ 50 MB, ≤ 300 páginas y
 * tiempo por página acotado. Un PDF por encima del tope se rechaza con
 * `PdfLimitError` de código estable (fail-closed), no con crash ni cuelgue.
 *
 * El PDF de N páginas se arma en el propio test: es un PDF válido mínimo
 * (catálogo, árbol de páginas y N páginas vacías sin /Contents) escrito a
 * mano con xref byte-exact — así el tope de páginas se prueba con un
 * documento real de pdfjs, sin mocks.
 *
 * El tope de tiempo por página (`page_timeout`, Promise.race de 10 s) no se
 * ejercita con una página que cuelgue de verdad: haría falta un PDF hostil
 * construido a propósito; queda cubierto por implementación y documentado
 * acá.
 */
import { describe, expect, it } from 'vitest'
import { loadPageGeometry, PdfLimitError } from '../index'

/** PDF mínimo de `pageCount` páginas vacías, offsets byte-exact (ASCII puro). */
function minimalPdf(pageCount: number): Uint8Array {
  const objects: string[] = []
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>'
  const kids = Array.from({ length: pageCount }, (_, i) => `${i + 3} 0 R`).join(' ')
  objects[2] = `<< /Type /Pages /Count ${pageCount} /Kids [${kids}] >>`
  for (let i = 0; i < pageCount; i++) {
    objects[i + 3] = '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >>'
  }
  let body = '%PDF-1.4\n'
  const offsets: number[] = []
  for (let i = 1; i < objects.length; i++) {
    offsets[i] = body.length
    body += `${i} 0 obj\n${objects[i]}\nendobj\n`
  }
  const xrefStart = body.length
  body += `xref\n0 ${objects.length}\n0000000000 65535 f \n`
  for (let i = 1; i < objects.length; i++) {
    body += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`
  }
  body += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`
  return new Uint8Array(Buffer.from(body, 'latin1'))
}

describe('K3 — topes de lectura S5 con rechazo controlado', () => {
  it('buffer de más de 50 MB: PdfLimitError file_too_large sin abrir el documento', async () => {
    const huge = new Uint8Array(50 * 1024 * 1024 + 1)
    huge.set(Buffer.from('%PDF-1.4\n', 'latin1'))
    const rejection = loadPageGeometry(huge)
    await expect(rejection).rejects.toBeInstanceOf(PdfLimitError)
    await rejection.catch((error: PdfLimitError) => {
      expect(error.code).toBe('file_too_large')
    })
  })

  it('PDF de 301 páginas: PdfLimitError too_many_pages antes de leer contenido', async () => {
    const rejection = loadPageGeometry(minimalPdf(301))
    await expect(rejection).rejects.toBeInstanceOf(PdfLimitError)
    await rejection.catch((error: PdfLimitError) => {
      expect(error.code).toBe('too_many_pages')
    })
  })

  it('PDF de 2 páginas del mismo builder: pasa el tope y devuelve sus páginas', async () => {
    const pages = await loadPageGeometry(minimalPdf(2))
    expect(pages).toHaveLength(2)
    expect(pages.map((p) => p.page)).toEqual([1, 2])
    expect(pages.every((p) => p.items.length === 0 && p.rules.length === 0)).toBe(true)
  })
})
