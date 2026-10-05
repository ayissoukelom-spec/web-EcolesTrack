import React, { useEffect, useMemo, useState } from 'react';
import { AlertCircle, LoaderCircle, Trophy } from 'lucide-react';
import type { Class, School, UserRole } from '../types.ts';
import { apiFetch, getUiErrorMessage } from '../lib/api.ts';
import { useAuth } from '../contexts/AuthContext.tsx';

interface ClassResultsViewProps {
  schoolsList: School[];
  currentSchoolId?: number | null;
}

interface ResultClass extends Class {
  yearName?: string;
}

interface ResultPeriod {
  id: number;
  name: string;
  periodType?: string | null;
  orderIndex?: number;
}

interface ClassResultStudent {
  studentId: number;
  firstName: string;
  lastName: string;
  average: number | null;
  rank: number | null;
}

interface ClassRankingResponse {
  school: { id: number; name: string };
  class: { id: number; name: string };
  period: { id: number; name: string; periodType: string | null };
  students: ClassResultStudent[];
}

const rankLabel = (rank: number | null): string => {
  if (rank == null) return '—';
  return rank === 1 ? '1er' : `${rank}e`;
};

const formatAverage = (average: number | null): string => (
  average == null ? '—' : average.toFixed(2).replace('.', ',')
);

