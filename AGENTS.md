# Dominotracker

Personal localhost dev tool. Domino's Pizza Tracker-style visualization of gauntlette pipeline progress.

## Stack

- Node.js, zero dependencies (built-in http, fs, path only)
- Vanilla HTML/CSS/JS frontend
- SSE for live updates

## Run

```
node server.js
```

Opens browser automatically. Default port 3000, override with `PORT` env var.

## Test

```
node test/parser.test.js
```

## Architecture

- `parser.js` — reads ~/.gauntlette/ plan files, extracts frontmatter, review table, vision, branch
- `server.js` — HTTP server, /api/plans endpoint, /events SSE, fs.watch for live updates
- `public/index.html` — HTML shell
- `public/app.js` — client-side renderer (fetch + SSE + DOM)
- `public/style.css` — Domino's-inspired theme

## Key Decisions

- Parser keys off `## Gauntlette Review Report` heading specifically — not just any table
- No detail view in v1 — dashboard is the product
- Full re-render on SSE events (10-15 cards max, no DOM diffing needed)
- textContent for all user-derived content (XSS prevention)
- Bind to 127.0.0.1 only
