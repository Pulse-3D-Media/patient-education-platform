-- AlterTable
ALTER TABLE "Share" ADD COLUMN     "qrCodeId" TEXT;

-- CreateTable
CREATE TABLE "QrCode" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "videoId" TEXT NOT NULL,
    "senderUserId" TEXT NOT NULL,
    "senderFallbackName" TEXT,
    "liveKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "retiredAt" TIMESTAMP(3),

    CONSTRAINT "QrCode_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "QrCode_code_key" ON "QrCode"("code");

-- CreateIndex
CREATE UNIQUE INDEX "QrCode_liveKey_key" ON "QrCode"("liveKey");

-- CreateIndex
CREATE INDEX "QrCode_clinicId_retiredAt_idx" ON "QrCode"("clinicId", "retiredAt");

-- CreateIndex
CREATE INDEX "Share_qrCodeId_createdAt_idx" ON "Share"("qrCodeId", "createdAt");

-- AddForeignKey
ALTER TABLE "Share" ADD CONSTRAINT "Share_qrCodeId_fkey" FOREIGN KEY ("qrCodeId") REFERENCES "QrCode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QrCode" ADD CONSTRAINT "QrCode_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QrCode" ADD CONSTRAINT "QrCode_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "Video"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

