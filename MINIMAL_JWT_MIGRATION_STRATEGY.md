# Stratégie de Migration JWT Minimale et Progressive

> NOTE: This document outlines a FUTURE migration path for refresh-cookie flows and RS256 signing. These are design proposals only — the current implementation uses HS256 access tokens and does not provide a refresh cookie flow.
## Production-Ready Sans Breaking Changes

**Document Type:** Stratégie d'implémentation progressive  
**Status:** 📋 Prêt pour discussion et approbation  
**Contrainte Clé:** Zéro breaking change - dev continue d'utiliser x-simulated-*

---

## 🎯 Objectif

Migrer vers l'authentification JWT **sans casser les workflows actuels** en 5 phases courtes (~1 semaine chacune).

**Principe:** Chaque phase reste **fonctionnelle et testée** indépendamment. La migration est **additive, non substitutive** jusqu'à la Phase 5 (cleanup optionnel).

---

## 📊 État Avant / Après

### AVANT (État actuel)
```
Login Flow:
POST /api/auth/local-login
  ↓ returns { id, uid, email, name, role, mustReset }
  ↓ Frontend stores in localStorage
  ↓ apiFetch injects x-simulated-* headers
  ↓ Backend accepts x-simulated-* headers
  ✅ Dev mode works
  ❌ Production: NO JWT, NO token auth
```

### APRÈS Phase 5 (Production-Ready)
```
Login Flow:
POST /api/auth/local-login
  ↓ returns { user, accessToken, refreshToken }
  ↓ Frontend stores accessToken in memory + HttpOnly cookie
  ↓ Frontend stores refreshToken in HttpOnly cookie
  ↓ apiFetch injects Authorization: Bearer accessToken
  ↓ Backend verifies JWT via jwt.verify()
  ↓ Token refresh on 401 via POST /api/auth/refresh
  ✅ Production JWT-secure
  ✅ Dev can still use x-simulated-* (backward compat)
```

---

## 🚀 Cinq Phases Minimales

### Phase 1: JWT Generation (Jour 1-2)
**Objectif:** Enable jwt.sign() in login endpoint  
**Scope:** Minimal (1 file, ~20 lines added)  
**Status:** Non-breaking (frontend ignores token for now)

#### Changes Requis:

1. **`server.ts` - POST `/api/auth/local-login` (line 1438)**
   
   After successful password verification (line ~1455), BEFORE sending response:
   
   ```typescript
   // After: const response = { ...userRecord, mustReset: !!localMustReset };
   
   // NEW: Generate JWT token
   let accessToken = null;
   try {
     const jwtSecret = process.env.JWT_SECRET;
     if (jwtSecret) {
       const jwt = require('jsonwebtoken');
       accessToken = jwt.sign(
         {
           uid: userRecord.uid,
           id: userRecord.id,
           email: userRecord.email,
           role: userRecord.role,
           schoolId: userRecord.schoolId
         },
         jwtSecret,
         { expiresIn: '1h' }  // Access token: 1 hour
       );
     }
   } catch (err) {
     console.warn('Failed to generate JWT token:', err?.message);
   }
   
   // Return both user + token (or just user if JWT failed)
   const response = {
     ...userRecord,
     mustReset: !!localMustReset,
     accessToken: accessToken || undefined  // Optional, undefined if JWT failed
   };
   res.json(response);
   ```

2. **`.env.example` - Add JWT config**
   
   ```
   # JWT Configuration
   JWT_SECRET="your-secret-key-min-32-chars-long"
   JWT_REFRESH_SECRET="your-refresh-secret-key-min-32-chars-long"
   ACCESS_TOKEN_EXPIRY=3600
   REFRESH_TOKEN_EXPIRY=604800
   ```

#### Backward Compatibility:
- ✅ Frontend doesn't have to use `accessToken`
- ✅ Can still use x-simulated-* headers
- ✅ Dev environment unaffected
- ✅ Zero middleware changes

#### Testing:
```bash
POST /api/auth/local-login { email, password }
Response: { id, uid, email, name, role, mustReset, accessToken? }
```

**Expected Effort:** 20 minutes
**Risk Level:** 🟢 MINIMAL (additive only)

---

### Phase 2: Optional JWT Storage Frontend (Jour 2-3)
**Objectif:** Frontend optionally stores + injects JWT  
**Scope:** Minimal (1 file, ~30 lines added)  
**Status:** Non-breaking (x-simulated-* still works)

#### Changes Requis:

