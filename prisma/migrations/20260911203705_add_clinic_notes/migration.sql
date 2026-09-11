-- CreateEnum
CREATE TYPE "NoteKind" AS ENUM ('STAFF', 'STATUS');

-- CreateTable
CREATE TABLE "ClinicNote" (
    "id" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "kind" "NoteKind" NOT NULL DEFAULT 'STAFF',
    "body" TEXT NOT NULL,
    "authorName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClinicNote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ClinicNote_clinicId_createdAt_idx" ON "ClinicNote"("clinicId", "createdAt");

-- AddForeignKey
ALTER TABLE "ClinicNote" ADD CONSTRAINT "ClinicNote_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE CASCADE ON UPDATE CASCADE;
