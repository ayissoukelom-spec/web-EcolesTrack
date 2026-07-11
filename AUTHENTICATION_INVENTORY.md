# Inventaire Complet de l'Authentification
## État Actuel du Système (2026-01-11)

**Document Type:** État présent - Audit sans modifications  
**Status:** ✅ Complet et à jour

---

## Table des Matières

1. [Routes d'Authentification (Backend)](#1-routes-dauthentification-backend)
2. [Middleware d'Authentification](#2-middleware-dauthentification)
3. [Stockage Frontend](#3-stockage-frontend)
4. [Variables d'Environnement](#4-variables-denvironnement)
5. [Tests Existants](#5-tests-existants)
6. [Tableau Récapitulatif](#6-tableau-récapitulatif)

---

## 1. Routes d'Authentification (Backend)

### Fichier: `server.ts`

#### Route 1: POST `/api/auth/local-login` (Lines 1438-1476)
**Middleware:** `loginLimiter` (5 tentatives par 15 min)  
**Authentification requise:** ❌ NON  
**Paramètres d'entrée:**
- `email` (string, obligatoire)
- `password` (string, obligatoire)

**Logique:**
1. Normalise email (lowercase, trim)
2. Recherche utilisateur par email
3. Vérifie que rôle ≠ 'student'
4. Lookup localAuths par userId
5. Vérifie password via PBKDF2 (310K iterations, SHA-512)
6. Détecte si mustReset = true (compare hash avec default '123456')

**Réponse (200):**
```json
{
  "id": number,
  "uid": string,
  "email": string,
  "name": string,
  "role": string,
  "schoolId": number | null,
  "mustReset": boolean
}
```

**Erreurs possibles:**
- 400: Missing email or password
- 401: Email ou mot de passe invalide
- 401: Connexion non autorisée pour un compte élève
- 401: Aucun mot de passe enregistré pour cet utilisateur
- 401: Mot de passe incorrect
- 500: Login failed

**⚠️ PROBLÈME:** ❌ **NO JWT RETURNED** - Retourne seulement l'objet utilisateur sans token JWT

---

#### Route 2: POST `/api/auth/logout` (Lines 1477-1485)
**Middleware:** ❌ AUCUN (pas de `requireAuth`)  
**Authentification requise:** ❌ NON  
**Paramètres d'entrée:** (Aucun)

**Logique:**
- No-op server-side
- Retourne succès
- Client doit nettoyer les clés localStorage

**Réponse (200):**
```json
{ "success": true }
```

**⚠️ PROBLÈME:** ❌ **STATELESS** - Ne révoque aucun token, pas de session côté serveur

---

#### Route 3: POST `/api/auth/change-password` (Lines 1487-1515)
**Middleware:** ❌ **AUCUN (MISSING `requireAuth`)** - 🔴 VULNÉRABILITÉ VUL2  
**Authentification requise:** ❌ NON (mais devrait être YES!)  
**Paramètres d'entrée:**
- `email` (string, obligatoire)
- `currentPassword` (string, obligatoire)
- `newPassword` (string, obligatoire)

**Logique:**
1. Normalise email
2. Lookup utilisateur par email
3. Lookup localAuths
4. Vérifie currentPassword via PBKDF2
5. Hash newPassword
6. UPDATE localAuths avec nouvelles valeurs + `mustReset = false`

**Réponse (200):**
```json
{ "success": true }
```

**Erreurs possibles:**
- 400: Missing fields
- 400: Le mot de passe ne peut pas être le mot de passe par défaut
- 404: Utilisateur non trouvé ← **User Enumeration** (VUL2a)
- 400: Aucun mot de passe enregistré ← **User Enumeration** (VUL2b)
- 401: Mot de passe actuel incorrect ← **User Enumeration** (VUL2c)
- 500: Failed to change password

**🔴 CRITIQUES VULNÉRABILITÉS:**
1. ❌ Missing `requireAuth` middleware → Anyone can change anyone's password
2. ❌ 3 different error messages → User enumeration (détermine si email existe)
3. ❌ No rate limiting → Brute force possible

---

#### Route 4: GET `/api/auth/schools` (Lines 1519-1571)
**Middleware:** `requireAuth` ✅  
**Authentification requise:** ✅ YES  
**Paramètres:** (Aucun)

**Logique:**
1. Vérifie req.user exists (requireAuth)
2. Appelle resolveActor()
3. Si super_admin: retourne toutes les écoles
4. Sinon: utilise getUserSchoolMemberships()
5. Retourne liste + activeSchoolId

**Réponse (200):**
```json
{
  "schools": [
    { "id": number, "name": string }
  ],
  "activeSchoolId": number | null
}
```

---

#### Route 5: POST `/api/auth/schools/active` (Lines 1573-1663)
**Middleware:** `requireAuth` ✅  
**Authentification requise:** ✅ YES  
**Paramètres d'entrée:**
```json
{ "schoolId": number }
```

**Logique:**
1. Vérifie req.user exists
2. Appelle resolveActor()
3. Super admin peut sélectionner n'importe quelle école
4. Autres rôles: vérifie membership
5. Appelle setActiveUserSchool()

**Réponse (200):**
```json
{ "schoolId": number }
```

---

#### Route 6: POST `/api/auth/register-or-login` (Lines 1679-1819)
**Middleware:** `requireAuth` ✅  
**Authentification requise:** ✅ YES  
**Paramètres:** (Aucun, utilise req.user)

**Logique:**
1. Vérifie req.user exists
2. Lookup utilisateur par uid
3. Si existe: UPDATE (sync data)
4. Sinon: INSERT avec rôle par défaut
5. Crée linked profile (parent/teacher/school_admin)
6. Retourne créé/synced utilisateur

**⚠️ DÉTAILS:** Ceci est appelé APRÈS login local pour synchroniser state en DB

---

### Autres Routes Avec `requireAuth`

| Route | Méthode | Ligne | Authentification |
|-------|---------|-------|-----------------|
| `/api/users/:userId/schools` | POST | 540 | requireAuth |
| `/api/simulation/users` | GET | 591 | requireAuth |
| `/api/debug/sim-profile` | GET | 713 | requireAuth |
| `/api/admin/users` | POST | 764 | requireAuth |
| `/api/admin/users/:id` | PUT | 1007 | requireAuth |
| `/api/admin/users/:id` | DELETE | 1270 | requireAuth |
| `/api/audit/events` | GET | 1306 | requireAuth |
| `/api/admin/set-password` | POST | 1321 | requireAuth |
| `/api/users/:id` | PUT | 1373 | requireAuth |

---

## 2. Middleware d'Authentification

### Fichier: `src/middleware/auth.ts`

#### Type: `AuthRequest` (Interface)
```typescript
export interface AuthRequest extends Request {
  user?: {
    id?: number;
    uid: string;
    email?: string;
    name?: string;
    role?: string;
    appRole?: AppRole;
    schoolId?: number | null;
    simulated?: boolean;
  };
}
```

---

#### Fonction: `mapToAppRole()` (Lines 8-15)
**Objectif:** Map DB roles → AppRoles (admin/teacher/parent/student)

**Mappings:**
```
'super_admin' | 'school_admin' | 'admin'  →  'admin'
'teacher'                                  →  'teacher'
'parent'                                   →  'parent'
'student'                                  →  'student'
undefined / null                           →  undefined
```

---

#### Fonction: `verifyToken()` (Lines 27-113)
**Type:** Middleware (Express request handler)  
**Utilisée par:** `requireAuth`, toutes les routes protégées

**Logique:**
1. Check `NODE_ENV === 'production'` (String comparison, exact match) 🔴 **VUL1: Fragile**
2. Extract Authorization header (Bearer token format)
3. **Si NO Bearer token:**
   - If production: return 401 "Unauthorized: Missing token"
   - If dev: check x-simulated-* headers
4. **Si Bearer token present:**
   - Extract JWT from "Bearer " prefix
   - Get JWT_SECRET from env (default 'dev-jwt-secret' if not prod)
   - Verify JWT via jwt.verify()
   - Extract `uid` from decoded token
   - Lookup utilisateur en DB par uid
   - Set req.user from DB record
   - Call next()

**⚠️ PROBLÈMES:**
1. **VUL1:** NODE_ENV check too strict - only exact match 'production'
   - Attack: NODE_ENV='prod' → isProduction=false → simulation headers accepted
2. **No JWT generation anywhere** - jwt.verify() is called but jwt.sign() doesn't exist

---

#### Fonction: `requireRole()` (Lines 123-132)
**Type:** Middleware factory  
**Usage:** `app.get('/route', requireAuth, requireRole(['admin', 'teacher']), handler)`

**Logique:**
1. Extract req.user.appRole
2. Check if role in allowedRoles array
3. If YES: call next()
4. If NO: return 403 "Forbidden"

---

#### Fonction: `requireOwnership()` (Lines 134-165)
**Type:** Middleware factory with async resolver  
**Usage:** `requireOwnership(async (req) => { ... }, { bypassRoles: [...] })`

**Logique:**
1. Check if user.appRole in bypassRoles → allow
2. Otherwise: call resolver async function
3. If resolver returns true → allow
4. If resolver returns false → 403 "Forbidden"

---

#### Export: `requireAuth` (Line 121)
```typescript
export const requireAuth = verifyToken;
```

Simply re-exports verifyToken as requireAuth for use in routes.

---

### Tests: `src/middleware/auth.test.ts` (80 lines)

**Test Suite:** "auth middleware access control"

**Test 1:** "rejects simulated auth headers in production"
- Setup: NODE_ENV='production', DELETE JWT_SECRET
- Request: x-simulated-role header (no Bearer token)
- Expected: 401 response, next NOT called
- Status: ✅ PASSES

**Test 2:** "autorise un role admin sur requireRole"
- Request: user.appRole = 'admin', route requires ['admin']
- Expected: next() called
- Status: ✅ PASSES

**Test 3:** "refuse un role parent sur une route admin/teacher"
- Request: user.appRole = 'parent', route requires ['admin', 'teacher']
- Expected: 403 status, next NOT called
- Status: ✅ PASSES

**Test 4:** "autorise owner quand resolver retourne true"
- Setup: requireOwnership with resolver → true, bypassRoles: ['admin', 'teacher']
- Request: user.appRole = 'parent'
- Expected: next() called
- Status: ✅ PASSES

**Test 5:** "refuse owner quand resolver retourne false (cross-user)"
- Setup: requireOwnership with resolver → false, bypassRoles: ['admin', 'teacher']
- Request: user.appRole = 'parent'
- Expected: 403 status, next NOT called
- Status: ✅ PASSES

**Coverage Gap:** ❌ NO JWT generation tests, NO token refresh tests

---

## 3. Stockage Frontend

### Fichier: `src/lib/api.ts` (340 lines)

#### localStorage Keys (Lines 24-26)
```typescript
const LOCAL_STORAGE_ROLE_KEY = 'ecoletrack_simulated_role';
const LOCAL_STORAGE_USER_KEY = 'ecoletrack_simulated_user';
const LOCAL_STORAGE_ACTIVE_SCHOOL_KEY = 'ecoletrack_active_school_id';
```

---

#### Fonction: `getSimulatedRole()` (Lines 62-64)
**Returns:** string | null  
**Source:** localStorage  
**Key:** 'ecoletrack_simulated_role'

---

#### Fonction: `setSimulatedRole()` (Lines 66-68)
**Sets:** localStorage item for role  
**Usage:** Called in LoginView after successful login

---

#### Fonction: `getSimulatedUser()` (Lines 75-82)
**Returns:** object | null  
**Source:** localStorage  
**Key:** 'ecoletrack_simulated_user'  
**Format:** JSON string
**Fallback:** null if parse fails

---

#### Fonction: `setSimulatedUser()` (Lines 84-93)
**Sets:** localStorage with JSON.stringify(user)  
**Side Effect:** Dispatches `simulatedUserChanged` custom event  
**Usage:** Called in LoginView after successful login

**Stored User Object:**
```json
{
  "id": number,
  "uid": string,
  "email": string,
  "name": string,
  "role": string,
  "schoolId": number | null
}
```

---

#### Fonction: `clearSimulatedUser()` (Lines 95-98)
**Action:** Remove both simulated user AND active school  
**Usage:** On logout

---

#### Fonction: `getActiveSchoolId()` (Lines 100-107)
**Returns:** number | null  
**Source:** localStorage key 'ecoletrack_active_school_id'  
**Parsing:** Number() with isFinite validation

---

#### Função: `setActiveSchoolId()` (Lines 109-115)
**Sets:** localStorage with schoolId  
**Behavior:** Remove key if schoolId is null

---

#### Fonction: `getSimulationHeaders()` (Lines 186-231)
**Purpose:** Generate x-simulated-* headers for every request  
**Returns:** Record<string, string>

**Headers Generated:**
```javascript
{
  'Content-Type': 'application/json',
  'x-simulated-role': role,
  'x-simulated-uid': uid,
  'x-simulated-email': email,
  'x-simulated-name': name,
  'x-simulated-school-id': schoolId  // If present
}
```

**Defaults by Role:**
- super_admin: uid='sim_superadmin_123', email='superadmin@ecoletrack.fr'
- school_admin: uid='sim_schooladmin_123', email='valerie.admin@ecoletrack.fr'
- teacher: uid='sim_teacher_123', email='f.martin.prof@ecoletrack.fr'
- parent: uid='sim_parent_123', email='marianne.dubois@gmail.com'

**Data Priority:**
1. If active: use activeSchoolId
2. Else if in localStorage: use simulatedUser.schoolId
3. Else: use role-specific default

---

#### Fonction: `apiFetch()` (Lines 233-269)
**Purpose:** Main API fetcher with automatic header injection  
**Behavior:**
1. Call getSimulationHeaders()
2. Merge with provided options.headers
3. Fetch with merged options
4. Return JSON if ok, throw Error if not

**Auto-Validation:**
- Client-side name validation (validateClientNames)
- Excluded endpoints: /api/classes, /api/school-terms, /api/academic-years

**Error Handling:**
- response.ok = false → throw Error
- Extract error message from response.json().error

**⚠️ PROBLEM:** No JWT injection - only x-simulated-* headers

---

#### Fonction: `apiFetchBlob()` (Lines 271-297)
**Purpose:** Fetch binary data (PDF, images)  
**Returns:** Blob  
**Behavior:**
- Same header injection
- Remove Content-Type header before fetch
- Return response.blob()

---

### Fichier: `src/components/LoginView.tsx`

#### State Variables (Lines 13-22)
```typescript
const [email, setEmail] = useState('');
const [password, setPassword] = useState('');
const [error, setError] = useState<string | null>(null);
const [loading, setLoading] = useState(false);
const [schools, setSchools] = useState<Array<{ id: number; name: string }>>([]);
const [selectedSchoolId, setSelectedSchoolId] = useState<number | ''>('');
const [loggedInUser, setLoggedInUser] = useState<any | null>(null);
const [showChangePassword, setShowChangePassword] = useState(false);
const [selectionPending, setSelectionPending] = useState(false);
const [schoolsLoading, setSchoolsLoading] = useState(false);
```

---

#### Function: `loadSchools()` (Lines 24-37)
**Action:**
1. Call apiFetch('/api/auth/schools')
2. Parse response: schools array + activeSchoolId
3. Set state

---

#### Function: `submit()` (Lines 39-75)
**Form submission handler**

**Steps:**
1. Direct fetch to `/api/auth/local-login` (NOT via apiFetch)
   - Why: No simulation headers needed yet
2. Parse response → user object
3. Check user.mustReset:
   - If true: show ChangePasswordView, exit
   - If false: continue
4. Store in localStorage:
   - `setSimulatedRole(user.role)`
   - `setSimulatedUser({ id, uid, email, name })`
   - Clear activeSchoolId
5. Call `apiFetch('/api/auth/register-or-login', { method: 'POST' })`
6. If super_admin: redirect /
7. Else: load schools, show selection UI

**⚠️ ISSUE:** No JWT token handling

---

#### Function: `confirmSchoolSelection()` (Lines 77-102)
**Action:**
1. POST to `/api/auth/schools/active` with schoolId
2. Update localStorage:
   - `setActiveSchoolId(schoolId)`
   - `setSimulatedUser({ ...loggedInUser, schoolId })`
3. Redirect to /
4. Call onLogin()

---

### localStorage Data Summary

| Key | Size | Type | Content | Lifetime |
|-----|------|------|---------|----------|
| `ecoletrack_simulated_role` | ~10B | string | Role name | Until logout |
| `ecoletrack_simulated_user` | ~200B | JSON | User object | Until logout |
| `ecoletrack_active_school_id` | ~4B | string | School ID | Until logout |
| **TOTAL** | ~214B | | | Session |

**⚠️ OBSERVATION:** All tokens/credentials stored in localStorage (XSS vulnerable)

---

## 4. Variables d'Environnement

### Fichier: `.env.example`
```
GEMINI_API_KEY="MY_GEMINI_API_KEY"
APP_URL="MY_APP_URL"
```

**Current Count:** 2 variables  
**Auth-Related:** 0

---

### Fichier: `src/middleware/auth.ts` (JWT Usage)
**Line 92:** `const secret = process.env.JWT_SECRET ?? (isProduction ? undefined : 'dev-jwt-secret');`

**Expected Variables:**
- `JWT_SECRET` (required in production, default 'dev-jwt-secret' in dev)
- `NODE_ENV` (checked: exact match 'production')

**Actual Status:**
- ❌ JWT_SECRET: Not documented in .env.example
- ❌ NODE_ENV: Expected but not explicitly set anywhere

---

### Database Configuration (for reference)
From `src/db/index.ts`:
```
SQL_HOST
SQL_PORT (default: 5432)
SQL_USER
SQL_PASSWORD
SQL_DB_NAME
```

---

## 5. Tests Existants

### Test Files Related to Auth

#### 1. `src/middleware/auth.test.ts` (80 lines)
**Status:** ✅ Passing  
**Tests:** 5 total
- Simulation headers rejection in production
- Role-based access control (3 tests)
- Ownership validation (2 tests)

**Coverage:** Middleware logic only  
**Gaps:** ❌ JWT generation, ❌ Token refresh, ❌ Login flow

---

#### 2. `src/lib/api.error.test.ts`
**Related Tests:** 2
- Token missing error suppression
- System error filtering

**Status:** ✅ Related but not auth-specific

---

#### 3. `src/lib/authSchoolMembership.test.ts`
**Purpose:** Test getFallbackSchoolIdsForActor()  
**Status:** ✅ Related to auth context

---

#### 4. `src/lib/bulletinSecurity.integration.test.ts`
**Purpose:** Integration tests for bulletin access control  
**Auth Tokens (Mocked):**
```javascript
{
  adminToken: { id: 1, uid: 'admin-uid', appRole: 'admin', role: 'school_admin', schoolId: 1 },
  teacherToken: { id: 2, uid: 'teacher-uid', appRole: 'teacher', role: 'teacher', schoolId: 1 },
  parentOwnToken: { id: 10, uid: 'parent-own-uid', appRole: 'parent', role: 'parent', schoolId: 1 },
  parentOtherToken: { id: 11, uid: 'parent-other-uid', appRole: 'parent', role: 'parent', schoolId: 1 },
  studentOwnToken: { id: 20, uid: 'student-own-uid', appRole: 'student', role: 'student', schoolId: 1 }
}
```

**Status:** ✅ Passing access control tests  
**Gaps:** ❌ No real JWT verification

---

#### 5. `test/e2e/profile-e2e.test.ts`
**Title:** "E2E: create → force password change → update profile → re-login"  
**Flows Tested:**
1. POST /api/admin/users to create parent with default password
2. POST /api/auth/local-login with default '123456'
3. Expect mustReset: true
4. Call /api/auth/change-password
5. Re-login with new password
6. Update profile

**Status:** ✅ E2E test  
**Coverage:** Login + password change flow

---

### Test Summary

| Test File | Tests | Status | Auth Coverage |
|-----------|-------|--------|----------------|
| auth.test.ts | 5 | ✅ | Middleware only |
| api.error.test.ts | 2 | ✅ | Error handling |
| authSchoolMembership.test.ts | N/A | ✅ | School membership |
| bulletinSecurity.integration.test.ts | Multiple | ✅ | RBAC (mocked JWT) |
| profile-e2e.test.ts | 1 | ✅ | Login + password |

**Major Gaps:**
- ❌ JWT generation tests
- ❌ Token refresh tests
- ❌ Token revocation tests
- ❌ Token theft detection
- ❌ Multi-device session tests
- ❌ Token blacklist tests

---

## 6. Tableau Récapitulatif

### 6.1 Routes d'Authentification Summary

| Route | Method | Auth Required | Line | JWT | Issue |
|-------|--------|---------------|------|-----|-------|
| `/api/auth/local-login` | POST | ❌ | 1438 | ❌ NO | Returns user only, no token |
| `/api/auth/logout` | POST | ❌ | 1477 | N/A | No-op, no session cleanup |
| `/api/auth/change-password` | POST | ❌ | 1487 | N/A | 🔴 Missing requireAuth |
| `/api/auth/schools` | GET | ✅ | 1519 | ✅ | OK |
| `/api/auth/schools/active` | POST | ✅ | 1573 | ✅ | OK |
| `/api/auth/register-or-login` | POST | ✅ | 1679 | ✅ | Sync endpoint |

---

### 6.2 Middleware Status

| Component | Type | Status | Issues |
|-----------|------|--------|--------|
| `verifyToken` | Middleware | ✅ Works | NODE_ENV check fragile (VUL1) |
| `requireAuth` | Export | ✅ Works | No refresh logic |
| `requireRole` | Middleware | ✅ Works | OK |
| `requireOwnership` | Middleware | ✅ Works | OK |
| `mapToAppRole` | Helper | ✅ Works | OK |

---

### 6.3 Frontend Storage Status

| Component | Type | Status | Issues |
|-----------|------|--------|--------|
| localStorage keys | State | ✅ Works | Only x-simulated-*, no JWT |
| apiFetch | Helper | ✅ Works | Injects x-simulated-* only |
| getSimulationHeaders | Helper | ✅ Works | No Authorization header |
| LoginView | Component | ✅ Works | No JWT storage |

---

### 6.4 Security Vulnerabilities Found

| ID | Severity | Component | Issue | Impact |
|----|----------|-----------|-------|--------|
| VUL1 | 🔴 CRITICAL | auth.ts:37 | NODE_ENV check exact-match only | Bypass in prod if NODE_ENV set to 'prod' or 'PRODUCTION' |
| VUL2 | 🔴 CRITICAL | server.ts:1487 | change-password missing requireAuth | Anyone can change anyone's password |
| VUL2a | 🟠 HIGH | server.ts:1495,1502,1506 | User enumeration (3 diff errors) | Attacker can probe which emails exist |
| VUL3 | 🟠 HIGH | server.ts:127-130 | resolveActor silent fallback | If simulated user not in DB, accepts arbitrary claims |

---

### 6.5 Feature Implementation Status

| Feature | Implemented | Status | Notes |
|---------|-------------|--------|-------|
| Password hashing | ✅ | PBKDF2 310K iterations | Secure |
| Rate limiting | ✅ | 5 attempts / 15 min | Login only |
| Role-based access | ✅ | RBAC via middleware | Working |
| Multi-school support | ✅ | Via localStorage + DB | Working |
| Forced password change | ✅ | mustReset flag | Working |
| Simulation headers | ✅ | x-simulated-* | Dev only |
| JWT generation | ❌ | Missing | No jwt.sign() anywhere |
| JWT storage (frontend) | ❌ | Missing | No Authorization header |
| Token refresh | ❌ | Missing | No /api/auth/refresh |
| Token blacklist | ❌ | Missing | No revocation system |
| Session tracking | ❌ | Missing | No sessions table |
| Logout revocation | ❌ | Missing | No-op endpoint |
| Multi-device detection | ❌ | Missing | Not tracked |
| Token rotation | ❌ | Missing | No version tracking |

---

### 6.6 Environment Configuration Status

| Variable | Documented | Used | Status |
|----------|-------------|------|--------|
| JWT_SECRET | ❌ | ✅ (auth.ts:92) | Default 'dev-jwt-secret' |
| NODE_ENV | ❌ | ✅ (auth.ts:36) | Exact match 'production' |
| SQL_* | ✅ (.env.example) | ✅ | Database config |
| GEMINI_API_KEY | ✅ (.env.example) | ✅ | AI config |
| APP_URL | ✅ (.env.example) | ✅ | App URL |

---

### 6.7 Test Coverage Status

| Category | Tests | Status | Notes |
|----------|-------|--------|-------|
| Middleware tests | 5 | ✅ Passing | No JWT tests |
| API error tests | 2 | ✅ Passing | Limited scope |
| School membership | Multiple | ✅ Passing | Specific feature |
| Bulletin security | Multiple | ✅ Passing | RBAC tests |
| E2E login flow | 1 | ✅ Passing | Password change only |
| **JWT tests** | ❌ NONE | | **Not tested** |
| **Token refresh tests** | ❌ NONE | | **Not tested** |
| **Session tests** | ❌ NONE | | **Not tested** |

---

## Summary: Current Authentication Completeness

### ✅ What Works
1. User registration (via admin + register-or-login)
2. Password hashing (PBKDF2 secure)
3. Rate limiting (login endpoint)
4. Role-based access control (middleware)
5. Multi-school support (via userSchools table)
6. Forced password reset (mustReset flag)
7. Development simulation headers (x-simulated-*)
8. Password change endpoint (but unprotected)

### ❌ What's Missing (For Production)
1. JWT generation (jwt.sign() not used)
2. JWT token return from login
3. JWT storage on frontend
4. Authorization Bearer header injection
5. Token refresh endpoint (/api/auth/refresh)
6. Token blacklist / revocation system
7. Session tracking (token_sessions table missing)
8. Multi-device tracking
9. Token rotation on refresh
10. Theft detection (token reuse checking)

### 🔴 Critical Issues
1. **VUL2:** `/api/auth/change-password` has no `requireAuth` middleware
2. **VUL1:** NODE_ENV check is fragile (exact match only)
3. **VUL3:** resolveActor() accepts non-DB users silently

### 🟠 High Priority
1. Create /api/auth/refresh endpoint
2. Implement JWT generation in login
3. Add token storage on frontend
4. Add Authorization header injection in apiFetch
5. Create token_sessions + token_blacklist tables

---

**Inventory Created:** 2026-01-11  
**Last Verified:** All code references current as of `server.ts` attachment  
**Status:** ✅ Complete and accurate
