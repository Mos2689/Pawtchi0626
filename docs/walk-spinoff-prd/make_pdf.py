"""Convert TROT-PRD-MASTER.md to a styled A4 PDF (reportlab, no external converters).

Usage:  python make_pdf.py [input.md] [output.pdf]
Defaults: TROT-PRD-MASTER.md -> TROT-PRD-MASTER.pdf (same folder as this script).
"""
import os
import re
import sys

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (BaseDocTemplate, Frame, HRFlowable, PageBreak,
                                PageTemplate, Paragraph, Spacer, Table,
                                TableStyle, XPreformatted)

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, "TROT-PRD-MASTER.md")
OUT = sys.argv[2] if len(sys.argv) > 2 else os.path.join(HERE, "TROT-PRD-MASTER.pdf")

# ---------------------------------------------------------------- fonts
def register_fonts():
    """Prefer DejaVu (full coverage of the doc's glyphs); fall back to Windows fonts."""
    candidates = []
    try:
        import matplotlib
        mpl_fonts = os.path.join(os.path.dirname(matplotlib.__file__), "mpl-data", "fonts", "ttf")
        candidates.append({
            "body": os.path.join(mpl_fonts, "DejaVuSans.ttf"),
            "bold": os.path.join(mpl_fonts, "DejaVuSans-Bold.ttf"),
            "italic": os.path.join(mpl_fonts, "DejaVuSans-Oblique.ttf"),
            "bolditalic": os.path.join(mpl_fonts, "DejaVuSans-BoldOblique.ttf"),
            "mono": os.path.join(mpl_fonts, "DejaVuSansMono.ttf"),
            "safe": True,
        })
    except ImportError:
        pass
    win = r"C:\Windows\Fonts"
    candidates.append({
        "body": os.path.join(win, "segoeui.ttf"),
        "bold": os.path.join(win, "segoeuib.ttf"),
        "italic": os.path.join(win, "segoeuii.ttf"),
        "bolditalic": os.path.join(win, "segoeuiz.ttf"),
        "mono": os.path.join(win, "consola.ttf"),
        "safe": False,
    })
    candidates.append({
        "body": os.path.join(win, "arial.ttf"),
        "bold": os.path.join(win, "arialbd.ttf"),
        "italic": os.path.join(win, "ariali.ttf"),
        "bolditalic": os.path.join(win, "arialbi.ttf"),
        "mono": os.path.join(win, "cour.ttf"),
        "safe": False,
    })
    for c in candidates:
        if all(os.path.exists(c[k]) for k in ("body", "bold", "italic", "bolditalic", "mono")):
            pdfmetrics.registerFont(TTFont("Body", c["body"]))
            pdfmetrics.registerFont(TTFont("Body-Bold", c["bold"]))
            pdfmetrics.registerFont(TTFont("Body-Italic", c["italic"]))
            pdfmetrics.registerFont(TTFont("Body-BoldItalic", c["bolditalic"]))
            pdfmetrics.registerFont(TTFont("Mono", c["mono"]))
            pdfmetrics.registerFontFamily("Body", normal="Body", bold="Body-Bold",
                                          italic="Body-Italic", boldItalic="Body-BoldItalic")
            return c["safe"]
    raise SystemExit("No usable TTF font set found.")

FULL_COVERAGE = register_fonts()

# Emoji never render in these fonts; swap for text. Replacements must never
# contain markdown metacharacters (*_`) or they corrupt inline parsing.
EMOJI_MAP = {"\U0001F43E": "[paw]", "\U0001F393": "[mortarboard]", "\U0001F389": "[confetti]",
             "\U0001F56F": "[candle]", "\U0001F631": "[scream]", "\U0001F97A": "[pleading]",
             "⭐": "•", "️": ""}
# Symbols DejaVu covers but the Windows fallback body font may not. Box-drawing
# chars are left alone: they only occur in code blocks and Consolas has them.
SYMBOL_MAP = {} if FULL_COVERAGE else {"✓": "+", "★": "•", "▼": "v"}

