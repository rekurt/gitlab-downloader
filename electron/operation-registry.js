const { randomUUID } = require('node:crypto');

function createOperationRegistry(options = {}) {
  const createId = options.id || randomUUID;
  const operations = new Map();

  function owned(id, ownerId) {
    const operation = operations.get(id);
    if (!operation || operation.ownerId !== ownerId) {
      throw new Error(`Operation ${id} is not available`);
    }
    return operation;
  }

  return {
    begin(kind, ownerId) {
      const id = createId();
      if (operations.has(id)) throw new Error(`Operation ${id} already exists`);
      const controller = new AbortController();
      const operation = {
        id,
        kind,
        ownerId,
        controller,
        signal: controller.signal,
        status: 'running',
        result: null,
        error: null,
      };
      operations.set(id, operation);
      return operation;
    },

    complete(id, result) {
      const operation = operations.get(id);
      if (!operation || operation.status !== 'running') return;
      operation.status = ['partial', 'failed', 'canceled'].includes(result?.status)
        ? result.status
        : 'finished';
      operation.result = result ?? null;
    },

    fail(id, error) {
      const operation = operations.get(id);
      if (!operation || operation.status !== 'running') return;
      if (operation.signal.aborted) {
        operation.status = 'canceled';
        return;
      }
      operation.status = 'failed';
      operation.error = error?.message || String(error);
    },

    cancel(id, ownerId) {
      const operation = owned(id, ownerId);
      if (operation.status === 'running') {
        operation.status = 'canceled';
        operation.controller.abort(new DOMException('Canceled', 'AbortError'));
      }
      return this.status(id, ownerId);
    },

    status(id, ownerId) {
      const operation = owned(id, ownerId);
      return {
        operationId: operation.id,
        kind: operation.kind,
        status: operation.status,
        result: operation.result,
        error: operation.error,
      };
    },

    cancelAll() {
      for (const operation of operations.values()) {
        if (operation.status === 'running') {
          operation.status = 'canceled';
          operation.controller.abort(new DOMException('Application shutdown', 'AbortError'));
        }
      }
    },
  };
}

module.exports = { createOperationRegistry };
