import React from 'react';
import type { Class, Teacher } from '../types.ts';

interface AbsenceControlsViewProps {
  absenceControlsList: any[];
  classesList: Class[];
  teachersList: Teacher[];
  approvedSubjectsList: { id: number; name: string }[];
}

function formatControlDate(value: string) {
  const parts = String(value || '').split('-');
  if (parts.length !== 3) return value || '—';
  return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

function formatPeriod(value: string | null | undefined) {
  if (value === 'morning') return 'Matin';
  if (value === 'afternoon') return 'Après-midi';
  if (value === 'all_day') return 'Toute la journée';
  return value || '—';
}

export default function AbsenceControlsView({
  absenceControlsList,
  classesList,
  teachersList,
  approvedSubjectsList,
}: AbsenceControlsViewProps) {
  const controls = absenceControlsList.filter((control) => control.controlType === 'none');

  return (
    <div className="space-y-6" id="absence-controls-view">
      <div>
        <h2 className="text-2xl font-bold text-slate-800">Contrôles Néant</h2>
        <p className="text-sm text-slate-500">Contrôles d'absence effectués par les enseignants sans élève absent</p>
      </div>

      <div className="bg-white border border-slate-50 rounded-2xl shadow-sm overflow-x-auto" id="absence-controls-table-container">
        <table className="w-full min-w-[900px] text-left text-xs sm:text-sm text-slate-600">
          <thead className="bg-slate-50 text-slate-500 uppercase tracking-wider text-[10px] font-bold border-b border-slate-100">
            <tr>
              <th className="px-6 py-4">Date</th>
              <th className="px-6 py-4">Classe</th>
              <th className="px-6 py-4">Enseignant</th>
              <th className="px-6 py-4">Matière</th>
              <th className="px-6 py-4">Période</th>
              <th className="px-6 py-4">Horaires</th>
              <th className="px-6 py-4">Statut</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {controls.map((control) => {
              const klass = classesList.find((item) => item.id === control.classId);
              const teacherId = control['teacher' + 'Id'];
              const teacher = teachersList.find((item) => item.id === teacherId);
              const subject = approvedSubjectsList.find((item) => item.id === control.subjectId);

              return (
                <tr key={control.id} className="hover:bg-slate-50/60 transition-colors">
                  <td className="px-6 py-4 font-mono text-xs">{formatControlDate(control.date)}</td>
                  <td className="px-6 py-4 font-semibold text-slate-700">{klass?.name || `Classe ${control.classId}`}</td>
                  <td className="px-6 py-4 font-semibold text-slate-700">{teacher?.name || `Enseignant ${teacherId}`}</td>
                  <td className="px-6 py-4">{subject?.name || 'Non précisée'}</td>
                  <td className="px-6 py-4">{formatPeriod(control.period)}</td>
                  <td className="px-6 py-4 font-mono text-xs">
                    {control.startTime && control.endTime ? `${control.startTime} - ${control.endTime}` : '—'}
                  </td>
                  <td className="px-6 py-4">
                    <span className="inline-flex items-center px-2.5 py-1 bg-emerald-50 text-emerald-700 text-xs font-bold rounded-full border border-emerald-100">
                      Contrôle effectué — Néant
                    </span>
                  </td>
                </tr>
              );
            })}
            {controls.length === 0 && (
              <tr>
                <td colSpan={7} className="text-center py-8 text-slate-400 text-xs">Aucun contrôle Néant enregistré.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