def demoji(text):
    for k, v in EMOJI_MAP.items():
        text = text.replace(k, v)
    return text

def body_glyphs(text):
    text = demoji(text)
    for k, v in SYMBOL_MAP.items():
        text = text.replace(k, v)
    return text

# ---------------------------------------------------------------- styles
INK = colors.HexColor("#22261F")
INK2 = colors.HexColor("#5A6052")
TRAIL = colors.HexColor("#2F5D3E")
CLAY = colors.HexColor("#C4593B")
LINE = colors.HexColor("#E7E2D8")
PAPER = colors.HexColor("#FAF7F2")

def st(name, **kw):
    base = dict(fontName="Body", fontSize=9, leading=13, textColor=INK, spaceAfter=5)
    base.update(kw)
    return ParagraphStyle(name, **base)

S = {
    "h1": st("h1", fontName="Body-Bold", fontSize=19, leading=23, textColor=TRAIL,
             spaceBefore=6, spaceAfter=10, keepWithNext=1),
    "h2": st("h2", fontName="Body-Bold", fontSize=13.5, leading=17, textColor=INK,
             spaceBefore=14, spaceAfter=6, keepWithNext=1),
    "h3": st("h3", fontName="Body-Bold", fontSize=11, leading=14, textColor=TRAIL,
             spaceBefore=10, spaceAfter=4, keepWithNext=1),
    "h4": st("h4", fontName="Body-BoldItalic", fontSize=9.5, leading=13, textColor=INK,
             spaceBefore=8, spaceAfter=3, keepWithNext=1),
    "body": st("body"),
    "bullet": st("bullet", leftIndent=14, bulletIndent=4),
    "bullet2": st("bullet2", leftIndent=26, bulletIndent=16),
    "num": st("num", leftIndent=18, bulletIndent=4),
    "quote": st("quote", fontName="Body-Italic", textColor=INK2, leftIndent=12,
                borderPadding=4, spaceBefore=4, spaceAfter=6),
    "code": ParagraphStyle("code", fontName="Mono", fontSize=6.8, leading=8.6,
                           textColor=INK, backColor=PAPER, borderColor=LINE,
                           borderWidth=0.5, borderPadding=5, spaceBefore=4, spaceAfter=8),
    "cell": st("cell", fontSize=7.6, leading=9.6, spaceAfter=0),
    "cellsm": st("cellsm", fontSize=6.6, leading=8.4, spaceAfter=0),
    "cellh": st("cellh", fontName="Body-Bold", fontSize=7.6, leading=9.6, spaceAfter=0),
    "cellhsm": st("cellhsm", fontName="Body-Bold", fontSize=6.6, leading=8.4, spaceAfter=0),
}

# ---------------------------------------------------------------- inline md
CODESPAN = re.compile(r"`([^`]+)`")
BOLD = re.compile(r"\*\*(.+?)\*\*", re.S)
ITAL = re.compile(r"(?<![\w*])\*([^*\n]+?)\*(?![\w*])")
LINK = re.compile(r"\[([^\]]+)\]\(([^)]+)\)")

def inline(text):
    text = body_glyphs(text)
    text = text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    stash = []
    def keep(m):
        stash.append(m.group(1))
        return f"\x00{len(stash)-1}\x00"
    text = CODESPAN.sub(keep, text)
    text = LINK.sub(lambda m: f'<u>{m.group(1)}</u>', text)
    text = BOLD.sub(lambda m: f"<b>{m.group(1)}</b>", text)
    text = ITAL.sub(lambda m: f"<i>{m.group(1)}</i>", text)
    for i, frag in enumerate(stash):
        text = text.replace(f"\x00{i}\x00", f'<font face="Mono" size="-1">{frag}</font>')
    return text

