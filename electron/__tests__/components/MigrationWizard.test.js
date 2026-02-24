import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import MigrationWizard from '../../src/components/MigrationWizard';

// Mock child components to isolate wizard logic
jest.mock('../../src/components/AuthorMapper', () => {
  return function MockAuthorMapper({ onSave, onCancel }) {
    return (
      <div data-testid="author-mapper">
        <button onClick={() => onSave({ authorMappings: { 'a@b.com': { original_name: 'A', original_email: 'a@b.com', new_name: 'B', new_email: 'b@c.com' } }, committerMappings: {} })}>
          Mock Save Mappings
        </button>
        <button onClick={onCancel}>Mock Cancel</button>
      </div>
    );
  };
});

jest.mock('../../src/components/ProgressIndicator', () => {
  return function MockProgressIndicator({ migrationId, onComplete, onError }) {
    return (
      <div data-testid="progress-indicator">
        Migration ID: {migrationId}
        <button onClick={() => onComplete({ status: 'completed' })}>Mock Complete</button>
        <button onClick={() => onError('mock error')}>Mock Error</button>
      </div>
    );
  };
});

describe('MigrationWizard', () => {
  const mockRepo = { name: 'test-repo', path: '/repos/test-repo' };
  let mockStartMigration;

  beforeEach(() => {
    mockStartMigration = jest.fn().mockResolvedValue({ success: true, migrationId: 'mig_123' });
    window.electronAPI = {
      startMigration: mockStartMigration,
    };
  });

  afterEach(() => {
    delete window.electronAPI;
  });

  test('renders wizard header with repo name', () => {
    render(<MigrationWizard repo={mockRepo} onComplete={jest.fn()} onCancel={jest.fn()} />);
    expect(screen.getByText('Migration Wizard')).toBeInTheDocument();
    expect(screen.getByText('Repository: test-repo')).toBeInTheDocument();
  });

  test('renders step indicators', () => {
    render(<MigrationWizard repo={mockRepo} onComplete={jest.fn()} onCancel={jest.fn()} />);
    expect(screen.getByText('Configure Authors')).toBeInTheDocument();
    expect(screen.getByText('Review & Confirm')).toBeInTheDocument();
    expect(screen.getByText('Migration In Progress')).toBeInTheDocument();
    expect(screen.getByText('Complete')).toBeInTheDocument();
  });

  test('starts on step 1 with AuthorMapper', () => {
    render(<MigrationWizard repo={mockRepo} onComplete={jest.fn()} onCancel={jest.fn()} />);
    expect(screen.getByTestId('author-mapper')).toBeInTheDocument();
  });

  test('advances to step 2 after saving mappings', () => {
    render(<MigrationWizard repo={mockRepo} onComplete={jest.fn()} onCancel={jest.fn()} />);
    fireEvent.click(screen.getByText('Mock Save Mappings'));

    expect(screen.getByText('Review Mappings')).toBeInTheDocument();
    expect(screen.getByText('Start Migration')).toBeInTheDocument();
  });

  test('shows author mappings in review step', () => {
    render(<MigrationWizard repo={mockRepo} onComplete={jest.fn()} onCancel={jest.fn()} />);
    fireEvent.click(screen.getByText('Mock Save Mappings'));

    expect(screen.getByText('Author Mappings')).toBeInTheDocument();
  });

  test('start migration calls IPC', async () => {
    render(<MigrationWizard repo={mockRepo} onComplete={jest.fn()} onCancel={jest.fn()} />);
    fireEvent.click(screen.getByText('Mock Save Mappings'));

    await act(async () => {
      fireEvent.click(screen.getByText('Start Migration'));
    });

    await waitFor(() => {
      expect(mockStartMigration).toHaveBeenCalledWith({
        repoPath: '/repos/test-repo',
        authorMappings: expect.any(Object),
        committerMappings: {},
      });
    });
  });

  test('advances to step 3 after migration starts', async () => {
    render(<MigrationWizard repo={mockRepo} onComplete={jest.fn()} onCancel={jest.fn()} />);
    fireEvent.click(screen.getByText('Mock Save Mappings'));

    await act(async () => {
      fireEvent.click(screen.getByText('Start Migration'));
    });

    await waitFor(() => {
      expect(screen.getByTestId('progress-indicator')).toBeInTheDocument();
    });
    expect(screen.getByText('Migration ID: mig_123')).toBeInTheDocument();
  });

  test('shows error when migration start fails', async () => {
    mockStartMigration.mockResolvedValue({ success: false, error: 'Server error' });
    render(<MigrationWizard repo={mockRepo} onComplete={jest.fn()} onCancel={jest.fn()} />);
    fireEvent.click(screen.getByText('Mock Save Mappings'));

    await act(async () => {
      fireEvent.click(screen.getByText('Start Migration'));
    });

    await waitFor(() => {
      expect(screen.getByText('Server error')).toBeInTheDocument();
    });
  });

  test('advances to step 4 on migration complete', async () => {
    render(<MigrationWizard repo={mockRepo} onComplete={jest.fn()} onCancel={jest.fn()} />);
    fireEvent.click(screen.getByText('Mock Save Mappings'));

    await act(async () => {
      fireEvent.click(screen.getByText('Start Migration'));
    });

    await waitFor(() => {
      expect(screen.getByTestId('progress-indicator')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Mock Complete'));
    expect(screen.getByText('Migration Complete')).toBeInTheDocument();
  });

  test('back button goes from step 2 to step 1', () => {
    render(<MigrationWizard repo={mockRepo} onComplete={jest.fn()} onCancel={jest.fn()} />);
    fireEvent.click(screen.getByText('Mock Save Mappings'));
    fireEvent.click(screen.getByText('Back'));
    expect(screen.getByTestId('author-mapper')).toBeInTheDocument();
  });

  test('handles missing electronAPI', async () => {
    delete window.electronAPI;
    render(<MigrationWizard repo={mockRepo} onComplete={jest.fn()} onCancel={jest.fn()} />);
    fireEvent.click(screen.getByText('Mock Save Mappings'));

    await act(async () => {
      fireEvent.click(screen.getByText('Start Migration'));
    });

    await waitFor(() => {
      expect(screen.getByText('Electron API not available')).toBeInTheDocument();
    });
  });
});
