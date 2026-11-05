#!/usr/bin/env python3
"""Generador determinista de los fixtures SoA F1–F5.

El mismo proceso escribe el PDF y el JSON de verdad. Semillas fijas.
Contenido inventado: sin patrocinador, sin fármaco y sin protocolo real.

F6, F6b, F7 y F8 (generador 1.3.0) viven en f6_f7.py:
`python generate.py F6 F6b F7 F8` no reescribe F1–F5.
"""
from __future__ import annotations

import io
import json
import sys
from pathlib import Path

from pypdf import PdfReader, PdfWriter
from pypdf.generic import ArrayObject, ByteStringObject
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "fixtures" / "soa"
FONT_PATH = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
FONTB_PATH = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
VERSION = "1.1.0"
PORTRAIT = (612.0, 792.0)
LANDSCAPE = (792.0, 612.0)
SECTION_ES = "1.3 Cronograma de actividades"
SECTION_EN = "1.3 Schedule of Assessments"

pdfmetrics.registerFont(TTFont("DejaVu", FONT_PATH))
pdfmetrics.registerFont(TTFont("DejaVuBold", FONTB_PATH if Path(FONTB_PATH).exists() else FONT_PATH))

FORBIDDEN = (
    "pfizer", "lilly", "roche", "novartis", "sanofi", "boehringer", "tirzepatid",
    "semaglutid", "keynote", "ozempic", "humira", "opdivo",
)


def W(before, after, unit):
    return {"before": before, "after": after, "unit": unit}


def timing(kind, value, unit, anchor=None, recurrence=None):
    return {"kind": kind, "value": value, "unit": unit, "anchor": anchor, "recurrence": recurrence}


def cond(kind, expr, page=1, source_ref=""):
    return {"kind": kind, "expr": expr, "sourceRef": source_ref, "page": page, "confidence": 1}


def visit(key, printed, label, kind, value, unit, vtype, window, fasting=None, onsite=None, arm=None, anchor=None, recurrence=None):
    return {
        "key": key,
        "printedId": printed,
        "label": label,
        "timing": timing(kind, value, unit, anchor, recurrence),
        "window": window,
        "type": vtype,
        "attributes": {"fasting": fasting, "onSite": onsite, "armOnly": arm},
        "page": None,
        "bbox": None,
    }


def procedure(key, label, kind="procedure"):
    aliases = {
        "ECG de 12 derivaciones": ["electrocardiograma", "ecg"],
        "Signos vitales": ["vitales"],
        "12-lead ECG": ["electrocardiogram"],
        "Vital signs": ["vitals"],
    }.get(label, [])
    return {"key": key, "label": label, "section": None, "kind": kind, "conditions": [], "aliases": aliases, "page": None, "bbox": None}


def catalog_es():
    labels = [
        "Consentimiento informado",
        "Criterios de inclusión/exclusión",
        "Datos demográficos",
        "Antecedentes",
        "Medicación concomitante",
        "Eventos adversos",
        "Signos vitales",
        "Peso",
        "Talla",
        "Examen físico completo",
        "Examen físico dirigido",
        "ECG de 12 derivaciones",
        "Prueba de embarazo en orina",
        "Prueba de embarazo en suero",
        "Dispensación de producto",
        "Devolución de producto",
        "Adherencia",
        "Registro en sistema de aleatorización",
    ]
    labels += [f"Panel de laboratorio {letter}" for letter in "ABCDEFGH"]
    labels += [f"Analito X{i}" for i in range(1, 13)]
    labels += [f"Cuestionario PRO-{i}" for i in range(1, 7)]
    labels += [f"Escala clínica C-{i}" for i in range(1, 5)]
    labels += [
        "Muestra PK",
        "Muestra de inmunogenicidad",
        "Biomarcador B-1",
        "Biomarcador B-2",
        "Biomarcador B-3",
        "Imagen I-1",
        "Entre 1 y 2 horas después de la dosis",
        "Entre 2 y 4 horas después de la dosis",
        "Entre 4 y 6 horas después de la dosis",
        "Entre 6 y 8 horas después de la dosis",
        "Entre 8 y 12 horas después de la dosis",
        "Entre 12 y 24 horas después de la dosis",
    ]
    return labels


def catalog_en():
    return [
        "Informed consent",
        "Inclusion/exclusion criteria",
        "Demographics",
        "Medical history",
        "Concomitant medications",
        "Adverse events",
        "Vital signs",
        "Weight",
        "Height",
        "Complete physical exam",
        "Directed physical exam",
        "12-lead ECG",
        "Urine pregnancy test",
        "Serum pregnancy test",
        "Study product dispensation",
        "Study product return",
        "Adherence",
        "Randomization system registration",
        "Laboratory panel A",
        "Laboratory panel B",
        "Analyte X1",
        "PRO questionnaire PRO-1",
        "PK sample",
        "Immunogenicity sample",
        "Clinical scale C-1",
        "Biomarker B-1",
        "Imaging I-1",
        "Between 1 and 2 hours after the dose",
        "Between 2 and 4 hours after the dose",
        "Between 4 and 6 hours after the dose",
    ]


def make_procedures(labels, prefix):
    return [procedure(f"{prefix}{i + 1:02d}", label) for i, label in enumerate(labels)]


NOTE_ES = [
    "Solo en participantes del brazo A",
    "Solo en participantes del brazo B",
    "Solo en mujeres con capacidad de concebir",
    "Antes de la dosis",
    "Entre 1 y 2 horas después de la dosis",
    "El resultado tiene que estar disponible antes de V1",
    "Solo con el consentimiento opcional K",
    "Solo si hay un hallazgo en la visita basal",
    "Ventana propia: −4/+2 semanas",
    "En ayunas de al menos 8 h",
]
NOTE_EN = [
    "Arm A participants only",
    "Arm B participants only",
    "Women of childbearing potential only",
    "Before the dose",
    "Between 1 and 2 hours after the dose",
    "The result must be available before D1",
    "Only with optional consent K",
    "Only if a finding is present at the baseline visit",
    "Procedure window: −4/+2 weeks",
    "Fasting for at least 8 h",
]
PROSE_ES = [
    "Este documento es un ejercicio sintético. No describe un estudio real, no nombra un producto comercial y no tiene patrocinador.",
    "Los párrafos siguientes solo ocupan páginas para que el lector llegue a la grilla con el mismo esfuerzo que en un documento largo.",
    "El producto en estudio (PE) y el comparador (CMP) son etiquetas genéricas. Los brazos se llaman A y B. Las ramas de rescate se llaman R1 y R2.",
    "Las evaluaciones usan paneles, analitos y cuestionarios inventados. Ningún resultado de este texto debe leerse como dato clínico.",
    "La numeración de páginas es continua. Un índice puede citar la grilla antes de que la grilla aparezca.",
    "Quien lea este relleno no encuentra aquí una dosis, un tubo ni un volumen. Esos datos no forman parte del ejercicio.",
]
PROSE_EN = [
    "This document is a synthetic exercise. It describes no real study, names no commercial product and has no sponsor.",
    "The following paragraphs only fill pages so a reader reaches the grid after the same amount of paper as in a long document.",
    "Study product (PE) and comparator (CMP) are generic labels. Arms are called A and B. Rescue branches are called R1 and R2.",
    "Assessments use invented panels, analytes and questionnaires. Nothing in this filler is clinical data.",
    "Page numbering is continuous. An index may cite the grid before the grid appears.",
    "A reader of this filler will not find a dose, a tube or a volume. Those data are outside the exercise.",
]


def wrap(text, font, size, width):
    lines, cur = [], ""
    for word in text.split():
        trial = word if not cur else f"{cur} {word}"
        if pdfmetrics.stringWidth(trial, font, size) <= width:
            cur = trial
        else:
            if cur:
                lines.append(cur)
            cur = word
    if cur:
        lines.append(cur)
    return lines


def leaders(c, x, y, title, page_no, width):
    c.setFont("DejaVu", 10)
    c.drawString(x, y, title)
    label_w = pdfmetrics.stringWidth(title, "DejaVu", 10)
    number = str(page_no)
    num_w = pdfmetrics.stringWidth(number, "DejaVu", 10)
    num_x = x + width - num_w
    c.drawString(num_x, y, number)
    dot_x = x + label_w + 6
    while dot_x < num_x - 8:
        c.drawString(dot_x, y, ".")
        dot_x += 5


class Doc:
    def __init__(self, fixture, seed, n_pages, lang):
        self.fixture = fixture
        self.seed = seed
        self.n_pages = n_pages
        self.lang = lang
        self.items = []
        self.tables = []
        self.false_hit_pages = []
        self.rotate_pages = []
        self.rules = []
        self.inconsistencies = []
        self.note_carry = None
        self.difficulty = {
            "splitTokens": 0,
            "mergedCells": 0,
            "shadedColumns": 0,
            "unnumberedColumns": 0,
            "rotatedPages": 0,
            "glyphLoss": False,
        }

    def add(self, drawer, size, kind):
        page = len(self.items) + 1
        self.items.append({"page": page, "drawer": drawer, "size": size, "kind": kind})
        return page

    def page_label(self, c, page, size):
        c.setFillColorRGB(0, 0, 0)
        c.setFont("DejaVu", 8)
        word = "Página" if self.lang == "es" else "Page"
        c.drawString(24, size[1] - 18, f"{word} {page}")
        c.setFont("DejaVu", 7)
        footer = "Documento sintético de ejercicio. Sin patrocinador." if self.lang == "es" else "Synthetic exercise document. No sponsor."
        c.drawString(24, 16, footer)
        c.drawRightString(size[0] - 24, 16, f"{page}/{self.n_pages}")


def draw_prose(doc, index):
    paras = PROSE_ES if doc.lang == "es" else PROSE_EN

    def drawer(c, page, size):
        doc.page_label(c, page, size)
        y = size[1] - 40
        width = size[0] - 72
        text = paras[index % len(paras)]
        text = f"{text} Bloque {index + 1}."
        c.setFont("DejaVu", 10)
        for line in wrap(text, "DejaVu", 10, width) * 18:
            if y < 40:
                break
            c.drawString(36, y, line)
            y -= 14

    return drawer


