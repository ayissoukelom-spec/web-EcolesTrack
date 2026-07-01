# Test Plan: Email Uniqueness & School Selection Flow

## 📋 Résumé des Tests

### A. TEST: Email Uniqueness Per-School

#### A.1 - Créer même email dans deux écoles différentes ✅
```bash
# Admin crée un enseignant dans École A
POST /api/teachers
{
  "name": "Alice Martin",
  "email": "alice@example.com",
  "schoolId": 1,
  "specialization": "Math",
  "phone": "06123456789"
}
→ 201 Created ✅

# Admin crée un parent dans École B (même email)
POST /api/parents
{
  "name": "Alice Martin (Parent)",
  "email": "alice@example.com",
  "schoolId": 2
}
→ 201 Created ✅ (Devrait réussir - écoles différentes)
```

#### A.2 - Refuser email en doublon dans la même école ❌
```bash
# Admin essaie de créer un autre prof dans École A avec même email
POST /api/teachers
{
  "name": "Alice Martin",
  "email": "alice@example.com",
  "schoolId": 1,
  "specialization": "Science"
}
→ 409 Conflict ❌ (Devrait refuser - même école)
Error: "User with same email already exists in this school"
```

#### A.3 - Super admin: email unique globalement 🔒
```bash
# Super admin crée un compte avec email
POST /api/admin/users
{
  "email": "superadmin@example.com",
  "name": "Admin Principal",
  "role": "super_admin"
}
→ 201 Created ✅

# Tentative de créer un autre super admin avec même email
POST /api/admin/users
{
  "email": "superadmin@example.com",
  "name": "Autre Admin",
  "role": "super_admin"
}
→ 409 Conflict ❌ (Global unique)
Error: "User with same email already exists"
```

#### A.4 - Mettre à jour email existant (PUT /api/admin/users/:id)
```bash
# Créer 2 enseignants dans École A
POST /api/teachers → alice@example.com (id=1)
POST /api/teachers → bob@example.com (id=2)

# Essayer de changer l'email de alice vers bob (même école)
PUT /api/admin/users/1
{
  "email": "bob@example.com",
  "name": "Alice",
  "role": "teacher",
  "schoolId": 1
}
→ 409 Conflict ❌ (Conflict: bob existe déjà dans l'école 1)
Error: "Email already in use by another user in this school"

# Changer l'email de alice vers charlie@example.com (différent)
PUT /api/admin/users/1
{
  "email": "charlie@example.com",
  "name": "Alice",
  "role": "teacher",
  "schoolId": 1
}
→ 200 OK ✅
```

#### A.5 - Batch import parents (POST /api/parents/batch)
```bash
POST /api/parents/batch
[
  { "name": "Parent 1", "email": "parent1@example.com", "schoolId": 1 },
  { "name": "Parent 1 Branch", "email": "parent1@example.com", "schoolId": 2 },
  { "name": "Parent Dup", "email": "parent1@example.com", "schoolId": 1 }
]

Response:
{
  "inserted": [
    { "id": ..., "email": "parent1@example.com", "schoolId": 1 },
    { "id": ..., "email": "parent1@example.com", "schoolId": 2 }
  ],
  "errors": [
    { "row": 2, "email": "parent1@example.com", "error": "duplicate email in this school" }
  ]
}
```

---

### B. TEST: Authentication School Selection Flow

#### B.1 - Login avec user multi-école
```bash
# User alice a memberships dans École 1 ET École 2

# Step 1: Login
POST /api/auth/local-login
{
  "email": "alice@example.com",
  "password": "password123"
}
→ 200 OK
Response: { "id": 1, "email": "alice@example.com", "name": "Alice", "role": "teacher", "schoolId": 1 }

# IMPORTANT: Frontend ne doit PAS inclure le schoolId dans les headers de simulation à ce stade
# Headers simulés doivent être: x-simulated-role, x-simulated-uid, x-simulated-email, x-simulated-name
# MAIS PAS x-simulated-school-id
```

#### B.2 - GET /api/auth/schools sans schoolId header
```bash
# Headers: x-simulated-role=teacher, x-simulated-email=alice@example.com
# SANS x-simulated-school-id (c'est la clé!)

GET /api/auth/schools
→ 200 OK
Response: {
  "schools": [
    { "id": 1, "name": "École Primaire A" },
    { "id": 2, "name": "École Primaire B" }
  ],
  "activeSchoolId": 1
}

Vérifier: 
✅ Les 2 écoles retournées = memberships réels dans user_schools pour alice
✅ Pas d'écoles "fantômes" ou obsolètes
✅ activeSchoolId pointe sur une école réelle
```

#### B.3 - Frontend affiche les écoles et utilisateur sélectionne
```
UI affiche:
  □ École Primaire A
  ☑ École Primaire B  ← User sélectionne

User clique "Continuer"
```

#### B.4 - POST /api/auth/schools/active avec sélection
```bash
POST /api/auth/schools/active
{
  "schoolId": 2
}

Vérification:
1. Backend vérifie que alice a un membership pour schoolId=2 dans user_schools
2. Si pas de membership → 403 Forbidden
3. Si membership existe → 200 OK, set isActive=true pour schoolId=2

Response: { "schoolId": 2 }
```

