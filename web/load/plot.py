"""Графики нагрузочного эксперимента (Задание 3.6).

Запуск:  python3 load/plot.py            (берёт последний каталог load/results/<время>)
         python3 load/plot.py <каталог>
Нужен matplotlib:  pip install matplotlib   (или sudo apt install python3-matplotlib)
"""
import csv
import json
import sys
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

here = Path(__file__).resolve().parent
run_dir = Path(sys.argv[1]) if len(sys.argv) > 1 else sorted((here / "results").iterdir())[-1]
summary = json.loads((run_dir / "summary.json").read_text(encoding="utf-8"))["summaries"]
out = run_dir / "charts"
out.mkdir(exist_ok=True)

TITLE = {"S": "S: 30 последовательных", "P": "P: 5 параллельных × 6", "Q": "Q: конвейер (оптимизация)"}
GREY, BLUE, LIGHT = "#8a8f98", "#2856d8", "#a9bdf2"
plt.rcParams.update({"font.size": 10, "axes.spines.top": False, "axes.spines.right": False, "figure.dpi": 150})


def raw(mode, profile):
    with open(run_dir / f"raw-{mode}-{profile}.csv", encoding="utf-8") as f:
        return [r for r in csv.DictReader(f) if r["status"] == "1"]


# 1. Задержка каждой транзакции (основной режим)
fig, ax = plt.subplots(figsize=(9, 4.2))
for prof, color, marker in (("S", GREY, "o"), ("P", BLUE, "s")):
    rows = raw("blocktime1", prof)
    ax.plot(range(1, len(rows) + 1), [float(r["latencyMs"]) for r in rows], marker=marker, ms=4, lw=1, color=color, label=TITLE[prof])
s_main = {(s["mode"], s["profile"]): s for s in summary}
ax.axhline(1000, color="#c0362c", lw=1, ls="--")
ax.text(30.5, 1060, "интервал блока 1000 мс", color="#c0362c", va="bottom", ha="right", fontsize=9)
ax.set_ylim(0, 1200)
ax.set_xlabel("номер транзакции в порядке отправки")
ax.set_ylabel("задержка, мс")
ax.set_title("Задержка подтверждения ≈ интервалу блока в обоих профилях (Anvil, блок раз в 1 с)", loc="left", fontsize=11)
ax.legend(frameon=False, loc="lower right")
fig.tight_layout()
fig.savefig(out / "fig1-latency-per-tx.png")

# 2. p50 / p95 по профилям и режимам
order = [(s["mode"], s["profile"]) for s in summary]
labels = [f"{TITLE[p]}\n{m}" for m, p in order]
fig, axes = plt.subplots(1, 2, figsize=(11, 4.4), gridspec_kw={"width_ratios": [3, 2]})
for ax, mode in zip(axes, ("blocktime1", "automine")):
    sel = [s for s in summary if s["mode"] == mode]
    x = range(len(sel))
    w = 0.38
    b1 = ax.bar([i - w / 2 for i in x], [s["p50Ms"] for s in sel], w, color=LIGHT, label="p50")
    b2 = ax.bar([i + w / 2 for i in x], [s["p95Ms"] for s in sel], w, color=BLUE, label="p95")
    for bars in (b1, b2):
        for b in bars:
            ax.text(b.get_x() + b.get_width() / 2, b.get_height(), f"{b.get_height():.0f}" if b.get_height() >= 100 else f"{b.get_height():.1f}", ha="center", va="bottom", fontsize=8)
    ax.set_xticks(list(x))
    ax.set_xticklabels([TITLE[s["profile"]].replace(": ", ":\n", 1) for s in sel], fontsize=8)
    ax.set_title("блок раз в 1 с (основной)" if mode == "blocktime1" else "automine (контроль: без ожидания блока)", fontsize=10)
    ax.set_ylabel("мс")
axes[0].set_ylim(0, 1250)
axes[0].legend(frameon=False, ncol=2, loc="upper right")
fig.suptitle("p50 и p95: ~1000 мс задаёт интервал блока; собственные расходы клиента, RPC и EVM ≈ 22–26 мс", x=0.01, ha="left", fontsize=11)
fig.tight_layout()
fig.savefig(out / "fig2-p50-p95.png")

# 3. Пропускная способность
fig, ax = plt.subplots(figsize=(9, 4.2))
sel = [s for s in summary if s["mode"] == "blocktime1"]
colors = [GREY, BLUE, "#137a3f"]
bars = ax.bar([TITLE[s["profile"]] for s in sel], [s["throughputOps"] for s in sel], color=colors[: len(sel)])
for b, s in zip(bars, sel):
    ax.text(b.get_x() + b.get_width() / 2, b.get_height(), f"{s['throughputOps']:.2f} оп/с\n{s['blocksUsed']} блок(ов), до {s['txPerBlockMax']} tx в блоке", ha="center", va="bottom", fontsize=9)
ax.set_ylabel("успешных операций в секунду")
ax.set_ylim(0, max(s["throughputOps"] for s in sel) * 1.3)
ax.set_title("Пропускная способность растёт с числом транзакций в блоке (Anvil, блок раз в 1 с)", loc="left", fontsize=11)
fig.tight_layout()
fig.savefig(out / "fig3-throughput.png")

# 4. gasUsed на транзакцию
fig, ax = plt.subplots(figsize=(9, 3.6))
for prof, color in (("S", GREY), ("P", BLUE)):
    rows = raw("blocktime1", prof)
    ax.plot(range(1, len(rows) + 1), [int(r["gasUsed"]) for r in rows], marker="o", ms=3, lw=1, color=color, label=TITLE[prof])
avg = s_main[("blocktime1", "S")]["gasUsedAvg"]
ax.set_ylim(avg - 400, avg + 200)
ax.set_xlabel("номер транзакции")
ax.set_ylabel("gasUsed")
ax.set_title(f"gasUsed registerService стабилен: ≈{avg:,} газа на новую запись".replace(",", " "), loc="left", fontsize=11)
ax.legend(frameon=False, loc="lower right")
fig.tight_layout()
fig.savefig(out / "fig4-gas-used.png")

print("графики:", *sorted(p.name for p in out.iterdir()), sep="\n  ")
