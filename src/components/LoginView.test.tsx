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

    fireEvent.change(screen.getByLabelText(/Email ou numéro de téléphone/i), { target: { value: 'test@example.com' } });
    fireEvent.change(screen.getByLabelText(/Mot de passe/i, { selector: 'input' }), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: /Se connecter/i }));

    await waitFor(() => {
      expect(localStorage.getItem('ecoletrack_jwt_access')).toBe('jwt-token');
    });
    expect(JSON.parse((window.fetch as any).mock.calls[0][1].body)).toEqual({ identifier: 'test@example.com', password: '123456' });
  });

  it('submits a phone number in the shared identifier field without email-only browser validation', async () => {
    window.fetch = createFetchMock([
      { id: 2, uid: 'parent_2', email: 'parent@example.com', name: 'Parent Example', role: 'parent', token: 'parent-jwt', mustReset: false },
      {},
    ]);

    render(<LoginView onLogin={mockOnLogin} />);

    const identifierInput = screen.getByLabelText(/Email ou numéro de téléphone/i) as HTMLInputElement;
    expect(identifierInput.type).toBe('text');
    fireEvent.change(identifierInput, { target: { value: '90123456' } });
    fireEvent.change(screen.getByLabelText(/Mot de passe/i, { selector: 'input' }), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: /Se connecter/i }));

    await waitFor(() => expect(localStorage.getItem('ecoletrack_jwt_access')).toBe('parent-jwt'));
    expect(JSON.parse((window.fetch as any).mock.calls[0][1].body)).toEqual({ identifier: '90123456', password: '123456' });
  });

  it('does not store access token when login response is missing token', async () => {
    window.fetch = createFetchMock([
      { id: 1, uid: 'user_1', email: 'test@example.com', name: 'Test User', role: 'parent', mustReset: false },
      {},
    ]);

    render(<LoginView onLogin={mockOnLogin} />);

    fireEvent.change(screen.getByLabelText(/Email/i), { target: { value: 'test@example.com' } });
    fireEvent.change(screen.getByLabelText(/Mot de passe/i, { selector: 'input' }), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: /Se connecter/i }));

    await waitFor(() => {
      expect(localStorage.getItem('ecoletrack_jwt_access')).toBeNull();
    });
  });

  it('toggles password visibility when clicking the eye icon', () => {
    render(<LoginView onLogin={mockOnLogin} />);

    const passwordInput = screen.getByLabelText(/Mot de passe/i, { selector: 'input' }) as HTMLInputElement;
    const toggleButton = screen.getByRole('button', { name: /Afficher le mot de passe/i });

    expect(passwordInput.type).toBe('password');

    fireEvent.click(toggleButton);
    expect(passwordInput.type).toBe('text');
    expect(toggleButton.getAttribute('aria-label')).toBe('Masquer le mot de passe');

    fireEvent.click(toggleButton);
    expect(passwordInput.type).toBe('password');
    expect(toggleButton.getAttribute('aria-label')).toBe('Afficher le mot de passe');
  });
  it('displays the session expired message when redirected after 401', () => {
    localStorage.setItem('ecoletrack_session_expired_message', 'Votre session a expiré. Veuillez vous reconnecter.');
    render(<LoginView onLogin={mockOnLogin} />);
    expect(screen.getByText(/Votre session a expiré/i)).toBeTruthy();
  });});