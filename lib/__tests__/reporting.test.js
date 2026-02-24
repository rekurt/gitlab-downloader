import { jest } from '@jest/globals';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { printSummary, printDryRun, writeJsonReport } from '../reporting.js';

describe('printSummary', () => {
  let logMessages;
  let errorMessages;
  let options;

  beforeEach(() => {
    logMessages = [];
    errorMessages = [];
    options = {
      log: (msg) => logMessages.push(msg),
      error: (msg) => errorMessages.push(msg),
    };
  });

  test('prints counts for all statuses', () => {
    const results = [
      { name: 'repo1', status: 'success', message: '' },
      { name: 'repo2', status: 'success', message: '' },
      { name: 'repo3', status: 'updated', message: '' },
      { name: 'repo4', status: 'skipped', message: 'already exists' },
      { name: 'repo5', status: 'failed', message: 'network error' },
    ];

    const hasFailed = printSummary(results, options);

    expect(hasFailed).toBe(true);
    expect(logMessages[0]).toBe('Summary: success=2 updated=1 skipped=1 failed=1');
  });

  test('returns false when no failures', () => {
    const results = [
      { name: 'repo1', status: 'success', message: '' },
      { name: 'repo2', status: 'updated', message: '' },
    ];

    const hasFailed = printSummary(results, options);

    expect(hasFailed).toBe(false);
    expect(errorMessages).toHaveLength(0);
  });

  test('logs failed repositories when failures exist', () => {
    const results = [
      { name: 'repo1', status: 'failed', message: 'timeout' },
      { name: 'repo2', status: 'failed', message: 'auth error' },
      { name: 'repo3', status: 'success', message: '' },
    ];

    printSummary(results, options);

    expect(errorMessages[0]).toBe('Failed repositories:');
    expect(errorMessages[1]).toBe('- repo1: timeout');
    expect(errorMessages[2]).toBe('- repo2: auth error');
    expect(errorMessages).toHaveLength(3);
  });

  test('handles empty results', () => {
    const hasFailed = printSummary([], options);

    expect(hasFailed).toBe(false);
    expect(logMessages[0]).toBe('Summary: success=0 updated=0 skipped=0 failed=0');
  });

  test('uses console.log and console.error by default', () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    printSummary([{ name: 'r', status: 'failed', message: 'err' }]);

    expect(logSpy).toHaveBeenCalledWith('Summary: success=0 updated=0 skipped=0 failed=1');
    expect(errorSpy).toHaveBeenCalledWith('Failed repositories:');

    logSpy.mockRestore();
    errorSpy.mockRestore();
  });

  test('ignores unknown statuses in counts', () => {
    const results = [
      { name: 'repo1', status: 'success', message: '' },
      { name: 'repo2', status: 'unknown', message: '' },
    ];

    const hasFailed = printSummary(results, options);

    expect(hasFailed).toBe(false);
    expect(logMessages[0]).toBe('Summary: success=1 updated=0 skipped=0 failed=0');
  });
});

describe('printDryRun', () => {
  let logMessages;
  let options;

  beforeEach(() => {
    logMessages = [];
    options = { log: (msg) => logMessages.push(msg) };
  });

  test('prints header and project rows', () => {
    const projects = [
      { id: 42, name: 'my-project', http_url_to_repo: 'https://gitlab.com/group/my-project.git', group_path: 'group' },
      { id: 99, name: 'other', http_url_to_repo: 'https://gitlab.com/team/other.git', group_path: 'team' },
    ];

    const config = { group: 'group', clone_path: '/tmp/repos' };
    const buildCloneTarget = (project, _cfg) => [project.name, `/tmp/repos/${project.group_path}/${project.name}`];

    printDryRun(projects, config, buildCloneTarget, options);

    expect(logMessages[0]).toBe('Dry-run mode enabled. Projects to process: 2');
    // Header line
    expect(logMessages[1]).toContain('ID');
    expect(logMessages[1]).toContain('NAME');
    expect(logMessages[1]).toContain('GROUP_PATH');
    expect(logMessages[1]).toContain('URL');
    expect(logMessages[1]).toContain('TARGET');
    // Data rows
    expect(logMessages[2]).toContain('42');
    expect(logMessages[2]).toContain('my-project');
    expect(logMessages[2]).toContain('group');
    expect(logMessages[3]).toContain('99');
    expect(logMessages[3]).toContain('other');
  });

  test('handles empty project list', () => {
    printDryRun([], {}, () => ['', ''], options);

    expect(logMessages[0]).toBe('Dry-run mode enabled. Projects to process: 0');
    expect(logMessages).toHaveLength(2); // header + column names
  });

  test('truncates long fields', () => {
    const longName = 'a'.repeat(50);
    const longUrl = 'https://gitlab.com/' + 'x'.repeat(100);
    const projects = [
      { id: 1, name: longName, http_url_to_repo: longUrl, group_path: 'grp' },
    ];

    const buildCloneTarget = (project) => [project.name, '/tmp/target'];

    printDryRun(projects, {}, buildCloneTarget, options);

    // Name should be truncated to 30 chars in the output
    const dataRow = logMessages[2];
    expect(dataRow).toContain('a'.repeat(30));
    // URL should be truncated to 45 chars
    expect(dataRow).toContain(longUrl.slice(0, 45));
  });

  test('handles missing fields gracefully', () => {
    const projects = [{ id: undefined, name: 'proj' }];
    const buildCloneTarget = () => ['proj', '/tmp/proj'];

    printDryRun(projects, {}, buildCloneTarget, options);

    const dataRow = logMessages[2];
    // Should not throw, should handle undefined group_path and http_url_to_repo
    expect(dataRow).toContain('proj');
  });

  test('uses console.log by default', () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

    printDryRun([], {}, () => ['', '']);

    expect(logSpy).toHaveBeenCalled();

    logSpy.mockRestore();
  });
});

