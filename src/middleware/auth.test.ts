import { describe, expect, it, vi } from 'vitest';
import { requireOwnership, requireRole, type AuthRequest } from './auth';

const createMockRes = () => {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
};

describe('auth middleware access control', () => {
  it('autorise un role admin sur requireRole', () => {
    const req = { user: { appRole: 'admin' } } as any as AuthRequest;
    const res = createMockRes();
    const next = vi.fn();

    requireRole(['admin'])(req, res as any, next as any);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('refuse un role parent sur une route admin/teacher', () => {
    const req = { user: { appRole: 'parent' } } as any as AuthRequest;
    const res = createMockRes();
    const next = vi.fn();

    requireRole(['admin', 'teacher'])(req, res as any, next as any);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('autorise owner quand resolver retourne true', async () => {
    const req = { user: { appRole: 'parent' } } as any as AuthRequest;
    const res = createMockRes();
    const next = vi.fn();

    const middleware = requireOwnership(async () => true, { bypassRoles: ['admin', 'teacher'] });
    await middleware(req, res as any, next as any);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('refuse owner quand resolver retourne false (cross-user)', async () => {
    const req = { user: { appRole: 'parent' } } as any as AuthRequest;
    const res = createMockRes();
    const next = vi.fn();

    const middleware = requireOwnership(async () => false, { bypassRoles: ['admin', 'teacher'] });
    await middleware(req, res as any, next as any);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });
});
