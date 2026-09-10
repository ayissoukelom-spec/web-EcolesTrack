import React, { useRef, useState, useEffect } from 'react';
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
  AuditEvent,
  SubjectType,
  EducationLevel,
} from './types.ts';
import {
  apiFetch,
  getUiErrorMessage,
  setSimulatedRole,
  clearSimulatedRole,
  clearSimulatedUser,
  setSimulatedUser,
  findTeacherProfileFromSimulatedUser,
} from './lib/api.ts';
import { useAuth } from './contexts/AuthContext.tsx';
import { useAbsences } from './hooks/useAbsences.ts';
import { countOverdueEvaluations, isEvaluationArchived, isEvaluationLockedBySchoolAdmin, isEvaluationArchivedForSchoolAdminByAge } from './lib/evaluationUtils.ts';
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
import ParentNotesView from './components/ParentNotesView.tsx';
import ArchiveView from './components/ArchiveView.tsx';
import BulletinsView from './components/BulletinsView.tsx';
import GlobalErrorToast from './components/GlobalErrorToast.tsx';

import {
  LayoutDashboard,
  Building2,
  CalendarDays,
  Award,
  Bell,
  Smartphone,
  Info,
  BookOpen,
  FileText,
  LogOut,
  RefreshCw,
  AlertCircle
} from 'lucide-react';

