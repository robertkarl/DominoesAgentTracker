const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { parseFrontmatter, parseTitle, parseVision, parseBranch, parseReviewTable, classifyStatus, mergeStageFiles, PIPELINE_STAGES, ARK_STAGES, parsePlan, loadAllPlans, loadAllGstackPlans, loadAllArkPlans, slugifyFeatureTitle, arkMapStages } = require('../parser');

const FIXTURES = path.join(__dirname, 'fixtures');

describe('parseFrontmatter', () => {
  it('extracts status from frontmatter', () => {
    const result = parseFrontmatter('---\nstatus: SHIPPED\n---\n# Title');
    assert.strictEqual(result.status, 'SHIPPED');
  });

  it('extracts branch from frontmatter', () => {
    const result = parseFrontmatter('---\nstatus: IN PROGRESS\nbranch: papercuts\n---\n');
    assert.strictEqual(result.status, 'IN PROGRESS');
    assert.strictEqual(result.branch, 'papercuts');
  });

  it('returns UNKNOWN when no frontmatter and no inline metadata', () => {
    const result = parseFrontmatter('# Just a title\nNo frontmatter here');
    assert.strictEqual(result.status, 'UNKNOWN');
  });

  it('returns UNKNOWN when frontmatter has no status', () => {
    const result = parseFrontmatter('---\nfoo: bar\n---\n');
    assert.strictEqual(result.status, 'UNKNOWN');
  });

  it('extracts status from inline **Phase:** metadata', () => {
    const result = parseFrontmatter('# Title\n\n**Phase:** /survey\n**Project:** Foo');
    assert.strictEqual(result.status, 'SURVEY');
  });

  it('extracts status from inline **Status:** metadata', () => {
    const result = parseFrontmatter('# Title\n\n**Status:** Active\n');
    assert.strictEqual(result.status, 'ACTIVE');
  });

  it('extracts status from loose Status metadata', () => {
    const result = parseFrontmatter('# Title\n\nStatus: Approved\nBranch: main\nRepo: dominotracker\n');
    assert.strictEqual(result.status, 'APPROVED');
    assert.strictEqual(result.branch, 'main');
  });
});

describe('parseTitle', () => {
  it('extracts first h1', () => {
    assert.strictEqual(parseTitle('---\nstatus: X\n---\n# My Title\n## Sub'), 'My Title');
  });

  it('returns null when no h1', () => {
    assert.strictEqual(parseTitle('## Only h2\nno h1'), null);
  });
});

describe('parseVision', () => {
  it('extracts vision text', () => {
    const content = '## Vision\n\nThis is the vision text.\n\n## Scope\n\nOther stuff';
    assert.strictEqual(parseVision(content), 'This is the vision text.');
  });

  it('returns null when no vision section', () => {
    assert.strictEqual(parseVision('## Scope\nStuff'), null);
  });
});

describe('parseBranch', () => {
  it('extracts branch from Branch: line', () => {
    assert.strictEqual(parseBranch('Branch: master (plan: bugfixes) | Repo: gauntlette'), 'master');
  });

  it('extracts simple branch name', () => {
    assert.strictEqual(parseBranch('Branch: main | Repo: dominotracker'), 'main');
  });

  it('returns null when no branch line', () => {
    assert.strictEqual(parseBranch('No branch info here'), null);
  });
});

