-- AlterTable
ALTER TABLE "Video" ADD COLUMN     "muxAssetId" TEXT,
ADD COLUMN     "muxPlaybackId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Video_muxPlaybackId_key" ON "Video"("muxPlaybackId");
