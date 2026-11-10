import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import type { Class, School, Subject, Teacher } from '../types.ts';
import { buildTeacherExportWorkbook } from './teacherAssignmentsExcel';

describe('teacher assignments Excel export', () => {
  it('groups exact pairs by school, teacher and subject while preserving partial and unassigned teachers', async () => {
    const schools: School[] = [
      { id: 1, name: 'École du Lac', address: '', phone: '' },
      { id: 2, name: 'École du Nord', address: '', phone: '' },
    ];
    const classes: Class[] = [
      { id: 101, name: '6e A', schoolId: null, academicYearId: 1 },
      { id: 102, name: '5e B', schoolId: null, academicYearId: 1 },
      { id: 103, name: '4e A', schoolId: null, academicYearId: 1 },
      { id: 104, name: '3e B', schoolId: null, academicYearId: 1 },
    ];
    const subjects: Subject[] = [
      { id: 201, name: 'Mathématiques' },
      { id: 202, name: 'Physique' },
    ];
    const teachers: Teacher[] = [
      {
        id: 11,
        userId: 111,
        name: 'Enseignant A',
        email: 'a@example.com',
        schoolId: 1,
        schoolIds: [1, 2],
        subjectIds: [201, 202],
        teachingAssignments: [
          { id: 1, classId: 101, subjectId: 201, schoolId: 1, isActive: true },
          { id: 2, classId: 102, subjectId: 201, schoolId: 1, isActive: true },
          { id: 3, classId: 101, subjectId: 201, schoolId: 1, isActive: true },
          { id: 4, classId: 103, subjectId: 202, schoolId: 1, isActive: true },
          { id: 5, classId: 104, subjectId: 202, schoolId: 2, isActive: true },
          { id: 6, classId: 103, subjectId: 202, schoolId: 2, isActive: false },
        ],
      },
      {
        id: 12,
        userId: 112,
        name: 'Enseignant Partiel',
        email: 'partial@example.com',
        schoolId: 1,
        assignedSubjects: [{ id: 201, name: 'Mathématiques', schoolId: 1 }],
        administrativeClassIds: [102],
        administrativeClassAssignments: [{ classId: 102, schoolId: 1 }],
      },
      {
        id: 13,
        userId: 113,
        name: 'Enseignant Sans affectation',
        email: 'none@example.com',
        schoolId: 2,
      },
    ];
    const summaryRows = teachers.map((teacher) => ({
      'Nom complet': teacher.name,
      'Adresse Email': teacher.email,
      École: schools.find((school) => school.id === teacher.schoolId)?.name ?? '',
    }));

    const bytes = await buildTeacherExportWorkbook(summaryRows, teachers, schools, classes, subjects);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Buffer.from(bytes));

    const summary = workbook.getWorksheet('Enseignants');
    expect(summary?.rowCount).toBe(4);
    expect(summary?.getRow(2).getCell(1).value).toBe('Enseignant A');

    const detail = workbook.getWorksheet('Détail des affectations');
    expect(detail?.getRow(1).values).toEqual([
      undefined,
      'Établissement',
      'Identifiant enseignant',
      'Enseignant',
      'Identifiant matière',
      'Matière',
      'Classes affectées',
      'État de vérification',
    ]);

    const rows: Array<{ school: unknown; teacherId: unknown; subjectId: unknown; subject: unknown; classes: unknown; status: unknown }> = [];
    detail?.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      rows.push({
        school: row.getCell(1).value,
        teacherId: row.getCell(2).value,
        subjectId: row.getCell(4).value,
        subject: row.getCell(5).value,
        classes: row.getCell(6).value,
        status: row.getCell(7).value,
      });
    });

    const exactRows = rows.filter((row) => row.status === 'Affectation exacte confirmée');
    expect(exactRows).toHaveLength(3);
    expect(exactRows.find((row) => row.school === 'École du Lac' && row.subjectId === 201)?.classes).toBe('5e B, 6e A');
    expect(exactRows.filter((row) => row.school === 'École du Lac' && row.subjectId === 202)).toHaveLength(1);
    expect(exactRows.find((row) => row.school === 'École du Nord' && row.subjectId === 202)?.classes).toBe('3e B');
    expect(exactRows.every((row) => row.teacherId === 11)).toBe(true);

    const partialRows = rows.filter((row) => row.teacherId === 12);
    expect(partialRows).toHaveLength(2);
    expect(partialRows.every((row) => row.school === 'École du Lac')).toBe(true);
    expect(partialRows.find((row) => row.subjectId === 201)).toMatchObject({
      classes: '',
      status: 'Association partielle : matière associée sans paire classe–matière active confirmée',
    });
    expect(partialRows.find((row) => row.subjectId == null)).toMatchObject({
      subject: '',
      classes: '5e B',
      status: 'Association partielle : classe associée sans matière confirmée',
    });

    const unassignedRow = rows.find((row) => row.teacherId === 13);
    expect(unassignedRow?.teacherId).toBe(13);
    expect(unassignedRow?.status).toBe('Aucune affectation classe–matière confirmée');
  });
});
