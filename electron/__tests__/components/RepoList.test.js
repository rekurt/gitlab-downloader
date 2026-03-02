import React from 'react';
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { App as AntApp } from 'antd';
import RepoList from '../../src/components/RepoList';

function renderWithAntd(ui) {
  return render(<AntApp>{ui}</AntApp>);
}

describe('RepoList', () => {
  let mockGetRepos;
  let mockCloneRepositories;
  let mockOpenPath;

  const mockRepos = [
    {
      name: 'repo1',
      path: '/repos/repo1',
      url: 'https://gitlab.com/group/repo1.git',
      last_updated: '2024-01-01T00:00:00Z',
    },
    {
      name: 'repo2',
      path: '/repos/repo2',
      url: 'https://gitlab.com/group/repo2.git',
      last_updated: null,
    },
  ];

  beforeEach(() => {
    jest.useFakeTimers();
    mockGetRepos = jest.fn().mockResolvedValue({ repositories: mockRepos });
    mockCloneRepositories = jest.fn().mockResolvedValue({ success: true, results: [] });
    mockOpenPath = jest.fn().mockResolvedValue({ success: true });
    window.electronAPI = {
      getRepos: mockGetRepos,
      cloneRepositories: mockCloneRepositories,
      openPath: mockOpenPath,
    };
  });

  afterEach(() => {
    jest.useRealTimers();
    delete window.electronAPI;
  });

  test('shows loading state initially', async () => {
    await act(async () => {
      renderWithAntd(<RepoList clonePath="/repos" />);
    });
    // Table shows loading via Ant Design Spin - the component has loaded by now
    expect(mockGetRepos).toHaveBeenCalledWith('/repos');
  });

  test('calls getRepos with clonePath', async () => {
    await act(async () => {
      renderWithAntd(<RepoList clonePath="/repos" />);
    });
    expect(mockGetRepos).toHaveBeenCalledWith('/repos');
  });

  test('renders repository names in the table', async () => {
    await act(async () => {
      renderWithAntd(<RepoList clonePath="/repos" />);
    });

    await waitFor(() => {
      expect(screen.getByText('repo1')).toBeInTheDocument();
    });
    expect(screen.getByText('repo2')).toBeInTheDocument();
  });

  test('displays repository count', async () => {
    await act(async () => {
      renderWithAntd(<RepoList clonePath="/repos" />);
    });

    await waitFor(() => {
      expect(screen.getByText('2 repositories')).toBeInTheDocument();
    });
  });

  test('renders remote URL column', async () => {
    await act(async () => {
      renderWithAntd(<RepoList clonePath="/repos" />);
    });

    await waitFor(() => {
      expect(screen.getByText('https://gitlab.com/group/repo1.git')).toBeInTheDocument();
    });
  });

  test('renders local path column', async () => {
    await act(async () => {
      renderWithAntd(<RepoList clonePath="/repos" />);
    });

    await waitFor(() => {
      expect(screen.getByText('/repos/repo1')).toBeInTheDocument();
    });
  });

  test('shows empty state when no repos', async () => {
    mockGetRepos.mockResolvedValue({ repositories: [] });
    await act(async () => {
      renderWithAntd(<RepoList clonePath="/repos" />);
    });

    await waitFor(() => {
      expect(
        screen.getByText('No repositories found. Clone projects first.'),
      ).toBeInTheDocument();
    });
  });

  test('shows error state on failure', async () => {
    mockGetRepos.mockRejectedValue(new Error('Network error'));
    await act(async () => {
      renderWithAntd(<RepoList clonePath="/repos" />);
    });

    await waitFor(() => {
      expect(
        screen.getByText(/Error loading repositories: Network error/),
      ).toBeInTheDocument();
    });
  });

  test('handles missing electronAPI', async () => {
    delete window.electronAPI;
    await act(async () => {
      renderWithAntd(<RepoList clonePath="/repos" />);
    });

    await waitFor(() => {
      expect(
        screen.getByText('No repositories found. Clone projects first.'),
      ).toBeInTheDocument();
    });
  });

  test('passes undefined clonePath when empty', async () => {
    await act(async () => {
      renderWithAntd(<RepoList clonePath="" />);
    });
    expect(mockGetRepos).toHaveBeenCalledWith(undefined);
  });

  test('shows retry button on error', async () => {
    mockGetRepos.mockRejectedValue(new Error('fail'));
    await act(async () => {
      renderWithAntd(<RepoList clonePath="/repos" />);
    });

    await waitFor(() => {
      expect(screen.getByText('Retry')).toBeInTheDocument();
    });
  });

  test('has search input', async () => {
    await act(async () => {
      renderWithAntd(<RepoList clonePath="/repos" />);
    });

    await waitFor(() => {
      expect(screen.getByTestId('search-input')).toBeInTheDocument();
    });
  });

  test('filters repos by search text', async () => {
    await act(async () => {
      renderWithAntd(<RepoList clonePath="/repos" />);
    });

    await waitFor(() => {
      expect(screen.getByText('repo1')).toBeInTheDocument();
    });

    const searchInput = screen.getByTestId('search-input').querySelector('input');
    await act(async () => {
      fireEvent.change(searchInput, { target: { value: 'repo1' } });
    });

    expect(screen.getByText('repo1')).toBeInTheDocument();
    expect(screen.queryByText('repo2')).not.toBeInTheDocument();
  });

  test('has refresh button', async () => {
    await act(async () => {
      renderWithAntd(<RepoList clonePath="/repos" />);
    });

    await waitFor(() => {
      expect(screen.getByTestId('refresh-btn')).toBeInTheDocument();
    });
  });

  test('has action buttons for each repo', async () => {
    await act(async () => {
      renderWithAntd(<RepoList clonePath="/repos" />);
    });

    await waitFor(() => {
      expect(screen.getByTestId('update-btn-repo1')).toBeInTheDocument();
      expect(screen.getByTestId('migrate-btn-repo1')).toBeInTheDocument();
      expect(screen.getByTestId('open-btn-repo1')).toBeInTheDocument();
    });
  });

  test('open folder button calls openPath IPC', async () => {
    await act(async () => {
      renderWithAntd(<RepoList clonePath="/repos" />);
    });

    await waitFor(() => {
      expect(screen.getByTestId('open-btn-repo1')).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId('open-btn-repo1'));
    });

    expect(mockOpenPath).toHaveBeenCalledWith('/repos/repo1');
  });

  test('migrate button calls onMigrationStart', async () => {
    const onMigrationStart = jest.fn();
    const onSelectRepo = jest.fn();
    await act(async () => {
      renderWithAntd(
        <RepoList
          clonePath="/repos"
          onSelectRepo={onSelectRepo}
          onMigrationStart={onMigrationStart}
        />,
      );
    });

    await waitFor(() => {
      expect(screen.getByTestId('migrate-btn-repo1')).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId('migrate-btn-repo1'));
    });

    expect(onMigrationStart).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'repo1', path: '/repos/repo1' }),
    );
  });

  test('update button calls cloneRepositories with updateExisting', async () => {
    await act(async () => {
      renderWithAntd(<RepoList clonePath="/repos" />);
    });

    await waitFor(() => {
      expect(screen.getByTestId('update-btn-repo1')).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId('update-btn-repo1'));
    });

    expect(mockCloneRepositories).toHaveBeenCalledWith({
      projects: [
        expect.objectContaining({
          name: 'repo1',
          http_url_to_repo: 'https://gitlab.com/group/repo1.git',
        }),
      ],
      updateExisting: true,
    });
  });

  test('shows "Unknown" tag for repos without last_updated', async () => {
    await act(async () => {
      renderWithAntd(<RepoList clonePath="/repos" />);
    });

    await waitFor(() => {
      expect(screen.getByText('Unknown')).toBeInTheDocument();
    });
  });

  test('page title is Local Repositories', async () => {
    await act(async () => {
      renderWithAntd(<RepoList clonePath="/repos" />);
    });

    await waitFor(() => {
      expect(screen.getByText('Local Repositories')).toBeInTheDocument();
    });
  });
});
