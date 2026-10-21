"""Мини-библиотека для архитектурных схем и DFD (SVG). Используется docs/diagrams/build.py."""
from html import escape

FONT = "Inter, 'Segoe UI', 'DejaVu Sans', Arial, sans-serif"
MONO = "'JetBrains Mono', 'DejaVu Sans Mono', Consolas, monospace"
INK, MUTED, LINE = "#1d2433", "#5b6474", "#344054"
RED, BLUE, GREEN, AMBER, PURPLE, TEAL, GREY = "#c0362c", "#2856d8", "#137a3f", "#9a6400", "#6b3fd6", "#0f7a8a", "#667085"
TINT = {
    "user": "#ffffff",
    "browser": "#eef3ff",
    "wallet": "#f3eeff",
    "rpc": "#fff6e5",
    "chain": "#e9f7ee",
    "monitor": "#e8f6f8",
    "ci": "#f2f4f7",
    "offchain": "#fdf0ef",
}


def tw(s, size):
    """Оценка ширины строки (Inter)."""
    w = 0.0
    for ch in s:
        if ch in "il.,:;|'!()[]{} ":
            w += 0.32
        elif ch.isupper():
            w += 0.66
        elif ch in "mwшщжмыюМШЩЖЫЮ":
            w += 0.78
        else:
            w += 0.55
    return w * size * 1.08


