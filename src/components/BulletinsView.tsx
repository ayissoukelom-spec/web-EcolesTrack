import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ShieldCheck } from 'lucide-react';
import type {
  BulletinDetail,
  BulletinListFilters,
  BulletinListItem,
  BulletinTermOption,
  Class,
  Evaluation,
  Grade,
  School,
  Student,
  UserRole,
} from '../types.ts';
import { fetchBulletinDetail, apiFetch } from '../lib/api.ts';
import { useAuth } from '../contexts/AuthContext.tsx';
import { useBulletinsList } from '../hooks/useBulletinsList.ts';
import { useBulletinDetail } from '../hooks/useBulletinDetail.ts';
import { useGenerateBulletin } from '../hooks/useGenerateBulletin.ts';
import { useDownloadBulletinPDF } from '../hooks/useDownloadBulletinPDF.ts';
import BulletinsList from './bulletins/BulletinsList.tsx';
import BulletinDetailView from './bulletins/BulletinDetail.tsx';
import BulletinActions from './bulletins/BulletinActions.tsx';

interface BulletinsViewProps {
  schoolsList: School[];
  classesList: Class[];
  studentsList: Student[];
  evaluationsList: Evaluation[];
  gradesList: Grade[];
  teacherClassIds?: number[];
}

const parentCacheKey = (uid: string) => `ecoletrack_parent_bulletin_ids_${uid}`;

const normalizeEvaluationType = (value?: string | null): 'interrogation' | 'devoir' | 'composition' | null => {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (normalized === 'interrogation') return 'interrogation';
  if (normalized === 'devoir') return 'devoir';
  if (normalized === 'composition') return 'composition';
  return null;
};

const parseNumericScore = (score: string | number | null | undefined): number | null => {
  if (score == null) return null;
  const normalized = String(score).trim().replace(',', '.');
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
};

const computeWeightedAverage = (entries: Array<{ coefficient: number; score: number }>): number | null => {
  let totalWeightedScore = 0;
  let totalCoefficient = 0;

  for (const entry of entries) {
    const coefficient = Number(entry.coefficient ?? 0);
    if (!Number.isFinite(coefficient) || coefficient <= 0) continue;
    totalWeightedScore += entry.score * coefficient;
    totalCoefficient += coefficient;
  }

  return totalCoefficient > 0 ? totalWeightedScore / totalCoefficient : null;
};

const toParentListItem = (detail: BulletinDetail): BulletinListItem => ({
  id: detail.id,
  studentId: detail.studentId,
  studentName: detail.studentName,
  classId: detail.classId,
  className: detail.className,
  schoolYearId: detail.schoolYearId,
  schoolYearName: detail.schoolYearName,
  termId: detail.termId,
  termName: detail.termName,
  average: detail.average,
  rank: detail.rank,
  mention: detail.mention,
  appreciation: detail.appreciation,
  generatedAt: detail.generatedAt,
  createdAt: detail.createdAt,
  updatedAt: detail.updatedAt,
});

