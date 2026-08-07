# Revue Critique: MINIMAL_JWT_MIGRATION_STRATEGY.md

> NOTE: This document contains recommendations for a future migration to refresh-cookie flows and RS256. Those features are PLANNED only; the current codebase issues HS256 access tokens only. Do not treat RS256/refresh-cookie as implemented.
## Risques Cachés, Régressions & Étapes Manquantes

**Statut:** 🔴 **Document à réviser avant implémentation**  
**Severity:** 3 critiques, 5 hauts, 8 moyens  
**Effort Correction:** 16-24 heures supplémentaires

---

## 🔴 PROBLÈMES CRITIQUES (Bloquer implémentation)

### 1. **Refreshtoken Jamais Généré en Phase 1**

**Problème:**
- Phase 1 code: génère SEULEMENT `accessToken`
- Phase 3 code: assme `response.refreshToken` existe
- Réalité: Phase 1 ne retourne pas `refreshToken`
- Conséquence: Phase 3 auto-refresh break car `getRefreshToken()` = null

**Code Affecté:**
```typescript
// Phase 1 (server.ts) - MANQUANT
const response = {
  ...userRecord,
  mustReset: !!localMustReset,
  accessToken: accessToken || undefined  // ✅ présent
  // ❌ refreshToken MISSING!
};

// Phase 2 (LoginView.tsx) - essaie utiliser
if (response.refreshToken) {  // ← undefined, ne stocke rien
  api.setRefreshToken(response.refreshToken);
}

// Phase 3 (api.ts) - crash/silent fail
if (response.status === 401 && retries > 0 && getRefreshToken()) {  // ← null, never retry
  // Never executes for JWT users!
}
```

**Impact:** 
- 🔴 **CRITICAL:** Phase 3 auto-refresh non-fonctionnel
- Users avec accessToken expirés restent bloqués
- Fallback à refresh manuel = user confusion

**Fix Requis (Phase 1 doit aussi générer refreshToken):**
```typescript
// Phase 1: Generate BOTH tokens
const jwtSecret = process.env.JWT_SECRET;
const refreshSecret = process.env.JWT_REFRESH_SECRET || jwtSecret;

const accessToken = jwt.sign(
  { uid, id, email, role, schoolId },
  jwtSecret,
  { expiresIn: '1h' }
);

const refreshToken = jwt.sign(
  { uid, id, email },  // Mini claims for refresh
  refreshSecret,
  { expiresIn: '7d' }
);

const response = {
  ...userRecord,
  mustReset: !!localMustReset,
  accessToken,
  refreshToken  // ← MUST be added
};
```

**Action:** Mettre à jour Phase 1 spec avant de coder

---

### 2. **Rate Limiter Syntax Faux (Phase 4)**

**Problème:**
```typescript
const changePasswordLimiter = rateLimit({
  skip: (req) => req.path !== '/api/auth/change-password'
});
```

**C'est INVERSÉ:**
- `skip: true` = BYPASSER le rate limiting
- `skip: (req) => req.path !== '/api/auth/change-password'` = skip si DIFFERENT de change-password
- Résultat: Rate limiter JAMAIS appliqué au bon endpoint!

**Impact:** 
- 🔴 **CRITICAL:** Brute force possible sur change-password
- Limiter ineffectif = VUL2 partiellement fixe

**Fix Requis:**
```typescript
// OPTION 1: Simple path match (better)
app.post('/api/auth/change-password',
  rateLimit({ windowMs: 15*60*1000, max: 3 }),
  changePasswordLimiter,  // Apply DIRECTLY
  requireAuth,
  async (req, res) => { ... }
);

// OPTION 2: Conditional skip (correct)
const changePasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 3,
  skip: (req) => req.path === '/api/auth/change-password' ? false : true  // Only rate limit THIS endpoint
});
```

**Action:** Corriger syntax avant Phase 4

---

### 3. **Token Blacklist Manquant (Pas de Logout Sécurisé)**

**Problème:**
- Après login: user obtient JWT valide 1h
- User fait logout (no-op server)
- Backend ne révoque rien
- JWT reste valide!
- Attacker avec token volé = 1 heure accès full

