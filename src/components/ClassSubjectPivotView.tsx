import React, { useEffect, useMemo, useState } from 'react';
import { AlertCircle, LoaderCircle, Table2 } from 'lucide-react';
import type { School, UserRole } from '../types.ts';
import { apiFetch, getUiErrorMessage } from '../lib/api.ts';
import { useAuth } from '../contexts/AuthContext.tsx';

interface ClassOption {
  id: number;
  name: string;
  academicYearId: number;
  yearName?: string | null;
}

interface PeriodOption {
  id: number;
  name: string;
  periodType?: string | null;
  orderIndex?: number;
}

interface PivotClass {
  id: number;
  name: string;
  levelId: number | null;
  levelName: string | null;
}

interface PivotSubject {
  id: number;
  name: string;
}

interface PivotCell {
  classId: number;
  subjectId: number;
  average: number | null;
  studentsWithResult: number;
  studentsWithoutResult: number;
}

interface ClassSubjectPivotResponse {
  school: { id: number; name: string };
  academicYear: { id: number; name: string | null };
  period: { id: number; name: string; periodType: string | null };
  classes: PivotClass[];
  subjects: PivotSubject[];
  cells: PivotCell[];
}

interface ClassSubjectPivotViewProps {
  schoolsList: School[];
  currentSchoolId?: number | null;
}

const formatAverage = (average: number | null): string => (
  average == null ? '—' : average.toFixed(2).replace('.', ',')
);

