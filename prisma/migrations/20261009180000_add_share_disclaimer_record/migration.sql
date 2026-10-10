-- The "for education only" box on the patient page: an anonymous record on
-- each link (when the box was first ticked, how many ticks were recorded, and
-- which wording was ticked last). Three additive columns; every existing link
-- gets 0 and two empties, which is the truth (no box existed before).

-- AlterTable
ALTER TABLE "Share" ADD COLUMN     "disclaimerAcceptances" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "disclaimerFirstAcceptedAt" TIMESTAMP(3),
ADD COLUMN     "disclaimerVersion" TEXT;
