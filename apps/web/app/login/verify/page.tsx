import { redirect } from "next/navigation";
import Link from "next/link";
import { Header, Footer } from "@/components/Shell";
import { verifyMagicLink } from "@/lib/worker";
import { createSession } from "@/lib/session";

export const dynamic = "force-dynamic";
export const metadata = { title: "Signing in", robots: { index: false } };

export default async function VerifyPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  if (token) {
    try {
      const { user } = await verifyMagicLink(token);
      await createSession({ userId: user.id, email: user.email, isAdmin: user.isAdmin });
      redirect("/dashboard");
    } catch (err) {
      // redirect() throws by design; only real failures fall through.
      if (err && typeof err === "object" && "digest" in err) throw err;
    }
  }

  return (
    <>
      <Header />
      <main className="w-full flex-1 mx-auto max-w-md px-6 pt-20 pb-20">
        <p className="t-eyebrow">Sign in</p>
        <h1 className="t-h2 mt-3">That link no longer works</h1>
        <p className="t-small measure mt-3 text-ink-dim">
          Sign-in links expire after 15 minutes and can only be used once. Mail scanners
          sometimes open them first, which uses the link up.
        </p>
        <Link
          href="/login"
          className="mt-8 inline-block bg-paper px-5 py-3 text-sm font-medium text-canvas transition-colors hover:bg-paper-dim"
        >
          Send a new link
        </Link>
      </main>
      <Footer />
    </>
  );
}
