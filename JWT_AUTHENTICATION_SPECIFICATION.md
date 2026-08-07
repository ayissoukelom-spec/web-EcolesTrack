# JWT Authentication Specification — Implémentation Courante

> Ce document décrit uniquement l'implémentation actuelle telle qu'observée dans le code. Pour l'architecture cible (RS256, refresh tokens, rotation, cookies HttpOnly), voir `JWT_FUTURE_DESIGN.md`.

## Résumé rapide

- Algorithme de signature en production : **HS256** (secret partagé `JWT_SECRET`).
- Claims usuels : `iss` (validé si `JWT_ISSUER` configuré), `aud` (validé si `JWT_AUDIENCE` configuré), `sub`, `iat`, `exp`, `jti`.
- `jti` : attendu et utilisé pour la révocation. La colonne DB `token_blacklist.token_jti` est actuellement **nullable** pour compatibilité historique, mais les tokens doivent contenir `jti` pour une révocation fiable.
- Validation effectuée par le middleware (`src/middleware/auth.ts`) : signature (HS256), `exp`/`nbf`, `iss`/`aud` si configurés, et liaison `sub` → utilisateur DB (`decoded.sub === String(dbUser.id)`).
- Révocation : vérification de `token_blacklist` par `token_jti` ou, en fallback historique, par token brut. Si le token est blacklisté et non expiré, il est rejeté.
- Refresh tokens : **ABSENTS** de l'implémentation courante. Toute mention de refresh tokens ou de refresh-cookie dans d'autres documents correspond à une architecture future (voir `JWT_FUTURE_DESIGN.md`).

## Détails techniques

### Emission
- Point d'émission observé : `src/lib/localLogin.ts` (si présent).
- Doit signer avec : `JWT_SECRET` (ne pas utiliser de valeur codée en dur en production).
- Exemple de claims attendus :
  - `sub`: identifiant DB de l'utilisateur (string)
  - `uid`, `email`, `role`, `schoolId`
  - `jti`: UUID v4
  - `type`: 'access'

### Vérification (middleware)
- Utiliser la valeur de `JWT_SECRET` pour `jwt.verify()` en HS256.
- Si `JWT_ISSUER` est configuré, valider `iss`.
- Si `JWT_AUDIENCE` est configuré, valider `aud`.
- Vérifier `exp` (et `nbf` si présent).
- Charger l'utilisateur en base à partir de `decoded.uid`/`sub` et vérifier la correspondance `sub`.
- Vérifier la révocation via `token_blacklist` (chercher `token_jti` puis fallback token brut si nécessaire).

### Logout / Révocation
- Le mécanisme actuel s'appuie sur la table `token_blacklist` pour refuser des tokens révoqués.
- Lors d'un logout, le `jti` du token courant devrait être ajouté à `token_blacklist` (si présent) ; la colonne nullable existe pour compatibilité historique.

## Variables d'environnement (production)
- `JWT_SECRET` : **OBLIGATOIRE** en production (stockage sécurisé recommandé).
- `JWT_ISSUER` : recommandé (si utilisé, middleware validera `iss`).
- `JWT_AUDIENCE` : recommandé (si utilisé, middleware validera `aud`).
- `JWT_EXPIRES_IN` : notation d'expiration (ex. `1h`).
- `ALLOW_SIMULATED_AUTH` : NE PAS activer en production (autorise des en-têtes de simulation en dev/test).

## Recommandations opérationnelles
- S'assurer que tous les tokens signés contiennent un `jti` unique (UUID v4).
- Ne pas déployer sans `JWT_SECRET` configuré en production.
- Documenter et migrer la colonne `token_blacklist.token_jti` vers `NOT NULL` uniquement après avoir vérifié que tous les tokens existants ont des `jti` uniques.

## Référence code
- `src/middleware/auth.ts` — point de vérification et d'attachement `req.user`.
- `src/lib/localLogin.ts` — point d'émission (vérifier existence et comportement).

---

**Statut:** Aligné sur l'implémentation actuelle (HS256, blacklist).  
**Dernière mise à jour:** 2026-08-07
