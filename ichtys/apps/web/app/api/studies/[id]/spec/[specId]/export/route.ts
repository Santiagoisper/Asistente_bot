import { z } from 'zod'
import { AccessError, validateStudyAccess } from '@ichtys/auth'
import { and, db, eq, studySpecs } from '@ichtys/db'
import { studySpecSchema } from '@ichtys/ingestion'
import type { StudySpec } from '@ichtys/ingestion'
import {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  Header, Footer, PageNumber, AlignmentType, HeadingLevel,
  BorderStyle, WidthType, ShadingType, VerticalAlign,
  LevelFormat, TableOfContents,
} from 'docx'

export const runtime = 'nodejs'

interface RouteParams {
  params: Promise<{ id: string; specId: string }>
}

const querySchema = z.object({
  format: z.enum(['docx', 'pdf']),
})

// ---------------------------------------------------------------------------
// Cell helpers
// ---------------------------------------------------------------------------

const CELL_BORDER = { style: BorderStyle.SINGLE, size: 1, color: 'DDDDDD' } as const
const CELL_BORDERS = { top: CELL_BORDER, bottom: CELL_BORDER, left: CELL_BORDER, right: CELL_BORDER }
const CELL_MARGINS = { top: 80, bottom: 80, left: 120, right: 120 }

function headerCell(text: string, widthDxa: number) {
  return new TableCell({
    borders: CELL_BORDERS,
    width: { size: widthDxa, type: WidthType.DXA },
    shading: { fill: '1A4B6E', type: ShadingType.CLEAR },
    margins: CELL_MARGINS,
    verticalAlign: VerticalAlign.CENTER,
    children: [
      new Paragraph({
        children: [new TextRun({ text, bold: true, color: 'FFFFFF', size: 18 })],
      }),
    ],
  })
}

function bodyCell(text: string, widthDxa: number, mono = false) {
  return new TableCell({
    borders: CELL_BORDERS,
    width: { size: widthDxa, type: WidthType.DXA },
    margins: CELL_MARGINS,
    children: [
      new Paragraph({
        children: [
          new TextRun({ text: text || '—', size: 18, font: mono ? 'Courier New' : 'Arial' }),
        ],
      }),
    ],
  })
}

// ---------------------------------------------------------------------------
// DOCX generation
// ---------------------------------------------------------------------------

