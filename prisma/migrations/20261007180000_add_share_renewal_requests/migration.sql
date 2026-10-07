-- How many "ask my clinic" requests have been recorded on each link, for the
-- Pulse reports. Starts at 0 on every existing link (requests made before
-- this column existed were never kept, so 0 is all that can be said), and
-- only ever goes up. Adding a column with a constant default does not
-- rewrite the table.
-- AlterTable
ALTER TABLE "Share" ADD COLUMN     "renewalRequests" INTEGER NOT NULL DEFAULT 0;

-- An index for "links this clinic made since <date>", which every report
-- reads. Changes no data.
-- CreateIndex
CREATE INDEX "Share_clinicId_createdAt_idx" ON "Share"("clinicId", "createdAt");
