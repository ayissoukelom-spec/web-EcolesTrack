# Teacher Data Sources - Quick Reference & Search Results

## Your Original Questions - ANSWERED

### ❓ 1. ALL places that fetch or retrieve teacher data

**API CALLS:**
- ✅ **GET /api/teachers** [App.tsx:201, AppShell.tsx:99]
- ✅ **GET /api/simulation/users** [App.tsx:201, AppShell.tsx:99] - Contains teacher users with classIds
- ✅ **POST /api/teachers** [App.tsx:447, AppShell.tsx:243] - Creates new teacher
- ✅ **POST /api/admin/users** [AppShell.tsx:276] - Creates teacher via user endpoint

**STATE VARIABLES:**
- ✅ `teachersList` [App.tsx:74, AppShell.tsx:33] - Primary state
- ✅ `usersList` [App.tsx:105, AppShell.tsx:109] - Contains teachers as User objects

**NO localStorage/sessionStorage reads for teacher data** (only admin tab state is cached)

---

### ❓ 2. AdminView teachersList prop - WHERE DOES IT GET IT?

```
Parent Chain:
  App.tsx OR AppShell.tsx
    ↓ (through props)
  <AdminView teachersList={teachersList} ... />
```

**Source: [App.tsx Line 209]**
```typescript
setTeachersList(map['/api/teachers']);  // Direct from GET /api/teachers response
```

**Source: [AppShell.tsx Line 104]**
```typescript
setTeachersList(Array.isArray(map['/api/teachers']) ? map['/api/teachers'] : []);
```

**Passing to AdminView:**
- App.tsx [Line 751, 957]: `<AdminView teachersList={teachersList} ...>`
- AppShell.tsx [Line 352, 449]: `<AdminView teachersList={teachersList} ...>`

---

### ❓ 3. teachersList from /api/teachers or /api/simulation/users?

**ANSWER: From BOTH, but different purposes**

| Endpoint | State Var | Component Use | Purpose |
|----------|-----------|---------------|---------|
| GET /api/teachers | `teachersList` | AdminView Teachers tab | Display teacher list with classIds |
| GET /api/simulation/users | `usersList` | AdminView Accounts tab | Manage user accounts (includes teachers) |

**In AdminView specifically:**
- **Teachers Tab** uses `teachersList` (from /api/teachers)
- **Accounts Tab** uses `usersList` (from /api/simulation/users), shows teachers as accounts

---

### ❓ 4. Is there filtering/transformation that strips classIds?

**ANSWER: NO. Checked all possible locations:**

| Location | Type | Result |
|----------|------|--------|
| apiFetch (api.ts:188-238) | Function | ❌ No transform - returns `response.json()` directly |
| setTeachersList (App.tsx:209) | State update | ❌ Direct assignment: `map['/api/teachers']` |
| State initialization (types.ts:68) | Type def | ✅ Includes `classIds?: number[]` |
| AdminView filtering (AdminView.tsx:555-557) | Filter logic | ❌ Only filters existing data, doesn't modify classIds |
| filteredTeachersList mapping | Array ops | ❌ Simple filter, no object transformation |
| Edit form population (AdminView.tsx:3281) | State setter | ❌ Pulls `tc.classIds` directly |

**Conclusion:** NO transformations strip classIds.

---

### ❓ 5. Functions that might copy/transform teacher objects?

**Searched for:** `.map()`, `.filter()`, `.slice()`, spread operators, object creation

**FOUND:**

1. **filteredTeachersList creation** [AdminView.tsx:555-557]
   ```typescript
   const filteredTeachersList = teachersList.filter((t) =>
     (userRole !== 'super_admin' || !superAdminSchoolFilterId || t.schoolId === superAdminSchoolFilterId) &&
     (!teacherClassFilterId || (t.classIds || []).includes(teacherClassFilterId)) &&  // Uses classIds
     filterBySearch(t.name)
   );
   ```
   - ✅ Simple filter - preserves all properties
   - ✅ Even filters BY classIds (expects it to exist)

