import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import LoginView from './LoginView';

const mockOnLogin = vi.fn();

const localStorageMock = (() => {
  const store: Record<string, string> = {};
  return {
    clear() {
      for (const key in store) delete store[key];
    },
    getItem(key: string) {
      return store[key] ?? null;
    },
    setItem(key: string, value: string) {
      store[key] = String(value);
    },
    removeItem(key: string) {
      delete store[key];
    },
  };
})();

function createFetchMock(responses: any[]) {
  const fetchMock = vi.fn();
  responses.forEach((response) => {
    fetchMock.mockResolvedValueOnce({
      ok: response.ok !== false,
      status: response.status ?? 200,
      json: () => Promise.resolve(response.body ?? response),
    } as any);
  });
  return fetchMock;
}

describe('LoginView', () => {
  beforeEach(() => {
    cleanup();
    mockOnLogin.mockClear();
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: localStorageMock,
    });
    localStorageMock.clear();
  });

  it('stores JWT token from local-login response', async () => {
    window.fetch = createFetchMock([
      { id: 1, uid: 'user_1', email: 'test@example.com', name: 'Test User', role: 'parent', token: 'jwt-token', mustReset: false },
      {},
    ]);

    render(<LoginView onLogin={mockOnLogin} />);

    fireEvent.change(screen.getByLabelText(/Email/i), { target: { value: 'test@example.com' } });
    fireEvent.change(screen.getByLabelText(/Mot de passe/i), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: /Se connecter/i }));

    await waitFor(() => {
      expect(localStorage.getItem('ecoletrack_jwt_access')).toBe('jwt-token');
    });
  });

  it('does not store access token when login response is missing token', async () => {
    window.fetch = createFetchMock([
      { id: 1, uid: 'user_1', email: 'test@example.com', name: 'Test User', role: 'parent', mustReset: false },
      {},
    ]);

    render(<LoginView onLogin={mockOnLogin} />);

    fireEvent.change(screen.getByLabelText(/Email/i), { target: { value: 'test@example.com' } });
    fireEvent.change(screen.getByLabelText(/Mot de passe/i), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: /Se connecter/i }));

    await waitFor(() => {
      expect(localStorage.getItem('ecoletrack_jwt_access')).toBeNull();
    });
  });
});