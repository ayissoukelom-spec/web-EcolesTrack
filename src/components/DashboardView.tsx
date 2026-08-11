import React from 'react';
import { Users, AlertTriangle, Percent, GraduationCap, Clock, CheckCircle, XCircle, Award } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LabelList, PieChart, Pie, Cell } from 'recharts';

import { UserRole } from '../types.ts';
import { getGradeBadgeClass, getGradeBand } from '../lib/gradeColor';

export function normalizeDashboardChartData(rawData: unknown): Array<{ name: string; taux: number }> {
  if (!Array.isArray(rawData)) return [];

  return rawData.reduce<Array<{ name: string; taux: number }>>((acc, item) => {
    if (!item || typeof item !== 'object') return acc;

    const record = item as Record<string, unknown>;
    const name = typeof record.name === 'string' && record.name.trim()
      ? record.name.trim()
      : typeof record.label === 'string' && record.label.trim()
        ? record.label.trim()
        : typeof record.className === 'string' && record.className.trim()
          ? record.className.trim()
          : null;

    const rawValue = typeof record.taux === 'number'
      ? record.taux
      : typeof record.value === 'number'
        ? record.value
        : typeof record.attendanceRate === 'number'
          ? record.attendanceRate
          : typeof record.percent === 'number'
            ? record.percent
            : null;

    if (!name || rawValue == null) return acc;

    const clampedValue = Math.max(0, Math.min(100, Number(rawValue)));
    acc.push({ name, taux: Number.isFinite(clampedValue) ? clampedValue : 0 });
    return acc;
  }, []);
}

interface DashboardViewProps {
  stats: {
    totalStudents: number;
    totalAbsences: number;
    totalClasses: number;
    totalTeachers: number;
    attendanceRate: number;
    maleStudents?: number;
    femaleStudents?: number;
  };
  recentAbsences: any[];
  recentGrades: any[];
  userRole?: UserRole;
  chartData?: Array<{ name: string; taux: number }>;
  absenceStatusCounts?: {
    justified: number;
    unjustified: number;
  };
}

