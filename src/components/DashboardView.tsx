import React from 'react';
import { Users, AlertTriangle, Percent, GraduationCap, Clock, CheckCircle, XCircle, Award } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LabelList, PieChart, Pie, Cell } from 'recharts';

import { UserRole } from '../types.ts';

interface DashboardViewProps {
  stats: {
    totalStudents: number;
    totalAbsences: number;
    totalClasses: number;
    totalTeachers: number;
    attendanceRate: number;
    maleStudents?: number;
    femaleStudents?: number;
    unknownGenderStudents?: number;
  };
  recentAbsences: any[];
  recentGrades: any[];
  userRole?: UserRole;
}

export default function DashboardView({
  stats,
  recentAbsences,
  recentGrades,
  userRole,
}: DashboardViewProps) {
  console.log('Statistiques reçues par DashboardView :', stats);
  const attendanceData = [
    { name: 'Terminale S1', taux: 93.5 },
    { name: 'Seconde A', taux: 96.2 },
    { name: 'Première B', taux: 94.8 },
    { name: '3ème C', taux: 91.0 },
    { name: '4ème A', taux: 95.5 },
  ];

  // Pie chart data for justified vs unjustified absences
  const justifiedCount = recentAbsences.filter((a) => a.isJustified).length;
  const unjustifiedCount = recentAbsences.filter((a) => !a.isJustified).length;
  const totalAbsenceCount = justifiedCount + unjustifiedCount;
  const pieData = [
    { name: 'Justifiées', value: justifiedCount, color: '#10b981' },
    { name: 'Non Justifiées', value: unjustifiedCount, color: '#ef4444' },
  ];

  return (
    <div className="space-y-6" id="dashboard-view">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">Tableau de Bord Général</h2>
          <p className="text-sm text-slate-500">Statistiques de fréquentation globale et vue d’ensemble en temps réel</p>
        </div>
      </div>

      {/* Grid of counters */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
        
        {/* Total Students */}
        <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm flex items-center justify-between" id="card-stats-students">
          <div className="space-y-1">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Effectif Total</span>
            <p className="text-3xl font-bold text-slate-800">{stats.totalStudents}</p>
            <p className="text-xs text-indigo-500 font-semibold tracking-tight">Élèves inscrits</p>
          </div>
          <div className="p-3 bg-indigo-50 text-indigo-600 rounded-xl">
            <Users className="h-6 w-6" />
          </div>
        </div>

        {/* Gender Distribution */}
        {userRole !== 'parent' && (
          <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm" id="card-stats-gender">
            <div className="space-y-4">
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Répartition par genre</span>
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-slate-50 rounded-2xl p-4">
                  <p className="text-xs text-slate-500 uppercase tracking-wider">Garçons</p>
                  <p className="text-2xl font-bold text-slate-800">{stats.maleStudents || 0}</p>
                </div>
                <div className="bg-slate-50 rounded-2xl p-4">
                  <p className="text-xs text-slate-500 uppercase tracking-wider">Filles</p>
                  <p className="text-2xl font-bold text-slate-800">{stats.femaleStudents || 0}</p>
                </div>
              </div>
              {stats.unknownGenderStudents && stats.unknownGenderStudents > 0 && (
                <p className="text-[11px] text-slate-500">{stats.unknownGenderStudents} non renseigné{stats.unknownGenderStudents > 1 ? 's' : ''}</p>
              )}
            </div>
          </div>
        )}

        {/* Total Absences */}
        <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm flex items-center justify-between" id="card-stats-absences">
          <div className="space-y-1">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Absences enregistrées</span>
            <p className="text-3xl font-bold text-slate-800">{stats.totalAbsences}</p>
            <p className="text-xs text-rose-500 font-semibold tracking-tight">Depuis l’ouverture de l’année</p>
          </div>
          <div className="p-3 bg-rose-50 text-rose-600 rounded-xl">
            <AlertTriangle className="h-6 w-6" />
          </div>
        </div>

        {/* Attendance Rate */}
        <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm flex items-center justify-between" id="card-stats-rate">
          <div className="space-y-1">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Taux de Fréquentation</span>
            <p className="text-3xl font-bold text-slate-800">{stats.attendanceRate}%</p>
            <p className="text-xs text-emerald-500 font-semibold tracking-tight">Taux moyen de présence</p>
          </div>
          <div className="p-3 bg-emerald-50 text-emerald-600 rounded-xl">
            <Percent className="h-6 w-6" />
          </div>
        </div>

        {/* Classes Info */}
        <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm flex items-center justify-between" id="card-stats-classes">
          <div className="space-y-1">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Classes & Acteurs</span>
            <p className="text-3xl font-bold text-slate-800">{stats.totalClasses}</p>
            <p className="text-xs text-slate-500">Divisions de l’établissement</p>
          </div>
          <div className="p-3 bg-amber-50 text-amber-600 rounded-xl">
            <GraduationCap className="h-6 w-6" />
          </div>
        </div>
      </div>

      {/* Charts section */}
      <div className="grid grid-cols-1 gap-6">
        {userRole !== 'parent' && (
          <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm space-y-4">
            <div>
              <h3 className="font-bold text-slate-800">Fréquentation par Division (%)</h3>
              <p className="text-xs text-slate-400">Taux moyen de présence pour les classes principales</p>
            </div>
            <div className="h-64 wc-chart" style={{ minWidth: 0, minHeight: 0 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={attendanceData} margin={{ top: 20, right: 10, left: -20, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis dataKey="name" tick={{ fill: '#64748b', fontSize: 11 }} />
                  <YAxis domain={[80, 100]} tick={{ fill: '#64748b', fontSize: 11 }} />
                  <Tooltip cursor={{ fill: '#f8fafc' }} />
                  <Bar dataKey="taux" fill="#4f46e5" radius={[6, 6, 0, 0]}>
                    <LabelList dataKey="taux" position="top" style={{ fontSize: 11, fill: '#64748b', fontWeight: 'bold' }} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
        {/* Justifications pie chart */}
        <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm space-y-4">
          <div>
            <h3 className="font-bold text-slate-800">Statut des Absences</h3>
            <p className="text-xs text-slate-400">Répartition entre absences déclarées et justifiées</p>
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
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
            <div className="absolute text-center">
              <span className="text-xs text-slate-400 uppercase font-bold tracking-wider">Total</span>
              <p className="text-xl font-black text-slate-800">{totalAbsenceCount}</p>
            </div>
          </div>
          <div className="space-y-2 pt-2 border-t border-slate-100">
            {pieData.map((d) => (
              <div key={d.name} className="flex justify-between items-center text-xs">
                <span className="flex items-center gap-2 text-slate-500 text-xs">
                  <span className="w-3 h-3 rounded-full inline-block" style={{ backgroundColor: d.color }} />
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
        
        {/* Recent absences list */}
        <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm space-y-4">
          <div className="flex justify-between items-center">
            <h3 className="font-bold text-slate-800 flex items-center gap-2">
              <Clock className="h-5 w-5 text-indigo-500" />
              Absences Signalées Récemment
            </h3>
            <span className="text-xs bg-slate-50 text-slate-500 font-semibold px-2 py-1 rounded-lg">Temps Réel</span>
          </div>
          
          <div className="divide-y divide-slate-50">
            {recentAbsences && recentAbsences.length > 0 ? (
              recentAbsences.map((abs, i) => (
                <div key={abs.id || i} className="py-3 flex items-center justify-between text-xs sm:text-sm">
                  <div>
                    <p className="font-bold text-slate-800">{abs.studentName}</p>
                    <p className="text-xs text-slate-400">Classe : {abs.className} • Date : {abs.date}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-500 capitalize bg-slate-100 px-2.5 py-1 rounded-md">
                      {abs.period === 'morning' ? 'Matin' : abs.period === 'afternoon' ? 'Après-midi' : 'Journée'}
                    </span>
                    {abs.isJustified ? (
                      <span className="flex items-center gap-1 text-emerald-600 bg-emerald-50 px-2 py-1 rounded-lg font-bold text-xs">
                        <CheckCircle className="h-3 w-3" />
                        Justifiée
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-rose-600 bg-rose-50 px-2 py-1 rounded-lg font-bold text-xs">
                        <XCircle className="h-3 w-3" />
                        A Justifier
                      </span>
                    )}
                  </div>
                </div>
              ))
            ) : (
              <p className="text-slate-400 py-4 text-center text-xs">Aucune absence enregistrée ces derniers jours.</p>
            )}
          </div>
        </div>

        {/* Recent grades list */}
        <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm space-y-4">
          <div className="flex justify-between items-center">
            <h3 className="font-bold text-slate-800 flex items-center gap-2">
              <Award className="h-5 w-5 text-indigo-500" />
              Dernières Évaluations & Notes
            </h3>
            <span className="text-xs bg-emerald-50 text-emerald-600 px-2 py-1 rounded-lg font-semibold">Publiées</span>
          </div>

          <div className="divide-y divide-slate-50">
            {recentGrades && recentGrades.length > 0 ? (
              recentGrades.map((grade, i) => (
                <div key={grade.id || i} className="py-3 flex items-center justify-between text-xs sm:text-sm">
                  <div>
                    <p className="font-bold text-slate-800">{grade.studentName}</p>
                    <p className="text-xs text-slate-400">
                      {grade.subject} • {grade.evaluationTitle || 'Devoir'}
                    </p>
                  </div>
                  <div className="text-right">
                    <span className="text-sm font-bold bg-indigo-50 text-indigo-700 px-3 py-1.5 rounded-xl border border-indigo-100/60 inline-block font-mono">
                      {grade.score} / 20
                    </span>
                  </div>
                </div>
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
