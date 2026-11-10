import ExcelJS from 'exceljs';
import { getTeacherDisplayName } from '../types.ts';
import type { Class, School, Subject, Teacher } from '../types.ts';

type TeacherExportProfile = Pick<Teacher,
  | 'id'
  | 'name'
  | 'lastName'
  | 'firstNames'
  | 'schoolId'
  | 'teachingAssignments'
  | 'assignedSubjects'
  | 'subjectIds'
  | 'administrativeClassIds'
  | 'administrativeClassAssignments'
>;

interface AssignmentDetailRow {
  schoolId: number | null;
  schoolName: string;
  teacherId: number;
  teacherName: string;
  subjectId: number | null;
  subjectName: string;
  classNames: string;
  status: string;
}

const compareByNameThenId = (left: { name: string; id: number }, right: { name: string; id: number }) => (
  left.name.localeCompare(right.name, 'fr', { sensitivity: 'base', numeric: true }) || left.id - right.id
);

export const buildTeacherAssignmentDetailRows = (
  teachers: TeacherExportProfile[],
  schools: School[],
  classes: Class[],
  subjects: Subject[],
): AssignmentDetailRow[] => {
  const schoolById = new Map(schools.map((school) => [school.id, school]));
  const classById = new Map(classes.map((item) => [item.id, item]));
  const subjectById = new Map(subjects.map((subject) => [subject.id, subject]));
  const rows: AssignmentDetailRow[] = [];

  for (const teacher of teachers) {
    const groups = new Map<string, {
      schoolId: number;
      subjectId: number;
      classIds: Set<number>;
    }>();
    for (const assignment of teacher.teachingAssignments ?? []) {
      const schoolId = Number(assignment.schoolId);
      if (!assignment.isActive
        || !Number.isInteger(assignment.id)
        || !Number.isInteger(assignment.classId)
        || !Number.isInteger(assignment.subjectId)
        || !Number.isInteger(schoolId)
        || schoolId <= 0) continue;

      const key = `${schoolId}:${teacher.id}:${assignment.subjectId}`;
      const group = groups.get(key) ?? {
        schoolId,
        subjectId: assignment.subjectId,
        classIds: new Set<number>(),
      };
      group.classIds.add(assignment.classId);
      groups.set(key, group);
    }

    const exactSubjectSchoolKeys = new Set<string>();
    const exactClassSchoolKeys = new Set<string>();
    for (const group of groups.values()) {
      exactSubjectSchoolKeys.add(`${group.schoolId}:${group.subjectId}`);
      const classNames = [...group.classIds]
        .map((id) => ({ id, name: classById.get(id)?.name ?? `Classe #${id}` }))
        .sort(compareByNameThenId)
        .map(({ name }) => name)
        .join(', ');
      rows.push({
        schoolId: group.schoolId,
        schoolName: schoolById.get(group.schoolId)?.name ?? `Établissement #${group.schoolId}`,
        teacherId: teacher.id,
        teacherName: getTeacherDisplayName(teacher),
        subjectId: group.subjectId,
        subjectName: subjectById.get(group.subjectId)?.name ?? `Matière #${group.subjectId}`,
        classNames,
        status: 'Affectation exacte confirmée',
      });
      for (const classId of group.classIds) {
        exactClassSchoolKeys.add(`${group.schoolId}:${classId}`);
      }
    }

    let hasUnverifiableAssociation = false;
    for (const subject of teacher.assignedSubjects ?? []) {
      if (subject.schoolId == null) {
        hasUnverifiableAssociation = true;
      } else if (!exactSubjectSchoolKeys.has(`${subject.schoolId}:${subject.id}`)) {
        rows.push({
          schoolId: subject.schoolId,
          schoolName: schoolById.get(subject.schoolId)?.name ?? `Établissement #${subject.schoolId}`,
          teacherId: teacher.id,
          teacherName: getTeacherDisplayName(teacher),
          subjectId: subject.id,
          subjectName: subjectById.get(subject.id)?.name ?? subject.name,
          classNames: '',
          status: 'Association partielle : matière associée sans paire classe–matière active confirmée',
        });
      }
    }
    if (!teacher.assignedSubjects?.length && teacher.subjectIds?.length) {
      hasUnverifiableAssociation = true;
    }

    for (const assignment of teacher.administrativeClassAssignments ?? []) {
      if (assignment.schoolId == null) {
        hasUnverifiableAssociation = true;
      } else if (!exactClassSchoolKeys.has(`${assignment.schoolId}:${assignment.classId}`)) {
        rows.push({
          schoolId: assignment.schoolId,
          schoolName: schoolById.get(assignment.schoolId)?.name ?? `Établissement #${assignment.schoolId}`,
          teacherId: teacher.id,
          teacherName: getTeacherDisplayName(teacher),
          subjectId: null,
          subjectName: '',
          classNames: classById.get(assignment.classId)?.name ?? `Classe #${assignment.classId}`,
          status: 'Association partielle : classe associée sans matière confirmée',
        });
      }
    }
    if (!teacher.administrativeClassAssignments?.length && teacher.administrativeClassIds?.length) {
      hasUnverifiableAssociation = true;
    }

    if (hasUnverifiableAssociation) {
      rows.push({
        schoolId: null,
        schoolName: 'Non vérifiable',
        teacherId: teacher.id,
        teacherName: getTeacherDisplayName(teacher),
        subjectId: null,
        subjectName: 'Non vérifiable',
        classNames: '',
        status: 'Association partielle : établissement ou correspondance classe–matière non vérifiable',
      });
    } else if (groups.size === 0
      && !rows.some((row) => row.teacherId === teacher.id && row.status.startsWith('Association partielle'))) {
      rows.push({
        schoolId: null,
        schoolName: 'Non vérifiable',
        teacherId: teacher.id,
        teacherName: getTeacherDisplayName(teacher),
        subjectId: null,
        subjectName: '',
        classNames: '',
        status: 'Aucune affectation classe–matière confirmée',
      });
    }
  }

  return rows.sort((left, right) => (
    (left.schoolId ?? Number.MAX_SAFE_INTEGER) - (right.schoolId ?? Number.MAX_SAFE_INTEGER)
    || left.teacherId - right.teacherId
    || (left.subjectId ?? Number.MAX_SAFE_INTEGER) - (right.subjectId ?? Number.MAX_SAFE_INTEGER)
    || left.status.localeCompare(right.status, 'fr')
  ));
};

