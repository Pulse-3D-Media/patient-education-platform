import { LibraryShell } from "@/components/ui/LibraryShell";

/**
 * Every library page sits inside the shell: thin top banner, icon rail, and
 * the category drawer that opens from the books icon. The page itself is
 * server-rendered and passed through as children.
 */
export default function LibraryLayout({ children }: LayoutProps<"/library">) {
  return <LibraryShell>{children}</LibraryShell>;
}