export default function BulletinsView({
  schoolsList,
  classesList,
  studentsList,
  evaluationsList,
  gradesList,
  teacherClassIds = [],
}: BulletinsViewProps) {
  const { role, user: simulated } = useAuth();
  const currentRole: UserRole = role as UserRole;
  const canGenerate = currentRole === 'school_admin' || currentRole === 'super_admin';
  const canList = currentRole === 'school_admin' || currentRole === 'super_admin' || currentRole === 'teacher' || currentRole === 'parent';
  const isTeacher = currentRole === 'teacher';
  const isParent = currentRole === 'parent';

  const [filters, setFilters] = useState<{ classId?: number; studentId?: number; termId?: number }>({});
  const [page, setPage] = useState(1);
  const pageSize = 20;

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [selectedBatchIds, setSelectedBatchIds] = useState<number[]>([]);
  const [generateSchoolId, setGenerateSchoolId] = useState<string>('');
  const [generateClassId, setGenerateClassId] = useState<string>('');
  const [generateStudentId, setGenerateStudentId] = useState<string>('');
  const [generateTermId, setGenerateTermId] = useState<string>('');
  const [schoolScopedClasses, setSchoolScopedClasses] = useState<Class[] | null>(null);
  const [schoolScopedClassesLoading, setSchoolScopedClassesLoading] = useState(false);
  const [schoolScopedClassesError, setSchoolScopedClassesError] = useState<string | null>(null);
  const schoolClassesRequestRef = useRef(0);
  const [lookupIdInput, setLookupIdInput] = useState('');
  const [parentKnownItems, setParentKnownItems] = useState<BulletinListItem[]>([]);
  const [lastGeneratedClassSummary, setLastGeneratedClassSummary] = useState<Array<{ id: number; studentName: string; className: string; termName: string }>>([]);
  const [lastGeneratedClassIds, setLastGeneratedClassIds] = useState<number[]>([]);
  const [evaluationValidationOverrides, setEvaluationValidationOverrides] = useState<Record<number, boolean>>({});
  const [validationBusyId, setValidationBusyId] = useState<number | null>(null);
  const [openEvaluationSubjects, setOpenEvaluationSubjects] = useState<Record<string, boolean>>({});
  const allEvaluationsCheckboxRef = useRef<HTMLInputElement | null>(null);

  const visibleClasses = useMemo(() => {
    if (!isTeacher) return classesList;
    return classesList.filter((c) => teacherClassIds.includes(c.id));
  }, [classesList, isTeacher, teacherClassIds]);

  const visibleStudents = useMemo(() => {
    const scopedByClass = filters.classId
      ? studentsList.filter((s) => s.classId === filters.classId)
      : studentsList;

    if (!isTeacher) return scopedByClass;
    return scopedByClass.filter((s) => teacherClassIds.includes(s.classId));
  }, [filters.classId, isTeacher, studentsList, teacherClassIds]);

  const visibleStudentIds = useMemo(() => new Set(visibleStudents.map((student) => student.id)), [visibleStudents]);

  const generateSchools = useMemo(() => {
    if (currentRole === 'super_admin' || currentRole === 'school_admin') {
      return schoolsList;
    }

    const classSchoolIds = new Set(
      classesList
        .map((klass) => klass.schoolId)
        .filter((schoolId): schoolId is number => schoolId != null),
    );
    return schoolsList.filter((school) => classSchoolIds.has(school.id));
  }, [classesList, currentRole, schoolsList]);

  const generateClasses = useMemo(() => {
    if (!generateSchoolId) return classesList;
    return schoolScopedClasses ?? [];
  }, [classesList, generateSchoolId, schoolScopedClasses]);

  const generateStudents = useMemo(() => {
    const classId = generateClassId ? Number(generateClassId) : null;
    const schoolId = generateSchoolId ? Number(generateSchoolId) : null;

    return studentsList.filter((student) => {
      if (classId != null && student.classId !== classId) return false;
      if (schoolId != null && student.schoolId !== schoolId) return false;
      return true;
    });
  }, [generateClassId, generateSchoolId, studentsList]);

  const [termsFromApi, setTermsFromApi] = useState<Array<{ id: number; name: string; startDate?: string | null; endDate?: string | null }>>([]);

  useEffect(() => {
    const schoolId = Number(generateSchoolId);
    if (!generateSchoolId || !Number.isInteger(schoolId) || schoolId <= 0) {
      schoolClassesRequestRef.current += 1;
      setSchoolScopedClasses(null);
      setSchoolScopedClassesLoading(false);
      setSchoolScopedClassesError(null);
      return;
    }

    const requestId = schoolClassesRequestRef.current + 1;
    schoolClassesRequestRef.current = requestId;
    setSchoolScopedClasses(null);
    setSchoolScopedClassesLoading(true);
    setSchoolScopedClassesError(null);

    apiFetch(`/api/classes?schoolId=${schoolId}`)
      .then((payload) => {
        if (schoolClassesRequestRef.current !== requestId) return;
        setSchoolScopedClasses(Array.isArray(payload) ? payload : []);
      })
      .catch((error: any) => {
        if (schoolClassesRequestRef.current !== requestId) return;
        setSchoolScopedClasses([]);
        setSchoolScopedClassesError(error?.message || 'Impossible de charger les classes de cette ecole.');
      })
      .finally(() => {
        if (schoolClassesRequestRef.current === requestId) {
          setSchoolScopedClassesLoading(false);
        }
      });
  }, [generateSchoolId]);

  useEffect(() => {
    (async () => {
      try {
        const list = await apiFetch('/api/school-terms');
        if (Array.isArray(list)) {
          setTermsFromApi(list.map((t: any) => ({
            id: t.id,
            name: t.name,
            startDate: t.startDate ?? null,
            endDate: t.endDate ?? null,
          })));
        }
      } catch (e) {
        // ignore
      }
    })();
  }, []);

  const termOptions = useMemo<BulletinTermOption[]>(() => {
    if (termsFromApi && termsFromApi.length > 0) {
      return termsFromApi.map((t) => ({ id: t.id, name: t.name }));
    }
    const seen = new Set<number>();
    const options: BulletinTermOption[] = [];
    for (const ev of evaluationsList || []) {
      const termId = Number(ev?.termId);
      if (!Number.isInteger(termId) || termId <= 0 || seen.has(termId)) continue;
      seen.add(termId);
      options.push({ id: termId, name: String(ev?.termName || `Trimestre ${termId}`) });
    }
    return options.sort((a, b) => a.id - b.id);
  }, [evaluationsList, termsFromApi]);

  const generateEvaluations = useMemo(() => {
    const classId = generateClassId ? Number(generateClassId) : null;
    const termId = generateTermId ? Number(generateTermId) : null;
    if (classId == null || termId == null) return [];
    const selectedTerm = termsFromApi.find((term) => term.id === termId);
    return evaluationsList.filter((evaluation) => {
      if (evaluation.classId !== classId) return false;
      if (evaluation.termId != null) return evaluation.termId === termId;
      if (!selectedTerm?.startDate || !selectedTerm.endDate) return false;
      const date = String(evaluation.date || '').slice(0, 10);
      return date >= selectedTerm.startDate && date <= selectedTerm.endDate;
    });
  }, [evaluationsList, generateClassId, generateTermId, termsFromApi]);

  const evaluationGroups = useMemo(() => {
    const groups = new Map<string, Evaluation[]>();
    generateEvaluations.forEach((evaluation) => {
      const subject = String(evaluation.subject || '').trim() || 'Matiere non renseignee';
      const group = groups.get(subject) ?? [];
      group.push(evaluation);
      groups.set(subject, group);
    });
    return Array.from(groups.entries()).map(([subject, evaluations]) => ({ subject, evaluations }));
  }, [generateEvaluations]);

  const isEvaluationValidated = (evaluation: Evaluation) =>
    evaluationValidationOverrides[evaluation.id] ?? evaluation.countInBulletin !== false;

  const missingGradeCount = (evaluation: Evaluation) => {
    const classStudents = generateStudents.filter((student) => student.classId === evaluation.classId);
    const gradedStudentIds = new Set(
      gradesList.filter((grade) => grade.evaluationId === evaluation.id).map((grade) => grade.studentId),
    );
    return Math.max(0, classStudents.length - classStudents.filter((student) => gradedStudentIds.has(student.id)).length);
  };

  const handleToggleEvaluation = async (evaluation: Evaluation) => {
    const nextValue = !isEvaluationValidated(evaluation);
    setValidationBusyId(evaluation.id);
    try {
      await apiFetch(`/api/evaluations/${evaluation.id}/bulletin-status`, {
        method: 'PUT',
        body: JSON.stringify({ countInBulletin: nextValue }),
      });
      setEvaluationValidationOverrides((previous) => ({ ...previous, [evaluation.id]: nextValue }));
    } catch (error: any) {
      generateHook.setError(error?.message || 'Impossible de modifier la validation de l evaluation.');
    } finally {
      setValidationBusyId(null);
    }
  };

  const setEvaluationsValidation = async (evaluations: Evaluation[], countInBulletin: boolean) => {
    if (evaluations.length === 0) return;
    setValidationBusyId(evaluations[0].id);
    try {
      await Promise.all(evaluations.map((evaluation) => apiFetch(`/api/evaluations/${evaluation.id}/bulletin-status`, {
        method: 'PUT',
        body: JSON.stringify({ countInBulletin }),
      })));
      setEvaluationValidationOverrides((previous) => {
        const next = { ...previous };
        evaluations.forEach((evaluation) => {
          next[evaluation.id] = countInBulletin;
        });
        return next;
      });
    } catch (error: any) {
      generateHook.setError(error?.message || 'Impossible de modifier la validation des evaluations.');
    } finally {
      setValidationBusyId(null);
    }
  };

  const selectedEvaluationCount = generateEvaluations.filter(isEvaluationValidated).length;

  useEffect(() => {
    if (!allEvaluationsCheckboxRef.current) return;
    allEvaluationsCheckboxRef.current.indeterminate = selectedEvaluationCount > 0
      && selectedEvaluationCount < generateEvaluations.length;
  }, [generateEvaluations.length, selectedEvaluationCount]);

  const suggestedParentStudentId = useMemo(() => {
    if (!isParent) return null;
    const parentName = String(simulated?.name || '').trim().toLowerCase();
    const parentEmail = String(simulated?.email || '').trim().toLowerCase();

    const byParentName = studentsList.find((s) => String(s.parentName || '').trim().toLowerCase() === parentName);
    if (byParentName) return byParentName.id;

    const byEmailHint = studentsList.find((s) => {
      const compactParentName = String(s.parentName || '').toLowerCase().replace(/\s+/g, '');
      return compactParentName && parentEmail.includes(compactParentName);
    });

    return byEmailHint?.id ?? null;
  }, [isParent, studentsList]);

  useEffect(() => {
    if (!canGenerate) return;

    if (generateClassId) {
      const classExists = generateClasses.some((klass) => String(klass.id) === generateClassId);
      if (!classExists) {
        setGenerateClassId('');
      }
    }

    if (generateStudentId) {
      const studentExists = generateStudents.some((student) => String(student.id) === generateStudentId);
      if (!studentExists) {
        setGenerateStudentId('');
      }
    }
  }, [canGenerate, generateClassId, generateClasses, generateStudentId, generateStudents]);

  useEffect(() => {
    if (canGenerate && termOptions.length > 0 && !generateTermId) {
      setGenerateTermId(String(termOptions[0].id));
    }
  }, [canGenerate, generateTermId, termOptions]);

  useEffect(() => {
    if (isParent && suggestedParentStudentId && !filters.studentId) {
      setFilters((prev) => ({ ...prev, studentId: suggestedParentStudentId }));
    }
  }, [filters.studentId, isParent, suggestedParentStudentId]);

  const listFilters = useMemo<BulletinListFilters>(() => ({
    page,
    pageSize,
    classId: filters.classId,
    studentId: filters.studentId,
    termId: filters.termId,
  }), [filters.classId, filters.studentId, filters.termId, page, pageSize]);

  const listHook = useBulletinsList({ enabled: canList, filters: listFilters });
  const detailHook = useBulletinDetail();
  const generateHook = useGenerateBulletin();
  const pdfHook = useDownloadBulletinPDF();

  const liveNotesForDetail = useMemo(() => {
    const detail = detailHook.detail;
    if (!detail) return [] as Array<{ id: string; subject: string; title: string; score: string; maxScore: number | null; date: string | null }>;

    const selectedTerm = termsFromApi.find((t) => t.id === detail.termId);
    const startDate = selectedTerm?.startDate ?? null;
    const endDate = selectedTerm?.endDate ?? null;

    const notes = evaluationsList
      .filter((ev) => {
        if (ev.classId !== detail.classId) return false;
        if (ev.countInBulletin === false) return false;

        if (ev.termId != null) return ev.termId === detail.termId;

        if (!startDate || !endDate || !ev.date) return false;
        const evalDate = String(ev.date).slice(0, 10);
        return evalDate >= startDate && evalDate <= endDate;
      })
      .map((ev) => {
        const grade = gradesList.find((g) => g.evaluationId === ev.id && g.studentId === detail.studentId);
        if (!grade) return null;

        return {
          id: `${ev.id}-${detail.studentId}`,
          subject: ev.subject,
          title: ev.title,
          score: String(grade.score ?? '-'),
          maxScore: ev.maxScore ?? null,
          date: ev.date ?? null,
        };
      })
      .filter((row): row is { id: string; subject: string; title: string; score: string; maxScore: number | null; date: string | null } => !!row)
      .sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));

    return notes;
  }, [detailHook.detail, evaluationsList, gradesList, termsFromApi]);

  const subjectBreakdownForDetail = useMemo(() => {
    const detail = detailHook.detail;
    if (!detail) return {} as Record<string, { interrogation: number | null; devoir: number | null; composition: number | null; average: number | null; classAverage: number | null }>;

    const selectedTerm = termsFromApi.find((t) => t.id === detail.termId);
    const startDate = selectedTerm?.startDate ?? null;
    const endDate = selectedTerm?.endDate ?? null;
    const relevantEvaluations = evaluationsList.filter((ev) => {
      if (ev.classId !== detail.classId) return false;
      if (ev.countInBulletin === false) return false;
      if (ev.termId != null) return ev.termId === detail.termId;
      if (!startDate || !endDate || !ev.date) return false;
      const evalDate = String(ev.date).slice(0, 10);
      return evalDate >= startDate && evalDate <= endDate;
    });

    const classStudentIds = studentsList
      .filter((student) => student.classId === detail.classId)
      .map((student) => student.id);

    const subjectMap = new Map<string, { groups: Record<'interrogation' | 'devoir' | 'composition', Array<{ coefficient: number; score: number }>>; subjectAverages: number[] }>();

    for (const subjectName of Array.from(new Set(relevantEvaluations.map((ev) => ev.subject.trim() || 'Matiere non renseignee')))) {
      const byType: Record<'interrogation' | 'devoir' | 'composition', Array<{ coefficient: number; score: number }>> = {
        interrogation: [],
        devoir: [],
        composition: [],
      };
      const subjectAverages: number[] = [];

      for (const ev of relevantEvaluations.filter((evaluation) => evaluation.subject === subjectName)) {
        const type = normalizeEvaluationType(ev.type);
        if (!type) continue;

        const scoreForStudent = gradesList.find((grade) => grade.evaluationId === ev.id && grade.studentId === detail.studentId);
        const rawScore = scoreForStudent ? parseNumericScore(scoreForStudent.score) : null;
        if (rawScore == null) continue;

        const normalizedScore = (rawScore / (ev.maxScore || 20)) * 20;
        byType[type].push({ coefficient: Number(ev.coefficient || 0), score: normalizedScore });
      }

      for (const studentId of classStudentIds) {
        const entries: Array<{ coefficient: number; score: number }> = [];
        for (const ev of relevantEvaluations.filter((evaluation) => evaluation.subject === subjectName)) {
          const grade = gradesList.find((g) => g.evaluationId === ev.id && g.studentId === studentId);
          const rawScore = grade ? parseNumericScore(grade.score) : null;
          if (rawScore == null) continue;
          const normalizedScore = (rawScore / (ev.maxScore || 20)) * 20;
          entries.push({ coefficient: Number(ev.coefficient || 0), score: normalizedScore });
        }
        const subjectAverage = computeWeightedAverage(entries);
        if (subjectAverage != null) subjectAverages.push(subjectAverage);
      }

      subjectMap.set(subjectName, {
        groups: byType,
        subjectAverages,
      });
    }

    const result: Record<string, { interrogation: number | null; devoir: number | null; composition: number | null; average: number | null; classAverage: number | null }> = {};
    for (const [subjectName, { groups, subjectAverages }] of subjectMap.entries()) {
      const allEntries = Array.from(new Set([
        ...groups.interrogation,
        ...groups.devoir,
        ...groups.composition,
      ]));
      const currentAverage = computeWeightedAverage(allEntries);
      const classAverage = subjectAverages.length > 0
        ? subjectAverages.reduce((sum, value) => sum + value, 0) / subjectAverages.length
        : null;
      result[subjectName] = {
        interrogation: computeWeightedAverage(groups.interrogation),
        devoir: computeWeightedAverage(groups.devoir),
        composition: computeWeightedAverage(groups.composition),
        average: currentAverage,
        classAverage,
      };
    }

    return result;
  }, [detailHook.detail, evaluationsList, gradesList, studentsList, termsFromApi]);

  useEffect(() => {
    if (listHook.error && isParent) {
      listHook.setError('Votre profil parent ne peut pas afficher la liste globale. Utilisez la consultation detaillee par ID autorise.');
    }
  }, [isParent, listHook.error]);

  const loadDetailAndMaybeCache = async (id: number) => {
    setSelectedId(id);
    const detail = await detailHook.loadDetail(id);
    if (!detail || !isParent) return;

    const uid = simulated?.uid;
    if (!uid) return;

    const nextItems = [toParentListItem(detail), ...parentKnownItems.filter((it) => it.id !== detail.id)].slice(0, 20);
    setParentKnownItems(nextItems);
    localStorage.setItem(parentCacheKey(uid), JSON.stringify(nextItems.map((it) => it.id)));
  };

  const loadParentCached = async () => {
    if (!isParent) return;

    const uid = simulated?.uid;
    if (!uid) return;

    const raw = localStorage.getItem(parentCacheKey(uid));
    if (!raw) {
      setParentKnownItems([]);
      return;
    }

    let ids: number[] = [];
    try {
      const parsed = JSON.parse(raw);
      ids = Array.isArray(parsed)
        ? parsed.map((value) => Number(value)).filter((value) => Number.isInteger(value) && value > 0)
        : [];
    } catch {
      ids = [];
    }

    if (ids.length === 0) {
      setParentKnownItems([]);
      return;
    }

    const loaded: BulletinListItem[] = [];
    for (const id of ids.slice(0, 20)) {
      try {
        const detail = await fetchBulletinDetail(id);
        loaded.push(toParentListItem(detail));
      } catch {
        // ignore inaccessible cache ids
      }
    }
    setParentKnownItems(loaded);
  };

  useEffect(() => {
    if (isParent) {
      loadParentCached();
    }
  }, [isParent]);

  const handleGenerateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const studentId = Number(generateStudentId);
    const termId = Number(generateTermId);

    if (!Number.isInteger(studentId) || studentId <= 0 || !Number.isInteger(termId) || termId <= 0) {
      generateHook.setError('Selectionnez un eleve et un trimestre valides.');
      return;
    }

    const created = await generateHook.run(studentId, termId);
    setLastGeneratedClassSummary([]);
    setLastGeneratedClassIds([]);
    await listHook.refresh();
    if (created?.id) {
      await loadDetailAndMaybeCache(Number(created.id));
    }
  };

  const handleGenerateClassSubmit = async () => {
    const classId = Number(generateClassId);
    const termId = Number(generateTermId);

    if (!Number.isInteger(classId) || classId <= 0) {
      generateHook.setError('Selectionnez une classe valide pour la generation en lot.');
      return;
    }

    if (!Number.isInteger(termId) || termId <= 0) {
      generateHook.setError('Selectionnez un trimestre valide pour la generation en lot.');
      return;
    }

    const classStudentIds = generateStudents
      .filter((student) => student.classId === classId)
      .map((student) => student.id);

    if (classStudentIds.length === 0) {
      generateHook.setError('Aucun eleve trouve dans cette classe.');
      return;
    }

    const createdList = await generateHook.runMany(classStudentIds, termId);

    setFilters((prev) => ({
      ...prev,
      classId,
      termId,
      studentId: undefined,
    }));
    setPage(1);
    setSelectedBatchIds([]);

    const createdIds = createdList
      .map((entry) => entry.id)
      .filter((id): id is number => Number.isInteger(id) && Number(id) > 0);

    const className = classesList.find((klass) => klass.id === classId)?.name || `Classe ${classId}`;
    const termName = termOptions.find((term) => term.id === termId)?.name || `Trimestre ${termId}`;
    const summary = createdList
      .map((entry) => {
        const id = Number(entry.id);
        if (!Number.isInteger(id) || id <= 0) return null;
        const student = studentsList.find((s) => s.id === entry.studentId);
        return {
          id,
          studentName: student ? `${student.lastName} ${student.firstName}`.trim() : `Eleve ${entry.studentId}`,
          className,
          termName,
        };
      })
      .filter((item): item is { id: number; studentName: string; className: string; termName: string } => !!item);

    setLastGeneratedClassSummary(summary);
    setLastGeneratedClassIds(summary.map((item) => item.id));
    setSelectedBatchIds(summary.map((item) => item.id));
    setSelectedId(null);

    await listHook.refresh({
      page: 1,
      pageSize,
      classId,
      termId,
      studentId: undefined,
    });
  };

  const handleParentLookupSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const id = Number(lookupIdInput);
    if (!Number.isInteger(id) || id <= 0) {
      detailHook.setError('Entrez un identifiant de bulletin valide.');
      return;
    }
    await loadDetailAndMaybeCache(id);
  };

  const handleDownloadPdf = async () => {
    if (!selectedId) return;
    await pdfHook.run(selectedId);
  };

  const handleDownloadBatch = async () => {
    if (selectedBatchIds.length === 0) return;
    await pdfHook.runMany(selectedBatchIds);
  };

  const renderedItems = canList
    ? (isTeacher
      ? listHook.items.filter((item) => teacherClassIds.includes(item.classId) && visibleStudentIds.has(item.studentId))
      : listHook.items)
    : parentKnownItems;
  const total = canList ? listHook.total : parentKnownItems.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="space-y-6" id="bulletins-view">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">Bulletins scolaires</h2>
          <p className="text-sm text-slate-500">Liste, detail et telechargement PDF via APIs backend existantes.</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleDownloadBatch}
            disabled={pdfHook.loading || selectedBatchIds.length === 0}
            className="text-xs px-3 py-2 rounded-xl border border-indigo-200 text-indigo-700 bg-indigo-50 hover:bg-indigo-100 disabled:opacity-50"
          >
            {pdfHook.loading ? 'Telechargement...' : `Telecharger la selection (${selectedBatchIds.length})`}
          </button>
          <div className="flex items-center gap-2 text-xs text-emerald-700 bg-emerald-50 border border-emerald-100 px-3 py-2 rounded-xl">
            <ShieldCheck className="h-4 w-4" />
            <span>Securise par role et ownership</span>
          </div>
        </div>
      </div>

      <BulletinActions
        canGenerate={canGenerate}
        isParent={isParent}
        schoolsList={generateSchools}
        classesList={generateClasses}
        studentsList={generateStudents}
        termOptions={termOptions}
        generateSchoolId={generateSchoolId}
        generateClassId={generateClassId}
        generateStudentId={generateStudentId}
        generateTermId={generateTermId}
        lookupIdInput={lookupIdInput}
        isGenerateLoading={generateHook.loading}
        generateError={generateHook.error}
        generateSuccess={generateHook.success}
        canGenerateClassBulk={Boolean(generateClassId) && Boolean(generateTermId) && generateStudents.some((student) => String(student.classId) === generateClassId)}
        generateClassStudentsCount={generateStudents.filter((student) => String(student.classId) === generateClassId).length}
        onGenerateSchoolChange={(value) => {
          setGenerateSchoolId(value);
          setGenerateClassId('');
          setGenerateStudentId('');
        }}
        onGenerateClassChange={(value) => {
          setGenerateClassId(value);
          setGenerateStudentId('');
        }}
        onGenerateStudentChange={setGenerateStudentId}
        onGenerateTermChange={setGenerateTermId}
        onGenerateClassSubmit={handleGenerateClassSubmit}
        onLookupIdInputChange={setLookupIdInput}
        onGenerateSubmit={handleGenerateSubmit}
        onParentLookupSubmit={handleParentLookupSubmit}
        onReloadParentKnown={loadParentCached}
      />

      {canGenerate && generateEvaluations.length > 0 && (
        <section className="bg-white border border-slate-100 rounded-2xl p-4 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-slate-700">Evaluations a prendre en compte</h3>
              <p className="text-xs text-slate-500">La validation s applique a toute la classe selectionnee.</p>
            </div>
            <label className="flex items-center gap-2 text-xs font-semibold text-indigo-700">
              <input
                ref={allEvaluationsCheckboxRef}
                type="checkbox"
                checked={selectedEvaluationCount === generateEvaluations.length}
                disabled={validationBusyId != null}
                onChange={() => setEvaluationsValidation(generateEvaluations, selectedEvaluationCount !== generateEvaluations.length)}
              />
              Toutes les evaluations
            </label>
          </div>
          <div className="space-y-2">
            {evaluationGroups.map(({ subject, evaluations }) => {
              const selectedCount = evaluations.filter(isEvaluationValidated).length;
              const isOpen = openEvaluationSubjects[subject] ?? true;
              const allSelected = selectedCount === evaluations.length;
              return (
                <div key={subject} className="rounded-xl border border-slate-200 overflow-hidden">
                  <div className="flex items-center justify-between gap-3 bg-slate-50 px-3 py-2">
                    <button
                      type="button"
                      onClick={() => setOpenEvaluationSubjects((previous) => ({ ...previous, [subject]: !isOpen }))}
                      className="flex min-w-0 items-center gap-2 text-left text-sm font-semibold text-slate-700"
                      aria-expanded={isOpen}
                    >
                      <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${isOpen ? '' : '-rotate-90'}`} />
                      <span className="truncate">{subject}</span>
                    </button>
                    <span className="shrink-0 text-xs font-semibold text-slate-500">
                      {selectedCount}/{evaluations.length} selectionnees
                    </span>
                  </div>
                  {isOpen && (
                    <div className="space-y-2 p-2">
                      <div className="flex flex-wrap gap-2 px-1">
                        <button
                          type="button"
                          disabled={allSelected || validationBusyId != null}
                          onClick={() => setEvaluationsValidation(evaluations, true)}
                          className="rounded-lg border border-emerald-200 px-2 py-1 text-[11px] font-semibold text-emerald-700 disabled:opacity-50"
                        >
                          Tout selectionner
                        </button>
                        <button
                          type="button"
                          disabled={selectedCount === 0 || validationBusyId != null}
                          onClick={() => setEvaluationsValidation(evaluations, false)}
                          className="rounded-lg border border-slate-200 px-2 py-1 text-[11px] font-semibold text-slate-600 disabled:opacity-50"
                        >
                          Tout deselectionner
                        </button>
                      </div>
                      {evaluations.map((evaluation) => {
                        const validated = isEvaluationValidated(evaluation);
                        const missing = missingGradeCount(evaluation);
                        const gradeCount = gradesList.filter((grade) => grade.evaluationId === evaluation.id).length;
                        const classStudentCount = generateStudents.filter((student) => student.classId === evaluation.classId).length;
                        return (
                          <label key={evaluation.id} className="flex items-start gap-3 rounded-lg border border-slate-100 p-2 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={validated}
                              disabled={validationBusyId != null}
                              onChange={() => handleToggleEvaluation(evaluation)}
                              className="mt-1"
                            />
                            <span className="min-w-0 text-sm text-slate-700">
                              <span className="block font-semibold">{evaluation.title || 'Evaluation sans titre'}</span>
                              <span className="block text-xs text-slate-500">{evaluation.date} · Coef. {evaluation.coefficient}</span>
                              <span className={`block text-xs ${missing > 0 ? 'text-amber-700' : 'text-emerald-700'}`}>
                                {gradeCount}/{classStudentCount} notes{missing > 0 ? ` · ${missing} manquante(s)` : ''}
                              </span>
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {generateSchoolId && (schoolScopedClassesLoading || schoolScopedClassesError) && (
        <p className="text-xs text-slate-500">
          {schoolScopedClassesLoading ? 'Chargement des classes de l ecole...' : schoolScopedClassesError}
        </p>
      )}

      {lastGeneratedClassSummary.length > 0 && (
        <section className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4 space-y-2">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm font-semibold text-emerald-800">
              Generation de classe terminee: {lastGeneratedClassSummary.length} bulletin(s) cree(s).
            </p>
            <button
              type="button"
              onClick={() => pdfHook.runMany(lastGeneratedClassIds)}
              disabled={pdfHook.loading || lastGeneratedClassIds.length === 0}
              className="text-xs px-3 py-2 rounded-xl border border-emerald-300 text-emerald-800 bg-white hover:bg-emerald-100 disabled:opacity-50"
            >
              {pdfHook.loading ? 'Telechargement...' : `Telecharger les ${lastGeneratedClassIds.length} bulletins`}
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
            {lastGeneratedClassSummary.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => loadDetailAndMaybeCache(item.id)}
                className="text-left rounded-xl border border-emerald-200 bg-white/90 hover:bg-white px-3 py-2"
              >
                <p className="text-sm font-semibold text-slate-800">{item.studentName}</p>
                <p className="text-xs text-slate-600">{item.className} • {item.termName}</p>
                <p className="text-[11px] text-emerald-700">Bulletin ID {item.id}</p>
              </button>
            ))}
          </div>
        </section>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        <BulletinsList
          canList={canList}
          loading={listHook.loading}
          error={listHook.error}
          items={renderedItems}
          total={total}
          page={page}
          totalPages={totalPages}
          selectedId={selectedId}
          visibleClasses={visibleClasses}
          visibleStudents={visibleStudents}
          termOptions={termOptions}
          filters={filters}
          onRefresh={() => {
            setLastGeneratedClassSummary([]);
            setLastGeneratedClassIds([]);
            listHook.refresh();
          }}
          onSelect={loadDetailAndMaybeCache}
          onPrevPage={() => setPage((prev) => Math.max(1, prev - 1))}
          onNextPage={() => setPage((prev) => Math.min(totalPages, prev + 1))}
          onResetFilters={() => {
            setLastGeneratedClassSummary([]);
            setLastGeneratedClassIds([]);
            setFilters({});
            setPage(1);
          }}
          onFilterClassChange={(value) => {
            setLastGeneratedClassSummary([]);
            setLastGeneratedClassIds([]);
            setFilters((prev) => ({ ...prev, classId: value ? Number(value) : undefined, studentId: undefined }));
            setPage(1);
          }}
          onFilterStudentChange={(value) => {
            setLastGeneratedClassSummary([]);
            setLastGeneratedClassIds([]);
            setFilters((prev) => ({ ...prev, studentId: value ? Number(value) : undefined }));
            setPage(1);
          }}
          onFilterTermChange={(value) => {
            setLastGeneratedClassSummary([]);
            setLastGeneratedClassIds([]);
            setFilters((prev) => ({ ...prev, termId: value ? Number(value) : undefined }));
            setPage(1);
          }}
          selectedForBatchIds={selectedBatchIds}
          onToggleBatchSelection={(id, checked) => {
            setSelectedBatchIds((prev) => {
              if (checked) return prev.includes(id) ? prev : [...prev, id];
              return prev.filter((value) => value !== id);
            });
          }}
          onToggleSelectAllVisible={(checked) => {
            setSelectedBatchIds((prev) => {
              const visibleIds = renderedItems.map((item) => item.id);
              if (checked) {
                return Array.from(new Set([...prev, ...visibleIds]));
              }
              return prev.filter((id) => !visibleIds.includes(id));
            });
          }}
        />

        <BulletinDetailView
          detail={detailHook.detail}
          loading={detailHook.loading}
          error={detailHook.error || pdfHook.error}
          selectedId={selectedId}
          liveNotes={liveNotesForDetail}
          subjectBreakdown={subjectBreakdownForDetail}
          pdfLoading={pdfHook.loading}
          onDownloadPdf={handleDownloadPdf}
        />
      </div>
    </div>
  );
}