export default function DashboardView({
  stats,
  recentAbsences,
  recentGrades,
  userRole,
  chartData = [],
  absenceStatusCounts,
}: DashboardViewProps) {
  console.log('Statistiques reçues par DashboardView :', stats);
  console.log('Graphique reçu :', chartData);
  console.log('TYPE chartData:', typeof chartData);
  console.log('IS ARRAY:', Array.isArray(chartData));
  console.log('CONTENT SAMPLE:', chartData?.slice?.(0, 5));

  const attendanceData = normalizeDashboardChartData(chartData);
  const justifiedCount = absenceStatusCounts?.justified ?? recentAbsences.filter((a) => a.isJustified).length;
  const unjustifiedCount = absenceStatusCounts?.unjustified ?? recentAbsences.filter((a) => !a.isJustified).length;
  const totalAbsenceCount = justifiedCount + unjustifiedCount;
  const pieData = [
    { name: 'Justifiées', value: justifiedCount, color: '#10b981' },
    { name: 'Non Justifiées', value: unjustifiedCount, color: '#ef4444' },
  ];

  return (
    <div className="space-y-6 bg-[radial-gradient(circle_at_top_left,_rgba(99,102,241,0.10),_transparent_28%),radial-gradient(circle_at_bottom_right,_rgba(56,189,248,0.12),_transparent_30%)] p-1 md:p-2" id="dashboard-view">
      <div className="flex justify-between items-center rounded-3xl border border-indigo-100/80 bg-white/70 px-5 py-4 shadow-[0_10px_25px_rgba(15,23,42,0.05)] backdrop-blur-sm">
        <div>
          <h2 className="text-2xl font-black tracking-tight text-slate-800">Tableau de Bord Général</h2>
          <p className="text-sm text-slate-500">Statistiques de fréquentation globale et vue d’ensemble en temps réel</p>
        </div>
      </div>

      {/* Grid of counters */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
        <div
          className="group relative overflow-hidden rounded-3xl border border-indigo-200/80 bg-gradient-to-br from-indigo-600 via-indigo-500 to-blue-500 p-5 shadow-[0_18px_35px_rgba(79,70,229,0.20)] transition-all duration-200 hover:-translate-y-1 hover:shadow-[0_22px_40px_rgba(79,70,229,0.28)]"
          id="card-stats-students"
        >
          <div className="absolute -right-6 -top-7 h-24 w-24 rounded-full bg-white/10 blur-2xl" />
          <div className="relative flex items-center justify-between gap-4">
            <div className="space-y-2">
              <span className="text-[0.68rem] font-semibold uppercase tracking-[0.22em] text-indigo-100">Effectif Total</span>
              <p className="text-4xl font-black leading-none text-white">{stats.totalStudents}</p>
              <p className="text-xs font-semibold tracking-tight text-indigo-100/90">Élèves inscrits</p>
            </div>
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/25 bg-white/10 text-white shadow-inner">
              <Users className="h-6 w-6" />
            </div>
          </div>
        </div>

        {userRole !== 'parent' && (
          <div
            className="rounded-3xl border border-sky-200/80 bg-gradient-to-br from-sky-50 via-white to-cyan-50 p-5 shadow-[0_12px_30px_rgba(14,116,144,0.09)] transition-all duration-200 hover:-translate-y-1 hover:shadow-[0_18px_32px_rgba(14,116,144,0.14)]"
            id="card-stats-gender"
          >
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-3">
                <span className="text-[0.68rem] font-semibold uppercase tracking-[0.22em] text-slate-500">Répartition par genre</span>
                <div className="rounded-full bg-sky-100 px-2 py-1 text-[0.6rem] font-semibold text-sky-700">Live</div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-2xl bg-gradient-to-br from-sky-500 to-cyan-400 p-4 text-white shadow-[0_12px_24px_rgba(14,116,144,0.25)]">
                  <p className="text-[0.6rem] uppercase tracking-[0.18em] text-sky-100">Garçons</p>
                  <p className="mt-2 text-3xl font-black leading-none">{stats.maleStudents || 0}</p>
                </div>
                <div className="rounded-2xl bg-gradient-to-br from-pink-400 to-fuchsia-500 p-4 text-white shadow-[0_12px_24px_rgba(217,70,239,0.22)]">
                  <p className="text-[0.6rem] uppercase tracking-[0.18em] text-pink-100">Filles</p>
                  <p className="mt-2 text-3xl font-black leading-none">{stats.femaleStudents || 0}</p>
                </div>
              </div>
            </div>
          </div>
        )}

        <div
          className="group relative overflow-hidden rounded-3xl border border-rose-200/80 bg-gradient-to-br from-rose-500 via-pink-500 to-orange-400 p-5 text-white shadow-[0_18px_35px_rgba(244,63,94,0.20)] transition-all duration-200 hover:-translate-y-1 hover:shadow-[0_22px_40px_rgba(244,63,94,0.26)]"
          id="card-stats-absences"
        >
          <div className="absolute -left-6 -bottom-8 h-24 w-24 rounded-full bg-white/10 blur-2xl" />
          <div className="relative flex items-center justify-between gap-4">
            <div className="space-y-2">
              <span className="text-[0.68rem] font-semibold uppercase tracking-[0.22em] text-rose-100">Absences enregistrées</span>
              <p className="text-4xl font-black leading-none text-white">{stats.totalAbsences}</p>
              <p className="text-xs font-semibold tracking-tight text-rose-50/90">Depuis l’ouverture de l’année</p>
            </div>
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/25 bg-white/10 text-white shadow-inner">
              <AlertTriangle className="h-6 w-6" />
            </div>
          </div>
        </div>

        <div
          className="group relative overflow-hidden rounded-3xl border border-emerald-200/80 bg-gradient-to-br from-emerald-400 via-emerald-500 to-teal-500 p-5 text-white shadow-[0_18px_35px_rgba(16,185,129,0.18)] transition-all duration-200 hover:-translate-y-1 hover:shadow-[0_22px_40px_rgba(16,185,129,0.24)]"
          id="card-stats-rate"
        >
          <div className="absolute right-0 top-0 h-20 w-20 rounded-full bg-white/10 blur-2xl" />
          <div className="relative flex items-center justify-between gap-4">
            <div className="space-y-2">
              <span className="text-[0.68rem] font-semibold uppercase tracking-[0.22em] text-emerald-50">Taux de Fréquentation</span>
              <p className="text-4xl font-black leading-none text-white">{stats.attendanceRate}%</p>
              <p className="text-xs font-semibold tracking-tight text-emerald-50/90">Taux moyen de présence</p>
            </div>
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/25 bg-white/10 text-white shadow-inner">
              <Percent className="h-6 w-6" />
            </div>
          </div>
        </div>

        <div
          className="group relative overflow-hidden rounded-3xl border border-amber-200/80 bg-gradient-to-br from-orange-400 via-amber-400 to-yellow-300 p-5 text-white shadow-[0_18px_35px_rgba(251,146,60,0.18)] transition-all duration-200 hover:-translate-y-1 hover:shadow-[0_22px_40px_rgba(251,146,60,0.26)]"
          id="card-stats-classes"
        >
          <div className="absolute left-0 top-0 h-20 w-20 rounded-full bg-white/10 blur-2xl" />
          <div className="relative flex items-center justify-between gap-4">
            <div className="space-y-2">
              <span className="text-[0.68rem] font-semibold uppercase tracking-[0.22em] text-amber-50">Classes & Acteurs</span>
              <p className="text-4xl font-black leading-none text-white">{stats.totalClasses}</p>
              <p className="text-xs font-medium text-amber-50/90">Divisions de l’établissement</p>
            </div>
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/25 bg-white/10 text-white shadow-inner">
              <GraduationCap className="h-6 w-6" />
            </div>
          </div>
        </div>
      </div>

      {/* Charts section */}
      <div className="grid grid-cols-1 gap-6">
        {userRole !== 'parent' && (
          <div className="rounded-3xl border border-slate-200/80 bg-gradient-to-br from-white via-slate-50 to-indigo-50/60 p-5 shadow-[0_16px_35px_rgba(15,23,42,0.06)]">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h3 className="text-lg font-bold text-slate-800">Fréquentation par Division (%)</h3>
                <p className="text-xs text-slate-500">Taux moyen de présence pour les classes principales</p>
              </div>
              <div className="rounded-full border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-[0.62rem] font-semibold uppercase tracking-[0.18em] text-indigo-600">
                Classes
              </div>
            </div>
            <div className="h-64 wc-chart" style={{ minWidth: 0, minHeight: 0 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={attendanceData} margin={{ top: 20, right: 10, left: -20, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                  <XAxis dataKey="name" tick={{ fill: '#475569', fontSize: 11 }} />
                  <YAxis domain={[0, 100]} tick={{ fill: '#475569', fontSize: 11 }} />
                  <Tooltip cursor={{ fill: '#f8fafc' }} contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0', boxShadow: '0 12px 30px rgba(15,23,42,0.08)' }} />
                  <Bar dataKey="taux" fill="#4f46e5" radius={[8, 8, 0, 0]}>
                    <LabelList dataKey="taux" position="top" style={{ fontSize: 11, fill: '#334155', fontWeight: 'bold' }} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        <div className="rounded-3xl border border-slate-200/80 bg-gradient-to-br from-white via-slate-50 to-rose-50/60 p-5 shadow-[0_16px_35px_rgba(15,23,42,0.06)]">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h3 className="text-lg font-bold text-slate-800">Statut des Absences</h3>
              <p className="text-xs text-slate-500">Répartition entre absences déclarées et justifiées</p>
            </div>
            <div className="rounded-full border border-rose-200 bg-rose-50 px-2.5 py-1 text-[0.62rem] font-semibold uppercase tracking-[0.18em] text-rose-600">
              Suivi
            </div>
          </div>
          <div className="h-44 flex items-center justify-center relative" style={{ minWidth: 0, minHeight: 0 }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={pieData}
                  cx="50%"
                  cy="50%"
                  innerRadius={50}
                  outerRadius={75}
                  paddingAngle={5}
                  dataKey="value"
                >
                  {pieData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0', boxShadow: '0 12px 30px rgba(15,23,42,0.08)' }} />
              </PieChart>
            </ResponsiveContainer>
            <div className="absolute text-center">
              <span className="text-[0.65rem] uppercase font-bold tracking-[0.18em] text-slate-400">Total</span>
              <p className="text-2xl font-black text-slate-800">{totalAbsenceCount}</p>
            </div>
          </div>
          <div className="space-y-2 pt-3 border-t border-slate-100">
            {pieData.map((d) => (
              <div key={d.name} className="flex justify-between items-center rounded-xl border border-slate-100 bg-white/70 px-3 py-2 text-xs">
                <span className="flex items-center gap-2 text-slate-600">
                  <span className="h-2.5 w-2.5 rounded-full inline-block" style={{ backgroundColor: d.color }} />
                  {d.name}
                </span>
                <span className="font-bold text-slate-800">{d.value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Recent activities section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="rounded-3xl border border-slate-200/80 bg-gradient-to-br from-white via-slate-50 to-indigo-50/50 p-5 shadow-[0_16px_35px_rgba(15,23,42,0.06)]">
          <div className="mb-4 flex justify-between items-center">
            <h3 className="font-bold text-slate-800 flex items-center gap-2">
              <Clock className="h-5 w-5 text-indigo-500" />
              Absences Signalées Récemment
            </h3>
            <span className="text-[0.62rem] font-semibold uppercase tracking-[0.18em] rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-slate-600">Temps Réel</span>
          </div>

          <div className="space-y-2">
            {recentAbsences && recentAbsences.length > 0 ? (
              recentAbsences.map((abs, i) => (
                <div key={abs.id || i} className="rounded-2xl border border-slate-100 bg-white/80 px-3 py-3 shadow-sm transition-all duration-150 hover:shadow-md">
                  <div className="flex items-center justify-between gap-3 text-xs sm:text-sm">
                    <div>
                      <p className="font-bold text-slate-800">{abs.studentName}</p>
                      <p className="text-xs text-slate-400">Classe : {abs.className} • Date : {abs.date}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[0.62rem] font-semibold uppercase tracking-[0.14em] text-slate-500 capitalize bg-slate-100 px-2 py-1 rounded-full">
                        {abs.period === 'morning' ? 'Matin' : abs.period === 'afternoon' ? 'Après-midi' : 'Journée'}
                      </span>
                      {abs.isJustified ? (
                        <span className="flex items-center gap-1 text-emerald-600 bg-emerald-50 px-2 py-1 rounded-full font-bold text-[0.62rem] uppercase tracking-[0.12em]">
                          <CheckCircle className="h-3 w-3" />
                          Justifiée
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 text-rose-600 bg-rose-50 px-2 py-1 rounded-full font-bold text-[0.62rem] uppercase tracking-[0.12em]">
                          <XCircle className="h-3 w-3" />
                          A Justifier
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <p className="text-slate-400 py-4 text-center text-xs">Aucune absence enregistrée ces derniers jours.</p>
            )}
          </div>
        </div>

        <div className="rounded-3xl border border-slate-200/80 bg-gradient-to-br from-white via-slate-50 to-emerald-50/50 p-5 shadow-[0_16px_35px_rgba(15,23,42,0.06)]">
          <div className="mb-4 flex justify-between items-center">
            <h3 className="font-bold text-slate-800 flex items-center gap-2">
              <Award className="h-5 w-5 text-violet-500" />
              Dernières Évaluations & Notes
            </h3>
            <span className="text-[0.62rem] font-semibold uppercase tracking-[0.18em] rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-emerald-600">Publiées</span>
          </div>

          <div className="space-y-2">
            {recentGrades && recentGrades.length > 0 ? (
              recentGrades.map((grade, i) => (
                (() => {
                  const maxScore = grade.maxScore != null ? Number(grade.maxScore) : 20;
                  const gradeBand = getGradeBand(grade.score, maxScore);
                  const gradeBadgeClass = getGradeBadgeClass(gradeBand);

                  return (
                    <div key={grade.id || i} className="rounded-2xl border border-slate-100 bg-white/80 px-3 py-3 shadow-sm transition-all duration-150 hover:shadow-md">
                      <div className="flex items-center justify-between gap-3 text-xs sm:text-sm">
                        <div>
                          <p className="font-bold text-slate-800">{grade.studentName}</p>
                          <p className="text-xs text-slate-400">
                            {grade.subject} • {grade.evaluationTitle || 'Devoir'}
                          </p>
                        </div>
                        <div className="text-right">
                          <span className={`text-sm font-bold px-3 py-1.5 rounded-xl inline-block font-mono ${gradeBadgeClass}`}>
                            {grade.score}{grade.maxScore != null ? `/${grade.maxScore}` : '/20'}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })()
              ))
            ) : (
              <p className="text-slate-400 py-4 text-center text-xs">Aucune note saisie récemment.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
