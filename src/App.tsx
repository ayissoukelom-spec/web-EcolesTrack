import React, { useState, useEffect } from 'react';
import {
  School,
  AcademicYear,
  Class,
  Teacher,
  Student,
  Parent,
  SystemNotification,
  User,
  UserRole,
  AuditEvent
} from './types.ts';
import {
  apiFetch,
  getSimulatedRole,
  setSimulatedRole,
  clearSimulatedRole,
  clearSimulatedUser,
  getSimulatedSchoolId,
  getSimulatedUser,
  setSimulatedUser,
} from './lib/api.ts';
import { upsertGradeInList } from './lib/gradeState';
import SimulatorHeader from './components/SimulatorHeader.tsx';
import LoginView from './components/LoginView.tsx';
import DashboardView from './components/DashboardView.tsx';
import AdminView from './components/AdminView.tsx';
import ErrorBoundary from './components/ErrorBoundary.tsx';
import AbsenceView from './components/AbsenceView.tsx';
import NotesView from './components/NotesView.tsx';
import NotificationView from './components/NotificationView.tsx';
import AuditView from './components/AuditView.tsx';
import MobileParentView from './components/MobileParentView.tsx';
import ArchiveView from './components/ArchiveView.tsx';

import {
  LayoutDashboard,
  Building2,
  CalendarDays,
  Award,
  Bell,
  Smartphone,
  Info,
  BookOpen,
  LogOut,
  RefreshCw,
  AlertCircle
} from 'lucide-react';