describe('writeJsonReport', () => {
  let tmpDir;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'reporting-test-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  test('writes valid JSON report', async () => {
    const reportPath = join(tmpDir, 'report.json');
    const config = { group: 'my-group' };
    const results = [
      { name: 'repo1', status: 'success', message: '' },
      { name: 'repo2', status: 'failed', message: 'timeout' },
    ];

    await writeJsonReport(reportPath, config, 5, results);

    const content = JSON.parse(await readFile(reportPath, 'utf-8'));
    expect(content.group).toBe('my-group');
    expect(content.projects_count).toBe(5);
    expect(content.summary.success).toBe(1);
    expect(content.summary.failed).toBe(1);
    expect(content.summary.updated).toBe(0);
    expect(content.summary.skipped).toBe(0);
    expect(content.results).toHaveLength(2);
    expect(content.results[0].name).toBe('repo1');
    expect(content.results[1].name).toBe('repo2');
  });

  test('includes generated_at timestamp in ISO format', async () => {
    const reportPath = join(tmpDir, 'report.json');
    const before = new Date().toISOString();

    await writeJsonReport(reportPath, { group: null }, 0, []);

    const content = JSON.parse(await readFile(reportPath, 'utf-8'));
    const after = new Date().toISOString();

    expect(content.generated_at).toBeDefined();
    // The timestamp should be between before and after
    expect(content.generated_at >= before).toBe(true);
    expect(content.generated_at <= after).toBe(true);
  });

  test('creates parent directories if they do not exist', async () => {
    const reportPath = join(tmpDir, 'nested', 'deep', 'report.json');

    await writeJsonReport(reportPath, { group: 'g' }, 1, [
      { name: 'r', status: 'success', message: '' },
    ]);

    const content = JSON.parse(await readFile(reportPath, 'utf-8'));
    expect(content.group).toBe('g');
    expect(content.projects_count).toBe(1);
  });

  test('handles null group in config', async () => {
    const reportPath = join(tmpDir, 'report.json');

    await writeJsonReport(reportPath, {}, 0, []);

    const content = JSON.parse(await readFile(reportPath, 'utf-8'));
    expect(content.group).toBeNull();
  });

  test('does not mutate original results array', async () => {
    const reportPath = join(tmpDir, 'report.json');
    const results = [{ name: 'repo1', status: 'success', message: '' }];
    const original = JSON.parse(JSON.stringify(results));

    await writeJsonReport(reportPath, { group: 'g' }, 1, results);

    expect(results).toEqual(original);
  });

  test('writes pretty-printed JSON with 2-space indent', async () => {
    const reportPath = join(tmpDir, 'report.json');

    await writeJsonReport(reportPath, { group: 'g' }, 0, []);

    const raw = await readFile(reportPath, 'utf-8');
    // Should contain newlines and indentation (pretty-printed)
    expect(raw).toContain('\n');
    expect(raw).toContain('  ');
  });

  test('handles all status types in summary', async () => {
    const reportPath = join(tmpDir, 'report.json');
    const results = [
      { name: 'r1', status: 'success', message: '' },
      { name: 'r2', status: 'updated', message: '' },
      { name: 'r3', status: 'skipped', message: 'exists' },
      { name: 'r4', status: 'failed', message: 'err' },
      { name: 'r5', status: 'success', message: '' },
    ];

    await writeJsonReport(reportPath, { group: 'g' }, 10, results);

    const content = JSON.parse(await readFile(reportPath, 'utf-8'));
    expect(content.summary).toEqual({
      success: 2,
      updated: 1,
      skipped: 1,
      failed: 1,
    });
    expect(content.results).toHaveLength(5);
  });
});