describe('parseReviewTable', () => {
  it('parses a complete review table', () => {
    const content = `## Gauntlette Review Report

| Review | Trigger | Runs | Status | Findings |
|--------|---------|------|--------|----------|
| Survey | \`/survey\` | 1 | DONE | Found stuff |
| Product Review | \`/product-review\` | 0 | — | — |`;

    const stages = parseReviewTable(content);
    assert.strictEqual(stages.length, 2);
    assert.strictEqual(stages[0].name, 'Survey');
    assert.strictEqual(stages[0].trigger, '/survey');
    assert.strictEqual(stages[0].runs, 1);
    assert.strictEqual(stages[0].status, 'DONE');
    assert.strictEqual(stages[1].name, 'Product Review');
    assert.strictEqual(stages[1].status, '—');
  });

  it('returns empty array when no review table heading', () => {
    const stages = parseReviewTable('# Title\n\n## Scope\n\n| Item | Effort |\n|---|---|\n| Thing | S |');
    assert.strictEqual(stages.length, 0);
  });

  it('handles status with parenthetical', () => {
    const content = `## Gauntlette Review Report

| Review | Trigger | Runs | Status | Findings |
|--------|---------|------|--------|----------|
| QA | \`/quality-check\` | 0 | SKIPPED (no browser/E2E surface) | Prompts project |`;

    const stages = parseReviewTable(content);
    assert.strictEqual(stages.length, 1);
    assert.strictEqual(stages[0].status, 'SKIPPED (no browser/E2E surface)');
  });

  it('handles duplicate rows', () => {
    const content = `## Gauntlette Review Report

| Review | Trigger | Runs | Status | Findings |
|--------|---------|------|--------|----------|
| QA | \`/quality-check\` | 0 | SKIPPED | Skipped |
| Ship | \`/ship-it\` | 1 | DONE | Shipped |
| QA | \`/quality-check\` | 0 | — | — |`;

    const stages = parseReviewTable(content);
    assert.strictEqual(stages.length, 3);
    assert.strictEqual(stages[0].name, 'QA');
    assert.strictEqual(stages[2].name, 'QA');
  });

  it('parses gstack review tables with a Why column', () => {
    const content = `## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| Eng Review | \`/gstack-plan-eng-review\` | Architecture & tests | 1 | CLEAR (PLAN) | 12 issues |
| Outside Voice | codex-plan-review | Independent challenge | 1 | ISSUES | 4 tensions resolved |`;

    const stages = parseReviewTable(content);
    assert.strictEqual(stages.length, 2);
    assert.strictEqual(stages[0].why, 'Architecture & tests');
    assert.strictEqual(stages[0].runs, 1);
    assert.strictEqual(stages[1].status, 'ISSUES');
  });

  it('skips malformed rows', () => {
    const content = `## Gauntlette Review Report

| Review | Trigger | Runs | Status | Findings |
|--------|---------|------|--------|----------|
| Survey | \`/survey\` | 1 | DONE | Found stuff |
| Bad Row |
| Product Review | \`/product-review\` | 1 | CLEAR | Good |`;

    const stages = parseReviewTable(content);
    assert.strictEqual(stages.length, 2);
    assert.strictEqual(stages[0].name, 'Survey');
    assert.strictEqual(stages[1].name, 'Product Review');
  });
});

describe('classifyStatus', () => {
  it('classifies completed statuses', () => {
    assert.strictEqual(classifyStatus('DONE'), 'completed');
    assert.strictEqual(classifyStatus('PASS'), 'completed');
    assert.strictEqual(classifyStatus('SHIPPED'), 'completed');
  });

  it('classifies clear as its own category', () => {
    assert.strictEqual(classifyStatus('CLEAR'), 'clear');
    assert.strictEqual(classifyStatus('CLEAR (PLAN)'), 'clear');
    assert.strictEqual(classifyStatus('CLEAN (FULL)'), 'clear');
  });

  it('classifies skipped statuses', () => {
    assert.strictEqual(classifyStatus('SKIPPED'), 'skipped');
    assert.strictEqual(classifyStatus('SKIPPED (no browser)'), 'skipped');
  });

  it('classifies pending statuses', () => {
    assert.strictEqual(classifyStatus('—'), 'pending');
    assert.strictEqual(classifyStatus(''), 'pending');
  });

  it('classifies issue-like statuses', () => {
    assert.strictEqual(classifyStatus('ISSUES'), 'issues');
    assert.strictEqual(classifyStatus('issues_found (claude)'), 'issues');
  });

  it('handles null and undefined without crashing', () => {
    assert.strictEqual(classifyStatus(null), 'pending');
    assert.strictEqual(classifyStatus(undefined), 'pending');
  });
});