1. **`src/lib/api.ts` - Update localStorage keys + apiFetch**

   Add new localStorage keys:
   ```typescript
   const JWT_ACCESS_TOKEN_KEY = 'ecoletrack_jwt_access';
   const JWT_REFRESH_TOKEN_KEY = 'ecoletrack_jwt_refresh';
   
   export const getAccessToken = () => localStorage.getItem(JWT_ACCESS_TOKEN_KEY);
   export const setAccessToken = (token: string | null) => {
     if (token) localStorage.setItem(JWT_ACCESS_TOKEN_KEY, token);
     else localStorage.removeItem(JWT_ACCESS_TOKEN_KEY);
   };
   export const getRefreshToken = () => localStorage.getItem(JWT_REFRESH_TOKEN_KEY);
   export const setRefreshToken = (token: string | null) => {
     if (token) localStorage.setItem(JWT_REFRESH_TOKEN_KEY, token);
     else localStorage.removeItem(JWT_REFRESH_TOKEN_KEY);
   };
   ```

   Update `apiFetch()` to check JWT first, fallback to x-simulated-*:
   ```typescript
   export const apiFetch = async (url: string, options?: RequestInit): Promise<any> => {
     const headers = { 'Content-Type': 'application/json', ...options?.headers };
     
     // PRIORITY 1: Use JWT if available
     const accessToken = getAccessToken();
     if (accessToken) {
       headers['Authorization'] = `Bearer ${accessToken}`;
     } else {
       // PRIORITY 2: Fallback to x-simulated-* headers
       const simHeaders = getSimulationHeaders();
       Object.assign(headers, simHeaders);
     }
     
     return fetch(url, { ...options, headers })
       .then(response => {
         if (!response.ok) throw new Error(response.statusText);
         return response.json();
       })
       .catch(error => { throw error; });
   };
   ```

2. **`src/components/LoginView.tsx` - Store accessToken after login**

   After successful login (line ~60), BEFORE calling `setSimulatedUser`:
   ```typescript
   // NEW: Store JWT if returned by backend
   if (response.accessToken) {
     api.setAccessToken(response.accessToken);
   }
   
   // EXISTING: Keep x-simulated-* headers too
   setSimulatedRole(user.role);
   setSimulatedUser({ id: user.id, uid: user.uid, email, name });
   ```

#### Backward Compatibility:
- ✅ If `accessToken` not in response: use x-simulated-* (fallback)
- ✅ If JWT available: use JWT (priority)
- ✅ Both coexist during transition
- ✅ No server changes needed

#### Testing:
```bash
# With JWT
POST /api/auth/local-login → { accessToken: "eyJ..." }
apiFetch('/api/auth/schools')
  → Authorization: Bearer eyJ... (NOT x-simulated-*)

# Without JWT (backward compat)
POST /api/auth/local-login → { /* no accessToken */ }
apiFetch('/api/auth/schools')
  → x-simulated-role, x-simulated-uid, ... (fallback)
```

**Expected Effort:** 30 minutes
**Risk Level:** 🟢 MINIMAL (pure fallback logic)

---

### Phase 3: Token Refresh Endpoint (Jour 3-4)
**Objectif:** Add refresh token mechanism  
**Scope:** Small (1 endpoint, ~30 lines)  
**Status:** Non-breaking (optional, not required yet)

#### Changes Requis:

1. **`server.ts` - Add POST `/api/auth/refresh` endpoint**

   Add after POST `/api/auth/logout` (line ~1485):
   ```typescript
   // Refresh access token using refresh token
   app.post('/api/auth/refresh', async (req, res) => {
     try {
       const refreshToken = req.body?.refreshToken;
       if (!refreshToken) {
         return res.status(401).json({ error: 'Missing refresh token' });
       }

       const jwtSecret = process.env.JWT_SECRET;
       const refreshSecret = process.env.JWT_REFRESH_SECRET || jwtSecret;
       
       if (!jwtSecret) {
         return res.status(500).json({ error: 'JWT not configured' });
       }

       const jwt = require('jsonwebtoken');
       let decoded;
       try {
         decoded = jwt.verify(refreshToken, refreshSecret);
       } catch (err) {
         return res.status(401).json({ error: 'Invalid refresh token' });
       }

       // Lookup user to ensure still active
       const [user] = await db.select().from(users).where(eq(users.id, decoded.id));
       if (!user || user.isDeleted) {
         return res.status(401).json({ error: 'User not found or deleted' });
       }

       // Generate new access token
       const newAccessToken = jwt.sign(
         {
           uid: user.uid,
           id: user.id,
           email: user.email,
           role: user.role,
           schoolId: user.schoolId
         },
         jwtSecret,
         { expiresIn: '1h' }
       );

       res.json({ accessToken: newAccessToken });
     } catch (err) {
       console.error('Token refresh error:', err);
       res.status(500).json({ error: 'Failed to refresh token' });
     }
   });
   ```

