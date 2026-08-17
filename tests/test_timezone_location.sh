#!/usr/bin/env bash
set -euo pipefail

script=$(dirname "$0")/../TimezoneLocation.sh

expect_zone() {
  local zone=$1 expected=$2
  local actual
  actual=$(TZ="$zone" bash "$script")
  if [[ $actual != "$expected" ]]; then
    printf 'FAIL timezone %s\nexpected: %s\nactual:   %s\n' "$zone" "$expected" "$actual" >&2
    exit 1
  fi
}

expect_zone America/Monterrey $'America/Monterrey\t+2540-10019'
expect_zone Australia/Melbourne $'Australia/Melbourne\t-3749+14458'
expect_zone UTC ""

# Renamed / linked zones should resolve through tzdata hard links.
linked=$(TZ=US/Eastern bash "$script")
if [[ $linked != *$'\t'* ]]; then
  printf 'FAIL linked zone US/Eastern produced no coordinates: %s\n' "$linked" >&2
  exit 1
fi

printf 'ok - timezone location resolves zoneinfo coordinates\n'
