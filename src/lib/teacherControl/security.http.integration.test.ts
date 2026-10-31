import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { promises as fsPromises } from 'fs';
import type { Server } from 'node:http';

const mockState = vi.hoisted(() => ({
  user: null as Record<string, unknown> | null,
  membership: null as Record<string, unknown> | null,
  school: null as Record<string, unknown> | null,
  gpsSettings: null as Record<string, unknown> | null,
  gpsSettingsError: false,
}));

vi.mock('../../db/index.ts', async () => {
  const { PgDialect } = await import('drizzle-orm/pg-core');
  const schema = await import('../../db/schema.ts');

  const select = vi.fn(() => {
    const builder: any = {
      table: null as unknown,
      rows: [] as Array<Record<string, unknown>>,
      params: [] as unknown[],
      from(table: unknown) {
        builder.table = table;
        if (table === schema.users) builder.rows = mockState.user ? [mockState.user] : [];
        else if (table === schema.userSchools) builder.rows = mockState.membership ? [mockState.membership] : [];
        else if (table === schema.schools) builder.rows = mockState.school ? [mockState.school] : [];
        else if (table === schema.teacherControlGpsSettings) builder.rows = mockState.gpsSettings ? [mockState.gpsSettings] : [];
        else builder.rows = [];
        return builder;
      },
      where(condition: unknown) {
        const query = new PgDialect().sqlToQuery(condition as never);
        builder.params = query.params;
        return builder;
      },
      limit() {
        return builder;
      },
      then(resolve: (value: Array<Record<string, unknown>>) => unknown, reject?: (error: unknown) => unknown) {
        if (builder.table === schema.users && builder.params.length > 0) {
          builder.rows = builder.rows.filter((row) => builder.params.includes(row.uid) || builder.params.includes(row.email));
        } else if (builder.table === schema.userSchools) {
          builder.rows = builder.rows.filter((row) => builder.params.includes(row.userId)
            && builder.params.includes(row.schoolId)
            && row.isActive === true);
        } else if (builder.table === schema.schools) {
          builder.rows = builder.rows.filter((row) => builder.params.includes(row.id));
        } else if (builder.table === schema.teacherControlGpsSettings) {
          if (mockState.gpsSettingsError) {
            const error = new Error('test GPS settings read failure');
            return reject ? Promise.reject(error).then(resolve, reject) : Promise.reject(error).then(resolve);
          }
          builder.rows = builder.rows.filter((row) => builder.params.includes(row.schoolId));
        }
        return Promise.resolve(builder.rows).then(resolve, reject);
      },
      catch(reject: (error: unknown) => unknown) {
        return Promise.resolve(builder.rows).catch(reject);
      },
      finally(callback: () => void) {
        return Promise.resolve(builder.rows).finally(callback);
      },
    };
    return builder;
  });

  return {
    db: {
      select,
      execute: vi.fn().mockResolvedValue(undefined),
    },
    withNotificationRecipientAccountLock: vi.fn(),
  };
});

import { createApp } from '../../../server.ts';
import {
  TEACHER_CONTROL_APP_PERMISSIONS_POLICY,
  TEACHER_CONTROL_DEFAULT_PERMISSIONS_POLICY,
  TEACHER_CONTROL_DOCUMENT_AUTH_COOKIE,
  TEACHER_CONTROL_TEACHER_DOCUMENT_PATH,
} from './security.ts';