export default function App() {
  const [currentRole, setCurrentRole] = useState<UserRole>('' as UserRole);
  const [currentSchoolId, setCurrentSchoolId] = useState<number | null>(getSimulatedSchoolId());
  const [superAdminSchoolFilterId, setSuperAdminSchoolFilterId] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState('tableau-de-bord');
  const [isSyncing, setIsSyncing] = useState(false);
  const [isAuditLoading, setIsAuditLoading] = useState(false);
  const [importResult, setImportResult] = useState<any | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // States loaded from backend
  const [stats, setStats] = useState({
    totalStudents: 0,
    totalAbsences: 0,
    totalClasses: 0,
    totalTeachers: 0,
    attendanceRate: 94.5,
  });
  const [schoolsList, setSchoolsList] = useState<School[]>([]);
  const [yearsList, setYearsList] = useState<AcademicYear[]>([]);
  const [classesList, setClassesList] = useState<Class[]>([]);
  const [teachersList, setTeachersList] = useState<Teacher[]>([]);
  const [studentsList, setStudentsList] = useState<Student[]>([]);
  const [parentsList, setParentsList] = useState<Parent[]>([]);
  const [absencesList, setAbsencesList] = useState<any[]>([]);
  const [summaryRecentAbsences, setSummaryRecentAbsences] = useState<any[]>([]);
  const [evaluationsList, setEvaluationsList] = useState<any[]>([]);
  const [gradesList, setGradesList] = useState<any[]>([]);
  const [summaryRecentGrades, setSummaryRecentGrades] = useState<any[]>([]);
  const [notificationsList, setNotificationsList] = useState<SystemNotification[]>([]);
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);
  const [usersList, setUsersList] = useState<User[]>([]);

  const simulatedUser = getSimulatedUser();
  const currentUser = simulatedUser
    ? usersList.find((u) => String(u.uid) === String(simulatedUser.uid)
      || (u.email && simulatedUser.email && u.email.toLowerCase() === simulatedUser.email.toLowerCase()))
    : undefined;

  const currentTeacherProfile = currentRole === 'teacher'
    ? teachersList.find((t) => {
      const emailMatch = simulatedUser?.email && t.email?.toLowerCase() === simulatedUser.email.toLowerCase();
      const userIdFromUid = simulatedUser?.uid?.startsWith('teacher_') ? Number(simulatedUser.uid.split('_')[1]) : NaN;
      const userIdMatch = !Number.isNaN(userIdFromUid) && String(t.userId) === String(userIdFromUid);
      return (currentUser && t.userId === currentUser.id) || emailMatch || userIdMatch;
    })
    : undefined;

  const currentTeacherClassIds = currentTeacherProfile?.classIds || [];
  const currentTeacherSpecializations = currentTeacherProfile?.specialization
    ? Array.isArray(currentTeacherProfile.specialization)
      ? currentTeacherProfile.specialization
      : String(currentTeacherProfile.specialization).split(',').map((item) => item.trim()).filter(Boolean)
    : [];

  const fetchAuditEvents = async () => {
    if (currentRole !== 'super_admin') {
      setAuditEvents([]);
      return;
    }

    setIsAuditLoading(true);
    try {
      const events = await apiFetch('/api/audit/events');
      setAuditEvents(events);
    } catch (auditErr: any) {
      console.warn('Impossible de charger le journal d\'événements :', auditErr);
      setAuditEvents([]);
      setErrorMsg('Impossible de charger le journal des actions.');
    } finally {
      setIsAuditLoading(false);
    }
  };

  // Authenticate & Fetch data on load and whenever simulation role changes
  const fetchAllData = async (showSpinner = true) => {
    if (showSpinner) setIsSyncing(true);
    setErrorMsg(null);
    try {
      // 1. Sync authentication role switcher context
      await apiFetch('/api/auth/register-or-login', { method: 'POST' });

      // 2. Load dashboard summary & role details
      const summary = await apiFetch('/api/dashboard/summary');
      console.log('[TMP-GENDER-DEBUG][APP] /api/dashboard/summary response', {
        stats: summary?.stats,
        keys: summary?.stats ? Object.keys(summary.stats) : [],
      });
      setStats(summary.stats);
      setSummaryRecentGrades(summary.recentGrades);
      setSummaryRecentAbsences(summary.recentAbsences);
      setAbsencesList(summary.recentAbsences); // standard overview holds latest

      // 3. Load other lists for CRUD and management tabs
      const endpoints = [
        '/api/schools',
        '/api/academic-years',
        '/api/classes',
        '/api/teachers',
        '/api/students',
        '/api/parents',
        '/api/absences',
        '/api/evaluations',
        '/api/grades',
        '/api/notifications',
        '/api/simulation/users',
      ];

      const promises = endpoints.map(e => apiFetch(e).catch((err) => ({ __error: true, error: err })));
      const results = await Promise.all(promises);

      const map = Object.fromEntries(endpoints.map((e, i) => [e, results[i]]));

      setSchoolsList(Array.isArray(map['/api/schools']) ? map['/api/schools'] : []);
      setYearsList(Array.isArray(map['/api/academic-years']) ? map['/api/academic-years'] : []);
      setClassesList(Array.isArray(map['/api/classes']) ? map['/api/classes'] : []);
      setTeachersList(Array.isArray(map['/api/teachers']) ? map['/api/teachers'] : []);
      setStudentsList(Array.isArray(map['/api/students']) ? map['/api/students'] : []);
      setParentsList(Array.isArray(map['/api/parents']) ? map['/api/parents'] : []);
      setAbsencesList(Array.isArray(map['/api/absences']) ? map['/api/absences'] : []);
      setEvaluationsList(Array.isArray(map['/api/evaluations']) ? map['/api/evaluations'] : []);
      setGradesList(Array.isArray(map['/api/grades']) ? map['/api/grades'] : []);
      setNotificationsList(Array.isArray(map['/api/notifications']) ? map['/api/notifications'] : []);
      setUsersList(Array.isArray(map['/api/simulation/users']) ? map['/api/simulation/users'] : []);

      if (currentRole === 'super_admin') {
        await fetchAuditEvents();
      } else {
        setAuditEvents([]);
      }
    } catch (err: any) {
      console.error('Error hydrating EcoleTrack database:', err);
      setErrorMsg(err.message || 'Impossible de charger les données EcoleTrack.');
    } finally {
      setIsSyncing(false);
    }
  };

  useEffect(() => {
    // Read cached role
    const savedRole = getSimulatedRole();
    setCurrentRole(savedRole ? (savedRole as UserRole) : ('' as UserRole));

    // Handle browser back/forward (popstate)
    const onPopState = () => {
      const newRole = getSimulatedRole();
      setCurrentRole(newRole ? (newRole as UserRole) : ('' as UserRole));
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  useEffect(() => {
    if (currentRole !== 'super_admin') {
      setSuperAdminSchoolFilterId(null);
    }
    if (currentRole) fetchAllData();
  }, [currentRole]);

  useEffect(() => {
    if (activeTab === 'audit' && currentRole === 'super_admin') {
      fetchAuditEvents();
    }
  }, [activeTab, currentRole]);

  const handleRoleChange = (newRole: string) => {
    if (!newRole) {
      clearSimulatedRole();
      clearSimulatedUser();
      setCurrentRole('' as UserRole);
      setCurrentSchoolId(null);
      window.history.replaceState(null, '', '/login');
      return;
    }
    // Ensure there's a simulated user set when switching roles quickly.
    const existingSimUser = getSimulatedUser();
    if (!existingSimUser) {
      if (newRole === 'teacher') {
        // pick a teacher in the current school if available, otherwise a generic teacher
        const preferred = teachersList.find((t) => t.schoolId === currentSchoolId) || teachersList[0];
        if (preferred) {
          setSimulatedUser({ uid: `teacher_${preferred.userId || preferred.id}`, email: preferred.email || '', name: preferred.name || 'Enseignant', schoolId: preferred.schoolId });
        } else {
          setSimulatedUser({ uid: `sim_teacher_${Date.now()}`, email: 'sim_teacher@example.test', name: 'Enseignant Simulé', schoolId: currentSchoolId });
        }
      } else if (newRole === 'school_admin') {
        setSimulatedUser({ uid: `sim_schooladmin_${Date.now()}`, email: 'sim_schooladmin@example.test', name: 'Admin Ecole', schoolId: currentSchoolId });
      } else if (newRole === 'parent') {
        setSimulatedUser({ uid: `sim_parent_${Date.now()}`, email: 'sim_parent@example.test', name: 'Parent Simulé', schoolId: currentSchoolId });
      }
    }

    setSimulatedRole(newRole);
    const simulatedSchoolId = getSimulatedSchoolId();
    setCurrentRole(newRole as UserRole);
    setCurrentSchoolId(simulatedSchoolId);
    window.history.replaceState(null, '', '/');
  };

  const handleLogout = async () => {
    clearSimulatedRole();
    clearSimulatedUser();
    setCurrentRole('' as UserRole);
    setCurrentSchoolId(null);
    try {
      await apiFetch('/api/auth/logout', { method: 'POST' });
    } catch (e) {
      console.warn('Logout request failed', e);
    }
    window.location.replace('/login');
  };

  // ==========================================
  // HANDLERS FOR CREATIONS (POSTS REST API)
  // ==========================================

  const handleAddSchool = async (data: { name: string; address: string; phone: string; classNames?: string[] }) => {
    try {
      const createdSchool = await apiFetch('/api/schools', {
        method: 'POST',
        body: JSON.stringify(data),
      });
      await fetchAllData(false);
      return createdSchool;
    } catch (err: any) {
      setErrorMsg(err.message || 'Impossible d\'ajouter l\'école');
      throw err;
    }
  };

  const handleAddYear = async (data: { name: string; isActive: boolean; schoolId?: number }) => {
    try {
      await apiFetch('/api/academic-years', {
        method: 'POST',
        body: JSON.stringify(data),
      });
      await fetchAllData(false);
    } catch (err: any) {
      setErrorMsg(err.message || 'Impossible d\'ajouter l\'année');
      throw err;
    }
  };

  const handleAddClass = async (data: { name: string; schoolId: number; academicYearId: number; teacherId?: number }) => {
    try {
      await apiFetch('/api/classes', {
        method: 'POST',
        body: JSON.stringify(data),
      });
      await fetchAllData(false);
    } catch (err: any) {
      setErrorMsg(err.message || 'Impossible de créer la classe');
      throw err;
    }
  };

  const handleDeleteClass = async (id: number) => {
    try {
      await apiFetch(`/api/classes/${id}`, { method: 'DELETE' });
      fetchAllData();
    } catch (err: any) {
      setErrorMsg(err.message || 'Suppression impossible');
    }
  };

  const handleDeleteSchool = async (id: number) => {
    try {
      await apiFetch(`/api/schools/${id}`, { method: 'DELETE' });
      fetchAllData();
    } catch (err: any) {
      if (err.message && err.message.includes('École introuvable')) {
        setErrorMsg('L’école demandée n’existe plus. Rafraîchissez la page puis réessayez.');
        await fetchAllData();
      } else {
        setErrorMsg(err.message || 'Impossible de supprimer l’école.');
      }
    }
  };
  const handleUpdateSchool = async (id: number, data: { name: string; address: string; phone: string; classNames?: string[] }) => {
    try {
      await apiFetch(`/api/schools/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      });
      fetchAllData();
    } catch (err: any) {
      setErrorMsg(err.message || 'Impossible de mettre à jour l\'école');
      throw err;
    }
  };

  const handleUpdateStudent = async (id: number, data: { firstName: string; lastName: string; birthDate: string | null; schoolId?: number; classId: number; parentId: number; academicYearId?: number; teacherIds?: number[]; schoolAdminId?: number; gender?: string }) => {
    try {
      await apiFetch(`/api/students/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      });
      fetchAllData();
    } catch (err: any) {
      setErrorMsg(err.message || 'Impossible de mettre à jour l\'élève');
      throw err;
    }
  };

  const handleAddTeacher = async (data: { name: string; email: string; phone: string; specialization: string | string[]; schoolId: number; classIds?: number[]; gender?: string }) => {
    try {
      const created = await apiFetch('/api/teachers', {
        method: 'POST',
        body: JSON.stringify(data),
      });
      await fetchAllData(false);
      return created;
    } catch (err: any) {
      setErrorMsg(err.message);
      throw err;
    }
  };

  const handleAddParent = async (data: { name: string; email: string; phone: string; address: string; schoolId?: number; studentId?: number; gender?: string }) => {
    try {
      const created = await apiFetch('/api/parents', {
        method: 'POST',
        body: JSON.stringify(data),
      });
      // Refresh only parent list to avoid closing/reinitializing the student form
      const parents = await apiFetch('/api/parents');
      setParentsList(parents);
      return created;
    } catch (err: any) {
      setErrorMsg(err.message);
      throw err;
    }
  };

  const handleAddStudent = async (data: { firstName: string; lastName: string; birthDate: string; schoolId: number; classId: number; parentId?: number; academicYearId?: number; teacherIds?: number[]; schoolAdminId?: number; gender?: string }) => {
    try {
      await apiFetch('/api/students', {
        method: 'POST',
        body: JSON.stringify(data),
      });
      fetchAllData();
    } catch (err: any) {
      setErrorMsg(err.message);
    }
  };

  const handleBatchCreateStudents = async (records: any[]) => {
    try {
      const json = await apiFetch('/api/students/batch', {
        method: 'POST',
        body: JSON.stringify(records),
      });
      setImportResult(json);
      if (json.insertedCount && json.insertedCount > 0) fetchAllData();
    } catch (err: any) {
      setErrorMsg(err.message || 'Import CSV impossible');
    }
  };

  const handleBatchCreateParents = async (records: any[]) => {
    try {
      const json = await apiFetch('/api/parents/batch', {
        method: 'POST',
        body: JSON.stringify(records),
      });
      setImportResult(json);
      if (json.insertedCount && json.insertedCount > 0) fetchAllData();
    } catch (err: any) {
      setErrorMsg(err.message || 'Import parents impossible');
    }
  };

  const handleCreateUser = async (data: { uid?: string; email: string; name: string; role: string; schoolId?: number; academicYearId?: number; phone?: string; specialization?: string; gender?: string; password?: string; classIds?: number[] }) => {
    try {
      const created = await apiFetch('/api/admin/users', {
        method: 'POST',
        body: JSON.stringify(data),
      });

      fetchAllData();
      return created;
    } catch (err: any) {
      const userFriendlyMessage = err.status === 403 || /Forbidden/.test(err.message)
        ? 'Erreur : vous n’êtes pas autorisé à créer ce compte pour cette école ou ce rôle.'
        : err.message || 'Failed to create user';
      setErrorMsg(userFriendlyMessage);
      throw new Error(userFriendlyMessage);
    }
  };

  const handleUpdateUser = async (id: number, data: { email: string; name: string; role: string; schoolId?: number; academicYearId?: number; phone?: string; specialization?: string; gender?: string; classIds?: number[] }) => {
    try {
      await apiFetch(`/api/admin/users/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      });
      fetchAllData();
    } catch (err: any) {
      setErrorMsg(err.message || 'Impossible de mettre à jour le compte');
      throw err;
    }
  };

  const handleSetPassword = async (userId: number, password: string) => {
    try {
      await apiFetch('/api/admin/set-password', {
        method: 'POST',
        body: JSON.stringify({ userId, password }),
      });
      fetchAllData();
    } catch (err: any) {
      setErrorMsg(err.message || 'Impossible de mettre à jour le mot de passe');
      throw err;
    }
  };

  const handleDeleteUser = async (id: number) => {
    try {
      await apiFetch(`/api/admin/users/${id}`, {
        method: 'DELETE',
      });
      fetchAllData();
    } catch (err: any) {
      setErrorMsg(err.message || 'Impossible de supprimer le compte');
      throw err;
    }
  };

  const handleAddAbsence = async (data: { studentId: number; classId: number; date: string; period: string; isJustified: boolean }) => {
    try {
      await apiFetch('/api/absences', {
        method: 'POST',
        body: JSON.stringify(data),
      });
      fetchAllData();
    } catch (err: any) {
      setErrorMsg(err.message);
    }
  };

  const handleJustifyAbsence = async (id: number, reason: string) => {
    try {
      await apiFetch(`/api/absences/${id}/justify`, {
        method: 'PUT',
        body: JSON.stringify({ justificationReason: reason }),
      });
      fetchAllData();
    } catch (err: any) {
      setErrorMsg(err.message);
    }
  };

  const handleAddEvaluation = async (data: { classId: number; subject: string; title: string; coefficient: number; maxScore: number; date: string }) => {
    try {
      console.debug('Creating evaluation', data);
      await apiFetch('/api/evaluations', {
        method: 'POST',
        body: JSON.stringify(data),
      });
      console.debug('Evaluation created, refreshing data');
      fetchAllData();
    } catch (err: any) {
      setErrorMsg(err.message);
    }
  };

  const handleAddGrade = async (data: { evaluationId: number; studentId: number; score: string; remarks: string }) => {
    try {
      const createdOrUpdatedGrade = await apiFetch('/api/grades', {
        method: 'POST',
        body: JSON.stringify(data),
      });
      setGradesList((prev) => upsertGradeInList(prev as any[], {
        id: createdOrUpdatedGrade.id ?? Date.now(),
        evaluationId: data.evaluationId,
        studentId: data.studentId,
        score: data.score,
        remarks: data.remarks,
        editCount: createdOrUpdatedGrade.editCount ?? 0,
        evaluationTitle: createdOrUpdatedGrade.evaluationTitle ?? '',
        subject: createdOrUpdatedGrade.subject ?? '',
      }));
    } catch (err: any) {
      setErrorMsg(err.message);
      throw err;
    }
  };

  const handleSendNotification = async (data: { title: string; body: string; type: string; userId?: number }) => {
    try {
      await apiFetch('/api/notifications/send', {
        method: 'POST',
        body: JSON.stringify(data),
      });
      fetchAllData();
    } catch (err: any) {
      setErrorMsg(err.message);
    }
  };

  const handleMarkAllAsRead = async () => {
    try {
      await apiFetch('/api/notifications/read-all', { method: 'PUT' });
      fetchAllData();
    } catch (err: any) {
      setErrorMsg(err.message);
    }
  };

  // If not authenticated, render SPA login view
  if (!currentRole) {
    return <LoginView onLogin={(role) => { setSimulatedRole(role); setCurrentRole(role as UserRole); }} />;
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col font-sans text-slate-800" id="main-application">
      {/* Simulation console bar at the header */}
      <SimulatorHeader
        currentRole={currentRole}
        schoolsList={schoolsList}
        parentsList={parentsList}
        classesList={classesList}
        teachersList={teachersList}
        studentsList={studentsList}
        yearsList={yearsList}
        onRoleChange={handleRoleChange}
        onLogout={handleLogout}
        onRefreshData={fetchAllData}
        isSyncing={isSyncing}
        onManageAccounts={() => setActiveTab('administration')}
      />

      {/* Main workspace with sidebar option layout */}
      <div className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 lg:p-8 flex flex-col lg:flex-row gap-6">
        
        {/* SIDEBAR NAVIGATION */}
        <aside className="w-full lg:w-64 shrink-0 bg-white border border-slate-100 rounded-2xl p-4 shadow-sm" id="main-sidebar">
          <div className="space-y-4">
            <div className="px-3 py-2 border-b border-slate-100 pb-3">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block">Navigation</span>
              <p className="text-xs text-slate-400">Cliquez pour basculer d'un module à l'autre</p>
            </div>

            <nav className="space-y-1">
              {/* Tab 1: Dashboard */}
              <button
                onClick={() => setActiveTab('tableau-de-bord')}
                className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs sm:text-sm font-semibold transition-all cursor-pointer ${
                  activeTab === 'tableau-de-bord'
                    ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/10'
                    : 'text-slate-500 hover:text-slate-900 hover:bg-slate-50'
                }`}
                id="sidebar-nav-dashboard"
              >
                <LayoutDashboard className="h-4.5 w-4.5" />
                <span>Tableau de Bord</span>
              </button>

              {/* Tab 2: Admin standard dashboard */}
              <button
                onClick={() => setActiveTab('administration')}
                className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs sm:text-sm font-semibold transition-all cursor-pointer ${
                  activeTab === 'administration'
                    ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/10'
                    : 'text-slate-500 hover:text-slate-900 hover:bg-slate-50'
                }`}
                id="sidebar-nav-admin"
              >
                <Building2 className="h-4.5 w-4.5" />
                <span>Administration</span>
              </button>

              {/* Tab 3: Absences */}
              <button
                onClick={() => setActiveTab('absences')}
                className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs sm:text-sm font-semibold transition-all cursor-pointer ${
                  activeTab === 'absences'
                    ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/10'
                    : 'text-slate-500 hover:text-slate-900 hover:bg-slate-50'
                }`}
                id="sidebar-nav-absences"
              >
                <CalendarDays className="h-4.5 w-4.5" />
                <span>Absences</span>
              </button>

              {/* Tab 4: Notes et bulletins (hidden for parents) */}
              {currentRole !== 'parent' && (
                <>
                  <button
                    onClick={() => setActiveTab('notes')}
                    className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs sm:text-sm font-semibold transition-all cursor-pointer ${
                      activeTab === 'notes'
                        ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/10'
                        : 'text-slate-500 hover:text-slate-900 hover:bg-slate-50'
                    }`}
                    id="sidebar-nav-grades"
                  >
                    <Award className="h-4.5 w-4.5" />
                    <span>Notes & Bulletins</span>
                  </button>

                  <button
                    onClick={() => setActiveTab('archive')}
                    className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs sm:text-sm font-semibold transition-all cursor-pointer ${
                      activeTab === 'archive'
                        ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/10'
                        : 'text-slate-500 hover:text-slate-900 hover:bg-slate-50'
                    }`}
                    id="sidebar-nav-archive"
                  >
                    <BookOpen className="h-4.5 w-4.5" />
                    <span>Archive</span>
                  </button>
                </>
              )}

              {currentRole === 'super_admin' && (
                <button
                  onClick={() => setActiveTab('audit')}
                  className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs sm:text-sm font-semibold transition-all cursor-pointer ${
                    activeTab === 'audit'
                      ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/10'
                      : 'text-slate-500 hover:text-slate-900 hover:bg-slate-50'
                  }`}
                  id="sidebar-nav-audit"
                >
                  <Info className="h-4.5 w-4.5" />
                  <span>Journal des actions</span>
                </button>
              )}

              {/* Tab 5: Real-time FCM Notifications */}
              <button
                onClick={() => setActiveTab('notifications')}
                className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-xs sm:text-sm font-semibold transition-all cursor-pointer ${
                  activeTab === 'notifications'
                    ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/10'
                    : 'text-slate-500 hover:text-slate-900 hover:bg-slate-50'
                }`}
                id="sidebar-nav-notifications"
              >
                <div className="flex items-center gap-3">
                  <Bell className="h-4.5 w-4.5" />
                  <span>Messagerie & Push</span>
                </div>
                {notificationsList.filter((n) => !n.isRead).length > 0 && (
                  <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold ${
                    activeTab === 'notifications' ? 'bg-white text-indigo-700' : 'bg-indigo-600 text-white'
                  }`}>
                    {notificationsList.filter((n) => !n.isRead).length}
                  </span>
                )}
              </button>

              {/* Tab 6: Android APK Virtual Smartphone Mockup */}
              <button
                onClick={() => setActiveTab('mobile-parent')}
                className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs sm:text-sm font-semibold transition-all cursor-pointer ${
                  activeTab === 'mobile-parent'
                    ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/10'
                    : 'text-slate-500 hover:text-slate-900 hover:bg-slate-50'
                }`}
                id="sidebar-nav-mobile"
              >
                <Smartphone className="h-4.5 w-4.5" />
                <span>Application Mobile</span>
              </button>
            </nav>
          </div>

          {/* Quick info status connection footer */}
          <div className="mt-8 pt-4 border-t border-slate-100 flex flex-col gap-2 p-1">
            <div className="text-[10px] text-slate-400 space-y-1">
              <span className="font-bold text-slate-500 block">BASE DE DONNÉES :</span>
              <p className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 bg-emerald-500 rounded-full inline-block" />
                PostgreSQL Connecté (Cloud SQL)
              </p>
            </div>
          </div>
        </aside>

        {/* WORKSPACE CENTRAL BOARD */}
        <main className="flex-1 min-w-0" id="main-viewport">
          
          {/* Error warning notification banners */}
          {errorMsg && (
            <div className="bg-rose-50 border border-rose-100 p-4 rounded-2xl mb-6 flex items-start gap-3 animate-fade-in text-xs sm:text-sm">
              <AlertCircle className="h-5 w-5 text-rose-500 shrink-0 mt-0.5" />
              <div className="space-y-1 leading-relaxed">
                <p className="font-bold text-rose-800">Alerte Système</p>
                <p className="text-rose-700">{errorMsg}</p>
              </div>
              <button onClick={() => setErrorMsg(null)} className="ml-auto text-rose-400 font-bold hover:text-rose-600 cursor-pointer">✕</button>
            </div>
          )}

          {/* LOADING SCREEN */}
          {isSyncing && (
            <div className="bg-white/60 p-12 text-center rounded-2xl border border-slate-50 shadow-sm flex flex-col justify-center items-center gap-3 my-12">
              <RefreshCw className="h-10 w-10 text-indigo-600 animate-spin" />
              <p className="text-xs text-slate-500 font-medium">Synchronisation des registres en temps réel...</p>
            </div>
          )}

          {/* DYNAMIC RENDERING PANEL BASED ON ACTIVE TABS */}
          {!isSyncing && (
            <div className="bg-white p-6 border border-slate-100 rounded-2xl shadow-sm transition-all animate-fade-in" id="content-card">
              {activeTab === 'tableau-de-bord' && (
                <DashboardView
                  stats={stats}
                  recentAbsences={summaryRecentAbsences}
                  recentGrades={summaryRecentGrades}
                  userRole={currentRole}
                />
              )}

              {activeTab === 'administration' && (
                <ErrorBoundary>
                  <AdminView
                  userRole={currentRole}
                  schoolsList={schoolsList}
                  yearsList={yearsList}
                  classesList={classesList}
                  teachersList={teachersList}
                  studentsList={studentsList}
                  parentsList={parentsList}
                  usersList={usersList}
                  onAddSchool={handleAddSchool}
                  onUpdateSchool={handleUpdateSchool}
                  onUpdateStudent={handleUpdateStudent}
                  onAddYear={handleAddYear}
                  onAddClass={handleAddClass}
                  onAddTeacher={handleAddTeacher}
                  onAddParent={handleAddParent}
                  onAddStudent={handleAddStudent}
                  onBatchCreateStudents={handleBatchCreateStudents}
                  onBatchCreateParents={handleBatchCreateParents}
                  importResult={importResult}
                  onCreateUser={handleCreateUser}
                  onUpdateUser={handleUpdateUser}
                  onSetPassword={handleSetPassword}
                  onDeleteUser={handleDeleteUser}
                  onDeleteClass={handleDeleteClass}
                  onDeleteSchool={handleDeleteSchool}
                  currentSchoolId={currentSchoolId}
                  />
                </ErrorBoundary>
              )}

              {activeTab === 'absences' && (
                <AbsenceView
                  userRole={currentRole}
                  absencesList={absencesList}
                  studentsList={studentsList}
                  classesList={classesList}
                  schoolsList={schoolsList}
                  onAddAbsence={handleAddAbsence}
                  onJustifyAbsence={handleJustifyAbsence}
                />
              )}

              {activeTab === 'notes' && currentRole !== 'parent' && (
                <NotesView
                  userRole={currentRole}
                  evaluationsList={evaluationsList}
                  gradesList={gradesList}
                  studentsList={studentsList}
                  classesList={classesList}
                  schoolsList={schoolsList}
                  schoolFilterId={superAdminSchoolFilterId}
                  onSchoolFilterChange={setSuperAdminSchoolFilterId}
                  teacherClassIds={currentRole === 'teacher' ? currentTeacherClassIds : []}
                  teacherSpecializations={currentRole === 'teacher' ? currentTeacherSpecializations : []}
                  teacherId={currentRole === 'teacher' ? currentTeacherProfile?.id : undefined}
                  onAddEvaluation={handleAddEvaluation}
                  onAddGrade={handleAddGrade}
                />
              )}

              {activeTab === 'archive' && currentRole !== 'parent' && (
                <ArchiveView
                  userRole={currentRole}
                  evaluationsList={evaluationsList}
                  gradesList={gradesList}
                  studentsList={studentsList}
                  classesList={classesList}
                  schoolsList={schoolsList}
                  schoolFilterId={superAdminSchoolFilterId}
                  onSchoolFilterChange={setSuperAdminSchoolFilterId}
                  teacherClassIds={currentRole === 'teacher' ? currentTeacherClassIds : []}
                  teacherId={currentRole === 'teacher' ? currentTeacherProfile?.id : undefined}
                />
              )}

              {activeTab === 'audit' && currentRole === 'super_admin' && (
                <AuditView
                  auditEvents={auditEvents}
                  isLoading={isAuditLoading}
                  onReload={fetchAuditEvents}
                />
              )}

              {activeTab === 'notifications' && (
                <NotificationView
                  userRole={currentRole}
                  notificationsList={notificationsList}
                  usersList={usersList}
                  onSendNotification={handleSendNotification}
                  onMarkAllAsRead={handleMarkAllAsRead}
                />
              )}

              {activeTab === 'mobile-parent' && (
                <MobileParentView
                  currentRole={currentRole}
                  studentsList={studentsList}
                  parentsList={parentsList}
                  absencesList={absencesList}
                  gradesList={gradesList}
                  notificationsList={notificationsList}
                  onJustifyAbsence={handleJustifyAbsence}
                />
              )}
            </div>
          )}

        </main>

      </div>
    </div>
  );
}
