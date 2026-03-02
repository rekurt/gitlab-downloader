import React from 'react';
import { render, screen, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import ProgressIndicator from '../../src/components/ProgressIndicator';

describe('ProgressIndicator', () => {
  let mockOnMigrationProgress;
  let progressCallback;

  beforeEach(() => {
    mockOnMigrationProgress = jest.fn((callback) => {
      progressCallback = callback;
      return jest.fn(); // cleanup function
    });
    window.electronAPI = {
      onMigrationProgress: mockOnMigrationProgress,
    };
  });

  afterEach(() => {
    delete window.electronAPI;
    progressCallback = null;
  });

  test('shows waiting message initially', () => {
    render(<ProgressIndicator migrationId="mig_123" onComplete={jest.fn()} onError={jest.fn()} />);
    expect(screen.getByText('Waiting for progress...')).toBeInTheDocument();
  });

  test('registers progress listener on mount', () => {
    render(<ProgressIndicator migrationId="mig_123" onComplete={jest.fn()} onError={jest.fn()} />);
    expect(mockOnMigrationProgress).toHaveBeenCalledTimes(1);
  });

  test('does not register listener without migrationId', () => {
    render(<ProgressIndicator migrationId={null} onComplete={jest.fn()} onError={jest.fn()} />);
    expect(mockOnMigrationProgress).not.toHaveBeenCalled();
  });

  test('updates progress display on IPC event', () => {
    render(<ProgressIndicator migrationId="mig_123" onComplete={jest.fn()} onError={jest.fn()} />);

    act(() => {
      progressCallback({
        migrationId: 'mig_123',
        status: 'running',
        progress: 50,
        current_task: 'Rewriting authors',
        messages: ['Step 1 done'],
      });
    });

    expect(screen.getByText('RUNNING')).toBeInTheDocument();
    expect(screen.getByText('50%')).toBeInTheDocument();
    expect(screen.getByText('Rewriting authors')).toBeInTheDocument();
    expect(screen.getByText('Step 1 done')).toBeInTheDocument();
  });

  test('ignores events for different migration', () => {
    render(<ProgressIndicator migrationId="mig_123" onComplete={jest.fn()} onError={jest.fn()} />);

    act(() => {
      progressCallback({
        migrationId: 'mig_other',
        status: 'running',
        progress: 50,
        current_task: 'Other task',
      });
    });

    // Should still show waiting message since we ignored the event
    expect(screen.getByText('Waiting for progress...')).toBeInTheDocument();
  });

  test('calls onComplete when migration completes', () => {
    const onComplete = jest.fn();
    render(<ProgressIndicator migrationId="mig_123" onComplete={onComplete} onError={jest.fn()} />);

    act(() => {
      progressCallback({
        migrationId: 'mig_123',
        status: 'completed',
        progress: 100,
        current_task: 'Done',
      });
    });

    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(screen.getByText('COMPLETED')).toBeInTheDocument();
    expect(screen.getByText(/Migration completed successfully/)).toBeInTheDocument();
  });

  test('calls onError when migration fails', () => {
    const onError = jest.fn();
    render(<ProgressIndicator migrationId="mig_123" onComplete={jest.fn()} onError={onError} />);

    act(() => {
      progressCallback({
        migrationId: 'mig_123',
        status: 'failed',
        progress: 100,
        current_task: 'Failed',
        error: 'Something went wrong',
      });
    });

    expect(onError).toHaveBeenCalledWith('Something went wrong');
    expect(screen.getByText('FAILED')).toBeInTheDocument();
    expect(screen.getByText(/Migration failed/)).toBeInTheDocument();
  });

  test('shows default error message when no error detail', () => {
    const onError = jest.fn();
    render(<ProgressIndicator migrationId="mig_123" onComplete={jest.fn()} onError={onError} />);

    act(() => {
      progressCallback({
        migrationId: 'mig_123',
        status: 'failed',
        progress: 100,
        current_task: 'Failed',
      });
    });

    expect(onError).toHaveBeenCalledWith('Migration failed');
  });

  test('shows progress bar with correct percentage', () => {
    render(<ProgressIndicator migrationId="mig_123" onComplete={jest.fn()} onError={jest.fn()} />);

    act(() => {
      progressCallback({
        migrationId: 'mig_123',
        status: 'running',
        progress: 75,
        current_task: 'Working',
      });
    });

    expect(screen.getByText('75%')).toBeInTheDocument();
  });

  test('renders messages list', () => {
    render(<ProgressIndicator migrationId="mig_123" onComplete={jest.fn()} onError={jest.fn()} />);

    act(() => {
      progressCallback({
        migrationId: 'mig_123',
        status: 'running',
        progress: 30,
        current_task: 'Working',
        messages: ['Message 1', 'Message 2', 'Message 3'],
      });
    });

    expect(screen.getByText('Message 1')).toBeInTheDocument();
    expect(screen.getByText('Message 2')).toBeInTheDocument();
    expect(screen.getByText('Message 3')).toBeInTheDocument();
  });

  test('handles missing electronAPI', () => {
    delete window.electronAPI;
    render(<ProgressIndicator migrationId="mig_123" onComplete={jest.fn()} onError={jest.fn()} />);
    expect(screen.getByText('Waiting for progress...')).toBeInTheDocument();
  });
});
