import { readFileSync } from 'node:fs';
import path from 'node:path';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import { parents, teachers } from './schema.ts';

const migrationPath = path.join(
  process.cwd(),
  'drizzle',
  'manual',
  '0152_parent_teacher_profiles_multi_school.sql',
);
const migration = readFileSync(migrationPath, 'utf8');

describe('multi-school Parent and Teacher profile schema', () => {
  it('models school-scoped profiles while retaining nullable historical Parent schools', () => {
    const parentConfig = getTableConfig(parents);
    const teacherConfig = getTableConfig(teachers);
    const profileIndexes = (config: typeof parentConfig) =>
      config.indexes
        .filter(({ config: indexConfig }) => indexConfig.unique)
        .map(({ config: indexConfig }) => ({
          name: indexConfig.name,
          columns: indexConfig.columns.map((column) => column.name),
        }));

    expect(parents.schoolId.notNull).toBe(false);
    expect(parentConfig.indexes[0].config.where).toBeDefined();
    expect(profileIndexes(parentConfig)).toEqual([{
      name: 'parents_user_id_school_id_idx',
      columns: ['user_id', 'school_id'],
    }]);
    expect(profileIndexes(teacherConfig)).toEqual([{
      name: 'teachers_user_id_school_id_idx',
      columns: ['user_id', 'school_id'],
    }]);
    expect(parentConfig.uniqueConstraints).toHaveLength(0);
    expect(teacherConfig.uniqueConstraints).toHaveLength(0);
  });

  it('preflights ambiguous data transactionally without rewriting profiles, links, or memberships', () => {
    expect(migration).toMatch(/\bBEGIN;\s/);
    expect(migration).toMatch(/COMMIT;\s*$/);

    const profileUniquenessPreflight = migration.match(
      /IF NOT EXISTS \([\s\S]*?Cannot replace profile uniqueness:[\s\S]*?END IF;/,
    )?.[0];
    expect(profileUniquenessPreflight).toBeDefined();
    for (const tableName of ['parents', 'teachers']) {
      expect(profileUniquenessPreflight).toMatch(
        new RegExp(
          `constraint_row\\.conrelid = 'public\\.${tableName}'::regclass[\\s\\S]*?constraint_row\\.contype = 'u'[\\s\\S]*?cardinality\\(constraint_row\\.conkey\\) = 1[\\s\\S]*?attribute_row\\.attrelid = 'public\\.${tableName}'::regclass[\\s\\S]*?attribute_row\\.attname\\s*=\\s*'user_id'`,
        ),
      );
    }

    const profileConstraintRemoval = migration.match(
      /DO \$drop_profile_constraints\$[\s\S]*?\$drop_profile_constraints\$;/,
    )?.[0];
    expect(profileConstraintRemoval).toBeDefined();
    for (const tableName of ['parents', 'teachers']) {
      expect(profileConstraintRemoval).toMatch(
        new RegExp(
          `FOR constraint_name IN\\s+SELECT constraint_row\\.conname\\s+FROM pg_constraint AS constraint_row\\s+WHERE constraint_row\\.conrelid = 'public\\.${tableName}'::regclass\\s+AND constraint_row\\.contype = 'u'\\s+AND cardinality\\(constraint_row\\.conkey\\) = 1[\\s\\S]*?attribute_row\\.attrelid = 'public\\.${tableName}'::regclass[\\s\\S]*?attribute_row\\.attname\\s*=\\s*'user_id'[\\s\\S]*?LOOP\\s+EXECUTE format\\('ALTER TABLE public\\.${tableName} DROP CONSTRAINT %I', constraint_name\\);`,
        ),
      );
    }
    expect(profileConstraintRemoval).toContain(
      'dropped_parent_unique_count = 0 OR dropped_teacher_unique_count = 0',
    );
    expect(migration).toContain('school_id IS NULL');
    expect(migration).toMatch(
      /constraint_row\.contype = 'f'[\s\S]*?attribute_row\.attname\s*=\s*'school_id'[\s\S]*?\) = ANY\(constraint_row\.conkey\)[\s\S]*?Cannot preserve historical Parent school references/,
    );
    expect(profileConstraintRemoval).toMatch(
      /constraint_row\.conrelid = 'public\.parents'::regclass[\s\S]*?constraint_row\.contype = 'f'[\s\S]*?cardinality\(constraint_row\.conkey\) = 1[\s\S]*?attribute_row\.attname\s*=\s*'school_id'[\s\S]*?constraint_row\.confrelid = 'public\.schools'::regclass[\s\S]*?attribute_row\.attname\s*=\s*'id'[\s\S]*?DROP CONSTRAINT %I/,
    );
    expect(migration).toContain('WHERE school_id IS NOT NULL');
    expect(migration).not.toContain('ALTER COLUMN school_id SET NOT NULL');
    expect(migration).toContain('Preserving historical Parent profiles');
    expect(migration).toContain('school_id IS NOT NULL');
    expect(migration).toContain('duplicate_parent_profile_count');
    expect(migration).toContain('duplicate_teacher_profile_count');
    expect(migration).toContain('0151_user_schools_role_scoped_uniqueness');
    expect(migration).toContain('legacy user_schools (user_id, school_id) uniqueness');
    expect(migration).toContain('student_row.parent_id = parent_row.id');
    expect(migration).toContain('public.teacher_control_sessions');
    expect(migration).toContain('public.teacher_control_regularization_requests');
    expect(migration).toContain('membership_row.is_active IS TRUE');
    expect(migration).not.toMatch(/\b(?:INSERT INTO|UPDATE public\.|DELETE FROM|TRUNCATE)\b/i);
  });
});
