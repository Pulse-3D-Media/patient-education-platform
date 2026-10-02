/**
 * The kind of an error, never its message: a Stripe error's type, a Prisma
 * error's code, or the class name. What goes in the server log when something
 * fails, and what billing stores and shows to staff.
 *
 * Why never the message or the whole error: a message can carry what the
 * failing code was working on, and on this app that can be a share code, a
 * connection string or a signed address. Printing the whole error object
 * prints the message and the stack too. The kind is enough to know where to
 * look; the rest is found by reproducing it.
 *
 * Pure, no imports, so any server file can use it without pulling Prisma or
 * Stripe in.
 */
export function errorKind(error: unknown): string {
  if (error && typeof error === "object") {
    const { name, code, type } = error as { name?: unknown; code?: unknown; type?: unknown };
    // Prisma's known request errors carry a short code such as P2002 (a duplicate).
    if (name === "PrismaClientKnownRequestError" && typeof code === "string" && /^P\d{4}$/.test(code)) {
      return `Prisma ${code}`;
    }
    // Stripe's errors carry their kind as a type such as StripeConnectionError.
    if (typeof type === "string" && /^Stripe\w*$/.test(type)) return type;
    if (typeof name === "string" && /^\w{1,60}$/.test(name)) return name;
  }
  return "Error";
}