2. **findTeacherProfileFromSimulatedUser** [lib/api.ts:98-135]
   ```typescript
   export function findTeacherProfileFromSimulatedUser(
     currentRole: UserRole | '',
     simulatedUser: any,
     teachersList: any[],  // ← Uses teachersList directly
     usersList: any[]
   ): any {
     if (currentRole !== 'teacher' || !simulatedUser || !teachersList?.length) return undefined;
     
     const byUid = teachersList.find((teacher) => teacher.uid && String(teacher.uid) === simUid);
     const byEmail = teachersList.find((teacher) => teacher.email && teacher.email.toLowerCase() === simEmail);
     const byUserId = teachersList.find((teacher) => String(teacher.userId) === String(userIdFromUid));
     // ... returns one of the above teachers unchanged
   }
   ```
   - ✅ Only finds, doesn't transform
   - ✅ Returns teacher object as-is

3. **No other transformations found** ✅

---

### ❓ 6. Multiple API calls to same endpoint?

**GET /api/teachers called:**
1. ✅ App.tsx:201 - `Promise.all(endpoints.map(...))` - fetchAllData
2. ✅ AppShell.tsx:99 - `Promise.all(endpoints.map(...))` - fetchAllData

Both in same batch with other endpoints → NO race condition.

**Called when:** `currentRole` changes [App.tsx:263-268, AppShell.tsx]

---

### ❓ 7. State initialization that might be overwritten?

**Initial state:** `useState<Teacher[]>([])`

**All state updates to teachersList:**
1. Line 209 (App.tsx): `setTeachersList(map['/api/teachers'])`
2. Line 104 (AppShell.tsx): `setTeachersList(Array.isArray(map['/api/teachers']) ? ... : [])`

**No other setState calls for teachersList** ✅

---

## DATA FLOW DIAGRAM

```
BACKEND RESPONSE (GET /api/teachers)
  ↓
  [
    {id: 1, name: "John", email: "john@test.com", classIds: [1, 2, 3]},
    {id: 2, name: "Jane", email: "jane@test.com", classIds: [2, 3]}
  ]
  ↓
apiFetch (lib/api.ts:238)
  ↓ [NO MODIFICATION]
  ↓
Promise.all results array
  ↓
map['/api/teachers'] Object.fromEntries
  ↓
setTeachersList(map['/api/teachers'])
  ↓
teachersList React state
  ↓
<AdminView teachersList={teachersList} />
  ↓
AdminView.tsx receives prop
  ↓
filteredTeachersList = teachersList.filter(...)  [NO MODIFICATION]
  ↓
{filteredTeachersList.map((tc) => (
  <tr>
    {tc.name} ... {tc.classIds}  ← DISPLAYS classIds HERE
  </tr>
))}
```

---

## Backend Response Structure

### GET /api/teachers Response [server.ts:1898-1957]

```typescript
// After querying class_teachers table:
const assignmentMap = new Map<number, number[]>();
assignments.forEach((item) => {
  const existing = assignmentMap.get(item.teacherId) || [];
  existing.push(item.classId);
  assignmentMap.set(item.teacherId, existing);
});

const list = teachersList.map((teacher) => ({
  ...teacher,                                    // Original fields
  classIds: assignmentMap.get(teacher.id) || [], // ← ADDED HERE (Line 1955)
}));

res.json(list);
```

**Server logs:** Line 1940: `console.log('GET /api/teachers - assignments count:', assignments.length);`

### GET /api/simulation/users Response [server.ts:259-363]

```typescript
// Build normalized user list
const normalizedById = allUsers.reduce((acc, user) => {
  if (!acc[user.id]) {
    acc[user.id] = {
      // ... user fields ...
      classIds: [],  // ← INITIALIZED EMPTY (Line 327)
      _teacherId: user.teacherId,
    };
  }
  return acc;
}, {});

// Populate classIds for teachers
if (teacherIds.length > 0) {
  const assignmentRows = await db.select...;
  const assignmentMap = new Map<number, number[]>();
  assignmentRows.forEach((item) => {
    const existing = assignmentMap.get(item.teacherId) || [];
    existing.push(item.classId);
    assignmentMap.set(item.teacherId, existing);
  });

  Object.values(normalizedById).forEach((user) => {
    if (user._teacherId != null) {
      user.classIds = assignmentMap.get(user._teacherId) || [];  // ← POPULATED HERE (Line 353)
    }
    delete user._teacherId;
  });
}

res.json(Object.values(normalizedById));
```

