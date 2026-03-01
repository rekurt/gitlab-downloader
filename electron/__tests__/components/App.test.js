import React from 'react';
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import App from '../../src/App';

// Mock child components to isolate App logic
jest.mock('../../src/components/AppLayout', () => {
  return function MockAppLayout({ currentView, onNavigate, children }) {
    return (
      <div data-testid="app-layout" data-current-view={currentView}>
        <button data-testid="nav-settings" onClick={() => onNavigate('settings')}>Settings</button>
        <button data-testid="nav-repos" onClick={() => onNavigate('repos')}>Repositories</button>
        <button data-testid="nav-projects" onClick={() => onNavigate('projects')}>Projects</button>
        <button data-testid="nav-clone" onClick={() => onNavigate('clone')}>Clone</button>
        <div data-testid="layout-content">{children}</div>
      </div>
    );
  };
});

jest.mock('../../src/components/SettingsPage', () => {
  return function MockSettingsPage(props) {
    return <div data-testid="settings-page">SettingsPage</div>;
  };
});

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
  let mockLoadSettings;

  beforeEach(() => {
    mockLoadSettings = jest.fn().mockResolvedValue({ clonePath: '/test/repos', gitlabUrl: 'https://gitlab.com' });
    window.electronAPI = {
      loadSettings: mockLoadSettings,
    };
  });

  afterEach(() => {
    delete window.electronAPI;
  });

  test('calls loadSettings on mount', async () => {
    await act(async () => {
      render(<App />);
    });
    expect(mockLoadSettings).toHaveBeenCalledTimes(1);
  });

  test('renders settings page by default', async () => {
    await act(async () => {
      render(<App />);
    });
    await waitFor(() => {
      expect(screen.getByTestId('settings-page')).toBeInTheDocument();
    });
  });

  test('renders AppLayout with currentView', async () => {
    await act(async () => {
      render(<App />);
    });
    await waitFor(() => {
      expect(screen.getByTestId('app-layout')).toHaveAttribute('data-current-view', 'settings');
    });
  });

  test('navigates to repos view', async () => {
    await act(async () => {
      render(<App />);
    });
    await waitFor(() => {
      expect(screen.getByTestId('settings-page')).toBeInTheDocument();
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('nav-repos'));
    });
    expect(screen.getByTestId('repo-list')).toBeInTheDocument();
    expect(screen.queryByTestId('settings-page')).not.toBeInTheDocument();
  });

  test('passes clonePath from settings to RepoList', async () => {
    await act(async () => {
      render(<App />);
    });
    await waitFor(() => {
      expect(screen.getByTestId('settings-page')).toBeInTheDocument();
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('nav-repos'));
    });
    expect(screen.getByTestId('repo-list')).toHaveAttribute('data-clone-path', '/test/repos');
  });

  test('renders navigation buttons', async () => {
    await act(async () => {
      render(<App />);
    });
    expect(screen.getByTestId('nav-settings')).toBeInTheDocument();
    expect(screen.getByTestId('nav-repos')).toBeInTheDocument();
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
      expect(screen.getByTestId('settings-page')).toBeInTheDocument();
    });
  });

  test('handles loadSettings error gracefully', async () => {
    window.electronAPI.loadSettings = jest.fn().mockRejectedValue(new Error('fail'));
    await act(async () => {
      render(<App />);
    });
    await waitFor(() => {
      expect(screen.getByTestId('settings-page')).toBeInTheDocument();
    });
  });
});