export default function ClassSubjectPivotView({
  schoolsList,
  currentSchoolId,
}: ClassSubjectPivotViewProps) {
  const { role } = useAuth();
  const currentRole = role as UserRole;
  const [schoolId, setSchoolId] = useState(
    currentRole === 'school_admin' && currentSchoolId != null ? String(currentSchoolId) : '',
  );
  const [classOptions, setClassOptions] = useState<ClassOption[]>([]);
  const [academicYearId, setAcademicYearId] = useState('');
  const [periods, setPeriods] = useState<PeriodOption[]>([]);
  const [periodId, setPeriodId] = useState('');
  const [pivot, setPivot] = useState<ClassSubjectPivotResponse | null>(null);
  const [selectedLevelId, setSelectedLevelId] = useState('');
  const [selectedClassId, setSelectedClassId] = useState('');
  const [selectedSubjectId, setSelectedSubjectId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filtersLoading, setFiltersLoading] = useState(false);

  useEffect(() => {
    if (currentRole === 'school_admin' && currentSchoolId != null) {
      setSchoolId(String(currentSchoolId));
    } else if (currentRole === 'super_admin') {
      setSchoolId('');
    }
    setAcademicYearId('');
    setPeriodId('');
    setPivot(null);
  }, [currentRole, currentSchoolId]);

  useEffect(() => {
    let cancelled = false;
    setClassOptions([]);
    setAcademicYearId('');
    setPeriods([]);
    setPeriodId('');
    setPivot(null);
    setError(null);

    if (!schoolId) {
      setFiltersLoading(false);
      return () => { cancelled = true; };
    }

    setFiltersLoading(true);
    apiFetch(`/api/classes?schoolId=${encodeURIComponent(schoolId)}&approvedOnly=true`)
      .then((payload) => {
        if (cancelled) return;
        const rows = Array.isArray(payload) ? payload as ClassOption[] : [];
        setClassOptions(rows);
        const availableYears = Array.from(new Map(
          rows.map((item) => [item.academicYearId, item]),
        ).values());
        setAcademicYearId(availableYears.length > 0 ? String(availableYears[0].academicYearId) : '');
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setClassOptions([]);
        setError(getUiErrorMessage(cause, 'Impossible de charger les classes.'));
      })
      .finally(() => {
        if (!cancelled) setFiltersLoading(false);
      });

    return () => { cancelled = true; };
  }, [schoolId]);

  const academicYears = useMemo(() => Array.from(new Map(
    classOptions.map((item) => [item.academicYearId, {
      id: item.academicYearId,
      name: item.yearName || `Année ${item.academicYearId}`,
    }]),
  ).values()), [classOptions]);

  useEffect(() => {
    let cancelled = false;
    setPeriods([]);
    setPeriodId('');
    setPivot(null);
    setSelectedLevelId('');
    setSelectedClassId('');
    setSelectedSubjectId('');
    setError(null);

    if (!schoolId || !academicYearId) {
      return () => { cancelled = true; };
    }

    setFiltersLoading(true);
    const params = new URLSearchParams({
      schoolId,
      academicYearId,
      availableOnly: 'true',
    });
    apiFetch(`/api/school-terms?${params.toString()}`)
      .then((payload) => {
        if (cancelled) return;
        const availablePeriods = Array.isArray(payload) ? payload as PeriodOption[] : [];
        setPeriods(availablePeriods);
        setPeriodId(availablePeriods.length > 0 ? String(availablePeriods[0].id) : '');
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setPeriods([]);
        setError(getUiErrorMessage(cause, 'Impossible de charger les périodes.'));
      })
      .finally(() => {
        if (!cancelled) setFiltersLoading(false);
      });

    return () => { cancelled = true; };
  }, [schoolId, academicYearId]);

  useEffect(() => {
    let cancelled = false;
    setPivot(null);
    setError(null);

    if (!schoolId || !academicYearId || !periodId) {
      setLoading(false);
      return () => { cancelled = true; };
    }

    setLoading(true);
    const params = new URLSearchParams({ schoolId, academicYearId, periodId });
    apiFetch(`/api/results/class-subject-pivot?${params.toString()}`)
      .then((payload) => {
        if (!cancelled) setPivot(payload as ClassSubjectPivotResponse);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setPivot(null);
        setError(getUiErrorMessage(cause, 'Impossible de charger les résultats par classe et matière.'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [schoolId, academicYearId, periodId]);

  const availableClasses = useMemo(
    () => (pivot?.classes ?? []).filter((item) => !selectedLevelId || String(item.levelId) === selectedLevelId),
    [pivot, selectedLevelId],
  );
  const availableLevels = useMemo(() => {
    const levelsById = new Map<number, string>();
    for (const item of pivot?.classes ?? []) {
      if (item.levelId != null && item.levelName) levelsById.set(item.levelId, item.levelName);
    }
    return Array.from(levelsById, ([id, name]) => ({ id, name }));
  }, [pivot]);
  const visibleClasses = useMemo(
    () => availableClasses.filter((item) => !selectedClassId || String(item.id) === selectedClassId),
    [availableClasses, selectedClassId],
  );
  const visibleSubjects = useMemo(
    () => (pivot?.subjects ?? []).filter((item) => !selectedSubjectId || String(item.id) === selectedSubjectId),
    [pivot, selectedSubjectId],
  );
  const cellsByKey = useMemo(
    () => new Map((pivot?.cells ?? []).map((cell) => [`${cell.classId}:${cell.subjectId}`, cell])),
    [pivot],
  );
  const selectedSchool = schoolsList.find((school) => String(school.id) === schoolId);

  return (
    <section className="space-y-6" aria-labelledby="class-subject-pivot-heading">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 id="class-subject-pivot-heading" className="text-xl font-bold text-slate-900 sm:text-2xl">
            Résultats par classe et matière
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Moyennes des résultats officiels individuels, calculées à partir des notes courantes.
          </p>
        </div>
        <Table2 className="hidden h-8 w-8 text-indigo-600 sm:block" aria-hidden="true" />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {currentRole === 'super_admin' ? (
          <label className="space-y-1.5 text-sm font-semibold text-slate-700">
            Établissement
            <select
              value={schoolId}
              onChange={(event) => setSchoolId(event.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 font-normal outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
            >
              <option value="">Sélectionner une école</option>
              {schoolsList.map((school) => <option key={school.id} value={school.id}>{school.name}</option>)}
            </select>
          </label>
        ) : (
          <div className="space-y-1.5 text-sm font-semibold text-slate-700">
            Établissement
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 font-normal">
              {selectedSchool?.name ?? 'École active'}
            </div>
          </div>
        )}

        <label className="space-y-1.5 text-sm font-semibold text-slate-700">
          Année scolaire
          <select
            value={academicYearId}
            onChange={(event) => setAcademicYearId(event.target.value)}
            disabled={!schoolId || filtersLoading || academicYears.length === 0}
            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 font-normal outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 disabled:bg-slate-50"
          >
            <option value="">Sélectionner une année</option>
            {academicYears.map((year) => <option key={year.id} value={year.id}>{year.name}</option>)}
          </select>
        </label>

        <label className="space-y-1.5 text-sm font-semibold text-slate-700">
          Période
          <select
            value={periodId}
            onChange={(event) => setPeriodId(event.target.value)}
            disabled={!academicYearId || filtersLoading || periods.length === 0}
            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 font-normal outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 disabled:bg-slate-50"
          >
            <option value="">Sélectionner une période</option>
            {periods.map((period) => <option key={period.id} value={period.id}>{period.name}</option>)}
          </select>
        </label>

        <label className="space-y-1.5 text-sm font-semibold text-slate-700">
          Niveau
          <select
            value={selectedLevelId}
            onChange={(event) => {
              setSelectedLevelId(event.target.value);
              setSelectedClassId('');
            }}
            disabled={!pivot || availableLevels.length === 0}
            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 font-normal outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 disabled:bg-slate-50"
          >
            <option value="">Tous les niveaux</option>
            {availableLevels.map((level) => <option key={level.id} value={level.id}>{level.name}</option>)}
          </select>
        </label>

        <label className="space-y-1.5 text-sm font-semibold text-slate-700">
          Classe
          <select
            value={selectedClassId}
            onChange={(event) => setSelectedClassId(event.target.value)}
            disabled={!pivot || availableClasses.length === 0}
            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 font-normal outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 disabled:bg-slate-50"
          >
            <option value="">Toutes les classes</option>
            {availableClasses.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </label>

        <label className="space-y-1.5 text-sm font-semibold text-slate-700">
          Matière
          <select
            value={selectedSubjectId}
            onChange={(event) => setSelectedSubjectId(event.target.value)}
            disabled={!pivot || pivot.subjects.length === 0}
            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 font-normal outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 disabled:bg-slate-50"
          >
            <option value="">Toutes les matières</option>
            {pivot?.subjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.name}</option>)}
          </select>
        </label>
      </div>

      {error && (
        <div role="alert" className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          {error}
        </div>
      )}

      {loading && (
        <div role="status" className="flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white p-8 text-sm text-slate-500">
          <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
          Calcul des résultats officiels...
        </div>
      )}

      {!loading && pivot && visibleClasses.length > 0 && visibleSubjects.length > 0 && (
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
          <table className="min-w-full border-collapse text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th scope="col" className="sticky left-0 z-10 min-w-48 border-b border-r border-slate-200 bg-slate-50 px-4 py-3">
                  Classe
                </th>
                {visibleSubjects.map((subject) => (
                  <th scope="col" key={subject.id} className="min-w-44 border-b border-slate-200 px-4 py-3">
                    {subject.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {visibleClasses.map((classItem) => (
                <tr key={classItem.id} className="align-top">
                  <th scope="row" className="sticky left-0 z-10 border-r border-slate-200 bg-white px-4 py-3 font-semibold text-slate-800">
                    <span className="block">{classItem.name}</span>
                    {classItem.levelName && <span className="mt-0.5 block text-xs font-normal text-slate-500">{classItem.levelName}</span>}
                  </th>
                  {visibleSubjects.map((subject) => {
                    const cell = cellsByKey.get(`${classItem.id}:${subject.id}`);
                    return (
                      <td key={subject.id} className="px-4 py-3 text-slate-700">
                        <div className="font-semibold">{formatAverage(cell?.average ?? null)}</div>
                        <div className="mt-1 text-xs text-slate-500">
                          Avec résultat : {cell?.studentsWithResult ?? 0}
                        </div>
                        <div className="text-xs text-slate-500">
                          Sans résultat : {cell?.studentsWithoutResult ?? 0}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!loading && pivot && (visibleClasses.length === 0 || visibleSubjects.length === 0) && (
        <div className="rounded-xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-500">
          Aucun résultat exploitable n’est disponible pour cette sélection.
        </div>
      )}
    </section>
  );
}