**Séquence Attack:**
```
1. Alice login (gets accessToken, expires in 1h)
2. Alice logout
3. Bob steal Alice token (somehow - XSS, MITM, etc)
4. Bob can use token for 1h even after Alice logout
5. Alice cannot revoke tokens = stuck
```

**Impact:**
- 🔴 **CRITICAL:** Logout non-sécurisé
- Post-logout access window = security risk
- Utilisateurs croyent être déconnectés mais JWT valide

**What's Missing:**
- Token blacklist table (sessions ou token_revocation)
- On logout: add token to blacklist
- On every request: check token NOT in blacklist
- Cleanup job: delete expired blacklist entries

**Action:** Ajouter Phase de Token Revocation (avant Phase 4)

**Estimated Schema Needed:**
```sql
CREATE TABLE token_blacklist (
  id INTEGER PRIMARY KEY,
  token_jti STRING UNIQUE,           -- JWT ID (sub-claim)
  user_id INTEGER,
  blacklisted_at TIMESTAMP,
  expires_at TIMESTAMP,              -- Auto-cleanup
  reason TEXT                        -- 'logout', 'password_change', etc
);
```

---

## 🟠 RÉGRESSIONS HAUTES (Casser existing functionality)

### 4. **E2E Tests Vont Échouer (Phase 4)**

**Test Affecté:** `test/e2e/profile-e2e.test.ts` line ~43
```typescript
const login = await post('/api/auth/local-login', { email, password: '123456' });
expect(login.status).toBe(200);  // ✅ passes

// Later in test:
await post('/api/auth/change-password', {
  email: user.email,
  currentPassword: '123456',
  newPassword: 'newpass'
});
// ❌ After Phase 4: 401 (no auth header!)
```

**Impact:**
- 🟠 **HIGH:** Test suite fail post-Phase 4
- CI/CD pipeline break
- Deployment blocked

**Fix Requis:**
- Update test to use JWT after Phase 1 deployed
- Or: Conditionally skip test until Phase 4 ready

**Action:** Document test migration path in Phase plan

---

### 5. **Admin Password Reset Workflow Broken (Phase 4)**

**Scenario:**
- Admin uses `/api/admin/set-password` to reset user password
- Currently: works (no requireAuth)
- After Phase 4: change-password now needs auth
- Question: what about `/api/admin/set-password`?

**Code Review:**
```typescript
// Current (server.ts line 1321)
app.post('/api/admin/set-password', requireAuth, async (req: AuthRequest, res) => {
  // Already has requireAuth - GOOD
});

// But change-password (line 1487)
app.post('/api/auth/change-password', async (req, res) => {
  // Currently NO requireAuth
  // Phase 4 adds requireAuth - BREAKS existing API
});
```

**Impact:**
- 🟠 **HIGH:** API incompatibility between two endpoints
- External tools/scripts using change-password fail
- Admin reset path differs from user self-change

**Question:** Should both require auth? Or split concerns?
- Option 1: Both require auth (current plan) - safer
- Option 2: Admin path = no auth, user path = auth - confusing

**Action:** Clarify and document both paths Phase 4

---

### 6. **Old Frontend Clients Will Break (Phase 4)**

**Scenario:**
- Deploy Phase 4 (change-password needs requireAuth)
- Old frontend client still calling without Authorization header
- Response: 401 "Authentication required"
- User: "Password change stopped working!"

**Timeline Problem:**
- Phase 1-3: Can be slow (weeks)
- Phase 4: Breaking change (deployment all at once)
- If frontend team slow: clients fail

**Impact:**
- 🟠 **HIGH:** User-facing breakage
- Support cost: "Why can't I change password?"
- Rollback difficult if not planned

**Action:** 
- Phase 4 MUST be coordinated with frontend team
- Require minimum 2-week notice before Phase 4 deploy
- Potentially: feature flag for Phase 4 (JWT_REQUIRE_AUTH=false)

---

### 7. **localStorage Token XSS Vulnerability (Phase 2)**

**Document Contradiction:**

Phase 2 spec:
```typescript
export const setAccessToken = (token: string | null) => {
  if (token) localStorage.setItem(JWT_ACCESS_TOKEN_KEY, token);  // ← XSS vulnerable!
};
```

Phase 5 spec (aspirational):
```typescript
// Frontend stores accessToken in memory + HttpOnly cookie
// Uses HttpOnly cookie (immune to XSS)
```

