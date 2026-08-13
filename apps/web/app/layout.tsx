import type { Metadata } from "next";
import { IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

/*
 * IBM Plex was drawn for technical documentation, which is what a findings
 * report is. Self-hosted by next/font — no CDN request, no silent fallback.
 */
const plexSans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-plex-sans",
  display: "swap",
});

const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-plex-mono",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? "https://defenex.com"),
  title: {
    default: "Defenex — find who is faking your brand",
    template: "%s · Defenex",
  },
  description:
    "Scan the open web for counterfeit listings, lookalike domains, phishing and impersonation of your brand. Every finding quotes the evidence.",
  openGraph: {
    title: "Defenex",
    description: "Find who is faking your brand. Then remove them.",
    type: "website",
    images: [{ url: "/og.jpg", width: 1200, height: 630, alt: "Defenex — find who is faking your brand" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Defenex",
    description: "Find who is faking your brand. Then remove them.",
    images: ["/og.jpg"],
  },
  robots: { index: true, follow: true },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${plexSans.variable} ${plexMono.variable}`}>
      <body className="flex min-h-screen flex-col">{children}</body>
    </html>
  );
}
