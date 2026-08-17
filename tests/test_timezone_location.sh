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

# Ubuntu's default tzdata drops backward-compat names like US/Eastern.
# Drive the renamed-zone path with a tiny TZDIR so CI does not depend on
# tzdata-legacy, and cover both the symlink (Debian) and hard-link (Arch) cases.
fixture=$(mktemp -d)
trap 'rm -rf "$fixture"' EXIT
mkdir -p "$fixture/America" "$fixture/US"
printf 'US\t+404251-0740023\tAmerica/New_York\tEastern\n' >"$fixture/zone1970.tab"
: >"$fixture/America/New_York"
ln -s ../America/New_York "$fixture/US/Eastern"
ln "$fixture/America/New_York" "$fixture/US/EasternHard"

expect_renamed() {
  local zone=$1
  local actual
  actual=$(TZDIR="$fixture" TZ="$zone" bash "$script")
  if [[ $actual != $'America/New_York\t+404251-0740023' ]]; then
    printf 'FAIL renamed zone %s\nexpected: America/New_York\t+404251-0740023\nactual:   %s\n' \
      "$zone" "$actual" >&2
    exit 1
  fi
}

expect_renamed US/Eastern
expect_renamed US/EasternHard

printf 'ok - timezone location resolves zoneinfo coordinates\n'