describe('parsePlan', () => {
  it('parses a complete plan file', async () => {
    const plan = await parsePlan(path.join(FIXTURES, 'complete.md'));
    assert.strictEqual(plan.error, null);
    assert.strictEqual(plan.status, 'SHIPPED');
    assert.strictEqual(plan.title, 'Gauntlette Bugfixes');
    assert.strictEqual(plan.branch, 'master');
    // SHIPPED plans show all 11 standard pipeline stages as completed
    assert.strictEqual(plan.stages.length, 11);
    for (const stage of plan.stages) {
      assert.strictEqual(stage.visual, 'completed');
      assert.strictEqual(stage.status, 'DONE');
    }
    assert.strictEqual(plan.stages[0].name, 'Survey');
    assert.strictEqual(plan.stages[10].name, 'Ship');
  });

  it('parses plan with no review table', async () => {
    const plan = await parsePlan(path.join(FIXTURES, 'no-table.md'));
    assert.strictEqual(plan.error, null);
    assert.strictEqual(plan.status, 'IN PROGRESS');
    assert.strictEqual(plan.title, 'Papercuts Plan');
    assert.strictEqual(plan.branch, 'papercuts');
    assert.strictEqual(plan.stages.length, 0);
  });

  it('parses mid-review plan', async () => {
    const plan = await parsePlan(path.join(FIXTURES, 'mid-review.md'));
    assert.strictEqual(plan.status, 'ACTIVE');
    assert.strictEqual(plan.stages.length, 8);
    const completed = plan.stages.filter(s => s.visual === 'completed');
    const clear = plan.stages.filter(s => s.visual === 'clear');
    const pending = plan.stages.filter(s => s.visual === 'pending');
    assert.strictEqual(completed.length, 1); // DONE
    assert.strictEqual(clear.length, 4);     // CLEAR stages
    assert.strictEqual(pending.length, 3);
  });

  it('handles malformed file gracefully', async () => {
    const plan = await parsePlan(path.join(FIXTURES, 'malformed.md'));
    assert.strictEqual(plan.status, 'UNKNOWN');
    assert.strictEqual(plan.stages.length, 2); // skips bad row
    assert.strictEqual(plan.stages[1].status, 'SKIPPED (not relevant)');
    assert.strictEqual(plan.stages[1].visual, 'skipped');
  });

  it('returns error for nonexistent file', async () => {
    const plan = await parsePlan(path.join(FIXTURES, 'nonexistent.md'));
    assert.notStrictEqual(plan.error, null);
    assert.strictEqual(plan.status, 'ERROR');
  });

  it('parses a gstack workflow doc', async () => {
    const plan = await parsePlan(path.join(FIXTURES, 'gstack-design.md'), { source: 'gstack' });
    assert.strictEqual(plan.error, null);
    assert.strictEqual(plan.source, 'gstack');
    assert.strictEqual(plan.repo, 'yah');
    assert.strictEqual(plan.name, 'unknown');
    assert.strictEqual(plan.status, 'APPROVED');
    assert.strictEqual(plan.branch, 'unknown');
    assert.strictEqual(plan.generatedBy, '/office-hours');
    assert.strictEqual(plan.stages.length, 6); // 3 from review table + 3 appended (Implementation, QA, Ship)
    assert.strictEqual(plan.stages[1].visual, 'clear');
    assert.strictEqual(plan.stages[2].visual, 'issues');
  });
});

