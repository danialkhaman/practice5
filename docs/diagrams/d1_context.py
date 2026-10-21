"""Уровень 1 — контекст системы (C4 System Context)."""
from svglib import Diagram, RED, BLUE, GREEN, AMBER, PURPLE, TEAL, GREY, INK, MUTED, LINE


def person(d, x, y, w, h, title, lines, color=INK):
    # пиктограмма человека + карточка
    cx = x + w / 2
    d.parts.append(f'<circle cx="{cx}" cy="{y - 34}" r="22" fill="#fff" stroke="{color}" stroke-width="2.4"/>')
    d.parts.append(f'<path d="M{cx - 40} {y + 2} Q{cx} {y - 30} {cx + 40} {y + 2}" fill="#fff" stroke="{color}" stroke-width="2.4"/>')
    d.box(x, y, w, h, title, lines, stroke=color, tsize=18, lsize=14)


def build():
    d = Diagram(2500, 1560, "Архитектура · уровень 1 — контекст системы учёта ТО оборудования",
                "Кто взаимодействует с системой MaintenanceRegistry и через какие внешние системы (вариант 8 «Промышленность»)")

    # Система в центре
    d.rect(860, 470, 780, 560, fill="#eef3ff", stroke=BLUE, sw=3, rx=22)
    d.text(1250, 530, "Система учёта ТО оборудования", 26, 700, INK, "middle")
    d.text(1250, 566, "MaintenanceRegistry · ПР №5", 19, 600, BLUE, "middle")
    items = [
        ("dApp", "React + ethers.js v6: подключение кошелька, чтение, запись, этапы транзакции, события"),
        ("Смарт-контракт", "реестр этапов ТО, роли (AccessControl), пауза (Pausable)"),
        ("Мониторинг", "телеметрия, правила R1/R2, журналы и тревоги"),
        ("Тесты и CI", "интеграционные, инварианты, fuzz, Slither, npm audit"),
    ]
    yy = 630
    for t, s in items:
        d.rect(890, yy - 28, 720, 82, fill="#fff", stroke="#c7d4f5", sw=1.5, rx=12)
        d.text(910, yy, t, 17, 700, BLUE)
        d.text(910, yy + 28, s, 14.5, 400)
        yy += 98

    # Люди
    person(d, 80, 230, 360, 170, "Инженер ТО", ["роль TECHNICIAN_ROLE", "регистрирует этапы ТО станков", "и хеш акта (keccak256)"], GREEN)
    person(d, 80, 560, 360, 170, "Администратор", ["ADMIN_ROLE + DEFAULT_ADMIN_ROLE", "отзыв записей, пауза, выдача ролей", "в продакшене — мультисиг"], BLUE)
    person(d, 80, 890, 360, 170, "Аудитор / наблюдатель", ["без ролей, только чтение:", "getLastService, verifyDocument,", "события в обозревателе"], GREY)
    person(d, 80, 1220, 360, 190, "Нарушитель", ["посторонний адрес или украденный", "ключ: вызовы без роли, подмена", "dApp/RPC, отказ в обслуживании"], RED)

    # Внешние системы
    d.box(1990, 170, 440, 200, "Кошелёк MetaMask", ["хранит закрытые ключи пользователя,", "показывает и подписывает транзакции,", "сообщает аккаунт и chainId (EIP-1193)"], header="внешняя система", header_color=PURPLE, tsize=19, lsize=14)
    d.box(1990, 470, 440, 230, "Сеть Ethereum (EVM)", ["локально — Anvil, chainId 31337", "(в продакшене — Sepolia/mainnet)", "через RPC-узел: блоки, состояние,", "журнал событий, квитанции"], header="внешняя система", header_color=GREEN, tsize=19, lsize=14)
    d.box(1990, 800, 440, 200, "Хранилище актов ТО", ["off-chain: PDF/сканы актов,", "ПДн и коммерческие данные;", "в сеть уходит только хеш"], header="внешняя система", header_color=RED, tsize=19, lsize=14)
    d.box(1990, 1100, 440, 200, "Дежурный / SOC", ["получает тревоги R1, R2", "(консоль, alerts.jsonl, вебхук),", "реагирует: роли, пауза, RPC"], header="получатель тревог", header_color=TEAL, tsize=19, lsize=14)
    d.box(980, 1200, 540, 230, "GitHub + реестры пакетов", ["репозиторий, GitHub Actions (CI),", "npm: ethers, react, vite;", "OpenZeppelin v5.7.0, forge-std,", "solc 0.8.30, Slither 0.11.6"], header="цепочка поставки", header_color=GREY, tsize=19, lsize=14)
    d.box(980, 150, 540, 190, "Браузер пользователя", ["среда выполнения dApp (недоверенная):", "код и данные в ней может изменить", "пользователь или расширение"], header="среда выполнения", header_color=AMBER, tsize=19, lsize=14)

    # Потоки от людей
    d.flow([(440, 330), (860, 600)], None, None, color=GREEN)
    d.label(650, 430, "регистрирует этап ТО,\nчитает историю станка", 13.5, GREEN)
    d.flow([(440, 650), (860, 720)], None, None, color=BLUE)
    d.label(650, 660, "отзыв, пауза, роли", 13.5, BLUE)
    d.flow([(440, 980), (860, 860)], None, None, color=GREY)
    d.label(650, 900, "читает, проверяет\nдокумент (verifyDocument)", 13.5, GREY)
    d.flow([(440, 1310), (860, 990)], None, None, color=RED, dash="9 6")
    d.label(650, 1170, "вызовы без роли,\nобход UI, отказ в\nобслуживании RPC", 13.5, RED)

    # Потоки к внешним системам
    d.flow([(1640, 560), (1990, 270)], None, None, color=PURPLE, both=True)
    d.label(1820, 380, "запрос подписи /\nаккаунт, chainId", 13.5, PURPLE)
    d.flow([(1640, 640), (1990, 585)], None, None, color=GREEN, both=True)
    d.label(1815, 650, "JSON-RPC: eth_call,\nтранзакции, логи, квитанции", 13.5, GREEN)
    d.flow([(1990, 900), (1640, 860)], None, None, color=RED, dash="9 6")
    d.label(1815, 920, "файл акта → хеш\n(локально в браузере)", 13.5, RED)
    d.flow([(1640, 960), (1990, 1200)], None, None, color=TEAL)
    d.label(1820, 1060, "тревоги R1/R2", 13.5, TEAL)
    d.flow([(1250, 1200), (1250, 1030)], None, None, color=GREY, dash="9 6")
    d.label(1250, 1120, "код, зависимости,\nпроверки CI", 13.5, GREY)
    d.flow([(1250, 340), (1250, 470)], None, None, color=AMBER, dash="9 6")
    d.label(1250, 415, "исполняет dApp", 13.5, AMBER)
    d.flow([(2210, 370), (2210, 470)], None, None, color=PURPLE)
    d.label(2320, 425, "подписанные\nтранзакции", 13.5, PURPLE)

    d.legend(1990, 1340, [
        ("box", BLUE, "система (граница системы)"),
        ("arrow", INK, "взаимодействие"),
        ("dash", RED, "угроза / недоверенный поток"),
    ], w=440)
    return d
