# Competition operations

## Backup and restore rehearsal

From the project root, start the PostgreSQL service with the credentials in .env. Keep backups outside the repository in a directory readable only by the operator. Use the same PostgreSQL major version for the rehearsal.

```bash
umask 077
docker compose exec -T db pg_dump -U sunday -Fc sunday > "$BACKUP_DIR/competition.dump"
docker compose exec -T db createdb -U sunday sunday_restore_check
docker compose exec -T db pg_restore -U sunday --exit-on-error --no-owner -d sunday_restore_check < "$BACKUP_DIR/competition.dump"
docker compose exec -T db psql -U sunday -d sunday_restore_check -c '\\dt'
```

Use a fresh verification database name for each rehearsal. Compare grade, student, attempt and score counts with the snapshot. Point an isolated API at the restored database, sign in and open results before considering the backup usable. Protect backups as roster and credential data. Use an encrypted destination and restrict access to operators.

## Event day

Before opening, check eligibility, the frozen question sets and duration for each grade. Record the expected peak attendance and run simultaneous starts, saves and result reads at that load. Test the deployed domain on real phones and verify a fresh backup can be restored. If a provider outage disrupts participation, record affected students and times, communicate the interruption, and use the audited replacement workflow while the window is open. Keep distribution handouts private and send each student only their own row.


## Repeat the local pilot

Point the API at a freshly migrated, seeded disposable database. Start the production frontend with its API rewrite directed to that API. Set PUBLIC_ORIGIN to the frontend URL and TEST_ADMIN_PASSWORD to the test administrator password. Run `PILOT_DISPOSABLE_DB=yes PILOT_STUDENTS=90 node tests/pilot-load.mjs` from the project root. The script imports synthetic students, issues activation credentials, opens a test competition, and checks every published score. Discard the temporary database after the rehearsal.
