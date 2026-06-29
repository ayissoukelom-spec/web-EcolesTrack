# Frontend API Endpoints Analysis - Teacher/Admin User Data Flow

## Executive Summary
The frontend **DOES correctly send `classIds`** to all three endpoints. The issue with "classIds: []" likely exists on the **backend side** (data processing or database layer), not in the frontend code.

---

## 1. GET /api/teachers - Fetch Teachers List

### Used In:
- **[App.tsx](src/App.tsx#L189)** - Line 189
- **[AppShell.tsx](src/components/AppShell.tsx#L91)** - Line 91

### When Called:
- **Component Mount**: Fetched during initial app load via `useEffect` in `fetchAllData()`
- **After Operations**: Refetched after any teacher/user/student operation to update UI

### Data Usage:
```javascript
// Lines 189-209 in App.tsx
const endpoints = [
  '/api/teachers',
  // ... other endpoints
];
const promises = endpoints.map(e => apiFetch(e).catch(...));
const results = await Promise.all(promises);
const map = Object.fromEntries(endpoints.map((e, i) => [e, results[i]]));

// Set state with fetched teacher list
if (Array.isArray(map['/api/teachers'])) {
  setTeachersList(map['/api/teachers']);
}
```

### Response Expected:
Array of Teacher objects with `classIds` array populated for each teacher.

---

## 2. POST /api/teachers - Create Teacher

### Used In:
- **[App.tsx](src/App.tsx#L447)** - Lines 447-454
- **[AppShell.tsx](src/components/AppShell.tsx#L243)** - Line 243
- **[AdminView.tsx](src/components/AdminView.tsx#L679-L732)** - Called via `onAddTeacher` handler

### When Called:
- **When**: User submits new teacher form in AdminView
- **Where**: AdminModal form → calls `handleSaveNewTeacher()` → calls `onAddTeacher()` → calls `handleAddTeacher` in AppShell

### Data Sent:
```javascript
// AdminView.tsx line 710-717
await onAddTeacher({
  name: newTeacherForm.name,
  email: newTeacherForm.email,
  phone: `+228 ${phoneDigits}`,
  specialization: newTeacherForm.specializations,      // ✅ Sent
  schoolId: targetSchoolId,
  classIds: newTeacherForm.assignedClassIds,           // ✅✅✅ INCLUDED
  gender: newTeacherForm.gender,
});

// AppShell.tsx line 243
const created = await apiFetch('/api/teachers', { 
  method: 'POST', 
  body: JSON.stringify(data) 
});
```

### Frontend Form Validation:
```javascript
// AdminView.tsx line 705-707
if (!Array.isArray(newTeacherForm.assignedClassIds) || newTeacherForm.assignedClassIds.length === 0) {
  setStudentError("L'enseignant doit être affecté à au moins une classe.");
  return;
}
```
**⚠️ Frontend REQUIRES at least 1 class before submission!**

### UI Component:
- **AdminModal.tsx** lines 658-659: Class selection checkboxes
```javascript
<ClassSelector
  value={newTeacherForm.assignedClassIds || []}
  onChange={(ids) => setNewTeacherForm({ ...newTeacherForm, assignedClassIds: ids })}
/>
```

---

## 3. POST /api/admin/users - Create Admin/Teacher User

### Used In:
- **[App.tsx](src/App.tsx#L515)** - Lines 515-522
- **[AppShell.tsx](src/components/AppShell.tsx#L277)** - Line 277
- **[SimulatorHeader.tsx](src/components/SimulatorHeader.tsx#L1021)** - Lines 1021-1028

### When Called:
- **When**: User creates a new user (teacher, admin, or parent) via SimulatorHeader modal
- **Where**: SimulatorHeader "Create Account" button → calls `/api/admin/users` with POST

### Data Sent (For Teacher Role):
```javascript
// SimulatorHeader.tsx lines 1006-1019
const payload: any = {
  email: createEmail,
  name,
  role: createRole,
  phone: `${createPhonePrefix}${createPhone}`,
  specialization: createRole === 'teacher' ? createSpecializations : undefined,
};

// ... role-specific handling ...
if (createRole === 'teacher') {
  payload.schoolId = currentRole === 'school_admin'
    ? simUser?.schoolId
    : parseInt(createSchoolId);
  payload.classIds = createAssignedClassIds;    // ✅✅✅ INCLUDED
}

const createdUser = await apiFetch('/api/admin/users', {
  method: 'POST',
  body: JSON.stringify({ ...payload, password: createPassword }),
});
```

### Frontend Form Validation:
```javascript
// SimulatorHeader.tsx lines 967-971
if (createRole === 'teacher') {
  if (!Array.isArray(createAssignedClassIds) || createAssignedClassIds.length === 0) {
    setCreateError('Veuillez sélectionner au moins une classe pour l\'enseignant');
    return;
  }
}
```
**⚠️ Frontend REQUIRES at least 1 class before submission!**

### UI Component:
- **SimulatorHeader.tsx** lines 850-893: Class selection checkboxes with live feedback
```javascript
<label className="flex items-center gap-2 rounded-lg px-2 py-2 cursor-pointer hover:bg-slate-100 border border-transparent hover:border-slate-200">
  <input
    type="checkbox"
    checked={createAssignedClassIds.includes(cls.id)}
    onChange={() => { /* update state */ }}
  />
  <span className="truncate">{cls.name}</span>
</label>
```

---

## 4. PUT /api/admin/users/{id} - Update Admin/Teacher User

### Used In:
- **[App.tsx](src/App.tsx#L533)** - Lines 533-539
- **[AppShell.tsx](src/components/AppShell.tsx#L283)** - Line 283

### When Called:
- **When**: User updates user details (teacher, admin, or parent)
- **Data Updated**: Role, school, academic year, specializations, **classIds**, gender, etc.

### Data Sent (For Teacher Role):
```javascript
// AppShell.tsx line 283
await apiFetch(`/api/admin/users/${id}`, {
  method: 'PUT',
  body: JSON.stringify(data)  // ✅ classIds included in data
});

// Passed data includes:
{
  email: string;
  name: string;
  role: string;
  schoolId?: number;
  academicYearId?: number;
  phone?: string;
  specialization?: string | string[];
  gender?: string;
  classIds?: number[];  // ✅✅✅ INCLUDED
}
```

---

## 5. GET /api/debug/sim-profile - Debug Endpoint

### Used In:
- **[SimulatorHeader.tsx](src/components/SimulatorHeader.tsx#L430)** - Line 430

### When Called:
- **When**: Component renders and teacher profile cannot be resolved from teachersList
- **Purpose**: Debug helper to get current simulated teacher's full profile including schoolId
- **Context**: Only used when `currentRole === 'teacher'` and schoolId is not found

### Usage:
```javascript
if (currentRole === 'teacher') {
  const dbg = await apiFetch('/api/debug/sim-profile');
  sid = dbg?.teacherRow?.schoolId ?? null;
}
```

### Data Expected:
```javascript
{
  teacherRow?: {
    schoolId?: number;
    classIds?: number[];
    specialization?: string | string[];
    // ... other fields
  };
  // ... other debug info
}
```

---

## CRITICAL FINDING: Frontend Data Flow is Correct ✅

### Submission Paths:

#### Path A: Via POST /api/teachers (AdminView)
```
User fills form in AdminModal
  ↓
Form includes assignedClassIds (validated, ≥1 required)
  ↓
handleSaveNewTeacher() in AdminView
  ↓
onAddTeacher() callback → handleAddTeacher in AppShell
  ↓
apiFetch('/api/teachers', { 
  method: 'POST', 
  body: JSON.stringify(data) 
})
  ↓
Data includes: { classIds: [1, 2, 3], ... }
```

#### Path B: Via POST /api/admin/users (SimulatorHeader)
```
User fills form in SimulatorHeader modal
  ↓
Form includes createAssignedClassIds (validated, ≥1 required)
  ↓
User clicks "Créer" button
  ↓
Form validation passes classIds check
  ↓
apiFetch('/api/admin/users', {
  method: 'POST',
  body: JSON.stringify({ classIds: createAssignedClassIds, ... })
})
  ↓
Data includes: { classIds: [1, 2, 3], ... }
```

---

## Backend Issue: Where the Problem Likely Occurs

Since the frontend **correctly sends classIds**, the "classIds: []" problem likely occurs in one of these backend areas:

1. **POST /api/teachers handler**
   - May not be reading `req.body.classIds` 
   - May be using wrong field name
   - May be mapping classIds incorrectly to database

2. **POST /api/admin/users handler**
   - May not be handling classIds for teacher role
   - May be overwriting classIds with empty array
   - May have permission/validation that silently drops classIds

3. **Database layer**
   - classIds may not be inserted into teacher_classes junction table
   - Foreign key constraints may be failing silently
   - Column may be nullable causing NULL instead of []

4. **Response transformation**
   - classIds may be queried from DB correctly but not included in response
   - Response mapping may be defaulting classIds to []

---

## Recommendations

1. **Check backend POST /api/teachers handler** - Ensure it reads and processes `classIds` from request body
2. **Check backend POST /api/admin/users handler** - Ensure classIds handling for teacher role
3. **Check database transactions** - Ensure classIds are persisted to teacher_classes table
4. **Add backend logging** - Log the received classIds before and after processing
5. **Check response data** - Verify classIds are being selected in the response query

---

## File References

| Component | Purpose | Line |
|-----------|---------|------|
| [App.tsx](src/App.tsx) | Main app, fetches initial data | 189, 447, 515, 533 |
| [AppShell.tsx](src/components/AppShell.tsx) | Routes requests to API, defines handlers | 91, 243, 277, 283 |
| [AdminView.tsx](src/components/AdminView.tsx) | Admin panel UI, teacher creation form logic | 679-732 |
| [AdminModal.tsx](src/components/AdminModal.tsx) | Modal for creating/editing teachers | 658-659, 669 |
| [SimulatorHeader.tsx](src/components/SimulatorHeader.tsx) | Simulator controls, user creation | 850-893, 1021 |
