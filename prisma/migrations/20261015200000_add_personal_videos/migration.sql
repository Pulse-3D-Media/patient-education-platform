-- CreateTable
CREATE TABLE "PersonalVideo" (
    "id" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "clerkUserId" TEXT NOT NULL,
    "videoId" TEXT NOT NULL,
    "favoritedAt" TIMESTAMP(3),
    "playCount" INTEGER NOT NULL DEFAULT 0,
    "lastPlayedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PersonalVideo_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PersonalVideo_clinicId_clerkUserId_videoId_key" ON "PersonalVideo"("clinicId", "clerkUserId", "videoId");

-- AddForeignKey
ALTER TABLE "PersonalVideo" ADD CONSTRAINT "PersonalVideo_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonalVideo" ADD CONSTRAINT "PersonalVideo_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "Video"("id") ON DELETE CASCADE ON UPDATE CASCADE;

