.pragma library

var DEFAULTS = {
  enabled: false,
  dayTheme: "Flexoki Light",
  nightTheme: "Matte Black",
  dayStart: 420,
  nightStart: 1140,
  scheduleMode: "fixed",
  latitude: null,
  longitude: null,
  dayOffset: 0,
  nightOffset: 0,
  lastHandledBoundary: ""
}

var RANDOM_LIGHT = "@random-light"
var RANDOM_DARK = "@random-dark"

// Solar constants. The zenith is the standard sunrise/sunset definition:
// 90 degrees plus 0.833 for atmospheric refraction and the solar radius.
var DEGREES = Math.PI / 180
var J2000 = 2451545.0
var SOLAR_ZENITH = 90.833
var OBLIQUITY = 23.4397
var UNIX_EPOCH_JD = 2440587.5

function integer(value, fallback) {
  var parsed = Number(value)
  return isFinite(parsed) && Math.floor(parsed) === parsed ? parsed : fallback
}

function minute(value, fallback) {
  var parsed = integer(value, fallback)
  return parsed >= 0 && parsed < 1440 ? parsed : fallback
}

function themeName(value, fallback) {
  var name = typeof value === "string" ? value.trim() : ""
  return name.length ? name : fallback
}

// Coordinates are null unless they parse to a finite number inside the valid
// range. Anything else falls back to fixed scheduling instead of throwing.
function coordinate(value, limit) {
  if (typeof value !== "number" && typeof value !== "string") return null
  if (typeof value === "string" && !value.trim().length) return null
  var parsed = Number(value)
  if (!isFinite(parsed)) return null
  return parsed >= -limit && parsed <= limit ? parsed : null
}

function offsetMinutes(value, fallback) {
  var parsed = integer(value, fallback)
  return parsed >= -720 && parsed <= 720 ? parsed : fallback
}

function scheduleMode(value) {
  return value === "solar" ? "solar" : "fixed"
}

function normalize(raw) {
  var source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}
  var dayStart = minute(source.dayStart, DEFAULTS.dayStart)
  var nightStart = minute(source.nightStart, DEFAULTS.nightStart)
  if (dayStart === nightStart) nightStart = (dayStart + 720) % 1440

  return {
    enabled: source.enabled === true,
    dayTheme: themeName(source.dayTheme, DEFAULTS.dayTheme),
    nightTheme: themeName(source.nightTheme, DEFAULTS.nightTheme),
    dayStart: dayStart,
    nightStart: nightStart,
    scheduleMode: scheduleMode(source.scheduleMode),
    latitude: coordinate(source.latitude, 90),
    longitude: coordinate(source.longitude, 180),
    dayOffset: offsetMinutes(source.dayOffset, DEFAULTS.dayOffset),
    nightOffset: offsetMinutes(source.nightOffset, DEFAULTS.nightOffset),
    lastHandledBoundary: typeof source.lastHandledBoundary === "string"
      ? source.lastHandledBoundary : ""
  }
}

function pad(value) {
  return String(value).padStart(2, "0")
}

function timeLabel(minutes) {
  var value = minute(minutes, 0)
  return pad(Math.floor(value / 60)) + ":" + pad(value % 60)
}

function minuteOfDay(date) {
  return date.getHours() * 60 + date.getMinutes()
}

function isDayAt(minutes, dayStart, nightStart) {
  if (dayStart < nightStart) return minutes >= dayStart && minutes < nightStart
  return minutes >= dayStart || minutes < nightStart
}

// --- Location ------------------------------------------------------------
// Coordinates come from the first source that has usable ones: what the user
// typed into this plugin, then Omarchy's shared location file, then the system
// timezone. Only the typed values are ever persisted, so a location changed
// elsewhere keeps flowing through instead of being frozen into our config.

var WEATHER_LOCATION_PATH = "/.local/state/omarchy/settings/weather.json"

// A source becomes usable only with both coordinates. Half a coordinate places
// you on a meridian rather than a city, so it falls through to the next source.
function locationFrom(source, label) {
  var latitude = coordinate(source && source.latitude, 90)
  var longitude = coordinate(source && source.longitude, 180)
  if (latitude === null || longitude === null) return null
  var name = source && typeof source.name === "string" ? source.name.trim() : ""
  return { latitude: latitude, longitude: longitude, source: label, name: name }
}

function resolveLocation(manual, weather, timezone) {
  return locationFrom(manual, "manual")
    || locationFrom(weather, "weather")
    || locationFrom(timezone, "timezone")
    || { latitude: null, longitude: null, source: "none", name: "" }
}

