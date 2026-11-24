# Verification record

Local PostgreSQL 16, NestJS, Next.js and headless Chrome. Fixtures use synthetic identities. The browser goes through the Next.js same-origin API rewrite.

| Check | Result |
|---|---|
| Release builds and migrations from a fresh database | Passed |
| API integration and scoring tests | 9 passed |
| Browser acceptance through the production frontend | 4 passed on a freshly migrated database |
| PostgreSQL dump and restore into a separate local database | Passed with 90 submitted attempts and 180.00 total points restored |
| Local pilot load rehearsal | 30 and 90 concurrent synthetic student sessions passed |
| Hosted provider URLs, event-size load and real phones | Pending the hosted pilot |

The API tests cover roster scope, activation reissue and reuse, session rotation, PIN throttling, valid competition windows, blueprint validation, concurrent starts, frozen questions, answer revisions, exact and partial sorting scores, timeout during a row-lock race, late writes, publication, export, and replacement rollback and retry.

The browser tests cover CSV import and Excel download, activation through the UI, reload and login with a leading-zero PIN, fresh-browser appearance, Arabic and English layout at mobile and desktop widths, and saving an answer while the theme changes. The quiz test checks the deadline after the theme change and reload and confirms the score appears after publication.


## Local pilot rehearsal

The production frontend sent each burst through the same-origin API proxy to NestJS. Both runs verified that every student got one distinct attempt, resumed with the original deadline and saved answer, and received the expected published score. The test chose 30 and 90 synthetic students because actual attendance is pending.

| Operation | 30 students, p95 | 90 students, p95 |
|---|---:|---:|
| Activation | 677 ms | 1,968 ms |
| Start | 111 ms | 204 ms |
| Save answer | 72 ms | 172 ms |
| Resume | 62 ms | 143 ms |
| Submit | 77 ms | 190 ms |
