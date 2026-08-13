import type { Metadata } from "next";
import { LegalPage } from "@/components/LegalPage";

export const metadata: Metadata = { title: "Acceptable use" };

export default function AcceptableUse() {
  return (
    <LegalPage title="Acceptable use" updated="13 August 2026">
      <p>
        Defenex exists to help brand owners find misuse of their own marks. These rules keep it
        from becoming something else.
      </p>

      <h2>Do not</h2>
      <ul>
        <li>Scan a brand in order to harass, dox or intimidate the people behind it.</li>
        <li>Use reports to make enforcement claims over marks you do not own or represent.</li>
        <li>Submit domains you do not have a legitimate interest in examining.</li>
        <li>Attempt to make the scanner fetch private, internal or non-public systems.</li>
        <li>Automate the free scanner or work around its rate limits.</li>
      </ul>

      <h2>What we block</h2>
      <p>
        The scanner refuses to fetch private network addresses, loopback addresses and cloud
        metadata endpoints. Requests that look like an attempt to reach internal infrastructure
        are rejected before any network request is made.
      </p>

      <h2>Takedowns</h2>
      <p>
        Before we submit any enforcement notice on your behalf, we verify that you own or
        represent the mark. Filing a notice you are not entitled to file carries real legal
        consequences, and we will not do it on trust.
      </p>

      <h2>Reporting abuse</h2>
      <p>
        If you believe someone is using Defenex against you, write to{" "}
        <strong>abuse@defenex.com</strong>.
      </p>
    </LegalPage>
  );
}
