#!/usr/bin/env bash

# Every machine already carries a coarse location: tzdata ships the coordinates
# of each zone's reference city in zone1970.tab. A zone resolves to within a few
# kilometres of where the user actually is, which is far finer than sunrise
# times can tell apart, and it is correct from first boot with nothing
# configured and no network.
#
# Prints "<zone>\t<ISO 6709 coordinates>" and nothing at all when the zone
# cannot be resolved or is missing from the tables.

zoneinfo="${TZDIR:-/usr/share/zoneinfo}"

# TZ wins when set. A leading colon is allowed by POSIX; an absolute value
# names a file rather than a zone, so it resolves against the zoneinfo tree.
zone="${TZ#:}"

if [[ $zone == /* ]]; then
  link=$(readlink -f "$zone" 2>/dev/null)
  zone="${link#"$zoneinfo"/}"
elif [[ -z $zone ]]; then
  # timedatectl first: it reports the name whether /etc/localtime is a symlink
  # or a plain copy, and readlink cannot tell you the zone of a copy at all.
  zone=$(timedatectl show -p Timezone --value 2>/dev/null)

  # Without systemd the symlink is the usual record, and Debian and Ubuntu also
  # write the name out. A copied /etc/localtime on a system with neither is the
  # one case left unresolvable; it falls through to the other location sources.
  if [[ -z $zone || $zone == "n/a" ]]; then
    link=$(readlink -f /etc/localtime 2>/dev/null)
    zone="${link#"$zoneinfo"/}"
    [[ -z $zone || $zone == /* ]] && [[ -r /etc/timezone ]] && zone=$(</etc/timezone)
  fi
fi

zone="${zone//[[:space:]]/}"
[[ -n $zone && $zone != /* ]] || exit 0

# zone1970.tab is the current table; zone.tab additionally carries zones kept
# only for backward compatibility. Field 2 is the coordinates, field 3 the zone
# name.
lookup() {
  local candidate=$1 table
  for table in "$zoneinfo/zone1970.tab" "$zoneinfo/zone.tab"; do
    [[ -f $table ]] || continue

    local coordinates
    coordinates=$(awk -F'\t' -v zone="$candidate" \
      '$1 !~ /^#/ && $3 == zone { print $2; exit }' "$table")

    if [[ -n $coordinates ]]; then
      printf '%s\t%s\n' "$candidate" "$coordinates"
      return 0
    fi
  done
  return 1
}

lookup "$zone" && exit 0

# Renamed zones such as Australia/Canberra and US/Eastern are absent from both
# tables. tzdata hard-links them to the zone that replaced them, so the sibling
# that does appear in a table is the modern name for the same place. Zones with
# no geography at all, like UTC, correctly resolve to nothing.
while IFS= read -r sibling; do
  lookup "${sibling#"$zoneinfo"/}" && exit 0
done < <(find "$zoneinfo" -samefile "$zoneinfo/$zone" 2>/dev/null)
