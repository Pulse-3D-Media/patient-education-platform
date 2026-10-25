-- AlterTable
ALTER TABLE "CategoryConfig" ADD COLUMN     "formerSlugs" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "imageUrl" TEXT,
ADD COLUMN     "label" TEXT,
ADD COLUMN     "slug" TEXT,
ADD COLUMN     "sortOrder" INTEGER;

-- CreateIndex
CREATE UNIQUE INDEX "CategoryConfig_slug_key" ON "CategoryConfig"("slug");