**Problem:**
- localStorage = XSS vulnerable
- Document promises Phase 5 fix (HttpOnly)
- But Phase 2-4 use vulnerable method (1-2 weeks exposed!)
- No migration path from localStorage → HttpOnly documented

**Impact:**
- 🟠 **HIGH:** XSS attackers can steal JWT for weeks
- Phase 5 migration complex and undocumented
- Users may never upgrade

**Action:**
- Start with HttpOnly cookie IMMEDIATELY (Phase 1)
- Avoid localStorage entirely
- OR: Use memory-only storage (cleared on refresh)

**Better Phase 1 Approach:**
```typescript
// Use HttpOnly cookie from start (backend sets)
app.post('/api/auth/local-login', async (req, res) => {
  const accessToken = jwt.sign(...);
  const refreshToken = jwt.sign(...);
  
  // Set as HttpOnly cookies (immune to XSS)
  res.cookie('accessToken', accessToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 1 * 60 * 60 * 1000  // 1h
  });
  
  res.cookie('refreshToken', refreshToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 7 * 24 * 60 * 60 * 1000  // 7d
  });
  
  // Response: NO token (it's in cookie)
  res.json({ user: { id, email, role, mustReset } });
});
```

Then frontend:
```typescript
// Auto-injected by browser (no JS needed)
fetch('/api/auth/schools')
  // Cookies sent automatically (httpOnly)
  // No XSS access possible
```

---

### 8. **Asymmetric 401 Handling for x-simulated Users (Phase 3)**

**Code Issue:**
```typescript
if (response.status === 401 && retries > 0 && getRefreshToken()) {
  // Only retries if refreshToken exists
}
```

**Scenario:**
- User A: JWT mode (has refreshToken) → 401 triggers auto-refresh ✅
- User B: x-simulated mode (no refreshToken) → 401 fails immediately ❌

**Impact:**
- 🟠 **HIGH:** Different behavior for dev vs prod
- Inconsistent UX
- Hard to debug: "works in dev, fails in staging"

**Better Approach:**
```typescript
if (response.status === 401 && retries > 0) {
  // Check JWT FIRST
  if (getRefreshToken()) {
    // JWT path: try refresh
    try { 
      const newToken = await refreshJWT();
      return apiFetch(url, { ...options }, retries - 1);
    } catch (e) {
      // Refresh failed, fall through
    }
  }
  
  // Fallback: try x-simulated headers
  const simHeaders = getSimulationHeaders();
  if (simHeaders['x-simulated-uid']) {
    // Regenerate x-simulated headers
    return apiFetch(url, { ...options }, 0);  // No more retries
  }
}
```

---

## 🟡 ÉTAPES MANQUANTES (Gaps in planning)

### 9. **Token Rotation on Refresh Not Documented**

**Best Practice:** Return NEW refresh token on each refresh (prevents token theft)

**Current Phase 3 Spec:**
```typescript
app.post('/api/auth/refresh', async (req, res) => {
  // Verify old refresh token
  const newAccessToken = jwt.sign(...);
  res.json({ accessToken: newAccessToken });  // ← Only returns access token
  // ❌ Old refresh token still valid forever!
});
```

**Security Issue:**
- Attacker steals old refresh token
- Can refresh infinitely (never expires)
- Session hijacking impossible to stop

**Should Be:**
```typescript
app.post('/api/auth/refresh', async (req, res) => {
  const oldRefreshToken = req.body.refreshToken;
  
  // Verify old token
  const decoded = jwt.verify(oldRefreshToken, refreshSecret);
  
  // Add old token to blacklist immediately
  await db.insert(tokenBlacklist).values({
    token_jti: decoded.jti,
    expires_at: new Date(decoded.exp * 1000)
  });
  
  // Generate NEW refresh token (not reusing old one)
  const newRefreshToken = jwt.sign({
    uid, id, email,
    jti: crypto.randomUUID()  // New ID
  }, refreshSecret, { expiresIn: '7d' });
  
  const newAccessToken = jwt.sign(...);
  
  res.json({ 
    accessToken: newAccessToken,
    refreshToken: newRefreshToken  // ← NEW token, old one blacklisted
  });
});
```