def draw_cover(doc):
    def drawer(c, page, size):
        doc.page_label(c, page, size)
        c.setFont("DejaVuBold", 16)
        title = f"Documento sintético {doc.fixture}" if doc.lang == "es" else f"Synthetic document {doc.fixture}"
        c.drawString(48, size[1] - 120, title)
        c.setFont("DejaVu", 11)
        lines = (
            [
                "Ejercicio de lectura de una grilla de evaluaciones.",
                "Sin patrocinador. Sin fármaco. Sin código de estudio.",
                "Producto en estudio (PE). Comparador (CMP).",
                "Brazos A y B. Ramas de rescate R1 y R2.",
            ]
            if doc.lang == "es"
            else [
                "Exercise for reading an assessment grid.",
                "No sponsor. No drug. No study code.",
                "Study product (PE). Comparator (CMP).",
                "Arms A and B. Rescue branches R1 and R2.",
            ]
        )
        y = size[1] - 160
        for line in lines:
            c.drawString(48, y, line)
            y -= 18

    return drawer


def draw_synopsis(doc, grid_page_getter):
    def drawer(c, page, size):
        doc.page_label(c, page, size)
        c.setFont("DejaVuBold", 14)
        c.drawString(48, size[1] - 80, "Sinopsis" if doc.lang == "es" else "Synopsis")
        c.setFont("DejaVu", 11)
        if doc.lang == "es":
            sentence = (
                f"La sinopsis remite al {SECTION_ES} (página {grid_page_getter()}) "
                "para el detalle de las evaluaciones. Esta oración no es la grilla."
            )
        else:
            sentence = (
                f"The synopsis refers to the {SECTION_EN} (page {grid_page_getter()}) "
                "for the timing of evaluations. This sentence is not the grid."
            )
        y = size[1] - 120
        for line in wrap(sentence, "DejaVu", 11, size[0] - 96):
            c.drawString(48, y, line)
            y -= 16
        # Las reglas con página de sinopsis se imprimen acá. No se les cambia
        # la página: draw_rules, si existe, la asigna cuando corre después.
        y -= 10
        c.setFont("DejaVu", 10)
        for rule in doc.rules:
            for line in wrap(rule["text"], "DejaVu", 10, size[0] - 96):
                if y < 48:
                    break
                c.drawString(48, y, line)
                y -= 14
            y -= 6

    return drawer


def draw_index(doc, entries_getter):
    def drawer(c, page, size):
        doc.page_label(c, page, size)
        c.setFont("DejaVuBold", 14)
        c.drawString(48, size[1] - 80, "Índice" if doc.lang == "es" else "Contents")
        y = size[1] - 120
        for title, target in entries_getter():
            leaders(c, 48, y, title, target, size[0] - 96)
            y -= 22

    return drawer


def draw_tables_list(doc, entries_getter):
    def drawer(c, page, size):
        doc.page_label(c, page, size)
        c.setFont("DejaVuBold", 14)
        c.drawString(48, size[1] - 80, "Lista de tablas" if doc.lang == "es" else "List of tables")
        y = size[1] - 110
        c.setFont("DejaVu", 11)
        locator = SECTION_ES if doc.lang == "es" else SECTION_EN
        c.drawString(48, y, locator)
        y -= 22
        for title, target in entries_getter():
            c.drawString(48, y, f"{title}    {target}")
            y -= 20

    return drawer


def draw_abbreviations(doc, part):
    rows = [
        "PE: producto en estudio. Etiqueta genérica.",
        "CMP: comparador. Etiqueta genérica.",
        "PK: muestra sintética de farmacocinética.",
        "PRO: cuestionario inventado PRO-1 a PRO-6.",
        "R1 y R2: ramas de rescate.",
        "X1 a X12: analitos inventados.",
        "B-1 a B-3: biomarcadores inventados.",
        "I-1: imagen inventada.",
    ]

    def drawer(c, page, size):
        doc.page_label(c, page, size)
        c.setFont("DejaVuBold", 14)
        c.drawString(48, size[1] - 70, f"Abreviaturas ({part + 1}/2)")
        y = size[1] - 110
        c.setFont("DejaVu", 11)
        block = rows if part == 0 else rows[::-1]
        for line in block:
            c.drawString(48, y, line)
            y -= 22
        y -= 10
        for line in wrap(PROSE_ES[part % len(PROSE_ES)], "DejaVu", 10, size[0] - 96) * 8:
            if y < 40:
                break
            c.drawString(48, y, line)
            y -= 14

    return drawer


def draw_rules(doc, rules, prose_index):
    def drawer(c, page, size):
        doc.page_label(c, page, size)
        for rule in rules:
            rule["page"] = page
            for item in rule["conditions"]:
                item["page"] = page
        c.setFont("DejaVuBold", 13)
        heading = "Reglas fuera de la grilla" if doc.lang == "es" else "Rules outside the grid"
        c.drawString(40, size[1] - 48, heading)
        y = size[1] - 80
        c.setFont("DejaVu", 10)
        for rule in rules:
            for line in wrap(rule["text"], "DejaVu", 10, size[0] - 80):
                c.drawString(40, y, line)
                y -= 14
            y -= 8
        for line in wrap(PROSE_ES[prose_index % len(PROSE_ES)] if doc.lang == "es" else PROSE_EN[prose_index % len(PROSE_EN)], "DejaVu", 10, size[0] - 80) * 12:
            if y < 40:
                break
            c.drawString(40, y, line)
            y -= 14

    return drawer


def draw_notes(doc, notes, heading):
    def drawer(c, page, size):
        doc.page_label(c, page, size)
        for note in notes:
            note["page"] = page
            for item in note["conditions"]:
                item["page"] = page
        c.setFont("DejaVuBold", 12)
        c.drawString(36, size[1] - 46, heading)
        y = size[1] - 72
        width = size[0] - 72
        c.setFont("DejaVu", 9)
        if doc.note_carry:
            intro = "Continúa la nota anterior: " if doc.lang == "es" else "Previous footnote continues: "
            for line in wrap(intro + doc.note_carry, "DejaVu", 9, width):
                if y < 48:
                    break
                c.drawString(36, y, line)
                y -= 12
            y -= 8
            doc.note_carry = None
        for note in notes:
            note["page"] = page
            for item in note["conditions"]:
                item["page"] = page
            lines = wrap(f"{note['ref']}  {note['text']}", "DejaVu", 9, width)
            for line in lines:
                if y < 36:
                    break
                c.drawString(36, y, line)
                y -= 12
            if note.get("spill"):
                # El texto sigue en la página de comentarios que viene después.
                # La página de oro queda en el arranque de la nota.
                doc.note_carry = note["text"]
                for line in wrap(note["text"], "DejaVu", 9, width)[:4]:
                    if y < 48:
                        break
                    c.drawString(36, y, line)
                    y -= 12
            y -= 6

    return drawer


def pattern_mark(fixture, table_index, row, col):
    if fixture == "F1":
        return "x" if (row + col) % 2 == 0 else None
    if fixture == "F2":
        return "x" if (row * 3 + col) % 5 < 2 else None
    if fixture == "F3":
        return "x" if (row + col) % 3 == 0 else None
    if fixture == "F4":
        return "x" if (row + col) % 2 == 0 else None
    if fixture == "F5":
        return "x" if (row * 3 + col) % 7 < 3 else None
    return None


def build_grid(fixture, table_index, rows, visits):
    grid = [[None for _ in visits] for _ in rows]
    cells = []
    for r, proc in enumerate(rows):
        if proc["kind"] != "procedure":
            continue
        for c, vis in enumerate(visits):
            mark = pattern_mark(fixture, table_index, r, c)
            if not mark:
                continue
            cell = {
                "visitKey": vis["key"],
                "procedureKey": proc["key"],
                "mark": mark,
                "noteRefs": [],
                "conditions": [],
                "procedureWindow": None,
                "page": None,
                "bbox": None,
                "confidence": 1,
                "reviewed": False,
            }
            grid[r][c] = cell
            cells.append(cell)
    return grid, cells


def set_cell(grid, cells, row, col, rows, visits, mark, conditions=None, procedure_window=None):
    current = grid[row][col]
    if mark is None:
        if current is not None:
            cells.remove(current)
            grid[row][col] = None
        return
    if current is None:
        current = {
            "visitKey": visits[col]["key"],
            "procedureKey": rows[row]["key"],
            "mark": mark,
            "noteRefs": [],
            "conditions": [],
            "procedureWindow": None,
            "page": None,
            "bbox": None,
            "confidence": 1,
            "reviewed": False,
        }
        grid[row][col] = current
        cells.append(current)
    current["mark"] = mark
    if conditions is not None:
        current["conditions"] = conditions
    if procedure_window is not None:
        current["procedureWindow"] = procedure_window


def copy_row(grid, cells, src, dst, rows, visits):
    for col in range(len(visits)):
        source = grid[src][col]
        if source is None:
            set_cell(grid, cells, dst, col, rows, visits, None)
            continue
        set_cell(
            grid, cells, dst, col, rows, visits, source["mark"],
            conditions=[dict(item) for item in source["conditions"]],
            procedure_window=dict(source["procedureWindow"]) if source["procedureWindow"] else None,
        )


def attach_notes(grid, notes, row_offset=0):
    cursor = 0
    flat = []
    for r, row in enumerate(grid):
        for c, cell in enumerate(row):
            if cell is not None and cell["mark"] != "prn_range":
                flat.append((r, c, cell))
    for note in notes:
        if cursor >= len(flat):
            break
        _r, _c, cell = flat[cursor]
        cell["noteRefs"].append(note["ref"])
        note["row"] = _r
        cursor += 1


def make_notes(table_key, count, lang, refs=None, templates=None):
    bank = templates or (NOTE_ES if lang == "es" else NOTE_EN)
    notes = []
    for i in range(count):
        ref = refs[i] if refs else str(i + 1)
        text = bank[i % len(bank)]
        kind = "arm" if "brazo" in text or "Arm" in text else "dose_timing" if "dosis" in text or "dose" in text else "fasting" if "ayun" in text.lower() or "Fasting" in text else "population"
        notes.append({
            "ref": ref,
            "tableKey": table_key,
            "text": text,
            "page": None,
            "conditions": [cond(kind, text)],
            "placement": "after",
            "row": None,
            "spill": False,
        })
    return notes


