import { jest } from '@jest/globals';
import { showSuccess, showError, showInfo, showWarning } from '../ui.js';

// ─── Output helper functions ──────────────────────────────────

describe('showSuccess', () => {
  let logSpy;

  beforeEach(() => {
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  test('outputs success message to console', () => {
    showSuccess('All done');
    expect(logSpy).toHaveBeenCalledTimes(1);
    const output = logSpy.mock.calls[0][0];
    expect(output).toContain('All done');
    expect(output).toContain('✓');
  });
});

describe('showError', () => {
  let errSpy;

  beforeEach(() => {
    errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    errSpy.mockRestore();
  });

  test('outputs error message to stderr', () => {
    showError('Something failed');
    expect(errSpy).toHaveBeenCalledTimes(1);
    const output = errSpy.mock.calls[0][0];
    expect(output).toContain('Something failed');
    expect(output).toContain('✗');
  });
});

describe('showInfo', () => {
  let logSpy;

  beforeEach(() => {
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  test('outputs info message to console', () => {
    showInfo('Starting operation');
    expect(logSpy).toHaveBeenCalledTimes(1);
    const output = logSpy.mock.calls[0][0];
    expect(output).toContain('Starting operation');
    expect(output).toContain('ℹ');
  });
});

describe('showWarning', () => {
  let logSpy;

  beforeEach(() => {
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  test('outputs warning message to console', () => {
    showWarning('Watch out');
    expect(logSpy).toHaveBeenCalledTimes(1);
    const output = logSpy.mock.calls[0][0];
    expect(output).toContain('Watch out');
    expect(output).toContain('⚠');
  });
});
