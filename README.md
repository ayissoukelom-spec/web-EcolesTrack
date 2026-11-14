<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://ai.google.dev/static/site-assets/images/share-ais-513315318.png" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/8a2efc86-53ff-4af9-a932-34f018727f74

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`

## Local tuition reminder test

The Super Admin school page exposes the end-of-month reminder test only when the Web and mobile backend are running in development against the same loopback-hosted PostgreSQL database. Configure `ECOLETRACK_LOCAL_TUITION_REMINDER_TEST_ENABLED=true` in both processes and set `ECOLETRACK_LOCAL_TUITION_REMINDER_TEST_DATABASE_NAME` to the exact local `SQL_DB_NAME` in both environments; names containing `prod` or `stag` are rejected, and each server verifies the database name and loopback server address at runtime. PostgreSQL addresses with full-length host masks (`/32` for IPv4 and `/128` for IPv6) are accepted. Set `SQL_HOST` to `127.0.0.1`, `localhost` or `::1`, and `API_URL` to an HTTP loopback URL for the local mobile backend. The Web and mobile backend must use the same local-only `INTERNAL_SECRET`. Without `ECOLETRACK_LOCAL_TUITION_REMINDER_TEST_TARGETS`, the panel remains visible but sending is disabled.

Configure `ECOLETRACK_LOCAL_TUITION_REMINDER_TEST_TARGETS` as a JSON array of synthetic target tuples, for example:

```json
[{"schoolId":1,"studentId":2,"parentUserId":3,"deviceId":"42"}]
```

Each tuple must identify a dedicated test school/student, its linked test parent account, and the numeric ID of that parent’s test device in `mobile_parent_devices`. The backend independently checks the tuple, current parent/student/school authorization, push preference and exact device association before sending. The tool refuses to run if the global reminder runtime’s enablement flags are both true. Selecting a month injects a simulated 08:00 school-local clock; it does not change the operating-system clock. A run can submit a real FCM push to the single configured test device. `fcm_accepted` is not proof of device delivery or display. Do not configure real student, parent or device records as test targets.
