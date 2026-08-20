import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import SettingsPage from '../../src/components/SettingsPage';

jest.mock('../../src/components/OAuthDeviceFlow', () => () => <div>OAuth</div>);

describe('SettingsPage', () => {
  test('does not show success when main reports success:false', async () => {
    window.electronAPI = {
      saveSettings: jest.fn().mockResolvedValue({ success: false, error: 'Encryption failed' }),
      testConnection: jest.fn(),
    };
    render(<SettingsPage settings={{}} onSave={jest.fn()} />);
    fireEvent.change(screen.getByPlaceholderText('https://gitlab.example.com'), {
      target: { value: 'https://gitlab.example.com' },
    });
    fireEvent.click(screen.getByText('Save'));
    await waitFor(() => expect(screen.getByTestId('settings-result')).toHaveTextContent('Encryption failed'));
    expect(screen.getByTestId('settings-result')).not.toHaveTextContent('saved securely');
    delete window.electronAPI;
  });

  test('saves public settings, clears token inputs, and shows connection outcomes', async () => {
    const onSave = jest.fn();
    window.electronAPI = {
      saveSettings: jest.fn().mockResolvedValue({
        success: true,
        settings: { gitlabUrl: 'https://gitlab.example.com', maxConcurrency: 3 },
      }),
      testConnection: jest.fn()
        .mockResolvedValueOnce({ success: true, profile: { username: 'alice' } })
        .mockResolvedValueOnce({ success: false, error: 'Forbidden' }),
    };
    render(<SettingsPage settings={{ gitlabUrl: 'https://gitlab.example.com' }} onSave={onSave} />);
    fireEvent.click(screen.getByText('Test saved credentials'));
    await waitFor(() => expect(screen.getByTestId('settings-result')).toHaveTextContent('Connected as alice'));
    fireEvent.click(screen.getByText('Test saved credentials'));
    await waitFor(() => expect(screen.getByTestId('settings-result')).toHaveTextContent('Forbidden'));

    const passwords = document.querySelectorAll('input[type="password"]');
    fireEvent.change(passwords[0], { target: { value: 'source-secret' } });
    fireEvent.change(passwords[1], { target: { value: 'destination-secret' } });
    fireEvent.click(screen.getByText('Save'));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({
      gitlabUrl: 'https://gitlab.example.com', maxConcurrency: 3,
    }));
    expect(passwords[0]).toHaveValue('');
    expect(passwords[1]).toHaveValue('');
    delete window.electronAPI;
  });
});
