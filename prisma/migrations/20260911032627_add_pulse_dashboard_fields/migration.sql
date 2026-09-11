-- AlterTable
ALTER TABLE "Clinic" ADD COLUMN     "categories" "Category"[] DEFAULT ARRAY[]::"Category"[],
ADD COLUMN     "managedByPulse" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "noticeText" TEXT,
ADD COLUMN     "phone" TEXT,
ADD COLUMN     "showPlaceholders" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "statusChangedAt" TIMESTAMP(3),
ADD COLUMN     "statusChangedBy" TEXT,
ADD COLUMN     "statusReason" TEXT,
ADD COLUMN     "surgeonSeats" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "viewDaysOverride" INTEGER;

-- CreateTable
CREATE TABLE "AppSettings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "unclaimedDays" INTEGER NOT NULL DEFAULT 90,
    "viewDays" INTEGER NOT NULL DEFAULT 7,
    "graceDays" INTEGER NOT NULL DEFAULT 14,
    "qrDailyFlag" INTEGER NOT NULL DEFAULT 200,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppSettings_pkey" PRIMARY KEY ("id")
);
