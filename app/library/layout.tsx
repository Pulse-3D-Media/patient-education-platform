import { AppShell } from "@/components/ui/AppShell";

/**
 * Every library page sits inside the shared shell: thin top banner, icon
 * rail, and the category drawer that opens from the books icon. The page
 * itself is server-rendered and passed through as children.
 */
export default function LibraryLayout({ children }: LayoutProps<"/library">) {
  return <AppShell>{children}</AppShell>;
}
