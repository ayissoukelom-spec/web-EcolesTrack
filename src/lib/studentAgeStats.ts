export interface StudentAgeSourceRow {
  classId: number;
  className: string;
  schoolId: number;
  birthDate: string | null;
}

export interface ClassAgeStats {
  classId: number;
  className: string;
  schoolId: number;
  averageAge: number | null;
  includedStudents: number;
  distribution: Array<{ age: number; count: number }>;
}

interface CalendarDate {
  year: number;
  month: number;
  day: number;
}

function parseCalendarDate(value: string | null | undefined): CalendarDate | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;

  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  if (year < 1 || month < 1 || month > 12 || day < 1) return null;

  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (day > daysInMonth[month - 1]) return null;

  return { year, month, day };
}

function calculateCompletedAge(birthDate: CalendarDate, referenceDate: CalendarDate): number | null {
  if (
    birthDate.year > referenceDate.year
    || (birthDate.year === referenceDate.year && birthDate.month > referenceDate.month)
    || (birthDate.year === referenceDate.year && birthDate.month === referenceDate.month && birthDate.day > referenceDate.day)
  ) {
    return null;
  }

  let age = referenceDate.year - birthDate.year;
  const isLeapYear = referenceDate.year % 4 === 0
    && (referenceDate.year % 100 !== 0 || referenceDate.year % 400 === 0);
  const anniversaryMonth = birthDate.month;
  const anniversaryDay = birthDate.month === 2 && birthDate.day === 29 && !isLeapYear
    ? 28
    : birthDate.day;

  if (
    referenceDate.month < anniversaryMonth
    || (referenceDate.month === anniversaryMonth && referenceDate.day < anniversaryDay)
  ) {
    age -= 1;
  }

  return age;
}

export function buildClassAgeStats(
  rows: StudentAgeSourceRow[],
  referenceDateValue: string,
): ClassAgeStats[] {
  const referenceDate = parseCalendarDate(referenceDateValue);
  if (!referenceDate) throw new RangeError('Invalid age statistics reference date');

  const grouped = new Map<string, {
    classId: number;
    className: string;
    schoolId: number;
    ageTotal: number;
    includedStudents: number;
    ages: Map<number, number>;
  }>();

  for (const row of rows) {
    const key = `${row.schoolId}:${row.classId}`;
    let group = grouped.get(key);
    if (!group) {
      group = {
        classId: row.classId,
        className: row.className,
        schoolId: row.schoolId,
        ageTotal: 0,
        includedStudents: 0,
        ages: new Map(),
      };
      grouped.set(key, group);
    }

    const birthDate = parseCalendarDate(row.birthDate);
    const age = birthDate ? calculateCompletedAge(birthDate, referenceDate) : null;
    if (age == null) continue;

    group.ageTotal += age;
    group.includedStudents += 1;
    group.ages.set(age, (group.ages.get(age) ?? 0) + 1);
  }

  return Array.from(grouped.values())
    .map((group) => ({
      classId: group.classId,
      className: group.className,
      schoolId: group.schoolId,
      averageAge: group.includedStudents > 0
        ? Math.round(group.ageTotal / group.includedStudents)
        : null,
      includedStudents: group.includedStudents,
      distribution: Array.from(group.ages.entries())
        .sort(([ageA], [ageB]) => ageA - ageB)
        .map(([age, count]) => ({ age, count })),
    }))
    .sort((classA, classB) =>
      classA.schoolId - classB.schoolId
      || classA.className.localeCompare(classB.className)
      || classA.classId - classB.classId,
    );
}
