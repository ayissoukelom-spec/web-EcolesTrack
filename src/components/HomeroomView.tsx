import { useEffect, useState } from 'react';
import { fetchMyHomeroomClass, type HomeroomClassDetail, type HomeroomClassSummary } from '../lib/api.ts';
import { normalizeEvaluationType } from '../lib/bulletinService.ts';

type HomeroomSection = 'students' | 'evaluations' | 'attendance' | 'bulletins' | 'exams';

interface Props {
  classes: HomeroomClassSummary[];
}

const formatDate = (value?: string | null) => {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('fr-FR');
};

export default function HomeroomView({ classes }: Props) {
  const [selectedClassId, setSelectedClassId] = useState<number | null>(classes[0]?.id ?? null);
  const [detail, setDetail] = useState<HomeroomClassDetail | null>(null);
  const [section, setSection] = useState<HomeroomSection>('students');
  const [selectedSubject, setSelectedSubject] = useState('');
  const [selectedStudentId, setSelectedStudentId] = useState('');
  const [selectedBulletinStudentId, setSelectedBulletinStudentId] = useState('');
  const [selectedPeriod, setSelectedPeriod] = useState('');
  const [selectedEvaluationType, setSelectedEvaluationType] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setSelectedSubject('');
    setSelectedStudentId('');
    setSelectedBulletinStudentId('');
    setSelectedPeriod('');
    setSelectedEvaluationType('');
  }, [selectedClassId]);

  useEffect(() => {
    if (!classes.some((item) => item.id === selectedClassId)) {
      setSelectedClassId(classes[0]?.id ?? null);
    }
  }, [classes, selectedClassId]);

  useEffect(() => {
    if (selectedClassId == null) {
      setDetail(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchMyHomeroomClass(selectedClassId)
      .then((result) => {
        if (!cancelled) setDetail(result);
      })
      .catch((requestError: any) => {
        if (!cancelled) {
          setDetail(null);
          setError(requestError?.message || 'Impossible de charger cette classe.');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedClassId]);

  const availableSubjects = Array.from(new Set(
    (detail?.evaluations ?? [])
      .map((evaluation) => evaluation.subject)
      .filter((subject): subject is string => typeof subject === 'string' && subject.trim().length > 0),
  )).sort((left, right) => left.localeCompare(right, 'fr'));
  const periodType = detail?.class.cycleCode === 'college'
    ? 'trimester'
    : detail?.class.cycleCode === 'lycee'
      ? 'semester'
      : null;
  const periodCount = periodType === 'trimester' ? 3 : periodType === 'semester' ? 2 : 0;
  const periodOptions = Array.from({ length: periodCount }, (_, index) => ({
    value: `${periodType}:${index + 1}`,
    label: `${index === 0 ? '1er' : `${index + 1}e`} ${periodType === 'trimester' ? 'trimestre' : 'semestre'}`,
  }));
  const filteredEvaluations = (detail?.evaluations ?? []).filter((evaluation) => {
    if (selectedSubject && evaluation.subject !== selectedSubject) return false;
    if (selectedEvaluationType && normalizeEvaluationType(evaluation.type) !== selectedEvaluationType) return false;
    if (selectedPeriod) {
      const [selectedPeriodType, selectedOrderIndex] = selectedPeriod.split(':');
      if (evaluation.periodType !== selectedPeriodType || evaluation.orderIndex !== Number(selectedOrderIndex)) return false;
    }
    return true;
  });
  const filteredEvaluationIds = new Set(filteredEvaluations.map((evaluation) => evaluation.id));
  const filteredGrades = (detail?.grades ?? []).filter((grade) =>
    filteredEvaluationIds.has(grade.evaluationId)
      && (!selectedStudentId || grade.studentId === Number(selectedStudentId)),
  );
  const filteredBulletins = (detail?.bulletins ?? []).filter((bulletin) =>
    !selectedBulletinStudentId || bulletin.studentId === Number(selectedBulletinStudentId),
  );
  const absenceCounts = new Map<number, number>();
  for (const absence of detail?.absences ?? []) {
    absenceCounts.set(absence.studentId, (absenceCounts.get(absence.studentId) ?? 0) + 1);
  }
  const lateArrivalCounts = new Map<number, number>();
  for (const lateArrival of detail?.lateArrivals ?? []) {
    lateArrivalCounts.set(lateArrival.studentId, (lateArrivalCounts.get(lateArrival.studentId) ?? 0) + 1);
  }
  const attendanceSummary = (detail?.students ?? []).map((student) => ({
    id: student.id,
    studentName: `${student.firstName} ${student.lastName}`,
    totalAbsences: absenceCounts.get(student.id) ?? 0,
    totalLateArrivals: lateArrivalCounts.get(student.id) ?? 0,
  }));

  const sections: Array<{ id: HomeroomSection; label: string }> = [
    { id: 'students', label: 'Élèves et responsables' },
    { id: 'evaluations', label: 'Évaluations et notes' },
    { id: 'attendance', label: 'Absences et retards' },
    { id: 'bulletins', label: 'Bulletins' },
    { id: 'exams', label: 'Résultats officiels' },
  ];

  return (
    <section className="space-y-4" aria-label="Classes dont vous êtes titulaire">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-800">Mes classes titulaires</h2>
          <p className="mt-1 text-sm text-slate-500">Consultation en lecture seule</p>
        </div>
        {classes.length > 1 && (
          <label className="w-full text-sm font-medium text-slate-700 sm:max-w-xs">
            Classe
            <select
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
              value={selectedClassId ?? ''}
              onChange={(event) => setSelectedClassId(event.target.value ? Number(event.target.value) : null)}
            >
              {classes.map((item) => (
                <option key={`${item.schoolId}-${item.id}`} value={item.id}>{item.name} · {item.schoolName}</option>
              ))}
            </select>
          </label>
        )}
      </header>

      {classes.length === 0 && <p className="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-600">Aucune classe titulaire ne vous est affectée.</p>}
      {loading && <p role="status" className="text-sm text-slate-500">Chargement des informations de classe…</p>}
      {error && <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}

      {detail && !loading && (
        <>
          <div className="grid gap-3 rounded-lg border border-slate-200 bg-white p-4 sm:grid-cols-2 lg:grid-cols-4">
            <div><p className="text-xs font-semibold uppercase text-slate-500">Classe</p><p className="mt-1 font-semibold text-slate-900">{detail.class.name}</p></div>
            <div><p className="text-xs font-semibold uppercase text-slate-500">Niveau</p><p className="mt-1 text-slate-800">{detail.class.levelName || '—'}</p></div>
            <div><p className="text-xs font-semibold uppercase text-slate-500">Établissement</p><p className="mt-1 text-slate-800">{detail.class.schoolName}</p></div>
            <div><p className="text-xs font-semibold uppercase text-slate-500">Année scolaire</p><p className="mt-1 text-slate-800">{detail.class.yearName}</p></div>
          </div>

          <nav className="flex flex-wrap gap-2 border-b border-slate-200" aria-label="Informations de classe">
            {sections.map((item) => (
              <button
                key={item.id}
                type="button"
                aria-pressed={section === item.id}
                onClick={() => setSection(item.id)}
                className={`border-b-2 px-3 py-2 text-sm font-medium ${section === item.id ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-slate-600 hover:text-slate-900'}`}
              >
                {item.label}
              </button>
            ))}
          </nav>

          {section === 'students' && (
            <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="p-3">Élève</th><th className="p-3">Statut</th><th className="p-3">Responsable</th><th className="p-3">Contact</th></tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {detail.students.map((student) => (
                    <tr key={student.id}>
                      <td className="p-3 font-medium text-slate-800">{student.lastName} {student.firstName}</td>
                      <td className="p-3 text-slate-600">{student.studentStatus || (student.isActive ? 'Actif' : 'Ancien élève')}</td>
                      <td className="p-3 text-slate-700">{student.parentName || '—'}{student.parentAddress ? <span className="block text-xs text-slate-500">{student.parentAddress}</span> : null}</td>
                      <td className="p-3 text-slate-600">{student.parentPhone || student.parentEmail || '—'}</td>
                    </tr>
                  ))}
                  {detail.students.length === 0 && <tr><td className="p-4 text-slate-500" colSpan={4}>Aucun élève dans cette classe.</td></tr>}
                </tbody>
              </table>
            </div>
          )}

          {section === 'evaluations' && (
            <div className="space-y-4">
              <div className="grid gap-3 rounded-lg border border-slate-200 bg-white p-3 sm:grid-cols-2 lg:grid-cols-4">
                <label className="text-sm font-medium text-slate-700">
                  Matière
                  <select
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
                    value={selectedSubject}
                    onChange={(event) => setSelectedSubject(event.target.value)}
                  >
                    <option value="">Toutes les matières</option>
                    {availableSubjects.map((subject) => <option key={subject} value={subject}>{subject}</option>)}
                  </select>
                </label>
                <label className="text-sm font-medium text-slate-700">
                  Élève
                  <select
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
                    value={selectedStudentId}
                    onChange={(event) => setSelectedStudentId(event.target.value)}
                  >
                    <option value="">Tous les élèves</option>
                    {(detail?.students ?? []).map((student) => (
                      <option key={student.id} value={student.id}>{student.lastName} {student.firstName}</option>
                    ))}
                  </select>
                </label>
                <label className="text-sm font-medium text-slate-700">
                  Période
                  <select
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
                    value={selectedPeriod}
                    onChange={(event) => setSelectedPeriod(event.target.value)}
                  >
                    <option value="">Toutes les périodes</option>
                    {periodOptions.map((period) => <option key={period.value} value={period.value}>{period.label}</option>)}
                  </select>
                </label>
                <label className="text-sm font-medium text-slate-700">
                  Type d’évaluation
                  <select
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
                    value={selectedEvaluationType}
                    onChange={(event) => setSelectedEvaluationType(event.target.value)}
                  >
                    <option value="">Toutes</option>
                    <option value="devoir">Devoir</option>
                    <option value="interrogation">Interrogation</option>
                    <option value="composition">Composition</option>
                  </select>
                </label>
              </div>
              <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="p-3">Date</th><th className="p-3">Matière</th><th className="p-3">Évaluation</th><th className="p-3">Enseignant</th></tr></thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredEvaluations.map((evaluation: any) => <tr key={evaluation.id}><td className="p-3">{formatDate(evaluation.date)}</td><td className="p-3">{evaluation.subject}</td><td className="p-3">{evaluation.title}</td><td className="p-3">{evaluation.teacherName}</td></tr>)}
                    {filteredEvaluations.length === 0 && <tr><td className="p-4 text-slate-500" colSpan={4}>Aucune évaluation.</td></tr>}
                  </tbody>
                </table>
              </div>
              <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="p-3">Élève</th><th className="p-3">Matière</th><th className="p-3">Évaluation</th><th className="p-3">Note</th><th className="p-3">Remarque</th></tr></thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredGrades.map((grade: any) => <tr key={grade.id}><td className="p-3">{grade.studentName}</td><td className="p-3">{grade.subject}</td><td className="p-3">{grade.evaluationTitle}</td><td className="p-3 font-semibold">{grade.score}</td><td className="p-3">{grade.remarks || '—'}</td></tr>)}
                    {filteredGrades.length === 0 && <tr><td className="p-4 text-slate-500" colSpan={5}>Aucune note enregistrée.</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {section === 'attendance' && (
            <ReadOnlyRows
              title="Absences et retards"
              emptyLabel="Aucun élève dans cette classe."
              rows={attendanceSummary}
              columns={['studentName', 'totalAbsences', 'totalLateArrivals']}
              labels={['Élève', "Total d'absences", 'Total de retards']}
            />
          )}

          {section === 'bulletins' && (
            <div className="space-y-3">
              <label className="block max-w-sm text-sm font-medium text-slate-700">
                Élève
                <select
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
                  value={selectedBulletinStudentId}
                  onChange={(event) => setSelectedBulletinStudentId(event.target.value)}
                >
                  <option value="">Tous les élèves</option>
                  {detail.students.map((student) => (
                    <option key={student.id} value={student.id}>{student.lastName} {student.firstName}</option>
                  ))}
                </select>
              </label>
              {filteredBulletins.map((bulletin: any) => (
                <article key={bulletin.id} className="rounded-lg border border-slate-200 bg-white p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="font-semibold text-slate-900">{bulletin.studentName}</h3>
                    <span className="text-sm text-slate-600">{bulletin.termName || bulletin.schoolYearName} · Moyenne {bulletin.average ?? '—'} · Rang {bulletin.rank ?? '—'}</span>
                  </div>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    {bulletin.lines.map((line: any) => <p key={line.id} className="text-sm text-slate-700">{line.subjectName}: {line.average ?? '—'}{line.teacherComment ? ` · ${line.teacherComment}` : ''}</p>)}
                  </div>
                  {bulletin.appreciation && <p className="mt-2 text-sm text-slate-600">{bulletin.appreciation}</p>}
                </article>
              ))}
              {filteredBulletins.length === 0 && <p className="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-500">Aucun bulletin enregistré.</p>}
            </div>
          )}

          {section === 'exams' && <ReadOnlyRows title="Résultats officiels" emptyLabel="Aucun résultat officiel." rows={detail.examResults} columns={['studentName', 'examType', 'resultStatus', 'examSession']} labels={['Élève', 'Examen', 'Résultat', 'Session']} />}
        </>
      )}
    </section>
  );
}

function ReadOnlyRows({ title, emptyLabel, rows, columns, labels }: {
  title: string;
  emptyLabel: string;
  rows: Array<Record<string, any>>;
  columns: string[];
  labels: string[];
}) {
  return (
    <section className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <h3 className="border-b border-slate-100 px-3 py-2 font-semibold text-slate-800">{title}</h3>
      <table className="w-full text-left text-sm">
        <thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr>{labels.map((label) => <th key={label} className="p-3">{label}</th>)}</tr></thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((row, index) => <tr key={row.id ?? index}>{columns.map((column) => <td key={column} className="p-3 text-slate-700">{column === 'date' ? formatDate(row[column]) : row[column] ?? '—'}</td>)}</tr>)}
          {rows.length === 0 && <tr><td className="p-4 text-slate-500" colSpan={columns.length}>{emptyLabel}</td></tr>}
        </tbody>
      </table>
    </section>
  );
}