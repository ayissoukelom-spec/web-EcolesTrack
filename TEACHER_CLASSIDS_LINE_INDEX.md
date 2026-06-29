# Teacher ClassIds - Complete Line-by-Line Index

## QUICK FACTS

| Aspect | File | Line(s) | Status |
|--------|------|---------|--------|
| 🔄 **Fetch /api/teachers** | App.tsx | 201 | Active |
| 🔄 **Fetch /api/teachers** | AppShell.tsx | 99 | Active |
| 💾 **Store in state** | App.tsx | 209 | Direct assignment |
| 💾 **Store in state** | AppShell.tsx | 104 | Direct assignment |
| 📊 **Pass to AdminView** | App.tsx | 751, 957 | Via prop |
| 📊 **Pass to AdminView** | AppShell.tsx | 352, 449 | Via prop |
| 🔍 **Filter teachers** | AdminView.tsx | 555-557 | Uses classIds |
| 📋 **Display table** | AdminView.tsx | 3261-3310 | Shows classIds |
| 👁️ **Detail modal** | AdminView.tsx | 2212 | Shows classIds |
| ✏️ **Edit form** | AdminView.tsx | 3281 | Pulls classIds |
| 🌐 **Backend response** | server.ts | 1955 | Adds classIds |
| 🌐 **Backend response** | server.ts | 353 | Adds classIds (users) |
| 🌐 **Backend query** | server.ts | 1938-1953 | Builds classIds map |
| 🌐 **Backend query** | server.ts | 340-353 | Builds classIds map (users) |

---

## FRONTEND DATA SOURCES

### 1. FETCH LOCATIONS

#### App.tsx [Line 190-230]
```typescript
const fetchAllData = async (showSpinner = true) => {
  // ...auth and summary...
  
  const endpoints = [
    '/api/schools',
    '/api/academic-years',
    '/api/classes',
    '/api/teachers',              // ← LINE 194
    '/api/students',
    '/api/parents',
    '/api/absences',
    '/api/evaluations',
    '/api/grades',
    '/api/notifications',
    '/api/subjects',
    '/api/subjects?approvedOnly=true',
    '/api/simulation/users',      // ← LINE 207
  ];
  
  const promises = endpoints.map(e => apiFetch(e).catch(...));  // LINE 200-201
  const results = await Promise.all(promises);
  
  const map = Object.fromEntries(endpoints.map((e, i) => [e, results[i]]));  // LINE 204
  
  logTeachersPayload('RAW_API_RESPONSE_/api/teachers', results[endpoints.indexOf('/api/teachers')]);  // LINE 205
  logTeachersPayload('MAP_/api/teachers', map['/api/teachers']);  // LINE 206
  
  if (Array.isArray(map['/api/teachers'])) {
    logTeachersPayload('BEFORE_SET_TEACHERSLIST', map['/api/teachers']);  // LINE 208
    setTeachersList(map['/api/teachers']);  // ← LINE 209 - SET STATE
  }
  if (Array.isArray(map['/api/schools'])) setSchoolsList(map['/api/schools']);  // LINE 211
  // ... more state setters ...
  if (Array.isArray(map['/api/simulation/users'])) setUsersList(map['/api/simulation/users']);  // LINE 226
};
```

**Triggered by:** [Line 263-268]
```typescript
useEffect(() => {
  if (currentRole !== 'super_admin') {
    setSuperAdminSchoolFilterId(null);
  }
  if (currentRole) fetchAllData();  // ← TRIGGER ON ROLE CHANGE
}, [currentRole]);
```

