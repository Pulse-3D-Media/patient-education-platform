-- AlterTable
ALTER TABLE "Clinic" ADD COLUMN     "setupReminder" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "setupReminderAt" TIMESTAMP(3);

