import { beforeEach, describe, expect, it, vi } from 'vitest';
import { users } from '../db/schema.ts';

// Mock state for controlling DB responses
const mockState = {
  usersByUid: new Map<string, any>(),
  usersByEmail: new Map<string, any>(),
};

// Create a builder that properly handles .where() chains
const createBuilder = (table: any, allRows: any[]) => {
  const builder: any = {
    _rows: allRows,
    from(tbl: any) {
      builder.table = tbl;
      return builder;
    },
    where() {
      return builder;
    },
    then(resolve: (value: any) => void) {
      // Return the mock rows or empty array as appropriate
      return Promise.resolve(builder._rows).then(resolve);
    },
    catch(reject: (reason?: any) => void) {
      return Promise.resolve(builder._rows).catch(reject);
    },
    finally(cb: () => void) {
      return Promise.resolve(builder._rows).finally(cb);
    },
  };
  return builder;
};

var mockDb: { select: ReturnType<typeof vi.fn> };

vi.mock('../db/index.ts', () => {
  mockDb = {
    select: vi.fn(() => ({
      from: vi.fn((table: any) => {
        // Build appropriate mock rows based on which table and what search was done
        let rows: any[] = [];
        if (table === users) {
          rows = Array.from(mockState.usersByUid.values());
        }
        return createBuilder(table, rows);
      }),
    })),
  };
  return {
    db: mockDb,
  };
});

import type { AuthRequest } from './auth';
import { resolveActor } from '../../server.ts';

describe('resolveActor', () => {
  beforeEach(() => {
    mockDb.select.mockClear();
    mockState.usersByUid.clear();
    mockState.usersByEmail.clear();
  });

  it('returns null when no req.user', async () => {
    const req = {} as AuthRequest;
    const result = await resolveActor(req);
    expect(result).toBeNull();
  });

  it('returns resolved DB actor for real JWT user with schoolId', async () => {
    const dbUser = { id: 1, uid: 'user_1', email: 'a@x', name: 'A', role: 'teacher', schoolId: 12 };
    mockState.usersByUid.set('user_1', dbUser);

    const req = { user: { uid: 'user_1', role: 'teacher', schoolId: 12 } } as AuthRequest;
    const result = await resolveActor(req);

    expect(result).toMatchObject({ id: 1, uid: 'user_1', role: 'teacher', schoolId: 12, email: 'a@x', name: 'A' });
  });

  it('returns null for real JWT school_admin without schoolId', async () => {
    const dbUser = { id: 2, uid: 'admin_1', email: 'admin@x', name: 'Admin', role: 'school_admin', schoolId: null };
    mockState.usersByUid.set('admin_1', dbUser);

    const req = { user: { uid: 'admin_1', role: 'school_admin', schoolId: null } } as AuthRequest;
    const result = await resolveActor(req);

    expect(result).toBeNull();
  });

  it('returns simulated actor when dev simulation has schoolId', async () => {
    // No DB user found - should return synthetic simulated actor
    const req = { user: { uid: 'sim_1', role: 'teacher', email: 'sim@x', name: 'Sim', schoolId: 7, simulated: true } } as AuthRequest;
    const result = await resolveActor(req);

    expect(result).toMatchObject({ uid: 'sim_1', role: 'teacher', schoolId: 7, simulated: true, email: 'sim@x', name: 'Sim' });
  });

  it('returns simulated actor with null schoolId when dev simulation omits schoolId', async () => {
    // No DB user found - should return synthetic simulated actor with null schoolId
    const req = { user: { uid: 'sim_2', role: 'parent', email: 'sim2@x', name: 'Parent Sim', schoolId: null, simulated: true } } as AuthRequest;
    const result = await resolveActor(req);

    expect(result).toMatchObject({ uid: 'sim_2', role: 'parent', schoolId: null, simulated: true });
  });

  it('returns null for simulated school_admin without schoolId', async () => {
    // school_admin role requires schoolId - should reject even when simulated
    const req = { user: { uid: 'sim_admin', role: 'school_admin', email: 'simadmin@x', name: 'Sim Admin', schoolId: null, simulated: true } } as AuthRequest;
    const result = await resolveActor(req);

    expect(result).toBeNull();
  });

  it('keeps super_admin without schoolId accepted', async () => {
    // super_admin has no schoolId requirement - should be accepted
    const req = { user: { uid: 'sim_super', role: 'super_admin', email: 'sim@x', name: 'Super Sim', schoolId: null, simulated: true } } as AuthRequest;
    const result = await resolveActor(req);

    expect(result).toMatchObject({ uid: 'sim_super', role: 'super_admin', schoolId: null, simulated: true });
  });
});
