import React, { useState, useRef, useEffect } from 'react';
import { Shield, Settings, BookOpen, Users, Bell, Smartphone, RefreshCw } from 'lucide-react';
import { getSimulatedRole, getSimulatedUser, setSimulatedRole, setSimulatedUser, clearSimulatedRole, clearSimulatedUser, apiFetch } from '../lib/api';
import { School, AcademicYear, Class, Teacher, Student, Parent } from '../types';

interface SimulatorHeaderProps {
  currentRole: string;
  schoolsList: School[];
  classesList?: Class[];
  teachersList?: Teacher[];
  studentsList?: Student[];
  parentsList?: Parent[];
  yearsList: AcademicYear[];
  onRoleChange: (newRole: string) => void;
  onRefreshData: () => void;
  isSyncing: boolean;
  onManageAccounts?: () => void;
  onLogout?: () => Promise<void>;
}

export default function SimulatorHeader({
  currentRole,
  schoolsList,
  classesList = [],
  teachersList = [],
  studentsList = [],
  parentsList = [],
  yearsList = [],
  onRoleChange,
  onRefreshData,
  isSyncing,
  onManageAccounts,
  onLogout,
}: SimulatorHeaderProps) {
  const [simUser, setSimUser] = useState<any | null>(getSimulatedUser());
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const profileRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!profileRef.current) return;
      if (e.target instanceof Node && !profileRef.current.contains(e.target)) {
        setProfileMenuOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setProfileMenuOpen(false);
    }
    document.addEventListener('click', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('click', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, []);
  const defaultSchoolId = schoolsList.length > 0 ? String(schoolsList[0].id) : '';
  const [loginOpen, setLoginOpen] = useState(false);
  const [loginEmail, setLoginEmail] = useState('');
  const [loginName, setLoginName] = useState('');
  const [loginRole, setLoginRole] = useState(currentRole);
  const [loginSchoolId, setLoginSchoolId] = useState(defaultSchoolId);
  const [loginError, setLoginError] = useState<string | null>(null);

  const [createAccountOpen, setCreateAccountOpen] = useState(false);

  React.useEffect(() => {
    if (!loginSchoolId && defaultSchoolId) {
      setLoginSchoolId(defaultSchoolId);
    }
  }, [defaultSchoolId, loginSchoolId]);
  const [createEmail, setCreateEmail] = useState('');
  const [createFirstName, setCreateFirstName] = useState('');
  const [createLastName, setCreateLastName] = useState('');
  const [createPhone, setCreatePhone] = useState('');
  const [createPassword, setCreatePassword] = useState('');
  const [createPasswordConfirm, setCreatePasswordConfirm] = useState('');
  const [createRole, setCreateRole] = useState('teacher');
  const [createGender, setCreateGender] = useState('');
  const [createSchoolId, setCreateSchoolId] = useState('');
  const [createAcademicYearId, setCreateAcademicYearId] = useState('');
  const [createParentSchoolId, setCreateParentSchoolId] = useState('');
  const [createParentClassId, setCreateParentClassId] = useState('');
  const [createSpecializations, setCreateSpecializations] = useState<string[]>([]);
  const [createAssignedClassIds, setCreateAssignedClassIds] = useState<number[]>([]);
  const [showClassSelection, setShowClassSelection] = useState(true);
  const [createError, setCreateError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const createTeacherSchoolId = createRole === 'teacher'
    ? (currentRole === 'school_admin' ? Number(simUser?.schoolId) : (Number(createSchoolId) || undefined))
    : undefined;
  const teacherSpecializations = [
    'Anglais',
    'Français',
    'Histoire-Géographie',
    'Physique-Chimie',
    'SVT',
    'Mathématiques',
    'Philosophie',
    'Espagnol',
    'Allemand',
  ];
  const roles = [
    {
      id: 'super_admin',
      label: 'Super Admin',
      color: 'bg-red-500/10 text-red-700 border-red-200 hover:bg-red-500/20',
      activeColor: 'bg-red-600 text-white border-red-600 focus:ring-red-500',
      description: 'Gestion globale des établissements et des comptes'
    },
    {
      id: 'school_admin',
      label: 'Admin École',
      color: 'bg-amber-500/10 text-amber-700 border-amber-200 hover:bg-amber-500/20',
      activeColor: 'bg-amber-600 text-white border-amber-600 focus:ring-amber-500',
      description: 'Administration de son lycée, classes et inscrits'
    },
    {
      id: 'teacher',
      label: 'Enseignant',
      color: 'bg-indigo-500/10 text-indigo-700 border-indigo-200 hover:bg-indigo-500/20',
      activeColor: 'bg-indigo-600 text-white border-indigo-600 focus:ring-indigo-500',
      description: 'Saisie des notes, appel des absences, évaluations'
    },
    {
      id: 'parent',
      label: 'Parent',
      color: 'bg-emerald-500/10 text-emerald-700 border-emerald-200 hover:bg-emerald-500/20',
      activeColor: 'bg-emerald-600 text-white border-emerald-600 focus:ring-emerald-500',
      description: 'Suivi des notes, justifications, notifications push'
    },
  ];

  const activeRoleDetails = roles.find((r) => r.id === currentRole) || roles[0];

  // resolve teacher profile from teachersList when role is teacher
  const teacherProfile = (teachersList || []).find((t) => t.email && simUser?.email && t.email.toLowerCase() === simUser.email.toLowerCase());
  const teacherClassIds = teacherProfile ? (teacherProfile.classIds || []) : [];
  const teacherClassCount = teacherClassIds.length;
  const teacherClasses = (classesList || []).filter((c) => teacherClassIds.includes(c.id));
  const teacherStudents = (studentsList || []).filter((s) => teacherClassIds.includes(s.classId));
  const [fetchedSchoolName, setFetchedSchoolName] = useState<string | null>(null);

  // resolve parent profile when role is parent
  const parentProfile = (parentsList || []).find((p) => {
    const byUid = simUser?.uid && String(p.userId) === String(simUser.uid);
    const byEmail = simUser?.email && p.email?.toLowerCase() === simUser.email.toLowerCase();
    return Boolean(byUid || byEmail);
  });

  const displayName = currentRole === 'parent'
    ? (parentProfile ? `${parentProfile.firstName} ${parentProfile.lastName}` : (simUser?.name || simUser?.displayName || simUser?.email || 'Parent connecté'))
    : (simUser?.name || simUser?.displayName || simUser?.email || 'Utilisateur');

  useEffect(() => {
    let sid = teacherProfile?.schoolId ?? null;
    let cancelled = false;
    (async () => {
      try {
        if (!sid) {
          // Try debug endpoint to resolve teacherRow when teachersList doesn't include it
          if (currentRole === 'teacher') {
            const dbg = await apiFetch('/api/debug/sim-profile');
            sid = dbg?.teacherRow?.schoolId ?? null;
          }
        }
        if (!sid) return;
        // If schoolsList doesn't contain the teacher's school, fetch it individually
        const found = schoolsList.find((s) => Number(s.id) === Number(sid));
        if (found) {
          if (!cancelled) setFetchedSchoolName(found.name);
          return;
        }
        const res = await apiFetch(`/api/schools/${sid}`);
        if (!cancelled && res && res.name) setFetchedSchoolName(res.name);
      } catch (e) {
        // ignore; permission may be denied or endpoint missing
      }
    })();
    return () => { cancelled = true; };
  }, [teacherProfile?.schoolId, schoolsList]);

  return (
    <div className="bg-slate-900 text-white border-b border-slate-800" id="simulator-header">
      {/* Simulation Sandbox indicator */}
      <div className="px-4 py-2 bg-gradient-to-r from-indigo-900 via-purple-950 to-indigo-900 flex flex-wrap justify-between items-center text-xs gap-2">
        <div className="flex items-center gap-2">
          <span className="inline-flex h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
          <span className="font-medium tracking-wide uppercase text-slate-200">
            Console de Simulation Architecture EdTech - EcoleTrack
          </span>
        </div>
        <div className="text-slate-300">
          Mode bac à sable : basculez d'un rôle à l'autre pour tester instantanément
        </div>
        <div className="text-slate-200 text-sm">
          {simUser ? (
            (() => {
              const sid = simUser?.schoolId ?? simUser?.school?.id ?? teacherProfile?.schoolId ?? null;
              const schoolName = sid ? (schoolsList.find((s) => s.id === Number(sid))?.name || fetchedSchoolName) : null;
              return (
                <>
                  <div className="flex flex-col">
                    <div className="flex items-center gap-2">
                      <span>{displayName}</span>
                      {schoolName ? <span className="ml-2 text-slate-400">— {schoolName}</span> : null}
                    </div>
                    {currentRole === 'teacher' ? (
                      <div className="text-xs text-slate-400 mt-1">
                        Profil enseignant: {teacherProfile ? `ID ${teacherProfile.id}` : 'non trouvé'} · Classes: {teacherClassCount} · Élèves: {teacherStudents.length}
                      </div>
                    ) : null}
                  </div>
                </>
              );
            })()
          ) : 'Aucun utilisateur connecté'}
        </div>
      </div>
      {/* Login modal */}
      {loginOpen && (
        <div className="fixed inset-0 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-md text-slate-800">
            <h3 className="font-bold mb-3">Se connecter (simulation)</h3>
            <div className="space-y-4 text-sm">
              <div>
                <label className="block text-xs">Rôle</label>
                <select
                  className="w-full p-2 border rounded"
                  value={loginRole}
                  onChange={(e) => {
                    const nextRole = e.target.value;
                    setLoginRole(nextRole);
                    if (nextRole !== 'super_admin') {
                      setLoginSchoolId(defaultSchoolId);
                    }
                  }}
                >
                  <option value="super_admin">Super Admin</option>
                  <option value="school_admin">Admin École</option>
                  <option value="teacher">Enseignant</option>
                  <option value="parent">Parent</option>
                </select>
              </div>

              <div>
                <label className="block text-xs">Email</label>
                <input
                  className="w-full p-2 border rounded"
                  value={loginEmail}
                  onChange={(e) => setLoginEmail(e.target.value)}
                  placeholder="email@exemple.fr"
                />
              </div>

              <div>
                <label className="block text-xs">Nom</label>
                <input
                  className="w-full p-2 border rounded"
                  value={loginName}
                  onChange={(e) => setLoginName(e.target.value)}
                  placeholder="M. Koffi"
                />
              </div>

              {loginRole !== 'super_admin' && (
                <div>
                  <label className="block text-xs">École</label>
                  <select
                    className="w-full p-2 border rounded"
                    value={loginSchoolId}
                    onChange={(e) => setLoginSchoolId(e.target.value)}
                  >
                    <option value="">-- Choisissez l'école --</option>
                    {schoolsList.map((school) => (
                      <option key={school.id} value={String(school.id)}>{school.name}</option>
                    ))}
                  </select>
                </div>
              )}

              {loginError && <div className="text-rose-600 text-sm">{loginError}</div>}

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  className="px-3 py-2 rounded bg-slate-100"
                  onClick={() => setLoginOpen(false)}
                >
                  Annuler
                </button>
                <button
                  type="button"
                  className="px-3 py-2 rounded bg-indigo-600 text-white"
                  onClick={async () => {
                    try {
                      setLoginError(null);
                      const uid = `${loginRole}_${Date.now()}`;
                      const name = loginName || `${loginRole} Test`;
                      const email = loginEmail || `${uid}@example.test`;
                      const resolvedSchoolId = loginRole === 'super_admin' ? undefined : (Number(loginSchoolId) || undefined);
                      if (loginRole !== 'super_admin' && !resolvedSchoolId) {
                        setLoginError('Veuillez sélectionner une école pour ce rôle.');
                        return;
                      }
                      // Persist simulation headers
                      setSimulatedRole(loginRole as any);
                      setSimulatedUser({ uid, email, name, schoolId: resolvedSchoolId });
                      setSimUser({ uid, email, name, schoolId: resolvedSchoolId });
                      // Trigger backend register-or-login to ensure user profile exists
                      try {
                        await apiFetch('/api/auth/register-or-login', { method: 'POST' });
                      } catch (e) {
                        // ignore; user may already exist
                      }
                      onRoleChange(loginRole);
                      onRefreshData();
                      setLoginOpen(false);
                    } catch (err: any) {
                      setLoginError(err?.message || 'Erreur de connexion');
                    }
                  }}
                >
                  Se connecter
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Create Account modal */}
      {createAccountOpen && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-3xl max-h-[90vh] overflow-auto text-slate-800 shadow-xl relative z-[10000]">
            <div className="flex items-start justify-between mb-4">
              <h3 className="font-bold">Créer un nouveau compte</h3>
              <button aria-label="Fermer" className="text-slate-400 hover:text-slate-600 font-bold text-lg" onClick={() => setCreateAccountOpen(false)}>✕</button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
              <div>
                <label className="block text-xs">Rôle</label>
                <select
                  className="w-full p-2 border rounded"
                  value={createRole}
                  onChange={(e) => {
                    const selectedRole = e.target.value;
                    setCreateRole(selectedRole);
                    if (selectedRole !== 'school_admin' && !(selectedRole === 'teacher' && currentRole === 'school_admin')) {
                      setCreateSchoolId('');
                    }
                    if (selectedRole !== 'school_admin') {
                      setCreateAcademicYearId('');
                    }
                    if (selectedRole === 'teacher' && currentRole === 'school_admin') {
                      setCreateSchoolId(String(simUser?.schoolId ?? ''));
                    }
                    if (selectedRole === 'parent' && currentRole === 'school_admin') {
                      setCreateParentSchoolId(String(simUser?.schoolId ?? ''));
                      setCreateParentClassId('');
                    }
                    if (selectedRole !== 'teacher') {
                      setCreateAssignedClassIds([]);
                    }
                    if (selectedRole !== 'parent') {
                      setCreateParentSchoolId('');
                      setCreateParentClassId('');
                    }
                  }}
                >
                  {currentRole === 'super_admin' ? (
                    <>
                      <option value="super_admin">Super Admin</option>
                      <option value="school_admin">Admin École</option>
                    </>
                  ) : null}
                  <option value="teacher">Enseignant</option>
                  <option value="parent">Parent</option>
                </select>
              </div>

              {createRole === 'school_admin' && (
                <>
                  <div>
                    <label className="block text-xs">École</label>
                    <select className="w-full p-2 border rounded" value={createSchoolId} onChange={(e) => {
                      setCreateSchoolId(e.target.value);
                      setCreateAcademicYearId('');
                    }}>
                      <option value="">-- Choisir une école --</option>
                      {schoolsList.length > 0 ? (
                        schoolsList.map((school) => (
                          <option key={school.id} value={String(school.id)}>{school.name}</option>
                        ))
                      ) : (
                        <option value="">Aucune école disponible</option>
                      )}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs">Année scolaire</label>
                    <select className="w-full p-2 border rounded" value={createAcademicYearId} onChange={(e) => setCreateAcademicYearId(e.target.value)}>
                      <option value="">-- Choisir une année --</option>
                      {yearsList.length > 0 ? (
                        yearsList
                          .filter((year) => year.schoolId == null)
                          .map((year) => (
                            <option key={year.id} value={String(year.id)}>{year.name}</option>
                          ))
                      ) : (
                        <option value="">Aucune année disponible</option>
                      )}
                    </select>
                  </div>
                </>
              )}

              {createRole === 'parent' && (
                <>
                  <div>
                    <label className="block text-xs">École</label>
                    {currentRole === 'school_admin' ? (
                      <div className="w-full p-2 border rounded bg-slate-50 text-slate-600">
                        {schoolsList.find((s) => s.id === simUser?.schoolId)?.name || 'École assignée automatiquement'}
                      </div>
                    ) : (
                      <select className="w-full p-2 border rounded" value={createParentSchoolId} onChange={(e) => {
                        setCreateParentSchoolId(e.target.value);
                        setCreateParentClassId('');
                      }}>
                        <option value="">-- Choisir une école --</option>
                        {schoolsList.length > 0 ? (
                          schoolsList.map((school) => (
                            <option key={school.id} value={String(school.id)}>{school.name}</option>
                          ))
                        ) : (
                          <option value="">Aucune école disponible</option>
                        )}
                      </select>
                    )}
                  </div>
                  <div>
                    <label className="block text-xs">Classe</label>
                    <select className="w-full p-2 border rounded" value={createParentClassId} onChange={(e) => {
                      setCreateParentClassId(e.target.value);
                    }}>
                      <option value="">-- Choisir une classe --</option>
                      {createParentSchoolId ? (
                        (classesList || [])
                          .filter((cls) => String(cls.schoolId) === createParentSchoolId)
                          .map((cls) => (
                            <option key={cls.id} value={String(cls.id)}>{cls.name}</option>
                          ))
                      ) : (
                        <option value="">Sélectionnez d'abord une école</option>
                      )}
                    </select>
                  </div>
                </>
              )}

              <div>
                <label className="block text-xs">Email</label>
                <input className="w-full p-2 border rounded" value={createEmail} onChange={(e) => setCreateEmail(e.target.value)} placeholder="email@exemple.fr" />
              </div>

              <div>
                <label className="block text-xs">Nom</label>
                <input className="w-full p-2 border rounded" value={createLastName} onChange={(e) => setCreateLastName(e.target.value)} placeholder="Dupont" />
              </div>

              <div>
                <label className="block text-xs">Prénom(s)</label>
                <input className="w-full p-2 border rounded" value={createFirstName} onChange={(e) => setCreateFirstName(e.target.value)} placeholder="Jean" />
              </div>

              <div>
                <label className="block text-xs">Numéro de téléphone</label>
                <div className="flex items-center border rounded overflow-hidden">
                  <span className="px-2 py-2 bg-slate-100 text-slate-500 text-sm font-medium">+228</span>
                  <input className="flex-1 p-2 border-0 outline-none" type="tel" value={createPhone} onChange={(e) => setCreatePhone(e.target.value.replace(/\D/g, '').slice(0, 8))} placeholder="90000000" maxLength={8} />
                </div>
              </div>

              {(createRole === 'teacher' || createRole === 'parent') && (
                <div>
                  <label className="block text-xs">Sexe</label>
                  <select className="w-full p-2 border rounded" value={createGender} onChange={(e) => setCreateGender(e.target.value)}>
                    <option value="">-- Choisir le sexe --</option>
                    <option value="M">Masculin</option>
                    <option value="F">Féminin</option>
                    <option value="other">Autre</option>
                  </select>
                </div>
              )}

              {createRole === 'teacher' && (
                <>
                  <div>
                    <label className="block text-xs">École</label>
                    {currentRole === 'school_admin' ? (
                      <div className="w-full p-2 border rounded bg-slate-50 text-slate-600">
                        {schoolsList.find((s) => s.id === simUser?.schoolId)?.name || 'École assignée automatiquement'}
                      </div>
                    ) : (
                      <select
                        className="w-full p-2 border rounded"
                        value={createSchoolId}
                        onChange={(e) => {
                          setCreateSchoolId(e.target.value);
                          setCreateAssignedClassIds([]);
                        }}
                      >
                        <option value="">-- Choisir une école --</option>
                        {schoolsList.map((school) => (
                          <option key={school.id} value={String(school.id)}>{school.name}</option>
                        ))}
                      </select>
                    )}
                  </div>

                  <div>
                    <label className="block text-xs">Spécialisation</label>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 border border-slate-200 rounded p-2 bg-slate-50 max-h-56 overflow-auto">
                      {teacherSpecializations.map((subject) => (
                        <label key={subject} className="flex items-center gap-2 px-2 py-1 rounded hover:bg-slate-100 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={createSpecializations.includes(subject)}
                            onChange={() => {
                              if (createSpecializations.includes(subject)) {
                                setCreateSpecializations(createSpecializations.filter((item) => item !== subject));
                              } else {
                                setCreateSpecializations([...createSpecializations, subject]);
                              }
                            }}
                            className="h-4 w-4 accent-indigo-600"
                          />
                          <span className="text-sm text-slate-700">{subject}</span>
                        </label>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs">Classes assignées</label>
                    {showClassSelection ? (
                      <>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-44 overflow-y-auto border border-slate-200 rounded p-2 bg-slate-50 text-sm">
                          {(classesList || [])
                            .filter((cls) => !createTeacherSchoolId || cls.schoolId === createTeacherSchoolId)
                            .map((cls) => (
                              <label key={cls.id} className="flex items-center gap-2 rounded-lg px-2 py-2 cursor-pointer hover:bg-slate-100 border border-transparent hover:border-slate-200">
                                <input
                                  type="checkbox"
                                  checked={createAssignedClassIds.includes(cls.id)}
                                  onChange={() => {
                                    if (createAssignedClassIds.includes(cls.id)) {
                                      setCreateAssignedClassIds(createAssignedClassIds.filter((id) => id !== cls.id));
                                    } else {
                                      setCreateAssignedClassIds([...createAssignedClassIds, cls.id]);
                                    }
                                  }}
                                  className="h-4 w-4 accent-indigo-600"
                                />
                                <span className="truncate">{cls.name}</span>
                              </label>
                            ))}
                          {(classesList || []).filter((cls) => !createTeacherSchoolId || cls.schoolId === createTeacherSchoolId).length === 0 && (
                            <div className="text-slate-500">Sélectionnez d'abord une école pour afficher les classes disponibles.</div>
                          )}
                        </div>
                        <div className="flex flex-wrap gap-2 items-center mt-2">
                          <button
                            type="button"
                            className="px-3 py-1.5 rounded bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700"
                            onClick={() => setShowClassSelection(false)}
                            disabled={createAssignedClassIds.length === 0}
                          >
                            Valider la sélection
                          </button>
                          <span className="text-xs text-slate-500">Vous pouvez sélectionner plusieurs classes avant de valider.</span>
                        </div>
                      </>
                    ) : null}
                    {createAssignedClassIds.length > 0 && (
                      <div className="mt-2 text-xs text-slate-700 bg-slate-100 p-2 rounded border border-slate-200">
                        <strong>Classes sélectionnées :</strong>{' '}
                        {(classesList || [])
                          .filter((cls) => createAssignedClassIds.includes(cls.id))
                          .map((cls) => cls.name)
                          .join(', ')}
                      </div>
                    )}
                    {!showClassSelection && (
                      <button
                        type="button"
                        className="mt-2 text-xs text-indigo-600 hover:underline"
                        onClick={() => setShowClassSelection(true)}
                      >
                        Modifier la sélection des classes
                      </button>
                    )}
                  </div>
                </>
              )}

              <div>
                <label className="block text-xs">Mot de passe</label>
                <input className="w-full p-2 border rounded" type="password" value={createPassword} onChange={(e) => setCreatePassword(e.target.value)} placeholder="••••••••" />
              </div>

              <div>
                <label className="block text-xs">Confirmer le mot de passe</label>
                <input className="w-full p-2 border rounded" type="password" value={createPasswordConfirm} onChange={(e) => setCreatePasswordConfirm(e.target.value)} placeholder="••••••••" />
              </div>
            </div>

            <div className="mt-2">
              {createError && <div className="text-rose-600 text-sm">{createError}</div>}
            </div>

            <div className="flex justify-end gap-2 mt-3">
              <button className="px-3 py-2 rounded bg-slate-100" onClick={() => setCreateAccountOpen(false)} disabled={isCreating}>Annuler</button>
              <button className="px-3 py-2 rounded bg-emerald-600 text-white" onClick={async () => {
                try {
                  setCreateError(null);
                  if (createPhone.length !== 8) {
                    setCreateError('Le numéro de téléphone doit contenir 8 chiffres');
                    return;
                  }
                  if (!createEmail) {
                    setCreateError('L’email est requis');
                    return;
                  }
                  if (!createPassword || createPassword.length < 6) {
                    setCreateError('Le mot de passe doit contenir au moins 6 caractères');
                    return;
                  }
                  if (createRole === 'school_admin' && !createSchoolId) {
                    setCreateError('Une école est requise pour un Admin École');
                    return;
                  }
                  if (createRole === 'school_admin' && !createAcademicYearId) {
                    setCreateError('Une année scolaire est requise pour un Admin École');
                    return;
                  }
                  if (createRole === 'parent' && !createParentSchoolId) {
                    setCreateError('Une école est requise pour un parent');
                    return;
                  }
                  if (createRole === 'teacher' || createRole === 'parent') {
                    if (!createGender) {
                      setCreateError('Le sexe est requis pour les parents et les enseignants');
                      return;
                    }
                  }
                  if (createRole === 'teacher') {
                    if (currentRole !== 'school_admin' && !createSchoolId) {
                      setCreateError('Une école est requise pour un enseignant');
                      return;
                    }
                    if (!Array.isArray(createSpecializations) || createSpecializations.length === 0) {
                      setCreateError('Au moins une spécialisation est requise pour un enseignant');
                      return;
                    }
                    if (!Array.isArray(createAssignedClassIds) || createAssignedClassIds.length === 0) {
                      setCreateError('Veuillez sélectionner au moins une classe pour l\'enseignant');
                      return;
                    }
                  }
                  if (createPassword !== createPasswordConfirm) {
                    setCreateError('Les mots de passe ne correspondent pas');
                    return;
                  }
                  setIsCreating(true);
                  const name = `${createFirstName} ${createLastName}`.trim() || `${createRole} Test`;
                  const payload: any = {
                    email: createEmail,
                    name,
                    role: createRole,
                    phone: `+228${createPhone}`,
                    specialization: createRole === 'teacher' ? createSpecializations : undefined,
                  };
                  if (createRole === 'school_admin') {
                    payload.schoolId = parseInt(createSchoolId);
                    payload.academicYearId = parseInt(createAcademicYearId);
                  } else if (createRole === 'teacher') {
                    payload.schoolId = currentRole === 'school_admin'
                      ? simUser?.schoolId
                      : parseInt(createSchoolId);
                    payload.classIds = createAssignedClassIds;
                  } else if (createRole === 'parent') {
                    payload.schoolId = parseInt(createParentSchoolId);
                  }

                  if (createRole === 'teacher' || createRole === 'parent') {
                    payload.gender = createGender;
                  }

                  const createdUser = await apiFetch('/api/admin/users', {
                    method: 'POST',
                    body: JSON.stringify({ ...payload, password: createPassword }),
                  });

                  setCreateAccountOpen(false);
                  setCreateEmail('');
                  setCreateFirstName('');
                  setCreateLastName('');
                  setCreatePhone('');
                  setCreatePassword('');
                  setCreatePasswordConfirm('');
                  setCreateRole('teacher');
                  setCreateSchoolId('');
                  setCreateAcademicYearId('');
                  setCreateParentSchoolId('');
                  setCreateParentClassId('');
                  setCreateSpecializations([]);
                  setCreateAssignedClassIds([]);
                  setCreateGender('');
                  onRefreshData();
                } catch (err: any) {
                  setCreateError(err?.message || 'Erreur lors de la création du compte');
                } finally {
                  setIsCreating(false);
                }
              }} disabled={isCreating}>
                {isCreating ? 'Création...' : 'Créer'}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="max-w-7xl mx-auto p-4 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        {/* Title */}
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-indigo-600 rounded-xl leading-none">
            <BookOpen className="h-6 w-6 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-white flex items-center gap-2">
              EcoleTrack <span className="text-xs bg-slate-800 border border-slate-700 text-indigo-400 px-2 py-0.5 rounded-full">v1.0-STABLE</span>
            </h1>
            <p className="text-xs text-slate-400">Architecture REST, PostgreSQL, Firebase Messaging</p>
          </div>
        </div>

        {/* Dynamic Buttons */}
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 w-full md:w-auto">
          {/* Quick role switch */}
          <div className="flex flex-wrap gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800">
            {roles
              .filter(role => role.id === currentRole)
              .map((role) => {
              const isActive = role.id === currentRole;
              return (
                <button
                  key={role.id}
                  onClick={() => onRoleChange(role.id)}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${
                    isActive
                      ? role.activeColor + ' shadow-md shadow-indigo-950/50'
                      : 'text-slate-400 hover:text-white hover:bg-slate-900'
                  }`}
                  title={role.description}
                  id={`btn-sim-${role.id}`}
                >
                  {role.label}
                </button>
              );
            })}
          </div>

          <button
            onClick={onRefreshData}
            disabled={isSyncing}
            className="flex items-center justify-center gap-2 px-3 py-1.5 md:py-2 text-xs font-medium text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700/80 rounded-xl transition-colors border border-slate-700/60 disabled:opacity-50"
            title="Rafraîchir les données"
            id="btn-sim-refresh"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
            {"Données"}
          </button>

          {/* Profile menu */}
          <div className="relative" ref={profileRef}>
            <button
              onClick={() => setProfileMenuOpen(!profileMenuOpen)}
              className="ml-2 px-3 py-1.5 flex items-center gap-2 text-xs font-medium text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700/80 rounded-xl transition-colors border border-slate-700/60"
              title="Profil"
              id="btn-sim-profile"
            >
              <Users className="h-4 w-4" />
              <span className="hidden sm:inline">{simUser ? simUser.name : 'Profil'}</span>
            </button>

            {profileMenuOpen && (
              <div className="absolute right-0 mt-2 w-48 bg-white text-slate-800 rounded shadow-lg z-40">
                <div className="p-3 border-b text-sm">
                  <div className="font-semibold">{simUser ? simUser.name : 'Aucun utilisateur'}</div>
                  <div className="text-xs text-slate-500">{simUser ? simUser.email : ''}</div>
                </div>
                <div className="p-2 flex flex-col gap-1">
                  {currentRole !== 'parent' && (
                    <button
                      type="button"
                      className="text-left px-2 py-2 text-sm hover:bg-slate-100 rounded text-indigo-600 font-medium"
                      onClick={() => {
                        setCreateAccountOpen(true);
                        setProfileMenuOpen(false);
                      }}
                    >
                      ➕ Créer un compte
                    </button>
                  )}
                  <button type="button" className="text-left px-2 py-2 text-sm hover:bg-slate-100 rounded text-indigo-600 font-medium" onClick={() => { if (onManageAccounts) onManageAccounts(); setProfileMenuOpen(false); }}>⚙️ Gestion des comptes</button>
                  <button type="button" className="text-left px-2 py-2 text-sm hover:bg-slate-100 rounded" onClick={async () => {
                    setProfileMenuOpen(false);
                    if (onLogout) await onLogout();
                  }}>Se déconnecter</button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
      
      {/* Context disclaimer */}
      <div className="bg-slate-950/60 border-t border-slate-800/80 px-4 py-2.5 text-xs text-slate-400">
        <div className="max-w-7xl mx-auto flex items-center gap-2">
          <Shield className="h-4 w-4 text-slate-400 shrink-0" />
          <span>
            Rôle Actif : <strong className="text-slate-200">{activeRoleDetails.label}</strong> — {activeRoleDetails.description}
          </span>
        </div>
      </div>
    </div>
  );
}
