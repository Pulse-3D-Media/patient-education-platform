import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The line between browser code and the database (rules 1 and 8 in
 * CLAUDE.md). Three things hold it, and each is checked here by reading the
 * source:
 *
 *   1. lib/db/client.ts, which every file in lib/db imports, starts with
 *      import "server-only". Next.js then fails the build if browser code
 *      reaches the database through any chain of imports.
 *   2. No file marked "use client" imports lib/db (or Prisma's client)
 *      itself. The build would catch it too; this says so sooner and names
 *      the file.
 *   3. The scripts in prisma/ run with --conditions=react-server, without
 *      which the guard in 1 would refuse to let them start.
 *
 * The build is the real proof of 1 (this test cannot follow every chain of
 * imports the way the bundler does).
 */

/** Every .ts and .tsx file under a folder, tests left out. */
function sourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) found.push(...sourceFiles(path));
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) found.push(path);
  }
  return found;
}

/** True when the file opens with the "use client" line, which is what makes it browser code. */
function isClientFile(text: string) {
  return /^\s*(["'])use client\1/.test(text.replace(/^(\s*\/\/[^\n]*\n|\s*\/\*[\s\S]*?\*\/)*/, ""));
}

/** What a file imports that carries a value at run time: "import type" lines are left out, since they vanish when the code is built. */
function importsOf(text: string): string[] {
  const found: string[] = [];
  for (const match of text.matchAll(/^\s*(?:import|export)\s+(?!type\b)[^;]*?from\s+["']([^"']+)["']/gm)) found.push(match[1]);
  for (const match of text.matchAll(/^\s*import\s+["']([^"']+)["']/gm)) found.push(match[1]);
  return found;
}

/** True when an import, written from the file at `path`, points into lib/db or at Prisma's client. */
function reachesDatabase(path: string, specifier: string) {
  if (specifier === "@prisma/client") return true;
  if (specifier === "@/lib/db" || specifier.startsWith("@/lib/db/")) return true;
  if (!specifier.startsWith(".")) return false;
  const target = normalize(join(dirname(path), specifier)).replace(/\\/g, "/");
  return target === "lib/db" || target.startsWith("lib/db/");
}

describe("browser code and the database", () => {
  it("lib/db/client.ts starts with the server-only guard", () => {
    const text = readFileSync("lib/db/client.ts", "utf8");
    expect(text.trimStart().startsWith('import "server-only";')).toBe(true);
  });

  it("every file in lib/db that touches Prisma goes through that client", () => {
    for (const path of sourceFiles("lib/db")) {
      const text = readFileSync(path, "utf8");
      if (path.replace(/\\/g, "/") === "lib/db/client.ts") continue;
      // A file may take a transaction it is handed (lock helpers do), but nothing else may make a client of its own.
      expect(text, path).not.toMatch(/new PrismaClient\(/);
    }
  });

  it("no file marked \"use client\" imports lib/db or Prisma's client", () => {
    const offenders: string[] = [];
    let clientFiles = 0;
    for (const path of [...sourceFiles("app"), ...sourceFiles("components"), ...sourceFiles("lib")]) {
      const text = readFileSync(path, "utf8");
      if (!isClientFile(text)) continue;
      clientFiles++;
      for (const specifier of importsOf(text)) {
        if (reachesDatabase(path, specifier)) offenders.push(`${path.replace(/\\/g, "/")} imports ${specifier}`);
      }
    }
    // The search really did look at the browser files (there are dozens), so an empty list means something.
    expect(clientFiles).toBeGreaterThan(20);
    expect(offenders).toEqual([]);
  });

  it("the check above would catch the two forms that used to break the rule", () => {
    const before = `"use client";\n\nimport { useActionState } from "react";\nimport { SETTINGS_DEFAULTS, SETTINGS_HELP, type Settings } from "@/lib/db/settings";\n`;
    expect(isClientFile(before)).toBe(true);
    expect(importsOf(before).filter((specifier) => reachesDatabase("app/pulse/settings/SettingsForm.tsx", specifier))).toEqual(["@/lib/db/settings"]);
    // A type-only import is fine: it is gone before the code reaches the browser.
    const typeOnly = `"use client";\nimport type { Category } from "@prisma/client";\n`;
    expect(importsOf(typeOnly)).toEqual([]);
    // A relative path into lib/db counts too.
    expect(reachesDatabase("lib/example.ts", "./db/settings")).toBe(true);
    expect(reachesDatabase("lib/example.ts", "./expiry")).toBe(false);
  });

  it("every script that loads lib/db runs with the react-server condition", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { scripts: Record<string, string>; prisma?: { seed?: string }; dependencies: Record<string, string> };
    const commands = [...Object.values(pkg.scripts), pkg.prisma?.seed ?? ""].filter((command) => /\btsx\b/.test(command));
    expect(commands.length).toBeGreaterThan(0);
    for (const command of commands) expect(command).toContain("--conditions=react-server");
    expect(pkg.dependencies["server-only"]).toBeDefined();
  });
});
