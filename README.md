# mr5 — ПР №5, вариант 8 «Промышленность»

Web3-клиент, тестирование безопасности, мониторинг угроз и DevSecOps для смарт-контракта
`MaintenanceRegistry` (реестр этапов технического обслуживания оборудования) из ПР №3.
Инструменты: Foundry (чётный вариант), React 19 + ethers.js v6, локальная сеть Anvil.

> Только тестовые аккаунты Anvil и синтетические данные. Закрытых ключей, seed-фраз и паролей
> в репозитории нет: скрипты используют разблокированные аккаунты локального узла.

## Структура

```
contracts/                      Foundry-проект
  src/MaintenanceRegistry.sol     исправленный контракт из ПР №3 (AccessControl + Pausable)
  test/MaintenanceRegistry.t.sol  13 тестов из ПР №3
  test/Security.fuzz.t.sol        F1–F3: fuzz/property-тесты
  test/Security.invariant.t.sol   I1–I3: три инварианта безопасности (handler + ghost-переменные)
  test/mocks/…Vulnerable.sol      уязвимая версия ПР №3 — только негативный контроль в тестах
  lib/                            подмодули forge-std, OpenZeppelin v5.7.0
web/                            Node-проект (Node ≥ 22.12)
  src/                            dApp: App.jsx, wallet.js (EIP-1193), styles.css
  shared/                         общий слой dApp/тестов/монитора: registry.js (этапы транзакции),
                                  errors.js, events.js (дедупликация), telemetry.js, invariants.js
  monitor/                        монитор: коллектор :8787, опрос цепи, правила R1/R2 (rules.mjs)
  scripts/                        anvil.mjs, deploy.mjs, scenario.mjs (normal | attack)
  load/                           loadtest.mjs (профили S, P, Q), plot.py (графики)
  test/integration.test.js        IT1–IT12 на настоящем Anvil
.github/workflows/ci.yml        CI: сборка, тесты, Slither, npm audit, версия OpenZeppelin
scripts/                        check-oz-version.sh, ci-local.sh (репетиция CI)
docs/diagrams/                  архитектура (3 уровня) и DFD (уровни 0–2): SVG + PNG + исходники
docs/evidence/                  журналы прогонов: тесты, Slither, npm audit, мониторинг, нагрузка
docs/screenshots-reference/     эталонные скриншоты интерфейса
```

## Быстрый старт (Ubuntu / WSL)

```bash
# 0. один раз: git-репозиторий и зависимости
git init
cd contracts
forge install foundry-rs/forge-std@v1.17.0 OpenZeppelin/openzeppelin-contracts@v5.7.0
forge build && cd ..
cd web && npm ci && cd ..
cp .env.example .env

# 1. узел (отдельный терминал)
anvil --host 0.0.0.0

# 2. деплой и роли: #0 админ, #1 инженер ТО, #2 посторонний, #3–#7 клиенты нагрузки
cd web && npm run deploy:local

# 3. монитор (отдельный терминал)
cd web && npm run monitor

# 4. dApp (отдельный терминал) → http://localhost:5173
cd web && npm run dev
```

MetaMask: сеть `http://127.0.0.1:8545`, chainId `31337`; импортируйте тестовые аккаунты #0, #1, #2
из вывода `anvil` (не публикуйте эти ключи и скриншоты со списком ключей).

## Проверки

| Команда | Что делает |
|---|---|
| `cd contracts && forge test -vv` | 19 тестов: unit, fuzz F1–F3, инварианты I1–I3 |
| `cd contracts && slither . --filter-paths "lib/\|test/" --fail-medium` | статический анализ |
| `cd web && npm test` | 12 интеграционных (Anvil) + 8 тестов правил мониторинга |
| `cd web && npm audit --audit-level=high` | проверка зависимостей |
| `cd web && npm run scenario:normal` / `scenario:attack` | демонстрация мониторинга |
| `cd web && npm run load && npm run load:plot` | нагрузочный эксперимент и графики |
| `bash scripts/ci-local.sh` | все шаги CI локально |

## Безопасность

- Авторизация — только в контракте (`onlyRole`); интерфейс лишь подсказывает.
- Успех транзакции определяется по квитанции (`status = 1`), а не по полученному хешу.
- Откатившаяся транзакция не оставляет событий: монитор читает квитанции и прикладной журнал.
- Телеметрия вырезает поля с ключами, мнемониками, паролями, подписями, токенами.
- `.env` в `.gitignore`; в репозитории только `.env.example` без секретов.
