import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Header, Footer } from "@/components/Shell";
import { getSession } from "@/lib/session";
import { LoginForm } from "./LoginForm";

export const metadata: Metadata = { title: "Sign in", robots: { index: false } };

export default async function LoginPage() {
  if (await getSession()) redirect("/dashboard");
  return (
    <>
      <Header />
      <main className="w-full flex-1 mx-auto max-w-md px-6 pt-20 pb-20">
        <p className="t-eyebrow">Account</p>
        <h1 className="t-h2 mt-3">Sign in</h1>
        <LoginForm />
      </main>
      <Footer />
    </>
  );
}
