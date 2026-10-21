"""Сборка всех схем ПР №5: SVG + PNG (2x) через headless Chromium (Playwright).

Запуск:  python3 docs/diagrams/build.py [имя ...]
PNG рендерит scripts/render-svg.cjs (нужен playwright); без него сохраняются только SVG.
"""
import importlib
import subprocess
import sys
from pathlib import Path

here = Path(__file__).resolve().parent
sys.path.insert(0, str(here))
MODULES = ["d1_context", "d2_containers", "d3_components", "dfd0", "dfd1", "dfd2"]

names = sys.argv[1:] or MODULES
out = here / "out"
out.mkdir(exist_ok=True)
for name in names:
    mod = importlib.import_module(name)
    d = mod.build()
    (out / f"{name}.svg").write_text(d.svg(), encoding="utf-8")
    print("svg", name, d.w, "x", d.h)

renderer = here / "render-svg.cjs"
if renderer.exists():
    subprocess.run(["node", str(renderer), str(out), *names], check=False)
