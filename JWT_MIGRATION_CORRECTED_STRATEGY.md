# Plan de Migration JWT - Stratégie Corrigée
## Architecture Cible avec Cookies HttpOnly + Token Rotation

**Statut:** 🟡 Plan d'exécution détaillé (AVANT codage)  
**Rythme:** ~1 semaine (Phases 0-5 progressives)  
**Risque:** Minimal (pas de rupture jusqu'à Phase 4)  

---

## ARCHITECTURE CIBLE

### Vue d'ensemble

```
CLIENT (Browser)                  SERVER (Node.js + Postgres)
┌─────────────────┐              ┌──────────────────────────┐
│ Session Storage │ ─────JWT────> │ verify JWT from cookie   │
│ (User info only)│              │ check token_blacklist    │
│                 │              │ check expiration         │
└─────────────────┘              └──────────────────────────┘
       │                                  │
       │ localStorage                     │ cookies (HttpOnly)
       ├── name (User display)            ├── accessToken (1h)
       ├── role (UI rendering)            └── refreshToken (7d)
       └── schoolId (active school)
```

### Cookies vs localStorage

| Aspect | localStorage | HttpOnly Cookie |
|--------|--------------|-----------------|
| **Accès JS** | ✅ Lisible | ❌ Invisible (sécurisé) |
| **Envoi auto** | ❌ Header manuel | ✅ Auto (HTTPS) |
| **Vulnérabilité XSS** | 🔴 Critique | 🟢 Protégé |
| **CSRF** | ✅ Protégé | ⚠️ Dépend SameSite |
| **Logout** | ✅ Simple (clear storage) | ✅ Simple (delete cookie) |

### Token Claims (JWT)

```typescript
// ACCESS TOKEN (1 hour)
{
  uid: "user_123",              // User unique ID
  id: 42,                        // User row ID
  email: "prof@ecole.fr",        // Email
  role: "teacher",               // Role (super_admin|school_admin|teacher|parent)
  schoolId: 5,                   // Current school context
  jti: "uuid-v4",                // JWT ID (for revocation)
  iat: 1234567890,               // Issued at
  exp: 1234571490,               // Expires at (+1h)
  type: "access"                 // Token type
}

// REFRESH TOKEN (7 days, minimal claims)
{
  uid: "user_123",               // Only needed for session tracking
  id: 42,
  jti: "uuid-v4-refresh",        // Different JTI from access
  iat: 1234567890,
  exp: 1234999890,               // Expires at (+7d)
  type: "refresh"
}
```

---

## SCHEMA DATABASE (Nouvelles tables)

### Table 1: token_blacklist

Utilisée pour:
- Logout immédiat
- Invalider ancien refresh token (rotation)
- Détecter réutilisation (sécurité)
- Auto-cleanup au démarrage

```sql
CREATE TABLE IF NOT EXISTS token_blacklist (
  id SERIAL PRIMARY KEY,
  token_jti VARCHAR(255) NOT NULL UNIQUE,  -- JWT ID from token
  user_id INTEGER NOT NULL,                 -- User who owns token
  session_id VARCHAR(255),                  -- Multi-device tracking
  reason VARCHAR(50),                       -- 'logout' | 'rotation' | 'theft_suspect'
  blacklisted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP NOT NULL,            -- When token naturally expires
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_user_blacklist (user_id, expires_at),
  INDEX idx_jti (token_jti)
);

-- Auto cleanup: expirer après 7 jours max
CREATE OR REPLACE FUNCTION cleanup_expired_blacklist()
RETURNS void AS $$
BEGIN
  DELETE FROM token_blacklist 
  WHERE expires_at < CURRENT_TIMESTAMP 
     OR blacklisted_at < CURRENT_TIMESTAMP - INTERVAL '7 days';
END;
$$ LANGUAGE plpgsql;

-- Exécuter au démarrage serveur
```

### Table 2: user_sessions (optional, for multi-device)

```sql
CREATE TABLE IF NOT EXISTS user_sessions (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  session_id VARCHAR(255) UNIQUE NOT NULL,
  device_fingerprint VARCHAR(255),          -- User-Agent hash
  ip_address VARCHAR(45),                   -- IPv4 or IPv6
  last_activity TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_user_sessions (user_id)
);

-- PHASE 5 only (advanced feature)
```

---

## FICHIERS À MODIFIER (Ordonnance)

### PHASE 0: Préparation Infrastructure

**Fichiers:**
1. `.env.example` - Ajouter variables JWT
2. `src/lib/jwt.ts` - NOUVEAU module centralisé
3. Drizzle schema - Ajouter token_blacklist

**Détails ci-dessous**

---

### PHASE 1: Backend JWT Generation

**Fichiers:**
1. `server.ts` - Modifier POST `/api/auth/local-login`
2. `server.ts` - Ajouter POST `/api/auth/refresh`
3. `server.ts` - Modifier POST `/api/auth/logout`
4. `src/middleware/auth.ts` - Adapter verifyToken()

**Scope:** Générer JWT, ajouter refresh endpoint, adapter middleware

---

### PHASE 2: Frontend Cookie Handling

**Fichiers:**
1. `src/components/LoginView.tsx` - Adapter post-login
2. `src/lib/api.ts` - Adapter apiFetch (accepter cookies)
3. `src/context/AuthContext.tsx` - Fallback localStorage

**Scope:** Frontend prêt à recevoir cookies, stocke infos non-sensibles

---

### PHASE 3: Token Refresh & Auto-Recovery

**Fichiers:**
1. `src/lib/api.ts` - Ajouter auto-refresh en 401
2. `server.ts` - Améliorer refresh endpoint (gestion erreurs)
3. `src/middleware/auth.ts` - Middleware refresh token validation

**Scope:** Auto-recovery sur 401, sans boucle infinie

---

### PHASE 4: VUL2 Fix (Breaking Change)

**Fichiers:**
1. `server.ts` - Ajouter `requireAuth` à `/api/auth/change-password`
2. `server.ts` - Fixer rate limiter syntax
3. `server.ts` - Unifier error messages

**Scope:** Sécuriser endpoint, notification client obligatoire

---

### PHASE 5: Cleanup & Optimisations

**Fichiers:**
1. `src/middleware/auth.ts` - Fixer VUL1 (NODE_ENV check)
2. `src/lib/api.ts` - Optionnellement supprimer x-simulated-*
3. Tests - Mettre à jour pour JWT

**Scope:** Optional, peut être déphasé après Phase 4

---

## DETAILLE PHASE 0: PRÉPARATION

### 0.1 - `.env.example` (Ajouter variables)

**Fichier:** `.env.example`  
**Lignes:** Ajouter à la fin

**Nouveau contenu:**
```bash
# JWT Configuration
JWT_SECRET=your-secret-key-here-min-32-chars
JWT_REFRESH_SECRET=your-refresh-secret-min-32-chars
JWT_ACCESS_EXPIRY=3600         # seconds (1 hour)
JWT_REFRESH_EXPIRY=604800      # seconds (7 days)

# Cookie Configuration
COOKIE_SECURE=true             # HTTPS only (set false for dev)
COOKIE_SAMESITE=strict         # CSRF protection
COOKIE_DOMAIN=                 # Leave empty for localhost

# Multi-device (Phase 5)
SESSION_TRACKING_ENABLED=false # Phase 5 feature
```

**Raison:** Centraliser config JWT  
**Risque:** Aucun (nouveau fichier)  
**Rollback:** Supprimer lignes

---

### 0.2 - Créer `src/lib/jwt.ts` (NOUVEAU)

**Fichier:** `src/lib/jwt.ts`  
**Type:** Nouveau module (création)

**Contenu:**
```typescript
// src/lib/jwt.ts - Centralized JWT utilities
import jwt from 'jsonwebtoken';
import crypto from 'crypto';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-jwt-secret';
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'dev-jwt-refresh-secret';
const ACCESS_EXPIRY = process.env.JWT_ACCESS_EXPIRY || '3600';      // 1 hour
const REFRESH_EXPIRY = process.env.JWT_REFRESH_EXPIRY || '604800';   // 7 days

export interface TokenPayload {
  uid: string;
  id: number;
  email: string;
  role: 'super_admin' | 'school_admin' | 'teacher' | 'parent' | 'student';
  schoolId: number | null;
  jti?: string;
  type?: 'access' | 'refresh';
}

/**
 * Generate access token (1 hour by default)
 */
export function generateAccessToken(payload: Omit<TokenPayload, 'jti' | 'type'>): string {
  const jti = crypto.randomUUID();
  return jwt.sign(
    {
      ...payload,
      jti,
      type: 'access'
    },
    JWT_SECRET,
    {
      expiresIn: parseInt(ACCESS_EXPIRY, 10),
      algorithm: 'HS256'
    }
  );
}

/**
 * Generate refresh token (7 days by default)
 */
export function generateRefreshToken(payload: Omit<TokenPayload, 'jti' | 'type'>): string {
  const jti = crypto.randomUUID();
  return jwt.sign(
    {
      uid: payload.uid,
      id: payload.id,
      jti,
      type: 'refresh'
    },
    JWT_REFRESH_SECRET,
    {
      expiresIn: parseInt(REFRESH_EXPIRY, 10),
      algorithm: 'HS256'
    }
  );
}

/**
 * Verify access token
 */
export function verifyAccessToken(token: string): TokenPayload | null {
  try {
    const decoded = jwt.verify(token, JWT_SECRET, {
      algorithms: ['HS256']
    }) as any;
    
    if (decoded.type !== 'access') {
      return null;
    }
    
    return {
      uid: decoded.uid,
      id: decoded.id,
      email: decoded.email,
      role: decoded.role,
      schoolId: decoded.schoolId,
      jti: decoded.jti,
      type: 'access'
    };
  } catch (err) {
    return null;
  }
}

/**
 * Verify refresh token
 */
export function verifyRefreshToken(token: string): Pick<TokenPayload, 'uid' | 'id' | 'jti'> | null {
  try {
    const decoded = jwt.verify(token, JWT_REFRESH_SECRET, {
      algorithms: ['HS256']
    }) as any;
    
    if (decoded.type !== 'refresh') {
      return null;
    }
    
    return {
      uid: decoded.uid,
      id: decoded.id,
      jti: decoded.jti
    };
  } catch (err) {
    return null;
  }
}

/**
 * Decode token without verification (for debugging)
 */
export function decodeToken(token: string): any {
  try {
    return jwt.decode(token);
  } catch {
    return null;
  }
}

/**
 * Extract JTI from token (for blacklist)
 */
export function extractJTI(token: string): string | null {
  const decoded = decodeToken(token);
  return decoded?.jti ?? null;
}
```

**Raison:** Centraliser logique JWT, éviter imports dispersés  
**Risque:** Aucun (nouveau fichier)  
**Rollback:** Supprimer fichier

---

### 0.3 - Ajouter token_blacklist table (Drizzle)

**Fichier:** `db/schema.ts` ou équivalent Drizzle  
**Type:** Nouvelle table

**Contenu:**
```typescript
import { sql } from 'drizzle-orm';
import { integer, serial, text, timestamp, varchar, index } from 'drizzle-orm/pg-core';
import { pgTable } from 'drizzle-orm/pg-core';

export const tokenBlacklist = pgTable(
  'token_blacklist',
  {
    id: serial('id').primaryKey(),
    tokenJti: varchar('token_jti', { length: 255 }).notNull().unique(),
    userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    sessionId: varchar('session_id', { length: 255 }),
    reason: varchar('reason', { length: 50 }), // 'logout', 'rotation', 'theft_suspect'
    blacklistedAt: timestamp('blacklisted_at', { mode: 'date' }).default(sql`CURRENT_TIMESTAMP`),
    expiresAt: timestamp('expires_at', { mode: 'date' }).notNull(),
    createdAt: timestamp('created_at', { mode: 'date' }).default(sql`CURRENT_TIMESTAMP`)
  },
  (table) => ({
    userBlacklistIdx: index('idx_user_blacklist').on(table.userId, table.expiresAt),
    jtiIdx: index('idx_jti').on(table.tokenJti)
  })
);
```

**Raison:** Stocker tokens révoqués  
**Risque:** Aucun (nouvelle table, pas modifiée)  
**Rollback:** DROP TABLE token_blacklist

---

### 0.4 - Ajouter fonction auto-cleanup

**Fichier:** `server.ts` - Ajouter dans `startServer()`  
**Lignes:** Après `seedDatabaseIfEmpty()`

**Contenu:**
```typescript
// Auto-cleanup expired tokens (run once per startup)
async function cleanupExpiredTokens() {
  try {
    const now = new Date();
    const deleted = await db.delete(tokenBlacklist)
      .where(sql`expires_at < ${now} OR blacklisted_at < ${now} - INTERVAL '7 days'`)
      .returning();
    
    if (deleted.length > 0) {
      console.log(`[JWT] Cleaned up ${deleted.length} expired token blacklist entries`);
    }
  } catch (err) {
    console.warn('[JWT] Cleanup failed:', err);
    // Don't block startup on cleanup failure
  }
}

// Puis dans startServer():
await cleanupExpiredTokens();
```

**Raison:** Éviter table qui grandit infiniment  
**Risque:** Faible (soft delete, ne casse rien)  
**Rollback:** Supprimer appel fonction

---

## DETAILLE PHASE 1: BACKEND JWT GENERATION

### 1.1 - Modifier `/api/auth/local-login` (server.ts)

**Fichier:** `server.ts`  
**Lignes actuelles:** 1438-1476  
**Action:** Modifier response + ajouter cookies

**Avant:**
```typescript
app.post('/api/auth/local-login', loginLimiter, async (req, res) => {
  // ... password verification ...
  const response = { ...userRecord, mustReset: !!localMustReset } as any;
  res.json(response);
});
```

**Après:**
```typescript
import { generateAccessToken, generateRefreshToken } from './src/lib/jwt.js';

app.post('/api/auth/local-login', loginLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Missing email or password' });

    const normalizedEmail = email.trim().toLowerCase();
    const usersFound = await db.select().from(users)
      .where(eq(sql`LOWER(${users.email})`, normalizedEmail));
    
    if (usersFound.length === 0) return res.status(401).json({ error: 'Email ou mot de passe invalide' });
    const userRecord = usersFound[0];
    if (userRecord.role === 'student') return res.status(401).json({ error: 'Connexion non autorisée pour un compte élève' });

    const authRows = await db.select().from(localAuths)
      .where(eq(localAuths.userId, userRecord.id));
    
    if (authRows.length === 0) return res.status(401).json({ error: 'Aucun mot de passe enregistré' });
    
    const { passwordHash, salt, mustReset } = authRows[0] as any;
    const crypto = await import('node:crypto');
    const verifyHash = crypto.pbkdf2Sync(password, salt, 310000, 64, 'sha512').toString('hex');
    
    if (verifyHash !== passwordHash) return res.status(401).json({ error: 'Mot de passe incorrect' });

    let localMustReset = !!mustReset;
    if (typeof mustReset === 'undefined' || mustReset === null) {
      try {
        const defaultHash = crypto.pbkdf2Sync('123456', salt, 310000, 64, 'sha512').toString('hex');
        localMustReset = verifyHash === defaultHash;
      } catch (e) {
        // ignore
      }
    }

    // ✅ NOUVEAU: Générer JWT tokens
    const accessToken = generateAccessToken({
      uid: userRecord.uid,
      id: userRecord.id,
      email: userRecord.email,
      role: userRecord.role,
      schoolId: userRecord.schoolId
    });

    const refreshToken = generateRefreshToken({
      uid: userRecord.uid,
      id: userRecord.id,
      email: userRecord.email,
      role: userRecord.role,
      schoolId: userRecord.schoolId
    });

    // ✅ NOUVEAU: Définir cookies HttpOnly
    const isSecure = process.env.NODE_ENV === 'production';
    const cookieOptions = {
      httpOnly: true,
      secure: isSecure,
      sameSite: 'strict' as const,
      maxAge: 3600 * 1000  // 1 hour for access token
    };

    res.cookie('accessToken', accessToken, cookieOptions);
    res.cookie('refreshToken', refreshToken, {
      ...cookieOptions,
      maxAge: 7 * 24 * 3600 * 1000  // 7 days for refresh token
    });

    // Response: Retourner infos non-sensibles (frontend stocke en localStorage)
    res.json({
      id: userRecord.id,
      uid: userRecord.uid,
      email: userRecord.email,
      name: userRecord.name,
      role: userRecord.role,
      schoolId: userRecord.schoolId,
      mustReset: !!localMustReset
    });
  } catch (err: any) {
    console.error('Local login error:', err);
    res.status(500).json({ error: err?.message || 'Login failed' });
  }
});
```

**Raison:** Générer JWT + envoyer en cookies  
**Risque:** Moyen - change response mais ajoute seulement, ne supprime rien  
**Rollback:** Supprimer blocs jwt + cookies, garder json response

---

### 1.2 - Ajouter POST `/api/auth/refresh` (server.ts)

**Fichier:** `server.ts`  
**Lignes:** Après logout endpoint (~1515)  
**Action:** Nouveau endpoint

**Contenu:**
```typescript
import { extractJTI, verifyRefreshToken, generateAccessToken } from './src/lib/jwt.js';

// Refresh access token using refresh token from cookie
app.post('/api/auth/refresh', async (req, res) => {
  try {
    const refreshToken = req.cookies.refreshToken;
    
    if (!refreshToken) {
      return res.status(401).json({ error: 'No refresh token' });
    }

    // Verify refresh token signature
    const decoded = verifyRefreshToken(refreshToken);
    if (!decoded) {
      return res.status(401).json({ error: 'Invalid refresh token' });
    }

    // Check if token is blacklisted (revoked)
    const blacklisted = await db.select().from(tokenBlacklist)
      .where(eq(tokenBlacklist.tokenJti, decoded.jti));
    
    if (blacklisted.length > 0) {
      return res.status(401).json({ error: 'Token has been revoked' });
    }

    // Load user to generate new access token with current data
    const [user] = await db.select().from(users)
      .where(eq(users.id, decoded.id));
    
    if (!user || user.isDeleted) {
      return res.status(401).json({ error: 'User not found or deleted' });
    }

    // ✅ Generate new access token
    const newAccessToken = generateAccessToken({
      uid: user.uid,
      id: user.id,
      email: user.email,
      role: user.role,
      schoolId: user.schoolId
    });

    // ✅ Generate new refresh token (rotation)
    const newRefreshToken = generateRefreshToken({
      uid: user.uid,
      id: user.id,
      email: user.email,
      role: user.role,
      schoolId: user.schoolId
    });

    // ✅ Blacklist old refresh token (rotation)
    const oldJti = extractJTI(refreshToken);
    if (oldJti) {
      try {
        const decoded = jwt.decode(refreshToken) as any;
        await db.insert(tokenBlacklist).values({
          tokenJti: oldJti,
          userId: user.id,
          reason: 'rotation',
          expiresAt: new Date(decoded.exp * 1000)
        });
      } catch (e) {
        console.warn('[JWT] Failed to blacklist old refresh token:', e);
        // Don't fail refresh if blacklist write fails (soft error)
      }
    }

    // Set new cookies
    const isSecure = process.env.NODE_ENV === 'production';
    const cookieOptions = {
      httpOnly: true,
      secure: isSecure,
      sameSite: 'strict' as const
    };

    res.cookie('accessToken', newAccessToken, {
      ...cookieOptions,
      maxAge: 3600 * 1000  // 1 hour
    });

    res.cookie('refreshToken', newRefreshToken, {
      ...cookieOptions,
      maxAge: 7 * 24 * 3600 * 1000  // 7 days
    });

    res.json({ success: true });
  } catch (err: any) {
    console.error('Refresh token error:', err);
    res.status(500).json({ error: 'Refresh failed' });
  }
});
```

**Raison:** Permettre refresh sans login, avec rotation  
**Risque:** Faible - nouveau endpoint, n'affecte rien  
**Rollback:** Supprimer endpoint

---

### 1.3 - Modifier POST `/api/auth/logout` (server.ts)

**Fichier:** `server.ts`  
**Lignes actuelles:** ~1512  
**Action:** Remplacer no-op par logout sécurisé

**Avant:**
```typescript
app.post('/api/auth/logout', async (req, res) => {
  try {
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to logout' });
  }
});
```

**Après:**
```typescript
app.post('/api/auth/logout', async (req, res) => {
  try {
    const accessToken = req.cookies.accessToken;
    const refreshToken = req.cookies.refreshToken;

    // Blacklist both tokens
    const tokensToBlacklist = [];
    
    if (accessToken) {
      const accessJti = extractJTI(accessToken);
      if (accessJti) {
        const decoded = jwt.decode(accessToken) as any;
        tokensToBlacklist.push({
          tokenJti: accessJti,
          userId: decoded?.id,
          reason: 'logout' as const,
          expiresAt: new Date(decoded?.exp * 1000)
        });
      }
    }

    if (refreshToken) {
      const refreshJti = extractJTI(refreshToken);
      if (refreshJti) {
        const decoded = jwt.decode(refreshToken) as any;
        tokensToBlacklist.push({
          tokenJti: refreshJti,
          userId: decoded?.id,
          reason: 'logout' as const,
          expiresAt: new Date(decoded?.exp * 1000)
        });
      }
    }

    // Insert blacklist entries (async, non-blocking)
    if (tokensToBlacklist.length > 0) {
      db.insert(tokenBlacklist).values(tokensToBlacklist).catch((err) => {
        console.warn('[JWT] Failed to blacklist logout tokens:', err);
      });
    }

    // Clear cookies
    res.clearCookie('accessToken', { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict' });
    res.clearCookie('refreshToken', { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict' });

    res.json({ success: true });
  } catch (err: any) {
    console.error('Logout error:', err);
    res.status(500).json({ error: 'Logout failed' });
  }
});
```

**Raison:** Logout sécurisé (révoque tokens, clear cookies)  
**Risque:** Faible - améliore logout existant  
**Rollback:** Revert à version simple

---

### 1.4 - Adapter middleware verifyToken() (auth.ts)

**Fichier:** `src/middleware/auth.ts`  
**Lignes:** 27-113  
**Action:** Modifier extraction token + vérification

**Changes:**

```typescript
import { verifyAccessToken } from '../lib/jwt.js';

export const verifyToken = (req: AuthRequest, res, next) => {
  try {
    // 1. Try JWT from cookie (PRIORITAIRE en production)
    const accessToken = req.cookies?.accessToken;
    
    if (accessToken) {
      const decoded = verifyAccessToken(accessToken);
      
      if (decoded) {
        // ✅ JWT valide et non-expiré
        // Load user from DB to ensure not deleted
        db.select().from(users)
          .where(eq(users.id, decoded.id))
          .then((rows) => {
            if (rows.length === 0 || rows[0].isDeleted) {
              return res.status(401).json({ error: 'User not found or deleted' });
            }
            
            req.user = rows[0];
            return next();
          })
          .catch((err) => {
            console.error('JWT verification DB error:', err);
            res.status(500).json({ error: 'Server error' });
          });
        return;
      }
      
      // JWT invalide/expiré, cliente devra refresh
      if (!accessToken) {
        return res.status(401).json({ error: 'No token provided' });
      }
      return res.status(401).json({ error: 'Token expired or invalid' });
    }

    // 2. Fallback: x-simulated-* headers (dev mode only)
    const isProduction = process.env.NODE_ENV?.toLowerCase() === 'production';
    
    if (!isProduction) {
      const simHeaders = {
        uid: req.headers['x-simulated-uid'],
        email: req.headers['x-simulated-email'],
        role: req.headers['x-simulated-role'],
        schoolId: req.headers['x-simulated-school-id']
      };

      if (simHeaders.uid && simHeaders.role) {
        // Dev mode: create user object from headers
        req.user = {
          id: Math.random(),  // Temp ID for dev
          uid: String(simHeaders.uid),
          email: String(simHeaders.email),
          name: 'Simulated User',
          role: String(simHeaders.role),
          schoolId: simHeaders.schoolId ? parseInt(String(simHeaders.schoolId)) : null,
          simulated: true
        };
        return next();
      }
    }

    // No token and not in dev mode with simulation headers
    return res.status(401).json({ error: 'Unauthorized' });
  } catch (err: any) {
    console.error('Auth verification error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};
```

**Raison:** Accepter JWT de cookie (prioritaire) + fallback sim headers  
**Risque:** Moyen - modifie core middleware, mais conserve fallback  
**Rollback:** Revert à version avant

---

## DETAILLE PHASE 2: FRONTEND COOKIE HANDLING

### 2.1 - Modifier LoginView.tsx

**Fichier:** `src/components/LoginView.tsx`  
**Action:** Post-login adaptée cookies + localStorage

**Changes:**
```typescript
const handleLogin = async (e: React.FormEvent) => {
  e.preventDefault();
  try {
    const response = await fetch(`/api/auth/local-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
      credentials: 'include'  // ✅ IMPORTANT: envoyer cookies
    });

    if (!response.ok) {
      setError('Email ou mot de passe invalide');
      return;
    }

    const user = await response.json();

    // ✅ NOUVEAU: Store user info in localStorage (non-sensible)
    localStorage.setItem('ecoletrack_user_display', JSON.stringify({
      id: user.id,
      uid: user.uid,
      name: user.name,
      email: user.email,
      role: user.role,
      schoolId: user.schoolId
    }));

    // ✅ Rediriger
    navigate(user.mustReset ? '/change-password' : '/');
  } catch (err: any) {
    setError(err.message);
  }
};
```

**Raison:** Cookies envoyés auto, localStorage pour UI  
**Risque:** Faible - ajoute credential flag  
**Rollback:** Supprimer credential flag

---

### 2.2 - Adapter apiFetch() (api.ts)

**Fichier:** `src/lib/api.ts`  
**Lignes:** 233-269  
**Action:** Ajouter credentials + remove x-simulated auto-injection

**Changes:**
```typescript
export const apiFetch = async (
  url: string,
  options?: RequestInit,
  retries = 1
): Promise<Response> => {
  try {
    // ✅ NOUVEAU: Send cookies automatically
    const fetchOptions = {
      ...options,
      credentials: 'include' as const,  // Auto-send cookies
      headers: {
        ...options?.headers,
        'Content-Type': 'application/json'
      }
    };

    // Fallback: only add x-simulated-* headers in development
    const isDev = process.env.NODE_ENV !== 'production';
    
    if (isDev && !isJWTMode()) {
      // DEV MODE: Add simulation headers if JWT not available
      const simHeaders = getSimulationHeaders();
      Object.assign(fetchOptions.headers, simHeaders);
    }

    let response = await fetch(url, fetchOptions);

    // ✅ Handle 401: try refresh once
    if (response.status === 401 && retries > 0) {
      console.log('[API] Got 401, attempting refresh...');

      try {
        const refreshResponse = await fetch('/api/auth/refresh', {
          method: 'POST',
          credentials: 'include'
        });

        if (refreshResponse.ok) {
          console.log('[API] Refresh successful, retrying request...');
          // Retry original request with new token in cookie
          return apiFetch(url, options, retries - 1);
        }
      } catch (refreshErr) {
        console.error('[API] Refresh failed:', refreshErr);
        // Fall through to error handling
      }

      // Refresh failed: redirect to login
      window.location.href = '/login';
      return response;
    }

    return response;
  } catch (err: any) {
    console.error('Fetch error:', err);
    throw err;
  }
};

