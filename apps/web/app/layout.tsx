import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Defenex — Brand protection",
  description:
    "Find counterfeit listings, domain squatting, and impersonation of your brand across the open web.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
