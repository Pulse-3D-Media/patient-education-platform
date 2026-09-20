-- CreateEnum
CREATE TYPE "PracticeType" AS ENUM ('UNKNOWN', 'CLINIC', 'HOSPITAL');

-- CreateEnum
CREATE TYPE "StaffAccess" AS ENUM ('OPEN', 'PAUSED', 'CANCELED');

-- CreateEnum
CREATE TYPE "BillingStatus" AS ENUM ('NONE', 'INCOMPLETE', 'ACTIVE', 'PAST_DUE', 'CANCELED');

-- CreateEnum
CREATE TYPE "BillingInterval" AS ENUM ('MONTH', 'YEAR');

-- CreateEnum
CREATE TYPE "BillingEventStatus" AS ENUM ('RECEIVED', 'PROCESSED', 'IGNORED', 'FAILED');

-- AlterTable
ALTER TABLE "Clinic" ADD COLUMN     "graceEndsAt" TIMESTAMP(3),
ADD COLUMN     "practiceType" "PracticeType" NOT NULL DEFAULT 'UNKNOWN',
ADD COLUMN     "staffAccess" "StaffAccess";

-- CreateTable
CREATE TABLE "ClinicBilling" (
    "clinicId" TEXT NOT NULL,
    "stripeCustomerId" TEXT,
    "stripeSubscriptionId" TEXT,
    "status" "BillingStatus" NOT NULL DEFAULT 'NONE',
    "currentPeriodEnd" TIMESTAMP(3),
    "cancelAt" TIMESTAMP(3),
    "paymentFailedAt" TIMESTAMP(3),
    "graceEndsAt" TIMESTAMP(3),
    "lastReconciledAt" TIMESTAMP(3),
    "pendingPlanId" TEXT,
    "currentPlanId" TEXT,
    "scheduledPlanId" TEXT,
    "scheduledChangeAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClinicBilling_pkey" PRIMARY KEY ("clinicId")
);

-- CreateTable
CREATE TABLE "BillingPlan" (
    "id" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "pricingVersionId" TEXT NOT NULL,
    "categories" "Category"[],
    "entitledCategories" "Category"[],
    "surgeonSeats" INTEGER NOT NULL,
    "interval" "BillingInterval" NOT NULL,
    "perSeatCents" INTEGER NOT NULL,
    "totalCents" INTEGER NOT NULL,
    "acceptedById" TEXT NOT NULL,
    "acceptedByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BillingPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillingEvent" (
    "id" TEXT NOT NULL,
    "stripeEventId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "clinicId" TEXT,
    "stripeCustomerId" TEXT,
    "stripeSubscriptionId" TEXT,
    "status" "BillingEventStatus" NOT NULL DEFAULT 'RECEIVED',
    "outcome" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastErrorCode" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "BillingEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ClinicBilling_stripeCustomerId_key" ON "ClinicBilling"("stripeCustomerId");

-- CreateIndex
CREATE UNIQUE INDEX "ClinicBilling_stripeSubscriptionId_key" ON "ClinicBilling"("stripeSubscriptionId");

-- CreateIndex
CREATE UNIQUE INDEX "ClinicBilling_pendingPlanId_key" ON "ClinicBilling"("pendingPlanId");

-- CreateIndex
CREATE UNIQUE INDEX "ClinicBilling_currentPlanId_key" ON "ClinicBilling"("currentPlanId");

-- CreateIndex
CREATE UNIQUE INDEX "ClinicBilling_scheduledPlanId_key" ON "ClinicBilling"("scheduledPlanId");

-- CreateIndex
CREATE INDEX "BillingPlan_clinicId_createdAt_idx" ON "BillingPlan"("clinicId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "BillingEvent_stripeEventId_key" ON "BillingEvent"("stripeEventId");

-- CreateIndex
CREATE INDEX "BillingEvent_status_receivedAt_idx" ON "BillingEvent"("status", "receivedAt");

-- CreateIndex
CREATE INDEX "BillingEvent_clinicId_receivedAt_idx" ON "BillingEvent"("clinicId", "receivedAt");

-- AddForeignKey
ALTER TABLE "ClinicBilling" ADD CONSTRAINT "ClinicBilling_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClinicBilling" ADD CONSTRAINT "ClinicBilling_pendingPlanId_fkey" FOREIGN KEY ("pendingPlanId") REFERENCES "BillingPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClinicBilling" ADD CONSTRAINT "ClinicBilling_currentPlanId_fkey" FOREIGN KEY ("currentPlanId") REFERENCES "BillingPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClinicBilling" ADD CONSTRAINT "ClinicBilling_scheduledPlanId_fkey" FOREIGN KEY ("scheduledPlanId") REFERENCES "BillingPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingPlan" ADD CONSTRAINT "BillingPlan_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingPlan" ADD CONSTRAINT "BillingPlan_pricingVersionId_fkey" FOREIGN KEY ("pricingVersionId") REFERENCES "PricingVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Backfill, written by hand (the lines above are Prisma's own diff).
--
-- Until now a clinic's status could only be ACTIVE, PAUSED or CANCELED
-- because Pulse staff (or npm run db:set-status) set it by hand; nothing
-- else wrote those values. From here on the status is worked out from what
-- staff set by hand ("staffAccess") and from billing, so every clinic that
-- was set by hand has that fact recorded in the new column. Without this,
-- the first recalculation would send every clinic that is open today back
-- to PENDING. Only the new column is written; "status" itself and every
-- other existing column are left exactly as they are.
UPDATE "Clinic" SET "staffAccess" = 'OPEN' WHERE "status" = 'ACTIVE';
UPDATE "Clinic" SET "staffAccess" = 'PAUSED' WHERE "status" = 'PAUSED';
UPDATE "Clinic" SET "staffAccess" = 'CANCELED' WHERE "status" = 'CANCELED';