/**
 * Check if user has JWT (vs using simulation mode)
 */
function isJWTMode(): boolean {
  // Simple heuristic: if we have a valid session, we're in JWT mode
  // More sophisticated: check if localStorage has JWT-specific flags
  return !localStorage.getItem('ecoletrack_simulated_role');
}
```

**Raison:** Cookies envoyés auto, auto-refresh en 401  
**Risque:** Moyen - change apiFetch logic  
**Rollback:** Revert à version avant

---

## DETAILLE PHASE 3: AUTO-REFRESH & ERROR HANDLING

### 3.1 - Améliorer refresh endpoint

**Fichier:** `server.ts` - endpoint `/api/auth/refresh`  
**Action:** Ajouter détection réutilisation refresh token

**Ajout (détecter reuse/vol):**
```typescript
// After verifying refresh token:

// Detect token reuse (security check)
// If token has been used recently: suspicious
const recentUse = await db.select().from(tokenBlacklist)
  .where(
    and(
      eq(tokenBlacklist.tokenJti, decoded.jti),
      sql`blacklisted_at > NOW() - INTERVAL '5 minutes'`
    )
  );

if (recentUse.length > 0) {
  console.warn(`[JWT] Possible refresh token theft: ${decoded.id} reused old token`);
  
  // Revoke ALL sessions for this user (security measure)
  await db.insert(tokenBlacklist).values({
    tokenJti: 'REVOKE_ALL_' + decoded.jti,
    userId: decoded.id,
    reason: 'theft_suspect',
    expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000)
  });
  
  return res.status(401).json({ 
    error: 'Session compromised. Please login again',
    reason: 'token_reuse_detected'
  });
}
```

**Raison:** Détecter vol token  
**Risque:** Faible - ajoute sécurité, ne casse rien  
**Rollback:** Supprimer bloc

---

## DETAILLE PHASE 4: VUL2 FIX (BREAKING)

### 4.1 - Fixer `/api/auth/change-password` (VUL2)

**Fichier:** `server.ts`  
**Lignes:** 1487-1515  
**Action:** Ajouter requireAuth + fixer rate limiter

**Avant:**
```typescript
app.post('/api/auth/change-password', async (req, res) => {
  // NO PROTECTION, ANYONE CAN CALL
```

**Après:**
```typescript
// Rate limiter for change-password
const changePasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 minutes
  max: 3,                    // 3 attempts
  skip: (req) => {
    // Only rate-limit THIS endpoint
    return !req.path.startsWith('/api/auth/change-password');
  }
});

