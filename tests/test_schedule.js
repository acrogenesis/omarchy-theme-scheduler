#!/usr/bin/env node

// Solar assertions compare against published Melbourne almanac times, so the
// clock has to be pinned before anything constructs a Date.
process.env.TZ = "Australia/Melbourne";

const fs = require("fs");
const path = require("path");
const source = fs.readFileSync(path.join(__dirname, "..", "Schedule.js"), "utf8")
  .replace(/^\.pragma library\s*$/m, "");
const names = [...source.matchAll(/^function\s+([A-Za-z0-9_]+)/gm)].map((m) => m[1]);
const constants = [...source.matchAll(/^var\s+([A-Z][A-Z0-9_]*)/gm)].map((m) => m[1]);
const Schedule = new Function(`${source}\nreturn {${[...names, ...constants].join(",")}};`)();

let checks = 0;
let failures = 0;
function eq(label, actual, expected) {
  checks++;
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    failures++;
    console.error(`FAIL ${label}\n  got ${JSON.stringify(actual)}\n  expected ${JSON.stringify(expected)}`);
  }
}

function near(label, actual, expected, tolerance) {
  checks++;
  if (!isFinite(actual) || Math.abs(actual - expected) > tolerance) {
    failures++;
    console.error(`FAIL ${label}\n  got ${actual}\n  expected ${expected} +/- ${tolerance}`);
  }
}

function differs(label, actual, other) {
  checks++;
  if (JSON.stringify(actual) === JSON.stringify(other)) {
    failures++;
    console.error(`FAIL ${label}\n  both sides are ${JSON.stringify(actual)}`);
  }
}

const config = Schedule.normalize({
  enabled: true,
  dayTheme: "White",
  nightTheme: "Tokyo Night",
  dayStart: 420,
  nightStart: 1140
});

eq("day begins inclusively", Schedule.periodAt(new Date(2026, 7, 12, 7, 0), config), "day");
eq("night begins inclusively", Schedule.periodAt(new Date(2026, 7, 12, 19, 0), config), "night");
eq("desired day theme", Schedule.desiredTheme(new Date(2026, 7, 12, 12, 0), config), "White");
eq("desired night theme", Schedule.desiredTheme(new Date(2026, 7, 12, 23, 0), config), "Tokyo Night");
eq("day boundary token", Schedule.boundaryToken(new Date(2026, 7, 12, 8, 0), config), "2026-08-12@day@420");
eq("pre-dawn night uses previous boundary", Schedule.boundaryToken(new Date(2026, 7, 12, 2, 0), config), "2026-08-11@night@1140");
eq("next night boundary", Schedule.nextBoundary(new Date(2026, 7, 12, 12, 0), config), new Date(2026, 7, 12, 19, 0));
eq("next day boundary", Schedule.nextBoundary(new Date(2026, 7, 12, 23, 0), config), new Date(2026, 7, 13, 7, 0));

const overnight = Schedule.normalize({ dayStart: 1200, nightStart: 360 });
eq("overnight day before midnight", Schedule.periodAt(new Date(2026, 7, 12, 23, 0), overnight), "day");
eq("overnight day after midnight", Schedule.periodAt(new Date(2026, 7, 13, 2, 0), overnight), "day");
eq("overnight night", Schedule.periodAt(new Date(2026, 7, 13, 10, 0), overnight), "night");
eq("overnight token crosses date", Schedule.boundaryToken(new Date(2026, 7, 13, 2, 0), overnight), "2026-08-12@day@1200");

eq("invalid values normalize", Schedule.normalize({ enabled: 1, dayStart: -1, nightStart: "x" }), Schedule.DEFAULTS);
eq("equal starts are separated", Schedule.normalize({ dayStart: 60, nightStart: 60 }).nightStart, 780);
eq("quarter-hour options", Schedule.timeOptions(15).length, 96);
eq("time label", Schedule.timeLabel(65), "01:05");
eq("slug display", Schedule.displayTheme("catppuccin-latte\n"), "Catppuccin Latte");

