import React, { useState } from 'react';
import { BookOpen, Plus, Edit2, Trash2, X, CheckCircle2, XCircle } from 'lucide-react';
import { Subject } from '../types.ts';
import ModalSurface from './ModalSurface';

interface SchoolOption {
  id: number;
  name: string;
}

interface SubjectsViewProps {
  subjectsList: Subject[];
  userRole?: string;
  schoolId?: number;
  schoolsList?: SchoolOption[];
  onAddSubject: (data: { name: string; code?: string; schoolId?: number }) => void;
  onUpdateSubject: (id: number, data: { name: string; code?: string }) => void;
  onDeleteSubject: (id: number) => void;
  onApproveSubject?: (id: number) => void;
  onRejectSubject?: (id: number) => void;
  subjectGroups?: any[];
  subjectGroupForm?: { name: string; selectedSubjectNames: string[] };
  editingSubjectGroupId?: string | null;
  subjectGroupError?: string | null;
  setSubjectGroupForm?: (form: { name: string; selectedSubjectNames: string[] }) => void;
  onSaveSubjectGroup?: () => void;
  onEditSubjectGroup?: (group: any) => void;
  onDeleteSubjectGroup?: (groupId: string) => void;
}

export default function SubjectsView({
  subjectsList,
  userRole,
  schoolId,
  schoolsList = [],
  onAddSubject,
  onUpdateSubject,
  onDeleteSubject,
  onApproveSubject,
  onRejectSubject,
  subjectGroups = [],
  subjectGroupForm = { name: '', selectedSubjectNames: [] },
  editingSubjectGroupId = null,
  subjectGroupError = null,
  setSubjectGroupForm = () => {},
  onSaveSubjectGroup = () => {},
  onEditSubjectGroup = () => {},
  onDeleteSubjectGroup = () => {},
}: SubjectsViewProps) {
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [formName, setFormName] = useState('');
  const [formCode, setFormCode] = useState('');
  const [selectedSchoolId, setSelectedSchoolId] = useState<number | ''>(schoolId ?? '');
  const [filterSchoolId, setFilterSchoolId] = useState<number | ''>('');

  const handleOpenForm = (subject?: Subject) => {
    if (subject) {
      setFormName(subject.name);
      setFormCode(subject.code || '');
      setEditingId(subject.id);
    } else {
      setFormName('');
      setFormCode('');
      setEditingId(null);
    }
    setIsFormOpen(true);
  };

  const handleCloseForm = () => {
    setIsFormOpen(false);
    setFormName('');
    setFormCode('');
    setSelectedSchoolId(schoolId ?? '');
    setEditingId(null);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formName.trim()) return;

    if (editingId) {
      onUpdateSubject(editingId, {
        name: formName.trim(),
        code: formCode.trim() || undefined,
      });
    } else {
      const targetSchoolId = userRole === 'super_admin' ? (selectedSchoolId ? Number(selectedSchoolId) : undefined) : schoolId;
      onAddSubject({
        name: formName.trim(),
        code: formCode.trim() || undefined,
        schoolId: targetSchoolId,
      });
    }
    handleCloseForm();
  };

  const handleDelete = (id: number) => {
    if (confirm('Êtes-vous sûr de vouloir supprimer cette matière ?')) {
      onDeleteSubject(id);
    }
  };

  const visibleSubjects = subjectsList.filter((subject) => {
    if (userRole !== 'super_admin' || !filterSchoolId) return true;
    return subject.schoolId === Number(filterSchoolId) || (subject as any).status !== undefined;
  });

  const getStatusLabel = (status?: string) => {
    switch (status) {
      case 'approved':
        return 'Approuvée';
      case 'rejected':
        return 'Refusée';
      default:
        return 'En attente';
    }
  };

  const getStatusClasses = (status?: string) => {
    switch (status) {
      case 'approved':
        return 'bg-emerald-50 text-emerald-700 border border-emerald-200';
      case 'rejected':
        return 'bg-rose-50 text-rose-700 border border-rose-200';
      default:
        return 'bg-amber-50 text-amber-700 border border-amber-200';
    }
  };

  return (
    <div className="space-y-6" id="subjects-view">
      {/* Header */}
      <div className="flex justify-between items-start">
        <div>
          <h2 className="text-2xl font-bold text-slate-800 flex items-center gap-3">
            <BookOpen className="h-7 w-7 text-indigo-600" />
            Gestion des Matières
          </h2>
          <p className="text-sm text-slate-500 mt-2">Administrez les matières/disciplines disponibles dans votre établissement</p>
        </div>
        {userRole !== 'school_admin' && (
          <button
            onClick={() => handleOpenForm()}
            className="bg-indigo-600 text-white px-4 py-2 rounded-xl font-semibold text-sm flex items-center gap-2 hover:bg-indigo-700 transition-colors"
          >
            <Plus className="h-4 w-4" />
            Ajouter une matière
          </button>
        )}
      </div>

      {userRole === 'super_admin' && (
        <div className="bg-white rounded-2xl border border-slate-100 p-4 shadow-sm flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <label htmlFor="subject-filter-school" className="block text-sm font-semibold text-slate-700 mb-2">
              Filtrer par établissement
            </label>
            <select
              id="subject-filter-school"
              value={filterSchoolId}
              onChange={(e) => setFilterSchoolId(e.target.value ? Number(e.target.value) : '')}
              className="w-full md:min-w-72 px-4 py-2 rounded-lg border border-slate-200 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
            >
              <option value="">Tous les établissements</option>
              {schoolsList.map((school) => (
                <option key={school.id} value={school.id}>{school.name}</option>
              ))}
            </select>
          </div>
          <p className="text-xs text-slate-500">Affiche uniquement les matières liées à l’établissement sélectionné.</p>
        </div>
      )}

      {userRole === 'super_admin' && (
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 space-y-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div>
              <h3 className="text-sm font-semibold text-slate-700">Groupes de matières</h3>
              <p className="text-xs text-slate-500">Créez des ensembles de matières réutilisables pour les écoles techniques, générales, etc.</p>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:w-[400px]">
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1">Nom du groupe</label>
                <input
                  type="text"
                  value={subjectGroupForm.name}
                  onChange={(e) => setSubjectGroupForm({ ...subjectGroupForm, name: e.target.value })}
                  placeholder="Ex. Lycée techniques"
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1">Matières du groupe</label>
                <div className="max-h-48 overflow-auto rounded-xl border border-slate-200 bg-white p-3">
                  {subjectsList.length === 0 ? (
                    <p className="text-sm text-slate-500">Aucune matière disponible.</p>
                  ) : (
                    subjectsList.map((subject) => (
                      <label key={subject.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-slate-700 hover:bg-slate-50">
                        <input
                          type="checkbox"
                          checked={subjectGroupForm.selectedSubjectNames.includes(subject.name)}
                          onChange={(e) => {
                            const current = subjectGroupForm.selectedSubjectNames;
                            const next = e.target.checked
                              ? [...current, subject.name]
                              : current.filter((name) => name !== subject.name);
                            setSubjectGroupForm({ ...subjectGroupForm, selectedSubjectNames: next });
                          }}
                          className="h-4 w-4 rounded border-slate-300 text-indigo-600"
                        />
                        <span>{subject.name}</span>
                      </label>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>
          {subjectGroupError && <div className="text-rose-600 text-sm">{subjectGroupError}</div>}
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={onSaveSubjectGroup} className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white">
              {editingSubjectGroupId ? 'Mettre à jour le groupe' : 'Enregistrer le groupe'}
            </button>
            {editingSubjectGroupId && (
              <button type="button" onClick={() => setSubjectGroupForm({ name: '', selectedSubjectNames: [] })} className="rounded-lg bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-700">
                Annuler
              </button>
            )}
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {subjectGroups.map((group) => (
              <div key={group.id} className="rounded-2xl border border-slate-200 bg-white p-3 text-sm text-slate-700">
                <div className="flex items-center justify-between gap-2">
                  <div className="font-semibold text-slate-800">{group.name}</div>
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={() => onEditSubjectGroup(group)} className="text-indigo-600 hover:text-indigo-700">Modifier</button>
                    <button type="button" onClick={() => onDeleteSubjectGroup(group.id)} className="text-rose-500 hover:text-rose-600">Supprimer</button>
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap gap-1">
                  {(group.subjectNames || []).map((subjectName: string) => (
                    <span key={`${group.id}-${subjectName}`} className="rounded-full bg-indigo-50 px-2 py-1 text-xs text-indigo-700">{subjectName}</span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Subjects Table */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
        <table className="w-full">
          <thead className="bg-slate-50 border-b border-slate-100">
            <tr>
              <th className="text-left px-6 py-4 font-semibold text-slate-700 text-sm uppercase tracking-wider">Nom de la matière</th>
              <th className="text-left px-6 py-4 font-semibold text-slate-700 text-sm uppercase tracking-wider">Code</th>
              {userRole === 'school_admin' && <th className="text-left px-6 py-4 font-semibold text-slate-700 text-sm uppercase tracking-wider">Statut</th>}
              <th className="text-center px-6 py-4 font-semibold text-slate-700 text-sm uppercase tracking-wider">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {visibleSubjects && visibleSubjects.length > 0 ? (
              visibleSubjects.map((subject) => (
                <tr key={subject.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-6 py-4 text-sm font-medium text-slate-800">{subject.name}</td>
                  <td className="px-6 py-4 text-sm text-slate-600">
                    {subject.code ? <span className="bg-slate-100 px-2 py-1 rounded text-xs font-mono">{subject.code}</span> : <span className="text-slate-400 text-xs italic">—</span>}
                  </td>
                  {userRole === 'school_admin' && (
                    <td className="px-6 py-4 text-sm">
                      <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${getStatusClasses(subject.status)}`}>
                        {getStatusLabel(subject.status)}
                      </span>
                    </td>
                  )}
                  <td className="px-6 py-4 text-center space-x-2">
                    {userRole === 'school_admin' ? (
                      <>
                        <button
                          onClick={() => onApproveSubject?.(subject.id)}
                          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold text-emerald-600 bg-emerald-50 hover:bg-emerald-100 transition-colors"
                        >
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          Approuver
                        </button>
                        <button
                          onClick={() => onRejectSubject?.(subject.id)}
                          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold text-rose-600 bg-rose-50 hover:bg-rose-100 transition-colors"
                        >
                          <XCircle className="h-3.5 w-3.5" />
                          Refuser
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          onClick={() => handleOpenForm(subject)}
                          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold text-indigo-600 bg-indigo-50 hover:bg-indigo-100 transition-colors"
                        >
                          <Edit2 className="h-3.5 w-3.5" />
                          Modifier
                        </button>
                        <button
                          onClick={() => handleDelete(subject.id)}
                          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold text-rose-600 bg-rose-50 hover:bg-rose-100 transition-colors"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          Supprimer
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={userRole === 'school_admin' ? 4 : 3} className="px-6 py-12 text-center">
                  <BookOpen className="h-12 w-12 text-slate-200 mx-auto mb-3" />
                  <p className="text-slate-500 font-medium">Aucune matière créée</p>
                  <p className="text-xs text-slate-400 mt-1">Cliquez sur "Ajouter une matière" pour commencer</p>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Form Modal */}
      {isFormOpen && (
        <ModalSurface
          isOpen={isFormOpen}
          onClose={handleCloseForm}
          ariaLabel={editingId ? 'Modifier la matière' : 'Ajouter une matière'}
          contentClassName="bg-white rounded-2xl shadow-2xl max-w-md w-full border border-slate-100 p-6"
          overlayClassName="bg-black/30"
        >
          <div className="flex justify-between items-center mb-6">
              <h3 className="text-xl font-bold text-slate-800">
                {editingId ? 'Modifier la matière' : 'Ajouter une matière'}
              </h3>
              <button
                onClick={handleCloseForm}
                className="text-slate-400 hover:text-slate-600 transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label htmlFor="subject-name-input" className="block text-sm font-semibold text-slate-700 mb-2">
                  Nom de la matière <span className="text-rose-500">*</span>
                </label>
                <input
                  id="subject-name-input"
                  type="text"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="Ex. Mathématiques"
                  className="w-full px-4 py-2 rounded-lg border border-slate-200 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
                  required
                />
              </div>

              <div>
                <label htmlFor="subject-code-input" className="block text-sm font-semibold text-slate-700 mb-2">
                  Code (optionnel)
                </label>
                <input
                  id="subject-code-input"
                  type="text"
                  value={formCode}
                  onChange={(e) => setFormCode(e.target.value)}
                  placeholder="Ex. MATH"
                  className="w-full px-4 py-2 rounded-lg border border-slate-200 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
                  maxLength={10}
                />
              </div>

              {userRole === 'super_admin' && (
                <div>
                  <label htmlFor="subject-school-select" className="block text-sm font-semibold text-slate-700 mb-2">
                    Établissement (optionnel)
                  </label>
                  <select
                    id="subject-school-select"
                    value={selectedSchoolId}
                    onChange={(e) => setSelectedSchoolId(e.target.value ? Number(e.target.value) : '')}
                    className="w-full px-4 py-2 rounded-lg border border-slate-200 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
                  >
                    <option value="">Global / Sans établissement</option>
                    {schoolsList.map((school) => (
                      <option key={school.id} value={school.id}>{school.name}</option>
                    ))}
                  </select>
                  <p className="text-xs text-slate-500 mt-2">Laisser vide pour créer une matière globale disponible pour tous les établissements.</p>
                </div>
              )}

              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={handleCloseForm}
                  className="flex-1 px-4 py-2 rounded-lg border border-slate-200 text-slate-700 font-semibold hover:bg-slate-50 transition-colors"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  className="flex-1 px-4 py-2 rounded-lg bg-indigo-600 text-white font-semibold hover:bg-indigo-700 transition-colors"
                >
                  {editingId ? 'Mettre à jour' : 'Créer'}
                </button>
              </div>
            </form>
        </ModalSurface>
      )}
    </div>
  );
}
