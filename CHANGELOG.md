# Changelog

All notable changes to this project will be documented in this file.

## [1.0.0.0] - 2026-04-20

### Added
- README with tagline, screenshot, prerequisites, and install instructions
- `screenshot.png` — live tracker screenshot for README

### Fixed
- `.stage.current` parallelogram shape removed — all pipeline stages now render as uniform rectangles
- Current-stage highlight logic: skipped stages (0 runs, pending) before the last completed stage are now hidden instead of being marked as current
- `*.png` blanket gitignore removed — `screenshot.png` and future image assets now commit correctly
- README git clone URL corrected to `robertkarl/dominotracker`
