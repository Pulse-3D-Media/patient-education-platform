-- An upload to Mux that is in flight for a video: Mux's direct upload id (so
-- the webhook and "Check with Mux" can find the row) and where it stands, in
-- a word ("waiting", "preparing", "failed"). Both optional, both empty on
-- every existing row, both cleared when the upload is finished with.
-- AlterTable
ALTER TABLE "Video" ADD COLUMN     "muxUploadId" TEXT,
ADD COLUMN     "muxUploadState" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Video_muxUploadId_key" ON "Video"("muxUploadId");