const catalog = Schedule.parseThemeCatalog(
  "Catppuccin\tdark\nCatppuccin Latte\tlight\nAether\t\nInvalid\tsepia\n"
);
eq("theme catalog modes", catalog, [
  { name: "Catppuccin", mode: "dark" },
  { name: "Catppuccin Latte", mode: "light" },
  { name: "Aether", mode: "" },
  { name: "Invalid", mode: "" }
]);
eq("random light label", Schedule.selectionLabel(Schedule.RANDOM_LIGHT), "Random light theme");
eq("random dark option", Schedule.themeOptions(catalog, Schedule.RANDOM_DARK)[0], {
  value: Schedule.RANDOM_DARK,
  label: "Random dark theme",
  description: "1 classified dark theme"
});

const unorderedCatalog = Schedule.parseThemeCatalog(
  "Zulu Light\tlight\nZulu Dark\tdark\nUnknown Zebra\t\nAlpha Dark\tdark\nUnknown Alpha\t\nAlpha Light\tlight\n"
);
eq("light picker groups light then dark then unclassified alphabetically",
  Schedule.themeOptions(unorderedCatalog, Schedule.RANDOM_LIGHT).map((option) => option.value), [
    Schedule.RANDOM_LIGHT,
    "Alpha Light",
    "Zulu Light",
    "Alpha Dark",
    "Zulu Dark",
    "Unknown Alpha",
    "Unknown Zebra"
  ]);
eq("dark picker groups dark then light then unclassified alphabetically",
  Schedule.themeOptions(unorderedCatalog, Schedule.RANDOM_DARK).map((option) => option.value), [
    Schedule.RANDOM_DARK,
    "Alpha Dark",
    "Zulu Dark",
    "Alpha Light",
    "Zulu Light",
    "Unknown Alpha",
    "Unknown Zebra"
  ]);
eq("explicit theme resolves unchanged", Schedule.resolveTheme("Aether", catalog, "", 0), "Aether");
eq("random mode excludes unclassified themes",
  Schedule.resolveTheme(Schedule.RANDOM_LIGHT, catalog, "", 0), "Catppuccin Latte");

const darkCatalog = Schedule.parseThemeCatalog("One\tdark\nTwo\tdark\nThree\tdark\n");
eq("random avoids current theme when possible",
  Schedule.resolveTheme(Schedule.RANDOM_DARK, darkCatalog, "One", 0), "Two");
eq("missing random pool fails closed",
  Schedule.resolveTheme(Schedule.RANDOM_LIGHT, darkCatalog, "", 0), "");

const randomSchedule = Schedule.normalize({
  enabled: true,
  dayTheme: Schedule.RANDOM_LIGHT,
  nightTheme: Schedule.RANDOM_DARK,
  dayStart: 420,
  nightStart: 1140
});
eq("random selection persists through normalization", randomSchedule.dayTheme, Schedule.RANDOM_LIGHT);
eq("next switch labels random selection",
  Schedule.nextSwitchText(new Date(2026, 7, 12, 12, 0), randomSchedule),
  "Today at 19:00 · Random dark theme");

// --- Location --------------------------------------------------------------

// tzdata ISO 6709: degrees and minutes, optionally seconds.
eq("zone coordinates parse degrees and minutes",
  Schedule.parseZoneCoordinates("-3749+14458"),
  { latitude: -37.8167, longitude: 144.9667 });
eq("zone coordinates parse seconds when present",
  Schedule.parseZoneCoordinates("+404251-0740023"),
  { latitude: 40.7142, longitude: -74.0064 });
eq("zone coordinates apply the sign to the whole magnitude",
  Schedule.parseZoneCoordinates("-0117+03649"),
  { latitude: -1.2833, longitude: 36.8167 });
eq("unparsable zone coordinates are rejected",
  [Schedule.parseZoneCoordinates("-37.81+144.96"),
    Schedule.parseZoneCoordinates("+4042-074"),
    Schedule.parseZoneCoordinates(""),
    Schedule.parseZoneCoordinates(null)],
  [null, null, null, null]);

