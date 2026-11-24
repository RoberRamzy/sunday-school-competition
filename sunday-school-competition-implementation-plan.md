# Sunday School Digital Competition

## Implementation Plan, Free Toolchain & Deployment Guide

**Document purpose:** Give this specification directly to a coding agent
(Cursor, Claude Code, Codex, etc.) and ask it to implement the complete
application.

**Project:** A web-based Sunday School competition for three
middle-school grades, with known student rosters, remote participation,
flexible start times, and one attempt per student per competition.

**Cost target:** Build and initially deploy using free tools and free
hosting tiers. Free-tier limits and terms can change; verify them before
the competition. A free deployment is suitable for development, testing,
and a small pilot, but must not be assumed to provide production-grade
uptime, backups, or support.

------------------------------------------------------------------------

# 1. Product Requirements

Build a responsive web application for managing and running digital
Sunday School competitions.

The platform has three interfaces:

1.  **Student application:** Account activation, login, available
    competitions, quiz taking, resume, and results.
2.  **Servant dashboard:** View and monitor students in assigned grades,
    participation, results, and recovery requests.
3.  **Super-admin dashboard:** Manage grades, students, servants,
    questions, competitions, attempts, results, and audit records.

## Core requirements

-   Exactly three predefined grades initially; design the data model so
    more can be added later.
-   Students are imported from a known roster. Students cannot
    self-register arbitrary identities.
-   Every student receives an individual, single-use activation code
    from their servant.
-   No student email address or phone number is required.
-   Students set a six-digit PIN after activation and use it for
    subsequent login after selecting their grade and name.
-   Students participate remotely from home using phones, tablets, or
    computers.
-   Competitions have an opening and closing date/time.
-   Students may start at any time during the competition window.
-   Each student may have one attempt per competition.
-   A started attempt can be resumed after refresh, browser closure, or
    network interruption, provided its deadline has not passed.
-   The backend controls identity, eligibility, quiz generation, time,
    answer persistence, scoring, and attempt finalization.
-   Question types: multiple choice (MCQ) and sorting/ordering.
-   Every student in the same competition and grade receives the same fixed
    set of questions and point values, with question order shuffled per attempt.
-   Results are hidden until the competition closes and an administrator
    publishes them, by default.
-   Support Arabic and English UI text, including RTL layout.
-   Make the application accessible and easy for middle-school students
    to use.

# 2. Recommended Free Toolchain

Use the following tools unless a concrete technical reason requires a
change. Do not introduce paid services or require a credit card without
first documenting the reason and asking for approval.

  -------------------------------------------------------------------------
  Purpose                 Recommended tool        Cost / notes
  ----------------------- ----------------------- -------------------------
  Code editor             Visual Studio Code      Free

  Coding agent            User's available agent  Agent usage may have
                          (Cursor, Claude Code,   separate limits/costs
                          Codex, etc.)            

  Source control          Git + GitHub Free       Free private repository

  Frontend                Next.js + TypeScript    Open source

  UI styling              Tailwind CSS            Open source

  Backend                 NestJS + TypeScript     Open source

  Database                PostgreSQL              Open source

  Database hosting        Neon Free               Free tier; check quotas
                                                  and scale-to-zero
                                                  behavior

  ORM and migrations      Prisma ORM              Free open-source core

  API documentation       NestJS Swagger /        Free
                          OpenAPI                 

  API testing             Bruno                   Free, open source

  Unit/E2E testing        Vitest or Jest +        Free, open source
                          Playwright              

  CI                      GitHub Actions          Free allowance for public
                                                  repositories; private
                                                  repositories have
                                                  included quotas

  Frontend hosting        Vercel Hobby            Free for eligible
                                                  personal/non-commercial
                                                  use; check current terms

  Backend hosting         Render Free Web Service Free but sleeps after
                                                  inactivity; cold starts;
                                                  not production-grade

  Domain                  Provider subdomains     Free; a custom domain
                                                  generally costs money

  Error logging           Structured application  Check current free quotas
                          logs; optional Sentry   and privacy terms
                          Developer plan          

  Spreadsheet             SheetJS Community       Use a maintained package
  import/export           Edition or ExcelJS      and verify its license

  Local development       Node.js LTS + pnpm      Free
  -------------------------------------------------------------------------

## 2.1 Hosting recommendation

Initial zero-cost deployment:

-   **Next.js frontend:** Vercel Hobby.
-   **NestJS API:** Render Free Web Service.
-   **PostgreSQL:** Neon Free.
-   **Repository and CI:** GitHub Free / GitHub Actions.
-   **Public URLs:** Students open the frontend provider subdomain. The browser
    sends all API requests to relative `/api/*` URLs on that origin. Configure a
    Vercel external rewrite to forward those paths to the NestJS service on Render.
    Use the same browser-facing paths in local development.

