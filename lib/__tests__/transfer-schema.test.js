import { describe, expect, test } from '@jest/globals';

import {
  TransferConnectionSchema,
  TransferEventSchema,
  TransferPlanSchema,
  isDirectTransferCompatible,
} from '../transfer-schema.js';

describe('TransferConnectionSchema', () => {
  test('normalizes a valid HTTPS connection', () => {
    expect(
      TransferConnectionSchema.parse({
        url: 'https://gitlab.example.com///',
        token: 'secret',
      }),
    ).toEqual({ url: 'https://gitlab.example.com', token: 'secret' });
  });

  test('rejects HTTP connections for platform transfer', () => {
    expect(() =>
      TransferConnectionSchema.parse({
        url: 'http://gitlab.example.com',
        token: 'secret',
      }),
    ).toThrow(/HTTPS/);
  });

  test('rejects credentials embedded in a connection URL', () => {
    expect(() => TransferConnectionSchema.parse({
      url: 'https://oauth2:must-not-leak@gitlab.example.com',
      token: 'runtime-secret',
    })).toThrow(/credentials/i);
    expect(() => TransferConnectionSchema.parse({
      url: 'https://gitlab.example.com?private_token=must-not-leak',
      token: 'runtime-secret',
    })).toThrow(/query/i);
  });
});

describe('TransferPlanSchema', () => {
  const validPlan = {
    schemaVersion: 1,
    createdAt: '2026-08-20T10:00:00.000Z',
    source: {
      url: 'https://source.example.com',
      version: '18.6.2',
      fullPath: 'team/platform',
      type: 'group',
    },
    destination: {
      url: 'https://destination.example.com',
      version: '18.7.1',
      namespace: 'archive',
    },
    entities: [
      {
        id: 'group:team/platform',
        sourceType: 'group',
        sourceFullPath: 'team/platform',
        destinationFullPath: 'archive/platform',
        destinationNamespace: 'archive',
        destinationSlug: 'platform',
        mode: 'direct_transfer',
        reason: 'destination entity does not exist',
      },
    ],
    warnings: [],
  };

  test('accepts a versioned plan with explicit entity modes', () => {
    expect(TransferPlanSchema.parse(validPlan)).toEqual(validPlan);
  });

  test.each(['direct_transfer', 'git_sync', 'git_only_fallback', 'blocked'])(
    'accepts %s mode',
    (mode) => {
      const plan = structuredClone(validPlan);
      plan.entities[0].mode = mode;
      expect(TransferPlanSchema.parse(plan).entities[0].mode).toBe(mode);
    },
  );

  test('rejects secrets anywhere in the serialized plan', () => {
    const plan = structuredClone(validPlan);
    plan.source.token = 'must-not-be-persisted';
    expect(() => TransferPlanSchema.parse(plan)).toThrow();
  });

  test('rejects credentials embedded in a persisted plan URL', () => {
    const plan = structuredClone(validPlan);
    plan.source.url = 'https://oauth2:must-not-leak@source.example.com';
    expect(() => TransferPlanSchema.parse(plan)).toThrow(/credentials/i);
  });
});

describe('TransferEventSchema', () => {
  test('accepts the shared CLI/Electron progress contract', () => {
    const event = {
      runId: 'run-1',
      entityId: 'project:team/api',
      phase: 'git_sync',
      status: 'running',
      progress: 0.5,
      message: 'Synchronizing repository refs',
    };
    expect(TransferEventSchema.parse(event)).toEqual(event);
  });

  test('rejects out-of-range progress and unknown event fields', () => {
    expect(() => TransferEventSchema.parse({
      runId: 'run-1',
      entityId: null,
      phase: 'complete',
      status: 'finished',
      progress: 2,
      message: 'done',
      token: 'secret',
    })).toThrow();
  });
});

describe('isDirectTransferCompatible', () => {
  test.each([
    ['18.6.2', '18.7.1'],
    ['17.11.4', '18.0.2'],
    ['18.7.0-ee', '18.7.3'],
  ])('accepts supported source %s and destination %s', (source, destination) => {
    expect(isDirectTransferCompatible(source, destination)).toBe(true);
  });

  test.each([
    ['16.7.9', '16.8.0'],
    ['18.2.0', '18.5.0'],
    ['18.8.0', '18.7.0'],
    ['not-a-version', '18.7.0'],
  ])('rejects incompatible source %s and destination %s', (source, destination) => {
    expect(isDirectTransferCompatible(source, destination)).toBe(false);
  });
});