app.post(
  '/api/auth/change-password',
  requireAuth,  // ✅ NOUVEAU: Require authentication
  changePasswordLimiter,
  async (req: AuthRequest, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });

      // Use authenticated user ID (not email from body)
      const userId = req.user.id;

      const { currentPassword, newPassword } = req.body;
      if (!currentPassword || !newPassword) {
        return res.status(400).json({ error: 'Missing fields' });
      }

      if (newPassword === '123456') {
        return res.status(400).json({ error: 'Le mot de passe ne peut pas être le mot de passe par défaut' });
      }

      // Load user's auth
      const [userRecord] = await db.select().from(users)
        .where(eq(users.id, userId));
      
      if (!userRecord) return res.status(401).json({ error: 'User not found' });

      const authRows = await db.select().from(localAuths)
        .where(eq(localAuths.userId, userId));
      
      if (authRows.length === 0) {
        return res.status(400).json({ error: 'No password configured' });
      }

      const { passwordHash, salt } = authRows[0] as any;

      // Verify current password
      const crypto = await import('node:crypto');
      const verifyHash = crypto.pbkdf2Sync(currentPassword, salt, 310000, 64, 'sha512').toString('hex');
      
      if (verifyHash !== passwordHash) {
        return res.status(401).json({ error: 'Current password incorrect' });
      }

      // Hash new password
      const newSalt = crypto.randomBytes(16).toString('hex');
      const newHash = crypto.pbkdf2Sync(newPassword, newSalt, 310000, 64, 'sha512').toString('hex');

      await db.update(localAuths).set({
        passwordHash: newHash,
        salt: newSalt,
        mustReset: false
      }).where(eq(localAuths.userId, userId));

      // ✅ NOUVEAU: Logout user (revoke all tokens)
      // Because password changed = security event
      const accessToken = req.cookies?.accessToken;
      const refreshToken = req.cookies?.refreshToken;

      if (accessToken || refreshToken) {
        const tokensToBlacklist = [];
        
        if (accessToken) {
          const jti = extractJTI(accessToken);
          const decoded = jwt.decode(accessToken) as any;
          if (jti) tokensToBlacklist.push({
            tokenJti: jti,
            userId,
            reason: 'password_change',
            expiresAt: new Date(decoded?.exp * 1000)
          });
        }
        
        if (refreshToken) {
          const jti = extractJTI(refreshToken);
          const decoded = jwt.decode(refreshToken) as any;
          if (jti) tokensToBlacklist.push({
            tokenJti: jti,
            userId,
            reason: 'password_change',
            expiresAt: new Date(decoded?.exp * 1000)
          });
        }

        await db.insert(tokenBlacklist).values(tokensToBlacklist).catch((err) => {
          console.warn('[JWT] Failed to blacklist on password change:', err);
        });
      }

      res.clearCookie('accessToken');
      res.clearCookie('refreshToken');

      res.json({ success: true, message: 'Password changed. Please login again' });
    } catch (err: any) {
      console.error('change-password error:', err);
      res.status(500).json({ error: 'Failed to change password' });
    }
  }
);
```

**⚠️ BREAKING CHANGE:**
- Clients sans `requireAuth` recevront 401
- Email parameter ignoré (on utilise req.user.id)
- Unified error messages

**Raison:** Fixer VUL2 (accès non-autorisé)  
**Risque:** 🔴 CRITIQUE - Breaking, NOTIFICATION OBLIGATOIRE  
**Rollback:** Supprimer requireAuth

**NOTIFICATION PRÉ-DÉPLOIEMENT:**
```
🚨 IMPORTANT NOTICE: API Breaking Change Phase 4