#### AppShell.tsx [Line 60-110]
```typescript
const fetchAllData = async (showSpinner = true) => {
  if (showSpinner) setIsSyncing(true);
  setErrorMsg(null);
  try {
    await apiFetch('/api/auth/register-or-login', { method: 'POST' });
    await Promise.all([refreshDashboard(), refreshClasses(), refreshStudents(), refreshAbsences()]);  // LINE 86

    const endpoints = [
      '/api/schools',           // LINE 89
      '/api/academic-years',
      '/api/teachers',          // ← LINE 91
      '/api/parents',
      '/api/evaluations',
      '/api/grades',
      '/api/notifications',
      '/api/simulation/users',  // ← LINE 97
    ];

    const results = await Promise.all(endpoints.map((endpoint) => apiFetch(endpoint).catch(...)));  // LINE 99
    const map = Object.fromEntries(endpoints.map((endpoint, index) => [endpoint, results[index]]));  // LINE 100

    setSchoolsList(Array.isArray(map['/api/schools']) ? map['/api/schools'] : []);  // LINE 102
    setYearsList(Array.isArray(map['/api/academic-years']) ? map['/api/academic-years'] : []);  // LINE 103
    setTeachersList(Array.isArray(map['/api/teachers']) ? map['/api/teachers'] : []);  // ← LINE 104 - SET STATE
    setParentsList(Array.isArray(map['/api/parents']) ? map['/api/parents'] : []);  // LINE 105
    setEvaluationsList(Array.isArray(map['/api/evaluations']) ? map['/api/evaluations'] : []);  // LINE 106
    setGradesList(Array.isArray(map['/api/grades']) ? map['/api/grades'] : []);  // LINE 107
    setNotificationsList(Array.isArray(map['/api/notifications']) ? map['/api/notifications'] : []);  // LINE 108
    setUsersList(Array.isArray(map['/api/simulation/users']) ? map['/api/simulation/users'] : []);  // LINE 109
  } catch (err: any) {
    console.error('Error hydrating EcoleTrack database:', err);
    setErrorMsg(err.message || 'Impossible de charger les données EcoleTrack.');
  } finally {
    setIsSyncing(false);
  }
};
```

---

### 2. STATE INITIALIZATION

#### App.tsx [Line 74]
```typescript
const [teachersList, setTeachersList] = useState<Teacher[]>([]);
```

#### AppShell.tsx [Line 33]
```typescript
const [teachersList, setTeachersList] = useState<Teacher[]>([]);
```

#### Types.ts [Line 68]
```typescript
export interface Teacher {
  id: number;
  userId: number;
  uid?: string;
  name: string;
  email: string;
  phone?: string;
  specialization?: string | string[];
  schoolId: number;
  classIds?: number[];  // ← DEFINED HERE
  gender?: string;
}
```

---

### 3. PROP PASSING TO COMPONENTS

#### App.tsx [Line 751]
```typescript
<BulletinsView
  userRole={currentRole}
  schoolsList={schoolsList}
  yearsList={yearsList}
  teachersList={teachersList}  // ← PASSED HERE
  studentsList={studentsList}
  // ... other props
/>
```

#### App.tsx [Line 957]
```typescript
<AdminView
  userRole={currentRole}
  schoolsList={schoolsList}
  yearsList={yearsList}
  classesList={classesList}
  teachersList={teachersList}  // ← PASSED HERE
  studentsList={studentsList}
  parentsList={parentsList}
  usersList={usersList}
  // ... handlers
/>
```

#### AppShell.tsx [Line 352]
```typescript
<AdminView
  userRole={currentRole}
  schoolsList={schoolsList}
  yearsList={yearsList}
  classesList={classesList}
  teachersList={teachersList}  // ← PASSED HERE
  studentsList={studentsList}
  parentsList={parentsList}
  usersList={usersList}
  // ... handlers
/>
```

#### AppShell.tsx [Line 449]
```typescript
<BulletinsView
  userRole={currentRole}
  schoolsList={schoolsList}
  yearsList={yearsList}
  teachersList={teachersList}  // ← PASSED HERE
  // ... other props
/>
```

---

### 4. ADMINVIEW PROP DEFINITION

#### AdminView.tsx [Line 355]
```typescript
interface AdminViewProps {
  userRole: UserRole;
  schoolsList: School[];
  yearsList: AcademicYear[];
  classesList: Class[];
  teachersList: Teacher[];  // ← RECEIVED HERE
  studentsList: Student[];
  parentsList: Parent[];
  // ... many other props
}
```

#### AdminView.tsx [Line 393]
```typescript
export default function AdminView({
  userRole,
  schoolsList,
  yearsList,
  classesList,
  teachersList,  // ← DESTRUCTURED HERE
  studentsList,
  parentsList,
  // ... many other destructured props
}: AdminViewProps) {
```

---

## FRONTEND USAGE - WHERE classIds IS CONSUMED

### 1. FILTERING LOGIC

#### AdminView.tsx [Line 555-557]
```typescript
const filteredTeachersList = teachersList.filter((t) =>
  (userRole !== 'super_admin' || !superAdminSchoolFilterId || t.schoolId === superAdminSchoolFilterId) &&
  (!teacherClassFilterId || (t.classIds || []).includes(teacherClassFilterId)) &&  // ← USES classIds
  filterBySearch(t.name)
);
```

### 2. TABLE DISPLAY

