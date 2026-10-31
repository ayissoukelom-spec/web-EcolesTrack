import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../server.ts';

const expectedCsp = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "img-src 'self' data: https://flagcdn.com https://*.flagcdn.com",
  "font-src 'self' https://fonts.gstatic.com https://fonts.googleapis.com",
  "connect-src 'self' https://*.firebaseapp.com https://*.firebasestorage.app https://*.firebaseio.com https://*.googleapis.com https://*.googleusercontent.com",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

describe('security headers', () => {
  it('removes x-powered-by and sets the expected security headers on secure requests', async () => {
    const app = await createApp();

    const response = await request(app)
      .get('/api/health')
      .set('X-Forwarded-Proto', 'https');

    expect(response.status).toBe(200);
    expect(response.headers['x-powered-by']).toBeUndefined();
    expect(response.headers['content-security-policy']).toBe(expectedCsp);
    expect(response.headers['strict-transport-security']).toBe('max-age=31536000');
    expect(response.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['referrer-policy']).toBe('no-referrer');
    expect(response.headers['permissions-policy']).toBe('geolocation=(), microphone=(), camera=()');
  });

  it('omits HSTS on insecure requests and keeps the security headers on error responses', async () => {
    const app = await createApp();

    const insecureResponse = await request(app)
      .get('/api/health')
      .set('X-Forwarded-Proto', 'http');
    expect(insecureResponse.headers['strict-transport-security']).toBeUndefined();
    expect(insecureResponse.headers['x-powered-by']).toBeUndefined();

    const missingRouteResponse = await request(app).get('/definitely-missing-route');
    expect(missingRouteResponse.status).toBe(401);
    expect(missingRouteResponse.headers['content-security-policy']).toBe(expectedCsp);
    expect(missingRouteResponse.headers['x-powered-by']).toBeUndefined();
    expect(missingRouteResponse.headers['x-content-type-options']).toBe('nosniff');
  });
});