// ~/.local/state/omarchy/settings/weather.json, written by
// omarchy-weather-location, which owns the format. A hand-written file may
// carry only a name; without coordinates there is nothing here to geocode
// offline, so that counts as unset.
function parseWeatherLocation(text) {
  var data = null
  try { data = JSON.parse(String(text || "")) }
  catch (error) { return null }
  if (!data || typeof data !== "object" || Array.isArray(data)) return null
  return {
    name: typeof data.name === "string" ? data.name.trim() : "",
    latitude: coordinate(data.latitude, 90),
    longitude: coordinate(data.longitude, 180)
  }
}

// tzdata records each zone's reference city as ISO 6709: a signed degrees and
// minutes pair, optionally with seconds. "-3749+14458" is Melbourne.
function parseZoneCoordinates(text) {
  var match = /^([+-])(\d{2})(\d{2})(\d{2})?([+-])(\d{3})(\d{2})(\d{2})?$/
    .exec(String(text || "").trim())
  if (!match) return null
  return {
    latitude: sexagesimal(match[1], match[2], match[3], match[4]),
    longitude: sexagesimal(match[5], match[6], match[7], match[8])
  }
}

function sexagesimal(sign, degrees, minutes, seconds) {
  var value = Number(degrees) + Number(minutes) / 60 + Number(seconds || 0) / 3600
  return Math.round((sign === "-" ? -value : value) * 10000) / 10000
}

// A zone's last segment is its reference city, which is the only part worth
// showing: "Australia/Melbourne" is Melbourne. The tables carry a comment field
// too, but it is a region for some zones ("Victoria") and a timezone
// description for others ("Eastern (most areas)"), so it is not usable as a
// place name.
function zoneCityName(zone) {
  var segments = String(zone || "").split("/")
  return segments[segments.length - 1].replace(/_/g, " ").trim()
}

// "<zone>\t<ISO 6709>", as printed by TimezoneLocation.sh.
function parseZoneLocation(text) {
  var fields = String(text || "").split("\n")[0].split("\t")
  var zone = String(fields[0] || "").trim()
  var coordinates = parseZoneCoordinates(fields[1])
  if (!zone || !coordinates) return null
  return {
    name: zoneCityName(zone),
    zone: zone,
    latitude: coordinates.latitude,
    longitude: coordinates.longitude
  }
}

function coordinatePair(location) {
  var value = location || {}
  if (value.latitude === null || value.longitude === null) return ""
  return value.latitude + ", " + value.longitude
}

// One line naming where the sun is being computed for, and which of the three
// sources decided it.
function locationLabel(location) {
  var value = location || {}
  if (value.source === "manual") return "Set here"
  if (value.source === "none") return "No location set"

  var where = value.name || coordinatePair(value)
  return value.source === "weather"
    ? where + " — shared with the weather panel"
    : where + " — from your timezone"
}

// --- Solar ---------------------------------------------------------------
// Sunrise and sunset are computed locally with the NOAA low-precision solar
// position algorithm. Nothing here touches the network or the filesystem, so
// scheduling keeps working offline, on battery, and before Wi-Fi associates.

function wrapMinutes(value) {
  var rounded = Math.round(value)
  return ((rounded % 1440) + 1440) % 1440
}

// Julian day of the instant the date represents. Epoch milliseconds carry no
// timezone, so neither does this.
function julianDay(date) {
  return date.getTime() / 86400000 + UNIX_EPOCH_JD
}

// Sunrise and sunset for the local calendar day of `date`, as local
// minutes-of-day. Returns null when the sun neither rises nor sets, which is
// the polar case where the hour angle is undefined.
function solarEvents(date, latitude, longitude) {
  var lat = coordinate(latitude, 90)
  var lon = coordinate(longitude, 180)
  if (lat === null || lon === null) return null

  var noon = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12, 0, 0, 0)
  var day = Math.round(julianDay(noon) - J2000 + 0.0008 + lon / 360)
  var meanSolarDay = day - lon / 360

  var anomaly = (357.5291 + 0.98560028 * meanSolarDay) % 360
  var center = 1.9148 * Math.sin(anomaly * DEGREES)
    + 0.02 * Math.sin(2 * anomaly * DEGREES)
    + 0.0003 * Math.sin(3 * anomaly * DEGREES)
  var ecliptic = (anomaly + center + 180 + 102.9372) % 360
  var transit = J2000 + meanSolarDay + 0.0053 * Math.sin(anomaly * DEGREES)
    - 0.0069 * Math.sin(2 * ecliptic * DEGREES)
  var declination = Math.asin(Math.sin(ecliptic * DEGREES) * Math.sin(OBLIQUITY * DEGREES))

  var cosHourAngle = (Math.cos(SOLAR_ZENITH * DEGREES)
    - Math.sin(lat * DEGREES) * Math.sin(declination))
    / (Math.cos(lat * DEGREES) * Math.cos(declination))
  if (!isFinite(cosHourAngle) || cosHourAngle > 1 || cosHourAngle < -1) return null

  var hourAngle = Math.acos(cosHourAngle) / DEGREES
  return {
    sunriseMinutes: localMinuteOfDay(transit - hourAngle / 360),
    sunsetMinutes: localMinuteOfDay(transit + hourAngle / 360)
  }
}