#### AdminView.tsx [Line 3261-3310]
```typescript
{filteredTeachersList.map((tc) => (
  <tr key={tc.id} className="hover:bg-slate-50/60 transition-colors">
    <td className="px-6 py-4 font-bold text-slate-800">{tc.name}</td>  // ← LINE 3263
    <td className="px-6 py-4 text-slate-500 font-mono text-xs">{tc.email}</td>  // ← LINE 3264
    <td className="px-6 py-4 text-slate-500">{schoolsList.find((s) => s.id === tc.schoolId)?.name || '—'}</td>  // ← LINE 3265
    <td className="px-6 py-4 text-indigo-700 font-semibold text-xs bg-indigo-50/40 inline-block my-2 mx-6 py-1 px-2.5 rounded-lg border border-indigo-100">{tc.specialization || 'Général'}</td>  // ← LINE 3266
    <td className="px-6 py-4 text-slate-500">{tc.phone || '—'}</td>  // ← LINE 3267
    <td className="px-6 py-4 text-right space-x-2">
      <button
        onClick={() => openTeacherDetail(tc)}  // ← LINE 3270
        className="inline-flex items-center gap-2 px-3 py-2 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg text-slate-700 text-xs font-semibold transition-colors"
        title="Voir le détail de l'enseignant"
      >
        <Eye className="h-3.5 w-3.5" />
        Voir
      </button>
      <button
        onClick={() => {
          const user = usersList.find((u) => u.id === tc.userId);  // ← LINE 3279
          if (!user) return;
          const assignedClassIds = tc.classIds || [];  // ← LINE 3281 - PULLS classIds FROM tc
          setUserToEdit(user);
          setUserForm({
            email: user.email,
            name: user.name,
            role: 'teacher',
            schoolId: user.schoolId ? String(user.schoolId) : '',
            academicYearId: '',
            phone: (user as any).phone || '',
            specialization: Array.isArray((user as any).specialization)
              ? (user as any).specialization
              : String((user as any).specialization || '')
                  .split(',')
                  .map((s) => s.trim())
                  .filter(Boolean),
            gender: (user as any).gender || '',
            assignedClassIds,  // ← LINE 3306 - POPULATED IN FORM
          });
          setEditUserOpen(true);  // ← LINE 3308
        }}
        className="inline-flex items-center gap-2 px-3 py-2 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 rounded-lg text-indigo-700 text-xs font-semibold transition-colors"
        title="Modifier l'enseignant"
      >
        Modifier
      </button>
    </td>
  </tr>
))}
```

### 3. TEACHER DETAIL MODAL

#### AdminView.tsx [Line 1399]
```typescript
const openTeacherDetail = (teacher: Teacher) => {
  const resolvedClasses = (teacher.classIds || []).map((id) => ({ id, className: classesList.find((c) => c.id === id)?.name }));  // ← LINE 1403
  setTeacherDetailState(resolvedClasses);
  setTeacherDetail(teacher);  // ← LINE 1405
  setTeacherDetailOpen(true);  // ← LINE 1406
};
```

#### AdminView.tsx [Line 2190-2220]
```typescript
{teacherDetailOpen && teacherDetail && (
  <div>
    {/* ... other details ... */}
    <div><strong>Classes assignées:</strong> 
      {(teacherDetail.classIds || [])  // ← LINE 2212 - DISPLAYS classIds
        .map((id) => classesList.find((c) => c.id === id)?.name)
        .filter(Boolean)
        .join(', ') || 'Aucune'}
    </div>
  </div>
)}
```

### 4. ACCOUNTS TAB - TEACHER PROFILE LOOKUP

#### AdminView.tsx [Line 3565-3620]
```typescript
{filteredAccountsList.map((user) => (
  <tr key={user.id} className="hover:bg-slate-50/60 transition-colors">
    <td className="px-6 py-4 font-bold text-slate-800">{user.name}</td>  // ← LINE 3612
    <td className="px-6 py-4 text-slate-500 font-mono text-xs">{user.email}</td>  // ← LINE 3613
    <td className="px-6 py-4 text-slate-700 capitalize">{user.role.replace('_', ' ')}</td>  // ← LINE 3614
    <td className="px-6 py-4 text-slate-500">{(() => {
      const teacherProfile = teachersList.find((t) => t.userId === user.id);  // ← LINE 3617
      const sid = user.schoolId ?? teacherProfile?.schoolId ?? null;
      return sid ? (schoolsList.find((s) => s.id === Number(sid))?.name || '—') : '—';
    })()}</td>  // ← LINE 3618
    {/* ... other fields ... */}
    <td className="px-6 py-4 text-right space-x-2">
      <button
        onClick={() => {
          const teacherProfile = teachersList.find((t) => t.userId === user.id);  // ← LINE 3626
          const assignedClassIds = teacherProfile ? (teacherProfile.classIds || []) : [];  // ← LINE 3627 - PULLS classIds
          const rawPhone = (user as any).phone || '';
          const strippedPhoneDigits = rawPhone.replace(/\D/g, '');
          const normalizedPhone = strippedPhoneDigits.length === 11 && strippedPhoneDigits.startsWith('228')
            ? strippedPhoneDigits.slice(3)
            : strippedPhoneDigits;
          setUserToEdit(user);
          setUserForm({
            email: user.email,
            name: user.name,
            role: user.role,
            schoolId: user.schoolId ? String(user.schoolId) : '',
            academicYearId: (user as any).academicYearId ? String((user as any).academicYearId) : '',
            phone: normalizedPhone,
            specialization: (user as any).specialization || '',
            gender: (user as any).gender || '',
            assignedClassIds,  // ← POPULATED FORM
          });
          setEditUserOpen(true);  // ← LINE 3641
        }}
        className="p-1 px-2.5 bg-slate-100 hover:bg-slate-200 border border-slate-200 text-slate-700 rounded-lg text-xs font-semibold transition-colors"
        title="Modifier"
      >
        Modifier
      </button>
    </td>
  </tr>
))}
```

