import type { Metadata } from "next";
import { LegalPage } from "@/components/LegalPage";

export const metadata: Metadata = { title: "Privacy" };

export default function Privacy() {
  return (
    <LegalPage title="Privacy" updated="13 August 2026">
      <h2>What we collect</h2>
      <p>
        When you run a scan we store the brand name, domain and industry you submit, and your
        email address if you provide one. We also store the results of the scan: the URLs we
        examined, the text we quoted from them, and screenshots we captured.
      </p>
      <p>
        We record the IP address a scan was requested from. It is used only to rate-limit
        the free scanner and is not used to build a profile of you.
      </p>

      <h2>What we do with it</h2>
      <ul>
        <li>Run the scan you asked for and show you the results.</li>
        <li>Email you the report, if you gave us an address.</li>
        <li>Compare future scans of the same brand so we can tell you what is new.</li>
      </ul>
      <p>
        We do not sell your data, and we do not use your scan results to advertise to you.
      </p>

      <h2>Third parties that process data for us</h2>
      <ul>
        <li><strong>YepAPI</strong> — runs the web searches and fetches pages that block us.</li>
        <li><strong>Google (Gemini)</strong> — classifies fetched page text.</li>
        <li><strong>Cloudflare R2</strong> — stores screenshots and report PDFs.</li>
        <li><strong>Resend</strong> — delivers report emails.</li>
        <li><strong>Railway and Vercel</strong> — host the service.</li>
      </ul>

      <h2>Retention</h2>
      <p>
        Scan results are kept so that later scans can be compared against them. Ask us to
        delete them and we will, along with any screenshots and your email address.
      </p>

      <h2>Your rights</h2>
      <p>
        You can ask for a copy of what we hold about you, ask us to correct it, or ask us to
        delete it. Write to <strong>privacy@defenex.com</strong> and we will respond within
        30 days.
      </p>

      <h2>Reports about you rather than by you</h2>
      <p>
        If a Defenex report references a page you operate and you believe the finding is
        wrong, write to <strong>privacy@defenex.com</strong>. We will review it, and we
        correct findings we cannot support.
      </p>
    </LegalPage>
  );
}
