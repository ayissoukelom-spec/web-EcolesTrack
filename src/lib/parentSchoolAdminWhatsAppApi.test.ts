import express from 'express';
import { PgDialect } from 'drizzle-orm/pg-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../db/index.ts';
import { registerParentSchoolAdminWhatsAppRoute } from './parentSchoolAdminWhatsAppApi';

vi.mock('../middleware/auth.ts', () => ({
  verifyToken: (_req: any, _res: any, next: any) => next(),
  requireRole: () => (_req: any, _res: any, next: any) => next(),
}));

vi.mock('./parentStudentAccess.ts', () => ({
  getParentChildStudentIds: vi.fn(),
}));

describe('GET /api/parent/whatsapp-contact', () => {
  let getParentChildStudentIdsMock: any;
  let activeServer: any = null;

  beforeEach(async () => {
    const accessModule = await import('./parentStudentAccess.ts');
    getParentChildStudentIdsMock = accessModule.getParentChildStudentIds;
    getParentChildStudentIdsMock.mockReset().mockResolvedValue([71]);
  });

  afterEach(async () => {
    if (activeServer) {
      await new Promise<void>((resolve) => activeServer.close(() => resolve()));
      activeServer = null;
    }
  });

  const listen = async (role = 'parent') => {
    const app = express();
    registerParentSchoolAdminWhatsAppRoute(app, {
      resolveActor: async () => ({ id: 10, role }),
      verifyMiddleware: ((_req: any, _res: any, next: any) => next()) as any,
      accessMiddleware: ((_req: any, _res: any, next: any) => next()) as any,
    });
    await new Promise<void>((resolve) => {
      activeServer = app.listen(0, () => resolve());
    });
    const address = activeServer.address();
    return `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
  };

  const mockQueries = (results: unknown[][]) => {
    const whereConditions: any[] = [];
    const selectSpy = vi.spyOn(db, 'select').mockImplementation(() => {
      const query: any = {
        from: () => query,
        where: (condition: unknown) => {
          whereConditions.push(condition);
          return query;
        },
        orderBy: () => query,
        then: (resolve: (result: unknown[]) => unknown, reject: (error: unknown) => unknown) => (
          Promise.resolve(results.shift() ?? []).then(resolve, reject)
        ),
      };
      return query;
    });
    return { selectSpy, whereConditions };
  };

  it('selects the first usable school admin phone and creates a standard WhatsApp link', async () => {
    const { selectSpy, whereConditions } = mockQueries([
      [{ schoolId: 9 }],
      [
        { phone: 'not-a-phone' },
        { phone: '+228 90 00 00 01' },
        { phone: '+22890000002' },
      ],
    ]);
    try {
      const baseUrl = await listen();
      const response = await fetch(`${baseUrl}/api/parent/whatsapp-contact?studentId=71`);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.whatsappUrl).toBe(
        'https://wa.me/22890000001?text=Bonjour%2C%20je%20souhaite%20contacter%20l%E2%80%99administration%20de%20l%E2%80%99%C3%A9cole.',
      );
      expect(getParentChildStudentIdsMock).toHaveBeenCalledWith(10);
      const adminScope = new PgDialect().sqlToQuery(whereConditions[1]);
      expect(adminScope.sql).toContain('school_id');
      expect(adminScope.params).toContain(9);
      expect(adminScope.params).toContain('school_admin');
    } finally {
      selectSpy.mockRestore();
    }
  });

  it('does not return an administrator phone when the requested child is outside the parent scope', async () => {
    getParentChildStudentIdsMock.mockResolvedValue([70]);
    const selectSpy = vi.spyOn(db, 'select');
    try {
      const baseUrl = await listen();
      const response = await fetch(`${baseUrl}/api/parent/whatsapp-contact?studentId=71`);
      expect(response.status).toBe(404);
      expect(selectSpy).not.toHaveBeenCalled();
    } finally {
      selectSpy.mockRestore();
    }
  });

  it('does not provide a WhatsApp link when no school admin has a usable phone', async () => {
    const { selectSpy } = mockQueries([
      [{ schoolId: 9 }],
      [{ phone: null }, { phone: 'unusable' }],
    ]);
    try {
      const baseUrl = await listen();
      const response = await fetch(`${baseUrl}/api/parent/whatsapp-contact?studentId=71`);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ whatsappUrl: null });
    } finally {
      selectSpy.mockRestore();
    }
  });

  it('refuses non-parent actors', async () => {
    const selectSpy = vi.spyOn(db, 'select');
    try {
      const baseUrl = await listen('school_admin');
      const response = await fetch(`${baseUrl}/api/parent/whatsapp-contact?studentId=71`);
      expect(response.status).toBe(403);
      expect(selectSpy).not.toHaveBeenCalled();
    } finally {
      selectSpy.mockRestore();
    }
  });
});
