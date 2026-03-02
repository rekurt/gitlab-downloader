import { writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

/**
 * Count results by status.
 *
 * @param {Array<{name: string, status: string, message: string}>} results
 * @returns {{success: number, updated: number, skipped: number, failed: number}}
 */
function countByStatus(results) {
  const counts = { success: 0, updated: 0, skipped: 0, failed: 0 };
  for (const item of results) {
    if (item.status in counts) {
      counts[item.status]++;
    }
  }
  return counts;
}

/**
 * Print a summary of clone/pull results.
 *
 * Returns true if there were any failures, false otherwise.
 *
 * @param {Array<{name: string, status: string, message: string}>} results
 * @param {object} [options]
 * @param {(msg: string) => void} [options.log] - Logging function (default: console.log)
 * @param {(msg: string) => void} [options.error] - Error logging function (default: console.error)
 * @returns {boolean} true if any results have status "failed"
 */
export function printSummary(results, options = {}) {
  const log = options.log || console.log;
  const error = options.error || console.error;
  const { success, updated, skipped, failed } = countByStatus(results);

  log(`Summary: success=${success} updated=${updated} skipped=${skipped} failed=${failed}`);

  if (failed > 0) {
    error('Failed repositories:');
    for (const item of results) {
      if (item.status === 'failed') {
        error(`- ${item.name}: ${item.message}`);
      }
    }
  }

  return failed > 0;
}

/**
 * Print a dry-run preview of planned operations in tabular format.
 *
 * @param {Array<object>} projects - GitLab project objects
 * @param {object} config - GitlabConfig
 * @param {(project: object, config: object) => {repoName: string, targetPath: string}} buildCloneTarget - Function to compute clone target
 * @param {object} [options]
 * @param {(msg: string) => void} [options.log] - Logging function (default: console.log)
 */
export function printDryRun(projects, config, buildCloneTarget, options = {}) {
  const log = options.log || console.log;

  log(`Dry-run mode enabled. Projects to process: ${projects.length}`);
  log(
    'ID'.padEnd(8) +
    'NAME'.padEnd(30) +
    'GROUP_PATH'.padEnd(30) +
    'URL'.padEnd(45) +
    'TARGET'
  );

  for (const project of projects) {
    const { repoName, targetPath } = buildCloneTarget(project, config);
    const url = (project.http_url_to_repo || '').slice(0, 45);

    log(
      String(project.id || '').padEnd(8) +
      repoName.slice(0, 30).padEnd(30) +
      (project.group_path || '').slice(0, 30).padEnd(30) +
      url.padEnd(45) +
      targetPath
    );
  }
}

/**
 * Write a JSON report file with clone/pull results.
 *
 * Creates parent directories if they do not exist.
 *
 * @param {string} path - Output file path
 * @param {object} config - GitlabConfig (needs .group)
 * @param {number} projectsCount - Total number of projects
 * @param {Array<{name: string, status: string, message: string}>} results
 */
export async function writeJsonReport(path, config, projectsCount, results) {
  const payload = {
    generated_at: new Date().toISOString(),
    group: config.group || null,
    projects_count: projectsCount,
    summary: countByStatus(results),
    results: results.map((item) => ({ ...item })),
  };

  const dir = dirname(path);
  await mkdir(dir, { recursive: true });
  await writeFile(path, JSON.stringify(payload, null, 2), 'utf-8');
}
