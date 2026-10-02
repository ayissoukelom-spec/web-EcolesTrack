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
    const loginToken = login.json.token;

    const rejectedPasswords = [
      ['abcdef12', 'Le nouveau mot de passe doit contenir au moins une lettre majuscule.'],
      ['Abcdefgh', 'Le nouveau mot de passe doit contenir au moins un chiffre.'],
      ['Ab123', 'Le nouveau mot de passe doit contenir au moins 8 caractères.'],
      ['12345678', 'Le nouveau mot de passe doit contenir au moins une lettre majuscule.'],
      ['abcdefgh', 'Le nouveau mot de passe doit contenir au moins une lettre majuscule et au moins un chiffre.'],
      ['123456', 'Le nouveau mot de passe ne peut pas être le mot de passe temporaire.'],
      ['abc', 'Le nouveau mot de passe doit contenir au moins 8 caractères, au moins une lettre majuscule et au moins un chiffre.'],
    ];
    for (const [newPassword, error] of rejectedPasswords) {
      const rejected = await post('/api/auth/change-password', {
        email,
        currentPassword: '123456',
        newPassword,
      }, { Authorization: `Bearer ${loginToken}` });
      expect(rejected.status).toBe(400);
      expect(rejected.json.error).toBe(error);
    }

    // 3) Change password using change-password endpoint
    const newPassword = 'Abcd1234';
    const change = await post('/api/auth/change-password', { email, currentPassword: '123456', newPassword }, { Authorization: `Bearer ${loginToken}` });
    expect(change.status).toBe(200);
    expect(change.json).toHaveProperty('success');
    expect(change.json.success).toBeTruthy();

    // 4) Update profile as the owner (simulate parent actor by uid)
    const updatedName = 'E2E Parent Updated';
    const putResp = await put(`/api/users/${userId}`, { name: updatedName, phone: '+22922222222' }, { 'x-simulated-role': 'parent', 'x-simulated-uid': uid, 'x-simulated-email': email });
    expect(putResp.status).toBe(200);
    expect(putResp.json).toHaveProperty('name');
    expect(putResp.json.name).toBe(updatedName);

    // 5) Logout then login again with new password and verify name persists
    await post('/api/auth/logout', {}, { Authorization: `Bearer ${loginToken}` });
    const relogin = await post('/api/auth/local-login', { email, password: newPassword });
    expect(relogin.status).toBe(200);
    expect(relogin.json.mustReset).toBe(false);
    expect(relogin.json).toHaveProperty('name');
    expect(relogin.json.name).toBe(updatedName);
  }, 20000);

  it('should reject a reused token after logout', async () => {
    const email = uniqueEmail();
    const name = 'E2E Logout Test';

    const create = await post('/api/admin/users', { email, name, role: 'parent', phone: '+22933333333' }, { 'x-simulated-role': 'super_admin', 'x-simulated-email': 'sa@test.local' });
    expect(create.status).toBe(201);

    const login = await post('/api/auth/local-login', { email, password: '123456' });
    expect(login.status).toBe(200);
    const token = login.json.token;
    expect(token).toBeTruthy();

    const logout = await post('/api/auth/logout', {}, { Authorization: `Bearer ${token}` });
    expect(logout.status).toBe(200);

    const protectedRes = await get('/api/auth/schools', { Authorization: `Bearer ${token}` });
    expect(protectedRes.status).toBe(401);
  }, 20000);
});
