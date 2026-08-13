import type { Metadata } from "next";
import { LegalPage } from "@/components/LegalPage";

export const metadata: Metadata = { title: "Terms" };

export default function Terms() {
  return (
    <LegalPage title="Terms of service" updated="13 August 2026">
      <h2>What Defenex does</h2>
      <p>
        Defenex searches publicly accessible web pages and reports ones that appear to
        infringe a brand. Each finding quotes text taken from the page it references.
      </p>

      <h2>What a finding is, and is not</h2>
      <p>
        A finding is an observation about what a page appears to do. It is{" "}
        <strong>not legal advice and not a determination that anyone has broken the law</strong>.
        Whether a particular use of a mark is infringing depends on facts we cannot see, including
        your registrations, your licences and your distribution agreements.
      </p>
      <p>
        Automated classification is imperfect. Review findings before acting on them, and take
        advice from a qualified lawyer before sending any enforcement notice.
      </p>

      <h2>Using the free scanner</h2>
      <p>
        The free scanner is rate-limited and offered as-is. Do not use it to scan brands with the
        intention of harassing their owners, and do not attempt to overload it.
      </p>

      <h2>Accuracy</h2>
      <p>
        We do our best to report only what we can evidence, and we discard findings whose evidence
        does not hold up. We do not promise that a scan finds everything: search engines index a
        fraction of the web, and some sites block automated access entirely.
      </p>

      <h2>Liability</h2>
      <p>
        To the extent the law allows, Defenex is not liable for losses arising from action or
        inaction taken on the basis of a report.
      </p>

      <h2>Contact</h2>
      <p><strong>legal@defenex.com</strong></p>
    </LegalPage>
  );
}
