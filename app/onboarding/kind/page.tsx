import { redirect } from "next/navigation";

/**
 * This address used to ask "Are you a surgeon?". The question was retired
 * with the seat model of September 2026 (everyone but the account owner
 * holds a seat; see lib/seats.ts). The page stays only so an old link or a
 * bookmark lands somewhere: /onboarding sends each person on to where they
 * belong.
 */
export default function RetiredKindQuestion(): never {
  redirect("/onboarding");
}
