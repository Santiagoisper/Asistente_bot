import { describe, expect, it } from 'vitest'
import { parsePdf, PdfParseError } from '../parser'

/**
 * PDF 1.4 mínimo, sin object streams. pdf-parse@1.1.4 no lee de forma fiable
 * el PDF 1.7 que escribe pdf-lib. El comentario largo evita el Buffer chico
 * que esta build de pdf.js lee con el xref corrido; los bytes se copian igual
 * a un Uint8Array dentro de parsePdf.
 */
function buildPdf(pageCount: number): Buffer {
  const parts: string[] = []
  const offsets: number[] = []
  let cursor = 0
  const write = (s: string) => {
    parts.push(s)
    cursor += Buffer.byteLength(s)
  }
  write('%PDF-1.4\n')
  write(`%${'F'.repeat(16_384)}\n`)
  const pageObj = (i: number) => 4 + i * 2
  const contentObj = (i: number) => 5 + i * 2
  const maxObj = 3 + pageCount * 2
  const addObj = (num: number, body: string) => {
    offsets[num] = cursor
    write(`${num} 0 obj\n${body}\nendobj\n`)
  }
  addObj(1, '<< /Type /Catalog /Pages 2 0 R >>')
  const kids = Array.from({ length: pageCount }, (_, i) => `${pageObj(i)} 0 R`).join(' ')
  addObj(2, `<< /Type /Pages /Kids [${kids}] /Count ${pageCount} >>`)
  addObj(3, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>')
  for (let i = 0; i < pageCount; i++) {
    const text = i === 0 ? 'FICTICIO' : 'X'
    const streamBody = `BT /F1 12 Tf 72 72 Td (${text}) Tj ET`
    addObj(
      pageObj(i),
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentObj(i)} 0 R >>`,
    )
    addObj(
      contentObj(i),
      `<< /Length ${Buffer.byteLength(streamBody)} >>\nstream\n${streamBody}\nendstream`,
    )
  }
  const xrefStart = cursor
  let xref = `xref\n0 ${maxObj + 1}\n0000000000 65535 f \n`
  for (let i = 1; i <= maxObj; i++) {
    xref += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`
  }
  write(xref)
  write(`trailer\n<< /Size ${maxObj + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`)
  return Buffer.from(parts.join(''))
}

describe('parsePdf contra pdf-parse real', () => {
  it('lee un PDF ficticio de dos páginas', async () => {
    const parsed = await parsePdf(buildPdf(2))

    expect(parsed.pageCount).toBe(2)
    expect(parsed.pages[0]?.rawText).toContain('FICTICIO')
  })

  it('rechaza un PDF de 301 páginas aunque la librería se trague el error de la página', async () => {
    await expect(parsePdf(buildPdf(301))).rejects.toMatchObject({
      name: 'PdfParseError',
      code: 'pdf_complexity_limit',
    })
  }, 60_000)

  it('un PDF truncado falla con un código controlado', async () => {
    const full = buildPdf(2)
    const chopped = Buffer.from(full.subarray(0, Math.floor(full.byteLength / 2)))

    await expect(parsePdf(chopped)).rejects.toBeInstanceOf(PdfParseError)
    await expect(parsePdf(chopped)).rejects.toMatchObject({
      code: 'pdf_text_extraction_failed',
    })
  })
})
