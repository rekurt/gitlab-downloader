import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import AppLayout from '../../src/components/AppLayout';

describe('AppLayout', () => {
  test('renders sidebar with menu items', () => {
    render(
      <AppLayout currentView="settings" onNavigate={() => {}}>
        <div>Content</div>
      </AppLayout>,
    );
    expect(screen.getByText('GitLab Dump')).toBeInTheDocument();
    expect(screen.getByText('Settings')).toBeInTheDocument();
    expect(screen.getByText('Projects')).toBeInTheDocument();
    expect(screen.getByText('Clone')).toBeInTheDocument();
    expect(screen.getByText('Repositories')).toBeInTheDocument();
    expect(screen.getByText('Migration')).toBeInTheDocument();
  });

  test('renders children content', () => {
    render(
      <AppLayout currentView="settings" onNavigate={() => {}}>
        <div data-testid="child-content">Hello World</div>
      </AppLayout>,
    );
    expect(screen.getByTestId('child-content')).toBeInTheDocument();
    expect(screen.getByText('Hello World')).toBeInTheDocument();
  });

  test('calls onNavigate when menu item is clicked', () => {
    const onNavigate = jest.fn();
    render(
      <AppLayout currentView="settings" onNavigate={onNavigate}>
        <div>Content</div>
      </AppLayout>,
    );
    fireEvent.click(screen.getByText('Projects'));
    expect(onNavigate).toHaveBeenCalledWith('projects');
  });

  test('highlights current view in menu', () => {
    const { container } = render(
      <AppLayout currentView="repos" onNavigate={() => {}}>
        <div>Content</div>
      </AppLayout>,
    );
    // The selected menu item should have the ant-menu-item-selected class
    const selectedItem = container.querySelector('.ant-menu-item-selected');
    expect(selectedItem).toBeTruthy();
    expect(selectedItem.textContent).toContain('Repositories');
  });
});
