"""Fixtures sintéticos F6, F6b, F7, F8 y F9. Generador 1.3.0.

F6: encabezado numérico sin prefijo y sin etiqueta en la fila de enteros.
Tres guiones, dos de ellos separados por un solo entero (4 - 5 6 - 7 - 8).
Períodos agrupados arriba y una fila «Día» en otra banda. 22 páginas de
cronograma apaisadas; el encabezado se repite en cada una.

F6b: el mismo F6, con la etiqueta de la fila de enteros. Dos palabras, la
misma fuente que las fichas. El techo de la etiqueta queda 11,5 pt sobre
el techo de las fichas, y el texto queda a la izquierda de la primera.

F7: un solo encabezado de varias líneas. Períodos arriba. Fila de ids de
visita en celdas de dos líneas: las fichas largas partidas (prefijo arriba,
número 9 pt abajo, mismo x) y 5 fichas cortas enteras, centradas en altura.
Etiqueta «Visita» en x = 82, en la línea del número. Primera ficha en
x = 220. Fila de semanas 39 pt abajo, con fichas S… partidas si son largas.
26 columnas, 4 páginas, encabezado repetido. Antes, una página de figura:
21 fichas S… cuyo origen queda a 6 pt del siguiente, sin marcas.

F8: control de dos tablas apiladas de verdad. Hay filas de datos entre los
dos encabezados. El calificador las desempata por geometría.

F9: encabezado mixto en una sola línea de fichas. Etiqueta de 6 letras a
la izquierda, después 10 enteros, 4 fichas con letras (una partida en dos
palabras) y una leyenda larga. Hay marcas en cada columna. La fila de
ventana cubre las columnas y no la etiqueta.

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
F6_CARD_FONT = 7
# El techo que arma pdfjs es baseline + tamaño. Con la misma fuente, subir
# la línea de base 11,5 pt sube el techo 11,5 pt.
F6B_LABEL_RISE = 11.5
F6B_LABEL_WORDS = ("Visita", "número")

# Baselines en espacio de usuario (origen abajo a la izquierda). Las distancias
# son las que midió el Architect: 9 pt entre letras y números, 45 pt entre
# tiras, 6 pt y 18 pt hasta la primera etiqueta de datos.
F8_LETTER_Y = 548.0
F8_LETTER_TO_NUMBER = 9.0
F8_STRIP_GAP = 45.0
F8_DATA_GAP = (6.0, 18.0)
F8_LABEL_X = 82.0
F8_CARD_X = (237.0, 213.0)
F8_PREFIXES = ("V", "W")
F8_COLUMNS = (20, 24)
F8_ROWS = (2, 4)
F8_ROW_PITCH = 14.0
F8_PAGES = 5


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
        require_fit(glyph, "DejaVu", F6_CARD_FONT, vw, "F6 ficha")
    return {
        "left": left,
        "proc_w": proc_w,
        "vw": vw,
        "vx": vx,
        "comment_x": vx(n),
        "right": vx(n) + comment_w,
        "n": n,
    }


def draw_f6_page(doc, table, r0, r1, layout, row_label=None):
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

        # «Día» vive en la banda de abajo. La etiqueta de los enteros, si va,
        # no comparte esa línea: su techo queda 11,5 pt sobre el de las fichas.
        number_y = header_bottom + 3
        day_y = day_bottom + 3
        if abs((number_y - day_y) - F6_DAY_GAP) > 0.01:
            raise SystemExit("F6 la fila Día no queda separada de los enteros")
        left_text(c, "Día", left + 2, day_y, 6)
        center(c, "Comentarios", comment_x, right - comment_x, header_bottom + 4, 6)
        label_record = None
        if row_label is not None:
            size = row_label["fontSize"]
            if size != F6_CARD_FONT:
                raise SystemExit("F6b la etiqueta no usa la fuente de las fichas")
            label_y = number_y + row_label["rise"]
            label_x = left + 2.0
            cursor_x = label_x
            space = pdfmetrics.stringWidth(" ", "DejaVu", size)
            pieces = []
            for index, word in enumerate(row_label["words"]):
                if index:
                    cursor_x += space
                left_text(c, word, cursor_x, label_y, size)
                width = pdfmetrics.stringWidth(word, "DejaVu", size)
                pieces.append({"text": word, "x": round(cursor_x, 2), "width": round(width, 2)})
                cursor_x += width
            if cursor_x >= vx(0) - 1:
                raise SystemExit("F6b la etiqueta pisa la primera ficha")
            label_record = {
                "text": " ".join(row_label["words"]),
                "words": [piece["text"] for piece in pieces],
                "x": round(label_x, 2),
                "baseline": round(label_y, 2),
                "fontSize": size,
                "rise": row_label["rise"],
                "glyphTop": round(label_y + size, 2),
                "bbox": box(label_x, label_y, cursor_x, label_y + size),
            }

        columns = []
        days = []
        for index, value in enumerate(F6_VALUES):
            glyph = "-" if value is None else str(value)
            center(c, glyph, vx(index), vw, number_y, F6_CARD_FONT)
            day = str((index + 1) * 7)
            center(c, day, vx(index), vw, day_y, 6)
            number_box = box(vx(index), header_bottom, vx(index) + vw, header_top)
            columns.append({
                "index": index,
                "glyph": glyph,
                "dash": value is None,
                "text": "—" if value is None else str(value),
                "fontSize": F6_CARD_FONT,
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
                "label": label_record,
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
    return build_numeric("F6", 1006, None)


def build_f6b():
    return build_numeric("F6b", 1009, {
        "words": F6B_LABEL_WORDS,
        "rise": F6B_LABEL_RISE,
        "fontSize": F6_CARD_FONT,
    })


def build_numeric(fixture, seed, row_label):
    if F6_ROWS_PER_PAGE != [2, 6, 5, 4, 3] + [2] * 17:
        raise SystemExit("F6: el plan de filas no es el declarado")
    if sum(F6_ROWS_PER_PAGE) != 54 or len(F6_ROWS_PER_PAGE) != 22:
        raise SystemExit(f"F6 filas {sum(F6_ROWS_PER_PAGE)} páginas {len(F6_ROWS_PER_PAGE)}")
    if any(not 2 <= count <= 6 for count in F6_ROWS_PER_PAGE):
        raise SystemExit("F6: una página se sale de 2 a 6 filas")
    labels = catalog_es()
    rows = make_procedures(labels[:54], fixture)
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
    doc = Doc(fixture, seed, 24, "es")
    doc.tables.append(table)
    layout = f6_layout()
    doc.add(draw_cover(doc), (612.0, 792.0), "cover")
    doc.false_hit_pages.append(doc.add(draw_synopsis(doc, lambda: table["pages"][0]), (612.0, 792.0), "false"))
    cursor = 0
    for count in F6_ROWS_PER_PAGE:
        table["pages"].append(doc.add(
            draw_f6_page(doc, table, cursor, cursor + count, layout, row_label),
            LANDSCAPE,
            "grid",
        ))
        cursor += count
    if len(doc.items) != doc.n_pages:
        raise SystemExit(f"{fixture} páginas {len(doc.items)} != {doc.n_pages}")
    doc.f6_table = table
    return doc, []


def f8_layout(columns, prefix, card_x):
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
        raise SystemExit(f"F8 tira {prefix}: la columna mide {vw:.1f} y el glifo {widest:.1f}")
    col0 = center0 - vw / 2.0
    if card_x - F8_LABEL_X < 130:
        raise SystemExit(f"F8 tira {prefix}: la etiqueta no queda a 130 pt de la ficha")
    if col0 <= F8_LABEL_X + 8:
        raise SystemExit(f"F8 tira {prefix}: la columna de la ficha pisa la etiqueta")

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


def draw_f8_page(doc, slices):
    """slices: (table, r0, r1, prefix, layout, letter_y, data_gap) de arriba a abajo."""

    def drawer(c, page, size):
        paint_title(c, doc, page, size, "Dos tiras. La ficha está partida.")
        for table, r0, r1, prefix, layout, letter_y, data_gap in slices:
            left = layout["left"]
            vw = layout["vw"]
            vx = layout["vx"]
            n = layout["n"]
            right = layout["right"]
            number_y = letter_y - F8_LETTER_TO_NUMBER
            first_data_y = number_y - data_gap
            row_count = r1 - r0
            data = []
            for offset, row_index in enumerate(range(r0, r1)):
                data.append((row_index, first_data_y - offset * F8_ROW_PITCH))
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
            label_width = vx(0) - F8_LABEL_X - 4
            for row_index, baseline in data:
                proc = table["rows"][row_index]
                lines = wrap(proc["label"], "DejaVu", 6, label_width)[:2]
                for i, line in enumerate(lines):
                    left_text(c, line, F8_LABEL_X, baseline - i * 7, 6)
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
                    "dataLabelX": F8_LABEL_X,
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


def build_f8():
    labels = catalog_es()
    rows_a, rows_b = F8_ROWS
    need_a = rows_a * F8_PAGES
    need_b = rows_b * F8_PAGES
    strip_a = make_strip("T1", "Tira de la serie V", "V", F8_COLUMNS[0], labels[:need_a], 0, "1")
    strip_b = make_strip("T2", "Tira de la serie W", "W", F8_COLUMNS[1], labels[need_a:need_a + need_b], 1, "1/")
    layout_a = f8_layout(F8_COLUMNS[0], "V", F8_CARD_X[0])
    layout_b = f8_layout(F8_COLUMNS[1], "W", F8_CARD_X[1])
    for layout in (layout_a, layout_b):
        require_fit("1/", "DejaVu", 9, layout["vw"], "F8 número")
    letter_b = F8_LETTER_Y - F8_STRIP_GAP
    # La segunda fila de la tira 1 tiene que quedar por encima de las letras de la tira 2.
    lowest_a = (F8_LETTER_Y - F8_LETTER_TO_NUMBER - F8_DATA_GAP[0]) - (rows_a - 1) * F8_ROW_PITCH
    if lowest_a - letter_b < 12:
        raise SystemExit(f"F8 la tira 1 pisa a la tira 2 ({lowest_a} vs {letter_b})")
    doc = Doc("F8", 1008, 2 + F8_PAGES, "es")
    doc.tables.extend([strip_a, strip_b])
    doc.add(draw_cover(doc), (612.0, 792.0), "cover")
    doc.false_hit_pages.append(doc.add(draw_synopsis(doc, lambda: strip_a["pages"][0]), (612.0, 792.0), "false"))
    for index in range(F8_PAGES):
        page = doc.add(
            draw_f8_page(doc, [
                (strip_a, index * rows_a, (index + 1) * rows_a, "V", layout_a, F8_LETTER_Y, F8_DATA_GAP[0]),
                (strip_b, index * rows_b, (index + 1) * rows_b, "W", layout_b, letter_b, F8_DATA_GAP[1]),
            ]),
            LANDSCAPE,
            "grid",
        )
        strip_a["pages"].append(page)
        strip_b["pages"].append(page)
    if len(doc.items) != doc.n_pages:
        raise SystemExit(f"F8 páginas {len(doc.items)} != {doc.n_pages}")
    doc.f8_strips = (strip_a, strip_b)
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
        elif item["kind"] == "figure":
            if not width > height:
                raise SystemExit(f"{doc.fixture} figura {index} no está apaisada")
            if locator not in folded:
                raise SystemExit(f"{doc.fixture} figura {index} no tiene el título de la sección")
            item["content"] = page_content(page)
        elif locator in folded:
            raise SystemExit(f"{doc.fixture} página {index} ({item['kind']}) repite el localizador")
    folded = "\n".join(texts).casefold()
    for word in FORBIDDEN:
        if word in folded:
            raise SystemExit(f"{doc.fixture} contiene un término prohibido: {word}")
    return reader


def check_f6(pdf, doc, gold):
    check_numeric(pdf, doc, gold, labeled=False)


def check_f6b(pdf, doc, gold):
    check_numeric(pdf, doc, gold, labeled=True)


def check_numeric(pdf, doc, gold, labeled):
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
    card = pages[0]["columns"][0]
    if labeled:
        label = header["label"]
        if not header["integerRowLabeled"] or label is None:
            raise SystemExit("F6b la fila de enteros no está etiquetada")
        if tuple(label["words"]) != F6B_LABEL_WORDS or label["fontSize"] != card["fontSize"]:
            raise SystemExit("F6b la etiqueta no son dos palabras de la misma fuente")
        close(label["baseline"] - card["baseline"], F6B_LABEL_RISE, "F6b línea de la etiqueta")
        close(label["glyphTop"] - (card["baseline"] + card["fontSize"]), F6B_LABEL_RISE, "F6b techo de la etiqueta")
        if label["bbox"][2] >= card["bbox"][0]:
            raise SystemExit("F6b la etiqueta no queda a la izquierda de la primera ficha")
    elif header["label"] is not None or header["integerRowLabeled"]:
        raise SystemExit("F6 la fila de enteros sigue etiquetada")
    for period in header["periods"]:
        if period["end"] - period["start"] < 2:
            raise SystemExit("F6 período sin agrupar")
    for page in pages:
        if [column["glyph"] for column in page["columns"]] != glyphs:
            raise SystemExit(f"F6 página {page['page']} no repite el encabezado")
        if labeled:
            if page["label"] is None or page["label"]["text"] != header["label"]["text"]:
                raise SystemExit(f"{doc.fixture} página {page['page']} no repite la etiqueta")
        elif page["label"] is not None:
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
            raise SystemExit(f"{doc.fixture} página {item['page']} tiene texto a la izquierda de los enteros")
        if labeled:
            label = gold["header"]["label"]
            # La ó sale por ToUnicode: extract_text la ve, el literal del
            # content stream no. La geometría se mide por la línea de base.
            if any(word not in text for word in label["words"]):
                raise SystemExit(f"F6b página {item['page']} no muestra las dos palabras")
            found = sorted(
                (
                    run for run in runs
                    if abs(run[1] - (header_y + label["rise"])) < 0.05
                    and run[2] == label["fontSize"]
                    and run[0] < header_runs[0][0] - 1
                ),
                key=lambda run: run[0],
            )
            if len(found) != 2 or found[0][3] != label["words"][0]:
                raise SystemExit(f"F6b página {item['page']} la etiqueta no son dos palabras a 11,5 pt")
            close(found[0][0], label["x"], "F6b primera palabra")
            if found[1][0] <= found[0][0]:
                raise SystemExit(f"F6b página {item['page']} las palabras no se leen en orden")
        day_runs = [run for run in numeric if run[1] < header_y - 14 and run[3].isdigit()]
        if not day_runs:
            raise SystemExit(f"F6 página {item['page']} no tiene la fila Día debajo")


def check_f8(pdf, doc, gold):
    check_common(pdf, doc)
    strips = gold["strips"]
    if [strip["visitColumns"] for strip in strips] != [20, 24]:
        raise SystemExit("F8 no tiene tiras de 20 y 24")
    if len(strips[0]["pages"]) < 4:
        raise SystemExit("F8 no llega a 4 páginas")
    pages = [page["page"] for page in strips[0]["pages"]]
    if pages != [page["page"] for page in strips[1]["pages"]] or pages != gold["document"]["sopPages"]:
        raise SystemExit("F8 las dos tiras no comparten las páginas de cronograma")
    expected = (
        (F8_CARD_X[0], F8_DATA_GAP[0], "1"),
        (F8_CARD_X[1], F8_DATA_GAP[1], "1/"),
    )
    for strip, prefix, (card_x, data_gap, first_number) in zip(strips, F8_PREFIXES, expected):
        for page in strip["pages"]:
            if page["headerRows"] != [
                {"role": "prefix", "fontSize": 7, "baseline": page["prefixBaseline"]},
                {"role": "number", "fontSize": 9, "baseline": page["numberBaseline"]},
            ]:
                raise SystemExit("F8 la ficha no está partida en prefijo y número a 9 pt")
            close(page["prefixBaseline"] - page["numberBaseline"], F8_LETTER_TO_NUMBER, "F8 letras a números")
            close(page["numberBaseline"] - page["firstDataBaseline"], data_gap, "F8 números a datos")
            close(page["dataLabelX"], F8_LABEL_X, "F8 etiqueta de datos")
            close(page["cardX"], card_x, "F8 origen de la ficha")
            if page["labelColumn"]["countsAsVisit"]:
                raise SystemExit("F8 la columna de etiquetas cuenta como visita")
            if len(page["columns"]) != strip["visitColumns"]:
                raise SystemExit("F8 columnas distintas del ancho de la tira")
            if page["columns"][0]["number"] != first_number:
                raise SystemExit("F8 la primera ficha no es la pedida")
            for column in page["columns"]:
                if column["prefix"] != prefix or column["numberFontSize"] != 9:
                    raise SystemExit("F8 ficha mal partida")
                if column["printedId"] != f"{prefix}{column['number']}":
                    raise SystemExit("F8 el id no junta prefijo y número")
    close(strips[0]["pages"][0]["prefixBaseline"] - strips[1]["pages"][0]["prefixBaseline"], F8_STRIP_GAP, "F8 entre tiras")
    reader = PdfReader(io.BytesIO(pdf))
    for item in doc.items:
        if item["kind"] != "grid":
            continue
        text = reader.pages[item["page"] - 1].extract_text() or ""
        for banned in ("Serie", "Ficha", "Número de visita"):
            if banned in text:
                raise SystemExit(f"F8 página {item['page']} trae la etiqueta {banned}")
        content = page_content(reader.pages[item["page"] - 1])
        if content.count(b"9 Tf") < 44:
            raise SystemExit(f"F8 página {item['page']} no dibuja los números a 9 pt ({content.count(b'9 Tf')})")
        runs = pdf_runs(content)
        letters = {
            "V": sorted((run for run in runs if run[3] == "V" and run[2] == 7), key=lambda run: run[0]),
            "W": sorted((run for run in runs if run[3] == "W" and run[2] == 7), key=lambda run: run[0]),
        }
        if len(letters["V"]) != 20 or len(letters["W"]) != 24:
            raise SystemExit(f"F8 página {item['page']} no tiene 20 V y 24 W")
        close(letters["V"][0][0], F8_CARD_X[0], f"F8 página {item['page']} x de V")
        close(letters["W"][0][0], F8_CARD_X[1], f"F8 página {item['page']} x de W")
        close(letters["V"][0][1] - letters["W"][0][1], F8_STRIP_GAP, f"F8 página {item['page']} entre tiras")
        for prefix, card_x, data_gap in (("V", F8_CARD_X[0], F8_DATA_GAP[0]), ("W", F8_CARD_X[1], F8_DATA_GAP[1])):
            letter_y = letters[prefix][0][1]
            numbers = [run for run in runs if abs(run[1] - (letter_y - F8_LETTER_TO_NUMBER)) < 0.05 and run[2] == 9]
            if len(numbers) != len(letters[prefix]):
                raise SystemExit(f"F8 página {item['page']} la tira {prefix} no tiene el número 9 pt debajo")
            labels = [run for run in runs if abs(run[0] - F8_LABEL_X) < 0.05 and abs(run[1] - (letter_y - F8_LETTER_TO_NUMBER - data_gap)) < 0.05]
            if not labels:
                raise SystemExit(f"F8 página {item['page']} la tira {prefix} no tiene la etiqueta de datos a {data_gap} pt")
        slash = [run for run in runs if run[3] == "1/" and run[2] == 9]
        if len(slash) != 1 or abs(slash[0][1] - (letters["W"][0][1] - F8_LETTER_TO_NUMBER)) > 0.05:
            raise SystemExit(f"F8 página {item['page']} no tiene el 1/ en la tira 2")


def attach_f6(doc, gold):
    table = doc.f6_table
    pages = table["headerPages"]
    gold["header"] = {
        "kind": "numeric_visit",
        "label": pages[0]["label"],
        "integerRowLabeled": pages[0]["label"] is not None,
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


def attach_f8(doc, gold):
    strips = []
    for table in doc.f8_strips:
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


F7_LABEL_X = 82.0
F7_CARD_X = 220.0
F7_PREFIX_Y = 522.0
F7_LINE_GAP = 9.0
F7_WEEK_GAP = 39.0
F7_PERIOD_GAP = 18.0
F7_COLUMNS = 26
F7_GRID_PAGES = 4
F7_ROWS_PER_PAGE = 4
F7_FIGURE_CARDS = 21
# Paso entre orígenes. Un hueco de 6 pt entre bordes deja 16–21 pt entre
# orígenes, que es lo que midió el Architect y no ejercita el corte de < 10 pt.
F7_FIGURE_STEP = 6.0
F7_SHORT = {0: "V1", 8: "ET", 14: "FA", 20: "VDT", 25: "EOS"}
F7_PERIODS = ((0, 8, "Selección"), (8, 18, "Tratamiento"), (18, 26, "Seguimiento"))


def f7_cards():
    cards = []
    number = 2
    for index in range(F7_COLUMNS):
        short = F7_SHORT.get(index)
        if short is not None:
            cards.append({
                "index": index,
                "printedId": short,
                "split": False,
                "prefix": None,
                "number": None,
            })
            continue
        cards.append({
            "index": index,
            "printedId": f"V{number}",
            "split": True,
            "prefix": "V",
            "number": str(number),
        })
        number += 1
    if len(F7_SHORT) < 4 or len(F7_SHORT) > 5:
        raise SystemExit("F7 tiene que tener 4 o 5 fichas cortas")
    return cards


def f7_weeks():
    weeks = []
    for index in range(F7_COLUMNS):
        text = f"S{index + 1}"
        split = len(text) > 2
        weeks.append({
            "index": index,
            "text": text,
            "split": split,
            "prefix": "S" if split else None,
            "number": text[1:] if split else None,
        })
    return weeks


def f7_layout():
    vw = round((PAGE_W - 16.0 - F7_CARD_X) / F7_COLUMNS, 2)
    widest = max(
        pdfmetrics.stringWidth("VDT", "DejaVu", 8),
        pdfmetrics.stringWidth("22", "DejaVu", 9),
        pdfmetrics.stringWidth("S26", "DejaVu", 8),
    )
    if vw < widest + 1:
        raise SystemExit(f"F7 la columna mide {vw:.1f} y no entra {widest:.1f}")
    if not 213 <= F7_CARD_X <= 237:
        raise SystemExit("F7 la primera ficha sale del rango 213–237")

    def vx(index):
        return F7_CARD_X + index * vw

    return {"vw": vw, "vx": vx, "right": vx(F7_COLUMNS), "left": 70.0}


def draw_f7_figure(doc, cards):
    def drawer(c, page, size):
        paint_title(c, doc, page, size, "Línea de tiempo. Sin grilla.")
        y = 360.0
        x = 48.0
        placed = []
        for card in cards:
            width = pdfmetrics.stringWidth(card, "DejaVu", 8)
            left_text(c, card, x, y, 8)
            placed.append({"text": card, "x": round(x, 2), "y": y, "width": round(width, 2)})
            x += F7_FIGURE_STEP
        if x > size[0] - 24:
            raise SystemExit("F7 la figura no entra en la página")
        doc.f7_figure = {"page": page, "y": y, "gap": F7_FIGURE_STEP, "separation": "origin", "cards": placed}

    return drawer


def draw_f7_page(doc, table, r0, r1, layout, cards, weeks):
    def drawer(c, page, size):
        paint_title(c, doc, page, size, "Encabezado de varias líneas.")
        vw = layout["vw"]
        vx = layout["vx"]
        left = layout["left"]
        right = layout["right"]
        prefix_y = F7_PREFIX_Y
        number_y = prefix_y - F7_LINE_GAP
        short_y = (prefix_y + number_y) / 2.0
        week_y = prefix_y - F7_WEEK_GAP
        week_number_y = week_y - F7_LINE_GAP
        week_short_y = (week_y + week_number_y) / 2.0
        period_y = prefix_y + F7_PERIOD_GAP
        top = period_y + 10
        data = []
        for offset, row_index in enumerate(range(r0, r1)):
            data.append((row_index, week_number_y - 16 - offset * 16))
        bottom = data[-1][1] - 4

        hline(c, left, right, top)
        hline(c, left, right, week_number_y - 8)
        hline(c, left, right, bottom)
        for _row_index, baseline in data:
            hline(c, left, right, baseline + 9)
        vline(c, left, bottom, top)
        for index in range(F7_COLUMNS + 1):
            vline(c, vx(index), bottom, top)

        left_text(c, "Período", F7_LABEL_X, period_y, 7)
        left_text(c, "Visita", F7_LABEL_X, number_y, 7)
        periods = []
        for start, end, label in F7_PERIODS:
            center(c, label, vx(start), vx(end) - vx(start), period_y, 7)
            periods.append({
                "label": label,
                "start": start,
                "end": end,
                "bbox": box(vx(start), period_y - 2, vx(end), period_y + 8),
            })

        columns = []
        for card in cards:
            index = card["index"]
            if card["split"]:
                left_text(c, card["prefix"], vx(index), prefix_y, 7)
                left_text(c, card["number"], vx(index), number_y, 9)
                glyph_x = vx(index)
                card_box = box(vx(index), number_y - 2, vx(index) + vw, prefix_y + 8)
            else:
                center(c, card["printedId"], vx(index), vw, short_y, 8)
                width = pdfmetrics.stringWidth(card["printedId"], "DejaVu", 8)
                glyph_x = vx(index) + (vw - width) / 2.0
                card_box = box(glyph_x, short_y - 2, glyph_x + width, short_y + 8)
            columns.append({
                "index": index,
                "printedId": card["printedId"],
                "split": card["split"],
                "prefix": card["prefix"],
                "number": card["number"],
                "glyphX": round(glyph_x, 2),
                "prefixBaseline": prefix_y if card["split"] else None,
                "numberBaseline": number_y if card["split"] else None,
                "baseline": short_y if not card["split"] else number_y,
                "bbox": card_box,
            })
            vis = table["visits"][index]
            if vis["page"] is None:
                vis["page"] = page
                vis["bbox"] = card_box

        week_columns = []
        for week in weeks:
            index = week["index"]
            if week["split"]:
                left_text(c, week["prefix"], vx(index), week_y, 7)
                left_text(c, week["number"], vx(index), week_number_y, 9)
                glyph_x = vx(index)
            else:
                center(c, week["text"], vx(index), vw, week_short_y, 8)
                width = pdfmetrics.stringWidth(week["text"], "DejaVu", 8)
                glyph_x = vx(index) + (vw - width) / 2.0
            week_columns.append({
                "index": index,
                "text": week["text"],
                "split": week["split"],
                "prefix": week["prefix"],
                "number": week["number"],
                "glyphX": round(glyph_x, 2),
                "prefixBaseline": week_y if week["split"] else None,
                "numberBaseline": week_number_y if week["split"] else None,
                "baseline": week_short_y if not week["split"] else week_y,
            })

        data_rows = []
        label_width = F7_CARD_X - F7_LABEL_X - 6
        for row_index, baseline in data:
            proc = table["rows"][row_index]
            lines = wrap(proc["label"], "DejaVu", 6, label_width)[:2]
            for i, line in enumerate(lines):
                left_text(c, line, F7_LABEL_X, baseline - i * 7, 6)
            row_top = baseline + 8
            row_bottom = baseline - 4
            if proc["page"] is None:
                proc["page"] = page
                proc["bbox"] = box(left, row_bottom, vx(0), row_top)
            for index in range(F7_COLUMNS):
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
                "bbox": box(F7_LABEL_X, row_bottom, right, row_top),
            })

        if not any(item["page"] == page for item in table["headerPages"]):
            table["headerPages"].append({
                "page": page,
                "columns": columns,
                "weeks": week_columns,
                "periods": periods,
                "rows": r1 - r0,
                "label": {"text": "Visita", "x": F7_LABEL_X, "baseline": number_y},
                "periodLabel": {"text": "Período", "x": F7_LABEL_X, "baseline": period_y},
                "labelColumn": {
                    "countsAsVisit": False,
                    "bbox": box(left, bottom, vx(0), top),
                },
                "prefixBaseline": prefix_y,
                "numberBaseline": number_y,
                "shortBaseline": short_y,
                "weekBaseline": week_y,
                "weekNumberBaseline": week_number_y,
                "firstCardX": F7_CARD_X,
                "columnWidth": round(vw, 2),
                "dataRows": data_rows,
            })

    return drawer


def build_f7():
    cards = f7_cards()
    weeks = f7_weeks()
    labels = catalog_es()
    row_count = F7_ROWS_PER_PAGE * F7_GRID_PAGES
    rows = make_procedures(labels[:row_count], "F7")
    visits = []
    for card in cards:
        item = numbered_visit(
            f"T1-C{card['index']:02d}",
            card["printedId"],
            f"Visita {card['printedId']}",
            (card["index"] + 1) * 7,
        )
        visits.append(item)
    grid, cells = new_grid(rows, visits)
    for r in range(len(rows)):
        for col in range(len(visits)):
            if (r + col) % 2 == 0:
                set_cell(grid, cells, r, col, rows, visits, "x")
    table = {
        "key": "T1",
        "title": "Cronograma de varias líneas",
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
    layout = f7_layout()
    doc = Doc("F7", 1007, 2 + F7_GRID_PAGES, "es")
    doc.tables.append(table)
    doc.add(draw_cover(doc), (612.0, 792.0), "cover")
    figure_cards = [f"S{index + 1}" for index in range(F7_FIGURE_CARDS)]
    doc.add(draw_f7_figure(doc, figure_cards), LANDSCAPE, "figure")
    for index in range(F7_GRID_PAGES):
        r0 = index * F7_ROWS_PER_PAGE
        table["pages"].append(doc.add(
            draw_f7_page(doc, table, r0, r0 + F7_ROWS_PER_PAGE, layout, cards, weeks),
            LANDSCAPE,
            "grid",
        ))
    if len(doc.items) != doc.n_pages:
        raise SystemExit(f"F7 páginas {len(doc.items)} != {doc.n_pages}")
    doc.f7_table = table
    doc.f7_cards = cards
    doc.f7_weeks = weeks
    return doc, []


def check_f7(pdf, doc, gold):
    check_common(pdf, doc)
    header = gold["header"]
    if header["visitColumns"] != 26 or len(header["pages"]) != 4:
        raise SystemExit("F7 no tiene 26 columnas en 4 páginas")
    if gold["document"]["sopPages"] != [page["page"] for page in header["pages"]]:
        raise SystemExit("F7 el cronograma no son solo las 4 páginas de grilla")
    figure = gold["figure"]
    if figure["page"] in gold["document"]["sopPages"] or figure["cards"] != 21 or figure["marks"] != 0:
        raise SystemExit("F7 la figura no queda fuera del cronograma")
    if figure["page"] != gold["document"]["sopPages"][0] - 1:
        raise SystemExit("F7 la figura no es la página anterior")
    shorts = [column for column in header["columns"] if not column["split"]]
    splits = [column for column in header["columns"] if column["split"]]
    if not 4 <= len(shorts) <= 5:
        raise SystemExit("F7 no tiene 4 o 5 fichas cortas")
    if header["label"]["text"] != "Visita" or header["label"]["x"] != F7_LABEL_X:
        raise SystemExit("F7 la etiqueta del encabezado no está a la izquierda")
    close(header["label"]["baseline"], header["numberBaseline"], "F7 etiqueta con el número")
    close(header["prefixBaseline"] - header["numberBaseline"], F7_LINE_GAP, "F7 prefijo a número")
    close(header["prefixBaseline"] - header["weekBaseline"], F7_WEEK_GAP, "F7 visitas a semanas")
    close(header["pages"][0]["periodLabel"]["baseline"] - header["prefixBaseline"], F7_PERIOD_GAP, "F7 períodos")
    close(header["firstCardX"], F7_CARD_X, "F7 primera ficha")
    if not 213 <= header["firstCardX"] <= 237:
        raise SystemExit("F7 la primera ficha sale de 213–237")
    for column in splits:
        if column["prefixBaseline"] - column["numberBaseline"] != F7_LINE_GAP:
            raise SystemExit("F7 una ficha larga no está a 9 pt")
        close(
            column["glyphX"],
            header["firstCardX"] + column["index"] * header["columnWidth"],
            "F7 origen de la ficha",
            0.02,
        )
    for column in shorts:
        mid = (header["prefixBaseline"] + header["numberBaseline"]) / 2.0
        close(column["baseline"], mid, "F7 ficha corta")
    long_weeks = [week for week in header["weeks"] if week["split"]]
    whole_weeks = [week for week in header["weeks"] if not week["split"]]
    if not long_weeks:
        raise SystemExit("F7 ninguna semana larga está partida")
    if len(whole_weeks) <= len(shorts):
        raise SystemExit("F7 la fila de semanas no tiene más fichas enteras que la de visitas")
    for week in long_weeks:
        close(week["prefixBaseline"] - week["numberBaseline"], F7_LINE_GAP, "F7 semana partida")
        close(
            week["glyphX"],
            header["firstCardX"] + week["index"] * header["columnWidth"],
            "F7 origen de la semana",
            0.02,
        )
    for page in header["pages"]:
        if [column["printedId"] for column in page["columns"]] != [column["printedId"] for column in header["columns"]]:
            raise SystemExit(f"F7 página {page['page']} no repite el encabezado")
        if page["labelColumn"]["countsAsVisit"]:
            raise SystemExit("F7 la etiqueta cuenta como visita")
    reader = PdfReader(io.BytesIO(pdf))
    figure_page = reader.pages[figure["page"] - 1]
    figure_runs = sorted(
        (run for run in pdf_runs(page_content(figure_page)) if run[3].startswith("S") and run[3][1:].isdigit()),
        key=lambda run: run[0],
    )
    if len(figure_runs) != 21:
        raise SystemExit(f"F7 la figura tiene {len(figure_runs)} fichas S")
    if b"(X)" in page_content(figure_page):
        raise SystemExit("F7 la figura tiene marcas")
    for previous, nxt in zip(figure_runs, figure_runs[1:]):
        close(nxt[0] - previous[0], F7_FIGURE_STEP, "F7 separación de la figura", 0.2)
    for item in doc.items:
        if item["kind"] != "grid":
            continue
        runs = pdf_runs(page_content(reader.pages[item["page"] - 1]))
        letters = [run for run in runs if run[3] == "V" and run[2] == 7]
        numbers = [run for run in runs if run[2] == 9 and run[3].isdigit()]
        if len(letters) < 21:
            raise SystemExit(f"F7 página {item['page']} no repite los prefijos")
        for letter in letters:
            twin = [run for run in numbers if abs(run[0] - letter[0]) <= 1 and abs((letter[1] - run[1]) - F7_LINE_GAP) < 0.05]
            if not twin:
                raise SystemExit(f"F7 página {item['page']} un número no está a 9 pt y ±1 pt de su prefijo")
        label = [run for run in runs if run[3] == "Visita" and abs(run[0] - F7_LABEL_X) < 0.05]
        if not label or abs(label[0][1] - (letters[0][1] - F7_LINE_GAP)) > 0.05:
            raise SystemExit(f"F7 página {item['page']} la etiqueta no va con la línea del número")
        first_id = shorts[0]["printedId"]
        first_card = [run for run in runs if run[3] == first_id and run[2] == 8]
        if not first_card or not 213 <= first_card[0][0] <= 237:
            where = first_card[0][0] if first_card else "ausente"
            raise SystemExit(f"F7 página {item['page']} la primera ficha está en x {where}")
        week_letters = [run for run in runs if run[3] == "S" and run[2] == 7]
        if not week_letters:
            raise SystemExit(f"F7 página {item['page']} no tiene la fila de semanas partida")
        close(letters[0][1] - week_letters[0][1], F7_WEEK_GAP, f"F7 página {item['page']} semanas")


def attach_f7(doc, gold):
    table = doc.f7_table
    pages = table["headerPages"]
    first = pages[0]
    gold["header"] = {
        "kind": "multiline_visit",
        "visitColumns": F7_COLUMNS,
        "columnWidth": first["columnWidth"],
        "repeatedOnEveryGridPage": True,
        "label": first["label"],
        "labelColumnCountsAsVisit": False,
        "periods": [
            {"label": label, "start": start, "end": end}
            for start, end, label in F7_PERIODS
        ],
        "columns": [
            {
                "index": column["index"],
                "printedId": column["printedId"],
                "split": column["split"],
                "prefix": column["prefix"],
                "number": column["number"],
                "glyphX": column["glyphX"],
                "prefixBaseline": column["prefixBaseline"],
                "numberBaseline": column["numberBaseline"],
                "baseline": column["baseline"],
            }
            for column in first["columns"]
        ],
        "weeks": first["weeks"],
        "prefixBaseline": first["prefixBaseline"],
        "numberBaseline": first["numberBaseline"],
        "shortBaseline": first["shortBaseline"],
        "weekBaseline": first["weekBaseline"],
        "weekNumberBaseline": first["weekNumberBaseline"],
        "firstCardX": first["firstCardX"],
        "pages": pages,
    }
    figure = doc.f7_figure
    gold["figure"] = {
        "page": figure["page"],
        "cards": len(figure["cards"]),
        "gap": figure["gap"],
        "separation": figure["separation"],
        "marks": 0,
        "timeline": figure["cards"],
    }
    gold["document"]["figurePages"] = [figure["page"]]


F9_LABEL = "Visita"
F9_LABEL_X = 40.0
F9_CARD_FONT = 8
F9_GRID_PAGES = 2
F9_ROWS_PER_PAGE = 3
F9_CARD_Y = 500.0
F9_WINDOW_GAP = 22.0
F9_ROW_PITCH = 16.0
# Entre las dos palabras de la ficha partida. El lector une textos a 6 pt
# o menos; 2 pt los deja en una sola ficha y no los pega a la vecina.
F9_SPLIT_GAP = 2.0


def f9_cards():
    if len(F9_LABEL) != 6:
        raise SystemExit("F9 la etiqueta no tiene 6 letras")
    cards = [{"printedId": str(n), "parts": [str(n)], "kind": "integer"} for n in range(1, 11)]
    for text in ("ET", "FA", "EOS"):
        cards.append({"printedId": text, "parts": [text], "kind": "letters"})
    cards.append({"printedId": "Fin etapa", "parts": ["Fin", "etapa"], "kind": "split"})
    cards.append({
        "printedId": "Anotacion larga de las fichas",
        "parts": ["Anotacion larga de las fichas"],
        "kind": "legend",
    })
    letters = [card for card in cards if card["kind"] in {"letters", "split"}]
    if len([card for card in cards if card["kind"] == "integer"]) != 10 or len(letters) != 4:
        raise SystemExit("F9 no tiene 10 enteros y 4 fichas con letras")
    if cards[-1]["kind"] != "legend" or sum(1 for card in cards if card["kind"] == "split") != 1:
        raise SystemExit("F9 no cierra con la ficha partida y la leyenda")
    return cards


def f9_text_width(card):
    if card["kind"] == "split":
        return (
            sum(pdfmetrics.stringWidth(part, "DejaVu", F9_CARD_FONT) for part in card["parts"])
            + F9_SPLIT_GAP
        )
    return pdfmetrics.stringWidth(card["printedId"], "DejaVu", F9_CARD_FONT)


def f9_layout(cards):
    pad = 14.0
    widths = [f9_text_width(card) + pad for card in cards]
    card_x = 150.0
    xs = []
    x = card_x
    for width in widths:
        xs.append(x)
        x += width
    right = x
    if right > PAGE_W - 16:
        raise SystemExit(f"F9 no entra en la página: {right:.1f}")
    label_w = pdfmetrics.stringWidth(F9_LABEL, "DejaVu", F9_CARD_FONT)
    if F9_LABEL_X + label_w + 8 >= card_x:
        raise SystemExit("F9 la etiqueta se pega a la primera ficha")
    split = cards[13]
    if f9_text_width(split) + 4 > widths[13]:
        raise SystemExit("F9 la ficha partida no entra en su columna")
    return {
        "cardX": card_x,
        "widths": widths,
        "xs": xs,
        "right": right,
        "left": 28.0,
    }


def draw_f9_page(doc, table, r0, r1, layout, cards):
    def drawer(c, page, size):
        paint_title(c, doc, page, size, "Encabezado mixto.")
        xs = layout["xs"]
        widths = layout["widths"]
        left = layout["left"]
        right = layout["right"]
        card_y = F9_CARD_Y
        window_y = card_y - F9_WINDOW_GAP
        data = [(r0 + offset, window_y - 18 - offset * F9_ROW_PITCH) for offset in range(r1 - r0)]
        top = card_y + 12
        bottom = data[-1][1] - 6

        hline(c, left, right, top)
        hline(c, left, right, card_y - 4)
        hline(c, left, right, window_y + 10)
        hline(c, left, right, window_y - 6)
        for _row_index, baseline in data:
            hline(c, left, right, baseline + 10)
        hline(c, left, right, bottom)
        vline(c, left, bottom, top)
        x = layout["cardX"]
        vline(c, x, bottom, top)
        for width in widths:
            x += width
            vline(c, x, bottom, top)

        left_text(c, F9_LABEL, F9_LABEL_X, card_y, F9_CARD_FONT)
        left_text(c, "Ventana", F9_LABEL_X, window_y, 7)
        columns = []
        for index, card in enumerate(cards):
            glyph_x = xs[index]
            if card["kind"] == "split":
                cursor = glyph_x
                for part_index, part in enumerate(card["parts"]):
                    left_text(c, part, cursor, card_y, F9_CARD_FONT)
                    cursor += pdfmetrics.stringWidth(part, "DejaVu", F9_CARD_FONT)
                    if part_index == 0:
                        cursor += F9_SPLIT_GAP
            else:
                left_text(c, card["printedId"], glyph_x, card_y, F9_CARD_FONT)
            center(c, "3 d", xs[index], widths[index], window_y, 7)
            card_box = box(xs[index], card_y - 2, xs[index] + widths[index], card_y + F9_CARD_FONT)
            columns.append({
                "index": index,
                "printedId": card["printedId"],
                "kind": card["kind"],
                "parts": list(card["parts"]),
                "glyphX": round(glyph_x, 2),
                "baseline": card_y,
                "bbox": card_box,
            })
            vis = table["visits"][index]
            if vis["page"] is None:
                vis["page"] = page
                vis["bbox"] = card_box

        label_width = layout["cardX"] - F9_LABEL_X - 8
        data_rows = []
        for row_index, baseline in data:
            proc = table["rows"][row_index]
            lines = wrap(proc["label"], "DejaVu", 6, label_width)[:2]
            for i, line in enumerate(lines):
                left_text(c, line, F9_LABEL_X, baseline - i * 7, 6)
            row_top = baseline + 9
            row_bottom = baseline - 5
            if proc["page"] is None:
                proc["page"] = page
                proc["bbox"] = box(left, row_bottom, xs[0], row_top)
            for index in range(len(cards)):
                cell = table["grid"][row_index][index]
                cell_box = box(xs[index], row_bottom, xs[index] + widths[index], row_top)
                if cell is None:
                    continue
                center(c, "X", xs[index], widths[index], baseline, 8)
                if cell["page"] is None:
                    cell["page"] = page
                    cell["bbox"] = cell_box
            data_rows.append({
                "procedureKey": proc["key"],
                "baseline": baseline,
                "bbox": box(F9_LABEL_X, row_bottom, right, row_top),
            })

        if any(item["page"] == page for item in table["headerPages"]):
            return
        table["headerPages"].append({
            "page": page,
            "columns": columns,
            "rows": r1 - r0,
            "label": {"text": F9_LABEL, "x": F9_LABEL_X, "baseline": card_y},
            "window": {
                "label": "Ventana",
                "baseline": window_y,
                "coversLabel": False,
                "text": "3 d",
            },
            "labelColumn": {
                "countsAsVisit": False,
                "bbox": box(left, bottom, xs[0], top),
            },
            "cardBaseline": card_y,
            "firstCardX": layout["cardX"],
            "dataRows": data_rows,
        })

    return drawer


def build_f9():
    cards = f9_cards()
    labels = catalog_es()
    row_count = F9_ROWS_PER_PAGE * F9_GRID_PAGES
    rows = make_procedures(labels[:row_count], "F9")
    visits = []
    for card in cards:
        visits.append(numbered_visit(
            f"T1-C{card_index(cards, card):02d}",
            card["printedId"],
            f"Columna {card['printedId']}",
            (card_index(cards, card) + 1) * 7,
        ))
    grid, cells = new_grid(rows, visits)
    for r in range(len(rows)):
        for col in range(len(visits)):
            if (r + col) % 2 == 0:
                set_cell(grid, cells, r, col, rows, visits, "x")
    if any(
        not any(grid[r][col] is not None for r in range(len(rows)))
        for col in range(len(visits))
    ):
        raise SystemExit("F9 hay una columna sin marcas")
    table = {
        "key": "T1",
        "title": "Cronograma de encabezado mixto",
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
    layout = f9_layout(cards)
    doc = Doc("F9", 1010, 1 + F9_GRID_PAGES, "es")
    doc.tables.append(table)
    doc.add(draw_cover(doc), (612.0, 792.0), "cover")
    for index in range(F9_GRID_PAGES):
        r0 = index * F9_ROWS_PER_PAGE
        table["pages"].append(doc.add(
            draw_f9_page(doc, table, r0, r0 + F9_ROWS_PER_PAGE, layout, cards),
            LANDSCAPE,
            "grid",
        ))
    if len(doc.items) != doc.n_pages:
        raise SystemExit(f"F9 páginas {len(doc.items)} != {doc.n_pages}")
    doc.f9_table = table
    doc.f9_cards = cards
    return doc, []


def card_index(cards, card):
    return cards.index(card)


def check_f9(pdf, doc, gold):
    check_common(pdf, doc)
    header = gold["header"]
    if header["kind"] != "mixed" or header["visitColumns"] != 15 or len(header["pages"]) != 2:
        raise SystemExit("F9 no tiene 15 columnas en 2 páginas")
    if gold["document"]["sopPages"] != [page["page"] for page in header["pages"]]:
        raise SystemExit("F9 el cronograma no son solo las páginas de grilla")
    if header["label"]["text"] != F9_LABEL or len(header["label"]["text"]) != 6:
        raise SystemExit("F9 la etiqueta no son 6 letras")
    if header["labelColumnCountsAsVisit"]:
        raise SystemExit("F9 la etiqueta cuenta como visita")
    printed = [column["printedId"] for column in header["columns"]]
    if printed[:10] != [str(n) for n in range(1, 11)] or printed[10:13] != ["ET", "FA", "EOS"]:
        raise SystemExit(f"F9 las fichas no son enteros y luego letras: {printed}")
    split = header["columns"][13]
    legend = header["columns"][14]
    if split["kind"] != "split" or split["parts"] != ["Fin", "etapa"] or legend["kind"] != "legend":
        raise SystemExit("F9 falta la ficha partida o la leyenda")
    close(header["label"]["baseline"], header["cardBaseline"], "F9 etiqueta en la línea de fichas")
    for page in header["pages"]:
        if [column["printedId"] for column in page["columns"]] != printed:
            raise SystemExit(f"F9 página {page['page']} no repite el encabezado")
        if page["window"]["coversLabel"] or page["labelColumn"]["countsAsVisit"]:
            raise SystemExit(f"F9 página {page['page']} la ventana cubre la etiqueta")
    marks_by_column = [0] * 15
    for cell in gold["cells"]:
        visit = next(item for item in gold["visits"] if item["key"] == cell["visitKey"])
        index = int(visit["key"].rsplit("C", 1)[1])
        marks_by_column[index] += 1
    if any(count == 0 for count in marks_by_column):
        raise SystemExit(f"F9 una columna no tiene marcas: {marks_by_column}")
    reader = PdfReader(io.BytesIO(pdf))
    for item in doc.items:
        if item["kind"] != "grid":
            continue
        runs = pdf_runs(page_content(reader.pages[item["page"] - 1]))
        label = [run for run in runs if run[3] == F9_LABEL and abs(run[0] - F9_LABEL_X) < 0.05]
        integers = [run for run in runs if run[3] in {str(n) for n in range(1, 11)} and abs(run[1] - F9_CARD_Y) < 0.05]
        if not label or abs(label[0][1] - F9_CARD_Y) > 0.05:
            raise SystemExit(f"F9 página {item['page']} la etiqueta no está en la línea de fichas")
        if len(integers) != 10:
            raise SystemExit(f"F9 página {item['page']} no tiene los 10 enteros en la línea de fichas")
        fin = [run for run in runs if run[3] == "Fin" and abs(run[1] - F9_CARD_Y) < 0.05]
        etapa = [run for run in runs if run[3] == "etapa" and abs(run[1] - F9_CARD_Y) < 0.05]
        if len(fin) != 1 or len(etapa) != 1:
            raise SystemExit(f"F9 página {item['page']} la ficha partida no está en la línea")
        gap = etapa[0][0] - (fin[0][0] + pdfmetrics.stringWidth("Fin", "DejaVu", F9_CARD_FONT))
        close(gap, F9_SPLIT_GAP, f"F9 página {item['page']} hueco de la ficha partida", 0.4)
        if not any(run[3] == legend["printedId"] and abs(run[1] - F9_CARD_Y) < 0.05 for run in runs):
            raise SystemExit(f"F9 página {item['page']} no tiene la leyenda en la línea de fichas")
        if not any(run[3] == "X" for run in runs):
            raise SystemExit(f"F9 página {item['page']} no tiene marcas")
        label_marks = [
            run for run in runs
            if run[3] == "X" and run[0] < header["firstCardX"] - 1
        ]
        if label_marks:
            raise SystemExit(f"F9 página {item['page']} hay marcas en la columna de la etiqueta")


def attach_f9(doc, gold):
    table = doc.f9_table
    pages = table["headerPages"]
    first = pages[0]
    gold["header"] = {
        "kind": "mixed",
        "visitColumns": len(doc.f9_cards),
        "repeatedOnEveryGridPage": True,
        "label": first["label"],
        "labelColumnCountsAsVisit": False,
        "windowCoversLabel": False,
        "cardBaseline": first["cardBaseline"],
        "firstCardX": first["firstCardX"],
        "columns": [
            {
                "index": column["index"],
                "printedId": column["printedId"],
                "kind": column["kind"],
                "parts": column["parts"],
                "glyphX": column["glyphX"],
                "baseline": column["baseline"],
            }
            for column in first["columns"]
        ],
        "pages": pages,
    }


def emit_named(names):
    builders = {
        "F6": (build_f6, attach_f6, check_f6),
        "F6b": (build_f6b, attach_f6, check_f6b),
        "F7": (build_f7, attach_f7, check_f7),
        "F8": (build_f8, attach_f8, check_f8),
        "F9": (build_f9, attach_f9, check_f9),
    }
    for name in names:
        build, attach, check = builders[name]
        doc, extra = build()
        emit_doc(doc, extra, attach, check)


if __name__ == "__main__":
    import sys
    emit_named(sys.argv[1:] or ["F6", "F6b", "F7", "F8"])
