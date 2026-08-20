import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import App from '../../src/App';

jest.mock('../../src/components/AppLayout', () => ({ currentView, onNavigate, children }) => (
  <div>
    <span data-testid="current-view">{currentView}</span>
    {['settings', 'clone', 'transfer', 'rewrite'].map((view) => (
      <button key={view} onClick={() => onNavigate(view)}>{view}</button>
    ))}
    {children}
  </div>
));
jest.mock('../../src/components/SettingsPage', () => ({ onSave }) => (
  <button onClick={() => onSave({ gitlabUrl: 'https://saved.example.com' })}>settings-page</button>
));
jest.mock('../../src/components/ClonePage', () => () => <div>clone-page</div>);
jest.mock('../../src/components/TransferPage', () => () => <div>transfer-page</div>);
jest.mock('../../src/components/HistoryRewritePage', () => () => <div>rewrite-page</div>);

describe('App', () => {
  test('loads settings and navigates through all operation screens', async () => {
    window.electronAPI = { loadSettings: jest.fn().mockResolvedValue({}) };
    render(<App />);
    await waitFor(() => expect(screen.getByText('settings-page')).toBeInTheDocument());
    for (const [button, page] of [
      ['clone', 'clone-page'], ['transfer', 'transfer-page'], ['rewrite', 'rewrite-page'], ['settings', 'settings-page'],
    ]) {
      fireEvent.click(screen.getByText(button));
      expect(screen.getByText(page)).toBeInTheDocument();
    }
    fireEvent.click(screen.getByText('settings-page'));
    delete window.electronAPI;
  });

  test('renders a load failure and still opens settings', async () => {
    window.electronAPI = { loadSettings: jest.fn().mockRejectedValue(new Error('settings unavailable')) };
    render(<App />);
    await waitFor(() => expect(screen.getByText('settings unavailable')).toBeInTheDocument());
    expect(screen.getByText('settings-page')).toBeInTheDocument();
    delete window.electronAPI;
  });
});
