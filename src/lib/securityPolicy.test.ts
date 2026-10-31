import { describe, expect, it } from 'vitest';
import { buildContentSecurityPolicy } from './securityPolicy.ts';

describe('content security policy', () => {
  it('keeps the production policy unchanged', () => {
    expect(buildContentSecurityPolicy(false)).toBe([
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
    ].join('; '));
  });

  it('allows only the Vite React preamble hash and local HMR websocket in development', () => {
    const policy = buildContentSecurityPolicy(true);

    expect(policy).toBe([
      "default-src 'self'",
      "script-src 'self' 'sha256-Z2/iFzh9VMlVkEOar1f/oSHWwQk3ve1qk/C2WdsC4Xk='",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "img-src 'self' data: https://flagcdn.com https://*.flagcdn.com",
      "font-src 'self' https://fonts.gstatic.com https://fonts.googleapis.com",
      "connect-src 'self' https://*.firebaseapp.com https://*.firebasestorage.app https://*.firebaseio.com https://*.googleapis.com https://*.googleusercontent.com ws://localhost:24678",
      "frame-src 'none'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join('; '));
    const scriptSource = policy.split('; ').find((directive) => directive.startsWith('script-src '));
    expect(scriptSource).not.toContain("'unsafe-inline'");
    expect(policy).not.toContain("'unsafe-eval'");
  });
});