export default function ClassResultsView({ schoolsList, currentSchoolId }: ClassResultsViewProps) {
  const { role } = useAuth();
  const currentRole = role as UserRole;
  const [schoolId, setSchoolId] = useState(
    currentRole === 'school_admin' && currentSchoolId != null ? String(currentSchoolId) : '',
  );
  const [classes, setClasses] = useState<ResultClass[]>([]);
  const [classId, setClassId] = useState('');
  const [periods, setPeriods] = useState<ResultPeriod[]>([]);
  const [periodId, setPeriodId] = useState('');
  const [ranking, setRanking] = useState<ClassRankingResponse | null>(null);
  const [classesLoading, setClassesLoading] = useState(false);
  const [periodsLoading, setPeriodsLoading] = useState(false);
  const [resultsLoading, setResultsLoading] = useState(false);
  const [classesError, setClassesError] = useState<string | null>(null);
  const [periodsError, setPeriodsError] = useState<string | null>(null);
  const [resultsError, setResultsError] = useState<string | null>(null);

  useEffect(() => {
    if (currentRole === 'school_admin' && currentSchoolId != null) {
      setSchoolId(String(currentSchoolId));
    } else if (currentRole === 'super_admin') {
      setSchoolId('');
    }
    setClassId('');
    setPeriodId('');
    setRanking(null);
  }, [currentRole, currentSchoolId]);

  useEffect(() => {
    let cancelled = false;
    setClasses([]);
    setClassId('');
    setPeriods([]);
    setPeriodId('');
    setRanking(null);
    setClassesError(null);

    if (!schoolId) {
      setClassesLoading(false);
      return () => { cancelled = true; };
    }

    setClassesLoading(true);
    apiFetch(`/api/classes?schoolId=${encodeURIComponent(schoolId)}&approvedOnly=true`)
      .then((payload) => {
        if (cancelled) return;
        setClasses(Array.isArray(payload) ? payload as ResultClass[] : []);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setClasses([]);
        setClassesError(getUiErrorMessage(error, 'Impossible de charger les classes.'));
      })
      .finally(() => {
        if (!cancelled) setClassesLoading(false);
      });

    return () => { cancelled = true; };
  }, [schoolId]);

  const selectedClass = useMemo(
    () => classes.find((item) => String(item.id) === classId) ?? null,
    [classes, classId],
  );

  useEffect(() => {
    let cancelled = false;
    setPeriods([]);
    setPeriodId('');
    setRanking(null);
    setPeriodsError(null);

    if (!schoolId || !selectedClass) {
      setPeriodsLoading(false);
      return () => { cancelled = true; };
    }

    setPeriodsLoading(true);
    const params = new URLSearchParams({
      schoolId,
      classId: String(selectedClass.id),
      academicYearId: String(selectedClass.academicYearId),
      availableOnly: 'true',
    });
    apiFetch(`/api/school-terms?${params.toString()}`)
      .then((payload) => {
        if (cancelled) return;
        const availablePeriods = Array.isArray(payload) ? payload as ResultPeriod[] : [];
        setPeriods(availablePeriods);
        setPeriodId(availablePeriods.length > 0 ? String(availablePeriods[0].id) : '');
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setPeriods([]);
        setPeriodsError(getUiErrorMessage(error, 'Impossible de charger les périodes.'));
      })
      .finally(() => {
        if (!cancelled) setPeriodsLoading(false);
      });

    return () => { cancelled = true; };
  }, [schoolId, selectedClass]);

  useEffect(() => {
    let cancelled = false;
    setRanking(null);
    setResultsError(null);

    if (!schoolId || !classId || !periodId) {
      setResultsLoading(false);
      return () => { cancelled = true; };
    }

    setResultsLoading(true);
    const params = new URLSearchParams({ schoolId, classId, periodId });
    apiFetch(`/api/results/class-ranking?${params.toString()}`)
      .then((payload) => {
        if (cancelled) return;
        setRanking(payload as ClassRankingResponse);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setRanking(null);
        setResultsError(getUiErrorMessage(error, 'Impossible de charger les résultats.'));
      })
      .finally(() => {
        if (!cancelled) setResultsLoading(false);
      });

    return () => { cancelled = true; };
  }, [schoolId, classId, periodId]);

  const selectedSchool = schoolsList.find((school) => String(school.id) === schoolId);
  const hasAnyAverage = ranking?.students.some((student) => student.average != null) ?? false;

  return (
    <section className="space-y-6" aria-labelledby="class-results-heading">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 id="class-results-heading" className="text-xl font-bold text-slate-900 sm:text-2xl">Résultats / Proclamation</h1>
          <p className="mt-1 text-sm text-slate-500">Classement officiel calculé à partir des notes de la période sélectionnée.</p>
        </div>
        <Trophy className="hidden h-8 w-8 text-indigo-600 sm:block" aria-hidden="true" />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {currentRole === 'super_admin' ? (
          <label className="space-y-1.5 text-sm font-semibold text-slate-700">
            École
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
            École
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 font-normal">
              {selectedSchool?.name ?? 'École active'}
            </div>
          </div>
        )}

        <label className="space-y-1.5 text-sm font-semibold text-slate-700">
          Classe
          <select
            value={classId}
            onChange={(event) => setClassId(event.target.value)}
            disabled={!schoolId || classesLoading || classes.length === 0}
            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 font-normal outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 disabled:bg-slate-50"
          >
            <option value="">Sélectionner une classe</option>
            {classes.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </label>

        <label className="space-y-1.5 text-sm font-semibold text-slate-700 md:col-span-2">
          Période
          <select
            value={periodId}
            onChange={(event) => setPeriodId(event.target.value)}
            disabled={!classId || periodsLoading || periods.length === 0}
            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 font-normal outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 disabled:bg-slate-50"
          >
            <option value="">Sélectionner une période</option>
            {periods.map((period) => <option key={period.id} value={period.id}>{period.name}</option>)}
          </select>
        </label>
      </div>

      {classesLoading && <LoadingMessage label="Chargement des classes…" />}
      {currentRole === 'super_admin' && schoolId === '' && schoolsList.length === 0 && (
        <InfoMessage>Aucune école disponible dans votre périmètre.</InfoMessage>
      )}
      {!schoolId && currentRole === 'super_admin' && (
        schoolsList.length > 0 && <InfoMessage>Choisissez une école pour afficher les classes de son périmètre.</InfoMessage>
      )}
      {schoolId && !classesLoading && !classesError && classes.length === 0 && (
        <InfoMessage>Aucune classe disponible pour cette école.</InfoMessage>
      )}
      {classesError && <ErrorMessage message={classesError} />}

      {periodsLoading && <LoadingMessage label="Chargement des périodes…" />}
      {selectedClass && !periodsLoading && !periodsError && periods.length === 0 && (
        <InfoMessage>Aucune période disponible pour cette classe et son année scolaire.</InfoMessage>
      )}
      {periodsError && <ErrorMessage message={periodsError} />}

      {resultsLoading && <LoadingMessage label="Calcul du classement…" />}
      {resultsError && <ErrorMessage message={resultsError} />}
      {ranking && !resultsLoading && (
        <div className="space-y-4">
          <div className="rounded-xl bg-indigo-50 px-4 py-3 text-sm text-indigo-900">
            <span className="font-semibold">{ranking.class.name}</span>
            <span className="mx-2 text-indigo-300">·</span>
            <span>{ranking.period.name}</span>
          </div>
          {ranking.students.length === 0 ? (
            <InfoMessage>Cette classe ne contient aucun élève actif.</InfoMessage>
          ) : (
            <>
              {!hasAnyAverage && (
                <InfoMessage>Aucune donnée de note exploitable pour cette période. Les élèves restent affichés sans rang.</InfoMessage>
              )}
              <div className="overflow-x-auto rounded-xl border border-slate-200">
                <table className="w-full min-w-[520px] border-collapse text-left text-sm">
                  <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th scope="col" className="px-4 py-3 font-semibold">Rang</th>
                      <th scope="col" className="px-4 py-3 font-semibold">Élève</th>
                      <th scope="col" className="px-4 py-3 text-right font-semibold">Moyenne générale</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {ranking.students.map((student) => (
                      <tr key={student.studentId} className="bg-white hover:bg-slate-50/70">
                        <td className="whitespace-nowrap px-4 py-3 font-semibold text-indigo-700">{rankLabel(student.rank)}</td>
                        <td className="px-4 py-3 font-medium text-slate-800">{student.lastName} {student.firstName}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-slate-700">{formatAverage(student.average)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}

function LoadingMessage({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 rounded-xl border border-slate-100 bg-slate-50 p-4 text-sm text-slate-600" role="status">
      <LoaderCircle className="h-4 w-4 animate-spin text-indigo-600" aria-hidden="true" />
      {label}
    </div>
  );
}

function InfoMessage({ children }: { children: React.ReactNode }) {
  return <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">{children}</div>;
}

function ErrorMessage({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700" role="alert">
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      {message}
    </div>
  );
}
