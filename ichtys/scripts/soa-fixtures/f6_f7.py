"""Fixtures sintéticos F6 y F7. Generador 1.3.0.

F6: encabezado numérico sin prefijo y sin etiqueta en la fila de enteros.
Tres guiones, dos de ellos separados por un solo entero (4 - 5 6 - 7 - 8).
Períodos agrupados arriba y una fila «Día» en otra banda. 22 páginas de
cronograma apaisadas; el encabezado se repite en cada una. Tira de
comentarios a la derecha. 2 a 6 filas de datos por página.

F7: cada página de cronograma trae dos tiras apiladas (20 y 24 columnas).
La ficha está partida: prefijo de letras y, 9 pt debajo, el número a 9 pt.
Sin etiquetas «Serie» ni «Ficha». Etiquetas de datos en x = 82. Las fichas
empiezan en x = 237 y x = 213. 45 pt entre las filas de letras. 6 pt y 18 pt
hasta la primera fila de datos. La primera ficha de la tira 2 es «1/».

Sin patrocinador, sin fármaco y sin protocolo real. No reescribe F1–F5.
"""
from __future__ import annotations

import io
import json
import re

from pypdf import PdfReader
from reportlab.pdfbase import pdfmetrics

from generate import (
    FORBIDDEN,
    LANDSCAPE,
    OUT,
    SECTION_ES,
    W,
    Doc,
    catalog_es,
    draw_cover,
    draw_synopsis,
    gold_from,
    make_procedures,
    render,
    require_geometry,
    set_cell,
    visit,
    wrap,
    write_pngs,
)

VERSION = "1.3.0"
PAGE_W, PAGE_H = LANDSCAPE

# 4 - 5 6 - 7 - 8: tres guiones, y los dos últimos separados por un entero.
F6_VALUES = [1, 2, 3, 4, None, 5, 6, None, 7, None, 8, 9, 10, 11, 12, 13, 14, 15, 16]
F6_PERIODS = ((0, 7, "Selección"), (7, 13, "Tratamiento"), (13, 19, "Seguimiento"))
F6_ROWS_PER_PAGE = [2, 6, 5, 4, 3] + [2] * 17
F6_DAY_GAP = 16.0

# Baselines en espacio de usuario (origen abajo a la izquierda). Las distancias
# son las que midió el Architect: 9 pt entre letras y números, 45 pt entre
# tiras, 6 pt y 18 pt hasta la primera etiqueta de datos.
F7_LETTER_Y = 548.0
F7_LETTER_TO_NUMBER = 9.0
F7_STRIP_GAP = 45.0
F7_DATA_GAP = (6.0, 18.0)
F7_LABEL_X = 82.0
F7_CARD_X = (237.0, 213.0)
F7_PREFIXES = ("V", "W")
F7_COLUMNS = (20, 24)
F7_ROWS = (2, 4)
F7_ROW_PITCH = 14.0
F7_PAGES = 5


def box(x0, y0, x1, y1):
    return [round(x0, 2), round(y0, 2), round(x1, 2), round(y1, 2)]


def require_fit(text, font, size, width, where):
    got = pdfmetrics.stringWidth(text, font, size)
    if got > width - 1:
        raise SystemExit(f"{where}: {text!r} mide {got:.1f} y el hueco es {width:.1f}")


def hline(c, x0, x1, y):
    c.setStrokeColorRGB(0.35, 0.35, 0.35)
    c.setLineWidth(0.4)
    c.line(x0, y, x1, y)


def vline(c, x, y0, y1):
    c.setStrokeColorRGB(0.35, 0.35, 0.35)
    c.setLineWidth(0.4)
    c.line(x, y0, x, y1)


def center(c, text, x, w, baseline, size):
    c.setFillColorRGB(0, 0, 0)
    c.setFont("DejaVu", size)
    c.drawCentredString(x + w / 2.0, baseline, text)


def left_text(c, text, x, baseline, size):
    c.setFillColorRGB(0, 0, 0)
    c.setFont("DejaVu", size)
    c.drawString(x, baseline, text)


def new_grid(rows, visits):
    return [[None for _ in visits] for _ in rows], []


def numbered_visit(key, printed, label, day):
    return visit(key, printed, label, "scheduled", day, "day", "standard", W(3, 3, "day"))


def paint_title(c, doc, page, size, subtitle):
    doc.page_label(c, page, size)
    c.setFillColorRGB(0, 0, 0)
    c.setFont("DejaVuBold", 8)
    c.drawString(18, size[1] - 32, SECTION_ES)
    c.setFont("DejaVu", 7)
    c.drawString(18, size[1] - 42, subtitle)


