import { beforeAll, describe, it, expect } from 'vitest';
import request from 'supertest';

let app: any;

beforeAll(async () => {
  process.env.NODE_ENV = 'test';
  const serverModule = await import('../../server.ts');
  app = await serverModule.createApp();
});

function uniqueEmail() {
  return `e2e-parent-${Date.now()}@test.local`;
}

async function post(path: string, body: any, headers: Record<string,string> = {}) {
  const res = await request(app)
    .post(path)
    .set({ 'Content-Type': 'application/json', ...headers })
    .send(body);
  return { status: res.status, json: res.body };
}

async function put(path: string, body: any, headers: Record<string,string> = {}) {
  const res = await request(app)
    .put(path)
    .set({ 'Content-Type': 'application/json', ...headers })
    .send(body);
  return { status: res.status, json: res.body };
}

async function get(path: string, headers: Record<string,string> = {}) {
  const res = await request(app)
    .get(path)
    .set(headers);
  return { status: res.status, json: res.body };
}

describe('E2E: create → force password change → update profile → re-login', () => {
  it('should create parent, force reset, change password, update profile and verify on re-login', async () => {
    const email = uniqueEmail();
    const name = 'E2E Parent';

    // 1) Create parent via admin create (simulate super_admin)
    const create = await post('/api/admin/users', { email, name, role: 'parent', phone: '+22911111111' }, { 'x-simulated-role': 'super_admin', 'x-simulated-email': 'sa@test.local' });
    expect(create.status).toBe(201);
    const created = create.json;
    expect(created).toHaveProperty('id');
    expect(created).toHaveProperty('uid');

    const userId = created.id as number;
    const uid = created.uid as string;

    // 2) Login with default password '123456' and expect mustReset true
    const login = await post('/api/auth/local-login', { email, password: '123456' });
    expect(login.status).toBe(200);
    expect(login.json).toHaveProperty('mustReset');
    expect(login.json.mustReset).toBeTruthy();

    // 3) Change password using change-password endpoint
    const newPassword = 'E2EnewP@ss1234';
    const change = await post('/api/auth/change-password', { email, currentPassword: '123456', newPassword });
    expect(change.status).toBe(200);
    expect(change.json).toHaveProperty('success');
    expect(change.json.success).toBeTruthy();

    // 4) Update profile as the owner (simulate parent actor by uid)
    const updatedName = 'E2E Parent Updated';
    const putResp = await put(`/api/users/${userId}`, { name: updatedName, phone: '+22922222222' }, { 'x-simulated-role': 'parent', 'x-simulated-uid': uid, 'x-simulated-email': email });
    expect(putResp.status).toBe(200);
    expect(putResp.json).toHaveProperty('name');
    expect(putResp.json.name).toBe(updatedName);

    // 5) Logout (no-op) then login again with new password and verify name persists
    await post('/api/auth/logout', {});
    const relogin = await post('/api/auth/local-login', { email, password: newPassword });
    expect(relogin.status).toBe(200);
    expect(relogin.json).toHaveProperty('name');
    expect(relogin.json.name).toBe(updatedName);
  }, 20000);
});
