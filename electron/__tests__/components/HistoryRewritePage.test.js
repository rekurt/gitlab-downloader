import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import HistoryRewritePage from '../../src/components/HistoryRewritePage';

describe('HistoryRewritePage', () => {
  function api() {
    let listener;
    const cleanup = jest.fn();
    const electronAPI = {
      selectRewriteRepository: jest.fn().mockResolvedValue({ success: true, repositoryId: 'repository-1', displayPath: '/source.git' }),
      selectRewriteMapping: jest.fn().mockResolvedValue({ success: true, mappingId: 'mapping-1', ruleCount: 2 }),
      selectDirectory: jest.fn().mockResolvedValue({ success: true, directoryId: 'directory-1', displayPath: '/output' }),
      previewRewrite: jest.fn().mockResolvedValue({ success: true, operationId: 'preview-1' }),
      startRewrite: jest.fn().mockResolvedValue({ success: true, operationId: 'rewrite-1' }),
      onOperationEvent: jest.fn((callback) => { listener = callback; return cleanup; }),
    };
    return { electronAPI, cleanup, listener: () => listener };
  }

  test('previews and starts an explicitly confirmed push using only resource IDs', async () => {
    const fixture = api();
    window.electronAPI = fixture.electronAPI;
    const view = render(<HistoryRewritePage />);
    fireEvent.click(screen.getByText('Select repository'));
    fireEvent.click(screen.getByText('Select versioned mapping JSON'));
    await waitFor(() => expect(screen.getByText('/source.git')).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText('2 mapping rules')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Preview changed commits and refs'));
    await waitFor(() => expect(fixture.electronAPI.previewRewrite).toHaveBeenCalledWith({
      repositoryId: 'repository-1', mappingId: 'mapping-1',
    }));
    await act(async () => fixture.listener()({
      operationId: 'preview-1', status: 'finished', result: { status: 'preview', changedCommits: 3, changedRefs: ['main'] },
    }));
    expect(screen.getByText('3 changed commits; 1 changed refs')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Select output parent'));
    fireEvent.click(screen.getByRole('switch'));
    const confirmation = screen.getByPlaceholderText('I UNDERSTAND THAT COMMIT SHAS WILL CHANGE');
    fireEvent.change(confirmation, { target: { value: 'I UNDERSTAND THAT COMMIT SHAS WILL CHANGE' } });
    await waitFor(() => expect(screen.getByText('Rewrite into new mirror').closest('button')).toBeEnabled());
    fireEvent.click(screen.getByText('Rewrite into new mirror'));
    await waitFor(() => expect(fixture.electronAPI.startRewrite).toHaveBeenCalledWith(expect.objectContaining({
      repositoryId: 'repository-1', mappingId: 'mapping-1', outputDirectoryId: 'directory-1',
      push: true, previewId: 'preview-1',
    })));
    await act(async () => fixture.listener()({
      operationId: 'rewrite-1',
      status: 'failed',
      result: {
        status: 'failed',
        error: 'lease conflict',
        recovery: 'git clone --mirror before.bundle restored.git',
      },
    }));
    expect(screen.getByText(/lease conflict/)).toBeInTheDocument();
    expect(screen.getByText(/before\.bundle/)).toBeInTheDocument();
    view.unmount();
    expect(fixture.cleanup).toHaveBeenCalled();
    delete window.electronAPI;
  });

  test('ignores canceled pickers and shows a start failure', async () => {
    const fixture = api();
    fixture.electronAPI.selectRewriteRepository.mockResolvedValueOnce({ success: false, canceled: true });
    fixture.electronAPI.startRewrite.mockResolvedValueOnce({ success: false, error: 'rewrite refused' });
    window.electronAPI = fixture.electronAPI;
    render(<HistoryRewritePage />);
    fireEvent.click(screen.getByText('Select repository'));
    expect(screen.queryByText('/source.git')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('Select repository'));
    fireEvent.click(screen.getByText('Select versioned mapping JSON'));
    fireEvent.click(screen.getByText('Select output parent'));
    await waitFor(() => expect(screen.getByText('/source.git')).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText('Rewrite into new mirror').closest('button')).toBeEnabled());
    fireEvent.click(screen.getByText('Rewrite into new mirror'));
    await waitFor(() => expect(screen.getByText('rewrite refused')).toBeInTheDocument());
    delete window.electronAPI;
  });
});
