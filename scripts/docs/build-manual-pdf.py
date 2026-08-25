"""Browser-free fallback for build-manual-pdf.mjs (ReportLab/Platypus)."""

from __future__ import annotations

import html
import re
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    HRFlowable,
    ListFlowable,
    ListItem,
    LongTable,
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    TableStyle,
)

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "docs" / "USER-MANUAL.md"
OUTPUT = ROOT / "docs" / "user-manual.pdf"

FONT_DIR = Path("/usr/share/fonts/truetype/dejavu")
pdfmetrics.registerFont(TTFont("AegisSans", FONT_DIR / "DejaVuSans.ttf"))
pdfmetrics.registerFont(TTFont("AegisSans-Bold", FONT_DIR / "DejaVuSans-Bold.ttf"))
pdfmetrics.registerFont(TTFont("AegisMono", FONT_DIR / "DejaVuSansMono.ttf"))
pdfmetrics.registerFontFamily("AegisSans", normal="AegisSans", bold="AegisSans-Bold")

base = getSampleStyleSheet()
body = ParagraphStyle(
    "Body",
    parent=base["BodyText"],
    fontName="AegisSans",
    fontSize=8.7,
    leading=12.4,
    textColor=colors.HexColor("#14181f"),
    spaceAfter=5,
)
styles = {
    1: ParagraphStyle("H1", parent=body, fontName="AegisSans-Bold", fontSize=20, leading=24, spaceAfter=8),
    2: ParagraphStyle("H2", parent=body, fontName="AegisSans-Bold", fontSize=13, leading=16, spaceBefore=10, spaceAfter=4, keepWithNext=True),
    3: ParagraphStyle("H3", parent=body, fontName="AegisSans-Bold", fontSize=10.5, leading=13, spaceBefore=8, spaceAfter=3, keepWithNext=True),
}
quote = ParagraphStyle(
    "Quote",
    parent=body,
    leftIndent=10,
    rightIndent=6,
    borderColor=colors.HexColor("#c88a1a"),
    borderWidth=0.8,
    borderPadding=7,
    backColor=colors.HexColor("#fdf6e7"),
    spaceBefore=4,
    spaceAfter=7,
)
small = ParagraphStyle("Small", parent=body, fontSize=7.8, leading=10.5)


def inline(text: str) -> str:
    value = html.escape(text)
    tick = chr(96)
    value = re.sub(re.escape(tick) + r"([^" + re.escape(tick) + r"]+)" + re.escape(tick), r'<font name="AegisMono">\1</font>', value)
    value = re.sub(r"\*\*([^*]+)\*\*", r"<b>\1</b>", value)
    value = re.sub(r"(^|[^*])\*([^*]+)\*", r"\1<i>\2</i>", value)
    value = re.sub(r"(https?://[^\s&lt;)]+)", r'<link href="\1" color="#245c8f">\1</link>', value)
    return value


def blocks(markdown: str):
    lines = markdown.splitlines()
    out = []
    i = 0
    block_start = re.compile(r"^(#{1,6}\s|---+$|[>|]|(?:\d+\.\s)|(?:[-*]\s))")
    while i < len(lines):
        line = lines[i]
        if not line.strip():
            i += 1
            continue
        if re.fullmatch(r"---+", line.strip()):
            out.append(HRFlowable(width="100%", thickness=0.5, color=colors.HexColor("#d3d9e2"), spaceBefore=5, spaceAfter=7))
            i += 1
            continue
        heading = re.match(r"^(#{1,3})\s+(.*)$", line)
        if heading:
            level = len(heading.group(1))
            if level == 1 and out:
                out.append(PageBreak())
            out.append(Paragraph(inline(heading.group(2)), styles[level]))
            i += 1
            continue
        if line.startswith(">"):
            buf = []
            while i < len(lines) and lines[i].startswith(">"):
                buf.append(re.sub(r"^>\s?", "", lines[i]))
                i += 1
            out.append(Paragraph(inline(" ".join(buf)), quote))
            continue
        if line.startswith("|"):
            raw = []
            while i < len(lines) and lines[i].startswith("|"):
                raw.append(lines[i])
                i += 1

            def cells(row: str):
                return [cell.strip() for cell in row.strip("|").split("|")]

            rows = [cells(raw[0])] + [cells(row) for row in raw[2:]]
            data = [[Paragraph(inline(cell), small) for cell in row] for row in rows]
            available = A4[0] - 32 * mm
            widths = [available * 0.24, available * 0.76] if len(rows[0]) == 2 else None
            table = LongTable(data, colWidths=widths, repeatRows=1, hAlign="LEFT")
            table.setStyle(
                TableStyle(
                    [
                        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#edf1f6")),
                        ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#cbd3dd")),
                        ("VALIGN", (0, 0), (-1, -1), "TOP"),
                        ("LEFTPADDING", (0, 0), (-1, -1), 5),
                        ("RIGHTPADDING", (0, 0), (-1, -1), 5),
                        ("TOPPADDING", (0, 0), (-1, -1), 4),
                        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
                    ]
                )
            )
            out.extend([table, Spacer(1, 6)])
            continue
        marker = re.match(r"^(\d+\.\s+|[-*]\s+)", line)
        if marker:
            ordered = marker.group(1)[0].isdigit()
            items = []
            while i < len(lines):
                current = re.match(r"^(\d+\.\s+|[-*]\s+)(.*)$", lines[i])
                if current and current.group(1)[0].isdigit() == ordered:
                    item = current.group(2)
                    i += 1
                    while i < len(lines) and (not lines[i].strip() or lines[i].startswith("  ")):
                        if lines[i].strip():
                            item += " " + lines[i].strip()
                        i += 1
                    items.append(ListItem(Paragraph(inline(item), body)))
                else:
                    break
            out.append(
                ListFlowable(
                    items,
                    bulletType="1" if ordered else "bullet",
                    start="1",
                    leftIndent=15,
                    bulletFontName="AegisSans",
                    bulletFontSize=8,
                    spaceAfter=5,
                )
            )
            continue
        buf = [line]
        i += 1
        while i < len(lines) and lines[i].strip() and not block_start.match(lines[i]):
            buf.append(lines[i].strip())
            i += 1
        out.append(Paragraph(inline(" ".join(buf)), body))
    return out


def page_footer(canvas, doc):
    canvas.saveState()
    canvas.setFont("AegisSans", 7.5)
    canvas.setFillColor(colors.HexColor("#647184"))
    canvas.drawCentredString(A4[0] / 2, 9 * mm, f"Aegis Futures Lab - User Manual  |  {doc.page}")
    canvas.restoreState()


doc = SimpleDocTemplate(
    str(OUTPUT),
    pagesize=A4,
    leftMargin=16 * mm,
    rightMargin=16 * mm,
    topMargin=16 * mm,
    bottomMargin=16 * mm,
    title="Aegis Futures Lab - User Manual",
    author="Aegis Futures Lab",
)
doc.build(blocks(SOURCE.read_text(encoding="utf-8")), onFirstPage=page_footer, onLaterPages=page_footer)
print(f"Wrote {OUTPUT}")
