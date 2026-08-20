export {
  GITLAB_API_VERSION,
  DEFAULT_CLONE_PATH,
  DEFAULT_PER_PAGE,
  DEFAULT_TIMEOUT,
  DEFAULT_API_RETRIES,
  DEFAULT_CLONE_RETRIES,
  DEFAULT_CONCURRENCY,
  MIN_CONCURRENCY,
  MAX_CONCURRENCY,
  RETRY_BACKOFF_MAX,
} from './constants.js';

export {
  GitlabConfigSchema,
  validateGitlabUrl,
  parseConfig,
} from './config.js';

export {
  trimPrefix,
  sanitizePathComponent,
  extractGroupPath,
  isSubpath,
  sanitizeGitOutput,
  stripUrlCredentials,
  redactSecrets,
} from './utils.js';

export {
  maybeRateLimitDelay,
  fetchJson,
  fetchPaginated,
  fetchGroupMetadata,
  getAllProjects,
  getUserProjects,
} from './client.js';

export {
  deviceAuthorize,
  pollDeviceToken,
} from './auth.js';

export {
  runGitCommand,
  buildCloneTarget,
  cloneRepository,
  cloneAllRepositories,
} from './cloner.js';

export { withGitAskPass } from './git-auth.js';

export { syncRepository } from './git-sync.js';

export { inspectTransferTools } from './preflight.js';

export { findGitRepositories } from './repository-discovery.js';

export {
  HISTORY_REWRITE_CONFIRMATION,
  HISTORY_REWRITE_PREVIEW_MAX_AGE_MS,
  HistoryMappingSchema,
  validateHistoryMapping,
  createMailmap,
  previewHistoryRewrite,
  rewriteHistory,
} from './history-rewrite.js';

export {
  TransferConnectionSchema,
  TransferEntityModeSchema,
  TransferEventSchema,
  TransferEntityPlanSchema,
  TransferPlanSchema,
  isDirectTransferCompatible,
} from './transfer-schema.js';

export {
  GitLabApiError,
  requestGitLab,
  getGitLabVersion,
  getCurrentUser,
  getApplicationSettings,
  getGroup,
  getProject,
  listSubgroups,
  listGroupProjects,
  createGroup,
  createProject,
  startBulkImport,
  getBulkImport,
  getBulkImportEntities,
  getBulkImportFailures,
  cancelBulkImport,
} from './gitlab-api.js';

export {
  planTransfer,
  executeTransfer,
  getTransferStatus,
  cancelTransfer,
  ensureGitOnlyEntity,
} from './transfer.js';