Useful official pages:

-   GitHub: https://github.com/
-   GitHub Actions: https://github.com/features/actions
-   Visual Studio Code: https://code.visualstudio.com/
-   Next.js: https://nextjs.org/
-   NestJS: https://nestjs.com/
-   PostgreSQL: https://www.postgresql.org/
-   Prisma: https://www.prisma.io/
-   Neon pricing: https://neon.com/pricing
-   Neon free-plan limits: https://neon.com/docs/introduction/pro-plan
-   Vercel Hobby: https://vercel.com/docs/plans/hobby
-   Vercel pricing: https://vercel.com/pricing
-   Render free deployment limitations: https://render.com/docs/free
-   Tailwind CSS: https://tailwindcss.com/
-   Playwright: https://playwright.dev/
-   Bruno: https://www.usebruno.com/

**Important hosting caveats:**

-   Render Free Web Services spin down after inactivity and may take
    around a minute to wake up. This is unacceptable during a live
    competition unless the service is upgraded or another suitable
    always-on host is chosen. Do not use uptime pings to bypass a
    provider's free-tier restrictions.
-   Render's free PostgreSQL database has a short lifetime and no
    backups; do not use it as the persistent competition database.
-   Neon Free databases can scale to zero and have quotas. Test
    cold-start behavior, connection pooling, concurrent connections, and
    database availability.
-   Supabase Free is a reasonable alternative PostgreSQL host, but free
    projects can pause after inactivity and have no automatic backups on
    the free tier. Compare current limits before choosing.
-   Vercel Hobby has eligibility and usage restrictions. Confirm that
    the intended church/non-commercial use complies with its current
    terms.
-   Free hosting tiers do not provide a production uptime guarantee or
    guaranteed support. Before a real competition, test the exact
    deployment under realistic concurrent load and arrange a
    backup/export plan.
-   Never promise that the entire service will remain free forever.
    Providers can change quotas and terms.

If Render cold starts are unacceptable, investigate a currently
available free alternative for the NestJS service, or use a small paid
always-on service only after explicit approval. Keep the deployment
architecture portable so hosting can be changed without rewriting
business logic.

## 2.2 Keep the architecture portable

-   Use standard PostgreSQL, not proprietary database features.
-   Keep secrets in environment variables.
-   Use a `DATABASE_URL` environment variable.
-   Do not store uploaded files on ephemeral server filesystems.
-   Do not make application correctness depend on a specific hosting
    provider.
-   Include deployment instructions for local Docker Compose and the
    selected cloud providers.

# 3. Architecture and Repository Structure

Use a modular monolith. Do not use microservices, Kubernetes, Redis, or
complex infrastructure for the initial expected scale.

``` text
sunday-school-competition/
├── apps/
│   ├── web/                  # Next.js student and admin interfaces
│   └── api/                  # NestJS backend
├── packages/
│   └── shared/               # Shared types and schemas
├── prisma/
│   ├── schema.prisma
│   ├── migrations/
│   └── seed.ts
├── docs/
│   ├── architecture.md
│   ├── deployment.md
│   ├── api.md
│   └── operations.md
├── docker-compose.yml
├── .env.example
├── pnpm-workspace.yaml
└── README.md
```

Recommended backend modules:

-   AuthModule
-   StudentsModule
-   GradesModule
-   ServantsModule
-   QuestionsModule
-   CompetitionsModule
-   AttemptsModule
-   ScoringModule
-   ResultsModule
-   AuditModule
-   AdminModule

Use REST APIs and OpenAPI/Swagger documentation.

# 4. Roles and Permissions

Implement backend-enforced role-based access control.

## 4.1 Student

A student can:

-   Activate their account with their unique activation code.
-   Set and use a PIN.
-   View competitions available to their grade.
-   Start an eligible competition.
-   Resume their existing attempt.
-   Answer MCQ and sorting questions.
-   Submit their attempt.
-   View results only when published.

A student cannot:

-   Change their identity or grade.
-   View another student's records or attempt.
-   Start a second attempt in the same competition.
-   Access correct answers or answer keys.
-   Change a locked or submitted answer.
-   Access admin endpoints.

## 4.2 Grade Servant

A servant is assigned to one or more grades and can:

-   View students in assigned grades only.
-   Add, edit, suspend, import, and permanently delete students in assigned grades.
    A transfer requires access to both grades.
-   View activation status.
-   Create and edit competition drafts, publish results, and activate, close,
    archive, or permanently delete competitions when assigned every eligible grade.