class Diagram:
    def __init__(self, w, h, title, subtitle=""):
        self.w, self.h = w, h
        self.parts = []
        self.top = []  # слой поверх (подписи стрелок, бейджи)
        self.text(40, 52, title, 30, 700)
        if subtitle:
            self.text(40, 86, subtitle, 17, 400, MUTED)

    # ---------- примитивы ----------
    def text(self, x, y, s, size=14, weight=400, color=INK, anchor="start", mono=False, layer=None, italic=False):
        fam = MONO if mono else FONT
        st = ' font-style="italic"' if italic else ""
        el = f'<text x="{x:.1f}" y="{y:.1f}" font-family="{fam}" font-size="{size}" font-weight="{weight}" fill="{color}" text-anchor="{anchor}"{st}>{escape(s)}</text>'
        (layer if layer is not None else self.parts).append(el)

    def rect(self, x, y, w, h, fill="#fff", stroke=LINE, sw=1.5, rx=10, dash=None, layer=None, opacity=1):
        d = f' stroke-dasharray="{dash}"' if dash else ""
        el = f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{rx}" fill="{fill}" fill-opacity="{opacity}" stroke="{stroke}" stroke-width="{sw}"{d}/>'
        (layer if layer is not None else self.parts).append(el)

    def line(self, pts, color=LINE, sw=2, dash=None, arrow=True, both=False, layer=None):
        d = f' stroke-dasharray="{dash}"' if dash else ""
        mid = color.replace("#", "")
        me = f' marker-end="url(#a{mid})"' if arrow else ""
        ms = f' marker-start="url(#s{mid})"' if both else ""
        p = " ".join(f"{x:.1f},{y:.1f}" for x, y in pts)
        el = f'<polyline points="{p}" fill="none" stroke="{color}" stroke-width="{sw}" stroke-linejoin="round"{d}{me}{ms}/>'
        (layer if layer is not None else self.parts).append(el)
        self._colors = getattr(self, "_colors", set()) | {color}

    # ---------- составные элементы ----------
    def zone(self, x, y, w, h, label, kind, tag=None, sub=None):
        """Доверительная граница: пунктирная красная рамка с тонировкой зоны."""
        self.rect(x, y, w, h, fill=TINT[kind], stroke=RED, sw=2.2, rx=16, dash="10 6")
        lx = x + 18
        if tag:
            pw = tw(tag, 14) + 18
            self.rect(lx, y - 14, pw, 28, fill=RED, stroke=RED, rx=14)
            self.text(lx + pw / 2, y + 5, tag, 14, 700, "#fff", "middle")
            lx += pw + 10
        bw = tw(label, 16) + 20
        self.rect(lx, y - 14, bw, 28, fill="#fff", stroke=RED, sw=1.5, rx=14)
        self.text(lx + 10, y + 5, label, 16, 600, RED)
        if sub:
            self.text(x + 20, y + 36, sub, 13, 400, MUTED, italic=True)

    def box(self, x, y, w, h, title, lines=(), fill="#fff", stroke=LINE, sw=1.6, tsize=17, lsize=13.5, mono_lines=False, strong=False, header=None, header_color=None):
        if strong:
            self.rect(x, y, w, h, fill=fill, stroke=RED, sw=4, rx=12)
        else:
            self.rect(x, y, w, h, fill=fill, stroke=stroke, sw=sw, rx=12)
        ty = y + 28
        if header:
            hc = header_color or GREY
            self.rect(x, y, w, 30, fill=hc, stroke=hc, rx=12)
            self.rect(x, y + 16, w, 14, fill=hc, stroke=hc, rx=0)
            self.text(x + 14, y + 21, header, 13, 600, "#fff")
            ty = y + 56
        self.text(x + 14, ty, title, tsize, 700)
        yy = ty + lsize + 10
        for ln in lines:
            if isinstance(ln, tuple):
                s, opt = ln
            else:
                s, opt = ln, {}
            self.text(x + 14 + opt.get("indent", 0), yy, s, opt.get("size", lsize), opt.get("weight", 400), opt.get("color", INK), mono=opt.get("mono", mono_lines))
            yy += opt.get("size", lsize) + opt.get("gap", 8)
        return yy

    def pill(self, x, y, s, color=RED, size=13, layer=None):
        layer = layer if layer is not None else self.top
        w = tw(s, size) + 16
        self.rect(x, y - size - 3, w, size + 10, fill=color, stroke=color, rx=(size + 10) / 2, layer=layer)
        self.text(x + w / 2, y + 2, s, size, 700, "#fff", "middle", layer=layer)
        return w

    def pills(self, x, y, items, size=13):
        """Ряд бейджей слева направо: items = [(текст, цвет), ...]."""
        for s, c in items:
            x += self.pill(x, y, s, c, size=size) + 8
        return x

    def num(self, x, y, n, color=INK):
        self.top.append(f'<circle cx="{x}" cy="{y}" r="15" fill="{color}" stroke="#fff" stroke-width="2.5"/>')
        self.text(x, y + 5.5, str(n), 15, 700, "#fff", "middle", layer=self.top)

    def label(self, x, y, s, size=13, color=INK, anchor="middle", weight=500, bg="#fff"):
        lines = s.split("\n")
        wmax = max(tw(l, size) for l in lines) + 12
        hh = len(lines) * (size + 4) + 6
        x0 = x - wmax / 2 if anchor == "middle" else (x if anchor == "start" else x - wmax)
        self.rect(x0, y - size - 2, wmax, hh, fill=bg, stroke="none", sw=0, rx=4, layer=self.top, opacity=0.93)
        for i, l in enumerate(lines):
            tx = x0 + wmax / 2 if anchor == "middle" else x0 + 6
            self.text(tx, y + i * (size + 4), l, size, weight, color, "middle" if anchor == "middle" else "start", layer=self.top)

    def flow(self, pts, n=None, label=None, at=None, color=LINE, dash=None, both=False, lpos=None, nat=None, sw=2.2, lsize=13):
        self.line(pts, color=color, dash=dash, both=both, sw=sw)
        if n is not None:
            if nat is None:
                (x1, y1), (x2, y2) = pts[0], pts[1]
                nat = ((x1 + x2) / 2, (y1 + y2) / 2)
            self.num(nat[0], nat[1], n, color if color != LINE else INK)
        if label:
            lx, ly = lpos if lpos else (nat[0], nat[1] + 32)
            self.label(lx, ly, label, lsize, color if color != LINE else INK)

    # ---------- DFD (нотация Гейна — Сарсона) ----------
    def process(self, x, y, w, h, pid, title, lines=(), color=BLUE):
        self.rect(x, y, w, h, fill="#fff", stroke=color, sw=2.4, rx=18)
        self.rect(x, y, w, 34, fill=color, stroke=color, rx=18)
        self.rect(x, y + 18, w, 16, fill=color, stroke=color, rx=0)
        self.text(x + w / 2, y + 24, pid, 16, 700, "#fff", "middle")
        yy = y + 62
        for i, t in enumerate(title.split("\n")):
            self.text(x + w / 2, yy, t, 16.5, 700, INK, "middle")
            yy += 22
        yy += 4
        for ln in lines:
            self.text(x + w / 2, yy, ln, 13, 400, MUTED, "middle")
            yy += 19

    def store(self, x, y, w, h, sid, title, color=AMBER):
        self.parts.append(f'<path d="M{x + w} {y} H{x} V{y + h} H{x + w}" fill="#fffaf0" stroke="{color}" stroke-width="2.4"/>')
        self.rect(x, y, w, h, fill="#fffaf0", stroke="none", sw=0, rx=0)
        self.parts.append(f'<path d="M{x + w} {y} H{x} V{y + h} H{x + w}" fill="none" stroke="{color}" stroke-width="2.4"/>')
        self.parts.append(f'<line x1="{x + 54}" y1="{y}" x2="{x + 54}" y2="{y + h}" stroke="{color}" stroke-width="2"/>')
        self.text(x + 27, y + h / 2 + 6, sid, 15, 700, color, "middle")
        lines = title.split("\n")
        y0 = y + h / 2 + 6 - (len(lines) - 1) * 10
        for i, l in enumerate(lines):
            self.text(x + 66, y0 + i * 20, l, 15, 600 if i == 0 else 400, INK)

    def entity(self, x, y, w, h, title, lines=(), color=LINE):
        self.rect(x + 7, y + 7, w, h, fill="#d0d5dd", stroke="none", sw=0, rx=4)
        self.rect(x, y, w, h, fill="#fff", stroke=color, sw=2.4, rx=4)
        yy = y + 30
        for t in title.split("\n"):
            self.text(x + w / 2, yy, t, 16.5, 700, INK, "middle")
            yy += 22
        for ln in lines:
            self.text(x + w / 2, yy, ln, 13, 400, MUTED, "middle")
            yy += 18

    def legend(self, x, y, items, title="Обозначения", w=None):
        w = w or 420
        h = 44 + 30 * len(items)
        self.rect(x, y, w, h, fill="#fff", stroke="#d0d5dd", sw=1.2, rx=10)
        self.text(x + 16, y + 28, title, 15, 700)
        yy = y + 60
        for kind, color, s in items:
            if kind == "zone":
                self.rect(x + 16, yy - 15, 42, 20, fill="#fff", stroke=RED, sw=2, rx=5, dash="6 4")
            elif kind == "arrow":
                self.line([(x + 16, yy - 5), (x + 58, yy - 5)], color=color, sw=2.2)
            elif kind == "dash":
                self.line([(x + 16, yy - 5), (x + 58, yy - 5)], color=color, sw=2.2, dash="7 5")
            elif kind == "pill":
                self.rect(x + 16, yy - 17, 42, 22, fill=color, stroke=color, rx=11)
            elif kind == "strong":
                self.rect(x + 16, yy - 17, 42, 22, fill="#fff", stroke=RED, sw=4, rx=6)
            elif kind == "num":
                self.parts.append(f'<circle cx="{x + 37}" cy="{yy - 6}" r="11" fill="{INK}"/>')
            elif kind == "box":
                self.rect(x + 16, yy - 17, 42, 22, fill="#fff", stroke=color, sw=2, rx=6)
            self.text(x + 72, yy, s, 13.5, 400)
            yy += 30

    def svg(self):
        colors = getattr(self, "_colors", set()) | {LINE, RED, BLUE, GREEN, AMBER, PURPLE, TEAL, GREY, INK}
        defs = []
        for c in colors:
            m = c.replace("#", "")
            defs.append(f'<marker id="a{m}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="{c}"/></marker>')
            defs.append(f'<marker id="s{m}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="{c}"/></marker>')
        body = "\n".join(self.parts + self.top)
        return (
            f'<svg xmlns="http://www.w3.org/2000/svg" width="{self.w}" height="{self.h}" viewBox="0 0 {self.w} {self.h}">'
            f'<defs>{"".join(defs)}</defs><rect width="{self.w}" height="{self.h}" fill="#ffffff"/>\n{body}\n</svg>'
        )
