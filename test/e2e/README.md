# E2E Security Test Suite (Vitest + Supertest)

This folder contains end-to-end tests that exercise sensitive authentication and authorization flows described in the audit.

How it works
- Tests start the real `server.ts` module; however the DB and auth middleware are mocked via `vi.mock` so tests run fast and deterministically.
- Fixtures: in-memory objects inside `auth.e2e.test.ts` represent `users`, `schools`, `localAuths`, etc.
- The mocked `requireAuth` middleware simulates three bearer tokens:
  - `token-super` → `super_admin`
  - `token-school` → `school_admin` (schoolId: 10)
  - `token-teacher` → `teacher` (schoolId: 10)

Scenarios covered (mapping to audit requirements)
1. NODE_ENV=production + `x-simulated-*` headers → must be refused.
2. Attempt to create `super_admin` using simulated context → must fail (401/403 expected).
3. `school_admin` attempts creating/modifying another admin → must fail (400/403 expected).
4. `school_admin` attempts action outside their school (set-password for user in different school) → must fail (400/403 expected).
5. `super_admin` performs allowed actions (create admin, delete user) → allowed (201/200 or acceptable conflict/404 depending on fixtures).
6. After each action, the in-memory fixtures are inspected to assert DB state (roles, isDeleted, etc.).

Limitations & required refactors
- The tests mock the DB layer (`./src/db/index.ts`) and the auth middleware (`./src/middleware/auth.ts`) using Vitest module stubs. This avoids needing a real Postgres instance.
- The server is started by importing `server.ts` (it calls `startServer()` on import). The tests assume port `3000` is available.
- If you prefer integration tests against a real database, refactor `server.ts` to export an `createApp({ db, auth })` factory and run against a test Postgres/SQLite instance. The current mocks allow fast security verification.

Run the tests

Install dependencies if needed, then run:

```bash
npm install
npx vitest run test/e2e/auth.e2e.test.ts
```

Notes
- These tests intentionally accept some non-201 statuses where the application enforces uniqueness constraints (409) or validation (400). The goal is to assert the absence of privilege escalation and correct rejection of simulated headers in production.