---

## BACKEND DATA GENERATION

### 1. GET /api/teachers

#### server.ts [Line 1898-1957]
```typescript
// 4. Teachers - Filtered by school
app.get('/api/teachers', requireAuth, async (req: AuthRequest, res) => {  // ← LINE 1898
  try {
    if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });
    
    const [user] = await db.select().from(users).where(eq(users.uid, req.user.uid));
    if (!user) return res.status(404).json({ error: 'User not found' });

    let query = db
      .select({
        id: teachers.id,
        userId: teachers.userId,
        uid: users.uid,
        name: users.name,
        email: users.email,
        gender: users.gender,
        phone: teachers.phone,
        specialization: teachers.specialization,
        schoolId: teachers.schoolId,
      })  // ← LINE 1918 - NOTE: No classIds here yet
      .from(teachers)
      .innerJoin(users, eq(teachers.userId, users.id));

    if (user.role !== 'super_admin') {
      // School admin and others see only their school's teachers
      if (user.schoolId) {
        query = query.where(eq(teachers.schoolId, user.schoolId)) as any;  // ← LINE 1928
      } else {
        return res.json([]);
      }
    }

    const teachersList = await query;
    const teacherIds = teachersList.map((teacher) => teacher.id).filter(Boolean);

    let assignments: Array<{ teacherId: number; classId: number }> = [];
    if (teacherIds.length > 0) {
      assignments = await db
        .select({ teacherId: classTeachers.teacherId, classId: classTeachers.classId })  // ← LINE 1938-1940 - QUERY classIds
        .from(classTeachers)
        .where(inArray(classTeachers.teacherId, teacherIds));
    }

    console.log('GET /api/teachers - assignments count:', assignments.length);  // ← LINE 1940 - DEBUG LOG

    const assignmentMap = new Map<number, number[]>();
    assignments.forEach((item) => {
      const existing = assignmentMap.get(item.teacherId) || [];
      existing.push(item.classId);
      assignmentMap.set(item.teacherId, existing);
    });  // ← LINE 1950 - BUILD MAP

    const list = teachersList.map((teacher) => ({
      ...teacher,
      classIds: assignmentMap.get(teacher.id) || [],  // ← LINE 1955 - ADD classIds TO RESPONSE
    }));

    res.json(list);  // ← LINE 1956 - SEND RESPONSE
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to retrieve teachers list' });
  }
});
```

### 2. GET /api/simulation/users