function localMinuteOfDay(julian) {
  var when = new Date((julian - UNIX_EPOCH_JD) * 86400000)
  return wrapMinutes(when.getHours() * 60 + when.getMinutes() + when.getSeconds() / 60)
}

// Day and night boundaries derived from the sun for `date`, or null when solar
// scheduling is off, the coordinates are unusable, or the sun does not set.
function solarBoundaries(date, config) {
  var normalized = normalize(config)
  if (normalized.scheduleMode !== "solar") return null
  var events = solarEvents(date, normalized.latitude, normalized.longitude)
  if (!events) return null

  var dayStart = wrapMinutes(events.sunriseMinutes + normalized.dayOffset)
  var nightStart = wrapMinutes(events.sunsetMinutes + normalized.nightOffset)

  // Derived boundaries must sit inside one local day. A fixed schedule may wrap
  // past midnight because its times never move, but solar times shift daily,
  // and inside the polar circles they cross midnight and swap order for a few
  // days either side of the midnight sun. A wrapped derived boundary makes the
  // period that opened yesterday unresolvable, so fixed times take over until
  // the sun sorts itself out.
  if (dayStart >= nightStart) return null

  return {
    dayStart: dayStart,
    nightStart: nightStart,
    sunriseMinutes: events.sunriseMinutes,
    sunsetMinutes: events.sunsetMinutes
  }
}

// The single point where a date turns into boundary minutes. Everything that
// needs a boundary goes through here so solar and fixed stay consistent.
function effectiveBoundaries(date, config) {
  var normalized = normalize(config)
  var solar = solarBoundaries(date, normalized)
  if (solar) {
    return {
      dayStart: solar.dayStart,
      nightStart: solar.nightStart,
      mode: "solar"
    }
  }
  return {
    dayStart: normalized.dayStart,
    nightStart: normalized.nightStart,
    mode: "fixed"
  }
}

// --- Schedule ------------------------------------------------------------

function periodAt(date, config) {
  var boundaries = effectiveBoundaries(date, config)
  return isDayAt(minuteOfDay(date), boundaries.dayStart, boundaries.nightStart)
    ? "day" : "night"
}

function desiredTheme(date, config) {
  var normalized = normalize(config)
  return periodAt(date, normalized) === "day"
    ? normalized.dayTheme : normalized.nightTheme
}

function randomMode(value) {
  if (value === RANDOM_LIGHT) return "light"
  if (value === RANDOM_DARK) return "dark"
  return ""
}

function selectionLabel(value) {
  var mode = randomMode(value)
  return mode ? "Random " + mode + " theme" : String(value || "")
}

function parseThemeCatalog(text) {
  var result = []
  var seen = {}
  var lines = String(text || "").split("\n")
  for (var i = 0; i < lines.length; i++) {
    var fields = lines[i].split("\t")
    var name = String(fields[0] || "").trim()
    if (!name || seen[name.toLowerCase()]) continue
    var mode = String(fields[1] || "").trim().toLowerCase()
    if (mode !== "light" && mode !== "dark") mode = ""
    result.push({ name: name, mode: mode })
    seen[name.toLowerCase()] = true
  }
  return result
}

function themeOptions(catalog, randomSelection) {
  var mode = randomMode(randomSelection) || String(randomSelection || "").toLowerCase()
  var token = mode === "dark" ? RANDOM_DARK : RANDOM_LIGHT
  var count = 0
  var options = []
  var themes = Array.isArray(catalog) ? catalog : []
  for (var i = 0; i < themes.length; i++)
    if (themes[i] && themes[i].mode === mode) count++

  options.push({
    value: token,
    label: selectionLabel(token),
    description: count + " classified " + mode + (count === 1 ? " theme" : " themes")
  })

  var ordered = themes.slice().sort(function(left, right) {
    var leftMode = left && left.mode ? left.mode : ""
    var rightMode = right && right.mode ? right.mode : ""
    var leftRank = leftMode === mode ? 0 : (leftMode ? 1 : 2)
    var rightRank = rightMode === mode ? 0 : (rightMode ? 1 : 2)
    if (leftRank !== rightRank) return leftRank - rightRank

    var leftName = String(left && left.name ? left.name : "").toLowerCase()
    var rightName = String(right && right.name ? right.name : "").toLowerCase()
    if (leftName < rightName) return -1
    if (leftName > rightName) return 1
    return 0
  })

  for (var j = 0; j < ordered.length; j++) {
    var theme = ordered[j]
    if (!theme || !theme.name) continue
    options.push({
      value: theme.name,
      label: theme.name,
      description: theme.mode ? theme.mode + " theme" : "theme mode not declared"
    })
  }
  return options
}