2. **`src/lib/api.ts` - Auto-refresh on 401**

   Wrap apiFetch with retry logic:
   ```typescript
   export const apiFetch = async (url: string, options?: RequestInit, retries = 1): Promise<any> => {
     const headers = { 'Content-Type': 'application/json', ...options?.headers };
     
     const accessToken = getAccessToken();
     if (accessToken) {
       headers['Authorization'] = `Bearer ${accessToken}`;
     } else {
       const simHeaders = getSimulationHeaders();
       Object.assign(headers, simHeaders);
     }
     
     try {
       const response = await fetch(url, { ...options, headers });
       
       // If 401 and have refresh token, try to refresh
       if (response.status === 401 && retries > 0 && getRefreshToken()) {
         try {
           const refreshResponse = await fetch('/api/auth/refresh', {
             method: 'POST',
             headers: { 'Content-Type': 'application/json' },
             body: JSON.stringify({ refreshToken: getRefreshToken() })
           });
           
           if (refreshResponse.ok) {
             const { accessToken: newToken } = await refreshResponse.json();
             setAccessToken(newToken);
             
             // Retry request with new token
             headers['Authorization'] = `Bearer ${newToken}`;
             return apiFetch(url, { ...options, headers }, retries - 1);
           }
         } catch (err) {
           console.warn('Token refresh failed:', err);
         }
       }
       
       if (!response.ok) throw new Error(response.statusText);
       return response.json();
     } catch (error) {
       throw error;
     }
   };
   ```

3. **`src/components/LoginView.tsx` - Store both tokens**

   After login, also store refresh token:
   ```typescript
   if (response.accessToken) {
     api.setAccessToken(response.accessToken);
   }
   if (response.refreshToken) {
     api.setRefreshToken(response.refreshToken);
   }
   ```

#### Backward Compatibility:
- ✅ 401 handling only attempts refresh if JWT was being used
- ✅ x-simulated-* users unaffected
- ✅ Dev environment unchanged

#### Testing:
```bash
# Generate two tokens
POST /api/auth/local-login → { accessToken, refreshToken }

# Wait for token expiry (set to 1h)
# Call protected endpoint
GET /api/auth/schools
  → 401 if access token expired
  → Auto-refresh via /api/auth/refresh
  → Retry with new token
  → 200 OK
```

**Expected Effort:** 45 minutes
**Risk Level:** 🟢 LOW (optional refresh only)

---

### Phase 4: Harden VUL2 (Jour 4-5)
**Objectif:** Fix `/api/auth/change-password` vulnerabilities  
**Scope:** Small (1 endpoint, ~10 lines modified)  
**Status:** BREAKING for unauthenticated requests (but correct fix)

#### Changes Requis:

1. **`server.ts` - POST `/api/auth/change-password` (line 1487)**

   Add `requireAuth` middleware + rate limiting:
   ```typescript
   const changePasswordLimiter = rateLimit({
     windowMs: 15 * 60 * 1000,  // 15 minutes
     max: 3,  // max 3 attempts (stricter than login)
     message: { error: 'Too many password change attempts' },
     skip: (req) => req.path !== '/api/auth/change-password'
   });

   // BEFORE: app.post('/api/auth/change-password', async (req, res) => {
   // AFTER:
   app.post('/api/auth/change-password', changePasswordLimiter, requireAuth, async (req: AuthRequest, res) => {
     try {
       // NEW: Verify user is authenticated
       if (!req.user || !req.user.id) {
         return res.status(401).json({ error: 'Authentication required' });
       }

       // CHANGED: Use authenticated user ID instead of email from body
       const userId = req.user.id;

       // NEW: Get email + passwords from body
       const { currentPassword, newPassword } = req.body;
       if (!currentPassword || !newPassword) {
         return res.status(400).json({ error: 'Missing required fields' });
       }
       if (newPassword === '123456') {
         return res.status(400).json({ error: 'Default password not allowed' });
       }

       // Lookup authenticated user
       const [userRecord] = await db.select().from(users).where(eq(users.id, userId));
       
       // UNIFIED ERROR: Don't leak whether user exists
       if (!userRecord) {
         return res.status(401).json({ error: 'Password change failed' });
       }

       const authRows = await db.select().from(localAuths).where(eq(localAuths.userId, userId));
       
       // UNIFIED ERROR: Same message for all failures
       if (authRows.length === 0) {
         return res.status(401).json({ error: 'Password change failed' });
       }

       const { passwordHash, salt } = authRows[0] as any;
       const crypto = await import('node:crypto');
       const verifyHash = crypto.pbkdf2Sync(currentPassword, salt, 310000, 64, 'sha512').toString('hex');
       
       // UNIFIED ERROR: Same message for all failures
       if (verifyHash !== passwordHash) {
         return res.status(401).json({ error: 'Password change failed' });
       }

       // Hash new password
       const newSalt = crypto.randomBytes(16).toString('hex');
       const newHash = crypto.pbkdf2Sync(newPassword, newSalt, 310000, 64, 'sha512').toString('hex');

       await db.update(localAuths)
         .set({ passwordHash: newHash, salt: newSalt, mustReset: false })
         .where(eq(localAuths.userId, userId));

       // SECURITY: Invalidate JWT if needed (optional Phase 5+)
       res.json({ success: true });
     } catch (err: any) {
       console.error('change-password error:', err);
       res.status(500).json({ error: 'Password change failed' });
     }
   });
   ```