eq("zone location parses the script's output",
  Schedule.parseZoneLocation("Australia/Melbourne\t-3749+14458\n"),
  { name: "Melbourne", zone: "Australia/Melbourne",
    latitude: -37.8167, longitude: 144.9667 });
eq("a zone with no coordinates yields nothing",
  [Schedule.parseZoneLocation(""), Schedule.parseZoneLocation("UTC\t"),
    Schedule.parseZoneLocation("\t-3749+14458")],
  [null, null, null]);

// The last segment is the reference city; the tables' comment field is not a
// usable place name, so it is deliberately unused.
eq("zone names reduce to their city",
  ["Australia/Melbourne", "America/New_York", "Europe/London",
    "America/Argentina/Buenos_Aires", "Atlantic/Reykjavik"].map(Schedule.zoneCityName),
  ["Melbourne", "New York", "London", "Buenos Aires", "Reykjavik"]);

// Omarchy's shared location file, written by omarchy-weather-location.
eq("weather location parses name and coordinates",
  Schedule.parseWeatherLocation('{"name":"Riga","latitude":56.9496,"longitude":24.1052}'),
  { name: "Riga", latitude: 56.9496, longitude: 24.1052 });
eq("a name-only weather location has no coordinates",
  Schedule.parseWeatherLocation('{"name":"Malibu"}'),
  { name: "Malibu", latitude: null, longitude: null });
eq("out-of-range weather coordinates are rejected",
  Schedule.parseWeatherLocation('{"name":"Nowhere","latitude":91,"longitude":0}'),
  { name: "Nowhere", latitude: null, longitude: 0 });
eq("unreadable weather locations yield nothing",
  [Schedule.parseWeatherLocation("not json"), Schedule.parseWeatherLocation(""),
    Schedule.parseWeatherLocation("[]"), Schedule.parseWeatherLocation(null)],
  [null, null, null, null]);

const WEATHER = { name: "Riga", latitude: 56.9496, longitude: 24.1052 };
const ZONE = Schedule.parseZoneLocation("Australia/Melbourne\t-3749+14458");

eq("typed coordinates win over every inherited source",
  Schedule.resolveLocation({ latitude: -37.8136, longitude: 144.9631 }, WEATHER, ZONE),
  { latitude: -37.8136, longitude: 144.9631, source: "manual", name: "" });
eq("the shared location is used when nothing is typed",
  Schedule.resolveLocation({ latitude: null, longitude: null }, WEATHER, ZONE),
  { latitude: 56.9496, longitude: 24.1052, source: "weather", name: "Riga" });
eq("the timezone is used when the shared location has no coordinates",
  Schedule.resolveLocation({}, { name: "Malibu", latitude: null, longitude: null }, ZONE),
  { latitude: -37.8167, longitude: 144.9667, source: "timezone", name: "Melbourne" });
eq("nothing anywhere resolves to no location",
  Schedule.resolveLocation({}, null, null),
  { latitude: null, longitude: null, source: "none", name: "" });
eq("half a typed coordinate falls through instead of placing a meridian",
  Schedule.resolveLocation({ latitude: -37.8136, longitude: "" }, WEATHER, ZONE).source,
  "weather");

eq("each source names itself",
  [Schedule.resolveLocation({ latitude: 0, longitude: 0 }, null, null),
    Schedule.resolveLocation({}, WEATHER, ZONE),
    Schedule.resolveLocation({}, null, ZONE),
    Schedule.resolveLocation({}, null, null)].map(Schedule.locationLabel),
  ["Set here",
    "Riga — shared with the weather panel",
    "Melbourne — from your timezone",
    "No location set"]);
eq("a nameless shared location falls back to its coordinates",
  Schedule.locationLabel(
    Schedule.resolveLocation({}, { latitude: 56.9496, longitude: 24.1052 }, null)),
  "56.9496, 24.1052 — shared with the weather panel");

