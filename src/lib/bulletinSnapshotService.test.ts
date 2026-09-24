import { describe, expect, it } from 'vitest';
import {
  calculateAnnualBulletinResults,
  generateBulletinSnapshot,
  groupBulletinLinesBySubjectType,
  resolveAnnualPeriodScope,
  resolveSubjectTeacherName,
  type BulletinLineSnapshotInput,
  type BulletinSnapshotContext,
  type BulletinSnapshotPersistence,
  type CreateBulletinInput,
  type SubjectTypeMetadata,
} from './bulletinSnapshotService';
import type { BulletinEvaluationLike, BulletinGradeLike } from './bulletinService';

describe('calcul de la moyenne et du rang annuels', () => {
  it('calcule la moyenne et le rang annuels sur deux semestres, sans dépendre de orderIndex', () => {
    const terms = [
      { id: 1, name: '1er Semestre', periodType: 'semester', orderIndex: 1, academicYearId: 100, startDate: '2025-09-01', endDate: '2025-12-31' },
      { id: 2, name: '2ème Semestre', periodType: 'semester', orderIndex: 1, academicYearId: 100, startDate: '2026-01-01', endDate: '2026-06-30' },
    ];
    const bulletins = [
      { id: 11, studentId: 1, schoolYearId: 100, termId: 1, average: 12 },
      { id: 12, studentId: 1, schoolYearId: 100, termId: 2, average: 8 },
      { id: 21, studentId: 2, schoolYearId: 100, termId: 1, average: 14 },
      { id: 22, studentId: 2, schoolYearId: 100, termId: 2, average: 10 },
    ];

    expect(resolveAnnualPeriodScope(1, terms, 100).isLastPeriod).toBe(false);
    expect(resolveAnnualPeriodScope(2, terms, 100).isLastPeriod).toBe(true);
    expect(calculateAnnualBulletinResults({ targetStudentId: 1, classStudentIds: [1, 2], periods: terms, bulletins })).toEqual({
      annualAverage: 10,
      annualRank: 2,
    });
  });

  it('calcule la moyenne annuelle sur trois trimestres et la réserve au troisième', () => {
    const terms = [
      { id: 1, name: 'Trimestre 1', periodType: 'trimester', orderIndex: 1, academicYearId: 100, startDate: '2025-09-01', endDate: '2025-11-30' },
      { id: 2, name: 'Trimestre 2', periodType: 'trimester', orderIndex: 1, academicYearId: 100, startDate: '2025-12-01', endDate: '2026-02-28' },
      { id: 3, name: 'Trimestre 3', periodType: 'trimester', orderIndex: 1, academicYearId: 100, startDate: '2026-03-01', endDate: '2026-06-30' },
    ];
    const bulletins = [
      { id: 11, studentId: 1, schoolYearId: 100, termId: 1, average: 12 },
      { id: 12, studentId: 1, schoolYearId: 100, termId: 2, average: 9 },
      { id: 13, studentId: 1, schoolYearId: 100, termId: 3, average: 15 },
    ];

    expect(resolveAnnualPeriodScope(1, terms, 100).isLastPeriod).toBe(false);
    expect(resolveAnnualPeriodScope(2, terms, 100).isLastPeriod).toBe(false);
    expect(resolveAnnualPeriodScope(3, terms, 100).isLastPeriod).toBe(true);
    expect(calculateAnnualBulletinResults({ targetStudentId: 1, classStudentIds: [1], periods: terms, bulletins })).toEqual({
      annualAverage: 12,
      annualRank: 1,
    });
  });
});

interface FakeState {
  students: Array<{ id: number; classId: number; schoolId: number; firstName: string; lastName: string }>;
  classes: Array<{ id: number; academicYearId: number }>;
  terms: Array<{ id: number; academicYearId: number }>;
  evaluations: BulletinEvaluationLike[];
  grades: BulletinGradeLike[];
  bulletins: Array<CreateBulletinInput & { id: number }>;
  bulletinLines: Array<BulletinLineSnapshotInput & { id: number; bulletinId: number }>;
  subjectTypeNames: Map<string, SubjectTypeMetadata>;
}

const cloneState = (state: FakeState): FakeState => ({
  students: state.students.map((row) => ({ ...row })),
  classes: state.classes.map((row) => ({ ...row })),
  terms: state.terms.map((row) => ({ ...row })),
  evaluations: state.evaluations.map((row) => ({ ...row })),
  grades: state.grades.map((row) => ({ ...row })),
  bulletins: state.bulletins.map((row) => ({ ...row })),
  bulletinLines: state.bulletinLines.map((row) => ({ ...row })),
  subjectTypeNames: new Map(state.subjectTypeNames),
});