#### What Fixes:
- ✅ **VUL2:** Added `requireAuth` middleware (now protected)
- ✅ **VUL2a:** Unified error message (no user enumeration)
- ✅ **Rate limiting:** Max 3 attempts per 15 min (stricter than login)
- ✅ **User ID from token:** Can't change other users' passwords

#### Backward Compatibility:
- ⚠️ **BREAKING:** Frontend MUST pass valid `Authorization: Bearer` OR `x-simulated-*` headers
- ✅ Dev mode still works (x-simulated-* headers accepted)
- ✅ Production now secure (JWT required)

#### Testing:
```bash
# BEFORE: Anyone could change password with email + current pwd
POST /api/auth/change-password { email, currentPassword, newPassword }
  → 200 ✅ (VULNERABLE)

# AFTER: Requires authentication
POST /api/auth/change-password { currentPassword, newPassword }
  Header: Authorization: Bearer eyJ...
  → 200 ✅ (SECURE)

Without auth header:
  → 401 ❌ (PROTECTED)
```

**Expected Effort:** 30 minutes
**Risk Level:** 🟠 MEDIUM (breaking for unauthenticated calls, but correct)

---

### Phase 5: Cleanup & Optional JWT-Only Mode (Jour 5+)
**Objectif:** Optional full JWT enforcement + NODE_ENV fix  
**Scope:** Optional (can stay hybrid forever)  
**Status:** Fully production-ready

#### Optional Changes (if desired):

1. **`src/middleware/auth.ts` - VUL1 Fix (robustify NODE_ENV)**

   Change (line 36):
   ```typescript
   // BEFORE:
   const isProduction = process.env.NODE_ENV === 'production';
   
   // AFTER: More robust check
   const isProduction = ['production', 'prod'].includes(
     String(process.env.NODE_ENV || '').toLowerCase()
   );
   ```

   Even better with env validator:
   ```typescript
   const isProduction = process.env.NODE_ENV?.toLowerCase() === 'production' && 
     process.env.JWT_SECRET !== undefined;
   ```

2. **`src/middleware/auth.ts` - Optional JWT-Only Mode (Phase 5+)**

   Add env var to disable x-simulated-* fallback:
   ```typescript
   const forceJwtOnly = process.env.JWT_ONLY === 'true';
   
   if (forceJwtOnly && isProduction && !hasValidBearer) {
     return res.status(401).json({ error: 'JWT token required' });
   }
   ```

3. **`src/lib/api.ts` - Remove x-simulated-* (optional)**

   If you want pure JWT:
   ```typescript
   export const apiFetch = async (url: string, options?: RequestInit): Promise<any> => {
     const headers = { 'Content-Type': 'application/json', ...options?.headers };
     
     const accessToken = getAccessToken();
     if (!accessToken) {
       // In production, JWT required
       if (process.env.NODE_ENV === 'production') {
         throw new Error('No access token available');
       }
       // In dev, still allow x-simulated-*
       const simHeaders = getSimulationHeaders();
       Object.assign(headers, simHeaders);
     } else {
       headers['Authorization'] = `Bearer ${accessToken}`;
     }
     
     return apiFetch(url, { ...options, headers });
   };
   ```