#### B.5 - Frontend met à jour simulation après sélection
```javascript
// Après réponse positive de POST /api/auth/schools/active:
setActiveSchoolId(2);  // localStorage
setSimulatedUser({
  uid: "teacher_...",
  email: "alice@example.com",
  name: "Alice",
  schoolId: 2  // NOW incluez le schoolId
});

// Maintenant les headers incluront x-simulated-school-id=2
```

#### B.6 - Tentative de sélectionner école sans membership
```bash
# User bob a membership uniquement dans École 1
# Bob essaie de sélectionner École 3 (pas de membership)

POST /api/auth/schools/active
{
  "schoolId": 3
}

Response: 403 Forbidden
Error: "School membership not found for this user"

Logs doivent montrer:
"School selection denied: user has no membership for school"
{ userId: bob.id, schoolId: 3, userRole: "teacher" }
```

#### B.7 - Super admin peut sélectionner n'importe quelle école
```bash
# Super admin login
POST /api/auth/local-login → super_admin

# GET /api/auth/schools retourne TOUTES les écoles
GET /api/auth/schools
→ "schools": [...toutes les écoles de la base...]

# Super admin peut sélectionner n'importe laquelle
POST /api/auth/schools/active
{
  "schoolId": 99  # Peut être n'importe quelle école
}
→ 200 OK ✅
```

---

## 🔍 Points de Vérification Détaillés

### Database Consistency
```sql
-- Vérifier user_schools est correctement rempli
SELECT u.id, u.email, u.school_id, us.school_id, us.is_active
FROM users u
LEFT JOIN user_schools us ON u.id = us.user_id
WHERE u.role IN ('teacher', 'parent');

-- Les user_schools doivent avoir entries pour tous les teachers/parents
-- user_schools.school_id doit être consistant avec users.school_id
```

### Logs à Vérifier
Après chaque test, vérifier les logs pour:
```
[GET /api/auth/schools]
✅ "actor.id = X, memberships found = 2"
✅ "schoolIds = [1, 2]"
✅ "activeSchoolId determined = 1"

[POST /api/auth/schools/active]
✅ "userId X attempting to select schoolId Y"
✅ "membership check: found/not found"
✅ Si denied: "School selection denied: ..."

[POST /api/admin/users]
✅ "Email check: per-school for role=teacher, schoolId=1"
✅ "Conflicts found: 0" → OK, ou > 0 → Conflict
```

---

## 📝 Test Cases Summary

| Test | Endpoint | Input | Expected | Status |
|------|----------|-------|----------|--------|
| A.1 | POST /api/teachers | email dans École 1 | ✅ 201 | ✅ |
| A.1 | POST /api/parents | email dans École 2 | ✅ 201 | ✅ |
| A.2 | POST /api/teachers | email dup École 1 | ❌ 409 | ✅ |
| A.3 | POST /api/admin/users | super_admin email | ✅ 201 | ✅ |
| A.3 | POST /api/admin/users | dup super_admin | ❌ 409 | ✅ |
| A.4 | PUT /api/admin/users | change email dup | ❌ 409 | ✅ |
| A.5 | POST /api/parents/batch | batch dup emails | mixed ✅❌ | ✅ |
| B.1 | POST /api/auth/local-login | login multi-school | ✅ 200 | ✅ |
| B.2 | GET /api/auth/schools | no school header | ✅ retourne memberships | ✅ |
| B.3 | Frontend | affiche écoles | UI sync ✅ | ✅ |
| B.4 | POST /api/auth/schools/active | sélection valid | ✅ 200 | ✅ |
| B.6 | POST /api/auth/schools/active | school sans membership | ❌ 403 | ✅ |
| B.7 | POST /api/auth/schools/active | super_admin select any | ✅ 200 | ✅ |

---

## 🚀 Exécution des Tests

### Option 1: Tests Manuels (Postman)
Voir `tests/postman_collection.json` (à créer)

### Option 2: Tests Automatisés (Vitest)
```bash
# Run email uniqueness tests
npm test -- tests/email-uniqueness.test.ts

# Run auth flow tests
npm test -- tests/auth-school-selection.test.ts

# Run all tests
npm test
```

### Option 3: Tests d'Intégration (Curl)
```bash
./test-email-uniqueness.sh
./test-auth-flow.sh
```

---

## 📌 Important: Frontend Checklist

Avant déploiement en prod, vérifier que LoginView.tsx:

- [ ] N'inclut PAS `schoolId` dans `setSimulatedUser()` après login
- [ ] Appelle `loadSchools()` APRÈS `setSimulatedUser()` (sans schoolId)
- [ ] Attend la réponse complète de `GET /api/auth/schools`
- [ ] Affiche uniquement les écoles retournées par le backend
- [ ] Appelle `POST /api/auth/schools/active` quand utilisateur sélectionne
- [ ] Met à jour `simulatedUser` avec `schoolId` APRÈS confirmation du backend
- [ ] Gère les cas d'erreur 403 "School membership not found"

---

## 🔒 Security Validation

- ✅ Email uniqueness per-school (pas de fuite entre écoles)
- ✅ Super admin reste globalement unique
- ✅ Membership strict (403 si pas de user_schools entry)
- ✅ Frontend headers ne peuvent pas bypasser server checks
- ✅ PUT /api/admin/users vérifie aussi per-school

