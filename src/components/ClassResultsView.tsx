import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, Download, LoaderCircle, Trophy } from 'lucide-react';
import type { Class, School, UserRole } from '../types.ts';
import { apiFetch, getUiErrorMessage } from '../lib/api.ts';
import { buildClassRankingExcel, classRankingExcelFilename } from '../lib/classRankingExcel.ts';
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
  matricule?: string | null;
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

interface AvailableEvaluation {
  id: number;
  subjectId: number | null;
  subject: string;
  title: string;
  type: 'interrogation' | 'devoir' | 'evaluation_mensuelle' | 'composition' | null;
  coefficient: number;
  maxScore: number;
  countInBulletin: boolean;
  date: string;
}

interface CustomSubjectAverage {
  subjectId: number | null;
  subjectName: string;
  average: number | null;
}

interface CustomClassResult {
  studentId: number;
  matricule: string | null;
  firstName: string;
  lastName: string;
  subjectAverages: CustomSubjectAverage[];
  missingSubjects: string[];
  missingEvaluations: string[];
  average: number | null;
  rank: number | null;
}

interface CustomRankingResponse {
  school: { id: number; name: string };
  class: { id: number; name: string };
  period: { id: number; name: string; periodType: string | null };
  evaluations: AvailableEvaluation[];
  rankedStudentCount: number;
  calculatedAt: string;
  students: CustomClassResult[];
}

const rankLabel = (rank: number | null): string => {
  if (rank == null) return '—';
  return rank === 1 ? '1er' : `${rank}e`;
};

const formatAverage = (average: number | null): string => (
  average == null ? '—' : average.toFixed(2).replace('.', ',')
);

const normalizeSubjectName = (name: string): string => name.trim()
  .toLocaleLowerCase('fr')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '');

const subjectKey = (evaluation: Pick<AvailableEvaluation, 'subjectId' | 'subject'>): string => (
  evaluation.subjectId != null ? `id:${evaluation.subjectId}` : `name:${normalizeSubjectName(evaluation.subject)}`
);

const customSubjectKey = (subject: Pick<CustomSubjectAverage, 'subjectId' | 'subjectName'>): string => (
  subject.subjectId != null ? `id:${subject.subjectId}` : `name:${normalizeSubjectName(subject.subjectName)}`
);

const evaluationTypeLabel = (type: AvailableEvaluation['type']): string => {
  if (type === 'evaluation_mensuelle') return 'Évaluation mensuelle';
  if (type === 'interrogation') return 'Interrogation';
  if (type === 'devoir') return 'Devoir';
  if (type === 'composition') return 'Composition';
  return 'Évaluation';
};

