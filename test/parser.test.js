const { describe, it } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { parseFrontmatter, parseTitle, parseVision, parseBranch, parseReviewTable, classifyStatus, mergeStageFiles, PIPELINE_STAGES, parsePlan, loadAllPlans } = require('../parser');

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
  });

  it('classifies skipped statuses', () => {
    assert.strictEqual(classifyStatus('SKIPPED'), 'skipped');
    assert.strictEqual(classifyStatus('SKIPPED (no browser)'), 'skipped');
  });

  it('classifies pending statuses', () => {
    assert.strictEqual(classifyStatus('—'), 'pending');
    assert.strictEqual(classifyStatus(''), 'pending');
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
  it('merges stage files from cookedbook-ai-open into one plan with stages', async () => {
    const homedir = require('os').homedir();
    const result = await loadAllPlans(path.join(homedir, '.gauntlette'));
    const plan = result.plans.find(p => p.project === 'cookedbook-ai-open');
    assert.ok(plan, 'cookedbook-ai-open plan should exist');
    assert.ok(plan.stages.length > 0, 'merged plan should have stages');
    assert.strictEqual(plan.stages.length, 11, 'should have all 11 pipeline stages');
    const completed = plan.stages.filter(s => s.visual === 'completed');
    assert.ok(completed.length >= 5, 'should have at least 5 completed stages');
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
