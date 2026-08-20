import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import TransferPage from '../../src/components/TransferPage';

describe('TransferPage', () => {
  test('renders partial results as warnings and cleans up operation subscription', async () => {
    let listener;
    const cleanup = jest.fn();
    window.electronAPI = {
      planTransfer: jest.fn().mockResolvedValue({
        success: true,
        planId: 'plan-1',
        plan: {
          warnings: [],
          entities: [{
            id: 'project:team/app',
            sourceFullPath: 'team/app',
            destinationFullPath: 'archive/app',
            mode: 'git_sync',
            reason: 'destination exists',
          }],
        },
      }),
      startTransfer: jest.fn().mockResolvedValue({ success: true, operationId: 'transfer-1' }),
      onOperationEvent: jest.fn((callback) => {
        listener = callback;
        return cleanup;
      }),
    };
    const view = render(<TransferPage />);
    const inputs = screen.getAllByRole('textbox');
    ['https://source.example.com', 'https://destination.example.com', 'team/app', 'archive']
      .forEach((value, index) => fireEvent.change(inputs[index], { target: { value } }));
    fireEvent.click(screen.getByText('Create safe plan'));
    await waitFor(() => expect(screen.getByText('Run transfer')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Run transfer'));
    await waitFor(() => expect(window.electronAPI.startTransfer).toHaveBeenCalledWith({ planId: 'plan-1' }));
    await act(async () => {
      listener({
        operationId: 'transfer-1',
        status: 'partial',
        result: {
          status: 'partial',
          failures: [{ message: 'refs/heads/main was divergent' }],
        },
      });
    });
    expect(screen.getByTestId('transfer-result')).toHaveTextContent('Transfer: partial');
    expect(screen.getByTestId('transfer-result')).toHaveTextContent('divergent');
    view.unmount();
    expect(cleanup).toHaveBeenCalled();
    delete window.electronAPI;
  });

  test('shows plan/start failures and a genuinely finished transfer', async () => {
    let listener;
    window.electronAPI = {
      planTransfer: jest.fn()
        .mockResolvedValueOnce({ success: false, error: 'plan blocked' })
        .mockResolvedValueOnce({
          success: true,
          planId: 'plan-2',
          plan: {
            warnings: ['LFS unavailable'],
            entities: [{
              id: 'project:team/app', sourceFullPath: 'team/app', destinationFullPath: 'archive/app',
              mode: 'git_sync', reason: 'destination exists',
            }],
          },
        }),
      startTransfer: jest.fn()
        .mockResolvedValueOnce({ success: false, error: 'start refused' })
        .mockResolvedValueOnce({ success: true, operationId: 'transfer-2' }),
      onOperationEvent: jest.fn((callback) => { listener = callback; }),
    };
    render(<TransferPage />);
    const inputs = screen.getAllByRole('textbox');
    ['https://source.example.com', 'https://destination.example.com', 'team/app', 'archive']
      .forEach((value, index) => fireEvent.change(inputs[index], { target: { value } }));
    fireEvent.click(screen.getByText('Create safe plan'));
    await waitFor(() => expect(screen.getByTestId('transfer-result')).toHaveTextContent('plan blocked'));
    fireEvent.click(screen.getByText('Create safe plan'));
    await waitFor(() => expect(screen.getByText('LFS unavailable')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Run transfer'));
    await waitFor(() => expect(screen.getByTestId('transfer-result')).toHaveTextContent('start refused'));
    fireEvent.click(screen.getByText('Run transfer'));
    await waitFor(() => expect(screen.getByTestId('transfer-result')).toHaveTextContent('running'));
    await act(async () => listener({
      operationId: 'transfer-2', status: 'finished', result: { status: 'finished', failures: [] },
    }));
    expect(screen.getByTestId('transfer-result')).toHaveTextContent('Transfer: finished');
    delete window.electronAPI;
  });
});