def f6_layout():
    proc_w, comment_w = 128.0, 64.0
    left = 18.0
    n = len(F6_VALUES)
    usable = PAGE_W - left - 18.0 - proc_w - comment_w
    vw = usable / n
    col_x = left + proc_w

    def vx(index):
        return col_x + index * vw

    for start, end, label in F6_PERIODS:
        require_fit(label, "DejaVu", 6, (end - start) * vw, f"F6 período {label}")
    for value in F6_VALUES:
        glyph = "-" if value is None else str(value)
        require_fit(glyph, "DejaVu", 7, vw, "F6 ficha")
    return {
        "left": left,
        "proc_w": proc_w,
        "vw": vw,
        "vx": vx,
        "comment_x": vx(n),
        "right": vx(n) + comment_w,
        "n": n,
    }


def draw_f6_page(doc, table, r0, r1, layout):
    def drawer(c, page, size):
        paint_title(c, doc, page, size, "Encabezado numérico, períodos agrupados.")
        left = layout["left"]
        proc_w = layout["proc_w"]
        vw = layout["vw"]
        vx = layout["vx"]
        comment_x = layout["comment_x"]
        right = layout["right"]
        n = layout["n"]
        y = size[1] - 52.0

        def band(height):
            nonlocal y
            top = y
            bottom = round(y - height, 2)
            y = bottom
            return top, bottom

        period_top, period_bottom = band(12)
        header_top, header_bottom = band(14)
        day_top, day_bottom = band(F6_DAY_GAP)
        data = []
        for row_index in range(r0, r1):
            top, bottom = band(16)
            data.append((row_index, top, bottom))
        body_bottom = data[-1][2]

        # Períodos: solo los bordes del grupo. Por debajo, una línea por columna.
        for y_line in (period_top, period_bottom, header_bottom, day_bottom, body_bottom):
            hline(c, left, right, y_line)
        for _row_index, top, _bottom in data:
            hline(c, left, right, top)
        vline(c, left, body_bottom, period_top)
        vline(c, left + proc_w, body_bottom, period_top)
        vline(c, right, body_bottom, period_top)
        for start, end, _label in F6_PERIODS:
            vline(c, vx(start), period_bottom, period_top)
            vline(c, vx(end), period_bottom, period_top)
        for index in range(n + 1):
            vline(c, vx(index), body_bottom, period_bottom)
        vline(c, comment_x, body_bottom, period_bottom)

        periods = []
        for start, end, label in F6_PERIODS:
            center(c, label, vx(start), vx(end) - vx(start), period_bottom + 3, 6)
            periods.append({"label": label, "start": start, "end": end, "bbox": box(vx(start), period_bottom, vx(end), period_top)})

        # La fila de enteros no lleva etiqueta. «Día» vive en la banda de abajo.
        number_y = header_bottom + 3
        day_y = day_bottom + 3
        if abs((number_y - day_y) - F6_DAY_GAP) > 0.01:
            raise SystemExit("F6 la fila Día no queda separada de los enteros")
        left_text(c, "Día", left + 2, day_y, 6)
        center(c, "Comentarios", comment_x, right - comment_x, header_bottom + 4, 6)

        columns = []
        days = []
        for index, value in enumerate(F6_VALUES):
            glyph = "-" if value is None else str(value)
            center(c, glyph, vx(index), vw, number_y, 7)
            day = str((index + 1) * 7)
            center(c, day, vx(index), vw, day_y, 6)
            number_box = box(vx(index), header_bottom, vx(index) + vw, header_top)
            columns.append({
                "index": index,
                "glyph": glyph,
                "dash": value is None,
                "text": "—" if value is None else str(value),
                "fontSize": 7,
                "baseline": number_y,
                "bbox": number_box,
            })
            days.append({"index": index, "text": day, "bbox": box(vx(index), day_bottom, vx(index) + vw, day_top)})
            vis = table["visits"][index]
            if vis["page"] is None:
                vis["page"] = page
                vis["bbox"] = number_box

        data_rows = []
        for row_index, top, bottom in data:
            proc = table["rows"][row_index]
            lines = wrap(proc["label"], "DejaVu", 6, proc_w - 6)[:2]
            for i, line in enumerate(lines):
                left_text(c, line, left + 2, bottom + 3 + (len(lines) - 1 - i) * 7, 6)
            if proc["page"] is None:
                proc["page"] = page
                proc["bbox"] = box(left, bottom, left + proc_w, top)
            if (row_index % 2) == 0:
                left_text(c, "ver nota", comment_x + 2, bottom + 4, 6)
            for index in range(n):
                cell = table["grid"][row_index][index]
                cell_box = box(vx(index), bottom, vx(index) + vw, top)
                if cell is None:
                    continue
                center(c, "X", vx(index), vw, bottom + 4, 7)
                if cell["page"] is None:
                    cell["page"] = page
                    cell["bbox"] = cell_box
            data_rows.append({"procedureKey": proc["key"], "bbox": box(left, bottom, vx(n), top)})

        if not any(item["page"] == page for item in table["headerPages"]):
            table["headerPages"].append({
                "page": page,
                "rows": r1 - r0,
                "periods": periods,
                "label": None,
                "labelColumn": {"countsAsVisit": False, "bbox": box(left, body_bottom, left + proc_w, header_top)},
                "columns": columns,
                "timeRow": {
                    "label": "Día",
                    "baseline": day_y,
                    "bbox": box(left, day_bottom, left + proc_w, day_top),
                    "values": days,
                },
                "commentsStrip": {
                    "text": "Comentarios",
                    "countsAsVisit": False,
                    "bbox": box(comment_x, body_bottom, right, header_top),
                },
                "dataRows": data_rows,
            })

    return drawer


