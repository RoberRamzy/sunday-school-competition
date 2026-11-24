# Restart checkpoint · 24 November 2026

The local implementation has advanced beyond the archived identity checkpoint. Use the current workspace. Both Sol workers finished their assigned implementation. The complete student login, quiz and publication path passed local browser verification. Hosted deployment is on hold per the user. See [verification record](test-report.md) and [implementation status](implementation-status.md).

The remaining deployment work is to connect the private repository and the free provider projects, rehearse with real phones and the expected number of students, and run the documented restore on the target environment after the user resumes hosting.

## Earlier milestone snapshot

- Supervisor: docs/api.md is the agreed contract. The project includes Docker Compose, installation and operations guides, CI configuration, synthetic browser tests in tests/, and the grade/servant administration component. Root and app npm lockfiles exist. No initialized Git repository was found.
- Backend worker: apps/api contains the Prisma identity schema and migration, initial-admin seed, NestJS auth, throttling, grade-scoped roster, Excel handout, reset, staff management and appearance endpoints.
- Frontend worker: apps/web contains the sign-in and activation forms, staff portal, bilingual layout, initial server-side appearance and session reads, and both generated WebP illustrations. Roster integration, UI review and browser verification were in progress at checkpoint time. Inspect current files and worker messages first; they can be newer than this snapshot.
- The two workers in this chat are named backend and frontend. If starting a new chat, reuse the files and retain this division of work.
- Local PostgreSQL was started successfully and Chrome was launched successfully. These infrastructure checks do **not** establish that login passed. See docs/test-report.md for recorded evidence. No competition or theme acceptance gate was marked passed.

## Resume procedure

1. Read AGENTS.md, the implementation plan, docs/api.md and the latest worker results. Confirm apps/web/app/components/roster.tsx and its imports are complete. Review migrations, auth/roster authorization, the proxy, first render and role-based navigation against the contract.
2. Load the existing root .env into your shell with `set -a; source .env; set +a`. It contains generated **local-only** bootstrap and database credentials. Preserve it on this machine and keep it private. When restoring elsewhere, follow README.md with new credentials. Use the existing Docker Compose volume and migrate forward.
3. Run `docker compose up -d --wait db`, `npm run db:migrate --prefix apps/api`, `npm run build --prefix apps/api` and `npm run db:seed --prefix apps/api`. Check port availability before starting additional servers. Start the API on 3001 and web on 3000 as documented. Reach them via http://localhost:3000.
4. Run `node --env-file=.env --test tests/login.test.mjs`. It creates a synthetic student, reads their code from an Excel handout, activates through the UI, refreshes, logs in from a new mobile-size browser with a leading-zero PIN and checks rotation, logout and code reuse. Run the API integration tests and the appearance test, fix failures, and record actual outcomes. Access to host Docker, localhost and headless Chrome may require sandbox approval.
5. Only after the browser login gate passes, assign the competition modules and student/administration screens against the next supervisor-owned contract. Follow the acceptance checklist in section 21, including concurrency, overdue finalization and save/reconnect. Keep docs/implementation-status.md and docs/test-report.md current. Leave all external deployment on hold.

The archive beside this file is a portable source snapshot. It excludes .env, database data, dependencies, build outputs and the archive itself. The editable workspace and database volume are the latest local working state.
