-- AlterTable
ALTER TABLE "Video" ADD COLUMN     "notes" TEXT,
ADD COLUMN     "posterUrl" TEXT;

-- CreateTable
CREATE TABLE "CategoryConfig" (
    "category" "Category" NOT NULL,
    "sellable" BOOLEAN NOT NULL DEFAULT true,
    "comingSoonText" TEXT,

    CONSTRAINT "CategoryConfig_pkey" PRIMARY KEY ("category")
);
