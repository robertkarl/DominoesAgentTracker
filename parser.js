const fs = require('fs');
const path = require('path');

function parseFrontmatter(content) {
  const lines = content.split('\n');
  if (lines[0] === '---') {
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
    return { status: result.status || 'UNKNOWN', branch: result.branch || null, phase: result.phase || null, project: result.project || null };
  }

  // Fallback: detect inline bold metadata (e.g. **Phase:** /survey, **Status:** Active)
  const phaseMatch = content.match(/\*\*Phase:\*\*\s*\/?(\S+)/);
  const statusMatch = content.match(/\*\*Status:\*\*\s*(\S+)/);
  const inlineStatus = phaseMatch ? phaseMatch[1] : statusMatch ? statusMatch[1] : null;
  if (inlineStatus) {
    return { status: inlineStatus.toUpperCase(), branch: null, phase: null, project: null };
  }

  return { status: 'UNKNOWN', phase: null, project: null };
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

    // SHIPPED plans: all pipeline stages are completed — the pizza has arrived
    const isShipped = (frontmatter.status || '').toUpperCase() === 'SHIPPED';
    const finalStages = isShipped
      ? PIPELINE_STAGES.map(stage => ({
          name: stage.name,
          trigger: '',
          runs: 1,
          status: 'DONE',
          findings: '—',
          visual: 'completed',
        }))
      : stages.length > 0
        ? stages.map(s => ({ ...s, visual: classifyStatus(s.status) }))
        : inferStagesFromStatus(frontmatter.status);

    return {
      repo,
      name,
      filePath,
      lastModified: stat.mtime.toISOString(),
      status: frontmatter.status,
      phase: frontmatter.phase,
      project: frontmatter.project,
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

function mergeStageFiles(stageFiles, repoName, projectName) {
  // Build a set of completed phase aliases from the individual files
  const completedPhases = new Set();
  let latestModified = null;
  let title = null;
  let vision = null;
  let branch = null;
  let latestFile = null;

  for (const sf of stageFiles) {
    if (sf.phase) {
      const upper = sf.phase.toUpperCase();
      completedPhases.add(upper);
    }
    if (sf.lastModified && (!latestModified || sf.lastModified > latestModified)) {
      latestModified = sf.lastModified;
      latestFile = sf;
    }
    if (!title && sf.title && sf.title !== sf.name) title = sf.title;
    if (!vision && sf.vision) vision = sf.vision;
    if (!branch && sf.branch) branch = sf.branch;
  }

  // Find the furthest-along stage to determine overall status
  let furthestIdx = -1;
  for (const phase of completedPhases) {
    for (let i = 0; i < PIPELINE_STAGES.length; i++) {
      if (PIPELINE_STAGES[i].aliases.includes(phase)) {
        if (i > furthestIdx) furthestIdx = i;
        break;
      }
    }
  }

  // Build pipeline stages: completed if we have a file, skipped if jumped over, pending if ahead
  // A stage is "skipped" if it has no file but a later stage does (it was passed over).
  // A stage is "pending" if it has no file and no later stage has a file (it's next/future).
  const hasFileFlags = PIPELINE_STAGES.map(stage => stage.aliases.some(a => completedPhases.has(a)));

  // Find the index of the last completed stage
  let lastCompletedIdx = -1;
  for (let i = hasFileFlags.length - 1; i >= 0; i--) {
    if (hasFileFlags[i]) { lastCompletedIdx = i; break; }
  }

  const stages = PIPELINE_STAGES.map((stage, i) => {
    const hasFile = hasFileFlags[i];
    let visual;
    if (hasFile) {
      visual = 'completed';
    } else if (i < lastCompletedIdx) {
      // No file, but a later stage was completed — this was skipped
      visual = 'skipped';
    } else {
      // No file, no later completed stage — genuinely pending/upcoming
      visual = 'pending';
    }
    return {
      name: stage.name,
      trigger: '',
      runs: hasFile ? 1 : 0,
      status: hasFile ? 'DONE' : '—',
      findings: '—',
      visual,
    };
  });

  // Determine overall plan status
  // If ship-it stage has a file, it's shipped — skipped stages don't block that
  const shipStageIdx = PIPELINE_STAGES.findIndex(s => s.aliases.includes('SHIP-IT'));
  const shipHasFile = shipStageIdx !== -1 && hasFileFlags[shipStageIdx];
  const allDone = stages.every(s => s.visual === 'completed');
  const overallStatus = (allDone || shipHasFile) ? 'SHIPPED' : 'ACTIVE';

  // If shipped, mark all stages as completed — the pizza has arrived
  if (overallStatus === 'SHIPPED') {
    for (const s of stages) {
      s.visual = 'completed';
      s.status = 'DONE';
      s.runs = 1;
    }
  }

  // Use the latest file's title, falling back to project name
  const surveyFile = stageFiles.find(sf => sf.phase && sf.phase.toUpperCase() === 'SURVEY');
  const displayTitle = (surveyFile && surveyFile.title && surveyFile.title !== surveyFile.name)
    ? surveyFile.title
    : title || projectName;

  return {
    repo: repoName,
    name: projectName,
    filePath: latestFile ? latestFile.filePath : stageFiles[0].filePath,
    lastModified: latestModified,
    status: overallStatus,
    phase: null,
    project: projectName,
    title: displayTitle,
    vision: vision,
    branch: branch,
    stages: stages,
    error: null,
  };
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

    const repoParsed = [];
    for (const file of files) {
      if (!file.endsWith('.md')) continue;
      const filePath = path.join(repoDir, file);
      const plan = await parsePlan(filePath);
      repoParsed.push(plan);
    }

    // Detect multi-file plans: files with a `phase` field are individual stage files
    const stageFiles = repoParsed.filter(p => p.phase);
    const standaloneFiles = repoParsed.filter(p => !p.phase);

    if (stageFiles.length > 0) {
      // Group stage files by project (or all together if no project field)
      const byProject = {};
      for (const sf of stageFiles) {
        const key = sf.project || repo.name;
        if (!byProject[key]) byProject[key] = [];
        byProject[key].push(sf);
      }

      for (const [projectName, projectFiles] of Object.entries(byProject)) {
        const merged = mergeStageFiles(projectFiles, repo.name, projectName);
        plans.push(merged);
      }
    }

    // Standalone files (no phase) are treated as individual plans
    for (const p of standaloneFiles) {
      plans.push(p);
    }
  }

  // Filter plans by freshness and status
  const STALE_MS = 8 * 60 * 60 * 1000;
  const SHIPPED_VISIBLE_MS = 24 * 60 * 60 * 1000;
  const now = Date.now();
  const fresh = plans.filter(p => {
    const s = (p.status || '').toUpperCase();
    const age = p.lastModified ? (now - new Date(p.lastModified).getTime()) : Infinity;

    // UNKNOWN = no frontmatter, not a real gauntlette plan — always hide
    if (s === 'UNKNOWN') return false;

    // Recently modified files show regardless of status (including SHIPPED)
    if (age <= STALE_MS) return true;

    // SHIPPED plans stay visible for 24 hours after last modification
    if (s === 'SHIPPED') return age <= SHIPPED_VISIBLE_MS;

    // Everything else older than 8 hours is stale
    return false;
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

module.exports = { parseFrontmatter, parseTitle, parseVision, parseBranch, parseReviewTable, classifyStatus, inferStagesFromStatus, mergeStageFiles, PIPELINE_STAGES, parsePlan, loadAllPlans };
