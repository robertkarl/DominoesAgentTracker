const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const os = require('os');
const { loadAllWorkflows } = require('./parser');

const PORT = parseInt(process.env.PORT, 10) || 3000;
const HOST = '127.0.0.1';
const GAUNTLETTE_DIR = path.join(os.homedir(), '.gauntlette');
const GSTACK_PROJECTS_DIR = path.join(os.homedir(), '.gstack', 'projects');
const ARK_SCAN_ROOT = process.env.ARK_SCAN_ROOT || path.join(os.homedir(), 'Code');
const PUBLIC_DIR = path.join(__dirname, 'public');
const REFRESH_INTERVAL_MS = 60 * 1000;

const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
};

let cachedPlans = { plans: [], error: null };
const sseClients = new Set();
let debounceTimer = null;
let refreshInFlight = null;
const arkWatchers = new Map(); // arkDir -> fs.FSWatcher

function broadcastPlans() {
  const data = JSON.stringify(cachedPlans);
  for (const res of sseClients) {
    try {
      res.write(`data: ${data}\n\n`);
    } catch {
      sseClients.delete(res);
    }
  }
}

function updateArkWatchers(watchDirs) {
  const desired = new Set(watchDirs);

  // Remove watchers for dirs no longer needed
  for (const [dir, watcher] of arkWatchers) {
    if (!desired.has(dir)) {
      watcher.close();
      arkWatchers.delete(dir);
    }
  }

  // Add watchers for new dirs
  for (const dir of desired) {
    if (!arkWatchers.has(dir)) {
      try {
        const watcher = fs.watch(dir, { recursive: true }, scheduleRefresh);
        arkWatchers.set(dir, watcher);
      } catch (err) {
        console.warn(`WARN: fs.watch failed for ark dir ${dir}: ${err.message}`);
      }
    }
  }
}

async function refreshPlans() {
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    try {
      const result = await loadAllWorkflows(GAUNTLETTE_DIR, GSTACK_PROJECTS_DIR, ARK_SCAN_ROOT);
      cachedPlans = { plans: result.plans, error: result.error };
      updateArkWatchers(result.arkWatchDirs || []);
    } catch (err) {
      console.error(`ERROR refreshing plans: ${err.message}`);
      cachedPlans = { plans: [], error: err.message };
    }
    broadcastPlans();
  })();

  try {
    await refreshInFlight;
  } finally {
    refreshInFlight = null;
  }
}

function serveStatic(req, res) {
  let filePath = req.url === '/' ? '/index.html' : req.url;
  const fullPath = path.resolve(PUBLIC_DIR, '.' + path.normalize(filePath));
  // Prevent directory traversal — resolved path must be under PUBLIC_DIR
  if (!fullPath.startsWith(PUBLIC_DIR + path.sep) && fullPath !== PUBLIC_DIR) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  const ext = path.extname(fullPath);
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  fs.readFile(fullPath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not Found');
      return;
    }
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  if (req.url === '/api/plans') {
    await refreshPlans();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(cachedPlans));
    return;
  }

  if (req.url === '/events') {
    await refreshPlans();
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });
    res.write(`data: ${JSON.stringify(cachedPlans)}\n\n`);
    sseClients.add(res);
    req.on('close', () => sseClients.delete(res));
    return;
  }

  serveStatic(req, res);
});

function scheduleRefresh() {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    refreshPlans().catch((err) => {
      console.error(`ERROR refreshing plans: ${err.message}`);
    });
  }, 500);
}

function watchDirectory(dirPath, label) {
  try {
    fs.watch(dirPath, { recursive: true }, scheduleRefresh);
  } catch (err) {
    console.warn(`WARN: fs.watch failed for ${label}: ${err.message}`);
  }
}

watchDirectory(GAUNTLETTE_DIR, GAUNTLETTE_DIR);
watchDirectory(GSTACK_PROJECTS_DIR, GSTACK_PROJECTS_DIR);

setInterval(() => {
  refreshPlans().catch((err) => {
    console.error(`ERROR refreshing plans: ${err.message}`);
  });
}, REFRESH_INTERVAL_MS);

// Start
refreshPlans().then(() => {
  server.listen(PORT, HOST, () => {
    const url = `http://${HOST}:${PORT}`;
    console.log(`Dominotracker running at ${url}`);
    console.log(`Watching ${GAUNTLETTE_DIR} for changes`);
    console.log(`Watching ${GSTACK_PROJECTS_DIR} for changes`);
    console.log(`Scanning ${ARK_SCAN_ROOT} for ark workflows`);
    console.log(`Tracking ${cachedPlans.plans.length} plans`);

    // Auto-open browser on macOS
    exec(`open ${url}`);
  });
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`ERROR: Port ${PORT} in use. Kill the other process or use PORT=${PORT + 1} node server.js`);
    process.exit(1);
  }
  throw err;
});
