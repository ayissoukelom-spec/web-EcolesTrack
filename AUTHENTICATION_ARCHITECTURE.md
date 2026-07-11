# 📋 DOCUMENT D'ARCHITECTURE D'AUTHENTIFICATION

**Date:** 2026-07-11  
**Statut:** Partiellement Implémenté - Architecture Incohérente  
**Risque Production:** 🔴 CRITIQUE

---

## 1. FLUX D'AUTHENTIFICATION ACTUEL

### 1.1 Flux de Développement (NODE_ENV !== 'production')

```
Frontend (React)
├─ POST /api/auth/local-login
│  ├─ Body: { email, password }
│  ├─ NO headers
│  └─ Response: { id, uid, email, name, role, mustReset }  ← NO JWT
│
├─ Store in localStorage:
│  ├─ ecoletrack_simulated_role = user.role
│  ├─ ecoletrack_simulated_user = { id, uid, email, name }
│  └─ ecoletrack_active_school_id = schoolId
│
├─ apiFetch() injects x-simulated-* headers:
│  ├─ x-simulated-role
│  ├─ x-simulated-uid
│  ├─ x-simulated-email
│  ├─ x-simulated-name
│  └─ x-simulated-school-id
│
└─ POST /api/auth/register-or-login
   └─ WITH x-simulated-* headers (NO Authorization Bearer)

Backend (Express)
├─ requireAuth middleware:
│  ├─ Check NODE_ENV === 'production' (Line 37 auth.ts)
│  ├─ IF isProduction=false:
│  │  ├─ Look for Authorization: Bearer ❌ NOT found
│  │  ├─ Look for x-simulated-role ✅ FOUND
│  │  └─ Accept simulated user (set req.user.simulated=true)
│  │
│  └─ IF Bearer found:
│     ├─ jwt.verify(token, JWT_SECRET)
│     └─ Load user from DB
│
├─ resolveActor():
│  ├─ IF req.user.simulated:
│  │  ├─ Try to find matching DB user by uid/email
│  │  ├─ IF found → Return DB user
│  │  └─ IF NOT found → Return simulated user (silently!)
│  │
│  └─ ELSE load from DB
│
└─ Protected endpoints:
   └─ Work with x-simulated-* headers

✅ Result: Everything works in DEV
```

### 1.2 Flux de Production (NODE_ENV === 'production')

```
Frontend (React)
├─ POST /api/auth/local-login
│  └─ Response: { id, uid, email, name, role, mustReset }  ← NO JWT!
│
├─ Frontend cannot generate Bearer token ❌
│
├─ Still stores in localStorage and adds x-simulated-* headers
│
└─ POST /api/auth/register-or-login
   └─ WITH x-simulated-* headers (NO Authorization Bearer)

Backend (Express)
├─ requireAuth middleware:
│  ├─ Check NODE_ENV === 'production'
│  ├─ IF isProduction=true:
│  │  ├─ Look for Authorization: Bearer ❌ NOT found
│  │  ├─ Return 401 UNAUTHORIZED (Line 74 auth.ts)
│  │  └─ ❌ EXITS HERE - never checks x-simulated-*
│  │
│  └─ Never reaches x-simulated-* check
│
❌ Result: COMPLETE AUTHENTICATION FAILURE
```

---

## 2. COMPOSANTS IMPLÉMENTES & NON IMPLÉMENTES

### 2.1 Complètement Implémentés ✅

| Composant | Fichier | Statut | Notes |
|-----------|---------|--------|-------|
| **Login Endpoint** | server.ts:1438-1475 | ✅ | Valide email/password, retourne user object |
| **Password Hashing** | server.ts + localAuths | ✅ | PBKDF2 avec salt 16 bytes |
| **Rate Limiting** | server.ts:1425 | ✅ | 5 tentatives/15min sur login |
| **Simulation Headers (Dev)** | api.ts:150-180 | ✅ | x-simulated-* headers générés |
| **Frontend localStorage** | api.ts:24-25 | ✅ | Persiste role, user, schoolId |
| **requireAuth Middleware** | auth.ts:37-125 | ✅ | Vérifie Bearer OU x-simulated-* |
| **resolveActor()** | server.ts:100-155 | ✅ | Matching DB user + fallback |
| **Permission Checks** | server.ts (spread) | ✅ | Role-based access control (RBAC) |
| **Audit Logging** | server.ts + schema | ✅ | Logs user actions |

