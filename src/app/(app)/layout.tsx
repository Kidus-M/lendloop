import { auth } from "@clerk/nextjs/server";
import { AccountGate } from "@/components/AccountGate";
import { AppNav } from "@/components/AppNav";

export default async function SignedInLayout({ children }: { children: React.ReactNode }) {
  // Sends signed-out visitors to sign in. This is for the experience only: every
  // Convex function checks identity and role itself, whatever this layout does.
  const { isAuthenticated, redirectToSignIn } = await auth();
  if (!isAuthenticated) return redirectToSignIn();

  return (
    <AccountGate>
      <AppNav />
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-8 sm:py-10">{children}</main>
    </AccountGate>
  );
}
