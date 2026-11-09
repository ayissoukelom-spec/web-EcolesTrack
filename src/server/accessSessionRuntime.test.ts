import { beforeEach, describe, expect, it, vi } from 'vitest';

var mockVerify: ReturnType<typeof vi.fn>;
var mockRevokeById: ReturnType<typeof vi.fn>;

vi.mock('../db/index.ts', () => ({ db: {} }));

vi.mock('./accessJwtSigner.ts', () => {
  mockVerify = vi.fn();
  return {
    AccessJwtSigner: class {
      verify(...args: unknown[]) {
        return mockVerify(...args);
      }
    },
    accessJwtLifetimeSeconds: () => 3600,
  };
});

vi.mock('./drizzleGenerationAwareAccessSessionStore.ts', () => ({
  DrizzleGenerationAwareAccessSessionStore: class {
    constructor() {
      mockRevokeById = vi.fn();
      return { revokeById: (...args: unknown[]) => mockRevokeById(...args) };
    }
  },
}));

import { revokeAccessSessionToken } from './accessSessionRuntime.ts';

describe('revokeAccessSessionToken', () => {
  beforeEach(() => {
    mockVerify.mockReset();
    mockRevokeById.mockReset();
  });

  it('rejects legacy or malformed JWTs without touching the session store', async () => {
    mockVerify.mockReturnValueOnce({ valid: false, reason: 'invalid_shape' });

    await expect(revokeAccessSessionToken('legacy.jwt')).resolves.toEqual({
      ok: false,
      reason: 'invalid_token',
    });
    expect(mockRevokeById).not.toHaveBeenCalled();
  });

  it('revokes only the Web session identified by the strict token sub and sid', async () => {
    mockVerify.mockReturnValueOnce({
      valid: true,
      claims: { sub: '17', sid: 'web-session-17' },
    });
    mockRevokeById.mockResolvedValueOnce({ status: 'revoked' });

    await expect(revokeAccessSessionToken('strict.jwt')).resolves.toEqual({ ok: true });
    expect(mockRevokeById).toHaveBeenCalledWith({
      sessionId: 'web-session-17',
      userId: 17,
      nowEpochMs: expect.any(Number),
    });
  });

  it('does not report success for a session owned by another user', async () => {
    mockVerify.mockReturnValueOnce({
      valid: true,
      claims: { sub: '17', sid: 'other-users-session' },
    });
    mockRevokeById.mockResolvedValueOnce({ status: 'identity_mismatch' });

    await expect(revokeAccessSessionToken('strict.jwt')).resolves.toEqual({
      ok: false,
      reason: 'identity_mismatch',
    });
  });
});
