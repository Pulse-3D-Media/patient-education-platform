-- Option A for added categories (decided by Evan on 2026-10-26): remember which accepted
-- plans were bought as the full library, so they include every category, ones added later too.
-- Additive: false for every existing plan, which is the truth (production had no paid plans).

ALTER TABLE "BillingPlan" ADD COLUMN     "fullLibrary" BOOLEAN NOT NULL DEFAULT false;
