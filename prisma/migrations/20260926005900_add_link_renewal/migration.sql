-- AlterTable
ALTER TABLE "AppSettings" ADD COLUMN     "maxRenewals" INTEGER NOT NULL DEFAULT 3;

-- AlterTable
ALTER TABLE "Share" ADD COLUMN     "lastRenewedAt" TIMESTAMP(3),
ADD COLUMN     "renewalRequestedAt" TIMESTAMP(3),
ADD COLUMN     "renewalsUsed" INTEGER NOT NULL DEFAULT 0;