def window_groups_from_visits(visits, groups):
    """groups: list of (start, end, window, text, split)."""
    parsed = []
    for start, end, window, text, split in groups:
        for index in range(start, end):
            visits[index]["window"] = window
        parsed.append({"start": start, "end": end, "window": window, "text": text, "split": split})
    return parsed


def draw_grid_slice(doc, table, sl):
    def drawer(c, page, size):
        doc.page_label(c, page, size)
        pw, ph = size
        margin = 22
        top = ph - 32
        c.setFont("DejaVuBold", 8)
        c.drawString(margin, top, table["sectionTitle"])
        c.setFont("DejaVu", 7)
        c.drawString(margin, top - 11, table["title"])
        y = top - 18
        visits = table["visits"]
        rows = table["rows"]
        grid = table["grid"]
        n_vis = sl["c1"] - sl["c0"]
        show_comments = bool(table.get("commentW")) and sl["c0"] == 0
        proc_w = table["procW"]
        comment_w = table["commentW"] if show_comments else 0
        usable = pw - 2 * margin - proc_w - comment_w
        vw = usable / max(n_vis, 1)
        comment_x = margin + proc_w + n_vis * vw

        def vx(local):
            return margin + proc_w + local * vw

        def band(height, painter):
            nonlocal y
            bottom = y - height
            if bottom < 28:
                raise SystemExit(f"{doc.fixture} {table['key']} página {page}: la banda no entra ({bottom})")
            painter(y, bottom, height)
            y = bottom

        def shade_col(local, top_y, bottom_y):
            absolute = sl["c0"] + local
            if absolute not in table["shaded"]:
                return
            c.setFillColorRGB(0.86, 0.86, 0.86)
            c.rect(vx(local), bottom_y, vw, top_y - bottom_y, fill=1, stroke=0)
            c.setFillColorRGB(0, 0, 0)

        def stroke_cell(x, bottom_y, w, h):
            if table["bordered"]:
                c.setStrokeColorRGB(0.35, 0.35, 0.35)
                c.setLineWidth(0.3)
                c.rect(x, bottom_y, w, h, fill=0, stroke=1)

        if table.get("levels") and sl["c0"] == 0:
            def paint_levels(top_y, bottom_y, height):
                c.setFillColorRGB(0.93, 0.93, 0.93)
                for label, a, b in table["levels"]:
                    vis_a, vis_b = max(a, sl["c0"]), min(b, sl["c1"])
                    if vis_a >= vis_b:
                        continue
                    x0, x1 = vx(vis_a - sl["c0"]), vx(vis_b - sl["c0"])
                    c.rect(x0, bottom_y, x1 - x0, height, fill=1, stroke=0)
                    c.setFillColorRGB(0, 0, 0)
                    c.setFont("DejaVuBold", 6)
                    c.drawCentredString((x0 + x1) / 2, bottom_y + 3, label)
                    if b - a > 1:
                        doc.difficulty["mergedCells"] += 1
                    stroke_cell(x0, bottom_y, x1 - x0, height)
                c.setFillColorRGB(0, 0, 0)
            band(12, paint_levels)

        def paint_ids(top_y, bottom_y, height):
            for local, absolute in enumerate(range(sl["c0"], sl["c1"])):
                vis = visits[absolute]
                shade_col(local, top_y, bottom_y)
                stroke_cell(vx(local), bottom_y, vw, height)
                c.setFillColorRGB(0, 0, 0)
                printed = vis["printedId"] if vis["printedId"] else "—"
                c.setFont("DejaVu", 6)
                if vis.get("splitHeader"):
                    parts = vis["splitHeader"]
                    c.drawString(vx(local) + 1, bottom_y + 8, parts[0])
                    c.drawString(vx(local) + 1, bottom_y + 1, parts[1])
                    doc.difficulty["splitTokens"] += 1
                else:
                    lines = wrap(printed, "DejaVu", 6, vw - 2)[:2]
                    for i, line in enumerate(lines):
                        c.drawCentredString(vx(local) + vw / 2, bottom_y + 8 - i * 7, line)
                if vis["page"] is None:
                    vis["page"] = page
                    vis["bbox"] = [round(vx(local), 2), round(bottom_y, 2), round(vx(local) + vw, 2), round(top_y, 2)]
        band(20, paint_ids)

        def paint_timing(top_y, bottom_y, height):
            for local, absolute in enumerate(range(sl["c0"], sl["c1"])):
                shade_col(local, top_y, bottom_y)
                stroke_cell(vx(local), bottom_y, vw, height)
                vis = visits[absolute]
                value = vis["timing"]["value"]
                unit = vis["timing"]["unit"]
                label = "evt" if vis["timing"]["kind"] == "event" or value is None else f"{value}{unit[0] if unit else ''}"
                c.setFont("DejaVu", 5)
                c.drawCentredString(vx(local) + vw / 2, bottom_y + 2, label)
        band(11, paint_timing)

        def paint_windows(top_y, bottom_y, height):
            c.setFont("DejaVu", 6)
            label = table.get("windowLabel") or ("Ventana" if doc.lang == "es" else "Visit window")
            c.drawString(margin + 1, bottom_y + 2, label[:18])
            for group in table["windowGroups"]:
                a, b = group["start"], group["end"]
                vis_a, vis_b = max(a, sl["c0"]), min(b, sl["c1"])
                if vis_a >= vis_b:
                    continue
                x0, x1 = vx(vis_a - sl["c0"]), vx(vis_b - sl["c0"])
                c.setFillColorRGB(0.95, 0.95, 0.9)
                c.rect(x0, bottom_y, x1 - x0, height, fill=1, stroke=0)
                c.setFillColorRGB(0, 0, 0)
                stroke_cell(x0, bottom_y, x1 - x0, height)
                if a >= sl["c0"] and a < sl["c1"]:
                    if group["split"]:
                        parts = ["Hast", "a", "42", "d"]
                        step = (x1 - x0) / len(parts)
                        for i, part in enumerate(parts):
                            c.setFont("DejaVu", 5)
                            c.drawString(x0 + i * step + 1, bottom_y + 2, part)
                        doc.difficulty["splitTokens"] += 1
                    else:
                        c.setFont("DejaVu", 6)
                        c.drawCentredString((x0 + x1) / 2, bottom_y + 2, group["text"])
                    if b - a > 1:
                        doc.difficulty["mergedCells"] += 1
        band(12, paint_windows)

        for attr in table.get("attributes", []):
            def paint_attr(top_y, bottom_y, height, attr=attr):
                c.setFont("DejaVu", 6)
                c.drawString(margin + 1, bottom_y + 2, attr["label"][:22])
                for local, absolute in enumerate(range(sl["c0"], sl["c1"])):
                    shade_col(local, top_y, bottom_y)
                    stroke_cell(vx(local), bottom_y, vw, height)
                    value = attr["values"][absolute]
                    if not value:
                        continue
                    c.setFont("DejaVu", 6)
                    c.drawCentredString(vx(local) + vw / 2, bottom_y + 2, value)
            band(12, paint_attr)

        row_h = table["rowH"]
        for row_index in range(sl["r0"], sl["r1"]):
            proc = rows[row_index]

            def paint_row(top_y, bottom_y, height, row_index=row_index, proc=proc):
                stroke_cell(margin, bottom_y, proc_w, height)
                c.setFillColorRGB(0, 0, 0)
                c.setFont("DejaVu", 6)
                label_lines = wrap(proc["label"], "DejaVu", 6, proc_w - 8)[:2]
                for i, line in enumerate(label_lines):
                    c.drawString(margin + 2, bottom_y + 3 + (len(label_lines) - 1 - i) * 7, line)
                if proc["page"] is None:
                    proc["page"] = page
                    proc["bbox"] = [round(margin, 2), round(bottom_y, 2), round(margin + proc_w, 2), round(top_y, 2)]
                # Corridas "según necesidad": una sola cadena sobre el rango visible.
                run = []

                def flush(run):
                    if not run:
                        return
                    x0 = vx(run[0] - sl["c0"])
                    x1 = vx(run[-1] - sl["c0"]) + vw
                    phrase = "según necesidad" if doc.lang == "es" else "as needed"
                    c.setFont("DejaVu", 6)
                    c.drawCentredString((x0 + x1) / 2, bottom_y + 3, phrase)
                    if len(run) > 1:
                        doc.difficulty["mergedCells"] += 1
                    for absolute in run:
                        cell = grid[row_index][absolute]
                        local = absolute - sl["c0"]
                        cell["page"] = page
                        cell["bbox"] = [round(vx(local), 2), round(bottom_y, 2), round(vx(local) + vw, 2), round(top_y, 2)]

                for local, absolute in enumerate(range(sl["c0"], sl["c1"])):
                    shade_col(local, top_y, bottom_y)
                    stroke_cell(vx(local), bottom_y, vw, height)
                    cell = grid[row_index][absolute]
                    if cell is not None and cell["mark"] == "prn_range":
                        run.append(absolute)
                        continue
                    flush(run)
                    run = []
                    if cell is None:
                        continue
                    c.setFillColorRGB(0, 0, 0)
                    shifted = absolute in table["shaded"]
                    baseline = top_y - 3 if shifted else bottom_y + 3
                    c.setFont("DejaVu", 7)
                    c.drawCentredString(vx(local) + vw / 2, baseline, "X")
                    if cell["noteRefs"]:
                        c.setFont("DejaVu", 4.5)
                        c.drawString(vx(local) + vw / 2 + 4, baseline + 4, cell["noteRefs"][0])
                    cell["page"] = page
                    cell["bbox"] = [round(vx(local), 2), round(bottom_y, 2), round(vx(local) + vw, 2), round(top_y, 2)]
                flush(run)
                if show_comments:
                    stroke_cell(comment_x, bottom_y, comment_w, height)
                    comment = table.get("commentByRow", {}).get(row_index)
                    if comment:
                        c.setFont("DejaVu", 5)
                        snippet = wrap(comment, "DejaVu", 5, comment_w - 4)[:2]
                        for i, line in enumerate(snippet):
                            c.drawString(comment_x + 2, bottom_y + 3 + i * 6, line)
            band(row_h, paint_row)

        if sl.get("narrative"):
            for nar in table.get("narratives", []):
                proc = nar["procedure"]
                a, b = nar["c0"], nar["c1"]
                vis_a, vis_b = max(a, sl["c0"]), min(b, sl["c1"])
                if vis_a >= vis_b:
                    continue

                def paint_nar(top_y, bottom_y, height, proc=proc, vis_a=vis_a, vis_b=vis_b, nar=nar):
                    x0, x1 = vx(vis_a - sl["c0"]), vx(vis_b - sl["c0"])
                    c.setFillColorRGB(0.94, 0.94, 0.94)
                    c.rect(x0, bottom_y, x1 - x0, height, fill=1, stroke=0)
                    c.setFillColorRGB(0, 0, 0)
                    stroke_cell(x0, bottom_y, x1 - x0, height)
                    c.setFont("DejaVu", 6)
                    c.drawCentredString((x0 + x1) / 2, bottom_y + 4, nar["text"][:80])
                    if proc["page"] is None:
                        proc["page"] = page
                        proc["bbox"] = [round(x0, 2), round(bottom_y, 2), round(x1, 2), round(top_y, 2)]
                    if vis_b - vis_a > 1:
                        doc.difficulty["mergedCells"] += 1
                band(14, paint_nar)

        last = table["slices"][-1]
        continues = (sl["r0"], sl["r1"], sl["c0"], sl["c1"]) != (last["r0"], last["r1"], last["c0"], last["c1"])
        if continues:
            c.setFillColorRGB(0, 0, 0)
            c.setFont("DejaVu", 7)
            phrase = "Continúa en la página siguiente" if doc.lang == "es" else "Continued on the next page"
            c.drawString(margin, 26, phrase)

        for note in table.get("notes", []):
            if note.get("placement") == "comment" and sl["r0"] <= (note.get("row") or -1) < sl["r1"] and sl["c0"] == 0:
                note["page"] = page

    return drawer


