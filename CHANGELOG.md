# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Solar scheduling now finds a location by itself. Coordinates are taken from
  the first source that has them: the panel's own fields, Omarchy's shared
  location at `~/.local/state/omarchy/settings/weather.json` (the file
  `omarchy-weather-location` writes and the weather panel reads), then the
  system timezone, whose reference-city coordinates `tzdata` already ships.
  A fresh install schedules correctly with nothing configured.
- The panel names the location in use and its source, and folds the coordinate
  fields away behind an override while one is inherited.
- `status` IPC reports `locationSource` and `locationName` alongside the
  coordinates.

### Changed

- Inherited coordinates are never written to the plugin's config, so changing
  the weather location or the system timezone moves the sun without further
  action. Only coordinates typed into the panel are persisted.

## [0.3.0] - 2026-08-16

### Added

- Solar scheduling: day and night boundaries derived from sunrise and sunset for
  a configured latitude and longitude, computed locally with the NOAA solar
  position algorithm. No network, no cache, no third-party service.
- Sunrise and sunset offsets, so the switch can lead or trail the sun by up to
  two hours.
- Schedule mode selector in the panel, with today's computed times shown for
  comparison against an almanac.

### Changed

- Forked from `acrogenesis.theme-scheduler` as `dkam.theme-scheduler-solar`.
- Configuration moved to `~/.config/omarchy/theme-scheduler-solar/` so both
  plugins can be installed without sharing catch-up state.
- `status` IPC now returns JSON, including the schedule mode, the resolved
  sunrise and sunset, and the coordinates in use.

### Fixed

- Boundary tokens are resolved against the day the boundary falls on, so a night
  in progress keeps one token across midnight instead of re-firing when the
  solar times shift underneath it.

### Notes

- Solar boundaries that wrap past local midnight, and polar days where the sun
  does not rise or set, fall back to the configured fixed times.

## [0.2.0] - 2026-08-13

### Added

- Random day and night theme selections based on Omarchy's `colors.toml` mode metadata.
- Theme pickers grouped by preferred mode with alphabetical ordering within each group.

## [0.1.0] - 2026-08-13

### Added

- Automatic switching between independently selected day and night themes.
- Local-time schedules configurable in 15-minute increments.
- Catch-up after sleep, restart, or a missed schedule boundary.
- Overnight schedule support.
- Manual theme overrides that remain active until the next boundary.
- Omarchy bar panel with enable/disable controls and an apply-now action.
- Sun and moon bar indicators, dimmed while automation is disabled.
- Shell IPC commands for status, enable, disable, and immediate application.
- Persistent configuration under `~/.config/omarchy/theme-scheduler/`.
- Scheduling unit tests and GitHub Actions CI.

[Unreleased]: https://github.com/acrogenesis/omarchy-theme-scheduler/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/acrogenesis/omarchy-theme-scheduler/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/acrogenesis/omarchy-theme-scheduler/releases/tag/v0.1.0