describe('mergeStageFiles', () => {
  it('merges stage files into a single plan with correct pipeline', () => {
    const stageFiles = [
      { phase: 'survey', status: 'COMPLETE', title: 'My Survey', name: 'survey', lastModified: '2026-04-01T16:49:00Z', vision: null, branch: null, filePath: '/tmp/survey.md' },
      { phase: 'product-review', status: 'COMPLETE', title: 'Product Review', name: 'product-review', lastModified: '2026-04-01T16:51:00Z', vision: null, branch: null, filePath: '/tmp/product-review.md' },
      { phase: 'arch-review', status: 'COMPLETE', title: 'Arch Review', name: 'arch-review', lastModified: '2026-04-01T17:03:00Z', vision: null, branch: null, filePath: '/tmp/arch-review.md' },
      { phase: 'fresh-eyes', status: 'COMPLETE', title: 'Fresh Eyes', name: 'fresh-eyes', lastModified: '2026-04-01T17:06:00Z', vision: null, branch: null, filePath: '/tmp/fresh-eyes.md' },
      { phase: 'code-review', status: 'COMPLETE', title: 'Code Review', name: 'code-review', lastModified: '2026-04-01T17:17:00Z', vision: null, branch: null, filePath: '/tmp/code-review.md' },
      { phase: 'quality-check', status: 'COMPLETE', title: 'QA Check', name: 'quality-check', lastModified: '2026-04-01T17:21:00Z', vision: null, branch: null, filePath: '/tmp/quality-check.md' },
    ];

    const merged = mergeStageFiles(stageFiles, 'cookedbook-ai-open', 'cookedbook-ai-open');

    assert.strictEqual(merged.status, 'ACTIVE'); // not all stages done
    assert.strictEqual(merged.stages.length, 11); // all pipeline stages
    assert.strictEqual(merged.repo, 'cookedbook-ai-open');

    // Check stage classifications
    const completed = merged.stages.filter(s => s.visual === 'completed');
    const skipped = merged.stages.filter(s => s.visual === 'skipped');
    const pending = merged.stages.filter(s => s.visual === 'pending');
    assert.strictEqual(completed.length, 6); // survey, product, arch, fresh-eyes, code-review, qa
    assert.strictEqual(skipped.length, 3);   // ux, cso, implement (jumped over — later stages completed)
    assert.strictEqual(pending.length, 2);   // human, ship (genuinely upcoming)

    // Verify specific stages
    assert.strictEqual(merged.stages[0].visual, 'completed'); // Survey
    assert.strictEqual(merged.stages[2].visual, 'skipped');   // UX Review (no file, but later stages done)
    assert.strictEqual(merged.stages[3].visual, 'completed'); // Architecture
    assert.strictEqual(merged.stages[5].visual, 'skipped');   // CSO Review (skipped)
    assert.strictEqual(merged.stages[6].visual, 'skipped');   // Implementation (skipped)
    assert.strictEqual(merged.stages[9].visual, 'pending');   // Human Review (upcoming)
    assert.strictEqual(merged.stages[10].visual, 'pending');  // Ship (upcoming)
  });

  it('marks all done as SHIPPED when every stage has a file', () => {
    const allPhases = ['survey', 'product-review', 'ux-review', 'arch-review', 'fresh-eyes', 'cso-review', 'implement', 'code-review', 'quality-check', 'human-review', 'ship-it'];
    const stageFiles = allPhases.map((phase, i) => ({
      phase, status: 'COMPLETE', title: phase, name: phase,
      lastModified: `2026-04-01T${String(10 + i).padStart(2, '0')}:00:00Z`,
      vision: null, branch: null, filePath: `/tmp/${phase}.md`,
    }));

    const merged = mergeStageFiles(stageFiles, 'test-repo', 'test-project');
    assert.strictEqual(merged.status, 'SHIPPED');
    assert.strictEqual(merged.stages.every(s => s.visual === 'completed'), true);
  });

  it('uses survey file title as display title', () => {
    const stageFiles = [
      { phase: 'survey', status: 'COMPLETE', title: 'My Cool Feature Survey', name: 'survey', lastModified: '2026-04-01T10:00:00Z', vision: 'A vision', branch: 'feature-branch', filePath: '/tmp/survey.md' },
      { phase: 'product-review', status: 'COMPLETE', title: 'Product Review', name: 'product-review', lastModified: '2026-04-01T11:00:00Z', vision: null, branch: null, filePath: '/tmp/product-review.md' },
    ];

    const merged = mergeStageFiles(stageFiles, 'repo', 'project');
    assert.strictEqual(merged.title, 'My Cool Feature Survey');
    assert.strictEqual(merged.branch, 'feature-branch');
    assert.strictEqual(merged.vision, 'A vision');
  });
});

describe('loadAllPlans (multi-file)', () => {
  it('merges stage files into one plan with stages', async () => {
    const tmpRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'dominotracker-gauntlette-'));
    const repoDir = path.join(tmpRoot, 'cookedbook-ai-open');
    await fs.promises.mkdir(repoDir, { recursive: true });

    const files = [
      ['survey.md', 'survey'],
      ['product-review.md', 'product-review'],
      ['arch-review.md', 'arch-review'],
      ['fresh-eyes.md', 'fresh-eyes'],
      ['code-review.md', 'code-review'],
      ['quality-check.md', 'quality-check'],
    ];

    for (const [filename, phase] of files) {
      await fs.promises.writeFile(repoDir + '/' + filename, `---
status: COMPLETE
phase: ${phase}
project: cookedbook-ai-open
branch: feature-branch
---
# ${phase}
`);
    }

    const result = await loadAllPlans(tmpRoot);
    const plan = result.plans.find(p => p.project === 'cookedbook-ai-open');
    assert.ok(plan, 'merged plan should exist');
    assert.ok(plan.stages.length > 0, 'merged plan should have stages');
    assert.strictEqual(plan.stages.length, 11, 'should have all 11 pipeline stages');
    const completed = plan.stages.filter(s => s.visual === 'completed');
    assert.strictEqual(completed.length, 6);
  });
});

