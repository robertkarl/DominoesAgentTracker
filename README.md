# dominotracker

Domino's Pizza Tracker for your [gauntlette](https://github.com/gauntlette) / [gstack](https://github.com/gauntlette/gstack) pipeline.

![dominotracker screenshot](screenshot.png)

Watch your AI agent pipelines advance through review stages in real time — Survey, Product Review, UX, Architecture, Fresh Eyes, Implementation, Code Review, QA — rendered as a live progress bar that updates the moment a plan file changes on disk.

## Prerequisites

- Node.js 18+
- [gauntlette](https://github.com/gauntlette) or [gstack](https://github.com/gauntlette/gstack) installed and actively running pipelines

## Install & run

```bash
git clone https://github.com/rkkarl/dominotracker
cd dominotracker
node server.js
```

Opens `http://localhost:3000` automatically. Override port with `PORT=3001 node server.js`.

## How it works

The server reads plan files from `~/.gauntlette/` and `~/.gstack/` and serves them over HTTP. An SSE (`/events`) stream pushes updates to the browser whenever any plan file changes on disk — no polling, no page refresh. Each plan's Gauntlette Review Report table becomes a row of stage tiles: completed stages fill red, the current stage pulses, pending stages stay gray.

Zero npm dependencies. Built-in `http`, `fs`, `path` only.
