import { beforeEach, describe, expect, it } from 'vitest';
import { getSimulationHeaders, setActiveSchoolId, setSimulatedRole, setSimulatedUser, validateClientNames } from './api';

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