def safe_para(text, style, bulletText=None):
    """Paragraph that degrades to tag-stripped plain text on any markup error."""
    try:
        return Paragraph(text, style, bulletText=bulletText)
    except Exception:
        plain = re.sub(r"<[^>]+>", "", text)
        return Paragraph(plain, style, bulletText=bulletText)

# ---------------------------------------------------------------- table builder
def build_table(rows, width):
    rows = [r for r in rows
            if not all(re.fullmatch(r":?-{2,}:?", c.strip()) or not c.strip() for c in r)]
    if not rows:
        return None
    ncols = max(len(r) for r in rows)
    small = ncols >= 5
    body_s, head_s = (S["cellsm"], S["cellhsm"]) if small else (S["cell"], S["cellh"])
    data = []
    for i, r in enumerate(rows):
        r = list(r) + [""] * (ncols - len(r))
        data.append([safe_para(inline(c.strip()), head_s if i == 0 else body_s) for c in r])
    t = Table(data, colWidths=[width / ncols] * ncols, repeatRows=1, splitByRow=1)
    t.setStyle(TableStyle([
        ("GRID", (0, 0), (-1, -1), 0.4, LINE),
        ("BACKGROUND", (0, 0), (-1, 0), PAPER),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 3.5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 3.5),
        ("TOPPADDING", (0, 0), (-1, -1), 2.5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 2.5),
    ]))
    t.spaceAfter = 8
    return t

# ---------------------------------------------------------------- doc template
class Doc(BaseDocTemplate):
    def afterFlowable(self, fl):
        if isinstance(fl, Paragraph) and fl.style.name in ("h1", "h2"):
            txt = re.sub(r"<[^>]+>", "", fl.getPlainText())[:90]
            key = f"bm{id(fl)}"
            self.canv.bookmarkPage(key)
            self.canv.addOutlineEntry(txt, key, 0 if fl.style.name == "h1" else 1, 0)

def on_page(canv, doc):
    canv.saveState()
    canv.setFont("Body", 7)
    canv.setFillColor(INK2)
    canv.drawString(20 * mm, 11 * mm, "Trot — Master PRD & GTM Playbook (Draft v1.1, Australia-first)")
    canv.drawRightString(A4[0] - 20 * mm, 11 * mm, f"Page {doc.page}")
    canv.setStrokeColor(LINE)
    canv.setLineWidth(0.4)
    canv.line(20 * mm, 14 * mm, A4[0] - 20 * mm, 14 * mm)
    canv.restoreState()

def on_cover(canv, doc):
    canv.saveState()
    w, h = A4
    canv.setFillColor(PAPER)
    canv.rect(0, 0, w, h, stroke=0, fill=1)
    canv.setFillColor(TRAIL)
    canv.setFont("Body-Bold", 52)
    canv.drawString(25 * mm, h - 90 * mm, "TROT")
    canv.setFillColor(CLAY)
    canv.setLineWidth(3)
    canv.setStrokeColor(CLAY)
    canv.line(25 * mm, h - 96 * mm, 80 * mm, h - 96 * mm)
    canv.setFillColor(INK)
    canv.setFont("Body-Bold", 17)
    canv.drawString(25 * mm, h - 112 * mm, "Master Product Requirements Document")
    canv.drawString(25 * mm, h - 121 * mm, "& Go-To-Market Playbook")
    canv.setFont("Body", 11)
    canv.setFillColor(INK2)
    canv.drawString(25 * mm, h - 136 * mm, "The social operating system for dog walking.")
    canv.setFont("Body", 9.5)
    for i, line in enumerate([
        "Draft v1.1 — consolidated master: strategy · product · design · go-to-market",
        "Australia-first launch (Melbourne, metro #1)",
        "Sections §1–§20 · self-contained · working codename “Trot”",
        "July 2026",
    ]):
        canv.drawString(25 * mm, h - (150 + i * 6.5) * mm, line)
    canv.setFont("Body-Italic", 9)
    canv.drawString(25 * mm, 25 * mm, "Every walk counts.")
    canv.restoreState()

