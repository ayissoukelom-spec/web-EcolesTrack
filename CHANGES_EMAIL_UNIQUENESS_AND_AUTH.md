# Corrections: Gestion d'Unicité des Emails et Flux de Sélection d'École

> **Note de mise à jour :** la règle d'unicité par établissement décrite dans cette note est historique et a été remplacée. La règle actuelle exige une unicité globale des emails normalisés, tous rôles et établissements confondus; les parents peuvent avoir `NULL`. Voir le schéma courant dans `src/db/schema.ts` et le baseline candidat dans `drizzle-local-baseline-candidate/`.

## 📋 Résumé des Modifications

### 1. **Règle actuelle d'unicité des emails**

- `normalizeEmail()` applique `String.trim()` puis `toLowerCase()`; un email absent ou blanc devient `NULL`.
- Les vérifications des parcours de création, modification, authentification et import sont globales; elles ne varient ni selon le rôle ni selon l'établissement.
- La contrainte attendue est un index unique sur `LOWER(BTRIM(email, trimCharacters))` pour les emails non nuls, accompagné de checks qui autorisent `NULL` pour les parents et refusent les emails blancs. La liste SQL des caractères rognés reflète l'ensemble `String.trim()`.
- L'unicité de base de données est décrite dans `src/db/schema.ts` et le baseline candidat `drizzle-local-baseline-candidate/`; aucune migration n'a été appliquée par cette mise à jour.
- `ensureUsersTableSchema()` ne supprime et ne recrée plus de contrainte email; les objets attendus relèvent du schéma et des migrations/baselines.

**Comportement attendu :** le même email normalisé est refusé pour toute paire de comptes, y compris entre écoles ou rôles différents. Plusieurs parents peuvent avoir `NULL`; les rôles autres que parent doivent fournir un email non blanc.

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

1. **Emails**: Un email normalisé ne peut être attribué qu'à un seul compte, tous rôles et établissements confondus.
2. **Authentification**: Vérification stricte que l'utilisateur a le membership requis
3. **Super Admin**: Reste global (comme avant)
4. **Teachers/Parents**: Leurs autorisations et memberships restent liés à l'école; l'unicité email est globale.

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