#### When To Do Phase 5:
- ✅ After **all** teams adopt JWT (1-2 weeks after Phase 2)
- ✅ After **monitoring confirms** x-simulated-* usage is gone
- ✅ After **all tests pass** with JWT-only
- ✅ Optional: Can stay hybrid indefinitely

**Expected Effort:** 15 minutes (if doing it)
**Risk Level:** 🟡 LOW (fully optional)

---

## 📈 Timeline & Rollout

| Phase | Duration | Files | Risk | Status |
|-------|----------|-------|------|--------|
| 1: JWT Gen | 1-2 days | 2 | 🟢 | Enable token generation |
| 2: JWT Storage | 1-2 days | 2 | 🟢 | Frontend optional adoption |
| 3: Token Refresh | 1-2 days | 2 | 🟢 | Auto-refresh 401 |
| 4: VUL2 Fix | 1-2 days | 1 | 🟠 | Security hardening |
| 5: Cleanup | Optional | 2 | 🟡 | Full JWT-only (optional) |
| **Total** | **~1 week** | **9** | | **Production-ready** |

---

## 🧪 Testing Strategy Per Phase

### Phase 1 Test Cases
```
✓ POST /api/auth/local-login returns accessToken
✓ accessToken is valid JWT (can decode)
✓ Frontend can ignore accessToken (backward compat)
✓ Dev mode still works (x-simulated-* headers)
```

### Phase 2 Test Cases
```
✓ If accessToken in localStorage: use it
✓ If accessToken not in localStorage: use x-simulated-*
✓ Authorization: Bearer header sent when using JWT
✓ x-simulated-* headers sent when no JWT
✓ Protected endpoints work with both methods
```

### Phase 3 Test Cases
```
✓ POST /api/auth/refresh returns new accessToken
✓ 401 response triggers auto-refresh
✓ New token is valid
✓ Request retried and succeeds with new token
✓ Invalid refresh token returns 401
```

### Phase 4 Test Cases
```
✓ POST /api/auth/change-password requires auth
✓ Without auth header: 401 (BREAKING)
✓ All errors return same message (no user enum)
✓ Rate limiting: 3 attempts per 15 min
✓ Can only change own password (authenticated user ID)
✓ Password not set to '123456'
```

### Phase 5 Test Cases (if doing cleanup)
```
✓ NODE_ENV check works with 'production', 'prod'
✓ JWT_ONLY=true forces JWT only (rejects x-simulated-*)
✓ Can still use x-simulated-* in dev if JWT_ONLY=false
```

---

## ⚠️ Risk Mitigation

### Risk 1: JWT_SECRET Not Configured
**Mitigation:**
- Phase 1: JWT generation fails silently, falls back to no token
- Phase 2-3: apiFetch uses x-simulated-* if no JWT available
- Phase 4: BREAKING → require JWT_SECRET in .env

**Solution:** Add pre-flight check in server startup:
```typescript
if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) {
  console.error('ERROR: JWT_SECRET not configured in production!');
  process.exit(1);
}
```

### Risk 2: Frontend Doesn't Update
**Mitigation:**
- Phases 1-3: x-simulated-* headers still work
- Phase 4: Requires authentication (might break old frontend)
- Phase 5: Optional (can delay indefinitely)

**Solution:** Monitor client version, ensure all clients updated before Phase 4

### Risk 3: Token Expiry Too Short/Long
**Mitigation:**
- Default: Access 1h, Refresh 7 days (configurable via env)
- Auto-refresh handles token rotation transparently

**Solution:** Fine-tune via environment variables:
```
ACCESS_TOKEN_EXPIRY=3600        # 1 hour
REFRESH_TOKEN_EXPIRY=604800     # 7 days
```

### Risk 4: Database Query Performance
**Mitigation:**
- `jwt.verify()` is local (no DB call)
- Only `/api/auth/refresh` does DB lookup (user still active?)
- No new indexes required

---

## 🔒 Security Hardening Post-Migration

After Phase 4, consider:

1. **Token Blacklist (Sessions Table)**
   - On logout: add token to blacklist
   - On refresh: check if old token in blacklist
   - Clean up expired tokens daily

2. **Token Rotation on Refresh**
   - Return new refresh token on each refresh
   - Invalidate old refresh token after use
   - Prevents token theft

3. **Multi-Device Detection**
   - Store token session ID in DB
   - Track last IP + user agent
   - Alert on unusual login

4. **CORS + CSRF Protection**
   - Ensure CORS allows only trusted origins
   - Add CSRF token to state-changing requests

