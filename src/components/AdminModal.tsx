import React, { useState, useRef, useEffect } from 'react';
import { getSimulatedSchoolId, apiFetch } from '../lib/api.ts';
import RequiredLabel from './RequiredLabel';

export default function AdminModal(props: any) {
  const {
    isModalOpen,
    onClose,
    activeTab,
    handleFormSubmit,
    schoolForm,
    setSchoolForm,
    yearForm,
    setYearForm,
    classForm,
    setClassForm,
    teacherForm,
    setTeacherForm,
    parentForm,
    setParentForm,
    studentForm,
    setStudentForm,
    studentError,
    newParentMode,
    setNewParentMode,
    newParentForm,
    setNewParentForm,
    newTeacherMode,
    setNewTeacherMode,
    newTeacherForm,
    setNewTeacherForm,
    allowSelectOverflow,
    setAllowSelectOverflow,
    sortedParentPhonePrefixes,
    teacherSpecializations,
    schoolsList,
    yearsList,
    teachersList,
    parentsList,
    studentsList,
    availableSchoolAdmins,
    sortedClasses,
    defaultAcademicYearId,
    handleSaveNewParent,
    handleSaveNewTeacher,
    userRole,
    currentSchoolId,
  } = props;
  const { fieldErrors, setFieldErrors } = props;

  const clearFieldError = (field: string) => {
    if (!setFieldErrors) return;
    setFieldErrors((prev: Record<string, string>) => {
      const copy = { ...prev };
      if (copy[field]) delete copy[field];
      return copy;
    });
  };

  const cycleOptions = ['6ème', '5ème', '4ème', '3ème', '2nde', '1ère', 'Tle'];
  const sectionOptions = ['A', 'B', 'C', 'D'];
  const streamOptions = ['A4', 'C', 'D', 'CD', 'G1', 'G2', 'G3', 'F1', 'F2', 'F3', 'F4'];
  const groupOptions = ['1', '2', '3', '4'];
  const birthDateDayOptions = Array.from({ length: 31 }, (_, index) => String(index + 1).padStart(2, '0'));
  const birthDateMonthOptions = Array.from({ length: 12 }, (_, index) => ({
    value: String(index + 1).padStart(2, '0'),
    label: ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Juin', 'Juil', 'Aoû', 'Sep', 'Oct', 'Nov', 'Déc'][index],
  }));
  const birthDateYearOptions = Array.from({ length: 25 }, (_, index) => String(new Date().getFullYear() - index));

  const selectedStudentSchoolId = studentForm.schoolId ? parseInt(studentForm.schoolId, 10) : undefined;
  const currentStudentSchoolId = userRole === 'school_admin' ? (currentSchoolId ?? selectedStudentSchoolId) : selectedStudentSchoolId;
  const selectedStudentClassId = studentForm.classId ? parseInt(studentForm.classId, 10) : undefined;
  const selectedStudentClass = sortedClasses.find((c: any) => c.id === selectedStudentClassId);
  const isApprovedForSchool = (c: any, schoolId?: number | null) => {
    if (schoolId == null) {
      if (c.status != null) return c.status === 'approved';
      return true;
    }
    if (c.schoolId === schoolId) return true;
    return c.schoolId == null && c.status === 'approved';
  };
  const filteredStudentClasses = sortedClasses.filter((c: any) => !currentStudentSchoolId || isApprovedForSchool(c, currentStudentSchoolId));
  // Get all teachers assigned to the selected class (via classIds, not just teacherId)
  const teachersInSelectedClass = selectedStudentClass
    ? teachersList.filter((t: any) => (t.classIds || []).includes(selectedStudentClass.id))
    : [];
  const filteredTeachers = selectedStudentClassId && teachersInSelectedClass.length > 0
    ? teachersInSelectedClass
    : teachersList.filter((t: any) => !currentStudentSchoolId || t.schoolId === currentStudentSchoolId);
  const disableStudentSchoolSelection = userRole === 'school_admin' && currentSchoolId != null;
  const selectedStudentParentId = studentForm.parentId ? parseInt(studentForm.parentId, 10) : undefined;
  const [localParents, setLocalParents] = useState<any[] | null>(null);
  const availableClassesForSchool = userRole === 'school_admin' && currentSchoolId
    ? sortedClasses.filter((c: any) => isApprovedForSchool(c, currentSchoolId))
    : sortedClasses.filter((c: any) => isApprovedForSchool(c));

  const availableClassNames = Array.from(new Set<string>(availableClassesForSchool.map((c: any) => String(c.name)))).sort((a, b) => {
    const order = ['4ème','3ème','2nde a4','2nde cd','2nde','1ère a4','1ère d','1ère','tle a4','tle d','tle'];
    const normalize = (s: string) => s.toLowerCase();
    const indexOfName = (name: string) => {
      const n = normalize(name);
      for (let i = 0; i < order.length; i += 1) {
        if (n.startsWith(order[i]) || n.includes(order[i])) return i;
      }
      return order.length;
    };
    const ia = indexOfName(a);
    const ib = indexOfName(b);
    if (ia !== ib) return ia - ib;
    return a.localeCompare(b, 'fr');
  });

  const filteredParents = parentsList.filter((p: any) => {
    if (selectedStudentClassId) {
      return Number(p.studentClassId) === Number(selectedStudentClassId)
        && (!currentStudentSchoolId || Number(p.studentSchoolId) === Number(currentStudentSchoolId));
    }
    if (currentStudentSchoolId && Number(p.studentSchoolId) !== Number(currentStudentSchoolId)) return false;
    return true;
  });

  const parentOptions = localParents ?? filteredParents;
  const uniqueParentOptions = Array.from(
    new Map(parentOptions.map((p: any) => [p.id, p])).values(),
  );

  // Load parents from API by school/class when either changes (debug logs included)
  useEffect(() => {
    const schoolId = currentStudentSchoolId;
    const classId = selectedStudentClassId;
    if (!schoolId || !classId) {
      setLocalParents(null);
      return;
    }
    let mounted = true;
    (async () => {
      try {
        const q = new URLSearchParams();
        q.set('schoolId', String(schoolId));
        q.set('classId', String(classId));
        const json = await apiFetch(`/api/parents?${q.toString()}`);
        if (!mounted) return;
        // replace local filtered parents with fetched list limited to same school/class
        // Note: keep parentsList intact; update a local state for parents for this modal
        setLocalParents(json || []);
      } catch (err: any) {
        console.error('Error loading parents for school/class', err?.message || err);
        if (mounted) setLocalParents([]);
      }
    })();
    return () => { mounted = false; };
  }, [currentStudentSchoolId, selectedStudentClassId]);

  // When the global parentsList prop updates (for example after creating a new parent),
  // clear localParents so the component falls back to the refreshed `parentsList`.
  useEffect(() => {
    setLocalParents(null);
  }, [parentsList]);

  // Close modal on Escape key
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose?.();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const autoSelectedSchoolId = selectedStudentClass?.schoolId ?? currentStudentSchoolId ?? currentSchoolId ?? schoolsList[0]?.id;
  const autoSelectedSchoolName = schoolsList.find((s: any) => s.id === autoSelectedSchoolId)?.name || 'École assignée automatiquement';
  const autoAssignedParentSchoolId = userRole === 'school_admin' ? currentSchoolId : undefined;
  const autoAssignedParentSchoolName = schoolsList.find((s: any) => s.id === autoAssignedParentSchoolId)?.name || autoSelectedSchoolName;

  useEffect(() => {
    if (userRole === 'school_admin' && currentSchoolId != null && !parentForm.schoolId) {
      setParentForm((prev: any) => ({ ...prev, schoolId: String(currentSchoolId) }));
    }
  }, [userRole, currentSchoolId, parentForm.schoolId, setParentForm]);

  useEffect(() => {
    if (!newParentMode) return;
    if (!newParentForm.schoolId && autoSelectedSchoolId) {
      setNewParentForm((prev: Record<string, any>) => ({
        ...prev,
        schoolId: String(autoSelectedSchoolId),
      }));
    }
  }, [newParentMode, autoSelectedSchoolId]);

  function CustomDropdown({ value, options, placeholder, onChange }: { value: string; options: { value: string; label: string }[]; placeholder?: string; onChange: (v: string) => void }) {
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement | null>(null);
    useEffect(() => {
      function onDoc(e: MouseEvent) {
        if (!ref.current) return;
        if (!ref.current.contains(e.target as Node)) setOpen(false);
      }
      document.addEventListener('mousedown', onDoc);
      return () => document.removeEventListener('mousedown', onDoc);
    }, []);

    const selectedLabel = options.find((o) => o.value === value)?.label || '';

    return (
      <div className="relative" ref={ref}>
        <button type="button" onClick={() => setOpen((s) => !s)} className="w-full text-left px-3 py-2 bg-slate-50 border border-slate-200 text-xs sm:text-sm rounded-xl">
          {selectedLabel || placeholder}
        </button>
        {open && (
          <div className="absolute left-0 top-full mt-1 w-full bg-white border border-slate-200 rounded shadow-lg z-50 max-h-56 overflow-auto">
            {options.map((opt) => (
              <button key={opt.value} type="button" onClick={() => { onChange(opt.value); setOpen(false); }} className={`w-full text-left px-3 py-2 hover:bg-slate-100 ${opt.value === value ? 'bg-slate-100 font-semibold' : ''}`}>
                {opt.label}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  function MultiSelect({ options, value, onChange, placeholder }: { options: { value: number; label: string }[]; value: number[]; onChange: (vals: number[]) => void; placeholder?: string }) {
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement | null>(null);
    useEffect(() => {
      function onDoc(e: MouseEvent) {
        if (!ref.current) return;
        if (!ref.current.contains(e.target as Node)) setOpen(false);
      }
      document.addEventListener('mousedown', onDoc);
      return () => document.removeEventListener('mousedown', onDoc);
    }, []);

    const toggle = (v: number) => {
      if (value.includes(v)) onChange(value.filter((x) => x !== v));
      else onChange([...value, v]);
    };

    return (
      <div className="relative" ref={ref}>
        <div className="w-full border border-slate-200 rounded-xl px-2 py-2 bg-white flex items-center gap-2 flex-wrap" onClick={() => setOpen((s) => !s)}>
          {value && value.length > 0 ? (
            options.filter(o => value.includes(o.value)).map((o) => (
              <span key={o.value} className="inline-flex items-center bg-indigo-50 text-indigo-700 px-2 py-1 rounded-full text-xs">
                {o.label}
                <button type="button" onClick={(e) => { e.stopPropagation(); onChange(value.filter(x => x !== o.value)); }} className="ml-2 text-indigo-500">✕</button>
              </span>
            ))
          ) : (
            <div className="text-slate-400 text-xs">{placeholder || 'Choisir...'}</div>
          )}
          <div className="ml-auto text-slate-400 text-xs">▾</div>
        </div>
        {open && (
          <div className="absolute left-0 top-full mt-1 w-full bg-white border border-slate-200 rounded shadow-lg z-50 max-h-56 overflow-auto">
            {options.map((opt) => (
              <button key={opt.value} type="button" onClick={(e) => { e.preventDefault(); toggle(opt.value); }} className={`w-full text-left px-3 py-2 hover:bg-slate-100 ${value.includes(opt.value) ? 'bg-slate-100 font-semibold' : ''}`}>
                {opt.label}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  if (!isModalOpen) return null;

  return (
    <div
      className="fixed inset-0 flex items-center justify-center bg-black/40 p-4 z-50 overflow-x-hidden"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) {
          onClose?.();
        }
      }}
    >
      <div className="bg-white rounded-2xl p-6 w-full max-w-3xl max-h-[90vh] overflow-auto" onMouseDown={(e) => e.stopPropagation()}>
        <form onSubmit={handleFormSubmit} className="space-y-3 overflow-auto max-h-[80vh]">
          {/* Form 1: SCHOOL */}
          {activeTab === 'schools' && (
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">
                  <RequiredLabel label="Nom de l’établissement" required />
                </label>
                <input required type="text" value={schoolForm.name} onChange={e => setSchoolForm({...schoolForm, name: e.target.value})} placeholder="Lycée de Lomé" className="w-full px-3 py-2 bg-slate-50 border border-slate-200 text-xs sm:text-sm rounded-xl" />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Adresse</label>
                <input type="text" value={schoolForm.address} onChange={e => setSchoolForm({...schoolForm, address: e.target.value})} placeholder="Adresse complète" className="w-full px-3 py-2 bg-slate-50 border border-slate-200 text-xs sm:text-sm rounded-xl" />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">
                  <RequiredLabel label="Téléphone" required />
                </label>
                <div className="flex gap-2">
                  <input type="text" disabled value="+228" className="w-20 px-3 py-2 bg-slate-200 border border-slate-300 text-slate-700 rounded-xl font-bold cursor-not-allowed" />
                  <input required type="text" value={schoolForm.phoneDigits} onChange={e => setSchoolForm({...schoolForm, phoneDigits: e.target.value.replace(/\D/g, '').slice(0, 8)})} placeholder="90000000" maxLength={8} className="flex-1 px-3 py-2 bg-slate-50 border border-slate-200 text-xs sm:text-sm rounded-xl" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Classes existantes</label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-64 overflow-auto border border-slate-200 rounded-xl bg-slate-50 p-3">
                  {availableClassNames.map((name) => (
                    <label key={name} className="flex items-center gap-2 rounded-xl px-3 py-2 cursor-pointer hover:bg-slate-100">
                      <input
                        type="checkbox"
                        checked={(schoolForm.selectedClassNames || []).includes(name)}
                        onChange={(e) => {
                          const current = schoolForm.selectedClassNames || [];
                          const next = e.target.checked
                            ? [...current, name]
                            : current.filter((n: string) => n !== name);
                          setSchoolForm({ ...schoolForm, selectedClassNames: next });
                        }}
                        className="h-4 w-4 text-indigo-600 border-slate-300 rounded"
                      />
                      <span className="text-sm text-slate-700">{name}</span>
                    </label>
                  ))}
                </div>
                <p className="mt-2 text-xs text-slate-500">Cochez les classes existantes à reproduire dans la nouvelle école.</p>
              </div>
            </div>
          )}

          {studentError && (
            <div className="mt-3 p-2 bg-rose-50 border border-rose-200 rounded text-rose-700 text-sm flex items-start gap-2" role="alert">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01M21 12A9 9 0 1 1 3 12a9 9 0 0 1 18 0z"/></svg>
              <div className="text-sm">{studentError}</div>
            </div>
          )}

          {/* Form 2: ACADEMIC YEAR */}
          {activeTab === 'years' && (
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">
                  <RequiredLabel label="Label Année Scolaire" required />
                </label>
                <input required type="text" value={yearForm.name} onChange={e => setYearForm({...yearForm, name: e.target.value})} placeholder="2026-2027" className="w-full px-3 py-2 bg-slate-50 border border-slate-200 text-xs sm:text-sm rounded-xl" />
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-slate-600 text-sm">
                Cette année scolaire est globale et définie par le super admin. Les écoles et les autres comptes peuvent l'utiliser sans créer d'année dédiée.
              </div>
              {userRole !== 'super_admin' && (
                <div className="mt-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-amber-700 text-sm">
                  Seul le super admin peut créer une nouvelle année scolaire globale.
                </div>
              )}
              <div className="flex items-center gap-2">
                <input id="year-active" type="checkbox" checked={yearForm.isActive} onChange={e => setYearForm({...yearForm, isActive: e.target.checked})} className="w-4 h-4" />
                <label htmlFor="year-active" className="text-sm text-slate-600">Année active</label>
              </div>
            </div>
          )}

          {/* Form 3: CLASS */}
          {activeTab === 'classes' && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Cycle</label>
                  <input list="cycle-options" type="text" value={classForm.cycle} onChange={e => setClassForm({...classForm, cycle: e.target.value})} placeholder="Cycle (ex: 1ère)" className="w-full px-3 py-2 bg-slate-50 border border-slate-200 text-xs sm:text-sm rounded-xl" />
                  <datalist id="cycle-options">
                    {cycleOptions.map((c) => <option key={c} value={c} />)}
                  </datalist>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Section</label>
                  <input list="section-options" type="text" value={classForm.section} onChange={e => setClassForm({...classForm, section: e.target.value})} placeholder="Section" className="w-full px-3 py-2 bg-slate-50 border border-slate-200 text-xs sm:text-sm rounded-xl" />
                  <datalist id="section-options">
                    {sectionOptions.map((s) => <option key={s} value={s} />)}
                  </datalist>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Parcours / Filière</label>
                  <input list="stream-options" type="text" value={classForm.stream} onChange={e => setClassForm({...classForm, stream: e.target.value})} placeholder="Filière" className="w-full px-3 py-2 bg-slate-50 border border-slate-200 text-xs sm:text-sm rounded-xl" />
                  <datalist id="stream-options">
                    {streamOptions.map((s) => <option key={s} value={s} />)}
                  </datalist>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Groupe (optionnel)</label>
                  <input list="group-options" type="text" value={classForm.group} onChange={e => setClassForm({...classForm, group: e.target.value})} placeholder="Groupe" className="w-full px-3 py-2 bg-slate-50 border border-slate-200 text-xs sm:text-sm rounded-xl" />
                  <datalist id="group-options">
                    {groupOptions.map((g) => <option key={g} value={g} />)}
                  </datalist>
                </div>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">École</label>
                {userRole === 'school_admin' ? (
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
                    {schoolsList.find((s: any) => s.id === (currentSchoolId ?? Number(classForm.schoolId)))?.name || 'Votre école sera assignée automatiquement'}
                  </div>
                ) : (
                  <>
                    <select value={classForm.schoolId} onChange={e => setClassForm({...classForm, schoolId: e.target.value})} className="w-full px-3 py-2 bg-slate-50 border border-slate-200 text-xs sm:text-sm rounded-xl">
                      <option value="">-- Global (catalogue) --</option>
                      {schoolsList.map((s: any) => (
                        <option key={s.id} value={String(s.id)}>{s.name}</option>
                      ))}
                    </select>
                    <p className="text-xs text-slate-500 mt-1">Laisser vide pour créer une classe globale visible de tous.</p>
                  </>
                )}
              </div>
            </div>
          )}

          {/* Form 4: TEACHER */}
          {activeTab === 'teachers' && (
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">
                  <RequiredLabel label="Nom complet" required />
                </label>
                <input required type="text" value={teacherForm.name} onChange={e => { setTeacherForm({...teacherForm, name: e.target.value}); clearFieldError('name'); }} placeholder="M. Koffi" className="w-full px-3 py-2 bg-slate-50 border border-slate-200 text-xs sm:text-sm rounded-xl" />
                {fieldErrors?.name && <p className="mt-1 text-rose-600 text-sm">{fieldErrors.name}</p>}
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">
                  <RequiredLabel label="Email" required />
                </label>
                <input required type="email" value={teacherForm.email} onChange={e => setTeacherForm({...teacherForm, email: e.target.value})} placeholder="prof@ecoletrack.fr" className="w-full px-3 py-2 bg-slate-50 border border-slate-200 text-xs sm:text-sm rounded-xl" />
              </div>
                  <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">École</label>
                {userRole === 'school_admin' ? (
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
                    {schoolsList.find((s: any) => s.id === (currentSchoolId ?? schoolsList[0]?.id))?.name || 'Votre école sera assignée automatiquement'}
                  </div>
                ) : (
                  <select required value={teacherForm.schoolId} onChange={e => setTeacherForm({...teacherForm, schoolId: e.target.value})} className="w-full px-3 py-2 bg-slate-50 border border-slate-200 text-xs sm:text-sm rounded-xl">
                    <option value="">-- Choisissez une école --</option>
                    {schoolsList.map((school: any) => (
                      <option key={school.id} value={String(school.id)}>{school.name}</option>
                    ))}
                  </select>
                )}
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Spécialités</label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 border border-slate-200 rounded-xl bg-slate-50 p-3">
                  {teacherSpecializations.map((subject: any) => (
                    <label key={subject} className="flex items-center gap-2 rounded-lg px-2 py-2 cursor-pointer hover:bg-slate-100 border border-transparent hover:border-slate-200">
                      <input
                        type="checkbox"
                        checked={teacherForm.specializations.includes(subject)}
                        onChange={() => {
                          if (teacherForm.specializations.includes(subject)) {
                            setTeacherForm({ ...teacherForm, specializations: teacherForm.specializations.filter((item: string) => item !== subject) });
                          } else {
                            setTeacherForm({ ...teacherForm, specializations: [...teacherForm.specializations, subject] });
                          }
                        }}
                        className="h-4 w-4 accent-indigo-600"
                      />
                      <span className="text-xs sm:text-sm text-slate-700">{subject}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Numéro de téléphone</label>
                <div className="flex gap-2">
                  <input type="text" disabled value="+228" className="w-20 px-3 py-2 bg-slate-200 border border-slate-300 text-slate-700 rounded-xl font-bold cursor-not-allowed" />
                  <input
                    type="text"
                    value={teacherForm.phone}
                    onChange={e => setTeacherForm({...teacherForm, phone: e.target.value.replace(/\D/g, '').slice(0, 8)})}
                    className="flex-1 px-3 py-2 bg-slate-50 border border-slate-200 text-xs sm:text-sm rounded-xl"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">
                  <RequiredLabel label="Sexe" required />
                </label>
                <select required value={teacherForm.gender} onChange={e => setTeacherForm({...teacherForm, gender: e.target.value})} className="w-full px-3 py-2 bg-slate-50 border border-slate-200 text-xs sm:text-sm rounded-xl">
                  <option value="">-- Choisissez le sexe --</option>
                  <option value="M">Masculin</option>
                  <option value="F">Féminin</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Classes assignées (sélection multiple)</label>
                {(() => {
                  const teacherSelectedSchoolId = userRole === 'school_admin' ? autoSelectedSchoolId : (teacherForm.schoolId ? parseInt(teacherForm.schoolId, 10) : undefined);
                  const available = (sortedClasses || []).filter((c: any) => !teacherSelectedSchoolId || isApprovedForSchool(c, teacherSelectedSchoolId));
                  return (
                    <MultiSelect
                      options={available.map((c: any) => ({ value: c.id, label: c.name }))}
                      value={teacherForm.assignedClassIds || []}
                      onChange={(ids) => setTeacherForm({ ...teacherForm, assignedClassIds: ids })}
                      placeholder="-- Choisissez les classes --"
                    />
                  );
                })()}
              </div>
            </div>
          )}

          {/* Form 5: STUDENT */}
          {activeTab === 'students' && (
            <div className="space-y-3">
              {newParentMode ? (
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">
                      <RequiredLabel label="Nom du parent d’élève" required />
                    </label>
                    <input required type="text" value={newParentForm.name} onChange={e => { setNewParentForm({...newParentForm, name: e.target.value}); clearFieldError('name'); }} placeholder="M. Koffi" className="w-full px-3 py-2 bg-slate-50 border border-slate-200 text-xs sm:text-sm rounded-xl" />
                    {fieldErrors?.name && <p className="mt-1 text-rose-600 text-sm">{fieldErrors.name}</p>}
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">
                      <RequiredLabel label="Email de communication" required />
                    </label>
                    <input required type="email" value={newParentForm.email} onChange={e => setNewParentForm({...newParentForm, email: e.target.value})} placeholder="valerie@damidot.com" className="w-full px-3 py-2 bg-slate-50 border border-slate-200 text-xs sm:text-sm rounded-xl" />
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <div>
                      <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Indicatif</label>
                      <select value={newParentForm.phonePrefix} onChange={e => setNewParentForm({...newParentForm, phonePrefix: e.target.value})} className="w-full px-3 py-2 bg-slate-50 border border-slate-200 text-xs sm:text-sm rounded-xl">
                        {sortedParentPhonePrefixes.map((prefix: any) => (
                          <option key={prefix.value} value={prefix.value}>{prefix.label}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">N° Portable</label>
                      <input type="text" value={newParentForm.phone} onChange={e => setNewParentForm({...newParentForm, phone: e.target.value.replace(/\D/g, '').slice(0, newParentForm.phonePrefix === '+228' ? 8 : 20)})} placeholder="90000000" maxLength={newParentForm.phonePrefix === '+228' ? 8 : 20} className="w-full px-3 py-2 bg-slate-50 border border-slate-200 text-xs sm:text-sm rounded-xl" />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Adresse</label>
                    <input type="text" value={newParentForm.address} onChange={e => setNewParentForm({...newParentForm, address: e.target.value})} placeholder="Paris..." className="w-full px-3 py-2 bg-slate-50 border border-slate-200 text-xs sm:text-sm rounded-xl" />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">
                      <RequiredLabel label="Sexe" required />
                    </label>
                    <select required value={newParentForm.gender} onChange={e => setNewParentForm({...newParentForm, gender: e.target.value})} className="w-full px-3 py-2 bg-slate-50 border border-slate-200 text-xs sm:text-sm rounded-xl">
                      <option value="">-- Choisissez le sexe --</option>
                      <option value="M">Masculin</option>
                      <option value="F">Féminin</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">École</label>
                    {userRole === 'school_admin' ? (
                      <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">{autoSelectedSchoolName}</div>
                    ) : (
                      <select value={newParentForm.schoolId} onChange={e => setNewParentForm({...newParentForm, schoolId: e.target.value})} className="w-full px-3 py-2 bg-slate-50 border border-slate-200 text-xs sm:text-sm rounded-xl">
                        <option value="">-- Choisissez une école --</option>
                        {schoolsList.map((school: any) => (
                          <option key={school.id} value={String(school.id)}>{school.name}</option>
                        ))}
                      </select>
                    )}
                  </div>
                  <div className="flex items-center justify-between gap-2 pt-2">
                    <button type="button" className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl text-xs sm:text-sm font-semibold transition-colors" onClick={() => setNewParentMode(false)}>
                      Retour au formulaire élève
                    </button>
                    <button type="button" className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs sm:text-sm font-semibold shadow-md inline-flex items-center gap-1 cursor-pointer" onClick={(e) => { e.preventDefault(); handleSaveNewParent && handleSaveNewParent(); }}>
                      Enregistrer le parent
                    </button>
                  </div>
                </div>
              ) : newTeacherMode ? (
                <div className="space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <div>
                      <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">
                        <RequiredLabel label="Nom de l'enseignant" required />
                      </label>
                      <input required type="text" value={newTeacherForm.name} onChange={e => { setNewTeacherForm({...newTeacherForm, name: e.target.value}); clearFieldError('name'); }} placeholder="M. Koffi" className="w-full px-3 py-2 bg-slate-50 border border-slate-200 text-xs sm:text-sm rounded-xl" />
                      {fieldErrors?.name && <p className="mt-1 text-rose-600 text-sm">{fieldErrors.name}</p>}
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">
                        <RequiredLabel label="Email" required />
                      </label>
                      <input required type="email" value={newTeacherForm.email} onChange={e => setNewTeacherForm({...newTeacherForm, email: e.target.value})} placeholder="prof@exemple.com" className="w-full px-3 py-2 bg-slate-50 border border-slate-200 text-xs sm:text-sm rounded-xl" />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <div>
                      <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">
                        <RequiredLabel label="Téléphone" required />
                      </label>
                      <div className="flex gap-2">
                        <input type="text" disabled value="+228" className="w-20 px-3 py-2 bg-slate-200 border border-slate-300 text-slate-700 rounded-xl font-bold cursor-not-allowed" />
                        <input required type="text" value={newTeacherForm.phone} onChange={e => setNewTeacherForm({...newTeacherForm, phone: e.target.value.replace(/\D/g, '').slice(0, 8)})} placeholder="90000000" className="flex-1 px-3 py-2 bg-slate-50 border border-slate-200 text-xs sm:text-sm rounded-xl" maxLength={8} />
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Spécialités</label>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 border border-slate-200 rounded-xl bg-slate-50 p-3">
                        {teacherSpecializations.map((subject: any) => (
                          <label key={subject} className="flex items-center gap-2 rounded-lg px-2 py-2 cursor-pointer hover:bg-slate-100 border border-transparent hover:border-slate-200">
                            <input
                              type="checkbox"
                              checked={newTeacherForm.specializations.includes(subject)}
                              onChange={() => {
                                if (newTeacherForm.specializations.includes(subject)) {
                                  setNewTeacherForm({ ...newTeacherForm, specializations: newTeacherForm.specializations.filter((item: string) => item !== subject) });
                                } else {
                                  setNewTeacherForm({ ...newTeacherForm, specializations: [...newTeacherForm.specializations, subject] });
                                }
                              }}
                              className="h-4 w-4 accent-indigo-600"
                            />
                            <span className="text-xs sm:text-sm text-slate-700">{subject}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">École</label>
                    {userRole === 'school_admin' ? (
                      <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
                        {autoSelectedSchoolName}
                      </div>
                    ) : (
                      <select required value={newTeacherForm.schoolId} onChange={e => setNewTeacherForm({...newTeacherForm, schoolId: e.target.value})} className="w-full px-3 py-2 bg-slate-50 border border-slate-200 text-xs sm:text-sm rounded-xl">
                        <option value="">-- Choisissez une école --</option>
                        {schoolsList.map((school: any) => (
                          <option key={school.id} value={String(school.id)}>{school.name}</option>
                        ))}
                      </select>
                    )}
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Sexe</label>
                    <select required value={newTeacherForm.gender} onChange={e => setNewTeacherForm({...newTeacherForm, gender: e.target.value})} className="w-full px-3 py-2 bg-slate-50 border border-slate-200 text-xs sm:text-sm rounded-xl">
                      <option value="">-- Choisissez le sexe --</option>
                      <option value="M">Masculin</option>
                      <option value="F">Féminin</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Classes assignées (sélection multiple)</label>
                    {(() => {
                      const selectedSchoolId = userRole === 'school_admin' ? autoSelectedSchoolId : (newTeacherForm.schoolId ? parseInt(newTeacherForm.schoolId, 10) : undefined);
                      const available = (sortedClasses || []).filter((c: any) => !selectedSchoolId || isApprovedForSchool(c, selectedSchoolId));
                      return (
                        <MultiSelect
                      options={available.map((c: any) => ({ value: c.id, label: c.name }))}
                      value={newTeacherForm.assignedClassIds || []}
                      onChange={(ids) => setNewTeacherForm({ ...newTeacherForm, assignedClassIds: ids })}
                      placeholder="-- Choisissez les classes --"
                    />
                      );
                    })()}
                  </div>
                  <div className="flex items-center justify-between gap-2 pt-2">
                    <button type="button" className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl text-xs sm:text-sm font-semibold transition-colors" onClick={() => setNewTeacherMode(false)}>
                      Retour au formulaire élève
                    </button>
                    <button type="button" className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs sm:text-sm font-semibold shadow-md inline-flex items-center gap-1 cursor-pointer" onClick={(e) => { e.preventDefault(); handleSaveNewTeacher && handleSaveNewTeacher(); }}>
                      Enregistrer l'enseignant
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">
                        <RequiredLabel label="Nom de famille" required />
                      </label>
                      <input required type="text" value={studentForm.lastName} onChange={e => { setStudentForm({...studentForm, lastName: e.target.value}); clearFieldError('lastName'); }} placeholder="ABALO" className="w-full px-3 py-2 bg-slate-50 border border-slate-200 text-xs sm:text-sm rounded-xl" />
                      {fieldErrors?.lastName && <p className="mt-1 text-rose-600 text-sm">{fieldErrors.lastName}</p>}
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">
                        <RequiredLabel label="Prénoms" required />
                      </label>
                      <input required type="text" value={studentForm.firstName} onChange={e => { setStudentForm({...studentForm, firstName: e.target.value}); clearFieldError('firstName'); }} placeholder="Koffi" className="w-full px-3 py-2 bg-slate-50 border border-slate-200 text-xs sm:text-sm rounded-xl" />
                      {fieldErrors?.firstName && <p className="mt-1 text-rose-600 text-sm">{fieldErrors.firstName}</p>}
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Date de Naissance</label>
                    <div className="grid grid-cols-3 gap-2">
                      <CustomDropdown
                        value={studentForm.birthDate ? studentForm.birthDate.split('-')[2] : ''}
                        options={birthDateDayOptions.map((d) => ({ value: d, label: d }))}
                        placeholder="Jour"
                        onChange={(v) => {
                          const [year, month] = studentForm.birthDate.split('-');
                          setStudentForm({ ...studentForm, birthDate: `${year || ''}-${month || ''}-${v}` });
                        }}
                      />
                      <CustomDropdown
                        value={studentForm.birthDate ? studentForm.birthDate.split('-')[1] : ''}
                        options={birthDateMonthOptions}
                        placeholder="Mois"
                        onChange={(v) => {
                          const [year, , day] = studentForm.birthDate.split('-');
                          setStudentForm({ ...studentForm, birthDate: `${year || ''}-${v}-${day || ''}` });
                        }}
                      />
                      <CustomDropdown
                        value={studentForm.birthDate ? studentForm.birthDate.split('-')[0] : ''}
                        options={birthDateYearOptions.map((y) => ({ value: y, label: y }))}
                        placeholder="Année"
                        onChange={(v) => {
                          const [, month, day] = studentForm.birthDate.split('-');
                          setStudentForm({ ...studentForm, birthDate: `${v}-${month || ''}-${day || ''}` });
                        }}
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">
                      <RequiredLabel label="École de l’élève" required />
                    </label>
                    <select
                      required
                      disabled={disableStudentSchoolSelection}
                      value={currentStudentSchoolId ? String(currentStudentSchoolId) : studentForm.schoolId}
                      onChange={e => setStudentForm({ ...studentForm, schoolId: e.target.value, classId: '', parentId: '' })}
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 text-xs sm:text-sm rounded-xl"
                    >
                      <option value="">-- Choisissez l'école --</option>
                      {schoolsList.map((s: any) => (
                        <option key={s.id} value={s.id}>{s.name}</option>
                      ))}
                    </select>
                    {disableStudentSchoolSelection && currentStudentSchoolId && (
                      <p className="mt-2 text-xs text-slate-500">École assignée automatiquement pour votre rôle Admin École.</p>
                    )}
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">
                      <RequiredLabel label="Classe d’affectation" required />
                    </label>
                    <select
                      required
                      value={studentForm.classId}
                      onChange={(e) => {
                        const selectedClassId = e.target.value;
                        const selectedClass = sortedClasses.find((c: any) => String(c.id) === selectedClassId);
                        const classTeachers = selectedClass
                          ? teachersList.filter((t: any) => (t.classIds || []).includes(selectedClass.id))
                          : [];
                        const autoSelectedTeacherIds = classTeachers.map((t: any) => t.id);
                        const previousClassId = studentForm.classId;
                        const keepParent = previousClassId && previousClassId === selectedClassId;

                        setStudentForm({
                          ...studentForm,
                          classId: selectedClassId,
                          schoolId: selectedClass?.schoolId ? String(selectedClass.schoolId) : studentForm.schoolId,
                          teacherIds: autoSelectedTeacherIds.length > 0 ? autoSelectedTeacherIds : [],
                          parentId: keepParent ? studentForm.parentId : '',
                        });
                      }}
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 text-xs sm:text-sm rounded-xl"
                    >
                      <option value="">-- Choisissez la classe --</option>
                      {filteredStudentClasses.map((c: any) => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Parent rattaché (optionnel)</label>
                    <select
                      value={studentForm.parentId}
                      onChange={e => setStudentForm({...studentForm, parentId: e.target.value})}
                      disabled={!selectedStudentClassId}
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 text-xs sm:text-sm rounded-xl disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
                    >
                      <option value="">-- Choisissez le parent --</option>
                      {uniqueParentOptions.map((p: any) => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                    {selectedStudentClassId ? (
                      (localParents ?? filteredParents).length === 0 ? (
                        <p className="mt-2 text-xs text-slate-500">Aucun parent disponible pour cette classe.</p>
                      ) : null
                    ) : (
                      <p className="mt-2 text-xs text-slate-500">Sélectionnez d'abord la classe pour activer le champ des parents.</p>
                    )}
                    <button type="button" className="mt-2 text-indigo-600 text-xs font-semibold hover:underline" onClick={() => { 
                      setNewParentForm({
                        ...newParentForm,
                        schoolId: String(autoSelectedSchoolId),
                      });
                      setNewParentMode(true); 
                      setNewTeacherMode(false); 
                    }}>
                      Créer un nouveau parent rattaché
                    </button>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">
                      <RequiredLabel label="Année scolaire" required />
                    </label>
                    {yearsList.length === 1 ? (
                      <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">{yearsList[0]?.name}</div>
                    ) : (
                      <select required value={studentForm.academicYearId} onChange={e => setStudentForm({...studentForm, academicYearId: e.target.value})} className="w-full px-3 py-2 bg-slate-50 border border-slate-200 text-xs sm:text-sm rounded-xl">
                        <option value="">-- Choisissez l'année scolaire --</option>
                        {yearsList.map((y: any) => (
                          <option key={y.id} value={y.id}>{y.name}</option>
                        ))}
                      </select>
                    )}
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">
                      <RequiredLabel label="Sexe de l'élève" required />
                    </label>
                    <select required value={studentForm.gender} onChange={e => setStudentForm({...studentForm, gender: e.target.value})} className="w-full px-3 py-2 bg-slate-50 border border-slate-200 text-xs sm:text-sm rounded-xl">
                      <option value="">-- Choisissez le sexe --</option>
                      <option value="M">Masculin</option>
                      <option value="F">Féminin</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Enseignants de la classe (assignés automatiquement)</label>
                    <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg">
                      {teachersInSelectedClass.length === 0 ? (
                        <p className="text-xs text-slate-500 italic">Sélectionnez une classe pour voir les enseignants assignés</p>
                      ) : (
                        <div className="flex flex-wrap gap-2">
                          {teachersInSelectedClass.map((t: any) => (
                            <span key={t.id} className="inline-flex items-center gap-1 px-3 py-1 bg-indigo-100 text-indigo-700 border border-indigo-300 rounded-full text-xs font-medium whitespace-nowrap">
                              <span className="w-2 h-2 bg-indigo-600 rounded-full"></span>
                              {t.name}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    <p className="text-xs text-slate-500 mt-2 italic">Les enseignants sont automatiquement assignés selon leur affectation à la classe.</p>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Compte Admin École</label>
                    {userRole === 'school_admin' ? (
                      <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
                        {availableSchoolAdmins.find((u: any) => u.id === parseInt(studentForm.schoolAdminId))?.name || 'Admin école sera assigné automatiquement'}
                      </div>
                    ) : (
                      <select value={studentForm.schoolAdminId} onChange={e => setStudentForm({...studentForm, schoolAdminId: e.target.value})} className="w-full px-3 py-2 bg-slate-50 border border-slate-200 text-xs sm:text-sm rounded-xl">
                        <option value="">-- Choisissez l'admin école --</option>
                        {availableSchoolAdmins.map((u: any) => (
                          <option key={u.id} value={u.id}>{u.name} ({u.email})</option>
                        ))}
                      </select>
                    )}
                  </div>
                </>
              )}
            </div>
          )}

          {/* Form 5: PARENTS */}
          {activeTab === 'parents' && (
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">
                  <RequiredLabel label="Nom du parent d’élève" required />
                </label>
                <input required type="text" value={parentForm.name} onChange={e => { setParentForm({...parentForm, name: e.target.value}); clearFieldError('name'); }} placeholder="M. Koffi" className="w-full px-3 py-2 bg-slate-50 border border-slate-200 text-xs sm:text-sm rounded-xl" />
                {fieldErrors?.name && <p className="mt-1 text-rose-600 text-sm">{fieldErrors.name}</p>}
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">
                  <RequiredLabel label="Email de communication" required />
                </label>
                <input required type="email" value={parentForm.email} onChange={e => setParentForm({...parentForm, email: e.target.value})} placeholder="valerie@damidot.com" className="w-full px-3 py-2 bg-slate-50 border border-slate-200 text-xs sm:text-sm rounded-xl" />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Indicatif</label>
                  <select value={parentForm.phonePrefix} onChange={e => setParentForm({...parentForm, phonePrefix: e.target.value})} className="w-full px-3 py-2 bg-slate-50 border border-slate-200 text-xs sm:text-sm rounded-xl">
                    {sortedParentPhonePrefixes.map((prefix: any) => (
                      <option key={prefix.value} value={prefix.value}>{prefix.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">N° Portable</label>
                  <input required type="text" value={parentForm.phone} onChange={e => setParentForm({...parentForm, phone: e.target.value.replace(/\D/g, '').slice(0, parentForm.phonePrefix === '+228' ? 8 : 20)})} placeholder="90000000" maxLength={parentForm.phonePrefix === '+228' ? 8 : 20} className="w-full px-3 py-2 bg-slate-50 border border-slate-200 text-xs sm:text-sm rounded-xl" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Adresse</label>
                <input type="text" value={parentForm.address} onChange={e => setParentForm({...parentForm, address: e.target.value})} placeholder="Paris..." className="w-full px-3 py-2 bg-slate-50 border border-slate-200 text-xs sm:text-sm rounded-xl" />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Sexe</label>
                <select required value={parentForm.gender} onChange={e => setParentForm({...parentForm, gender: e.target.value})} className="w-full px-3 py-2 bg-slate-50 border border-slate-200 text-xs sm:text-sm rounded-xl">
                  <option value="">-- Choisissez le sexe --</option>
                  <option value="M">Masculin</option>
                  <option value="F">Féminin</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">École</label>
                {userRole === 'school_admin' && currentSchoolId != null ? (
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
                    {autoAssignedParentSchoolName}
                  </div>
                ) : (
                  <select required value={parentForm.schoolId} onChange={e => setParentForm({...parentForm, schoolId: e.target.value})} className="w-full px-3 py-2 bg-slate-50 border border-slate-200 text-xs sm:text-sm rounded-xl">
                    <option value="">-- Choisissez une école --</option>
                    {schoolsList.map((school: any) => (
                      <option key={school.id} value={String(school.id)}>{school.name}</option>
                    ))}
                  </select>
                )}
              </div>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-4">
            <button type="button" onClick={() => onClose && onClose()} className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl text-xs sm:text-sm font-semibold transition-colors cursor-pointer">Annuler</button>
            <button type="submit" className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs sm:text-sm font-semibold shadow-md inline-flex items-center gap-1 cursor-pointer">Enregistrer</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// Close on Escape key as well
// Note: props.isModalOpen handled by parent; this effect runs when component mounted
// to support keyboard dismissal for accessibility.
// eslint-disable-next-line import/no-default-export