POST /api/auth/change-password NOW REQUIRES AUTHENTICATION

Before: curl -X POST /api/auth/change-password \
  -d '{"email": "user@ecole.fr", "currentPassword": "...", "newPassword": "..."}'

After: Must be authenticated (JWT cookie or x-simulated-* headers)
  curl -X POST /api/auth/change-password \
    -b "accessToken=..." \
    -d '{"currentPassword": "...", "newPassword": "..."}'

Impact:
- Email from request body IGNORED
- Using authenticated user ID instead
- All existing sessions logged out after password change

Migration timeline:
- Phase 4 deploy: 2-week advance notice required
- 1 week notice: Update client code
- Day 1: Deploy change-password fix
- Post-deploy: Monitor 401 errors
```

---

## DETAILLE PHASE 5: CLEANUP (OPTIONAL)

### 5.1 - Fixer VUL1 (NODE_ENV check)

**Fichier:** `src/middleware/auth.ts`  
**Lignes:** 37  
**Action:** Normaliser NODE_ENV check

**Avant:**
```typescript
const isProduction = process.env.NODE_ENV === 'production';
```

**Après:**
```typescript
const isProduction = process.env.NODE_ENV?.toLowerCase() === 'production';
```

**Raison:** Bloquer bypass NODE_ENV='PRODUCTION'  
**Risque:** Faible - améliore sécurité  
**Rollback:** Revert

---

### 5.2 - Optionnellement supprimer x-simulated-* (post-Migration)

**Ne faire que après que tous les clients sont migrés:**

```typescript
// Dans verifyToken(), supprimer bloc fallback:
// SUPPRIMER CETTE SECTION après confirmation:
if (!isProduction) {
  const simHeaders = { ... };
  // ...
}
```

**Raison:** Réduire surface d'attaque  
**Risque:** 🔴 CRITIQUE - Briser dev mode  
**Rollback:** Restaurer bloc

---

## SUMMARY: FICHIERS À MODIFIER PAR PHASE

### Phase 0: Infrastructure

| Fichier | Lignes | Type | Effort |
|---------|--------|------|--------|
| `.env.example` | End | Add | 10m |
| `src/lib/jwt.ts` | N/A | Create | 20m |
| Drizzle schema | N/A | Add table | 10m |
| `server.ts` | ~500 | Add cleanup | 5m |
| **TOTAL** | | | **45m** |

### Phase 1: JWT Backend

| Fichier | Lignes | Type | Effort |
|---------|--------|------|--------|
| `server.ts` | 1438-1476 | Modify | 30m |
| `server.ts` | ~1515 | Add refresh | 25m |
| `server.ts` | ~1512 | Modify logout | 15m |
| `src/middleware/auth.ts` | 27-113 | Modify | 30m |
| **TOTAL** | | | **100m** |

### Phase 2: Frontend Cookies

| Fichier | Lignes | Type | Effort |
|---------|--------|------|--------|
| `src/components/LoginView.tsx` | ~50 | Modify | 20m |
| `src/lib/api.ts` | 233-269 | Modify | 30m |
| `src/context/AuthContext.tsx` | N/A | Adapt | 15m |
| **TOTAL** | | | **65m** |

### Phase 3: Auto-Refresh

| Fichier | Lignes | Type | Effort |
|---------|--------|------|--------|
| `server.ts` | ~1550 | Enhance refresh | 20m |
| `src/lib/api.ts` | ~300 | Enhance 401 handling | 25m |
| `src/middleware/auth.ts` | N/A | Enhance | 10m |
| **TOTAL** | | | **55m** |

### Phase 4: VUL2 Fix (BREAKING)

| Fichier | Lignes | Type | Effort |
|---------|--------|------|--------|
| `server.ts` | 1487-1515 | Modify + requireAuth | 40m |
| Tests | Update E2E | Update | 30m |
| Documentation | Add breaking change notice | 20m |
| **TOTAL** | | | **90m** |

### Phase 5: Cleanup (Optional)

| Fichier | Lignes | Type | Effort |
|---------|--------|------|--------|
| `src/middleware/auth.ts` | 37 | Fix VUL1 | 5m |
| `src/lib/api.ts` | Various | Remove sim headers | 15m |
| Tests | Update | Update for JWT-only | 20m |
| **TOTAL** | | | **40m** |

---

## GRAND TOTAL

| Phase | Durée Estim | Dev | Staging | Production |
|-------|-------------|-----|---------|------------|
| 0 | 45m | Day 1 | - | - |
| 1 | 100m | Day 1-2 | Day 2 | Day 3-4 |
| 2 | 65m | Day 2 | Day 2-3 | Day 4-5 |
| 3 | 55m | Day 2-3 | Day 3 | Day 5-6 |
| 4 | 90m | Day 3-4 | Day 4-5 | Day 6-7 ⚠️ |
| 5 | 40m | Day 5+ | Optional | Optional |
| **TOTAL** | **~10h** | **~1 week** | **1 week** | **1 week** |

---

## DEPLOYMENT STRATEGY

### Pre-Deployment Checklist (All Phases)

```
PHASE PREPARATION:
□ Code review completed
□ Tests passing (>80% coverage)
□ Database migration tested locally
□ Rollback procedure documented
□ Team notified

