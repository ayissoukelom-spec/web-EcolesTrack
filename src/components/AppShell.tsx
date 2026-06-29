import { useEffect, useState } from 'react';
import type { AcademicYear, AuditEvent, Class, Parent, School, Student, SystemNotification, Teacher, User, UserRole } from '../types.ts';
import { apiFetch, clearSimulatedRole, clearSimulatedUser, getSimulatedRole, getSimulatedSchoolId, getSimulatedUser, getUiErrorMessage, setSimulatedRole, setSimulatedUser, findTeacherProfileFromSimulatedUser } from '../lib/api.ts';
import { upsertGradeInList } from '../lib/gradeState';
import { isEvaluationCompleted } from '../lib/evaluationUtils.ts';
import AppLayout from './AppLayout.tsx';
import LoginView from './LoginView.tsx';
import DashboardView from './DashboardView.tsx';
import AdminView from './AdminView.tsx';
import ErrorBoundary from './ErrorBoundary.tsx';
import AbsenceView from './AbsenceView.tsx';
import NotesView from './NotesView.tsx';
import NotificationView from './NotificationView.tsx';
import AuditView from './AuditView.tsx';
import MobileParentView from './MobileParentView.tsx';
import ArchiveView from './ArchiveView.tsx';
import BulletinsView from './BulletinsView.tsx';
import { useAdminDashboard } from '../hooks/useAdminDashboard.ts';
import { useStudents } from '../hooks/useStudents.ts';
import { useClasses } from '../hooks/useClasses.ts';
import { useAbsences } from '../hooks/useAbsences.ts';