**Action:** Add token rotation to Phase 3 spec

---

### 10. **Multi-Device Attack Vector Not Documented**

**Scenario:**
```
1. Alice login Device A → gets JWT_A
2. Alice login Device B → gets JWT_B
3. Attacker steals JWT_A
4. Attacker uses JWT_A on Device C
5. Alice sees login on "unknown device"? → NO, system doesn't track it!
6. Alice changes password → JWT_A still valid!
```

**Problem:**
- No session tracking
- No device fingerprinting
- No "last login from" detection
- JWT stolen = game over

**What's Missing:**
- Session ID in JWT (track per-device)
- Track: IP, User-Agent, timestamp
- Alert on unusual login (new device, new IP, etc)
- Revoke other sessions on password change

**Action:** Document multi-device strategy (Phase 5+ feature, not blocking)

---

### 11. **HttpOnly Cookie Migration Path Not Documented**

**Document Promise (Phase 5):**
- "Use HttpOnly cookie + memory storage"

**Never Shows:**
- How to migrate from localStorage → HttpOnly
- Timeline for migration
- What breaks during transition
- Rollback plan if HttpOnly fails

**Action:** Either:
- Start with HttpOnly in Phase 1 (safest)
- Or: Document Phase 5.5 migration (localStorage → HttpOnly)

---

### 12. **CSRF Protection Not Addressed**

**Current State:**
- JWT from localStorage = NOT vulnerable to CSRF (no automatic cookie send)
- But x-simulated-* headers = unclear CSRF risk

**Questions Not Answered:**
- Is POST /api/auth/change-password CSRF protected?
- If attacker's form posts to change-password, what happens?
- x-simulated-* headers: auto-injected by browser? (No, JS headers)

**Action:** Add CSRF mitigation to Phase 4+ security hardening

---

### 13. **Infinit Recursion Risk (Phase 3)**

**Code Issue:**
```typescript
export const apiFetch = async (url: string, options?: RequestInit, retries = 1): Promise<any> => {
  // ... refresh logic ...
  return apiFetch(url, { ...options, headers }, retries - 1);  // RECURSION
};
```

**Problem:**
- If always 401: recursion depth = retries
- Stack trace grows
- Max call stack error possible

**Better:**
```typescript
export const apiFetch = async (url: string, options?: RequestInit, retries = 1): Promise<any> => {
  while (retries > 0) {
    try {
      const response = await fetch(url, { ...options, headers });
      if (!response.ok && response.status === 401 && retries > 0 && getRefreshToken()) {
        // Try refresh once
        retries--;
        // ... refresh logic ...
      } else if (!response.ok) {
        throw new Error(response.statusText);
      }
      return response.json();
    } catch (err) {
      if (retries > 0) continue;
      throw err;
    }
  }
};
```

**Action:** Use loop instead of recursion (safer, clearer)

---

### 14. **Monitoring Metrics Not Specific Enough**

**Document Says:**
- "Monitor logs during rollout"
- "Check refresh endpoint latency"

**Missing:**
- Specific metrics to track:
  - 401 error rate (should be low, then spike on Phase 4?)
  - Refresh endpoint response time (target: <100ms?)
  - Token generation time (target: <10ms?)
  - Blacklist table size (how fast grows?)
  - Auth middleware latency
  - JWT decode failures
- Alert thresholds
- Dashboards/queries

**Action:** Add monitoring spec (Prometheus metrics, alert rules)

---

### 15. **Node.js Module Import Not Clarified**

**Code Says:**
```typescript
const jwt = require('jsonwebtoken');
```

**Issue:**
- `jsonwebtoken` must be installed
- Not checked if imported multiple places
- Circular dependency risk if imported in many files

**Better:**
```typescript
// Create central jwt utils file
// src/lib/jwt.ts
import jwt from 'jsonwebtoken';

export const signAccessToken = (payload, secret, expiresIn = '1h') => {
  return jwt.sign(payload, secret, { expiresIn });
};

export const signRefreshToken = (payload, secret, expiresIn = '7d') => {
  return jwt.sign(payload, secret, { expiresIn });
};

export const verifyToken = (token, secret) => {
  return jwt.verify(token, secret);
};
```

**Action:** Create jwt utils module, avoid repeated imports

---