-   Share direct links to activated competitions they can access.
-   Preview and control publication of the site-wide across-competition leaderboard.
-   Monitor participation and completion.
-   Review results when permitted.
-   Flag suspicious activity.
-   Assist with account recovery according to permissions.

A servant cannot:

-   Access unassigned grades.
-   Manage staff accounts, grade definitions, site appearance, or individual
    competition leaderboard settings.
-   Silently delete or reset attempts.

## 4.3 Super Admin

Can:

-   Manage grades, students, and servants.
-   Import student lists.
-   Assign servants to grades.
-   Generate/reset activation credentials.
-   Manage questions and question banks.
-   Create and configure competitions.
-   Monitor attempts and audit records.
-   Publish results.
-   Export results.
-   Authorize an exceptional replacement attempt with a mandatory
    reason.

# 5. Authentication and Student Identity

## 5.1 Student roster

Each student record must include:

-   UUID primary key.
-   Full name.
-   Grade ID.
-   Activation code hash, initially empty, for verifying the issued one-time password.
-   Activation code used timestamp, recorded when the student activates.
-   PIN hash, recorded when the student sets their six-digit login PIN.
-   Status: `PENDING_ACTIVATION`, `ACTIVE`, or `SUSPENDED`.
-   Created and updated timestamps.

## 5.2 Activation

1.  The admin imports the roster. For duplicate names within a grade, the
    admin sets distinct, student-recognizable display labels before enabling
    login (for example, a class or group alongside the name).
2.  An assigned servant or super admin selects pending students in one grade
    and requests the Excel handout. At export time, generate a unique random
    one-time activation password for each selected student. In one transaction,
    store the new hashes, invalidate the previous codes, and audit the issuer
    and recipients. Recheck grade access and pending status in that transaction.
3.  Return the XLSX workbook directly with caching disabled. Include a row per
    student with columns **Name** (the roster display label) and **One-time
    password**. Store both cells as text. The workbook contains only the newly
    issued activation credentials. Each student chooses their own PIN later.
4.  The servant privately gives each student their own row. If the download
    fails or is lost, the servant explicitly reissues the affected pending
    students' passwords. The server retains only the hashes.
5.  The student selects their grade and name, enters the one-time password,
    and chooses a six-digit PIN. Verify the selected record, pending status,
    and activation credential together. Atomically consume the code, record
    the used timestamp, store the PIN hash, and create the session.

For each later login, the student selects their grade, selects their name,
and enters only their six-digit PIN. The selected name carries an internal
student ID. Verify the ID belongs to the selected grade, the account is active,
and its PIN matches before issuing the session. Preserve leading zeros in
PINs. Different students may choose the same PIN. The pre-login picker exposes
only grade choices and the display labels and selection IDs needed for that
grade. Rate-limit both lookup and sign-in and use a generic sign-in failure.

Requirements:

-   Activation code is single-use.
-   Activation code is generated with a cryptographically secure random
    generator.
-   Rate-limit activation attempts.
-   Avoid account enumeration in error messages.
-   Use Argon2id or another appropriate password hashing algorithm for
    PINs.
-   Because six-digit PINs have a small search space, add strict
    throttling, temporary lockouts, and a servant-assisted reset
    process.
-   Never store PINs or raw activation codes in logs.

## 5.3 Sessions

Use opaque, random session tokens stored as hashes in the database. Set
the raw token in a cookie with:

-   `HttpOnly`
-   `Secure` in production
-   `SameSite=Lax` or stricter where compatible
-   Host-only cookie (omit `Domain`) with `Path=/` and appropriate expiration

Forward cookies and Set-Cookie through the same-origin API proxy. Disable
shared caching of authentication and personalized responses. Keep CSRF
checks tied to the public frontend origin. Implement logout, expiration, and revocation.

Allow one active student session by default. If a new device logs in,
revoke the old session and show a clear notice. Do not permanently bind
a student to a device; device changes and lost browser data must be
recoverable through the servant.

Protect cookie-authenticated state-changing endpoints against CSRF. Use
appropriate CORS allowlists.

# 6. Competition Configuration and Lifecycle

A competition contains:

-   Title and description.
-   Instructions.
-   Eligible grades.
-   Opening timestamp.
-   Closing timestamp.
-   Duration in minutes.
-   Question blueprint per grade.
-   Scoring configuration.
-   Result visibility settings.
-   Status: `DRAFT`, `SCHEDULED`, `ACTIVE`, `CLOSED`, or `ARCHIVED`.

All timestamps are stored in UTC and displayed in the user's local
timezone.

## 6.1 Flexible start

Students may start at any time during the competition window.

The effective deadline is:

``` text
effective_deadline = MIN(
  started_at + duration_minutes,
  competition.closes_at
)
```

The backend calculates and stores `started_at` and `expires_at`. The
frontend only displays the remaining time.