# ---------------------------------------------------------------- parse
with open(SRC, encoding="utf-8") as f:
    lines = f.read().splitlines()

PAGE_W, PAGE_H = A4
MARGIN = 20 * mm
avail = PAGE_W - 2 * MARGIN

story = [PageBreak()]  # leaves the cover template
i, n = 0, len(lines)
first_h1 = True
while i < n:
    ln = lines[i]
    stripped = ln.strip()
    if stripped.startswith("```"):
        buf = []
        i += 1
        while i < n and not lines[i].strip().startswith("```"):
            buf.append(demoji(lines[i]).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;"))
            i += 1
        story.append(XPreformatted("\n".join(buf), S["code"]))
        i += 1
        continue
    if stripped.startswith("|"):
        rows = []
        while i < n and lines[i].strip().startswith("|"):
            rows.append([c for c in lines[i].strip().strip("|").split("|")])
            i += 1
        t = build_table(rows, avail)
        if t is not None:
            story.append(t)
        continue
    if re.fullmatch(r"-{3,}", stripped):
        story.append(Spacer(1, 3))
        story.append(HRFlowable(width="100%", thickness=0.5, color=LINE, spaceAfter=7))
        i += 1
        continue
    m = re.match(r"(#{1,4})\s+(.*)", stripped)
    if m:
        level = len(m.group(1))
        text = m.group(2)
        if level == 1:
            if not first_h1:
                story.append(PageBreak())
            first_h1 = False
            story.append(safe_para(inline(text), S["h1"]))
            story.append(HRFlowable(width="100%", thickness=1.1, color=CLAY, spaceAfter=9))
        else:
            story.append(safe_para(inline(text), S[f"h{level}"]))
        i += 1
        continue
    if stripped.startswith("> "):
        buf = []
        while i < n and lines[i].strip().startswith(">"):
            buf.append(lines[i].strip().lstrip(">").strip())
            i += 1
        story.append(safe_para(inline(" ".join(buf)), S["quote"]))
        continue
    mb = re.match(r"(\s*)([-*])\s+(.*)", ln)
    if mb and not stripped.startswith("**"):
        style = S["bullet2"] if len(mb.group(1)) >= 2 else S["bullet"]
        story.append(safe_para(inline(mb.group(3)), style, bulletText="•"))
        i += 1
        continue
    mn = re.match(r"\s*(\d+)\.\s+(.*)", ln)
    if mn:
        story.append(safe_para(inline(mn.group(2)), S["num"], bulletText=f"{mn.group(1)}."))
        i += 1
        continue
    if not stripped:
        i += 1
        continue
    # plain paragraph: join consecutive plain lines
    buf = [stripped]
    i += 1
    while i < n:
        nxt = lines[i].strip()
        if (not nxt or nxt.startswith(("#", "|", "```", "> ", "- ", "* "))
                or re.fullmatch(r"-{3,}", nxt) or re.match(r"\d+\.\s", nxt)):
            break
        buf.append(nxt)
        i += 1
    story.append(safe_para(inline(" ".join(buf)), S["body"]))

# ---------------------------------------------------------------- build
doc = Doc(OUT, pagesize=A4, leftMargin=MARGIN, rightMargin=MARGIN,
          topMargin=18 * mm, bottomMargin=20 * mm,
          title="Trot — Master PRD & GTM Playbook",
          author="Trot", subject="Product Requirements Document")
frame = Frame(MARGIN, 20 * mm, avail, PAGE_H - 38 * mm, id="f")
doc.addPageTemplates([
    PageTemplate(id="cover", frames=[frame], onPage=on_cover),
    PageTemplate(id="page", frames=[frame], onPage=on_page),
])
story.insert(0, Spacer(1, 1))  # something on the cover page frame

from reportlab.platypus import NextPageTemplate
story.insert(1, NextPageTemplate("page"))

doc.build(story)
size_kb = os.path.getsize(OUT) // 1024
print(f"OK: {OUT} ({size_kb} KB)")
