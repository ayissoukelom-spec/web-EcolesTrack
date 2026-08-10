import { createHotContext as __vite__createHotContext } from "/@vite/client";import.meta.hot = __vite__createHotContext("/src/App.tsx");import __vite__cjsImport0_react_jsxDevRuntime from "/node_modules/.vite/deps/react_jsx-dev-runtime.js?v=6a93e62d"; const Fragment = __vite__cjsImport0_react_jsxDevRuntime["Fragment"]; const jsxDEV = __vite__cjsImport0_react_jsxDevRuntime["jsxDEV"];
var _s = $RefreshSig$();
import __vite__cjsImport1_react from "/node_modules/.vite/deps/react.js?v=6a93e62d"; const useRef = __vite__cjsImport1_react["useRef"]; const useState = __vite__cjsImport1_react["useState"]; const useEffect = __vite__cjsImport1_react["useEffect"];
import {
  apiFetch,
  getUiErrorMessage,
  setSimulatedRole,
  clearSimulatedRole,
  clearSimulatedUser,
  setSimulatedUser,
  findTeacherProfileFromSimulatedUser
} from "/src/lib/api.ts";
import { useAuth } from "/src/contexts/AuthContext.tsx";
import { countOverdueEvaluations, isEvaluationArchived, isEvaluationLockedBySchoolAdmin, isEvaluationArchivedForSchoolAdminByAge } from "/src/lib/evaluationUtils.ts";
import SimulatorHeader from "/src/components/SimulatorHeader.tsx?t=1786399278690";
import LoginView from "/src/components/LoginView.tsx";
import DashboardView from "/src/components/DashboardView.tsx";
import AdminView from "/src/components/AdminView.tsx?t=1786399278729";
import ErrorBoundary from "/src/components/ErrorBoundary.tsx";
import AbsenceView from "/src/components/AbsenceView.tsx";
import NotesView from "/src/components/NotesView.tsx";
import NotificationView from "/src/components/NotificationView.tsx";
import AuditView from "/src/components/AuditView.tsx";
import MobileParentView from "/src/components/MobileParentView.tsx";
import ParentNotesView from "/src/components/ParentNotesView.tsx";
import ArchiveView from "/src/components/ArchiveView.tsx";
import BulletinsView from "/src/components/BulletinsView.tsx";
import GlobalErrorToast from "/src/components/GlobalErrorToast.tsx";
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
  RefreshCw,
  AlertCircle
} from "/node_modules/.vite/deps/lucide-react.js?v=6a93e62d";
export default function App() {
  _s();
  const { user: authenticatedUser, token, role, activeSchoolId } = useAuth();
  const currentRole = role;
  const currentSchoolId = activeSchoolId;
  const [superAdminSchoolFilterId, setSuperAdminSchoolFilterId] = useState(null);
  const [activeTab, setActiveTab] = useState("tableau-de-bord");
  const [isSyncing, setIsSyncing] = useState(false);
  const [isAuditLoading, setIsAuditLoading] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const [errorMsg, setErrorMsg] = useState(null);
  const [stats, setStats] = useState({
    totalStudents: 0,
    totalAbsences: 0,
    totalClasses: 0,
    totalTeachers: 0,
    attendanceRate: 94.5
  });
  const [chartData, setChartData] = useState([]);
  const [schoolsList, setSchoolsList] = useState([]);
  const [yearsList, setYearsList] = useState([]);
  const [classesList, setClassesList] = useState([]);
  const [teachersList, setTeachersList] = useState([]);
  const [studentsList, setStudentsList] = useState([]);
  const [parentsList, setParentsList] = useState([]);
  const logTeachersPayload = (prefix, payload) => {
    if (!Array.isArray(payload)) {
      console.log(`${prefix} payload is not an array:`, payload);
      return;
    }
    console.log(`${prefix} length=${payload.length}`);
    payload.forEach((teacher, index) => {
      console.log(`${prefix} [${index}]`, {
        id: teacher?.id,
        uid: teacher?.uid,
        email: teacher?.email,
        classIds: teacher?.classIds
      });
    });
  };
  const [absencesList, setAbsencesList] = useState([]);
  const [summaryRecentAbsences, setSummaryRecentAbsences] = useState([]);
  const unjustifiedAbsencesCount = absencesList.filter((absence) => !absence.isJustified).length;
  const [evaluationsList, setEvaluationsList] = useState([]);
  const [gradesList, setGradesList] = useState([]);
  const [summaryRecentGrades, setSummaryRecentGrades] = useState([]);
  const [notificationsList, setNotificationsList] = useState([]);
  const [auditEvents, setAuditEvents] = useState([]);
  const [usersList, setUsersList] = useState([]);
  const [subjectsList, setSubjectsList] = useState([]);
  const [approvedSubjectsList, setApprovedSubjectsList] = useState([]);
  const processedNotificationIdsRef = useRef(/* @__PURE__ */ new Set());
  const currentTeacherProfile = findTeacherProfileFromSimulatedUser(currentRole, authenticatedUser, teachersList, usersList);
  const currentTeacherClassIds = currentTeacherProfile?.classIds || [];
  const currentTeacherSpecializations = currentTeacherProfile?.specialization ? Array.isArray(currentTeacherProfile.specialization) ? currentTeacherProfile.specialization : String(currentTeacherProfile.specialization).split(/[,;&|\/\+]/).map((item) => item.trim()).filter(Boolean) : [];
  const visibleErrorMsg = getUiErrorMessage(errorMsg);
  const noteOverdueCount = currentRole === "teacher" || currentRole === "school_admin" || currentRole === "super_admin" ? countOverdueEvaluations(
    evaluationsList,
    studentsList,
    gradesList,
    currentRole,
    currentRole === "teacher" ? currentTeacherProfile?.id : void 0
  ) : 0;
  const normalizeStudentsPayload = (payload) => {
    if (Array.isArray(payload)) return payload;
    if (payload && typeof payload === "object") {
      const record = payload;
      const maybeStudents = record.students;
      if (Array.isArray(maybeStudents)) return maybeStudents;
      const maybeData = record.data;
      if (Array.isArray(maybeData)) return maybeData;
      if (maybeData && typeof maybeData === "object") {
        const nestedStudents = maybeData.students;
        if (Array.isArray(nestedStudents)) return nestedStudents;
      }
    }
    return [];
  };
  const fetchAuditEvents = async () => {
    if (currentRole !== "super_admin") {
      setAuditEvents([]);
      return;
    }
    setIsAuditLoading(true);
    try {
      const events = await apiFetch("/api/audit/events");
      setAuditEvents(events);
    } catch (auditErr) {
      console.warn("Impossible de charger le journal d'événements :", auditErr);
      setAuditEvents([]);
      setErrorMsg("Impossible de charger le journal des actions.");
    } finally {
      setIsAuditLoading(false);
    }
  };
  const fetchAllData = async (showSpinner = true) => {
    if (showSpinner) setIsSyncing(true);
    setErrorMsg(null);
    try {
      await apiFetch("/api/auth/register-or-login", { method: "POST" }).catch((err) => {
        const uiMessage = getUiErrorMessage(err);
        if (uiMessage) {
          console.warn("Auth sync warning ignored in UI:", err);
        }
      });
      const summary = await apiFetch("/api/dashboard/summary");
      console.log("RAW API RESPONSE DASHBOARD:", summary);
      console.log("chartData reçu:", summary?.chartData);
      if (summary && typeof summary === "object") {
        if ("stats" in summary) setStats(summary.stats);
        if ("recentGrades" in summary) setSummaryRecentGrades(summary.recentGrades);
        if ("recentAbsences" in summary) {
          setSummaryRecentAbsences(summary.recentAbsences);
          setAbsencesList(summary.recentAbsences);
        }
        if (Array.isArray(summary.chartData)) {
          setChartData(summary.chartData);
        } else {
          setChartData([]);
        }
      }
      const endpoints = [
        "/api/schools",
        "/api/academic-years",
        "/api/classes",
        "/api/teachers",
        "/api/students",
        "/api/parents",
        "/api/absences",
        "/api/evaluations",
        "/api/grades",
        "/api/notifications",
        "/api/subjects",
        "/api/subjects?approvedOnly=true",
        "/api/simulation/users"
      ];
      const promises = endpoints.map((e) => apiFetch(e).catch((err) => ({ __error: true, error: err })));
      const results = await Promise.all(promises);
      const map = Object.fromEntries(endpoints.map((e, i) => [e, results[i]]));
      logTeachersPayload("RAW_API_RESPONSE_/api/teachers", results[endpoints.indexOf("/api/teachers")]);
      logTeachersPayload("MAP_/api/teachers", map["/api/teachers"]);
      if (Array.isArray(map["/api/teachers"])) {
        logTeachersPayload("BEFORE_SET_TEACHERSLIST", map["/api/teachers"]);
        setTeachersList(map["/api/teachers"]);
      }
      if (Array.isArray(map["/api/schools"])) setSchoolsList(map["/api/schools"]);
      if (Array.isArray(map["/api/academic-years"])) setYearsList(map["/api/academic-years"]);
      if (Array.isArray(map["/api/classes"])) setClassesList(map["/api/classes"]);
      const rawStudentsPayload = map["/api/students"];
      const normalizedStudents = normalizeStudentsPayload(rawStudentsPayload);
      setStudentsList(normalizedStudents);
      if (Array.isArray(map["/api/parents"])) setParentsList(map["/api/parents"]);
      if (Array.isArray(map["/api/absences"])) setAbsencesList(map["/api/absences"]);
      if (Array.isArray(map["/api/evaluations"])) setEvaluationsList(map["/api/evaluations"]);
      if (Array.isArray(map["/api/grades"])) setGradesList(map["/api/grades"]);
      if (Array.isArray(map["/api/notifications"])) setNotificationsList(map["/api/notifications"]);
      if (Array.isArray(map["/api/subjects"])) setSubjectsList(map["/api/subjects"]);
      if (Array.isArray(map["/api/subjects?approvedOnly=true"])) setApprovedSubjectsList(map["/api/subjects?approvedOnly=true"]);
      if (Array.isArray(map["/api/simulation/users"])) setUsersList(map["/api/simulation/users"]);
      if (currentRole === "super_admin") {
        await fetchAuditEvents();
      } else {
        setAuditEvents([]);
      }
    } catch (err) {
      const uiMessage = getUiErrorMessage(err, "Impossible de charger les données EcoleTrack.");
      if (uiMessage) {
        setErrorMsg(uiMessage);
      }
      console.error("Error hydrating EcoleTrack database:", err);
      console.warn("[students-load] keeping existing student list because the refresh failed.", err);
    } finally {
      setIsSyncing(false);
    }
  };
  useEffect(() => {
    if (currentRole !== "super_admin") return;
    const schoolId = superAdminSchoolFilterId;
    const endpoint = schoolId ? `/api/classes?schoolId=${schoolId}` : "/api/classes";
    (async () => {
      try {
        const payload = await apiFetch(endpoint);
        setClassesList(Array.isArray(payload) ? payload : []);
      } catch (err) {
        console.warn("Failed to load classes for super admin school filter", err);
      }
    })();
  }, [superAdminSchoolFilterId, currentRole]);
  useEffect(() => {
    logTeachersPayload("AFTER_SET_TEACHERSLIST", teachersList);
  }, [teachersList]);
  useEffect(() => {
    if (role !== "super_admin") {
      setSuperAdminSchoolFilterId(null);
    }
    if (role) fetchAllData();
  }, [role]);
  useEffect(() => {
    if (!role) return;
    if (currentRole === "super_admin" || activeSchoolId != null) {
      fetchAllData();
    }
  }, [activeSchoolId, currentRole, role]);
  useEffect(() => {
    if (!notificationsList || notificationsList.length === 0) return;
    const newNotifs = notificationsList.filter((notif) => !processedNotificationIdsRef.current.has(notif.id));
    if (newNotifs.length === 0) return;
    const hasAbsence = newNotifs.some((notif) => notif.type === "absence");
    const hasGrade = newNotifs.some((notif) => notif.type === "grade");
    if (!hasAbsence && !hasGrade) return;
    newNotifs.forEach((notif) => processedNotificationIdsRef.current.add(notif.id));
    if (hasAbsence || hasGrade) {
      fetchAllData(false);
    }
  }, [notificationsList]);
  useEffect(() => {
    if (activeTab === "audit" && currentRole === "super_admin") {
      fetchAuditEvents();
    }
  }, [activeTab, currentRole]);
  const handleRoleChange = (newRole) => {
    if (!newRole) {
      clearSimulatedRole();
      clearSimulatedUser();
      window.history.replaceState(null, "", "/login");
      return;
    }
    const existingSimUser = authenticatedUser;
    if (!existingSimUser) {
      if (newRole === "teacher") {
        const preferred = teachersList.find((t) => t.schoolId === currentSchoolId) || teachersList[0];
        if (preferred) {
          setSimulatedUser({ uid: `teacher_${preferred.userId || preferred.id}`, email: preferred.email || "", name: preferred.name || "Enseignant", schoolId: preferred.schoolId });
        } else {
          setSimulatedUser({ uid: `sim_teacher_${Date.now()}`, email: "sim_teacher@example.test", name: "Enseignant Simulé", schoolId: currentSchoolId });
        }
      } else if (newRole === "school_admin") {
        setSimulatedUser({ uid: `sim_schooladmin_${Date.now()}`, email: "sim_schooladmin@example.test", name: "Admin Ecole", schoolId: currentSchoolId });
      } else if (newRole === "parent") {
        setSimulatedUser({ uid: `sim_parent_${Date.now()}`, email: "sim_parent@example.test", name: "Parent Simulé", schoolId: currentSchoolId });
      }
    }
    setSimulatedRole(newRole);
    window.history.replaceState(null, "", "/");
  };
  const handleLogout = async () => {
    clearSimulatedRole();
    clearSimulatedUser();
    try {
      await apiFetch("/api/auth/logout", { method: "POST" });
    } catch (e) {
      console.warn("Logout request failed", e);
    }
    window.location.replace("/login");
  };
  const handleAddSchool = async (data) => {
    try {
      const createdSchool = await apiFetch("/api/schools", {
        method: "POST",
        body: JSON.stringify(data)
      });
      await fetchAllData(false);
      return createdSchool;
    } catch (err) {
      setErrorMsg(err.message || "Impossible d'ajouter l'école");
      throw err;
    }
  };
  const handleAddYear = async (data) => {
    try {
      await apiFetch("/api/academic-years", {
        method: "POST",
        body: JSON.stringify(data)
      });
      await fetchAllData(false);
    } catch (err) {
      setErrorMsg(err.message || "Impossible d'ajouter l'année");
      throw err;
    }
  };
  const handleSetActiveYear = async (yearId) => {
    try {
      await apiFetch(`/api/academic-years/${yearId}/activate`, {
        method: "PUT"
      });
      await fetchAllData(false);
    } catch (err) {
      setErrorMsg(err.message || "Impossible de définir cette année comme active");
      throw err;
    }
  };
  const handleDeleteYear = async (yearId) => {
    try {
      await apiFetch(`/api/academic-years/${yearId}`, {
        method: "DELETE"
      });
      await fetchAllData(false);
    } catch (err) {
      setErrorMsg(err.message || "Impossible de supprimer cette année scolaire");
      throw err;
    }
  };
  const handleAddClass = async (data) => {
    try {
      const payload = {
        ...data,
        schoolId: data.schoolId ?? null
      };
      await apiFetch("/api/classes", {
        method: "POST",
        body: JSON.stringify(payload)
      });
      await fetchAllData(false);
    } catch (err) {
      setErrorMsg(err.message || "Impossible de créer la classe");
      throw err;
    }
  };
  const handleDeleteClass = async (id) => {
    try {
      await apiFetch(`/api/classes/${id}`, { method: "DELETE" });
      fetchAllData();
    } catch (err) {
      setErrorMsg(err.message || "Suppression impossible");
    }
  };
  const handleApproveClass = async (id) => {
    try {
      const schoolId = currentSchoolId;
      if (!schoolId) throw new Error("Aucun établissement sélectionné pour approuver la classe");
      await apiFetch(`/api/schools/${schoolId}/classes/${id}/approve`, { method: "POST" });
      setClassesList((prev) => prev.map((c) => c.id === id ? { ...c, status: "approved" } : c));
      await fetchAllData(false);
    } catch (err) {
      setErrorMsg(err.message || "Impossible d'approuver la classe.");
      throw err;
    }
  };
  const handleRejectClass = async (id) => {
    try {
      const schoolId = currentSchoolId;
      if (!schoolId) throw new Error("Aucun établissement sélectionné pour refuser la classe");
      await apiFetch(`/api/schools/${schoolId}/classes/${id}/reject`, { method: "POST" });
      setClassesList((prev) => prev.map((c) => c.id === id ? { ...c, status: "rejected" } : c));
      await fetchAllData(false);
    } catch (err) {
      setErrorMsg(err.message || "Impossible de refuser la classe.");
      throw err;
    }
  };
  const handleDeleteSchool = async (id) => {
    try {
      await apiFetch(`/api/schools/${id}`, { method: "DELETE" });
      fetchAllData();
    } catch (err) {
      if (err.message && err.message.includes("École introuvable")) {
        setErrorMsg("L’école demandée n’existe plus. Rafraîchissez la page puis réessayez.");
        await fetchAllData();
      } else {
        setErrorMsg(err.message || "Impossible de supprimer l’école.");
      }
    }
  };
  const handleUpdateSchool = async (id, data) => {
    try {
      await apiFetch(`/api/schools/${id}`, {
        method: "PUT",
        body: JSON.stringify(data)
      });
      fetchAllData();
    } catch (err) {
      setErrorMsg(err.message || "Impossible de mettre à jour l'école");
      throw err;
    }
  };
  const handleUpdateStudent = async (id, data) => {
    try {
      await apiFetch(`/api/students/${id}`, {
        method: "PUT",
        body: JSON.stringify(data)
      });
      fetchAllData();
    } catch (err) {
      setErrorMsg(err.message || "Impossible de mettre à jour l'élève");
      throw err;
    }
  };
  const handleAddTeacher = async (data) => {
    try {
      const created = await apiFetch("/api/teachers", {
        method: "POST",
        body: JSON.stringify(data)
      });
      await fetchAllData(false);
      return created;
    } catch (err) {
      setErrorMsg(err.message);
      throw err;
    }
  };
  const handleAddParent = async (data) => {
    try {
      const created = await apiFetch("/api/parents", {
        method: "POST",
        body: JSON.stringify(data)
      });
      const parents = await apiFetch("/api/parents");
      setParentsList(parents);
      return created;
    } catch (err) {
      setErrorMsg(err.message);
      throw err;
    }
  };
  const handleAddStudent = async (data) => {
    try {
      await apiFetch("/api/students", {
        method: "POST",
        body: JSON.stringify(data)
      });
      fetchAllData();
    } catch (err) {
      setErrorMsg(err.message);
    }
  };
  const handleBatchCreateStudents = async (records) => {
    try {
      const json = await apiFetch("/api/students/batch", {
        method: "POST",
        body: JSON.stringify(records)
      });
      setImportResult(json);
      if (json.insertedCount && json.insertedCount > 0) fetchAllData();
    } catch (err) {
      setErrorMsg(err.message || "Import CSV impossible");
    }
  };
  const handleBatchCreateParents = async (records) => {
    try {
      const json = await apiFetch("/api/parents/batch", {
        method: "POST",
        body: JSON.stringify(records)
      });
      setImportResult(json);
      if (json.insertedCount && json.insertedCount > 0) fetchAllData();
    } catch (err) {
      setErrorMsg(err.message || "Import parents impossible");
    }
  };
  const handleCreateUser = async (data) => {
    try {
      const created = await apiFetch("/api/admin/users", {
        method: "POST",
        body: JSON.stringify(data)
      });
      fetchAllData();
      return created;
    } catch (err) {
      const userFriendlyMessage = err.status === 403 || /Forbidden/.test(err.message) ? "Erreur : vous n’êtes pas autorisé à créer ce compte pour cette école ou ce rôle." : err.message || "Failed to create user";
      setErrorMsg(userFriendlyMessage);
      throw new Error(userFriendlyMessage);
    }
  };
  const handleUpdateUser = async (id, data) => {
    try {
      await apiFetch(`/api/admin/users/${id}`, {
        method: "PUT",
        body: JSON.stringify(data)
      });
      fetchAllData();
    } catch (err) {
      setErrorMsg(err.message || "Impossible de mettre à jour le compte");
      throw err;
    }
  };
  const handleSetPassword = async (userId, password) => {
    try {
      await apiFetch("/api/admin/set-password", {
        method: "POST",
        body: JSON.stringify({ userId, password })
      });
      fetchAllData();
    } catch (err) {
      setErrorMsg(err.message || "Impossible de mettre à jour le mot de passe");
      throw err;
    }
  };
  const handleDeleteUser = async (id) => {
    try {
      await apiFetch(`/api/admin/users/${id}`, {
        method: "DELETE"
      });
      fetchAllData();
    } catch (err) {
      setErrorMsg(err.message || "Impossible de supprimer le compte");
      throw err;
    }
  };
  const handleAddAbsence = async (data) => {
    try {
      await apiFetch("/api/absences", {
        method: "POST",
        body: JSON.stringify(data)
      });
      fetchAllData();
    } catch (err) {
      setErrorMsg(err.message);
    }
  };
  const handleJustifyAbsence = async (id, reason) => {
    try {
      await apiFetch(`/api/absences/${id}/justify`, {
        method: "PUT",
        body: JSON.stringify({ justificationReason: reason })
      });
      fetchAllData();
    } catch (err) {
      setErrorMsg(err.message);
    }
  };
  const handleAddEvaluation = async (data) => {
    try {
      console.debug("Creating evaluation", data);
      await apiFetch("/api/evaluations", {
        method: "POST",
        body: JSON.stringify(data)
      });
      console.debug("Evaluation created, refreshing data");
      fetchAllData();
    } catch (err) {
      setErrorMsg(err.message);
    }
  };
  const refreshApprovedSubjects = async () => {
    try {
      const approved = await apiFetch("/api/subjects?approvedOnly=true");
      if (Array.isArray(approved)) setApprovedSubjectsList(approved);
    } catch (err) {
      console.warn("Unable to refresh approved subject list:", err);
    }
  };
  const handleAddGrade = async (data) => {
    try {
      const createdOrUpdatedGrade = await apiFetch("/api/grades", {
        method: "POST",
        body: JSON.stringify(data)
      });
      setGradesList((prev) => {
        const existingIndex = prev.findIndex(
          (g) => g.evaluationId === data.evaluationId && g.studentId === data.studentId
        );
        const gradeEntry = {
          id: createdOrUpdatedGrade.id ?? (existingIndex !== -1 ? prev[existingIndex].id : Date.now()),
          evaluationId: data.evaluationId,
          studentId: data.studentId,
          score: data.score,
          remarks: data.remarks,
          editCount: createdOrUpdatedGrade.editCount ?? prev[existingIndex]?.editCount ?? 0,
          evaluationTitle: createdOrUpdatedGrade.evaluationTitle ?? prev[existingIndex]?.evaluationTitle ?? "",
          subject: createdOrUpdatedGrade.subject ?? prev[existingIndex]?.subject ?? ""
        };
        if (existingIndex !== -1) {
          const next = [...prev];
          next[existingIndex] = gradeEntry;
          return next;
        }
        return [...prev, gradeEntry];
      });
    } catch (err) {
      setErrorMsg(err.message);
      throw err;
    }
  };
  const handleAddSubject = async (data) => {
    try {
      const createdSubject = await apiFetch("/api/subjects", {
        method: "POST",
        body: JSON.stringify(data)
      });
      setSubjectsList((prev) => [...prev, createdSubject]);
    } catch (err) {
      setErrorMsg(err.message);
      throw err;
    }
  };
  const handleUpdateSubject = async (id, data) => {
    try {
      const updatedSubject = await apiFetch(`/api/subjects/${id}`, {
        method: "PUT",
        body: JSON.stringify(data)
      });
      setSubjectsList(
        (prev) => prev.map((s) => s.id === id ? updatedSubject : s)
      );
      await refreshApprovedSubjects();
    } catch (err) {
      setErrorMsg(err.message);
      throw err;
    }
  };
  const handleDeleteSubject = async (id) => {
    try {
      await apiFetch(`/api/subjects/${id}`, {
        method: "DELETE"
      });
      setSubjectsList((prev) => prev.filter((s) => s.id !== id));
      await refreshApprovedSubjects();
    } catch (err) {
      setErrorMsg(err.message);
      throw err;
    }
  };
  const handleApproveSubject = async (id) => {
    try {
      const schoolId = currentSchoolId;
      if (!schoolId) throw new Error("Aucun établissement sélectionné");
      await apiFetch(`/api/schools/${schoolId}/subjects/${id}/approve`, { method: "POST" });
      setSubjectsList((prev) => prev.map((s) => s.id === id ? { ...s, status: "approved" } : s));
      await refreshApprovedSubjects();
    } catch (err) {
      setErrorMsg(err.message);
      throw err;
    }
  };
  const handleRejectSubject = async (id) => {
    try {
      const schoolId = currentSchoolId;
      if (!schoolId) throw new Error("Aucun établissement sélectionné");
      await apiFetch(`/api/schools/${schoolId}/subjects/${id}/reject`, { method: "POST" });
      setSubjectsList((prev) => prev.map((s) => s.id === id ? { ...s, status: "rejected" } : s));
      await refreshApprovedSubjects();
    } catch (err) {
      setErrorMsg(err.message);
      throw err;
    }
  };
  const handleSendNotification = async (data) => {
    try {
      await apiFetch("/api/notifications/send", {
        method: "POST",
        body: JSON.stringify(data)
      });
      fetchAllData();
    } catch (err) {
      setErrorMsg(err.message);
    }
  };
  const handleMarkAllAsRead = async () => {
    try {
      await apiFetch("/api/notifications/read-all", { method: "PUT" });
      fetchAllData();
    } catch (err) {
      setErrorMsg(err.message);
    }
  };
  const handleNotificationRead = async () => {
    try {
      await fetchAllData(false);
    } catch (e) {
      console.warn("Failed to refresh data after marking notification read", e);
    }
  };
  if (!authenticatedUser || !token && currentRole !== "super_admin" || currentRole !== "super_admin" && !activeSchoolId) {
    return /* @__PURE__ */ jsxDEV(LoginView, { onLogin: (role2) => {
      setSimulatedRole(role2);
    } }, void 0, false, {
      fileName: "D:/Projet AYISSOU/web ecoles/src/App.tsx",
      lineNumber: 809,
      columnNumber: 12
    }, this);
  }
  const activeEvaluations = evaluationsList.filter((ev) => {
    if (currentRole === "super_admin") return true;
    if (currentRole === "school_admin") {
      return !isEvaluationLockedBySchoolAdmin(ev, studentsList, gradesList) && !isEvaluationArchivedForSchoolAdminByAge(ev, studentsList, gradesList);
    }
    return !isEvaluationArchived(ev, studentsList, gradesList);
  });
  const archivedEvaluations = evaluationsList.filter((ev) => {
    if (currentRole === "super_admin") return false;
    if (currentRole === "school_admin") {
      return isEvaluationLockedBySchoolAdmin(ev, studentsList, gradesList) || isEvaluationArchivedForSchoolAdminByAge(ev, studentsList, gradesList);
    }
    return isEvaluationArchived(ev, studentsList, gradesList);
  });
  return /* @__PURE__ */ jsxDEV("div", { className: "min-h-screen bg-slate-50 flex flex-col font-sans text-slate-800", id: "main-application", children: [
    /* @__PURE__ */ jsxDEV(
      SimulatorHeader,
      {
        currentRole,
        schoolsList,
        parentsList,
        classesList,
        teachersList,
        studentsList,
        usersList,
        yearsList,
        approvedSubjectsList,
        onRoleChange: handleRoleChange,
        onLogout: handleLogout,
        onRefreshData: fetchAllData,
        isSyncing,
        onManageAccounts: () => setActiveTab("administration")
      },
      void 0,
      false,
      {
        fileName: "D:/Projet AYISSOU/web ecoles/src/App.tsx",
        lineNumber: 833,
        columnNumber: 7
      },
      this
    ),
    visibleErrorMsg && /* @__PURE__ */ jsxDEV(GlobalErrorToast, { message: visibleErrorMsg, onClose: () => setErrorMsg(null) }, void 0, false, {
      fileName: "D:/Projet AYISSOU/web ecoles/src/App.tsx",
      lineNumber: 851,
      columnNumber: 7
    }, this),
    /* @__PURE__ */ jsxDEV("div", { className: "flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 lg:p-8 flex flex-col lg:flex-row gap-6", children: [
      /* @__PURE__ */ jsxDEV("aside", { className: "w-full lg:w-64 shrink-0 bg-white border border-slate-100 rounded-2xl p-4 shadow-sm", id: "main-sidebar", children: [
        /* @__PURE__ */ jsxDEV("div", { className: "space-y-4", children: [
          /* @__PURE__ */ jsxDEV("div", { className: "px-3 py-2 border-b border-slate-100 pb-3", children: [
            /* @__PURE__ */ jsxDEV("span", { className: "text-[10px] font-bold text-slate-400 uppercase tracking-widest block", children: "Navigation" }, void 0, false, {
              fileName: "D:/Projet AYISSOU/web ecoles/src/App.tsx",
              lineNumber: 861,
              columnNumber: 15
            }, this),
            /* @__PURE__ */ jsxDEV("p", { className: "text-xs text-slate-400", children: "Cliquez pour basculer d'un module à l'autre" }, void 0, false, {
              fileName: "D:/Projet AYISSOU/web ecoles/src/App.tsx",
              lineNumber: 862,
              columnNumber: 15
            }, this)
          ] }, void 0, true, {
            fileName: "D:/Projet AYISSOU/web ecoles/src/App.tsx",
            lineNumber: 860,
            columnNumber: 13
          }, this),
          /* @__PURE__ */ jsxDEV("nav", { className: "space-y-1", children: [
            /* @__PURE__ */ jsxDEV(
              "button",
              {
                onClick: () => setActiveTab("tableau-de-bord"),
                className: `w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs sm:text-sm font-semibold transition-all cursor-pointer ${activeTab === "tableau-de-bord" ? "bg-indigo-600 text-white shadow-md shadow-indigo-600/10" : "text-slate-500 hover:text-slate-900 hover:bg-slate-50"}`,
                id: "sidebar-nav-dashboard",
                children: [
                  /* @__PURE__ */ jsxDEV(LayoutDashboard, { className: "h-4.5 w-4.5" }, void 0, false, {
                    fileName: "D:/Projet AYISSOU/web ecoles/src/App.tsx",
                    lineNumber: 876,
                    columnNumber: 17
                  }, this),
                  /* @__PURE__ */ jsxDEV("span", { children: "Tableau de Bord" }, void 0, false, {
                    fileName: "D:/Projet AYISSOU/web ecoles/src/App.tsx",
                    lineNumber: 877,
                    columnNumber: 17
                  }, this)
                ]
              },
              void 0,
              true,
              {
                fileName: "D:/Projet AYISSOU/web ecoles/src/App.tsx",
                lineNumber: 867,
                columnNumber: 15
              },
              this
            ),
            /* @__PURE__ */ jsxDEV(
              "button",
              {
                onClick: () => setActiveTab("administration"),
                className: `w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs sm:text-sm font-semibold transition-all cursor-pointer ${activeTab === "administration" ? "bg-indigo-600 text-white shadow-md shadow-indigo-600/10" : "text-slate-500 hover:text-slate-900 hover:bg-slate-50"}`,
                id: "sidebar-nav-admin",
                children: [
                  /* @__PURE__ */ jsxDEV(Building2, { className: "h-4.5 w-4.5" }, void 0, false, {
                    fileName: "D:/Projet AYISSOU/web ecoles/src/App.tsx",
                    lineNumber: 890,
                    columnNumber: 17
                  }, this),
                  /* @__PURE__ */ jsxDEV("span", { children: "Administration" }, void 0, false, {
                    fileName: "D:/Projet AYISSOU/web ecoles/src/App.tsx",
                    lineNumber: 891,
                    columnNumber: 17
                  }, this)
                ]
              },
              void 0,
              true,
              {
                fileName: "D:/Projet AYISSOU/web ecoles/src/App.tsx",
                lineNumber: 881,
                columnNumber: 15
              },
              this
            ),
            /* @__PURE__ */ jsxDEV(
              "button",
              {
                onClick: () => setActiveTab("absences"),
                className: `w-full flex items-center justify-between gap-3 px-3.5 py-2.5 rounded-xl text-xs sm:text-sm font-semibold transition-all cursor-pointer ${activeTab === "absences" ? "bg-indigo-600 text-white shadow-md shadow-indigo-600/10" : "text-slate-500 hover:text-slate-900 hover:bg-slate-50"}`,
                id: "sidebar-nav-absences",
                "data-testid": "sidebar-nav-absences",
                children: [
                  /* @__PURE__ */ jsxDEV("div", { className: "flex items-center gap-3", children: [
                    /* @__PURE__ */ jsxDEV(CalendarDays, { className: "h-4.5 w-4.5" }, void 0, false, {
                      fileName: "D:/Projet AYISSOU/web ecoles/src/App.tsx",
                      lineNumber: 906,
                      columnNumber: 19
                    }, this),
                    /* @__PURE__ */ jsxDEV("span", { children: "Absences" }, void 0, false, {
                      fileName: "D:/Projet AYISSOU/web ecoles/src/App.tsx",
                      lineNumber: 907,
                      columnNumber: 19
                    }, this)
                  ] }, void 0, true, {
                    fileName: "D:/Projet AYISSOU/web ecoles/src/App.tsx",
                    lineNumber: 905,
                    columnNumber: 17
                  }, this),
                  unjustifiedAbsencesCount > 0 && /* @__PURE__ */ jsxDEV("span", { className: `px-1.5 py-0.5 rounded-full text-[10px] font-bold ${activeTab === "absences" ? "bg-white text-indigo-700" : "bg-indigo-600 text-white"}`, children: unjustifiedAbsencesCount > 99 ? "99+" : unjustifiedAbsencesCount }, void 0, false, {
                    fileName: "D:/Projet AYISSOU/web ecoles/src/App.tsx",
                    lineNumber: 910,
                    columnNumber: 17
                  }, this)
                ]
              },
              void 0,
              true,
              {
                fileName: "D:/Projet AYISSOU/web ecoles/src/App.tsx",
                lineNumber: 895,
                columnNumber: 15
              },
              this
            ),
            currentRole === "parent" && /* @__PURE__ */ jsxDEV(
              "button",
              {
                onClick: () => setActiveTab("notes"),
                className: `w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs sm:text-sm font-semibold transition-all cursor-pointer ${activeTab === "notes" ? "bg-indigo-600 text-white shadow-md shadow-indigo-600/10" : "text-slate-500 hover:text-slate-900 hover:bg-slate-50"}`,
                id: "sidebar-nav-parent-grades",
                children: [
                  /* @__PURE__ */ jsxDEV(Award, { className: "h-4.5 w-4.5" }, void 0, false, {
                    fileName: "D:/Projet AYISSOU/web ecoles/src/App.tsx",
                    lineNumber: 928,
                    columnNumber: 19
                  }, this),
                  /* @__PURE__ */ jsxDEV("span", { children: "Notes" }, void 0, false, {
                    fileName: "D:/Projet AYISSOU/web ecoles/src/App.tsx",
                    lineNumber: 929,
                    columnNumber: 19
                  }, this)
                ]
              },
              void 0,
              true,
              {
                fileName: "D:/Projet AYISSOU/web ecoles/src/App.tsx",
                lineNumber: 919,
                columnNumber: 15
              },
              this
            ),
            currentRole !== "parent" && /* @__PURE__ */ jsxDEV(Fragment, { children: [
              /* @__PURE__ */ jsxDEV(
                "button",
                {
                  onClick: () => setActiveTab("notes"),
                  className: `w-full flex items-center justify-between gap-3 px-3.5 py-2.5 rounded-xl text-xs sm:text-sm font-semibold transition-all cursor-pointer ${activeTab === "notes" ? "bg-indigo-600 text-white shadow-md shadow-indigo-600/10" : "text-slate-500 hover:text-slate-900 hover:bg-slate-50"}`,
                  id: "sidebar-nav-grades",
                  children: [
                    /* @__PURE__ */ jsxDEV("div", { className: "flex items-center gap-3", children: [
                      /* @__PURE__ */ jsxDEV(Award, { className: "h-4.5 w-4.5" }, void 0, false, {
                        fileName: "D:/Projet AYISSOU/web ecoles/src/App.tsx",
                        lineNumber: 946,
                        columnNumber: 23
                      }, this),
                      /* @__PURE__ */ jsxDEV("span", { children: "Notes & Bulletins" }, void 0, false, {
                        fileName: "D:/Projet AYISSOU/web ecoles/src/App.tsx",
                        lineNumber: 947,
                        columnNumber: 23
                      }, this)
                    ] }, void 0, true, {
                      fileName: "D:/Projet AYISSOU/web ecoles/src/App.tsx",
                      lineNumber: 945,
                      columnNumber: 21
                    }, this),
                    noteOverdueCount > 0 && /* @__PURE__ */ jsxDEV("span", { className: `px-1.5 py-0.5 rounded-full text-[10px] font-bold ${activeTab === "notes" ? "bg-white text-indigo-700" : "bg-rose-500 text-white"}`, children: noteOverdueCount }, void 0, false, {
                      fileName: "D:/Projet AYISSOU/web ecoles/src/App.tsx",
                      lineNumber: 950,
                      columnNumber: 19
                    }, this)
                  ]
                },
                void 0,
                true,
                {
                  fileName: "D:/Projet AYISSOU/web ecoles/src/App.tsx",
                  lineNumber: 936,
                  columnNumber: 19
                },
                this
              ),
              /* @__PURE__ */ jsxDEV(
                "button",
                {
                  onClick: () => setActiveTab("archive"),
                  className: `w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs sm:text-sm font-semibold transition-all cursor-pointer ${activeTab === "archive" ? "bg-indigo-600 text-white shadow-md shadow-indigo-600/10" : "text-slate-500 hover:text-slate-900 hover:bg-slate-50"}`,
                  id: "sidebar-nav-archive",
                  children: [
                    /* @__PURE__ */ jsxDEV(BookOpen, { className: "h-4.5 w-4.5" }, void 0, false, {
                      fileName: "D:/Projet AYISSOU/web ecoles/src/App.tsx",
                      lineNumber: 967,
                      columnNumber: 21
                    }, this),
                    /* @__PURE__ */ jsxDEV("span", { children: "Archive" }, void 0, false, {
                      fileName: "D:/Projet AYISSOU/web ecoles/src/App.tsx",
                      lineNumber: 968,
                      columnNumber: 21
                    }, this)
                  ]
                },
                void 0,
                true,
                {
                  fileName: "D:/Projet AYISSOU/web ecoles/src/App.tsx",
                  lineNumber: 958,
                  columnNumber: 19
                },
                this
              )
            ] }, void 0, true, {
              fileName: "D:/Projet AYISSOU/web ecoles/src/App.tsx",
              lineNumber: 935,
              columnNumber: 15
            }, this),
            (currentRole === "school_admin" || currentRole === "super_admin" || currentRole === "teacher") && /* @__PURE__ */ jsxDEV(
              "button",
              {
                onClick: () => setActiveTab("bulletins"),
                className: `w-full flex items-center justify-between gap-3 px-3.5 py-2.5 rounded-xl text-xs sm:text-sm font-semibold transition-all cursor-pointer ${activeTab === "bulletins" ? "bg-indigo-600 text-white shadow-md shadow-indigo-600/10" : "text-slate-500 hover:text-slate-900 hover:bg-slate-50"}`,
                id: "sidebar-nav-bulletins",
                children: [
                  /* @__PURE__ */ jsxDEV("div", { className: "flex items-center gap-3", children: [
                    /* @__PURE__ */ jsxDEV(FileText, { className: "h-4.5 w-4.5" }, void 0, false, {
                      fileName: "D:/Projet AYISSOU/web ecoles/src/App.tsx",
                      lineNumber: 984,
                      columnNumber: 21
                    }, this),
                    /* @__PURE__ */ jsxDEV("span", { children: "Bulletins" }, void 0, false, {
                      fileName: "D:/Projet AYISSOU/web ecoles/src/App.tsx",
                      lineNumber: 985,
                      columnNumber: 21
                    }, this)
                  ] }, void 0, true, {
                    fileName: "D:/Projet AYISSOU/web ecoles/src/App.tsx",
                    lineNumber: 983,
                    columnNumber: 19
                  }, this),
                  noteOverdueCount > 0 && /* @__PURE__ */ jsxDEV("span", { className: `px-1.5 py-0.5 rounded-full text-[10px] font-bold ${activeTab === "bulletins" ? "bg-white text-indigo-700" : "bg-rose-500 text-white"}`, children: noteOverdueCount }, void 0, false, {
                    fileName: "D:/Projet AYISSOU/web ecoles/src/App.tsx",
                    lineNumber: 988,
                    columnNumber: 17
                  }, this)
                ]
              },
              void 0,
              true,
              {
                fileName: "D:/Projet AYISSOU/web ecoles/src/App.tsx",
                lineNumber: 974,
                columnNumber: 15
              },
              this
            ),
            currentRole === "super_admin" && /* @__PURE__ */ jsxDEV(
              "button",
              {
                onClick: () => setActiveTab("audit"),
                className: `w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs sm:text-sm font-semibold transition-all cursor-pointer ${activeTab === "audit" ? "bg-indigo-600 text-white shadow-md shadow-indigo-600/10" : "text-slate-500 hover:text-slate-900 hover:bg-slate-50"}`,
                id: "sidebar-nav-audit",
                children: [
                  /* @__PURE__ */ jsxDEV(Info, { className: "h-4.5 w-4.5" }, void 0, false, {
                    fileName: "D:/Projet AYISSOU/web ecoles/src/App.tsx",
                    lineNumber: 1007,
                    columnNumber: 19
                  }, this),
                  /* @__PURE__ */ jsxDEV("span", { children: "Journal des actions" }, void 0, false, {
                    fileName: "D:/Projet AYISSOU/web ecoles/src/App.tsx",
                    lineNumber: 1008,
                    columnNumber: 19
                  }, this)
                ]
              },
              void 0,
              true,
              {
                fileName: "D:/Projet AYISSOU/web ecoles/src/App.tsx",
                lineNumber: 998,
                columnNumber: 15
              },
              this
            ),
            /* @__PURE__ */ jsxDEV(
              "button",
              {
                onClick: () => setActiveTab("notifications"),
                className: `w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-xs sm:text-sm font-semibold transition-all cursor-pointer ${activeTab === "notifications" ? "bg-indigo-600 text-white shadow-md shadow-indigo-600/10" : "text-slate-500 hover:text-slate-900 hover:bg-slate-50"}`,
                id: "sidebar-nav-notifications",
                children: [
                  /* @__PURE__ */ jsxDEV("div", { className: "flex items-center gap-3", children: [
                    /* @__PURE__ */ jsxDEV(Bell, { className: "h-4.5 w-4.5" }, void 0, false, {
                      fileName: "D:/Projet AYISSOU/web ecoles/src/App.tsx",
                      lineNumber: 1023,
                      columnNumber: 19
                    }, this),
                    /* @__PURE__ */ jsxDEV("span", { children: "Messagerie & Push" }, void 0, false, {
                      fileName: "D:/Projet AYISSOU/web ecoles/src/App.tsx",
                      lineNumber: 1024,
                      columnNumber: 19
                    }, this)
                  ] }, void 0, true, {
                    fileName: "D:/Projet AYISSOU/web ecoles/src/App.tsx",
                    lineNumber: 1022,
                    columnNumber: 17
                  }, this),
                  notificationsList.filter((n) => !n.isRead).length > 0 && /* @__PURE__ */ jsxDEV("span", { className: `px-1.5 py-0.5 rounded-full text-[10px] font-bold ${activeTab === "notifications" ? "bg-white text-indigo-700" : "bg-indigo-600 text-white"}`, children: notificationsList.filter((n) => !n.isRead).length }, void 0, false, {
                    fileName: "D:/Projet AYISSOU/web ecoles/src/App.tsx",
                    lineNumber: 1027,
                    columnNumber: 17
                  }, this)
                ]
              },
              void 0,
              true,
              {
                fileName: "D:/Projet AYISSOU/web ecoles/src/App.tsx",
                lineNumber: 1013,
                columnNumber: 15
              },
              this
            ),
            /* @__PURE__ */ jsxDEV(
              "button",
              {
                onClick: () => setActiveTab("mobile-parent"),
                className: `w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs sm:text-sm font-semibold transition-all cursor-pointer ${activeTab === "mobile-parent" ? "bg-indigo-600 text-white shadow-md shadow-indigo-600/10" : "text-slate-500 hover:text-slate-900 hover:bg-slate-50"}`,
                id: "sidebar-nav-mobile",
                children: [
                  /* @__PURE__ */ jsxDEV(Smartphone, { className: "h-4.5 w-4.5" }, void 0, false, {
                    fileName: "D:/Projet AYISSOU/web ecoles/src/App.tsx",
                    lineNumber: 1045,
                    columnNumber: 17
                  }, this),
                  /* @__PURE__ */ jsxDEV("span", { children: "Application Mobile" }, void 0, false, {
                    fileName: "D:/Projet AYISSOU/web ecoles/src/App.tsx",
                    lineNumber: 1046,
                    columnNumber: 17
                  }, this)
                ]
              },
              void 0,
              true,
              {
                fileName: "D:/Projet AYISSOU/web ecoles/src/App.tsx",
                lineNumber: 1036,
                columnNumber: 15
              },
              this
            )
          ] }, void 0, true, {
            fileName: "D:/Projet AYISSOU/web ecoles/src/App.tsx",
            lineNumber: 865,
            columnNumber: 13
          }, this)
        ] }, void 0, true, {
          fileName: "D:/Projet AYISSOU/web ecoles/src/App.tsx",
          lineNumber: 859,
          columnNumber: 11
        }, this),
        currentRole === "super_admin" && /* @__PURE__ */ jsxDEV("div", { className: "mt-8 pt-4 border-t border-slate-100 flex flex-col gap-2 p-1", children: /* @__PURE__ */ jsxDEV("div", { className: "text-[10px] text-slate-400 space-y-1", children: [
          /* @__PURE__ */ jsxDEV("span", { className: "font-bold text-slate-500 block", children: "BASE DE DONNÉES :" }, void 0, false, {
            fileName: "D:/Projet AYISSOU/web ecoles/src/App.tsx",
            lineNumber: 1055,
            columnNumber: 17
          }, this),
          /* @__PURE__ */ jsxDEV("p", { className: "flex items-center gap-1.5", children: [
            /* @__PURE__ */ jsxDEV("span", { className: "h-1.5 w-1.5 bg-emerald-500 rounded-full inline-block" }, void 0, false, {
              fileName: "D:/Projet AYISSOU/web ecoles/src/App.tsx",
              lineNumber: 1057,
              columnNumber: 19
            }, this),
            "PostgreSQL Connecté (Cloud SQL)"
          ] }, void 0, true, {
            fileName: "D:/Projet AYISSOU/web ecoles/src/App.tsx",
            lineNumber: 1056,
            columnNumber: 17
          }, this)
        ] }, void 0, true, {
          fileName: "D:/Projet AYISSOU/web ecoles/src/App.tsx",
          lineNumber: 1054,
          columnNumber: 15
        }, this) }, void 0, false, {
          fileName: "D:/Projet AYISSOU/web ecoles/src/App.tsx",
          lineNumber: 1053,
          columnNumber: 11
        }, this)
      ] }, void 0, true, {
        fileName: "D:/Projet AYISSOU/web ecoles/src/App.tsx",
        lineNumber: 858,
        columnNumber: 9
      }, this),
      /* @__PURE__ */ jsxDEV("main", { className: "flex-1 min-w-0", id: "main-viewport", children: [
        visibleErrorMsg && /* @__PURE__ */ jsxDEV("div", { className: "bg-rose-50 border border-rose-100 p-4 rounded-2xl mb-6 flex items-start gap-3 animate-fade-in text-xs sm:text-sm", children: [
          /* @__PURE__ */ jsxDEV(AlertCircle, { className: "h-5 w-5 text-rose-500 shrink-0 mt-0.5" }, void 0, false, {
            fileName: "D:/Projet AYISSOU/web ecoles/src/App.tsx",
            lineNumber: 1071,
            columnNumber: 15
          }, this),
          /* @__PURE__ */ jsxDEV("div", { className: "space-y-1 leading-relaxed", children: [
            /* @__PURE__ */ jsxDEV("p", { className: "font-bold text-rose-800", children: "Alerte Système" }, void 0, false, {
              fileName: "D:/Projet AYISSOU/web ecoles/src/App.tsx",
              lineNumber: 1073,
              columnNumber: 17
            }, this),
            /* @__PURE__ */ jsxDEV("p", { className: "text-rose-700", children: visibleErrorMsg }, void 0, false, {
              fileName: "D:/Projet AYISSOU/web ecoles/src/App.tsx",
              lineNumber: 1074,
              columnNumber: 17
            }, this)
          ] }, void 0, true, {
            fileName: "D:/Projet AYISSOU/web ecoles/src/App.tsx",
            lineNumber: 1072,
            columnNumber: 15
          }, this),
          /* @__PURE__ */ jsxDEV("button", { onClick: () => setErrorMsg(null), className: "ml-auto text-rose-400 font-bold hover:text-rose-600 cursor-pointer", children: "✕" }, void 0, false, {
            fileName: "D:/Projet AYISSOU/web ecoles/src/App.tsx",
            lineNumber: 1076,
            columnNumber: 15
          }, this)
        ] }, void 0, true, {
          fileName: "D:/Projet AYISSOU/web ecoles/src/App.tsx",
          lineNumber: 1070,
          columnNumber: 11
        }, this),
        isSyncing && /* @__PURE__ */ jsxDEV("div", { className: "bg-white/60 p-12 text-center rounded-2xl border border-slate-50 shadow-sm flex flex-col justify-center items-center gap-3 my-12", children: [
          /* @__PURE__ */ jsxDEV(RefreshCw, { className: "h-10 w-10 text-indigo-600 animate-spin" }, void 0, false, {
            fileName: "D:/Projet AYISSOU/web ecoles/src/App.tsx",
            lineNumber: 1083,
            columnNumber: 15
          }, this),
          /* @__PURE__ */ jsxDEV("p", { className: "text-xs text-slate-500 font-medium", children: "Synchronisation des registres en temps réel..." }, void 0, false, {
            fileName: "D:/Projet AYISSOU/web ecoles/src/App.tsx",
            lineNumber: 1084,
            columnNumber: 15
          }, this)
        ] }, void 0, true, {
          fileName: "D:/Projet AYISSOU/web ecoles/src/App.tsx",
          lineNumber: 1082,
          columnNumber: 11
        }, this),
        !isSyncing && /* @__PURE__ */ jsxDEV("div", { className: "bg-white p-6 border border-slate-100 rounded-2xl shadow-sm transition-all animate-fade-in", id: "content-card", children: [
          activeTab === "tableau-de-bord" && /* @__PURE__ */ jsxDEV(
            DashboardView,
            {
              stats,
              recentAbsences: summaryRecentAbsences,
              recentGrades: summaryRecentGrades,
              userRole: currentRole,
              chartData
            },
            void 0,
            false,
            {
              fileName: "D:/Projet AYISSOU/web ecoles/src/App.tsx",
              lineNumber: 1092,
              columnNumber: 13
            },
            this
          ),
          activeTab === "administration" && /* @__PURE__ */ jsxDEV(ErrorBoundary, { children: /* @__PURE__ */ jsxDEV(
            AdminView,
            {
              userRole: currentRole,
              schoolsList,
              yearsList,
              classesList,
              teachersList,
              studentsList,
              parentsList,
              usersList,
              subjectsList,
              approvedSubjectsList,
              onAddSchool: handleAddSchool,
              onUpdateSchool: handleUpdateSchool,
              onUpdateStudent: handleUpdateStudent,
              onAddYear: handleAddYear,
              onSetActiveYear: handleSetActiveYear,
              onDeleteYear: handleDeleteYear,
              onAddClass: handleAddClass,
              onAddTeacher: handleAddTeacher,
              onAddParent: handleAddParent,
              onAddStudent: handleAddStudent,
              onBatchCreateStudents: handleBatchCreateStudents,
              onBatchCreateParents: handleBatchCreateParents,
              importResult,
              onCreateUser: handleCreateUser,
              onUpdateUser: handleUpdateUser,
              onSetPassword: handleSetPassword,
              onDeleteUser: handleDeleteUser,
              onDeleteClass: handleDeleteClass,
              onDeleteSchool: handleDeleteSchool,
              onAddSubject: handleAddSubject,
              onUpdateSubject: handleUpdateSubject,
              onDeleteSubject: handleDeleteSubject,
              onApproveSubject: handleApproveSubject,
              onRejectSubject: handleRejectSubject,
              onApproveClass: handleApproveClass,
              onRejectClass: handleRejectClass,
              currentSchoolId
            },
            void 0,
            false,
            {
              fileName: "D:/Projet AYISSOU/web ecoles/src/App.tsx",
              lineNumber: 1103,
              columnNumber: 27
            },
            this
          ) }, void 0, false, {
            fileName: "D:/Projet AYISSOU/web ecoles/src/App.tsx",
            lineNumber: 1102,
            columnNumber: 13
          }, this),
          activeTab === "absences" && /* @__PURE__ */ jsxDEV(
            AbsenceView,
            {
              userRole: currentRole,
              absencesList,
              studentsList,
              classesList,
              schoolsList,
              teachersList,
              approvedSubjectsList,
              teacherClassIds: currentRole === "teacher" ? currentTeacherClassIds : [],
              teacherSpecializations: currentRole === "teacher" ? currentTeacherSpecializations : [],
              onAddAbsence: handleAddAbsence,
              onJustifyAbsence: handleJustifyAbsence
            },
            void 0,
            false,
            {
              fileName: "D:/Projet AYISSOU/web ecoles/src/App.tsx",
              lineNumber: 1146,
              columnNumber: 13
            },
            this
          ),
          activeTab === "notes" && (currentRole === "parent" ? /* @__PURE__ */ jsxDEV(
            ParentNotesView,
            {
              currentRole,
              studentsList,
              parentsList,
              gradesList,
              evaluationsList: activeEvaluations
            },
            void 0,
            false,
            {
              fileName: "D:/Projet AYISSOU/web ecoles/src/App.tsx",
              lineNumber: 1163,
              columnNumber: 13
            },
            this
          ) : /* @__PURE__ */ jsxDEV(
            NotesView,
            {
              evaluationsList: activeEvaluations,
              gradesList,
              studentsList,
              classesList,
              schoolsList,
              schoolFilterId: superAdminSchoolFilterId,
              onSchoolFilterChange: setSuperAdminSchoolFilterId,
              teacherClassIds: currentRole === "teacher" ? currentTeacherClassIds : [],
              teacherSpecializations: currentRole === "teacher" ? currentTeacherSpecializations : [],
              approvedSubjectsList,
              teacherId: currentRole === "teacher" ? currentTeacherProfile?.id : void 0,
              onAddEvaluation: handleAddEvaluation,
              onAddGrade: handleAddGrade
            },
            void 0,
            false,
            {
              fileName: "D:/Projet AYISSOU/web ecoles/src/App.tsx",
              lineNumber: 1171,
              columnNumber: 13
            },
            this
          )),
          activeTab === "archive" && currentRole !== "parent" && /* @__PURE__ */ jsxDEV(
            ArchiveView,
            {
              userRole: currentRole,
              evaluationsList: archivedEvaluations,
              gradesList,
              studentsList,
              classesList,
              schoolsList,
              schoolFilterId: superAdminSchoolFilterId,
              onSchoolFilterChange: setSuperAdminSchoolFilterId,
              teacherClassIds: currentRole === "teacher" ? currentTeacherClassIds : [],
              teacherId: currentRole === "teacher" ? currentTeacherProfile?.id : void 0
            },
            void 0,
            false,
            {
              fileName: "D:/Projet AYISSOU/web ecoles/src/App.tsx",
              lineNumber: 1190,
              columnNumber: 13
            },
            this
          ),
          activeTab === "bulletins" && (currentRole === "school_admin" || currentRole === "super_admin" || currentRole === "teacher") && /* @__PURE__ */ jsxDEV(
            BulletinsView,
            {
              schoolsList,
              classesList,
              studentsList,
              evaluationsList: activeEvaluations,
              gradesList,
              teacherClassIds: currentRole === "teacher" ? currentTeacherClassIds : []
            },
            void 0,
            false,
            {
              fileName: "D:/Projet AYISSOU/web ecoles/src/App.tsx",
              lineNumber: 1205,
              columnNumber: 13
            },
            this
          ),
          activeTab === "audit" && currentRole === "super_admin" && /* @__PURE__ */ jsxDEV(
            AuditView,
            {
              auditEvents,
              isLoading: isAuditLoading,
              onReload: fetchAuditEvents
            },
            void 0,
            false,
            {
              fileName: "D:/Projet AYISSOU/web ecoles/src/App.tsx",
              lineNumber: 1216,
              columnNumber: 13
            },
            this
          ),
          activeTab === "notifications" && /* @__PURE__ */ jsxDEV(
            NotificationView,
            {
              userRole: currentRole,
              notificationsList,
              usersList,
              onSendNotification: handleSendNotification,
              onMarkAllAsRead: handleMarkAllAsRead,
              onNotificationRead: handleNotificationRead
            },
            void 0,
            false,
            {
              fileName: "D:/Projet AYISSOU/web ecoles/src/App.tsx",
              lineNumber: 1224,
              columnNumber: 13
            },
            this
          ),
          activeTab === "mobile-parent" && /* @__PURE__ */ jsxDEV(
            MobileParentView,
            {
              studentsList,
              parentsList,
              absencesList,
              gradesList,
              notificationsList,
              onJustifyAbsence: handleJustifyAbsence,
              onNotificationRead: handleNotificationRead
            },
            void 0,
            false,
            {
              fileName: "D:/Projet AYISSOU/web ecoles/src/App.tsx",
              lineNumber: 1235,
              columnNumber: 13
            },
            this
          )
        ] }, void 0, true, {
          fileName: "D:/Projet AYISSOU/web ecoles/src/App.tsx",
          lineNumber: 1090,
          columnNumber: 11
        }, this)
      ] }, void 0, true, {
        fileName: "D:/Projet AYISSOU/web ecoles/src/App.tsx",
        lineNumber: 1066,
        columnNumber: 9
      }, this)
    ] }, void 0, true, {
      fileName: "D:/Projet AYISSOU/web ecoles/src/App.tsx",
      lineNumber: 855,
      columnNumber: 7
    }, this)
  ] }, void 0, true, {
    fileName: "D:/Projet AYISSOU/web ecoles/src/App.tsx",
    lineNumber: 831,
    columnNumber: 5
  }, this);
}
_s(App, "3MiWEfTWwO43CqPME7DoC+qLH4I=", false, function() {
  return [useAuth];
});
_c = App;
var _c;
$RefreshReg$(_c, "App");
import * as RefreshRuntime from "/@react-refresh";
const inWebWorker = typeof WorkerGlobalScope !== "undefined" && self instanceof WorkerGlobalScope;
if (import.meta.hot && !inWebWorker) {
  if (!window.$RefreshReg$) {
    throw new Error(
      "@vitejs/plugin-react can't detect preamble. Something is wrong."
    );
  }
  RefreshRuntime.__hmr_import(import.meta.url).then((currentExports) => {
    RefreshRuntime.registerExportsForReactRefresh("D:/Projet AYISSOU/web ecoles/src/App.tsx", currentExports);
    import.meta.hot.accept((nextExports) => {
      if (!nextExports) return;
      const invalidateMessage = RefreshRuntime.validateRefreshBoundaryAndEnqueueUpdate("D:/Projet AYISSOU/web ecoles/src/App.tsx", currentExports, nextExports);
      if (invalidateMessage) import.meta.hot.invalidate(invalidateMessage);
    });
  });
}
function $RefreshReg$(type, id) {
  return RefreshRuntime.register(type, "D:/Projet AYISSOU/web ecoles/src/App.tsx " + id);
}
function $RefreshSig$() {
  return RefreshRuntime.createSignatureFunctionForTransform();
}

//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJtYXBwaW5ncyI6IkFBd3lCVyxTQThISyxVQTlITDs7QUF4eUJYLFNBQWdCQSxRQUFRQyxVQUFVQyxpQkFBaUI7QUFhbkQ7QUFBQSxFQUNFQztBQUFBQSxFQUNBQztBQUFBQSxFQUNBQztBQUFBQSxFQUNBQztBQUFBQSxFQUNBQztBQUFBQSxFQUNBQztBQUFBQSxFQUNBQztBQUFBQSxPQUNLO0FBQ1AsU0FBU0MsZUFBZTtBQUN4QixTQUFTQyx5QkFBeUJDLHNCQUFzQkMsaUNBQWlDQywrQ0FBK0M7QUFDeEksT0FBT0MscUJBQXFCO0FBQzVCLE9BQU9DLGVBQWU7QUFDdEIsT0FBT0MsbUJBQW1CO0FBQzFCLE9BQU9DLGVBQWU7QUFDdEIsT0FBT0MsbUJBQW1CO0FBQzFCLE9BQU9DLGlCQUFpQjtBQUN4QixPQUFPQyxlQUFlO0FBQ3RCLE9BQU9DLHNCQUFzQjtBQUM3QixPQUFPQyxlQUFlO0FBQ3RCLE9BQU9DLHNCQUFzQjtBQUM3QixPQUFPQyxxQkFBcUI7QUFDNUIsT0FBT0MsaUJBQWlCO0FBQ3hCLE9BQU9DLG1CQUFtQjtBQUMxQixPQUFPQyxzQkFBc0I7QUFFN0I7QUFBQSxFQUNFQztBQUFBQSxFQUNBQztBQUFBQSxFQUNBQztBQUFBQSxFQUNBQztBQUFBQSxFQUNBQztBQUFBQSxFQUNBQztBQUFBQSxFQUNBQztBQUFBQSxFQUNBQztBQUFBQSxFQUNBQztBQUFBQSxFQUVBQztBQUFBQSxFQUNBQztBQUFBQSxPQUNLO0FBRVAsd0JBQXdCQyxNQUFNO0FBQUFDLEtBQUE7QUFDNUIsUUFBTSxFQUFFQyxNQUFNQyxtQkFBbUJDLE9BQU9DLE1BQU1DLGVBQWUsSUFBSXBDLFFBQVE7QUFDekUsUUFBTXFDLGNBQWNGO0FBQ3BCLFFBQU1HLGtCQUFrQkY7QUFDeEIsUUFBTSxDQUFDRywwQkFBMEJDLDJCQUEyQixJQUFJakQsU0FBd0IsSUFBSTtBQUM1RixRQUFNLENBQUNrRCxXQUFXQyxZQUFZLElBQUluRCxTQUFTLGlCQUFpQjtBQUM1RCxRQUFNLENBQUNvRCxXQUFXQyxZQUFZLElBQUlyRCxTQUFTLEtBQUs7QUFDaEQsUUFBTSxDQUFDc0QsZ0JBQWdCQyxpQkFBaUIsSUFBSXZELFNBQVMsS0FBSztBQUMxRCxRQUFNLENBQUN3RCxjQUFjQyxlQUFlLElBQUl6RCxTQUFxQixJQUFJO0FBQ2pFLFFBQU0sQ0FBQzBELFVBQVVDLFdBQVcsSUFBSTNELFNBQXdCLElBQUk7QUFHNUQsUUFBTSxDQUFDNEQsT0FBT0MsUUFBUSxJQUFJN0QsU0FBUztBQUFBLElBQ2pDOEQsZUFBZTtBQUFBLElBQ2ZDLGVBQWU7QUFBQSxJQUNmQyxjQUFjO0FBQUEsSUFDZEMsZUFBZTtBQUFBLElBQ2ZDLGdCQUFnQjtBQUFBLEVBQ2xCLENBQUM7QUFDRCxRQUFNLENBQUNDLFdBQVdDLFlBQVksSUFBSXBFLFNBQWdELEVBQUU7QUFDcEYsUUFBTSxDQUFDcUUsYUFBYUMsY0FBYyxJQUFJdEUsU0FBbUIsRUFBRTtBQUMzRCxRQUFNLENBQUN1RSxXQUFXQyxZQUFZLElBQUl4RSxTQUF5QixFQUFFO0FBQzdELFFBQU0sQ0FBQ3lFLGFBQWFDLGNBQWMsSUFBSTFFLFNBQWtCLEVBQUU7QUFDMUQsUUFBTSxDQUFDMkUsY0FBY0MsZUFBZSxJQUFJNUUsU0FBb0IsRUFBRTtBQUM5RCxRQUFNLENBQUM2RSxjQUFjQyxlQUFlLElBQUk5RSxTQUFvQixFQUFFO0FBQzlELFFBQU0sQ0FBQytFLGFBQWFDLGNBQWMsSUFBSWhGLFNBQW1CLEVBQUU7QUFFM0QsUUFBTWlGLHFCQUFxQkEsQ0FBQ0MsUUFBZ0JDLFlBQXFCO0FBQy9ELFFBQUksQ0FBQ0MsTUFBTUMsUUFBUUYsT0FBTyxHQUFHO0FBQzNCRyxjQUFRQyxJQUFJLEdBQUdMLE1BQU0sNkJBQTZCQyxPQUFPO0FBQ3pEO0FBQUEsSUFDRjtBQUNBRyxZQUFRQyxJQUFJLEdBQUdMLE1BQU0sV0FBV0MsUUFBUUssTUFBTSxFQUFFO0FBQ2hETCxZQUFRTSxRQUFRLENBQUNDLFNBQWNDLFVBQWtCO0FBQy9DTCxjQUFRQyxJQUFJLEdBQUdMLE1BQU0sS0FBS1MsS0FBSyxLQUFLO0FBQUEsUUFDbENDLElBQUlGLFNBQVNFO0FBQUFBLFFBQ2JDLEtBQUtILFNBQVNHO0FBQUFBLFFBQ2RDLE9BQU9KLFNBQVNJO0FBQUFBLFFBQ2hCQyxVQUFVTCxTQUFTSztBQUFBQSxNQUNyQixDQUFDO0FBQUEsSUFDSCxDQUFDO0FBQUEsRUFDSDtBQUNBLFFBQU0sQ0FBQ0MsY0FBY0MsZUFBZSxJQUFJakcsU0FBZ0IsRUFBRTtBQUMxRCxRQUFNLENBQUNrRyx1QkFBdUJDLHdCQUF3QixJQUFJbkcsU0FBZ0IsRUFBRTtBQUM1RSxRQUFNb0csMkJBQTJCSixhQUFhSyxPQUFPLENBQUNDLFlBQWlCLENBQUNBLFFBQVFDLFdBQVcsRUFBRWY7QUFDN0YsUUFBTSxDQUFDZ0IsaUJBQWlCQyxrQkFBa0IsSUFBSXpHLFNBQWdCLEVBQUU7QUFDaEUsUUFBTSxDQUFDMEcsWUFBWUMsYUFBYSxJQUFJM0csU0FBZ0IsRUFBRTtBQUN0RCxRQUFNLENBQUM0RyxxQkFBcUJDLHNCQUFzQixJQUFJN0csU0FBZ0IsRUFBRTtBQUN4RSxRQUFNLENBQUM4RyxtQkFBbUJDLG9CQUFvQixJQUFJL0csU0FBK0IsRUFBRTtBQUNuRixRQUFNLENBQUNnSCxhQUFhQyxjQUFjLElBQUlqSCxTQUF1QixFQUFFO0FBQy9ELFFBQU0sQ0FBQ2tILFdBQVdDLFlBQVksSUFBSW5ILFNBQWlCLEVBQUU7QUFDckQsUUFBTSxDQUFDb0gsY0FBY0MsZUFBZSxJQUFJckgsU0FBZ0IsRUFBRTtBQUMxRCxRQUFNLENBQUNzSCxzQkFBc0JDLHVCQUF1QixJQUFJdkgsU0FBZ0IsRUFBRTtBQUMxRSxRQUFNd0gsOEJBQThCekgsT0FBb0Isb0JBQUkwSCxJQUFJLENBQUM7QUFFakUsUUFBTUMsd0JBQXdCbEgsb0NBQW9Dc0MsYUFBYUosbUJBQW1CaUMsY0FBY3VDLFNBQVM7QUFFekgsUUFBTVMseUJBQXlCRCx1QkFBdUIzQixZQUFZO0FBQ2xFLFFBQU02QixnQ0FBZ0NGLHVCQUF1QkcsaUJBQ3pEekMsTUFBTUMsUUFBUXFDLHNCQUFzQkcsY0FBYyxJQUNoREgsc0JBQXNCRyxpQkFDdEJDLE9BQU9KLHNCQUFzQkcsY0FBYyxFQUN4Q0UsTUFBTSxZQUFZLEVBQ2xCQyxJQUFJLENBQUNDLFNBQVNBLEtBQUtDLEtBQUssQ0FBQyxFQUN6QjdCLE9BQU84QixPQUFPLElBQ25CO0FBQ0osUUFBTUMsa0JBQWtCakksa0JBQWtCdUQsUUFBUTtBQUVsRCxRQUFNMkUsbUJBQW1CdkYsZ0JBQWdCLGFBQWFBLGdCQUFnQixrQkFBa0JBLGdCQUFnQixnQkFDcEdwQztBQUFBQSxJQUNBOEY7QUFBQUEsSUFDQTNCO0FBQUFBLElBQ0E2QjtBQUFBQSxJQUNBNUQ7QUFBQUEsSUFDQUEsZ0JBQWdCLFlBQVk0RSx1QkFBdUI5QixLQUFLMEM7QUFBQUEsRUFDMUQsSUFDRTtBQUVKLFFBQU1DLDJCQUEyQkEsQ0FBQ3BELFlBQWdDO0FBQ2hFLFFBQUlDLE1BQU1DLFFBQVFGLE9BQU8sRUFBRyxRQUFPQTtBQUVuQyxRQUFJQSxXQUFXLE9BQU9BLFlBQVksVUFBVTtBQUMxQyxZQUFNcUQsU0FBU3JEO0FBQ2YsWUFBTXNELGdCQUFnQkQsT0FBT0U7QUFDN0IsVUFBSXRELE1BQU1DLFFBQVFvRCxhQUFhLEVBQUcsUUFBT0E7QUFFekMsWUFBTUUsWUFBWUgsT0FBT0k7QUFDekIsVUFBSXhELE1BQU1DLFFBQVFzRCxTQUFTLEVBQUcsUUFBT0E7QUFDckMsVUFBSUEsYUFBYSxPQUFPQSxjQUFjLFVBQVU7QUFDOUMsY0FBTUUsaUJBQWtCRixVQUFzQ0Q7QUFDOUQsWUFBSXRELE1BQU1DLFFBQVF3RCxjQUFjLEVBQUcsUUFBT0E7QUFBQUEsTUFDNUM7QUFBQSxJQUNGO0FBRUEsV0FBTztBQUFBLEVBQ1Q7QUFFQSxRQUFNQyxtQkFBbUIsWUFBWTtBQUNuQyxRQUFJaEcsZ0JBQWdCLGVBQWU7QUFDakNtRSxxQkFBZSxFQUFFO0FBQ2pCO0FBQUEsSUFDRjtBQUVBMUQsc0JBQWtCLElBQUk7QUFDdEIsUUFBSTtBQUNGLFlBQU13RixTQUFTLE1BQU03SSxTQUFTLG1CQUFtQjtBQUNqRCtHLHFCQUFlOEIsTUFBTTtBQUFBLElBQ3ZCLFNBQVNDLFVBQWU7QUFDdEIxRCxjQUFRMkQsS0FBSyxtREFBb0RELFFBQVE7QUFDekUvQixxQkFBZSxFQUFFO0FBQ2pCdEQsa0JBQVksK0NBQStDO0FBQUEsSUFDN0QsVUFBQztBQUNDSix3QkFBa0IsS0FBSztBQUFBLElBQ3pCO0FBQUEsRUFDRjtBQUdBLFFBQU0yRixlQUFlLE9BQU9DLGNBQWMsU0FBUztBQUNqRCxRQUFJQSxZQUFhOUYsY0FBYSxJQUFJO0FBQ2xDTSxnQkFBWSxJQUFJO0FBQ2hCLFFBQUk7QUFFRixZQUFNekQsU0FBUywrQkFBK0IsRUFBRWtKLFFBQVEsT0FBTyxDQUFDLEVBQUVDLE1BQU0sQ0FBQ0MsUUFBUTtBQUMvRSxjQUFNQyxZQUFZcEosa0JBQWtCbUosR0FBRztBQUN2QyxZQUFJQyxXQUFXO0FBQ2JqRSxrQkFBUTJELEtBQUssb0NBQW9DSyxHQUFHO0FBQUEsUUFDdEQ7QUFBQSxNQUNGLENBQUM7QUFHRCxZQUFNRSxVQUFVLE1BQU10SixTQUFTLHdCQUF3QjtBQUN2RG9GLGNBQVFDLElBQUksK0JBQStCaUUsT0FBTztBQUNsRGxFLGNBQVFDLElBQUksbUJBQW9CaUUsU0FBaUJyRixTQUFTO0FBQzFELFVBQUlxRixXQUFXLE9BQU9BLFlBQVksVUFBVTtBQUMxQyxZQUFJLFdBQVdBLFFBQVMzRixVQUFTMkYsUUFBUTVGLEtBQUs7QUFDOUMsWUFBSSxrQkFBa0I0RixRQUFTM0Msd0JBQXVCMkMsUUFBUUMsWUFBWTtBQUMxRSxZQUFJLG9CQUFvQkQsU0FBUztBQUMvQnJELG1DQUF5QnFELFFBQVFFLGNBQWM7QUFDL0N6RCwwQkFBZ0J1RCxRQUFRRSxjQUFjO0FBQUEsUUFDeEM7QUFDQSxZQUFJdEUsTUFBTUMsUUFBU21FLFFBQWdCckYsU0FBUyxHQUFHO0FBQzdDQyx1QkFBY29GLFFBQWdCckYsU0FBUztBQUFBLFFBQ3pDLE9BQU87QUFDTEMsdUJBQWEsRUFBRTtBQUFBLFFBQ2pCO0FBQUEsTUFDRjtBQUdBLFlBQU11RixZQUFZO0FBQUEsUUFDaEI7QUFBQSxRQUNBO0FBQUEsUUFDQTtBQUFBLFFBQ0E7QUFBQSxRQUNBO0FBQUEsUUFDQTtBQUFBLFFBQ0E7QUFBQSxRQUNBO0FBQUEsUUFDQTtBQUFBLFFBQ0E7QUFBQSxRQUNBO0FBQUEsUUFDQTtBQUFBLFFBQ0E7QUFBQSxNQUF1QjtBQUd6QixZQUFNQyxXQUFXRCxVQUFVM0IsSUFBSSxDQUFBNkIsTUFBSzNKLFNBQVMySixDQUFDLEVBQUVSLE1BQU0sQ0FBQ0MsU0FBUyxFQUFFUSxTQUFTLE1BQU1DLE9BQU9ULElBQUksRUFBRSxDQUFDO0FBQy9GLFlBQU1VLFVBQVUsTUFBTUMsUUFBUUMsSUFBSU4sUUFBUTtBQUUxQyxZQUFNNUIsTUFBTW1DLE9BQU9DLFlBQVlULFVBQVUzQixJQUFJLENBQUM2QixHQUFHUSxNQUFNLENBQUNSLEdBQUdHLFFBQVFLLENBQUMsQ0FBQyxDQUFDLENBQUM7QUFDdkVwRix5QkFBbUIsa0NBQWtDK0UsUUFBUUwsVUFBVVcsUUFBUSxlQUFlLENBQUMsQ0FBQztBQUNoR3JGLHlCQUFtQixxQkFBcUIrQyxJQUFJLGVBQWUsQ0FBQztBQUM1RCxVQUFJNUMsTUFBTUMsUUFBUTJDLElBQUksZUFBZSxDQUFDLEdBQUc7QUFDdkMvQywyQkFBbUIsMkJBQTJCK0MsSUFBSSxlQUFlLENBQUM7QUFDbEVwRCx3QkFBZ0JvRCxJQUFJLGVBQWUsQ0FBQztBQUFBLE1BQ3RDO0FBQ0EsVUFBSTVDLE1BQU1DLFFBQVEyQyxJQUFJLGNBQWMsQ0FBQyxFQUFHMUQsZ0JBQWUwRCxJQUFJLGNBQWMsQ0FBQztBQUMxRSxVQUFJNUMsTUFBTUMsUUFBUTJDLElBQUkscUJBQXFCLENBQUMsRUFBR3hELGNBQWF3RCxJQUFJLHFCQUFxQixDQUFDO0FBQ3RGLFVBQUk1QyxNQUFNQyxRQUFRMkMsSUFBSSxjQUFjLENBQUMsRUFBR3RELGdCQUFlc0QsSUFBSSxjQUFjLENBQUM7QUFFMUUsWUFBTXVDLHFCQUFxQnZDLElBQUksZUFBZTtBQUM5QyxZQUFNd0MscUJBQXFCakMseUJBQXlCZ0Msa0JBQWtCO0FBQ3RFekYsc0JBQWdCMEYsa0JBQWtCO0FBRWxDLFVBQUlwRixNQUFNQyxRQUFRMkMsSUFBSSxjQUFjLENBQUMsRUFBR2hELGdCQUFlZ0QsSUFBSSxjQUFjLENBQUM7QUFDMUUsVUFBSTVDLE1BQU1DLFFBQVEyQyxJQUFJLGVBQWUsQ0FBQyxFQUFHL0IsaUJBQWdCK0IsSUFBSSxlQUFlLENBQUM7QUFDN0UsVUFBSTVDLE1BQU1DLFFBQVEyQyxJQUFJLGtCQUFrQixDQUFDLEVBQUd2QixvQkFBbUJ1QixJQUFJLGtCQUFrQixDQUFDO0FBQ3RGLFVBQUk1QyxNQUFNQyxRQUFRMkMsSUFBSSxhQUFhLENBQUMsRUFBR3JCLGVBQWNxQixJQUFJLGFBQWEsQ0FBQztBQUN2RSxVQUFJNUMsTUFBTUMsUUFBUTJDLElBQUksb0JBQW9CLENBQUMsRUFBR2pCLHNCQUFxQmlCLElBQUksb0JBQW9CLENBQUM7QUFDNUYsVUFBSTVDLE1BQU1DLFFBQVEyQyxJQUFJLGVBQWUsQ0FBQyxFQUFHWCxpQkFBZ0JXLElBQUksZUFBZSxDQUFDO0FBQzdFLFVBQUk1QyxNQUFNQyxRQUFRMkMsSUFBSSxpQ0FBaUMsQ0FBQyxFQUFHVCx5QkFBd0JTLElBQUksaUNBQWlDLENBQUM7QUFDekgsVUFBSTVDLE1BQU1DLFFBQVEyQyxJQUFJLHVCQUF1QixDQUFDLEVBQUdiLGNBQWFhLElBQUksdUJBQXVCLENBQUM7QUFFMUYsVUFBSWxGLGdCQUFnQixlQUFlO0FBQ2pDLGNBQU1nRyxpQkFBaUI7QUFBQSxNQUN6QixPQUFPO0FBQ0w3Qix1QkFBZSxFQUFFO0FBQUEsTUFDbkI7QUFBQSxJQUNGLFNBQVNxQyxLQUFVO0FBQ2pCLFlBQU1DLFlBQVlwSixrQkFBa0JtSixLQUFLLCtDQUErQztBQUN4RixVQUFJQyxXQUFXO0FBQ2I1RixvQkFBWTRGLFNBQVM7QUFBQSxNQUN2QjtBQUNBakUsY0FBUXlFLE1BQU0sd0NBQXdDVCxHQUFHO0FBQ3pEaEUsY0FBUTJELEtBQUssNkVBQTZFSyxHQUFHO0FBQUEsSUFDL0YsVUFBQztBQUNDakcsbUJBQWEsS0FBSztBQUFBLElBQ3BCO0FBQUEsRUFDRjtBQUlBcEQsWUFBVSxNQUFNO0FBQ2QsUUFBSTZDLGdCQUFnQixjQUFlO0FBQ25DLFVBQU0ySCxXQUFXekg7QUFDakIsVUFBTTBILFdBQVdELFdBQVcseUJBQXlCQSxRQUFRLEtBQUs7QUFDbEUsS0FBQyxZQUFZO0FBQ1gsVUFBSTtBQUNGLGNBQU10RixVQUFVLE1BQU1qRixTQUFTd0ssUUFBUTtBQUN2Q2hHLHVCQUFlVSxNQUFNQyxRQUFRRixPQUFPLElBQUlBLFVBQVUsRUFBRTtBQUFBLE1BQ3RELFNBQVNtRSxLQUFVO0FBQ2pCaEUsZ0JBQVEyRCxLQUFLLHdEQUF3REssR0FBRztBQUFBLE1BQzFFO0FBQUEsSUFDRixHQUFHO0FBQUEsRUFDTCxHQUFHLENBQUN0RywwQkFBMEJGLFdBQVcsQ0FBQztBQUUxQzdDLFlBQVUsTUFBTTtBQUNkZ0YsdUJBQW1CLDBCQUEwQk4sWUFBWTtBQUFBLEVBQzNELEdBQUcsQ0FBQ0EsWUFBWSxDQUFDO0FBRWpCMUUsWUFBVSxNQUFNO0FBQ2QsUUFBSTJDLFNBQVMsZUFBZTtBQUMxQkssa0NBQTRCLElBQUk7QUFBQSxJQUNsQztBQUNBLFFBQUlMLEtBQU1zRyxjQUFhO0FBQUEsRUFDekIsR0FBRyxDQUFDdEcsSUFBSSxDQUFDO0FBRVQzQyxZQUFVLE1BQU07QUFDZCxRQUFJLENBQUMyQyxLQUFNO0FBQ1gsUUFBSUUsZ0JBQWdCLGlCQUFpQkQsa0JBQWtCLE1BQU07QUFDM0RxRyxtQkFBYTtBQUFBLElBQ2Y7QUFBQSxFQUNGLEdBQUcsQ0FBQ3JHLGdCQUFnQkMsYUFBYUYsSUFBSSxDQUFDO0FBRXRDM0MsWUFBVSxNQUFNO0FBQ2QsUUFBSSxDQUFDNkcscUJBQXFCQSxrQkFBa0J0QixXQUFXLEVBQUc7QUFFMUQsVUFBTW1GLFlBQVk3RCxrQkFBa0JULE9BQU8sQ0FBQ3VFLFVBQVUsQ0FBQ3BELDRCQUE0QnFELFFBQVFDLElBQUlGLE1BQU1oRixFQUFFLENBQUM7QUFDeEcsUUFBSStFLFVBQVVuRixXQUFXLEVBQUc7QUFFNUIsVUFBTXVGLGFBQWFKLFVBQVVLLEtBQUssQ0FBQ0osVUFBVUEsTUFBTUssU0FBUyxTQUFTO0FBQ3JFLFVBQU1DLFdBQVdQLFVBQVVLLEtBQUssQ0FBQ0osVUFBVUEsTUFBTUssU0FBUyxPQUFPO0FBQ2pFLFFBQUksQ0FBQ0YsY0FBYyxDQUFDRyxTQUFVO0FBRTlCUCxjQUFVbEYsUUFBUSxDQUFDbUYsVUFBVXBELDRCQUE0QnFELFFBQVFNLElBQUlQLE1BQU1oRixFQUFFLENBQUM7QUFDOUUsUUFBSW1GLGNBQWNHLFVBQVU7QUFDMUJoQyxtQkFBYSxLQUFLO0FBQUEsSUFDcEI7QUFBQSxFQUNGLEdBQUcsQ0FBQ3BDLGlCQUFpQixDQUFDO0FBRXRCN0csWUFBVSxNQUFNO0FBQ2QsUUFBSWlELGNBQWMsV0FBV0osZ0JBQWdCLGVBQWU7QUFDMURnRyx1QkFBaUI7QUFBQSxJQUNuQjtBQUFBLEVBQ0YsR0FBRyxDQUFDNUYsV0FBV0osV0FBVyxDQUFDO0FBRTNCLFFBQU1zSSxtQkFBbUJBLENBQUNDLFlBQW9CO0FBQzVDLFFBQUksQ0FBQ0EsU0FBUztBQUNaaEwseUJBQW1CO0FBQ25CQyx5QkFBbUI7QUFDbkJnTCxhQUFPQyxRQUFRQyxhQUFhLE1BQU0sSUFBSSxRQUFRO0FBQzlDO0FBQUEsSUFDRjtBQUVBLFVBQU1DLGtCQUFrQi9JO0FBQ3hCLFFBQUksQ0FBQytJLGlCQUFpQjtBQUNwQixVQUFJSixZQUFZLFdBQVc7QUFFekIsY0FBTUssWUFBWS9HLGFBQWFnSCxLQUFLLENBQUNDLE1BQU1BLEVBQUVuQixhQUFhMUgsZUFBZSxLQUFLNEIsYUFBYSxDQUFDO0FBQzVGLFlBQUkrRyxXQUFXO0FBQ2JuTCwyQkFBaUIsRUFBRXNGLEtBQUssV0FBVzZGLFVBQVVHLFVBQVVILFVBQVU5RixFQUFFLElBQUlFLE9BQU80RixVQUFVNUYsU0FBUyxJQUFJZ0csTUFBTUosVUFBVUksUUFBUSxjQUFjckIsVUFBVWlCLFVBQVVqQixTQUFTLENBQUM7QUFBQSxRQUMzSyxPQUFPO0FBQ0xsSywyQkFBaUIsRUFBRXNGLEtBQUssZUFBZWtHLEtBQUtDLElBQUksQ0FBQyxJQUFJbEcsT0FBTyw0QkFBNEJnRyxNQUFNLHFCQUFxQnJCLFVBQVUxSCxnQkFBZ0IsQ0FBQztBQUFBLFFBQ2hKO0FBQUEsTUFDRixXQUFXc0ksWUFBWSxnQkFBZ0I7QUFDckM5Syx5QkFBaUIsRUFBRXNGLEtBQUssbUJBQW1Ca0csS0FBS0MsSUFBSSxDQUFDLElBQUlsRyxPQUFPLGdDQUFnQ2dHLE1BQU0sZUFBZXJCLFVBQVUxSCxnQkFBZ0IsQ0FBQztBQUFBLE1BQ2xKLFdBQVdzSSxZQUFZLFVBQVU7QUFDL0I5Syx5QkFBaUIsRUFBRXNGLEtBQUssY0FBY2tHLEtBQUtDLElBQUksQ0FBQyxJQUFJbEcsT0FBTywyQkFBMkJnRyxNQUFNLGlCQUFpQnJCLFVBQVUxSCxnQkFBZ0IsQ0FBQztBQUFBLE1BQzFJO0FBQUEsSUFDRjtBQUVBM0MscUJBQWlCaUwsT0FBTztBQUN4QkMsV0FBT0MsUUFBUUMsYUFBYSxNQUFNLElBQUksR0FBRztBQUFBLEVBQzNDO0FBRUEsUUFBTVMsZUFBZSxZQUFZO0FBQy9CNUwsdUJBQW1CO0FBQ25CQyx1QkFBbUI7QUFDbkIsUUFBSTtBQUNGLFlBQU1KLFNBQVMsb0JBQW9CLEVBQUVrSixRQUFRLE9BQU8sQ0FBQztBQUFBLElBQ3ZELFNBQVNTLEdBQUc7QUFDVnZFLGNBQVEyRCxLQUFLLHlCQUF5QlksQ0FBQztBQUFBLElBQ3pDO0FBQ0F5QixXQUFPWSxTQUFTQyxRQUFRLFFBQVE7QUFBQSxFQUNsQztBQU1BLFFBQU1DLGtCQUFrQixPQUFPeEQsU0FBMkc7QUFDeEksUUFBSTtBQUNGLFlBQU15RCxnQkFBZ0IsTUFBTW5NLFNBQVMsZ0JBQWdCO0FBQUEsUUFDbkRrSixRQUFRO0FBQUEsUUFDUmtELE1BQU1DLEtBQUtDLFVBQVU1RCxJQUFJO0FBQUEsTUFDM0IsQ0FBQztBQUNELFlBQU1NLGFBQWEsS0FBSztBQUN4QixhQUFPbUQ7QUFBQUEsSUFDVCxTQUFTL0MsS0FBVTtBQUNqQjNGLGtCQUFZMkYsSUFBSW1ELFdBQVcsOEJBQWdDO0FBQzNELFlBQU1uRDtBQUFBQSxJQUNSO0FBQUEsRUFDRjtBQUVBLFFBQU1vRCxnQkFBZ0IsT0FBTzlELFNBQWlFO0FBQzVGLFFBQUk7QUFDRixZQUFNMUksU0FBUyx1QkFBdUI7QUFBQSxRQUNwQ2tKLFFBQVE7QUFBQSxRQUNSa0QsTUFBTUMsS0FBS0MsVUFBVTVELElBQUk7QUFBQSxNQUMzQixDQUFDO0FBQ0QsWUFBTU0sYUFBYSxLQUFLO0FBQUEsSUFDMUIsU0FBU0ksS0FBVTtBQUNqQjNGLGtCQUFZMkYsSUFBSW1ELFdBQVcsOEJBQWdDO0FBQzNELFlBQU1uRDtBQUFBQSxJQUNSO0FBQUEsRUFDRjtBQUVBLFFBQU1xRCxzQkFBc0IsT0FBT0MsV0FBbUI7QUFDcEQsUUFBSTtBQUNGLFlBQU0xTSxTQUFTLHVCQUF1QjBNLE1BQU0sYUFBYTtBQUFBLFFBQ3ZEeEQsUUFBUTtBQUFBLE1BQ1YsQ0FBQztBQUNELFlBQU1GLGFBQWEsS0FBSztBQUFBLElBQzFCLFNBQVNJLEtBQVU7QUFDakIzRixrQkFBWTJGLElBQUltRCxXQUFXLGdEQUFnRDtBQUMzRSxZQUFNbkQ7QUFBQUEsSUFDUjtBQUFBLEVBQ0Y7QUFFQSxRQUFNdUQsbUJBQW1CLE9BQU9ELFdBQW1CO0FBQ2pELFFBQUk7QUFDRixZQUFNMU0sU0FBUyx1QkFBdUIwTSxNQUFNLElBQUk7QUFBQSxRQUM5Q3hELFFBQVE7QUFBQSxNQUNWLENBQUM7QUFDRCxZQUFNRixhQUFhLEtBQUs7QUFBQSxJQUMxQixTQUFTSSxLQUFVO0FBQ2pCM0Ysa0JBQVkyRixJQUFJbUQsV0FBVyw4Q0FBOEM7QUFDekUsWUFBTW5EO0FBQUFBLElBQ1I7QUFBQSxFQUNGO0FBRUEsUUFBTXdELGlCQUFpQixPQUFPbEUsU0FBaUc7QUFDN0gsUUFBSTtBQUNGLFlBQU16RCxVQUFVO0FBQUEsUUFDZCxHQUFHeUQ7QUFBQUEsUUFDSDZCLFVBQVU3QixLQUFLNkIsWUFBWTtBQUFBLE1BQzdCO0FBQ0EsWUFBTXZLLFNBQVMsZ0JBQWdCO0FBQUEsUUFDN0JrSixRQUFRO0FBQUEsUUFDUmtELE1BQU1DLEtBQUtDLFVBQVVySCxPQUFPO0FBQUEsTUFDOUIsQ0FBQztBQUNELFlBQU0rRCxhQUFhLEtBQUs7QUFBQSxJQUMxQixTQUFTSSxLQUFVO0FBQ2pCM0Ysa0JBQVkyRixJQUFJbUQsV0FBVywrQkFBK0I7QUFDMUQsWUFBTW5EO0FBQUFBLElBQ1I7QUFBQSxFQUNGO0FBRUEsUUFBTXlELG9CQUFvQixPQUFPbkgsT0FBZTtBQUM5QyxRQUFJO0FBQ0YsWUFBTTFGLFNBQVMsZ0JBQWdCMEYsRUFBRSxJQUFJLEVBQUV3RCxRQUFRLFNBQVMsQ0FBQztBQUN6REYsbUJBQWE7QUFBQSxJQUNmLFNBQVNJLEtBQVU7QUFDakIzRixrQkFBWTJGLElBQUltRCxXQUFXLHdCQUF3QjtBQUFBLElBQ3JEO0FBQUEsRUFDRjtBQUVBLFFBQU1PLHFCQUFxQixPQUFPcEgsT0FBZTtBQUMvQyxRQUFJO0FBQ0YsWUFBTTZFLFdBQVcxSDtBQUNqQixVQUFJLENBQUMwSCxTQUFVLE9BQU0sSUFBSXdDLE1BQU0sMERBQTBEO0FBQ3pGLFlBQU0vTSxTQUFTLGdCQUFnQnVLLFFBQVEsWUFBWTdFLEVBQUUsWUFBWSxFQUFFd0QsUUFBUSxPQUFPLENBQUM7QUFDbkYxRSxxQkFBZSxDQUFDd0ksU0FBU0EsS0FBS2xGLElBQUksQ0FBQ21GLE1BQU9BLEVBQUV2SCxPQUFPQSxLQUFLLEVBQUUsR0FBR3VILEdBQUdDLFFBQVEsV0FBVyxJQUFJRCxDQUFFLENBQUM7QUFDMUYsWUFBTWpFLGFBQWEsS0FBSztBQUFBLElBQzFCLFNBQVNJLEtBQVU7QUFDakIzRixrQkFBWTJGLElBQUltRCxXQUFXLG1DQUFvQztBQUMvRCxZQUFNbkQ7QUFBQUEsSUFDUjtBQUFBLEVBQ0Y7QUFFQSxRQUFNK0Qsb0JBQW9CLE9BQU96SCxPQUFlO0FBQzlDLFFBQUk7QUFDRixZQUFNNkUsV0FBVzFIO0FBQ2pCLFVBQUksQ0FBQzBILFNBQVUsT0FBTSxJQUFJd0MsTUFBTSx3REFBd0Q7QUFDdkYsWUFBTS9NLFNBQVMsZ0JBQWdCdUssUUFBUSxZQUFZN0UsRUFBRSxXQUFXLEVBQUV3RCxRQUFRLE9BQU8sQ0FBQztBQUNsRjFFLHFCQUFlLENBQUN3SSxTQUFTQSxLQUFLbEYsSUFBSSxDQUFDbUYsTUFBT0EsRUFBRXZILE9BQU9BLEtBQUssRUFBRSxHQUFHdUgsR0FBR0MsUUFBUSxXQUFXLElBQUlELENBQUUsQ0FBQztBQUMxRixZQUFNakUsYUFBYSxLQUFLO0FBQUEsSUFDMUIsU0FBU0ksS0FBVTtBQUNqQjNGLGtCQUFZMkYsSUFBSW1ELFdBQVcsa0NBQWtDO0FBQzdELFlBQU1uRDtBQUFBQSxJQUNSO0FBQUEsRUFDRjtBQUVBLFFBQU1nRSxxQkFBcUIsT0FBTzFILE9BQWU7QUFDL0MsUUFBSTtBQUNGLFlBQU0xRixTQUFTLGdCQUFnQjBGLEVBQUUsSUFBSSxFQUFFd0QsUUFBUSxTQUFTLENBQUM7QUFDekRGLG1CQUFhO0FBQUEsSUFDZixTQUFTSSxLQUFVO0FBQ2pCLFVBQUlBLElBQUltRCxXQUFXbkQsSUFBSW1ELFFBQVFjLFNBQVMsbUJBQW1CLEdBQUc7QUFDNUQ1SixvQkFBWSx1RUFBdUU7QUFDbkYsY0FBTXVGLGFBQWE7QUFBQSxNQUNyQixPQUFPO0FBQ0x2RixvQkFBWTJGLElBQUltRCxXQUFXLGtDQUFrQztBQUFBLE1BQy9EO0FBQUEsSUFDRjtBQUFBLEVBQ0Y7QUFDQSxRQUFNZSxxQkFBcUIsT0FBTzVILElBQVlnRCxTQUEyRztBQUN2SixRQUFJO0FBQ0YsWUFBTTFJLFNBQVMsZ0JBQWdCMEYsRUFBRSxJQUFJO0FBQUEsUUFDbkN3RCxRQUFRO0FBQUEsUUFDUmtELE1BQU1DLEtBQUtDLFVBQVU1RCxJQUFJO0FBQUEsTUFDM0IsQ0FBQztBQUNETSxtQkFBYTtBQUFBLElBQ2YsU0FBU0ksS0FBVTtBQUNqQjNGLGtCQUFZMkYsSUFBSW1ELFdBQVcscUNBQXNDO0FBQ2pFLFlBQU1uRDtBQUFBQSxJQUNSO0FBQUEsRUFDRjtBQUVBLFFBQU1tRSxzQkFBc0IsT0FBTzdILElBQVlnRCxTQUEyTjtBQUN4USxRQUFJO0FBQ0YsWUFBTTFJLFNBQVMsaUJBQWlCMEYsRUFBRSxJQUFJO0FBQUEsUUFDcEN3RCxRQUFRO0FBQUEsUUFDUmtELE1BQU1DLEtBQUtDLFVBQVU1RCxJQUFJO0FBQUEsTUFDM0IsQ0FBQztBQUNETSxtQkFBYTtBQUFBLElBQ2YsU0FBU0ksS0FBVTtBQUNqQjNGLGtCQUFZMkYsSUFBSW1ELFdBQVcscUNBQXNDO0FBQ2pFLFlBQU1uRDtBQUFBQSxJQUNSO0FBQUEsRUFDRjtBQUVBLFFBQU1vRSxtQkFBbUIsT0FBTzlFLFNBQW9KO0FBQ2xMLFFBQUk7QUFDRixZQUFNK0UsVUFBVSxNQUFNek4sU0FBUyxpQkFBaUI7QUFBQSxRQUM5Q2tKLFFBQVE7QUFBQSxRQUNSa0QsTUFBTUMsS0FBS0MsVUFBVTVELElBQUk7QUFBQSxNQUMzQixDQUFDO0FBQ0QsWUFBTU0sYUFBYSxLQUFLO0FBQ3hCLGFBQU95RTtBQUFBQSxJQUNULFNBQVNyRSxLQUFVO0FBQ2pCM0Ysa0JBQVkyRixJQUFJbUQsT0FBTztBQUN2QixZQUFNbkQ7QUFBQUEsSUFDUjtBQUFBLEVBQ0Y7QUFFQSxRQUFNc0Usa0JBQWtCLE9BQU9oRixTQUFrSTtBQUMvSixRQUFJO0FBQ0YsWUFBTStFLFVBQVUsTUFBTXpOLFNBQVMsZ0JBQWdCO0FBQUEsUUFDN0NrSixRQUFRO0FBQUEsUUFDUmtELE1BQU1DLEtBQUtDLFVBQVU1RCxJQUFJO0FBQUEsTUFDM0IsQ0FBQztBQUVELFlBQU1pRixVQUFVLE1BQU0zTixTQUFTLGNBQWM7QUFDN0M4RSxxQkFBZTZJLE9BQU87QUFDdEIsYUFBT0Y7QUFBQUEsSUFDVCxTQUFTckUsS0FBVTtBQUNqQjNGLGtCQUFZMkYsSUFBSW1ELE9BQU87QUFDdkIsWUFBTW5EO0FBQUFBLElBQ1I7QUFBQSxFQUNGO0FBRUEsUUFBTXdFLG1CQUFtQixPQUFPbEYsU0FBb047QUFDbFAsUUFBSTtBQUNGLFlBQU0xSSxTQUFTLGlCQUFpQjtBQUFBLFFBQzlCa0osUUFBUTtBQUFBLFFBQ1JrRCxNQUFNQyxLQUFLQyxVQUFVNUQsSUFBSTtBQUFBLE1BQzNCLENBQUM7QUFDRE0sbUJBQWE7QUFBQSxJQUNmLFNBQVNJLEtBQVU7QUFDakIzRixrQkFBWTJGLElBQUltRCxPQUFPO0FBQUEsSUFDekI7QUFBQSxFQUNGO0FBRUEsUUFBTXNCLDRCQUE0QixPQUFPQyxZQUFtQjtBQUMxRCxRQUFJO0FBQ0YsWUFBTUMsT0FBTyxNQUFNL04sU0FBUyx1QkFBdUI7QUFBQSxRQUNqRGtKLFFBQVE7QUFBQSxRQUNSa0QsTUFBTUMsS0FBS0MsVUFBVXdCLE9BQU87QUFBQSxNQUM5QixDQUFDO0FBQ0R2SyxzQkFBZ0J3SyxJQUFJO0FBQ3BCLFVBQUlBLEtBQUtDLGlCQUFpQkQsS0FBS0MsZ0JBQWdCLEVBQUdoRixjQUFhO0FBQUEsSUFDakUsU0FBU0ksS0FBVTtBQUNqQjNGLGtCQUFZMkYsSUFBSW1ELFdBQVcsdUJBQXVCO0FBQUEsSUFDcEQ7QUFBQSxFQUNGO0FBRUEsUUFBTTBCLDJCQUEyQixPQUFPSCxZQUFtQjtBQUN6RCxRQUFJO0FBQ0YsWUFBTUMsT0FBTyxNQUFNL04sU0FBUyxzQkFBc0I7QUFBQSxRQUNoRGtKLFFBQVE7QUFBQSxRQUNSa0QsTUFBTUMsS0FBS0MsVUFBVXdCLE9BQU87QUFBQSxNQUM5QixDQUFDO0FBQ0R2SyxzQkFBZ0J3SyxJQUFJO0FBQ3BCLFVBQUlBLEtBQUtDLGlCQUFpQkQsS0FBS0MsZ0JBQWdCLEVBQUdoRixjQUFhO0FBQUEsSUFDakUsU0FBU0ksS0FBVTtBQUNqQjNGLGtCQUFZMkYsSUFBSW1ELFdBQVcsMkJBQTJCO0FBQUEsSUFDeEQ7QUFBQSxFQUNGO0FBRUEsUUFBTTJCLG1CQUFtQixPQUFPeEYsU0FBK047QUFDN1AsUUFBSTtBQUNGLFlBQU0rRSxVQUFVLE1BQU16TixTQUFTLG9CQUFvQjtBQUFBLFFBQ2pEa0osUUFBUTtBQUFBLFFBQ1JrRCxNQUFNQyxLQUFLQyxVQUFVNUQsSUFBSTtBQUFBLE1BQzNCLENBQUM7QUFFRE0sbUJBQWE7QUFDYixhQUFPeUU7QUFBQUEsSUFDVCxTQUFTckUsS0FBVTtBQUNqQixZQUFNK0Usc0JBQXNCL0UsSUFBSThELFdBQVcsT0FBTyxZQUFZa0IsS0FBS2hGLElBQUltRCxPQUFPLElBQzFFLHFGQUNBbkQsSUFBSW1ELFdBQVc7QUFDbkI5SSxrQkFBWTBLLG1CQUFtQjtBQUMvQixZQUFNLElBQUlwQixNQUFNb0IsbUJBQW1CO0FBQUEsSUFDckM7QUFBQSxFQUNGO0FBRUEsUUFBTUUsbUJBQW1CLE9BQU8zSSxJQUFZZ0QsU0FBb087QUFDOVEsUUFBSTtBQUNGLFlBQU0xSSxTQUFTLG9CQUFvQjBGLEVBQUUsSUFBSTtBQUFBLFFBQ3ZDd0QsUUFBUTtBQUFBLFFBQ1JrRCxNQUFNQyxLQUFLQyxVQUFVNUQsSUFBSTtBQUFBLE1BQzNCLENBQUM7QUFDRE0sbUJBQWE7QUFBQSxJQUNmLFNBQVNJLEtBQVU7QUFDakIzRixrQkFBWTJGLElBQUltRCxXQUFXLHVDQUF1QztBQUNsRSxZQUFNbkQ7QUFBQUEsSUFDUjtBQUFBLEVBQ0Y7QUFFQSxRQUFNa0Ysb0JBQW9CLE9BQU8zQyxRQUFnQjRDLGFBQXFCO0FBQ3BFLFFBQUk7QUFDRixZQUFNdk8sU0FBUywyQkFBMkI7QUFBQSxRQUN4Q2tKLFFBQVE7QUFBQSxRQUNSa0QsTUFBTUMsS0FBS0MsVUFBVSxFQUFFWCxRQUFRNEMsU0FBUyxDQUFDO0FBQUEsTUFDM0MsQ0FBQztBQUNEdkYsbUJBQWE7QUFBQSxJQUNmLFNBQVNJLEtBQVU7QUFDakIzRixrQkFBWTJGLElBQUltRCxXQUFXLDZDQUE2QztBQUN4RSxZQUFNbkQ7QUFBQUEsSUFDUjtBQUFBLEVBQ0Y7QUFFQSxRQUFNb0YsbUJBQW1CLE9BQU85SSxPQUFlO0FBQzdDLFFBQUk7QUFDRixZQUFNMUYsU0FBUyxvQkFBb0IwRixFQUFFLElBQUk7QUFBQSxRQUN2Q3dELFFBQVE7QUFBQSxNQUNWLENBQUM7QUFDREYsbUJBQWE7QUFBQSxJQUNmLFNBQVNJLEtBQVU7QUFDakIzRixrQkFBWTJGLElBQUltRCxXQUFXLG1DQUFtQztBQUM5RCxZQUFNbkQ7QUFBQUEsSUFDUjtBQUFBLEVBQ0Y7QUFFQSxRQUFNcUYsbUJBQW1CLE9BQU8vRixTQUE2STtBQUMzSyxRQUFJO0FBQ0YsWUFBTTFJLFNBQVMsaUJBQWlCO0FBQUEsUUFDOUJrSixRQUFRO0FBQUEsUUFDUmtELE1BQU1DLEtBQUtDLFVBQVU1RCxJQUFJO0FBQUEsTUFDM0IsQ0FBQztBQUNETSxtQkFBYTtBQUFBLElBQ2YsU0FBU0ksS0FBVTtBQUNqQjNGLGtCQUFZMkYsSUFBSW1ELE9BQU87QUFBQSxJQUN6QjtBQUFBLEVBQ0Y7QUFFQSxRQUFNbUMsdUJBQXVCLE9BQU9oSixJQUFZaUosV0FBbUI7QUFDakUsUUFBSTtBQUNGLFlBQU0zTyxTQUFTLGlCQUFpQjBGLEVBQUUsWUFBWTtBQUFBLFFBQzVDd0QsUUFBUTtBQUFBLFFBQ1JrRCxNQUFNQyxLQUFLQyxVQUFVLEVBQUVzQyxxQkFBcUJELE9BQU8sQ0FBQztBQUFBLE1BQ3RELENBQUM7QUFDRDNGLG1CQUFhO0FBQUEsSUFDZixTQUFTSSxLQUFVO0FBQ2pCM0Ysa0JBQVkyRixJQUFJbUQsT0FBTztBQUFBLElBQ3pCO0FBQUEsRUFDRjtBQUVBLFFBQU1zQyxzQkFBc0IsT0FBT25HLFNBQW1IO0FBQ3BKLFFBQUk7QUFDRnRELGNBQVEwSixNQUFNLHVCQUF1QnBHLElBQUk7QUFDekMsWUFBTTFJLFNBQVMsb0JBQW9CO0FBQUEsUUFDakNrSixRQUFRO0FBQUEsUUFDUmtELE1BQU1DLEtBQUtDLFVBQVU1RCxJQUFJO0FBQUEsTUFDM0IsQ0FBQztBQUNEdEQsY0FBUTBKLE1BQU0scUNBQXFDO0FBQ25EOUYsbUJBQWE7QUFBQSxJQUNmLFNBQVNJLEtBQVU7QUFDakIzRixrQkFBWTJGLElBQUltRCxPQUFPO0FBQUEsSUFDekI7QUFBQSxFQUNGO0FBRUEsUUFBTXdDLDBCQUEwQixZQUFZO0FBQzFDLFFBQUk7QUFDRixZQUFNQyxXQUFXLE1BQU1oUCxTQUFTLGlDQUFpQztBQUNqRSxVQUFJa0YsTUFBTUMsUUFBUTZKLFFBQVEsRUFBRzNILHlCQUF3QjJILFFBQVE7QUFBQSxJQUMvRCxTQUFTNUYsS0FBVTtBQUNqQmhFLGNBQVEyRCxLQUFLLDRDQUE0Q0ssR0FBRztBQUFBLElBQzlEO0FBQUEsRUFDRjtBQUVBLFFBQU02RixpQkFBaUIsT0FBT3ZHLFNBQXNGO0FBQ2xILFFBQUk7QUFDRixZQUFNd0csd0JBQXdCLE1BQU1sUCxTQUFTLGVBQWU7QUFBQSxRQUMxRGtKLFFBQVE7QUFBQSxRQUNSa0QsTUFBTUMsS0FBS0MsVUFBVTVELElBQUk7QUFBQSxNQUMzQixDQUFDO0FBQ0RqQyxvQkFBYyxDQUFDdUcsU0FBUztBQUN0QixjQUFNbUMsZ0JBQWdCbkMsS0FBS29DO0FBQUFBLFVBQ3pCLENBQUNDLE1BQVdBLEVBQUVDLGlCQUFpQjVHLEtBQUs0RyxnQkFBZ0JELEVBQUVFLGNBQWM3RyxLQUFLNkc7QUFBQUEsUUFDM0U7QUFDQSxjQUFNQyxhQUFhO0FBQUEsVUFDakI5SixJQUFJd0osc0JBQXNCeEosT0FBT3lKLGtCQUFrQixLQUFLbkMsS0FBS21DLGFBQWEsRUFBRXpKLEtBQUttRyxLQUFLQyxJQUFJO0FBQUEsVUFDMUZ3RCxjQUFjNUcsS0FBSzRHO0FBQUFBLFVBQ25CQyxXQUFXN0csS0FBSzZHO0FBQUFBLFVBQ2hCRSxPQUFPL0csS0FBSytHO0FBQUFBLFVBQ1pDLFNBQVNoSCxLQUFLZ0g7QUFBQUEsVUFDZEMsV0FBV1Qsc0JBQXNCUyxhQUFhM0MsS0FBS21DLGFBQWEsR0FBR1EsYUFBYTtBQUFBLFVBQ2hGQyxpQkFBaUJWLHNCQUFzQlUsbUJBQW1CNUMsS0FBS21DLGFBQWEsR0FBR1MsbUJBQW1CO0FBQUEsVUFDbEdDLFNBQVNYLHNCQUFzQlcsV0FBVzdDLEtBQUttQyxhQUFhLEdBQUdVLFdBQVc7QUFBQSxRQUM1RTtBQUNBLFlBQUlWLGtCQUFrQixJQUFJO0FBQ3hCLGdCQUFNVyxPQUFPLENBQUMsR0FBRzlDLElBQUk7QUFDckI4QyxlQUFLWCxhQUFhLElBQUlLO0FBQ3RCLGlCQUFPTTtBQUFBQSxRQUNUO0FBQ0EsZUFBTyxDQUFDLEdBQUc5QyxNQUFNd0MsVUFBVTtBQUFBLE1BQzdCLENBQUM7QUFBQSxJQUNILFNBQVNwRyxLQUFVO0FBQ2pCM0Ysa0JBQVkyRixJQUFJbUQsT0FBTztBQUN2QixZQUFNbkQ7QUFBQUEsSUFDUjtBQUFBLEVBQ0Y7QUFFQSxRQUFNMkcsbUJBQW1CLE9BQU9ySCxTQUE2RDtBQUMzRixRQUFJO0FBQ0YsWUFBTXNILGlCQUFpQixNQUFNaFEsU0FBUyxpQkFBaUI7QUFBQSxRQUNyRGtKLFFBQVE7QUFBQSxRQUNSa0QsTUFBTUMsS0FBS0MsVUFBVTVELElBQUk7QUFBQSxNQUMzQixDQUFDO0FBQ0R2QixzQkFBZ0IsQ0FBQzZGLFNBQVMsQ0FBQyxHQUFHQSxNQUFNZ0QsY0FBYyxDQUFDO0FBQUEsSUFDckQsU0FBUzVHLEtBQVU7QUFDakIzRixrQkFBWTJGLElBQUltRCxPQUFPO0FBQ3ZCLFlBQU1uRDtBQUFBQSxJQUNSO0FBQUEsRUFDRjtBQUVBLFFBQU02RyxzQkFBc0IsT0FBT3ZLLElBQVlnRCxTQUEwQztBQUN2RixRQUFJO0FBQ0YsWUFBTXdILGlCQUFpQixNQUFNbFEsU0FBUyxpQkFBaUIwRixFQUFFLElBQUk7QUFBQSxRQUMzRHdELFFBQVE7QUFBQSxRQUNSa0QsTUFBTUMsS0FBS0MsVUFBVTVELElBQUk7QUFBQSxNQUMzQixDQUFDO0FBQ0R2QjtBQUFBQSxRQUFnQixDQUFDNkYsU0FDZkEsS0FBS2xGLElBQUksQ0FBQ3FJLE1BQU9BLEVBQUV6SyxPQUFPQSxLQUFLd0ssaUJBQWlCQyxDQUFFO0FBQUEsTUFDcEQ7QUFDQSxZQUFNcEIsd0JBQXdCO0FBQUEsSUFDaEMsU0FBUzNGLEtBQVU7QUFDakIzRixrQkFBWTJGLElBQUltRCxPQUFPO0FBQ3ZCLFlBQU1uRDtBQUFBQSxJQUNSO0FBQUEsRUFDRjtBQUVBLFFBQU1nSCxzQkFBc0IsT0FBTzFLLE9BQWU7QUFDaEQsUUFBSTtBQUNGLFlBQU0xRixTQUFTLGlCQUFpQjBGLEVBQUUsSUFBSTtBQUFBLFFBQ3BDd0QsUUFBUTtBQUFBLE1BQ1YsQ0FBQztBQUNEL0Isc0JBQWdCLENBQUM2RixTQUFTQSxLQUFLN0csT0FBTyxDQUFDZ0ssTUFBTUEsRUFBRXpLLE9BQU9BLEVBQUUsQ0FBQztBQUN6RCxZQUFNcUosd0JBQXdCO0FBQUEsSUFDaEMsU0FBUzNGLEtBQVU7QUFDakIzRixrQkFBWTJGLElBQUltRCxPQUFPO0FBQ3ZCLFlBQU1uRDtBQUFBQSxJQUNSO0FBQUEsRUFDRjtBQUVBLFFBQU1pSCx1QkFBdUIsT0FBTzNLLE9BQWU7QUFDakQsUUFBSTtBQUNGLFlBQU02RSxXQUFXMUg7QUFDakIsVUFBSSxDQUFDMEgsU0FBVSxPQUFNLElBQUl3QyxNQUFNLGlDQUFpQztBQUNoRSxZQUFNL00sU0FBUyxnQkFBZ0J1SyxRQUFRLGFBQWE3RSxFQUFFLFlBQVksRUFBRXdELFFBQVEsT0FBTyxDQUFDO0FBQ3BGL0Isc0JBQWdCLENBQUM2RixTQUFTQSxLQUFLbEYsSUFBSSxDQUFDcUksTUFBT0EsRUFBRXpLLE9BQU9BLEtBQUssRUFBRSxHQUFHeUssR0FBR2pELFFBQVEsV0FBVyxJQUFJaUQsQ0FBRSxDQUFDO0FBQzNGLFlBQU1wQix3QkFBd0I7QUFBQSxJQUNoQyxTQUFTM0YsS0FBVTtBQUNqQjNGLGtCQUFZMkYsSUFBSW1ELE9BQU87QUFDdkIsWUFBTW5EO0FBQUFBLElBQ1I7QUFBQSxFQUNGO0FBRUEsUUFBTWtILHNCQUFzQixPQUFPNUssT0FBZTtBQUNoRCxRQUFJO0FBQ0YsWUFBTTZFLFdBQVcxSDtBQUNqQixVQUFJLENBQUMwSCxTQUFVLE9BQU0sSUFBSXdDLE1BQU0saUNBQWlDO0FBQ2hFLFlBQU0vTSxTQUFTLGdCQUFnQnVLLFFBQVEsYUFBYTdFLEVBQUUsV0FBVyxFQUFFd0QsUUFBUSxPQUFPLENBQUM7QUFDbkYvQixzQkFBZ0IsQ0FBQzZGLFNBQVNBLEtBQUtsRixJQUFJLENBQUNxSSxNQUFPQSxFQUFFekssT0FBT0EsS0FBSyxFQUFFLEdBQUd5SyxHQUFHakQsUUFBUSxXQUFXLElBQUlpRCxDQUFFLENBQUM7QUFDM0YsWUFBTXBCLHdCQUF3QjtBQUFBLElBQ2hDLFNBQVMzRixLQUFVO0FBQ2pCM0Ysa0JBQVkyRixJQUFJbUQsT0FBTztBQUN2QixZQUFNbkQ7QUFBQUEsSUFDUjtBQUFBLEVBQ0Y7QUFFQSxRQUFNbUgseUJBQXlCLE9BQU83SCxTQUF5RTtBQUM3RyxRQUFJO0FBQ0YsWUFBTTFJLFNBQVMsMkJBQTJCO0FBQUEsUUFDeENrSixRQUFRO0FBQUEsUUFDUmtELE1BQU1DLEtBQUtDLFVBQVU1RCxJQUFJO0FBQUEsTUFDM0IsQ0FBQztBQUNETSxtQkFBYTtBQUFBLElBQ2YsU0FBU0ksS0FBVTtBQUNqQjNGLGtCQUFZMkYsSUFBSW1ELE9BQU87QUFBQSxJQUN6QjtBQUFBLEVBQ0Y7QUFFQSxRQUFNaUUsc0JBQXNCLFlBQVk7QUFDdEMsUUFBSTtBQUNGLFlBQU14USxTQUFTLCtCQUErQixFQUFFa0osUUFBUSxNQUFNLENBQUM7QUFDL0RGLG1CQUFhO0FBQUEsSUFDZixTQUFTSSxLQUFVO0FBQ2pCM0Ysa0JBQVkyRixJQUFJbUQsT0FBTztBQUFBLElBQ3pCO0FBQUEsRUFDRjtBQUVBLFFBQU1rRSx5QkFBeUIsWUFBWTtBQUV6QyxRQUFJO0FBQ0YsWUFBTXpILGFBQWEsS0FBSztBQUFBLElBQzFCLFNBQVNXLEdBQUc7QUFDVnZFLGNBQVEyRCxLQUFLLDBEQUEwRFksQ0FBQztBQUFBLElBQzFFO0FBQUEsRUFDRjtBQUdBLE1BQUksQ0FBQ25ILHFCQUFzQixDQUFDQyxTQUFTRyxnQkFBZ0IsaUJBQW1CQSxnQkFBZ0IsaUJBQWlCLENBQUNELGdCQUFpQjtBQUN6SCxXQUFPLHVCQUFDLGFBQVUsU0FBUyxDQUFDRCxVQUFTO0FBQUV4Qyx1QkFBaUJ3QyxLQUFJO0FBQUEsSUFBRyxLQUF4RDtBQUFBO0FBQUE7QUFBQTtBQUFBLFdBQTBEO0FBQUEsRUFDbkU7QUFHQSxRQUFNZ08sb0JBQW9CcEssZ0JBQWdCSCxPQUFPLENBQUN3SyxPQUFPO0FBQ3ZELFFBQUkvTixnQkFBZ0IsY0FBZSxRQUFPO0FBQzFDLFFBQUlBLGdCQUFnQixnQkFBZ0I7QUFDbEMsYUFBTyxDQUFDbEMsZ0NBQWdDaVEsSUFBSWhNLGNBQWM2QixVQUFVLEtBQy9ELENBQUM3Rix3Q0FBd0NnUSxJQUFJaE0sY0FBYzZCLFVBQVU7QUFBQSxJQUM1RTtBQUNBLFdBQU8sQ0FBQy9GLHFCQUFxQmtRLElBQUloTSxjQUFjNkIsVUFBVTtBQUFBLEVBQzNELENBQUM7QUFDRCxRQUFNb0ssc0JBQXNCdEssZ0JBQWdCSCxPQUFPLENBQUN3SyxPQUFPO0FBQ3pELFFBQUkvTixnQkFBZ0IsY0FBZSxRQUFPO0FBQzFDLFFBQUlBLGdCQUFnQixnQkFBZ0I7QUFDbEMsYUFBT2xDLGdDQUFnQ2lRLElBQUloTSxjQUFjNkIsVUFBVSxLQUM5RDdGLHdDQUF3Q2dRLElBQUloTSxjQUFjNkIsVUFBVTtBQUFBLElBQzNFO0FBQ0EsV0FBTy9GLHFCQUFxQmtRLElBQUloTSxjQUFjNkIsVUFBVTtBQUFBLEVBQzFELENBQUM7QUFFRCxTQUNFLHVCQUFDLFNBQUksV0FBVSxtRUFBa0UsSUFBRyxvQkFFbEY7QUFBQTtBQUFBLE1BQUM7QUFBQTtBQUFBLFFBQ0M7QUFBQSxRQUNBO0FBQUEsUUFDQTtBQUFBLFFBQ0E7QUFBQSxRQUNBO0FBQUEsUUFDQTtBQUFBLFFBQ0E7QUFBQSxRQUNBO0FBQUEsUUFDQTtBQUFBLFFBQ0EsY0FBYzBFO0FBQUFBLFFBQ2QsVUFBVWE7QUFBQUEsUUFDVixlQUFlL0M7QUFBQUEsUUFDZjtBQUFBLFFBQ0Esa0JBQWtCLE1BQU0vRixhQUFhLGdCQUFnQjtBQUFBO0FBQUEsTUFkdkQ7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBLElBY3lEO0FBQUEsSUFHeERpRixtQkFDQyx1QkFBQyxvQkFBaUIsU0FBU0EsaUJBQWlCLFNBQVMsTUFBTXpFLFlBQVksSUFBSSxLQUEzRTtBQUFBO0FBQUE7QUFBQTtBQUFBLFdBQTZFO0FBQUEsSUFJL0UsdUJBQUMsU0FBSSxXQUFVLHFGQUdiO0FBQUEsNkJBQUMsV0FBTSxXQUFVLHNGQUFxRixJQUFHLGdCQUN2RztBQUFBLCtCQUFDLFNBQUksV0FBVSxhQUNiO0FBQUEsaUNBQUMsU0FBSSxXQUFVLDRDQUNiO0FBQUEsbUNBQUMsVUFBSyxXQUFVLHdFQUF1RSwwQkFBdkY7QUFBQTtBQUFBO0FBQUE7QUFBQSxtQkFBaUc7QUFBQSxZQUNqRyx1QkFBQyxPQUFFLFdBQVUsMEJBQXlCLDJEQUF0QztBQUFBO0FBQUE7QUFBQTtBQUFBLG1CQUFpRjtBQUFBLGVBRm5GO0FBQUE7QUFBQTtBQUFBO0FBQUEsaUJBR0E7QUFBQSxVQUVBLHVCQUFDLFNBQUksV0FBVSxhQUViO0FBQUE7QUFBQSxjQUFDO0FBQUE7QUFBQSxnQkFDQyxTQUFTLE1BQU1SLGFBQWEsaUJBQWlCO0FBQUEsZ0JBQzdDLFdBQVcsMEhBQ1RELGNBQWMsb0JBQ1YsNERBQ0EsdURBQXVEO0FBQUEsZ0JBRTdELElBQUc7QUFBQSxnQkFFSDtBQUFBLHlDQUFDLG1CQUFnQixXQUFVLGlCQUEzQjtBQUFBO0FBQUE7QUFBQTtBQUFBLHlCQUF3QztBQUFBLGtCQUN4Qyx1QkFBQyxVQUFLLCtCQUFOO0FBQUE7QUFBQTtBQUFBO0FBQUEseUJBQXFCO0FBQUE7QUFBQTtBQUFBLGNBVnZCO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQSxZQVdBO0FBQUEsWUFHQTtBQUFBLGNBQUM7QUFBQTtBQUFBLGdCQUNDLFNBQVMsTUFBTUMsYUFBYSxnQkFBZ0I7QUFBQSxnQkFDNUMsV0FBVywwSEFDVEQsY0FBYyxtQkFDViw0REFDQSx1REFBdUQ7QUFBQSxnQkFFN0QsSUFBRztBQUFBLGdCQUVIO0FBQUEseUNBQUMsYUFBVSxXQUFVLGlCQUFyQjtBQUFBO0FBQUE7QUFBQTtBQUFBLHlCQUFrQztBQUFBLGtCQUNsQyx1QkFBQyxVQUFLLDhCQUFOO0FBQUE7QUFBQTtBQUFBO0FBQUEseUJBQW9CO0FBQUE7QUFBQTtBQUFBLGNBVnRCO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQSxZQVdBO0FBQUEsWUFHQTtBQUFBLGNBQUM7QUFBQTtBQUFBLGdCQUNDLFNBQVMsTUFBTUMsYUFBYSxVQUFVO0FBQUEsZ0JBQ3RDLFdBQVcsMElBQ1RELGNBQWMsYUFDViw0REFDQSx1REFBdUQ7QUFBQSxnQkFFN0QsSUFBRztBQUFBLGdCQUNILGVBQVk7QUFBQSxnQkFFWjtBQUFBLHlDQUFDLFNBQUksV0FBVSwyQkFDYjtBQUFBLDJDQUFDLGdCQUFhLFdBQVUsaUJBQXhCO0FBQUE7QUFBQTtBQUFBO0FBQUEsMkJBQXFDO0FBQUEsb0JBQ3JDLHVCQUFDLFVBQUssd0JBQU47QUFBQTtBQUFBO0FBQUE7QUFBQSwyQkFBYztBQUFBLHVCQUZoQjtBQUFBO0FBQUE7QUFBQTtBQUFBLHlCQUdBO0FBQUEsa0JBQ0NrRCwyQkFBMkIsS0FDMUIsdUJBQUMsVUFBSyxXQUFXLG9EQUNmbEQsY0FBYyxhQUFhLDZCQUE2QiwwQkFBMEIsSUFFakZrRCxxQ0FBMkIsS0FBSyxRQUFRQSw0QkFIM0M7QUFBQTtBQUFBO0FBQUE7QUFBQSx5QkFJQTtBQUFBO0FBQUE7QUFBQSxjQW5CSjtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUEsWUFxQkE7QUFBQSxZQUVDdEQsZ0JBQWdCLFlBQ2Y7QUFBQSxjQUFDO0FBQUE7QUFBQSxnQkFDQyxTQUFTLE1BQU1LLGFBQWEsT0FBTztBQUFBLGdCQUNuQyxXQUFXLDBIQUNURCxjQUFjLFVBQ1YsNERBQ0EsdURBQXVEO0FBQUEsZ0JBRTdELElBQUc7QUFBQSxnQkFFSDtBQUFBLHlDQUFDLFNBQU0sV0FBVSxpQkFBakI7QUFBQTtBQUFBO0FBQUE7QUFBQSx5QkFBOEI7QUFBQSxrQkFDOUIsdUJBQUMsVUFBSyxxQkFBTjtBQUFBO0FBQUE7QUFBQTtBQUFBLHlCQUFXO0FBQUE7QUFBQTtBQUFBLGNBVmI7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBLFlBV0E7QUFBQSxZQUlESixnQkFBZ0IsWUFDZixtQ0FDRTtBQUFBO0FBQUEsZ0JBQUM7QUFBQTtBQUFBLGtCQUNDLFNBQVMsTUFBTUssYUFBYSxPQUFPO0FBQUEsa0JBQ25DLFdBQVcsMElBQ1RELGNBQWMsVUFDViw0REFDQSx1REFBdUQ7QUFBQSxrQkFFN0QsSUFBRztBQUFBLGtCQUVIO0FBQUEsMkNBQUMsU0FBSSxXQUFVLDJCQUNiO0FBQUEsNkNBQUMsU0FBTSxXQUFVLGlCQUFqQjtBQUFBO0FBQUE7QUFBQTtBQUFBLDZCQUE4QjtBQUFBLHNCQUM5Qix1QkFBQyxVQUFLLGlDQUFOO0FBQUE7QUFBQTtBQUFBO0FBQUEsNkJBQXVCO0FBQUEseUJBRnpCO0FBQUE7QUFBQTtBQUFBO0FBQUEsMkJBR0E7QUFBQSxvQkFDQ21GLG1CQUFtQixLQUNsQix1QkFBQyxVQUFLLFdBQVcsb0RBQ2ZuRixjQUFjLFVBQVUsNkJBQTZCLHdCQUF3QixJQUU1RW1GLDhCQUhIO0FBQUE7QUFBQTtBQUFBO0FBQUEsMkJBSUE7QUFBQTtBQUFBO0FBQUEsZ0JBbEJKO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQSxjQW9CQTtBQUFBLGNBRUE7QUFBQSxnQkFBQztBQUFBO0FBQUEsa0JBQ0MsU0FBUyxNQUFNbEYsYUFBYSxTQUFTO0FBQUEsa0JBQ3JDLFdBQVcsMEhBQ1RELGNBQWMsWUFDViw0REFDQSx1REFBdUQ7QUFBQSxrQkFFN0QsSUFBRztBQUFBLGtCQUVIO0FBQUEsMkNBQUMsWUFBUyxXQUFVLGlCQUFwQjtBQUFBO0FBQUE7QUFBQTtBQUFBLDJCQUFpQztBQUFBLG9CQUNqQyx1QkFBQyxVQUFLLHVCQUFOO0FBQUE7QUFBQTtBQUFBO0FBQUEsMkJBQWE7QUFBQTtBQUFBO0FBQUEsZ0JBVmY7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBLGNBV0E7QUFBQSxpQkFsQ0Y7QUFBQTtBQUFBO0FBQUE7QUFBQSxtQkFtQ0E7QUFBQSxhQUdBSixnQkFBZ0Isa0JBQWtCQSxnQkFBZ0IsaUJBQWlCQSxnQkFBZ0IsY0FDbkY7QUFBQSxjQUFDO0FBQUE7QUFBQSxnQkFDQyxTQUFTLE1BQU1LLGFBQWEsV0FBVztBQUFBLGdCQUN2QyxXQUFXLDBJQUNURCxjQUFjLGNBQ1YsNERBQ0EsdURBQXVEO0FBQUEsZ0JBRTdELElBQUc7QUFBQSxnQkFFSDtBQUFBLHlDQUFDLFNBQUksV0FBVSwyQkFDYjtBQUFBLDJDQUFDLFlBQVMsV0FBVSxpQkFBcEI7QUFBQTtBQUFBO0FBQUE7QUFBQSwyQkFBaUM7QUFBQSxvQkFDakMsdUJBQUMsVUFBSyx5QkFBTjtBQUFBO0FBQUE7QUFBQTtBQUFBLDJCQUFlO0FBQUEsdUJBRmpCO0FBQUE7QUFBQTtBQUFBO0FBQUEseUJBR0E7QUFBQSxrQkFDQ21GLG1CQUFtQixLQUNsQix1QkFBQyxVQUFLLFdBQVcsb0RBQ2ZuRixjQUFjLGNBQWMsNkJBQTZCLHdCQUF3QixJQUVoRm1GLDhCQUhIO0FBQUE7QUFBQTtBQUFBO0FBQUEseUJBSUE7QUFBQTtBQUFBO0FBQUEsY0FsQko7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBLFlBb0JBO0FBQUEsWUFHRHZGLGdCQUFnQixpQkFDZjtBQUFBLGNBQUM7QUFBQTtBQUFBLGdCQUNDLFNBQVMsTUFBTUssYUFBYSxPQUFPO0FBQUEsZ0JBQ25DLFdBQVcsMEhBQ1RELGNBQWMsVUFDViw0REFDQSx1REFBdUQ7QUFBQSxnQkFFN0QsSUFBRztBQUFBLGdCQUVIO0FBQUEseUNBQUMsUUFBSyxXQUFVLGlCQUFoQjtBQUFBO0FBQUE7QUFBQTtBQUFBLHlCQUE2QjtBQUFBLGtCQUM3Qix1QkFBQyxVQUFLLG1DQUFOO0FBQUE7QUFBQTtBQUFBO0FBQUEseUJBQXlCO0FBQUE7QUFBQTtBQUFBLGNBVjNCO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQSxZQVdBO0FBQUEsWUFJRjtBQUFBLGNBQUM7QUFBQTtBQUFBLGdCQUNDLFNBQVMsTUFBTUMsYUFBYSxlQUFlO0FBQUEsZ0JBQzNDLFdBQVcsb0lBQ1RELGNBQWMsa0JBQ1YsNERBQ0EsdURBQXVEO0FBQUEsZ0JBRTdELElBQUc7QUFBQSxnQkFFSDtBQUFBLHlDQUFDLFNBQUksV0FBVSwyQkFDYjtBQUFBLDJDQUFDLFFBQUssV0FBVSxpQkFBaEI7QUFBQTtBQUFBO0FBQUE7QUFBQSwyQkFBNkI7QUFBQSxvQkFDN0IsdUJBQUMsVUFBSyxpQ0FBTjtBQUFBO0FBQUE7QUFBQTtBQUFBLDJCQUF1QjtBQUFBLHVCQUZ6QjtBQUFBO0FBQUE7QUFBQTtBQUFBLHlCQUdBO0FBQUEsa0JBQ0M0RCxrQkFBa0JULE9BQU8sQ0FBQzBLLE1BQU0sQ0FBQ0EsRUFBRUMsTUFBTSxFQUFFeEwsU0FBUyxLQUNuRCx1QkFBQyxVQUFLLFdBQVcsb0RBQ2Z0QyxjQUFjLGtCQUFrQiw2QkFBNkIsMEJBQTBCLElBRXRGNEQsNEJBQWtCVCxPQUFPLENBQUMwSyxNQUFNLENBQUNBLEVBQUVDLE1BQU0sRUFBRXhMLFVBSDlDO0FBQUE7QUFBQTtBQUFBO0FBQUEseUJBSUE7QUFBQTtBQUFBO0FBQUEsY0FsQko7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBLFlBb0JBO0FBQUEsWUFHQTtBQUFBLGNBQUM7QUFBQTtBQUFBLGdCQUNDLFNBQVMsTUFBTXJDLGFBQWEsZUFBZTtBQUFBLGdCQUMzQyxXQUFXLDBIQUNURCxjQUFjLGtCQUNWLDREQUNBLHVEQUF1RDtBQUFBLGdCQUU3RCxJQUFHO0FBQUEsZ0JBRUg7QUFBQSx5Q0FBQyxjQUFXLFdBQVUsaUJBQXRCO0FBQUE7QUFBQTtBQUFBO0FBQUEseUJBQW1DO0FBQUEsa0JBQ25DLHVCQUFDLFVBQUssa0NBQU47QUFBQTtBQUFBO0FBQUE7QUFBQSx5QkFBd0I7QUFBQTtBQUFBO0FBQUEsY0FWMUI7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBLFlBV0E7QUFBQSxlQXRMRjtBQUFBO0FBQUE7QUFBQTtBQUFBLGlCQXVMQTtBQUFBLGFBN0xGO0FBQUE7QUFBQTtBQUFBO0FBQUEsZUE4TEE7QUFBQSxRQUdDSixnQkFBZ0IsaUJBQ2YsdUJBQUMsU0FBSSxXQUFVLCtEQUNiLGlDQUFDLFNBQUksV0FBVSx3Q0FDYjtBQUFBLGlDQUFDLFVBQUssV0FBVSxrQ0FBaUMsaUNBQWpEO0FBQUE7QUFBQTtBQUFBO0FBQUEsaUJBQWtFO0FBQUEsVUFDbEUsdUJBQUMsT0FBRSxXQUFVLDZCQUNYO0FBQUEsbUNBQUMsVUFBSyxXQUFVLDBEQUFoQjtBQUFBO0FBQUE7QUFBQTtBQUFBLG1CQUFzRTtBQUFBLFlBQUc7QUFBQSxlQUQzRTtBQUFBO0FBQUE7QUFBQTtBQUFBLGlCQUdBO0FBQUEsYUFMRjtBQUFBO0FBQUE7QUFBQTtBQUFBLGVBTUEsS0FQRjtBQUFBO0FBQUE7QUFBQTtBQUFBLGVBUUE7QUFBQSxXQTNNSjtBQUFBO0FBQUE7QUFBQTtBQUFBLGFBNk1BO0FBQUEsTUFHQSx1QkFBQyxVQUFLLFdBQVUsa0JBQWlCLElBQUcsaUJBR2pDc0Y7QUFBQUEsMkJBQ0MsdUJBQUMsU0FBSSxXQUFVLG9IQUNiO0FBQUEsaUNBQUMsZUFBWSxXQUFVLDJDQUF2QjtBQUFBO0FBQUE7QUFBQTtBQUFBLGlCQUE4RDtBQUFBLFVBQzlELHVCQUFDLFNBQUksV0FBVSw2QkFDYjtBQUFBLG1DQUFDLE9BQUUsV0FBVSwyQkFBMEIsOEJBQXZDO0FBQUE7QUFBQTtBQUFBO0FBQUEsbUJBQXFEO0FBQUEsWUFDckQsdUJBQUMsT0FBRSxXQUFVLGlCQUFpQkEsNkJBQTlCO0FBQUE7QUFBQTtBQUFBO0FBQUEsbUJBQThDO0FBQUEsZUFGaEQ7QUFBQTtBQUFBO0FBQUE7QUFBQSxpQkFHQTtBQUFBLFVBQ0EsdUJBQUMsWUFBTyxTQUFTLE1BQU16RSxZQUFZLElBQUksR0FBRyxXQUFVLHNFQUFxRSxpQkFBekg7QUFBQTtBQUFBO0FBQUE7QUFBQSxpQkFBMEg7QUFBQSxhQU41SDtBQUFBO0FBQUE7QUFBQTtBQUFBLGVBT0E7QUFBQSxRQUlEUCxhQUNDLHVCQUFDLFNBQUksV0FBVSxtSUFDYjtBQUFBLGlDQUFDLGFBQVUsV0FBVSw0Q0FBckI7QUFBQTtBQUFBO0FBQUE7QUFBQSxpQkFBNkQ7QUFBQSxVQUM3RCx1QkFBQyxPQUFFLFdBQVUsc0NBQXFDLDhEQUFsRDtBQUFBO0FBQUE7QUFBQTtBQUFBLGlCQUFnRztBQUFBLGFBRmxHO0FBQUE7QUFBQTtBQUFBO0FBQUEsZUFHQTtBQUFBLFFBSUQsQ0FBQ0EsYUFDQSx1QkFBQyxTQUFJLFdBQVUsNkZBQTRGLElBQUcsZ0JBQzNHRjtBQUFBQSx3QkFBYyxxQkFDYjtBQUFBLFlBQUM7QUFBQTtBQUFBLGNBQ0M7QUFBQSxjQUNBLGdCQUFnQmdEO0FBQUFBLGNBQ2hCLGNBQWNVO0FBQUFBLGNBQ2QsVUFBVTlEO0FBQUFBLGNBQ1Y7QUFBQTtBQUFBLFlBTEY7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBLFVBS3VCO0FBQUEsVUFJeEJJLGNBQWMsb0JBQ2IsdUJBQUMsaUJBQ1M7QUFBQSxZQUFDO0FBQUE7QUFBQSxjQUNULFVBQVVKO0FBQUFBLGNBQ1Y7QUFBQSxjQUNBO0FBQUEsY0FDQTtBQUFBLGNBQ0E7QUFBQSxjQUNBO0FBQUEsY0FDQTtBQUFBLGNBQ0E7QUFBQSxjQUNBO0FBQUEsY0FDQTtBQUFBLGNBQ0EsYUFBYXNKO0FBQUFBLGNBQ2IsZ0JBQWdCb0I7QUFBQUEsY0FDaEIsaUJBQWlCQztBQUFBQSxjQUNqQixXQUFXZjtBQUFBQSxjQUNYLGlCQUFpQkM7QUFBQUEsY0FDakIsY0FBY0U7QUFBQUEsY0FDZCxZQUFZQztBQUFBQSxjQUNaLGNBQWNZO0FBQUFBLGNBQ2QsYUFBYUU7QUFBQUEsY0FDYixjQUFjRTtBQUFBQSxjQUNkLHVCQUF1QkM7QUFBQUEsY0FDdkIsc0JBQXNCSTtBQUFBQSxjQUN0QjtBQUFBLGNBQ0EsY0FBY0M7QUFBQUEsY0FDZCxjQUFjRztBQUFBQSxjQUNkLGVBQWVDO0FBQUFBLGNBQ2YsY0FBY0U7QUFBQUEsY0FDZCxlQUFlM0I7QUFBQUEsY0FDZixnQkFBZ0JPO0FBQUFBLGNBQ2hCLGNBQWMyQztBQUFBQSxjQUNkLGlCQUFpQkU7QUFBQUEsY0FDakIsaUJBQWlCRztBQUFBQSxjQUNqQixrQkFBa0JDO0FBQUFBLGNBQ2xCLGlCQUFpQkM7QUFBQUEsY0FDakIsZ0JBQWdCeEQ7QUFBQUEsY0FDaEIsZUFBZUs7QUFBQUEsY0FDZjtBQUFBO0FBQUEsWUFyQ1E7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBLFVBcUN5QixLQXRDbkM7QUFBQTtBQUFBO0FBQUE7QUFBQSxpQkF3Q0E7QUFBQSxVQUdEbkssY0FBYyxjQUNiO0FBQUEsWUFBQztBQUFBO0FBQUEsY0FDQyxVQUFVSjtBQUFBQSxjQUNWO0FBQUEsY0FDQTtBQUFBLGNBQ0E7QUFBQSxjQUNBO0FBQUEsY0FDQTtBQUFBLGNBQ0E7QUFBQSxjQUNBLGlCQUFpQkEsZ0JBQWdCLFlBQVk2RSx5QkFBeUI7QUFBQSxjQUN0RSx3QkFBd0I3RSxnQkFBZ0IsWUFBWThFLGdDQUFnQztBQUFBLGNBQ3BGLGNBQWMrRztBQUFBQSxjQUNkLGtCQUFrQkM7QUFBQUE7QUFBQUEsWUFYcEI7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBLFVBV3lDO0FBQUEsVUFJMUMxTCxjQUFjLFlBQ2JKLGdCQUFnQixXQUNkO0FBQUEsWUFBQztBQUFBO0FBQUEsY0FDQztBQUFBLGNBQ0E7QUFBQSxjQUNBO0FBQUEsY0FDQTtBQUFBLGNBQ0EsaUJBQWlCOE47QUFBQUE7QUFBQUEsWUFMbkI7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBLFVBS3FDLElBR3JDO0FBQUEsWUFBQztBQUFBO0FBQUEsY0FDQyxpQkFBaUJBO0FBQUFBLGNBQ2pCO0FBQUEsY0FDQTtBQUFBLGNBQ0E7QUFBQSxjQUNBO0FBQUEsY0FDQSxnQkFBZ0I1TjtBQUFBQSxjQUNoQixzQkFBc0JDO0FBQUFBLGNBQ3RCLGlCQUFpQkgsZ0JBQWdCLFlBQVk2RSx5QkFBeUI7QUFBQSxjQUN0RSx3QkFBd0I3RSxnQkFBZ0IsWUFBWThFLGdDQUFnQztBQUFBLGNBQ3BGO0FBQUEsY0FDQSxXQUFXOUUsZ0JBQWdCLFlBQVk0RSx1QkFBdUI5QixLQUFLMEM7QUFBQUEsY0FDbkUsaUJBQWlCeUc7QUFBQUEsY0FDakIsWUFBWUk7QUFBQUE7QUFBQUEsWUFiZDtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUEsVUFhNkI7QUFBQSxVQUtoQ2pNLGNBQWMsYUFBYUosZ0JBQWdCLFlBQzFDO0FBQUEsWUFBQztBQUFBO0FBQUEsY0FDQyxVQUFVQTtBQUFBQSxjQUNWLGlCQUFpQmdPO0FBQUFBLGNBQ2pCO0FBQUEsY0FDQTtBQUFBLGNBQ0E7QUFBQSxjQUNBO0FBQUEsY0FDQSxnQkFBZ0I5TjtBQUFBQSxjQUNoQixzQkFBc0JDO0FBQUFBLGNBQ3RCLGlCQUFpQkgsZ0JBQWdCLFlBQVk2RSx5QkFBeUI7QUFBQSxjQUN0RSxXQUFXN0UsZ0JBQWdCLFlBQVk0RSx1QkFBdUI5QixLQUFLMEM7QUFBQUE7QUFBQUEsWUFWckU7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBLFVBVStFO0FBQUEsVUFJaEZwRixjQUFjLGdCQUFnQkosZ0JBQWdCLGtCQUFrQkEsZ0JBQWdCLGlCQUFpQkEsZ0JBQWdCLGNBQ2hIO0FBQUEsWUFBQztBQUFBO0FBQUEsY0FDQztBQUFBLGNBQ0E7QUFBQSxjQUNBO0FBQUEsY0FDQSxpQkFBaUI4TjtBQUFBQSxjQUNqQjtBQUFBLGNBQ0EsaUJBQWlCOU4sZ0JBQWdCLFlBQVk2RSx5QkFBeUI7QUFBQTtBQUFBLFlBTnhFO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQSxVQU0yRTtBQUFBLFVBSTVFekUsY0FBYyxXQUFXSixnQkFBZ0IsaUJBQ3hDO0FBQUEsWUFBQztBQUFBO0FBQUEsY0FDQztBQUFBLGNBQ0EsV0FBV1E7QUFBQUEsY0FDWCxVQUFVd0Y7QUFBQUE7QUFBQUEsWUFIWjtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUEsVUFHNkI7QUFBQSxVQUk5QjVGLGNBQWMsbUJBQ2I7QUFBQSxZQUFDO0FBQUE7QUFBQSxjQUNDLFVBQVVKO0FBQUFBLGNBQ1Y7QUFBQSxjQUNBO0FBQUEsY0FDQSxvQkFBb0IyTjtBQUFBQSxjQUNwQixpQkFBaUJDO0FBQUFBLGNBQ2pCLG9CQUFvQkM7QUFBQUE7QUFBQUEsWUFOdEI7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBLFVBTTZDO0FBQUEsVUFJOUN6TixjQUFjLG1CQUNiO0FBQUEsWUFBQztBQUFBO0FBQUEsY0FDQztBQUFBLGNBQ0E7QUFBQSxjQUNBO0FBQUEsY0FDQTtBQUFBLGNBQ0E7QUFBQSxjQUNBLGtCQUFrQjBMO0FBQUFBLGNBQ2xCLG9CQUFvQitCO0FBQUFBO0FBQUFBLFlBUHRCO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQSxVQU82QztBQUFBLGFBeEpqRDtBQUFBO0FBQUE7QUFBQTtBQUFBLGVBMkpBO0FBQUEsV0FuTEo7QUFBQTtBQUFBO0FBQUE7QUFBQSxhQXNMQTtBQUFBLFNBellGO0FBQUE7QUFBQTtBQUFBO0FBQUEsV0EyWUE7QUFBQSxPQW5hRjtBQUFBO0FBQUE7QUFBQTtBQUFBLFNBb2FBO0FBRUo7QUFBQ25PLEdBOXFDdUJELEtBQUc7QUFBQSxVQUN3QzlCLE9BQU87QUFBQTtBQUFBLEtBRGxEOEI7QUFBRyxJQUFBME87QUFBQSxhQUFBQSxJQUFBIiwibmFtZXMiOlsidXNlUmVmIiwidXNlU3RhdGUiLCJ1c2VFZmZlY3QiLCJhcGlGZXRjaCIsImdldFVpRXJyb3JNZXNzYWdlIiwic2V0U2ltdWxhdGVkUm9sZSIsImNsZWFyU2ltdWxhdGVkUm9sZSIsImNsZWFyU2ltdWxhdGVkVXNlciIsInNldFNpbXVsYXRlZFVzZXIiLCJmaW5kVGVhY2hlclByb2ZpbGVGcm9tU2ltdWxhdGVkVXNlciIsInVzZUF1dGgiLCJjb3VudE92ZXJkdWVFdmFsdWF0aW9ucyIsImlzRXZhbHVhdGlvbkFyY2hpdmVkIiwiaXNFdmFsdWF0aW9uTG9ja2VkQnlTY2hvb2xBZG1pbiIsImlzRXZhbHVhdGlvbkFyY2hpdmVkRm9yU2Nob29sQWRtaW5CeUFnZSIsIlNpbXVsYXRvckhlYWRlciIsIkxvZ2luVmlldyIsIkRhc2hib2FyZFZpZXciLCJBZG1pblZpZXciLCJFcnJvckJvdW5kYXJ5IiwiQWJzZW5jZVZpZXciLCJOb3Rlc1ZpZXciLCJOb3RpZmljYXRpb25WaWV3IiwiQXVkaXRWaWV3IiwiTW9iaWxlUGFyZW50VmlldyIsIlBhcmVudE5vdGVzVmlldyIsIkFyY2hpdmVWaWV3IiwiQnVsbGV0aW5zVmlldyIsIkdsb2JhbEVycm9yVG9hc3QiLCJMYXlvdXREYXNoYm9hcmQiLCJCdWlsZGluZzIiLCJDYWxlbmRhckRheXMiLCJBd2FyZCIsIkJlbGwiLCJTbWFydHBob25lIiwiSW5mbyIsIkJvb2tPcGVuIiwiRmlsZVRleHQiLCJSZWZyZXNoQ3ciLCJBbGVydENpcmNsZSIsIkFwcCIsIl9zIiwidXNlciIsImF1dGhlbnRpY2F0ZWRVc2VyIiwidG9rZW4iLCJyb2xlIiwiYWN0aXZlU2Nob29sSWQiLCJjdXJyZW50Um9sZSIsImN1cnJlbnRTY2hvb2xJZCIsInN1cGVyQWRtaW5TY2hvb2xGaWx0ZXJJZCIsInNldFN1cGVyQWRtaW5TY2hvb2xGaWx0ZXJJZCIsImFjdGl2ZVRhYiIsInNldEFjdGl2ZVRhYiIsImlzU3luY2luZyIsInNldElzU3luY2luZyIsImlzQXVkaXRMb2FkaW5nIiwic2V0SXNBdWRpdExvYWRpbmciLCJpbXBvcnRSZXN1bHQiLCJzZXRJbXBvcnRSZXN1bHQiLCJlcnJvck1zZyIsInNldEVycm9yTXNnIiwic3RhdHMiLCJzZXRTdGF0cyIsInRvdGFsU3R1ZGVudHMiLCJ0b3RhbEFic2VuY2VzIiwidG90YWxDbGFzc2VzIiwidG90YWxUZWFjaGVycyIsImF0dGVuZGFuY2VSYXRlIiwiY2hhcnREYXRhIiwic2V0Q2hhcnREYXRhIiwic2Nob29sc0xpc3QiLCJzZXRTY2hvb2xzTGlzdCIsInllYXJzTGlzdCIsInNldFllYXJzTGlzdCIsImNsYXNzZXNMaXN0Iiwic2V0Q2xhc3Nlc0xpc3QiLCJ0ZWFjaGVyc0xpc3QiLCJzZXRUZWFjaGVyc0xpc3QiLCJzdHVkZW50c0xpc3QiLCJzZXRTdHVkZW50c0xpc3QiLCJwYXJlbnRzTGlzdCIsInNldFBhcmVudHNMaXN0IiwibG9nVGVhY2hlcnNQYXlsb2FkIiwicHJlZml4IiwicGF5bG9hZCIsIkFycmF5IiwiaXNBcnJheSIsImNvbnNvbGUiLCJsb2ciLCJsZW5ndGgiLCJmb3JFYWNoIiwidGVhY2hlciIsImluZGV4IiwiaWQiLCJ1aWQiLCJlbWFpbCIsImNsYXNzSWRzIiwiYWJzZW5jZXNMaXN0Iiwic2V0QWJzZW5jZXNMaXN0Iiwic3VtbWFyeVJlY2VudEFic2VuY2VzIiwic2V0U3VtbWFyeVJlY2VudEFic2VuY2VzIiwidW5qdXN0aWZpZWRBYnNlbmNlc0NvdW50IiwiZmlsdGVyIiwiYWJzZW5jZSIsImlzSnVzdGlmaWVkIiwiZXZhbHVhdGlvbnNMaXN0Iiwic2V0RXZhbHVhdGlvbnNMaXN0IiwiZ3JhZGVzTGlzdCIsInNldEdyYWRlc0xpc3QiLCJzdW1tYXJ5UmVjZW50R3JhZGVzIiwic2V0U3VtbWFyeVJlY2VudEdyYWRlcyIsIm5vdGlmaWNhdGlvbnNMaXN0Iiwic2V0Tm90aWZpY2F0aW9uc0xpc3QiLCJhdWRpdEV2ZW50cyIsInNldEF1ZGl0RXZlbnRzIiwidXNlcnNMaXN0Iiwic2V0VXNlcnNMaXN0Iiwic3ViamVjdHNMaXN0Iiwic2V0U3ViamVjdHNMaXN0IiwiYXBwcm92ZWRTdWJqZWN0c0xpc3QiLCJzZXRBcHByb3ZlZFN1YmplY3RzTGlzdCIsInByb2Nlc3NlZE5vdGlmaWNhdGlvbklkc1JlZiIsIlNldCIsImN1cnJlbnRUZWFjaGVyUHJvZmlsZSIsImN1cnJlbnRUZWFjaGVyQ2xhc3NJZHMiLCJjdXJyZW50VGVhY2hlclNwZWNpYWxpemF0aW9ucyIsInNwZWNpYWxpemF0aW9uIiwiU3RyaW5nIiwic3BsaXQiLCJtYXAiLCJpdGVtIiwidHJpbSIsIkJvb2xlYW4iLCJ2aXNpYmxlRXJyb3JNc2ciLCJub3RlT3ZlcmR1ZUNvdW50IiwidW5kZWZpbmVkIiwibm9ybWFsaXplU3R1ZGVudHNQYXlsb2FkIiwicmVjb3JkIiwibWF5YmVTdHVkZW50cyIsInN0dWRlbnRzIiwibWF5YmVEYXRhIiwiZGF0YSIsIm5lc3RlZFN0dWRlbnRzIiwiZmV0Y2hBdWRpdEV2ZW50cyIsImV2ZW50cyIsImF1ZGl0RXJyIiwid2FybiIsImZldGNoQWxsRGF0YSIsInNob3dTcGlubmVyIiwibWV0aG9kIiwiY2F0Y2giLCJlcnIiLCJ1aU1lc3NhZ2UiLCJzdW1tYXJ5IiwicmVjZW50R3JhZGVzIiwicmVjZW50QWJzZW5jZXMiLCJlbmRwb2ludHMiLCJwcm9taXNlcyIsImUiLCJfX2Vycm9yIiwiZXJyb3IiLCJyZXN1bHRzIiwiUHJvbWlzZSIsImFsbCIsIk9iamVjdCIsImZyb21FbnRyaWVzIiwiaSIsImluZGV4T2YiLCJyYXdTdHVkZW50c1BheWxvYWQiLCJub3JtYWxpemVkU3R1ZGVudHMiLCJzY2hvb2xJZCIsImVuZHBvaW50IiwibmV3Tm90aWZzIiwibm90aWYiLCJjdXJyZW50IiwiaGFzIiwiaGFzQWJzZW5jZSIsInNvbWUiLCJ0eXBlIiwiaGFzR3JhZGUiLCJhZGQiLCJoYW5kbGVSb2xlQ2hhbmdlIiwibmV3Um9sZSIsIndpbmRvdyIsImhpc3RvcnkiLCJyZXBsYWNlU3RhdGUiLCJleGlzdGluZ1NpbVVzZXIiLCJwcmVmZXJyZWQiLCJmaW5kIiwidCIsInVzZXJJZCIsIm5hbWUiLCJEYXRlIiwibm93IiwiaGFuZGxlTG9nb3V0IiwibG9jYXRpb24iLCJyZXBsYWNlIiwiaGFuZGxlQWRkU2Nob29sIiwiY3JlYXRlZFNjaG9vbCIsImJvZHkiLCJKU09OIiwic3RyaW5naWZ5IiwibWVzc2FnZSIsImhhbmRsZUFkZFllYXIiLCJoYW5kbGVTZXRBY3RpdmVZZWFyIiwieWVhcklkIiwiaGFuZGxlRGVsZXRlWWVhciIsImhhbmRsZUFkZENsYXNzIiwiaGFuZGxlRGVsZXRlQ2xhc3MiLCJoYW5kbGVBcHByb3ZlQ2xhc3MiLCJFcnJvciIsInByZXYiLCJjIiwic3RhdHVzIiwiaGFuZGxlUmVqZWN0Q2xhc3MiLCJoYW5kbGVEZWxldGVTY2hvb2wiLCJpbmNsdWRlcyIsImhhbmRsZVVwZGF0ZVNjaG9vbCIsImhhbmRsZVVwZGF0ZVN0dWRlbnQiLCJoYW5kbGVBZGRUZWFjaGVyIiwiY3JlYXRlZCIsImhhbmRsZUFkZFBhcmVudCIsInBhcmVudHMiLCJoYW5kbGVBZGRTdHVkZW50IiwiaGFuZGxlQmF0Y2hDcmVhdGVTdHVkZW50cyIsInJlY29yZHMiLCJqc29uIiwiaW5zZXJ0ZWRDb3VudCIsImhhbmRsZUJhdGNoQ3JlYXRlUGFyZW50cyIsImhhbmRsZUNyZWF0ZVVzZXIiLCJ1c2VyRnJpZW5kbHlNZXNzYWdlIiwidGVzdCIsImhhbmRsZVVwZGF0ZVVzZXIiLCJoYW5kbGVTZXRQYXNzd29yZCIsInBhc3N3b3JkIiwiaGFuZGxlRGVsZXRlVXNlciIsImhhbmRsZUFkZEFic2VuY2UiLCJoYW5kbGVKdXN0aWZ5QWJzZW5jZSIsInJlYXNvbiIsImp1c3RpZmljYXRpb25SZWFzb24iLCJoYW5kbGVBZGRFdmFsdWF0aW9uIiwiZGVidWciLCJyZWZyZXNoQXBwcm92ZWRTdWJqZWN0cyIsImFwcHJvdmVkIiwiaGFuZGxlQWRkR3JhZGUiLCJjcmVhdGVkT3JVcGRhdGVkR3JhZGUiLCJleGlzdGluZ0luZGV4IiwiZmluZEluZGV4IiwiZyIsImV2YWx1YXRpb25JZCIsInN0dWRlbnRJZCIsImdyYWRlRW50cnkiLCJzY29yZSIsInJlbWFya3MiLCJlZGl0Q291bnQiLCJldmFsdWF0aW9uVGl0bGUiLCJzdWJqZWN0IiwibmV4dCIsImhhbmRsZUFkZFN1YmplY3QiLCJjcmVhdGVkU3ViamVjdCIsImhhbmRsZVVwZGF0ZVN1YmplY3QiLCJ1cGRhdGVkU3ViamVjdCIsInMiLCJoYW5kbGVEZWxldGVTdWJqZWN0IiwiaGFuZGxlQXBwcm92ZVN1YmplY3QiLCJoYW5kbGVSZWplY3RTdWJqZWN0IiwiaGFuZGxlU2VuZE5vdGlmaWNhdGlvbiIsImhhbmRsZU1hcmtBbGxBc1JlYWQiLCJoYW5kbGVOb3RpZmljYXRpb25SZWFkIiwiYWN0aXZlRXZhbHVhdGlvbnMiLCJldiIsImFyY2hpdmVkRXZhbHVhdGlvbnMiLCJuIiwiaXNSZWFkIiwiX2MiXSwiaWdub3JlTGlzdCI6W10sInNvdXJjZXMiOlsiQXBwLnRzeCJdLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgUmVhY3QsIHsgdXNlUmVmLCB1c2VTdGF0ZSwgdXNlRWZmZWN0IH0gZnJvbSAncmVhY3QnO1xyXG5pbXBvcnQge1xyXG4gIFNjaG9vbCxcclxuICBBY2FkZW1pY1llYXIsXHJcbiAgQ2xhc3MsXHJcbiAgVGVhY2hlcixcclxuICBTdHVkZW50LFxyXG4gIFBhcmVudCxcclxuICBTeXN0ZW1Ob3RpZmljYXRpb24sXHJcbiAgVXNlcixcclxuICBVc2VyUm9sZSxcclxuICBBdWRpdEV2ZW50XHJcbn0gZnJvbSAnLi90eXBlcy50cyc7XHJcbmltcG9ydCB7XHJcbiAgYXBpRmV0Y2gsXHJcbiAgZ2V0VWlFcnJvck1lc3NhZ2UsXHJcbiAgc2V0U2ltdWxhdGVkUm9sZSxcclxuICBjbGVhclNpbXVsYXRlZFJvbGUsXHJcbiAgY2xlYXJTaW11bGF0ZWRVc2VyLFxyXG4gIHNldFNpbXVsYXRlZFVzZXIsXHJcbiAgZmluZFRlYWNoZXJQcm9maWxlRnJvbVNpbXVsYXRlZFVzZXIsXHJcbn0gZnJvbSAnLi9saWIvYXBpLnRzJztcclxuaW1wb3J0IHsgdXNlQXV0aCB9IGZyb20gJy4vY29udGV4dHMvQXV0aENvbnRleHQudHN4JztcclxuaW1wb3J0IHsgY291bnRPdmVyZHVlRXZhbHVhdGlvbnMsIGlzRXZhbHVhdGlvbkFyY2hpdmVkLCBpc0V2YWx1YXRpb25Mb2NrZWRCeVNjaG9vbEFkbWluLCBpc0V2YWx1YXRpb25BcmNoaXZlZEZvclNjaG9vbEFkbWluQnlBZ2UgfSBmcm9tICcuL2xpYi9ldmFsdWF0aW9uVXRpbHMudHMnO1xyXG5pbXBvcnQgU2ltdWxhdG9ySGVhZGVyIGZyb20gJy4vY29tcG9uZW50cy9TaW11bGF0b3JIZWFkZXIudHN4JztcclxuaW1wb3J0IExvZ2luVmlldyBmcm9tICcuL2NvbXBvbmVudHMvTG9naW5WaWV3LnRzeCc7XHJcbmltcG9ydCBEYXNoYm9hcmRWaWV3IGZyb20gJy4vY29tcG9uZW50cy9EYXNoYm9hcmRWaWV3LnRzeCc7XHJcbmltcG9ydCBBZG1pblZpZXcgZnJvbSAnLi9jb21wb25lbnRzL0FkbWluVmlldy50c3gnO1xyXG5pbXBvcnQgRXJyb3JCb3VuZGFyeSBmcm9tICcuL2NvbXBvbmVudHMvRXJyb3JCb3VuZGFyeS50c3gnO1xyXG5pbXBvcnQgQWJzZW5jZVZpZXcgZnJvbSAnLi9jb21wb25lbnRzL0Fic2VuY2VWaWV3LnRzeCc7XHJcbmltcG9ydCBOb3Rlc1ZpZXcgZnJvbSAnLi9jb21wb25lbnRzL05vdGVzVmlldy50c3gnO1xyXG5pbXBvcnQgTm90aWZpY2F0aW9uVmlldyBmcm9tICcuL2NvbXBvbmVudHMvTm90aWZpY2F0aW9uVmlldy50c3gnO1xyXG5pbXBvcnQgQXVkaXRWaWV3IGZyb20gJy4vY29tcG9uZW50cy9BdWRpdFZpZXcudHN4JztcclxuaW1wb3J0IE1vYmlsZVBhcmVudFZpZXcgZnJvbSAnLi9jb21wb25lbnRzL01vYmlsZVBhcmVudFZpZXcudHN4JztcclxuaW1wb3J0IFBhcmVudE5vdGVzVmlldyBmcm9tICcuL2NvbXBvbmVudHMvUGFyZW50Tm90ZXNWaWV3LnRzeCc7XHJcbmltcG9ydCBBcmNoaXZlVmlldyBmcm9tICcuL2NvbXBvbmVudHMvQXJjaGl2ZVZpZXcudHN4JztcclxuaW1wb3J0IEJ1bGxldGluc1ZpZXcgZnJvbSAnLi9jb21wb25lbnRzL0J1bGxldGluc1ZpZXcudHN4JztcclxuaW1wb3J0IEdsb2JhbEVycm9yVG9hc3QgZnJvbSAnLi9jb21wb25lbnRzL0dsb2JhbEVycm9yVG9hc3QudHN4JztcclxuXHJcbmltcG9ydCB7XHJcbiAgTGF5b3V0RGFzaGJvYXJkLFxyXG4gIEJ1aWxkaW5nMixcclxuICBDYWxlbmRhckRheXMsXHJcbiAgQXdhcmQsXHJcbiAgQmVsbCxcclxuICBTbWFydHBob25lLFxyXG4gIEluZm8sXHJcbiAgQm9va09wZW4sXHJcbiAgRmlsZVRleHQsXHJcbiAgTG9nT3V0LFxyXG4gIFJlZnJlc2hDdyxcclxuICBBbGVydENpcmNsZVxyXG59IGZyb20gJ2x1Y2lkZS1yZWFjdCc7XHJcblxyXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbiBBcHAoKSB7XHJcbiAgY29uc3QgeyB1c2VyOiBhdXRoZW50aWNhdGVkVXNlciwgdG9rZW4sIHJvbGUsIGFjdGl2ZVNjaG9vbElkIH0gPSB1c2VBdXRoKCk7XHJcbiAgY29uc3QgY3VycmVudFJvbGUgPSByb2xlIGFzIFVzZXJSb2xlO1xyXG4gIGNvbnN0IGN1cnJlbnRTY2hvb2xJZCA9IGFjdGl2ZVNjaG9vbElkO1xyXG4gIGNvbnN0IFtzdXBlckFkbWluU2Nob29sRmlsdGVySWQsIHNldFN1cGVyQWRtaW5TY2hvb2xGaWx0ZXJJZF0gPSB1c2VTdGF0ZTxudW1iZXIgfCBudWxsPihudWxsKTtcclxuICBjb25zdCBbYWN0aXZlVGFiLCBzZXRBY3RpdmVUYWJdID0gdXNlU3RhdGUoJ3RhYmxlYXUtZGUtYm9yZCcpO1xyXG4gIGNvbnN0IFtpc1N5bmNpbmcsIHNldElzU3luY2luZ10gPSB1c2VTdGF0ZShmYWxzZSk7XHJcbiAgY29uc3QgW2lzQXVkaXRMb2FkaW5nLCBzZXRJc0F1ZGl0TG9hZGluZ10gPSB1c2VTdGF0ZShmYWxzZSk7XHJcbiAgY29uc3QgW2ltcG9ydFJlc3VsdCwgc2V0SW1wb3J0UmVzdWx0XSA9IHVzZVN0YXRlPGFueSB8IG51bGw+KG51bGwpO1xyXG4gIGNvbnN0IFtlcnJvck1zZywgc2V0RXJyb3JNc2ddID0gdXNlU3RhdGU8c3RyaW5nIHwgbnVsbD4obnVsbCk7XHJcblxyXG4gIC8vIFN0YXRlcyBsb2FkZWQgZnJvbSBiYWNrZW5kXHJcbiAgY29uc3QgW3N0YXRzLCBzZXRTdGF0c10gPSB1c2VTdGF0ZSh7XHJcbiAgICB0b3RhbFN0dWRlbnRzOiAwLFxyXG4gICAgdG90YWxBYnNlbmNlczogMCxcclxuICAgIHRvdGFsQ2xhc3NlczogMCxcclxuICAgIHRvdGFsVGVhY2hlcnM6IDAsXHJcbiAgICBhdHRlbmRhbmNlUmF0ZTogOTQuNSxcclxuICB9KTtcclxuICBjb25zdCBbY2hhcnREYXRhLCBzZXRDaGFydERhdGFdID0gdXNlU3RhdGU8QXJyYXk8eyBuYW1lOiBzdHJpbmc7IHRhdXg6IG51bWJlciB9Pj4oW10pO1xyXG4gIGNvbnN0IFtzY2hvb2xzTGlzdCwgc2V0U2Nob29sc0xpc3RdID0gdXNlU3RhdGU8U2Nob29sW10+KFtdKTtcclxuICBjb25zdCBbeWVhcnNMaXN0LCBzZXRZZWFyc0xpc3RdID0gdXNlU3RhdGU8QWNhZGVtaWNZZWFyW10+KFtdKTtcclxuICBjb25zdCBbY2xhc3Nlc0xpc3QsIHNldENsYXNzZXNMaXN0XSA9IHVzZVN0YXRlPENsYXNzW10+KFtdKTtcclxuICBjb25zdCBbdGVhY2hlcnNMaXN0LCBzZXRUZWFjaGVyc0xpc3RdID0gdXNlU3RhdGU8VGVhY2hlcltdPihbXSk7XHJcbiAgY29uc3QgW3N0dWRlbnRzTGlzdCwgc2V0U3R1ZGVudHNMaXN0XSA9IHVzZVN0YXRlPFN0dWRlbnRbXT4oW10pO1xyXG4gIGNvbnN0IFtwYXJlbnRzTGlzdCwgc2V0UGFyZW50c0xpc3RdID0gdXNlU3RhdGU8UGFyZW50W10+KFtdKTtcclxuXHJcbiAgY29uc3QgbG9nVGVhY2hlcnNQYXlsb2FkID0gKHByZWZpeDogc3RyaW5nLCBwYXlsb2FkOiB1bmtub3duKSA9PiB7XHJcbiAgICBpZiAoIUFycmF5LmlzQXJyYXkocGF5bG9hZCkpIHtcclxuICAgICAgY29uc29sZS5sb2coYCR7cHJlZml4fSBwYXlsb2FkIGlzIG5vdCBhbiBhcnJheTpgLCBwYXlsb2FkKTtcclxuICAgICAgcmV0dXJuO1xyXG4gICAgfVxyXG4gICAgY29uc29sZS5sb2coYCR7cHJlZml4fSBsZW5ndGg9JHtwYXlsb2FkLmxlbmd0aH1gKTtcclxuICAgIHBheWxvYWQuZm9yRWFjaCgodGVhY2hlcjogYW55LCBpbmRleDogbnVtYmVyKSA9PiB7XHJcbiAgICAgIGNvbnNvbGUubG9nKGAke3ByZWZpeH0gWyR7aW5kZXh9XWAsIHtcclxuICAgICAgICBpZDogdGVhY2hlcj8uaWQsXHJcbiAgICAgICAgdWlkOiB0ZWFjaGVyPy51aWQsXHJcbiAgICAgICAgZW1haWw6IHRlYWNoZXI/LmVtYWlsLFxyXG4gICAgICAgIGNsYXNzSWRzOiB0ZWFjaGVyPy5jbGFzc0lkcyxcclxuICAgICAgfSk7XHJcbiAgICB9KTtcclxuICB9O1xyXG4gIGNvbnN0IFthYnNlbmNlc0xpc3QsIHNldEFic2VuY2VzTGlzdF0gPSB1c2VTdGF0ZTxhbnlbXT4oW10pO1xyXG4gIGNvbnN0IFtzdW1tYXJ5UmVjZW50QWJzZW5jZXMsIHNldFN1bW1hcnlSZWNlbnRBYnNlbmNlc10gPSB1c2VTdGF0ZTxhbnlbXT4oW10pO1xyXG4gIGNvbnN0IHVuanVzdGlmaWVkQWJzZW5jZXNDb3VudCA9IGFic2VuY2VzTGlzdC5maWx0ZXIoKGFic2VuY2U6IGFueSkgPT4gIWFic2VuY2UuaXNKdXN0aWZpZWQpLmxlbmd0aDtcclxuICBjb25zdCBbZXZhbHVhdGlvbnNMaXN0LCBzZXRFdmFsdWF0aW9uc0xpc3RdID0gdXNlU3RhdGU8YW55W10+KFtdKTtcclxuICBjb25zdCBbZ3JhZGVzTGlzdCwgc2V0R3JhZGVzTGlzdF0gPSB1c2VTdGF0ZTxhbnlbXT4oW10pO1xyXG4gIGNvbnN0IFtzdW1tYXJ5UmVjZW50R3JhZGVzLCBzZXRTdW1tYXJ5UmVjZW50R3JhZGVzXSA9IHVzZVN0YXRlPGFueVtdPihbXSk7XHJcbiAgY29uc3QgW25vdGlmaWNhdGlvbnNMaXN0LCBzZXROb3RpZmljYXRpb25zTGlzdF0gPSB1c2VTdGF0ZTxTeXN0ZW1Ob3RpZmljYXRpb25bXT4oW10pO1xyXG4gIGNvbnN0IFthdWRpdEV2ZW50cywgc2V0QXVkaXRFdmVudHNdID0gdXNlU3RhdGU8QXVkaXRFdmVudFtdPihbXSk7XHJcbiAgY29uc3QgW3VzZXJzTGlzdCwgc2V0VXNlcnNMaXN0XSA9IHVzZVN0YXRlPFVzZXJbXT4oW10pO1xyXG4gIGNvbnN0IFtzdWJqZWN0c0xpc3QsIHNldFN1YmplY3RzTGlzdF0gPSB1c2VTdGF0ZTxhbnlbXT4oW10pO1xyXG4gIGNvbnN0IFthcHByb3ZlZFN1YmplY3RzTGlzdCwgc2V0QXBwcm92ZWRTdWJqZWN0c0xpc3RdID0gdXNlU3RhdGU8YW55W10+KFtdKTtcclxuICBjb25zdCBwcm9jZXNzZWROb3RpZmljYXRpb25JZHNSZWYgPSB1c2VSZWY8U2V0PG51bWJlcj4+KG5ldyBTZXQoKSk7XHJcblxyXG4gIGNvbnN0IGN1cnJlbnRUZWFjaGVyUHJvZmlsZSA9IGZpbmRUZWFjaGVyUHJvZmlsZUZyb21TaW11bGF0ZWRVc2VyKGN1cnJlbnRSb2xlLCBhdXRoZW50aWNhdGVkVXNlciwgdGVhY2hlcnNMaXN0LCB1c2Vyc0xpc3QpO1xyXG5cclxuICBjb25zdCBjdXJyZW50VGVhY2hlckNsYXNzSWRzID0gY3VycmVudFRlYWNoZXJQcm9maWxlPy5jbGFzc0lkcyB8fCBbXTtcclxuICBjb25zdCBjdXJyZW50VGVhY2hlclNwZWNpYWxpemF0aW9ucyA9IGN1cnJlbnRUZWFjaGVyUHJvZmlsZT8uc3BlY2lhbGl6YXRpb25cclxuICAgID8gQXJyYXkuaXNBcnJheShjdXJyZW50VGVhY2hlclByb2ZpbGUuc3BlY2lhbGl6YXRpb24pXHJcbiAgICAgID8gY3VycmVudFRlYWNoZXJQcm9maWxlLnNwZWNpYWxpemF0aW9uXHJcbiAgICAgIDogU3RyaW5nKGN1cnJlbnRUZWFjaGVyUHJvZmlsZS5zcGVjaWFsaXphdGlvbilcclxuICAgICAgICAgIC5zcGxpdCgvWyw7JnxcXC9cXCtdLylcclxuICAgICAgICAgIC5tYXAoKGl0ZW0pID0+IGl0ZW0udHJpbSgpKVxyXG4gICAgICAgICAgLmZpbHRlcihCb29sZWFuKVxyXG4gICAgOiBbXTtcclxuICBjb25zdCB2aXNpYmxlRXJyb3JNc2cgPSBnZXRVaUVycm9yTWVzc2FnZShlcnJvck1zZyk7XHJcblxyXG4gIGNvbnN0IG5vdGVPdmVyZHVlQ291bnQgPSBjdXJyZW50Um9sZSA9PT0gJ3RlYWNoZXInIHx8IGN1cnJlbnRSb2xlID09PSAnc2Nob29sX2FkbWluJyB8fCBjdXJyZW50Um9sZSA9PT0gJ3N1cGVyX2FkbWluJ1xyXG4gICAgPyBjb3VudE92ZXJkdWVFdmFsdWF0aW9ucyhcclxuICAgICAgZXZhbHVhdGlvbnNMaXN0LFxyXG4gICAgICBzdHVkZW50c0xpc3QsXHJcbiAgICAgIGdyYWRlc0xpc3QsXHJcbiAgICAgIGN1cnJlbnRSb2xlIGFzIFVzZXJSb2xlLFxyXG4gICAgICBjdXJyZW50Um9sZSA9PT0gJ3RlYWNoZXInID8gY3VycmVudFRlYWNoZXJQcm9maWxlPy5pZCA6IHVuZGVmaW5lZCxcclxuICAgIClcclxuICAgIDogMDtcclxuXHJcbiAgY29uc3Qgbm9ybWFsaXplU3R1ZGVudHNQYXlsb2FkID0gKHBheWxvYWQ6IHVua25vd24pOiBTdHVkZW50W10gPT4ge1xyXG4gICAgaWYgKEFycmF5LmlzQXJyYXkocGF5bG9hZCkpIHJldHVybiBwYXlsb2FkIGFzIFN0dWRlbnRbXTtcclxuXHJcbiAgICBpZiAocGF5bG9hZCAmJiB0eXBlb2YgcGF5bG9hZCA9PT0gJ29iamVjdCcpIHtcclxuICAgICAgY29uc3QgcmVjb3JkID0gcGF5bG9hZCBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPjtcclxuICAgICAgY29uc3QgbWF5YmVTdHVkZW50cyA9IHJlY29yZC5zdHVkZW50cztcclxuICAgICAgaWYgKEFycmF5LmlzQXJyYXkobWF5YmVTdHVkZW50cykpIHJldHVybiBtYXliZVN0dWRlbnRzIGFzIFN0dWRlbnRbXTtcclxuXHJcbiAgICAgIGNvbnN0IG1heWJlRGF0YSA9IHJlY29yZC5kYXRhO1xyXG4gICAgICBpZiAoQXJyYXkuaXNBcnJheShtYXliZURhdGEpKSByZXR1cm4gbWF5YmVEYXRhIGFzIFN0dWRlbnRbXTtcclxuICAgICAgaWYgKG1heWJlRGF0YSAmJiB0eXBlb2YgbWF5YmVEYXRhID09PSAnb2JqZWN0Jykge1xyXG4gICAgICAgIGNvbnN0IG5lc3RlZFN0dWRlbnRzID0gKG1heWJlRGF0YSBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPikuc3R1ZGVudHM7XHJcbiAgICAgICAgaWYgKEFycmF5LmlzQXJyYXkobmVzdGVkU3R1ZGVudHMpKSByZXR1cm4gbmVzdGVkU3R1ZGVudHMgYXMgU3R1ZGVudFtdO1xyXG4gICAgICB9XHJcbiAgICB9XHJcblxyXG4gICAgcmV0dXJuIFtdO1xyXG4gIH07XHJcblxyXG4gIGNvbnN0IGZldGNoQXVkaXRFdmVudHMgPSBhc3luYyAoKSA9PiB7XHJcbiAgICBpZiAoY3VycmVudFJvbGUgIT09ICdzdXBlcl9hZG1pbicpIHtcclxuICAgICAgc2V0QXVkaXRFdmVudHMoW10pO1xyXG4gICAgICByZXR1cm47XHJcbiAgICB9XHJcblxyXG4gICAgc2V0SXNBdWRpdExvYWRpbmcodHJ1ZSk7XHJcbiAgICB0cnkge1xyXG4gICAgICBjb25zdCBldmVudHMgPSBhd2FpdCBhcGlGZXRjaCgnL2FwaS9hdWRpdC9ldmVudHMnKTtcclxuICAgICAgc2V0QXVkaXRFdmVudHMoZXZlbnRzKTtcclxuICAgIH0gY2F0Y2ggKGF1ZGl0RXJyOiBhbnkpIHtcclxuICAgICAgY29uc29sZS53YXJuKCdJbXBvc3NpYmxlIGRlIGNoYXJnZXIgbGUgam91cm5hbCBkXFwnw6l2w6luZW1lbnRzIDonLCBhdWRpdEVycik7XHJcbiAgICAgIHNldEF1ZGl0RXZlbnRzKFtdKTtcclxuICAgICAgc2V0RXJyb3JNc2coJ0ltcG9zc2libGUgZGUgY2hhcmdlciBsZSBqb3VybmFsIGRlcyBhY3Rpb25zLicpO1xyXG4gICAgfSBmaW5hbGx5IHtcclxuICAgICAgc2V0SXNBdWRpdExvYWRpbmcoZmFsc2UpO1xyXG4gICAgfVxyXG4gIH07XHJcblxyXG4gIC8vIEF1dGhlbnRpY2F0ZSAmIEZldGNoIGRhdGEgb24gbG9hZCBhbmQgd2hlbmV2ZXIgc2ltdWxhdGlvbiByb2xlIGNoYW5nZXNcclxuICBjb25zdCBmZXRjaEFsbERhdGEgPSBhc3luYyAoc2hvd1NwaW5uZXIgPSB0cnVlKSA9PiB7XHJcbiAgICBpZiAoc2hvd1NwaW5uZXIpIHNldElzU3luY2luZyh0cnVlKTtcclxuICAgIHNldEVycm9yTXNnKG51bGwpO1xyXG4gICAgdHJ5IHtcclxuICAgICAgLy8gMS4gU3luYyBhdXRoZW50aWNhdGlvbiByb2xlIHN3aXRjaGVyIGNvbnRleHRcclxuICAgICAgYXdhaXQgYXBpRmV0Y2goJy9hcGkvYXV0aC9yZWdpc3Rlci1vci1sb2dpbicsIHsgbWV0aG9kOiAnUE9TVCcgfSkuY2F0Y2goKGVycikgPT4ge1xyXG4gICAgICAgIGNvbnN0IHVpTWVzc2FnZSA9IGdldFVpRXJyb3JNZXNzYWdlKGVycik7XHJcbiAgICAgICAgaWYgKHVpTWVzc2FnZSkge1xyXG4gICAgICAgICAgY29uc29sZS53YXJuKCdBdXRoIHN5bmMgd2FybmluZyBpZ25vcmVkIGluIFVJOicsIGVycik7XHJcbiAgICAgICAgfVxyXG4gICAgICB9KTtcclxuXHJcbiAgICAgIC8vIDIuIExvYWQgZGFzaGJvYXJkIHN1bW1hcnkgJiByb2xlIGRldGFpbHNcclxuICAgICAgY29uc3Qgc3VtbWFyeSA9IGF3YWl0IGFwaUZldGNoKCcvYXBpL2Rhc2hib2FyZC9zdW1tYXJ5Jyk7XHJcbiAgICAgIGNvbnNvbGUubG9nKCdSQVcgQVBJIFJFU1BPTlNFIERBU0hCT0FSRDonLCBzdW1tYXJ5KTtcclxuICAgICAgY29uc29sZS5sb2coJ2NoYXJ0RGF0YSByZcOndTonLCAoc3VtbWFyeSBhcyBhbnkpPy5jaGFydERhdGEpO1xyXG4gICAgICBpZiAoc3VtbWFyeSAmJiB0eXBlb2Ygc3VtbWFyeSA9PT0gJ29iamVjdCcpIHtcclxuICAgICAgICBpZiAoJ3N0YXRzJyBpbiBzdW1tYXJ5KSBzZXRTdGF0cyhzdW1tYXJ5LnN0YXRzKTtcclxuICAgICAgICBpZiAoJ3JlY2VudEdyYWRlcycgaW4gc3VtbWFyeSkgc2V0U3VtbWFyeVJlY2VudEdyYWRlcyhzdW1tYXJ5LnJlY2VudEdyYWRlcyk7XHJcbiAgICAgICAgaWYgKCdyZWNlbnRBYnNlbmNlcycgaW4gc3VtbWFyeSkge1xyXG4gICAgICAgICAgc2V0U3VtbWFyeVJlY2VudEFic2VuY2VzKHN1bW1hcnkucmVjZW50QWJzZW5jZXMpO1xyXG4gICAgICAgICAgc2V0QWJzZW5jZXNMaXN0KHN1bW1hcnkucmVjZW50QWJzZW5jZXMpO1xyXG4gICAgICAgIH1cclxuICAgICAgICBpZiAoQXJyYXkuaXNBcnJheSgoc3VtbWFyeSBhcyBhbnkpLmNoYXJ0RGF0YSkpIHtcclxuICAgICAgICAgIHNldENoYXJ0RGF0YSgoc3VtbWFyeSBhcyBhbnkpLmNoYXJ0RGF0YSk7XHJcbiAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgIHNldENoYXJ0RGF0YShbXSk7XHJcbiAgICAgICAgfVxyXG4gICAgICB9XHJcblxyXG4gICAgICAvLyAzLiBMb2FkIG90aGVyIGxpc3RzIGZvciBDUlVEIGFuZCBtYW5hZ2VtZW50IHRhYnNcclxuICAgICAgY29uc3QgZW5kcG9pbnRzID0gW1xyXG4gICAgICAgICcvYXBpL3NjaG9vbHMnLFxyXG4gICAgICAgICcvYXBpL2FjYWRlbWljLXllYXJzJyxcclxuICAgICAgICAnL2FwaS9jbGFzc2VzJyxcclxuICAgICAgICAnL2FwaS90ZWFjaGVycycsXHJcbiAgICAgICAgJy9hcGkvc3R1ZGVudHMnLFxyXG4gICAgICAgICcvYXBpL3BhcmVudHMnLFxyXG4gICAgICAgICcvYXBpL2Fic2VuY2VzJyxcclxuICAgICAgICAnL2FwaS9ldmFsdWF0aW9ucycsXHJcbiAgICAgICAgJy9hcGkvZ3JhZGVzJyxcclxuICAgICAgICAnL2FwaS9ub3RpZmljYXRpb25zJyxcclxuICAgICAgICAnL2FwaS9zdWJqZWN0cycsXHJcbiAgICAgICAgJy9hcGkvc3ViamVjdHM/YXBwcm92ZWRPbmx5PXRydWUnLFxyXG4gICAgICAgICcvYXBpL3NpbXVsYXRpb24vdXNlcnMnLFxyXG4gICAgICBdO1xyXG5cclxuICAgICAgY29uc3QgcHJvbWlzZXMgPSBlbmRwb2ludHMubWFwKGUgPT4gYXBpRmV0Y2goZSkuY2F0Y2goKGVycikgPT4gKHsgX19lcnJvcjogdHJ1ZSwgZXJyb3I6IGVyciB9KSkpO1xyXG4gICAgICBjb25zdCByZXN1bHRzID0gYXdhaXQgUHJvbWlzZS5hbGwocHJvbWlzZXMpO1xyXG5cclxuICAgICAgY29uc3QgbWFwID0gT2JqZWN0LmZyb21FbnRyaWVzKGVuZHBvaW50cy5tYXAoKGUsIGkpID0+IFtlLCByZXN1bHRzW2ldXSkpO1xyXG4gICAgICBsb2dUZWFjaGVyc1BheWxvYWQoJ1JBV19BUElfUkVTUE9OU0VfL2FwaS90ZWFjaGVycycsIHJlc3VsdHNbZW5kcG9pbnRzLmluZGV4T2YoJy9hcGkvdGVhY2hlcnMnKV0pO1xyXG4gICAgICBsb2dUZWFjaGVyc1BheWxvYWQoJ01BUF8vYXBpL3RlYWNoZXJzJywgbWFwWycvYXBpL3RlYWNoZXJzJ10pO1xyXG4gICAgICBpZiAoQXJyYXkuaXNBcnJheShtYXBbJy9hcGkvdGVhY2hlcnMnXSkpIHtcclxuICAgICAgICBsb2dUZWFjaGVyc1BheWxvYWQoJ0JFRk9SRV9TRVRfVEVBQ0hFUlNMSVNUJywgbWFwWycvYXBpL3RlYWNoZXJzJ10pO1xyXG4gICAgICAgIHNldFRlYWNoZXJzTGlzdChtYXBbJy9hcGkvdGVhY2hlcnMnXSk7XHJcbiAgICAgIH1cclxuICAgICAgaWYgKEFycmF5LmlzQXJyYXkobWFwWycvYXBpL3NjaG9vbHMnXSkpIHNldFNjaG9vbHNMaXN0KG1hcFsnL2FwaS9zY2hvb2xzJ10pO1xyXG4gICAgICBpZiAoQXJyYXkuaXNBcnJheShtYXBbJy9hcGkvYWNhZGVtaWMteWVhcnMnXSkpIHNldFllYXJzTGlzdChtYXBbJy9hcGkvYWNhZGVtaWMteWVhcnMnXSk7XHJcbiAgICAgIGlmIChBcnJheS5pc0FycmF5KG1hcFsnL2FwaS9jbGFzc2VzJ10pKSBzZXRDbGFzc2VzTGlzdChtYXBbJy9hcGkvY2xhc3NlcyddKTtcclxuXHJcbiAgICAgIGNvbnN0IHJhd1N0dWRlbnRzUGF5bG9hZCA9IG1hcFsnL2FwaS9zdHVkZW50cyddO1xyXG4gICAgICBjb25zdCBub3JtYWxpemVkU3R1ZGVudHMgPSBub3JtYWxpemVTdHVkZW50c1BheWxvYWQocmF3U3R1ZGVudHNQYXlsb2FkKTtcclxuICAgICAgc2V0U3R1ZGVudHNMaXN0KG5vcm1hbGl6ZWRTdHVkZW50cyk7XHJcblxyXG4gICAgICBpZiAoQXJyYXkuaXNBcnJheShtYXBbJy9hcGkvcGFyZW50cyddKSkgc2V0UGFyZW50c0xpc3QobWFwWycvYXBpL3BhcmVudHMnXSk7XHJcbiAgICAgIGlmIChBcnJheS5pc0FycmF5KG1hcFsnL2FwaS9hYnNlbmNlcyddKSkgc2V0QWJzZW5jZXNMaXN0KG1hcFsnL2FwaS9hYnNlbmNlcyddKTtcclxuICAgICAgaWYgKEFycmF5LmlzQXJyYXkobWFwWycvYXBpL2V2YWx1YXRpb25zJ10pKSBzZXRFdmFsdWF0aW9uc0xpc3QobWFwWycvYXBpL2V2YWx1YXRpb25zJ10pO1xyXG4gICAgICBpZiAoQXJyYXkuaXNBcnJheShtYXBbJy9hcGkvZ3JhZGVzJ10pKSBzZXRHcmFkZXNMaXN0KG1hcFsnL2FwaS9ncmFkZXMnXSk7XHJcbiAgICAgIGlmIChBcnJheS5pc0FycmF5KG1hcFsnL2FwaS9ub3RpZmljYXRpb25zJ10pKSBzZXROb3RpZmljYXRpb25zTGlzdChtYXBbJy9hcGkvbm90aWZpY2F0aW9ucyddKTtcclxuICAgICAgaWYgKEFycmF5LmlzQXJyYXkobWFwWycvYXBpL3N1YmplY3RzJ10pKSBzZXRTdWJqZWN0c0xpc3QobWFwWycvYXBpL3N1YmplY3RzJ10pO1xyXG4gICAgICBpZiAoQXJyYXkuaXNBcnJheShtYXBbJy9hcGkvc3ViamVjdHM/YXBwcm92ZWRPbmx5PXRydWUnXSkpIHNldEFwcHJvdmVkU3ViamVjdHNMaXN0KG1hcFsnL2FwaS9zdWJqZWN0cz9hcHByb3ZlZE9ubHk9dHJ1ZSddKTtcclxuICAgICAgaWYgKEFycmF5LmlzQXJyYXkobWFwWycvYXBpL3NpbXVsYXRpb24vdXNlcnMnXSkpIHNldFVzZXJzTGlzdChtYXBbJy9hcGkvc2ltdWxhdGlvbi91c2VycyddKTtcclxuXHJcbiAgICAgIGlmIChjdXJyZW50Um9sZSA9PT0gJ3N1cGVyX2FkbWluJykge1xyXG4gICAgICAgIGF3YWl0IGZldGNoQXVkaXRFdmVudHMoKTtcclxuICAgICAgfSBlbHNlIHtcclxuICAgICAgICBzZXRBdWRpdEV2ZW50cyhbXSk7XHJcbiAgICAgIH1cclxuICAgIH0gY2F0Y2ggKGVycjogYW55KSB7XHJcbiAgICAgIGNvbnN0IHVpTWVzc2FnZSA9IGdldFVpRXJyb3JNZXNzYWdlKGVyciwgJ0ltcG9zc2libGUgZGUgY2hhcmdlciBsZXMgZG9ubsOpZXMgRWNvbGVUcmFjay4nKTtcclxuICAgICAgaWYgKHVpTWVzc2FnZSkge1xyXG4gICAgICAgIHNldEVycm9yTXNnKHVpTWVzc2FnZSk7XHJcbiAgICAgIH1cclxuICAgICAgY29uc29sZS5lcnJvcignRXJyb3IgaHlkcmF0aW5nIEVjb2xlVHJhY2sgZGF0YWJhc2U6JywgZXJyKTtcclxuICAgICAgY29uc29sZS53YXJuKCdbc3R1ZGVudHMtbG9hZF0ga2VlcGluZyBleGlzdGluZyBzdHVkZW50IGxpc3QgYmVjYXVzZSB0aGUgcmVmcmVzaCBmYWlsZWQuJywgZXJyKTtcclxuICAgIH0gZmluYWxseSB7XHJcbiAgICAgIHNldElzU3luY2luZyhmYWxzZSk7XHJcbiAgICB9XHJcbiAgfTtcclxuXHJcbiAgLy8gV2hlbiBTdXBlciBBZG1pbiBzZWxlY3RzIGEgc2Nob29sIGZpbHRlciwgZmV0Y2ggY2xhc3NlcyBhbm5vdGF0ZWQgZm9yIHRoYXQgc2Nob29sXHJcbiAgLy8gc28gdGhhdCBnbG9iYWwgY2xhc3NlcyBhcHByb3ZlZCBmb3IgdGhlIHNjaG9vbCBoYXZlIHRoZWlyIGBzdGF0dXNgIHBvcHVsYXRlZC5cclxuICB1c2VFZmZlY3QoKCkgPT4ge1xyXG4gICAgaWYgKGN1cnJlbnRSb2xlICE9PSAnc3VwZXJfYWRtaW4nKSByZXR1cm47XHJcbiAgICBjb25zdCBzY2hvb2xJZCA9IHN1cGVyQWRtaW5TY2hvb2xGaWx0ZXJJZDtcclxuICAgIGNvbnN0IGVuZHBvaW50ID0gc2Nob29sSWQgPyBgL2FwaS9jbGFzc2VzP3NjaG9vbElkPSR7c2Nob29sSWR9YCA6ICcvYXBpL2NsYXNzZXMnO1xyXG4gICAgKGFzeW5jICgpID0+IHtcclxuICAgICAgdHJ5IHtcclxuICAgICAgICBjb25zdCBwYXlsb2FkID0gYXdhaXQgYXBpRmV0Y2goZW5kcG9pbnQpO1xyXG4gICAgICAgIHNldENsYXNzZXNMaXN0KEFycmF5LmlzQXJyYXkocGF5bG9hZCkgPyBwYXlsb2FkIDogW10pO1xyXG4gICAgICB9IGNhdGNoIChlcnI6IGFueSkge1xyXG4gICAgICAgIGNvbnNvbGUud2FybignRmFpbGVkIHRvIGxvYWQgY2xhc3NlcyBmb3Igc3VwZXIgYWRtaW4gc2Nob29sIGZpbHRlcicsIGVycik7XHJcbiAgICAgIH1cclxuICAgIH0pKCk7XHJcbiAgfSwgW3N1cGVyQWRtaW5TY2hvb2xGaWx0ZXJJZCwgY3VycmVudFJvbGVdKTtcclxuXHJcbiAgdXNlRWZmZWN0KCgpID0+IHtcclxuICAgIGxvZ1RlYWNoZXJzUGF5bG9hZCgnQUZURVJfU0VUX1RFQUNIRVJTTElTVCcsIHRlYWNoZXJzTGlzdCk7XHJcbiAgfSwgW3RlYWNoZXJzTGlzdF0pO1xyXG5cclxuICB1c2VFZmZlY3QoKCkgPT4ge1xyXG4gICAgaWYgKHJvbGUgIT09ICdzdXBlcl9hZG1pbicpIHtcclxuICAgICAgc2V0U3VwZXJBZG1pblNjaG9vbEZpbHRlcklkKG51bGwpO1xyXG4gICAgfVxyXG4gICAgaWYgKHJvbGUpIGZldGNoQWxsRGF0YSgpO1xyXG4gIH0sIFtyb2xlXSk7XHJcblxyXG4gIHVzZUVmZmVjdCgoKSA9PiB7XHJcbiAgICBpZiAoIXJvbGUpIHJldHVybjtcclxuICAgIGlmIChjdXJyZW50Um9sZSA9PT0gJ3N1cGVyX2FkbWluJyB8fCBhY3RpdmVTY2hvb2xJZCAhPSBudWxsKSB7XHJcbiAgICAgIGZldGNoQWxsRGF0YSgpO1xyXG4gICAgfVxyXG4gIH0sIFthY3RpdmVTY2hvb2xJZCwgY3VycmVudFJvbGUsIHJvbGVdKTtcclxuXHJcbiAgdXNlRWZmZWN0KCgpID0+IHtcclxuICAgIGlmICghbm90aWZpY2F0aW9uc0xpc3QgfHwgbm90aWZpY2F0aW9uc0xpc3QubGVuZ3RoID09PSAwKSByZXR1cm47XHJcblxyXG4gICAgY29uc3QgbmV3Tm90aWZzID0gbm90aWZpY2F0aW9uc0xpc3QuZmlsdGVyKChub3RpZikgPT4gIXByb2Nlc3NlZE5vdGlmaWNhdGlvbklkc1JlZi5jdXJyZW50Lmhhcyhub3RpZi5pZCkpO1xyXG4gICAgaWYgKG5ld05vdGlmcy5sZW5ndGggPT09IDApIHJldHVybjtcclxuXHJcbiAgICBjb25zdCBoYXNBYnNlbmNlID0gbmV3Tm90aWZzLnNvbWUoKG5vdGlmKSA9PiBub3RpZi50eXBlID09PSAnYWJzZW5jZScpO1xyXG4gICAgY29uc3QgaGFzR3JhZGUgPSBuZXdOb3RpZnMuc29tZSgobm90aWYpID0+IG5vdGlmLnR5cGUgPT09ICdncmFkZScpO1xyXG4gICAgaWYgKCFoYXNBYnNlbmNlICYmICFoYXNHcmFkZSkgcmV0dXJuO1xyXG5cclxuICAgIG5ld05vdGlmcy5mb3JFYWNoKChub3RpZikgPT4gcHJvY2Vzc2VkTm90aWZpY2F0aW9uSWRzUmVmLmN1cnJlbnQuYWRkKG5vdGlmLmlkKSk7XHJcbiAgICBpZiAoaGFzQWJzZW5jZSB8fCBoYXNHcmFkZSkge1xyXG4gICAgICBmZXRjaEFsbERhdGEoZmFsc2UpO1xyXG4gICAgfVxyXG4gIH0sIFtub3RpZmljYXRpb25zTGlzdF0pO1xyXG5cclxuICB1c2VFZmZlY3QoKCkgPT4ge1xyXG4gICAgaWYgKGFjdGl2ZVRhYiA9PT0gJ2F1ZGl0JyAmJiBjdXJyZW50Um9sZSA9PT0gJ3N1cGVyX2FkbWluJykge1xyXG4gICAgICBmZXRjaEF1ZGl0RXZlbnRzKCk7XHJcbiAgICB9XHJcbiAgfSwgW2FjdGl2ZVRhYiwgY3VycmVudFJvbGVdKTtcclxuXHJcbiAgY29uc3QgaGFuZGxlUm9sZUNoYW5nZSA9IChuZXdSb2xlOiBzdHJpbmcpID0+IHtcclxuICAgIGlmICghbmV3Um9sZSkge1xyXG4gICAgICBjbGVhclNpbXVsYXRlZFJvbGUoKTtcclxuICAgICAgY2xlYXJTaW11bGF0ZWRVc2VyKCk7XHJcbiAgICAgIHdpbmRvdy5oaXN0b3J5LnJlcGxhY2VTdGF0ZShudWxsLCAnJywgJy9sb2dpbicpO1xyXG4gICAgICByZXR1cm47XHJcbiAgICB9XHJcbiAgICAvLyBFbnN1cmUgdGhlcmUncyBhIHNpbXVsYXRlZCB1c2VyIHNldCB3aGVuIHN3aXRjaGluZyByb2xlcyBxdWlja2x5LlxyXG4gICAgY29uc3QgZXhpc3RpbmdTaW1Vc2VyID0gYXV0aGVudGljYXRlZFVzZXI7XHJcbiAgICBpZiAoIWV4aXN0aW5nU2ltVXNlcikge1xyXG4gICAgICBpZiAobmV3Um9sZSA9PT0gJ3RlYWNoZXInKSB7XHJcbiAgICAgICAgLy8gcGljayBhIHRlYWNoZXIgaW4gdGhlIGN1cnJlbnQgc2Nob29sIGlmIGF2YWlsYWJsZSwgb3RoZXJ3aXNlIGEgZ2VuZXJpYyB0ZWFjaGVyXHJcbiAgICAgICAgY29uc3QgcHJlZmVycmVkID0gdGVhY2hlcnNMaXN0LmZpbmQoKHQpID0+IHQuc2Nob29sSWQgPT09IGN1cnJlbnRTY2hvb2xJZCkgfHwgdGVhY2hlcnNMaXN0WzBdO1xyXG4gICAgICAgIGlmIChwcmVmZXJyZWQpIHtcclxuICAgICAgICAgIHNldFNpbXVsYXRlZFVzZXIoeyB1aWQ6IGB0ZWFjaGVyXyR7cHJlZmVycmVkLnVzZXJJZCB8fCBwcmVmZXJyZWQuaWR9YCwgZW1haWw6IHByZWZlcnJlZC5lbWFpbCB8fCAnJywgbmFtZTogcHJlZmVycmVkLm5hbWUgfHwgJ0Vuc2VpZ25hbnQnLCBzY2hvb2xJZDogcHJlZmVycmVkLnNjaG9vbElkIH0pO1xyXG4gICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICBzZXRTaW11bGF0ZWRVc2VyKHsgdWlkOiBgc2ltX3RlYWNoZXJfJHtEYXRlLm5vdygpfWAsIGVtYWlsOiAnc2ltX3RlYWNoZXJAZXhhbXBsZS50ZXN0JywgbmFtZTogJ0Vuc2VpZ25hbnQgU2ltdWzDqScsIHNjaG9vbElkOiBjdXJyZW50U2Nob29sSWQgfSk7XHJcbiAgICAgICAgfVxyXG4gICAgICB9IGVsc2UgaWYgKG5ld1JvbGUgPT09ICdzY2hvb2xfYWRtaW4nKSB7XHJcbiAgICAgICAgc2V0U2ltdWxhdGVkVXNlcih7IHVpZDogYHNpbV9zY2hvb2xhZG1pbl8ke0RhdGUubm93KCl9YCwgZW1haWw6ICdzaW1fc2Nob29sYWRtaW5AZXhhbXBsZS50ZXN0JywgbmFtZTogJ0FkbWluIEVjb2xlJywgc2Nob29sSWQ6IGN1cnJlbnRTY2hvb2xJZCB9KTtcclxuICAgICAgfSBlbHNlIGlmIChuZXdSb2xlID09PSAncGFyZW50Jykge1xyXG4gICAgICAgIHNldFNpbXVsYXRlZFVzZXIoeyB1aWQ6IGBzaW1fcGFyZW50XyR7RGF0ZS5ub3coKX1gLCBlbWFpbDogJ3NpbV9wYXJlbnRAZXhhbXBsZS50ZXN0JywgbmFtZTogJ1BhcmVudCBTaW11bMOpJywgc2Nob29sSWQ6IGN1cnJlbnRTY2hvb2xJZCB9KTtcclxuICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIHNldFNpbXVsYXRlZFJvbGUobmV3Um9sZSk7XHJcbiAgICB3aW5kb3cuaGlzdG9yeS5yZXBsYWNlU3RhdGUobnVsbCwgJycsICcvJyk7XHJcbiAgfTtcclxuXHJcbiAgY29uc3QgaGFuZGxlTG9nb3V0ID0gYXN5bmMgKCkgPT4ge1xyXG4gICAgY2xlYXJTaW11bGF0ZWRSb2xlKCk7XHJcbiAgICBjbGVhclNpbXVsYXRlZFVzZXIoKTtcclxuICAgIHRyeSB7XHJcbiAgICAgIGF3YWl0IGFwaUZldGNoKCcvYXBpL2F1dGgvbG9nb3V0JywgeyBtZXRob2Q6ICdQT1NUJyB9KTtcclxuICAgIH0gY2F0Y2ggKGUpIHtcclxuICAgICAgY29uc29sZS53YXJuKCdMb2dvdXQgcmVxdWVzdCBmYWlsZWQnLCBlKTtcclxuICAgIH1cclxuICAgIHdpbmRvdy5sb2NhdGlvbi5yZXBsYWNlKCcvbG9naW4nKTtcclxuICB9O1xyXG5cclxuICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cclxuICAvLyBIQU5ETEVSUyBGT1IgQ1JFQVRJT05TIChQT1NUUyBSRVNUIEFQSSlcclxuICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cclxuXHJcbiAgY29uc3QgaGFuZGxlQWRkU2Nob29sID0gYXN5bmMgKGRhdGE6IHsgbmFtZTogc3RyaW5nOyBhZGRyZXNzOiBzdHJpbmc7IHBob25lOiBzdHJpbmc7IGNsYXNzTmFtZXM/OiBzdHJpbmdbXTsgc3ViamVjdE5hbWVzPzogc3RyaW5nW10gfSkgPT4ge1xyXG4gICAgdHJ5IHtcclxuICAgICAgY29uc3QgY3JlYXRlZFNjaG9vbCA9IGF3YWl0IGFwaUZldGNoKCcvYXBpL3NjaG9vbHMnLCB7XHJcbiAgICAgICAgbWV0aG9kOiAnUE9TVCcsXHJcbiAgICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoZGF0YSksXHJcbiAgICAgIH0pO1xyXG4gICAgICBhd2FpdCBmZXRjaEFsbERhdGEoZmFsc2UpO1xyXG4gICAgICByZXR1cm4gY3JlYXRlZFNjaG9vbDtcclxuICAgIH0gY2F0Y2ggKGVycjogYW55KSB7XHJcbiAgICAgIHNldEVycm9yTXNnKGVyci5tZXNzYWdlIHx8ICdJbXBvc3NpYmxlIGRcXCdham91dGVyIGxcXCfDqWNvbGUnKTtcclxuICAgICAgdGhyb3cgZXJyO1xyXG4gICAgfVxyXG4gIH07XHJcblxyXG4gIGNvbnN0IGhhbmRsZUFkZFllYXIgPSBhc3luYyAoZGF0YTogeyBuYW1lOiBzdHJpbmc7IGlzQWN0aXZlOiBib29sZWFuOyBzY2hvb2xJZD86IG51bWJlciB9KSA9PiB7XHJcbiAgICB0cnkge1xyXG4gICAgICBhd2FpdCBhcGlGZXRjaCgnL2FwaS9hY2FkZW1pYy15ZWFycycsIHtcclxuICAgICAgICBtZXRob2Q6ICdQT1NUJyxcclxuICAgICAgICBib2R5OiBKU09OLnN0cmluZ2lmeShkYXRhKSxcclxuICAgICAgfSk7XHJcbiAgICAgIGF3YWl0IGZldGNoQWxsRGF0YShmYWxzZSk7XHJcbiAgICB9IGNhdGNoIChlcnI6IGFueSkge1xyXG4gICAgICBzZXRFcnJvck1zZyhlcnIubWVzc2FnZSB8fCAnSW1wb3NzaWJsZSBkXFwnYWpvdXRlciBsXFwnYW5uw6llJyk7XHJcbiAgICAgIHRocm93IGVycjtcclxuICAgIH1cclxuICB9O1xyXG5cclxuICBjb25zdCBoYW5kbGVTZXRBY3RpdmVZZWFyID0gYXN5bmMgKHllYXJJZDogbnVtYmVyKSA9PiB7XHJcbiAgICB0cnkge1xyXG4gICAgICBhd2FpdCBhcGlGZXRjaChgL2FwaS9hY2FkZW1pYy15ZWFycy8ke3llYXJJZH0vYWN0aXZhdGVgLCB7XHJcbiAgICAgICAgbWV0aG9kOiAnUFVUJyxcclxuICAgICAgfSk7XHJcbiAgICAgIGF3YWl0IGZldGNoQWxsRGF0YShmYWxzZSk7XHJcbiAgICB9IGNhdGNoIChlcnI6IGFueSkge1xyXG4gICAgICBzZXRFcnJvck1zZyhlcnIubWVzc2FnZSB8fCAnSW1wb3NzaWJsZSBkZSBkw6lmaW5pciBjZXR0ZSBhbm7DqWUgY29tbWUgYWN0aXZlJyk7XHJcbiAgICAgIHRocm93IGVycjtcclxuICAgIH1cclxuICB9O1xyXG5cclxuICBjb25zdCBoYW5kbGVEZWxldGVZZWFyID0gYXN5bmMgKHllYXJJZDogbnVtYmVyKSA9PiB7XHJcbiAgICB0cnkge1xyXG4gICAgICBhd2FpdCBhcGlGZXRjaChgL2FwaS9hY2FkZW1pYy15ZWFycy8ke3llYXJJZH1gLCB7XHJcbiAgICAgICAgbWV0aG9kOiAnREVMRVRFJyxcclxuICAgICAgfSk7XHJcbiAgICAgIGF3YWl0IGZldGNoQWxsRGF0YShmYWxzZSk7XHJcbiAgICB9IGNhdGNoIChlcnI6IGFueSkge1xyXG4gICAgICBzZXRFcnJvck1zZyhlcnIubWVzc2FnZSB8fCAnSW1wb3NzaWJsZSBkZSBzdXBwcmltZXIgY2V0dGUgYW5uw6llIHNjb2xhaXJlJyk7XHJcbiAgICAgIHRocm93IGVycjtcclxuICAgIH1cclxuICB9O1xyXG5cclxuICBjb25zdCBoYW5kbGVBZGRDbGFzcyA9IGFzeW5jIChkYXRhOiB7IG5hbWU6IHN0cmluZzsgc2Nob29sSWQ/OiBudW1iZXIgfCBudWxsOyBhY2FkZW1pY1llYXJJZDogbnVtYmVyOyB0ZWFjaGVySWQ/OiBudW1iZXIgfSkgPT4ge1xyXG4gICAgdHJ5IHtcclxuICAgICAgY29uc3QgcGF5bG9hZCA9IHtcclxuICAgICAgICAuLi5kYXRhLFxyXG4gICAgICAgIHNjaG9vbElkOiBkYXRhLnNjaG9vbElkID8/IG51bGwsXHJcbiAgICAgIH07XHJcbiAgICAgIGF3YWl0IGFwaUZldGNoKCcvYXBpL2NsYXNzZXMnLCB7XHJcbiAgICAgICAgbWV0aG9kOiAnUE9TVCcsXHJcbiAgICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkocGF5bG9hZCksXHJcbiAgICAgIH0pO1xyXG4gICAgICBhd2FpdCBmZXRjaEFsbERhdGEoZmFsc2UpO1xyXG4gICAgfSBjYXRjaCAoZXJyOiBhbnkpIHtcclxuICAgICAgc2V0RXJyb3JNc2coZXJyLm1lc3NhZ2UgfHwgJ0ltcG9zc2libGUgZGUgY3LDqWVyIGxhIGNsYXNzZScpO1xyXG4gICAgICB0aHJvdyBlcnI7XHJcbiAgICB9XHJcbiAgfTtcclxuXHJcbiAgY29uc3QgaGFuZGxlRGVsZXRlQ2xhc3MgPSBhc3luYyAoaWQ6IG51bWJlcikgPT4ge1xyXG4gICAgdHJ5IHtcclxuICAgICAgYXdhaXQgYXBpRmV0Y2goYC9hcGkvY2xhc3Nlcy8ke2lkfWAsIHsgbWV0aG9kOiAnREVMRVRFJyB9KTtcclxuICAgICAgZmV0Y2hBbGxEYXRhKCk7XHJcbiAgICB9IGNhdGNoIChlcnI6IGFueSkge1xyXG4gICAgICBzZXRFcnJvck1zZyhlcnIubWVzc2FnZSB8fCAnU3VwcHJlc3Npb24gaW1wb3NzaWJsZScpO1xyXG4gICAgfVxyXG4gIH07XHJcblxyXG4gIGNvbnN0IGhhbmRsZUFwcHJvdmVDbGFzcyA9IGFzeW5jIChpZDogbnVtYmVyKSA9PiB7XHJcbiAgICB0cnkge1xyXG4gICAgICBjb25zdCBzY2hvb2xJZCA9IGN1cnJlbnRTY2hvb2xJZDtcclxuICAgICAgaWYgKCFzY2hvb2xJZCkgdGhyb3cgbmV3IEVycm9yKCdBdWN1biDDqXRhYmxpc3NlbWVudCBzw6lsZWN0aW9ubsOpIHBvdXIgYXBwcm91dmVyIGxhIGNsYXNzZScpO1xyXG4gICAgICBhd2FpdCBhcGlGZXRjaChgL2FwaS9zY2hvb2xzLyR7c2Nob29sSWR9L2NsYXNzZXMvJHtpZH0vYXBwcm92ZWAsIHsgbWV0aG9kOiAnUE9TVCcgfSk7XHJcbiAgICAgIHNldENsYXNzZXNMaXN0KChwcmV2KSA9PiBwcmV2Lm1hcCgoYykgPT4gKGMuaWQgPT09IGlkID8geyAuLi5jLCBzdGF0dXM6ICdhcHByb3ZlZCcgfSA6IGMpKSk7XHJcbiAgICAgIGF3YWl0IGZldGNoQWxsRGF0YShmYWxzZSk7XHJcbiAgICB9IGNhdGNoIChlcnI6IGFueSkge1xyXG4gICAgICBzZXRFcnJvck1zZyhlcnIubWVzc2FnZSB8fCAnSW1wb3NzaWJsZSBkXFwnYXBwcm91dmVyIGxhIGNsYXNzZS4nKTtcclxuICAgICAgdGhyb3cgZXJyO1xyXG4gICAgfVxyXG4gIH07XHJcblxyXG4gIGNvbnN0IGhhbmRsZVJlamVjdENsYXNzID0gYXN5bmMgKGlkOiBudW1iZXIpID0+IHtcclxuICAgIHRyeSB7XHJcbiAgICAgIGNvbnN0IHNjaG9vbElkID0gY3VycmVudFNjaG9vbElkO1xyXG4gICAgICBpZiAoIXNjaG9vbElkKSB0aHJvdyBuZXcgRXJyb3IoJ0F1Y3VuIMOpdGFibGlzc2VtZW50IHPDqWxlY3Rpb25uw6kgcG91ciByZWZ1c2VyIGxhIGNsYXNzZScpO1xyXG4gICAgICBhd2FpdCBhcGlGZXRjaChgL2FwaS9zY2hvb2xzLyR7c2Nob29sSWR9L2NsYXNzZXMvJHtpZH0vcmVqZWN0YCwgeyBtZXRob2Q6ICdQT1NUJyB9KTtcclxuICAgICAgc2V0Q2xhc3Nlc0xpc3QoKHByZXYpID0+IHByZXYubWFwKChjKSA9PiAoYy5pZCA9PT0gaWQgPyB7IC4uLmMsIHN0YXR1czogJ3JlamVjdGVkJyB9IDogYykpKTtcclxuICAgICAgYXdhaXQgZmV0Y2hBbGxEYXRhKGZhbHNlKTtcclxuICAgIH0gY2F0Y2ggKGVycjogYW55KSB7XHJcbiAgICAgIHNldEVycm9yTXNnKGVyci5tZXNzYWdlIHx8ICdJbXBvc3NpYmxlIGRlIHJlZnVzZXIgbGEgY2xhc3NlLicpO1xyXG4gICAgICB0aHJvdyBlcnI7XHJcbiAgICB9XHJcbiAgfTtcclxuXHJcbiAgY29uc3QgaGFuZGxlRGVsZXRlU2Nob29sID0gYXN5bmMgKGlkOiBudW1iZXIpID0+IHtcclxuICAgIHRyeSB7XHJcbiAgICAgIGF3YWl0IGFwaUZldGNoKGAvYXBpL3NjaG9vbHMvJHtpZH1gLCB7IG1ldGhvZDogJ0RFTEVURScgfSk7XHJcbiAgICAgIGZldGNoQWxsRGF0YSgpO1xyXG4gICAgfSBjYXRjaCAoZXJyOiBhbnkpIHtcclxuICAgICAgaWYgKGVyci5tZXNzYWdlICYmIGVyci5tZXNzYWdlLmluY2x1ZGVzKCfDiWNvbGUgaW50cm91dmFibGUnKSkge1xyXG4gICAgICAgIHNldEVycm9yTXNnKCdM4oCZw6ljb2xlIGRlbWFuZMOpZSBu4oCZZXhpc3RlIHBsdXMuIFJhZnJhw65jaGlzc2V6IGxhIHBhZ2UgcHVpcyByw6llc3NheWV6LicpO1xyXG4gICAgICAgIGF3YWl0IGZldGNoQWxsRGF0YSgpO1xyXG4gICAgICB9IGVsc2Uge1xyXG4gICAgICAgIHNldEVycm9yTXNnKGVyci5tZXNzYWdlIHx8ICdJbXBvc3NpYmxlIGRlIHN1cHByaW1lciBs4oCZw6ljb2xlLicpO1xyXG4gICAgICB9XHJcbiAgICB9XHJcbiAgfTtcclxuICBjb25zdCBoYW5kbGVVcGRhdGVTY2hvb2wgPSBhc3luYyAoaWQ6IG51bWJlciwgZGF0YTogeyBuYW1lOiBzdHJpbmc7IGFkZHJlc3M6IHN0cmluZzsgcGhvbmU6IHN0cmluZzsgY2xhc3NOYW1lcz86IHN0cmluZ1tdOyBzdWJqZWN0TmFtZXM/OiBzdHJpbmdbXSB9KSA9PiB7XHJcbiAgICB0cnkge1xyXG4gICAgICBhd2FpdCBhcGlGZXRjaChgL2FwaS9zY2hvb2xzLyR7aWR9YCwge1xyXG4gICAgICAgIG1ldGhvZDogJ1BVVCcsXHJcbiAgICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoZGF0YSksXHJcbiAgICAgIH0pO1xyXG4gICAgICBmZXRjaEFsbERhdGEoKTtcclxuICAgIH0gY2F0Y2ggKGVycjogYW55KSB7XHJcbiAgICAgIHNldEVycm9yTXNnKGVyci5tZXNzYWdlIHx8ICdJbXBvc3NpYmxlIGRlIG1ldHRyZSDDoCBqb3VyIGxcXCfDqWNvbGUnKTtcclxuICAgICAgdGhyb3cgZXJyO1xyXG4gICAgfVxyXG4gIH07XHJcblxyXG4gIGNvbnN0IGhhbmRsZVVwZGF0ZVN0dWRlbnQgPSBhc3luYyAoaWQ6IG51bWJlciwgZGF0YTogeyBmaXJzdE5hbWU6IHN0cmluZzsgbGFzdE5hbWU6IHN0cmluZzsgYmlydGhEYXRlOiBzdHJpbmcgfCBudWxsOyBzY2hvb2xJZD86IG51bWJlcjsgY2xhc3NJZDogbnVtYmVyOyBwYXJlbnRJZDogbnVtYmVyOyBhY2FkZW1pY1llYXJJZD86IG51bWJlcjsgdGVhY2hlcklkcz86IG51bWJlcltdOyBzY2hvb2xBZG1pbklkPzogbnVtYmVyOyBnZW5kZXI/OiBzdHJpbmcgfSkgPT4ge1xyXG4gICAgdHJ5IHtcclxuICAgICAgYXdhaXQgYXBpRmV0Y2goYC9hcGkvc3R1ZGVudHMvJHtpZH1gLCB7XHJcbiAgICAgICAgbWV0aG9kOiAnUFVUJyxcclxuICAgICAgICBib2R5OiBKU09OLnN0cmluZ2lmeShkYXRhKSxcclxuICAgICAgfSk7XHJcbiAgICAgIGZldGNoQWxsRGF0YSgpO1xyXG4gICAgfSBjYXRjaCAoZXJyOiBhbnkpIHtcclxuICAgICAgc2V0RXJyb3JNc2coZXJyLm1lc3NhZ2UgfHwgJ0ltcG9zc2libGUgZGUgbWV0dHJlIMOgIGpvdXIgbFxcJ8OpbMOodmUnKTtcclxuICAgICAgdGhyb3cgZXJyO1xyXG4gICAgfVxyXG4gIH07XHJcblxyXG4gIGNvbnN0IGhhbmRsZUFkZFRlYWNoZXIgPSBhc3luYyAoZGF0YTogeyBuYW1lOiBzdHJpbmc7IGVtYWlsOiBzdHJpbmc7IHBob25lOiBzdHJpbmc7IHNwZWNpYWxpemF0aW9uOiBzdHJpbmcgfCBzdHJpbmdbXTsgc2Nob29sSWQ6IG51bWJlcjsgY2xhc3NJZHM/OiBudW1iZXJbXTsgZ2VuZGVyPzogc3RyaW5nIH0pID0+IHtcclxuICAgIHRyeSB7XHJcbiAgICAgIGNvbnN0IGNyZWF0ZWQgPSBhd2FpdCBhcGlGZXRjaCgnL2FwaS90ZWFjaGVycycsIHtcclxuICAgICAgICBtZXRob2Q6ICdQT1NUJyxcclxuICAgICAgICBib2R5OiBKU09OLnN0cmluZ2lmeShkYXRhKSxcclxuICAgICAgfSk7XHJcbiAgICAgIGF3YWl0IGZldGNoQWxsRGF0YShmYWxzZSk7XHJcbiAgICAgIHJldHVybiBjcmVhdGVkO1xyXG4gICAgfSBjYXRjaCAoZXJyOiBhbnkpIHtcclxuICAgICAgc2V0RXJyb3JNc2coZXJyLm1lc3NhZ2UpO1xyXG4gICAgICB0aHJvdyBlcnI7XHJcbiAgICB9XHJcbiAgfTtcclxuXHJcbiAgY29uc3QgaGFuZGxlQWRkUGFyZW50ID0gYXN5bmMgKGRhdGE6IHsgbmFtZTogc3RyaW5nOyBlbWFpbDogc3RyaW5nOyBwaG9uZTogc3RyaW5nOyBhZGRyZXNzOiBzdHJpbmc7IHNjaG9vbElkPzogbnVtYmVyOyBzdHVkZW50SWQ/OiBudW1iZXI7IGdlbmRlcj86IHN0cmluZyB9KSA9PiB7XHJcbiAgICB0cnkge1xyXG4gICAgICBjb25zdCBjcmVhdGVkID0gYXdhaXQgYXBpRmV0Y2goJy9hcGkvcGFyZW50cycsIHtcclxuICAgICAgICBtZXRob2Q6ICdQT1NUJyxcclxuICAgICAgICBib2R5OiBKU09OLnN0cmluZ2lmeShkYXRhKSxcclxuICAgICAgfSk7XHJcbiAgICAgIC8vIFJlZnJlc2ggb25seSBwYXJlbnQgbGlzdCB0byBhdm9pZCBjbG9zaW5nL3JlaW5pdGlhbGl6aW5nIHRoZSBzdHVkZW50IGZvcm1cclxuICAgICAgY29uc3QgcGFyZW50cyA9IGF3YWl0IGFwaUZldGNoKCcvYXBpL3BhcmVudHMnKTtcclxuICAgICAgc2V0UGFyZW50c0xpc3QocGFyZW50cyk7XHJcbiAgICAgIHJldHVybiBjcmVhdGVkO1xyXG4gICAgfSBjYXRjaCAoZXJyOiBhbnkpIHtcclxuICAgICAgc2V0RXJyb3JNc2coZXJyLm1lc3NhZ2UpO1xyXG4gICAgICB0aHJvdyBlcnI7XHJcbiAgICB9XHJcbiAgfTtcclxuXHJcbiAgY29uc3QgaGFuZGxlQWRkU3R1ZGVudCA9IGFzeW5jIChkYXRhOiB7IGZpcnN0TmFtZTogc3RyaW5nOyBsYXN0TmFtZTogc3RyaW5nOyBiaXJ0aERhdGU6IHN0cmluZzsgc2Nob29sSWQ6IG51bWJlcjsgY2xhc3NJZDogbnVtYmVyOyBwYXJlbnRJZD86IG51bWJlcjsgYWNhZGVtaWNZZWFySWQ/OiBudW1iZXI7IHRlYWNoZXJJZHM/OiBudW1iZXJbXTsgc2Nob29sQWRtaW5JZD86IG51bWJlcjsgZ2VuZGVyPzogc3RyaW5nIH0pID0+IHtcclxuICAgIHRyeSB7XHJcbiAgICAgIGF3YWl0IGFwaUZldGNoKCcvYXBpL3N0dWRlbnRzJywge1xyXG4gICAgICAgIG1ldGhvZDogJ1BPU1QnLFxyXG4gICAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KGRhdGEpLFxyXG4gICAgICB9KTtcclxuICAgICAgZmV0Y2hBbGxEYXRhKCk7XHJcbiAgICB9IGNhdGNoIChlcnI6IGFueSkge1xyXG4gICAgICBzZXRFcnJvck1zZyhlcnIubWVzc2FnZSk7XHJcbiAgICB9XHJcbiAgfTtcclxuXHJcbiAgY29uc3QgaGFuZGxlQmF0Y2hDcmVhdGVTdHVkZW50cyA9IGFzeW5jIChyZWNvcmRzOiBhbnlbXSkgPT4ge1xyXG4gICAgdHJ5IHtcclxuICAgICAgY29uc3QganNvbiA9IGF3YWl0IGFwaUZldGNoKCcvYXBpL3N0dWRlbnRzL2JhdGNoJywge1xyXG4gICAgICAgIG1ldGhvZDogJ1BPU1QnLFxyXG4gICAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHJlY29yZHMpLFxyXG4gICAgICB9KTtcclxuICAgICAgc2V0SW1wb3J0UmVzdWx0KGpzb24pO1xyXG4gICAgICBpZiAoanNvbi5pbnNlcnRlZENvdW50ICYmIGpzb24uaW5zZXJ0ZWRDb3VudCA+IDApIGZldGNoQWxsRGF0YSgpO1xyXG4gICAgfSBjYXRjaCAoZXJyOiBhbnkpIHtcclxuICAgICAgc2V0RXJyb3JNc2coZXJyLm1lc3NhZ2UgfHwgJ0ltcG9ydCBDU1YgaW1wb3NzaWJsZScpO1xyXG4gICAgfVxyXG4gIH07XHJcblxyXG4gIGNvbnN0IGhhbmRsZUJhdGNoQ3JlYXRlUGFyZW50cyA9IGFzeW5jIChyZWNvcmRzOiBhbnlbXSkgPT4ge1xyXG4gICAgdHJ5IHtcclxuICAgICAgY29uc3QganNvbiA9IGF3YWl0IGFwaUZldGNoKCcvYXBpL3BhcmVudHMvYmF0Y2gnLCB7XHJcbiAgICAgICAgbWV0aG9kOiAnUE9TVCcsXHJcbiAgICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkocmVjb3JkcyksXHJcbiAgICAgIH0pO1xyXG4gICAgICBzZXRJbXBvcnRSZXN1bHQoanNvbik7XHJcbiAgICAgIGlmIChqc29uLmluc2VydGVkQ291bnQgJiYganNvbi5pbnNlcnRlZENvdW50ID4gMCkgZmV0Y2hBbGxEYXRhKCk7XHJcbiAgICB9IGNhdGNoIChlcnI6IGFueSkge1xyXG4gICAgICBzZXRFcnJvck1zZyhlcnIubWVzc2FnZSB8fCAnSW1wb3J0IHBhcmVudHMgaW1wb3NzaWJsZScpO1xyXG4gICAgfVxyXG4gIH07XHJcblxyXG4gIGNvbnN0IGhhbmRsZUNyZWF0ZVVzZXIgPSBhc3luYyAoZGF0YTogeyB1aWQ/OiBzdHJpbmc7IGVtYWlsOiBzdHJpbmc7IG5hbWU6IHN0cmluZzsgcm9sZTogc3RyaW5nOyBzY2hvb2xJZD86IG51bWJlcjsgYWNhZGVtaWNZZWFySWQ/OiBudW1iZXI7IHBob25lPzogc3RyaW5nOyBzcGVjaWFsaXphdGlvbj86IHN0cmluZyB8IHN0cmluZ1tdOyBnZW5kZXI/OiBzdHJpbmc7IHBhc3N3b3JkPzogc3RyaW5nOyBjbGFzc0lkcz86IG51bWJlcltdIH0pID0+IHtcclxuICAgIHRyeSB7XHJcbiAgICAgIGNvbnN0IGNyZWF0ZWQgPSBhd2FpdCBhcGlGZXRjaCgnL2FwaS9hZG1pbi91c2VycycsIHtcclxuICAgICAgICBtZXRob2Q6ICdQT1NUJyxcclxuICAgICAgICBib2R5OiBKU09OLnN0cmluZ2lmeShkYXRhKSxcclxuICAgICAgfSk7XHJcblxyXG4gICAgICBmZXRjaEFsbERhdGEoKTtcclxuICAgICAgcmV0dXJuIGNyZWF0ZWQ7XHJcbiAgICB9IGNhdGNoIChlcnI6IGFueSkge1xyXG4gICAgICBjb25zdCB1c2VyRnJpZW5kbHlNZXNzYWdlID0gZXJyLnN0YXR1cyA9PT0gNDAzIHx8IC9Gb3JiaWRkZW4vLnRlc3QoZXJyLm1lc3NhZ2UpXHJcbiAgICAgICAgPyAnRXJyZXVyIDogdm91cyBu4oCZw6p0ZXMgcGFzIGF1dG9yaXPDqSDDoCBjcsOpZXIgY2UgY29tcHRlIHBvdXIgY2V0dGUgw6ljb2xlIG91IGNlIHLDtGxlLidcclxuICAgICAgICA6IGVyci5tZXNzYWdlIHx8ICdGYWlsZWQgdG8gY3JlYXRlIHVzZXInO1xyXG4gICAgICBzZXRFcnJvck1zZyh1c2VyRnJpZW5kbHlNZXNzYWdlKTtcclxuICAgICAgdGhyb3cgbmV3IEVycm9yKHVzZXJGcmllbmRseU1lc3NhZ2UpO1xyXG4gICAgfVxyXG4gIH07XHJcblxyXG4gIGNvbnN0IGhhbmRsZVVwZGF0ZVVzZXIgPSBhc3luYyAoaWQ6IG51bWJlciwgZGF0YTogeyBlbWFpbDogc3RyaW5nOyBuYW1lOiBzdHJpbmc7IHJvbGU6IHN0cmluZzsgc2Nob29sSWQ/OiBudW1iZXI7IGFjYWRlbWljWWVhcklkPzogbnVtYmVyOyBwaG9uZT86IHN0cmluZzsgc3BlY2lhbGl6YXRpb24/OiBzdHJpbmcgfCBzdHJpbmdbXTsgZ2VuZGVyPzogc3RyaW5nOyBhZGRyZXNzPzogc3RyaW5nOyBzdHVkZW50SWQ/OiBudW1iZXI7IGNsYXNzSWRzPzogbnVtYmVyW10gfSkgPT4ge1xyXG4gICAgdHJ5IHtcclxuICAgICAgYXdhaXQgYXBpRmV0Y2goYC9hcGkvYWRtaW4vdXNlcnMvJHtpZH1gLCB7XHJcbiAgICAgICAgbWV0aG9kOiAnUFVUJyxcclxuICAgICAgICBib2R5OiBKU09OLnN0cmluZ2lmeShkYXRhKSxcclxuICAgICAgfSk7XHJcbiAgICAgIGZldGNoQWxsRGF0YSgpO1xyXG4gICAgfSBjYXRjaCAoZXJyOiBhbnkpIHtcclxuICAgICAgc2V0RXJyb3JNc2coZXJyLm1lc3NhZ2UgfHwgJ0ltcG9zc2libGUgZGUgbWV0dHJlIMOgIGpvdXIgbGUgY29tcHRlJyk7XHJcbiAgICAgIHRocm93IGVycjtcclxuICAgIH1cclxuICB9O1xyXG5cclxuICBjb25zdCBoYW5kbGVTZXRQYXNzd29yZCA9IGFzeW5jICh1c2VySWQ6IG51bWJlciwgcGFzc3dvcmQ6IHN0cmluZykgPT4ge1xyXG4gICAgdHJ5IHtcclxuICAgICAgYXdhaXQgYXBpRmV0Y2goJy9hcGkvYWRtaW4vc2V0LXBhc3N3b3JkJywge1xyXG4gICAgICAgIG1ldGhvZDogJ1BPU1QnLFxyXG4gICAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHsgdXNlcklkLCBwYXNzd29yZCB9KSxcclxuICAgICAgfSk7XHJcbiAgICAgIGZldGNoQWxsRGF0YSgpO1xyXG4gICAgfSBjYXRjaCAoZXJyOiBhbnkpIHtcclxuICAgICAgc2V0RXJyb3JNc2coZXJyLm1lc3NhZ2UgfHwgJ0ltcG9zc2libGUgZGUgbWV0dHJlIMOgIGpvdXIgbGUgbW90IGRlIHBhc3NlJyk7XHJcbiAgICAgIHRocm93IGVycjtcclxuICAgIH1cclxuICB9O1xyXG5cclxuICBjb25zdCBoYW5kbGVEZWxldGVVc2VyID0gYXN5bmMgKGlkOiBudW1iZXIpID0+IHtcclxuICAgIHRyeSB7XHJcbiAgICAgIGF3YWl0IGFwaUZldGNoKGAvYXBpL2FkbWluL3VzZXJzLyR7aWR9YCwge1xyXG4gICAgICAgIG1ldGhvZDogJ0RFTEVURScsXHJcbiAgICAgIH0pO1xyXG4gICAgICBmZXRjaEFsbERhdGEoKTtcclxuICAgIH0gY2F0Y2ggKGVycjogYW55KSB7XHJcbiAgICAgIHNldEVycm9yTXNnKGVyci5tZXNzYWdlIHx8ICdJbXBvc3NpYmxlIGRlIHN1cHByaW1lciBsZSBjb21wdGUnKTtcclxuICAgICAgdGhyb3cgZXJyO1xyXG4gICAgfVxyXG4gIH07XHJcblxyXG4gIGNvbnN0IGhhbmRsZUFkZEFic2VuY2UgPSBhc3luYyAoZGF0YTogeyBzdHVkZW50SWQ6IG51bWJlcjsgY2xhc3NJZDogbnVtYmVyOyBkYXRlOiBzdHJpbmc7IHN1YmplY3RJZD86IG51bWJlcjsgc3RhcnRUaW1lOiBzdHJpbmc7IGVuZFRpbWU6IHN0cmluZzsgaXNKdXN0aWZpZWQ6IGJvb2xlYW4gfSkgPT4ge1xyXG4gICAgdHJ5IHtcclxuICAgICAgYXdhaXQgYXBpRmV0Y2goJy9hcGkvYWJzZW5jZXMnLCB7XHJcbiAgICAgICAgbWV0aG9kOiAnUE9TVCcsXHJcbiAgICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoZGF0YSksXHJcbiAgICAgIH0pO1xyXG4gICAgICBmZXRjaEFsbERhdGEoKTtcclxuICAgIH0gY2F0Y2ggKGVycjogYW55KSB7XHJcbiAgICAgIHNldEVycm9yTXNnKGVyci5tZXNzYWdlKTtcclxuICAgIH1cclxuICB9O1xyXG5cclxuICBjb25zdCBoYW5kbGVKdXN0aWZ5QWJzZW5jZSA9IGFzeW5jIChpZDogbnVtYmVyLCByZWFzb246IHN0cmluZykgPT4ge1xyXG4gICAgdHJ5IHtcclxuICAgICAgYXdhaXQgYXBpRmV0Y2goYC9hcGkvYWJzZW5jZXMvJHtpZH0vanVzdGlmeWAsIHtcclxuICAgICAgICBtZXRob2Q6ICdQVVQnLFxyXG4gICAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHsganVzdGlmaWNhdGlvblJlYXNvbjogcmVhc29uIH0pLFxyXG4gICAgICB9KTtcclxuICAgICAgZmV0Y2hBbGxEYXRhKCk7XHJcbiAgICB9IGNhdGNoIChlcnI6IGFueSkge1xyXG4gICAgICBzZXRFcnJvck1zZyhlcnIubWVzc2FnZSk7XHJcbiAgICB9XHJcbiAgfTtcclxuXHJcbiAgY29uc3QgaGFuZGxlQWRkRXZhbHVhdGlvbiA9IGFzeW5jIChkYXRhOiB7IGNsYXNzSWQ6IG51bWJlcjsgc3ViamVjdDogc3RyaW5nOyB0aXRsZTogc3RyaW5nOyBjb2VmZmljaWVudDogbnVtYmVyOyBtYXhTY29yZTogbnVtYmVyOyBkYXRlOiBzdHJpbmcgfSkgPT4ge1xyXG4gICAgdHJ5IHtcclxuICAgICAgY29uc29sZS5kZWJ1ZygnQ3JlYXRpbmcgZXZhbHVhdGlvbicsIGRhdGEpO1xyXG4gICAgICBhd2FpdCBhcGlGZXRjaCgnL2FwaS9ldmFsdWF0aW9ucycsIHtcclxuICAgICAgICBtZXRob2Q6ICdQT1NUJyxcclxuICAgICAgICBib2R5OiBKU09OLnN0cmluZ2lmeShkYXRhKSxcclxuICAgICAgfSk7XHJcbiAgICAgIGNvbnNvbGUuZGVidWcoJ0V2YWx1YXRpb24gY3JlYXRlZCwgcmVmcmVzaGluZyBkYXRhJyk7XHJcbiAgICAgIGZldGNoQWxsRGF0YSgpO1xyXG4gICAgfSBjYXRjaCAoZXJyOiBhbnkpIHtcclxuICAgICAgc2V0RXJyb3JNc2coZXJyLm1lc3NhZ2UpO1xyXG4gICAgfVxyXG4gIH07XHJcblxyXG4gIGNvbnN0IHJlZnJlc2hBcHByb3ZlZFN1YmplY3RzID0gYXN5bmMgKCkgPT4ge1xyXG4gICAgdHJ5IHtcclxuICAgICAgY29uc3QgYXBwcm92ZWQgPSBhd2FpdCBhcGlGZXRjaCgnL2FwaS9zdWJqZWN0cz9hcHByb3ZlZE9ubHk9dHJ1ZScpO1xyXG4gICAgICBpZiAoQXJyYXkuaXNBcnJheShhcHByb3ZlZCkpIHNldEFwcHJvdmVkU3ViamVjdHNMaXN0KGFwcHJvdmVkKTtcclxuICAgIH0gY2F0Y2ggKGVycjogYW55KSB7XHJcbiAgICAgIGNvbnNvbGUud2FybignVW5hYmxlIHRvIHJlZnJlc2ggYXBwcm92ZWQgc3ViamVjdCBsaXN0OicsIGVycik7XHJcbiAgICB9XHJcbiAgfTtcclxuXHJcbiAgY29uc3QgaGFuZGxlQWRkR3JhZGUgPSBhc3luYyAoZGF0YTogeyBldmFsdWF0aW9uSWQ6IG51bWJlcjsgc3R1ZGVudElkOiBudW1iZXI7IHNjb3JlOiBzdHJpbmc7IHJlbWFya3M6IHN0cmluZyB9KSA9PiB7XHJcbiAgICB0cnkge1xyXG4gICAgICBjb25zdCBjcmVhdGVkT3JVcGRhdGVkR3JhZGUgPSBhd2FpdCBhcGlGZXRjaCgnL2FwaS9ncmFkZXMnLCB7XHJcbiAgICAgICAgbWV0aG9kOiAnUE9TVCcsXHJcbiAgICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoZGF0YSksXHJcbiAgICAgIH0pO1xyXG4gICAgICBzZXRHcmFkZXNMaXN0KChwcmV2KSA9PiB7XHJcbiAgICAgICAgY29uc3QgZXhpc3RpbmdJbmRleCA9IHByZXYuZmluZEluZGV4KFxyXG4gICAgICAgICAgKGc6IGFueSkgPT4gZy5ldmFsdWF0aW9uSWQgPT09IGRhdGEuZXZhbHVhdGlvbklkICYmIGcuc3R1ZGVudElkID09PSBkYXRhLnN0dWRlbnRJZFxyXG4gICAgICAgICk7XHJcbiAgICAgICAgY29uc3QgZ3JhZGVFbnRyeSA9IHtcclxuICAgICAgICAgIGlkOiBjcmVhdGVkT3JVcGRhdGVkR3JhZGUuaWQgPz8gKGV4aXN0aW5nSW5kZXggIT09IC0xID8gcHJldltleGlzdGluZ0luZGV4XS5pZCA6IERhdGUubm93KCkpLFxyXG4gICAgICAgICAgZXZhbHVhdGlvbklkOiBkYXRhLmV2YWx1YXRpb25JZCxcclxuICAgICAgICAgIHN0dWRlbnRJZDogZGF0YS5zdHVkZW50SWQsXHJcbiAgICAgICAgICBzY29yZTogZGF0YS5zY29yZSxcclxuICAgICAgICAgIHJlbWFya3M6IGRhdGEucmVtYXJrcyxcclxuICAgICAgICAgIGVkaXRDb3VudDogY3JlYXRlZE9yVXBkYXRlZEdyYWRlLmVkaXRDb3VudCA/PyBwcmV2W2V4aXN0aW5nSW5kZXhdPy5lZGl0Q291bnQgPz8gMCxcclxuICAgICAgICAgIGV2YWx1YXRpb25UaXRsZTogY3JlYXRlZE9yVXBkYXRlZEdyYWRlLmV2YWx1YXRpb25UaXRsZSA/PyBwcmV2W2V4aXN0aW5nSW5kZXhdPy5ldmFsdWF0aW9uVGl0bGUgPz8gJycsXHJcbiAgICAgICAgICBzdWJqZWN0OiBjcmVhdGVkT3JVcGRhdGVkR3JhZGUuc3ViamVjdCA/PyBwcmV2W2V4aXN0aW5nSW5kZXhdPy5zdWJqZWN0ID8/ICcnLFxyXG4gICAgICAgIH07XHJcbiAgICAgICAgaWYgKGV4aXN0aW5nSW5kZXggIT09IC0xKSB7XHJcbiAgICAgICAgICBjb25zdCBuZXh0ID0gWy4uLnByZXZdO1xyXG4gICAgICAgICAgbmV4dFtleGlzdGluZ0luZGV4XSA9IGdyYWRlRW50cnk7XHJcbiAgICAgICAgICByZXR1cm4gbmV4dDtcclxuICAgICAgICB9XHJcbiAgICAgICAgcmV0dXJuIFsuLi5wcmV2LCBncmFkZUVudHJ5XTtcclxuICAgICAgfSk7XHJcbiAgICB9IGNhdGNoIChlcnI6IGFueSkge1xyXG4gICAgICBzZXRFcnJvck1zZyhlcnIubWVzc2FnZSk7XHJcbiAgICAgIHRocm93IGVycjtcclxuICAgIH1cclxuICB9O1xyXG5cclxuICBjb25zdCBoYW5kbGVBZGRTdWJqZWN0ID0gYXN5bmMgKGRhdGE6IHsgbmFtZTogc3RyaW5nOyBjb2RlPzogc3RyaW5nOyBzY2hvb2xJZD86IG51bWJlciB9KSA9PiB7XHJcbiAgICB0cnkge1xyXG4gICAgICBjb25zdCBjcmVhdGVkU3ViamVjdCA9IGF3YWl0IGFwaUZldGNoKCcvYXBpL3N1YmplY3RzJywge1xyXG4gICAgICAgIG1ldGhvZDogJ1BPU1QnLFxyXG4gICAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KGRhdGEpLFxyXG4gICAgICB9KTtcclxuICAgICAgc2V0U3ViamVjdHNMaXN0KChwcmV2KSA9PiBbLi4ucHJldiwgY3JlYXRlZFN1YmplY3RdKTtcclxuICAgIH0gY2F0Y2ggKGVycjogYW55KSB7XHJcbiAgICAgIHNldEVycm9yTXNnKGVyci5tZXNzYWdlKTtcclxuICAgICAgdGhyb3cgZXJyO1xyXG4gICAgfVxyXG4gIH07XHJcblxyXG4gIGNvbnN0IGhhbmRsZVVwZGF0ZVN1YmplY3QgPSBhc3luYyAoaWQ6IG51bWJlciwgZGF0YTogeyBuYW1lOiBzdHJpbmc7IGNvZGU/OiBzdHJpbmcgfSkgPT4ge1xyXG4gICAgdHJ5IHtcclxuICAgICAgY29uc3QgdXBkYXRlZFN1YmplY3QgPSBhd2FpdCBhcGlGZXRjaChgL2FwaS9zdWJqZWN0cy8ke2lkfWAsIHtcclxuICAgICAgICBtZXRob2Q6ICdQVVQnLFxyXG4gICAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KGRhdGEpLFxyXG4gICAgICB9KTtcclxuICAgICAgc2V0U3ViamVjdHNMaXN0KChwcmV2KSA9PlxyXG4gICAgICAgIHByZXYubWFwKChzKSA9PiAocy5pZCA9PT0gaWQgPyB1cGRhdGVkU3ViamVjdCA6IHMpKVxyXG4gICAgICApO1xyXG4gICAgICBhd2FpdCByZWZyZXNoQXBwcm92ZWRTdWJqZWN0cygpO1xyXG4gICAgfSBjYXRjaCAoZXJyOiBhbnkpIHtcclxuICAgICAgc2V0RXJyb3JNc2coZXJyLm1lc3NhZ2UpO1xyXG4gICAgICB0aHJvdyBlcnI7XHJcbiAgICB9XHJcbiAgfTtcclxuXHJcbiAgY29uc3QgaGFuZGxlRGVsZXRlU3ViamVjdCA9IGFzeW5jIChpZDogbnVtYmVyKSA9PiB7XHJcbiAgICB0cnkge1xyXG4gICAgICBhd2FpdCBhcGlGZXRjaChgL2FwaS9zdWJqZWN0cy8ke2lkfWAsIHtcclxuICAgICAgICBtZXRob2Q6ICdERUxFVEUnLFxyXG4gICAgICB9KTtcclxuICAgICAgc2V0U3ViamVjdHNMaXN0KChwcmV2KSA9PiBwcmV2LmZpbHRlcigocykgPT4gcy5pZCAhPT0gaWQpKTtcclxuICAgICAgYXdhaXQgcmVmcmVzaEFwcHJvdmVkU3ViamVjdHMoKTtcclxuICAgIH0gY2F0Y2ggKGVycjogYW55KSB7XHJcbiAgICAgIHNldEVycm9yTXNnKGVyci5tZXNzYWdlKTtcclxuICAgICAgdGhyb3cgZXJyO1xyXG4gICAgfVxyXG4gIH07XHJcblxyXG4gIGNvbnN0IGhhbmRsZUFwcHJvdmVTdWJqZWN0ID0gYXN5bmMgKGlkOiBudW1iZXIpID0+IHtcclxuICAgIHRyeSB7XHJcbiAgICAgIGNvbnN0IHNjaG9vbElkID0gY3VycmVudFNjaG9vbElkO1xyXG4gICAgICBpZiAoIXNjaG9vbElkKSB0aHJvdyBuZXcgRXJyb3IoJ0F1Y3VuIMOpdGFibGlzc2VtZW50IHPDqWxlY3Rpb25uw6knKTtcclxuICAgICAgYXdhaXQgYXBpRmV0Y2goYC9hcGkvc2Nob29scy8ke3NjaG9vbElkfS9zdWJqZWN0cy8ke2lkfS9hcHByb3ZlYCwgeyBtZXRob2Q6ICdQT1NUJyB9KTtcclxuICAgICAgc2V0U3ViamVjdHNMaXN0KChwcmV2KSA9PiBwcmV2Lm1hcCgocykgPT4gKHMuaWQgPT09IGlkID8geyAuLi5zLCBzdGF0dXM6ICdhcHByb3ZlZCcgfSA6IHMpKSk7XHJcbiAgICAgIGF3YWl0IHJlZnJlc2hBcHByb3ZlZFN1YmplY3RzKCk7XHJcbiAgICB9IGNhdGNoIChlcnI6IGFueSkge1xyXG4gICAgICBzZXRFcnJvck1zZyhlcnIubWVzc2FnZSk7XHJcbiAgICAgIHRocm93IGVycjtcclxuICAgIH1cclxuICB9O1xyXG5cclxuICBjb25zdCBoYW5kbGVSZWplY3RTdWJqZWN0ID0gYXN5bmMgKGlkOiBudW1iZXIpID0+IHtcclxuICAgIHRyeSB7XHJcbiAgICAgIGNvbnN0IHNjaG9vbElkID0gY3VycmVudFNjaG9vbElkO1xyXG4gICAgICBpZiAoIXNjaG9vbElkKSB0aHJvdyBuZXcgRXJyb3IoJ0F1Y3VuIMOpdGFibGlzc2VtZW50IHPDqWxlY3Rpb25uw6knKTtcclxuICAgICAgYXdhaXQgYXBpRmV0Y2goYC9hcGkvc2Nob29scy8ke3NjaG9vbElkfS9zdWJqZWN0cy8ke2lkfS9yZWplY3RgLCB7IG1ldGhvZDogJ1BPU1QnIH0pO1xyXG4gICAgICBzZXRTdWJqZWN0c0xpc3QoKHByZXYpID0+IHByZXYubWFwKChzKSA9PiAocy5pZCA9PT0gaWQgPyB7IC4uLnMsIHN0YXR1czogJ3JlamVjdGVkJyB9IDogcykpKTtcclxuICAgICAgYXdhaXQgcmVmcmVzaEFwcHJvdmVkU3ViamVjdHMoKTtcclxuICAgIH0gY2F0Y2ggKGVycjogYW55KSB7XHJcbiAgICAgIHNldEVycm9yTXNnKGVyci5tZXNzYWdlKTtcclxuICAgICAgdGhyb3cgZXJyO1xyXG4gICAgfVxyXG4gIH07XHJcblxyXG4gIGNvbnN0IGhhbmRsZVNlbmROb3RpZmljYXRpb24gPSBhc3luYyAoZGF0YTogeyB0aXRsZTogc3RyaW5nOyBib2R5OiBzdHJpbmc7IHR5cGU6IHN0cmluZzsgdXNlcklkPzogbnVtYmVyIH0pID0+IHtcclxuICAgIHRyeSB7XHJcbiAgICAgIGF3YWl0IGFwaUZldGNoKCcvYXBpL25vdGlmaWNhdGlvbnMvc2VuZCcsIHtcclxuICAgICAgICBtZXRob2Q6ICdQT1NUJyxcclxuICAgICAgICBib2R5OiBKU09OLnN0cmluZ2lmeShkYXRhKSxcclxuICAgICAgfSk7XHJcbiAgICAgIGZldGNoQWxsRGF0YSgpO1xyXG4gICAgfSBjYXRjaCAoZXJyOiBhbnkpIHtcclxuICAgICAgc2V0RXJyb3JNc2coZXJyLm1lc3NhZ2UpO1xyXG4gICAgfVxyXG4gIH07XHJcblxyXG4gIGNvbnN0IGhhbmRsZU1hcmtBbGxBc1JlYWQgPSBhc3luYyAoKSA9PiB7XHJcbiAgICB0cnkge1xyXG4gICAgICBhd2FpdCBhcGlGZXRjaCgnL2FwaS9ub3RpZmljYXRpb25zL3JlYWQtYWxsJywgeyBtZXRob2Q6ICdQVVQnIH0pO1xyXG4gICAgICBmZXRjaEFsbERhdGEoKTtcclxuICAgIH0gY2F0Y2ggKGVycjogYW55KSB7XHJcbiAgICAgIHNldEVycm9yTXNnKGVyci5tZXNzYWdlKTtcclxuICAgIH1cclxuICB9O1xyXG5cclxuICBjb25zdCBoYW5kbGVOb3RpZmljYXRpb25SZWFkID0gYXN5bmMgKCkgPT4ge1xyXG4gICAgLy8gcmVmcmVzaCBub3RpZmljYXRpb25zIGxpc3QgYWZ0ZXIgYSBzaW5nbGUgbm90aWZpY2F0aW9uIGlzIG1hcmtlZCByZWFkXHJcbiAgICB0cnkge1xyXG4gICAgICBhd2FpdCBmZXRjaEFsbERhdGEoZmFsc2UpO1xyXG4gICAgfSBjYXRjaCAoZSkge1xyXG4gICAgICBjb25zb2xlLndhcm4oJ0ZhaWxlZCB0byByZWZyZXNoIGRhdGEgYWZ0ZXIgbWFya2luZyBub3RpZmljYXRpb24gcmVhZCcsIGUpO1xyXG4gICAgfVxyXG4gIH07XHJcblxyXG4gIC8vIElmIG5vdCBhdXRoZW50aWNhdGVkLCByZW5kZXIgU1BBIGxvZ2luIHZpZXdcclxuICBpZiAoIWF1dGhlbnRpY2F0ZWRVc2VyIHx8ICghdG9rZW4gJiYgY3VycmVudFJvbGUgIT09ICdzdXBlcl9hZG1pbicpIHx8IChjdXJyZW50Um9sZSAhPT0gJ3N1cGVyX2FkbWluJyAmJiAhYWN0aXZlU2Nob29sSWQpKSB7XHJcbiAgICByZXR1cm4gPExvZ2luVmlldyBvbkxvZ2luPXsocm9sZSkgPT4geyBzZXRTaW11bGF0ZWRSb2xlKHJvbGUpOyB9fSAvPjtcclxuICB9XHJcblxyXG4gIC8vIENlbnRyYWxpemVkIGZpbHRlcmluZyBvZiBldmFsdWF0aW9uczogc2VwYXJhdGUgYWN0aXZlIGZyb20gYXJjaGl2ZWRcclxuICBjb25zdCBhY3RpdmVFdmFsdWF0aW9ucyA9IGV2YWx1YXRpb25zTGlzdC5maWx0ZXIoKGV2KSA9PiB7XHJcbiAgICBpZiAoY3VycmVudFJvbGUgPT09ICdzdXBlcl9hZG1pbicpIHJldHVybiB0cnVlO1xyXG4gICAgaWYgKGN1cnJlbnRSb2xlID09PSAnc2Nob29sX2FkbWluJykge1xyXG4gICAgICByZXR1cm4gIWlzRXZhbHVhdGlvbkxvY2tlZEJ5U2Nob29sQWRtaW4oZXYsIHN0dWRlbnRzTGlzdCwgZ3JhZGVzTGlzdClcclxuICAgICAgICAmJiAhaXNFdmFsdWF0aW9uQXJjaGl2ZWRGb3JTY2hvb2xBZG1pbkJ5QWdlKGV2LCBzdHVkZW50c0xpc3QsIGdyYWRlc0xpc3QpO1xyXG4gICAgfVxyXG4gICAgcmV0dXJuICFpc0V2YWx1YXRpb25BcmNoaXZlZChldiwgc3R1ZGVudHNMaXN0LCBncmFkZXNMaXN0KTtcclxuICB9KTtcclxuICBjb25zdCBhcmNoaXZlZEV2YWx1YXRpb25zID0gZXZhbHVhdGlvbnNMaXN0LmZpbHRlcigoZXYpID0+IHtcclxuICAgIGlmIChjdXJyZW50Um9sZSA9PT0gJ3N1cGVyX2FkbWluJykgcmV0dXJuIGZhbHNlO1xyXG4gICAgaWYgKGN1cnJlbnRSb2xlID09PSAnc2Nob29sX2FkbWluJykge1xyXG4gICAgICByZXR1cm4gaXNFdmFsdWF0aW9uTG9ja2VkQnlTY2hvb2xBZG1pbihldiwgc3R1ZGVudHNMaXN0LCBncmFkZXNMaXN0KVxyXG4gICAgICAgIHx8IGlzRXZhbHVhdGlvbkFyY2hpdmVkRm9yU2Nob29sQWRtaW5CeUFnZShldiwgc3R1ZGVudHNMaXN0LCBncmFkZXNMaXN0KTtcclxuICAgIH1cclxuICAgIHJldHVybiBpc0V2YWx1YXRpb25BcmNoaXZlZChldiwgc3R1ZGVudHNMaXN0LCBncmFkZXNMaXN0KTtcclxuICB9KTtcclxuXHJcbiAgcmV0dXJuIChcclxuICAgIDxkaXYgY2xhc3NOYW1lPVwibWluLWgtc2NyZWVuIGJnLXNsYXRlLTUwIGZsZXggZmxleC1jb2wgZm9udC1zYW5zIHRleHQtc2xhdGUtODAwXCIgaWQ9XCJtYWluLWFwcGxpY2F0aW9uXCI+XHJcbiAgICAgIHsvKiBTaW11bGF0aW9uIGNvbnNvbGUgYmFyIGF0IHRoZSBoZWFkZXIgKi99XHJcbiAgICAgIDxTaW11bGF0b3JIZWFkZXJcclxuICAgICAgICBjdXJyZW50Um9sZT17Y3VycmVudFJvbGV9XHJcbiAgICAgICAgc2Nob29sc0xpc3Q9e3NjaG9vbHNMaXN0fVxyXG4gICAgICAgIHBhcmVudHNMaXN0PXtwYXJlbnRzTGlzdH1cclxuICAgICAgICBjbGFzc2VzTGlzdD17Y2xhc3Nlc0xpc3R9XHJcbiAgICAgICAgdGVhY2hlcnNMaXN0PXt0ZWFjaGVyc0xpc3R9XHJcbiAgICAgICAgc3R1ZGVudHNMaXN0PXtzdHVkZW50c0xpc3R9XHJcbiAgICAgICAgdXNlcnNMaXN0PXt1c2Vyc0xpc3R9XHJcbiAgICAgICAgeWVhcnNMaXN0PXt5ZWFyc0xpc3R9XHJcbiAgICAgICAgYXBwcm92ZWRTdWJqZWN0c0xpc3Q9e2FwcHJvdmVkU3ViamVjdHNMaXN0fVxyXG4gICAgICAgIG9uUm9sZUNoYW5nZT17aGFuZGxlUm9sZUNoYW5nZX1cclxuICAgICAgICBvbkxvZ291dD17aGFuZGxlTG9nb3V0fVxyXG4gICAgICAgIG9uUmVmcmVzaERhdGE9e2ZldGNoQWxsRGF0YX1cclxuICAgICAgICBpc1N5bmNpbmc9e2lzU3luY2luZ31cclxuICAgICAgICBvbk1hbmFnZUFjY291bnRzPXsoKSA9PiBzZXRBY3RpdmVUYWIoJ2FkbWluaXN0cmF0aW9uJyl9XHJcbiAgICAgIC8+XHJcblxyXG4gICAgICB7dmlzaWJsZUVycm9yTXNnICYmIChcclxuICAgICAgICA8R2xvYmFsRXJyb3JUb2FzdCBtZXNzYWdlPXt2aXNpYmxlRXJyb3JNc2d9IG9uQ2xvc2U9eygpID0+IHNldEVycm9yTXNnKG51bGwpfSAvPlxyXG4gICAgICApfVxyXG5cclxuICAgICAgey8qIE1haW4gd29ya3NwYWNlIHdpdGggc2lkZWJhciBvcHRpb24gbGF5b3V0ICovfVxyXG4gICAgICA8ZGl2IGNsYXNzTmFtZT1cImZsZXgtMSBtYXgtdy03eGwgdy1mdWxsIG14LWF1dG8gcC00IHNtOnAtNiBsZzpwLTggZmxleCBmbGV4LWNvbCBsZzpmbGV4LXJvdyBnYXAtNlwiPlxyXG4gICAgICAgIFxyXG4gICAgICAgIHsvKiBTSURFQkFSIE5BVklHQVRJT04gKi99XHJcbiAgICAgICAgPGFzaWRlIGNsYXNzTmFtZT1cInctZnVsbCBsZzp3LTY0IHNocmluay0wIGJnLXdoaXRlIGJvcmRlciBib3JkZXItc2xhdGUtMTAwIHJvdW5kZWQtMnhsIHAtNCBzaGFkb3ctc21cIiBpZD1cIm1haW4tc2lkZWJhclwiPlxyXG4gICAgICAgICAgPGRpdiBjbGFzc05hbWU9XCJzcGFjZS15LTRcIj5cclxuICAgICAgICAgICAgPGRpdiBjbGFzc05hbWU9XCJweC0zIHB5LTIgYm9yZGVyLWIgYm9yZGVyLXNsYXRlLTEwMCBwYi0zXCI+XHJcbiAgICAgICAgICAgICAgPHNwYW4gY2xhc3NOYW1lPVwidGV4dC1bMTBweF0gZm9udC1ib2xkIHRleHQtc2xhdGUtNDAwIHVwcGVyY2FzZSB0cmFja2luZy13aWRlc3QgYmxvY2tcIj5OYXZpZ2F0aW9uPC9zcGFuPlxyXG4gICAgICAgICAgICAgIDxwIGNsYXNzTmFtZT1cInRleHQteHMgdGV4dC1zbGF0ZS00MDBcIj5DbGlxdWV6IHBvdXIgYmFzY3VsZXIgZCd1biBtb2R1bGUgw6AgbCdhdXRyZTwvcD5cclxuICAgICAgICAgICAgPC9kaXY+XHJcblxyXG4gICAgICAgICAgICA8bmF2IGNsYXNzTmFtZT1cInNwYWNlLXktMVwiPlxyXG4gICAgICAgICAgICAgIHsvKiBUYWIgMTogRGFzaGJvYXJkICovfVxyXG4gICAgICAgICAgICAgIDxidXR0b25cclxuICAgICAgICAgICAgICAgIG9uQ2xpY2s9eygpID0+IHNldEFjdGl2ZVRhYigndGFibGVhdS1kZS1ib3JkJyl9XHJcbiAgICAgICAgICAgICAgICBjbGFzc05hbWU9e2B3LWZ1bGwgZmxleCBpdGVtcy1jZW50ZXIgZ2FwLTMgcHgtMy41IHB5LTIuNSByb3VuZGVkLXhsIHRleHQteHMgc206dGV4dC1zbSBmb250LXNlbWlib2xkIHRyYW5zaXRpb24tYWxsIGN1cnNvci1wb2ludGVyICR7XHJcbiAgICAgICAgICAgICAgICAgIGFjdGl2ZVRhYiA9PT0gJ3RhYmxlYXUtZGUtYm9yZCdcclxuICAgICAgICAgICAgICAgICAgICA/ICdiZy1pbmRpZ28tNjAwIHRleHQtd2hpdGUgc2hhZG93LW1kIHNoYWRvdy1pbmRpZ28tNjAwLzEwJ1xyXG4gICAgICAgICAgICAgICAgICAgIDogJ3RleHQtc2xhdGUtNTAwIGhvdmVyOnRleHQtc2xhdGUtOTAwIGhvdmVyOmJnLXNsYXRlLTUwJ1xyXG4gICAgICAgICAgICAgICAgfWB9XHJcbiAgICAgICAgICAgICAgICBpZD1cInNpZGViYXItbmF2LWRhc2hib2FyZFwiXHJcbiAgICAgICAgICAgICAgPlxyXG4gICAgICAgICAgICAgICAgPExheW91dERhc2hib2FyZCBjbGFzc05hbWU9XCJoLTQuNSB3LTQuNVwiIC8+XHJcbiAgICAgICAgICAgICAgICA8c3Bhbj5UYWJsZWF1IGRlIEJvcmQ8L3NwYW4+XHJcbiAgICAgICAgICAgICAgPC9idXR0b24+XHJcblxyXG4gICAgICAgICAgICAgIHsvKiBUYWIgMjogQWRtaW4gc3RhbmRhcmQgZGFzaGJvYXJkICovfVxyXG4gICAgICAgICAgICAgIDxidXR0b25cclxuICAgICAgICAgICAgICAgIG9uQ2xpY2s9eygpID0+IHNldEFjdGl2ZVRhYignYWRtaW5pc3RyYXRpb24nKX1cclxuICAgICAgICAgICAgICAgIGNsYXNzTmFtZT17YHctZnVsbCBmbGV4IGl0ZW1zLWNlbnRlciBnYXAtMyBweC0zLjUgcHktMi41IHJvdW5kZWQteGwgdGV4dC14cyBzbTp0ZXh0LXNtIGZvbnQtc2VtaWJvbGQgdHJhbnNpdGlvbi1hbGwgY3Vyc29yLXBvaW50ZXIgJHtcclxuICAgICAgICAgICAgICAgICAgYWN0aXZlVGFiID09PSAnYWRtaW5pc3RyYXRpb24nXHJcbiAgICAgICAgICAgICAgICAgICAgPyAnYmctaW5kaWdvLTYwMCB0ZXh0LXdoaXRlIHNoYWRvdy1tZCBzaGFkb3ctaW5kaWdvLTYwMC8xMCdcclxuICAgICAgICAgICAgICAgICAgICA6ICd0ZXh0LXNsYXRlLTUwMCBob3Zlcjp0ZXh0LXNsYXRlLTkwMCBob3ZlcjpiZy1zbGF0ZS01MCdcclxuICAgICAgICAgICAgICAgIH1gfVxyXG4gICAgICAgICAgICAgICAgaWQ9XCJzaWRlYmFyLW5hdi1hZG1pblwiXHJcbiAgICAgICAgICAgICAgPlxyXG4gICAgICAgICAgICAgICAgPEJ1aWxkaW5nMiBjbGFzc05hbWU9XCJoLTQuNSB3LTQuNVwiIC8+XHJcbiAgICAgICAgICAgICAgICA8c3Bhbj5BZG1pbmlzdHJhdGlvbjwvc3Bhbj5cclxuICAgICAgICAgICAgICA8L2J1dHRvbj5cclxuXHJcbiAgICAgICAgICAgICAgey8qIFRhYiAzOiBBYnNlbmNlcyAqL31cclxuICAgICAgICAgICAgICA8YnV0dG9uXHJcbiAgICAgICAgICAgICAgICBvbkNsaWNrPXsoKSA9PiBzZXRBY3RpdmVUYWIoJ2Fic2VuY2VzJyl9XHJcbiAgICAgICAgICAgICAgICBjbGFzc05hbWU9e2B3LWZ1bGwgZmxleCBpdGVtcy1jZW50ZXIganVzdGlmeS1iZXR3ZWVuIGdhcC0zIHB4LTMuNSBweS0yLjUgcm91bmRlZC14bCB0ZXh0LXhzIHNtOnRleHQtc20gZm9udC1zZW1pYm9sZCB0cmFuc2l0aW9uLWFsbCBjdXJzb3ItcG9pbnRlciAke1xyXG4gICAgICAgICAgICAgICAgICBhY3RpdmVUYWIgPT09ICdhYnNlbmNlcydcclxuICAgICAgICAgICAgICAgICAgICA/ICdiZy1pbmRpZ28tNjAwIHRleHQtd2hpdGUgc2hhZG93LW1kIHNoYWRvdy1pbmRpZ28tNjAwLzEwJ1xyXG4gICAgICAgICAgICAgICAgICAgIDogJ3RleHQtc2xhdGUtNTAwIGhvdmVyOnRleHQtc2xhdGUtOTAwIGhvdmVyOmJnLXNsYXRlLTUwJ1xyXG4gICAgICAgICAgICAgICAgfWB9XHJcbiAgICAgICAgICAgICAgICBpZD1cInNpZGViYXItbmF2LWFic2VuY2VzXCJcclxuICAgICAgICAgICAgICAgIGRhdGEtdGVzdGlkPVwic2lkZWJhci1uYXYtYWJzZW5jZXNcIlxyXG4gICAgICAgICAgICAgID5cclxuICAgICAgICAgICAgICAgIDxkaXYgY2xhc3NOYW1lPVwiZmxleCBpdGVtcy1jZW50ZXIgZ2FwLTNcIj5cclxuICAgICAgICAgICAgICAgICAgPENhbGVuZGFyRGF5cyBjbGFzc05hbWU9XCJoLTQuNSB3LTQuNVwiIC8+XHJcbiAgICAgICAgICAgICAgICAgIDxzcGFuPkFic2VuY2VzPC9zcGFuPlxyXG4gICAgICAgICAgICAgICAgPC9kaXY+XHJcbiAgICAgICAgICAgICAgICB7dW5qdXN0aWZpZWRBYnNlbmNlc0NvdW50ID4gMCAmJiAoXHJcbiAgICAgICAgICAgICAgICAgIDxzcGFuIGNsYXNzTmFtZT17YHB4LTEuNSBweS0wLjUgcm91bmRlZC1mdWxsIHRleHQtWzEwcHhdIGZvbnQtYm9sZCAke1xyXG4gICAgICAgICAgICAgICAgICAgIGFjdGl2ZVRhYiA9PT0gJ2Fic2VuY2VzJyA/ICdiZy13aGl0ZSB0ZXh0LWluZGlnby03MDAnIDogJ2JnLWluZGlnby02MDAgdGV4dC13aGl0ZSdcclxuICAgICAgICAgICAgICAgICAgfWB9PlxyXG4gICAgICAgICAgICAgICAgICAgIHt1bmp1c3RpZmllZEFic2VuY2VzQ291bnQgPiA5OSA/ICc5OSsnIDogdW5qdXN0aWZpZWRBYnNlbmNlc0NvdW50fVxyXG4gICAgICAgICAgICAgICAgICA8L3NwYW4+XHJcbiAgICAgICAgICAgICAgICApfVxyXG4gICAgICAgICAgICAgIDwvYnV0dG9uPlxyXG5cclxuICAgICAgICAgICAgICB7Y3VycmVudFJvbGUgPT09ICdwYXJlbnQnICYmIChcclxuICAgICAgICAgICAgICAgIDxidXR0b25cclxuICAgICAgICAgICAgICAgICAgb25DbGljaz17KCkgPT4gc2V0QWN0aXZlVGFiKCdub3RlcycpfVxyXG4gICAgICAgICAgICAgICAgICBjbGFzc05hbWU9e2B3LWZ1bGwgZmxleCBpdGVtcy1jZW50ZXIgZ2FwLTMgcHgtMy41IHB5LTIuNSByb3VuZGVkLXhsIHRleHQteHMgc206dGV4dC1zbSBmb250LXNlbWlib2xkIHRyYW5zaXRpb24tYWxsIGN1cnNvci1wb2ludGVyICR7XHJcbiAgICAgICAgICAgICAgICAgICAgYWN0aXZlVGFiID09PSAnbm90ZXMnXHJcbiAgICAgICAgICAgICAgICAgICAgICA/ICdiZy1pbmRpZ28tNjAwIHRleHQtd2hpdGUgc2hhZG93LW1kIHNoYWRvdy1pbmRpZ28tNjAwLzEwJ1xyXG4gICAgICAgICAgICAgICAgICAgICAgOiAndGV4dC1zbGF0ZS01MDAgaG92ZXI6dGV4dC1zbGF0ZS05MDAgaG92ZXI6Ymctc2xhdGUtNTAnXHJcbiAgICAgICAgICAgICAgICAgIH1gfVxyXG4gICAgICAgICAgICAgICAgICBpZD1cInNpZGViYXItbmF2LXBhcmVudC1ncmFkZXNcIlxyXG4gICAgICAgICAgICAgICAgPlxyXG4gICAgICAgICAgICAgICAgICA8QXdhcmQgY2xhc3NOYW1lPVwiaC00LjUgdy00LjVcIiAvPlxyXG4gICAgICAgICAgICAgICAgICA8c3Bhbj5Ob3Rlczwvc3Bhbj5cclxuICAgICAgICAgICAgICAgIDwvYnV0dG9uPlxyXG4gICAgICAgICAgICAgICl9XHJcblxyXG4gICAgICAgICAgICAgIHsvKiBUYWIgNDogTm90ZXMgZXQgYnVsbGV0aW5zIChoaWRkZW4gZm9yIHBhcmVudHMpICovfVxyXG4gICAgICAgICAgICAgIHtjdXJyZW50Um9sZSAhPT0gJ3BhcmVudCcgJiYgKFxyXG4gICAgICAgICAgICAgICAgPD5cclxuICAgICAgICAgICAgICAgICAgPGJ1dHRvblxyXG4gICAgICAgICAgICAgICAgICAgIG9uQ2xpY2s9eygpID0+IHNldEFjdGl2ZVRhYignbm90ZXMnKX1cclxuICAgICAgICAgICAgICAgICAgICBjbGFzc05hbWU9e2B3LWZ1bGwgZmxleCBpdGVtcy1jZW50ZXIganVzdGlmeS1iZXR3ZWVuIGdhcC0zIHB4LTMuNSBweS0yLjUgcm91bmRlZC14bCB0ZXh0LXhzIHNtOnRleHQtc20gZm9udC1zZW1pYm9sZCB0cmFuc2l0aW9uLWFsbCBjdXJzb3ItcG9pbnRlciAke1xyXG4gICAgICAgICAgICAgICAgICAgICAgYWN0aXZlVGFiID09PSAnbm90ZXMnXHJcbiAgICAgICAgICAgICAgICAgICAgICAgID8gJ2JnLWluZGlnby02MDAgdGV4dC13aGl0ZSBzaGFkb3ctbWQgc2hhZG93LWluZGlnby02MDAvMTAnXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIDogJ3RleHQtc2xhdGUtNTAwIGhvdmVyOnRleHQtc2xhdGUtOTAwIGhvdmVyOmJnLXNsYXRlLTUwJ1xyXG4gICAgICAgICAgICAgICAgICAgIH1gfVxyXG4gICAgICAgICAgICAgICAgICAgIGlkPVwic2lkZWJhci1uYXYtZ3JhZGVzXCJcclxuICAgICAgICAgICAgICAgICAgPlxyXG4gICAgICAgICAgICAgICAgICAgIDxkaXYgY2xhc3NOYW1lPVwiZmxleCBpdGVtcy1jZW50ZXIgZ2FwLTNcIj5cclxuICAgICAgICAgICAgICAgICAgICAgIDxBd2FyZCBjbGFzc05hbWU9XCJoLTQuNSB3LTQuNVwiIC8+XHJcbiAgICAgICAgICAgICAgICAgICAgICA8c3Bhbj5Ob3RlcyAmIEJ1bGxldGluczwvc3Bhbj5cclxuICAgICAgICAgICAgICAgICAgICA8L2Rpdj5cclxuICAgICAgICAgICAgICAgICAgICB7bm90ZU92ZXJkdWVDb3VudCA+IDAgJiYgKFxyXG4gICAgICAgICAgICAgICAgICAgICAgPHNwYW4gY2xhc3NOYW1lPXtgcHgtMS41IHB5LTAuNSByb3VuZGVkLWZ1bGwgdGV4dC1bMTBweF0gZm9udC1ib2xkICR7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGFjdGl2ZVRhYiA9PT0gJ25vdGVzJyA/ICdiZy13aGl0ZSB0ZXh0LWluZGlnby03MDAnIDogJ2JnLXJvc2UtNTAwIHRleHQtd2hpdGUnXHJcbiAgICAgICAgICAgICAgICAgICAgICB9YH0+XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHtub3RlT3ZlcmR1ZUNvdW50fVxyXG4gICAgICAgICAgICAgICAgICAgICAgPC9zcGFuPlxyXG4gICAgICAgICAgICAgICAgICAgICl9XHJcbiAgICAgICAgICAgICAgICAgIDwvYnV0dG9uPlxyXG5cclxuICAgICAgICAgICAgICAgICAgPGJ1dHRvblxyXG4gICAgICAgICAgICAgICAgICAgIG9uQ2xpY2s9eygpID0+IHNldEFjdGl2ZVRhYignYXJjaGl2ZScpfVxyXG4gICAgICAgICAgICAgICAgICAgIGNsYXNzTmFtZT17YHctZnVsbCBmbGV4IGl0ZW1zLWNlbnRlciBnYXAtMyBweC0zLjUgcHktMi41IHJvdW5kZWQteGwgdGV4dC14cyBzbTp0ZXh0LXNtIGZvbnQtc2VtaWJvbGQgdHJhbnNpdGlvbi1hbGwgY3Vyc29yLXBvaW50ZXIgJHtcclxuICAgICAgICAgICAgICAgICAgICAgIGFjdGl2ZVRhYiA9PT0gJ2FyY2hpdmUnXHJcbiAgICAgICAgICAgICAgICAgICAgICAgID8gJ2JnLWluZGlnby02MDAgdGV4dC13aGl0ZSBzaGFkb3ctbWQgc2hhZG93LWluZGlnby02MDAvMTAnXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIDogJ3RleHQtc2xhdGUtNTAwIGhvdmVyOnRleHQtc2xhdGUtOTAwIGhvdmVyOmJnLXNsYXRlLTUwJ1xyXG4gICAgICAgICAgICAgICAgICAgIH1gfVxyXG4gICAgICAgICAgICAgICAgICAgIGlkPVwic2lkZWJhci1uYXYtYXJjaGl2ZVwiXHJcbiAgICAgICAgICAgICAgICAgID5cclxuICAgICAgICAgICAgICAgICAgICA8Qm9va09wZW4gY2xhc3NOYW1lPVwiaC00LjUgdy00LjVcIiAvPlxyXG4gICAgICAgICAgICAgICAgICAgIDxzcGFuPkFyY2hpdmU8L3NwYW4+XHJcbiAgICAgICAgICAgICAgICAgIDwvYnV0dG9uPlxyXG4gICAgICAgICAgICAgICAgPC8+XHJcbiAgICAgICAgICAgICAgKX1cclxuXHJcbiAgICAgICAgICAgICAgeyhjdXJyZW50Um9sZSA9PT0gJ3NjaG9vbF9hZG1pbicgfHwgY3VycmVudFJvbGUgPT09ICdzdXBlcl9hZG1pbicgfHwgY3VycmVudFJvbGUgPT09ICd0ZWFjaGVyJykgJiYgKFxyXG4gICAgICAgICAgICAgICAgPGJ1dHRvblxyXG4gICAgICAgICAgICAgICAgICBvbkNsaWNrPXsoKSA9PiBzZXRBY3RpdmVUYWIoJ2J1bGxldGlucycpfVxyXG4gICAgICAgICAgICAgICAgICBjbGFzc05hbWU9e2B3LWZ1bGwgZmxleCBpdGVtcy1jZW50ZXIganVzdGlmeS1iZXR3ZWVuIGdhcC0zIHB4LTMuNSBweS0yLjUgcm91bmRlZC14bCB0ZXh0LXhzIHNtOnRleHQtc20gZm9udC1zZW1pYm9sZCB0cmFuc2l0aW9uLWFsbCBjdXJzb3ItcG9pbnRlciAke1xyXG4gICAgICAgICAgICAgICAgICAgIGFjdGl2ZVRhYiA9PT0gJ2J1bGxldGlucydcclxuICAgICAgICAgICAgICAgICAgICAgID8gJ2JnLWluZGlnby02MDAgdGV4dC13aGl0ZSBzaGFkb3ctbWQgc2hhZG93LWluZGlnby02MDAvMTAnXHJcbiAgICAgICAgICAgICAgICAgICAgICA6ICd0ZXh0LXNsYXRlLTUwMCBob3Zlcjp0ZXh0LXNsYXRlLTkwMCBob3ZlcjpiZy1zbGF0ZS01MCdcclxuICAgICAgICAgICAgICAgICAgfWB9XHJcbiAgICAgICAgICAgICAgICAgIGlkPVwic2lkZWJhci1uYXYtYnVsbGV0aW5zXCJcclxuICAgICAgICAgICAgICAgID5cclxuICAgICAgICAgICAgICAgICAgPGRpdiBjbGFzc05hbWU9XCJmbGV4IGl0ZW1zLWNlbnRlciBnYXAtM1wiPlxyXG4gICAgICAgICAgICAgICAgICAgIDxGaWxlVGV4dCBjbGFzc05hbWU9XCJoLTQuNSB3LTQuNVwiIC8+XHJcbiAgICAgICAgICAgICAgICAgICAgPHNwYW4+QnVsbGV0aW5zPC9zcGFuPlxyXG4gICAgICAgICAgICAgICAgICA8L2Rpdj5cclxuICAgICAgICAgICAgICAgICAge25vdGVPdmVyZHVlQ291bnQgPiAwICYmIChcclxuICAgICAgICAgICAgICAgICAgICA8c3BhbiBjbGFzc05hbWU9e2BweC0xLjUgcHktMC41IHJvdW5kZWQtZnVsbCB0ZXh0LVsxMHB4XSBmb250LWJvbGQgJHtcclxuICAgICAgICAgICAgICAgICAgICAgIGFjdGl2ZVRhYiA9PT0gJ2J1bGxldGlucycgPyAnYmctd2hpdGUgdGV4dC1pbmRpZ28tNzAwJyA6ICdiZy1yb3NlLTUwMCB0ZXh0LXdoaXRlJ1xyXG4gICAgICAgICAgICAgICAgICAgIH1gfT5cclxuICAgICAgICAgICAgICAgICAgICAgIHtub3RlT3ZlcmR1ZUNvdW50fVxyXG4gICAgICAgICAgICAgICAgICAgIDwvc3Bhbj5cclxuICAgICAgICAgICAgICAgICAgKX1cclxuICAgICAgICAgICAgICAgIDwvYnV0dG9uPlxyXG4gICAgICAgICAgICAgICl9XHJcblxyXG4gICAgICAgICAgICAgIHtjdXJyZW50Um9sZSA9PT0gJ3N1cGVyX2FkbWluJyAmJiAoXHJcbiAgICAgICAgICAgICAgICA8YnV0dG9uXHJcbiAgICAgICAgICAgICAgICAgIG9uQ2xpY2s9eygpID0+IHNldEFjdGl2ZVRhYignYXVkaXQnKX1cclxuICAgICAgICAgICAgICAgICAgY2xhc3NOYW1lPXtgdy1mdWxsIGZsZXggaXRlbXMtY2VudGVyIGdhcC0zIHB4LTMuNSBweS0yLjUgcm91bmRlZC14bCB0ZXh0LXhzIHNtOnRleHQtc20gZm9udC1zZW1pYm9sZCB0cmFuc2l0aW9uLWFsbCBjdXJzb3ItcG9pbnRlciAke1xyXG4gICAgICAgICAgICAgICAgICAgIGFjdGl2ZVRhYiA9PT0gJ2F1ZGl0J1xyXG4gICAgICAgICAgICAgICAgICAgICAgPyAnYmctaW5kaWdvLTYwMCB0ZXh0LXdoaXRlIHNoYWRvdy1tZCBzaGFkb3ctaW5kaWdvLTYwMC8xMCdcclxuICAgICAgICAgICAgICAgICAgICAgIDogJ3RleHQtc2xhdGUtNTAwIGhvdmVyOnRleHQtc2xhdGUtOTAwIGhvdmVyOmJnLXNsYXRlLTUwJ1xyXG4gICAgICAgICAgICAgICAgICB9YH1cclxuICAgICAgICAgICAgICAgICAgaWQ9XCJzaWRlYmFyLW5hdi1hdWRpdFwiXHJcbiAgICAgICAgICAgICAgICA+XHJcbiAgICAgICAgICAgICAgICAgIDxJbmZvIGNsYXNzTmFtZT1cImgtNC41IHctNC41XCIgLz5cclxuICAgICAgICAgICAgICAgICAgPHNwYW4+Sm91cm5hbCBkZXMgYWN0aW9uczwvc3Bhbj5cclxuICAgICAgICAgICAgICAgIDwvYnV0dG9uPlxyXG4gICAgICAgICAgICAgICl9XHJcblxyXG4gICAgICAgICAgICAgIHsvKiBUYWIgNTogUmVhbC10aW1lIEZDTSBOb3RpZmljYXRpb25zICovfVxyXG4gICAgICAgICAgICAgIDxidXR0b25cclxuICAgICAgICAgICAgICAgIG9uQ2xpY2s9eygpID0+IHNldEFjdGl2ZVRhYignbm90aWZpY2F0aW9ucycpfVxyXG4gICAgICAgICAgICAgICAgY2xhc3NOYW1lPXtgdy1mdWxsIGZsZXggaXRlbXMtY2VudGVyIGp1c3RpZnktYmV0d2VlbiBweC0zLjUgcHktMi41IHJvdW5kZWQteGwgdGV4dC14cyBzbTp0ZXh0LXNtIGZvbnQtc2VtaWJvbGQgdHJhbnNpdGlvbi1hbGwgY3Vyc29yLXBvaW50ZXIgJHtcclxuICAgICAgICAgICAgICAgICAgYWN0aXZlVGFiID09PSAnbm90aWZpY2F0aW9ucydcclxuICAgICAgICAgICAgICAgICAgICA/ICdiZy1pbmRpZ28tNjAwIHRleHQtd2hpdGUgc2hhZG93LW1kIHNoYWRvdy1pbmRpZ28tNjAwLzEwJ1xyXG4gICAgICAgICAgICAgICAgICAgIDogJ3RleHQtc2xhdGUtNTAwIGhvdmVyOnRleHQtc2xhdGUtOTAwIGhvdmVyOmJnLXNsYXRlLTUwJ1xyXG4gICAgICAgICAgICAgICAgfWB9XHJcbiAgICAgICAgICAgICAgICBpZD1cInNpZGViYXItbmF2LW5vdGlmaWNhdGlvbnNcIlxyXG4gICAgICAgICAgICAgID5cclxuICAgICAgICAgICAgICAgIDxkaXYgY2xhc3NOYW1lPVwiZmxleCBpdGVtcy1jZW50ZXIgZ2FwLTNcIj5cclxuICAgICAgICAgICAgICAgICAgPEJlbGwgY2xhc3NOYW1lPVwiaC00LjUgdy00LjVcIiAvPlxyXG4gICAgICAgICAgICAgICAgICA8c3Bhbj5NZXNzYWdlcmllICYgUHVzaDwvc3Bhbj5cclxuICAgICAgICAgICAgICAgIDwvZGl2PlxyXG4gICAgICAgICAgICAgICAge25vdGlmaWNhdGlvbnNMaXN0LmZpbHRlcigobikgPT4gIW4uaXNSZWFkKS5sZW5ndGggPiAwICYmIChcclxuICAgICAgICAgICAgICAgICAgPHNwYW4gY2xhc3NOYW1lPXtgcHgtMS41IHB5LTAuNSByb3VuZGVkLWZ1bGwgdGV4dC1bMTBweF0gZm9udC1ib2xkICR7XHJcbiAgICAgICAgICAgICAgICAgICAgYWN0aXZlVGFiID09PSAnbm90aWZpY2F0aW9ucycgPyAnYmctd2hpdGUgdGV4dC1pbmRpZ28tNzAwJyA6ICdiZy1pbmRpZ28tNjAwIHRleHQtd2hpdGUnXHJcbiAgICAgICAgICAgICAgICAgIH1gfT5cclxuICAgICAgICAgICAgICAgICAgICB7bm90aWZpY2F0aW9uc0xpc3QuZmlsdGVyKChuKSA9PiAhbi5pc1JlYWQpLmxlbmd0aH1cclxuICAgICAgICAgICAgICAgICAgPC9zcGFuPlxyXG4gICAgICAgICAgICAgICAgKX1cclxuICAgICAgICAgICAgICA8L2J1dHRvbj5cclxuXHJcbiAgICAgICAgICAgICAgey8qIFRhYiA2OiBBbmRyb2lkIEFQSyBWaXJ0dWFsIFNtYXJ0cGhvbmUgTW9ja3VwICovfVxyXG4gICAgICAgICAgICAgIDxidXR0b25cclxuICAgICAgICAgICAgICAgIG9uQ2xpY2s9eygpID0+IHNldEFjdGl2ZVRhYignbW9iaWxlLXBhcmVudCcpfVxyXG4gICAgICAgICAgICAgICAgY2xhc3NOYW1lPXtgdy1mdWxsIGZsZXggaXRlbXMtY2VudGVyIGdhcC0zIHB4LTMuNSBweS0yLjUgcm91bmRlZC14bCB0ZXh0LXhzIHNtOnRleHQtc20gZm9udC1zZW1pYm9sZCB0cmFuc2l0aW9uLWFsbCBjdXJzb3ItcG9pbnRlciAke1xyXG4gICAgICAgICAgICAgICAgICBhY3RpdmVUYWIgPT09ICdtb2JpbGUtcGFyZW50J1xyXG4gICAgICAgICAgICAgICAgICAgID8gJ2JnLWluZGlnby02MDAgdGV4dC13aGl0ZSBzaGFkb3ctbWQgc2hhZG93LWluZGlnby02MDAvMTAnXHJcbiAgICAgICAgICAgICAgICAgICAgOiAndGV4dC1zbGF0ZS01MDAgaG92ZXI6dGV4dC1zbGF0ZS05MDAgaG92ZXI6Ymctc2xhdGUtNTAnXHJcbiAgICAgICAgICAgICAgICB9YH1cclxuICAgICAgICAgICAgICAgIGlkPVwic2lkZWJhci1uYXYtbW9iaWxlXCJcclxuICAgICAgICAgICAgICA+XHJcbiAgICAgICAgICAgICAgICA8U21hcnRwaG9uZSBjbGFzc05hbWU9XCJoLTQuNSB3LTQuNVwiIC8+XHJcbiAgICAgICAgICAgICAgICA8c3Bhbj5BcHBsaWNhdGlvbiBNb2JpbGU8L3NwYW4+XHJcbiAgICAgICAgICAgICAgPC9idXR0b24+XHJcbiAgICAgICAgICAgIDwvbmF2PlxyXG4gICAgICAgICAgPC9kaXY+XHJcblxyXG4gICAgICAgICAgey8qIFF1aWNrIGluZm8gc3RhdHVzIGNvbm5lY3Rpb24gZm9vdGVyICovfVxyXG4gICAgICAgICAge2N1cnJlbnRSb2xlID09PSAnc3VwZXJfYWRtaW4nICYmIChcclxuICAgICAgICAgICAgPGRpdiBjbGFzc05hbWU9XCJtdC04IHB0LTQgYm9yZGVyLXQgYm9yZGVyLXNsYXRlLTEwMCBmbGV4IGZsZXgtY29sIGdhcC0yIHAtMVwiPlxyXG4gICAgICAgICAgICAgIDxkaXYgY2xhc3NOYW1lPVwidGV4dC1bMTBweF0gdGV4dC1zbGF0ZS00MDAgc3BhY2UteS0xXCI+XHJcbiAgICAgICAgICAgICAgICA8c3BhbiBjbGFzc05hbWU9XCJmb250LWJvbGQgdGV4dC1zbGF0ZS01MDAgYmxvY2tcIj5CQVNFIERFIERPTk7DiUVTIDo8L3NwYW4+XHJcbiAgICAgICAgICAgICAgICA8cCBjbGFzc05hbWU9XCJmbGV4IGl0ZW1zLWNlbnRlciBnYXAtMS41XCI+XHJcbiAgICAgICAgICAgICAgICAgIDxzcGFuIGNsYXNzTmFtZT1cImgtMS41IHctMS41IGJnLWVtZXJhbGQtNTAwIHJvdW5kZWQtZnVsbCBpbmxpbmUtYmxvY2tcIiAvPlxyXG4gICAgICAgICAgICAgICAgICBQb3N0Z3JlU1FMIENvbm5lY3TDqSAoQ2xvdWQgU1FMKVxyXG4gICAgICAgICAgICAgICAgPC9wPlxyXG4gICAgICAgICAgICAgIDwvZGl2PlxyXG4gICAgICAgICAgICA8L2Rpdj5cclxuICAgICAgICAgICl9XHJcbiAgICAgICAgPC9hc2lkZT5cclxuXHJcbiAgICAgICAgey8qIFdPUktTUEFDRSBDRU5UUkFMIEJPQVJEICovfVxyXG4gICAgICAgIDxtYWluIGNsYXNzTmFtZT1cImZsZXgtMSBtaW4tdy0wXCIgaWQ9XCJtYWluLXZpZXdwb3J0XCI+XHJcbiAgICAgICAgICBcclxuICAgICAgICAgIHsvKiBFcnJvciB3YXJuaW5nIG5vdGlmaWNhdGlvbiBiYW5uZXJzICovfVxyXG4gICAgICAgICAge3Zpc2libGVFcnJvck1zZyAmJiAoXHJcbiAgICAgICAgICAgIDxkaXYgY2xhc3NOYW1lPVwiYmctcm9zZS01MCBib3JkZXIgYm9yZGVyLXJvc2UtMTAwIHAtNCByb3VuZGVkLTJ4bCBtYi02IGZsZXggaXRlbXMtc3RhcnQgZ2FwLTMgYW5pbWF0ZS1mYWRlLWluIHRleHQteHMgc206dGV4dC1zbVwiPlxyXG4gICAgICAgICAgICAgIDxBbGVydENpcmNsZSBjbGFzc05hbWU9XCJoLTUgdy01IHRleHQtcm9zZS01MDAgc2hyaW5rLTAgbXQtMC41XCIgLz5cclxuICAgICAgICAgICAgICA8ZGl2IGNsYXNzTmFtZT1cInNwYWNlLXktMSBsZWFkaW5nLXJlbGF4ZWRcIj5cclxuICAgICAgICAgICAgICAgIDxwIGNsYXNzTmFtZT1cImZvbnQtYm9sZCB0ZXh0LXJvc2UtODAwXCI+QWxlcnRlIFN5c3TDqG1lPC9wPlxyXG4gICAgICAgICAgICAgICAgPHAgY2xhc3NOYW1lPVwidGV4dC1yb3NlLTcwMFwiPnt2aXNpYmxlRXJyb3JNc2d9PC9wPlxyXG4gICAgICAgICAgICAgIDwvZGl2PlxyXG4gICAgICAgICAgICAgIDxidXR0b24gb25DbGljaz17KCkgPT4gc2V0RXJyb3JNc2cobnVsbCl9IGNsYXNzTmFtZT1cIm1sLWF1dG8gdGV4dC1yb3NlLTQwMCBmb250LWJvbGQgaG92ZXI6dGV4dC1yb3NlLTYwMCBjdXJzb3ItcG9pbnRlclwiPuKclTwvYnV0dG9uPlxyXG4gICAgICAgICAgICA8L2Rpdj5cclxuICAgICAgICAgICl9XHJcblxyXG4gICAgICAgICAgey8qIExPQURJTkcgU0NSRUVOICovfVxyXG4gICAgICAgICAge2lzU3luY2luZyAmJiAoXHJcbiAgICAgICAgICAgIDxkaXYgY2xhc3NOYW1lPVwiYmctd2hpdGUvNjAgcC0xMiB0ZXh0LWNlbnRlciByb3VuZGVkLTJ4bCBib3JkZXIgYm9yZGVyLXNsYXRlLTUwIHNoYWRvdy1zbSBmbGV4IGZsZXgtY29sIGp1c3RpZnktY2VudGVyIGl0ZW1zLWNlbnRlciBnYXAtMyBteS0xMlwiPlxyXG4gICAgICAgICAgICAgIDxSZWZyZXNoQ3cgY2xhc3NOYW1lPVwiaC0xMCB3LTEwIHRleHQtaW5kaWdvLTYwMCBhbmltYXRlLXNwaW5cIiAvPlxyXG4gICAgICAgICAgICAgIDxwIGNsYXNzTmFtZT1cInRleHQteHMgdGV4dC1zbGF0ZS01MDAgZm9udC1tZWRpdW1cIj5TeW5jaHJvbmlzYXRpb24gZGVzIHJlZ2lzdHJlcyBlbiB0ZW1wcyByw6llbC4uLjwvcD5cclxuICAgICAgICAgICAgPC9kaXY+XHJcbiAgICAgICAgICApfVxyXG5cclxuICAgICAgICAgIHsvKiBEWU5BTUlDIFJFTkRFUklORyBQQU5FTCBCQVNFRCBPTiBBQ1RJVkUgVEFCUyAqL31cclxuICAgICAgICAgIHshaXNTeW5jaW5nICYmIChcclxuICAgICAgICAgICAgPGRpdiBjbGFzc05hbWU9XCJiZy13aGl0ZSBwLTYgYm9yZGVyIGJvcmRlci1zbGF0ZS0xMDAgcm91bmRlZC0yeGwgc2hhZG93LXNtIHRyYW5zaXRpb24tYWxsIGFuaW1hdGUtZmFkZS1pblwiIGlkPVwiY29udGVudC1jYXJkXCI+XHJcbiAgICAgICAgICAgICAge2FjdGl2ZVRhYiA9PT0gJ3RhYmxlYXUtZGUtYm9yZCcgJiYgKFxyXG4gICAgICAgICAgICAgICAgPERhc2hib2FyZFZpZXdcclxuICAgICAgICAgICAgICAgICAgc3RhdHM9e3N0YXRzfVxyXG4gICAgICAgICAgICAgICAgICByZWNlbnRBYnNlbmNlcz17c3VtbWFyeVJlY2VudEFic2VuY2VzfVxyXG4gICAgICAgICAgICAgICAgICByZWNlbnRHcmFkZXM9e3N1bW1hcnlSZWNlbnRHcmFkZXN9XHJcbiAgICAgICAgICAgICAgICAgIHVzZXJSb2xlPXtjdXJyZW50Um9sZX1cclxuICAgICAgICAgICAgICAgICAgY2hhcnREYXRhPXtjaGFydERhdGF9XHJcbiAgICAgICAgICAgICAgICAvPlxyXG4gICAgICAgICAgICAgICl9XHJcblxyXG4gICAgICAgICAgICAgIHthY3RpdmVUYWIgPT09ICdhZG1pbmlzdHJhdGlvbicgJiYgKFxyXG4gICAgICAgICAgICAgICAgPEVycm9yQm91bmRhcnk+XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgPEFkbWluVmlld1xyXG4gICAgICAgICAgICAgICAgICB1c2VyUm9sZT17Y3VycmVudFJvbGV9XHJcbiAgICAgICAgICAgICAgICAgIHNjaG9vbHNMaXN0PXtzY2hvb2xzTGlzdH1cclxuICAgICAgICAgICAgICAgICAgeWVhcnNMaXN0PXt5ZWFyc0xpc3R9XHJcbiAgICAgICAgICAgICAgICAgIGNsYXNzZXNMaXN0PXtjbGFzc2VzTGlzdH1cclxuICAgICAgICAgICAgICAgICAgdGVhY2hlcnNMaXN0PXt0ZWFjaGVyc0xpc3R9XHJcbiAgICAgICAgICAgICAgICAgIHN0dWRlbnRzTGlzdD17c3R1ZGVudHNMaXN0fVxyXG4gICAgICAgICAgICAgICAgICBwYXJlbnRzTGlzdD17cGFyZW50c0xpc3R9XHJcbiAgICAgICAgICAgICAgICAgIHVzZXJzTGlzdD17dXNlcnNMaXN0fVxyXG4gICAgICAgICAgICAgICAgICBzdWJqZWN0c0xpc3Q9e3N1YmplY3RzTGlzdH1cclxuICAgICAgICAgICAgICAgICAgYXBwcm92ZWRTdWJqZWN0c0xpc3Q9e2FwcHJvdmVkU3ViamVjdHNMaXN0fVxyXG4gICAgICAgICAgICAgICAgICBvbkFkZFNjaG9vbD17aGFuZGxlQWRkU2Nob29sfVxyXG4gICAgICAgICAgICAgICAgICBvblVwZGF0ZVNjaG9vbD17aGFuZGxlVXBkYXRlU2Nob29sfVxyXG4gICAgICAgICAgICAgICAgICBvblVwZGF0ZVN0dWRlbnQ9e2hhbmRsZVVwZGF0ZVN0dWRlbnR9XHJcbiAgICAgICAgICAgICAgICAgIG9uQWRkWWVhcj17aGFuZGxlQWRkWWVhcn1cclxuICAgICAgICAgICAgICAgICAgb25TZXRBY3RpdmVZZWFyPXtoYW5kbGVTZXRBY3RpdmVZZWFyfVxyXG4gICAgICAgICAgICAgICAgICBvbkRlbGV0ZVllYXI9e2hhbmRsZURlbGV0ZVllYXJ9XHJcbiAgICAgICAgICAgICAgICAgIG9uQWRkQ2xhc3M9e2hhbmRsZUFkZENsYXNzfVxyXG4gICAgICAgICAgICAgICAgICBvbkFkZFRlYWNoZXI9e2hhbmRsZUFkZFRlYWNoZXJ9XHJcbiAgICAgICAgICAgICAgICAgIG9uQWRkUGFyZW50PXtoYW5kbGVBZGRQYXJlbnR9XHJcbiAgICAgICAgICAgICAgICAgIG9uQWRkU3R1ZGVudD17aGFuZGxlQWRkU3R1ZGVudH1cclxuICAgICAgICAgICAgICAgICAgb25CYXRjaENyZWF0ZVN0dWRlbnRzPXtoYW5kbGVCYXRjaENyZWF0ZVN0dWRlbnRzfVxyXG4gICAgICAgICAgICAgICAgICBvbkJhdGNoQ3JlYXRlUGFyZW50cz17aGFuZGxlQmF0Y2hDcmVhdGVQYXJlbnRzfVxyXG4gICAgICAgICAgICAgICAgICBpbXBvcnRSZXN1bHQ9e2ltcG9ydFJlc3VsdH1cclxuICAgICAgICAgICAgICAgICAgb25DcmVhdGVVc2VyPXtoYW5kbGVDcmVhdGVVc2VyfVxyXG4gICAgICAgICAgICAgICAgICBvblVwZGF0ZVVzZXI9e2hhbmRsZVVwZGF0ZVVzZXJ9XHJcbiAgICAgICAgICAgICAgICAgIG9uU2V0UGFzc3dvcmQ9e2hhbmRsZVNldFBhc3N3b3JkfVxyXG4gICAgICAgICAgICAgICAgICBvbkRlbGV0ZVVzZXI9e2hhbmRsZURlbGV0ZVVzZXJ9XHJcbiAgICAgICAgICAgICAgICAgIG9uRGVsZXRlQ2xhc3M9e2hhbmRsZURlbGV0ZUNsYXNzfVxyXG4gICAgICAgICAgICAgICAgICBvbkRlbGV0ZVNjaG9vbD17aGFuZGxlRGVsZXRlU2Nob29sfVxyXG4gICAgICAgICAgICAgICAgICBvbkFkZFN1YmplY3Q9e2hhbmRsZUFkZFN1YmplY3R9XHJcbiAgICAgICAgICAgICAgICAgIG9uVXBkYXRlU3ViamVjdD17aGFuZGxlVXBkYXRlU3ViamVjdH1cclxuICAgICAgICAgICAgICAgICAgb25EZWxldGVTdWJqZWN0PXtoYW5kbGVEZWxldGVTdWJqZWN0fVxyXG4gICAgICAgICAgICAgICAgICBvbkFwcHJvdmVTdWJqZWN0PXtoYW5kbGVBcHByb3ZlU3ViamVjdH1cclxuICAgICAgICAgICAgICAgICAgb25SZWplY3RTdWJqZWN0PXtoYW5kbGVSZWplY3RTdWJqZWN0fVxyXG4gICAgICAgICAgICAgICAgICBvbkFwcHJvdmVDbGFzcz17aGFuZGxlQXBwcm92ZUNsYXNzfVxyXG4gICAgICAgICAgICAgICAgICBvblJlamVjdENsYXNzPXtoYW5kbGVSZWplY3RDbGFzc31cclxuICAgICAgICAgICAgICAgICAgY3VycmVudFNjaG9vbElkPXtjdXJyZW50U2Nob29sSWR9XHJcbiAgICAgICAgICAgICAgICAgIC8+XHJcbiAgICAgICAgICAgICAgICA8L0Vycm9yQm91bmRhcnk+XHJcbiAgICAgICAgICAgICAgKX1cclxuXHJcbiAgICAgICAgICAgICAge2FjdGl2ZVRhYiA9PT0gJ2Fic2VuY2VzJyAmJiAoXHJcbiAgICAgICAgICAgICAgICA8QWJzZW5jZVZpZXdcclxuICAgICAgICAgICAgICAgICAgdXNlclJvbGU9e2N1cnJlbnRSb2xlfVxyXG4gICAgICAgICAgICAgICAgICBhYnNlbmNlc0xpc3Q9e2Fic2VuY2VzTGlzdH1cclxuICAgICAgICAgICAgICAgICAgc3R1ZGVudHNMaXN0PXtzdHVkZW50c0xpc3R9XHJcbiAgICAgICAgICAgICAgICAgIGNsYXNzZXNMaXN0PXtjbGFzc2VzTGlzdH1cclxuICAgICAgICAgICAgICAgICAgc2Nob29sc0xpc3Q9e3NjaG9vbHNMaXN0fVxyXG4gICAgICAgICAgICAgICAgICB0ZWFjaGVyc0xpc3Q9e3RlYWNoZXJzTGlzdH1cclxuICAgICAgICAgICAgICAgICAgYXBwcm92ZWRTdWJqZWN0c0xpc3Q9e2FwcHJvdmVkU3ViamVjdHNMaXN0fVxyXG4gICAgICAgICAgICAgICAgICB0ZWFjaGVyQ2xhc3NJZHM9e2N1cnJlbnRSb2xlID09PSAndGVhY2hlcicgPyBjdXJyZW50VGVhY2hlckNsYXNzSWRzIDogW119XHJcbiAgICAgICAgICAgICAgICAgIHRlYWNoZXJTcGVjaWFsaXphdGlvbnM9e2N1cnJlbnRSb2xlID09PSAndGVhY2hlcicgPyBjdXJyZW50VGVhY2hlclNwZWNpYWxpemF0aW9ucyA6IFtdfVxyXG4gICAgICAgICAgICAgICAgICBvbkFkZEFic2VuY2U9e2hhbmRsZUFkZEFic2VuY2V9XHJcbiAgICAgICAgICAgICAgICAgIG9uSnVzdGlmeUFic2VuY2U9e2hhbmRsZUp1c3RpZnlBYnNlbmNlfVxyXG4gICAgICAgICAgICAgICAgLz5cclxuICAgICAgICAgICAgICApfVxyXG5cclxuICAgICAgICAgICAgICB7YWN0aXZlVGFiID09PSAnbm90ZXMnICYmIChcclxuICAgICAgICAgICAgICAgIGN1cnJlbnRSb2xlID09PSAncGFyZW50JyA/IChcclxuICAgICAgICAgICAgICAgICAgPFBhcmVudE5vdGVzVmlld1xyXG4gICAgICAgICAgICAgICAgICAgIGN1cnJlbnRSb2xlPXtjdXJyZW50Um9sZX1cclxuICAgICAgICAgICAgICAgICAgICBzdHVkZW50c0xpc3Q9e3N0dWRlbnRzTGlzdH1cclxuICAgICAgICAgICAgICAgICAgICBwYXJlbnRzTGlzdD17cGFyZW50c0xpc3R9XHJcbiAgICAgICAgICAgICAgICAgICAgZ3JhZGVzTGlzdD17Z3JhZGVzTGlzdH1cclxuICAgICAgICAgICAgICAgICAgICBldmFsdWF0aW9uc0xpc3Q9e2FjdGl2ZUV2YWx1YXRpb25zfVxyXG4gICAgICAgICAgICAgICAgICAvPlxyXG4gICAgICAgICAgICAgICAgKSA6IChcclxuICAgICAgICAgICAgICAgICAgPE5vdGVzVmlld1xyXG4gICAgICAgICAgICAgICAgICAgIGV2YWx1YXRpb25zTGlzdD17YWN0aXZlRXZhbHVhdGlvbnN9XHJcbiAgICAgICAgICAgICAgICAgICAgZ3JhZGVzTGlzdD17Z3JhZGVzTGlzdH1cclxuICAgICAgICAgICAgICAgICAgICBzdHVkZW50c0xpc3Q9e3N0dWRlbnRzTGlzdH1cclxuICAgICAgICAgICAgICAgICAgICBjbGFzc2VzTGlzdD17Y2xhc3Nlc0xpc3R9XHJcbiAgICAgICAgICAgICAgICAgICAgc2Nob29sc0xpc3Q9e3NjaG9vbHNMaXN0fVxyXG4gICAgICAgICAgICAgICAgICAgIHNjaG9vbEZpbHRlcklkPXtzdXBlckFkbWluU2Nob29sRmlsdGVySWR9XHJcbiAgICAgICAgICAgICAgICAgICAgb25TY2hvb2xGaWx0ZXJDaGFuZ2U9e3NldFN1cGVyQWRtaW5TY2hvb2xGaWx0ZXJJZH1cclxuICAgICAgICAgICAgICAgICAgICB0ZWFjaGVyQ2xhc3NJZHM9e2N1cnJlbnRSb2xlID09PSAndGVhY2hlcicgPyBjdXJyZW50VGVhY2hlckNsYXNzSWRzIDogW119XHJcbiAgICAgICAgICAgICAgICAgICAgdGVhY2hlclNwZWNpYWxpemF0aW9ucz17Y3VycmVudFJvbGUgPT09ICd0ZWFjaGVyJyA/IGN1cnJlbnRUZWFjaGVyU3BlY2lhbGl6YXRpb25zIDogW119XHJcbiAgICAgICAgICAgICAgICAgICAgYXBwcm92ZWRTdWJqZWN0c0xpc3Q9e2FwcHJvdmVkU3ViamVjdHNMaXN0fVxyXG4gICAgICAgICAgICAgICAgICAgIHRlYWNoZXJJZD17Y3VycmVudFJvbGUgPT09ICd0ZWFjaGVyJyA/IGN1cnJlbnRUZWFjaGVyUHJvZmlsZT8uaWQgOiB1bmRlZmluZWR9XHJcbiAgICAgICAgICAgICAgICAgICAgb25BZGRFdmFsdWF0aW9uPXtoYW5kbGVBZGRFdmFsdWF0aW9ufVxyXG4gICAgICAgICAgICAgICAgICAgIG9uQWRkR3JhZGU9e2hhbmRsZUFkZEdyYWRlfVxyXG4gICAgICAgICAgICAgICAgICAvPlxyXG4gICAgICAgICAgICAgICAgKVxyXG4gICAgICAgICAgICAgICl9XHJcblxyXG4gICAgICAgICAgICAgIHthY3RpdmVUYWIgPT09ICdhcmNoaXZlJyAmJiBjdXJyZW50Um9sZSAhPT0gJ3BhcmVudCcgJiYgKFxyXG4gICAgICAgICAgICAgICAgPEFyY2hpdmVWaWV3XHJcbiAgICAgICAgICAgICAgICAgIHVzZXJSb2xlPXtjdXJyZW50Um9sZX1cclxuICAgICAgICAgICAgICAgICAgZXZhbHVhdGlvbnNMaXN0PXthcmNoaXZlZEV2YWx1YXRpb25zfVxyXG4gICAgICAgICAgICAgICAgICBncmFkZXNMaXN0PXtncmFkZXNMaXN0fVxyXG4gICAgICAgICAgICAgICAgICBzdHVkZW50c0xpc3Q9e3N0dWRlbnRzTGlzdH1cclxuICAgICAgICAgICAgICAgICAgY2xhc3Nlc0xpc3Q9e2NsYXNzZXNMaXN0fVxyXG4gICAgICAgICAgICAgICAgICBzY2hvb2xzTGlzdD17c2Nob29sc0xpc3R9XHJcbiAgICAgICAgICAgICAgICAgIHNjaG9vbEZpbHRlcklkPXtzdXBlckFkbWluU2Nob29sRmlsdGVySWR9XHJcbiAgICAgICAgICAgICAgICAgIG9uU2Nob29sRmlsdGVyQ2hhbmdlPXtzZXRTdXBlckFkbWluU2Nob29sRmlsdGVySWR9XHJcbiAgICAgICAgICAgICAgICAgIHRlYWNoZXJDbGFzc0lkcz17Y3VycmVudFJvbGUgPT09ICd0ZWFjaGVyJyA/IGN1cnJlbnRUZWFjaGVyQ2xhc3NJZHMgOiBbXX1cclxuICAgICAgICAgICAgICAgICAgdGVhY2hlcklkPXtjdXJyZW50Um9sZSA9PT0gJ3RlYWNoZXInID8gY3VycmVudFRlYWNoZXJQcm9maWxlPy5pZCA6IHVuZGVmaW5lZH1cclxuICAgICAgICAgICAgICAgIC8+XHJcbiAgICAgICAgICAgICAgKX1cclxuXHJcbiAgICAgICAgICAgICAge2FjdGl2ZVRhYiA9PT0gJ2J1bGxldGlucycgJiYgKGN1cnJlbnRSb2xlID09PSAnc2Nob29sX2FkbWluJyB8fCBjdXJyZW50Um9sZSA9PT0gJ3N1cGVyX2FkbWluJyB8fCBjdXJyZW50Um9sZSA9PT0gJ3RlYWNoZXInKSAmJiAoXHJcbiAgICAgICAgICAgICAgICA8QnVsbGV0aW5zVmlld1xyXG4gICAgICAgICAgICAgICAgICBzY2hvb2xzTGlzdD17c2Nob29sc0xpc3R9XHJcbiAgICAgICAgICAgICAgICAgIGNsYXNzZXNMaXN0PXtjbGFzc2VzTGlzdH1cclxuICAgICAgICAgICAgICAgICAgc3R1ZGVudHNMaXN0PXtzdHVkZW50c0xpc3R9XHJcbiAgICAgICAgICAgICAgICAgIGV2YWx1YXRpb25zTGlzdD17YWN0aXZlRXZhbHVhdGlvbnN9XHJcbiAgICAgICAgICAgICAgICAgIGdyYWRlc0xpc3Q9e2dyYWRlc0xpc3R9XHJcbiAgICAgICAgICAgICAgICAgIHRlYWNoZXJDbGFzc0lkcz17Y3VycmVudFJvbGUgPT09ICd0ZWFjaGVyJyA/IGN1cnJlbnRUZWFjaGVyQ2xhc3NJZHMgOiBbXX1cclxuICAgICAgICAgICAgICAgIC8+XHJcbiAgICAgICAgICAgICAgKX1cclxuXHJcbiAgICAgICAgICAgICAge2FjdGl2ZVRhYiA9PT0gJ2F1ZGl0JyAmJiBjdXJyZW50Um9sZSA9PT0gJ3N1cGVyX2FkbWluJyAmJiAoXHJcbiAgICAgICAgICAgICAgICA8QXVkaXRWaWV3XHJcbiAgICAgICAgICAgICAgICAgIGF1ZGl0RXZlbnRzPXthdWRpdEV2ZW50c31cclxuICAgICAgICAgICAgICAgICAgaXNMb2FkaW5nPXtpc0F1ZGl0TG9hZGluZ31cclxuICAgICAgICAgICAgICAgICAgb25SZWxvYWQ9e2ZldGNoQXVkaXRFdmVudHN9XHJcbiAgICAgICAgICAgICAgICAvPlxyXG4gICAgICAgICAgICAgICl9XHJcblxyXG4gICAgICAgICAgICAgIHthY3RpdmVUYWIgPT09ICdub3RpZmljYXRpb25zJyAmJiAoXHJcbiAgICAgICAgICAgICAgICA8Tm90aWZpY2F0aW9uVmlld1xyXG4gICAgICAgICAgICAgICAgICB1c2VyUm9sZT17Y3VycmVudFJvbGV9XHJcbiAgICAgICAgICAgICAgICAgIG5vdGlmaWNhdGlvbnNMaXN0PXtub3RpZmljYXRpb25zTGlzdH1cclxuICAgICAgICAgICAgICAgICAgdXNlcnNMaXN0PXt1c2Vyc0xpc3R9XHJcbiAgICAgICAgICAgICAgICAgIG9uU2VuZE5vdGlmaWNhdGlvbj17aGFuZGxlU2VuZE5vdGlmaWNhdGlvbn1cclxuICAgICAgICAgICAgICAgICAgb25NYXJrQWxsQXNSZWFkPXtoYW5kbGVNYXJrQWxsQXNSZWFkfVxyXG4gICAgICAgICAgICAgICAgICBvbk5vdGlmaWNhdGlvblJlYWQ9e2hhbmRsZU5vdGlmaWNhdGlvblJlYWR9XHJcbiAgICAgICAgICAgICAgICAvPlxyXG4gICAgICAgICAgICAgICl9XHJcblxyXG4gICAgICAgICAgICAgIHthY3RpdmVUYWIgPT09ICdtb2JpbGUtcGFyZW50JyAmJiAoXHJcbiAgICAgICAgICAgICAgICA8TW9iaWxlUGFyZW50Vmlld1xyXG4gICAgICAgICAgICAgICAgICBzdHVkZW50c0xpc3Q9e3N0dWRlbnRzTGlzdH1cclxuICAgICAgICAgICAgICAgICAgcGFyZW50c0xpc3Q9e3BhcmVudHNMaXN0fVxyXG4gICAgICAgICAgICAgICAgICBhYnNlbmNlc0xpc3Q9e2Fic2VuY2VzTGlzdH1cclxuICAgICAgICAgICAgICAgICAgZ3JhZGVzTGlzdD17Z3JhZGVzTGlzdH1cclxuICAgICAgICAgICAgICAgICAgbm90aWZpY2F0aW9uc0xpc3Q9e25vdGlmaWNhdGlvbnNMaXN0fVxyXG4gICAgICAgICAgICAgICAgICBvbkp1c3RpZnlBYnNlbmNlPXtoYW5kbGVKdXN0aWZ5QWJzZW5jZX1cclxuICAgICAgICAgICAgICAgICAgb25Ob3RpZmljYXRpb25SZWFkPXtoYW5kbGVOb3RpZmljYXRpb25SZWFkfVxyXG4gICAgICAgICAgICAgICAgLz5cclxuICAgICAgICAgICAgICApfVxyXG4gICAgICAgICAgICA8L2Rpdj5cclxuICAgICAgICAgICl9XHJcblxyXG4gICAgICAgIDwvbWFpbj5cclxuXHJcbiAgICAgIDwvZGl2PlxyXG4gICAgPC9kaXY+XHJcbiAgKTtcclxufVxyXG4iXSwiZmlsZSI6IkQ6L1Byb2pldCBBWUlTU09VL3dlYiBlY29sZXMvc3JjL0FwcC50c3gifQ==