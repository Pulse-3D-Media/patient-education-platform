import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "./client";
import { pingDatabase } from "./health";

/** The one query behind /api/health, against the real testing database. Reads no table, writes nothing. */

afterAll(async () => {
  await prisma.$disconnect();
});

describe("pingDatabase", () => {
  it("answers when the database can be reached", async () => {
    await expect(pingDatabase()).resolves.toBeUndefined();
  });
});
