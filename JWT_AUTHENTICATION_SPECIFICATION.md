# JWT Authentication Technical Specification
## Web Écoles - Production-Ready Implementation

**Document Version:** 1.0  
**Date:** 2026-01-11  
**Status:** Ready for Implementation  
**Backward Compatibility:** YES (Hybrid mode supported)

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Current State Analysis](#2-current-state-analysis)
3. [Target Architecture](#3-target-architecture)
4. [JWT Specification](#4-jwt-specification)
5. [Refresh Token Strategy](#5-refresh-token-strategy)
6. [Client-Side Storage Strategy](#6-client-side-storage-strategy)
7. [Authentication Flows](#7-authentication-flows)
8. [File-by-File Changes](#8-file-by-file-changes)
9. [Migration Plan (5 Phases)](#9-migration-plan-5-phases)
10. [Validation & Testing](#10-validation--testing)
11. [Rollback Procedures](#11-rollback-procedures)
12. [Security Considerations](#12-security-considerations)

---

## 1. Executive Summary

### Current Situation
- **Login endpoint** exists but returns **NO JWT** (returns user object only)
- **Frontend** injects **x-simulated-\*** headers (development mode only)
- **Production** authentication **completely broken** (no JWT generation)
- **Middleware** checks for Bearer token but never generates one

### Target Solution
Implement **JWT + Refresh Token (Hybrid Pattern)** with:
- **Access Token**: Short-lived (15 minutes), stored in memory, sent via Authorization header
- **Refresh Token**: Long-lived (7 days), stored in HttpOnly cookie, auto-rotated on use
- **Backward Compatibility**: Dual-mode support (JWT + x-simulated-* headers) for gradual rollout
- **Security**: Automatic refresh, CSRF protection, stateless validation

### Implementation Timeline
- **Phase 1 (Audit)**: 5 days - Validate environment, prepare infrastructure
- **Phase 2 (Backend)**: 5 days - JWT generation, refresh endpoint, token verification
- **Phase 3 (Frontend)**: 5 days - JWT storage, authorization headers, token refresh logic
- **Phase 4 (Deploy)**: 7 days - Canary deployment, monitoring, gradual rollout
- **Phase 5 (Hardening)**: 5 days - Fix VUL1/VUL2/VUL3, cleanup legacy code

**Total: 4-5 weeks with zero downtime**

---

## 2. Current State Analysis

### 2.1 Backend Authentication Components

#### Login Endpoint (`/api/auth/local-login`) - server.ts:1438-1475
**Current Behavior:**
```
Input:  { email, password }
Process: PBKDF2 verification (310,000 iterations)
Output: { id, uid, email, name, role, schoolId, mustReset }
Problem: NO jwt.sign() call - returns raw user object
```

**Current Code Reference:**
- Line 1475: `res.json(response)` ← **NO JWT returned**
- Password hashing: PBKDF2 with 310K iterations, 64 bytes, SHA-512
- Rate limiting: 5 attempts per 15 minutes (✅ already implemented)

#### Password Change Endpoint (`/api/auth/change-password`) - server.ts:1487-1509
**Current Issues:**
- ❌ Missing `requireAuth` middleware (CRITICAL VULNERABILITY)
- ❌ Three different error messages reveal user enumeration (VUL2)
- ❌ No rate limiting
- Anyone can change anyone's password if they know email + current password

#### Authentication Middleware (`auth.ts`) - Lines 37-125
**Current Logic:**
```
if NODE_ENV === 'production':
  → Expect Bearer token (jwt.verify)
  → If missing: return 401 "Unauthorized: Missing token"
else:
  → Check x-simulated-* headers
  → If missing: return 401
```

**Problem:** In production, NO jwt.sign() exists → all requests fail with 401

### 2.2 Frontend Authentication Components

#### API Layer (`src/lib/api.ts`) - Lines 150-230
**Current Behavior:**
- `getSimulationHeaders()` generates only x-simulated-* headers
- `apiFetch()` injects headers into every request
- No Authorization Bearer header generation
- localStorage keys:
  - `ecoletrack_simulated_role`
  - `ecoletrack_simulated_user`
  - `ecoletrack_active_school_id`

**Problem:** Frontend has NO JWT support - only simulation headers

#### Login Component (`src/components/LoginView.tsx`)
**Current Flow:**
1. POST `/api/auth/local-login` with email/password
2. Receive user object
3. Store in localStorage (x-simulated-*)
4. POST `/api/auth/register-or-login` with x-simulated-* headers
5. Frontend acts as proxy - never stores actual credentials

---

## 3. Target Architecture

### 3.1 Authentication Stack (Post-Migration)

```
┌─────────────────────────────────────────────────────────────┐
│                    USER (Browser)                            │
└────────────┬──────────────────────────────────────┬──────────┘
             │                                      │
          LOGIN                              REFRESH TOKEN EXPIRY
             │                                      │
             v                                      v
    ┌────────────────┐                    ┌─────────────────┐
    │ LoginView.tsx  │                    │  useJWTRefresh  │
    │ (React)        │                    │  Hook (React)   │
    └────────┬───────┘                    └────────┬────────┘
             │                                      │
             │ email+password                       │ refresh_token cookie
             │                                      │
             v                                      v
    ┌─────────────────────────────────────────────────────────┐
    │        /api/auth/local-login                            │
    │        (Bearer: none, CORS: allow)                       │
    │                                                          │
    │  1. Verify email + password (PBKDF2)                    │
    │  2. Create access token (15 min)                        │
    │  3. Create refresh token (7 days)                       │
    │  4. Return: { accessToken, user }                       │
    │  5. Set-Cookie: refreshToken (HttpOnly, Secure, SameSite) │
    └─────────────────────────────────────────────────────────┘
             │
             │ accessToken (memory) + refreshToken (cookie)
             │
             v
    ┌─────────────────────────────────────────────────────────┐
    │             Protected API Requests                       │
    │                                                          │
    │  Authorization: Bearer <accessToken>                    │
    │  Cookie: refreshToken=<token>                           │
    │                                                          │
    │  Middleware: verifyToken()                              │
    │  ✓ Extract from header                                  │
    │  ✓ Validate signature + expiry                          │
    │  ✓ Check blacklist (if revoked)                         │
    │  ✓ Attach req.user = payload                            │
    └─────────────────────────────────────────────────────────┘
             │
      ┌──────┴──────┐
      ▼             ▼
   SUCCESS      EXPIRED (401)
                    │
                    v
            ┌─────────────────────────┐
            │ /api/auth/refresh       │
            │ (Bearer: optional)      │
            │                         │
            │ 1. Extract refreshToken │
            │ 2. Verify signature     │
            │ 3. Check blacklist      │
            │ 4. Create new access    │
            │ 5. Rotate refresh       │
            │ 6. Return new tokens    │
            └─────────────────────────┘
                    │
                    v
            New accessToken (memory)
```

### 3.2 Dual-Mode Architecture (Hybrid Support)

During migration, both JWT and simulation headers work:

```
Authentication Request

         ↓
    ┌────────────────┐
    │ Has Bearer?    │ ← Authorization: Bearer <token>
    └────────┬───────┘
             │
          No│ Yes
            ├────→ Verify JWT (lines 97-120 in auth.ts)
            │
          Check x-simulated-* headers
            │
          ├─ If present: Accept (dev mode)
          ├─ If absent: 401 (prod mode / not initialized)
```

**Timeline:**
- **Phase 2-3**: Both work simultaneously
- **Phase 4**: Canary 10% → 50% → 100% JWT users
- **Phase 5**: Remove x-simulated-* header fallback, enforce JWT only

---

## 4. JWT Specification

### 4.1 Access Token (Short-Lived)

**Claim Structure:**
```json
{
  // Standard claims (RFC 7519)
  "iss": "ecoletrack",                          // Issuer
  "sub": "user_123",                            // Subject (user ID)
  "aud": "ecoletrack-api",                      // Audience
  "iat": 1710000000,                            // Issued At
  "exp": 1710900000,                            // Expiration (15 minutes later)
  
  // Custom claims
  "uid": "teacher_2024_001",                    // User unique ID
  "email": "prof@school.fr",                    // User email
  "name": "Jean Dupont",                        // User full name
  "role": "teacher",                            // RBAC role
  "schoolId": 5,                                // Active school context
  "academicYearId": 42,                         // Active academic year
  
  // Security claims
  "type": "access",                             // Token type (discriminator)
  "tokenId": "jti_...",                         // Unique token ID (for blacklist)
  "sessionId": "sess_...",                      // Session identifier
  "ipHash": "sha256(last_octet_of_ip)",        // IP fingerprint (optional)
  
  // Refresh token rotation tracking
  "refreshVersion": 3,                          // Incremented on refresh
}
```

**Format:**
```
Access Token (RS256 signed, 15 minutes):
eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.[payload].[signature]

Headers:
Authorization: Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.[payload].[signature]
```

**Parameters:**
- **Algorithm**: RS256 (RSA with SHA-256) — NOT HS256
  - ✅ Public key validation (can verify without private key)
  - ✅ Signature forgery prevention (requires private key)
  - ✅ Key rotation support (multiple keys in JWKS endpoint)
- **TTL**: 15 minutes (short-lived, limits damage from token theft)
- **Issued**: Immediately after login or refresh
- **Verified by**: All protected endpoints

### 4.2 Refresh Token (Long-Lived)

**Claim Structure:**
```json
{
  // Standard claims
  "iss": "ecoletrack",
  "sub": "user_123",
  "aud": "ecoletrack-api",
  "iat": 1710000000,
  "exp": 1710604800,                            // Expiration (7 days later)
  
  // Custom claims
  "uid": "teacher_2024_001",
  "role": "teacher",
  
  // Security claims
  "type": "refresh",                            // Token type
  "tokenId": "jti_refresh_...",                // Unique refresh token ID
  "sessionId": "sess_...",                      // Same as access token
  "version": 3,                                 // Prevents reuse of old versions
  
  // Rotation tracking
  "rotationChain": [
    "jti_refresh_1",
    "jti_refresh_2",
    "jti_refresh_3"
  ]                                             // All previous versions (detect theft)
}
```

**Format:**
```
Refresh Token (RS256 signed, 7 days):
eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.[payload].[signature]

Storage: HttpOnly, Secure, SameSite=Strict Cookie
Set-Cookie: refreshToken=<token>; HttpOnly; Secure; SameSite=Strict; Max-Age=604800; Path=/api
```

**Parameters:**
- **Algorithm**: RS256 (same as access token)
- **TTL**: 7 days (longer than access token, balances security vs UX)
- **Storage**: HttpOnly cookie (JavaScript cannot access)
  - ✅ Protected from XSS (JavaScript theft)
  - ✅ Auto-sent by browser (no code needed)
  - ✅ CSRF token required for POST requests
- **Transmission**: Automatic by browser (Set-Cookie / Cookie headers)
- **Verification**: Only `/api/auth/refresh` endpoint uses it

### 4.3 Token Signing Keys

**Backend Configuration:**
```yaml
JWT_PRIVATE_KEY: |
  -----BEGIN RSA PRIVATE KEY-----
  [2048-bit RSA private key in PEM format]
  -----END RSA PRIVATE KEY-----
  
JWT_PUBLIC_KEY: |
  -----BEGIN PUBLIC KEY-----
  [2048-bit RSA public key in PEM format]
  -----END PUBLIC KEY-----

JWT_ALGORITHM: RS256
JWT_ISSUER: ecoletrack
JWT_AUDIENCE: ecoletrack-api

ACCESS_TOKEN_EXPIRY: 15m        # 15 minutes
REFRESH_TOKEN_EXPIRY: 7d        # 7 days
```

**Key Generation (One-time during Phase 1):**
```bash
# Generate RSA keypair (2048-bit minimum, preferably 4096)
openssl genrsa -out private.pem 2048
openssl rsa -in private.pem -pubout -out public.pem

# Store in environment:
JWT_PRIVATE_KEY=$(cat private.pem)
JWT_PUBLIC_KEY=$(cat public.pem)
```

**Key Rotation Strategy:**
- Store multiple public keys in JWKS endpoint (`/.well-known/jwks.json`)
- Each key has a `kid` (Key ID) and `use: sig` metadata
- Old keys kept for 30 days (allow tokens to expire naturally)
- New tokens always signed with latest key

---

## 5. Refresh Token Strategy

### 5.1 Token Rotation (Automatic)

**Goal:** Detect token theft and limit damage window

**Mechanism:**
```
User Login
    ↓
Create: accessToken_v1 + refreshToken_v1
    ↓
Access Token Expires (15 min)
    ↓
Frontend calls /api/auth/refresh with cookie
    ↓
Backend:
  1. Verify refreshToken_v1 (signature + expiry)
  2. Check if version already used (detect reuse)
  3. Create: accessToken_v2 + refreshToken_v2
  4. Return new accessToken (memory)
  5. Set new refreshToken cookie (replaces old one)
  ↓
Next request uses accessToken_v2
```

**Rotation Rules:**
- ✅ Every refresh creates **new refresh token**
- ✅ Version counter increments (`version: 3`)
- ✅ If old version reused → entire session blacklisted (token theft detected)
- ✅ Keep rotation chain (last 10 tokens) for theft detection
- ✅ Old refresh token invalidated when new one issued

**Theft Detection:**
```
Scenario: Attacker steals refreshToken_v1

Legitimate flow:
  User: /api/auth/refresh with v1 → Server: accept, return v2 ✓
  User: /api/auth/refresh with v2 → Server: accept, return v3 ✓

Attack flow:
  User: /api/auth/refresh with v1 → Server: return v2
  Attacker: /api/auth/refresh with v1 → Server: DETECT reuse!
    → Action: Blacklist entire session
    → Response: 401 (force re-login)
    → Alert: Log suspicious activity
```

### 5.2 Token Revocation (Manual)

**Cases:**
1. **Logout** - User initiates
2. **Password Change** - Security event
3. **Account Suspension** - Admin action
4. **Theft Detection** - Automatic
5. **Device Loss** - User reports

**Revocation Mechanism:**
```
Token Blacklist (In-Memory Cache + Database)

Structure:
{
  tokenId: "jti_...",
  userId: 123,
  revokedAt: "2026-01-11T10:00:00Z",
  reason: "user_logout | password_changed | admin_revoke | theft_detected",
  sessionId: "sess_...",
  expiresAt: "2026-01-18T10:00:00Z"  // TTL = token lifetime
}

Storage:
- Redis (primary, fast, TTL auto-cleanup)
- PostgreSQL (backup, audit trail)

Verification on every request:
  if tokenId in blacklist:
    return 401 "Token revoked"
```

### 5.3 Session Lifecycle

```
┌─────────────────────────────────────────┐
│  User Logs In                           │
│  POST /api/auth/local-login             │
│  ↓ email + password verified            │
│  ✓ Access Token created (15 min)        │
│  ✓ Refresh Token created (7 days)       │
│  ✓ Session created in DB                │
│  ↓ sessionId stored in both tokens      │
└─────────────────────────────────────────┘
             │
             │ (15 minutes later)
             ↓
┌─────────────────────────────────────────┐
│  Access Token Expires                   │
│  Frontend detects 401                   │
│  POST /api/auth/refresh                 │
│  ← refreshToken from cookie             │
│  ✓ New Access Token (15 min)            │
│  ✓ New Refresh Token (7 days)           │
│  ✓ Version incremented                  │
└─────────────────────────────────────────┘
             │
             │ (7 days later)
             ↓
┌─────────────────────────────────────────┐
│  Refresh Token Expires                  │
│  Frontend detects 401                   │
│  POST /api/auth/refresh                 │
│  ← NO valid refresh token               │
│  ✗ 401 "Refresh token expired"          │
│  ↓ Redirect to login                    │
└─────────────────────────────────────────┘
             │
             │ OR User clicks Logout
             ↓
┌─────────────────────────────────────────┐
│  User Logs Out                          │
│  POST /api/auth/logout                  │
│  ↓ Revoke all tokens in session        │
│  ✓ Clear refreshToken cookie            │
│  ✓ Clear accessToken (memory)           │
│  ✓ Blacklist all sessionId tokens      │
│  ✓ Log audit event                      │
└─────────────────────────────────────────┘
```

---

## 6. Client-Side Storage Strategy

### 6.1 Storage Architecture

```
┌──────────────────────────────────────────────────────┐
│              Browser Storage Tiers                    │
├──────────────────────────────────────────────────────┤
│                                                       │
│  Tier 1: HttpOnly Cookie (Most Secure)              │
│  ───────────────────────────────────────             │
│  • refreshToken                                      │
│  • Inaccessible to JavaScript (XSS-proof)           │
│  • Auto-sent in requests (Secure + SameSite)        │
│  • Lifetime: 7 days                                  │
│  • Path: /api (only API requests)                    │
│                                                       │
│  Tier 2: Memory (Session Only)                       │
│  ───────────────────────────────────────             │
│  • accessToken                                       │
│  • Lost on page refresh/close                        │
│  • Manually injected in Authorization header        │
│  • Lifetime: 15 minutes or session end               │
│  • Pros: Zero XSS risk for access token            │
│  • Con: Lost on refresh (refresh token recovers)    │
│                                                       │
│  Tier 3: localStorage (Transient State)              │
│  ───────────────────────────────────────             │
│  • user: { id, uid, email, name, role }             │
│  • activeSchoolId: number                            │
│  • academicYearId: number                            │
│  • themePreference: string                           │
│  • ⚠️ NOT credentials - only display data             │
│  • Lifetime: Indefinite (cleared on logout)          │
│  • Pros: Persists page refresh                       │
│  • Con: Accessible to XSS (but contains no token)   │
│                                                       │
│  Tier 4: sessionStorage (Tab-Local State)            │
│  ───────────────────────────────────────             │
│  • pendingUserAction: { type, state }                │
│  • formDraft: { ... }                                │
│  • navigationState: { ... }                          │
│  • Lifetime: Until tab closed                        │
│  • Separate per tab                                  │
│                                                       │
└──────────────────────────────────────────────────────┘
```

### 6.2 Storage Implementation Details

**HttpOnly Cookie Setup:**
```
Response Header (from /api/auth/local-login):
Set-Cookie: refreshToken=<jwt>; 
            HttpOnly;              // No JavaScript access
            Secure;                // HTTPS only
            SameSite=Strict;       // CSRF protection
            Path=/api;             // Only sent to /api/*
            Max-Age=604800;        // 7 days
            Domain=ecoletrack.fr;  // Cookie domain
```

**Memory Storage (JavaScript):**
```typescript
// DO: Store in state variable (React)
const [accessToken, setAccessToken] = useState<string | null>(null);
const [user, setUser] = useState<UserData | null>(null);

// DON'T: Store in localStorage
// localStorage.setItem('accessToken', token); // ✗ XSS vulnerability

// Manual injection in requests:
headers: {
  'Authorization': `Bearer ${accessToken}`,
  // refreshToken automatically sent in cookies
}
```

**localStorage Key Names (For Display State Only):**
```
Old (Dev Mode):                    New (Persistent User State):
─────────────────────             ──────────────────────────
ecoletrack_simulated_role        → user.role (in memory)
ecoletrack_simulated_user        → user object (in memory)
ecoletrack_active_school_id      → activeSchoolId (in memory)

Additional (New):
─────────────────
ecoletrack_jwt_enabled: true     // Feature flag (enables JWT mode)
ecoletrack_user_preferences: {}  // UI theme, language, etc.
```

### 6.3 Token Refresh Flow (Frontend)

**Scenario: Access Token Expired During Request**

```typescript
// Flow in apiFetch wrapper:

1. Make request with accessToken
   → Authorization: Bearer <token>

2. Server returns 401 "Token expired"

3. Automatically retry with refresh:
   → POST /api/auth/refresh
   → Cookie: refreshToken=<token>  (auto-sent by browser)

4. Backend returns:
   → 200: { accessToken: new_token, user, ... }
   → Set-Cookie: refreshToken=<new_token> (auto-stored by browser)

5. Frontend stores new accessToken in memory:
   → setAccessToken(new_token)

6. Retry original request:
   → Authorization: Bearer <new_token>

7. Request succeeds ✓
```

### 6.4 Logout Implementation

**Frontend Logout:**
```typescript
// User clicks "Logout"
1. POST /api/auth/logout
   → Backend: Revoke all tokens for this session
   → Backend: Return empty Set-Cookie headers

2. Frontend cleanup:
   → Clear accessToken state: setAccessToken(null)
   → Clear user state: setUser(null)
   → Clear localStorage
   → Browser auto-clears cookie (Set-Cookie: expires=0)

3. Redirect: /login
```

**Backend Response:**
```
POST /api/auth/logout → 200 OK

Headers:
Set-Cookie: refreshToken=; 
            Expires=Thu, 01 Jan 1970 00:00:00 UTC;
            HttpOnly;
            Secure;
            SameSite=Strict;
            Path=/api;

Body:
{ success: true }
```

---

## 7. Authentication Flows

### 7.1 Login Flow (Initial Authentication)

```
┌────────────────────────────────────────────────────────────┐
│ ACTOR: New User (Not Authenticated)                        │
└────────────────────────────────────────────────────────────┘

Step 1: User submits login form
├─ Email: prof@school.fr
├─ Password: ••••••••
└─ Target: POST /api/auth/local-login

Step 2: Backend processes login
├─ Query: SELECT * FROM users WHERE email = 'prof@school.fr'
├─ Check: User exists & not deleted
├─ Verify: PBKDF2(password, salt, 310K iterations) = storedHash
├─ Create: accessToken (15 min)
├─ Create: refreshToken (7 days)
├─ Log: audit_events.insert(action='login', userId, ipHash)
└─ Blacklist: Any previous tokens for old sessions

Step 3: Response to frontend
├─ Status: 200 OK
├─ Body: {
│    accessToken: "eyJ...",
│    user: { id, uid, email, name, role, schoolId, academicYearId },
│    refreshTokenExpiresAt: "2026-01-18T10:00:00Z"
│  }
├─ Header: Set-Cookie: refreshToken=<jwt>; HttpOnly; Secure; SameSite=Strict; Max-Age=604800
└─ Note: NO CORS issue (refreshToken in cookie, auto-sent)

Step 4: Frontend stores tokens
├─ Memory: setAccessToken(response.accessToken)
├─ Memory: setUser(response.user)
├─ localStorage: user object (for persistence across refresh)
├─ Cookie: Auto-stored by browser (refreshToken)
└─ Redirect: /dashboard

Step 5: First authenticated request
├─ Request: GET /api/schools
├─ Header: Authorization: Bearer <accessToken>
├─ Cookie: refreshToken=<token> (auto-sent)
├─ Middleware: verifyToken()
│   ├─ Extract token from Authorization header
│   ├─ Verify RS256 signature (using public key)
│   ├─ Check expiry: iat + 900s > now
│   ├─ Check blacklist: tokenId not revoked
│   └─ Attach: req.user = payload
├─ Route: Execute with req.user available
└─ Success: Return 200 with school list
```

### 7.2 Token Refresh Flow (Expired Access Token)

```
┌────────────────────────────────────────────────────────────┐
│ ACTOR: Authenticated User (Access Token Expired)           │
└────────────────────────────────────────────────────────────┘

Precondition: User has valid refreshToken cookie
- Set-Cookie: refreshToken=<jwt_v1>

Step 1: User makes request with expired access token
├─ GET /api/students?classId=42
├─ Header: Authorization: Bearer <accessToken_expired>
├─ Cookie: refreshToken=<jwt_v1> (auto-sent by browser)
└─ Middleware: verifyToken() → 401 "Token expired"

Step 2: Frontend detects 401
├─ Error: 401 Token Expired
├─ Action: Trigger automatic refresh
└─ Call: POST /api/auth/refresh

Step 3: Refresh request
├─ POST /api/auth/refresh
├─ No Authorization header needed (use cookie instead)
├─ Cookie: refreshToken=<jwt_v1> (auto-sent)
├─ CSRF Token: <token> (header: X-CSRF-Token or body)
└─ Note: CORS allows credentials (withCredentials: true)

Step 4: Backend processes refresh
├─ Extract: refreshToken from cookie
├─ Verify: RS256 signature valid
├─ Check: Token not expired (exp > now)
├─ Detect: If version reused (e.g., v1 used twice)
│   └─ Action: Blacklist entire session, return 401
├─ Check: tokenId not in blacklist
├─ Lookup: Session in DB
├─ Verify: Session not revoked (logout, password change, etc.)
├─ Create: accessToken_v2 (15 min)
├─ Create: refreshToken_v2 (7 days, version=2)
├─ Blacklist: refreshToken_v1 (revocation)
├─ Update: Session.lastRefreshedAt = now
└─ Log: audit_events.insert(action='token_refreshed', userId, version=2)

Step 5: Response
├─ Status: 200 OK
├─ Body: {
│    accessToken: "eyJ...",  // New access token
│    refreshTokenExpiresAt: "2026-01-18..."
│  }
├─ Header: Set-Cookie: refreshToken=<jwt_v2>; ...
│           (replaces old cookie automatically)
└─ Note: Old refreshToken_v1 invalidated

Step 6: Frontend updates tokens
├─ Memory: setAccessToken(<new_accessToken>)
├─ Cookie: Auto-updated by browser (new refreshToken)
└─ Continue: Retry original request

Step 7: Retry original request
├─ GET /api/students?classId=42
├─ Header: Authorization: Bearer <accessToken_v2>  (NEW)
├─ Cookie: refreshToken=<jwt_v2> (NEW)
└─ Success: 200 with student list ✓
```

### 7.3 Logout Flow (Session Termination)

```
┌────────────────────────────────────────────────────────────┐
│ ACTOR: Authenticated User (Wants to Logout)                │
└────────────────────────────────────────────────────────────┘

Step 1: User clicks "Logout" button
└─ Trigger: handleLogout() in HeaderNav component

Step 2: Frontend cleanup
├─ Clear: accessToken state
├─ Clear: user state
├─ Clear: localStorage items
├─ Call: POST /api/auth/logout

Step 3: Logout request
├─ POST /api/auth/logout
├─ Header: Authorization: Bearer <accessToken>
├─ Cookie: refreshToken=<jwt> (auto-sent)
├─ CSRF Token: <token>
└─ Body: { sessionId?: "sess_..." } (optional)

Step 4: Backend processes logout
├─ Verify: Authorization header valid (or use sessionId from body)
├─ Extract: sessionId from token payload
├─ Blacklist: All tokens with this sessionId
│   └─ INSERT INTO token_blacklist (sessionId, ...)
├─ Update: Session.status = 'ended'
├─ Update: Session.endedAt = now
├─ Log: audit_events.insert(action='logout', userId, sessionId)
└─ Verification: All related refresh tokens now invalid

Step 5: Response
├─ Status: 200 OK
├─ Body: { success: true }
├─ Header: Set-Cookie: refreshToken=;
│           Expires=Thu, 01 Jan 1970 00:00:00 UTC;
│           (clears cookie)
└─ Note: No tokens in response body

Step 6: Frontend final cleanup
├─ Browser clears: refreshToken cookie (Set-Cookie: Expires=past)
├─ Redirect: /login
└─ UI: Show "You have been logged out"

Step 7: Next request (if attacker tries stolen token)
├─ Authorization: Bearer <accessToken_from_session>
├─ Middleware: verifyToken()
├─ Check: tokenId in blacklist? YES ✓
├─ Response: 401 "Token revoked"
└─ No access granted ✓
```

### 7.4 Theft Detection Flow (Dual Token Reuse)

```
┌────────────────────────────────────────────────────────────┐
│ SCENARIO: Refresh Token Stolen (Attacker & User Both Use) │
└────────────────────────────────────────────────────────────┘

Initial State:
├─ Legitimate User has: refreshToken_v1
├─ Attacker steals: refreshToken_v1 (via XSS or network sniff)
└─ Both try to use the same token

Timeline:

T=0:00  User makes request
├─ Normal flow, access token valid
└─ No action

T=0:15  Attacker attempts refresh
├─ POST /api/auth/refresh (with stolen refreshToken_v1)
├─ Backend: Verify signature ✓
├─ Backend: Check version (v1) ✓
├─ Backend: Not in rotation chain yet (first use)
├─ Backend: Create accessToken_v2_attacker
├─ Backend: Create refreshToken_v2_attacker
├─ Backend: Blacklist refreshToken_v1
└─ Attacker: Has new tokens (v2_attacker)

T=0:16  User attempts refresh (with original token)
├─ POST /api/auth/refresh (with original refreshToken_v1)
├─ Backend: Check if tokenId in blacklist
├─ Backend: YES! Already revoked by attacker's refresh
├─ Backend: Alert! Token reuse detected
├─ Backend: Action:
│   ├─ Revoke entire session (all tokens)
│   ├─ Blacklist: accessToken_v2_attacker
│   ├─ Blacklist: refreshToken_v2_attacker
│   ├─ Blacklist: All tokens from this session
│   └─ Log: SECURITY_ALERT (theft_detected, userId, sessionId)
├─ Backend: Response: 401 "Token revoked - session compromised"
└─ User: Forced to re-login

T=0:17  Attacker tries to use stolen token again
├─ POST /api/auth/refresh (with refreshToken_v2_attacker)
├─ Backend: Token is in blacklist (entire session revoked)
├─ Response: 401 "Session compromised"
└─ No access ✓

T=0:18  User attempts login again
├─ User: re-enters credentials
├─ Backend: Create new session (v1 restart)
├─ Note: Attacker has OLD tokens (from compromised session)
├─ All old tokens blacklisted, new session started
└─ Security recovered ✓
```

---

## 8. File-by-File Changes

### 8.1 Backend Files (Express.js)

#### File: `src/middleware/auth.ts`
**Current State:** JWT verification logic exists but never called (no jwt.sign)  
**Changes Required:**

1. **Import additions** (Line ~5)
   - Add: `import jwt from 'jsonwebtoken'`
   - Add: `import { createHash } from 'crypto'` (for IP fingerprinting)
   - Already imported: `verifyToken` from this file

2. **New configuration** (After imports, ~line 20)
   - Add environment variables loading: `JWT_PRIVATE_KEY`, `JWT_PUBLIC_KEY`, `JWT_ISSUER`, `JWT_AUDIENCE`
   - Validate: Keys exist and are valid PEM format
   - Add configuration object: `{ algorithm: 'RS256', issuer, audience }`

3. **Replace verifyToken function** (Lines 37-125)
   - **Keep existing logic** for backward compatibility (x-simulated-* headers)
   - **Add JWT verification first** (before simulation header check)
   - **New priority order:**
     1. If Authorization header exists: Verify JWT (RS256)
     2. Else if x-simulated-* headers exist: Accept (dev mode)
     3. Else: Return 401
   - Add blacklist checking (query Redis + DB)
   - Extract req.user from JWT claims

4. **New function: generateAccessToken** (Line ~130)
   - Input: `{ userId, uid, email, name, role, schoolId, academicYearId, sessionId, ipAddress }`
   - Process: `jwt.sign({ ... claims ... }, privateKey, { algorithm: 'RS256', expiresIn: '15m' })`
   - Output: Signed JWT string
   - Claims include: tokenId (uuid), sessionId, refreshVersion

5. **New function: generateRefreshToken** (Line ~150)
   - Input: `{ userId, uid, role, sessionId, version }`
   - Process: `jwt.sign({ ... claims ... }, privateKey, { algorithm: 'RS256', expiresIn: '7d', type: 'refresh' })`
   - Output: Signed JWT string
   - Store in DB: `token_sessions` table with version, sessionId

6. **New function: revokeToken** (Line ~170)
   - Input: `tokenId, reason, expiresAt`
   - Process: 
     - Add to Redis blacklist (with TTL = token expiry)
     - Insert to `token_blacklist` table (audit trail)
   - Returns: boolean success

7. **Keep existing exports:**
   - `export const requireAuth = verifyToken` (unchanged)
   - Add: `export { generateAccessToken, generateRefreshToken, revokeToken }`

---

#### File: `src/middleware/csrf.ts` (NEW FILE)
**Purpose:** CSRF protection for token refresh endpoint  
**Changes Required:**

1. **Create new file** with CSRF middleware
   - Use `csurf` package (already likely in dependencies)
   - Store tokens in session/localStorage (frontend-side)
   - Add CSRF token verification on POST `/api/auth/refresh`

2. **Middleware function:**
   - Extract CSRF token from request header: `X-CSRF-Token`
   - Or from request body: `_csrf`
   - Verify against session/stored value
   - Return 403 if invalid

---

#### File: `server.ts`
**Current State:** Login endpoint exists, returns user object (no JWT)  
**Changes Required:**

1. **POST /api/auth/local-login** (Lines 1438-1475)
   - **Add after password verification (line 1464):**
     - Generate: `accessToken = generateAccessToken({ userId: userRecord.id, ... })`
     - Generate: `refreshToken = generateRefreshToken({ userId: userRecord.id, ... })`
     - Create session: `INSERT INTO token_sessions (userId, sessionId, version, createdAt, ...)`
   - **Add to response (line 1475):**
     - Return: `{ accessToken, user: userRecord, mustReset: localMustReset }`
   - **Add Set-Cookie header:**
     ```
     Set-Cookie: refreshToken=<token>; 
                 HttpOnly; Secure; SameSite=Strict; 
                 Max-Age=604800; Path=/api
     ```
   - **Rate limiting:** Already exists ✓ (lines ~1436)

2. **POST /api/auth/refresh** (NEW ENDPOINT, insert before logout)
   - Endpoint: `app.post('/api/auth/refresh', csrfProtection, async (req, res) => {`
   - Extract: `refreshToken` from req.cookies or req.body
   - Verify: JWT signature valid
   - Check: Token type = "refresh"
   - Check: Not in blacklist
   - Check: Version matches DB (detect reuse)
   - **If version reused:** Blacklist entire session (theft detected)
   - **If valid:** 
     - Create new accessToken
     - Create new refreshToken (version++)
     - Blacklist old refreshToken
     - Return: `{ accessToken, refreshTokenExpiresAt }`
     - Set new cookie

3. **POST /api/auth/logout** (Lines ~1481)
   - **Add authentication check:**
     - Add `requireAuth` middleware
     - Extract `sessionId` from req.user (from JWT claims)
   - **Add revocation logic:**
     - Call: `revokeToken(req.user.tokenId, 'user_logout', expiresAt)`
     - Blacklist: All tokens in this session
     - Update: `token_sessions.status = 'ended'`
   - **Add Set-Cookie clear:**
     - Set-Cookie: refreshToken=; Expires=<past>; ...
   - **Add audit logging:**
     - `logAuditEvent(req.user, 'logout', 'session', null, null, '...')`

4. **POST /api/auth/change-password** (Lines 1487-1509) - **CRITICAL FIX**
   - **Add `requireAuth` middleware** (was missing!)
   - **Add rate limiting:**
     - New limiter: 3 attempts per hour (stricter than login)
   - **Remove user enumeration:**
     - Replace 3 different error messages with single generic: "Invalid credentials"
   - **Add:**
     - `const user = req.user` (from JWT)
     - Revoke all old tokens: `revokeToken(..., 'password_changed')`
     - Create new tokens after password change
     - Force token refresh on all devices

5. **Middleware: Token blacklist check**
   - Add to `verifyToken` function call path
   - Query: Redis first (fast), then DB (fallback)
   - Cache: 5 minute TTL

---

#### File: `src/db/schema.ts` (or equivalent ORM schema)
**Current State:** Has `users`, `localAuths`, `auditEvents` tables  
**Changes Required:**

1. **New table: `tokenSessions`**
   - `id` (uuid primary)
   - `userId` (fk → users)
   - `sessionId` (uuid, indexed)
   - `accessTokenVersion` (int, starts at 1)
   - `lastRefreshTokenId` (uuid)
   - `lastRefreshAt` (timestamp)
   - `status` (enum: 'active', 'ended', 'compromised')
   - `ipAddress` (varchar, optional)
   - `userAgent` (text, optional)
   - `createdAt` (timestamp)
   - `endedAt` (timestamp, nullable)
   - `expiresAt` (timestamp)

2. **New table: `tokenBlacklist`**
   - `id` (uuid primary)
   - `tokenId` (uuid, indexed)
   - `sessionId` (uuid, fk → tokenSessions, indexed)
   - `userId` (int, fk → users, indexed)
   - `tokenType` (enum: 'access', 'refresh')
   - `reason` (enum: 'user_logout', 'password_changed', 'theft_detected', 'admin_revoke')
   - `revokedAt` (timestamp)
   - `expiresAt` (timestamp, with TTL index)
   - `createdAt` (timestamp)

3. **Alter table: `users`**
   - Add: `mustReset` (boolean, default false) — if not exists

---

#### File: `.env.example` (or similar config file)
**Changes Required:**

Add new environment variables:
```
# JWT Configuration
JWT_PRIVATE_KEY=-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----
JWT_PUBLIC_KEY=-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----
JWT_ALGORITHM=RS256
JWT_ISSUER=ecoletrack
JWT_AUDIENCE=ecoletrack-api
ACCESS_TOKEN_EXPIRY=15m
REFRESH_TOKEN_EXPIRY=7d

# Token rotation
TOKEN_VERSION_CHECK_ENABLED=true
TOKEN_ROTATION_CHAIN_LENGTH=10

# Blacklist storage
TOKEN_BLACKLIST_REDIS_URL=redis://localhost:6379
TOKEN_BLACKLIST_TTL_MINUTES=10080  # 7 days

# CSRF Protection
CSRF_ENABLED=true

# Feature flags
JWT_ENABLED=true  # Phase 3+
LEGACY_SIMULATION_ENABLED=true  # Phase 1-2, disabled in Phase 5
```

---

### 8.2 Frontend Files (React)

#### File: `src/lib/api.ts`
**Current State:** Only generates x-simulated-* headers  
**Changes Required:**

1. **Import additions** (Line ~5)
   - Add: `import axios from 'axios'`
   - Add refresh logic helper

2. **New state management** (After existing helpers, ~line 40)
   - Create context: `AuthContext` with:
     - `accessToken: string | null`
     - `user: UserData | null`
     - `isAuthenticated: boolean`
     - `refreshToken(): Promise<void>`
     - `logout(): Promise<void>`

3. **Update `apiFetch` function** (Lines 215-230)
   - **Before sending request:**
     - Check if accessToken exists in context
     - If YES: Add header `Authorization: Bearer ${accessToken}`
     - If NO: Skip (allow simulation headers fallback for dev)
   - **After response:**
     - If status 401:
       - Check error: "Token expired"
       - Call: `refreshAccessToken()`
       - Retry original request with new token
   - **CSRF token:**
     - Extract from meta tag or localStorage
     - Add header: `X-CSRF-Token: <token>`

4. **New function: `setAccessToken(token)`** (Line ~50)
   - Store in: Memory state (NOT localStorage)
   - Purpose: Subsequent requests use this token

5. **New function: `refreshAccessToken()`** (Line ~60)
   - Endpoint: `POST /api/auth/refresh`
   - No Authorization header (use cookie instead)
   - Include CSRF token: Header `X-CSRF-Token`
   - On success: `setAccessToken(response.accessToken)`
   - On failure (401): Force redirect to `/login`
   - Auto-retry pending requests

6. **Keep backward compatibility:**
   - If `JWT_ENABLED` env var is false: Use x-simulated-* headers
   - If JWT_ENABLED is true: Use accessToken + refreshToken
   - Gradually transition via feature flag

7. **Axios interceptor** (Optional, after apiFetch):
   - Intercept 401 responses
   - Automatically call refresh
   - Retry request
   - Handles token expiry transparently

---

#### File: `src/components/LoginView.tsx`
**Current State:** POST to login, then POST to register-or-login with x-simulated-*  
**Changes Required:**

1. **Update handleLogin** (Lines 50-65)
   - **After successful login (POST /api/auth/local-login):**
     - Extract: `accessToken` from response
     - Extract: `user` from response
     - Store: `setAccessToken(accessToken)` — memory only
     - Store: `setUser(user)` — context/state
     - Store: `localStorage.setItem('user', JSON.stringify(user))`
   - **Remove:** x-simulated-* header generation (no longer needed)
   - **Remove:** POST to `/api/auth/register-or-login` (replace with direct dispatch)
   - **Cookie:** Automatically stored by browser (Set-Cookie header from login response)

2. **Update password validation** (Check for mustReset flag)
   - Keep existing logic ✓

3. **Redirect on success:**
   - If `mustReset: true` → redirect `/change-password`
   - Else → redirect `/dashboard`

4. **Error handling:**
   - Keep existing error messages
   - Add check for 429 (rate limit) → show cool-down message

---

#### File: `src/components/ChangePasswordView.tsx` (NEW or UPDATED)
**Current State:** Calls unprotected endpoint (no requireAuth)  
**Changes Required:**

1. **Endpoint verification:**
   - Now calls `POST /api/auth/change-password` (which HAS requireAuth)
   - Authorization header automatically added by apiFetch

2. **Update form submission** (Lines ~50)
   - Existing: `apiFetch('/api/auth/change-password', {...})`
   - Already sends: email, currentPassword, newPassword
   - **No changes needed** (backend now requires auth) ✓

3. **Add success flow:**
   - On 200 response:
     - Clear accessToken: `setAccessToken(null)`
     - Clear user: `setUser(null)`
     - Show message: "Password changed, please login again"
     - Force redirect: `/login`
   - Reason: Server revoked all tokens after password change

---

#### File: `src/components/HeaderNav.tsx` (or similar)
**Current State:** Logout button exists  
**Changes Required:**

1. **Update handleLogout** (wherever logout button handler is)
   - Call: `POST /api/auth/logout`
   - Header: Authorization will be auto-added by apiFetch
   - On success (200):
     - Clear: `setAccessToken(null)`
     - Clear: `setUser(null)`
     - Clear: `localStorage.removeItem('user')`
     - Browser auto-clears: refreshToken cookie (via Set-Cookie: Expires=past)
   - Redirect: `/login`

2. **Add logout on 401:**
   - If any request returns 401 "Token revoked" or "Session ended"
   - Auto-logout user
   - Redirect: `/login`
   - Show: "Your session has ended, please login again"

---

#### File: `src/context/AuthContext.tsx` (NEW FILE)
**Purpose:** Centralized authentication state  
**Changes Required:**

1. **Create AuthContext** with:
   - `accessToken: string | null`
   - `user: UserData | null`
   - `isAuthenticated: boolean`
   - `loading: boolean`

2. **Create AuthProvider** component:
   - Provide context to entire app
   - Initialize from localStorage on mount
   - Handle auto-logout on 401

3. **Create custom hook: `useAuth()`**
   - Returns context value
   - Throws error if used outside provider

4. **Create hook: `useAuthRefresh()`**
   - Auto-refresh accessToken before expiry
   - useEffect + setInterval
   - Calls `/api/auth/refresh` every 10 minutes

---

#### File: `src/hooks/useJWTRefresh.ts` (NEW FILE)
**Purpose:** Auto-refresh access token  
**Changes Required:**

1. **Hook signature:**
   ```typescript
   function useJWTRefresh() {
     // Auto-refresh logic
   }
   ```

2. **Behavior:**
   - Start timer after login
   - Every 10 minutes: Call `POST /api/auth/refresh`
   - On success: Update accessToken in context
   - On failure: Clear tokens, redirect to login
   - On component unmount: Clear timer

3. **Integration:**
   - Import in `App.tsx` or root component
   - Only runs if `isAuthenticated === true`

---

#### File: `src/App.tsx`
**Current State:** Main app component  
**Changes Required:**

1. **Wrap with AuthProvider:**
   - `<AuthProvider><App>...</App></AuthProvider>`

2. **Initialize auth on mount:**
   - Load user from localStorage
   - If stored user exists: Try to use accessToken
   - If no accessToken: Call `/api/auth/refresh` with cookie
   - If refresh succeeds: Update context
   - If refresh fails: Clear auth, show login

3. **Add route guard:**
   - Protected routes require `isAuthenticated === true`
   - Unprotected routes: `/login`, `/password-reset`, etc.

---

### 8.3 Configuration Files

#### File: `package.json`
**Current Dependencies:** Check what exists  
**New Dependencies Required:**

```json
{
  "dependencies": {
    "jsonwebtoken": "^9.0.0",        // JWT signing/verification
    "redis": "^4.6.0",               // Token blacklist cache
    "csurf": "^1.11.0",              // CSRF protection
    "dotenv": "^16.0.0"              // Env vars (if not exists)
  },
  "devDependencies": {
    "@types/jsonwebtoken": "^9.0.0"  // TS types
  }
}
```

---

#### File: `docker-compose.yml` (or deployment config)
**Changes Required:**

1. **Add Redis service** (if not exists):
   ```yaml
   redis:
     image: redis:7-alpine
     ports:
       - "6379:6379"
     volumes:
       - redis_data:/data
   ```

2. **Environment variables** in web service:
   - Add JWT_PRIVATE_KEY
   - Add JWT_PUBLIC_KEY
   - Add TOKEN_BLACKLIST_REDIS_URL

---

## 9. Migration Plan (5 Phases)

### Phase 1: Audit & Preparation (5 days)
**No code changes, only validation**

**Activities:**
1. Generate RSA keypair (2048-bit minimum)
2. Store keys in environment (secure vault)
3. Verify NODE_ENV handling in all environments
4. Set up Redis instance for token blacklist
5. Create database schema (token_sessions, token_blacklist tables)
6. Prepare feature flag: `JWT_ENABLED=false` (default)
7. Create runbook for emergency rollback
8. Load test: Measure API latency with JWT verification

**Checklist:**
- [ ] JWT_PRIVATE_KEY & JWT_PUBLIC_KEY generated and stored
- [ ] Redis instance running and accessible
- [ ] Database migrations prepared (not applied yet)
- [ ] Feature flag infrastructure ready
- [ ] Team trained on JWT concepts
- [ ] Monitoring dashboards created
- [ ] Rollback procedures documented

**Exit Criteria:**
- All 7 checklist items complete
- Technical team signs off on readiness
- No blocking issues in test environment

---

### Phase 2: Backend JWT Implementation (5 days)
**JWT token generation, refresh, and verification**

**Files Modified:**
1. `src/middleware/auth.ts` — Add JWT verification + token generation
2. `src/middleware/csrf.ts` — NEW, CSRF protection
3. `server.ts` — Update login, add refresh, add logout, fix change-password
4. `src/db/schema.ts` — Add tokenSessions + tokenBlacklist tables
5. `.env.example` — Add JWT configuration

**Key Changes:**
- Login endpoint now returns JWT
- Refresh endpoint created
- Token blacklist implemented
- Logout revokes tokens
- Backward compatible (x-simulated-* headers still work)

**Testing:**
- [ ] Manual login flow → receive JWT
- [ ] JWT refresh → new token
- [ ] Token expiry → 401
- [ ] Logout → token blacklisted
- [ ] Theft detection → session revoked
- [ ] x-simulated-* headers still work (fallback)

**Feature Flag:**
- `JWT_ENABLED=false` by default (still uses x-simulated-* in dev)
- Can be toggled per request type for canary testing

**Exit Criteria:**
- All endpoints return valid JWT
- Token refresh works end-to-end
- Theft detection triggers correctly
- x-simulated-* fallback still functional

**Rollback:**
- If critical issue: Revert commits, redeploy previous version
- JWT_ENABLED stays false → application uses simulation headers
- No data loss (JWT not persisted, only in memory)

---

### Phase 3: Frontend JWT Integration (5 days)
**Token storage, refresh logic, authorization headers**

**Files Modified:**
1. `src/lib/api.ts` — JWT injection + refresh logic
2. `src/components/LoginView.tsx` — Store JWT after login
3. `src/components/ChangePasswordView.tsx` — Handle token revocation
4. `src/components/HeaderNav.tsx` — Update logout
5. `src/context/AuthContext.tsx` — NEW, auth state management
6. `src/hooks/useJWTRefresh.ts` — NEW, auto-refresh hook
7. `src/App.tsx` — Wrap with AuthProvider

**Key Changes:**
- Access token stored in memory (React state)
- Refresh token stored in HttpOnly cookie (browser auto-manages)
- Auto-inject Authorization header in all requests
- Auto-refresh on token expiry (transparent to user)
- Logout clears all tokens

**Testing:**
- [ ] Login → receive and store JWT
- [ ] Make request → Authorization header present
- [ ] Wait 15 min → token auto-refreshes
- [ ] Logout → tokens cleared
- [ ] Page refresh → user still logged in (via refresh token)
- [ ] Device loss → force logout from admin

**Feature Flag:**
- Phase 1-2: `JWT_ENABLED=false` (backend generates JWT but frontend doesn't use it)
- Phase 3: `JWT_ENABLED=true` in dev environment (team testing)
- Phase 4: Canary 10% → 50% → 100% (gradual rollout)

**Exit Criteria:**
- Frontend correctly injects Authorization header
- Token refresh works transparently
- All endpoints accessible with JWT
- Page refresh maintains session (via refresh token)

**Rollback:**
- Revert frontend changes
- Set `JWT_ENABLED=false` in production
- Users automatically fall back to x-simulated-* headers
- No data loss

---

### Phase 4: Production Deployment (7 days)
**Canary rollout with monitoring**

**Deployment Strategy:**
1. **Day 1-2: Canary 10%**
   - Route 10% of users to JWT-enabled backend
   - 90% use x-simulated-* headers (legacy)
   - Monitor: Error rates, latency, JWT failures
   - Alert threshold: > 0.1% error increase

2. **Day 3-4: Canary 50%**
   - Route 50% of users to JWT backend
   - Continue monitoring
   - If issues: Rollback to 10% immediately

3. **Day 5-6: Canary 100%**
   - All users on JWT authentication
   - Keep legacy fallback active (emergency only)
   - Monitor for 24 hours

4. **Day 7: Legacy cleanup**
   - After 24 hours stable: Keep legacy in place for 2 more weeks
   - During 2 weeks: Disable new session creation on legacy path
   - Existing sessions can still use legacy until cookie expires

**Monitoring Metrics:**
- Login success rate (target: > 99%)
- Token refresh latency (target: < 50ms)
- Token refresh success rate (target: > 99.9%)
- 401 error rate (target: < 0.1% / hour)
- Theft detection triggers (target: < 5 / day across all users)

**Alerts:**
- Login success rate < 95%
- Token refresh latency > 200ms
- Refresh success rate < 99%
- More than 10 simultaneous theft detection events

**Rollback Trigger:**
- Any alert threshold exceeded for > 10 minutes
- OR cumulative error rate > 1%
- Action: Set `JWT_ENABLED=false` in production, redeploy

---

### Phase 5: Security Hardening (5 days)
**Fix remaining vulnerabilities, cleanup legacy code**

**Tasks:**
1. Fix VUL1: NODE_ENV check robustness
   - Replace `process.env.NODE_ENV === 'production'` with enum check
   - Support NODE_ENV values: 'production', 'prod', 'PRODUCTION'
   - OR use feature flag instead of NODE_ENV

2. Fix VUL2: Add `requireAuth` to `/api/auth/change-password`
   - Already done in Phase 2
   - Verify in production
   - Monitor: 0 unauthorized password changes

3. Fix VUL3: Remove fallback in resolveActor()
   - If simulated user not in DB: Return 401 (not silent fallback)
   - Force re-login or proper authentication

4. Cleanup: Disable x-simulated-* headers in production
   - Keep in development for testing
   - Production: Only JWT or 401

5. Cleanup: Remove dead code
   - Remove simulation header generation from frontend
   - Remove getSimulationHeaders() function
   - Update LoginView to only use JWT

6. Verification:
   - [ ] VUL1 fixed (NODE_ENV check robust)
   - [ ] VUL2 fixed (change-password requires auth)
   - [ ] VUL3 fixed (no silent fallback)
   - [ ] Legacy x-simulated-* disabled in production
   - [ ] All endpoints require valid JWT in production
   - [ ] Audit logs show 0 unauthorized access attempts
   - [ ] Token rotation working correctly
   - [ ] Theft detection triggers appropriately

**Exit Criteria:**
- All 3 vulnerabilities fixed
- Security audit passes
- Production authentication 100% JWT-based
- Zero legacy code paths remaining

---

## 10. Validation & Testing

### 10.1 Test Cases

#### Login Flow
```
Test: Valid credentials
Input: email=prof@school.fr, password=correct_pass
Expected: 200 OK, { accessToken, user, Set-Cookie: refreshToken }
Verify: 
  - accessToken is valid JWT
  - refreshToken in HttpOnly cookie
  - user object contains correct data

Test: Invalid password
Input: email=prof@school.fr, password=wrong_pass
Expected: 401 "Invalid credentials"
Verify:
  - No token returned
  - No cookie set

Test: Rate limiting
Input: 6 failed login attempts in 15 min
Expected: 429 "Too many attempts"
Verify:
  - After 5 failures: accept 6th attempt (returns 401)
  - 6th failure triggers rate limiter
  - 7th attempt blocked for 15 minutes
```

#### Token Refresh
```
Test: Valid refresh
Input: Valid refreshToken in cookie
Expected: 200 OK, { accessToken, Set-Cookie: new refreshToken }
Verify:
  - New accessToken is different version
  - Old refreshToken invalidated (added to blacklist)
  - New token version incremented

Test: Expired refresh token
Input: refreshToken expired (> 7 days old)
Expected: 401 "Refresh token expired"
Verify:
  - No new token returned
  - User forced to login again

Test: Token reuse detection (theft scenario)
Input: Old refreshToken v1 used twice
Expected: Second use → 401 "Session compromised"
Verify:
  - First refresh: returns new token v2 ✓
  - Second refresh with v1: returns 401 ✓
  - Entire session blacklisted
  - User forced to re-login
```

#### Logout Flow
```
Test: Valid logout
Input: Valid accessToken
Expected: 200 OK, Set-Cookie: refreshToken cleared
Verify:
  - Token added to blacklist
  - Cookie expiry set to past
  - User cannot access protected endpoints

Test: Logout without auth
Input: No Authorization header
Expected: 401 "Unauthorized"
Verify:
  - Logout fails
  - Session not terminated
```

#### Protected Endpoints
```
Test: Valid JWT
Input: GET /api/schools with Authorization: Bearer <token>
Expected: 200 OK, [ school list ]
Verify:
  - req.user populated from JWT claims
  - School filtering applied (user role)

Test: Expired JWT
Input: GET /api/schools with Authorization: Bearer <expired_token>
Expected: 401 "Token expired"
Verify:
  - No data returned
  - Frontend triggers refresh

Test: Invalid signature
Input: GET /api/schools with Authorization: Bearer <tampered_token>
Expected: 401 "Invalid token"
Verify:
  - Endpoint not executed
  - Audit logged

Test: Missing auth
Input: GET /api/schools with no Authorization header
Expected: 401 "Unauthorized" (or dev: check x-simulated-*)
Verify:
  - No data leaked
```

### 10.2 Performance Benchmarks

Target metrics post-implementation:

| Metric | Target | Current |
|--------|--------|---------|
| Login latency | < 100ms | ~50ms |
| Token refresh latency | < 50ms | N/A |
| JWT verification per req | < 5ms | N/A |
| Blacklist lookup (Redis) | < 10ms | N/A |
| Protected endpoint latency (overhead) | < 10ms additional | 0ms |

---

## 11. Rollback Procedures

### Immediate Rollback (< 1 hour)

**If Production Broken:**
1. Set environment variable: `JWT_ENABLED=false`
2. Redeploy (or restart): Application reverts to x-simulated-* headers
3. Verify: `/api/health` responds 200
4. Monitor: Error rates return to normal

**Data State:**
- JWTs already issued → still valid for 15 minutes
- Tokens in blacklist → ignored (legacy auth doesn't check)
- New sessions → created with x-simulated-* headers

**Recovery Time:** < 5 minutes (redeploy time)

---

### Rollback Scenarios

**Scenario A: High Error Rate During Canary Phase 1**
1. Check: Error logs for JWT-related issues
2. Identify: Whether JWT verification or refresh is failing
3. Action:
   - If fixable: Deploy hotfix to Phase 2 code
   - If not fixable: Set `JWT_ENABLED=false`, rollback to Phase 1
4. Analyze root cause
5. Retry when ready

**Scenario B: Database Migration Failed**
1. Rollback database schema
   ```sql
   DROP TABLE token_blacklist;
   DROP TABLE token_sessions;
   ```
2. Set `JWT_ENABLED=false`
3. Redeploy application
4. Recover using backup database if needed

**Scenario C: Redis Down (Token Blacklist Unavailable)**
1. Check: Redis connectivity
2. If recoverable: Restart Redis, check logs
3. If not: Set `JWT_ENABLED=false`, fallback to x-simulated-*
4. Revert to legacy while Redis is repaired

---

## 12. Security Considerations

### 12.1 JWT Security Best Practices

✅ **Implemented:**
- RS256 algorithm (asymmetric, public key validation)
- 15-minute access token TTL (limits damage from theft)
- HttpOnly cookies for refresh token (XSS-proof)
- Secure + SameSite=Strict on cookies (CSRF protection)
- Token rotation on every refresh (detect reuse)
- Token blacklist with automatic TTL cleanup
- Audit logging of all auth events
- Rate limiting on login (5 attempts / 15 min)
- PBKDF2 password hashing (310K iterations)
- IP fingerprinting (optional, in tokenId)

❌ **Explicitly NOT Implemented (by design):**
- localStorage for tokens (XSS vulnerable) — use memory instead
- Refresh token in response body — use HttpOnly cookie instead
- HS256 algorithm — use RS256 (public key validation)
- Long access token TTL — keep at 15 minutes
- Token version checking disabled — always enabled

### 12.2 Threat Model

| Threat | Attack | Mitigation | Status |
|--------|--------|-----------|--------|
| **XSS** | Steal accessToken from localStorage | Store in memory, not localStorage | ✅ |
| **XSS** | Steal refreshToken from cookie | HttpOnly flag prevents JS access | ✅ |
| **CSRF** | Submit refresh without user consent | CSRF token required, SameSite=Strict | ✅ |
| **Token Theft** | Use stolen token | Token rotation detects reuse, session blacklisted | ✅ |
| **Man-in-the-Middle** | Intercept token in transit | TLS/HTTPS required, Secure flag on cookie | ✅ |
| **Brute Force** | Try many passwords | Rate limiting: 5 attempts / 15 min | ✅ |
| **Token Forgery** | Create fake JWT | RS256 signature verification | ✅ |
| **Long Token Reuse** | Use token after password change | Token blacklist on password change | ✅ |
| **Logout Bypass** | Use token after logout | Logout revokes all tokens | ✅ |

### 12.3 Key Management

**Private Key Security:**
- Store in environment variable (vault service, not Git)
- Accessible only to backend process
- Used only for signing (never exposed to frontend)
- Rotated yearly (plan: Phase 6)

**Public Key Distribution:**
- Embedded in frontend code (OK, not secret)
- OR served via `/.well-known/jwks.json` endpoint
- Used for verification only (cannot forge)

**Key Rotation Plan (Future - Phase 6):**
- Old keys: Keep for 30 days (allow token expiry)
- New key signing: All new tokens use new key
- JWKS endpoint: List all active keys with kid + use
- No downtime: Gradual rotation over 30 days

---

## Summary Table: Implementation Checklist

| Phase | Task | Duration | Owner | Status |
|-------|------|----------|-------|--------|
| **1** | Generate JWT keypair | 1 day | DevOps | ❌ Pending |
| **1** | Setup Redis | 1 day | DevOps | ❌ Pending |
| **1** | Create database schema | 1 day | Backend | ❌ Pending |
| **1** | Documentation + training | 2 days | All | ❌ Pending |
| **2** | Implement JWT generation (auth.ts) | 2 days | Backend | ❌ Pending |
| **2** | Add refresh endpoint (server.ts) | 2 days | Backend | ❌ Pending |
| **2** | Fix VUL2 + add CSRF | 1 day | Backend | ❌ Pending |
| **3** | Update LoginView + API layer | 2 days | Frontend | ❌ Pending |
| **3** | Add AuthContext + hooks | 2 days | Frontend | ❌ Pending |
| **3** | Testing + QA | 1 day | QA | ❌ Pending |
| **4** | Canary 10% deployment | 2 days | DevOps | ❌ Pending |
| **4** | Canary 50% → 100% deployment | 4 days | DevOps | ❌ Pending |
| **4** | Monitoring + alerts | Ongoing | DevOps | ❌ Pending |
| **5** | Fix VUL1 + VUL3 | 2 days | Backend | ❌ Pending |
| **5** | Remove legacy code | 2 days | Frontend | ❌ Pending |
| **5** | Final audit + verification | 1 day | Security | ❌ Pending |

---

## Conclusion

This specification provides a complete, production-ready JWT authentication implementation with:

✅ **Zero downtime** migration via hybrid mode (JWT + x-simulated-*)  
✅ **Strong security** via RS256, token rotation, and theft detection  
✅ **Transparent UX** via automatic token refresh  
✅ **Full audit trail** for compliance  
✅ **Emergency rollback** in < 5 minutes  

**Next Step:** Approval from team → Begin Phase 1 (Audit & Preparation)

---

**Document Version:** 1.0  
**Last Updated:** 2026-01-11  
**Status:** Ready for Review