function resolveTheme(selection, catalog, currentTheme, randomValue) {
  var mode = randomMode(selection)
  if (!mode) return String(selection || "").trim()

  var themes = Array.isArray(catalog) ? catalog : []
  var pool = []
  for (var i = 0; i < themes.length; i++) {
    if (themes[i] && themes[i].mode === mode && themes[i].name)
      pool.push(String(themes[i].name))
  }
  if (!pool.length) return ""

  var current = String(currentTheme || "").toLowerCase()
  if (pool.length > 1 && current)
    pool = pool.filter(function(name) { return name.toLowerCase() !== current })

  var value = Number(randomValue)
  if (!isFinite(value) || value < 0) value = Math.random()
  var index = Math.min(pool.length - 1, Math.floor(value * pool.length))
  return pool[index]
}

function localDateKey(date) {
  return date.getFullYear() + "-" + pad(date.getMonth() + 1) + "-" + pad(date.getDate())
}

function dateAtMinute(date, minutes, dayDelta) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + (dayDelta || 0),
                  Math.floor(minutes / 60), minutes % 60, 0, 0)
}

// The boundary that opened the current period, resolved against the boundaries
// of the day that boundary actually falls on. A night that began at yesterday's
// sunset keeps yesterday's sunset minute, so the token stays stable over
// midnight instead of drifting when today's solar times are computed.
function boundaryInfo(date, config) {
  var normalized = normalize(config)
  var period = periodAt(date, normalized)
  var boundaries = effectiveBoundaries(date, normalized)
  var start = period === "day" ? boundaries.dayStart : boundaries.nightStart
  var boundary = dateAtMinute(date, start, 0)
  if (boundary.getTime() > date.getTime()) {
    var previous = dateAtMinute(date, 0, -1)
    boundaries = effectiveBoundaries(previous, normalized)
    start = period === "day" ? boundaries.dayStart : boundaries.nightStart
    boundary = dateAtMinute(previous, start, 0)
  }
  return { date: boundary, period: period, start: start }
}

function boundaryDate(date, config) {
  return boundaryInfo(date, config).date
}

// Solar boundaries move every day, so the resolved minute is part of the token.
// Without it a shifted boundary would look like one that was already handled.
function boundaryToken(date, config) {
  var info = boundaryInfo(date, config)
  return localDateKey(info.date) + "@" + info.period + "@" + info.start
}

function nextBoundary(date, config) {
  var normalized = normalize(config)
  var period = periodAt(date, normalized)
  var boundaries = effectiveBoundaries(date, normalized)
  var start = period === "day" ? boundaries.nightStart : boundaries.dayStart
  var next = dateAtMinute(date, start, 0)
  if (next.getTime() <= date.getTime()) {
    var tomorrow = dateAtMinute(date, 0, 1)
    boundaries = effectiveBoundaries(tomorrow, normalized)
    start = period === "day" ? boundaries.nightStart : boundaries.dayStart
    next = dateAtMinute(tomorrow, start, 0)
  }
  return next
}

function nextSwitchText(date, config) {
  var normalized = normalize(config)
  if (!normalized.enabled) return "Automation is off"
  var next = nextBoundary(date, normalized)
  var nextTheme = periodAt(date, normalized) === "day"
    ? normalized.nightTheme : normalized.dayTheme
  var dayOffset = new Date(next.getFullYear(), next.getMonth(), next.getDate()).getTime()
    - new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
  var prefix = dayOffset >= 86400000 ? "Tomorrow at " : "Today at "
  return prefix + timeLabel(next.getHours() * 60 + next.getMinutes()) + " · "
    + selectionLabel(nextTheme)
}

function timeOptions(step) {
  var interval = integer(step, 15)
  if (interval <= 0 || interval > 720) interval = 15
  var options = []
  for (var value = 0; value < 1440; value += interval)
    options.push({ value: String(value), label: timeLabel(value) })
  return options
}

function displayTheme(value) {
  var text = String(value || "").trim().replace(/-/g, " ")
  if (!text) return "Unknown"
  return text.replace(/(^|\s)([a-z])/g, function(_, space, letter) {
    return space + letter.toUpperCase()
  })
}
