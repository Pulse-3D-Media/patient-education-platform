-- CreateEnum
CREATE TYPE "ClinicStatus" AS ENUM ('PENDING', 'ACTIVE', 'PAUSED', 'PAST_DUE', 'CANCELED');

-- AlterTable
ALTER TABLE "Clinic" ADD COLUMN     "logoUrl" TEXT,
ADD COLUMN     "status" "ClinicStatus" NOT NULL DEFAULT 'PENDING';
