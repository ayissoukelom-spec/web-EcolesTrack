# JWT Future Design

> NOTE: Ce document décrit une architecture future. Elle n'est pas implémentée dans le code actuel.
>
> Ce fichier documente uniquement une conception cible/planned ; il ne doit pas être interprété comme l'état actuel du système.

# Conception future : RS256, Refresh, Rotation, Cookies, Révocation

## Objectif
Documenter l'architecture cible pour une évolution future : signatures RS256, gestion des clés privées/publiques, refresh tokens avec rotation, cookies HttpOnly/Secure, et révocation avancée.

## 1. RS256 - Algorithme et gestion de clés
- Algorithme recommandé pour production : **RS256** (asymétrique).
- Clés : clé privée (signing) stockée dans un secret manager, clé publique exposée aux validateurs.
- Rotation de clé : versionner les clés (kid), support pour plusieurs clés publiques lors de la vérification.
- Pratiques : NO switch-over sans période de compatibilité, clés privées ne doivent jamais être commises.

## 2. Gestion des clés privées/publiques
- Stockage : HSM / Vault (recommended). Environnement CI/CD en lecture seule pour key fetch.
- Formats : PEM/PKCS8 pour la clé privée, PEM/PKIX pour la clé publique.
- Exposure : fournir endpoint ou configuration `JWT_PUBLIC_KEYS_URL` pour la validation côté services.
- Rotation : publier nouvelle clé publique avant de commencer à signer avec la nouvelle clé privée; utiliser `kid` dans l'entête du JWT.

## 3. Refresh Tokens & Cookie-based Refresh
- Flow : Access tokens courts (ex. 15m), Refresh tokens longs (ex. 7d).
- Storage client : Refresh token en cookie `HttpOnly; Secure; SameSite=Strict` (backend définit le cookie), access token stocké en mémoire (ou sessionStorage avec précautions).
- Endpoint : `POST /api/auth/refresh` lisant le cookie HttpOnly (ou body pour mobile), émettant nouveau access token et nouveau refresh token (rotation).
- CSRF : exiger un CSRF token pour la route `POST /api/auth/refresh` si cookie est utilisé.

## 4. Rotation des refresh tokens
- Chaque refresh consomme l'ancien refresh token et génère un nouveau refresh token (one-time use).
- Stocker la chaîne de rotation dans la DB (session id, last_jti, version).
- Détecter la réutilisation d'un refresh token : si un token réutilisé est détecté, révoquer l'ensemble de la session et forcer logout global.

## 5. Cookies HttpOnly/Secure
- Cookie flags : `HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=...`.
- Domaines : définir `COOKIE_DOMAIN` en prod, laisser vide en dev/local.
- Mobile : pour mobile apps, accepter refresh token dans header Authorization ou body (pas de cookie).

## 6. Révocation avancée des sessions
- Tables : `user_sessions` (session_id, user_id, last_activity, device_info), `token_blacklist` (jti, session_id, user_id, expires_at, reason).
- Logout : inscrire le `jti` du token dans `token_blacklist` et marquer session comme ended.
- Rotation/revocation : lorsque refresh rotation détecte reuse, blacklist all JTI of session and increment session version.
- Cleanup : job périodique supprime entrées expirées de `token_blacklist`.

## 7. Évolutions possibles
- Support multi-tenant key sets (per-issuer keys).
- Intégration OIDC provider pour JWKS fetch automatique.
- Signature détachée (detached JWS) pour payloads volumineux.

## 8. Annexes
- Variables d'environnement envisagées pour cette architecture future : `JWT_PRIVATE_KEY`, `JWT_PUBLIC_KEY`, `JWT_PUBLIC_KEYS_URL`, `JWT_KEY_ID`, `JWT_REFRESH_SECRET`, `JWT_REFRESH_EXPIRES_IN`, `COOKIE_DOMAIN`, `ALLOW_SIMULATED_AUTH` (strictement false en production).

---

# End of document
