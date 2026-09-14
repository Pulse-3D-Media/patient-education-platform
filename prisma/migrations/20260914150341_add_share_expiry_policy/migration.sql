-- CreateEnum
CREATE TYPE "ExpiryPolicy" AS ENUM ('FIXED', 'FIRST_PLAY');

-- AlterTable
ALTER TABLE "Share" ADD COLUMN     "daysAfterFirstPlay" INTEGER,
ADD COLUMN     "expiryPolicy" "ExpiryPolicy" NOT NULL DEFAULT 'FIXED',
ADD COLUMN     "firstPlayedAt" TIMESTAMP(3);

