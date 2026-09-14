import { describe, it, expect } from 'vitest';
import { absenceControls } from '../src/db/schema.ts';

describe('absence controls schema', () => {
  it('exposes an absence controls table declaration for the web-only teacher control flow', () => {
    expect(absenceControls).toBeDefined();
  });
});