function buildDocx(spec: StudySpec, specVersion: number, specStatus: string): Document {
  const protocol = spec.identification.protocolCode ?? 'Sin código'
  const title    = spec.identification.title    ?? 'Sin título'
  const phase    = spec.identification.phase    ?? '—'
  const now      = new Date().toLocaleDateString('es-AR', { day: '2-digit', month: 'long', year: 'numeric' })
  const statusLabel = specStatus === 'approved' ? 'APROBADO' : specStatus === 'draft' ? 'BORRADOR' : 'SUPERSEDIDO'

  // Content width for A4 with 1" margins (11906 - 2880 = 9026 DXA)
  const contentWidth = 9026

  // ── Inclusion criteria table ──
  const inclusionRows: TableRow[] = [
    new TableRow({ children: [headerCell('N°', 720), headerCell('Criterio de inclusión', contentWidth - 720)] }),
    ...spec.inclusionCriteria.map((c) =>
      new TableRow({
        children: [bodyCell(c.number, 720, true), bodyCell(c.text, contentWidth - 720)],
      }),
    ),
  ]

  // ── Exclusion criteria table ──
  const exclusionRows: TableRow[] = [
    new TableRow({ children: [headerCell('N°', 720), headerCell('Criterio de exclusión', contentWidth - 720)] }),
    ...spec.exclusionCriteria.map((c) =>
      new TableRow({
        children: [bodyCell(c.number, 720, true), bodyCell(c.text, contentWidth - 720)],
      }),
    ),
  ]

  // ── Endpoints table ──
  const endpointTypeLabel: Record<string, string> = {
    primary: 'Primario', secondary: 'Secundario', exploratory: 'Exploratorio',
  }
  const endpointCols = [1200, 3913, 3913] as const
  const endpointsRows: TableRow[] = [
    new TableRow({
      children: [
        headerCell('Tipo',     endpointCols[0]),
        headerCell('Objetivo', endpointCols[1]),
        headerCell('Endpoint', endpointCols[2]),
      ],
    }),
    ...spec.endpoints.map((e) =>
      new TableRow({
        children: [
          bodyCell(endpointTypeLabel[e.type] ?? e.type, endpointCols[0]),
          bodyCell(e.objective, endpointCols[1]),
          bodyCell(e.endpoint,  endpointCols[2]),
        ],
      }),
    ),
  ]

  // ── Visits table ──
  const visitCols = [1500, 1500, 900, 900, contentWidth - 4800] as const
  const visitsRows: TableRow[] = [
    new TableRow({
      children: [
        headerCell('Visita',     visitCols[0]),
        headerCell('Etiqueta',   visitCols[1]),
        headerCell('Día',        visitCols[2]),
        headerCell('Ventana',    visitCols[3]),
        headerCell('Procedimientos', visitCols[4]),
      ],
    }),
    ...spec.visits.map((v) =>
      new TableRow({
        children: [
          bodyCell(v.name,                                               visitCols[0]),
          bodyCell(v.label ?? '—',                                       visitCols[1]),
          bodyCell(v.day !== null && v.day !== undefined ? String(v.day) : '—', visitCols[2], true),
          bodyCell(v.windowDays !== null && v.windowDays !== undefined ? `±${v.windowDays}d` : '—', visitCols[3], true),
          bodyCell(v.procedures.join(', ') || '—',                       visitCols[4]),
        ],
      }),
    ),
  ]

  function makeTable(rows: TableRow[], totalWidth: number) {
    return new Table({
      width: { size: totalWidth, type: WidthType.DXA },
      rows,
    })
  }

  function heading(text: string, level: (typeof HeadingLevel)[keyof typeof HeadingLevel]) {
    return new Paragraph({ heading: level, children: [new TextRun(text)] })
  }

  function spacer() {
    return new Paragraph({ children: [] })
  }

  return new Document({
    styles: {
      default: {
        document: { run: { font: 'Arial', size: 20 } },
      },
      paragraphStyles: [
        {
          id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true,
          run: { size: 28, bold: true, font: 'Arial', color: '1A4B6E' },
          paragraph: { spacing: { before: 300, after: 150 }, outlineLevel: 0 },
        },
        {
          id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true,
          run: { size: 22, bold: true, font: 'Arial', color: '2E6B9E' },
          paragraph: { spacing: { before: 200, after: 100 }, outlineLevel: 1 },
        },
      ],
    },
    numbering: {
      config: [
        {
          reference: 'bullets',
          levels: [{
            level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 720, hanging: 360 } } },
          }],
        },
      ],
    },
    sections: [{
      properties: {
        page: {
          // A4
          size: { width: 11906, height: 16838 },
          margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
        },
      },
      headers: {
        default: new Header({
          children: [
            new Paragraph({
              alignment: AlignmentType.RIGHT,
              children: [
                new TextRun({ text: `${protocol} — ALPHI Spec Export`, size: 16, color: '888888' }),
              ],
            }),
          ],
        }),
      },
      footers: {
        default: new Footer({
          children: [
            new Paragraph({
              alignment: AlignmentType.CENTER,
              children: [
                new TextRun({ text: 'Página ', size: 16, color: '888888' }),
                new TextRun({ children: [PageNumber.CURRENT], size: 16, color: '888888' }),
                new TextRun({ text: ' de ', size: 16, color: '888888' }),
                new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 16, color: '888888' }),
                new TextRun({ text: ` — Exportado ${now} — Estado: ${statusLabel}`, size: 16, color: '888888' }),
              ],
            }),
          ],
        }),
      },
      children: [
        // Cover
        new Paragraph({
          heading: HeadingLevel.HEADING_1,
          children: [new TextRun({ text: title, bold: true, size: 36, color: '1A4B6E' })],
        }),
        new Paragraph({
          children: [new TextRun({ text: `Protocolo: ${protocol}`, size: 22, color: '444444' })],
        }),
        new Paragraph({
          children: [new TextRun({ text: `Fase: ${phase}  ·  Versión spec: ${specVersion}  ·  Estado: ${statusLabel}`, size: 20, color: '666666' })],
        }),
        spacer(),
        new Paragraph({
          children: [new TextRun({ text: `Generado por ALPHI el ${now}`, size: 18, italics: true, color: '888888' })],
        }),
        spacer(),
        new TableOfContents('Índice', { hyperlink: true, headingStyleRange: '1-2' }),
        spacer(),

        // 1. Inclusion criteria
        heading('1. Criterios de inclusión', HeadingLevel.HEADING_1),
        makeTable(inclusionRows, contentWidth),
        spacer(),

        // 2. Exclusion criteria
        heading('2. Criterios de exclusión', HeadingLevel.HEADING_1),
        makeTable(exclusionRows, contentWidth),
        spacer(),

        // 3. Endpoints
        heading('3. Objetivos y criterios de valoración', HeadingLevel.HEADING_1),
        makeTable(endpointsRows, contentWidth),
        spacer(),

        // 4. Visit schedule
        heading('4. Cronograma de actividades (SoA)', HeadingLevel.HEADING_1),
        makeTable(visitsRows, contentWidth),
        spacer(),
      ],
    }],
  })
}

