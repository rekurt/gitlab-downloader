import React from 'react';
import { render, screen, waitFor, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import RepoList from '../../src/components/RepoList';

describe('RepoList', () => {
  let mockGetRepos;

  beforeEach(() => {
    jest.useFakeTimers();
    mockGetRepos = jest.fn().mockResolvedValue({
      repositories: [
        { name: 'repo1', path: '/repos/repo1', url: 'https://gitlab.com/group/repo1.git', last_updated: '2024-01-01T00:00:00Z' },
        { name: 'repo2', path: '/repos/repo2', url: 'https://gitlab.com/group/repo2.git', last_updated: null },
      ],
    });
    window.electronAPI = {
      getRepos: mockGetRepos,
    };
  });

  afterEach(() => {
    jest.useRealTimers();
    delete window.electronAPI;
  });

  test('shows loading state initially', () => {
    render(<RepoList clonePath="/repos" />);
    expect(screen.getByText('Loading repositories...')).toBeInTheDocument();
  });

  test('calls getRepos with clonePath', async () => {
    await act(async () => {
      render(<RepoList clonePath="/repos" />);
    });
    expect(mockGetRepos).toHaveBeenCalledWith('/repos');
  });

  test('renders repository list', async () => {
    await act(async () => {
      render(<RepoList clonePath="/repos" />);
    });

    await waitFor(() => {
      expect(screen.getByText('repo1')).toBeInTheDocument();
    });
    expect(screen.getByText('repo2')).toBeInTheDocument();
    expect(screen.getByText('2 repositories')).toBeInTheDocument();
  });

  test('renders repository URLs', async () => {
    await act(async () => {
      render(<RepoList clonePath="/repos" />);
    });

    await waitFor(() => {
      expect(screen.getByText('https://gitlab.com/group/repo1.git')).toBeInTheDocument();
    });
  });

  test('shows empty state when no repos', async () => {
    mockGetRepos.mockResolvedValue({ repositories: [] });
    await act(async () => {
      render(<RepoList clonePath="/repos" />);
    });

    await waitFor(() => {
      expect(screen.getByText('No repositories cloned yet.')).toBeInTheDocument();
    });
  });

  test('shows error state on failure', async () => {
    mockGetRepos.mockRejectedValue(new Error('Network error'));
    await act(async () => {
      render(<RepoList clonePath="/repos" />);
    });

    await waitFor(() => {
      expect(screen.getByText(/Error loading repositories: Network error/)).toBeInTheDocument();
    });
  });

  test('handles missing electronAPI', async () => {
    delete window.electronAPI;
    await act(async () => {
      render(<RepoList clonePath="/repos" />);
    });

    await waitFor(() => {
      expect(screen.getByText('No repositories cloned yet.')).toBeInTheDocument();
    });
  });

  test('passes undefined clonePath when empty', async () => {
    await act(async () => {
      render(<RepoList clonePath="" />);
    });
    expect(mockGetRepos).toHaveBeenCalledWith(undefined);
  });

  test('shows retry button on error', async () => {
    mockGetRepos.mockRejectedValue(new Error('fail'));
    await act(async () => {
      render(<RepoList clonePath="/repos" />);
    });

    await waitFor(() => {
      expect(screen.getByText('Retry')).toBeInTheDocument();
    });
  });
});
