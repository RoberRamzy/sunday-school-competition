-- CreateEnum
CREATE TYPE "StudentStatus" AS ENUM ('PENDING_ACTIVATION', 'ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "StaffStatus" AS ENUM ('ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "StaffRole" AS ENUM ('SUPER_ADMIN', 'SERVANT');

-- CreateEnum
CREATE TYPE "Theme" AS ENUM ('classic', 'christmas');

-- CreateTable
CREATE TABLE "Grade" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Grade_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Student" (
    "id" UUID NOT NULL,
    "gradeId" UUID NOT NULL,
    "fullName" TEXT NOT NULL,
    "displayLabel" TEXT NOT NULL,
    "status" "StudentStatus" NOT NULL DEFAULT 'PENDING_ACTIVATION',
    "activationCodeHash" TEXT,
    "activationCodeUsedAt" TIMESTAMPTZ(3),
    "pinHash" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Student_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminUser" (
    "id" UUID NOT NULL,
    "fullName" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "StaffRole" NOT NULL DEFAULT 'SERVANT',
    "status" "StaffStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "AdminUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServantGrade" (
    "servantId" UUID NOT NULL,
    "gradeId" UUID NOT NULL,

    CONSTRAINT "ServantGrade_pkey" PRIMARY KEY ("servantId","gradeId")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "studentId" UUID,
    "staffId" UUID,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "revokedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthLimit" (
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "AuthLimit_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "Appearance" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "theme" "Theme" NOT NULL DEFAULT 'classic',

    CONSTRAINT "Appearance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" UUID NOT NULL,
    "actorType" TEXT NOT NULL,
    "actorId" UUID NOT NULL,
    "eventType" TEXT NOT NULL,
    "metadataJson" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Grade_name_key" ON "Grade"("name");

-- CreateIndex
CREATE INDEX "Student_gradeId_status_idx" ON "Student"("gradeId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Student_gradeId_displayLabel_key" ON "Student"("gradeId", "displayLabel");

-- CreateIndex
CREATE UNIQUE INDEX "AdminUser_username_key" ON "AdminUser"("username");

-- CreateIndex
CREATE INDEX "ServantGrade_gradeId_idx" ON "ServantGrade"("gradeId");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_studentId_revokedAt_idx" ON "Session"("studentId", "revokedAt");

-- CreateIndex
CREATE INDEX "Session_staffId_revokedAt_idx" ON "Session"("staffId", "revokedAt");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE INDEX "AuthLimit_expiresAt_idx" ON "AuthLimit"("expiresAt");

-- CreateIndex
CREATE INDEX "AuditLog_eventType_createdAt_idx" ON "AuditLog"("eventType", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_actorId_createdAt_idx" ON "AuditLog"("actorId", "createdAt");

-- AddForeignKey
ALTER TABLE "Student" ADD CONSTRAINT "Student_gradeId_fkey" FOREIGN KEY ("gradeId") REFERENCES "Grade"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServantGrade" ADD CONSTRAINT "ServantGrade_servantId_fkey" FOREIGN KEY ("servantId") REFERENCES "AdminUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServantGrade" ADD CONSTRAINT "ServantGrade_gradeId_fkey" FOREIGN KEY ("gradeId") REFERENCES "Grade"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "AdminUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;


ALTER TABLE "Session" ADD CONSTRAINT "Session_exactly_one_owner"
  CHECK (num_nonnulls("studentId", "staffId") = 1);
CREATE UNIQUE INDEX "Session_one_current_student"
  ON "Session" ("studentId") WHERE "studentId" IS NOT NULL AND "revokedAt" IS NULL;
CREATE UNIQUE INDEX "Session_one_current_staff"
  ON "Session" ("staffId") WHERE "staffId" IS NOT NULL AND "revokedAt" IS NULL;
ALTER TABLE "Student" ADD CONSTRAINT "Student_credentials_match_status"
  CHECK (
    ("status" <> 'ACTIVE' OR ("pinHash" IS NOT NULL AND "activationCodeUsedAt" IS NOT NULL))
    AND ("status" <> 'PENDING_ACTIVATION' OR ("pinHash" IS NULL AND "activationCodeUsedAt" IS NULL))
    AND ("status" = 'PENDING_ACTIVATION' OR "activationCodeHash" IS NULL)
  );
ALTER TABLE "Appearance" ADD CONSTRAINT "Appearance_singleton" CHECK ("id" = 1);
