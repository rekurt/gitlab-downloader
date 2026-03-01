import React from 'react';
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { App as AntApp } from 'antd';
import SettingsPage from '../../src/components/SettingsPage';

// Wrap with AntApp for message context
function renderWithAntd(ui) {
  return render(<AntApp>{ui}</AntApp>);
}

describe('SettingsPage', () => {
  let mockSaveSettings;
  let mockTestConnection;
  let mockSelectDirectory;
  let onSave;

  beforeEach(() => {
    mockSaveSettings = jest.fn().mockResolvedValue({ success: true });
    mockTestConnection = jest.fn().mockResolvedValue({ success: true, username: 'testuser' });
    mockSelectDirectory = jest.fn().mockResolvedValue('/selected/path');
    onSave = jest.fn();

    window.electronAPI = {
      saveSettings: mockSaveSettings,
      testConnection: mockTestConnection,
      selectDirectory: mockSelectDirectory,
      loadSettings: jest.fn().mockResolvedValue({}),
    };
  });

  afterEach(() => {
    delete window.electronAPI;
  });

  test('renders settings form', async () => {
    await act(async () => {
      renderWithAntd(<SettingsPage settings={{}} onSave={onSave} />);
    });
    expect(screen.getByText('Settings')).toBeInTheDocument();
    expect(screen.getByText('Save')).toBeInTheDocument();
    expect(screen.getByText('Test Connection')).toBeInTheDocument();
  });

  test('renders GitLab URL input', async () => {
    await act(async () => {
      renderWithAntd(<SettingsPage settings={{}} onSave={onSave} />);
    });
    expect(screen.getByText('GitLab URL')).toBeInTheDocument();
  });

  test('renders auth method radio buttons', async () => {
    await act(async () => {
      renderWithAntd(<SettingsPage settings={{}} onSave={onSave} />);
    });
    expect(screen.getByText('Token')).toBeInTheDocument();
    expect(screen.getByText('OAuth')).toBeInTheDocument();
  });

  test('shows token input when auth method is token', async () => {
    await act(async () => {
      renderWithAntd(
        <SettingsPage settings={{ authMethod: 'token' }} onSave={onSave} />,
      );
    });
    expect(screen.getByText('Personal Access Token')).toBeInTheDocument();
  });

  test('shows OAuth Client ID input when auth method is oauth', async () => {
    await act(async () => {
      renderWithAntd(
        <SettingsPage settings={{ authMethod: 'oauth' }} onSave={onSave} />,
      );
    });
    expect(screen.getByText('OAuth Client ID')).toBeInTheDocument();
  });

  test('renders git auth mode radio buttons', async () => {
    await act(async () => {
      renderWithAntd(<SettingsPage settings={{}} onSave={onSave} />);
    });
    expect(screen.getByText('URL')).toBeInTheDocument();
    expect(screen.getByText('Credential Helper')).toBeInTheDocument();
  });

  test('renders max concurrency input', async () => {
    await act(async () => {
      renderWithAntd(<SettingsPage settings={{}} onSave={onSave} />);
    });
    expect(screen.getByText('Max Concurrency')).toBeInTheDocument();
  });

  test('renders clone path input with folder picker', async () => {
    await act(async () => {
      renderWithAntd(<SettingsPage settings={{}} onSave={onSave} />);
    });
    expect(screen.getByText('Clone Path')).toBeInTheDocument();
    expect(screen.getByTestId('select-directory-btn')).toBeInTheDocument();
  });

  test('populates form with provided settings', async () => {
    const settings = {
      gitlabUrl: 'https://my-gitlab.com',
      authMethod: 'token',
      token: 'test-token-123',
      clonePath: '/my/repos',
      maxConcurrency: 6,
      gitAuthMode: 'credential_helper',
    };

    await act(async () => {
      renderWithAntd(<SettingsPage settings={settings} onSave={onSave} />);
    });

    const urlInput = screen.getByPlaceholderText('https://gitlab.com');
    expect(urlInput).toHaveValue('https://my-gitlab.com');
  });

  test('handles test connection click', async () => {
    await act(async () => {
      renderWithAntd(
        <SettingsPage
          settings={{ gitlabUrl: 'https://gitlab.com', authMethod: 'token', token: 'abc' }}
          onSave={onSave}
        />,
      );
    });

    const testBtn = screen.getByTestId('test-connection-btn');
    await act(async () => {
      fireEvent.click(testBtn);
    });

    await waitFor(() => {
      expect(mockTestConnection).toHaveBeenCalled();
    });
  });

  test('handles missing electronAPI gracefully for test connection', async () => {
    delete window.electronAPI;

    await act(async () => {
      renderWithAntd(
        <SettingsPage settings={{}} onSave={onSave} />,
      );
    });

    // Should not crash when clicking test connection without electronAPI
    const testBtn = screen.getByTestId('test-connection-btn');
    await act(async () => {
      fireEvent.click(testBtn);
    });
  });
});
