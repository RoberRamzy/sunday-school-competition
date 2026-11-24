ALTER TABLE "AdminUser"
  ALTER COLUMN "passwordHash" DROP NOT NULL,
  ADD COLUMN "setupCodeHash" TEXT,
  ADD COLUMN "setupCodeExpiresAt" TIMESTAMPTZ(3);