---

## WHERE CLASSIDS IS USED IN UI

### Display
- **Teachers Tab Table** [AdminView.tsx:3260-3310]
  - Line 3281: `const assignedClassIds = tc.classIds || [];` ← Pulls from teacher

- **Teacher Detail Modal** [AdminView.tsx:2212]
  - `{(teacherDetail.classIds || []).map(...).join(', ')}`

- **Accounts Tab** [AdminView.tsx:3565-3620]
  - Line 3576: `const assignedClassIds = teacherProfile ? (teacherProfile.classIds || []) : [];`

### Filter
- **Class Filter** [AdminView.tsx:555-557]
  - `(!teacherClassFilterId || (t.classIds || []).includes(teacherClassFilterId))`

### Edit Form Population
- **Edit User Form** [AdminView.tsx:3281-3310]
  - Sets `userForm.assignedClassIds` from `tc.classIds`

---

## LOGGING POINTS FOR DEBUGGING

**Browser Console Logs (Frontend):**
```
App.tsx:205   → "RAW_API_RESPONSE_/api/teachers"      (what API returns)
App.tsx:206   → "MAP_/api/teachers"                    (what's in map object)
App.tsx:208   → "BEFORE_SET_TEACHERSLIST"             (before setState)
App.tsx:260   → "AFTER_SET_TEACHERSLIST"              (after setState - in useEffect)
```

**Server Console Logs (Backend):**
```
server.ts:1940 → "GET /api/teachers - assignments count: X"
```

Each log entry shows for each teacher:
```javascript
{
  id: ...,
  uid: ...,
  email: ...,
  classIds: [...]  ← Shows classIds array
}
```

---

## IF UI SHOWS classIds: []

### Hypothesis 1: Backend Not Returning classIds
**Evidence to check:**
- Server log shows `assignments count: 0` → class_teachers table is empty
- GET /api/teachers response in browser Network tab missing classIds field

**Test:**
```bash
curl http://localhost:3000/api/teachers \
  -H "x-simulated-uid: super_admin_1" \
  -H "x-simulated-role: super_admin" | jq '.[] | {name, classIds}'
```

### Hypothesis 2: Frontend Using Stale Data
**Evidence to check:**
- Browser localStorage has old teacher data
- Page cache not cleared

**Test:**
```javascript
// In browser console:
localStorage.clear();
location.reload();
```

### Hypothesis 3: Role-Based Filtering
**Evidence to check:**
- User role is not correctly identified
- Teacher is in different school than filter

**Test:**
- Check user's school_id matches teacher's school_id
- Check if role is correctly set to 'super_admin' or 'school_admin'

### Hypothesis 4: Different Data Source
**Evidence to check:**
- Another component/fetch updating teachersList
- Websocket or real-time update stripping classIds

**Search for:** All references to `setTeachersList` (should be only 2 locations)

---

## FILES INVOLVED

**Frontend:**
- [src/App.tsx](src/App.tsx) - Main data fetching, state management
- [src/components/AppShell.tsx](src/components/AppShell.tsx) - Alt data fetching
- [src/components/AdminView.tsx](src/components/AdminView.tsx) - UI display & consumption
- [src/lib/api.ts](src/lib/api.ts) - apiFetch function
- [src/types.ts](src/types.ts) - Teacher type definition

**Backend:**
- [server.ts](server.ts) - GET endpoints
  - Line 1898: GET /api/teachers
  - Line 259: GET /api/simulation/users

---

## QUICK COMMAND REFERENCE

```bash
# Check if classIds is in backend response
curl -s http://localhost:3000/api/teachers \
  -H "x-simulated-uid: super_admin_1" \
  -H "x-simulated-role: super_admin" | grep -c "classIds"

# Count teacher-class relationships in DB
psql $DATABASE_URL -c "SELECT COUNT(*) FROM class_teachers;"

# Find a specific teacher and their classes
psql $DATABASE_URL -c "
  SELECT t.id, t.user_id, COUNT(ct.class_id) as class_count
  FROM teachers t
  LEFT JOIN class_teachers ct ON t.id = ct.teacher_id
  WHERE t.id = 1
  GROUP BY t.id;"

# Watch server logs for GET /api/teachers
npm run dev | grep "GET /api/teachers"
```