// ---------------------------------------------------------------------------
// HTML/PDF generation
// ---------------------------------------------------------------------------

function buildHtml(spec: StudySpec, specVersion: number, specStatus: string): string {
  const protocol = spec.identification.protocolCode ?? 'Sin código'
  const title    = spec.identification.title    ?? 'Sin título'
  const phase    = spec.identification.phase    ?? '—'
  const now      = new Date().toLocaleDateString('es-AR', { day: '2-digit', month: 'long', year: 'numeric' })
  const statusLabel = specStatus === 'approved' ? 'APROBADO' : specStatus === 'draft' ? 'BORRADOR' : 'SUPERSEDIDO'

  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

  const inclusionRows = spec.inclusionCriteria
    .map((c) => `<tr><td class="num">${esc(c.number)}</td><td>${esc(c.text)}</td></tr>`)
    .join('')

  const exclusionRows = spec.exclusionCriteria
    .map((c) => `<tr><td class="num">${esc(c.number)}</td><td>${esc(c.text)}</td></tr>`)
    .join('')

  const epTypeLabel: Record<string, string> = {
    primary: 'Primario', secondary: 'Secundario', exploratory: 'Exploratorio',
  }
  const endpointRows = spec.endpoints
    .map((e) => `<tr><td><span class="badge ep-${e.type}">${epTypeLabel[e.type] ?? e.type}</span></td><td>${esc(e.objective)}</td><td>${esc(e.endpoint)}</td></tr>`)
    .join('')

  const visitRows = spec.visits
    .map((v) => `
      <tr>
        <td><strong>${esc(v.name)}</strong></td>
        <td>${v.label ? esc(v.label) : '—'}</td>
        <td class="mono">${v.day !== null && v.day !== undefined ? v.day : '—'}</td>
        <td class="mono">${v.windowDays !== null && v.windowDays !== undefined ? `±${v.windowDays}d` : '—'}</td>
        <td>${v.procedures.length ? v.procedures.map(esc).map((p) => `<span class="proc">${p}</span>`).join(' ') : '—'}</td>
      </tr>`)
    .join('')

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<title>${esc(protocol)} — ALPHI Spec Export</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, sans-serif; font-size: 11pt; color: #1a1a2e; background: #fff; padding: 0; }
  @page { size: A4; margin: 18mm 20mm 18mm 20mm; }
  @media print {
    .no-print { display: none; }
    h1 { page-break-after: avoid; }
    table { page-break-inside: auto; }
    tr { page-break-inside: avoid; }
  }

  /* Print button */
  .no-print {
    position: fixed; top: 16px; right: 16px; z-index: 9999;
    background: #1a4b6e; color: white; border: none;
    padding: 10px 20px; border-radius: 6px; cursor: pointer;
    font-size: 13px; font-weight: 600; font-family: Arial, sans-serif;
  }
  .no-print:hover { background: #2e6b9e; }

  /* Cover */
  .cover { padding: 40px 0 24px; border-bottom: 3px solid #1a4b6e; margin-bottom: 32px; }
  .cover .badge-status {
    display: inline-block; padding: 3px 12px; border-radius: 999px;
    font-size: 9pt; font-weight: 700; letter-spacing: 0.05em;
    background: ${specStatus === 'approved' ? '#d1fae5' : '#fef3c7'};
    color: ${specStatus === 'approved' ? '#065f46' : '#92400e'};
    margin-bottom: 10px;
  }
  .cover h1 { font-size: 20pt; font-weight: 700; color: #1a4b6e; line-height: 1.2; margin-bottom: 6px; }
  .cover .meta { font-size: 9pt; color: #666; margin-top: 8px; }

  /* Sections */
  h2 { font-size: 14pt; font-weight: 700; color: #1a4b6e; margin: 28px 0 12px; padding-bottom: 4px; border-bottom: 1px solid #d0d9e3; }

  /* Tables */
  table { width: 100%; border-collapse: collapse; font-size: 9.5pt; margin-bottom: 24px; }
  thead th { background: #1a4b6e; color: #fff; font-weight: 600; padding: 7px 10px; text-align: left; }
  tbody tr:nth-child(even) { background: #f5f8fb; }
  td { padding: 6px 10px; border-bottom: 1px solid #e5eaf0; vertical-align: top; line-height: 1.4; }
  td.num { font-family: 'Courier New', monospace; font-size: 9pt; white-space: nowrap; width: 48px; color: #666; }
  td.mono { font-family: 'Courier New', monospace; font-size: 9pt; color: #555; white-space: nowrap; }

  /* Endpoint badges */
  .badge { display: inline-block; padding: 1px 8px; border-radius: 999px; font-size: 8pt; font-weight: 700; white-space: nowrap; }
  .ep-primary     { background: #1a4b6e; color: #fff; }
  .ep-secondary   { background: #dbeafe; color: #1e40af; }
  .ep-exploratory { background: #fef3c7; color: #92400e; }

  /* Procedure chips */
  .proc { display: inline-block; background: #f0f4f8; border-radius: 4px; padding: 1px 6px; margin: 1px 2px; font-size: 8.5pt; color: #444; }

  /* Footer */
  .footer { margin-top: 40px; padding-top: 10px; border-top: 1px solid #d0d9e3; font-size: 8pt; color: #999; text-align: center; }
</style>
</head>
<body>
<button class="no-print" onclick="window.print()">🖨 Imprimir / Guardar PDF</button>

<div class="cover">
  <div class="badge-status">${statusLabel} · v${specVersion}</div>
  <h1>${esc(title)}</h1>
  <div class="meta">
    <strong>Protocolo:</strong> ${esc(protocol)} &nbsp;·&nbsp;
    <strong>Fase:</strong> ${esc(phase)} &nbsp;·&nbsp;
    <strong>Exportado:</strong> ${now} via ALPHI
  </div>
</div>

<h2>1. Criterios de inclusión</h2>
<table>
  <thead><tr><th style="width:48px">N°</th><th>Criterio</th></tr></thead>
  <tbody>${inclusionRows}</tbody>
</table>

<h2>2. Criterios de exclusión</h2>
<table>
  <thead><tr><th style="width:48px">N°</th><th>Criterio</th></tr></thead>
  <tbody>${exclusionRows}</tbody>
</table>

<h2>3. Objetivos y criterios de valoración (endpoints)</h2>
<table>
  <thead><tr><th style="width:110px">Tipo</th><th>Objetivo</th><th>Endpoint</th></tr></thead>
  <tbody>${endpointRows}</tbody>
</table>

<h2>4. Cronograma de actividades (SoA)</h2>
<table>
  <thead>
    <tr>
      <th>Visita</th>
      <th style="width:100px">Etiqueta</th>
      <th style="width:52px">Día</th>
      <th style="width:64px">Ventana</th>
      <th>Procedimientos</th>
    </tr>
  </thead>
  <tbody>${visitRows}</tbody>
</table>

<div class="footer">
  Documento generado automáticamente por ALPHI · ${now} · ${statusLabel} · v${specVersion}<br>
  Verificar siempre contra el protocolo original. Este documento no reemplaza el protocolo oficial.
</div>
</body>
</html>`
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function GET(req: Request, { params }: RouteParams) {
  const { id: studyId, specId } = await params

  const url    = new URL(req.url)
  const parsed = querySchema.safeParse({ format: url.searchParams.get('format') })
  if (!parsed.success) {
    return new Response(
      JSON.stringify({ error: 'format debe ser "pdf" o "docx"' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    )
  }

  const { format } = parsed.data

  try {
    const { orgId } = await validateStudyAccess(studyId)

    const row = await db.query.studySpecs.findFirst({
      where: and(
        eq(studySpecs.id, specId),
        eq(studySpecs.organizationId, orgId),
        eq(studySpecs.studyId, studyId),
      ),
    })

    if (!row) {
      return new Response(JSON.stringify({ error: 'Spec no encontrado' }), {
        status: 404, headers: { 'Content-Type': 'application/json' },
      })
    }

    const specParsed = studySpecSchema.safeParse(row.spec)
    if (!specParsed.success) {
      return new Response(JSON.stringify({ error: 'Formato de spec inválido' }), {
        status: 422, headers: { 'Content-Type': 'application/json' },
      })
    }

    const spec = specParsed.data
    const protocol = spec.identification.protocolCode ?? 'spec'
    const safeName = protocol.replace(/[^a-z0-9-_]/gi, '_').toLowerCase()

    if (format === 'docx') {
      const doc    = buildDocx(spec, row.version, row.status)
      const buffer = await Packer.toBuffer(doc)

      return new Response(new Uint8Array(buffer), {
        status: 200,
        headers: {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'Content-Disposition': `attachment; filename="${safeName}_spec_v${row.version}.docx"`,
          'Cache-Control': 'no-store',
        },
      })
    }

    // PDF: return print-ready HTML — browser saves as PDF via Ctrl+P / window.print()
    const html = buildHtml(spec, row.version, row.status)
    return new Response(html, {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Disposition': `inline; filename="${safeName}_spec_v${row.version}.html"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (err) {
    if (err instanceof AccessError) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: err.status, headers: { 'Content-Type': 'application/json' },
      })
    }
    console.error('[GET /api/studies/[id]/spec/[specId]/export]', err)
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    })
  }
}
