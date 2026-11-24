# Sunday School Competition

A bilingual student and staff portal for three middle-school grades. Classic is the default appearance. A super admin can select Christmas in Bethlehem from the staff dashboard.

## Local development

Use Node.js 24.12 or newer, npm, Docker and Docker Compose. Run the following from the repository root. Copy the example environment and set a new PostgreSQL password, matching DATABASE_URL, and an administrator password of at least 12 characters.

```bash
cp .env.example .env
# Edit .env with your local credentials.
set -a
source .env
set +a
docker compose up -d --wait db
npm ci
npm run setup
npm run db:migrate --prefix apps/api
npm run build --prefix apps/api
npm run db:seed --prefix apps/api
npm start --prefix apps/api
```

In a second terminal, run `npm run dev --prefix apps/web`. Visit http://localhost:3000 for students or http://localhost:3000/staff for staff. Use the same hostname as PUBLIC_ORIGIN. For production builds, set API_URL to the backend origin before building the frontend.

## First student login

1. Sign in as the configured admin on the staff page and add or import the student. Supply a distinct display label if two students share a name in the grade.
2. Select pending students from one grade and export their Excel handout. Privately give each student their own one-time password.
3. On the student page select **First time?**, choose grade and name, enter the issued password, and choose a six-digit PIN. Later sign-ins need only grade, name and PIN.

## Verification

Run browser tests against a dedicated local database with the seeded administrator, API and web running. These tests create roster records. Set TEST_ADMIN_PASSWORD and optionally TEST_ADMIN_USERNAME; install Chromium with `npx playwright install chromium` or set CHROMIUM_PATH to an installed executable. Run `npm run test:browser`. Run `npm run build` for the production builds.

The browser suite expects a freshly seeded disposable database. Repeated runs against the same database can reach the real login throttle.

See the [shared API contract](docs/api.md), [deployment guide](docs/deployment.md), [operations guide](docs/operations.md), and [verification record](docs/test-report.md).
