import {
  cancelBulkImport,
  executeTransfer,
  planTransfer,
  startBulkImport,
} from '@gitlab-dump/core';

const required = [
  'GITLAB_SOURCE_URL',
  'GITLAB_DESTINATION_URL',
  'GITLAB_SOURCE_TOKEN',
  'GITLAB_DESTINATION_TOKEN',
  'GITLAB_SMOKE_NEW_GROUP',
  'GITLAB_SMOKE_EXISTING_PROJECT',
  'GITLAB_SMOKE_CANCEL_GROUP',
  'GITLAB_SMOKE_RELATION_FAILURE_GROUP',
  'GITLAB_SMOKE_DESTINATION_NAMESPACE',
];
for (const name of required) {
  if (!process.env[name]) throw new Error(`Missing required smoke configuration: ${name}`);
}

const source = {
  url: process.env.GITLAB_SOURCE_URL,
  token: process.env.GITLAB_SOURCE_TOKEN,
};
const destination = {
  url: process.env.GITLAB_DESTINATION_URL,
  token: process.env.GITLAB_DESTINATION_TOKEN,
};
const namespace = process.env.GITLAB_SMOKE_DESTINATION_NAMESPACE;

function request(fullPath, type) {
  return {
    source: { ...source, fullPath, type },
    destination: { ...destination, namespace },
  };
}

function assertSafe(value) {
  const serialized = JSON.stringify(value);
  if (serialized.includes(source.token) || serialized.includes(destination.token)) {
    throw new Error('Smoke output contained a credential');
  }
}

const newGroupPlan = await planTransfer(request(process.env.GITLAB_SMOKE_NEW_GROUP, 'group'));
if (!newGroupPlan.entities.some((entity) => entity.mode === 'direct_transfer')) {
  throw new Error('New-group smoke did not select Direct Transfer');
}
assertSafe(newGroupPlan);
const directResult = await executeTransfer(newGroupPlan, {
  sourceToken: source.token,
  destinationToken: destination.token,
  onEvent: ({ phase, status }) => console.log(`direct-transfer ${phase} ${status}`),
});
assertSafe(directResult);
if (directResult.status !== 'finished') throw new Error(`Direct Transfer smoke ended as ${directResult.status}`);

const existingPlan = await planTransfer(request(process.env.GITLAB_SMOKE_EXISTING_PROJECT, 'project'));
if (existingPlan.entities[0]?.mode !== 'git_sync') {
  throw new Error(`Existing-project smoke selected ${existingPlan.entities[0]?.mode || 'nothing'} instead of git_sync`);
}
const syncResult = await executeTransfer(existingPlan, {
  sourceToken: source.token,
  destinationToken: destination.token,
});
assertSafe(syncResult);
if (!['finished', 'partial'].includes(syncResult.status)) {
  throw new Error(`Git-sync smoke ended as ${syncResult.status}`);
}

const cancelPlan = await planTransfer(request(process.env.GITLAB_SMOKE_CANCEL_GROUP, 'group'));
const cancelEntities = cancelPlan.entities.filter((entity) => entity.mode === 'direct_transfer');
if (cancelEntities.length === 0) throw new Error('Cancel smoke did not select Direct Transfer');
const started = await startBulkImport(destination, source, cancelEntities);
await cancelBulkImport(destination, started.id);
const resumed = await executeTransfer(cancelPlan, {
  sourceToken: source.token,
  destinationToken: destination.token,
  resumeBulkImportId: started.id,
});
assertSafe(resumed);
if (resumed.status !== 'canceled') throw new Error(`Resume/cancel smoke ended as ${resumed.status}`);

const failurePlan = await planTransfer(
  request(process.env.GITLAB_SMOKE_RELATION_FAILURE_GROUP, 'group'),
);
if (!failurePlan.entities.some((entity) => entity.mode === 'direct_transfer')) {
  throw new Error('Relation-failure smoke did not select Direct Transfer');
}
const failureResult = await executeTransfer(failurePlan, {
  sourceToken: source.token,
  destinationToken: destination.token,
});
assertSafe(failureResult);
if (failureResult.failures.length === 0) {
  throw new Error('Relation-failure smoke did not return relation failures');
}
for (const failure of failureResult.failures) {
  if (!Object.hasOwn(failure, 'relation') || !Object.hasOwn(failure, 'correlationId')) {
    throw new Error('Relation-failure report omitted safe diagnostic fields');
  }
}

console.log(JSON.stringify({
  directTransfer: directResult.status,
  gitSync: syncResult.status,
  cancelResume: resumed.status,
  relationFailures: failureResult.failures.length,
}));
