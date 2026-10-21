#!/usr/bin/env bash
# Локальная репетиция CI: те же шаги и в том же порядке, что в .github/workflows/ci.yml.
# Запуск из корня репозитория:  bash scripts/ci-local.sh 2>&1 | tee ci-local.log
set -euo pipefail
cd "$(dirname "$0")/.."
step() { printf '\n========== %s ==========\n' "$*"; }

step "contracts: версии инструментов"
(cd contracts && forge --version && anvil --version)
step "contracts: проверка зависимости OpenZeppelin (>= 5.4.0)"
(cd contracts && bash ../scripts/check-oz-version.sh lib/openzeppelin-contracts/package.json 5.4.0)
step "contracts: сборка"
(cd contracts && FOUNDRY_PROFILE=ci forge build --sizes)
step "contracts: тесты Foundry (unit, fuzz, 3 инварианта), профиль ci"
(cd contracts && FOUNDRY_PROFILE=ci forge test -vv)
step "contracts: Slither (порог Medium)"
(cd contracts && slither --version && slither . --filter-paths "lib/|test/" --fail-medium)

step "web: сборка контракта (артефакт для деплоя в тестах; Slither пересобирает out/ без test/)"
(cd contracts && forge build)
step "web: npm ci"
(cd web && npm ci --no-fund)
step "web: npm audit (порог high)"
(cd web && npm audit --audit-level=high)
step "web: сборка dApp"
(cd web && npm run build)
step "web: интеграционные тесты (Anvil) и тесты правил мониторинга"
(cd web && npm test)

printf '\nCI (локально): все шаги пройдены\n'
