import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import AppLayout from '../../src/components/AppLayout';

test('renders the 0.2 navigation and forwards selected view IDs', () => {
  const navigate = jest.fn();
  render(<AppLayout currentView="settings" onNavigate={navigate}><div>content</div></AppLayout>);
  expect(screen.getByText('GitLab Dump 0.2')).toBeInTheDocument();
  expect(screen.getByText('content')).toBeInTheDocument();
  fireEvent.click(screen.getByText('Transfer'));
  expect(navigate).toHaveBeenCalledWith('transfer');
});