export const buildTeacherExportWorkbook = async (
  summaryRows: Array<Record<string, string>>,
  teachers: TeacherExportProfile[],
  schools: School[],
  classes: Class[],
  subjects: Subject[],
): Promise<Uint8Array> => {
  const workbook = new ExcelJS.Workbook();
  const summary = workbook.addWorksheet('Enseignants');
  const summaryHeaders = Object.keys(summaryRows[0] ?? {
    'Nom complet': '',
    'Adresse Email': '',
    École: '',
    'Spécialité enseignée': '',
    Téléphone: '',
    'Dernière connexion': '',
  });
  summary.columns = summaryHeaders.map((header) => ({ header, key: header }));
  summary.addRows(summaryRows.map((row) => summaryHeaders.map((header) => row[header] ?? '')));

  const detail = workbook.addWorksheet('Détail des affectations');
  const detailHeaders = [
    'Établissement',
    'Identifiant enseignant',
    'Enseignant',
    'Identifiant matière',
    'Matière',
    'Classes affectées',
    'État de vérification',
  ];
  detail.columns = [
    { header: detailHeaders[0], key: 'schoolName', width: 24 },
    { header: detailHeaders[1], key: 'teacherId', width: 20 },
    { header: detailHeaders[2], key: 'teacherName', width: 28 },
    { header: detailHeaders[3], key: 'subjectId', width: 18 },
    { header: detailHeaders[4], key: 'subjectName', width: 24 },
    { header: detailHeaders[5], key: 'classNames', width: 42 },
    { header: detailHeaders[6], key: 'status', width: 68 },
  ];
  detail.addRows(buildTeacherAssignmentDetailRows(teachers, schools, classes, subjects));
  const header = detail.getRow(1);
  header.font = { bold: true };
  header.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDCE6F1' } };
  });
  return new Uint8Array(await workbook.xlsx.writeBuffer());
};
