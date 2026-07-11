import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider, useAuth } from './AuthContext.tsx';

function TestConsumer() {
  const { user, token, isAuthenticated, isSimulated } = useAuth();

  return (
    <div>
      <div data-testid="user">{user ? JSON.stringify(user) : 'no-user'}</div>
      <div data-testid="token">{token ?? 'no-token'}</div>
      <div data-testid="isAuthenticated">{isAuthenticated ? 'true' : 'false'}</div>
      <div data-testid="isSimulated">{isSimulated ? 'true' : 'false'}</div>
    </div>
  );
}

describe('AuthContext', () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        store: new Map<string, string>(),
        getItem(key: string) {
          return this.store.has(key) ? this.store.get(key) : null;
        },
        setItem(key: string, value: string) {
          this.store.set(key, value);
        },
        removeItem(key: string) {
          this.store.delete(key);
        },
        clear() {
          this.store.clear();
        },
      },
    });

    vi.spyOn(window, 'addEventListener');
    vi.spyOn(window, 'removeEventListener');
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('exposes authenticated state when JWT is present', () => {
    localStorage.setItem('ecoletrack_jwt_access', 'jwt-token');
    Object.defineProperty(globalThis, 'window', { value: globalThis.window, configurable: true });

    const Wrapper = () => (
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>
    );

    render(<Wrapper />);

    expect(screen.getByTestId('token').textContent).toBe('jwt-token');
    expect(screen.getByTestId('isAuthenticated').textContent).toBe('true');
    expect(screen.getByTestId('user').textContent).toBe('no-user');
  });

  it('exposes unauthenticated state when JWT is absent', () => {
    const Wrapper = () => (
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>
    );

    const { container } = render(<Wrapper />);
    const root = container.lastElementChild;
    expect(root).not.toBeNull();
    expect(screen.getAllByTestId('token').pop()?.textContent).toBe('no-token');
    expect(screen.getAllByTestId('isAuthenticated').pop()?.textContent).toBe('false');
    expect(screen.getAllByTestId('user').pop()?.textContent).toBe('no-user');
  });

  it('marks simulation as active when simulated user is present', () => {
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      },
    });

    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        store: new Map<string, string>(),
        getItem(key: string) {
          if (key === 'ecoletrack_simulated_role') return 'teacher';
          if (key === 'ecoletrack_simulated_user') return JSON.stringify({ uid: 'sim_teacher_123', email: 'teacher@example.test', name: 'Teacher' });
          return null;
        },
      },
    });

    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      },
    });

    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        store: new Map<string, string>(),
        getItem(key: string) {
          if (key === 'ecoletrack_simulated_role') return 'teacher';
          if (key === 'ecoletrack_simulated_user') return JSON.stringify({ uid: 'sim_teacher_123', email: 'teacher@example.test', name: 'Teacher' });
          return null;
        },
      },
    });

    const Wrapper = () => (
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>
    );

    render(<Wrapper />);

    expect(screen.getAllByTestId('isAuthenticated').pop()?.textContent).toBe('false');
    expect(screen.getAllByTestId('isSimulated').pop()?.textContent).toBe('true');
    expect(screen.getAllByTestId('user').pop()?.textContent).toContain('sim_teacher_123');
  });

  it('renders a component that does not use useAuth without error', () => {
    function SimpleComponent() {
      return <div>hello world</div>;
    }

    const Wrapper = () => (
      <AuthProvider>
        <SimpleComponent />
      </AuthProvider>
    );

    render(<Wrapper />);
    expect(screen.getByText('hello world')).toBeTruthy();
  });
});
