-- AlterTable
ALTER TABLE "Clinic" ADD COLUMN     "pricingVersionId" TEXT;

-- CreateTable
CREATE TABLE "PricingVersion" (
    "id" TEXT NOT NULL,
    "version" SERIAL NOT NULL,
    "config" JSONB NOT NULL,
    "note" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT NOT NULL,
    "createdByName" TEXT NOT NULL,
    "active" BOOLEAN,

    CONSTRAINT "PricingVersion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PricingVersion_version_key" ON "PricingVersion"("version");

-- CreateIndex
CREATE UNIQUE INDEX "PricingVersion_active_key" ON "PricingVersion"("active");

-- AddForeignKey
ALTER TABLE "Clinic" ADD CONSTRAINT "Clinic_pricingVersionId_fkey" FOREIGN KEY ("pricingVersionId") REFERENCES "PricingVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