def build_f6():
    if F6_ROWS_PER_PAGE != [2, 6, 5, 4, 3] + [2] * 17:
        raise SystemExit("F6: el plan de filas no es el declarado")
    if sum(F6_ROWS_PER_PAGE) != 54 or len(F6_ROWS_PER_PAGE) != 22:
        raise SystemExit(f"F6 filas {sum(F6_ROWS_PER_PAGE)} páginas {len(F6_ROWS_PER_PAGE)}")
    if any(not 2 <= count <= 6 for count in F6_ROWS_PER_PAGE):
        raise SystemExit("F6: una página se sale de 2 a 6 filas")
    labels = catalog_es()
    rows = make_procedures(labels[:54], "F6")
    visits = []
    for index, value in enumerate(F6_VALUES):
        printed = None if value is None else str(value)
        label = "Sin número" if value is None else f"Visita {value}"
        visits.append(numbered_visit(f"T1-C{index:02d}", printed, label, (index + 1) * 7))
    grid, cells = new_grid(rows, visits)
    for r in range(len(rows)):
        for c in range(len(visits)):
            if (r + c) % 2 == 0:
                set_cell(grid, cells, r, c, rows, visits, "x")
    table = {
        "key": "T1",
        "title": "Cronograma numérico",
        "branch": None,
        "phase": "tratamiento",
        "visits": visits,
        "rows": rows,
        "grid": grid,
        "cells": cells,
        "notes": [],
        "narratives": [],
        "pages": [],
        "headerPages": [],
    }
    doc = Doc("F6", 1006, 24, "es")
    doc.tables.append(table)
    layout = f6_layout()
    doc.add(draw_cover(doc), (612.0, 792.0), "cover")
    doc.false_hit_pages.append(doc.add(draw_synopsis(doc, lambda: table["pages"][0]), (612.0, 792.0), "false"))
    cursor = 0
    for count in F6_ROWS_PER_PAGE:
        table["pages"].append(doc.add(draw_f6_page(doc, table, cursor, cursor + count, layout), LANDSCAPE, "grid"))
        cursor += count
    if len(doc.items) != doc.n_pages:
        raise SystemExit(f"F6 páginas {len(doc.items)} != {doc.n_pages}")
    doc.f6_table = table
    return doc, []


def f7_layout(columns, prefix, card_x):
    """La x medida es el origen del glifo, no el centro de la celda."""
    prefix_w = pdfmetrics.stringWidth(prefix, "DejaVu", 7)
    center0 = card_x + prefix_w / 2.0
    widest = max(
        prefix_w,
        pdfmetrics.stringWidth("1/", "DejaVu", 9),
        pdfmetrics.stringWidth(str(columns), "DejaVu", 9),
    )
    max_right = PAGE_W - 16.0
    vw = (max_right - center0) / (columns - 0.5)
    if vw < widest + 2:
        raise SystemExit(f"F7 tira {prefix}: la columna mide {vw:.1f} y el glifo {widest:.1f}")
    col0 = center0 - vw / 2.0
    if card_x - F7_LABEL_X < 130:
        raise SystemExit(f"F7 tira {prefix}: la etiqueta no queda a 130 pt de la ficha")
    if col0 <= F7_LABEL_X + 8:
        raise SystemExit(f"F7 tira {prefix}: la columna de la ficha pisa la etiqueta")

    def vx(index):
        return col0 + index * vw

    return {
        "left": 70.0,
        "vw": vw,
        "vx": vx,
        "right": vx(columns),
        "n": columns,
        "card_x": card_x,
        "prefix_w": prefix_w,
    }