const createFakePersistence = (initial: FakeState, failOnInsertLines = false): { persistence: BulletinSnapshotPersistence; state: FakeState } => {
  const state = cloneState(initial);
  const subjectCatalog = [
    { id: 6, name: 'Phylosophiees' },
    { id: 7, name: 'Math' },
    { id: 8, name: 'Français' },
    { id: 9, name: 'Histoire' },
  ];

  const persistence: BulletinSnapshotPersistence = {
    transaction: async <T>(run: (ctx: BulletinSnapshotContext) => Promise<T>) => {
      const draft = cloneState(state);

      const ctx: BulletinSnapshotContext = {
        async getStudentById(studentId) {
          return draft.students.find((row) => row.id === studentId) ?? null;
        },
        async getClassById(classId) {
          return draft.classes.find((row) => row.id === classId) ?? null;
        },
        async getTermById(termId) {
          return draft.terms.find((row) => row.id === termId) ?? null;
        },
        async getClassStudents(classId) {
          return draft.students.filter((row) => row.classId === classId);
        },
        async getClassTermEvaluations(classId, termId) {
          return draft.evaluations.filter((row) => row.classId === classId && row.termId === termId);
        },
        async getGradesForStudents(studentIds, evaluationIds) {
          return draft.grades.filter((row) => studentIds.includes(row.studentId) && evaluationIds.includes(row.evaluationId));
        },
        async getTeacherNames(teacherIds) {
          // Fake implementation: return empty map for testing
          return new Map();
        },
        async getSubjectTypes() {
          return new Map(draft.subjectTypeNames);
        },
        async getSubjectIdsByName(schoolId, subjectNames) {
          const legacyNames = Array.from(new Set(subjectNames.map((name) => String(name ?? '').trim()).filter(Boolean)));
          const metadata = await this.getSubjectMetadataByName(schoolId, legacyNames);
          return new Map(Array.from(metadata.entries()).map(([legacyName, subject]) => [legacyName, subject.id]));
        },
        async getSubjectMetadataByName(schoolId, subjectNames) {
          const uniqueNames = Array.from(new Set(subjectNames.map((name) => String(name ?? '').trim()).filter(Boolean)));
          const result = new Map<string, { id: number; name: string }>();

          for (const legacyName of uniqueNames) {
            const normalizedLegacy = legacyName.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
            const matches = subjectCatalog.filter((subject) => {
              const normalizedCurrent = subject.name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
              return normalizedCurrent === normalizedLegacy || normalizedCurrent.startsWith(normalizedLegacy) || normalizedLegacy.startsWith(normalizedCurrent) || normalizedCurrent.includes(normalizedLegacy) || normalizedLegacy.includes(normalizedCurrent);
            });

            if (matches[0]) {
              result.set(legacyName, matches[0]);
            }
          }

          return result;
        },
        async getSubjectMetadataByIds(subjectIds) {
          const uniqueIds = Array.from(new Set(subjectIds.filter((subjectId): subjectId is number => Number.isInteger(subjectId) && subjectId > 0)));
          if (uniqueIds.length === 0) return new Map();

          return new Map(subjectCatalog
            .filter((subject) => uniqueIds.includes(subject.id))
            .map((subject) => [subject.id, { id: subject.id, name: subject.name }]));
        },
        async insertBulletin(payload) {
          const id = draft.bulletins.length + 1;
          draft.bulletins.push({ ...payload, id });
          return { id };
        },
        async insertBulletinLines(bulletinId, lines) {
          if (failOnInsertLines) {
            throw new Error('line insertion failed');
          }
          lines.forEach((line) => {
            draft.bulletinLines.push({
              ...line,
              id: draft.bulletinLines.length + 1,
              bulletinId,
            });
          });
        },
      };

      const result = await run(ctx);
      Object.assign(state, draft);
      return result;
    },
  };

  return { persistence, state };
};

describe('resolveCurrentSubjectMetadataByName', () => {
  const createApprovedSubjectResolverTx = (approvedRows: Array<{ id: number; name: string; schoolId: number | null }>) => ({
    select: () => ({
      from: () => ({
        innerJoin: () => ({
          where: (predicate: unknown) => {
            void predicate;
            return approvedRows;
          },
        }),
      }),
    }),
  }) as any;

  it('n utilise que les matières approuvées pour l école et rejette les matières proches non approuvées', async () => {
    const approvedRows = [
      { id: 77, name: 'Mathématiques', schoolId: 14 },
      { id: 88, name: 'Français', schoolId: 14 },
    ];
    const tx = createApprovedSubjectResolverTx(approvedRows);

    const result = await (await import('./bulletinSnapshotService')).resolveCurrentSubjectMetadataByName(tx, 14, ['Mathématiques', 'Mathématique Fine']);

    expect(result.get('Mathématiques')).toEqual({ id: 77, name: 'Mathématiques' });
    expect(result.has('Mathématique Fine')).toBe(false);
  });

  it('ne choisit pas une matière non approuvée même si son nom est proche de l ancien libellé', async () => {
    const approvedRows = [
      { id: 77, name: 'Mathématiques', schoolId: 14 },
      { id: 88, name: 'Français', schoolId: 14 },
    ];
    const tx = createApprovedSubjectResolverTx(approvedRows);

    const result = await (await import('./bulletinSnapshotService')).resolveCurrentSubjectMetadataByName(tx, 14, ['Mathématique', 'Mathématique Fine']);

    expect(result.get('Mathématique')).toEqual({ id: 77, name: 'Mathématiques' });
    expect(result.has('Mathématique Fine')).toBe(false);
    expect(Array.from(result.values())).not.toContainEqual({ id: 91, name: 'Mathématique Fine' });
  });
});

