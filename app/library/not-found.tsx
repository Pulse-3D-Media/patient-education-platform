import { StaffNotFound } from "@/components/ui/StaffNotFound";

/** A category address the library does not have (/library/elbow, say). Inside the shell, with a way home. */
export default function LibraryNotFound() {
  return <StaffNotFound backHref="/library" backLabel="Back to the library" />;
}