def draw_f7_page(doc, slices):
    """slices: (table, r0, r1, prefix, layout, letter_y, data_gap) de arriba a abajo."""

    def drawer(c, page, size):
        paint_title(c, doc, page, size, "Dos tiras. La ficha está partida.")
        for table, r0, r1, prefix, layout, letter_y, data_gap in slices:
            left = layout["left"]
            vw = layout["vw"]
            vx = layout["vx"]
            n = layout["n"]
            right = layout["right"]
            number_y = letter_y - F7_LETTER_TO_NUMBER
            first_data_y = number_y - data_gap
            row_count = r1 - r0
            data = []
            for offset, row_index in enumerate(range(r0, r1)):
                data.append((row_index, first_data_y - offset * F7_ROW_PITCH))
            last_data_y = data[-1][1]
            top = letter_y + 8
            bottom = last_data_y - 3

            hline(c, left, right, top)
            hline(c, left, right, bottom)
            for _row_index, baseline in data[1:]:
                hline(c, left, right, baseline + 8)
            vline(c, left, bottom, top)
            for index in range(n + 1):
                vline(c, vx(index), bottom, top)

            columns = []
            for index, vis in enumerate(table["visits"]):
                center(c, prefix, vx(index), vw, letter_y, 7)
                center(c, vis["number"], vx(index), vw, number_y, 9)
                prefix_box = box(vx(index), letter_y - 1, vx(index) + vw, letter_y + 8)
                number_box = box(vx(index), number_y - 2, vx(index) + vw, number_y + 8)
                columns.append({
                    "index": index,
                    "prefix": prefix,
                    "number": vis["number"],
                    "printedId": vis["printedId"],
                    "numberFontSize": 9,
                    "malformed": vis["number"] == "1/",
                    "prefixBBox": prefix_box,
                    "numberBBox": number_box,
                    "bbox": number_box,
                })
                if vis["page"] is None:
                    vis["page"] = page
                    vis["bbox"] = number_box

            data_rows = []
            label_width = vx(0) - F7_LABEL_X - 4
            for row_index, baseline in data:
                proc = table["rows"][row_index]
                lines = wrap(proc["label"], "DejaVu", 6, label_width)[:2]
                for i, line in enumerate(lines):
                    left_text(c, line, F7_LABEL_X, baseline - i * 7, 6)
                row_top = baseline + 8
                row_bottom = baseline - 3
                if proc["page"] is None:
                    proc["page"] = page
                    proc["bbox"] = box(left, row_bottom, vx(0), row_top)
                for index in range(n):
                    cell = table["grid"][row_index][index]
                    cell_box = box(vx(index), row_bottom, vx(index) + vw, row_top)
                    if cell is None:
                        continue
                    center(c, "X", vx(index), vw, baseline, 8)
                    if cell["page"] is None:
                        cell["page"] = page
                        cell["bbox"] = cell_box
                data_rows.append({
                    "procedureKey": proc["key"],
                    "baseline": baseline,
                    "bbox": box(left, row_bottom, right, row_top),
                })

            if not any(item["page"] == page for item in table["stripPages"]):
                table["stripPages"].append({
                    "page": page,
                    "visitColumns": n,
                    "rows": row_count,
                    "dataLabelX": F7_LABEL_X,
                    "cardX": layout["card_x"],
                    "prefixBaseline": letter_y,
                    "numberBaseline": number_y,
                    "firstDataBaseline": first_data_y,
                    "labelColumn": {
                        "countsAsVisit": False,
                        "bbox": box(left, bottom, vx(0), top),
                    },
                    "headerRows": [
                        {"role": "prefix", "fontSize": 7, "baseline": letter_y},
                        {"role": "number", "fontSize": 9, "baseline": number_y},
                    ],
                    "prefixRow": {
                        "fontSize": 7,
                        "baseline": letter_y,
                        "bbox": box(vx(0), letter_y - 1, right, letter_y + 8),
                    },
                    "numberRow": {
                        "fontSize": 9,
                        "baseline": number_y,
                        "bbox": box(vx(0), number_y - 2, right, number_y + 8),
                    },
                    "columns": columns,
                    "dataRows": data_rows,
                })

    return drawer