// --- Solar -----------------------------------------------------------------

const MELBOURNE = { latitude: -37.8136, longitude: 144.9631 };
const clock = (text) => Number(text.slice(0, 2)) * 60 + Number(text.slice(3));
const sun = (year, month, day) =>
  Schedule.solarEvents(new Date(year, month - 1, day, 12, 0),
    MELBOURNE.latitude, MELBOURNE.longitude);

// Published Melbourne times (Australia/Melbourne, DST where applicable).
const almanac = [
  { label: "summer solstice", date: [2026, 12, 21], sunrise: "05:54", sunset: "20:42" },
  { label: "winter solstice", date: [2026, 6, 21], sunrise: "07:36", sunset: "17:08" },
  { label: "march equinox", date: [2026, 3, 20], sunrise: "07:22", sunset: "19:33" },
  { label: "september equinox", date: [2026, 9, 23], sunrise: "06:09", sunset: "18:17" }
];
for (const entry of almanac) {
  const events = sun(...entry.date);
  near(`${entry.label} sunrise`, events.sunriseMinutes, clock(entry.sunrise), 2);
  near(`${entry.label} sunset`, events.sunsetMinutes, clock(entry.sunset), 2);
}

const summer = sun(2026, 12, 21);
const winter = sun(2026, 6, 21);
near("seasonal daylight spread is about 5h15m",
  (summer.sunsetMinutes - summer.sunriseMinutes)
  - (winter.sunsetMinutes - winter.sunriseMinutes), 315, 10);

// The whole case for the timezone fallback: a zone's reference city puts the
// sun within a minute of the real one, so inheriting beats asking.
for (const entry of almanac) {
  const [year, month, day] = entry.date;
  const inherited = Schedule.solarEvents(new Date(year, month - 1, day, 12, 0),
    ZONE.latitude, ZONE.longitude);
  near(`${entry.label} sunrise from the timezone alone`,
    inherited.sunriseMinutes, clock(entry.sunrise), 2);
  near(`${entry.label} sunset from the timezone alone`,
    inherited.sunsetMinutes, clock(entry.sunset), 2);
}

eq("polar midwinter has no sunrise",
  Schedule.solarEvents(new Date(2026, 11, 21, 12), 69.65, 18.96), null);
eq("polar midsummer has no sunset",
  Schedule.solarEvents(new Date(2026, 5, 21, 12), 69.65, 18.96), null);
eq("invalid coordinates yield no events",
  Schedule.solarEvents(new Date(2026, 7, 16, 12), 120, 144.9631), null);

eq("schedule mode defaults to fixed", Schedule.normalize({}).scheduleMode, "fixed");
eq("solar mode survives normalization",
  Schedule.normalize({ scheduleMode: "solar" }).scheduleMode, "solar");
eq("unknown mode falls back to fixed",
  Schedule.normalize({ scheduleMode: "sunrise" }).scheduleMode, "fixed");
eq("coordinates parse from strings",
  [Schedule.normalize({ latitude: "-37.8136", longitude: "144.9631" }).latitude,
    Schedule.normalize({ latitude: "-37.8136", longitude: "144.9631" }).longitude],
  [-37.8136, 144.9631]);
eq("out-of-range latitude is rejected",
  Schedule.normalize({ latitude: 91, longitude: 0 }).latitude, null);
eq("out-of-range longitude is rejected",
  Schedule.normalize({ latitude: 0, longitude: -181 }).longitude, null);
eq("unparsable coordinates are rejected",
  [Schedule.normalize({ latitude: "north", longitude: "" }).latitude,
    Schedule.normalize({ latitude: null, longitude: true }).longitude], [null, null]);
eq("offsets normalize", [Schedule.normalize({ dayOffset: -30 }).dayOffset,
  Schedule.normalize({ nightOffset: "x" }).nightOffset,
  Schedule.normalize({ dayOffset: 5000 }).dayOffset], [-30, 0, 0]);

