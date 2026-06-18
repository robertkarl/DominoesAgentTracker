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
// Set when an fs event arrives while a refresh is already running. The in-flight
// scan may have started before that change hit disk, so we run one more refresh
// when it finishes rather than dropping the event (which would leave the
// dashboard stale until the next poll or a manual reload).
let refreshRequested = false;
const arkWatchers = new Map(); // arkDir -> fs.FSWatcher
const staticWatchers = new Map(); // dirPath -> { watcher, recursive } for the always-watched dirs
const REARM_INTERVAL_MS = 6 * 60 * 60 * 1000; // periodically rebuild watchers (see rearmWatchers)

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

// Leaf .ark/ dirs are watched recursively (changes inside a run). Container dirs
// (the scan root and each ark-worktrees/) are watched non-recursively to catch
// runs/projects appearing or disappearing without scanning the whole tree — a
// recursive watch on the scan root would traverse all of ~/Code.
function updateArkWatchers(watchDirs, containerWatchDirs) {
  const desired = new Map(); // dir -> { recursive }
  for (const dir of watchDirs) desired.set(dir, { recursive: true });
  // Container dirs win over leaf entries only if not already present; a dir is
  // never both, so order does not matter in practice.
  for (const dir of containerWatchDirs) {
    if (!desired.has(dir)) desired.set(dir, { recursive: false });
  }

  // Remove watchers for dirs no longer needed
  for (const [dir, watcher] of arkWatchers) {
    if (!desired.has(dir)) {
      watcher.close();
      arkWatchers.delete(dir);
    }
  }

  // Add watchers for new dirs
  for (const [dir, opts] of desired) {
    if (!arkWatchers.has(dir)) {
      try {
        const watcher = fs.watch(dir, { recursive: opts.recursive }, scheduleRefresh);
        arkWatchers.set(dir, watcher);
      } catch (err) {
        console.warn(`WARN: fs.watch failed for ark dir ${dir}: ${err.message}`);
      }
    }
  }
}

// Resolve the set of live tmux session names (from `tmux ls`). Returns null when
// tmux isn't available or errors — null means "don't know", so the parser leaves
// runs alone rather than nuking everything when tmux is simply not running.
function getLiveTmuxSessions() {
  return new Promise((resolve) => {
    exec('tmux ls -F "#{session_name}"', (err, stdout) => {
      if (err) {
        // Exit code 1 with "no server running" is normal when no sessions exist —
        // that's a real empty set, not unknown. Distinguish by stderr/message.
        if (/no server running|no current session/i.test(err.message || '')) {
          resolve(new Set());
          return;
        }
        resolve(null); // tmux missing or unexpected failure -> unknown
        return;
      }
      resolve(new Set(stdout.split('\n').map(s => s.trim()).filter(Boolean)));
    });
  });
}

async function refreshPlans() {
  // If a scan is already running, mark that another is needed and wait for the
  // current one — the trailing run below will pick up whatever changed.
  if (refreshInFlight) {
    refreshRequested = true;
    return refreshInFlight;
  }

  refreshInFlight = (async () => {
    try {
      const liveTmuxSessions = await getLiveTmuxSessions();
      const result = await loadAllWorkflows(GAUNTLETTE_DIR, GSTACK_PROJECTS_DIR, ARK_SCAN_ROOT, liveTmuxSessions);
      cachedPlans = { plans: result.plans, error: result.error };
      updateArkWatchers(result.arkWatchDirs || [], result.arkContainerWatchDirs || []);
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

  // An event arrived mid-scan; run exactly one more pass to catch it.
  if (refreshRequested) {
    refreshRequested = false;
    return refreshPlans();
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

// Open a new iTerm2 window attached to the given tmux session. The session name
// is validated against the known live sessions (tmux ls) before use, so the value
// is never interpolated into a shell command unchecked.
function attachTmuxSession(session, callback) {
  exec('tmux ls -F "#{session_name}"', (err, stdout) => {
    if (err) {
      callback(new Error('tmux not running or no sessions'));
      return;
    }
    const sessions = stdout.split('\n').map(s => s.trim()).filter(Boolean);
    if (!sessions.includes(session)) {
      callback(new Error(`no live tmux session named ${session}`));
      return;
    }

    // session is now known-good (exact match against a live session name), so it is
    // safe to embed. Escape single quotes defensively for the nested AppleScript string.
    const cmd = `tmux attach -t ${session}`.replace(/'/g, `'\\''`);
    const script =
      `tell application "iTerm2" to create window with default profile\n` +
      `tell application "iTerm2" to tell current session of current window to write text "${cmd.replace(/"/g, '\\"')}"`;
    const osa = `osascript -e '${script.replace(/\n/g, "' -e '")}'`;
    exec(osa, (osaErr) => callback(osaErr || null));
  });
}

const server = http.createServer(async (req, res) => {
  if (req.url === '/api/attach' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1024) req.destroy(); // guard against oversized bodies
    });
    req.on('end', () => {
      let session;
      try {
        session = JSON.parse(body).session;
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'invalid JSON' }));
        return;
      }
      if (!session || typeof session !== 'string') {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'missing session' }));
        return;
      }
      attachTmuxSession(session, (err) => {
        if (err) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: err.message }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      });
    });
    return;
  }

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
  // Close any existing watcher for this dir first so re-arming replaces rather
  // than leaks the stream.
  const existing = staticWatchers.get(dirPath);
  if (existing) {
    try { existing.watcher.close(); } catch { /* already closed */ }
    staticWatchers.delete(dirPath);
  }
  try {
    const watcher = fs.watch(dirPath, { recursive: true }, scheduleRefresh);
    staticWatchers.set(dirPath, { watcher, recursive: true });
  } catch (err) {
    console.warn(`WARN: fs.watch failed for ${label}: ${err.message}`);
  }
}

// macOS fs.watch (FSEvents) watchers go stale over long uptimes — when a watched
// directory is torn down and recreated (e.g. ark rebuilding a worktree), the
// underlying stream keeps pointing at a dead inode and silently stops firing.
// The 60s poll masks this but leaves the UI laggy. Periodically close every
// watcher and rebuild it against the current tree, then refresh so any change
// missed while a watcher was dead is reflected immediately.
function rearmWatchers() {
  for (const watcher of arkWatchers.values()) {
    try { watcher.close(); } catch { /* already closed */ }
  }
  arkWatchers.clear();

  // Re-arm the static dirs (watchDirectory closes the old watcher first).
  watchDirectory(GAUNTLETTE_DIR, GAUNTLETTE_DIR);
  watchDirectory(GSTACK_PROJECTS_DIR, GSTACK_PROJECTS_DIR);

  // refreshPlans rebuilds the ark watchers via updateArkWatchers and broadcasts.
  refreshPlans().catch((err) => {
    console.error(`ERROR refreshing plans during re-arm: ${err.message}`);
  });
}

watchDirectory(GAUNTLETTE_DIR, GAUNTLETTE_DIR);
watchDirectory(GSTACK_PROJECTS_DIR, GSTACK_PROJECTS_DIR);

setInterval(() => {
  refreshPlans().catch((err) => {
    console.error(`ERROR refreshing plans: ${err.message}`);
  });
}, REFRESH_INTERVAL_MS);

setInterval(rearmWatchers, REARM_INTERVAL_MS);

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
