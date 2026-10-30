import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch, apiFetchBlob, getSimulationHeaders, isUnauthorizedError, setActiveSchoolId, setSimulatedRole, setSimulatedUser, validateClientNames } from './api';

class MemoryStorage {
  private store = new Map<string, string>();
  clear() { this.store.clear(); }
  getItem(key: string) { return this.store.has(key) ? this.store.get(key)! : null; }
  setItem(key: string, value: string) { this.store.set(key, value); }
  removeItem(key: string) { this.store.delete(key); }
}

describe('validateClientNames', () => {
  it('accepts class-like names containing digits and accents', () => {
    expect(() => validateClientNames({ name: '6ème A' })).not.toThrow();
    expect(() => validateClientNames({ name: 'CP1 A' })).not.toThrow();
  });

  it('accepts school and class names with common punctuation', () => {
    expect(() => validateClientNames({ name: "École Notre-Dame" })).not.toThrow();
    expect(() => validateClientNames({ name: 'CP1-B' })).not.toThrow();
  });

  it('accepts hyphens in given and family names', () => {
    expect(() => validateClientNames({ lastName: 'Jean-Pierre' })).not.toThrow();
    expect(() => validateClientNames({ firstName: 'Marie-Claire' })).not.toThrow();
    expect(() => validateClientNames({ firstNames: 'Koffi-Afi' })).not.toThrow();
  });

  it('continues rejecting characters outside the existing name policy', () => {
    expect(() => validateClientNames({ lastName: 'Jean<Pierre' })).toThrow(/caractères invalides/);
    expect(() => validateClientNames({ firstNames: 'Marie@Claire' })).toThrow(/caractères invalides/);
  });
});

describe('getSimulationHeaders', () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: new MemoryStorage(),
    });
  });

  it('prefers the active school id for teacher requests', () => {
    setSimulatedRole('teacher');
    setSimulatedUser({
      uid: 'sim_teacher_123',
      email: 'sol@gmail.com',
      name: 'Sol',
      schoolId: 2,
    });
    setActiveSchoolId(1);

    const headers = getSimulationHeaders();

    expect(headers['x-simulated-school-id']).toBe('1');
  });
});

