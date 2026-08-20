import { runGitCommand } from './cloner.js';

async function commandAvailable(runGit, args, signal) {
  try {
    const result = await runGit(args, { signal });
    return result.code === 0;
  } catch {
    return false;
  }
}

export async function inspectTransferTools(options = {}) {
  const runGit = options.runGit ?? runGitCommand;
  const signal = options.signal;
  const [git, gitLfs, gitFilterRepo] = await Promise.all([
    commandAvailable(runGit, ['git', '--version'], signal),
    commandAvailable(runGit, ['git', 'lfs', 'version'], signal),
    commandAvailable(runGit, ['git', 'filter-repo', '--version'], signal),
  ]);
  return { git, gitLfs, gitFilterRepo };
}
