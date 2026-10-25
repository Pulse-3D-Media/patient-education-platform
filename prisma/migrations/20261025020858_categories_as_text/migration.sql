-- K2: the five category columns change from the fixed list (the enum "Category")
-- to plain text, keeping every value exactly as it is ("KNEE" stays 'KNEE').
-- Approved by Evan on 2026-10-24 as a written plan (not additive, so not the
-- usual rule). WRITTEN BY HAND: Prisma's own generator writes a type change as
-- "drop the column, add a new one", which would throw the data away.
--
-- One transaction: either every column changes or none does.

BEGIN;

-- 1. Every category that exists today has its CategoryConfig row, so the
--    foreign key in step 4 can be added. The app makes these rows on first
--    read, so production already has them; this only fills a gap, never
--    changes a row.
INSERT INTO "CategoryConfig" ("category")
VALUES ('SPINE'), ('COMPLEX_SPINE'), ('KNEE'), ('SHOULDER'), ('HIP'), ('FOOT_ANKLE')
ON CONFLICT ("category") DO NOTHING;

-- 2. The columns, each converted in place, value by value. Postgres rebuilds
--    the indexes on them (Video_category_idx, CategoryConfig_pkey) itself.
ALTER TABLE "CategoryConfig" ALTER COLUMN "category" TYPE TEXT USING "category"::text;
ALTER TABLE "Video" ALTER COLUMN "category" TYPE TEXT USING "category"::text;

ALTER TABLE "Clinic" ALTER COLUMN "categories" DROP DEFAULT;
ALTER TABLE "Clinic" ALTER COLUMN "categories" TYPE TEXT[] USING "categories"::text[];
ALTER TABLE "Clinic" ALTER COLUMN "categories" SET DEFAULT ARRAY[]::TEXT[];

ALTER TABLE "BillingPlan" ALTER COLUMN "categories" TYPE TEXT[] USING "categories"::text[];
ALTER TABLE "BillingPlan" ALTER COLUMN "entitledCategories" TYPE TEXT[] USING "entitledCategories"::text[];

-- 3. TEMPORARY, for the minute between this migration and the new code going
--    live: the old code still compares these columns with values it marks as
--    "Category", and Postgres has no built-in way to compare text with that
--    type. This rule lets it. The new code only ever uses text, so it is not
--    affected. Dropped, together with the old "Category" type itself, by a
--    later clean-up migration once K2 has been live for a while. The type is
--    kept until then so that rolling the CODE back stays safe.
CREATE CAST (text AS "Category") WITH INOUT AS IMPLICIT;

-- 4. A video's category must be one in CategoryConfig. (The plan columns are
--    lists, which cannot have a foreign key; the app checks those.)
ALTER TABLE "Video" ADD CONSTRAINT "Video_category_fkey" FOREIGN KEY ("category") REFERENCES "CategoryConfig"("category") ON DELETE RESTRICT ON UPDATE CASCADE;

COMMIT;
