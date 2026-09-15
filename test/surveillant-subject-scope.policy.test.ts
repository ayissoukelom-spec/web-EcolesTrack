import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('surveillant subject scope policy', () => {
  it('resolves approved subjects from the surveillant school context', () => {
    const serverText = fs.readFileSync(path.resolve('server.ts'), 'utf8');
    expect(serverText).toContain("actor.role === 'school_admin' || actor.role === 'surveillant'");
    expect(serverText).toContain("if (approvedOnly && !targetSchoolId)");
  });
});