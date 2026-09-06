-- AlterEnum
ALTER TYPE "Category" ADD VALUE 'COMPLEX_SPINE';

-- AlterTable
ALTER TABLE "Video" ADD COLUMN     "isPlaceholder" BOOLEAN NOT NULL DEFAULT false;