def make_strip(key, title, prefix, columns, labels, mark_shift, first_number):
    rows = make_procedures(labels, key)
    visits = []
    for index in range(columns):
        number = first_number if index == 0 else str(index + 1)
        printed = f"{prefix}{number}"
        item = numbered_visit(f"{key}-C{index:02d}", printed, f"Visita {printed}", (index + 1) * 7)
        item["prefix"] = prefix
        item["number"] = number
        visits.append(item)
    grid, cells = new_grid(rows, visits)
    for r in range(len(rows)):
        for c in range(columns):
            if r == 0 or (r + c + mark_shift) % 3 == 0:
                set_cell(grid, cells, r, c, rows, visits, "x")
    return {
        "key": key,
        "title": title,
        "branch": None,
        "phase": f"serie {prefix}",
        "visits": visits,
        "rows": rows,
        "grid": grid,
        "cells": cells,
        "notes": [],
        "narratives": [],
        "pages": [],
        "stripPages": [],
        "prefix": prefix,
    }


def build_f7():
    labels = catalog_es()
    rows_a, rows_b = F7_ROWS
    need_a = rows_a * F7_PAGES
    need_b = rows_b * F7_PAGES
    strip_a = make_strip("T1", "Tira de la serie V", "V", F7_COLUMNS[0], labels[:need_a], 0, "1")
    strip_b = make_strip("T2", "Tira de la serie W", "W", F7_COLUMNS[1], labels[need_a:need_a + need_b], 1, "1/")
    layout_a = f7_layout(F7_COLUMNS[0], "V", F7_CARD_X[0])
    layout_b = f7_layout(F7_COLUMNS[1], "W", F7_CARD_X[1])
    for layout in (layout_a, layout_b):
        require_fit("1/", "DejaVu", 9, layout["vw"], "F7 número")
    letter_b = F7_LETTER_Y - F7_STRIP_GAP
    # La segunda fila de la tira 1 tiene que quedar por encima de las letras de la tira 2.
    lowest_a = (F7_LETTER_Y - F7_LETTER_TO_NUMBER - F7_DATA_GAP[0]) - (rows_a - 1) * F7_ROW_PITCH
    if lowest_a - letter_b < 12:
        raise SystemExit(f"F7 la tira 1 pisa a la tira 2 ({lowest_a} vs {letter_b})")
    doc = Doc("F7", 1007, 2 + F7_PAGES, "es")
    doc.tables.extend([strip_a, strip_b])
    doc.add(draw_cover(doc), (612.0, 792.0), "cover")
    doc.false_hit_pages.append(doc.add(draw_synopsis(doc, lambda: strip_a["pages"][0]), (612.0, 792.0), "false"))
    for index in range(F7_PAGES):
        page = doc.add(
            draw_f7_page(doc, [
                (strip_a, index * rows_a, (index + 1) * rows_a, "V", layout_a, F7_LETTER_Y, F7_DATA_GAP[0]),
                (strip_b, index * rows_b, (index + 1) * rows_b, "W", layout_b, letter_b, F7_DATA_GAP[1]),
            ]),
            LANDSCAPE,
            "grid",
        )
        strip_a["pages"].append(page)
        strip_b["pages"].append(page)
    if len(doc.items) != doc.n_pages:
        raise SystemExit(f"F7 páginas {len(doc.items)} != {doc.n_pages}")
    doc.f7_strips = (strip_a, strip_b)
    return doc, []


def page_content(page):
    data = page.get_contents()
    if data is None:
        return b""
    parts = data if isinstance(data, list) else [data]
    return b"\n".join(part.get_data() for part in parts)


def pdf_literal(raw):
    out = bytearray()
    i = 0
    while i < len(raw):
        if raw[i] == 0x5C:
            nxt = raw[i + 1:i + 2]
            if nxt.isdigit():
                octal = nxt
                for extra in range(2):
                    if i + 2 + extra < len(raw) and chr(raw[i + 2 + extra]).isdigit():
                        octal += raw[i + 2 + extra:i + 3 + extra]
                    else:
                        break
                out.append(int(octal, 8))
                i += 1 + len(octal)
                continue
            named = {b"n": 10, b"r": 13, b"t": 9, b"b": 8, b"f": 12}
            out.append(named.get(nxt, nxt[0] if nxt else 0))
            i += 2
            continue
        out.append(raw[i])
        i += 1
    return out.decode("latin1")


def pdf_runs(content):
    runs = []
    pattern = re.compile(
        rb"1 0 0 1 ([0-9.]+) ([0-9.]+) Tm /F\S+ ([0-9.]+) Tf [0-9.]+ TL \((.*?)\) Tj"
    )
    for match in pattern.finditer(content):
        x, y, size, raw = match.groups()
        runs.append((float(x), float(y), float(size), pdf_literal(raw)))
    return runs


