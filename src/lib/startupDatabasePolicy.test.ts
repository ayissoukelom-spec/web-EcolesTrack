import { describe, expect, it } from 'vitest';
import { shouldInitializeDatabaseAtStartup } from './startupDatabasePolicy.ts';

describe('startup database initialization policy', () => {
  it('allows skipping initializers only in development when explicitly requested', () => {
    expect(shouldInitializeDatabaseAtStartup('development', 'true')).toBe(false);
    expect(shouldInitializeDatabaseAtStartup('development', undefined)).toBe(true);
    expect(shouldInitializeDatabaseAtStartup('production', 'true')).toBe(true);
    expect(shouldInitializeDatabaseAtStartup('test', 'true')).toBe(true);
  });
});
