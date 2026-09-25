-- AlterTable
ALTER TABLE "Clinic" ADD COLUMN     "ownerClerkUserId" TEXT;

-- CreateTable
CREATE TABLE "SeatInvitation" (
    "id" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "clerkInvitationId" TEXT,
    "reservedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SeatInvitation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SeatInvitation_clerkInvitationId_key" ON "SeatInvitation"("clerkInvitationId");

-- CreateIndex
CREATE INDEX "SeatInvitation_clinicId_idx" ON "SeatInvitation"("clinicId");

-- AddForeignKey
ALTER TABLE "SeatInvitation" ADD CONSTRAINT "SeatInvitation_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