describe('apiFetch', () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: new MemoryStorage(),
    });
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      value: vi.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) } as any)),
    });
  });

  it('adds Authorization header when access token is stored', async () => {
    setSimulatedRole('parent');
    setSimulatedUser({ uid: 'sim_parent_123', email: 'parent@example.com', name: 'Parent User' });
    localStorage.setItem('ecoletrack_jwt_access', 'jwt-token');

    await apiFetch('/api/test', { method: 'POST', body: JSON.stringify({ foo: 'bar' }) });

    const fetchMock = globalThis.fetch as unknown as vi.Mock;
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const options = fetchMock.mock.calls[0][1] as any;
    expect(options.headers.Authorization).toBe('Bearer jwt-token');
    expect(options.headers['x-simulated-role']).toBe('parent');
    expect(options.headers['x-simulated-uid']).toBe('sim_parent_123');
  });

  it('does not add Authorization header when no access token is stored', async () => {
    setSimulatedRole('parent');
    setSimulatedUser({ uid: 'sim_parent_123', email: 'parent@example.com', name: 'Parent User' });

    await apiFetch('/api/test', { method: 'POST', body: JSON.stringify({ foo: 'bar' }) });

    const fetchMock = globalThis.fetch as unknown as vi.Mock;
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const options = fetchMock.mock.calls[0][1] as any;
    expect(options.headers.Authorization).toBeUndefined();
    expect(options.headers['x-simulated-role']).toBe('parent');
    expect(options.headers['x-simulated-uid']).toBe('sim_parent_123');
  });

  it('returns response body unchanged for 200 responses', async () => {
    const expected = { success: true };
    (globalThis.fetch as unknown as vi.Mock).mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve(expected) } as any);

    const result = await apiFetch('/api/test', { method: 'POST', body: JSON.stringify({ foo: 'bar' }) });

    expect(result).toEqual(expected);
  });

  it('detects 401 unauthorized responses centrally', async () => {
    (globalThis.fetch as unknown as vi.Mock).mockResolvedValueOnce({ ok: false, status: 401, json: () => Promise.resolve({ error: 'Unauthorized access' }) } as any);

    await expect(apiFetch('/api/test')).rejects.toMatchObject({ status: 401, isUnauthorized: true });
  });

  it('clears auth state, marks the session expired, and redirects to login on token/session 401 errors', async () => {
    const replaceMock = vi.fn();
    Object.defineProperty(globalThis, 'location', {
      configurable: true,
      value: { origin: 'http://localhost', pathname: '/', replace: replaceMock },
    });

    (globalThis.fetch as unknown as vi.Mock).mockResolvedValueOnce({ ok: false, status: 401, json: () => Promise.resolve({ error: 'Unauthorized: Invalid token' }) } as any);
    localStorage.setItem('ecoletrack_jwt_access', 'jwt-token');
    localStorage.setItem('ecoletrack_simulated_role', 'parent');

    await expect(apiFetch('/api/test')).rejects.toMatchObject({ status: 401, isUnauthorized: true });

    expect(localStorage.getItem('ecoletrack_jwt_access')).toBeNull();
    expect(localStorage.getItem('ecoletrack_simulated_role')).toBeNull();
    expect(localStorage.getItem('ecoletrack_session_expired_message')).toBe('Votre session a expiré. Veuillez vous reconnecter.');
    expect(replaceMock).toHaveBeenCalledWith('/login');
  });

  it('clears the session and preserves the disabled-account message on 401 ACCOUNT_DISABLED', async () => {
    const replaceMock = vi.fn();
    Object.defineProperty(globalThis, 'location', {
      configurable: true,
      value: { origin: 'http://localhost', pathname: '/', replace: replaceMock },
    });
    const disabledMessage = 'Ce compte est désactivé. Contactez votre administrateur.';
    localStorage.setItem('ecoletrack_jwt_access', 'jwt-token');
    localStorage.setItem('ecoletrack_simulated_role', 'parent');
    localStorage.setItem('ecoletrack_simulated_user', JSON.stringify({ uid: 'parent-1' }));
    (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: () => Promise.resolve({ code: 'ACCOUNT_DISABLED', error: disabledMessage }),
    } as any);

    await expect(apiFetch('/api/test')).rejects.toMatchObject({
      status: 401,
      isUnauthorized: true,
      code: 'ACCOUNT_DISABLED',
    });

    expect(localStorage.getItem('ecoletrack_jwt_access')).toBeNull();
    expect(localStorage.getItem('ecoletrack_simulated_role')).toBeNull();
    expect(localStorage.getItem('ecoletrack_simulated_user')).toBeNull();
    expect(localStorage.getItem('ecoletrack_session_expired_message')).toBe(disabledMessage);
    expect(replaceMock).toHaveBeenCalledTimes(1);
    expect(replaceMock).toHaveBeenCalledWith('/login');
  });

  it('redirects only once when concurrent requests receive 401 ACCOUNT_DISABLED', async () => {
    const replaceMock = vi.fn();
    Object.defineProperty(globalThis, 'location', {
      configurable: true,
      value: { origin: 'http://localhost', pathname: '/', replace: replaceMock },
    });
    localStorage.setItem('ecoletrack_jwt_access', 'jwt-token');
    (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 401,
      json: () => Promise.resolve({ code: 'ACCOUNT_DISABLED', error: 'Compte désactivé.' }),
    } as any);

    await Promise.allSettled([
      apiFetch('/api/first'),
      apiFetch('/api/second'),
    ]);

    expect(replaceMock).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem('ecoletrack_jwt_access')).toBeNull();
    expect(localStorage.getItem('ecoletrack_session_expired_message')).toBe('Compte désactivé.');
  });

  it('applies ACCOUNT_DISABLED logout handling to apiFetchBlob', async () => {
    const replaceMock = vi.fn();
    Object.defineProperty(globalThis, 'location', {
      configurable: true,
      value: { origin: 'http://localhost', pathname: '/', replace: replaceMock },
    });
    localStorage.setItem('ecoletrack_jwt_access', 'jwt-token');
    localStorage.setItem('ecoletrack_simulated_role', 'parent');
    (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: () => Promise.resolve({
        code: 'ACCOUNT_DISABLED',
        error: 'Ce compte est désactivé. Contactez votre administrateur.',
      }),
    } as any);

    await expect(apiFetchBlob('/api/notifications/12/attachments/34')).rejects.toMatchObject({
      status: 401,
      isUnauthorized: true,
      code: 'ACCOUNT_DISABLED',
    });

    expect(localStorage.getItem('ecoletrack_jwt_access')).toBeNull();
    expect(localStorage.getItem('ecoletrack_simulated_role')).toBeNull();
    expect(localStorage.getItem('ecoletrack_session_expired_message')).toBe(
      'Ce compte est désactivé. Contactez votre administrateur.',
    );
    expect(replaceMock).toHaveBeenCalledTimes(1);
    expect(replaceMock).toHaveBeenCalledWith('/login');
  });

  it('does not log out on 403 permission errors', async () => {
    const replaceMock = vi.fn();
    Object.defineProperty(globalThis, 'location', {
      configurable: true,
      value: { origin: 'http://localhost', pathname: '/', replace: replaceMock },
    });
    localStorage.setItem('ecoletrack_jwt_access', 'jwt-token');
    localStorage.setItem('ecoletrack_simulated_role', 'parent');
    (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 403,
      json: () => Promise.resolve({ code: 'FORBIDDEN', error: 'Forbidden' }),
    } as any);

    await expect(apiFetch('/api/test')).rejects.toMatchObject({ status: 403 });

    expect(localStorage.getItem('ecoletrack_jwt_access')).toBe('jwt-token');
    expect(localStorage.getItem('ecoletrack_simulated_role')).toBe('parent');
    expect(localStorage.getItem('ecoletrack_session_expired_message')).toBeNull();
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it('does not clear session or redirect on non-token 401 errors', async () => {
    const replaceMock = vi.fn();
    Object.defineProperty(globalThis, 'location', {
      configurable: true,
      value: { origin: 'http://localhost', pathname: '/', replace: replaceMock },
    });

    localStorage.setItem('ecoletrack_jwt_access', 'jwt-token');
    localStorage.setItem('ecoletrack_simulated_role', 'parent');

    (globalThis.fetch as unknown as vi.Mock).mockResolvedValueOnce({ ok: false, status: 401, json: () => Promise.resolve({ error: 'Unauthorized access' }) } as any);

    await expect(apiFetch('/api/test')).rejects.toMatchObject({ status: 401, isUnauthorized: true });

    expect(localStorage.getItem('ecoletrack_jwt_access')).toBe('jwt-token');
    expect(localStorage.getItem('ecoletrack_simulated_role')).toBe('parent');
    expect(localStorage.getItem('ecoletrack_session_expired_message')).toBeNull();
    expect(replaceMock).not.toHaveBeenCalled();
  });
});

describe('apiFetchBlob', () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: new MemoryStorage(),
    });
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      value: vi.fn(() => Promise.resolve({
        ok: true,
        status: 200,
        blob: () => Promise.resolve(new Blob(['pdf content'], { type: 'application/pdf' })),
      } as any)),
    });
  });

  it('sends the stored Bearer token and returns the response as a Blob', async () => {
    localStorage.setItem('ecoletrack_jwt_access', 'jwt-token');

    const blob = await apiFetchBlob('/api/notifications/12/attachments/34');

    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('application/pdf');
    const fetchMock = globalThis.fetch as any;
    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/api/notifications/12/attachments/34');
    expect(url).not.toContain('jwt-token');
    expect((options.headers as Record<string, string>).Authorization).toBe('Bearer jwt-token');
  });
});
