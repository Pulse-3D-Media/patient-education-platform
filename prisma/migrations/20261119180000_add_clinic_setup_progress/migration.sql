-- Setup progress for a clinic (approved by Evan on 2026-11-18). Additive only.
-- setupStep is empty on every existing clinic, which the app reads as "set up":
-- no clinic that was open before this change is asked to go through setup.
-- setupDone starts as an empty list on every existing clinic.

-- AlterTable
ALTER TABLE "Clinic" ADD COLUMN     "setupDone" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "setupStep" TEXT;
