# Architecture and identity decisions

Next.js renders public appearance and language on each page request, with a same-origin /api rewrite to the NestJS API. NestJS is the authority for identity, authorization, time, grading and result publication. PostgreSQL is the transactional store. See api.md for wire shapes.

## Identity and recovery

The public roster identifies which account to verify. A grade/name selection carries a student UUID; the server matches it to the submitted grade. The one-time handout credential proves first-time identity. Its digest is stored against the pending student. The PIN stays a six-character string, including leading zeros. Credentials are independent of display names, so a name change preserves the student's account and records.

A conditional write consumes the activation credential exactly once. That transaction also creates a new PIN hash, records the activation timestamp, and issues the first opaque session. Each login rotates sessions under an account row lock; the database only stores hashes of session tokens. Staff recovery revokes the existing PIN and sessions and returns the account to the pending state for a newly issued handout.

The same-origin browser API proxy supports host-only cookies. Mutations check the public origin. Grade authorization is determined by the staff principal and its active grade assignments at the backend. Public grade lookup reveals only the minimal labels required for grade/name login. Rate limits also apply to the selected account across devices.

## Attempts

Within a competition and grade, the admin freezes a fixed set of question and scoring snapshots. A student receives a persisted permutation on start. One partial unique index admits one non-invalidated attempt per student and competition, and a unique replacement link admits one replacement per original. Replacement authorization and student confirmation are separate operations; only confirmation starts the new timer.

All writes and terminal transitions serialize against the attempt. At the deadline the database's accepted answers determine the score. The first request that observes an overdue attempt (including reports) finalizes it with the deadline as the effective completion time. A timeout can thus be recorded after an idle host wakes. Display and ranking use the effective finish time.