def close(value, target, where, tol=0.05):
    if abs(value - target) > tol:
        raise SystemExit(f"{where}: medí {value} y tenía que ser {target}")


def check_common(pdf, doc):
    reader = PdfReader(io.BytesIO(pdf))
    if len(reader.pages) != doc.n_pages:
        raise SystemExit(f"{doc.fixture} pdf {len(reader.pages)} != {doc.n_pages}")
    texts = []
    for index, page in enumerate(reader.pages, start=1):
        text = page.extract_text() or ""
        texts.append(text)
        item = doc.items[index - 1]
        width, height = float(page.mediabox.width), float(page.mediabox.height)
        folded = text.casefold()
        locator = "cronograma de actividades"
        if item["kind"] == "grid":
            if not width > height:
                raise SystemExit(f"{doc.fixture} página {index} no está apaisada ({width}×{height})")
            if abs(width - PAGE_W) > 0.5 or abs(height - PAGE_H) > 0.5:
                raise SystemExit(f"{doc.fixture} página {index} mide {width}×{height}")
            if locator not in folded:
                raise SystemExit(f"{doc.fixture} página {index} no tiene el título de la grilla")
            content = page_content(page)
            item["content"] = content
        elif item["kind"] == "false":
            if locator not in folded:
                raise SystemExit(f"{doc.fixture} falso acierto sin localizador")
            if index not in doc.false_hit_pages:
                raise SystemExit(f"{doc.fixture} página {index} es falso acierto y no está en el gold")
        elif locator in folded:
            raise SystemExit(f"{doc.fixture} página {index} ({item['kind']}) repite el localizador")
    folded = "\n".join(texts).casefold()
    for word in FORBIDDEN:
        if word in folded:
            raise SystemExit(f"{doc.fixture} contiene un término prohibido: {word}")
    return reader


def check_f6(pdf, doc, gold):
    check_common(pdf, doc)
    header = gold["header"]
    pages = header["pages"]
    if len(pages) < 20 or len(gold["document"]["sopPages"]) < 20:
        raise SystemExit("F6 no llega a 20 páginas de cronograma")
    glyphs = [column["glyph"] for column in pages[0]["columns"]]
    if glyphs != ["-" if value is None else str(value) for value in F6_VALUES]:
        raise SystemExit(f"F6 fichas {glyphs}")
    integers = [int(column["text"]) for column in pages[0]["columns"] if not column["dash"]]
    dash_at = [column["index"] for column in pages[0]["columns"] if column["dash"]]
    if integers != sorted(set(integers)) or len(integers) < 3 or len(dash_at) < 3:
        raise SystemExit("F6 no tiene enteros crecientes y tres guiones")
    if not any(right - left == 2 for left, right in zip(dash_at, dash_at[1:])):
        raise SystemExit("F6 no tiene dos guiones separados por un solo entero")
    token_text = " ".join("-" if column["dash"] else column["text"] for column in pages[0]["columns"])
    if "4 - 5 6 - 7 - 8" not in token_text:
        raise SystemExit(f"F6 la secuencia no es 4 - 5 6 - 7 - 8: {token_text}")
    if header["label"] is not None or header["integerRowLabeled"]:
        raise SystemExit("F6 la fila de enteros sigue etiquetada")
    for period in header["periods"]:
        if period["end"] - period["start"] < 2:
            raise SystemExit("F6 período sin agrupar")
    for page in pages:
        if [column["glyph"] for column in page["columns"]] != glyphs:
            raise SystemExit(f"F6 página {page['page']} no repite el encabezado")
        if page["label"] is not None:
            raise SystemExit("F6 la fila de enteros tiene etiqueta")
        if page["timeRow"]["label"] != "Día":
            raise SystemExit("F6 perdió la fila Día")
        if page["columns"][0]["baseline"] - page["timeRow"]["baseline"] < 14:
            raise SystemExit("F6 la fila Día cae en la ventana de la fila de enteros")
        if page["labelColumn"]["countsAsVisit"] or page["commentsStrip"]["countsAsVisit"]:
            raise SystemExit("F6 cuenta la etiqueta o los comentarios como visita")
        if not 2 <= page["rows"] <= 6:
            raise SystemExit("F6 filas fuera de 2–6")
    reader = PdfReader(io.BytesIO(pdf))
    for item in doc.items:
        if item["kind"] != "grid":
            continue
        text = reader.pages[item["page"] - 1].extract_text() or ""
        if "Número de visita" in text:
            raise SystemExit(f"F6 página {item['page']} etiqueta la fila de enteros")
        for needle in ("Selección", "Tratamiento", "Seguimiento", "Día"):
            if needle not in text:
                raise SystemExit(f"F6 página {item['page']} no muestra {needle}")
        runs = pdf_runs(page_content(reader.pages[item["page"] - 1]))
        numeric = [run for run in runs if run[3] == "-" or run[3].isdigit()]
        if not numeric:
            raise SystemExit(f"F6 página {item['page']} sin enteros")
        header_y = max(run[1] for run in numeric)
        header_runs = sorted((run for run in numeric if abs(run[1] - header_y) < 0.2), key=lambda run: run[0])
        header_glyphs = [run[3] for run in header_runs]
        if header_glyphs != ["-" if value is None else str(value) for value in F6_VALUES]:
            raise SystemExit(f"F6 página {item['page']} el PDF no repite {header_glyphs}")
        left_of = [run for run in runs if abs(run[1] - header_y) < 0.2 and run[0] < header_runs[0][0] - 1]
        if left_of:
            raise SystemExit(f"F6 página {item['page']} tiene texto a la izquierda de los enteros")
        day_runs = [run for run in numeric if run[1] < header_y - 14 and run[3].isdigit()]
        if not day_runs:
            raise SystemExit(f"F6 página {item['page']} no tiene la fila Día debajo")