### 2.2 Partiellement Implémentés ⚠️

| Composant | Fichier | Statut | Raison |
|-----------|---------|--------|--------|
| **Auth Middleware** | auth.ts:37-125 | ⚠️ | Dual-mode (dev OK, prod cassé) |
| **TOKEN SECURITY** | auth.ts | ⚠️ | JWT peut être vérifié MAIS jamais généré |
| **NODE_ENV Check** | auth.ts:37 | ⚠️ | Case-sensitive, exact-match uniquement |

### 2.3 Non Implémentés ❌

| Composant | Fichier | Statut | Impact |
|-----------|---------|--------|--------|
| **JWT Generation** | ❌ NONE | ❌ | `jwt.sign()` n'existe pas |
| **JWT Return** | ❌ NONE | ❌ | Login ne retourne pas de token |
| **JWT Storage (Frontend)** | ❌ NONE | ❌ | localStorage ne stocke pas token |
| **Bearer Token Injection** | ❌ NONE | ❌ | apiFetch n'ajoute jamais `Authorization: Bearer` |
| **Token Refresh** | ❌ NONE | ❌ | Pas de mécanisme d'expiration |
| **Token Revocation** | ❌ NONE | ❌ | Pas de blacklist/logout |
| **Production Auth** | ❌ NONE | ❌ | Complètement cassé |

---

## 3. ANALYSE DES BRÈCHES CRITIQUES

### 3.1 Brèche 1: VUL2 - `/api/auth/change-password` sans `requireAuth`