## 6.2 One attempt per student

Enforce one attempt per student per competition with:

-   Backend eligibility validation.
-   A partial unique index covering every status except `INVALIDATED` (section 14).
-   A transaction or equivalent atomic operation when starting.
-   Idempotent start behavior: repeated requests return the existing
    attempt. For an authorized replacement awaiting start, start that same row
    atomically on student confirmation within the competition window.

A refresh or network retry must never create a second attempt.

A started attempt must be resumable until its deadline. A network
interruption must not consume another attempt.

## 6.3 Attempt statuses

Use explicit statuses such as:

-   `AWAITING_START` (authorized replacement awaiting student confirmation)
-   `IN_PROGRESS`
-   `SUBMITTED`
-   `TIMED_OUT`
-   `INVALIDATED` (only through authorized exceptional recovery)

Record status changes and actor/reason in the audit log.

# 7. Question Bank

Questions belong to a grade and contain:

-   UUID.
-   Grade ID.
-   Type: `MCQ` or `SORTING`.
-   Difficulty: `EASY`, `MEDIUM`, `HARD`.
-   Question text.
-   Optional explanation.
-   Points.
-   Optional image reference.
-   Tags/learning objectives.
-   Active/archived status.
-   Created/updated timestamps.

## 7.1 MCQ

Each MCQ has two or more options, each with a stable ID and content.
Correctness is stored only on the server.

-   Randomize option order per attempt.
-   Store the option order in the attempt snapshot.
-   Do not return `is_correct` or the answer key to student APIs.
-   Validate that submitted option IDs belong to the question.

## 7.2 Sorting

Each sorting question has stable item IDs, item content, and the correct
sequence.

-   Randomize initial item order per attempt.
-   Support drag-and-drop and accessible move-up/move-down controls.
-   Submit item IDs, not trusted display text.
-   Validate that each expected item appears exactly once.
-   Default scoring is partial positional scoring.
-   Allow exact-order scoring as an optional per-question configuration.

For partial positional scoring:

``` text
earned_points =
question_points * correctly_positioned_items / total_items
```

Use decimal-safe arithmetic and document rounding.

# 8. Quiz Blueprint and Randomization

The super admin chooses one set of questions per competition and grade.
The blueprint defines the required counts by question type and difficulty.

Example only:

``` text
Grade 1:
20 total questions
6 easy
10 medium
4 hard
14 MCQ
6 sorting
```

While the competition is in draft, the admin selects distinct active questions
from each eligible grade’s bank. Before scheduling or activating, validate that
the selection matches every configured count. Show any missing or excess
questions by category. Freeze the validated set, content, options, answer
keys, points, and scoring rules before students can start.

Every original and replacement attempt for that grade uses the full frozen set.
On start, shuffle the question order on the server using a cryptographically
secure random generator. Also shuffle the MCQ options and initial sorting
items as specified in section 7. Persist all display orders once per attempt
so refresh and reconnect restore exactly what the student saw.

# 9. Student Experience

## 9.1 Dashboard

Show:

-   Student name and grade.
-   Available competitions.
-   Competition status and availability window.
-   Start/Continue action.
-   Completed competitions.
-   Results when published.

## 9.2 Before start

Show title, instructions, number of questions, duration, deadline, and a
clear one-attempt warning. Require explicit confirmation.

## 9.3 During quiz

Show one question at a time:

-   Question number and progress.
-   Question text.
-   Answer controls.
-   Remaining time.
-   Save/connection status.
-   Next action.
-   Final submit action.

Default navigation policy: once the student moves forward, the previous
answer becomes locked and the student cannot return to edit it. Make
this behavior clear before the attempt starts.

For sorting, provide touch, keyboard, and accessible alternatives to
drag-and-drop.

Do not show correctness feedback, explanations, or correct answers
during the competition.

## 9.4 Timer and timeout

The backend is authoritative.

``` text
remaining_seconds = expires_at - server_current_time
```

Validate attempt status and expiration on every answer write and submit
request.

At or after the stored deadline, the server rejects further answer changes
and submissions. Before returning an attempt, dashboard, or monitoring count,
or ranking, publishing, or exporting results, finalize every overdue
`IN_PROGRESS` attempt in the requested scope. This also applies when a
student retries Start or resumes. The first relevant request after downtime
performs the same check.

Serialize answer saves, submissions and timeout finalization on the attempt
row. Check server time after acquiring the lock. In one transaction, score
the saved answers, award zero for unanswered questions, mark the attempt
`TIMED_OUT`, and record `expiresAt` as its effective finish time for ranking.
Record the actual processing time in the audit log. Repeated requests must
return the same final score and produce only one finalization event.