def check_f7(pdf, doc, gold):
    check_common(pdf, doc)
    strips = gold["strips"]
    if [strip["visitColumns"] for strip in strips] != [20, 24]:
        raise SystemExit("F7 no tiene tiras de 20 y 24")
    if len(strips[0]["pages"]) < 4:
        raise SystemExit("F7 no llega a 4 páginas")
    pages = [page["page"] for page in strips[0]["pages"]]
    if pages != [page["page"] for page in strips[1]["pages"]] or pages != gold["document"]["sopPages"]:
        raise SystemExit("F7 las dos tiras no comparten las páginas de cronograma")
    expected = (
        (F7_CARD_X[0], F7_DATA_GAP[0], "1"),
        (F7_CARD_X[1], F7_DATA_GAP[1], "1/"),
    )
    for strip, prefix, (card_x, data_gap, first_number) in zip(strips, F7_PREFIXES, expected):
        for page in strip["pages"]:
            if page["headerRows"] != [
                {"role": "prefix", "fontSize": 7, "baseline": page["prefixBaseline"]},
                {"role": "number", "fontSize": 9, "baseline": page["numberBaseline"]},
            ]:
                raise SystemExit("F7 la ficha no está partida en prefijo y número a 9 pt")
            close(page["prefixBaseline"] - page["numberBaseline"], F7_LETTER_TO_NUMBER, "F7 letras a números")
            close(page["numberBaseline"] - page["firstDataBaseline"], data_gap, "F7 números a datos")
            close(page["dataLabelX"], F7_LABEL_X, "F7 etiqueta de datos")
            close(page["cardX"], card_x, "F7 origen de la ficha")
            if page["labelColumn"]["countsAsVisit"]:
                raise SystemExit("F7 la columna de etiquetas cuenta como visita")
            if len(page["columns"]) != strip["visitColumns"]:
                raise SystemExit("F7 columnas distintas del ancho de la tira")
            if page["columns"][0]["number"] != first_number:
                raise SystemExit("F7 la primera ficha no es la pedida")
            for column in page["columns"]:
                if column["prefix"] != prefix or column["numberFontSize"] != 9:
                    raise SystemExit("F7 ficha mal partida")
                if column["printedId"] != f"{prefix}{column['number']}":
                    raise SystemExit("F7 el id no junta prefijo y número")
    close(strips[0]["pages"][0]["prefixBaseline"] - strips[1]["pages"][0]["prefixBaseline"], F7_STRIP_GAP, "F7 entre tiras")
    reader = PdfReader(io.BytesIO(pdf))
    for item in doc.items:
        if item["kind"] != "grid":
            continue
        text = reader.pages[item["page"] - 1].extract_text() or ""
        for banned in ("Serie", "Ficha", "Número de visita"):
            if banned in text:
                raise SystemExit(f"F7 página {item['page']} trae la etiqueta {banned}")
        content = page_content(reader.pages[item["page"] - 1])
        if content.count(b"9 Tf") < 44:
            raise SystemExit(f"F7 página {item['page']} no dibuja los números a 9 pt ({content.count(b'9 Tf')})")
        runs = pdf_runs(content)
        letters = {
            "V": sorted((run for run in runs if run[3] == "V" and run[2] == 7), key=lambda run: run[0]),
            "W": sorted((run for run in runs if run[3] == "W" and run[2] == 7), key=lambda run: run[0]),
        }
        if len(letters["V"]) != 20 or len(letters["W"]) != 24:
            raise SystemExit(f"F7 página {item['page']} no tiene 20 V y 24 W")
        close(letters["V"][0][0], F7_CARD_X[0], f"F7 página {item['page']} x de V")
        close(letters["W"][0][0], F7_CARD_X[1], f"F7 página {item['page']} x de W")
        close(letters["V"][0][1] - letters["W"][0][1], F7_STRIP_GAP, f"F7 página {item['page']} entre tiras")
        for prefix, card_x, data_gap in (("V", F7_CARD_X[0], F7_DATA_GAP[0]), ("W", F7_CARD_X[1], F7_DATA_GAP[1])):
            letter_y = letters[prefix][0][1]
            numbers = [run for run in runs if abs(run[1] - (letter_y - F7_LETTER_TO_NUMBER)) < 0.05 and run[2] == 9]
            if len(numbers) != len(letters[prefix]):
                raise SystemExit(f"F7 página {item['page']} la tira {prefix} no tiene el número 9 pt debajo")
            labels = [run for run in runs if abs(run[0] - F7_LABEL_X) < 0.05 and abs(run[1] - (letter_y - F7_LETTER_TO_NUMBER - data_gap)) < 0.05]
            if not labels:
                raise SystemExit(f"F7 página {item['page']} la tira {prefix} no tiene la etiqueta de datos a {data_gap} pt")
        slash = [run for run in runs if run[3] == "1/" and run[2] == 9]
        if len(slash) != 1 or abs(slash[0][1] - (letters["W"][0][1] - F7_LETTER_TO_NUMBER)) > 0.05:
            raise SystemExit(f"F7 página {item['page']} no tiene el 1/ en la tira 2")


