---
status: IMPLEMENTING
planning_mode: BUILDER
design_doc: /Users/robertkarl/.gauntlette/designs/dominotracker/master-design-20260420-111505.md
---
# dominotracker v1 Release

Created by /gauntlette-start on 2026-04-20
Branch: master | Repo: dominotracker
Design doc: /Users/robertkarl/.gauntlette/designs/dominotracker/master-design-20260420-111505.md

## Problem Statement

dominotracker is a working, polished personal tool. The code supports both gauntlette and gstack pipeline plan sources, has a Domino's-style reskin, and handles SHIPPED/ACTIVE/KILLED plan states correctly. It needs one UI fix (parallelogram stage bar) and a README before it's fit to share publicly. This is the v1 release plan.

## Vision

A shareable GitHub repository that any developer using gauntlette or gstack can clone, run immediately, and understand from the README. The "whoa" moment: you open the tracker and see your AI pipeline stages as a live Domino's-style progress bar.

**CEO note:** Scope is tight and correct. This is a release action, not a feature build. The only manual gate is the screenshot — the author must capture it after running the tracker locally. Don't automate around that; just ship around it.

## Planning Mode

BUILDER — side project / personal tool. The interview focused on sharpening the scope and nailing the "show it off" moment rather than validating demand or finding a paying user.

## Feature Spec

**What ships in v1:**

1. **CSS fix**: Remove the `clip-path: polygon(...)` from `.stage.current` in `public/style.css`. This currently makes the active (red) stage a parallelogram while all others are rectangles. All stages should be rectangles. Also remove the compensating negative margins and extra padding on that rule.

2. **README.md** at repo root with:
   - Header: project name + tagline ("Domino's Pizza Tracker for your gauntlette/gstack pipeline")
   - Screenshot of the running tracker (embedded image)
   - Prerequisites: Node.js, gauntlette or gstack
   - Install: `git clone`, `node server.js`
   - How it works: 2-3 sentences on SSE, ~/.gauntlette/ and ~/.gstack/ watching
   - Screenshot/GIF placeholder until user can capture one

3. **Git tag**: `v1.0.0` on master after the above lands

4. **GitHub push**: new public repo, push master + tag

## Scope

| Item | Decision | Effort | Why |
|------|----------|--------|-----|
| CSS parallelogram fix | ACCEPTED | XS | Known bug, 3-line CSS change |
| README with screenshot | ACCEPTED | S | Required for public shareability |
| v1.0.0 tag | ACCEPTED | XS | Marks the release clearly |
| GitHub repo + push | ACCEPTED | XS | The goal |
| Demo mode (fake plan data) | DEFERRED | M | gauntlette/gstack users are the target, not a general audience |
| npm publish | DEFERRED | S | More ceremony than needed for v1 |
| CHANGELOG.md | DEFERRED | S | Out of scope for personal tool v1 |
| GitHub Release notes | DEFERRED | S | Can add later; tag is enough |

## Resolved Decisions

| Decision | Why | Rejected |
|----------|-----|----------|
| Remove clip-path, make all stages rectangles | Parallelogram looks janky vs. rectangle neighbors | Keeping the Domino's angled look |
| Link gauntlette/gstack as prerequisites, no demo mode | Tool targets pipeline users; demo mode adds scope | Demo mode with fake plan files |
| Approach B: README with screenshot | Screenshot is what makes the repo shareable | Text-only README (Approach A) |
| No npm publish in v1 | Clone-and-run is simpler; no user demand yet | npm package |

## Codebase Health

STATUS: HEALTHY

- Stack: Node.js, zero deps, vanilla HTML/CSS/JS, SSE
- Structure: Clean, well-scoped — parser.js, server.js, public/ (app.js, style.css, index.html)
- Test coverage: parser.test.js with fixtures — parser covered, server/frontend untested (acceptable for personal tool)
- Documentation: AGENTS.md/CLAUDE.md present; no README.md yet
- Dependency freshness: zero dependencies, nothing to rot
- Git hygiene: clean master, 10 focused commits, good messages

## Relevant Code

- `public/style.css:230-238` — `.stage.current` rule with the parallelogram `clip-path`; fix is here
- `public/app.js` — frontend renderer; no changes needed
- `parser.js:430-541` — `loadAllPlans` + `loadAllGstackPlans` + `loadAllWorkflows`; both sources work
- `server.js` — HTTP + SSE server; no changes needed

## Open Wounds

- No README.md (the main blocker for publishing)
- `.stage.current` parallelogram bug (`clip-path` on line 235)

## Tech Debt

None relevant to this release.

## Out of Scope

- Demo mode
- npm publish
- CHANGELOG.md
- GitHub Release artifact (tag is enough)
- Mobile optimization beyond existing media query

## Architecture

### Mermaid: System Architecture

```mermaid
graph TD
    A[User Browser] -->|GET /| B[server.js :3000]
    A -->|GET /api/plans| B
    A -->|GET /events SSE| B
    B -->|read| C[parser.js]
    C -->|glob| D[~/.gauntlette/repo/*.md]
    C -->|glob| E[~/.gstack/projects/**/*.md]
    B -->|fs.watch| D
    B -->|fs.watch| E
    B -->|SSE push on change| A
```