**Fichier:** [server.ts](server.ts#L1487)  
**Ligne:** 1487  
**Sévérité:** 🔴 CRITIQUE

```typescript
app.post('/api/auth/change-password', async (req, res) => {  // ❌ NO requireAuth!
  // N'importe qui peut changer le mot de passe de n'importe quel user
  // 3 messages d'erreur différents = énumération d'utilisateurs
});
```

**Impact:**
- ❌ Accès non authentifié
- ❌ User enumeration (révèle emails existants)
- ❌ Brute force sur mots de passe

---

### 3.2 Brèche 2: VUL1 - NODE_ENV Check Fragile

**Fichier:** [auth.ts](src/middleware/auth.ts#L37)  
**Ligne:** 37  
**Sévérité:** 🔴 CRITIQUE

```typescript
const isProduction = process.env.NODE_ENV === 'production';
// Problème: Case-sensitive, exact match
// NODE_ENV='prod' → isProduction=false → simulation acceptée EN PRODUCTION!
```

**Scénarios d'attaque:**
- Typo env var → simulation headers acceptés
- Case mismatch → idem

---

### 3.3 Brèche 3: VUL3 - resolveActor() Fallback Silencieux

**Fichier:** [server.ts](server.ts#L127-L130)  
**Ligne:** 127-130  
**Sévérité:** 🟠 HAUTE

```typescript
// Si user non trouvé en DB ET simulated mode
// Retourne quand même simulated user
return {
  uid: req.user.uid,
  role: req.user.role,
  schoolId: req.user.schoolId,
  email: req.user.email,
  name: req.user.name,
} as any;
```

**Impact:**
- Attaquant crée headers arbitraires: `x-simulated-role: super_admin`
- Backend accepte silencieusement
- Escalade de privilege

---

## 4. MÉCANISME D'AUTHENTIFICATION RECOMMANDÉ

### 4.1 Comparaison des Approches

| Critère | JWT (Stateless) | Sessions HTTP-Only | OAuth2 |
|---------|---|---|---|
| **Sécurité XSS** | ⚠️ Risqué (localStorage) | ✅ Excellent | ✅ Excellent |
| **Sécurité CSRF** | ✅ Insensible | ⚠️ Nécessite token | ✅ Géré |
| **Stateless** | ✅ Oui | ❌ Non (session server) | ✅ Oui |
| **Mobile-friendly** | ✅ Excellent | ⚠️ Cookies problems | ✅ Excellent |
| **Scalabilité** | ✅ Excellente | ❌ Difficile (sticky sessions) | ✅ Excellente |
| **Revocation** | ❌ Difficile | ✅ Facile | ✅ Facile |
| **Refresh tokens** | ✅ Possibles | ✅ Natifs | ✅ Natifs |
| **Implémentation** | ⚠️ Complexe | ✅ Simple | ❌ Très complexe |

### 4.2 **Recommandation: JWT + Refresh Token (Hybrid Approach)**

**Pourquoi:**

1. **Déjà partiellement implémenté** → Coût minimal
2. **Stateless** → Scalabilité pour multi-serveur
3. **Mobile-compatible** → App école sur mobile
4. **Revocation possible** → Avec refresh token rotation
5. **Sécurisé** → Si bien implémenté

### 4.3 Architecture JWT Recommandée

```
┌─ Access Token (JWT)
│  ├─ Payload: { uid, email, role, schoolId, iat, exp:15min }
│  ├─ Storage: Memory-only (NOT localStorage) ← Key change
│  ├─ Expiration: 15 minutes
│  └─ Usage: Authorization: Bearer [access_token]
│
├─ Refresh Token (JWT)
│  ├─ Payload: { uid, tokenId, iat, exp:7days }
│  ├─ Storage: HttpOnly cookie (httpOnly=true, secure=true)
│  ├─ Expiration: 7 jours
│  ├─ Rotation: New refresh token on each refresh
│  └─ Usage: POST /api/auth/refresh
│
└─ Login Flow
   ├─ POST /api/auth/local-login (email, password)
   ├─ Validate credentials
   ├─ Generate access token
   ├─ Generate refresh token
   ├─ Set HttpOnly cookie: refresh_token
   └─ Return: { accessToken, user }
```

**Avantages de cette approche:**

✅ **Sécurité XSS:** Access token en mémoire (disparaît au reload)  
✅ **Sécurité CSRF:** Refresh token en HttpOnly cookie  
✅ **Sécurité Logout:** Refresh token rotation  
✅ **Mobile:** Refresh token dans header (pas de cookie)  
✅ **Scalable:** Stateless access token  

---

## 5. PLAN DE MIGRATION - MOINS DE RISQUES

### Phase 1: Préparation (Semaine 1) - ZÉRO modification

**Tâches (audit uniquement):**

1. ✅ Valider JWT_SECRET strength (32+ chars)
2. ✅ Vérifier NODE_ENV en staging/prod
3. ✅ Tester token expiration requirements
4. ✅ Mapper tous les endpoints protégés
5. ✅ Créer rollback procedures

**Livrables:**
- Checklist d'avant-migration
- Rollback documentation
- Monitoring setup

---

### Phase 2: Backend JWT Generation (Semaine 2) - SAFE modifications

**Étape 2.1: Ajouter JWT generation au login**

Fichier: `server.ts` ligne 1438-1475

```typescript
// AVANT:
const response = { ...userRecord, mustReset: !!localMustReset } as any;
res.json(response);

// APRÈS:
const jwt = require('jsonwebtoken');
const secret = process.env.JWT_SECRET || 'dev-fallback-secret';

const accessToken = jwt.sign(
  { uid: userRecord.uid, email: userRecord.email, role: userRecord.role, schoolId: userRecord.schoolId },
  secret,
  { algorithm: 'HS256', expiresIn: '15m' }
);

const refreshToken = jwt.sign(
  { uid: userRecord.uid, tokenId: Date.now() },
  secret,
  { algorithm: 'HS256', expiresIn: '7d' }
);

res.json({
  ...userRecord,
  mustReset: !!localMustReset,
  accessToken,      // ← NEW
  refreshToken,     // ← NEW (optional for now)
});
```

**Impact:**
- ✅ Backward compatible (response still includes user object)
- ✅ Frontend can ignore tokens (still works with x-simulated-*)
- ✅ Dev mode unaffected

---

**Étape 2.2: Add refresh endpoint**

Fichier: `server.ts` (new endpoint)

```typescript
app.post('/api/auth/refresh', async (req, res) => {
  try {
    const refreshToken = req.body.refreshToken;
    if (!refreshToken) return res.status(400).json({ error: 'Missing refresh token' });

    const jwt = require('jsonwebtoken');
    const secret = process.env.JWT_SECRET;
    const decoded = jwt.verify(refreshToken, secret);

    const [dbUser] = await db.select().from(users).where(eq(users.uid, decoded.uid));
    if (!dbUser) return res.status(401).json({ error: 'User not found' });

    const newAccessToken = jwt.sign(
      { uid: dbUser.uid, email: dbUser.email, role: dbUser.role, schoolId: dbUser.schoolId },
      secret,
      { algorithm: 'HS256', expiresIn: '15m' }
    );

    res.json({ accessToken: newAccessToken });
  } catch (err) {
    res.status(401).json({ error: 'Invalid refresh token' });
  }
});
```

---

### Phase 3: Frontend JWT Support (Semaine 3) - GRADUAL rollout

**Étape 3.1: Update apiFetch to use JWT**

Fichier: `src/lib/api.ts` ligne 215-230

```typescript
// BEFORE:
export async function apiFetch(endpoint: string, options: RequestInit = {}) {
  const headers = getSimulationHeaders();  // Only x-simulated-*
  // ...
}

// AFTER (optional feature flag):
export async function apiFetch(endpoint: string, options: RequestInit = {}) {
  let headers: Record<string, string> = { 'Content-Type': 'application/json' };
  
  // Try to use JWT if available
  const accessToken = window.__AUTH_TOKEN__ || sessionStorage.getItem('accessToken');
  if (accessToken) {
    headers['Authorization'] = `Bearer ${accessToken}`;
  } else {
    // Fallback to simulation headers (backward compat)
    const simHeaders = getSimulationHeaders();
    headers = { ...headers, ...simHeaders };
  }
  
  // ...
}
```

**Impact:**
- ✅ Both JWT and x-simulated-* work
- ✅ Gradual migration path
- ✅ Can A/B test

---

**Étape 3.2: Update login component**

Fichier: `src/components/LoginView.tsx` ligne 50-75

```typescript
// After login response:
const user = await response.json();

// Store JWT in memory (NOT localStorage)
if (user.accessToken) {
  window.__AUTH_TOKEN__ = user.accessToken;  // Memory only!
  sessionStorage.setItem('accessToken', user.accessToken);  // For tab restore
}

// Still keep simulation headers for backward compat
setSimulatedRole(user.role);
setSimulatedUser({ id: user.id, uid: user.uid, email: user.email, name: user.name });
```

---

### Phase 4: Production Deployment (Semaine 4) - CAREFUL rollout

**Jour 1: Deploy backend JWT generation**
- All servers now generate JWTs
- requireAuth accepts BOTH Bearer AND x-simulated-*
- Zero impact on frontend

**Jour 2-3: Monitor logs**
- Check for JWT generation errors
- Check for token verification issues
- Verify rate limiting still works

**Jour 4-5: Deploy frontend JWT support**
- Toggle feature flag to use JWT
- Measure error rates
- Keep x-simulated-* fallback active

**Jour 6-7: Disable x-simulated-* (optional)**
- requireAuth ONLY accepts Bearer in prod
- Keep support for dev mode via NODE_ENV check

---

### Phase 5: Cleanup & Hardening (Week 5+)

1. **Fix VUL2:** Add `requireAuth` to `/api/auth/change-password`
2. **Fix VUL1:** Improve NODE_ENV check
3. **Fix VUL3:** Remove resolveActor() fallback
4. **Add:** Token revocation on logout
5. **Add:** Refresh token rotation
6. **Add:** CSRF protection if needed

---

## 6. RISQUES & MITIGATIONS

| Risque | Impact | Mitigation |
|--------|--------|-----------|
| **Broken login in prod** | 🔴 CRITICAL | Phase 1: Validate JWT_SECRET before deploy |
| **XSS token theft** | 🔴 CRITICAL | Store access token in memory only |
| **CSRF attacks** | 🟠 HIGH | Use SameSite=Strict on cookies |
| **Token expiration** | 🟠 HIGH | Auto-refresh before expiration |
| **Logout doesn't work** | 🟠 HIGH | Invalidate refresh token server-side |
| **Old clients break** | 🟡 MEDIUM | Keep x-simulated-* support 2 months |
| **Database down** | 🟡 MEDIUM | JWT is stateless, still works |

---

## 7. VALIDATION CHECKLIST PRÉ-PRODUCTION

```
PRÉ-DÉPLOIEMENT PHASE 1:
☐ JWT_SECRET is set (min 32 chars)
☐ NODE_ENV validated in all environments
☐ Rollback procedures documented
☐ Monitoring alerts configured
☐ Load testing with JWT tokens
☐ Token expiration timing tested

PRÉ-DÉPLOIEMENT PHASE 2-3:
☐ Access token expires in 15 min
☐ Refresh token expires in 7 days
☐ Token refresh works end-to-end
☐ Logout clears refresh token
☐ XSS simulation: token not in localStorage
☐ CSRF simulation: cookie is HttpOnly

PRÉ-DÉPLOIEMENT PHASE 4:
☐ Production error rates < 1%
☐ No "Unauthorized" spam in logs
☐ Mobile clients still work
☐ Old API clients still work (fallback)
☐ Performance: auth <50ms
☐ Security: no token leaks in logs
```

---

## 8. RECOMMANDATIONS FINALES

### À FAIRE IMMÉDIATEMENT 🔴

1. **Fixer VUL2 (HIGH PRIORITY):** Ajouter `requireAuth` à `/api/auth/change-password`
2. **Fixer VUL3 (HIGH PRIORITY):** Supprimer fallback silencieux dans resolveActor()
3. **Fixer VUL1 (MEDIUM):** Améliorer NODE_ENV check

### À FAIRE APRÈS MIGRATION JWT ✅

4. Implémenter JWT complètement (Phases 1-5)
5. Ajouter refresh token rotation
6. Implémenter logout vrai (revocation)
7. Ajouter CSRF protection

### À ÉVITER ❌

- ❌ Ne pas stocker JWT en localStorage
- ❌ Ne pas utiliser sessions serverside (non-scalable)
- ❌ Ne pas implémenter OAuth2 (overkill)
- ❌ Ne pas supprimer simulation headers avant fin Phase 5

---

## 9. TABLEAU DE BORD DE MIGRATION

```
Status: ⏳ NOT STARTED

Phase 1: ⏳ Planning (Semaine 1)
├─ ☐ JWT_SECRET validation
├─ ☐ NODE_ENV check
├─ ☐ Rollback procedures
└─ Est. durée: 5 jours

Phase 2: ⏳ Backend (Semaine 2)
├─ ☐ JWT generation
├─ ☐ Refresh endpoint
├─ ☐ Token verification
└─ Est. durée: 5 jours

Phase 3: ⏳ Frontend (Semaine 3)
├─ ☐ apiFetch update
├─ ☐ LoginView update
├─ ☐ Feature flag
└─ Est. durée: 5 jours

Phase 4: ⏳ Deployment (Semaine 4)
├─ ☐ Staging tests
├─ ☐ Production deploy
├─ ☐ Monitoring
└─ Est. durée: 7 jours

Phase 5: ⏳ Hardening (Week 5+)
├─ ☐ VUL2 fix
├─ ☐ VUL3 fix
├─ ☐ VUL1 fix
└─ Est. durée: 5 jours

**TOTAL: ~4-5 semaines**
```

---

## 10. CONCLUSION

**État actuel:** Partiellement implémenté, cassé en production, 3 failles critiques

**Recommandation:** JWT + Refresh Token hybrid approach

**Risque migration:** 🟡 MEDIUM (si bien planifié et testé)

**Effort:** ~4-5 semaines pour implémentation + hardening complète

**Retour sur investissement:** Production-ready authentication, sécurisé, scalable

