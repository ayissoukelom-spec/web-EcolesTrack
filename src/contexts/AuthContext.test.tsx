import React from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider, useAuth } from './AuthContext.tsx';

function TestConsumer() {
  const { user, token, isAuthenticated, isSimulated, role, activeSchoolId } = useAuth();

  return (
    <div>
      <div data-testid="user">{user ? JSON.stringify(user) : 'no-user'}</div>
      <div data-testid="token">{token ?? 'no-token'}</div>
      <div data-testid="isAuthenticated">{isAuthenticated ? 'true' : 'false'}</div>
      <div data-testid="isSimulated">{isSimulated ? 'true' : 'false'}</div>
      <div data-testid="role">{role || 'no-role'}</div>
      <div data-testid="activeSchoolId">{activeSchoolId !== null ? String(activeSchoolId) : 'no-school'}</div>
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
    expect(screen.getByTestId('role').textContent).toBe('no-role');
    expect(screen.getByTestId('activeSchoolId').textContent).toBe('no-school');
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
          if (key === 'ecoletrack_simulated_user') return JSON.stringify({ uid: 'sim_teacher_123', email: 'teacher@example.test', name: 'Teacher', schoolId: 12 });
          if (key === 'ecoletrack_active_school_id') return '12';
          return null;
        },
        setItem(key: string, value: string) {
          this.store.set(key, value);
        },
        removeItem(key: string) {
          this.store.delete(key);
        },
      },
    });

    const Wrapper = () => (
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>
    );

    render(<Wrapper />);

    expect(screen.getByTestId('isAuthenticated').textContent).toBe('false');
    expect(screen.getByTestId('isSimulated').textContent).toBe('true');
    expect(screen.getByTestId('user').textContent).toContain('sim_teacher_123');
    expect(screen.getByTestId('role').textContent).toBe('teacher');
    expect(screen.getByTestId('activeSchoolId').textContent).toBe('12');
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

  it('updates user and role when simulatedUserChanged event fires', () => {
    const listeners: Record<string, Function[]> = {};

    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        addEventListener: vi.fn((event, callback) => {
          listeners[event] = listeners[event] || [];
          listeners[event].push(callback);
        }),
        removeEventListener: vi.fn((event, callback) => {
          listeners[event] = (listeners[event] || []).filter((listener) => listener !== callback);
        }),
      },
    });

    const localStorageMock = {
      store: new Map<string, string>([
        ['ecoletrack_simulated_role', 'parent'],
        ['ecoletrack_simulated_user', JSON.stringify({ uid: 'sim_parent_456', email: 'parent@example.test', name: 'Parent', schoolId: 7 })],
        ['ecoletrack_active_school_id', '7'],
      ]),
      getItem(key: string) {
        return this.store.get(key) ?? null;
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
    };

    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: localStorageMock,
    });

    const Wrapper = () => (
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>
    );

    render(<Wrapper />);

    expect(screen.getByTestId('role').textContent).toBe('parent');
    expect(screen.getByTestId('activeSchoolId').textContent).toBe('7');

    listeners.simulatedUserChanged?.forEach((callback) => callback(new Event('simulatedUserChanged')));

    expect(screen.getByTestId('isSimulated').textContent).toBe('true');
    expect(screen.getByTestId('user').textContent).toContain('sim_parent_456');
    expect(screen.getByTestId('role').textContent).toBe('parent');
    expect(screen.getByTestId('activeSchoolId').textContent).toBe('7');
  });

  it('refreshes all auth fields when storage event updates simulated role or active school id', async () => {
    const listeners: Record<string, Function[]> = {};

    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        addEventListener: vi.fn((event, callback) => {
          listeners[event] = listeners[event] || [];
          listeners[event].push(callback);
        }),
        removeEventListener: vi.fn((event, callback) => {
          listeners[event] = (listeners[event] || []).filter((listener) => listener !== callback);
        }),
      },
    });

    const localStorageMock = {
      store: new Map<string, string>([
        ['ecoletrack_simulated_role', 'teacher'],
        ['ecoletrack_simulated_user', JSON.stringify({ uid: 'sim_teacher_123', email: 'teacher@example.test', name: 'Teacher', schoolId: 12 })],
        ['ecoletrack_active_school_id', '12'],
      ]),
      getItem(key: string) {
        return this.store.get(key) ?? null;
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
    };

    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: localStorageMock,
    });

    const Wrapper = () => (
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>
    );

    render(<Wrapper />);

    expect(screen.getByTestId('role').textContent).toBe('teacher');
    expect(screen.getByTestId('activeSchoolId').textContent).toBe('12');
    expect(screen.getByTestId('isSimulated').textContent).toBe('true');

    localStorageMock.setItem('ecoletrack_simulated_role', 'parent');
    localStorageMock.setItem('ecoletrack_active_school_id', '7');
    localStorageMock.setItem('ecoletrack_simulated_user', JSON.stringify({ uid: 'sim_parent_456', email: 'parent@example.test', name: 'Parent', schoolId: 7 }));

    const storageEvent = {
      key: 'ecoletrack_simulated_role',
      newValue: 'parent',
      oldValue: 'teacher',
      storageArea: localStorageMock as unknown as Storage,
      url: 'http://localhost',
    } as StorageEvent;

    act(() => {
      listeners.storage?.forEach((callback) => callback(storageEvent));
    });

    expect(screen.getByTestId('isSimulated').textContent).toBe('true');
    expect(screen.getByTestId('user').textContent).toContain('sim_parent_456');
    expect(screen.getByTestId('role').textContent).toBe('parent');
    expect(screen.getByTestId('activeSchoolId').textContent).toBe('7');
  });
});
