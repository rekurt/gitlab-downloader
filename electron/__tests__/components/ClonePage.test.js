import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import ClonePage from '../../src/components/ClonePage';

describe('ClonePage', () => {
  test('selects projects by ID, starts a clone, renders partial state, and cleans up', async () => {
    let listener;
    const cleanup = jest.fn();
    window.electronAPI = {
      selectDirectory: jest.fn().mockResolvedValue({
        success: true, directoryId: 'directory-1', displayPath: '/allowed',
      }),
      fetchProjects: jest.fn().mockResolvedValue({
        success: true,
        sessionId: 'session-1',
        projects: [{ id: 77, fullPath: 'team/app' }],
      }),
      startClone: jest.fn().mockResolvedValue({ success: true, operationId: 'clone-1' }),
      onOperationEvent: jest.fn((callback) => { listener = callback; return cleanup; }),
    };
    const view = render(<ClonePage />);
    fireEvent.click(screen.getByText('Choose destination'));
    await waitFor(() => expect(screen.getByText('/allowed')).toBeInTheDocument());
    fireEvent.change(screen.getByPlaceholderText('Optional group path'), { target: { value: 'team' } });
    fireEvent.click(screen.getByText('Load projects'));
    await waitFor(() => expect(screen.getByText('team/app')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('switch'));
    await waitFor(() => expect(screen.getByText('Clone selected').closest('button')).toBeEnabled());
    fireEvent.click(screen.getByText('Clone selected'));
    await waitFor(() => expect(window.electronAPI.startClone).toHaveBeenCalledWith({
      sessionId: 'session-1', projectIds: [77], directoryId: 'directory-1', updateExisting: true,
    }));
    await screen.findByText('Clone: running');
    await act(async () => listener({ operationId: 'other', status: 'failed' }));
    expect(screen.getByText('Clone: running')).toBeInTheDocument();
    await act(async () => listener({ operationId: 'clone-1', status: 'partial', message: 'one failed' }));
    expect(screen.getByText('Clone: partial')).toBeInTheDocument();
    expect(screen.getByText('one failed')).toBeInTheDocument();
    view.unmount();
    expect(cleanup).toHaveBeenCalled();
    delete window.electronAPI;
  });

  test('shows main-process failures from project loading and clone start', async () => {
    window.electronAPI = {
      selectDirectory: jest.fn().mockResolvedValue({ success: true, directoryId: 'd', displayPath: '/d' }),
      fetchProjects: jest.fn()
        .mockResolvedValueOnce({ success: false, error: 'fetch denied' })
        .mockResolvedValueOnce({ success: true, sessionId: 's', projects: [{ id: 1, fullPath: 'one' }] }),
      startClone: jest.fn().mockResolvedValue({ success: false, error: 'clone denied' }),
      onOperationEvent: jest.fn(),
    };
    render(<ClonePage />);
    fireEvent.click(screen.getByText('Load projects'));
    await waitFor(() => expect(screen.getByText('fetch denied')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Choose destination'));
    fireEvent.click(screen.getByText('Load projects'));
    await waitFor(() => expect(screen.getByText('one')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('checkbox'));
    await waitFor(() => expect(screen.getByText('Clone selected').closest('button')).toBeEnabled());
    fireEvent.click(screen.getByText('Clone selected'));
    await waitFor(() => expect(screen.getByText('clone denied')).toBeInTheDocument());
    delete window.electronAPI;
  });
});
