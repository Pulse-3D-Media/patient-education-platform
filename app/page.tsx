import { redirect } from "next/navigation";

/**
 * The root address sends you to the library. There is no home page of its own
 * in Phase 1: the library is what a surgeon opens, and patients arrive by
 * share link at /watch/[code], never at the root.
 */
export default function Home() {
  redirect("/library");
}