describe('loadAllGstackPlans', () => {
  it('keeps the newest gstack workflow per repo and branch', async () => {
    const tmpRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'dominotracker-gstack-'));
    const projectDir = path.join(tmpRoot, 'yah');
    await fs.promises.mkdir(projectDir, { recursive: true });

    const olderFile = path.join(projectDir, 'older.md');
    const newerFile = path.join(projectDir, 'newer.md');
    const ignoredFile = path.join(projectDir, 'notes.md');

    await fs.promises.writeFile(olderFile, `# Older Doc

Generated by /office-hours on 2026-04-16
Branch: main
Repo: yah
Status: APPROVED

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| Eng Review | \`/gstack-plan-eng-review\` | Architecture | 1 | CLEAR (PLAN) | 4 issues |`);

    await fs.promises.writeFile(newerFile, `# Newer Doc

Generated by /office-hours on 2026-04-17
Branch: main
Repo: yah
Status: APPROVED

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| Eng Review | \`/gstack-plan-eng-review\` | Architecture | 1 | CLEAR (PLAN) | 2 issues |
| Outside Voice | codex-plan-review | Independent challenge | 1 | ISSUES | 1 tension |`);

    await fs.promises.writeFile(ignoredFile, '# Scratch Notes\n\nNo review report here.\n');

    const now = new Date();
    const anHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    await fs.promises.utimes(olderFile, anHourAgo, anHourAgo);
    await fs.promises.utimes(newerFile, now, now);
    await fs.promises.utimes(ignoredFile, now, now);

    const result = await loadAllGstackPlans(tmpRoot);
    assert.strictEqual(result.error, null);
    assert.strictEqual(result.plans.length, 1);
    assert.strictEqual(result.plans[0].title, 'Newer Doc');
    assert.strictEqual(result.plans[0].name, 'main');
    assert.strictEqual(result.plans[0].stages.length, 5); // 2 from review table + 3 appended (Implementation, QA, Ship)
  });
});

describe('loadAllPlans', () => {
  it('loads plans from real gauntlette directory (filters stale/unknown)', async () => {
    const homedir = require('os').homedir();
    const result = await loadAllPlans(path.join(homedir, '.gauntlette'));
    assert.strictEqual(result.error, null);
    // UNKNOWN plans should never appear; SHIPPED plans may appear if recently modified
    for (const plan of result.plans) {
      const s = (plan.status || '').toUpperCase();
      assert.notStrictEqual(s, 'UNKNOWN', `${plan.repo}/${plan.name} should not be UNKNOWN`);
      if (s === 'SHIPPED') {
        // SHIPPED plans are only shown if modified within 24 hours
        const age = Date.now() - new Date(plan.lastModified).getTime();
        assert.ok(age <= 24 * 60 * 60 * 1000, `${plan.repo}/${plan.name} is SHIPPED but older than 24h`);
      }
    }
  });

  it('returns directory_missing for nonexistent dir', async () => {
    const result = await loadAllPlans('/tmp/nonexistent-gauntlette-dir');
    assert.strictEqual(result.error, 'directory_missing');
    assert.strictEqual(result.plans.length, 0);
  });
});

// ===================== Ark Tests =====================

describe('slugifyFeatureTitle', () => {
  it('converts a feature title to a slug', () => {
    assert.strictEqual(slugifyFeatureTitle('Make DAT aware of ark workflows'), 'make-dat-aware-of-ark-workflows');
  });

  it('strips leading/trailing hyphens and collapses doubles', () => {
    assert.strictEqual(slugifyFeatureTitle('  --Hello!! World--  '), 'hello-world');
  });

  it('handles single word', () => {
    assert.strictEqual(slugifyFeatureTitle('refactor'), 'refactor');
  });
});

