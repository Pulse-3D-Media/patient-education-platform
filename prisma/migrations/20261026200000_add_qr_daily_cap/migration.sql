-- Prompt M: a hard daily cap on the links one printed QR code may hand out,
-- and the flag for Pulse staff moved down to 100 for settings rows made from
-- now on. Additive: the new column has a default, and a settings row that is
-- already saved keeps its own qrDailyFlag (only the column's default changes).

-- AlterTable
ALTER TABLE "AppSettings" ADD COLUMN     "qrDailyCap" INTEGER NOT NULL DEFAULT 200,
ALTER COLUMN "qrDailyFlag" SET DEFAULT 100;