describe('teacher control document geolocation HTTP policy', () => {
  let app: Awaited<ReturnType<typeof createApp>>;
  let server: Server;

  beforeAll(async () => {
    app = await createApp();
    server = app.listen(0);
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  });

  beforeEach(() => {
    mockState.user = {
      id: 501,
      uid: 'teacher-http-test',
      email: 'teacher-http-test@example.test',
      name: 'Teacher Test',
      role: 'teacher',
      schoolId: 8,
      isDeleted: false,
    };
    mockState.membership = { userId: 501, schoolId: 8, role: 'teacher', isActive: true };
    mockState.school = { id: 8, name: 'École Test', isSuspended: false };
    mockState.gpsSettings = { schoolId: 8, isEnabled: true, latitude: '6.1375', longitude: '1.2123' };
    mockState.gpsSettingsError = false;
  });

  function simulatedRequest(
    path = TEACHER_CONTROL_TEACHER_DOCUMENT_PATH,
    role = 'teacher',
    schoolId = '8',
    targetApp = app,
  ) {
    let requestBuilder = request(targetApp === app ? server : targetApp).get(path)
      .set('X-Simulated-Role', role)
      .set('X-Simulated-Uid', 'teacher-http-test')
      .set('X-Simulated-Email', 'teacher-http-test@example.test');
    if (schoolId != null) requestBuilder = requestBuilder.set('X-Simulated-School-Id', schoolId);
    return requestBuilder;
  }

  it('grants the permission only on the canonical document response when the teacher and school are eligible', async () => {
    const response = await simulatedRequest();

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toMatch(/^text\/html/);
    expect(response.headers['permissions-policy']).toBe('geolocation=(self), microphone=(), camera=()');
    expect(response.text).toMatch(/<html[\s>]/i);
  });

  it('keeps the restrictive policy when reading the authorized HTML document fails', async () => {
    const readFile = vi.spyOn(fsPromises, 'readFile').mockRejectedValueOnce(new Error('test HTML read failure'));
    try {
      const response = await simulatedRequest();

      expect(response.status).toBe(500);
      expect(response.headers['permissions-policy']).toBe(TEACHER_CONTROL_DEFAULT_PERMISSIONS_POLICY);
    } finally {
      readFile.mockRestore();
    }
  });

  it('applies the exception to the transformed HTML response in development', async () => {
    const originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    let developmentApp: Awaited<ReturnType<typeof createApp>> | undefined;
    try {
      developmentApp = await createApp();
    } finally {
      process.env.NODE_ENV = originalNodeEnv;
    }
    if (!developmentApp) throw new Error('Development app was not initialized.');

    const response = await simulatedRequest(
      TEACHER_CONTROL_TEACHER_DOCUMENT_PATH,
      'teacher',
      '8',
      developmentApp,
    );
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toMatch(/^text\/html/);
    expect(response.headers['permissions-policy']).toBe('geolocation=(self), microphone=(), camera=()');
  });

  it('keeps the default policy for unauthenticated and disabled accounts', async () => {
    const unauthenticatedResponse = await request(server).get(TEACHER_CONTROL_TEACHER_DOCUMENT_PATH);
    expect(unauthenticatedResponse.status).toBe(401);
    expect(unauthenticatedResponse.headers['permissions-policy']).toBe(TEACHER_CONTROL_DEFAULT_PERMISSIONS_POLICY);

    const unauthenticatedGpsValidation = await request(server)
      .post('/api/teacher-control/sessions/1/validate-end')
      .send({});
    expect(unauthenticatedGpsValidation.status).toBe(401);

    mockState.user = { ...mockState.user, isDeleted: true };
    const disabledResponse = await simulatedRequest();
    expect(disabledResponse.status).toBe(401);
    expect(disabledResponse.headers['permissions-policy']).toBe(TEACHER_CONTROL_DEFAULT_PERMISSIONS_POLICY);
  });

  it.each(['parent', 'surveillant', 'school_admin', 'super_admin'])(
    'refuses the raw role %s without granting geolocation',
    async (role) => {
      const response = await simulatedRequest(TEACHER_CONTROL_TEACHER_DOCUMENT_PATH, role);
      expect(response.status).toBe(403);
      expect(response.headers['permissions-policy']).toBe(TEACHER_CONTROL_DEFAULT_PERMISSIONS_POLICY);
    },
  );

  it('refuses suspended schools and missing or inactive school memberships', async () => {
    mockState.school = { ...mockState.school, isSuspended: true };
    const suspendedResponse = await simulatedRequest();
    expect(suspendedResponse.status).toBe(423);
    expect(suspendedResponse.headers['permissions-policy']).toBe(TEACHER_CONTROL_DEFAULT_PERMISSIONS_POLICY);

    mockState.school = { ...mockState.school, isSuspended: false };
    mockState.membership = null;
    const noMembershipResponse = await simulatedRequest();
    expect(noMembershipResponse.status).toBe(403);
    expect(noMembershipResponse.headers['permissions-policy']).toBe(TEACHER_CONTROL_DEFAULT_PERMISSIONS_POLICY);

    mockState.membership = { userId: 501, schoolId: 8, role: 'teacher', isActive: false };
    const inactiveMembershipResponse = await simulatedRequest();
    expect(inactiveMembershipResponse.status).toBe(403);
    expect(inactiveMembershipResponse.headers['permissions-policy']).toBe(TEACHER_CONTROL_DEFAULT_PERMISSIONS_POLICY);
  });

  it('requires the GPS settings to be present, enabled and readable', async () => {
    mockState.gpsSettings = null;
    const missingSettingsResponse = await simulatedRequest();
    expect(missingSettingsResponse.status).toBe(200);
    expect(missingSettingsResponse.headers['permissions-policy']).toBe(TEACHER_CONTROL_DEFAULT_PERMISSIONS_POLICY);

    mockState.gpsSettings = { schoolId: 8, isEnabled: false, latitude: '6.1375', longitude: '1.2123' };
    const disabledSettingsResponse = await simulatedRequest();
    expect(disabledSettingsResponse.status).toBe(200);
    expect(disabledSettingsResponse.headers['permissions-policy']).toBe(TEACHER_CONTROL_DEFAULT_PERMISSIONS_POLICY);

    mockState.gpsSettingsError = true;
    const settingsErrorResponse = await simulatedRequest();
    expect(settingsErrorResponse.status).toBe(503);
    expect(settingsErrorResponse.headers['permissions-policy']).toBe(TEACHER_CONTROL_DEFAULT_PERMISSIONS_POLICY);
  }, 20_000);

  it('keeps the restrictive policy on APIs, other HTML pages, errors and non-canonical paths', async () => {
    const apiResponse = await request(server).get('/api/health');
    expect(apiResponse.status).toBe(200);
    expect(apiResponse.headers['permissions-policy']).toBe(TEACHER_CONTROL_DEFAULT_PERMISSIONS_POLICY);

    const missingChallengeToken = await request(server)
      .post('/api/teacher-control/gps-challenges')
      .send({ action: 'start_session' });
    expect(missingChallengeToken.status).toBe(401);
    expect(missingChallengeToken.body.error).toBe('Unauthorized: Missing token');

    const invalidChallengeToken = await request(server)
      .post('/api/teacher-control/gps-challenges')
      .set('Authorization', 'Bearer invalid-token')
      .send({ action: 'start_session' });
    expect(invalidChallengeToken.status).toBe(401);
    expect(invalidChallengeToken.body.error).toBe('Unauthorized: Invalid token');

    const cookieCannotAuthenticateApi = await request(server)
      .post('/api/teacher-control/gps-challenges')
      .set('Cookie', `${TEACHER_CONTROL_DOCUMENT_AUTH_COOKIE}=document-token`)
      .send({ action: 'start_session' });
    expect(cookieCannotAuthenticateApi.status).toBe(401);
    expect(cookieCannotAuthenticateApi.body.error).toBe('Unauthorized: Missing token');

    const invalidDocumentCookie = await request(server)
      .get(TEACHER_CONTROL_TEACHER_DOCUMENT_PATH)
      .set('Cookie', `${TEACHER_CONTROL_DOCUMENT_AUTH_COOKIE}=expired-token`);
    expect(invalidDocumentCookie.status).toBe(401);
    expect(invalidDocumentCookie.body.error).toBe('Unauthorized: Invalid token');

    const unauthenticatedApiResponse = await request(server).get('/api/teacher-control/gps-settings');
    expect(unauthenticatedApiResponse.status).toBe(401);
    expect(unauthenticatedApiResponse.headers['permissions-policy']).toBe(TEACHER_CONTROL_DEFAULT_PERMISSIONS_POLICY);

    const missingApiResponse = await simulatedRequest('/api/teacher-control/not-found');
    expect(missingApiResponse.status).toBe(200);
    expect(missingApiResponse.headers['content-type']).toMatch(/^text\/html/);
    expect(missingApiResponse.headers['permissions-policy']).toBe(TEACHER_CONTROL_DEFAULT_PERMISSIONS_POLICY);

    const rootResponse = await request(server).get('/');
    expect(rootResponse.headers['content-type']).toMatch(/^text\/html/);
    expect(rootResponse.headers['permissions-policy']).toBe(TEACHER_CONTROL_APP_PERMISSIONS_POLICY);

    for (const path of [
      '/teacher-control/teacher/',
      '/teacher-control/Teacher',
      '/teacher-control/admin',
      '/teacher-control%2Fteacher',
      '/teacher-control/teacher.css',
    ]) {
      const response = await simulatedRequest(path);
      expect(response.headers['permissions-policy']).toBe(TEACHER_CONTROL_DEFAULT_PERMISSIONS_POLICY);
    }

    const missingResponse = await simulatedRequest('/teacher-control/not-found');
    expect(missingResponse.status).toBe(200);
    expect(missingResponse.headers['content-type']).toMatch(/^text\/html/);
    expect(missingResponse.headers['permissions-policy']).toBe(TEACHER_CONTROL_DEFAULT_PERMISSIONS_POLICY);
  }, 20_000);

  it('does not grant the exception to requests with query parameters', async () => {
    const response = await simulatedRequest(`${TEACHER_CONTROL_TEACHER_DOCUMENT_PATH}?next=/`);

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toMatch(/^text\/html/);
    expect(response.headers['permissions-policy']).toBe(TEACHER_CONTROL_DEFAULT_PERMISSIONS_POLICY);
  });
});
