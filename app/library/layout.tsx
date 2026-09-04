import { AppSidebar } from "@/components/ui/AppSidebar";
import { CategoryNav } from "@/components/ui/CategoryNav";

/**
 * The shell every library page sits in: global sidebar, then the category
 * rail, then the page. Two levels of navigation, kept visually separate so
 * adding categories never crowds the app-level items.
 */
export default function LibraryLayout({ children }: LayoutProps<"/library">) {
  return (
    <div className="flex min-h-screen flex-col bg-black text-white md:flex-row">
      <AppSidebar />
      <div className="flex min-w-0 flex-1 flex-col lg:flex-row">
        <CategoryNav />
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  );
}
