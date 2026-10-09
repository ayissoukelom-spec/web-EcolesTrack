import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import SchoolSuspensionNotice from './SchoolSuspensionNotice';

describe('SchoolSuspensionNotice', () => {
  afterEach(cleanup);

  it('shows the suspension information and working contact links', () => {
    render(<SchoolSuspensionNotice />);

    expect(screen.getByRole('heading', { name: 'Accès à votre établissement temporairement suspendu' })).toBeTruthy();
    expect(screen.getByText(/Vos données scolaires sont conservées/)).toBeTruthy();
    expect(screen.getByRole('link', { name: '+228 91 55 12 95' }).getAttribute('href')).toBe('tel:+22891551295');
    expect(screen.getByRole('link', { name: 'contact@ecolestrack.online' }).getAttribute('href')).toBe('mailto:contact@ecolestrack.online');
    expect(screen.getByText('Administration EcolesTrack')).toBeTruthy();
  });
});
