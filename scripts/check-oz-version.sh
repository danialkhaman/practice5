#!/usr/bin/env bash
# Проверка зависимости OpenZeppelin Contracts: версия не ниже минимальной исправленной.
# 5.4.0 — первая версия без GHSA-9rcw-c2f9-2j55 (Bytes.lastIndexOf, out-of-bounds read; затронуты 5.2.0–5.3.x).
# Использование: check-oz-version.sh <путь к package.json OpenZeppelin> <минимальная версия>
set -euo pipefail
pkg="${1:?путь к package.json}"
min="${2:?минимальная версия}"
ver=$(grep -m1 '"version"' "$pkg" | sed -E 's/.*"version": *"([^"]+)".*/\1/')
lowest=$(printf '%s\n%s\n' "$min" "$ver" | sort -V | head -n1)
if [ "$lowest" != "$min" ]; then
  echo "FAIL: OpenZeppelin Contracts $ver < $min (есть известные уязвимости, обновите библиотеку)"
  exit 1
fi
echo "OK: OpenZeppelin Contracts $ver >= $min"
