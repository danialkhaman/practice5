"""DFD уровень 2 — детализация процесса 3.0 «Формирование, подпись и отправка транзакции»."""
from svglib import Diagram, RED, BLUE, GREEN, AMBER, PURPLE, TEAL, GREY, INK, MUTED, LINE


def stage(d, x, y, w, s, color):
    d.rect(x, y, w, 34, fill=color, stroke=color, rx=17)
    d.text(x + w / 2, y + 23, s, 14.5, 700, "#fff", "middle")


def build():
    d = Diagram(2900, 1820, "DFD · уровень 2 — процесс 3.0 «Формирование, подпись и отправка транзакции»",
                "Подпроцессы 3.1–3.8, этапы, которые видит пользователь, выходы ошибок и проверки (AP) на каждом шаге — реализация shared/registry.js → sendTx()")

    # доверительные границы
    d.zone(30, 300, 1690, 820, "Браузер: dApp", "browser", tag="TB1")
    d.zone(1760, 300, 400, 820, "Кошелёк", "wallet", tag="TB2")
    d.zone(2200, 300, 260, 820, "RPC", "rpc", tag="TB3")
    d.zone(2500, 300, 370, 820, "EVM", "chain", tag="TB4")

    # этапы для пользователя (полоса сверху)
    d.text(40, 140, "Этапы в интерфейсе (STAGE_LABELS):", 16, 700, MUTED)
    stage(d, 60, 160, 660, "① Проверка сети и симуляция", BLUE)
    stage(d, 1780, 160, 360, "② Ожидание подписи", PURPLE)
    stage(d, 2220, 160, 230, "③ Отправлена", AMBER)
    stage(d, 760, 220, 520, "④ Ожидание подтверждения", AMBER)
    stage(d, 1320, 220, 380, "⑤ Успех / Ошибка", GREEN)

    # внешняя сущность
    d.entity(50, 360, 300, 120, "E1/E2 Пользователь", ["инженер ТО / администратор"])

    # процессы
    P = {}
    def proc(key, x, y, w, h, pid, title, lines, color=BLUE):
        d.process(x, y, w, h, pid, title, lines, color)
        P[key] = (x, y, w, h)

    proc("31", 60, 560, 300, 230, "3.1", "Ввод и валидация", ["machineId → bytes32 (≤ 31 ASCII)", "код ТО из справочника", "файл → keccak256 (локально)"])
    proc("32", 420, 560, 300, 230, "3.2", "Проверка сети", ["eth_chainId == 31337", "AP2: иначе запись", "заблокирована"])
    proc("33", 780, 560, 300, 230, "3.3", "Симуляция вызова", ["staticCall = eth_call", "от адреса пользователя", "AP4: откат до подписи"])
    proc("34", 1800, 560, 320, 230, "3.4", "Подпись в кошельке", ["окно MetaMask: функция,", "адрес контракта, газ", "AP3: решает пользователь"], PURPLE)
    proc("35", 2215, 560, 230, 230, "3.5", "Отправка", ["eth_sendRaw-", "Transaction", "→ txHash"], AMBER)
    proc("36", 780, 860, 300, 230, "3.6", "Ожидание квитанции", ["tx.wait():", "опрос eth_getTransaction-", "Receipt"], AMBER)
    proc("37", 1140, 860, 300, 230, "3.7", "Разбор результата", ["status 1 → события из логов", "status 0 → replay eth_call", "на блоке n−1 → причина"], GREEN)
    proc("38", 1480, 860, 225, 230, "3.8", "Журнал этапа", ["ts UTC, cid,", "method, txHash;", "секреты вырезаны"], TEAL)

    # хранилища
    d.store(1800, 980, 330, 70, "D1", "Ключи кошелька\nне покидают TB2", PURPLE)
    d.store(2520, 400, 330, 70, "D2", "Состояние контракта\nроли, пауза, записи", GREEN)
    d.store(2520, 980, 330, 70, "D3", "Журнал EVM, квитанции\nstatus, gasUsed, logs", GREEN)
    d.store(1440, 690, 265, 70, "D4", "Прикл. журнал\n→ :8787", TEAL)
    d.store(50, 980, 300, 70, "D6", "Акты ТО (off-chain)\nфайл выбирает пользователь", RED)

    # исполнение в EVM (процесс 4.0 с уровня 1 — для контекста)
    d.rect(2520, 560, 330, 230, fill="#fff", stroke=GREEN, sw=2, rx=18, dash="8 5")
    d.text(2685, 600, "4.0 Исполнение в EVM", 16, 700, GREEN, "middle")
    d.text(2685, 630, "(уровень 1)", 13, 400, MUTED, "middle")
    for i, t in enumerate(["onlyRole · whenNotPaused", "проверки данных", "запись или откат"]):
        d.text(2685, 665 + i * 22, t, 13.5, 400, INK, "middle")

    # основные потоки
    d.flow([(200, 480), (200, 560)], 1, None, nat=(200, 520))
    d.label(300, 525, "станок, код,\nкоманда", 12.5, anchor="start")
    d.flow([(200, 980), (200, 790)], 2, None, color=RED, nat=(200, 890))
    d.label(300, 900, "байты файла\n(не уходят в сеть)", 12.5, RED, anchor="start")
    d.flow([(360, 675), (420, 675)], 3, None, nat=(390, 640))
    d.flow([(720, 675), (780, 675)], 4, None, nat=(750, 640))
    d.flow([(1080, 640), (1800, 640)], 5, None, nat=(1600, 640))
    d.label(1600, 610, "calldata без подписи", 12.5)
    # симуляция в EVM
    d.flow([(930, 560), (930, 330), (2685, 330), (2685, 400)], 6, None, color=BLUE, dash="9 6", nat=(1600, 330))
    d.label(1350, 300, "eth_call (симуляция на текущем состоянии, без газа и без подписи)", 13, BLUE)
    # подпись с ключом
    d.flow([(1960, 790), (1960, 980)], 7, None, both=True, color=PURPLE, nat=(1960, 880))
    d.label(2050, 880, "ключ", 12.5, PURPLE)
    d.flow([(2120, 675), (2215, 675)], 8, None, color=PURPLE, nat=(2167, 640))
    d.flow([(2445, 675), (2520, 675)], 9, None, nat=(2482, 640))
    d.flow([(2685, 790), (2685, 980)], 10, None, color=GREEN, nat=(2685, 880))
    d.label(2770, 880, "событие\nили status 0", 12.5, GREEN)
    # квитанция обратно
    d.flow([(2520, 1015), (2470, 1015), (2470, 1160), (930, 1160), (930, 1090)], 11, None, color=GREEN, nat=(1700, 1160))
    d.label(1700, 1196, "квитанция (через RPC): status, blockNumber, gasUsed, logs", 13, GREEN)
    d.flow([(1080, 975), (1140, 975)], 12, None, color=GREEN, nat=(1110, 940))
    # hash -> ожидание
    d.flow([(2330, 560), (2330, 545), (1110, 545), (1110, 900), (1080, 900)], None, None, color=AMBER)
    d.label(1700, 535, "txHash → ожидание квитанции", 12.5, AMBER)
    # результат -> пользователь
    d.flow([(1290, 1090), (1290, 1240), (40, 1240), (40, 430), (50, 430)], 13, None, color=GREEN, nat=(600, 1240))
    d.label(600, 1276, "результат: блок, gasUsed, события — или причина ошибки", 13, GREEN)
    # все этапы -> журнал
    d.flow([(1590, 860), (1590, 760)], 14, None, color=TEAL, nat=(1590, 812))
    d.flow([(1440, 1000), (1480, 1000)], None, None, color=TEAL, dash="7 5")
    d.label(1568, 812, "tx.checking … tx.success / tx.error", 12, TEAL, anchor="end")

    # выходы ошибок
    errs = [
        (420, 800, "3.2 → WRONG_NETWORK", "кнопка «Переключить на Anvil»"),
        (780, 800, "3.3 → REVERT (preflight)", "AccessControlUnauthorized…, EnforcedPause"),
        (1800, 800, "3.4 → USER_REJECTED (4001)", "подпись отклонена"),
        (1145, 1022, "3.7 → REVERT onchain", "status 0, газ потрачен, событий нет"),
    ]
    for x, y, a, b in errs:
        d.rect(x, y + 6, 290, 46, fill="#fdecea", stroke=RED, sw=1.4, rx=8)
        d.text(x + 10, y + 26, a, 13.5, 700, RED)
        d.text(x + 10, y + 44, b, 12, 400, RED)

    # таблица соответствия
    y0 = 1330
    d.rect(30, y0, 2840, 460, fill="#fff", stroke="#d0d5dd", sw=1.2, rx=12)
    d.text(54, y0 + 38, "Соответствие подпроцессов коду и тестам", 18, 700)
    hdr = [(54, "Подпроцесс"), (520, "Код (web/shared/registry.js и др.)"), (1270, "Ошибка / выход"), (1880, "Проверено тестом")]
    for x, t in hdr:
        d.text(x, y0 + 76, t, 14, 700, MUTED)
    rows = [
        ("3.1 Ввод и валидация", "machineIdToBytes32, keccak256(файла)", "исключение формы (до сети)", "IT9 (InvalidServiceCode, TimestampInFuture)"),
        ("3.2 Проверка сети", "RegistryClient.assertNetwork()", "WRONG_NETWORK", "IT7 (chainId 11155111)"),
        ("3.3 Симуляция", "contract[method].staticCall(...)", "REVERT, phase = preflight", "IT3, IT4, IT8"),
        ("3.4 Подпись", "contract[method](...) → кошелёк", "USER_REJECTED (ACTION_REJECTED / 4001)", "IT6 (RejectingSigner)"),
        ("3.5 Отправка", "провайдер кошелька → eth_sendRawTransaction", "RPC (таймаут, недоступен)", "R2 в мониторинге"),
        ("3.6 Ожидание квитанции", "tx.wait()", "—", "IT1 (последовательность этапов)"),
        ("3.7 Разбор результата", "parseReceiptEvents, decodeFailedReceipt", "REVERT, phase = onchain, status 0", "IT5 (событий в журнале нет)"),
        ("3.8 Журнал этапа", "createTelemetry → POST /telemetry", "— (сбой коллектора не роняет UI)", "rules.test.js, демонстрация 3.3"),
    ]
    for i, r in enumerate(rows):
        yy = y0 + 112 + i * 40
        if i % 2 == 0:
            d.rect(40, yy - 26, 2820, 40, fill="#f8f9fb", stroke="none", sw=0, rx=6)
        d.text(54, yy, r[0], 14.5, 600)
        d.text(520, yy, r[1], 14, 400, INK, mono=True)
        d.text(1270, yy, r[2], 14.5, 400, RED if r[2] != "—" else MUTED)
        d.text(1880, yy, r[3], 14.5)
    return d
