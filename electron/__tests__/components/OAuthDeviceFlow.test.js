import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import OAuthDeviceFlow from '../../src/components/OAuthDeviceFlow';

describe('OAuthDeviceFlow', () => {
  test('uses current form values, never returns a token, and cleans up its subscription', async () => {
    let listener;
    const cleanup = jest.fn();
    const onAuthorized = jest.fn();
    const currentValues = {
      gitlabUrl: 'https://current.example.com',
      oauthClientId: 'current-client',
      oauthScope: 'api',
    };
    window.electronAPI = {
      startOAuth: jest.fn().mockResolvedValue({
        success: true,
        operationId: 'oauth-1',
        userCode: 'ABCD',
        verificationUri: 'https://current.example.com/oauth/device',
      }),
      openOAuth: jest.fn(),
      cancelOperation: jest.fn(),
      onOperationEvent: jest.fn((callback) => {
        listener = callback;
        return cleanup;
      }),
    };
    const view = render(<OAuthDeviceFlow getValues={() => currentValues} onAuthorized={onAuthorized} />);
    fireEvent.click(screen.getByTestId('oauth-start'));
    await waitFor(() => expect(window.electronAPI.startOAuth).toHaveBeenCalledWith(currentValues));
    await act(async () => {
      listener({
        operationId: 'oauth-1',
        status: 'finished',
        profile: { username: 'alice', name: 'Alice' },
      });
    });
    expect(onAuthorized).toHaveBeenCalledWith({ username: 'alice', name: 'Alice' });
    expect(JSON.stringify(onAuthorized.mock.calls)).not.toContain('token');
    view.unmount();
    expect(cleanup).toHaveBeenCalled();
    delete window.electronAPI;
  });

  test('shows start failures and supports retry, open, cancel, and canceled events', async () => {
    let listener;
    window.electronAPI = {
      startOAuth: jest.fn()
        .mockResolvedValueOnce({ success: false, error: 'OAuth unavailable' })
        .mockResolvedValueOnce({
          success: true,
          operationId: 'oauth-2',
          userCode: 'EFGH',
          verificationUri: 'https://gitlab.example.com/oauth/device',
        }),
      openOAuth: jest.fn().mockResolvedValue({ success: true }),
      cancelOperation: jest.fn().mockResolvedValue({ success: true }),
      onOperationEvent: jest.fn((callback) => { listener = callback; }),
    };
    render(<OAuthDeviceFlow getValues={() => ({ oauthClientId: 'client' })} />);
    fireEvent.click(screen.getByTestId('oauth-start'));
    await waitFor(() => expect(screen.getByText('OAuth unavailable')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Retry'));
    await waitFor(() => expect(screen.getByText(/Code:/)).toHaveTextContent('EFGH'));
    fireEvent.click(screen.getByText('Open authorization page'));
    expect(window.electronAPI.openOAuth).toHaveBeenCalledWith({ operationId: 'oauth-2' });
    fireEvent.click(screen.getByText('Cancel'));
    expect(window.electronAPI.cancelOperation).toHaveBeenCalledWith({ operationId: 'oauth-2' });
    await act(async () => listener({ operationId: 'other', status: 'failed', message: 'ignored' }));
    expect(screen.queryByText('ignored')).not.toBeInTheDocument();
    await act(async () => listener({ operationId: 'oauth-2', status: 'canceled' }));
    expect(screen.getByText('OAuth canceled')).toBeInTheDocument();
    delete window.electronAPI;
  });
});
