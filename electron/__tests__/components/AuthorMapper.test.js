import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import AuthorMapper from '../../src/components/AuthorMapper';

describe('AuthorMapper', () => {
  let mockSaveAuthorMappings;

  beforeEach(() => {
    mockSaveAuthorMappings = jest.fn().mockResolvedValue({ success: true });
    window.electronAPI = {
      saveAuthorMappings: mockSaveAuthorMappings,
    };
  });

  afterEach(() => {
    delete window.electronAPI;
  });

  test('renders author mapper header', () => {
    render(<AuthorMapper onSave={jest.fn()} onCancel={jest.fn()} />);
    expect(screen.getByText('Author Mapping')).toBeInTheDocument();
    expect(screen.getByText('Map original authors to new identities')).toBeInTheDocument();
  });

  test('renders initial empty mapping row with placeholders', () => {
    render(<AuthorMapper onSave={jest.fn()} onCancel={jest.fn()} />);
    expect(screen.getByPlaceholderText('John Doe')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('john@example.com')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('John Smith')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('john@newhost.com')).toBeInTheDocument();
  });

  test('add mapping button creates new row', async () => {
    render(<AuthorMapper onSave={jest.fn()} onCancel={jest.fn()} />);
    const addButton = screen.getByText('Add Mapping');

    await act(async () => {
      fireEvent.click(addButton);
    });

    const nameInputs = screen.getAllByPlaceholderText('John Doe');
    expect(nameInputs).toHaveLength(2);
  });

  test('remove mapping button removes row', async () => {
    render(<AuthorMapper onSave={jest.fn()} onCancel={jest.fn()} />);

    // Add a second mapping
    await act(async () => {
      fireEvent.click(screen.getByText('Add Mapping'));
    });
    expect(screen.getAllByPlaceholderText('John Doe')).toHaveLength(2);

    // Remove one
    const removeButtons = screen.getAllByText('Remove');
    await act(async () => {
      fireEvent.click(removeButtons[0]);
    });
    expect(screen.getAllByPlaceholderText('John Doe')).toHaveLength(1);
  });

  test('save calls onSave with correct author mappings', async () => {
    const onSave = jest.fn();
    render(<AuthorMapper onSave={onSave} onCancel={jest.fn()} />);

    fireEvent.change(screen.getByPlaceholderText('John Doe'), { target: { value: 'Old Author' } });
    fireEvent.change(screen.getByPlaceholderText('john@example.com'), { target: { value: 'old@example.com' } });
    fireEvent.change(screen.getByPlaceholderText('John Smith'), { target: { value: 'New Author' } });
    fireEvent.change(screen.getByPlaceholderText('john@newhost.com'), { target: { value: 'new@example.com' } });

    await act(async () => {
      fireEvent.click(screen.getByText('Save Mappings'));
    });

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith({
        authorMappings: {
          'old@example.com': {
            original_name: 'Old Author',
            original_email: 'old@example.com',
            new_name: 'New Author',
            new_email: 'new@example.com',
          },
        },
        committerMappings: {},
      });
    });
  });

  test('save persists mappings via IPC', async () => {
    const onSave = jest.fn();
    render(<AuthorMapper onSave={onSave} onCancel={jest.fn()} />);

    fireEvent.change(screen.getByPlaceholderText('John Doe'), { target: { value: 'A' } });
    fireEvent.change(screen.getByPlaceholderText('john@example.com'), { target: { value: 'a@b.com' } });
    fireEvent.change(screen.getByPlaceholderText('John Smith'), { target: { value: 'B' } });
    fireEvent.change(screen.getByPlaceholderText('john@newhost.com'), { target: { value: 'b@c.com' } });

    await act(async () => {
      fireEvent.click(screen.getByText('Save Mappings'));
    });

    await waitFor(() => {
      expect(mockSaveAuthorMappings).toHaveBeenCalledWith({
        authorMappings: expect.any(Object),
        committerMappings: {},
      });
    });
  });

  test('cancel button calls onCancel', () => {
    const onCancel = jest.fn();
    render(<AuthorMapper onSave={jest.fn()} onCancel={onCancel} />);
    fireEvent.click(screen.getByText('Cancel'));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  test('type selector switches between author and committer', async () => {
    const onSave = jest.fn();
    render(<AuthorMapper onSave={onSave} onCancel={jest.fn()} />);

    // Open the Ant Design Select dropdown via the combobox role
    const combobox = screen.getByRole('combobox');
    await act(async () => {
      fireEvent.mouseDown(combobox);
    });

    // Wait for the dropdown to appear, then click Committer option
    await waitFor(() => {
      const options = document.querySelectorAll('.ant-select-item-option');
      expect(options.length).toBeGreaterThanOrEqual(2);
    });
    const committerOption = document.querySelector('.ant-select-item-option[title="Committer"]');
    await act(async () => {
      fireEvent.click(committerOption);
    });

    // Fill in fields
    fireEvent.change(screen.getByPlaceholderText('John Doe'), { target: { value: 'CommitterName' } });
    fireEvent.change(screen.getByPlaceholderText('john@example.com'), { target: { value: 'c@d.com' } });
    fireEvent.change(screen.getByPlaceholderText('John Smith'), { target: { value: 'NewCommitter' } });
    fireEvent.change(screen.getByPlaceholderText('john@newhost.com'), { target: { value: 'd@e.com' } });

    await act(async () => {
      fireEvent.click(screen.getByText('Save Mappings'));
    });

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith({
        authorMappings: {},
        committerMappings: {
          'c@d.com': expect.objectContaining({
            original_name: 'CommitterName',
            new_name: 'NewCommitter',
          }),
        },
      });
    });
  });

  test('handles IPC save failure gracefully', async () => {
    mockSaveAuthorMappings.mockRejectedValue(new Error('IPC failed'));
    const onSave = jest.fn();
    render(<AuthorMapper onSave={onSave} onCancel={jest.fn()} />);

    fireEvent.change(screen.getByPlaceholderText('John Doe'), { target: { value: 'A' } });
    fireEvent.change(screen.getByPlaceholderText('john@example.com'), { target: { value: 'a@b.com' } });
    fireEvent.change(screen.getByPlaceholderText('John Smith'), { target: { value: 'B' } });
    fireEvent.change(screen.getByPlaceholderText('john@newhost.com'), { target: { value: 'b@c.com' } });

    await act(async () => {
      fireEvent.click(screen.getByText('Save Mappings'));
    });

    // onSave should still be called even if IPC persistence fails
    await waitFor(() => {
      expect(onSave).toHaveBeenCalled();
    });
  });
});