def add_table(doc, table):
    pages = []
    for sl in table["slices"]:
        size = LANDSCAPE if table["landscape"] else PORTRAIT
        page = doc.add(draw_grid_slice(doc, table, sl), size, "grid")
        pages.append(page)
        if table.get("rotateFirst") and len(pages) == 1:
            doc.rotate_pages.append(page)
            doc.difficulty["rotatedPages"] = 1
    table["pages"] = pages
    doc.tables.append(table)
    doc.difficulty["shadedColumns"] += len(table["shaded"])
    doc.difficulty["unnumberedColumns"] += sum(1 for vis in table["visits"] if vis["printedId"] is None)
    return pages


def slice_plan(n_rows, sizes, n_cols, split_first=False, narrative_on_first=False):
    slices, row = [], 0
    for index, size in enumerate(sizes):
        if index == 0 and split_first:
            # 19 columnas: 0–9 y después 10–18.
            mid = max(1, (n_cols + 1) // 2)
            slices.append({"r0": row, "r1": row + size, "c0": 0, "c1": mid, "narrative": narrative_on_first})
            slices.append({"r0": row, "r1": row + size, "c0": mid, "c1": n_cols, "narrative": False})
        else:
            slices.append({"r0": row, "r1": row + size, "c0": 0, "c1": n_cols, "narrative": narrative_on_first and index == 0 and not split_first})
        row += size
    if row != n_rows:
        raise SystemExit(f"plan de filas {row} != {n_rows}")
    return slices


def even_sizes(n_rows, n_pages):
    base, extra = divmod(n_rows, n_pages)
    return [base + (1 if i < extra else 0) for i in range(n_pages)]


def new_table(key, title, branch, phase, section, visits, rows, groups, fixture, table_index, landscape, bordered, shaded, slices, window_label=None, attributes=None, narratives=None, comment_w=0, levels=None, rotate_first=False, proc_w=120, row_h=16):
    grid, cells = build_grid(fixture, table_index, rows, visits)
    window_groups_from_visits(visits, groups)
    return {
        "key": key,
        "title": title,
        "branch": branch,
        "phase": phase,
        "sectionTitle": section,
        "visits": visits,
        "rows": rows,
        "grid": grid,
        "cells": cells,
        "windowGroups": [{"start": a, "end": b, "text": text, "split": split} for a, b, _w, text, split in groups],
        "landscape": landscape,
        "bordered": bordered,
        "shaded": set(shaded),
        "slices": slices,
        "windowLabel": window_label,
        "attributes": attributes or [],
        "narratives": narratives or [],
        "commentW": comment_w,
        "commentByRow": {},
        "levels": levels,
        "rotateFirst": rotate_first,
        "procW": proc_w,
        "rowH": row_h,
        "notes": [],
        "pages": [],
        "outcome": "complete",
        "reasons": [],
    }


def pad(doc, prose_start):
    index = prose_start
    while len(doc.items) < doc.n_pages:
        doc.add(draw_prose(doc, index), PORTRAIT, "prose")
        index += 1
    if len(doc.items) != doc.n_pages:
        raise SystemExit(f"{doc.fixture}: {len(doc.items)} páginas, se esperaban {doc.n_pages}")


def render(doc):
    buf = io.BytesIO()
    first = doc.items[0]["size"]
    c = canvas.Canvas(buf, pagesize=first, invariant=1, pageCompression=0)
    c.setTitle(f"Documento sintetico {doc.fixture}")
    c.setAuthor("Generador sintetico SOA")
    for index, item in enumerate(doc.items):
        if index:
            c.showPage()
        c.setPageSize(item["size"])
        item["drawer"](c, item["page"], item["size"])
    c.save()
    raw = buf.getvalue()
    if not doc.rotate_pages:
        return raw
    reader = PdfReader(io.BytesIO(raw))
    writer = PdfWriter()
    for index, page in enumerate(reader.pages, start=1):
        if index in doc.rotate_pages:
            page.rotate(90)
        writer.add_page(page)
    writer.add_metadata({
        "/Title": f"Documento sintetico {doc.fixture}",
        "/Author": "Generador sintetico SOA",
        "/Producer": f"soa-fixtures {VERSION}",
        "/CreationDate": "D:20260101000000Z",
        "/ModDate": "D:20260101000000Z",
    })
    token = ByteStringObject(f"soa-fixtures-{doc.fixture}-{VERSION}".encode("ascii"))
    writer._ID = ArrayObject([token, token])
    out = io.BytesIO()
    writer.write(out)
    return out.getvalue()


def gold_from(doc, extra_procedures):
    procedures = []
    seen = set()
    for table in doc.tables:
        for proc in table["rows"] + [nar["procedure"] for nar in table.get("narratives", [])]:
            if id(proc) in seen:
                continue
            seen.add(id(proc))
            procedures.append(proc)
    for proc in extra_procedures:
        if id(proc) not in seen:
            procedures.append(proc)
    visits, cells = [], []
    for table in doc.tables:
        visits.extend(table["visits"])
        for row in table["grid"]:
            for cell in row:
                if cell is not None:
                    cells.append(cell)
    def source(item):
        return {"page": item["page"], "bbox": item["bbox"]}
    def dump_visit(item):
        return {
            "key": item["key"], "tableKey": next(t["key"] for t in doc.tables if item in t["visits"]),
            "printedId": item["printedId"], "label": item["label"], "timing": item["timing"],
            "window": item["window"], "type": item["type"], "attributes": item["attributes"],
            "page": item["page"], "bbox": item["bbox"], "source": source(item), "confidence": 1,
        }
    def dump_proc(item):
        return {
            "key": item["key"], "label": item["label"], "section": item["section"], "kind": item["kind"],
            "conditions": item["conditions"], "aliases": item["aliases"],
            "page": item["page"], "bbox": item["bbox"], "source": source(item),
        }
    def dump_cell(item):
        return {
            "visitKey": item["visitKey"], "procedureKey": item["procedureKey"], "mark": item["mark"],
            "noteRefs": item["noteRefs"], "conditions": item["conditions"], "procedureWindow": item["procedureWindow"],
            "page": item["page"], "bbox": item["bbox"], "source": source(item),
            "confidence": item["confidence"], "reviewed": item["reviewed"],
        }
    notes = []
    for table in doc.tables:
        notes.extend(table["notes"])
    return {
        "fixture": doc.fixture,
        "seed": doc.seed,
        "generatorVersion": VERSION,
        "document": {
            "pages": doc.n_pages,
            "sopPages": [item["page"] for item in doc.items if item["kind"] == "grid"],
            "falseHitPages": doc.false_hit_pages,
        },
        "tables": [
            {
                "key": table["key"], "title": table["title"], "branch": table["branch"], "phase": table["phase"],
                "pages": table["pages"],
                "notePages": sorted({note["page"] for note in table["notes"] if note.get("page")}),
                "outcome": "complete", "reasons": [],
            }
            for table in doc.tables
        ],
        "visits": [dump_visit(item) for item in visits],
        "procedures": [dump_proc(item) for item in procedures],
        "procedureAliases": [
            {"alias": alias, "procedureKey": proc["key"]}
            for proc in procedures for alias in proc["aliases"]
        ],
        "cells": [dump_cell(item) for item in cells],
        "notes": [
            {"ref": note["ref"], "tableKey": note["tableKey"], "text": note["text"], "page": note["page"], "conditions": note["conditions"]}
            for note in notes
        ],
        "outOfTableRules": doc.rules,
        "inconsistencies": doc.inconsistencies,
        "difficulty": doc.difficulty,
    }


def require_geometry(doc, gold):
    pw = {item["page"]: item["size"] for item in doc.items}
    for bucket in ("visits", "procedures", "cells"):
        for item in gold[bucket]:
            if item.get("kind") == "narrative_rule" and item.get("page") is None:
                raise SystemExit(f"{doc.fixture} narrativa sin página {item.get('key')}")
            if item.get("page") is None or item.get("bbox") is None:
                raise SystemExit(f"{doc.fixture} {bucket} sin geometría {item.get('key') or item.get('visitKey')}")
            size = pw[item["page"]]
            x0, y0, x1, y1 = item["bbox"]
            if not (0 <= x0 < x1 <= size[0] + 0.5 and 0 <= y0 < y1 <= size[1] + 0.5):
                raise SystemExit(f"{doc.fixture} bbox fuera {bucket} {item.get('key')} {item['bbox']} pag {size}")


def build_f1():
    doc = Doc("F1", 1001, 60, "es")
    labels = catalog_es()
    rows1 = make_procedures(labels[:40], "A")
    rows2 = make_procedures(labels[:22], "B")
    rows3 = make_procedures(labels[:18], "C")
    visits1 = []
    ids1 = ["SEL", *[f"V{i}" for i in range(1, 24)], "FA", "FA-SEG"]
    for index, printed in enumerate(ids1):
        if printed == "SEL":
            item = visit(f"T1-C{index:02d}", printed, "Selección", "scheduled", -42, "day", "screening", None)
        elif printed == "FA":
            item = visit(f"T1-C{index:02d}", printed, "Fin", "scheduled", 168, "day", "end_of_study", None)
        elif printed == "FA-SEG":
            item = visit(f"T1-C{index:02d}", printed, "Seguimiento", "recurrent", 12, "week", "follow_up", None, recurrence={"every": 12, "unit": "week", "until": "S104"})
        else:
            number = int(printed[1:])
            vtype = "hybrid" if number in (4, 8, 12, 16) else "standard"
            item = visit(f"T1-C{index:02d}", printed, f"Visita {number}", "scheduled", 1 + (number - 1) * 7, "day", vtype, None)
        if printed == "V12":
            item["splitHeader"] = ["V", "12"]
        visits1.append(item)
    groups1 = [
        (0, 1, W(None, 42, "day"), "Hasta 42 d", True),
        (1, 5, W(2, 2, "day"), "±2 d", False),
        (5, 9, W(7, 7, "day"), "±7 d", False),
        (9, 14, W(14, 14, "day"), "±14 d", False),
        (14, 18, W(7, 7, "day"), "±7 d", False),
        (18, 22, W(14, 14, "day"), "±14 d", False),
        (22, 24, W(7, 7, "day"), "±7 d", False),
        (24, 26, None, "n/c", False),
    ]
    visits2 = [visit("T2-C00", "V1", "Ancla", "scheduled", 1, "day", "standard", None)]
    visits2.append(visit("T2-C01", "FA", "Fin", "scheduled", 168, "day", "end_of_study", None))
    for index in range(1, 13):
        kind = "recurrent" if index == 1 else "scheduled"
        recurrence = {"every": 12, "unit": "week", "until": "S104"} if index == 1 else None
        visits2.append(visit(f"T2-C{index + 1:02d}", f"VR{index}", f"Rescate {index}", kind, 12 * index, "week", "follow_up", None, recurrence=recurrence))
    groups2 = [
        (0, 1, W(2, 2, "day"), "±2 d", False),
        (1, 2, None, "n/c", False),
        (2, 6, W(7, 7, "day"), "±7 d", False),
        (6, 10, W(14, 14, "day"), "±14 d", False),
        (10, 14, W(7, 7, "day"), "±7 d", False),
    ]
    visits3 = [
        visit("T3-C00", "VR1", "Rescate 1", "recurrent", 12, "week", "follow_up", W(7, 7, "day"), recurrence={"every": 12, "unit": "week", "until": "S104"}),
        visit("T3-C01", "VR2", "Rescate 2", "scheduled", 24, "week", "follow_up", W(7, 7, "day")),
        visit("T3-C02", "VR3", "Rescate 3", "scheduled", 36, "week", "follow_up", W(7, 7, "day")),
        visit("T3-C03", "FA", "Fin", "scheduled", 168, "day", "end_of_study", None),
        visit("T3-C04", "FA-SEG", "Seguimiento", "follow_up" and "recurrent", 12, "week", "follow_up", W(14, 14, "day"), recurrence={"every": 12, "unit": "week", "until": "S104"}),
        visit("T3-C05", "V23", "Visita 23", "scheduled", 155, "day", "standard", W(7, 7, "day")),
    ]
    # The expression above for FA-SEG kind is the string "recurrent" because a non-empty string is truthy. Keep it explicit.
    visits3[4]["timing"]["kind"] = "recurrent"
    groups3 = [(i, i + 1, visits3[i]["window"], "n/c" if visits3[i]["window"] is None else "±7 d" if i != 4 else "±14 d", False) for i in range(6)]
    nar1 = procedure("N1", "Administración en el centro", "narrative_rule")
    nar2 = procedure("N2", "La rama de rescate no modifica el fin", "narrative_rule")
    narratives = [
        {"procedure": nar1, "text": "El producto en estudio (PE) o el comparador (CMP) se administra en el centro.", "c0": 0, "c1": 13},
        {"procedure": nar2, "text": "La rama de rescate R1 empieza después del fin de la rama principal.", "c0": 13, "c1": 26},
    ]
    t1 = new_table("T1", "Cronograma de la rama principal", None, "etiqueta abierta", SECTION_ES, visits1, rows1, groups1, "F1", 0, True, True, {24}, slice_plan(40, [4, 12, 12, 12], 26, narrative_on_first=True), narratives=narratives, proc_w=108, row_h=15)
    t2 = new_table("T2", "Cronograma de rescate R1", "Rescate R1", "rescate", SECTION_ES, visits2, rows2, groups2, "F1", 1, True, False, {2, 3, 4, 5}, slice_plan(22, [8, 8, 6], 14), proc_w=108, row_h=15)
    t3 = new_table("T3", "Cronograma de rescate R2", "Rescate R2", "rescate", SECTION_ES, visits3, rows3, groups3, "F1", 2, True, True, set(), slice_plan(18, [10, 8], 6), proc_w=120, row_h=15)
    # Defecto 1: evento adverso en el seguimiento y no en el fin.
    set_cell(t1["grid"], t1["cells"], 5, 24, rows1, visits1, None)
    set_cell(t1["grid"], t1["cells"], 5, 25, rows1, visits1, "x")
    # Condiciones de brazo en la misma columna (V5 = índice 5).
    set_cell(t1["grid"], t1["cells"], 14, 5, rows1, visits1, "x", [cond("arm", "Solo en participantes del brazo A")])
    set_cell(t1["grid"], t1["cells"], 15, 5, rows1, visits1, "x", [cond("arm", "Solo en participantes del brazo B")])
    notes1 = make_notes("T1", 14, "es")
    notes2 = make_notes("T2", 9, "es")
    notes3 = make_notes("T3", 2, "es")
    attach_notes(t1["grid"], notes1)
    attach_notes(t2["grid"], notes2)
    attach_notes(t3["grid"], notes3)
    t1["notes"], t2["notes"], t3["notes"] = notes1, notes2, notes3
    doc.add(draw_cover(doc), PORTRAIT, "cover")
    doc.false_hit_pages.append(doc.add(draw_synopsis(doc, lambda: doc.tables[0]["pages"][0]), PORTRAIT, "false"))
    doc.false_hit_pages.append(doc.add(draw_index(doc, lambda: [(SECTION_ES, doc.tables[0]["pages"][0]), ("Notas de la grilla", t1_note_page[0])]), PORTRAIT, "false"))
    doc.false_hit_pages.append(doc.add(draw_tables_list(doc, lambda: [(f"Tabla {i + 1}. {t['title']}", t["pages"][0]) for i, t in enumerate(doc.tables)]), PORTRAIT, "false"))
    for i in range(16):
        doc.add(draw_prose(doc, i), PORTRAIT, "prose")
    add_table(doc, t1)
    t1_note_page = [doc.add(draw_notes(doc, notes1, "Notas de la rama principal"), PORTRAIT, "notes")]
    add_table(doc, t2)
    doc.add(draw_notes(doc, notes2, "Notas de rescate R1"), PORTRAIT, "notes")
    add_table(doc, t3)
    doc.add(draw_notes(doc, notes3, "Notas de rescate R2"), PORTRAIT, "notes")
    doc.rules = [
        {"text": "La prosa dice que el seguimiento llega hasta S104. La grilla de rescate R1 sigue con VR9 a VR12.", "page": 2, "conditions": [cond("event", "hasta S104", 2)]},
        {"text": "Las visitas híbridas son V4, V8 y V12.", "page": 2, "conditions": [cond("event", "híbridas V4 V8 V12", 2)]},
    ]
    # La sinopsis ya se dibujó; las reglas viven en la página 2, que es la sinopsis.
    # Se imprimen también en la primera página de notas para que el texto exista en el PDF.
    notes1[0]["text"] = "La grilla marca seguimiento después de S104 (VR9 a VR12)."
    doc.inconsistencies = [
        {"kind": "followup_mark_missing_at_end", "description": "Eventos adversos está marcado en FA-SEG y no en FA.", "pages": [], "status": "open", "table": "T1"},
        {"kind": "merged_window_covers_anchor", "description": "En la rama principal la ventana ±2 d cubre V1 junto con V2 a V4. En rescate R1, V1 queda sola.", "pages": [], "status": "open", "table": "T1"},
        {"kind": "hybrid_set_mismatch", "description": "La prosa dice que las visitas híbridas son V4, V8 y V12. La grilla también marca V16.", "pages": [], "status": "open", "table": "T1"},
        {"kind": "prose_vs_table_limit", "description": "La prosa corta el seguimiento en S104. La grilla incluye VR9 a VR12.", "pages": [], "status": "open", "table": "T2"},
    ]
    pad(doc, 100)
    return doc, [nar1, nar2]


def build_f2():
    doc = Doc("F2", 1002, 50, "es")
    labels = catalog_es()
    rows = make_procedures(labels[:55], "D")
    rows1, rows2, rows3 = rows[0:38], rows[0:45], rows[10:55]
    v_t1 = [
        visit("U1-C00", "V600", "Preinclusión", "scheduled", -28, "day", "screening", W(3, 3, "day"), True, True),
        visit("U1-C01", "V1", "Día 1", "scheduled", 1, "day", "standard", W(0, 0, "day"), True, True),
    ]
    v_t2 = []
    for n in range(2, 18):
        v_t2.append(visit(f"U2-C{n:02d}", f"V{n}", f"Visita {n}", "scheduled", n * 7, "day", "standard", W(3, 5, "day"), n % 3 == 0, True))
    v_t2[12]["attributes"]["onSite"] = False  # V14
    v_t3 = []
    for n in range(18, 28):
        v_t3.append(visit(f"U3-C{n:02d}", f"V{n}", f"Visita {n}", "scheduled", n * 7, "day", "standard", W(5, 5, "day"), False, True))
    for week in (12, 24, 36, 48):
        v_t3.append(visit(f"U3-M{week}", f"VME{week}", f"Ciclo semana {week}", "scheduled", week, "week", "standard", W(7, 7, "day"), False, True))
    v_t3.append(visit("U3-DT", "VDT", "Discontinuación", "event", None, None, "early_termination", None, None, True))
    v_t3.append(visit("U3-NP", "VNP", "No programada", "event", None, None, "unscheduled", None, None, False))
    v_t3.append(visit("U3-VF", "VF", "Fin", "event", None, None, "end_of_study", None, None, True))
    g1 = [(0, 1, v_t1[0]["window"], "±3 d", False), (1, 2, v_t1[1]["window"], "0 d", False)]
    g2 = [(i, i + 1, v_t2[i]["window"], "−3/+5 d", False) for i in range(16)]
    g3 = []
    for i, vis in enumerate(v_t3):
        text = "n/c" if vis["window"] is None else "±7 d" if vis["window"]["before"] == 7 else "±5 d"
        g3.append((i, i + 1, vis["window"], text, False))
    attrs2 = [
        {"label": "Ayuno", "values": ["X" if v["attributes"]["fasting"] else "" for v in v_t2]},
        {"label": "Visita a la clínica", "values": ["X" if v["attributes"]["onSite"] else "" for v in v_t2]},
    ]
    attrs3 = [
        {"label": "Ayuno", "values": ["X" if v["attributes"]["fasting"] else "" for v in v_t3]},
        {"label": "Visita a la clínica", "values": ["X" if v["attributes"]["onSite"] else "" for v in v_t3]},
    ]
    t1 = new_table("T1", "Cronograma de preinclusión", None, "preinclusión", SECTION_ES, v_t1, rows1, g1, "F2", 0, False, False, set(), slice_plan(38, [10, 10, 10, 8], 2), attributes=[{"label": "Ayuno", "values": ["X", "X"]}, {"label": "Visita a la clínica", "values": ["X", "X"]}], comment_w=110, proc_w=150, row_h=20)
    t2 = new_table("T2", "Cronograma de tratamiento", "A", "tratamiento", SECTION_ES, v_t2, rows2, g2, "F2", 1, True, True, {12, 13}, slice_plan(45, [7, 7, 7, 6, 6, 6, 6], 16), attributes=attrs2, comment_w=70, proc_w=130, row_h=16)
    t3 = new_table("T3", "Cronograma de extensión", "B", "extensión", SECTION_ES, v_t3, rows3, g3, "F2", 2, True, False, {10, 11, 12, 13}, slice_plan(45, [8, 8, 8, 8, 7, 6], 17), attributes=attrs3, proc_w=120, row_h=14)
    # 8 filas "según necesidad" en rango.
    for row in (20, 21, 22, 23):
        for col in range(len(v_t2)):
            set_cell(t2["grid"], t2["cells"], row, col, rows2, v_t2, "prn_range" if 2 <= col <= 10 else None)
        for col in range(len(v_t3)):
            set_cell(t3["grid"], t3["cells"], row, col, rows3, v_t3, "prn_range" if 4 <= col <= 14 else None)
    # Defecto 5: V14 sin clínica y con laboratorio.
    panel_row = next(i for i, proc in enumerate(rows2) if proc["label"] == "Panel de laboratorio A")
    set_cell(t2["grid"], t2["cells"], panel_row, 12, rows2, v_t2, "x")
    notes = make_notes("T2", 16, "es") + make_notes("T3", 10, "es")
    for note in notes[:16]:
        note["placement"] = "comment"
        note["tableKey"] = "T2"
    for note in notes[16:]:
        note["placement"] = "prose"
        note["tableKey"] = "T3"
    attach_notes(t2["grid"], notes[:16])
    attach_notes(t3["grid"], notes[16:])
    notes[0]["text"] = "El analito X1 se considera alto si es < 10."
    notes[0]["conditions"] = [cond("population", "Analito X1 alto si es < 10")]
    t2["notes"] = notes[:16]
    t3["notes"] = notes[16:]
    t1["notes"] = []
    for note in notes[:16]:
        if note.get("row") is not None:
            t2["commentByRow"][note["row"]] = f"{note['ref']} {note['text']}"
    # La condición vive en Comentarios. Estas filas no traían nota, así que el texto entra.
    def qualify_comment(row_index, kind, expr):
        rows2[row_index]["conditions"] = [cond(kind, expr)]
        current = t2["commentByRow"].get(row_index, "")
        t2["commentByRow"][row_index] = f"{current} {expr}".strip()

    qualify_comment(12, "population", "solo subgrupo X")
    qualify_comment(14, "arm", "solo brazo A")
    qualify_comment(15, "arm", "solo brazo B")
    doc.rules = [
        {"text": "La prosa dice que la regla aplica después de V7.", "page": None, "conditions": [cond("order", "después de V7")]},
        {"text": "El analito X1 se considera alto si es > 10.", "page": None, "conditions": [cond("population", "Analito X1 alto si es > 10")]},
        {"text": "Ciclo de 4 visitas cada 48 semanas: VME12, VME24, VME36 y VME48.", "page": None, "conditions": [cond("event", "ciclo de 4 cada 48 semanas")]},
    ]
    doc.add(draw_cover(doc), PORTRAIT, "cover")
    doc.false_hit_pages.append(doc.add(draw_synopsis(doc, lambda: doc.tables[0]["pages"][0]), PORTRAIT, "false"))
    doc.false_hit_pages.append(doc.add(draw_index(doc, lambda: [(SECTION_ES, doc.tables[0]["pages"][0])]), PORTRAIT, "false"))
    doc.false_hit_pages.append(doc.add(draw_tables_list(doc, lambda: [(f"Tabla {i + 1}. {t['title']}", t["pages"][0]) for i, t in enumerate(doc.tables)]), PORTRAIT, "false"))
    for i, chunk in enumerate((doc.rules[:1], doc.rules[1:2], doc.rules[2:])):
        doc.add(draw_rules(doc, chunk, i), PORTRAIT, "rules")
    for i in range(3):
        doc.add(draw_prose(doc, i), PORTRAIT, "prose")
    add_table(doc, t1)
    add_table(doc, t2)
    add_table(doc, t3)
    doc.add(draw_notes(doc, notes[16:], "Notas de extensión"), PORTRAIT, "notes")
    doc.inconsistencies = [
        {"kind": "onsite_missing_with_lab", "description": "V14 no tiene marca de visita a la clínica y sí tiene panel de laboratorio A.", "pages": [], "status": "open", "table": "T2"},
        {"kind": "reversed_operator", "description": "Una nota dice que el analito X1 es alto si es < 10. La prosa dice si es > 10.", "pages": [], "status": "open", "table": "T2"},
        {"kind": "prose_vs_table_limit", "description": "La prosa dice después de V7. Una nota de la grilla dice después de V8.", "pages": [], "status": "open", "table": "T2"},
        {"kind": "followup_mark_missing_at_end", "description": "VF no repite una marca que sí está en V27.", "pages": [], "status": "open", "table": "T3"},
    ]
    # Marca en V27 (índice 9 de T3 = V27) que falta en VF (último).
    set_cell(t3["grid"], t3["cells"], 5, 9, rows3, v_t3, "x")
    set_cell(t3["grid"], t3["cells"], 5, len(v_t3) - 1, rows3, v_t3, None)
    notes[16]["text"] = "La grilla aplica la regla después de V8."
    pad(doc, 20)
    return doc, []


def build_f3():
    doc = Doc("F3", 1003, 90, "es")
    labels = catalog_es()
    rows = make_procedures(labels, "E")
    rows[59]["label"] = rows[18]["label"]
    rows[59]["aliases"] = []
    v1 = []
    for n in range(1, 17):
        v1.append(visit(f"S1-C{n:02d}", f"V{n}", f"Visita {n}", "scheduled", n * 7, "day", "standard", W(3 if n < 6 else 5 if n < 12 else 7, 3 if n < 6 else 5 if n < 12 else 7, "day"), n % 2 == 0, None))
    for i, (vtype, code) in enumerate((("pk_only", "PK"), ("dispense_only", "D"), ("hybrid", "H"))):
        item = visit(f"S1-U{i}", None, f"Sin número {code}", "scheduled", None, None, vtype, None, None, None)
        v1.append(item)
    type_values = []
    for vis in v1:
        type_values.append({"standard": "", "pk_only": "PK", "dispense_only": "D", "hybrid": "H"}[vis["type"]])
    rows1 = rows[:60]
    v2 = []
    for n in range(17, 27):
        vtype = "end_of_study" if n == 26 else "standard"
        v2.append(visit(f"S2-C{n:02d}", f"V{n}", f"Visita {n}", "scheduled", n * 7, "day", vtype, W(5, 5, "day"), False, None))
    v2.append(visit("S2-DT", "DT", "Discontinuación", "event", None, None, "early_termination", None))
    v2.append(visit("S2-800", "V800", "Seguimiento tardío", "scheduled", 800, "day", "follow_up", W(7, 7, "day")))
    rows2 = rows[:47]
    g1 = []
    for i, vis in enumerate(v1):
        if vis["printedId"] is None:
            g1.append((i, i + 1, None, "", False))
        else:
            g1.append((i, i + 1, vis["window"], f"±{vis['window']['before']} d", False))
    g2 = [(0, 2, W(0, 10, "day"), "18–28 d", False)]
    for i in range(2, len(v2)):
        text = "n/c" if v2[i]["window"] is None else f"±{v2[i]['window']['before']} d"
        g2.append((i, i + 1, v2[i]["window"], text, False))
    # V17 y V18 comparten la ventana combinada del grupo.
    levels = [("Días 18 a 28", 0, 2), ("Resto", 2, len(v2))]
    t1 = new_table("T1", "Cronograma partido, parte A", "A", "tratamiento", SECTION_ES, v1, rows1, g1, "F3", 0, True, True, {16, 17, 18}, slice_plan(60, even_sizes(60, 26), 19, split_first=True), attributes=[{"label": "Ayuno", "values": ["X" if v["attributes"]["fasting"] else "" for v in v1]}, {"label": "Tipo (PK/D/H)", "values": type_values}], proc_w=132, row_h=18)
    t2 = new_table("T2", "Cronograma partido, parte B", "B", "seguimiento", SECTION_ES, v2, rows2, g2, "F3", 1, True, True, {10}, slice_plan(47, even_sizes(47, 22), 12), levels=levels, proc_w=132, row_h=16)
    # Ventana propia de un procedimiento, en una celda de banda post-dosis.
    band = next(i for i, proc in enumerate(rows1) if proc["label"].startswith("Entre 1 y 2"))
    set_cell(t1["grid"], t1["cells"], band, 7, rows1, v1, "x", [cond("dose_timing", "Entre 1 y 2 horas después de la dosis")], {"before": 4, "after": 2, "unit": "week"})
    # Filas separadas por brazo.
    set_cell(t1["grid"], t1["cells"], 18, 3, rows1, v1, "x", [cond("arm", "Solo en participantes del brazo A")])
    set_cell(t1["grid"], t1["cells"], 19, 3, rows1, v1, "x", [cond("arm", "Solo en participantes del brazo B")])
    copy_row(t1["grid"], t1["cells"], 18, 59, rows1, v1)
    # Después de copiar la fila 18: el duplicado conserva el rótulo original.
    def qualify_label(index, suffix, kind, expr):
        rows[index]["label"] = f"{rows[index]['label']}{suffix}"
        rows[index]["conditions"] = [cond(kind, expr)]

    qualify_label(14, " — solo brazo A", "arm", "solo brazo A")
    qualify_label(15, " — solo brazo B", "arm", "solo brazo B")
    qualify_label(12, " (solo subgrupo X)", "population", "solo subgrupo X")
    qualify_label(16, " (solo subgrupo X)", "population", "solo subgrupo X")
    v1[17]["attributes"]["armOnly"] = "A"
    v1[3]["attributes"]["armOnly"] = "B"
    # Marca en el seguimiento V800 que falta en el fin V26.
    set_cell(t2["grid"], t2["cells"], 5, 9, rows2, v2, None)
    set_cell(t2["grid"], t2["cells"], 5, 11, rows2, v2, "x")
    notes = make_notes("T1", 27, "es")
    notes[0]["text"] = "Ventana propia: −4/+2 semanas."
    notes[0]["conditions"] = [cond("dose_timing", "Ventana propia: −4/+2 semanas")]
    notes[0]["spill"] = True
    notes[1]["text"] = "La prosa dice después de V7. Esta nota dice después de V8."
    attach_notes(t1["grid"], notes)
    t1["notes"] = notes
    t2["notes"] = []
    doc.rules = [{"text": "La prosa dice que la regla aplica después de V7.", "page": None, "conditions": [cond("order", "después de V7")]}]
    doc.add(draw_cover(doc), PORTRAIT, "cover")
    doc.false_hit_pages.append(doc.add(draw_synopsis(doc, lambda: doc.tables[0]["pages"][0]), PORTRAIT, "false"))
    doc.false_hit_pages.append(doc.add(draw_index(doc, lambda: [(SECTION_ES, doc.tables[0]["pages"][0])]), PORTRAIT, "false"))
    doc.false_hit_pages.append(doc.add(draw_tables_list(doc, lambda: [(f"Tabla {i + 1}. {t['title']}", t["pages"][0]) for i, t in enumerate(doc.tables)]), PORTRAIT, "false"))
    doc.add(draw_abbreviations(doc, 0), PORTRAIT, "abbr")
    doc.add(draw_abbreviations(doc, 1), PORTRAIT, "abbr")
    for i in range(6):
        doc.add(draw_prose(doc, i), PORTRAIT, "prose")
    add_table(doc, t1)
    add_table(doc, t2)
    # Tres páginas de comentarios. La primera nota es larga y se corta.
    doc.add(draw_notes(doc, notes[:9], "Comentarios 1"), PORTRAIT, "notes")
    doc.add(draw_notes(doc, notes[9:18], "Comentarios 2"), PORTRAIT, "notes")
    doc.add(draw_notes(doc, notes[18:], "Comentarios 3"), PORTRAIT, "notes")
    doc.add(draw_rules(doc, doc.rules, 3), PORTRAIT, "rules")
    doc.inconsistencies = [
        {"kind": "duplicated_row", "description": "Panel de laboratorio A está repetido, con las mismas marcas.", "pages": [], "status": "open", "table": "T1"},
        {"kind": "followup_mark_missing_at_end", "description": "Eventos adversos está en V800 y no en V26.", "pages": [], "status": "open", "table": "T2"},
        {"kind": "prose_vs_table_limit", "description": "La prosa dice después de V7. La nota dice después de V8.", "pages": [], "status": "open", "table": "T1"},
    ]
    pad(doc, 40)
    return doc, []


def assemble_f4():
    doc = Doc("F4", 1004, 8, "es")
    rows = make_procedures(catalog_es()[:15], "F")
    visits = [
        visit("Q0", "V0", "Selección", "scheduled", 0, "day", "screening", W(None, 7, "day"), True, True),
        visit("Q1", "V1", "Día 1", "scheduled", 1, "day", "hybrid", W(2, 2, "day"), True, True),
        visit("Q2", "V2", "Día 15", "scheduled", 15, "day", "hybrid", W(3, 3, "day"), False, True),
        visit("Q3", "V3", "Día 29", "scheduled", 29, "day", "hybrid", W(3, 7, "day"), False, True),
        visit("Q4", "V4", "Día 57", "scheduled", 57, "day", "standard", W(7, 7, "day"), False, True),
        visit("Q5", "V5", "Fin", "scheduled", 85, "day", "end_of_study", None, False, True),
    ]
    groups = [(i, i + 1, visits[i]["window"], "n/c" if visits[i]["window"] is None else "±", False) for i in range(6)]
    table = new_table("T1", "Cronograma breve", None, "única", SECTION_ES, visits, rows, groups, "F4", 0, False, True, {5}, slice_plan(15, [8, 7], 6), window_label="Margen de visita", proc_w=150, row_h=16)
    notes = make_notes("T1", 5, "es")
    notes[0]["text"] = "El analito X1 se considera alto si es < 5."
    notes[0]["conditions"] = [cond("population", "Analito X1 alto si es < 5")]
    attach_notes(table["grid"], notes)
    table["notes"] = notes
    doc.rules = [
        {"text": "Las visitas híbridas son V1 y V2.", "page": 2, "conditions": [cond("event", "híbridas V1 V2", 2)]},
        {"text": "El analito X1 se considera alto si es > 5.", "page": 2, "conditions": [cond("population", "Analito X1 alto si es > 5", 2)]},
    ]
    doc.add(draw_cover(doc), PORTRAIT, "cover")
    doc.false_hit_pages.append(doc.add(draw_synopsis(doc, lambda: doc.tables[0]["pages"][0]), PORTRAIT, "false"))
    doc.false_hit_pages.append(doc.add(draw_index(doc, lambda: [(SECTION_ES, doc.tables[0]["pages"][0])]), PORTRAIT, "false"))
    doc.false_hit_pages.append(doc.add(draw_tables_list(doc, lambda: [("Tabla 1. Cronograma breve", doc.tables[0]["pages"][0])]), PORTRAIT, "false"))
    doc.add(draw_prose(doc, 0), PORTRAIT, "prose")
    add_table(doc, table)
    doc.add(draw_notes(doc, notes, "Notas"), PORTRAIT, "notes")
    doc.inconsistencies = [
        {"kind": "hybrid_set_mismatch", "description": "La prosa dice que las visitas híbridas son V1 y V2. La grilla también marca V3.", "pages": [], "status": "open", "table": "T1"},
        {"kind": "reversed_operator", "description": "Una nota dice que el analito X1 es alto si es < 5. La prosa dice si es > 5.", "pages": [], "status": "open", "table": "T1"},
    ]
    if len(doc.items) != 8:
        raise SystemExit(f"F4 armó {len(doc.items)} páginas")
    return doc, []


def build_f5():
    doc = Doc("F5", 1005, 40, "en")
    labels = catalog_en()
    # Misma clave de procedimiento en las dos tablas: el calificador empareja por rótulo.
    rows = make_procedures(labels, "G")
    rows1 = rows[:25]
    rows2 = rows[:20]

    def qualify_en(index, suffix, kind, expr):
        rows[index]["label"] = f"{rows[index]['label']}{suffix}"
        rows[index]["conditions"] = [cond(kind, expr)]

    qualify_en(14, " — arm A only", "arm", "arm A only")
    qualify_en(15, " — arm B only", "arm", "arm B only")
    qualify_en(12, " (subgroup X only)", "population", "subgroup X only")
    specs = [
        ("SCR", "Screening", "scheduled", -14, "day", "screening", W(None, 7, "day")),
        ("D1", "Day 1", "scheduled", 1, "day", "standard", W(1, 1, "day")),
        ("W2", "Week 2", "scheduled", 2, "week", "standard", W(2, 2, "day")),
        ("W4", "Week 4", "scheduled", 4, "week", "standard", W(2, 2, "day")),
        ("W6", "Week 6", "scheduled", 6, "week", "standard", W(3, 3, "day")),
        ("W8", "Week 8", "scheduled", 8, "week", "standard", W(3, 3, "day")),
        ("W12", "Week 12", "scheduled", 12, "week", "standard", W(7, 7, "day")),
        ("W16", "Week 16", "scheduled", 16, "week", "standard", W(7, 7, "day")),
        ("W20", "Week 20", "scheduled", 20, "week", "standard", W(7, 7, "day")),
        ("W24", "Week 24", "scheduled", 24, "week", "standard", W(7, 7, "day")),
        ("ET", "Early termination", "event", None, None, "early_termination", None),
        ("FU", "Follow-up", "scheduled", 28, "week", "follow_up", W(7, 7, "day")),
    ]
    v1 = []
    for i, (printed, label, kind, value, unit, vtype, window) in enumerate(specs):
        v1.append(visit(f"E1-{i:02d}", printed, label, kind, value, unit, vtype, window, None, None))
    v2_specs = [
        ("D1", "Day 1", "scheduled", 1, "day", "pk_only", W(0, 1, "day")),
        ("W2", "Week 2", "scheduled", 2, "week", "pk_only", W(1, 1, "day")),
        ("W4", "Week 4", "scheduled", 4, "week", "pk_only", W(1, 1, "day")),
        ("W8", "Week 8", "scheduled", 8, "week", "pk_only", W(2, 2, "day")),
        ("W12", "Week 12", "scheduled", 12, "week", "standard", W(3, 3, "day")),
        ("W24", "Week 24", "scheduled", 24, "week", "standard", W(7, 7, "day")),
        ("ET", "Early termination", "event", None, None, "early_termination", None),
        ("FU", "Follow-up", "scheduled", 28, "week", "follow_up", W(7, 7, "day")),
    ]
    v2 = [visit(f"E2-{i:02d}", printed, label, kind, value, unit, vtype, window) for i, (printed, label, kind, value, unit, vtype, window) in enumerate(v2_specs)]
    groups1 = [
        (0, 1, v1[0]["window"], "up to 7 d", False),
        (1, 3, W(2, 2, "day"), "±2 d", False),
        (3, 6, W(3, 3, "day"), "±3 d", False),
        (6, 10, W(7, 7, "day"), "±7 d", False),
        (10, 11, None, "n/a", False),
        (11, 12, W(7, 7, "day"), "±7 d", False),
    ]
    for start, end, window, _text, _split in groups1:
        for index in range(start, end):
            v1[index]["window"] = window
    groups2 = [(i, i + 1, v2[i]["window"], "n/a" if v2[i]["window"] is None else "window", False) for i in range(8)]
    levels = [("Treatment period", 0, 4), ("Follow-up period", 4, 8)]
    t1 = new_table("T1", "Main assessment grid", None, "treatment", SECTION_EN, v1, rows1, groups1, "F5", 0, True, False, {1}, slice_plan(25, [7, 6, 6, 6], 12), proc_w=140, row_h=16)
    t2 = new_table("T2", "Pharmacokinetic grid", None, "pk", SECTION_EN, v2, rows2, groups2, "F5", 1, True, True, {0}, slice_plan(20, [10, 10], 8), levels=levels, rotate_first=True, proc_w=140, row_h=16)
    # Marca en FU que falta en ET (adverse events es la fila 5).
    set_cell(t1["grid"], t1["cells"], 5, 10, rows1, v1, None)
    set_cell(t1["grid"], t1["cells"], 5, 11, rows1, v1, "x")
    refs = ["a", "b", "c", "d", "e", "f", "g", "h", "†", "‡"]
    notes = make_notes("T1", 10, "en", refs=refs, templates=NOTE_EN)
    notes[0]["text"] = "The grid applies the rule after W16."
    attach_notes(t1["grid"], notes)
    t1["notes"] = notes
    t2["notes"] = []
    doc.rules = [{"text": "The prose says the rule applies after W12.", "page": 2, "conditions": [cond("order", "after W12", 2)]}]
    doc.add(draw_cover(doc), PORTRAIT, "cover")
    doc.false_hit_pages.append(doc.add(draw_synopsis(doc, lambda: doc.tables[0]["pages"][0]), PORTRAIT, "false"))
    doc.false_hit_pages.append(doc.add(draw_index(doc, lambda: [(SECTION_EN, doc.tables[0]["pages"][0])]), PORTRAIT, "false"))
    doc.false_hit_pages.append(doc.add(draw_tables_list(doc, lambda: [(f"Table {i + 1}. {t['title']}", t["pages"][0]) for i, t in enumerate(doc.tables)]), PORTRAIT, "false"))
    for i in range(10):
        doc.add(draw_prose(doc, i), PORTRAIT, "prose")
    add_table(doc, t1)
    add_table(doc, t2)
    doc.add(draw_notes(doc, notes, "Footnotes"), PORTRAIT, "notes")
    doc.inconsistencies = [
        {"kind": "merged_window_covers_anchor", "description": "Table 1 merges the ±2 d window across D1 and W2. Table 2 gives D1 its own window.", "pages": [], "status": "open", "table": "T1"},
        {"kind": "followup_mark_missing_at_end", "description": "Adverse events is marked at FU and missing at ET.", "pages": [], "status": "open", "table": "T1"},
        {"kind": "prose_vs_table_limit", "description": "The prose says after W12. A footnote says after W16.", "pages": [], "status": "open", "table": "T1"},
    ]
    pad(doc, 30)
    return doc, []


def resolve_inconsistencies(doc):
    for item in doc.inconsistencies:
        key = item.pop("table")
        table = next(t for t in doc.tables if t["key"] == key)
        item["pages"] = [table["pages"][0]]


def check_text(pdf_bytes, doc):
    reader = PdfReader(io.BytesIO(pdf_bytes))
    pages = [(page.extract_text() or "") for page in reader.pages]
    folded = "\n".join(pages).casefold()
    flat = " ".join(folded.split())
    for word in FORBIDDEN:
        if word in folded:
            raise SystemExit(f"{doc.fixture} contiene un término prohibido: {word}")
    needle = "cronograma de actividades" if doc.lang == "es" else "schedule of assessments"
    if needle not in folded:
        raise SystemExit(f"{doc.fixture} no tiene el falso acierto ni el título de la grilla")
    quiet = {"prose", "cover", "abbr", "notes", "rules"}
    for item in doc.items:
        page_text = pages[item["page"] - 1].casefold()
        present = needle in page_text
        if item["kind"] in quiet and present:
            raise SystemExit(f"{doc.fixture} página {item['page']} ({item['kind']}) repite el localizador")
        if item["kind"] in {"false", "grid"} and not present:
            raise SystemExit(f"{doc.fixture} página {item['page']} ({item['kind']}) no tiene el localizador")
    expected = {
        "F1": ("SEL", "Consentimiento informado", "híbridas son V4"),
        "F2": ("V600", "Panel de laboratorio A", "después de V7", "solo brazo A", "solo brazo B", "solo subgrupo X"),
        "F3": ("V800", "Panel de laboratorio A", "después de V7", "solo brazo A", "solo brazo B", "solo subgrupo X"),
        "F4": ("V0", "Consentimiento informado", "híbridas son V1"),
        "F5": ("SCR", "Informed consent", "after W12", "arm A only", "arm B only", "subgroup X only"),
    }
    for token in expected[doc.fixture]:
        if token.casefold() not in flat:
            raise SystemExit(f"{doc.fixture} no muestra {token!r} en la capa de texto")
    if doc.fixture == "F5":
        rotated = [i for i, page in enumerate(reader.pages, start=1) if page.get("/Rotate") == 90]
        if len(rotated) != 1:
            raise SystemExit(f"F5 rotaciones {rotated}")
    return folded


def write_pngs(pdf_path, folder):
    import pypdfium2 as pdfium

    folder.mkdir(parents=True, exist_ok=True)
    doc = pdfium.PdfDocument(str(pdf_path))
    try:
        for index in range(len(doc)):
            page = doc[index]
            bitmap = page.render(scale=1)
            image = bitmap.to_pil()
            image.save(folder / f"pagina-{index + 1}.png")
            bitmap.close()
            page.close()
    finally:
        doc.close()


def emit(doc, extra):
    resolve_inconsistencies(doc)
    pdf = render(doc)
    difficulty = json.loads(json.dumps(doc.difficulty))
    # La segunda pasada vuelve a contar rasgos. La geometría ya quedó fija.
    doc.note_carry = None
    pdf_again = render(doc)
    doc.difficulty = difficulty
    doc.note_carry = None
    if pdf != pdf_again:
        raise SystemExit(f"{doc.fixture} no es determinista")
    gold = gold_from(doc, extra)
    require_geometry(doc, gold)
    check_text(pdf, doc)
    n_cells = len(gold["cells"])
    n_prn = sum(1 for cell in gold["cells"] if cell["mark"] == "prn_range")
    n_grid = len(gold["document"]["sopPages"])
    print(f"{doc.fixture} pages={gold['document']['pages']} grid={n_grid} cells={n_cells} prn={n_prn} notes={len(gold['notes'])} inconsistencies={len(gold['inconsistencies'])} false={gold['document']['falseHitPages']}")
    ranges = {"F1": (700, 760, 9), "F2": (590, 660, 17), "F3": (520, 600, 49), "F4": (40, 50, 2), "F5": (180, 230, 6)}
    lo, hi, grids = ranges[doc.fixture]
    if not (lo <= n_cells <= hi) or n_grid != grids or gold["document"]["pages"] != doc.n_pages:
        raise SystemExit(f"{doc.fixture} fuera de rango cells={n_cells} grid={n_grid}")
    if not (2 <= len(gold["inconsistencies"]) <= 5):
        raise SystemExit(f"{doc.fixture} inconsistencias {len(gold['inconsistencies'])}")
    OUT.mkdir(parents=True, exist_ok=True)
    pdf_path = OUT / f"{doc.fixture}.pdf"
    pdf_path.write_bytes(pdf)
    (OUT / f"{doc.fixture}.gold.json").write_text(json.dumps(gold, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    write_pngs(pdf_path, OUT / f"{doc.fixture}.render")
    return gold


def main():
    requested = sys.argv[1:]
    if requested:
        unknown = [name for name in requested if name not in {"F6", "F6b", "F7", "F8"}]
        if unknown:
            raise SystemExit(f"aparte de F1–F5 solo se generan F6, F6b, F7 y F8; no entiendo {unknown}")
        from f6_f7 import emit_named
        emit_named(requested)
        return
    builders = [build_f1, build_f2, build_f3, assemble_f4, build_f5]
    golds = []
    for builder in builders:
        doc, extra = builder()
        golds.append(emit(doc, extra))
    counts = {
        gold["fixture"]: sum(1 for proc in gold["procedures"] if proc.get("conditions"))
        for gold in golds
        if gold["fixture"] in {"F2", "F3", "F5"}
    }
    total = sum(counts.values())
    if any(counts[name] < 1 for name in ("F2", "F3", "F5")) or not (3 <= total <= 10):
        raise SystemExit(f"filas condicionadas {counts}")
    arms = [
        visit for visit in next(gold for gold in golds if gold["fixture"] == "F3")["visits"]
        if visit["attributes"].get("armOnly")
    ]
    if len(arms) < 2:
        raise SystemExit(f"F3 armOnly {len(arms)}")
    print(f"condiciones {counts} total {total} F3 armOnly {len(arms)}")


if __name__ == "__main__":
    main()
