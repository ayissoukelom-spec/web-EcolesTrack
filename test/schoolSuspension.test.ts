import { describe, expect, it, vi } from 'vitest';
import { assertSchoolActiveInTransaction, SchoolSuspendedError } from '../src/lib/schoolSuspension.ts';

describe('school suspension transaction guard', () => {
  it('permits an active school after acquiring a shared row lock', async () => {
    const execute = vi.fn().mockResolvedValue({ rows: [{ is_suspended: false }] });

    await expect(assertSchoolActiveInTransaction({ execute }, 12)).resolves.toBeUndefined();

    expect(execute).toHaveBeenCalledOnce();
  });

  it('rejects a suspended school while holding the row lock', async () => {
    const execute = vi.fn().mockResolvedValue({ rows: [{ is_suspended: true }] });

    await expect(assertSchoolActiveInTransaction({ execute }, 12)).rejects.toMatchObject({
      code: 'SCHOOL_SUSPENDED',
      statusCode: 423,
      schoolId: 12,
    } satisfies Partial<SchoolSuspendedError>);
  });
});