### 16. **No Rollback Plan for Phase 1**

**Document Says:**
- "Rollback is just 'don't use accessToken'"

**Reality:**
- Once deployed, logs are full of `accessToken` fields
- Frontend might already using it
- Can't easily "unsee" the token

**Better Rollback:**
```
If Phase 1 breaks production:
1. Deploy hotfix: remove jwt.sign() code
2. Set JWT_SECRET='' (empty)
3. Frontend: ignore accessToken (will be undefined)
4. Back to pre-Phase-1 state

Timeline: 5-10 minutes
```

**Action:** Document explicit rollback commands for each phase

---

## 📋 CORRECTIVE ACTIONS REQUISES (Before implementation)

| # | Issue | Severity | Fix | Effort |
|----|-------|----------|-----|--------|
| 1 | RefreshToken not generated Phase 1 | 🔴 | Add refreshToken to Phase 1 login | 30m |
| 2 | Rate limiter syntax wrong | 🔴 | Correct skip logic or use middleware directly | 15m |
| 3 | No token blacklist (logout unsafe) | 🔴 | Add token_blacklist table + blacklist check | 3h |
| 4 | E2E tests will fail | 🟠 | Update tests + document migration | 1h |
| 5 | Admin reset workflow unclear | 🟠 | Clarify if /api/admin/set-password also needs auth | 30m |
| 6 | Old frontend clients break Phase 4 | 🟠 | Add 2-week warning to deployment plan | 30m |
| 7 | localStorage XSS vulnerability | 🟠 | Use HttpOnly from Phase 1 instead | 1h |
| 8 | Asymmetric 401 handling | 🟠 | Unify refresh logic for JWT + x-simulated | 1h |
| 9 | Token rotation not documented | 🟡 | Add rotation logic to Phase 3 refresh | 1h |
| 10 | Multi-device attack not tracked | 🟡 | Document Phase 5+ feature (session tracking) | 1h |
| 11 | HttpOnly migration path missing | 🟡 | Decide: Phase 1 HttpOnly or Phase 5 migration | 30m |
| 12 | CSRF protection not addressed | 🟡 | Add to security hardening section | 1h |
| 13 | Recursion risk in apiFetch | 🟡 | Convert to loop + safeguards | 1h |
| 14 | Monitoring metrics not specific | 🟡 | Add Prometheus queries + alert thresholds | 2h |
| 15 | JWT module import scattered | 🟡 | Create jwt utils module | 30m |
| 16 | No explicit rollback plan | 🟡 | Document per-phase rollback commands | 1h |
| **TOTAL** | | | | **~20 hours** |

---

## 🎯 RECOMMANDATION FINALE

**Verdict:** ❌ **Ne pas implémenter tel quel**

**Raisons:**
1. 3 problèmes critiques bloquent execution
2. 5 régressions significatives non mitigées
3. 8 étapes manquantes pour production
4. Total: ~20 heures corrections nécessaires

**Plan Recommandé:**

### OPTION A: Corriger maintenant (recommandé)
1. Incorporer les 16 corrections
2. Réviser stratégie
3. Re-valider
4. PUIS implémenter
5. **Temps total:** 2-3 jours + implémentation

### OPTION B: Implémenter progressivement avec mitigations
1. **Phase 1:** Generate BOTH tokens (accessToken + refreshToken) ✅
2. **Phase 2:** Use HttpOnly cookies from start (not localStorage) ✅
3. **Phase 3:** Add token rotation on refresh ✅
4. **Phase 4:** Add token_blacklist table + blacklist check + Phase 4 ✅
5. **Phase 5:** Multi-device tracking + advanced features
6. **+2 weeks post-Phase-1:** Fix E2E tests + old client warning

---

## 📞 QUESTIONS CRITIQUES À RÉSOUDRE

1. **HttpOnly ou localStorage?** Décider maintenant, pas Phase 5
2. **Token rotation?** Inclure Phase 3 ou post-MVP?
3. **Token blacklist?** Avant ou après Phase 4?
4. **E2E test migration?** Quand?
5. **Monitoring?** Setup avant ou après Phase 1?

---

**Status:** 🔴 AWAITING CORRECTIONS  
**Next:** Schedule review meeting with team  
**Estimated Corrected Completion:** 3-4 jours

