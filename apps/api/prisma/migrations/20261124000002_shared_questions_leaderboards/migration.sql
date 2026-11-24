ALTER TABLE "Competition"
  ADD COLUMN "sharedQuestions" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "leaderboardTiePolicy" "TiePolicy",
  ADD COLUMN "leaderboardAliasKey" UUID NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN "leaderboardScopes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "publicLeaderboard" JSONB;

ALTER TABLE "Question" ALTER COLUMN "gradeId" DROP NOT NULL;
ALTER TABLE "Question" ADD COLUMN "competitionId" UUID;
ALTER TABLE "Question" ADD CONSTRAINT "Question_competitionId_fkey"
  FOREIGN KEY ("competitionId") REFERENCES "Competition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Question" ADD CONSTRAINT "Question_exactly_one_owner"
  CHECK (num_nonnulls("gradeId", "competitionId") = 1);
CREATE INDEX "Question_competitionId_idx" ON "Question"("competitionId");