export default function ClassResultsView({ schoolsList, currentSchoolId }: ClassResultsViewProps) {
  const { role } = useAuth();
  const currentRole = role as UserRole;
  const [mode, setMode] = useState<'official' | 'custom'>('official');
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
  const [availableEvaluations, setAvailableEvaluations] = useState<AvailableEvaluation[]>([]);
  const [selectedEvaluationIds, setSelectedEvaluationIds] = useState<number[]>([]);
  const [customRanking, setCustomRanking] = useState<CustomRankingResponse | null>(null);
  const [evaluationsLoading, setEvaluationsLoading] = useState(false);
  const [customResultsLoading, setCustomResultsLoading] = useState(false);
  const [evaluationsError, setEvaluationsError] = useState<string | null>(null);
  const [customResultsError, setCustomResultsError] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const exportGenerationRef = useRef(0);

  const invalidateDisplayedResults = () => {
    exportGenerationRef.current += 1;
    setRanking(null);
    setCustomRanking(null);
    setExportError(null);
    setExporting(false);
  };

  useEffect(() => {
    if (currentRole === 'school_admin' && currentSchoolId != null) {
      setSchoolId(String(currentSchoolId));
    } else if (currentRole === 'super_admin') {
      setSchoolId('');
    }
    invalidateDisplayedResults();
    setClassId('');
    setPeriodId('');
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

  useEffect(() => {
    setSelectedEvaluationIds([]);
    setCustomRanking(null);
    setCustomResultsError(null);
  }, [schoolId, classId, periodId]);

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

    if (mode !== 'official' || !schoolId || !classId || !periodId) {
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
  }, [mode, schoolId, classId, periodId]);

  useEffect(() => {
    let cancelled = false;
    setAvailableEvaluations([]);
    setEvaluationsError(null);
    setSelectedEvaluationIds([]);
    setCustomRanking(null);

    if (mode !== 'custom' || !schoolId || !classId || !periodId) {
      setEvaluationsLoading(false);
      return () => { cancelled = true; };
    }

    setEvaluationsLoading(true);
    const params = new URLSearchParams({ schoolId, classId, periodId });
    apiFetch(`/api/results/class-ranking/available-evaluations?${params.toString()}`)
      .then((payload) => {
        if (cancelled) return;
        setAvailableEvaluations(Array.isArray(payload) ? payload as AvailableEvaluation[] : []);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setAvailableEvaluations([]);
        setEvaluationsError(getUiErrorMessage(error, 'Impossible de charger les évaluations disponibles.'));
      })
      .finally(() => {
        if (!cancelled) setEvaluationsLoading(false);
      });

    return () => { cancelled = true; };
  }, [mode, schoolId, classId, periodId]);

  const customSubjectColumns = useMemo(() => {
    const byKey = new Map<string, Pick<CustomSubjectAverage, 'subjectId' | 'subjectName'>>();
    for (const evaluation of customRanking?.evaluations ?? []) {
      const key = subjectKey(evaluation);
      if (!byKey.has(key)) {
        byKey.set(key, { subjectId: evaluation.subjectId, subjectName: evaluation.subject });
      }
    }
    return [...byKey.values()];
  }, [customRanking]);

  const evaluationsBySubject = useMemo(() => {
    const groups = new Map<string, { subjectName: string; evaluations: AvailableEvaluation[] }>();
    for (const evaluation of availableEvaluations) {
      const key = subjectKey(evaluation);
      const group = groups.get(key) ?? { subjectName: evaluation.subject, evaluations: [] };
      group.evaluations.push(evaluation);
      groups.set(key, group);
    }
    return [...groups.values()].sort((a, b) => a.subjectName.localeCompare(b.subjectName, 'fr'));
  }, [availableEvaluations]);

  const calculateCustomRanking = async () => {
    if (selectedEvaluationIds.length === 0) return;
    setCustomResultsLoading(true);
    setCustomResultsError(null);
    setCustomRanking(null);
    setExportError(null);
    try {
      const payload = await apiFetch('/api/results/class-ranking/custom', {
        method: 'POST',
        body: JSON.stringify({
          schoolId: Number(schoolId),
          classId: Number(classId),
          periodId: Number(periodId),
          evaluationIds: selectedEvaluationIds,
        }),
      });
      setCustomRanking(payload as CustomRankingResponse);
    } catch (error) {
      setCustomResultsError(getUiErrorMessage(error, 'Impossible de calculer le classement personnalisé.'));
    } finally {
      setCustomResultsLoading(false);
    }
  };

  const selectedSchool = schoolsList.find((school) => String(school.id) === schoolId);
  const hasAnyAverage = ranking?.students.some((student) => student.average != null) ?? false;
  const officialRankingIsCurrent = mode === 'official'
    && (currentRole !== 'school_admin' || String(currentSchoolId ?? '') === schoolId)
    && ranking?.school.id === Number(schoolId)
    && ranking.class.id === Number(classId)
    && ranking.period.id === Number(periodId);
  const customRankingIsCurrent = mode === 'custom'
    && (currentRole !== 'school_admin' || String(currentSchoolId ?? '') === schoolId)
    && customRanking?.school.id === Number(schoolId)
    && customRanking.class.id === Number(classId)
    && customRanking.period.id === Number(periodId)
    && customRanking.evaluations.length === selectedEvaluationIds.length
    && customRanking.evaluations.every((evaluation) => selectedEvaluationIds.includes(evaluation.id));

  const exportRanking = async (rankingType: 'official' | 'custom') => {
    const exportToken = exportGenerationRef.current;
    const result = rankingType === 'official' && officialRankingIsCurrent
      ? ranking
      : rankingType === 'custom' && customRankingIsCurrent
        ? customRanking
        : null;
    if (!result) return;

    setExporting(true);
    setExportError(null);
    try {
      const subjectColumns = rankingType === 'custom' ? customSubjectColumns : [];
      const subjectNames = subjectColumns.map(({ subjectName }) => subjectName);
      const students = rankingType === 'custom'
        ? (result as CustomRankingResponse).students.map((student) => ({
          rank: rankLabel(student.rank),
          matricule: student.matricule || '',
          fullName: `${student.lastName} ${student.firstName}`.trim(),
          subjectAverages: subjectColumns.map((column) => {
            const subject = student.subjectAverages.find((item) => (
              customSubjectKey(item) === customSubjectKey(column)
            ));
            return subject?.average ?? null;
          }),
          average: student.average,
        }))
        : (result as ClassRankingResponse).students.map((student) => ({
          rank: rankLabel(student.rank),
          matricule: student.matricule || '',
          fullName: `${student.lastName} ${student.firstName}`.trim(),
          subjectAverages: [],
          average: student.average,
        }));
      const generatedAt = new Date();
      const bytes = await buildClassRankingExcel({
        schoolName: result.school.name,
        className: result.class.name,
        periodName: result.period.name,
        rankingType,
        generatedAt,
        subjectNames,
        evaluations: rankingType === 'custom'
          ? (result as CustomRankingResponse).evaluations.map(({ subject, title }) => ({ subject, title }))
          : undefined,
        students,
      });
      if (exportGenerationRef.current !== exportToken) return;

      const blob = new Blob([bytes], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = classRankingExcelFilename(rankingType, result.class.name, result.period.name);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (error) {
      if (exportGenerationRef.current === exportToken) {
        setExportError(getUiErrorMessage(error, 'Impossible de générer le fichier Excel. Réessayez.'));
      }
    } finally {
      if (exportGenerationRef.current === exportToken) setExporting(false);
    }
  };

  return (
    <section className="space-y-6" aria-labelledby="class-results-heading">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 id="class-results-heading" className="text-xl font-bold text-slate-900 sm:text-2xl">Résultats / Proclamation</h1>
          <p className="mt-1 text-sm text-slate-500">
            {mode === 'official'
              ? 'Classement officiel calculé à partir des notes de la période sélectionnée.'
              : 'Classement non officiel calculé à partir des évaluations sélectionnées.'}
          </p>
        </div>
        <Trophy className="hidden h-8 w-8 text-indigo-600 sm:block" aria-hidden="true" />
      </div>

      <label className="block max-w-xl space-y-1.5 text-sm font-semibold text-slate-700">
        Mode de classement
        <select
          aria-label="Mode de classement"
          value={mode}
          onChange={(event) => {
            invalidateDisplayedResults();
            setMode(event.target.value as 'official' | 'custom');
          }}
          className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 font-normal outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
        >
          <option value="official">Classement officiel</option>
          <option value="custom">Classement personnalisé</option>
        </select>
      </label>

      <div className="grid gap-4 md:grid-cols-2">
        {currentRole === 'super_admin' ? (
          <label className="space-y-1.5 text-sm font-semibold text-slate-700">
            École
            <select
              value={schoolId}
              onChange={(event) => {
                invalidateDisplayedResults();
                setSchoolId(event.target.value);
              }}
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
            onChange={(event) => {
              invalidateDisplayedResults();
              setClassId(event.target.value);
            }}
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
            onChange={(event) => {
              invalidateDisplayedResults();
              setPeriodId(event.target.value);
            }}
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

      {mode === 'official' && resultsLoading && <LoadingMessage label="Calcul du classement…" />}
      {mode === 'official' && resultsError && <ErrorMessage message={resultsError} />}
      {mode === 'official' && ranking && officialRankingIsCurrent && !resultsLoading && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-indigo-50 px-4 py-3 text-sm text-indigo-900">
            <div>
              <span className="font-semibold">{ranking.class.name}</span>
              <span className="mx-2 text-indigo-300">·</span>
              <span>{ranking.period.name}</span>
            </div>
            <button
              type="button"
              onClick={() => void exportRanking('official')}
              disabled={exporting}
              className="inline-flex items-center gap-2 rounded-lg border border-indigo-200 bg-white px-3 py-2 font-semibold text-indigo-700 hover:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Download className="h-4 w-4" aria-hidden="true" />
              {exporting ? 'Génération Excel…' : 'Télécharger Excel'}
            </button>
          </div>
          {exportError && <ErrorMessage message={exportError} />}
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

      {mode === 'custom' && (
        <section className="space-y-4" aria-labelledby="custom-ranking-heading">
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
            <h2 id="custom-ranking-heading" className="font-semibold text-amber-950">Classement personnalisé — non officiel</h2>
            <p className="mt-1 text-sm text-amber-900">Sélectionnez librement les devoirs, interrogations, évaluations mensuelles et compositions à prendre en compte.</p>
          </div>

          {schoolId && classId && periodId && evaluationsLoading && <LoadingMessage label="Chargement des évaluations…" />}
          {evaluationsError && <ErrorMessage message={evaluationsError} />}
          {schoolId && classId && periodId && !evaluationsLoading && !evaluationsError && availableEvaluations.length === 0 && (
            <InfoMessage>Aucune évaluation sélectionnable n’est disponible pour cette classe et cette période.</InfoMessage>
          )}

          {evaluationsBySubject.length > 0 && (
            <div className="space-y-4">
              <div className="space-y-4">
                {evaluationsBySubject.map((group) => (
                  <fieldset key={subjectKey(group.evaluations[0])} className="rounded-xl border border-slate-200 p-4">
                    <legend className="px-1 text-sm font-semibold text-slate-800">{group.subjectName}</legend>
                    <div className="space-y-2">
                      {group.evaluations.map((evaluation) => (
                        <label key={evaluation.id} className="flex items-start gap-3 rounded-lg px-2 py-2 hover:bg-slate-50">
                          <input
                            type="checkbox"
                            aria-label={`${group.subjectName} — ${evaluation.title}`}
                            checked={selectedEvaluationIds.includes(evaluation.id)}
                            onChange={(event) => {
                              setSelectedEvaluationIds((current) => event.target.checked
                                ? [...current, evaluation.id]
                                : current.filter((id) => id !== evaluation.id));
                              invalidateDisplayedResults();
                            }}
                            className="mt-1 h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                          />
                          <span className="min-w-0 flex-1 text-sm text-slate-700">
                            <span className="font-medium">{evaluation.title}</span>
                            <span className="ml-2 text-xs text-slate-500">
                              {evaluationTypeLabel(evaluation.type)} · coef. {evaluation.coefficient} · /{evaluation.maxScore} · {evaluation.date}
                              {!evaluation.countInBulletin && ' · hors bulletin'}
                            </span>
                          </span>
                        </label>
                      ))}
                    </div>
                  </fieldset>
                ))}
              </div>
              <button
                type="button"
                onClick={calculateCustomRanking}
                disabled={selectedEvaluationIds.length === 0 || customResultsLoading}
                className="rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {customResultsLoading ? 'Calcul en cours…' : 'Calculer les rangs'}
              </button>
            </div>
          )}

          {customResultsLoading && <LoadingMessage label="Calcul du classement personnalisé…" />}
          {customResultsError && <ErrorMessage message={customResultsError} />}
          {customRanking && customRankingIsCurrent && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-indigo-50 px-4 py-3 text-sm text-indigo-900">
                <div>
                  <strong>Classement personnalisé — non officiel</strong>
                  <div className="mt-1">
                    {customRanking.school.name} · {customRanking.class.name} · {customRanking.period.name}
                  </div>
                  <div className="mt-1">
                    {customRanking.rankedStudentCount} élève(s) classé(s) sur {customRanking.students.length} · Calculé le {new Date(customRanking.calculatedAt).toLocaleString('fr-FR')}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => void exportRanking('custom')}
                  disabled={exporting}
                  className="inline-flex items-center gap-2 rounded-lg border border-indigo-200 bg-white px-3 py-2 font-semibold text-indigo-700 hover:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Download className="h-4 w-4" aria-hidden="true" />
                  {exporting ? 'Génération Excel…' : 'Télécharger Excel'}
                </button>
              </div>
              {exportError && <ErrorMessage message={exportError} />}
              <div className="rounded-xl border border-slate-200 p-4 text-sm">
                <h3 className="font-semibold text-slate-800">Évaluations retenues</h3>
                <ul className="mt-2 list-inside list-disc space-y-1 text-slate-600">
                  {customRanking.evaluations.map((evaluation) => (
                    <li key={evaluation.id}>{evaluation.subject} — {evaluation.title} ({evaluationTypeLabel(evaluation.type)}, coef. {evaluation.coefficient})</li>
                  ))}
                </ul>
              </div>
              {customRanking.students.length === 0 ? (
                <InfoMessage>Cette classe ne contient aucun élève actif.</InfoMessage>
              ) : (
                <div className="overflow-x-auto rounded-xl border border-slate-200">
                  <table className="w-full min-w-[760px] border-collapse text-left text-sm">
                    <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                      <tr>
                        <th scope="col" className="px-4 py-3 font-semibold">Rang</th>
                        <th scope="col" className="px-4 py-3 font-semibold">Matricule</th>
                        <th scope="col" className="px-4 py-3 font-semibold">Élève</th>
                        {customSubjectColumns.map((subject) => (
                          <th key={`${subject.subjectId ?? subject.subjectName}`} scope="col" className="px-4 py-3 text-right font-semibold">{subject.subjectName}</th>
                        ))}
                        <th scope="col" className="px-4 py-3 text-right font-semibold">Moyenne générale</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {customRanking.students.map((student) => (
                        <tr key={student.studentId} className="bg-white hover:bg-slate-50/70">
                          <td className="whitespace-nowrap px-4 py-3 font-semibold text-indigo-700">{rankLabel(student.rank)}</td>
                          <td className="whitespace-nowrap px-4 py-3 text-slate-700">{student.matricule || '—'}</td>
                          <td className="px-4 py-3 font-medium text-slate-800">{student.lastName} {student.firstName}</td>
                          {customSubjectColumns.map((subject) => {
                            const subjectAverage = student.subjectAverages.find((item) => (
                              customSubjectKey(item) === customSubjectKey(subject)
                            ))?.average ?? null;
                            return (
                              <td key={`${subject.subjectId ?? subject.subjectName}`} className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-slate-700">
                                {formatAverage(subjectAverage)}
                              </td>
                            );
                          })}
                          <td className="whitespace-nowrap px-4 py-3 text-right font-semibold tabular-nums text-slate-800">{formatAverage(student.average)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </section>
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
