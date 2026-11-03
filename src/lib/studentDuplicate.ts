import { sql } from 'drizzle-orm';

export type StudentDuplicateIdentity = {
  schoolId: number;
  firstName: string;
  lastName: string;
  studentGender: string;
  birthDate: string;
  parentName: string;
  parentGender: string;
};

function normalizeDuplicateName(value: unknown): string {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').toLowerCase() : '';
}

function normalizeDuplicateGender(value: unknown): string {
  if (typeof value !== 'string') return '';
  const normalized = value.trim().replace(/\s+/g, ' ').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (['m', 'male', 'masculin', 'homme', 'garcon', 'boy', 'boys'].includes(normalized)) return 'm';
  if (['f', 'female', 'feminin', 'feminine', 'femme', 'fille', 'girl', 'girls'].includes(normalized)) return 'f';
  return normalized;
}

export function buildStudentDuplicateIdentity(
  schoolId: number,
  firstName: unknown,
  lastName: unknown,
  studentGender: unknown,
  birthDate: unknown,
  parentName: unknown,
  parentGender: unknown,
): StudentDuplicateIdentity | null {
  const normalizedFirstName = normalizeDuplicateName(firstName);
  const normalizedLastName = normalizeDuplicateName(lastName);
  const normalizedStudentGender = normalizeDuplicateGender(studentGender);
  const normalizedBirthDate = typeof birthDate === 'string' ? birthDate.trim() : '';
  const normalizedParentName = normalizeDuplicateName(parentName);
  const normalizedParentGender = normalizeDuplicateGender(parentGender);

  if (!schoolId || !normalizedFirstName || !normalizedLastName || !normalizedStudentGender
    || !normalizedBirthDate || !normalizedParentName || !normalizedParentGender) {
    return null;
  }

  return {
    schoolId,
    firstName: normalizedFirstName,
    lastName: normalizedLastName,
    studentGender: normalizedStudentGender,
    birthDate: normalizedBirthDate,
    parentName: normalizedParentName,
    parentGender: normalizedParentGender,
  };
}

export async function getStudentParentIdentity(tx: any, parentId: number) {
  const result = await tx.execute(sql`
    SELECT u.name, u.gender
    FROM parents p
    INNER JOIN users u ON u.id = p.user_id
    WHERE p.id = ${parentId}
    LIMIT 1
  `);
  const rows = Array.isArray(result) ? result : result.rows;
  return rows?.[0] as { name?: string | null; gender?: string | null } | undefined;
}

export async function isDuplicateStudent(tx: any, identity: StudentDuplicateIdentity): Promise<boolean> {
  const lockKey = JSON.stringify([
    identity.schoolId,
    identity.firstName,
    identity.lastName,
    identity.studentGender,
    identity.birthDate,
    identity.parentName,
    identity.parentGender,
  ]);
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`);

  const result = await tx.execute(sql`
    SELECT s.id
    FROM students s
    INNER JOIN parents p ON p.id = s.parent_id
    INNER JOIN users u ON u.id = p.user_id
    WHERE s.school_id = ${identity.schoolId}
      AND lower(btrim(regexp_replace(coalesce(s.first_name, ''), '[[:space:]]+', ' ', 'g'))) = ${identity.firstName}
      AND lower(btrim(regexp_replace(coalesce(s.last_name, ''), '[[:space:]]+', ' ', 'g'))) = ${identity.lastName}
      AND CASE
        WHEN lower(btrim(s.gender)) IN ('m', 'male', 'masculin', 'homme', 'garcon', 'garçon', 'boy', 'boys') THEN 'm'
        WHEN lower(btrim(s.gender)) IN ('f', 'female', 'feminin', 'féminin', 'feminine', 'féminine', 'femme', 'fille', 'girl', 'girls') THEN 'f'
        ELSE lower(btrim(s.gender))
      END = ${identity.studentGender}
      AND btrim(s.birth_date) = ${identity.birthDate}
      AND lower(btrim(regexp_replace(coalesce(u.name, ''), '[[:space:]]+', ' ', 'g'))) = ${identity.parentName}
      AND CASE
        WHEN lower(btrim(u.gender)) IN ('m', 'male', 'masculin', 'homme', 'garcon', 'garçon', 'boy', 'boys') THEN 'm'
        WHEN lower(btrim(u.gender)) IN ('f', 'female', 'feminin', 'féminin', 'feminine', 'féminine', 'femme', 'fille', 'girl', 'girls') THEN 'f'
        ELSE lower(btrim(u.gender))
      END = ${identity.parentGender}
    LIMIT 1
  `);
  const rows = Array.isArray(result) ? result : result.rows;
  return Boolean(rows?.length);
}