export default function AppShell() {
  const [currentRole, setCurrentRole] = useState<UserRole>('' as UserRole);
  const [currentSchoolId, setCurrentSchoolId] = useState<number | null>(getSimulatedSchoolId());
  const [superAdminSchoolFilterId, setSuperAdminSchoolFilterId] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState('tableau-de-bord');
  const [isSyncing, setIsSyncing] = useState(false);
  const [isAuditLoading, setIsAuditLoading] = useState(false);
  const [importResult, setImportResult] = useState<any | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [schoolsList, setSchoolsList] = useState<School[]>([]);
  const [yearsList, setYearsList] = useState<AcademicYear[]>([]);
  const [teachersList, setTeachersList] = useState<Teacher[]>([]);
  const [parentsList, setParentsList] = useState<Parent[]>([]);
  const [evaluationsList, setEvaluationsList] = useState<any[]>([]);
  const [gradesList, setGradesList] = useState<any[]>([]);
  const [notificationsList, setNotificationsList] = useState<SystemNotification[]>([]);
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);
  const [usersList, setUsersList] = useState<User[]>([]);

  const {
    stats,
    recentAbsences: summaryRecentAbsences,
    recentGrades: summaryRecentGrades,
    refresh: refreshDashboard,
  } = useAdminDashboard();
  const { classes: classesList, refresh: refreshClasses, addClass: addClassApi, deleteClass: deleteClassApi } = useClasses();
  const { students: studentsList, refresh: refreshStudents, addStudent: addStudentApi, updateStudent: updateStudentApi, batchCreateStudents } = useStudents();
  const { absences: absencesList, refresh: refreshAbsences, addAbsence: addAbsenceApi, justifyAbsence } = useAbsences();

  const simulatedUser = getSimulatedUser();
  const currentTeacherProfile = findTeacherProfileFromSimulatedUser(currentRole, simulatedUser, teachersList, usersList);

  const currentTeacherClassIds = currentTeacherProfile?.classIds || [];
  const currentTeacherSpecializations = currentTeacherProfile?.specialization
    ? Array.isArray(currentTeacherProfile.specialization)
      ? currentTeacherProfile.specialization
      : String(currentTeacherProfile.specialization).split(',').map((item) => item.trim()).filter(Boolean)
    : [];
  const visibleErrorMsg = getUiErrorMessage(errorMsg);

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

  const fetchAllData = async (showSpinner = true) => {
    if (showSpinner) setIsSyncing(true);
    setErrorMsg(null);
    try {
      await apiFetch('/api/auth/register-or-login', { method: 'POST' });
      await Promise.all([refreshDashboard(), refreshClasses(), refreshStudents(), refreshAbsences()]);

      const endpoints = [
        '/api/schools',
        '/api/academic-years',
        '/api/teachers',
        '/api/parents',
        '/api/evaluations',
        '/api/grades',
        '/api/notifications',
        '/api/simulation/users',
      ];

      const results = await Promise.all(endpoints.map((endpoint) => apiFetch(endpoint).catch((err) => ({ __error: true, error: err }))));
      const map = Object.fromEntries(endpoints.map((endpoint, index) => [endpoint, results[index]]));

      setSchoolsList(Array.isArray(map['/api/schools']) ? map['/api/schools'] : []);
      setYearsList(Array.isArray(map['/api/academic-years']) ? map['/api/academic-years'] : []);
      setTeachersList(Array.isArray(map['/api/teachers']) ? map['/api/teachers'] : []);
      setParentsList(Array.isArray(map['/api/parents']) ? map['/api/parents'] : []);
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
    const savedRole = getSimulatedRole();
    setCurrentRole(savedRole ? (savedRole as UserRole) : ('' as UserRole));

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
    if (currentRole) {
      fetchAllData();
    }
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

    const existingSimUser = getSimulatedUser();
    if (!existingSimUser) {
      if (newRole === 'teacher') {
        const preferred = teachersList.find((teacher) => teacher.schoolId === currentSchoolId) || teachersList[0];
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
    setCurrentRole(newRole as UserRole);
    setCurrentSchoolId(getSimulatedSchoolId());
    window.history.replaceState(null, '', '/');
  };

  const handleLogout = async () => {
    clearSimulatedRole();
    clearSimulatedUser();
    setCurrentRole('' as UserRole);
    setCurrentSchoolId(null);
    try {
      await apiFetch('/api/auth/logout', { method: 'POST' });
    } catch (error) {
      console.warn('Logout request failed', error);
    }
    window.location.replace('/login');
  };

  const handleAddSchool = async (data: { name: string; address: string; phone: string; classNames?: string[] }) => {
    const createdSchool = await apiFetch('/api/schools', { method: 'POST', body: JSON.stringify(data) });
    await fetchAllData(false);
    return createdSchool;
  };

  const handleAddYear = async (data: { name: string; isActive: boolean; schoolId?: number }) => {
    await apiFetch('/api/academic-years', { method: 'POST', body: JSON.stringify(data) });
    await fetchAllData(false);
  };

  const handleAddClass = async (data: { name: string; schoolId?: number | null; academicYearId: number; teacherId?: number }) => {
    await apiFetch('/api/classes', { method: 'POST', body: JSON.stringify(data) });
    await fetchAllData(false);
  };

  const handleDeleteClass = async (id: number) => {
    await apiFetch(`/api/classes/${id}`, { method: 'DELETE' });
    await fetchAllData();
  };

  const handleDeleteSchool = async (id: number) => {
    try {
      await apiFetch(`/api/schools/${id}`, { method: 'DELETE' });
      await fetchAllData();
    } catch (error: any) {
      if (error.message && error.message.includes('École introuvable')) {
        setErrorMsg('L’école demandée n’existe plus. Rafraîchissez la page puis réessayez.');
        await fetchAllData();
      } else {
        setErrorMsg(error.message || 'Impossible de supprimer l’école.');
      }
    }
  };

  const handleUpdateSchool = async (id: number, data: { name: string; address: string; phone: string; classNames?: string[] }) => {
    await apiFetch(`/api/schools/${id}`, { method: 'PUT', body: JSON.stringify(data) });
    await fetchAllData();
  };

  const handleUpdateStudent = async (id: number, data: { firstName: string; lastName: string; birthDate: string | null; schoolId?: number; classId: number; parentId: number; academicYearId?: number; teacherIds?: number[]; schoolAdminId?: number; gender?: string }) => {
    await updateStudentApi(id, data);
    await fetchAllData();
  };

  const handleAddTeacher = async (data: { name: string; email: string; phone: string; specialization: string | string[]; schoolId: number; classIds?: number[]; gender?: string }) => {
    const created = await apiFetch('/api/teachers', { method: 'POST', body: JSON.stringify(data) });
    await fetchAllData(false);
    return created;
  };

  const handleAddParent = async (data: { name: string; email: string; phone: string; address: string; schoolId?: number; studentId?: number; gender?: string }) => {
    const created = await apiFetch('/api/parents', { method: 'POST', body: JSON.stringify(data) });
    const parents = await apiFetch('/api/parents');
    setParentsList(parents);
    return created;
  };

  const handleAddStudent = async (data: { firstName: string; lastName: string; birthDate: string; schoolId: number; classId: number; parentId?: number; academicYearId?: number; teacherIds?: number[]; schoolAdminId?: number; gender?: string }) => {
    await apiFetch('/api/students', { method: 'POST', body: JSON.stringify(data) });
    await fetchAllData();
  };

  const handleBatchCreateStudents = async (records: any[]) => {
    const json = await batchCreateStudents(records);
    setImportResult(json);
    if (json.insertedCount && json.insertedCount > 0) {
      await fetchAllData();
    }
  };

  const handleBatchCreateParents = async (records: any[]) => {
    const json = await apiFetch('/api/parents/batch', { method: 'POST', body: JSON.stringify(records) });
    setImportResult(json);
    if (json.insertedCount && json.insertedCount > 0) {
      await fetchAllData();
    }
  };

  const handleCreateUser = async (data: { uid?: string; email: string; name: string; role: string; schoolId?: number; academicYearId?: number; phone?: string; specialization?: string | string[]; gender?: string; password?: string; classIds?: number[] }) => {
    const created = await apiFetch('/api/admin/users', { method: 'POST', body: JSON.stringify(data) });
    await fetchAllData();
    return created;
  };

  const handleUpdateUser = async (id: number, data: { email: string; name: string; role: string; schoolId?: number; academicYearId?: number; phone?: string; specialization?: string | string[]; gender?: string; classIds?: number[] }) => {
    await apiFetch(`/api/admin/users/${id}`, { method: 'PUT', body: JSON.stringify(data) });
    await fetchAllData();
  };

  const handleSetPassword = async (userId: number, password: string) => {
    await apiFetch('/api/admin/set-password', { method: 'POST', body: JSON.stringify({ userId, password }) });
    await fetchAllData();
  };

  const handleDeleteUser = async (id: number) => {
    await apiFetch(`/api/admin/users/${id}`, { method: 'DELETE' });
    await fetchAllData();
  };

  const handleAddAbsence = async (data: { studentId: number; classId: number; date: string; period: string; isJustified: boolean }) => {
    await addAbsenceApi(data);
    await fetchAllData();
  };

  const handleJustifyAbsence = async (id: number, reason: string) => {
    await justifyAbsence(id, reason);
    await fetchAllData();
  };

  const handleAddEvaluation = async (data: { classId: number; subject: string; title: string; coefficient: number; maxScore: number; date: string }) => {
    await apiFetch('/api/evaluations', { method: 'POST', body: JSON.stringify(data) });
    await fetchAllData();
  };

  const handleAddGrade = async (data: { evaluationId: number; studentId: number; score: string; remarks: string }) => {
    const createdOrUpdatedGrade = await apiFetch('/api/grades', { method: 'POST', body: JSON.stringify(data) });
    setGradesList((previousGrades) => upsertGradeInList(previousGrades as any[], {
      id: createdOrUpdatedGrade.id ?? Date.now(),
      evaluationId: data.evaluationId,
      studentId: data.studentId,
      score: data.score,
      remarks: data.remarks,
      editCount: createdOrUpdatedGrade.editCount ?? 0,
      createdAt: createdOrUpdatedGrade.createdAt,
      updatedAt: createdOrUpdatedGrade.updatedAt,
      isModified: createdOrUpdatedGrade.isModified ?? ((createdOrUpdatedGrade.editCount ?? 0) > 0),
      evaluationTitle: createdOrUpdatedGrade.evaluationTitle ?? '',
      subject: createdOrUpdatedGrade.subject ?? '',
    }));
  };

  const handleSendNotification = async (data: { title: string; body: string; type: string; userId?: number }) => {
    await apiFetch('/api/notifications/send', { method: 'POST', body: JSON.stringify(data) });
    await fetchAllData();
  };

  const handleMarkAllAsRead = async () => {
    await apiFetch('/api/notifications/read-all', { method: 'PUT' });
    await fetchAllData();
  };

  const content = (() => {
    // Centralized filtering of evaluations: separate active from completed
    const activeEvaluations = evaluationsList.filter((ev) => !isEvaluationCompleted(ev, studentsList, gradesList));
    const completedEvaluations = evaluationsList.filter((ev) => isEvaluationCompleted(ev, studentsList, gradesList));

    if (activeTab === 'tableau-de-bord') {
      return <DashboardView stats={stats} recentAbsences={summaryRecentAbsences} recentGrades={summaryRecentGrades} userRole={currentRole} />;
    }

    if (activeTab === 'administration') {
      return (
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
      );
    }

    if (activeTab === 'absences') {
      return <AbsenceView userRole={currentRole} absencesList={absencesList} studentsList={studentsList} classesList={classesList} schoolsList={schoolsList} onAddAbsence={handleAddAbsence} onJustifyAbsence={handleJustifyAbsence} />;
    }

    if (activeTab === 'notes' && currentRole !== 'parent') {
      return (
        <NotesView
          userRole={currentRole}
          evaluationsList={activeEvaluations}
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
      );
    }

    if (activeTab === 'archive' && currentRole !== 'parent') {
      return (
        <ArchiveView
          userRole={currentRole}
          evaluationsList={completedEvaluations}
          gradesList={gradesList}
          studentsList={studentsList}
          classesList={classesList}
          schoolsList={schoolsList}
          schoolFilterId={superAdminSchoolFilterId}
          onSchoolFilterChange={setSuperAdminSchoolFilterId}
          teacherClassIds={currentRole === 'teacher' ? currentTeacherClassIds : []}
          teacherId={currentRole === 'teacher' ? currentTeacherProfile?.id : undefined}
        />
      );
    }

    if (activeTab === 'bulletins') {
      return <BulletinsView currentRole={currentRole} classesList={classesList} studentsList={studentsList} evaluationsList={activeEvaluations} teacherClassIds={currentRole === 'teacher' ? currentTeacherClassIds : []} />;
    }

    if (activeTab === 'audit' && currentRole === 'super_admin') {
      return <AuditView auditEvents={auditEvents} isLoading={isAuditLoading} onReload={fetchAuditEvents} />;
    }

    if (activeTab === 'notifications') {
      return <NotificationView userRole={currentRole} notificationsList={notificationsList} usersList={usersList} onSendNotification={handleSendNotification} onMarkAllAsRead={handleMarkAllAsRead} />;
    }

    if (activeTab === 'mobile-parent') {
      return <MobileParentView currentRole={currentRole} studentsList={studentsList} parentsList={parentsList} absencesList={absencesList} gradesList={gradesList} notificationsList={notificationsList} onJustifyAbsence={handleJustifyAbsence} />;
    }

    return null;
  })();

  if (!currentRole) {
    return <LoginView onLogin={handleRoleChange} />;
  }

  return (
    <AppLayout
      currentRole={currentRole}
      schoolsList={schoolsList}
      parentsList={parentsList}
      classesList={classesList}
      teachersList={teachersList}
      studentsList={studentsList}
      yearsList={yearsList}
      notificationsList={notificationsList}
      activeTab={activeTab}
      isSyncing={isSyncing}
      errorMsg={visibleErrorMsg}
      onRoleChange={handleRoleChange}
      onLogout={handleLogout}
      onRefreshData={fetchAllData}
      onManageAccounts={() => setActiveTab('administration')}
      onTabChange={setActiveTab}
      onClearError={() => setErrorMsg(null)}
    >
      {content}
    </AppLayout>
  );
}