Do not trust client time, client timer values, or client-submitted
scores.

# 10. Persistence and Reconnection

Internet interruption must not unfairly destroy an attempt.

-   Save every answer to the backend promptly.
-   Use idempotent answer writes or versioned updates.
-   Show whether an answer is confirmed saved.
-   On network failure, retain the pending answer locally temporarily
    and retry safely.
-   Before progressing when necessary, ensure the previous answer is
    acknowledged by the server.
-   On reconnect, fetch the authoritative attempt state, remaining time,
    and saved answers.
-   Never reset the timer.
-   Never create a new attempt for a reconnecting student.

The server database is the source of truth. Local storage may be used
only as a temporary retry buffer, not as the authoritative answer
record.

# 11. Anti-Cheating and AI-Resistance

It is impossible for an ordinary website to guarantee that a student is
not using ChatGPT or another device. Do not implement or market an AI
detector as proof of cheating.

The objective is to reduce the usefulness of external help, discourage
answer sharing, and provide fair review signals.

## 11.1 Question design

Prioritize:

-   Lesson comprehension.
-   Biblical scenarios.
-   Interpretation and application.
-   Chronological ordering.
-   Identifying incorrect statements.
-   Questions based on details taught in class.
-   Multiple variants testing the same learning objective.

Do not rely exclusively on simple fact-recall questions that can be
answered instantly by a search engine or AI.

## 11.2 Competition controls

Implement:

-   Randomized question order.
-   Randomized MCQ option order.
-   Randomized sorting item order.
-   One question per screen.
-   No answer feedback before the competition closes.
-   No public leaderboard before results are published.
-   Server-controlled total timer.
-   No pause/resume of the timer; reconnecting continues the same timer.

Use reasonable time limits. Do not disadvantage students who read more
slowly or use smaller devices.

## 11.3 Browser activity signals

Optionally record:

-   `visibilitychange` events (tab hidden/visible).
-   Window focus loss.
-   Repeated reconnects.
-   Session conflicts.
-   Extremely fast completion or answer patterns.

These are weak signals, not proof. Do not automatically disqualify a
student based on tab switching, IP changes, or a single unusual event.
Mobile browsers and notifications can create false positives.

Do not use webcam, microphone, invasive screen recording, or device
fingerprinting. Copy/paste restrictions and disabled text selection are
optional deterrents only; they are not security controls.

## 11.4 Audit review

Servants/admins may review suspicious indicators and flag an attempt.
Only authorized admins can decide whether to take action. Record the
reason and all actions.

# 12. Scoring and Results

All scoring occurs on the backend using the stored question and scoring
snapshots.

Store:

-   Total possible score.
-   Earned score.
-   Percentage.
-   Correct/incorrect/unanswered counts.
-   Started/submitted timestamps.
-   Attempt status.

Default ranking:

1.  Highest score.
2.  Fastest completion time as tie-breaker.
3.  If still tied, declare a tie.

Make the tie policy configurable.

Results are hidden until competition closure and admin publication by
default.

# 13. Dashboards

## 13.1 Super-admin dashboard

Overview:

-   Total students and grade distribution.
-   Active competitions.
-   Not started / in progress / completed / timed out counts.
-   Participation rate.
-   Results summary.

Student management:

-   Create/edit/suspend students.
-   Import Excel/CSV.
-   Preview and validate import before saving.
-   Detect duplicates and invalid grades.
-   Generate activation codes.
-   Reset PINs.
-   View participation history.

Servant management:

-   Create/edit/suspend servants.
-   Assign grades.
-   Manage permissions.

Question management:

-   Create/edit/archive questions.
-   Filter by grade, type, difficulty, and tag.
-   Preview questions.
-   Validate answer keys.
-   Prevent destructive deletion of questions referenced by attempts.

Competition management:

-   Create/edit/schedule/activate/close/archive.
-   Configure eligible grades, window, duration, blueprint, and scoring.
-   Select and preview each grade’s fixed question set, counts, and maximum score.

Monitoring and results:

-   View participation states.
-   Review audit signals.
-   View individual and grade results.
-   Publish results.
-   Export CSV/XLSX.

## 13.2 Servant dashboard

-   Assigned grades only.
-   Student list and activation status.
-   Participation and completion.
-   Results when published.
-   Account recovery assistance.
-   Flag suspicious activity.

Every backend query must enforce grade scope. Frontend filtering is not
authorization.

# 14. Database Model

Use PostgreSQL and Prisma. Use UUIDs for externally referenced records.

Core entities:

-   `Grade`
-   `Student`
-   `AdminUser` (super admin and servant accounts)
-   `ServantGrade`
-   `StudentSession`
-   `Competition`
-   `CompetitionGrade`
-   `CompetitionBlueprint`
-   `CompetitionQuestion`
-   `Question`
-   `QuestionOption`
-   `SortingItem`
-   `Attempt`
-   `AttemptQuestion`
-   `AttemptAnswer`
-   `AuditLog`

Suggested important fields:

### Grade

`id`, `name`, `createdAt`, `updatedAt`

### Student

`id`, `gradeId`, `fullName`, `displayLabel` (unique within grade), `activationCodeHash`,
`activationCodeUsedAt`, `pinHash`, `status`, `createdAt`, `updatedAt`

### AdminUser

`id`, `fullName`, `username`, `passwordHash`, `role`, `status`,
`createdAt`, `updatedAt`

### ServantGrade

`id`, `servantId`, `gradeId`; unique `(servantId, gradeId)`

### StudentSession

`id`, `studentId`, `tokenHash`, `expiresAt`, `revokedAt`, `createdAt`

### Competition

`id`, `title`, `description`, `instructions`, `opensAt`, `closesAt`,
`durationMinutes`, `status`, `resultsPublishedAt`, `createdAt`,
`updatedAt`

### CompetitionGrade

`id`, `competitionId`, `gradeId`; unique pair

### CompetitionBlueprint

`id`, `competitionId`, `gradeId`, `questionType`, `difficulty`,
`questionCount`

### CompetitionQuestion

`competitionGradeId`, `questionId`, `questionSnapshot`, unique per pair.
Store the approved content and scoring data in the snapshot when freezing the set.

### Question

`id`, `gradeId`, `type`, `difficulty`, `content`, `explanation`,
`points`, `status`, `createdAt`, `updatedAt`

### QuestionOption

`id`, `questionId`, `content`, `isCorrect`, `position`

### SortingItem

`id`, `questionId`, `content`, `correctPosition`

### Attempt

`id`, `competitionId`, `studentId`, `startedAt`, `expiresAt`,
`submittedAt`, `finishedAt` (submission time or timeout deadline), `status`, `totalScore`, `maxScore`, `createdAt`,
`updatedAt`

Create a PostgreSQL partial unique index on `(competitionId, studentId)`
where `status <> 'INVALIDATED'` in the migration. Include submitted,
timed-out and awaiting-start rows in the index. Add a nullable, unique
`replacesAttemptId` foreign key to the original attempt. For a replacement
awaiting start, leave `startedAt` and `expiresAt` empty until the student
confirms start. Use the usual competition closing time as the upper bound.
Exclude invalidated rows from rankings and participation counts. Count an
awaiting-start replacement as not started.

### AttemptQuestion

`id`, `attemptId`, `questionId`, `position`, `optionsOrder`,
`initialSortingOrder`, `pointsSnapshot`, `questionSnapshot`

### AttemptAnswer

`id`, `attemptQuestionId`, `answerJson`, `isCorrect`, `earnedPoints`,
`submittedAt`, `lockedAt`

### AuditLog

`id`, `actorType`, `actorId`, `eventType`, `metadataJson`, `createdAt`

Add indexes for common lookups: grade/student, competition/status,
attempt/student, attempt/competition, and audit event/time.

Preserve question text, options, correct answer snapshot, points, and
scoring rules for historical attempts. Editing a question later must not
change the grading of an existing attempt.

Use soft deletion or archiving where historical records reference an
entity.

# 15. REST API

Document all endpoints with OpenAPI/Swagger.

Authentication:

``` http
GET  /api/auth/grades
GET  /api/auth/grades/:gradeId/students
POST /api/auth/activate
POST /api/auth/login
POST /api/auth/logout
GET  /api/auth/me
```

Student:

``` http
GET /api/student/dashboard
GET /api/student/competitions
GET /api/student/competitions/:id
GET /api/student/attempts/:id
```

Attempt:

``` http
POST /api/competitions/:id/start
POST /api/attempts/:id/answers
POST /api/attempts/:id/submit
GET  /api/attempts/:id/status
```

Admin students:

``` http
GET    /api/admin/students
POST   /api/admin/students
POST   /api/admin/students/import
PATCH  /api/admin/students/:id
POST   /api/admin/students/:id/reset-pin
POST   /api/admin/grades/:gradeId/activation-handout   # selected student IDs, returns XLSX
```

Admin servants:

``` http
GET    /api/admin/servants
POST   /api/admin/servants
PATCH  /api/admin/servants/:id
```

Admin questions:

``` http
GET    /api/admin/questions
POST   /api/admin/questions
PATCH  /api/admin/questions/:id
DELETE /api/admin/questions/:id
```

Admin competitions:

``` http
GET  /api/admin/competitions
POST /api/admin/competitions
GET  /api/admin/competitions/:id
PATCH /api/admin/competitions/:id
POST /api/admin/competitions/:id/activate
POST /api/admin/competitions/:id/close
GET  /api/admin/competitions/:id/results
GET  /api/admin/competitions/:id/monitoring
```

Admin attempts:

``` http
GET  /api/admin/attempts/:id
POST /api/admin/attempts/:id/authorize-replacement
```

All endpoints require authentication/authorization as appropriate, DTO
validation, safe error handling, and ownership checks. A student must
never access another student's attempt by changing an ID.

# 16. Security Requirements

Implement and test:

-   HTTPS in production.
-   Secure HttpOnly session cookies.
-   CSRF protection for cookie-authenticated mutations.
-   Strict CORS allowlist.
-   Argon2id hashing for PINs/passwords.
-   Hashed random session tokens.
-   Rate limiting and lockouts.
-   Backend authorization on every protected route.
-   Grade-level access enforcement.
-   Database constraints and transactions.
-   Input validation and output sanitization.
-   Protection against IDOR.
-   Protection against duplicate attempts and race conditions.
-   Protection against answer replay/duplicate writes.
-   No correct-answer leakage.
-   No client-side scoring or authoritative timer.
-   Secret management through environment variables.
-   Audit logs without raw credentials or PINs.
-   Database export/backup and restore instructions.

Do not store credentials or authoritative quiz answers in
localStorage/sessionStorage. Do not log activation codes, PINs, session
tokens, or correct answers in student-facing logs.

# 17. Recovery and Exceptional Cases

PIN recovery:

1.  Student contacts their servant.
2.  Servant verifies identity using the church's established process.
3.  Authorized servant/admin initiates reset.
4.  Student receives a temporary recovery credential or a new activation
    code.
5.  Student sets a new PIN.

Attempt replacement:

1.  Student contacts servant.
2.  Servant flags the issue.
3.  Super admin reviews it.
4.  While the competition window is open, the super admin supplies a reason.
    In one transaction, lock the original attempt, invalidate it, create one
    linked replacement in `AWAITING_START`, and audit both IDs, actor, time,
    and reason. Retain the original answers and score for audit.
5.  Repeated authorization for the same original returns its existing
    replacement. A replacement cannot itself receive another replacement.
    The student starts the replacement through the usual Start action.

Never allow students to delete or reset their own attempts.

# 18. UI and Accessibility

-   Mobile-first responsive design.
-   Arabic RTL and English LTR support.
-   Large touch targets.
-   Clear typography and contrast.
-   Accessible form labels and keyboard navigation.
-   Sorting controls usable without drag-and-drop.
-   Clear timer and saved-answer status.
-   Friendly connection/error messages.
-   Loading and empty states.
-   Confirmation before starting and final submission.
-   No distracting animations during a quiz.

# 19. Testing

Automated tests are mandatory.

## Authentication

-   Valid and invalid activation.
-   Activation code reuse.
-   PIN verification.
-   PIN brute-force throttling.
-   Session expiration and revocation.
-   Session replacement.
-   Role and grade authorization.

-   Students sharing a name and PIN can select their distinct labels and reach
    their own accounts. Verify leading-zero PINs, mismatched grades and suspension.
-   Read the exported XLSX and verify names and one-time passwords match the
    selected pending students. Verify reissue revokes the previous codes, active
    accounts and out-of-grade requests are rejected, and concurrent activation
    consumes a code once.
-   On deployed provider domains, activate, sign in, refresh, save an answer
    and log out through the frontend URL. Verify authenticated responses stay
    private and cross-origin mutations fail CSRF checks.

## Competition

-   Concurrent replacement authorizations produce one linked row and one audit
    event. An interrupted transaction leaves the original intact. Concurrent
    student starts set the replacement timer once. Only the replacement counts.
-   Cannot start before opening or after closing.
-   Cannot start if grade is ineligible.
-   One attempt only.
-   Concurrent start requests create one attempt.
-   Refresh and reconnect resume the same attempt.
-   Timer never resets.
-   Competition close time takes precedence over personal duration.

## Quiz and scoring

-   All students and replacements in a grade receive identical question IDs
    and point values, including after a bank edit. Reject a draft selection
    that fails the blueprint. Exercise shuffling with controlled draws.
-   Randomized order is persisted.
-   Option order is persisted.
-   Correct answers are absent from student APIs.
-   MCQ scoring.
-   Sorting partial and exact scoring.
-   Invalid answer IDs rejected.
-   Locked answers cannot be changed.
-   Disconnect with saved and unanswered questions, advance past the deadline,
    then make monitoring, publication or export the first request. Verify
    the saved score, timeout count, and deadline-based finish time in each case.
