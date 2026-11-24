-- CreateEnum
CREATE TYPE "QuestionType" AS ENUM ('MCQ', 'SORTING');

-- CreateEnum
CREATE TYPE "Difficulty" AS ENUM ('EASY', 'MEDIUM', 'HARD');

-- CreateEnum
CREATE TYPE "SortingMode" AS ENUM ('PARTIAL', 'EXACT');

-- CreateEnum
CREATE TYPE "CompetitionStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'ACTIVE', 'CLOSED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "TiePolicy" AS ENUM ('SCORE_THEN_TIME', 'SCORE_ONLY');

-- CreateEnum
CREATE TYPE "AttemptStatus" AS ENUM ('AWAITING_START', 'IN_PROGRESS', 'SUBMITTED', 'TIMED_OUT', 'INVALIDATED');

-- CreateTable
CREATE TABLE "Question" (
    "id" UUID NOT NULL,
    "gradeId" UUID NOT NULL,
    "type" "QuestionType" NOT NULL,
    "difficulty" "Difficulty" NOT NULL,
    "explanation" TEXT NOT NULL DEFAULT '',
    "imageUrl" TEXT,
    "tags" TEXT[],
    "text" TEXT NOT NULL,
    "points" INTEGER NOT NULL,
    "items" JSONB NOT NULL,
    "correctOrder" UUID[],
    "sortingMode" "SortingMode" NOT NULL,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Question_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Competition" (
    "id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "tiePolicy" "TiePolicy" NOT NULL DEFAULT 'SCORE_THEN_TIME',
    "instructions" TEXT NOT NULL,
    "opensAt" TIMESTAMPTZ(3) NOT NULL,
    "closesAt" TIMESTAMPTZ(3) NOT NULL,
    "durationMinutes" INTEGER NOT NULL,
    "status" "CompetitionStatus" NOT NULL DEFAULT 'DRAFT',
    "publishedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Competition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompetitionGrade" (
    "id" UUID NOT NULL,
    "competitionId" UUID NOT NULL,
    "gradeId" UUID NOT NULL,
    "blueprint" JSONB NOT NULL,

    CONSTRAINT "CompetitionGrade_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompetitionQuestion" (
    "competitionGradeId" UUID NOT NULL,
    "questionId" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "snapshot" JSONB,

    CONSTRAINT "CompetitionQuestion_pkey" PRIMARY KEY ("competitionGradeId","questionId")
);

-- CreateTable
CREATE TABLE "Attempt" (
    "id" UUID NOT NULL,
    "competitionId" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "gradeId" UUID NOT NULL,
    "replacesAttemptId" UUID,
    "status" "AttemptStatus" NOT NULL,
    "startedAt" TIMESTAMPTZ(3),
    "expiresAt" TIMESTAMPTZ(3),
    "finishedAt" TIMESTAMPTZ(3),
    "submittedAt" TIMESTAMPTZ(3),
    "position" INTEGER NOT NULL DEFAULT 0,
    "percentage" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "score" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "maxScore" INTEGER NOT NULL DEFAULT 0,
    "correctCount" INTEGER NOT NULL DEFAULT 0,
    "incorrectCount" INTEGER NOT NULL DEFAULT 0,
    "unansweredCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Attempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttemptQuestion" (
    "id" UUID NOT NULL,
    "attemptId" UUID NOT NULL,
    "questionId" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "itemOrder" UUID[],

    CONSTRAINT "AttemptQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttemptAnswer" (
    "attemptQuestionId" UUID NOT NULL,
    "itemIds" UUID[],
    "revision" INTEGER NOT NULL,
    "savedAt" TIMESTAMPTZ(3) NOT NULL,
    "lockedAt" TIMESTAMPTZ(3),
    "earnedPoints" DECIMAL(12,2),

    CONSTRAINT "AttemptAnswer_pkey" PRIMARY KEY ("attemptQuestionId")
);

-- CreateIndex
CREATE INDEX "Question_gradeId_archived_type_difficulty_idx" ON "Question"("gradeId", "archived", "type", "difficulty");

-- CreateIndex
CREATE INDEX "Competition_status_closesAt_idx" ON "Competition"("status", "closesAt");

-- CreateIndex
CREATE INDEX "CompetitionGrade_gradeId_idx" ON "CompetitionGrade"("gradeId");

-- CreateIndex
CREATE UNIQUE INDEX "CompetitionGrade_competitionId_gradeId_key" ON "CompetitionGrade"("competitionId", "gradeId");

-- CreateIndex
CREATE UNIQUE INDEX "CompetitionQuestion_competitionGradeId_position_key" ON "CompetitionQuestion"("competitionGradeId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "Attempt_replacesAttemptId_key" ON "Attempt"("replacesAttemptId");

-- CreateIndex
CREATE INDEX "Attempt_competitionId_gradeId_status_expiresAt_idx" ON "Attempt"("competitionId", "gradeId", "status", "expiresAt");

-- CreateIndex
CREATE INDEX "Attempt_studentId_status_expiresAt_idx" ON "Attempt"("studentId", "status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "AttemptQuestion_attemptId_position_key" ON "AttemptQuestion"("attemptId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "AttemptQuestion_attemptId_questionId_key" ON "AttemptQuestion"("attemptId", "questionId");

-- AddForeignKey
ALTER TABLE "Question" ADD CONSTRAINT "Question_gradeId_fkey" FOREIGN KEY ("gradeId") REFERENCES "Grade"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompetitionGrade" ADD CONSTRAINT "CompetitionGrade_competitionId_fkey" FOREIGN KEY ("competitionId") REFERENCES "Competition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompetitionGrade" ADD CONSTRAINT "CompetitionGrade_gradeId_fkey" FOREIGN KEY ("gradeId") REFERENCES "Grade"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompetitionQuestion" ADD CONSTRAINT "CompetitionQuestion_competitionGradeId_fkey" FOREIGN KEY ("competitionGradeId") REFERENCES "CompetitionGrade"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompetitionQuestion" ADD CONSTRAINT "CompetitionQuestion_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attempt" ADD CONSTRAINT "Attempt_competitionId_fkey" FOREIGN KEY ("competitionId") REFERENCES "Competition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attempt" ADD CONSTRAINT "Attempt_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attempt" ADD CONSTRAINT "Attempt_gradeId_fkey" FOREIGN KEY ("gradeId") REFERENCES "Grade"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attempt" ADD CONSTRAINT "Attempt_replacesAttemptId_fkey" FOREIGN KEY ("replacesAttemptId") REFERENCES "Attempt"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttemptQuestion" ADD CONSTRAINT "AttemptQuestion_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "Attempt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttemptQuestion" ADD CONSTRAINT "AttemptQuestion_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttemptAnswer" ADD CONSTRAINT "AttemptAnswer_attemptQuestionId_fkey" FOREIGN KEY ("attemptQuestionId") REFERENCES "AttemptQuestion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX "Attempt_one_valid_per_student_competition"
  ON "Attempt" ("competitionId", "studentId") WHERE status <> 'INVALIDATED';
ALTER TABLE "Competition" ADD CONSTRAINT "Competition_valid_window"
  CHECK ("opensAt" < "closesAt" AND "durationMinutes" > 0);
ALTER TABLE "Attempt" ADD CONSTRAINT "Attempt_valid_lifecycle"
  CHECK (
    (status <> 'AWAITING_START' OR ("replacesAttemptId" IS NOT NULL AND "startedAt" IS NULL AND "expiresAt" IS NULL))
    AND (status NOT IN ('IN_PROGRESS', 'SUBMITTED', 'TIMED_OUT') OR ("startedAt" IS NOT NULL AND "expiresAt" IS NOT NULL AND "expiresAt" >= "startedAt"))
    AND (status NOT IN ('SUBMITTED', 'TIMED_OUT') OR "finishedAt" IS NOT NULL)
    AND (status <> 'SUBMITTED' OR "submittedAt" IS NOT NULL)
    AND (status <> 'TIMED_OUT' OR "finishedAt" = "expiresAt")
    AND "position" >= 0
  );
ALTER TABLE "Question" ADD CONSTRAINT "Question_positive_points" CHECK ("points" > 0);
ALTER TABLE "AttemptAnswer" ADD CONSTRAINT "AttemptAnswer_positive_revision" CHECK ("revision" > 0);