describe('generateBulletinSnapshot', () => {
  const baseState: FakeState = {
    students: [
      { id: 1, classId: 10, schoolId: 1, firstName: 'Alice', lastName: 'Dupont' },
      { id: 2, classId: 10, schoolId: 1, firstName: 'Bob', lastName: 'Martin' },
    ],
    classes: [{ id: 10, academicYearId: 100 }],
    terms: [{ id: 7, academicYearId: 100 }],
    evaluations: [
      { id: 1, classId: 10, teacherId: 1, termId: 7, subject: 'Math', title: 'DS 1', type: 'devoir', coefficient: 2, maxScore: 20, countInBulletin: true },
      { id: 2, classId: 10, teacherId: 2, termId: 7, subject: 'Français', title: 'DS 2', type: 'interrogation', coefficient: 1, maxScore: 10, countInBulletin: true },
      { id: 3, classId: 10, teacherId: 1, termId: 7, subject: 'Histoire', title: 'DS 3', type: 'composition', coefficient: 1, maxScore: 20, countInBulletin: false },
    ],
    grades: [
      { id: 1, evaluationId: 1, studentId: 1, score: '14' },
      { id: 2, evaluationId: 2, studentId: 1, score: '8' },
      { id: 3, evaluationId: 3, studentId: 1, score: '19' },
      { id: 4, evaluationId: 1, studentId: 2, score: '10' },
      { id: 5, evaluationId: 2, studentId: 2, score: '7' },
    ],
    bulletins: [],
    bulletinLines: [],
    subjectTypeNames: new Map(),
  };

  it('regroupe les lignes selon le type de matière sans dupliquer les matières', () => {
    const lines = [
      { subjectName: 'Français', subjectTypeId: 10, subjectTypeName: 'Littéraire', sortOrder: 2, average: 14 },
      { subjectName: 'Histoire', subjectTypeId: 10, subjectTypeName: 'Littéraires', sortOrder: 2, average: 12 },
      { subjectName: 'Math', subjectTypeId: 20, subjectTypeName: 'Scientifique', sortOrder: 1, average: 16 },
      { subjectName: 'Informatique', subjectTypeId: 30, subjectTypeName: 'Informatique', sortOrder: 3, average: 15 },
      { subjectName: 'Sport', subjectTypeName: null, average: 18 },
    ];

    const groups = groupBulletinLinesBySubjectType(lines);

    expect(groups.map((group) => group.subjectTypeId)).toEqual([20, 10, 30, null]);
    expect(groups[1]?.lines.map((line) => line.subjectName)).toEqual(['Français', 'Histoire']);
    expect(groups[2]?.lines.map((line) => line.subjectName)).toEqual(['Informatique']);
    expect(groups[3]?.subjectTypeName).toBe('Matières sans type');
  });

  it('applique la classification fournie pour l école sans inventer de type', async () => {
    const { persistence } = createFakePersistence({
      ...baseState,
      evaluations: baseState.evaluations.map((evaluation) => evaluation.id === 2
        ? { ...evaluation, subject: 'Science' }
        : evaluation.id === 3
          ? { ...evaluation, countInBulletin: true }
        : evaluation),
      subjectTypeNames: new Map([
        ['Math', { subjectTypeId: 10, subjectTypeName: 'Litteraire', sortOrder: 2 }],
        ['Science', { subjectTypeId: 20, subjectTypeName: 'Scientifique', sortOrder: 1 }],
      ]),
    });

    const result = await generateBulletinSnapshot(1, 7, persistence);

    expect(result.subjectGroups.map((group) => group.subjectTypeId)).toEqual([20, 10, null]);
    expect(result.subjectGroups[0]?.lines.map((line) => line.subjectName)).toContain('Science');
    expect(result.subjectGroups[1]?.lines.map((line) => line.subjectName)).toContain('Math');
    expect(result.subjectGroups[0]?.lines).not.toContainEqual(expect.objectContaining({ subjectName: 'Math' }));
    expect(result.subjectGroups[1]?.lines).not.toContainEqual(expect.objectContaining({ subjectName: 'Science' }));
    expect(result.subjectGroups[0]?.lines).toHaveLength(1);
    expect(result.subjectGroups[1]?.lines).toHaveLength(1);
    expect(result.linesCount).toBe(3);
  });

  it('enregistre un bulletin et toutes ses lignes de matière', async () => {
    const { persistence, state } = createFakePersistence(baseState);

    const result = await generateBulletinSnapshot(1, 7, persistence);

    expect(result.bulletinId).toBe(1);
    expect(state.bulletins).toHaveLength(1);
    expect(state.bulletinLines.length).toBeGreaterThan(0);
    expect(state.bulletinLines.every((line) => line.bulletinId === 1)).toBe(true);
    expect(state.bulletinLines.map((line) => line.subjectName).sort()).toEqual(['Français', 'Math']);
  });

  it('persiste les MIN/MAX officiels de la classe pour une generation individuelle', async () => {
    const { persistence, state } = createFakePersistence({
      ...baseState,
      students: [
        { id: 1, classId: 10, schoolId: 1, firstName: 'Alice', lastName: 'Dupont' },
        { id: 2, classId: 10, schoolId: 1, firstName: 'Bob', lastName: 'Martin' },
        { id: 3, classId: 10, schoolId: 1, firstName: 'Charlie', lastName: 'Durand' },
      ],
      evaluations: [
        { id: 10, classId: 10, teacherId: 1, termId: 7, subject: 'Math', title: 'Composition', type: 'composition', coefficient: 1, maxScore: 20, countInBulletin: true },
        { id: 11, classId: 10, teacherId: 1, termId: 7, subject: 'Math', title: 'Exclue', type: 'composition', coefficient: 10, maxScore: 20, countInBulletin: false },
      ],
      grades: [
        { id: 10, evaluationId: 10, studentId: 1, score: '14' },
        { id: 11, evaluationId: 10, studentId: 2, score: '11.5' },
        { id: 12, evaluationId: 10, studentId: 3, score: '8.75' },
        { id: 13, evaluationId: 11, studentId: 3, score: '20' },
      ],
    });

    const result = await generateBulletinSnapshot(2, 7, 901, persistence);
    const bulletin = state.bulletins[0];

    expect(result.average).toBe(11.5);
    expect(result.rank).toBe(2);
    expect(bulletin?.generationId).toBe(901);
    expect(bulletin?.classHighestAverage).toBe(14);
    expect(bulletin?.classLowestAverage).toBe(8.75);
    expect(bulletin?.classAverage).toBeCloseTo((14 + 11.5 + 8.75) / 3, 10);
  });

  it('classe les élèves selon la moyenne officielle avec un rang standard pour les ex æquo', async () => {
    const { persistence, state } = createFakePersistence({
      ...baseState,
      students: [1, 2, 3, 4].map((id) => ({
        id,
        classId: 10,
        schoolId: 1,
        firstName: `Student ${id}`,
        lastName: 'Test',
      })),
      evaluations: [
        { id: 20, classId: 10, teacherId: 1, termId: 7, subject: 'Math', title: 'Composition', type: 'composition', coefficient: 1, maxScore: 20, countInBulletin: true },
      ],
      grades: [15, 14, 14, 13].map((score, index) => ({
        id: index + 20,
        evaluationId: 20,
        studentId: index + 1,
        score: String(score),
      })),
    });

    for (const studentId of [1, 2, 3, 4]) {
      await generateBulletinSnapshot(studentId, 7, persistence);
    }

    expect(state.bulletins.sort((a, b) => a.studentId - b.studentId).map((bulletin) => [bulletin.average, bulletin.rank])).toEqual([
      [15, 1],
      [14, 2],
      [14, 2],
      [13, 4],
    ]);
  });

  it('exclut les moyennes nulles des MIN/MAX et conserve le snapshot apres modification des notes', async () => {
    const { persistence, state } = createFakePersistence({
      ...baseState,
      students: [
        { id: 1, classId: 10, schoolId: 1, firstName: 'Alice', lastName: 'Dupont' },
        { id: 2, classId: 10, schoolId: 1, firstName: 'Bob', lastName: 'Martin' },
        { id: 3, classId: 10, schoolId: 1, firstName: 'Charlie', lastName: 'Durand' },
      ],
      evaluations: [
        { id: 20, classId: 10, teacherId: 1, termId: 7, subject: 'Math', title: 'Composition', type: 'composition', coefficient: 1, maxScore: 20, countInBulletin: true },
      ],
      grades: [
        { id: 20, evaluationId: 20, studentId: 1, score: '14' },
        { id: 21, evaluationId: 20, studentId: 2, score: '11.5' },
        { id: 22, evaluationId: 20, studentId: 3, score: 'invalid' },
      ],
    });

    await generateBulletinSnapshot(2, 7, 902, persistence);
    const bulletin = state.bulletins[0];
    const highestBeforeChange = bulletin?.classHighestAverage;
    const lowestBeforeChange = bulletin?.classLowestAverage;

    const changedGrade = state.grades.find((grade) => grade.studentId === 3);
    if (changedGrade) changedGrade.score = '20';

    expect(highestBeforeChange).toBe(14);
    expect(lowestBeforeChange).toBe(11.5);
    expect(bulletin?.classAverage).toBeCloseTo((14 + 11.5) / 2, 10);
    expect(bulletin?.classHighestAverage).toBe(14);
    expect(bulletin?.classLowestAverage).toBe(11.5);
  });

  it('isole les MIN/MAX entre deux generations completes partagees par la classe', async () => {
    const { persistence, state } = createFakePersistence({
      ...baseState,
      students: [
        { id: 1, classId: 10, schoolId: 1, firstName: 'Alice', lastName: 'Dupont' },
        { id: 2, classId: 10, schoolId: 1, firstName: 'Bob', lastName: 'Martin' },
        { id: 3, classId: 10, schoolId: 1, firstName: 'Charlie', lastName: 'Durand' },
      ],
      evaluations: [
        { id: 30, classId: 10, teacherId: 1, termId: 7, subject: 'Math', title: 'Composition', type: 'composition', coefficient: 1, maxScore: 20, countInBulletin: true },
      ],
      grades: [
        { id: 30, evaluationId: 30, studentId: 1, score: '14' },
        { id: 31, evaluationId: 30, studentId: 2, score: '11.5' },
        { id: 32, evaluationId: 30, studentId: 3, score: '8.75' },
      ],
    });

    for (const studentId of [1, 2, 3]) {
      await generateBulletinSnapshot(studentId, 7, 1001, persistence);
    }
    expect(state.bulletins.map((bulletin) => [bulletin.generationId, bulletin.classHighestAverage, bulletin.classLowestAverage, bulletin.classAverage])).toEqual([
      [1001, 14, 8.75, (14 + 11.5 + 8.75) / 3],
      [1001, 14, 8.75, (14 + 11.5 + 8.75) / 3],
      [1001, 14, 8.75, (14 + 11.5 + 8.75) / 3],
    ]);

    state.grades.find((grade) => grade.studentId === 1)!.score = '16';
    state.grades.find((grade) => grade.studentId === 2)!.score = '14';
    state.grades.find((grade) => grade.studentId === 3)!.score = '11';
    for (const studentId of [1, 2, 3]) {
      await generateBulletinSnapshot(studentId, 7, 1002, persistence);
    }

    expect(state.bulletins.slice(3).map((bulletin) => [bulletin.generationId, bulletin.classHighestAverage, bulletin.classLowestAverage, bulletin.classAverage])).toEqual([
      [1002, 16, 11, (16 + 14 + 11) / 3],
      [1002, 16, 11, (16 + 14 + 11) / 3],
      [1002, 16, 11, (16 + 14 + 11) / 3],
    ]);
    expect(state.bulletins.slice(0, 3).every((bulletin) => bulletin.classHighestAverage === 14 && bulletin.classLowestAverage === 8.75)).toBe(true);
  });

  it('priorise subjectId de l évaluation quand il est disponible, même si le libellé historique est ancien', async () => {
    const customPersistence: BulletinSnapshotPersistence = {
      transaction: async <T>(run: (ctx: BulletinSnapshotContext) => Promise<T>) => {
        const students = [
          { id: 1, classId: 10, schoolId: 1, firstName: 'Alice', lastName: 'Dupont' },
        ];
        const classes = [{ id: 10, academicYearId: 100 }];
        const terms = [{ id: 7, academicYearId: 100 }];
        const evaluations: BulletinEvaluationLike[] = [
          { id: 500, classId: 10, teacherId: 1, termId: 7, subject: 'Physique et Chimie', title: 'Interro', type: 'interrogation', coefficient: 1, maxScore: 20, countInBulletin: true, subjectId: 5 },
        ];
        const grades: BulletinGradeLike[] = [
          { id: 500, evaluationId: 500, studentId: 1, score: '16' },
        ];
        const subjectMetadata = new Map<string, { id: number; name: string }>([['Physique et Chimie', { id: 5, name: 'Sciences Physique' }]]);
        const bulletinLines: BulletinLineSnapshotInput[] = [];

        const ctx: BulletinSnapshotContext = {
          async getStudentById(studentId) { return students.find((row) => row.id === studentId) ?? null; },
          async getClassById(classId) { return classes.find((row) => row.id === classId) ?? null; },
          async getTermById(termId) { return terms.find((row) => row.id === termId) ?? null; },
          async getClassStudents(classId) { return students.filter((row) => row.classId === classId); },
          async getClassTermEvaluations(classId, termId) { return evaluations.filter((row) => row.classId === classId && row.termId === termId); },
          async getGradesForStudents(studentIds, evaluationIds) { return grades.filter((row) => studentIds.includes(row.studentId) && evaluationIds.includes(row.evaluationId)); },
          async getTeacherNames() { return new Map(); },
          async getSubjectTypes() { return new Map(); },
          async getSubjectIdsByName() { return new Map(); },
          async getSubjectMetadataByName() { return subjectMetadata; },
          async getSubjectMetadataByIds(subjectIds) {
            const ids = Array.from(new Set(subjectIds.filter((subjectId): subjectId is number => Number.isInteger(subjectId) && subjectId > 0)));
            if (ids.length === 0) return new Map();

            return new Map(Array.from(subjectMetadata.values())
              .filter((subject) => ids.includes(subject.id))
              .map((subject) => [subject.id, { id: subject.id, name: subject.name }]));
          },
          async insertBulletin(payload) { return { id: 1 }; },
          async insertBulletinLines(_bulletinId, lines) { lines.forEach((line) => bulletinLines.push(line)); },
        };

        const result = await run(ctx);
        expect(bulletinLines[0]?.subjectId).toBe(5);
        expect(bulletinLines[0]?.subjectName).toBe('Sciences Physique');
        return result;
      },
    };

    await expect(generateBulletinSnapshot(1, 7, customPersistence)).resolves.toBeTruthy();
  });

  it('conserve le comportement historique quand subjectId est absent', async () => {
    const { persistence, state } = createFakePersistence({
      ...baseState,
      evaluations: [
        { id: 999, classId: 10, teacherId: 1, termId: 7, subject: 'Ancien libellé', title: 'Interro', type: 'interrogation', coefficient: 1, maxScore: 20, countInBulletin: true },
      ],
      grades: [
        { id: 999, evaluationId: 999, studentId: 1, score: '12' },
      ],
    });

    const result = await generateBulletinSnapshot(1, 7, persistence);
    const subjectLine = state.bulletinLines[0];

    expect(result.linesCount).toBe(1);
    expect(subjectLine?.subjectId).toBeNull();
    expect(subjectLine?.subjectName).toBe('Ancien libellé');
  });

  it('utilise le nom courant de la matière quand une évaluation garde un ancien libellé', async () => {
    const { persistence, state } = createFakePersistence({
      ...baseState,
      evaluations: [
        { id: 101, classId: 10, teacherId: 1, termId: 7, subject: 'Phylosophie', title: 'Interro', type: 'interrogation', coefficient: 1, maxScore: 20, countInBulletin: true },
      ],
      grades: [
        { id: 101, evaluationId: 101, studentId: 1, score: '15' },
      ],
    });

    const result = await generateBulletinSnapshot(1, 7, persistence);
    const subjectLine = state.bulletinLines.find((line) => line.subjectId === 6) ?? state.bulletinLines[0];

    expect(result.linesCount).toBe(1);
    expect(subjectLine?.subjectName).toBe('Phylosophiees');
    expect(subjectLine?.subjectId).toBe(6);
  });

  it('conserve le coefficient publié même si l évaluation garde un ancien libellé de matière', async () => {
    const { persistence, state } = createFakePersistence({
      ...baseState,
      evaluations: [
        { id: 201, classId: 10, teacherId: 1, termId: 7, subject: 'Phylosophie', title: 'Composition finale', type: 'composition', coefficient: 2, maxScore: 20, countInBulletin: true },
      ],
      grades: [
        { id: 201, evaluationId: 201, studentId: 1, score: '15' },
      ],
    });

    const result = await generateBulletinSnapshot(1, 7, persistence);
    const subjectLine = state.bulletinLines.find((line) => line.subjectId === 6) ?? state.bulletinLines[0];

    expect(result.linesCount).toBe(1);
    expect(subjectLine?.subjectName).toBe('Phylosophiees');
    expect(subjectLine?.subjectId).toBe(6);
    expect(subjectLine?.coefficient).toBe(2);
  });

  it('ne prend en compte que les évaluations validées et ignore les notes absentes', async () => {
    const { persistence, state } = createFakePersistence({
      ...baseState,
      evaluations: baseState.evaluations.map((evaluation) => ({
        ...evaluation,
        countInBulletin: evaluation.id === 1,
      })),
    });

    const result = await generateBulletinSnapshot(1, 7, persistence);

    expect(result.average).toBeNull();
    expect(result.totalCoefficients).toBe(0);
    expect(state.bulletinLines.map((line) => line.subjectName)).toEqual(['Math']);
    expect(state.bulletinLines[0]?.coefficient).toBeNull();
    expect(state.bulletinLines.some((line) => line.subjectName === 'Français')).toBe(false);
    expect(state.bulletinLines.some((line) => line.subjectName === 'Histoire')).toBe(false);
  });

  it('utilise le coefficient de la composition publiée pour la ligne matière', async () => {
    const { persistence, state } = createFakePersistence({
      ...baseState,
      evaluations: [
        { id: 10, classId: 10, teacherId: 1, termId: 7, subject: 'Math', title: 'Interro 1', type: 'interrogation', coefficient: 2, maxScore: 20, countInBulletin: true },
        { id: 11, classId: 10, teacherId: 1, termId: 7, subject: 'Math', title: 'Interro 2', type: 'interrogation', coefficient: 4, maxScore: 20, countInBulletin: true },
        { id: 12, classId: 10, teacherId: 1, termId: 7, subject: 'Math', title: 'Devoir', type: 'devoir', coefficient: 1, maxScore: 20, countInBulletin: true },
        { id: 13, classId: 10, teacherId: 1, termId: 7, subject: 'Math', title: 'Composition', type: 'composition', coefficient: 3, maxScore: 20, countInBulletin: true },
      ],
      grades: [
        { id: 10, evaluationId: 10, studentId: 1, score: '10' },
        { id: 11, evaluationId: 11, studentId: 1, score: '14' },
        { id: 12, evaluationId: 12, studentId: 1, score: '12' },
        { id: 13, evaluationId: 13, studentId: 1, score: '16' },
      ],
    });

    const result = await generateBulletinSnapshot(1, 7, persistence);
    const mathLine = state.bulletinLines.find((line) => line.subjectName === 'Math');

    expect(mathLine?.coefficient).toBe(3);
    expect(mathLine?.coefficient).not.toBe(10);
    expect(result.totalCoefficients).toBe(3);
  });

  it('n enregistre rien si une erreur survient pendant les lignes (transaction atomique)', async () => {
    const { persistence, state } = createFakePersistence(baseState, true);

    await expect(generateBulletinSnapshot(1, 7, persistence)).rejects.toThrow('line insertion failed');
    expect(state.bulletins).toHaveLength(0);
    expect(state.bulletinLines).toHaveLength(0);
  });

  it('calcule le rang par matière avec trois élèves et trois moyennes différentes', async () => {
    const { persistence, state } = createFakePersistence({
      ...baseState,
      students: [
        { id: 1, classId: 10, schoolId: 1, firstName: 'Alice', lastName: 'Dupont' },
        { id: 2, classId: 10, schoolId: 1, firstName: 'Bob', lastName: 'Martin' },
        { id: 3, classId: 10, schoolId: 1, firstName: 'Charlie', lastName: 'Durand' },
      ],
      grades: [
        // Math: Alice 18, Bob 15, Charlie 12
        { id: 1, evaluationId: 1, studentId: 1, score: '18' },
        { id: 2, evaluationId: 1, studentId: 2, score: '15' },
        { id: 3, evaluationId: 1, studentId: 3, score: '12' },
        // Français: Alice 14, Bob 16, Charlie 18
        { id: 4, evaluationId: 2, studentId: 1, score: '8' },  // 8/10 = 16/20
        { id: 5, evaluationId: 2, studentId: 2, score: '9.5' }, // 9.5/10 = 19/20
        { id: 6, evaluationId: 2, studentId: 3, score: '10' }, // 10/10 = 20/20
      ],
    });

    const result = await generateBulletinSnapshot(1, 7, persistence);

    const mathLine = state.bulletinLines.find((line) => line.subjectName === 'Math');
    const frenchLine = state.bulletinLines.find((line) => line.subjectName === 'Français');

    // Alice should rank 1st in Math (18 is highest)
    expect(mathLine?.rank).toBe(1);
    // Alice should rank 3rd in French (16/20 is lowest)
    expect(frenchLine?.rank).toBe(3);
  });

  it('attribue le même rang à deux élèves ex æquo (tie-breaking rule)', async () => {
    const { persistence, state } = createFakePersistence({
      ...baseState,
      students: [
        { id: 1, classId: 10, schoolId: 1, firstName: 'Alice', lastName: 'Dupont' },
        { id: 2, classId: 10, schoolId: 1, firstName: 'Bob', lastName: 'Martin' },
        { id: 3, classId: 10, schoolId: 1, firstName: 'Charlie', lastName: 'Durand' },
      ],
      grades: [
        // Math: All three students have 15 (tie), except Charlie has 13
        { id: 1, evaluationId: 1, studentId: 1, score: '15' },
        { id: 2, evaluationId: 1, studentId: 2, score: '15' },
        { id: 3, evaluationId: 1, studentId: 3, score: '13' },
      ],
    });

    const result = await generateBulletinSnapshot(1, 7, persistence);

    const mathLine = state.bulletinLines.find((line) => line.subjectName === 'Math');

    // Alice is tied at 15, so rank 1
    expect(mathLine?.rank).toBe(1);
  });

  it('calcule les rangs indépendamment pour chaque matière', async () => {
    const { persistence, state } = createFakePersistence({
      ...baseState,
      students: [
        { id: 1, classId: 10, schoolId: 1, firstName: 'Alice', lastName: 'Dupont' },
        { id: 2, classId: 10, schoolId: 1, firstName: 'Bob', lastName: 'Martin' },
      ],
      grades: [
        // Math: Alice 16, Bob 12
        { id: 1, evaluationId: 1, studentId: 1, score: '16' },
        { id: 2, evaluationId: 1, studentId: 2, score: '12' },
        // Français: Alice 10, Bob 16
        { id: 3, evaluationId: 2, studentId: 1, score: '5' }, // 5/10 = 10/20
        { id: 4, evaluationId: 2, studentId: 2, score: '8' }, // 8/10 = 16/20
      ],
    });

    const result = await generateBulletinSnapshot(1, 7, persistence);

    const mathLine = state.bulletinLines.find((line) => line.subjectName === 'Math');
    const frenchLine = state.bulletinLines.find((line) => line.subjectName === 'Français');

    // Alice is 1st in Math, 2nd in French
    expect(mathLine?.rank).toBe(1);
    expect(frenchLine?.rank).toBe(2);
  });

  it('choisit l enseignant principal d une matière par fréquence d affectation et non par la dernière occurrence', () => {
    expect(resolveSubjectTeacherName([7, 8, 7, 9], new Map([
      [7, 'Mme Aline'],
      [8, 'M. Benoit'],
      [9, 'Mme Celine'],
    ]))).toBe('Mme Aline');
  });

  it('conserve le nom actuel de l enseignant lorsque les évaluations pointent vers teacher_id 23 et user_id 54', () => {
    const teacherName = 'MASSEDA Ghislain Ikechuku Junior';
    const oldName = 'Ancien nom enseignant';

    expect(resolveSubjectTeacherName([23, 23, 23, 23], new Map([
      [23, teacherName],
      [12, oldName],
    ]))).toBe(teacherName);
    expect(resolveSubjectTeacherName([23, 23, 23, 23], new Map([
      [23, teacherName],
      [12, oldName],
    ]))).not.toBe(oldName);
  });

  it('retourne null pour le rang si aucune moyenne valide n\'existe', async () => {
    const { persistence, state } = createFakePersistence({
      ...baseState,
      grades: [
        // Only Bob has a grade in Math; Alice has none
        { id: 1, evaluationId: 1, studentId: 2, score: '15' },
      ],
    });

    const result = await generateBulletinSnapshot(1, 7, persistence);

    const mathLine = state.bulletinLines.find((line) => line.subjectName === 'Math');

    // Alice has no grade in Math, so rank should be null
    expect(mathLine?.rank).toBeNull();
  });

  it('le rang par matière correspond à la moyenne affichée dans la colonne Moy. Général', async () => {
    const { persistence, state } = createFakePersistence({
      ...baseState,
      students: [
        { id: 1, classId: 10, schoolId: 1, firstName: 'Alice', lastName: 'Dupont' },
        { id: 2, classId: 10, schoolId: 1, firstName: 'Bob', lastName: 'Martin' },
        { id: 3, classId: 10, schoolId: 1, firstName: 'Charlie', lastName: 'Durand' },
      ],
      grades: [
        // Math: Alice 20, Bob 10, Charlie 15
        { id: 1, evaluationId: 1, studentId: 1, score: '20' },
        { id: 2, evaluationId: 1, studentId: 2, score: '10' },
        { id: 3, evaluationId: 1, studentId: 3, score: '15' },
      ],
    });

    const result = await generateBulletinSnapshot(1, 7, persistence);

    const mathLine = state.bulletinLines.find((line) => line.subjectName === 'Math');

    // Alice: Moy. Clas 20/20 (rank 1), Moy. Général 20 because no composition exists
    expect(mathLine?.average).toBe(20);
    expect(mathLine?.rank).toBe(1);
  });

  it('calcule Moy. Clas comme la moyenne des moyennes Interro et Devoir', async () => {
    const { persistence, state } = createFakePersistence({
      ...baseState,
      students: [baseState.students[0]],
      evaluations: [
        { id: 10, classId: 10, teacherId: 1, termId: 7, subject: 'Math', title: 'Interro 1', type: 'interrogation', coefficient: 1, maxScore: 20, countInBulletin: true },
        { id: 11, classId: 10, teacherId: 1, termId: 7, subject: 'Math', title: 'Interro 2', type: 'interrogation', coefficient: 1, maxScore: 20, countInBulletin: true },
        { id: 12, classId: 10, teacherId: 1, termId: 7, subject: 'Math', title: 'Devoir 1', type: 'devoir', coefficient: 1, maxScore: 20, countInBulletin: true },
        { id: 13, classId: 10, teacherId: 1, termId: 7, subject: 'Math', title: 'Devoir 2', type: 'devoir', coefficient: 1, maxScore: 20, countInBulletin: true },
      ],
      grades: [
        { id: 10, evaluationId: 10, studentId: 1, score: '12' },
        { id: 11, evaluationId: 11, studentId: 1, score: '16' },
        { id: 12, evaluationId: 12, studentId: 1, score: '10' },
        { id: 13, evaluationId: 13, studentId: 1, score: '14' },
      ],
    });

    await generateBulletinSnapshot(1, 7, persistence);

    const mathLine = state.bulletinLines.find((line) => line.subjectName === 'Math');
    expect(mathLine?.interrogation).toBe(14);
    expect(mathLine?.devoir).toBe(12);
    expect(mathLine?.classAverage).toBe(13);
  });

  it('utilise uniquement la moyenne Interro si aucun Devoir n existe', async () => {
    const { persistence, state } = createFakePersistence({
      ...baseState,
      students: [baseState.students[0]],
      evaluations: [
        { id: 20, classId: 10, teacherId: 1, termId: 7, subject: 'Math', title: 'Interro', type: 'interrogation', coefficient: 1, maxScore: 20, countInBulletin: true },
      ],
      grades: [{ id: 20, evaluationId: 20, studentId: 1, score: '15' }],
    });

    await generateBulletinSnapshot(1, 7, persistence);

    expect(state.bulletinLines[0]?.classAverage).toBe(15);
  });

  it('utilise uniquement la moyenne Devoir si aucune Interro n existe', async () => {
    const { persistence, state } = createFakePersistence({
      ...baseState,
      students: [baseState.students[0]],
      evaluations: [
        { id: 30, classId: 10, teacherId: 1, termId: 7, subject: 'Math', title: 'Devoir', type: 'devoir', coefficient: 1, maxScore: 20, countInBulletin: true },
      ],
      grades: [{ id: 30, evaluationId: 30, studentId: 1, score: '13' }],
    });

    await generateBulletinSnapshot(1, 7, persistence);

    expect(state.bulletinLines[0]?.classAverage).toBe(13);
  });

  it('exclut les évaluations non retenues de Moy. Clas', async () => {
    const { persistence, state } = createFakePersistence({
      ...baseState,
      students: [baseState.students[0]],
      evaluations: [
        { id: 40, classId: 10, teacherId: 1, termId: 7, subject: 'Math', title: 'Interro retenue', type: 'interrogation', coefficient: 1, maxScore: 20, countInBulletin: true },
        { id: 41, classId: 10, teacherId: 1, termId: 7, subject: 'Math', title: 'Devoir non retenu', type: 'devoir', coefficient: 1, maxScore: 20, countInBulletin: false },
      ],
      grades: [
        { id: 40, evaluationId: 40, studentId: 1, score: '15' },
        { id: 41, evaluationId: 41, studentId: 1, score: '1' },
      ],
    });

    await generateBulletinSnapshot(1, 7, persistence);

    expect(state.bulletinLines[0]?.classAverage).toBe(15);
  });

  it('retourne null pour Moy. Clas sans Interro ni Devoir', async () => {
    const { persistence, state } = createFakePersistence({
      ...baseState,
      students: [baseState.students[0]],
      evaluations: [
        { id: 50, classId: 10, teacherId: 1, termId: 7, subject: 'Math', title: 'Composition', type: 'composition', coefficient: 1, maxScore: 20, countInBulletin: true },
      ],
      grades: [{ id: 50, evaluationId: 50, studentId: 1, score: '18' }],
    });

    await generateBulletinSnapshot(1, 7, persistence);

    expect(state.bulletinLines[0]?.classAverage).toBeNull();
  });

  it('calcule Moy. Clas indépendamment pour chaque matière', async () => {
    const { persistence, state } = createFakePersistence({
      ...baseState,
      students: [baseState.students[0]],
      evaluations: [
        { id: 60, classId: 10, teacherId: 1, termId: 7, subject: 'Math', title: 'Interro', type: 'interrogation', coefficient: 1, maxScore: 20, countInBulletin: true },
        { id: 61, classId: 10, teacherId: 1, termId: 7, subject: 'Math', title: 'Devoir', type: 'devoir', coefficient: 1, maxScore: 20, countInBulletin: true },
        { id: 62, classId: 10, teacherId: 1, termId: 7, subject: 'Français', title: 'Interro', type: 'interrogation', coefficient: 1, maxScore: 20, countInBulletin: true },
        { id: 63, classId: 10, teacherId: 1, termId: 7, subject: 'Français', title: 'Devoir', type: 'devoir', coefficient: 1, maxScore: 20, countInBulletin: true },
      ],
      grades: [
        { id: 60, evaluationId: 60, studentId: 1, score: '10' },
        { id: 61, evaluationId: 61, studentId: 1, score: '14' },
        { id: 62, evaluationId: 62, studentId: 1, score: '16' },
        { id: 63, evaluationId: 63, studentId: 1, score: '12' },
      ],
    });

    await generateBulletinSnapshot(1, 7, persistence);

    expect(state.bulletinLines.find((line) => line.subjectName === 'Math')?.classAverage).toBe(12);
    expect(state.bulletinLines.find((line) => line.subjectName === 'Français')?.classAverage).toBe(14);
  });

  it('calcule 11,50 comme Moy. Général et utilise cette valeur pour le rang et l appréciation', async () => {
    const { persistence, state } = createFakePersistence({
      ...baseState,
      students: [baseState.students[0]],
      evaluations: [
        { id: 70, classId: 10, teacherId: 1, termId: 7, subject: 'Math', title: 'Interro', type: 'interrogation', coefficient: 1, maxScore: 20, countInBulletin: true },
        { id: 71, classId: 10, teacherId: 1, termId: 7, subject: 'Math', title: 'Devoir', type: 'devoir', coefficient: 1, maxScore: 20, countInBulletin: true },
        { id: 72, classId: 10, teacherId: 1, termId: 7, subject: 'Math', title: 'Compo', type: 'composition', coefficient: 1, maxScore: 20, countInBulletin: true },
      ],
      grades: [
        { id: 70, evaluationId: 70, studentId: 1, score: '11.07' },
        { id: 71, evaluationId: 71, studentId: 1, score: '11.21' },
        { id: 72, evaluationId: 72, studentId: 1, score: '11.86' },
      ],
    });

    await generateBulletinSnapshot(1, 7, persistence);

    const mathLine = state.bulletinLines.find((line) => line.subjectName === 'Math');
    expect(mathLine?.interrogation).toBeCloseTo(11.07, 2);
    expect(mathLine?.devoir).toBeCloseTo(11.21, 2);
    expect(mathLine?.classAverage).toBeCloseTo(11.14, 2);
    expect(mathLine?.composition).toBeCloseTo(11.86, 2);
    expect(mathLine?.average).toBeCloseTo(11.5, 2);
    expect(mathLine?.rank).toBe(1);
    expect(mathLine?.teacherComment).toBe('Passable');
  });
});
