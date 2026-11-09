import { describe, expect, it } from 'vitest';
import { buildSimProfileDebugDto } from './debugSimProfileDto.ts';

describe('buildSimProfileDebugDto', () => {
  it('serializes BigInt-bearing actors without exposing internal security fields', () => {
    const actorWithInternals = {
      id: 7,
      uid: 'user-7',
      email: 'admin@example.test',
      name: 'Admin',
      role: 'super_admin',
      schoolId: null,
      academicYearId: null,
      simulated: false,
      accessSessionGeneration: 3n,
      deactivationGenerationAware: true,
      refreshToken: 'secret-refresh-token',
    };

    const dto = buildSimProfileDebugDto({
      simHeaders: { uid: null, email: null, role: null, schoolId: null },
      resolvedActor: actorWithInternals,
      dbUser: actorWithInternals,
      teacherRow: {
        id: 1,
        userId: 7,
        schoolId: 8,
        specialization: null,
      },
      classes: [{
        id: 20,
        schoolId: 8,
        academicYearId: 2,
        name: '6e A',
        teacherId: 1,
      }],
      students: [{
        id: 30,
        schoolId: 8,
        classId: 20,
        firstName: 'Ada',
        lastName: 'Lovelace',
        matricule: 'S-30',
        isActive: true,
      }],
    });

    expect(() => JSON.stringify(dto)).not.toThrow();
    expect(dto.resolvedActor).not.toHaveProperty('accessSessionGeneration');
    expect(dto.resolvedActor).not.toHaveProperty('deactivationGenerationAware');
    expect(dto.dbUser).not.toHaveProperty('refreshToken');
    expect(JSON.stringify(dto)).not.toContain('secret-refresh-token');
    expect(dto.teacherRow).toMatchObject({ schoolId: 8 });
  });
});
