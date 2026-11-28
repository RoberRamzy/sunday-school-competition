BEGIN;
CREATE TABLE "CompetitionGroup" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    CONSTRAINT "CompetitionGroup_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CompetitionGroup_name_key" ON "CompetitionGroup"("name");
INSERT INTO "CompetitionGroup" ("id", "name") VALUES ('00000000-0000-4000-8000-000000000001', 'Grades 1–3');

ALTER TABLE "Grade" ADD COLUMN "groupId" UUID NOT NULL DEFAULT '00000000-0000-4000-8000-000000000001';
ALTER TABLE "AdminUser" ADD COLUMN "groupId" UUID NOT NULL DEFAULT '00000000-0000-4000-8000-000000000001';
ALTER TABLE "Competition" ADD COLUMN "groupId" UUID NOT NULL DEFAULT '00000000-0000-4000-8000-000000000001',
    ADD COLUMN "timerEnabled" BOOLEAN NOT NULL DEFAULT true, ADD COLUMN "hasStarted" BOOLEAN NOT NULL DEFAULT false;
UPDATE "Competition" c SET "hasStarted" = true WHERE EXISTS (
    SELECT 1 FROM "Attempt" a WHERE a."competitionId" = c.id AND a."startedAt" IS NOT NULL
);
ALTER TABLE "OverallLeaderboard" ADD COLUMN "groupId" UUID NOT NULL DEFAULT '00000000-0000-4000-8000-000000000001';
ALTER TABLE "Attempt" ADD COLUMN "timerEnabled" BOOLEAN NOT NULL DEFAULT true;

DROP INDEX "Grade_name_key";
CREATE UNIQUE INDEX "Grade_groupId_name_key" ON "Grade"("groupId", "name");
INSERT INTO "OverallLeaderboard" ("id", "published") VALUES (1, false) ON CONFLICT ("id") DO NOTHING;
CREATE UNIQUE INDEX "OverallLeaderboard_groupId_key" ON "OverallLeaderboard"("groupId");
CREATE INDEX "Competition_groupId_status_closesAt_idx" ON "Competition"("groupId", "status", "closesAt");
CREATE SEQUENCE "OverallLeaderboard_id_seq";
ALTER SEQUENCE "OverallLeaderboard_id_seq" OWNED BY "OverallLeaderboard"."id";
ALTER TABLE "OverallLeaderboard" ALTER COLUMN "id" SET DEFAULT nextval('"OverallLeaderboard_id_seq"');
SELECT setval('"OverallLeaderboard_id_seq"', GREATEST(COALESCE(MAX("id"), 0) + 1, 2), false) FROM "OverallLeaderboard";

ALTER TABLE "Grade" ADD CONSTRAINT "Grade_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "CompetitionGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AdminUser" ADD CONSTRAINT "AdminUser_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "CompetitionGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Competition" ADD CONSTRAINT "Competition_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "CompetitionGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OverallLeaderboard" ADD CONSTRAINT "OverallLeaderboard_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "CompetitionGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
COMMIT;