const solarConfig = Schedule.normalize({
  enabled: true,
  scheduleMode: "solar",
  latitude: MELBOURNE.latitude,
  longitude: MELBOURNE.longitude,
  dayStart: 420,
  nightStart: 1140
});

const boundaries = Schedule.effectiveBoundaries(new Date(2026, 5, 21, 12), solarConfig);
eq("solar boundaries win in solar mode", boundaries.mode, "solar");
near("solar day starts at sunrise", boundaries.dayStart, clock("07:36"), 2);
near("solar night starts at sunset", boundaries.nightStart, clock("17:08"), 2);

const offsetConfig = Schedule.normalize({
  scheduleMode: "solar",
  latitude: MELBOURNE.latitude,
  longitude: MELBOURNE.longitude,
  dayOffset: 15,
  nightOffset: -30
});
const offsetBoundaries = Schedule.effectiveBoundaries(new Date(2026, 5, 21, 12), offsetConfig);
eq("offsets shift the solar boundaries",
  [offsetBoundaries.dayStart - boundaries.dayStart,
    offsetBoundaries.nightStart - boundaries.nightStart], [15, -30]);

const polarConfig = Schedule.normalize({
  scheduleMode: "solar",
  latitude: 69.65,
  longitude: 18.96,
  dayStart: 420,
  nightStart: 1140
});
eq("polar night falls back to fixed times",
  Schedule.effectiveBoundaries(new Date(2026, 11, 21, 12), polarConfig),
  { dayStart: 420, nightStart: 1140, mode: "fixed" });
eq("missing coordinates fall back to fixed times",
  Schedule.effectiveBoundaries(new Date(2026, 7, 16, 12),
    Schedule.normalize({ scheduleMode: "solar", dayStart: 420, nightStart: 1140 })),
  { dayStart: 420, nightStart: 1140, mode: "fixed" });
eq("fixed mode ignores coordinates",
  Schedule.effectiveBoundaries(new Date(2026, 7, 16, 12),
    Schedule.normalize({ latitude: MELBOURNE.latitude, longitude: MELBOURNE.longitude,
      dayStart: 420, nightStart: 1140 })),
  { dayStart: 420, nightStart: 1140, mode: "fixed" });
eq("solar boundaries expose the raw sun times",
  Schedule.solarBoundaries(new Date(2026, 5, 21, 12), solarConfig).sunriseMinutes,
  boundaries.dayStart);
eq("solar boundaries are null in fixed mode",
  Schedule.solarBoundaries(new Date(2026, 5, 21, 12), config), null);

// Catch-up compares tokens, so a boundary that moved must not look handled.
const westConfig = Schedule.normalize({
  scheduleMode: "solar",
  latitude: MELBOURNE.latitude,
  longitude: 115.8613,
  dayStart: 420,
  nightStart: 1140
});
const midday = new Date(2026, 7, 12, 12, 0);
eq("solar token carries the resolved minute",
  Schedule.boundaryToken(midday, solarConfig).split("@").slice(0, 2).join("@"),
  "2026-08-12@day");
differs("moved boundaries produce a different token for the same date and period",
  Schedule.boundaryToken(midday, solarConfig),
  Schedule.boundaryToken(midday, westConfig));
differs("solar and fixed tokens differ for the same date and period",
  Schedule.boundaryToken(midday, solarConfig), Schedule.boundaryToken(midday, config));

// Midnight must not split one night into two boundaries, or a random theme
// would be re-rolled every night at 00:00.
eq("a night keeps one token across midnight",
  Schedule.boundaryToken(new Date(2026, 7, 17, 1, 0), solarConfig),
  Schedule.boundaryToken(new Date(2026, 7, 16, 23, 0), solarConfig));
differs("consecutive nights get different tokens",
  Schedule.boundaryToken(new Date(2026, 7, 17, 23, 0), solarConfig),
  Schedule.boundaryToken(new Date(2026, 7, 16, 23, 0), solarConfig));

