# Corrections: Gestion d'Unicité des Emails et Flux de Sélection d'École

## 📋 Résumé des Modifications

### 1. **Gestion d'Unicité des Emails (Per-School)**

#### Fichier: `src/lib/emailUniqueness.ts`
- ✅ Modifié `EmailUniquenessScope` pour supporter deux modes:
  - `{ mode: 'global' }` : Pour super_admin (email unique dans tout le système)
  - `{ mode: 'per-school'; schoolId: number | null }` : Pour autres rôles (email unique par école)
- ✅ Mis à jour `getEmailUniquenessScope()` pour appliquer la logique correcte:
  - super_admin → mode global
  - teacher/parent → mode per-school

#### Fichier: `server.ts`
- ✅ **Nouvelle fonction** `findExistingUsersByEmailAndSchool()` (ligne ~75)
  - Vérifie si un email existe pour un schoolId spécifique
  - Retourne vide si pas de schoolId (ne peut pas vérifier per-school)

- ✅ **POST /api/admin/users** (ligne ~730-750)
  - Super admin: vérification d'email globale
  - Autres rôles: vérification d'email per-school avec schoolId
  - Message d'erreur amélioré

- ✅ **POST /api/teachers** (ligne ~2420)
  - Changé de `findExistingUsersByEmail()` → `findExistingUsersByEmailAndSchool()`
  - Vérifie email uniquement dans la même école

- ✅ **POST /api/parents** (ligne ~2650)
  - Changé de `findExistingUsersByEmail()` → `findExistingUsersByEmailAndSchool()`
  - Vérifie email uniquement dans la même école

**Comportement Attendu:**
```
École A:  alice@example.com (professeur) → ✅ Créé
École B:  alice@example.com (parent)    → ✅ Créé (différente école)
École A:  alice@example.com (autre role)→ ❌ Refusé (même école)
```

---

### 2. **Flux de Sélection d'École (Synchronisation UI/Backend)**

#### Fichier: `src/components/LoginView.tsx`
- ✅ **Correction majeure** (ligne ~53)
  - **AVANT**: `setSimulatedUser()` incluait le schoolId du login (potentiellement invalide)
  - **APRÈS**: `setSimulatedUser()` n'inclut plus le schoolId avant sélection
  - Headers de simulation n'incluent plus de schoolId invalide lors de GET /api/auth/schools

**Flux Corrigé:**
```
1. User login (POST /api/auth/local-login)
   ↓
2. setSimulatedUser() SANS schoolId
   ↓
3. GET /api/auth/schools (sans x-simulated-school-id invalide)
   ↓
4. Affiche les écoles valides (uniquement de user_schools)
   ↓
5. User sélectionne école
   ↓
6. POST /api/auth/schools/active (vérification stricte du membership)
   ↓
7. setActiveSchoolId() en localStorage
   ↓
8. setSimulatedUser() AVEC schoolId valide
```

#### Fichier: `server.ts`

- ✅ **GET /api/auth/schools** (ligne ~1240)
  - Commentaires améliorés pour clarifier la logique
  - Super admin: retourne toutes les écoles
  - Autres: retourne uniquement les écoles de `user_schools`
  - activeSchoolId calculé correctement depuis les memberships
  - Gestion correcte du cas sans memberships

- ✅ **POST /api/auth/schools/active** (ligne ~1285)
  - Logging amélioré pour déboguer les problèmes
  - Vérification stricte du membership via `ensureUserSchoolMembership()`
  - Message d'erreur clair si membership non trouvé
  - Super admin peut toujours sélectionner n'importe quelle école

**Garantie:**
- La liste d'écoles affichée = écoles dans `user_schools`
- Pas de désynchronisation entre frontend et backend
- "School membership not found" ne devrait plus survenir

---

## 🔒 Sécurité

### Isolation Multi-École Améliorée

1. **Emails**: Même email peut exister dans différentes écoles
2. **Authentification**: Vérification stricte que l'utilisateur a le membership requis
3. **Super Admin**: Reste global (comme avant)
4. **Teachers/Parents**: Isolés par école

### Validations Strictes

```sql
-- Vérification per-school
SELECT * FROM users 
WHERE LOWER(email) = ?
  AND school_id = ?;

-- Membership verification
SELECT * FROM user_schools 
WHERE user_id = ? 
  AND school_id = ?;
```

---

## 🧪 Points de Test Recommandés

1. **Email Uniqueness:**
   - Créer même email dans deux écoles différentes → ✅ Doit réussir
   - Créer même email dans la même école → ❌ Doit refuser
   - Super admin: même email partout → ❌ Doit refuser (global)

2. **Auth Flow:**
   - Login → GET schools sans schoolId en header → POST school active
   - Vérifier que seules les écoles valides sont affichées
   - Vérifier que la sélection d'école invalide est refusée (403)

3. **Data Consistency:**
   - Vérifier user_schools après login
   - Vérifier activeSchoolId en localStorage
   - Vérifier headers de simulation incluent le bon schoolId

---

## 📝 Notes d'Implementation

- Pas de migration de schéma nécessaire (tables existantes utilisées correctement)
- Pas de modification frontend majeure (LoginView seulement)
- Backward compatible avec les super_admin existants
- Le code de `user_schools` était déjà présent, maintenant correctement utilisé

---

## ✅ Checklist Avant Mise en Prod

- [ ] Tester création user/teacher/parent avec emails en double (même école + écoles différentes)
- [ ] Tester login flow complet → sélection école
- [ ] Vérifier user_schools contient les memberships corrects
- [ ] Vérifier super_admin peut toujours accéder à toutes les écoles
- [ ] Vérifier les logs pour "School selection denied" (détection de tentatives invalides)
- [ ] Tester avec données réelles: migrations anciennes d'écoles
