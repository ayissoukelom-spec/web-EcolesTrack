import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import RequiredLabel from './RequiredLabel';

describe('RequiredLabel', () => {
  it('renders a clearly visible required marker', () => {
    render(<RequiredLabel label="Email" required />);

    const star = screen.getByText('*');
    expect(star).toBeTruthy();
    expect(star.className).toContain('text-rose-600');
    expect(star.className).toContain('font-semibold');
  });
});