#### server.ts [Line 259-363]
```typescript
app.get('/api/simulation/users', requireAuth, async (req: AuthRequest, res) => {  // ← LINE 259
  try {
    const actor = await resolveActor(req);  // ← LINE 260
    if (!actor) return res.status(401).json({ error: 'Unauthenticated' });

    // Build filter conditions
    let filterConditions: any = eq(users.isDeleted, false);

    // Apply role-based filtering
    if (actor.role === 'school_admin' && actor.schoolId) {
      filterConditions = and(
        filterConditions,
        eq(users.schoolId, actor.schoolId),  // ← LINE 272 - FILTER BY SCHOOL
        notInArray(users.role, ['super_admin'])
      );
    } else if (actor.role === 'super_admin') {
      // Super admin sees all users (only filter by isDeleted)
    } else if (actor.role === 'parent') {
      if (!actor.id) {
        return res.json([]);
      }
      filterConditions = and(filterConditions, eq(users.id, actor.id));
    } else if (actor.role === 'teacher') {
      // Teachers are not allowed to list simulation users (they can only view students)
      return res.status(403).json({ error: 'Forbidden' });  // ← LINE 286
    } else {
      // Other roles cannot access this list
      return res.status(403).json({ error: 'Forbidden' });
    }

    const allUsers = await db
      .select({
        id: users.id,
        uid: users.uid,
        email: users.email,
        name: users.name,
        role: users.role,
        schoolId: users.schoolId,
        academicYearId: users.academicYearId,
        isDeleted: users.isDeleted,
        createdAt: users.createdAt,
        teacherId: teachers.id,
        teacherPhone: teachers.phone,
        teacherSpecialization: teachers.specialization,
        parentPhone: parents.phone,
      })  // ← LINE 304-312 - JOIN WITH TEACHERS
      .from(users)
      .leftJoin(teachers, eq(teachers.userId, users.id))
      .leftJoin(parents, eq(parents.userId, users.id))
      .where(filterConditions);  // ← LINE 313

    const normalizedById = allUsers.reduce((acc: Record<number, any>, user: any) => {
      if (!acc[user.id]) {
        acc[user.id] = {
          id: user.id,
          uid: user.uid,
          email: user.email,
          name: user.name,
          role: user.role,
          schoolId: user.schoolId,
          academicYearId: user.academicYearId,
          isDeleted: user.isDeleted,
          createdAt: user.createdAt,
          phone: user.teacherPhone || user.parentPhone || null,
          specialization: user.teacherSpecialization || null,
          classIds: [],  // ← LINE 327 - INITIALIZE EMPTY
          _teacherId: user.teacherId,
        };
      }
      return acc;
    }, {});  // ← LINE 331 - BUILD NORMALIZED MAP

    const teacherIds = Object.values(normalizedById)
      .map((user: any) => user._teacherId)
      .filter((id: any) => id != null);  // ← LINE 336 - COLLECT TEACHER IDS

    if (teacherIds.length > 0) {
      const assignmentRows = await db
        .select({ teacherId: classTeachers.teacherId, classId: classTeachers.classId })  // ← LINE 340-341 - QUERY classIds
        .from(classTeachers)
        .where(inArray(classTeachers.teacherId, teacherIds));

      const assignmentMap = new Map<number, number[]>();
      assignmentRows.forEach((item) => {
        const existing = assignmentMap.get(item.teacherId) || [];
        existing.push(item.classId);
        assignmentMap.set(item.teacherId, existing);
      });  // ← LINE 350 - BUILD MAP

      Object.values(normalizedById).forEach((user: any) => {
        if (user._teacherId != null) {
          user.classIds = assignmentMap.get(user._teacherId) || [];  // ← LINE 353 - SET classIds
        }
        delete user._teacherId;  // ← LINE 355 - CLEANUP TEMP FIELD
      });
    } else {
      Object.values(normalizedById).forEach((user: any) => {
        delete user._teacherId;
      });  // ← LINE 357-360 - CLEANUP IF NO TEACHERS
    }

    res.json(Object.values(normalizedById));  // ← LINE 361 - SEND RESPONSE
  } catch (err: any) {
    console.error('Failed to retrieve simulation users:', err);
    res.status(500).json({ error: 'Failed to retrieve simulation users' });
  }
});
```

---

## NO TRANSFORMATIONS FOUND

### apiFetch (api.ts)
- [Line 188-238](src/lib/api.ts#L188-L238): Direct `return response.json()` - NO modification

### No State Mutations
- [App.tsx 209](src/App.tsx#L209): Direct `setTeachersList(map['/api/teachers'])`
- [AppShell.tsx 104](src/components/AppShell.tsx#L104): Direct assignment

### No Object Transformation
- Filtering only via `.filter()` which preserves all properties
- No `.map()` creating new Teacher objects
- No property removal or modification

---

## SUMMARY

**The data flow is clean and linear:**

1. ✅ Backend queries teacher data + joins with class_teachers table
2. ✅ Backend response includes classIds array
3. ✅ Frontend fetches via apiFetch (no modification)
4. ✅ Response stored directly in teachersList state
5. ✅ State passed to AdminView as prop
6. ✅ AdminView uses teachersList for filtering and display
7. ✅ classIds field accessed at line 3281 for edit forms
8. ✅ classIds field displayed at line 2212 in detail modal

**If UI shows classIds: [], issue is likely:**
- Backend response doesn't actually include classIds (check network tab)
- class_teachers table is empty or not being queried (check server logs)
- Role-based filtering prevents access to teacher (check actor.schoolId vs teacher.schoolId)