STAGING DEPLOYMENT:
□ Deploy to staging
□ Run smoke tests
□ Monitor errors for 24h
□ Check performance metrics
□ Security audit passed

PRODUCTION DEPLOYMENT:
□ Maintenance window scheduled (if needed)
□ Rollback procedure ready
□ Monitoring/alerting configured
□ On-call team briefed
□ Post-deploy validation plan
```

### Deployment Windows

- **Phase 1, 2, 3:** Anytime (backward compatible)
- **Phase 4:** 🚨 REQUIRES 2-WEEK ADVANCE NOTICE + Coordination with clients
- **Phase 5:** Anytime after Phase 4 (optional)

---

## ROLLBACK PROCEDURES

### Phase-by-Phase Rollback

#### Phase 1 Rollback
```bash
# If JWT generation broken:
1. Deploy: remove jwt.sign() calls, keep json response
2. Set JWT_SECRET=''
3. Middleware: ignore accessToken cookie
4. Frontend: ignore cookies, fallback to x-simulated-*
5. Timeline: 5-10 minutes
```

#### Phase 2 Rollback
```bash
# If cookie handling broken:
1. Remove credentials: 'include' flag
2. Frontend: stop reading localStorage user data
3. Backend: continue serving cookies (harmless)
4. Timeline: 5 minutes
```

#### Phase 3 Rollback
```bash
# If auto-refresh broken:
1. Remove auto-refresh logic in apiFetch
2. Clients: manually handle 401 (redirect to login)
3. Timeline: 5 minutes
```

#### Phase 4 Rollback (CRITICAL)
```bash
# If change-password requireAuth breaks:
1. REMOVE requireAuth middleware from endpoint
2. ALERT ALL CLIENTS about breaking change
3. Keep rate limiter active
4. Timeline: 10 minutes
5. Follow-up: communicate with teams immediately
```

---

## TEST CHECKLIST (Par Phase)

### Phase 1 Tests

```typescript
describe('Phase 1: JWT Generation', () => {
  test('login returns user + sets JWT cookies', async () => {
    // Call login endpoint
    // Verify: accessToken cookie present + httpOnly
    // Verify: refreshToken cookie present + httpOnly
    // Verify: response has user data
  });

  test('refresh endpoint returns new tokens', async () => {
    // Call refresh with old token
    // Verify: new accessToken generated
    // Verify: new refreshToken generated
    // Verify: old token blacklisted
  });

  test('logout blacklists tokens', async () => {
    // Login
    // Call logout
    // Verify: cookies cleared
    // Verify: tokens in blacklist
  });
});
```

### Phase 2 Tests

```typescript
describe('Phase 2: Cookie Handling', () => {
  test('apiFetch sends cookies automatically', async () => {
    // Call apiFetch with credentials flag
    // Verify: cookies in request
    // Verify: response OK
  });

  test('LoginView stores user in localStorage', async () => {
    // Login
    // Verify: localStorage has user data
    // Verify: NOT tokens (only displayable info)
  });
});
```

### Phase 4 Tests (CRITICAL)

```typescript
describe('Phase 4: Change Password Security', () => {
  test('change-password requires authentication', async () => {
    // Call without auth
    // Verify: 401 response
    // Verify: error message
  });

  test('change-password accepts authenticated user', async () => {
    // Login first
    // Call change-password with JWT
    // Verify: 200 OK
    // Verify: user logged out (tokens cleared)
  });

  test('change-password rate limited', async () => {
    // Call endpoint 4 times in 15 minutes
    // Verify: 4th call returns 429 (Too Many Requests)
  });
});
```

---

## SECURITY CHECKLIST

- [ ] All tokens have expiry dates
- [ ] Refresh tokens rotate on each use
- [ ] Old tokens immediately blacklisted
- [ ] Cookies: HttpOnly = true
- [ ] Cookies: Secure = true (prod only)
- [ ] Cookies: SameSite = strict
- [ ] NODE_ENV check normalized (case-insensitive)
- [ ] Change-password requires authentication
- [ ] Rate limiting on all auth endpoints
- [ ] Error messages don't leak user info
- [ ] Session invalidation on password change
- [ ] Token reuse detected (theft protection)
- [ ] Logout blacklists all tokens
- [ ] Multi-device support possible (Phase 5+)

---

## KNOWN RISKS & MITIGATIONS

| Risk | Severity | Mitigation |
|------|----------|-----------|
| XSS steals refresh token | Medium | HttpOnly cookies immune to JS access |
| Token theft via MITM | High | Use HTTPS + Secure flag |
| Clock skew JWT expiry | Low | 30s grace period on expiry checks |
| Database blacklist grows | Low | Auto-cleanup on startup |
| Refresh loop infinite | Medium | Max 1 retry in apiFetch |
| Phase 4 breaks old clients | Critical | 2-week advance notice required |
| Dev/prod parity | Low | x-simulated-* fallback in dev |

---

## NEXT STEPS AFTER APPROVAL

1. ✅ **Document validated** (JWT_MIGRATION_CORRECTED_STRATEGY.md)
2. 🔲 **Team review & sign-off**
3. 🔲 **Phase 0 implementation** (infra setup)
4. 🔲 **Phase 0 testing** (database + env vars)
5. 🔲 **Phase 1 implementation** (JWT generation)
6. 🔲 **Phase 1 staging** (verify endpoint works)
7. 🔲 **Phase 1 production** (monitor 24h)
8. 🔲 **...continue phases 2-5**

---

**Status:** 🟡 READY FOR IMPLEMENTATION (pending approval)  
**Approvals Needed:** 1 (Tech Lead / Product Owner)  
**Estimated Completion:** 1 week

