-- The CDN address becomes optional (decided by Evan on 2026-10-05): a video
-- uploaded to Mux from the app lives in Mux only and has no address. No row
-- changes; every existing row keeps the address it has. The code refuses to
-- publish a video that has neither an address nor a Mux playback id.
ALTER TABLE "Video" ALTER COLUMN "videoUrl" DROP NOT NULL;