describe('arkMapStages', () => {
  it('maps all stages as completed for a fully-completed run', () => {
    const files = new Set(['SPEC.md', 'review-spec.md', 'verify-spec.mk', 'review-make.md', 'REVIEW.md', 'adversarial-claude.md']);
    const stages = arkMapStages(files, true);
    assert.strictEqual(stages.length, 8);
    assert.ok(stages.every(s => s.visual === 'completed'), 'all stages should be completed');
  });

  it('marks first missing artifact as current', () => {
    const files = new Set(['SPEC.md', 'review-spec.md']);
    const stages = arkMapStages(files, false);
    assert.strictEqual(stages[0].visual, 'completed'); // Spec
    assert.strictEqual(stages[1].visual, 'completed'); // Review Spec
    assert.strictEqual(stages[2].visual, 'current');   // Encode (first missing)
    assert.strictEqual(stages[3].visual, 'pending');   // Review Make
    assert.strictEqual(stages[7].visual, 'pending');   // Land
  });

  it('marks Implement and Verify both completed when REVIEW.md exists', () => {
    const files = new Set(['SPEC.md', 'review-spec.md', 'verify-spec.mk', 'review-make.md', 'REVIEW.md']);
    const stages = arkMapStages(files, false);
    assert.strictEqual(stages[4].visual, 'completed'); // Implement
    assert.strictEqual(stages[4].name, 'Implement');
    assert.strictEqual(stages[5].visual, 'completed'); // Verify
    assert.strictEqual(stages[5].name, 'Verify');
  });

  it('marks Implement as current when REVIEW.md is missing (AC-7)', () => {
    const files = new Set(['SPEC.md', 'review-spec.md', 'verify-spec.mk', 'review-make.md']);
    const stages = arkMapStages(files, false);
    assert.strictEqual(stages[4].visual, 'current');   // Implement is first missing
    assert.strictEqual(stages[5].visual, 'pending');   // Verify
  });

  it('detects Encode via verify-*.mk glob', () => {
    const files = new Set(['SPEC.md', 'review-spec.md', 'verify-login.mk']);
    const stages = arkMapStages(files, false);
    assert.strictEqual(stages[2].visual, 'completed'); // Encode
    assert.strictEqual(stages[2].name, 'Encode');
  });

  it('detects Adversarial via adversarial-codex.md', () => {
    const files = new Set(['SPEC.md', 'review-spec.md', 'verify-spec.mk', 'review-make.md', 'REVIEW.md', 'adversarial-codex.md']);
    const stages = arkMapStages(files, false);
    assert.strictEqual(stages[6].visual, 'completed'); // Adversarial
    assert.strictEqual(stages[6].name, 'Adversarial');
    assert.strictEqual(stages[7].visual, 'current');   // Land (not archived)
  });

  it('marks Land as completed only for archived runs', () => {
    const files = new Set(['SPEC.md']);
    const notArchived = arkMapStages(files, false);
    assert.strictEqual(notArchived[7].visual, 'pending'); // Land pending when not archived
    // But if all preceding files exist and archived:
    const archived = arkMapStages(files, true);
    assert.strictEqual(archived[7].visual, 'completed'); // Land completed when archived
  });

  it('shows only Spec as current when no artifacts exist', () => {
    const files = new Set();
    const stages = arkMapStages(files, false);
    assert.strictEqual(stages[0].visual, 'current');  // Spec
    assert.strictEqual(stages[1].visual, 'pending');  // Review Spec
  });
});

