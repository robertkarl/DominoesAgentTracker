const { describe, it } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { parseFrontmatter, parseTitle, parseVision, parseBranch, parseReviewTable, classifyStatus, parsePlan, loadAllPlans } = require('../parser');

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

  it('returns UNKNOWN when no frontmatter', () => {
    const result = parseFrontmatter('# Just a title\nNo frontmatter here');
    assert.strictEqual(result.status, 'UNKNOWN');
  });

  it('returns UNKNOWN when frontmatter has no status', () => {
    const result = parseFrontmatter('---\nfoo: bar\n---\n');
    assert.strictEqual(result.status, 'UNKNOWN');
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
    assert.strictEqual(plan.stages.length, 10); // includes Ship and duplicate QA
    assert.strictEqual(plan.stages[0].visual, 'completed');
    assert.strictEqual(plan.stages[7].visual, 'skipped'); // SKIPPED QA
    assert.strictEqual(plan.stages[8].name, 'Ship');
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

describe('loadAllPlans', () => {
  it('loads plans from real gauntlette directory (filters shipped/unknown/stale)', async () => {
    const homedir = require('os').homedir();
    const result = await loadAllPlans(path.join(homedir, '.gauntlette'));
    assert.strictEqual(result.error, null);
    // All returned plans should be non-shipped, non-unknown, and fresh
    for (const plan of result.plans) {
      const s = (plan.status || '').toUpperCase();
      assert.notStrictEqual(s, 'SHIPPED', `${plan.repo}/${plan.name} should not be SHIPPED`);
      assert.notStrictEqual(s, 'UNKNOWN', `${plan.repo}/${plan.name} should not be UNKNOWN`);
    }
  });

  it('returns directory_missing for nonexistent dir', async () => {
    const result = await loadAllPlans('/tmp/nonexistent-gauntlette-dir');
    assert.strictEqual(result.error, 'directory_missing');
    assert.strictEqual(result.plans.length, 0);
  });
});