// Solar boundaries that wrap past midnight cannot describe where the current
// period began, so they hand back to the fixed times. Melbourne's midwinter
// sunset pushed seven hours later lands after midnight.
const wrappedConfig = Schedule.normalize({
  scheduleMode: "solar",
  latitude: MELBOURNE.latitude,
  longitude: MELBOURNE.longitude,
  nightOffset: 420,
  dayStart: 420,
  nightStart: 1140
});
eq("boundaries wrapping past midnight fall back to fixed",
  Schedule.solarBoundaries(new Date(2026, 5, 21, 12), wrappedConfig), null);
eq("the wrapped day still falls back through effectiveBoundaries",
  Schedule.effectiveBoundaries(new Date(2026, 5, 21, 12), wrappedConfig),
  { dayStart: 420, nightStart: 1140, mode: "fixed" });
eq("a moderate offset still resolves as solar",
  Schedule.effectiveBoundaries(new Date(2026, 5, 21, 12),
    Schedule.normalize({ scheduleMode: "solar", latitude: MELBOURNE.latitude,
      longitude: MELBOURNE.longitude, nightOffset: 60 })).mode, "solar");

// The contract Service.reconcile depends on: over a span of days the token must
// change exactly when the period changes, never mid-period, and never come back
// once left. A returning token would re-apply a boundary that was already
// handled, which for a random theme means re-rolling it.
function sweepTokens(label, config, days) {
  const start = new Date(2026, 0, 1, 0, 0, 0, 0).getTime();
  const lastSeenAt = new Map();
  let previousToken = null;
  let previousPeriod = null;
  let periodChanges = 0;
  let tokenChanges = 0;
  let anomalies = 0;
  for (let i = 0; i < days * 1440; i++) {
    const now = new Date(start + i * 60000);
    const period = Schedule.periodAt(now, config);
    const token = Schedule.boundaryToken(now, config);
    const boundary = Schedule.boundaryDate(now, config);
    if (boundary.getTime() > now.getTime()) anomalies++;
    if (Schedule.periodAt(boundary, config) !== period) anomalies++;
    if (previousToken !== null) {
      const periodChanged = period !== previousPeriod;
      const tokenChanged = token !== previousToken;
      if (periodChanged) periodChanges++;
      if (tokenChanged) tokenChanges++;
      if (periodChanged !== tokenChanged) anomalies++;
    }
    if (lastSeenAt.has(token) && lastSeenAt.get(token) !== i - 1) anomalies++;
    lastSeenAt.set(token, i);
    previousToken = token;
    previousPeriod = period;
  }
  eq(`${label}: token tracks the period exactly`,
    { anomalies: anomalies, periodChanges: periodChanges, tokenChanges: tokenChanges },
    { anomalies: 0, periodChanges: days * 2, tokenChanges: days * 2 });
}

sweepTokens("solar", solarConfig, 14);
sweepTokens("fixed", config, 14);
sweepTokens("fixed overnight", overnight, 14);
sweepTokens("solar with offsets", offsetConfig, 14);
sweepTokens("polar fallback", polarConfig, 14);

eq("solar period follows the sun",
  [Schedule.periodAt(new Date(2026, 5, 21, 7, 0), solarConfig),
    Schedule.periodAt(new Date(2026, 5, 21, 8, 0), solarConfig),
    Schedule.periodAt(new Date(2026, 5, 21, 17, 30), solarConfig)],
  ["night", "day", "night"]);
near("next solar boundary is tomorrow's sunrise",
  (() => {
    const next = Schedule.nextBoundary(new Date(2026, 5, 21, 23, 0), solarConfig);
    return next.getHours() * 60 + next.getMinutes();
  })(), clock("07:36"), 2);
eq("next solar boundary lands on the next day",
  Schedule.nextBoundary(new Date(2026, 5, 21, 23, 0), solarConfig).getDate(), 22);

if (failures) process.exit(1);
console.log(`ok - ${checks} schedule checks`);
