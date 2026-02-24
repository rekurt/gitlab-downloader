import React from 'react';
import { render, screen, waitFor, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import App from '../../src/App';

// Mock child components to isolate App logic
jest.mock('../../src/components/RepoList', () => {
  return function MockRepoList(props) {
    return <div data-testid="repo-list" data-clone-path={props.clonePath}>RepoList</div>;
  };
});

jest.mock('../../src/components/MigrationWizard', () => {
  return function MockMigrationWizard(props) {
    return <div data-testid="migration-wizard">MigrationWizard: {props.repo?.name}</div>;
  };
});

describe('App', () => {
  let mockGetClonePath;

  beforeEach(() => {
    mockGetClonePath = jest.fn().mockResolvedValue('/test/repos');
    window.electronAPI = {
      getClonePath: mockGetClonePath,
    };
  });

  afterEach(() => {
    delete window.electronAPI;
  });

  test('renders header', async () => {
    await act(async () => {
      render(<App />);
    });
    expect(screen.getByText('GitLab Dump Desktop')).toBeInTheDocument();
  });

  test('calls getClonePath on mount', async () => {
    await act(async () => {
      render(<App />);
    });
    expect(mockGetClonePath).toHaveBeenCalledTimes(1);
  });

  test('renders RepoList with clonePath after initialization', async () => {
    await act(async () => {
      render(<App />);
    });
    await waitFor(() => {
      expect(screen.getByTestId('repo-list')).toBeInTheDocument();
    });
    expect(screen.getByTestId('repo-list')).toHaveAttribute('data-clone-path', '/test/repos');
  });

  test('renders Repositories nav button', async () => {
    await act(async () => {
      render(<App />);
    });
    expect(screen.getByText('Repositories')).toBeInTheDocument();
  });

  test('does not show status indicator (no health check)', async () => {
    await act(async () => {
      render(<App />);
    });
    expect(screen.queryByText('Connected')).not.toBeInTheDocument();
    expect(screen.queryByText('Disconnected')).not.toBeInTheDocument();
  });

  test('handles missing electronAPI gracefully', async () => {
    delete window.electronAPI;
    await act(async () => {
      render(<App />);
    });
    await waitFor(() => {
      expect(screen.getByTestId('repo-list')).toBeInTheDocument();
    });
  });

  test('handles getClonePath error gracefully', async () => {
    window.electronAPI.getClonePath = jest.fn().mockRejectedValue(new Error('fail'));
    await act(async () => {
      render(<App />);
    });
    await waitFor(() => {
      expect(screen.getByTestId('repo-list')).toBeInTheDocument();
    });
  });
});
