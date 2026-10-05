import { describe, expect, it, vi } from 'vitest';
import validateNames from './validateNames';

describe('validateNames middleware', () => {
  it('allows hyphens in given and family names', () => {
    const next = vi.fn();
    const response = { status: vi.fn(), json: vi.fn() };
    response.status.mockReturnValue(response);

    validateNames(
      { body: { lastName: 'Jean-Pierre', firstName: 'Marie-Claire', firstNames: 'Koffi-Afi' } } as any,
      response as any,
      next,
    );

    expect(next).toHaveBeenCalledOnce();
    expect(response.status).not.toHaveBeenCalled();
  });

  it('continues rejecting characters outside the existing name policy', () => {
    const next = vi.fn();
    const response = { status: vi.fn(), json: vi.fn() };
    response.status.mockReturnValue(response);

    validateNames(
      { body: { lastName: 'Jean<Pierre' } } as any,
      response as any,
      next,
    );

    expect(next).not.toHaveBeenCalled();
    expect(response.status).toHaveBeenCalledWith(400);
  });
});
