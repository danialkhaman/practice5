"""Уровень 3 — компоненты dApp, смарт-контракта и мониторинга."""
from svglib import Diagram, RED, BLUE, GREEN, AMBER, PURPLE, TEAL, GREY, INK, MUTED, LINE


def M(s, color=INK, size=13):
    return (s, {"mono": True, "size": size, "color": color})


def B(s, color=INK):
    return (s, {"weight": 700, "color": color, "gap": 6})


def build():
    d = Diagram(2860, 2280, "Архитектура · уровень 3 — компоненты dApp, смарт-контракта и мониторинга",
                "Модули репозитория mr5, связи между ними и место каждой проверки (подсказка → блокировка на клиенте → авторитетная проверка в контракте → обнаружение)")

    # ================= C1 dApp =================
    d.zone(30, 140, 990, 1400, "dApp: web/src + web/shared", "browser", tag="C1", sub="выполняется в браузере пользователя (TB1)")
    d.box(60, 200, 440, 330, "App.jsx — интерфейс", [
        "Шапка: адрес, chainId, «Завершить сеанс»",
        "Чтение: totalRecords, paused, роли (hasRole)",
        "getLastService + serviceCount по станку",
        "verifyDocument: keccak256(файла)",
        "Формы: registerService, revoke, pause,",
        "unpause, grantRole(TECHNICIAN)",
        "Ход транзакции: 4 этапа + итог",
        "Лента событий, прикладной журнал",
    ], header="src/App.jsx · React 19", header_color=BLUE, tsize=17, lsize=13.5)
    d.box(550, 200, 440, 230, "wallet.js — кошелёк (EIP-1193)", [
        M("requestAccount → eth_requestAccounts"),
        M("readChainId → eth_chainId"),
        M("revokeSession → wallet_revokePermissions"),
        M("switchToAnvil → wallet_switchEthereumChain"),
        M("  4902 → wallet_addEthereumChain"),
    ], header="src/wallet.js", header_color=PURPLE, tsize=16, lsize=13.5)
    d.box(60, 570, 440, 470, "RegistryClient", [
        B("Чтение (provider dApp)"),
        M("totalRecords · paused · rolesOf"),
        M("getLastService · serviceCount"),
        M("verifyDocument"),
        B("Запись (signer кошелька)"),
        M("registerService · revokeLastService"),
        M("pause · unpause · grantTechnician"),
        B("sendTx(method, args, opts)"),
        M("1 assertNetwork()  chainId = 31337", RED),
        M("2 staticCall()     предпроверка", RED),
        M("3 contract[method]() → подпись"),
        M("4 tx.wait()        квитанция"),
        M("5 status 0 → decodeFailedReceipt"),
        M("  onStage → UI и телеметрия"),
    ], header="shared/registry.js", header_color=BLUE, tsize=17, lsize=13.5)
    d.box(550, 470, 440, 250, "errors.js — классификация ошибок", [
        M("decodeError(err) →"),
        M("  USER_REJECTED · WRONG_NETWORK"),
        M("  REVERT · RPC · UNKNOWN"),
        "поиск revert data в дереве ошибки",
        M("parseRevertData → custom error + args"),
        "сообщения для пользователя по-русски",
    ], header="shared/errors.js", header_color=BLUE, tsize=16, lsize=13.5)
    d.box(550, 760, 440, 210, "events.js — лента событий", [
        M("fetchEvents → queryFilter('*', from, to)"),
        M("EventFeed: Map((txHash, logIndex))"),
        "дубль → отбрасывается, счётчик дублей",
        "6 типов: ServiceRegistered, …Revoked,",
        "Paused, Unpaused, RoleGranted/Revoked",
    ], header="shared/events.js", header_color=BLUE, tsize=16, lsize=13.5)
    d.box(550, 1010, 440, 210, "telemetry.js — прикладной журнал", [
        M("createTelemetry({source, sinks})"),
        M("newCorrelationId() → UUID v4"),
        "ts в UTC (ISO-8601), категория, событие",
        M("redact: privateKey, mnemonic, password,"),
        M("  secret, signature, token → [REDACTED]"),
    ], header="shared/telemetry.js", header_color=BLUE, tsize=16, lsize=13.5)
    d.box(60, 1080, 440, 190, "config.js + abi.js", [
        M("EXPECTED_CHAIN_ID = 31337"),
        M("ROLES · SERVICE_CODES 101/201/301/401"),
        M("machineIdToBytes32 (≤ 31 ASCII)"),
        M("REGISTRY_ABI: функции, события, ошибки"),
    ], header="shared/config.js · shared/abi.js", header_color=GREY, tsize=16, lsize=13.5)
    d.box(550, 1260, 440, 190, "invariants.js — проверка по журналу", [
        M("checkInvariants(provider, address)"),
        "I1 роль инициатора на блоке события",
        "I2 totalRecords = событий = Σ serviceCount",
        "I3 нет регистраций между Paused/Unpaused",
    ], header="shared/invariants.js", header_color=GREEN, tsize=16, lsize=13.5)
    d.box(60, 1310, 440, 200, "Внешние интерфейсы C1", [
        M("window.ethereum   → MetaMask (подпись)", PURPLE),
        M("JsonRpcProvider   → RPC dApp (чтение)", BLUE),
        M("fetch POST        → коллектор :8787", TEAL),
        M("/deployment.json  → адрес контракта", GREY),
    ], fill="#f8faff", tsize=16, lsize=13.5)
    # связи внутри C1
    d.flow([(500, 300), (550, 300)], None, None)
    d.flow([(280, 530), (280, 570)], None, None)
    d.flow([(500, 640), (550, 640)], None, None)
    d.flow([(500, 880), (550, 880)], None, None)
    d.flow([(500, 1010), (525, 1010), (525, 1100), (550, 1100)], None, None, color=TEAL)
    d.flow([(280, 1040), (280, 1080)], None, None, color=GREY)
    d.label(763, 446, "использует", 12, MUTED)

    # ================= C2 контракт =================
    d.zone(1060, 140, 720, 1400, "Смарт-контракт: contracts/", "chain", tag="C2", sub="исполняется в EVM (TB4); тесты — Foundry")
    d.box(1090, 200, 660, 170, "MaintenanceRegistry is AccessControl, Pausable", [
        M("AccessControl: _roles · hasRole · grantRole · onlyRole"),
        M("  revert AccessControlUnauthorizedAccount(account, role)"),
        M("Pausable: _paused · whenNotPaused · EnforcedPause"),
    ], header="src/MaintenanceRegistry.sol · OpenZeppelin 5.7.0", header_color=GREEN, tsize=16, lsize=13.5)
    d.box(1090, 400, 660, 520, "Функции и порядок проверок", [
        B("registerService(machineId, code, ts, docHash)", GREEN),
        M("  ① onlyRole(TECHNICIAN_ROLE)   AP5", RED),
        M("  ② whenNotPaused               AP6", RED),
        M("  ③ machineId ≠ 0 · code ≠ 0 · ts ≤ block.timestamp"),
        M("  ④ lastService[m] = …; serviceCount[m]++; totalRecords++"),
        M("  ⑤ emit ServiceRegistered(m, code, ts, docHash, sender)"),
        B("revokeLastService(machineId)", GREEN),
        M("  ① onlyRole(ADMIN_ROLE)  ② запись есть и не отозвана", RED),
        M("  ③ revoked = true  ④ emit ServiceRevoked(m, sender)"),
        B("pause() / unpause()", GREEN),
        M("  onlyRole(ADMIN_ROLE) → emit Paused / Unpaused", RED),
        B("grantRole / revokeRole", GREEN),
        M("  onlyRole(getRoleAdmin(role)) → RoleGranted/Revoked", RED),
        B("view: getLastService · verifyDocument · totalRecords …", GREEN),
        ("Checks → Effects → Events; внешних вызовов нет", {"size": 13, "color": GREEN, "weight": 600}),
    ], strong=True, tsize=17, lsize=13.5)
    d.box(1090, 950, 320, 250, "Storage", [
        M("lastService[bytes32]"),
        M("  → ServiceRecord"),
        M("serviceCount[bytes32]"),
        M("totalRecords"),
        M("_roles · _paused"),
    ], tsize=16, lsize=13.5)
    d.box(1430, 950, 320, 250, "События и ошибки", [
        M("ServiceRegistered/Revoked"),
        M("RoleGranted/Revoked"),
        M("Paused/Unpaused"),
        M("InvalidServiceCode"),
        M("EmptyMachineId"),
        M("TimestampInFuture"),
        M("NothingToRevoke"),
    ], tsize=16, lsize=13.5)
    d.box(1090, 1230, 660, 290, "Тесты Foundry (contracts/test)", [
        M("MaintenanceRegistry.t.sol   13 тестов ПР №3"),
        M("Security.fuzz.t.sol         F1 F2 F3"),
        M("  1000 прогонов, профиль ci — 5000"),
        M("Security.invariant.t.sol    I1 I2 I3"),
        M("  SecurityHandler: admin / tech / stranger"),
        M("  256×64 вызова, профиль ci — 512×128"),
        M("mocks/…Vulnerable.sol  — дефект ПР №3"),
        M("  негативный контроль для IT12"),
    ], header="forge test", header_color=GREEN, tsize=16, lsize=13.5)

    # ================= C3 мониторинг =================
    d.zone(1820, 140, 950, 1400, "Мониторинг и эксплуатация", "monitor", tag="C3", sub="web/monitor · web/scripts · web/load — сервер оператора (TB5) и стенд")
    d.box(1850, 200, 440, 330, "Опрос цепи — processBlock(n)", [
        M("getBlock(n, prefetchTxs)"),
        M("  tx.to == контракт"),
        M("getTransactionReceipt(hash)"),
        M("status 0 → decodeFailedReceipt"),
        M("  eth_call на блоке n−1 → причина"),
        M("logs → события контракта"),
        M("rpc(): таймаут 3 с"),
        M("  rpc.error / rpc.recovered"),
    ], header="monitor/monitor.mjs", header_color=TEAL, tsize=16, lsize=13.5)
    d.box(2310, 200, 440, 250, "HTTP-коллектор :8787", [
        M("POST /telemetry  ← журнал dApp"),
        "фильтр: только категории app, rpc",
        "CORS: только localhost:5173",
        "≤ 64 КБ на запрос, ≤ 50 записей",
        M("GET /health · /alerts · /invariants"),
    ], header="monitor/monitor.mjs", header_color=TEAL, tsize=16, lsize=13.5)
    d.box(1850, 570, 440, 420, "Detector — правила", [
        M("signalsOf(record) → сигналы"),
        B("R1 «нарушение доступа»", RED),
        "receipt status 0 или tx.error",
        M("  name = AccessControlUnauthorizedAccount"),
        "≥ 3 за 300 с от адреса · HIGH",
        B("R2 «сбой RPC»", AMBER),
        "rpc.error / tx.error kind RPC",
        "≥ 3 за 60 с на endpoint · MEDIUM",
        B("Защита от повторов"),
        "одна tx считается один раз (txHash)",
        "cooldown 600 / 300 с → alert.suppressed",
    ], header="monitor/rules.mjs", header_color=TEAL, tsize=16, lsize=13.5)
    d.box(2310, 490, 440, 500, "Выходы монитора", [
        M("logs/telemetry.jsonl"),
        "все записи: receipt, event, app, rpc,",
        "alert.suppressed, invariant",
        M("logs/alerts.jsonl"),
        "alert.fired, alert.resolved",
        "консоль (цветом)",
        M("ALERT_WEBHOOK_URL → вебхук"),
        "(необязательно, URL — только в .env)",
        B("Реакция дежурного"),
        "R1: проверить адрес и роли,",
        "при продолжении — pause(), отзыв ролей",
        "R2: резервный RPC, проверка узла",
    ], header="журналы и оповещения", header_color=TEAL, tsize=16, lsize=13.5)
    d.box(1850, 1030, 440, 200, "Сценарии демонстрации", [
        M("scripts/scenario.mjs normal"),
        "штатная работа → тревог нет",
        M("scripts/scenario.mjs attack"),
        "→ R1 на 3-м сигнале, 4-й подавлен",
    ], header="scripts/scenario.mjs", header_color=GREY, tsize=16, lsize=13.5)
    d.box(2310, 1030, 440, 200, "Развёртывание стенда", [
        M("anvil.mjs · deploy.mjs"),
        "#0 admin · #1 инженер · #2 посторонний",
        "#3–#7 клиенты нагрузки",
        M("→ public/deployment.json"),
    ], header="scripts/deploy.mjs", header_color=GREY, tsize=16, lsize=13.5)
    d.box(1850, 1260, 900, 130, "Нагрузочный эксперимент", [
        M("loadtest.mjs: S (30 подряд) · P (5 × 6) · Q (конвейер) × blocktime1 / automine"),
        M("nonce — локально; задержка = отправка → квитанция; plot.py → 4 графика"),
    ], header="load/", header_color=GREY, tsize=16, lsize=13.5)
    d.box(1850, 1410, 900, 115, "Автотесты vitest", [
        M("integration.test.js IT1–IT12 (Anvil) · rules.test.js — 8 тестов правил"),
    ], header="npm test", header_color=GREY, tsize=16, lsize=13.5)
    d.flow([(2070, 530), (2070, 570)], None, None, color=TEAL)
    d.flow([(2310, 400), (2300, 400), (2300, 660), (2290, 660)], None, None, color=TEAL)
    d.flow([(2290, 860), (2310, 860)], None, None, color=TEAL)

    # ================= связи между контейнерами =================
    d.flow([(500, 760), (560, 760), (560, 742), (1030, 742), (1030, 600), (1090, 600)], 1, None, color=INK, nat=(700, 742))
    d.label(880, 747, "транзакция: кошелёк → RPC → EVM", 12.5)
    d.flow([(1090, 830), (1040, 830), (1040, 980), (1000, 980)], 2, None, color=GREEN, nat=(1040, 905))
    d.label(1040, 950, "квитанция,\nсобытия", 12.5, GREEN)
    d.flow([(990, 1115), (1044, 1115), (1044, 1562), (2815, 1562), (2815, 330), (2750, 330)], 3, None, color=TEAL, dash="9 6", nat=(1500, 1562))
    d.label(1900, 1590, "прикладной журнал dApp: POST /telemetry (correlationId) → коллектор", 13, TEAL)
    d.flow([(1850, 300), (1750, 300)], 4, None, color=TEAL, dash="9 6", nat=(1800, 300))
    d.label(1800, 346, "опрос\nчерез\nRPC", 12.5, TEAL)

    # ================= где выполняется каждая проверка =================
    y0 = 1630
    d.rect(30, y0, 2800, 620, fill="#fff", stroke="#d0d5dd", sw=1.2, rx=12)
    d.text(54, y0 + 40, "Где выполняется каждая проверка и что она гарантирует", 20, 700)
    cols = [(54, "Проверка"), (640, "Компонент"), (1240, "Тип"), (1640, "Что даёт / почему не заменяет контракт")]
    for x, t in cols:
        d.text(x, y0 + 84, t, 15, 700, MUTED)
    rows = [
        ("Роли в интерфейсе (hasRole)", "App.jsx", "подсказка", GREY, "UX: объясняет, что вызов откатится; обходится правкой кода или cast"),
        ("chainId = 31337", "RegistryClient.assertNetwork", "блокировка на клиенте", AMBER, "не даёт подписать в чужой сети; EIP-155 дополнительно защищает подпись"),
        ("Симуляция eth_call до подписи", "RegistryClient (staticCall)", "предупреждение", AMBER, "откат виден до подписи, газ не тратится; обходится отправкой в обход dApp"),
        ("Согласие пользователя", "MetaMask (окно подписи)", "согласие", PURPLE, "ключ не покидает кошелёк; защищает от тихой подписи, не от ошибки пользователя"),
        ("onlyRole(TECHNICIAN / ADMIN / DEFAULT_ADMIN)", "MaintenanceRegistry (EVM)", "АВТОРИТЕТНАЯ", RED, "единственная проверка, которую нельзя обойти: выполняется консенсусом"),
        ("whenNotPaused · проверки данных", "MaintenanceRegistry (EVM)", "АВТОРИТЕТНАЯ", RED, "аварийная остановка записи; InvalidServiceCode, EmptyMachineId, TimestampInFuture"),
        ("R1 / R2, дедупликация тревог", "monitor Detector", "обнаружение", TEAL, "не предотвращает, а сообщает: попытки без роли, сбой RPC; без повторных уведомлений"),
        ("Инварианты I1–I3, fuzz F1–F3", "Foundry + invariants.js", "верификация", GREEN, "доказывает свойства на тысячах случайных сценариев и по журналу развёрнутого контракта"),
        ("Slither, npm audit, версия OZ ≥ 5.4.0", "CI GitHub Actions", "контроль поставки", GREY, "останавливает сборку при Medium+ в коде и High+ в зависимостях"),
    ]
    for i, (a, b, c, col, e) in enumerate(rows):
        yy = y0 + 124 + i * 52
        if i % 2 == 0:
            d.rect(40, yy - 30, 2780, 52, fill="#f8f9fb", stroke="none", sw=0, rx=6)
        d.text(54, yy, a, 15, 600)
        d.text(640, yy, b, 14.5, 400, INK, mono=True)
        d.pill(1240, yy + 2, c, col, size=13)
        d.text(1640, yy, e, 14.5)
    return d
