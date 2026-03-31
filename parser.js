const fs = require('fs');
const path = require('path');

function parseFrontmatter(content) {
  const lines = content.split('\n');
  if (lines[0] !== '---') return { status: 'UNKNOWN' };

  const result = {};
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === '---') break;
    const colonIdx = lines[i].indexOf(':');
    if (colonIdx !== -1) {
      const key = lines[i].slice(0, colonIdx).trim();
      const val = lines[i].slice(colonIdx + 1).trim();
      result[key] = val;
    }
  }
  return { status: result.status || 'UNKNOWN', branch: result.branch || null };
}

function parseTitle(content) {
  const match = content.match(/^# (.+)$/m);
  return match ? match[1].trim() : null;
}

function parseVision(content) {
  const match = content.match(/## Vision\s*\n([\s\S]*?)(?=\n##\s|\n###\s|$)/);
  if (!match) return null;
  const text = match[1].trim();
  return text || null;
}

function parseBranch(content) {
  // Try "Branch: xxx" line (e.g. "Branch: master (plan: bugfixes) | Repo: gauntlette")
  const match = content.match(/Branch:\s*(\S+)/);
  return match ? match[1] : null;
}

function parseReviewTable(content) {
  const lines = content.split('\n');

  // Find the ## Gauntlette Review Report heading
  let tableStart = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].match(/^## Gauntlette Review Report/)) {
      tableStart = i;
      break;
    }
  }
  if (tableStart === -1) return [];

  // Find the header row (starts with | Review)
  let headerIdx = -1;
  for (let i = tableStart + 1; i < lines.length && i < tableStart + 10; i++) {
    if (lines[i].match(/^\|\s*Review\s*\|/)) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx === -1) return [];

  // Parse column indices from header
  const headerCells = lines[headerIdx].split('|').map(c => c.trim()).filter(c => c);

  // Skip separator row (|---|---|...)
  let dataStart = headerIdx + 1;
  if (dataStart < lines.length && lines[dataStart].match(/^\|[\s-|]+$/)) {
    dataStart++;
  }

  // Parse data rows until we hit a non-table line
  const stages = [];
  for (let i = dataStart; i < lines.length; i++) {
    const line = lines[i];
    if (!line.startsWith('|')) break;
    if (line.match(/^\|[\s-|]+$/)) continue; // skip separator rows

    const cells = line.split('|').map(c => c.trim()).filter(c => c);
    if (cells.length < 4) continue; // malformed row, skip

    stages.push({
      name: cells[0] || '',
      trigger: cells[1] ? cells[1].replace(/`/g, '') : '',
      runs: parseInt(cells[2], 10) || 0,
      status: cells[3] || '—',
      findings: cells[4] || '—',
    });
  }

  return stages;
}

// Canonical pipeline stage order and their aliases as frontmatter status values
const PIPELINE_STAGES = [
  { name: 'Survey', aliases: ['SURVEY'] },
  { name: 'Product Review', aliases: ['PRODUCT-REVIEW', 'PRODUCT REVIEW'] },
  { name: 'UX Review', aliases: ['UX-REVIEW', 'UX REVIEW'] },
  { name: 'Architecture', aliases: ['ARCH-REVIEW', 'ARCH REVIEW', 'ARCHITECTURE'] },
  { name: 'Fresh Eyes', aliases: ['FRESH-EYES', 'FRESH EYES'] },
  { name: 'CSO Review', aliases: ['CSO-REVIEW', 'CSO REVIEW'] },
  { name: 'Implementation', aliases: ['IMPLEMENT', 'IMPLEMENTATION'] },
  { name: 'Code Review', aliases: ['CODE-REVIEW', 'CODE REVIEW'] },
  { name: 'QA', aliases: ['QUALITY-CHECK', 'QA'] },
  { name: 'Human Review', aliases: ['HUMAN-REVIEW', 'HUMAN REVIEW'] },
  { name: 'Ship', aliases: ['SHIP-IT', 'SHIP'] },
];

function inferStagesFromStatus(planStatus) {
  if (!planStatus) return [];
  const upper = planStatus.toUpperCase();

  // Find which pipeline stage matches the plan's frontmatter status
  let currentIdx = -1;
  for (let i = 0; i < PIPELINE_STAGES.length; i++) {
    if (PIPELINE_STAGES[i].aliases.includes(upper)) {
      currentIdx = i;
      break;
    }
  }
  if (currentIdx === -1) return [];

  // Everything before current stage is done, current is in-progress, rest is pending
  return PIPELINE_STAGES.map((stage, i) => ({
    name: stage.name,
    trigger: '',
    runs: i < currentIdx ? 1 : (i === currentIdx ? 1 : 0),
    status: i < currentIdx ? 'DONE' : (i === currentIdx ? 'DONE' : '—'),
    findings: '—',
    visual: i <= currentIdx ? 'completed' : 'pending',
  }));
}

function classifyStatus(status) {
  if (!status) return 'pending';
  const s = status.toUpperCase();
  if (['DONE', 'PASS', 'SHIPPED'].includes(s)) return 'completed';
  if (s === 'CLEAR') return 'clear';
  if (s.startsWith('SKIPPED')) return 'skipped';
  return 'pending';
}

async function parsePlan(filePath) {
  try {
    const content = await fs.promises.readFile(filePath, 'utf-8');
    const frontmatter = parseFrontmatter(content);
    const title = parseTitle(content);
    const vision = parseVision(content);
    const stages = parseReviewTable(content);
    const branch = frontmatter.branch || parseBranch(content);
    const stat = await fs.promises.stat(filePath);

    const dir = path.dirname(filePath);
    const repo = path.basename(dir);
    const name = path.basename(filePath, '.md');

    // If no review table, infer stages from the plan's frontmatter status
    const finalStages = stages.length > 0
      ? stages.map(s => ({ ...s, visual: classifyStatus(s.status) }))
      : inferStagesFromStatus(frontmatter.status);

    return {
      repo,
      name,
      filePath,
      lastModified: stat.mtime.toISOString(),
      status: frontmatter.status,
      title: title || name,
      vision: vision ? vision.slice(0, 200) : null,
      branch: branch || null,
      stages: finalStages,
      error: null,
    };
  } catch (err) {
    const dir = path.dirname(filePath);
    const repo = path.basename(dir);
    const name = path.basename(filePath, '.md');
    return {
      repo,
      name,
      filePath,
      lastModified: null,
      status: 'ERROR',
      title: name,
      vision: null,
      branch: null,
      stages: [],
      error: err.message,
    };
  }
}

async function loadAllPlans(gauntletteDir) {
  const resolvedDir = path.resolve(gauntletteDir);

  let repos;
  try {
    repos = await fs.promises.readdir(resolvedDir, { withFileTypes: true });
  } catch (err) {
    if (err.code === 'ENOENT') return { plans: [], error: 'directory_missing' };
    throw err;
  }

  const plans = [];
  for (const repo of repos) {
    if (!repo.isDirectory()) continue;

    const repoDir = path.join(resolvedDir, repo.name);
    let files;
    try {
      files = await fs.promises.readdir(repoDir);
    } catch {
      continue;
    }

    for (const file of files) {
      if (!file.endsWith('.md')) continue;
      const filePath = path.join(repoDir, file);
      const plan = await parsePlan(filePath);
      plans.push(plan);
    }
  }

  // Filter out shipped, unknown, and stale (>8 hours) plans
  const STALE_MS = 8 * 60 * 60 * 1000;
  const now = Date.now();
  const fresh = plans.filter(p => {
    const s = (p.status || '').toUpperCase();
    if (s === 'SHIPPED' || s === 'UNKNOWN') return false;
    if (p.lastModified && (now - new Date(p.lastModified).getTime()) > STALE_MS) return false;
    return true;
  });

  // Sort: ACTIVE/IN PROGRESS first, then by lastModified descending
  fresh.sort((a, b) => {
    const aActive = a.status && ['ACTIVE', 'IN PROGRESS'].includes(a.status.toUpperCase());
    const bActive = b.status && ['ACTIVE', 'IN PROGRESS'].includes(b.status.toUpperCase());
    if (aActive && !bActive) return -1;
    if (!aActive && bActive) return 1;
    if (a.lastModified && b.lastModified) return b.lastModified.localeCompare(a.lastModified);
    return 0;
  });

  return { plans: fresh, error: null };
}

module.exports = { parseFrontmatter, parseTitle, parseVision, parseBranch, parseReviewTable, classifyStatus, inferStagesFromStatus, PIPELINE_STAGES, parsePlan, loadAllPlans };