### Mermaid: Data Flow — CSS Fix

```mermaid
flowchart LR
    A[.stage.current in style.css] -->|remove clip-path polygon| B[no clip-path]
    A -->|remove margin -1px -4px| C[inherits .stage: no margin]
    A -->|remove padding 12px 12px| D[inherits .stage: padding 12px 4px]
    B & C & D --> E[All stages render as rectangles]
```

### ASCII: Architecture

```
User clones repo
    └── node server.js
            ├── HTTP :3000
            │   ├── GET /         → public/index.html
            │   ├── GET /api/plans → JSON (gauntlette + gstack plans)
            │   └── GET /events   → SSE stream
            └── fs.watch
                    ├── ~/.gauntlette/{repo}/*.md
                    └── ~/.gstack/projects/**/*.md
```

### Failure Matrix

| Scenario | Effect | Handled? |
|----------|--------|----------|
| `~/.gauntlette/` absent | `/api/plans` returns `[]`, UI shows empty state | Yes — parser returns `directory_missing` |
| `~/.gstack/` absent | Same as above for gstack plans | Yes |
| Port 3000 in use | Server exits with EADDRINUSE | Acceptable — personal tool, user fixes it |
| Malformed plan frontmatter | Plan skipped or shown as UNKNOWN | Yes — parser is defensive |
| Screenshot missing from repo | README renders broken img tag | Acceptable — user must add manually |

### Test Matrix

```
Component              | Happy Path | Error Path | Edge Cases
───────────────────────┼────────────┼────────────┼───────────
parser.js (existing)   |     ✓      |     ✓      |     ✓      (39 tests)
CSS .stage.current fix |   manual   |    n/a     |   manual   (visual check)
README.md              |   manual   |    n/a     |    n/a     (GitHub render check)
```

**No new test surface introduced.** The CSS fix is purely visual; automated testing would require a headless browser and is disproportionate for a 3-line change. Verify manually by running `node server.js` and confirming the active stage is a rectangle.

## Implementation Approaches

### Approach B: Polished release with screenshot (CHOSEN)
- Effort: S | Risk: Low | Completeness: 9/10
- Fix CSS bug, write README with embedded screenshot, tag, push
- Reuses: existing reference images for README context

## Implementation

**Completed — commit 7fc2eaa**

Files modified:
- `public/style.css:230-233` — Removed `clip-path: polygon(...)`, `margin: -1px -4px`, `padding: 12px 12px` from `.stage.current`. All stages now render as uniform rectangles. Tests: 39/39 pass.

Files created:
- `README.md` — tagline, screenshot placeholder (`screenshot.png`), prerequisites (Node 18+, gauntlette/gstack), install+run instructions, how it works.

Remaining:
- `git tag v1.0.0` + create GitHub repo + `git push origin master --tags`

Note: screenshot.png captured via lookingglass and committed.

## Priorities

1. CSS parallelogram fix — without this the UI looks broken in the first screenshot
2. README with screenshot — this is the public face of the project
3. Tag + push — the actual release act

## Gauntlette Review Report

| Review | Trigger | Runs | Status | Findings |
|--------|---------|------|--------|----------|
| Planning Kickoff | `/gauntlette-start` | 1 | DONE | v1 release: CSS fix + README + tag + GitHub push |
| CEO Review | `/gauntlette-ceo-review` | 1 | CLEAR | Scope correct: HOLD. Two file changes + tag + push. Screenshot is a manual gate for the author. |
| Design Review | `/gauntlette-design-review` | 0 | — | — |
| Engineering Review | `/gauntlette-eng-review` | 1 | CLEAR | No architecture changes. CSS fix: remove 3 properties from .stage.current; inherits .stage base correctly. Human gate for screenshot documented. |
| Fresh Eyes | `/gauntlette-fresh-eyes` | 0 | — | — |
| Implementation | `/gauntlette-implement` | 1 | DONE | CSS parallelogram fix (3 properties removed from .stage.current), README.md created. 39/39 tests pass. Commit 7fc2eaa. Human gate remaining: screenshot + tag + push. |
| Code Review | `/gauntlette-code-review` | 1 | PASS | Small diff (3 CSS lines + README). Found and fixed: current-stage highlight logic was marking skipped stages as current (app.js). Fixed README clone URL. Dead z-index on .stage.current noted (harmless). |
| QA | `/gauntlette-quality-check` | 1 | PASS | 6/6 tests pass. 1 bug found+fixed: screenshot.png excluded by *.png gitignore (README image would 404 on GitHub). Also cleaned up blanket *.jpg/*.png rules. SSE, CSS fix, current-stage highlight all verified. |
| Human Review | `/gauntlette-human-review` | 0 | — | — |
| Ship It | `/gauntlette-ship-it` | 0 | — | — |

**VERDICT:** QA PASS — all checks green. Proceed to /gauntlette-human-review or /gauntlette-ship-it.