def attach_f6(doc, gold):
    table = doc.f6_table
    pages = table["headerPages"]
    gold["header"] = {
        "kind": "numeric_visit",
        "label": None,
        "integerRowLabeled": False,
        "repeatedOnEveryGridPage": True,
        "rowsPerPage": [page["rows"] for page in pages],
        "tokens": [
            {"index": column["index"], "text": column["text"], "dash": column["dash"], "glyph": column["glyph"]}
            for column in pages[0]["columns"]
        ],
        "periods": [
            {"label": label, "start": start, "end": end}
            for start, end, label in F6_PERIODS
        ],
        "timeRowLabel": "Día",
        "commentsStripCountsAsVisit": False,
        "labelColumnCountsAsVisit": False,
        "pages": pages,
    }


def attach_f7(doc, gold):
    strips = []
    for table in doc.f7_strips:
        strips.append({
            "key": "A" if table["prefix"] == "V" else "B",
            "tableKey": table["key"],
            "prefix": table["prefix"],
            "visitColumns": len(table["visits"]),
            "labelColumnCountsAsVisit": False,
            "repeatedOnEveryGridPage": True,
            "pages": table["stripPages"],
        })
    gold["strips"] = strips


def emit_doc(doc, extra, attach, check):
    pdf = render(doc)
    difficulty = json.loads(json.dumps(doc.difficulty))
    pdf_again = render(doc)
    doc.difficulty = difficulty
    if pdf != pdf_again:
        raise SystemExit(f"{doc.fixture} no es determinista")
    gold = gold_from(doc, extra)
    gold["generatorVersion"] = VERSION
    gold["document"]["gridOrientation"] = "landscape"
    gold["document"]["gridPageSize"] = [PAGE_W, PAGE_H]
    attach(doc, gold)
    require_geometry(doc, gold)
    check(pdf, doc, gold)
    n_cells = len(gold["cells"])
    n_grid = len(gold["document"]["sopPages"])
    print(
        f"{doc.fixture} version={gold['generatorVersion']} pages={gold['document']['pages']} "
        f"grid={n_grid} visits={len(gold['visits'])} cells={n_cells}"
    )
    OUT.mkdir(parents=True, exist_ok=True)
    pdf_path = OUT / f"{doc.fixture}.pdf"
    pdf_path.write_bytes(pdf)
    (OUT / f"{doc.fixture}.gold.json").write_text(
        json.dumps(gold, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    write_pngs(pdf_path, OUT / f"{doc.fixture}.render")
    return gold


def emit_named(names):
    builders = {"F6": (build_f6, attach_f6, check_f6), "F7": (build_f7, attach_f7, check_f7)}
    for name in names:
        build, attach, check = builders[name]
        doc, extra = build()
        emit_doc(doc, extra, attach, check)


if __name__ == "__main__":
    import sys
    emit_named(sys.argv[1:] or ["F6", "F7"])
