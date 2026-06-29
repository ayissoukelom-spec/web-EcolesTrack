# Quick Reference: API Endpoint Usage & Data Flow

## Endpoints Summary Table

| Endpoint | HTTP | Component | Trigger | classIds Sent? | Status |
|----------|------|-----------|---------|---|---|
| GET /api/teachers | GET | App.tsx, AppShell.tsx | App init, after operations | N/A (fetch) | ✅ Working |
| POST /api/teachers | POST | AdminView.tsx | New teacher form submit | ✅ **YES** | ✅ Sent |
| POST /api/admin/users | POST | SimulatorHeader.tsx | Create user button | ✅ **YES** | ✅ Sent |
| PUT /api/admin/users/{id} | PUT | AppShell.tsx | User edit form | ✅ **YES** | ✅ Sent |
| GET /api/debug/sim-profile | GET | SimulatorHeader.tsx | Teacher profile resolve | N/A (debug) | ⚠️ Debug |

---

## Frontend Data Flow Diagram

```
┌─────────────────────────────────────────────────────────┐
│                   USER INTERFACE                         │
├─────────────────────────────────────────────────────────┤
│                                                           │
│  AdminView (Teacher Creation)    SimulatorHeader Modal   │
│  ├─ AdminModal.tsx               ├─ createAssignedClassIds
│  │  ├─ assignedClassIds          │
│  │  └─ specializations           └─ createSpecializations
│  │                                                       │
│  └─ handleSaveNewTeacher()       onClick → Validate & Create
│     └─ VALIDATES classIds ≥ 1     └─ VALIDATES classIds ≥ 1
│                                                          │
└────────────────────────────────────────────────────────┘
                        ↓
                  AppShell.tsx
                (Handler Layer)
              ┌───────────────────┐
              │ handleAddTeacher  │
              │   ↓               │
              │ classIds: [1,2,3] │
              │   ↓               │
              │ handleCreateUser  │
              │ handleUpdateUser  │
              └───────────────────┘
                        ↓
                   apiFetch()
                        ↓
        ┌───────────────────────────────────┐
        │   API ENDPOINTS (Backend)         │
        ├───────────────────────────────────┤
        │ POST /api/teachers                │
        │   body: { classIds: [...] }   ✅  │
        │                                   │
        │ POST /api/admin/users             │
        │   body: { classIds: [...] }   ✅  │
        │                                   │
        │ PUT /api/admin/users/{id}         │
        │   body: { classIds: [...] }   ✅  │
        └───────────────────────────────────┘
                        ↓
                  BACKEND ISSUE ⚠️
            (classIds not persisted)
```

---

## Component Hierarchy

### Teacher Creation Path

```
AdminView.tsx
├─ State: newTeacherForm { assignedClassIds: [] }
├─ UI: AdminModal.tsx
│  ├─ Class Selection Checkboxes (lines 658-659)
│  │  └─ onChange → setNewTeacherForm
│  └─ Save Button (line 669)
│     └─ onClick → handleSaveNewTeacher()
├─ Handler: handleSaveNewTeacher (lines 679-732)
│  ├─ VALIDATION: classIds.length ≥ 1 (line 705-707)
│  └─ SUBMIT: onAddTeacher({ classIds, ... })
└─ Prop callback to AppShell.tsx: handleAddTeacher
   └─ apiFetch('/api/teachers', { classIds })
```

### Admin User Creation Path

```
SimulatorHeader.tsx
├─ State: createAssignedClassIds: []
├─ UI: Modal form (lines 850-893)
│  ├─ Class Selection Checkboxes
│  │  └─ onChange → setCreateAssignedClassIds
│  └─ Create Button (line 1070+)
│     └─ onClick → handleClick
├─ Handler: onClick (lines 944-1050)
│  ├─ VALIDATION: classIds.length ≥ 1 (line 967-971)
│  └─ SUBMIT: apiFetch('/api/admin/users', { classIds })
```

---

## Key Validation Points (Frontend) ✅

### AdminView Teacher Creation
```javascript
// Line 705-707
if (!Array.isArray(newTeacherForm.assignedClassIds) || 
    newTeacherForm.assignedClassIds.length === 0) {
  setStudentError("L'enseignant doit être affecté à au moins une classe.");
  return;
}
// ✅ Prevents submission without classIds
```

### SimulatorHeader User Creation (Teacher)
```javascript
// Line 967-971
if (createRole === 'teacher') {
  if (!Array.isArray(createAssignedClassIds) || 
      createAssignedClassIds.length === 0) {
    setCreateError('Veuillez sélectionner au moins une classe...');
    return;
  }
}
// ✅ Prevents submission without classIds
```

---

## Request Payload Examples

### Example 1: POST /api/teachers
```json
{
  "name": "John Doe",
  "email": "john@school.com",
  "phone": "+228 12345678",
  "specialization": ["Math", "Physics"],
  "schoolId": 1,
  "classIds": [2, 5, 8],
  "gender": "M"
}
```

### Example 2: POST /api/admin/users (teacher role)
```json
{
  "email": "jane@school.com",
  "name": "Jane Smith",
  "role": "teacher",
  "phone": "+2289876543",
  "specialization": ["French", "Literature"],
  "schoolId": 1,
  "classIds": [3, 6],
  "gender": "F",
  "password": "securepass123"
}
```

### Example 3: PUT /api/admin/users/42
```json
{
  "email": "jane@school.com",
  "name": "Jane Smith",
  "role": "teacher",
  "phone": "+2289876543",
  "specialization": ["French", "Literature"],
  "schoolId": 1,
  "classIds": [3, 6, 9],
  "gender": "F"
}
```

---

## Conclusion

✅ **Frontend correctly sends classIds** via all three endpoints  
⚠️ **Issue is on backend** - classIds likely not being:
- Read from request body properly
- Validated correctly  
- Inserted into database junction table
- Selected in response queries