describe('loadAllArkPlans', () => {
  async function makeArkProject(root, projectName, files, archiveRuns) {
    const projectDir = path.join(root, projectName);
    const arkDir = path.join(projectDir, '.ark');
    await fs.promises.mkdir(arkDir, { recursive: true });

    for (const [name, content] of Object.entries(files || {})) {
      await fs.promises.writeFile(path.join(arkDir, name), content);
    }

    if (archiveRuns) {
      const archiveDir = path.join(arkDir, 'archive');
      await fs.promises.mkdir(archiveDir, { recursive: true });
      for (const [dirName, runFiles] of Object.entries(archiveRuns)) {
        const runDir = path.join(archiveDir, dirName);
        await fs.promises.mkdir(runDir, { recursive: true });
        for (const [name, content] of Object.entries(runFiles)) {
          await fs.promises.writeFile(path.join(runDir, name), content);
        }
      }
    }
  }

  it('discovers an active ark run (AC-1, AC-2, AC-9, AC-10)', async () => {
    const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'dat-ark-'));
    await makeArkProject(root, 'regina', {
      'FEATURE.md': 'Add last-login display',
      'DRIVER': 'some driver content',
      'SPEC.md': '# Spec content',
    });

    const result = await loadAllArkPlans(root);
    assert.strictEqual(result.plans.length, 1);
    const plan = result.plans[0];
    assert.strictEqual(plan.source, 'ark');
    assert.strictEqual(plan.repo, 'regina');
    assert.strictEqual(plan.status, 'ACTIVE');
    assert.strictEqual(plan.name, 'add-last-login-display');
    assert.strictEqual(plan.title, 'Add last-login display');
    assert.strictEqual(plan.stages.length, 8);
    assert.strictEqual(plan.stages[0].visual, 'completed'); // Spec
    assert.strictEqual(plan.stages[0].name, 'Spec');
    assert.strictEqual(plan.stages[1].visual, 'current');   // Review Spec
  });

  it('discovers completed/archived runs (AC-3, AC-11 archive name)', async () => {
    const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'dat-ark-'));
    await makeArkProject(root, 'regina', {}, {
      '20260613-145300-last-login-sat-jun-1f8388': {
        'FEATURE.md': 'Last login Saturday',
        'SPEC.md': '# Spec',
        'review-spec.md': '# Review',
        'REVIEW.md': '# Review results',
      },
    });

    const result = await loadAllArkPlans(root);
    assert.strictEqual(result.plans.length, 1);
    const plan = result.plans[0];
    assert.strictEqual(plan.source, 'ark');
    assert.strictEqual(plan.status, 'SHIPPED');
    assert.strictEqual(plan.name, 'last-login-sat-jun-1f8388');
    assert.strictEqual(plan.repo, 'regina');
  });

  it('ignores .ark/ with no FEATURE.md (AC-5)', async () => {
    const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'dat-ark-'));
    await makeArkProject(root, 'empty-project', {
      'DRIVER': 'leftover driver',
    });

    const result = await loadAllArkPlans(root);
    assert.strictEqual(result.plans.length, 0);
  });

  it('ignores archive when determining active run (AC-4)', async () => {
    const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'dat-ark-'));
    // Only archived run, no active FEATURE.md in top-level .ark/
    await makeArkProject(root, 'myproject', { 'DRIVER': 'x' }, {
      '20260613-120000-old-feature-abc123': {
        'FEATURE.md': 'Old feature',
        'SPEC.md': '# Spec',
      },
    });

    const result = await loadAllArkPlans(root);
    // Should find the archived run but NOT an active run
    assert.strictEqual(result.plans.length, 1);
    assert.strictEqual(result.plans[0].status, 'SHIPPED');
  });

  it('ignores internal files for stage mapping (AC-28)', async () => {
    const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'dat-ark-'));
    await makeArkProject(root, 'myproject', {
      'FEATURE.md': 'My Feature',
      'DRIVER': 'driver content',
      '_prompt_spec.md': 'prompt content',
      '.SPEC.md.swp': 'swap file',
    });
    // Also create _tests dir
    const testsDir = path.join(root, 'myproject', '.ark', '_tests');
    await fs.promises.mkdir(testsDir, { recursive: true });
    await fs.promises.writeFile(path.join(testsDir, 'test1.js'), 'test');

    const result = await loadAllArkPlans(root);
    assert.strictEqual(result.plans.length, 1);
    // No artifacts found beyond FEATURE.md, so Spec should be current (first missing)
    assert.strictEqual(result.plans[0].stages[0].visual, 'current');
  });

  it('falls back to project name when FEATURE.md is empty (AC-25)', async () => {
    const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'dat-ark-'));
    await makeArkProject(root, 'fallback-project', {
      'FEATURE.md': '',
    });

    const result = await loadAllArkPlans(root);
    assert.strictEqual(result.plans.length, 1);
    assert.strictEqual(result.plans[0].name, 'fallback-project');
    assert.strictEqual(result.plans[0].title, 'fallback-project');
  });

  it('handles nonexistent scan root gracefully (AC-23)', async () => {
    const result = await loadAllArkPlans('/tmp/nonexistent-ark-scan-root-xyz');
    assert.strictEqual(result.plans.length, 0);
    assert.strictEqual(result.error, null);
  });

  it('only includes FEATURE.md first line as title (AC-12)', async () => {
    const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'dat-ark-'));
    await makeArkProject(root, 'multiline', {
      'FEATURE.md': 'First line title\nSecond line detail\nThird line',
    });

    const result = await loadAllArkPlans(root);
    assert.strictEqual(result.plans[0].title, 'First line title');
    assert.strictEqual(result.plans[0].name, 'first-line-title');
  });

  it('active runs always shown regardless of age (AC-20)', async () => {
    const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'dat-ark-'));
    await makeArkProject(root, 'old-active', {
      'FEATURE.md': 'Old active feature',
      'SPEC.md': '# Spec',
    });
    // Set mtime to 30 days ago
    const oldTime = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const arkDir = path.join(root, 'old-active', '.ark');
    await fs.promises.utimes(path.join(arkDir, 'FEATURE.md'), oldTime, oldTime);
    await fs.promises.utimes(path.join(arkDir, 'SPEC.md'), oldTime, oldTime);

    const result = await loadAllArkPlans(root);
    assert.strictEqual(result.plans.length, 1);
    assert.strictEqual(result.plans[0].status, 'ACTIVE');
  });

  it('shipped runs older than 24h are filtered out (AC-21)', async () => {
    const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'dat-ark-'));
    await makeArkProject(root, 'old-shipped', {}, {
      '20260101-120000-old-feature-abc123': {
        'FEATURE.md': 'Old shipped feature',
        'SPEC.md': '# Spec',
      },
    });
    // Set mtime to 3 days ago
    const oldTime = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    const runDir = path.join(root, 'old-shipped', '.ark', 'archive', '20260101-120000-old-feature-abc123');
    await fs.promises.utimes(path.join(runDir, 'FEATURE.md'), oldTime, oldTime);
    await fs.promises.utimes(path.join(runDir, 'SPEC.md'), oldTime, oldTime);

    const result = await loadAllArkPlans(root);
    assert.strictEqual(result.plans.length, 0);
  });

  it('returns watchDirs for discovered .ark/ directories (AC-18)', async () => {
    const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'dat-ark-'));
    await makeArkProject(root, 'project-a', { 'FEATURE.md': 'Feature A' });
    await makeArkProject(root, 'project-b', { 'FEATURE.md': 'Feature B' });

    const result = await loadAllArkPlans(root);
    assert.strictEqual(result.watchDirs.length, 2);
    assert.ok(result.watchDirs.some(d => d.includes('project-a')));
    assert.ok(result.watchDirs.some(d => d.includes('project-b')));
  });

  it('handles partial artifacts in archived runs (AC-8)', async () => {
    const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'dat-ark-'));
    await makeArkProject(root, 'partial', {}, {
      '20260613-120000-partial-run-abc123': {
        'FEATURE.md': 'Partial feature',
        'SPEC.md': '# Spec',
        // No review-spec.md, so Review Spec should be pending
      },
    });

    const result = await loadAllArkPlans(root);
    assert.strictEqual(result.plans.length, 1);
    const plan = result.plans[0];
    assert.strictEqual(plan.stages[0].visual, 'completed'); // Spec
    assert.strictEqual(plan.stages[1].visual, 'current');   // Review Spec (first missing)
    // Land is completed because it's archived
    assert.strictEqual(plan.stages[7].visual, 'completed');
    assert.strictEqual(plan.stages[7].name, 'Land');
  });

  it('skips directories without .ark/ subdirectory', async () => {
    const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'dat-ark-'));
    // Regular project without .ark/
    await fs.promises.mkdir(path.join(root, 'no-ark-project'), { recursive: true });
    await fs.promises.writeFile(path.join(root, 'no-ark-project', 'README.md'), '# Readme');

    const result = await loadAllArkPlans(root);
    assert.strictEqual(result.plans.length, 0);
  });

  it('stage names are human-readable (AC-17)', async () => {
    const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'dat-ark-'));
    await makeArkProject(root, 'readable', { 'FEATURE.md': 'Readable stages' });

    const result = await loadAllArkPlans(root);
    const stageNames = result.plans[0].stages.map(s => s.name);
    assert.deepStrictEqual(stageNames, [
      'Spec', 'Review Spec', 'Encode', 'Review Make',
      'Implement', 'Verify', 'Adversarial', 'Land',
    ]);
  });
});