---

## 📋 Rollout Checklist

### Pre-Migration
- [ ] Backup current database
- [ ] Review all environments (.env.example, .env.local, .env.prod)
- [ ] Ensure test suite passes
- [ ] Set up staging environment with Phase 1 code

### Phase 1 (JWT Generation)
- [ ] Add jwt.sign() to login endpoint
- [ ] Update .env.example with JWT_SECRET
- [ ] Test: POST /api/auth/local-login returns accessToken
- [ ] Deploy to staging
- [ ] Monitor: Check no errors in production logs
- [ ] Rollback plan: Keep old endpoint working (already does)

### Phase 2 (Frontend Storage)
- [ ] Update api.ts to store accessToken
- [ ] Update LoginView to call setAccessToken
- [ ] Update apiFetch to check JWT first
- [ ] Test: Both JWT and x-simulated-* work
- [ ] Deploy to staging → production
- [ ] Monitor: Ensure no 401 errors spike

### Phase 3 (Token Refresh)
- [ ] Add /api/auth/refresh endpoint
- [ ] Update apiFetch with auto-retry on 401
- [ ] Add JWT_REFRESH_SECRET to env
- [ ] Test: Token expiry + refresh flow
- [ ] Deploy to staging → production
- [ ] Monitor: Check refresh endpoint latency

### Phase 4 (VUL2 Fix)
- [ ] Add requireAuth to change-password
- [ ] Add rate limiting
- [ ] Unify error messages
- [ ] ⚠️ BREAKING: Notify all clients before deploy
- [ ] Deploy to staging for 1 week
- [ ] Monitor: Old unauthenticated requests now fail (expected)
- [ ] Deploy to production (with team notification)

### Phase 5 (Optional Cleanup)
- [ ] Fix NODE_ENV check (VUL1)
- [ ] Add JWT_ONLY mode (optional)
- [ ] Remove x-simulated-* headers (optional)
- [ ] Update tests to JWT-only
- [ ] Deploy only if VUL1 is critical issue

---

## 💡 What Makes This Strategy Minimal

1. **Additive, Not Substitutive**
   - Phase 1-3: Both JWT and x-simulated-* work together
   - No endpoint logic changes until Phase 4
   - Rollback is just "don't use accessToken"

2. **No Database Migrations Required**
   - No new tables in Phase 1-3
   - No schema changes
   - Uses existing users table + JWT claims

3. **No Breaking Changes Until Phase 4**
   - Phases 1-3: 100% backward compatible
   - Phase 4: Breaking (but necessary security fix)
   - Phase 5: Optional (can delay or skip)

4. **Minimal New Code**
   - Phase 1: ~20 lines (jwt.sign)
   - Phase 2: ~30 lines (localStorage + fallback)
   - Phase 3: ~35 lines (refresh endpoint + retry)
   - Phase 4: ~15 lines modified (add requireAuth)
   - **Total: ~100 lines of production code**

5. **Tests Remain Green**
   - Existing auth.test.ts still passes (VUL1 not tested, so no fail)
   - New tests can be added incrementally
   - No regressions per phase

---

## 🎬 Next Steps

### If You Approve This Strategy:
1. Create branch: `feat/jwt-phase-1`
2. Implement Phase 1 changes (jwt.sign + .env.example)
3. Test in staging (1-2 days)
4. Deploy to production (Phase 1 is non-breaking)
5. Monitor for 3-5 days
6. Proceed to Phase 2 once confirmed stable

### If You Want Adjustments:
- Slower timeline? → Make each phase 2-3 days instead of 1
- Faster timeline? → Combine Phases 1-2 (same day)
- Skip Phase 4 security fix? → No (VUL2 is critical, must fix)
- Skip Phase 5 cleanup? → Yes (optional, only do if VUL1 matters)

---

## 📞 Questions Before Starting?

1. **JWT_SECRET Generation:** Should I provide script to generate secure secret?
2. **Token TTL:** Is 1 hour access + 7 days refresh acceptable?
3. **Staging Timeline:** Should we test 1 week per phase or shorter?
4. **Team Notification:** Need coordination with frontend team before Phase 4 (breaking)?
5. **Monitoring:** What metrics to watch during rollout?

---

**Strategy Status:** ✅ Ready for implementation  
**Approval Level:** 📋 Awaiting stakeholder review  
**Estimated Dev Time:** 8-16 hours over 1 week  
**Risk Assessment:** 🟢 Minimal (with proper phase-by-phase testing)