export default function App() {
  const { user: authenticatedUser, token, role, activeSchoolId } = useAuth();
  const { justifyAbsence } = useAbsences();
  const currentRole = role as UserRole;
  const currentSchoolId = activeSchoolId;
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
    absenceStatusCounts: {
      justified: 0,
      unjustified: 0,
    },
  });
  const [chartData, setChartData] = useState<Array<{ name: string; taux: number }>>([]);
  const [schoolsList, setSchoolsList] = useState<School[]>([]);
  const [yearsList, setYearsList] = useState<AcademicYear[]>([]);
  const [classesList, setClassesList] = useState<Class[]>([]);
  const [teachersList, setTeachersList] = useState<Teacher[]>([]);
  const [studentsList, setStudentsList] = useState<Student[]>([]);
  const [parentsList, setParentsList] = useState<Parent[]>([]);

  const logTeachersPayload = (prefix: string, payload: unknown) => {
    if (!Array.isArray(payload)) {
      console.log(`${prefix} payload is not an array:`, payload);
      return;
    }
    console.log(`${prefix} length=${payload.length}`);
    payload.forEach((teacher: any, index: number) => {
      console.log(`${prefix} [${index}]`, {
        id: teacher?.id,
        uid: teacher?.uid,
        email: teacher?.email,
        classIds: teacher?.classIds,
      });
    });
  };
  const [absencesList, setAbsencesList] = useState<any[]>([]);
  const [summaryRecentAbsences, setSummaryRecentAbsences] = useState<any[]>([]);
  const unjustifiedAbsencesCount = absencesList.filter((absence: any) => !absence.isJustified).length;
  const [evaluationsList, setEvaluationsList] = useState<any[]>([]);
  const [gradesList, setGradesList] = useState<any[]>([]);
  const [summaryRecentGrades, setSummaryRecentGrades] = useState<any[]>([]);
  const [notificationsList, setNotificationsList] = useState<SystemNotification[]>([]);
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);
  const [usersList, setUsersList] = useState<User[]>([]);
  const [subjectsList, setSubjectsList] = useState<any[]>([]);
  const [approvedSubjectsList, setApprovedSubjectsList] = useState<any[]>([]);
  const [subjectTypesList, setSubjectTypesList] = useState<SubjectType[]>([]);
  const [educationLevels, setEducationLevels] = useState<EducationLevel[]>([]);
  const processedNotificationIdsRef = useRef<Set<number>>(new Set());

  const currentTeacherProfile = findTeacherProfileFromSimulatedUser(currentRole, authenticatedUser, teachersList, usersList);

  const currentTeacherClassIds = (currentTeacherProfile?.classIds || [])
    .map((classId) => Number(classId))
    .filter((classId) => Number.isInteger(classId));
  const currentTeacherSpecializations = currentTeacherProfile?.specialization
    ? Array.isArray(currentTeacherProfile.specialization)
      ? currentTeacherProfile.specialization
      : String(currentTeacherProfile.specialization)
          .split(/[,;&|\/\+]/)
          .map((item) => item.trim())
          .filter(Boolean)
    : [];
  const visibleErrorMsg = getUiErrorMessage(errorMsg);

  const noteOverdueCount = currentRole === 'teacher' || currentRole === 'school_admin' || currentRole === 'super_admin'
    ? countOverdueEvaluations(
      evaluationsList,
      studentsList,
      gradesList,
      currentRole as UserRole,
      currentRole === 'teacher' ? currentTeacherProfile?.id : undefined,
    )
    : 0;

  const normalizeStudentsPayload = (payload: unknown): Student[] => {
    if (Array.isArray(payload)) return payload as Student[];

    if (payload && typeof payload === 'object') {
      const record = payload as Record<string, unknown>;
      const maybeStudents = record.students;
      if (Array.isArray(maybeStudents)) return maybeStudents as Student[];

      const maybeData = record.data;
      if (Array.isArray(maybeData)) return maybeData as Student[];
      if (maybeData && typeof maybeData === 'object') {
        const nestedStudents = (maybeData as Record<string, unknown>).students;
        if (Array.isArray(nestedStudents)) return nestedStudents as Student[];
      }
    }

    return [];
  };

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
      await apiFetch('/api/auth/register-or-login', { method: 'POST' }).catch((err) => {
        const uiMessage = getUiErrorMessage(err);
        if (uiMessage) {
          console.warn('Auth sync warning ignored in UI:', err);
        }
      });

      // 2. Load dashboard summary & role details
      const summary = await apiFetch('/api/dashboard/summary');
      console.log('RAW API RESPONSE DASHBOARD:', summary);
      console.log('chartData reçu:', (summary as any)?.chartData);
      if (summary && typeof summary === 'object') {
        if ('stats' in summary) setStats((prev) => ({ ...prev, ...summary.stats }));
        if ('absenceStatusCounts' in summary) {
          setStats((prev) => ({
            ...prev,
            absenceStatusCounts: summary.absenceStatusCounts || prev.absenceStatusCounts,
          }));
        }
        if ('recentGrades' in summary) setSummaryRecentGrades(summary.recentGrades);
        if ('recentAbsences' in summary) {
          setSummaryRecentAbsences(summary.recentAbsences);
          setAbsencesList(summary.recentAbsences);
        }
        if (Array.isArray((summary as any).chartData)) {
          setChartData((summary as any).chartData);
        } else {
          setChartData([]);
        }
      }

      // 3. Load other lists for CRUD and management tabs
      const classesEndpoint = currentRole !== 'super_admin' && currentSchoolId != null
        ? `/api/classes?schoolId=${currentSchoolId}`
        : '/api/classes';
      const endpoints = [
        '/api/schools',
        '/api/academic-years',
        classesEndpoint,
        '/api/teachers',
        '/api/students',
        '/api/parents',
        '/api/absences',
        '/api/evaluations',
        '/api/grades',
        '/api/notifications',
        '/api/subjects',
        '/api/subjects?approvedOnly=true',
        '/api/subject-types',
        '/api/education/levels',
        '/api/simulation/users',
      ];

      const promises = endpoints.map(e => apiFetch(e).catch((err) => ({ __error: true, error: err })));
      const results = await Promise.all(promises);

      const map = Object.fromEntries(endpoints.map((e, i) => [e, results[i]]));
      logTeachersPayload('RAW_API_RESPONSE_/api/teachers', results[endpoints.indexOf('/api/teachers')]);
      logTeachersPayload('MAP_/api/teachers', map['/api/teachers']);
      if (Array.isArray(map['/api/teachers'])) {
        logTeachersPayload('BEFORE_SET_TEACHERSLIST', map['/api/teachers']);
        setTeachersList(map['/api/teachers']);
      }
      if (Array.isArray(map['/api/schools'])) setSchoolsList(map['/api/schools']);
      if (Array.isArray(map['/api/academic-years'])) setYearsList(map['/api/academic-years']);
      if (Array.isArray(map[classesEndpoint])) {
        setClassesList((previousClasses) =>
          currentRole === 'teacher' && map[classesEndpoint].length === 0
            ? previousClasses
            : map[classesEndpoint]
        );
      }

      const rawStudentsPayload = map['/api/students'];
      const normalizedStudents = normalizeStudentsPayload(rawStudentsPayload);
      setStudentsList(normalizedStudents);

      if (Array.isArray(map['/api/parents'])) setParentsList(map['/api/parents']);
      if (Array.isArray(map['/api/absences'])) setAbsencesList(map['/api/absences']);
      if (Array.isArray(map['/api/evaluations'])) setEvaluationsList(map['/api/evaluations']);
      if (Array.isArray(map['/api/grades'])) setGradesList(map['/api/grades']);
      if (Array.isArray(map['/api/notifications'])) setNotificationsList(map['/api/notifications']);
      if (Array.isArray(map['/api/subjects'])) setSubjectsList(map['/api/subjects']);
      if (Array.isArray(map['/api/subjects?approvedOnly=true'])) setApprovedSubjectsList(map['/api/subjects?approvedOnly=true']);
      if (Array.isArray(map['/api/subject-types'])) setSubjectTypesList(map['/api/subject-types']);
      if (Array.isArray(map['/api/education/levels'])) setEducationLevels(map['/api/education/levels']);
      if (Array.isArray(map['/api/simulation/users'])) setUsersList(map['/api/simulation/users']);

      if (currentRole === 'super_admin') {
        await fetchAuditEvents();
      } else {
        setAuditEvents([]);
      }
    } catch (err: any) {
      const uiMessage = getUiErrorMessage(err, 'Impossible de charger les données EcoleTrack.');
      if (uiMessage) {
        setErrorMsg(uiMessage);
      }
      console.error('Error hydrating EcoleTrack database:', err);
      console.warn('[students-load] keeping existing student list because the refresh failed.', err);
    } finally {
      setIsSyncing(false);
    }
  };

  const refreshGrades = async () => {
    const grades = await apiFetch('/api/grades');
    if (Array.isArray(grades)) setGradesList(grades);
  };

  // When Super Admin selects a school filter, fetch classes annotated for that school
  // so that global classes approved for the school have their `status` populated.
  useEffect(() => {
    if (currentRole !== 'super_admin') return;
    const schoolId = superAdminSchoolFilterId;
    const endpoint = schoolId ? `/api/classes?schoolId=${schoolId}` : '/api/classes';
    (async () => {
      try {
        const payload = await apiFetch(endpoint);
        setClassesList(Array.isArray(payload) ? payload : []);
      } catch (err: any) {
        console.warn('Failed to load classes for super admin school filter', err);
      }
    })();
  }, [superAdminSchoolFilterId, currentRole]);

  useEffect(() => {
    logTeachersPayload('AFTER_SET_TEACHERSLIST', teachersList);
  }, [teachersList]);

  useEffect(() => {
    if (role !== 'super_admin') {
      setSuperAdminSchoolFilterId(null);
    }
    if (role) fetchAllData();
  }, [role]);

  useEffect(() => {
    if (!role) return;
    if (currentRole === 'super_admin' || activeSchoolId != null) {
      fetchAllData();
    }
  }, [activeSchoolId, currentRole, role]);

  useEffect(() => {
    if (!notificationsList || notificationsList.length === 0) return;

    const newNotifs = notificationsList.filter((notif) => !processedNotificationIdsRef.current.has(notif.id));
    if (newNotifs.length === 0) return;

    const hasAbsence = newNotifs.some((notif) => notif.type === 'absence');
    const hasGrade = newNotifs.some((notif) => notif.type === 'grade');
    if (!hasAbsence && !hasGrade) return;

    newNotifs.forEach((notif) => processedNotificationIdsRef.current.add(notif.id));
    if (hasAbsence || hasGrade) {
      fetchAllData(false);
    }
  }, [notificationsList]);

  useEffect(() => {
    if (activeTab === 'audit' && currentRole === 'super_admin') {
      fetchAuditEvents();
    }
  }, [activeTab, currentRole]);

  const handleRoleChange = (newRole: string) => {
    if (!newRole) {
      clearSimulatedRole();
      clearSimulatedUser();
      window.history.replaceState(null, '', '/login');
      return;
    }
    // Ensure there's a simulated user set when switching roles quickly.
    const existingSimUser = authenticatedUser;
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
    window.history.replaceState(null, '', '/');
  };

  const handleLogout = async () => {
    clearSimulatedRole();
    clearSimulatedUser();
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

  const handleAddSchool = async (data: { name: string; address: string; phone: string; officialName?: string | null; abbreviation?: string | null; motto?: string | null; postalBox?: string | null; email?: string | null; city?: string | null; region?: string | null; educationDirection?: string | null; classNames?: string[]; subjectNames?: string[] }) => {
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

  const handleSetActiveYear = async (yearId: number) => {
    try {
      await apiFetch(`/api/academic-years/${yearId}/activate`, {
        method: 'PUT',
      });
      await fetchAllData(false);
    } catch (err: any) {
      setErrorMsg(err.message || 'Impossible de définir cette année comme active');
      throw err;
    }
  };

  const handleDeleteYear = async (yearId: number) => {
    try {
      await apiFetch(`/api/academic-years/${yearId}`, {
        method: 'DELETE',
      });
      await fetchAllData(false);
    } catch (err: any) {
      setErrorMsg(err.message || 'Impossible de supprimer cette année scolaire');
      throw err;
    }
  };

  const handleAddClass = async (data: { name: string; levelId?: number | null; schoolId?: number | null; academicYearId: number; teacherId?: number }) => {
    try {
      const payload = {
        ...data,
        schoolId: data.schoolId ?? null,
      };
      await apiFetch('/api/classes', {
        method: 'POST',
        body: JSON.stringify(payload),
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

  const handleApproveClass = async (id: number) => {
    try {
      const schoolId = currentSchoolId;
      if (!schoolId) throw new Error('Aucun établissement sélectionné pour approuver la classe');
      await apiFetch(`/api/schools/${schoolId}/classes/${id}/approve`, { method: 'POST' });
      setClassesList((prev) => prev.map((c) => (c.id === id ? { ...c, status: 'approved' } : c)));
      await fetchAllData(false);
    } catch (err: any) {
      setErrorMsg(err.message || 'Impossible d\'approuver la classe.');
      throw err;
    }
  };

  const handleRejectClass = async (id: number) => {
    try {
      const schoolId = currentSchoolId;
      if (!schoolId) throw new Error('Aucun établissement sélectionné pour refuser la classe');
      await apiFetch(`/api/schools/${schoolId}/classes/${id}/reject`, { method: 'POST' });
      setClassesList((prev) => prev.map((c) => (c.id === id ? { ...c, status: 'rejected' } : c)));
      await fetchAllData(false);
    } catch (err: any) {
      setErrorMsg(err.message || 'Impossible de refuser la classe.');
      throw err;
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
  const handleUpdateSchool = async (id: number, data: { name: string; address: string; phone?: string; officialName?: string | null; abbreviation?: string | null; motto?: string | null; postalBox?: string | null; email?: string | null; city?: string | null; region?: string | null; educationDirection?: string | null; classNames?: string[]; subjectNames?: string[] }) => {
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

  const handleUpdateStudent = async (id: number, data: { firstName: string; lastName: string; birthDate: string | null; schoolId?: number; classId: number; parentId: number; academicYearId?: number; teacherIds?: number[]; schoolAdminId?: number; gender?: string; studentStatus?: string | null }) => {
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

  const handleAddStudent = async (data: { firstName: string; lastName: string; birthDate: string; schoolId: number; classId: number; parentId?: number; academicYearId?: number; teacherIds?: number[]; schoolAdminId?: number; gender?: string; studentStatus?: string | null }) => {
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

  const handleCreateUser = async (data: { uid?: string; email: string; name: string; role: string; schoolId?: number; academicYearId?: number; phone?: string; specialization?: string | string[]; gender?: string; password?: string; classIds?: number[] }) => {
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

  const handleUpdateUser = async (id: number, data: { email: string; name: string; role: string; schoolId?: number; academicYearId?: number; phone?: string; specialization?: string | string[]; gender?: string; address?: string; studentId?: number; classIds?: number[] }) => {
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

  const handleAddAbsence = async (data: { studentId: number; classId: number; date: string; subjectId?: number; startTime: string; endTime: string; isJustified: boolean }) => {
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

  const handleJustifyAbsence = async (id: number, reason: string, files?: File[] | File | null) => {
    try {
      await justifyAbsence(id, reason, files ?? undefined);
      fetchAllData();
    } catch (err: any) {
      setErrorMsg(err.message);
    }
  };

  const handleAddEvaluation = async (data: { classId: number; subject: string; type: string; coefficient: number; maxScore: number; date: string }) => {
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

  const refreshApprovedSubjects = async () => {
    try {
      const approved = await apiFetch('/api/subjects?approvedOnly=true');
      if (Array.isArray(approved)) setApprovedSubjectsList(approved);
    } catch (err: any) {
      console.warn('Unable to refresh approved subject list:', err);
    }
  };

  const handleAddGrade = async (data: { evaluationId: number; studentId: number; score: string; remarks: string }) => {
    try {
      await apiFetch('/api/grades', {
        method: 'POST',
        body: JSON.stringify(data),
      });
      await refreshGrades();
    } catch (err: any) {
      setErrorMsg(err.message);
      throw err;
    }
  };

  const handleAddSubject = async (data: { name: string; code?: string; schoolId?: number; subjectTypeId?: number | null }) => {
    try {
      const createdSubject = await apiFetch('/api/subjects', {
        method: 'POST',
        body: JSON.stringify(data),
      });
      setSubjectsList((prev) => [...prev, createdSubject]);
    } catch (err: any) {
      setErrorMsg(err.message);
      throw err;
    }
  };

  const handleUpdateSubject = async (id: number, data: { name: string; code?: string; subjectTypeId?: number | null }) => {
    try {
      const updatedSubject = await apiFetch(`/api/subjects/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      });
      setSubjectsList((prev) =>
        prev.map((s) => (s.id === id ? updatedSubject : s))
      );
      await refreshApprovedSubjects();
    } catch (err: any) {
      setErrorMsg(err.message);
      throw err;
    }
  };

  const handleAddSubjectType = async (data: { schoolId: number; name: string; description?: string | null; sortOrder?: number }) => {
    const created = await apiFetch('/api/subject-types', { method: 'POST', body: JSON.stringify(data) });
    setSubjectTypesList((prev) => [...prev, created]);
    return created;
  };

  const handleUpdateSubjectType = async (id: number, data: { schoolId?: number; name?: string; description?: string | null; sortOrder?: number }) => {
    const updated = await apiFetch(`/api/subject-types/${id}`, { method: 'PUT', body: JSON.stringify(data) });
    setSubjectTypesList((prev) => prev.map((item) => item.id === id ? updated : item));
    return updated;
  };

  const handleDeleteSubjectType = async (id: number) => {
    await apiFetch(`/api/subject-types/${id}`, { method: 'DELETE' });
    setSubjectTypesList((prev) => prev.filter((item) => item.id !== id));
  };

  const handleDeleteSubject = async (id: number) => {
    try {
      await apiFetch(`/api/subjects/${id}`, {
        method: 'DELETE',
      });
      setSubjectsList((prev) => prev.filter((s) => s.id !== id));
      await refreshApprovedSubjects();
    } catch (err: any) {
      setErrorMsg(err.message);
      throw err;
    }
  };

  const handleApproveSubject = async (id: number) => {
    try {
      const schoolId = currentSchoolId;
      if (!schoolId) throw new Error('Aucun établissement sélectionné');
      await apiFetch(`/api/schools/${schoolId}/subjects/${id}/approve`, { method: 'POST' });
      setSubjectsList((prev) => prev.map((s) => (s.id === id ? { ...s, status: 'approved' } : s)));
      await refreshApprovedSubjects();
    } catch (err: any) {
      setErrorMsg(err.message);
      throw err;
    }
  };

  const handleRejectSubject = async (id: number) => {
    try {
      const schoolId = currentSchoolId;
      if (!schoolId) throw new Error('Aucun établissement sélectionné');
      await apiFetch(`/api/schools/${schoolId}/subjects/${id}/reject`, { method: 'POST' });
      setSubjectsList((prev) => prev.map((s) => (s.id === id ? { ...s, status: 'rejected' } : s)));
      await refreshApprovedSubjects();
    } catch (err: any) {
      setErrorMsg(err.message);
      throw err;
    }
  };

  const handleSendNotification = async (data: { title: string; body: string; type: string; userId?: number; classId?: number; files?: File[] }) => {
    try {
      if (data.files && data.files.length > 0) {
        const formData = new FormData();
        formData.append('title', data.title);
        formData.append('body', data.body);
        formData.append('type', data.type);
        if (data.userId != null) formData.append('userId', String(data.userId));
        if (data.classId != null) formData.append('classId', String(data.classId));
        data.files.forEach((file) => formData.append('files', file));

        await apiFetch('/api/notifications/send', {
          method: 'POST',
          body: formData,
        });
      } else {
        await apiFetch('/api/notifications/send', {
          method: 'POST',
          body: JSON.stringify(data),
        });
      }
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

  const handleNotificationRead = async () => {
    // refresh notifications list after a single notification is marked read
    try {
      await fetchAllData(false);
    } catch (e) {
      console.warn('Failed to refresh data after marking notification read', e);
    }
  };

  // If not authenticated, render SPA login view
  if (!authenticatedUser || (!token && currentRole !== 'super_admin') || (currentRole !== 'super_admin' && !activeSchoolId)) {
    return <LoginView onLogin={(role) => { setSimulatedRole(role); }} />;
  }

  // Centralized filtering of evaluations: separate active from archived
  const activeEvaluations = evaluationsList.filter((ev) => {
    if (currentRole === 'super_admin') return true;
    if (currentRole === 'school_admin') {
      return !isEvaluationLockedBySchoolAdmin(ev, studentsList, gradesList)
        && !isEvaluationArchivedForSchoolAdminByAge(ev, studentsList, gradesList);
    }
    return !isEvaluationArchived(ev, studentsList, gradesList);
  });
  const archivedEvaluations = evaluationsList.filter((ev) => {
    if (currentRole === 'super_admin') return false;
    if (currentRole === 'school_admin') {
      return isEvaluationLockedBySchoolAdmin(ev, studentsList, gradesList)
        || isEvaluationArchivedForSchoolAdminByAge(ev, studentsList, gradesList);
    }
    return isEvaluationArchived(ev, studentsList, gradesList);
  });

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
        usersList={usersList}
        yearsList={yearsList}
        approvedSubjectsList={approvedSubjectsList}
        onRoleChange={handleRoleChange}
        onLogout={handleLogout}
        onRefreshData={fetchAllData}
        isSyncing={isSyncing}
        onManageAccounts={() => setActiveTab('administration')}
      />

      {visibleErrorMsg && (
        <GlobalErrorToast message={visibleErrorMsg} onClose={() => setErrorMsg(null)} />
      )}

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
                className={`w-full flex items-center justify-between gap-3 px-3.5 py-2.5 rounded-xl text-xs sm:text-sm font-semibold transition-all cursor-pointer ${
                  activeTab === 'absences'
                    ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/10'
                    : 'text-slate-500 hover:text-slate-900 hover:bg-slate-50'
                }`}
                id="sidebar-nav-absences"
                data-testid="sidebar-nav-absences"
              >
                <div className="flex items-center gap-3">
                  <CalendarDays className="h-4.5 w-4.5" />
                  <span>Absences</span>
                </div>
                {unjustifiedAbsencesCount > 0 && (
                  <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold ${
                    activeTab === 'absences' ? 'bg-white text-indigo-700' : 'bg-indigo-600 text-white'
                  }`}>
                    {unjustifiedAbsencesCount > 99 ? '99+' : unjustifiedAbsencesCount}
                  </span>
                )}
              </button>

              {currentRole === 'parent' && (
                <button
                  onClick={() => setActiveTab('notes')}
                  className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs sm:text-sm font-semibold transition-all cursor-pointer ${
                    activeTab === 'notes'
                      ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/10'
                      : 'text-slate-500 hover:text-slate-900 hover:bg-slate-50'
                  }`}
                  id="sidebar-nav-parent-grades"
                >
                  <Award className="h-4.5 w-4.5" />
                  <span>Notes</span>
                </button>
              )}

              {/* Tab 4: Notes et bulletins (hidden for parents) */}
              {currentRole !== 'parent' && (
                <>
                  <button
                    onClick={() => setActiveTab('notes')}
                    className={`w-full flex items-center justify-between gap-3 px-3.5 py-2.5 rounded-xl text-xs sm:text-sm font-semibold transition-all cursor-pointer ${
                      activeTab === 'notes'
                        ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/10'
                        : 'text-slate-500 hover:text-slate-900 hover:bg-slate-50'
                    }`}
                    id="sidebar-nav-grades"
                  >
                    <div className="flex items-center gap-3">
                      <Award className="h-4.5 w-4.5" />
                      <span>Notes & Bulletins</span>
                    </div>
                    {noteOverdueCount > 0 && (
                      <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold ${
                        activeTab === 'notes' ? 'bg-white text-indigo-700' : 'bg-rose-500 text-white'
                      }`}>
                        {noteOverdueCount}
                      </span>
                    )}
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

              <button
                type="button"
                disabled={currentRole !== 'super_admin'}
                onClick={() => {
                  if (currentRole === 'super_admin') {
                    setActiveTab('bulletins');
                  }
                }}
                className={`w-full flex items-center justify-between gap-3 px-3.5 py-2.5 rounded-xl text-xs sm:text-sm font-semibold transition-all ${
                  currentRole !== 'super_admin'
                    ? 'cursor-not-allowed opacity-60 text-slate-400'
                    : 'cursor-pointer text-slate-500 hover:text-slate-900 hover:bg-slate-50'
                } ${
                  activeTab === 'bulletins' && currentRole === 'super_admin'
                    ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/10'
                    : ''
                }`}
                id="sidebar-nav-bulletins"
                aria-disabled={currentRole !== 'super_admin'}
              >
                <div className="flex items-center gap-3">
                  <FileText className="h-4.5 w-4.5" />
                  <span>Bulletins</span>
                </div>
                {noteOverdueCount > 0 && (
                  <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold ${
                    activeTab === 'bulletins' && currentRole === 'super_admin' ? 'bg-white text-indigo-700' : 'bg-rose-500 text-white'
                  }`}>
                    {noteOverdueCount}
                  </span>
                )}
              </button>

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

            </nav>
          </div>

          {/* Quick info status connection footer */}
          {currentRole === 'super_admin' && (
            <div className="mt-8 pt-4 border-t border-slate-100 flex flex-col gap-2 p-1">
              <div className="text-[10px] text-slate-400 space-y-1">
                <span className="font-bold text-slate-500 block">BASE DE DONNÉES :</span>
                <p className="flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 bg-emerald-500 rounded-full inline-block" />
                  PostgreSQL Connecté (Cloud SQL)
                </p>
              </div>
            </div>
          )}
        </aside>

        {/* WORKSPACE CENTRAL BOARD */}
        <main className="flex-1 min-w-0" id="main-viewport">
          
          {/* Error warning notification banners */}
          {visibleErrorMsg && (
            <div className="bg-rose-50 border border-rose-100 p-4 rounded-2xl mb-6 flex items-start gap-3 animate-fade-in text-xs sm:text-sm">
              <AlertCircle className="h-5 w-5 text-rose-500 shrink-0 mt-0.5" />
              <div className="space-y-1 leading-relaxed">
                <p className="font-bold text-rose-800">Alerte Système</p>
                <p className="text-rose-700">{visibleErrorMsg}</p>
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
                  chartData={chartData}
                  absenceStatusCounts={stats.absenceStatusCounts}
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
                  subjectsList={subjectsList}
                  subjectTypesList={subjectTypesList}
                  educationLevels={educationLevels}
                  approvedSubjectsList={approvedSubjectsList}
                  onAddSchool={handleAddSchool}
                  onUpdateSchool={handleUpdateSchool}
                  onUpdateStudent={handleUpdateStudent}
                  onAddYear={handleAddYear}
                  onSetActiveYear={handleSetActiveYear}
                  onDeleteYear={handleDeleteYear}
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
                  onAddSubject={handleAddSubject}
                  onUpdateSubject={handleUpdateSubject}
                  onDeleteSubject={handleDeleteSubject}
                  onApproveSubject={handleApproveSubject}
                  onRejectSubject={handleRejectSubject}
                  onAddSubjectType={handleAddSubjectType}
                  onUpdateSubjectType={handleUpdateSubjectType}
                  onDeleteSubjectType={handleDeleteSubjectType}
                  onApproveClass={handleApproveClass}
                  onRejectClass={handleRejectClass}
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
                  teachersList={teachersList}
                  approvedSubjectsList={approvedSubjectsList}
                  teacherClassIds={currentRole === 'teacher' ? currentTeacherClassIds : []}
                  teacherSpecializations={currentRole === 'teacher' ? currentTeacherSpecializations : []}
                  onAddAbsence={handleAddAbsence}
                  onJustifyAbsence={handleJustifyAbsence}
                />
              )}

              {activeTab === 'notes' && (
                currentRole === 'parent' ? (
                  <ParentNotesView
                    currentRole={currentRole}
                    studentsList={studentsList}
                    parentsList={parentsList}
                    gradesList={gradesList}
                    evaluationsList={activeEvaluations}
                  />
                ) : (
                  <NotesView
                    evaluationsList={activeEvaluations}
                    gradesList={gradesList}
                    studentsList={studentsList}
                    classesList={classesList}
                    schoolsList={schoolsList}
                    schoolFilterId={superAdminSchoolFilterId}
                    onSchoolFilterChange={setSuperAdminSchoolFilterId}
                    teacherClassIds={currentRole === 'teacher' ? currentTeacherClassIds : []}
                    teacherSpecializations={currentRole === 'teacher' ? currentTeacherSpecializations : []}
                    approvedSubjectsList={approvedSubjectsList}
                    teacherId={currentRole === 'teacher' ? currentTeacherProfile?.id : undefined}
                    onAddEvaluation={handleAddEvaluation}
                    onAddGrade={handleAddGrade}
                  />
                )
              )}

              {activeTab === 'archive' && currentRole !== 'parent' && (
                <ArchiveView
                  userRole={currentRole}
                  evaluationsList={archivedEvaluations}
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

              {activeTab === 'bulletins' && currentRole === 'super_admin' && (
                <BulletinsView
                  schoolsList={schoolsList}
                  classesList={classesList}
                  studentsList={studentsList}
                  evaluationsList={activeEvaluations}
                  gradesList={gradesList}
                  teacherClassIds={[]}
                />
              )}

              {activeTab === 'bulletins' && currentRole !== 'super_admin' && null}

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
                  classesList={classesList}
                  studentsList={studentsList}
                  onSendNotification={handleSendNotification}
                  onMarkAllAsRead={handleMarkAllAsRead}
                  onNotificationRead={handleNotificationRead}
                />
              )}

              {activeTab === 'mobile-parent' && (
                <MobileParentView
                  studentsList={studentsList}
                  parentsList={parentsList}
                  absencesList={absencesList}
                  gradesList={gradesList}
                  notificationsList={notificationsList}
                  onJustifyAbsence={handleJustifyAbsence}
                  onNotificationRead={handleNotificationRead}
                />
              )}
            </div>
          )}

        </main>

      </div>
    </div>
  );
}
