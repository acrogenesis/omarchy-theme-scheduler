import QtQuick
import Quickshell
import Quickshell.Io
import "Schedule.js" as Schedule

Item {
  id: root

  readonly property string home: Quickshell.env("HOME")
  // Namespaced away from upstream's theme-scheduler directory: if both plugins
  // are installed they would otherwise share lastHandledBoundary and each undo
  // the other's catch-up.
  readonly property string configDir: home + "/.config/omarchy/theme-scheduler-solar"
  readonly property string configPath: configDir + "/config.json"
  readonly property string currentThemePath: home + "/.local/state/omarchy/current/theme.name"
  // Omarchy's shared location, owned by omarchy-weather-location. Read-only
  // here: the weather panel and its CLI own the format and the writes.
  readonly property string weatherLocationPath: home + Schedule.WEATHER_LOCATION_PATH
  readonly property string themeCatalogScriptPath: decodeURIComponent(
    String(Qt.resolvedUrl("ThemeCatalog.sh")).replace(/^file:\/\//, ""))
  readonly property string timezoneScriptPath: decodeURIComponent(
    String(Qt.resolvedUrl("TimezoneLocation.sh")).replace(/^file:\/\//, ""))

  property bool loaded: false
  property bool enabled: false
  property string dayTheme: Schedule.DEFAULTS.dayTheme
  property string nightTheme: Schedule.DEFAULTS.nightTheme
  property int dayStart: Schedule.DEFAULTS.dayStart
  property int nightStart: Schedule.DEFAULTS.nightStart
  property string scheduleMode: Schedule.DEFAULTS.scheduleMode
  // var rather than double: absent coordinates stay null instead of becoming 0,
  // which is a real place off the coast of Africa.
  property var latitude: Schedule.DEFAULTS.latitude
  property var longitude: Schedule.DEFAULTS.longitude
  property int dayOffset: Schedule.DEFAULTS.dayOffset
  property int nightOffset: Schedule.DEFAULTS.nightOffset
  property string lastHandledBoundary: ""

  // The two inherited sources, null until their file loads and their process
  // exits. Both are re-read when they change, so moving the weather location
  // or the system timezone moves the sun without a restart.
  property var weatherLocation: null
  property var timezoneLocation: null

  readonly property var resolvedLocation: Schedule.resolveLocation(
    { latitude: root.latitude, longitude: root.longitude },
    root.weatherLocation, root.timezoneLocation)
  readonly property var resolvedLatitude: resolvedLocation.latitude
  readonly property var resolvedLongitude: resolvedLocation.longitude
  readonly property string locationSource: resolvedLocation.source
  readonly property string locationName: resolvedLocation.name
  readonly property string locationSummary: Schedule.locationLabel(resolvedLocation)

  // What would be used if nothing were typed here. The panel needs this even
  // while manual coordinates are winning, to know whether offering to fall back
  // to an inherited location makes any sense.
  readonly property var inheritedLocation: Schedule.resolveLocation(
    null, root.weatherLocation, root.timezoneLocation)
  readonly property bool locationInheritable: inheritedLocation.source !== "none"
  readonly property string inheritedSummary: Schedule.locationLabel(inheritedLocation)

  property var themes: []
  readonly property var dayThemeOptions: Schedule.themeOptions(themes, Schedule.RANDOM_LIGHT)
  readonly property var nightThemeOptions: Schedule.themeOptions(themes, Schedule.RANDOM_DARK)
  property string currentTheme: "Unknown"
  property date now: new Date()
  property bool switchBusy: false
  property string pendingTheme: ""
  property string pendingBoundary: ""
  property string lastError: ""
  property string lastAction: ""

  readonly property string period: Schedule.periodAt(now, effectiveConfig())
  readonly property string desiredSelection: Schedule.desiredTheme(now, effectiveConfig())
  readonly property string desiredTheme: Schedule.selectionLabel(desiredSelection)
  readonly property string nextSwitchText: Schedule.nextSwitchText(now, effectiveConfig())

  // Every one of these depends on `now`, so the minute tick re-derives them.
  // Nothing caches a boundary, which is what lets solar times move at midnight
  // without the schedule holding yesterday's answer.
  readonly property var boundaries: Schedule.effectiveBoundaries(now, effectiveConfig())
  readonly property bool solarActive: boundaries.mode === "solar"
  readonly property var solarToday: Schedule.solarEvents(
    now, root.resolvedLatitude, root.resolvedLongitude)
  readonly property bool solarAvailable: solarToday !== null
  readonly property int sunriseMinutes: solarToday ? solarToday.sunriseMinutes : -1
  readonly property int sunsetMinutes: solarToday ? solarToday.sunsetMinutes : -1
  readonly property string sunriseText: solarToday
    ? Schedule.timeLabel(solarToday.sunriseMinutes) : "--:--"
  readonly property string sunsetText: solarToday
    ? Schedule.timeLabel(solarToday.sunsetMinutes) : "--:--"
  readonly property string dayStartText: Schedule.timeLabel(boundaries.dayStart)
  readonly property string nightStartText: Schedule.timeLabel(boundaries.nightStart)

  // Why solar is not in force while it is selected, for the panel to explain.
  readonly property string solarNotice: root.scheduleMode !== "solar" || root.solarActive ? ""
    : (root.resolvedLatitude === null || root.resolvedLongitude === null
      ? "No location is set anywhere on this system yet. Enter coordinates below."
      : "The sun does not set cleanly here today. Using the fixed times below.")

  // What gets persisted: the coordinates the user typed, blank included. The
  // inherited fallback is deliberately absent so it is never frozen into the
  // file, and keeps tracking its source when that source changes.
  function currentConfig() {
    return {
      enabled: root.enabled,
      dayTheme: root.dayTheme,
      nightTheme: root.nightTheme,
      dayStart: root.dayStart,
      nightStart: root.nightStart,
      scheduleMode: root.scheduleMode,
      latitude: root.latitude,
      longitude: root.longitude,
      dayOffset: root.dayOffset,
      nightOffset: root.nightOffset,
      lastHandledBoundary: root.lastHandledBoundary
    }
  }

  // What gets evaluated: the same config with the resolved coordinates dropped
  // in. Everything that turns a date into a boundary goes through this, so the
  // inherited location behaves exactly like a typed one.
  function effectiveConfig() {
    var config = root.currentConfig()
    config.latitude = root.resolvedLatitude
    config.longitude = root.resolvedLongitude
    return config
  }

  function applyConfig(text) {
    var parsed = {}
    try { parsed = text && text.trim() ? JSON.parse(text) : {} }
    catch (error) { root.lastError = "Invalid config.json: " + error }
    var config = Schedule.normalize(parsed)
    root.enabled = config.enabled
    root.dayTheme = config.dayTheme
    root.nightTheme = config.nightTheme
    root.dayStart = config.dayStart
    root.nightStart = config.nightStart
    root.scheduleMode = config.scheduleMode
    root.latitude = config.latitude
    root.longitude = config.longitude
    root.dayOffset = config.dayOffset
    root.nightOffset = config.nightOffset
    root.lastHandledBoundary = config.lastHandledBoundary
    root.loaded = true
    root.now = new Date()
    Qt.callLater(root.reconcile)
  }

  function saveConfig(patch) {
    var config = root.currentConfig()
    for (var key in patch) config[key] = patch[key]
    config = Schedule.normalize(config)
    var text = JSON.stringify(config, null, 2) + "\n"
    configFile.setText(text)
    root.applyConfig(text)
  }

  function setEnabled(value) {
    saveConfig({ enabled: value === true })
    if (value === true) Qt.callLater(root.applyNow)
    else root.lastAction = "Automatic switching disabled"
  }

  function updateSchedule(patch) {
    saveConfig(patch)
    root.lastAction = "Schedule saved"
  }

  function refreshThemes() {
    if (!themeListProcess.running) themeListProcess.running = true
  }

  function reconcile() {
    if (!root.loaded || !root.enabled || root.switchBusy) return
    root.now = new Date()
    var boundary = Schedule.boundaryToken(root.now, root.effectiveConfig())
    if (boundary === root.lastHandledBoundary) return
    switchSelection(root.desiredSelection, boundary)
  }

  function applyNow() {
    if (!root.loaded || root.switchBusy) return
    root.now = new Date()
    switchSelection(root.desiredSelection,
                    Schedule.boundaryToken(root.now, root.effectiveConfig()))
  }

  function switchSelection(selection, boundary) {
    var target = Schedule.resolveTheme(selection, root.themes,
                                       root.currentTheme, Math.random())
    if (!target) {
      var mode = Schedule.randomMode(selection)
      root.lastError = "No " + mode + " themes declare a mode in colors.toml."
      return
    }
    switchTo(target, boundary)
  }

  function switchTo(theme, boundary) {
    var target = String(theme || "").trim()
    if (!target) {
      root.lastError = "No theme is configured for the current period."
      return
    }

    root.pendingTheme = target
    root.pendingBoundary = boundary
    root.lastError = ""

    if (root.currentTheme.toLowerCase() === target.toLowerCase()) {
      root.lastHandledBoundary = boundary
      saveConfig({ lastHandledBoundary: boundary })
      root.lastAction = target + " is already active"
      return
    }

    switchProcess.command = ["omarchy", "theme", "set", target]
    root.switchBusy = true
    switchProcess.running = true
  }

  property Process configDirProcess: Process {
    command: ["mkdir", "-p", root.configDir]
  }

  property FileView configFile: FileView {
    path: root.configPath
    watchChanges: true
    printErrors: false
    atomicWrites: true
    onLoaded: root.applyConfig(text())
    onLoadFailed: root.applyConfig("")
    onFileChanged: reload()
  }

  property FileView weatherLocationFile: FileView {
    path: root.weatherLocationPath
    watchChanges: true
    printErrors: false
    onLoaded: root.weatherLocation = Schedule.parseWeatherLocation(text())
    onLoadFailed: root.weatherLocation = null
    onFileChanged: reload()
  }

  property Process timezoneProcess: Process {
    command: ["bash", root.timezoneScriptPath]
    stdout: StdioCollector {
      id: timezoneOutput
      waitForEnd: true
    }
    // A zone with no entry in the tables, such as UTC, exits 0 printing
    // nothing. That is a real answer — there is no place to put the sun.
    onExited: function(exitCode) {
      root.timezoneLocation = exitCode === 0
        ? Schedule.parseZoneLocation(timezoneOutput.text) : null
    }
  }

  property FileView currentThemeFile: FileView {
    path: root.currentThemePath
    watchChanges: true
    printErrors: false
    onLoaded: root.currentTheme = Schedule.displayTheme(text())
    onLoadFailed: root.currentTheme = "Unknown"
    onFileChanged: reload()
  }

  property Process themeListProcess: Process {
    command: ["bash", root.themeCatalogScriptPath]
    stdout: StdioCollector {
      id: themeListOutput
      waitForEnd: true
    }
    stderr: StdioCollector {
      id: themeListError
      waitForEnd: true
    }
    onExited: function(exitCode) {
      if (exitCode !== 0) {
        root.lastError = String(themeListError.text || "Could not list themes").trim()
        return
      }
      root.themes = Schedule.parseThemeCatalog(themeListOutput.text)
      Qt.callLater(root.reconcile)
    }
  }

  property Process switchProcess: Process {
    stderr: StdioCollector {
      id: switchError
      waitForEnd: true
    }
    onExited: function(exitCode) {
      root.switchBusy = false
      if (exitCode === 0) {
        var applied = root.pendingTheme
        root.lastHandledBoundary = root.pendingBoundary
        root.currentTheme = applied
        root.saveConfig({ lastHandledBoundary: root.pendingBoundary })
        root.lastAction = "Switched to " + applied
        root.lastError = ""
        currentThemeFile.reload()
      } else {
        root.lastError = String(switchError.text || "Theme switch failed").trim()
      }
      root.pendingTheme = ""
      root.pendingBoundary = ""
    }
  }

  SystemClock {
    id: clock
    precision: SystemClock.Minutes
    onDateChanged: {
      root.now = date
      root.reconcile()
    }
  }

  // A location arriving after startup, or changing later, moves every boundary.
  // Reconciling makes the schedule catch up the same way it does after sleep.
  onResolvedLocationChanged: Qt.callLater(root.reconcile)

  Component.onCompleted: {
    root.configDirProcess.running = true
    root.timezoneProcess.running = true
    root.refreshThemes()
  }
}
