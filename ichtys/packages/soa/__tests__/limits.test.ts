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
  return assemblePdf(objects)
}

/** PDF de UNA página con un ítem horizontal y dos girados ±90° (K1, R3). */
function rotatedTextPdf(): Uint8Array {
  const content =
    'BT /F1 10 Tf 1 0 0 1 20 100 Tm (horizontal) Tj ET\n' +
    'BT /F1 10 Tf 0 1 -1 0 150 20 Tm (girado) Tj ET\n' +
    'BT /F1 10 Tf 0 -1 1 0 30 180 Tm (girado b negativo) Tj ET\n'
  const objects: string[] = []
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>'
  objects[2] = '<< /Type /Pages /Count 1 /Kids [3 0 R] >>'
  objects[3] =
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>'
  objects[4] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
  objects[5] = `<< /Length ${content.length} >>\nstream\n${content}endstream`
  return assemblePdf(objects)
}

/** Cuerpo + xref de un PDF a partir de sus objetos (todo ASCII). */
function assemblePdf(objects: string[]): Uint8Array {
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

describe('K1 — señal de texto rotado (transform b/c ≠ 0)', () => {
  it('un PDF con texto dibujado girado ±90° reporta los ítems como rotated con caja correcta', async () => {
    // Tres ítems: horizontal (Tm 1 0 0 1), girado +90 (Tm 0 1 -1 0, b > 0)
    // y girado −90 (Tm 0 -1 1 0, b < 0). Helvetica es fuente estándar, sin
    // archivos. En los fixtures no hay texto rotado — esta es la señal que
    // dispara el reason 'rotated_text' de grid cuando acompañan refs sin
    // nota (G6). Con b < 0 (R3) la caja crece hacia +x desde el origen (e,f),
    // no hacia −x.
    const page = (await loadPageGeometry(rotatedTextPdf()))[0]!
    expect(page.items).toHaveLength(3)
    expect(page.items.filter((i) => i.rotated)).toHaveLength(2)
    const horizontal = page.items.find((i) => !i.rotated)
    expect(horizontal).toBeDefined()
    for (const rotated of page.items.filter((i) => i.rotated)) {
      expect(rotated.fontSize).toBeGreaterThan(0)
      // Girado: el texto corre en y — la caja es más alta que ancha.
      expect(rotated.bbox[3] - rotated.bbox[1]).toBeGreaterThan(
        rotated.bbox[2] - rotated.bbox[0],
      )
      expect(rotated.bbox[2]).toBeGreaterThan(rotated.bbox[0])
      expect(rotated.bbox[3]).toBeGreaterThan(rotated.bbox[1])
    }
    // El girado +90 parte de (150, 20): la caja vive en x < 150.
    const plus90 = page.items.find((i) => i.rotated && i.bbox[2] <= 150.5)!
    expect(plus90.bbox[2]).toBeGreaterThan(140)
    // El girado −90 parte de (30, 180): la caja crece hacia +x (R3), con
    // x0 en el propio origen — antes quedaba corrida −height.
    const minus90 = page.items.find((i) => i.rotated && i.bbox[0] < 50)!
    expect(minus90.bbox[0]).toBeGreaterThanOrEqual(29.5)
    expect(minus90.bbox[0]).toBeLessThan(35)
    // Y avanza hacia −y desde 180.
    expect(minus90.bbox[3]).toBeLessThanOrEqual(180.5)
    expect(minus90.bbox[1]).toBeLessThan(150)
  })
})
