import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AppNav } from './app-nav';

describe('AppNav', () => {
  it('links to the profile, security and settings pages', () => {
    render(<AppNav />);
    expect(screen.getByRole('navigation', { name: 'Account' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Profile' }).getAttribute('href')).toBe('/profile');
    expect(screen.getByRole('link', { name: 'Security' }).getAttribute('href')).toBe('/account');
    expect(screen.getByRole('link', { name: 'Tasks' }).getAttribute('href')).toBe('/tasks');
    expect(screen.getByRole('link', { name: 'Projects' }).getAttribute('href')).toBe('/projects');
    expect(screen.getByRole('link', { name: 'Workspace' }).getAttribute('href')).toBe('/workspace');
    expect(screen.getByRole('link', { name: 'Settings' }).getAttribute('href')).toBe('/settings');
  });
});