-   Race an answer save, submission and repeated reads at expiry. Verify late
    writes are rejected and exactly one finalization is recorded.
-   Historical attempt scoring unaffected by later question edits.

## Authorization

-   Student cannot read another student's attempt.
-   Servant cannot access unassigned grades.
-   Super admin can access all grades.
-   Admin actions are audited.

## End-to-end

Test Android and iOS mobile browsers, desktop browsers, refresh, slow
networks, disconnect/reconnect, simultaneous requests, and realistic
concurrent student usage.

# 20. Deployment and Operations

The agent must deliver:

-   Docker Compose for local PostgreSQL development.
-   Prisma migrations and seed script.
-   Initial super-admin creation procedure.
-   `.env.example` with placeholders only.
-   Production build scripts.
-   Health-check endpoint.
-   Structured logs.
-   Database backup/export instructions.
-   Restore procedure.
-   Deployment guide for Vercel, Render, and Neon.
-   OpenAPI documentation.
-   README with exact local setup and deployment steps.

Before a real competition:

1.  Verify current free-tier quotas and terms.
2.  Confirm the API does not sleep during the competition, or accept and
    test the cold-start impact.
3.  Run a load test approximating the expected number of students
    starting and answering at the same time.
4.  Test database connection limits and pooling.
5.  Export a database backup and verify that it can be restored.
6.  Test all critical flows on real phones.
7.  Freeze question and competition configuration before opening.
8.  Have a documented manual contingency if the hosting provider becomes
    unavailable.

Do not rely on a free provider's database as the only copy of
competition data.

# 21. Acceptance Criteria

The implementation is complete only when:

1.  Admin can create and manage three grades.
2.  Admin can import known student rosters.
3.  Every student receives an individual single-use activation code.
4.  Students can activate and log in without email or phone.
5.  Servants are restricted to assigned grades.
6.  Admin can create multiple competitions.
7.  Competition windows and durations work correctly.
8.  Students can start at different times.
9.  Database and backend enforce one non-invalidated attempt per student
    per competition, including after an approved replacement.
10. Each grade receives its fixed quiz with a shuffled, persisted display order.
11. MCQ and sorting questions work.
12. Sorting partial scoring works.
13. Backend controls all timing and scoring.
14. Answers persist and attempts resume after disconnection.
15. Expired attempts are graded before their status or results are reported,
    even when the student never returns.
16. Correct answers are never exposed to student APIs.
17. Admin can monitor participation and review audit signals.
18. Results can be published and exported.
19. Recovery and replacement-attempt workflows are audited.
20. Arabic RTL and English LTR layouts work.
21. Critical automated tests pass.
22. Deployment and restore instructions are complete.

# 22. Instructions to the Coding Agent

Implement the complete working application, not just a prototype, mock
UI, or architecture proposal.

Work in phases, but keep the repository runnable after each phase.

Recommended order:

1.  Inspect requirements and produce a concise implementation plan and
    architecture decisions.
2.  Create monorepo, tooling, linting, formatting, and CI.
3.  Create database schema, migrations, seed data, and local Docker
    Compose.
4.  Implement authentication, roles, and grade-scoped authorization.
5.  Implement student and servant management.
6.  Implement question bank and validation.
7.  Implement competition scheduling, blueprint validation, and attempt
    lifecycle.
8.  Implement fixed grade quizzes with per-attempt shuffling and student quiz UI.
9.  Implement persistence, reconnection, timeout, and scoring.
10. Implement admin dashboards, monitoring, results, and exports.
11. Implement audit and recovery workflows.
12. Add automated tests, security review, and deployment configuration.
13. Deploy a test instance using the free toolchain and document every
    required environment variable and manual setup step.

Agent rules:

-   Do not silently remove requirements.
-   Do not replace real backend behavior with mock data.
-   Do not leave security-critical TODOs.
-   Do not expose answer keys.
-   Do not trust client identity, time, score, grade, or attempt status.
-   Use strict TypeScript and modular code.
-   Use migrations for schema changes.
-   Add tests for every security-critical rule.
-   Explain any requirement that cannot be implemented exactly.
-   If a provider's free tier is unsuitable, explain the limitation and
    propose a free alternative before changing the architecture.
-   Do not incur paid services, add paid domains, or enable billable
    usage without explicit approval.
-   Keep a `docs/implementation-status.md` checklist updated as work
    progresses.
-   Finish with a clear local setup guide, deployment guide, test
    report, and list of any remaining limitations.

**Final objective:** Deliver a secure, maintainable, responsive digital
competition platform for three Sunday School grades, with reliable
identity verification, fair randomized quizzes, one-attempt enforcement,
server-authoritative timing and scoring, and practical anti-cheating
measures --- using free development and deployment tools wherever their
limitations permit.
