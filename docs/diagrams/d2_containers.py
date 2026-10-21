"""Уровень 2 — контейнеры, доверительные границы, источники данных, точки проверки полномочий."""
from svglib import Diagram, RED, BLUE, GREEN, AMBER, PURPLE, TEAL, GREY, INK, MUTED, LINE


def build():
    d = Diagram(2700, 2200,
                "Архитектура · уровень 2 — контейнеры, доверительные границы, источники данных и точки проверки полномочий",
                "Пользователь → dApp → Кошелёк → RPC → Смарт-контракт MaintenanceRegistry (вариант 8 «Промышленность»); мониторинг и CI — вспомогательные контуры")
    Z_TOP, Z_H = 150, 1120  # зоны: y 150 … 1270

    # ---------------- TB0 пользователи ----------------
    d.zone(30, Z_TOP, 300, 760, "Пользователи", "user", tag="TB0", sub="внешние субъекты, вне системы")
    d.box(50, 210, 260, 150, "Инженер ТО", ["TECHNICIAN_ROLE", "Anvil #1 · 0x7099…79C8", "регистрирует этапы ТО"], tsize=16)
    d.box(50, 380, 260, 150, "Администратор", ["ADMIN + DEFAULT_ADMIN", "Anvil #0 · 0xf39F…2266", "отзыв, пауза, роли"], tsize=16)
    d.box(50, 550, 260, 150, "Посторонний / аудитор", ["без ролей · Anvil #2", "читает публичные данные", "в сценарии атаки — нарушитель"], tsize=16)
    d.box(50, 720, 260, 160, "Дежурный", ["получает тревоги R1/R2", "(поток 10): вебхук,", "консоль монитора"], tsize=16)

    d.zone(30, 960, 300, 310, "Off-chain", "offchain", tag="TB-OFF", sub="защищённое хранилище актов")
    d.box(50, 1020, 260, 230, "Акт ТО (PDF / скан)", ["конфиденциально: ПДн,", "коммерческие данные", "в блокчейн — только", "keccak256(файла)", "проверка: verifyDocument"], tsize=16)
    d.pill(230, 1046, "DS6", BLUE)

    # ---------------- TB1 браузер ----------------
    d.zone(370, Z_TOP, 770, Z_H, "Браузер — недоверенная среда", "browser", tag="TB1",
           sub="код dApp и всё, что приходит в браузер, может быть изменено пользователем или вредоносным расширением")
    d.box(400, 210, 710, 560, "Web3-клиент MaintenanceRegistry", [
        "UI: подключение, чтение, запись, ход транзакции, события, журнал",
        ("wallet.js — EIP-1193: eth_requestAccounts, chainChanged, revoke", {}),
        "RegistryClient: проверка → подпись → отправка → подтверждение",
        "decodeError: USER_REJECTED · WRONG_NETWORK · REVERT · RPC",
        "EventFeed: дедупликация событий по ключу (txHash, logIndex)",
        "Telemetry: ts (UTC), correlationId, вырезание секретов",
        "keccak256(файл акта) — локально, файл в сеть не уходит",
        "deployment.json: адрес контракта и блок развёртывания",
        ("Чтение — через собственный RPC dApp; запись — только через кошелёк", {"color": BLUE, "weight": 600}),
        ("Кнопки по ролям не скрываются: решение о доступе — в контракте", {"color": RED, "weight": 600}),
    ], header="dApp · React 19 + ethers.js v6 · http://localhost:5173", header_color=BLUE, lsize=14, tsize=19)
    d.pills(420, 748, [("AP1 подсказка ролей", "#98a2b3"), ("AP2 chainId = 31337", RED), ("AP4 симуляция eth_call", RED), ("DS4", BLUE), ("DS7", BLUE)])

    d.zone(400, 830, 710, 420, "Кошелёк — изолированное расширение", "wallet", tag="TB2")
    d.box(430, 880, 650, 340, "MetaMask (EIP-1193-провайдер window.ethereum)", [
        "Хранилище ключей: закрытые ключи не покидают кошелёк",
        "Окно подтверждения: адрес, функция, газ — решает пользователь",
        "Подпись транзакции (EIP-155: chainId входит в подпись)",
        "Сети: Anvil 31337 (рабочая) / Sepolia 11155111 (неверная)",
        "Отправка подписанной транзакции через RPC выбранной сети",
        ("dApp видит только адрес и chainId, но не ключ", {"color": PURPLE, "weight": 600}),
    ], header="Кошелёк пользователя", header_color=PURPLE, lsize=14, tsize=17)
    d.pill(890, 1196, "AP3 согласие и подпись", RED)

    # ---------------- TB3 RPC ----------------
    d.zone(1180, Z_TOP, 420, Z_H, "RPC — полудоверенный", "rpc", tag="TB3", sub="транспорт: может отказать или исказить ответ")
    d.box(1205, 260, 370, 620, "Anvil (локальный узел)", [
        "eth_call — чтение и симуляция",
        "eth_sendTransaction / RawTransaction",
        "mempool → блок (automine / 1 с)",
        "eth_getLogs — журнал событий",
        "eth_getTransactionReceipt",
        "eth_blockNumber, getBlockByNumber",
        ("В продакшене: Infura / Alchemy /", {"color": MUTED}),
        ("собственный узел. Может быть", {"color": MUTED}),
        ("недоступен или искажать ответы", {"color": MUTED}),
        ("→ правило R2, резервный RPC", {"color": AMBER, "weight": 600}),
    ], header="JSON-RPC · http://127.0.0.1:8545", header_color=AMBER, lsize=14, tsize=18)
    d.pill(1215, 912, "DS1", BLUE)
    d.pill(1275, 912, "DS2", BLUE)
    d.pill(1335, 912, "DS3", BLUE)
    d.pill(1395, 912, "DS5 ошибки RPC", BLUE)
    d.box(1205, 950, 370, 290, "Угрозы зоны", [
        "T — подмена ответа eth_call",
        "D — отказ / таймаут узла",
        "I — утечка адресов и IP",
        "Меры: свой RPC dApp для чтения,",
        "квитанции как источник истины,",
        "таймаут 3 с, мониторинг R2",
    ], fill="#fffdf7", stroke=AMBER, lsize=13.5, tsize=16)

    # ---------------- TB4 блокчейн ----------------
    d.zone(1640, Z_TOP, 620, Z_H, "Блокчейн Ethereum / EVM", "chain", tag="TB4", sub="доверие к консенсусу и к коду контракта")
    d.box(1665, 210, 570, 690, "MaintenanceRegistry", [
        ("AccessControl + Pausable (OpenZeppelin 5.7.0)", {"color": MUTED}),
        ("Изменяющие функции", {"weight": 700, "gap": 6}),
        ("registerService(machineId, code, ts, docHash)", {"mono": True, "size": 13}),
        ("  onlyRole(TECHNICIAN_ROLE) · whenNotPaused", {"mono": True, "size": 13, "color": RED}),
        ("revokeLastService(machineId)", {"mono": True, "size": 13}),
        ("  onlyRole(ADMIN_ROLE)", {"mono": True, "size": 13, "color": RED}),
        ("pause() / unpause()", {"mono": True, "size": 13}),
        ("  onlyRole(ADMIN_ROLE)", {"mono": True, "size": 13, "color": RED}),
        ("grantRole() / revokeRole()", {"mono": True, "size": 13}),
        ("  onlyRole(DEFAULT_ADMIN_ROLE)", {"mono": True, "size": 13, "color": RED}),
        ("Чтение (view, без газа и подписи)", {"weight": 700, "gap": 6}),
        ("getLastService · verifyDocument · totalRecords", {"mono": True, "size": 13}),
        ("serviceCount · hasRole · paused", {"mono": True, "size": 13}),
        ("Проверки данных", {"weight": 700, "gap": 6}),
        ("machineId ≠ 0 · serviceCode ≠ 0 · ts ≤ block.timestamp", {"size": 13}),
        ("Внешних вызовов нет — reentrancy невозможен", {"size": 13, "color": GREEN, "weight": 600}),
    ], header="Смарт-контракт · 0x5FbD…0aa3 · Solidity 0.8.30", header_color=GREEN, strong=True, tsize=19, lsize=14)
    d.pills(1685, 880, [("AP5 onlyRole — авторитетная проверка", RED), ("AP6 whenNotPaused", RED)])
    d.box(1665, 930, 275, 315, "Состояние (storage)", [
        ("lastService[machineId]", {"mono": True, "size": 13}),
        ("serviceCount[machineId]", {"mono": True, "size": 13}),
        ("totalRecords", {"mono": True, "size": 13}),
        ("_roles[role][account]", {"mono": True, "size": 13}),
        ("_paused", {"mono": True, "size": 13}),
        ("источник истины для", {"size": 13, "color": MUTED}),
        ("чтения и инвариантов", {"size": 13, "color": MUTED}),
    ], tsize=16)
    d.pill(1855, 1228, "DS1", BLUE)
    d.box(1960, 930, 275, 315, "Журнал EVM, квитанции", [
        ("ServiceRegistered", {"mono": True, "size": 13}),
        ("ServiceRevoked", {"mono": True, "size": 13}),
        ("RoleGranted / RoleRevoked", {"mono": True, "size": 13}),
        ("Paused / Unpaused", {"mono": True, "size": 13}),
        ("receipt: status, gasUsed, logs", {"size": 13}),
        ("откат: status 0,", {"size": 13, "color": RED, "weight": 600}),
        ("событий в журнале НЕТ", {"size": 13, "color": RED, "weight": 600}),
    ], tsize=16)
    d.pill(2095, 1228, "DS2", BLUE)
    d.pill(2155, 1228, "DS3", BLUE)

    # ---------------- TB5 мониторинг ----------------
    d.zone(2300, Z_TOP, 370, Z_H, "Мониторинг", "monitor", tag="TB5", sub="сервер оператора")
    d.box(2320, 210, 330, 300, "Коллектор :8787", [
        "POST /telemetry — только app/rpc",
        "CORS: localhost:5173",
        "≤ 64 КБ, ≤ 50 записей",
        "GET /alerts · /invariants",
        "секреты вырезаются",
    ], header="monitor.mjs · Node 22", header_color=TEAL, tsize=17, lsize=13.5)
    d.pills(2340, 492, [("AP7 CORS + фильтр категорий", RED)])
    d.box(2320, 530, 330, 270, "Опрос цепи (1 с)", [
        "новые блоки → tx к контракту",
        "квитанции, включая status 0",
        "события контракта",
        "replay eth_call → причина",
        "ошибки и таймауты RPC (3 с)",
    ], tsize=17, lsize=13.5, stroke=TEAL)
    d.box(2320, 820, 330, 265, "Детектор правил", [
        ("R1 доступ: ≥ 3 за 300 с · HIGH", {"color": RED, "weight": 600}),
        ("R2 сбой RPC: ≥ 3 за 60 с · MEDIUM", {"color": AMBER, "weight": 600}),
        "cooldown 600 / 300 с —",
        "повторные тревоги подавляются",
        "resolved после восстановления",
    ], tsize=17, lsize=13.5, stroke=TEAL)
    d.box(2320, 1105, 330, 140, "Журналы", ["telemetry.jsonl · alerts.jsonl", "→ дежурный, вебхук (поток 10)"], tsize=17, lsize=13.5, stroke=TEAL)

    # ---------------- TB6 CI ----------------
    d.zone(370, 1420, 2300, 400, "Цепочка поставки и CI — GitHub Actions", "ci", tag="TB6")
    d.box(400, 1480, 400, 310, "Репозиторий mr5", [
        "contracts/ — Foundry, OZ, тесты",
        "web/ — dApp, монитор, нагрузка",
        ".github/workflows/ci.yml",
        ".env.example — без секретов",
        "README.md, docs/ — доказательства",
    ], header="git · подмодули forge-std, OpenZeppelin", header_color=GREY, tsize=17, lsize=14)
    d.box(860, 1480, 560, 310, "Задача contracts", [
        "checkout + подмодули",
        "проверка OpenZeppelin ≥ 5.4.0",
        "forge build --sizes",
        "forge test: unit + fuzz + 3 инварианта (профиль ci)",
        "Slither --fail-medium",
    ], header="ubuntu-latest · Foundry v1.5.1", header_color=GREY, tsize=17, lsize=14)
    d.box(1480, 1480, 560, 310, "Задача web", [
        "npm ci — строго по package-lock.json",
        "npm audit --audit-level=high",
        "vite build — сборка dApp",
        "vitest: 12 интеграционных (Anvil)",
        "+ 8 тестов правил мониторинга",
    ], header="ubuntu-latest · Node 22 · Foundry (anvil)", header_color=GREY, tsize=17, lsize=14)
    d.box(2100, 1480, 540, 310, "Внешние зависимости", [
        "npm: ethers 6.17, react 19.3, vite 8.3",
        "GitHub: OpenZeppelin v5.7.0, forge-std",
        "actions: checkout, setup-node,",
        "setup-python, foundry-toolchain",
        "solc 0.8.30 · slither 0.11.6",
    ], tsize=17, lsize=14)
    d.pills(2120, 1770, [("AP8 GITHUB_TOKEN: contents read", RED)])
    d.flow([(800, 1635), (860, 1635)], 12, None)
    d.label(830, 1600, "push / PR", 12.5)
    d.line([(1420, 1635), (1480, 1635)], color=GREY, dash="7 5")
    d.label(1450, 1600, "параллельно", 12)
    d.line([(2100, 1570), (2040, 1570)], color=GREY, dash="7 5")
    d.line([(2100, 1700), (1420, 1700)], color=GREY, dash="7 5")

    # ---------------- потоки ----------------
    # 1 — действия пользователя в UI
    for yy in (285, 455, 625):
        d.line([(310, yy), (400, yy)], color=INK, sw=2.2)
    d.num(355, 285, 1)
    d.label(355, 330, "действия\nв UI", 12.5)
    # 11 — файл акта -> хеш в браузере
    d.flow([(310, 1135), (352, 1135), (352, 720), (400, 720)], 11, None, color=PURPLE, nat=(352, 960))
    d.label(352, 1010, "файл\nакта", 12.5, PURPLE)
    # 2 — EIP-1193 соединение (двунаправленный)
    d.flow([(870, 770), (870, 880)], 2, None, both=True, nat=(870, 798))
    d.label(848, 803, "аккаунт, chainId", 12.5, anchor="end")
    # 4 — запрос подписи
    d.flow([(1015, 770), (1015, 880)], 4, None, nat=(1015, 798))
    d.label(1033, 806, "запрос подписи", 12.5, anchor="start")
    # 3 — чтение через RPC dApp
    d.flow([(1110, 330), (1205, 330)], 3, None, both=True, nat=(1157, 330), color=BLUE)
    d.label(1157, 378, "eth_call,\neth_getLogs", 12.5, BLUE)
    # 5 — подписанная транзакция в RPC
    d.flow([(1080, 1050), (1150, 1050), (1150, 700), (1205, 700)], 5, None, nat=(1150, 880))
    d.label(1150, 930, "signed tx", 12.5)
    # 7 — квитанция и события обратно в dApp
    d.flow([(1205, 560), (1110, 560)], 7, None, nat=(1157, 560), color=GREEN)
    d.label(1157, 608, "квитанция,\nсобытия", 12.5, GREEN)
    # 6 — включение в блок / исполнение
    d.flow([(1575, 420), (1665, 420)], 6, None, nat=(1620, 420))
    d.label(1620, 468, "блок,\nисполнение\nEVM", 12.5)
    # 7 — из цепи в RPC
    d.flow([(1665, 640), (1575, 640)], None, None, color=GREEN)
    d.num(1620, 640, 7, GREEN)
    d.label(1620, 688, "receipt,\nlogs", 12.5, GREEN)
    # 8 — прикладной журнал dApp -> коллектор (по нижнему коридору)
    d.flow([(1110, 740), (1162, 740), (1162, 1296), (2276, 1296), (2276, 380), (2320, 380)], 8, None, color=TEAL, dash="9 6", nat=(1700, 1296))
    d.label(1420, 1356, "8 — прикладной журнал dApp: POST /telemetry, correlationId", 13, TEAL)
    # 9 — опрос цепи монитором через RPC
    d.flow([(2320, 690), (2290, 690), (2290, 1318), (1620, 1318), (1620, 820), (1575, 820)], 9, None, color=TEAL, dash="9 6", nat=(2000, 1318))
    d.label(2040, 1386, "9 — опрос монитором: блоки, квитанции, логи, replay eth_call", 13, TEAL)
    # 10 — тревоги
    d.flow([(2485, 1085), (2485, 1105)], None, None, color=RED)
    d.num(2600, 1095, 10, RED)

    # ---------------- справочники AP / DS / легенда ----------------
    ap = [
        ("AP1", "UI-подсказка по ролям (hasRole) — НЕ граница безопасности, кнопки не скрываются"),
        ("AP2", "dApp: chainId кошелька = 31337, иначе запись заблокирована, кнопка «Переключить на Anvil»"),
        ("AP3", "Кошелёк: пользователь подтверждает транзакцию, подпись EIP-155 с chainId"),
        ("AP4", "dApp: симуляция eth_call до подписи — откат виден заранее, газ не тратится"),
        ("AP5", "Контракт: onlyRole(…) — единственная авторитетная проверка полномочий"),
        ("AP6", "Контракт: whenNotPaused — аварийная остановка записи"),
        ("AP7", "Коллектор: CORS + приём только категорий app/rpc, ограничение размера"),
        ("AP8", "CI: GITHUB_TOKEN только contents: read"),
    ]
    ds = [
        ("DS1", "Состояние контракта (storage) — eth_call"),
        ("DS2", "Журнал событий EVM — eth_getLogs (только успешные транзакции)"),
        ("DS3", "Квитанции — eth_getTransactionReceipt (status 0 у откатов)"),
        ("DS4", "Прикладной журнал dApp — этапы транзакций, отказы предпроверки"),
        ("DS5", "Ошибки и таймауты RPC — у монитора и у клиентов"),
        ("DS6", "Off-chain акт ТО — файл пользователя, в сеть уходит только хеш"),
        ("DS7", "deployment.json — адрес контракта и блок развёртывания"),
    ]
    y0 = 1870
    d.rect(370, y0, 1150, 300, fill="#fff", stroke="#d0d5dd", sw=1.2, rx=10)
    d.text(390, y0 + 32, "Точки проверки полномочий и защиты (AP)", 17, 700, RED)
    for i, (k, v) in enumerate(ap):
        d.pill(390, y0 + 70 + i * 29, k, RED if k != "AP1" else "#98a2b3", size=12)
        d.text(450, y0 + 70 + i * 29, v, 13.5)
    d.rect(1550, y0, 1120, 300, fill="#fff", stroke="#d0d5dd", sw=1.2, rx=10)
    d.text(1570, y0 + 32, "Источники данных (DS)", 17, 700, BLUE)
    for i, (k, v) in enumerate(ds):
        d.pill(1570, y0 + 70 + i * 31, k, BLUE, size=12)
        d.text(1630, y0 + 70 + i * 31, v, 13.5)
    d.legend(30, 1420, [
        ("zone", RED, "доверительная граница TB"),
        ("arrow", INK, "вызов / поток данных"),
        ("arrow", GREEN, "результат: квитанция, события"),
        ("arrow", BLUE, "чтение через RPC dApp"),
        ("dash", TEAL, "телеметрия и мониторинг"),
        ("num", INK, "номер потока (порядок)"),
        ("strong", RED, "авторитетная проверка"),
        ("pill", RED, "AP — точка проверки"),
        ("pill", BLUE, "DS — источник данных"),
    ], w=310)
    return d
