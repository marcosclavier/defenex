import {
  Body, Container, Head, Heading, Hr, Html, Link, Preview, Section, Text,
} from "@react-email/components";

export interface ReportFinding {
  url: string;
  domain: string;
  category: string;
  severity: number;
  severityLabel: string;
  confidence: string;
  evidenceQuote: string;
  hasScreenshot: boolean;
}

export interface ScanReportProps {
  brand: string;
  domain: string;
  findings: ReportFinding[];
  counts: Record<string, number>;
  reportUrl: string;
  scannedAt: string;
}

/*
 * Deliberately light-background with dark text.
 *
 * The web report uses the dark theme, but email clients do not: Gmail and
 * Outlook apply their own dark-mode inversion, which mangles dark templates
 * into unreadable low-contrast text. Inline styles only — <style> blocks are
 * stripped by several clients.
 */
const styles = {
  body: { backgroundColor: "#f5f5f4", fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif", margin: 0, padding: "24px 0" },
  container: { backgroundColor: "#ffffff", borderRadius: "8px", margin: "0 auto", maxWidth: "640px", padding: "32px", border: "1px solid #e7e5e4" },
  brandMark: { color: "#78716c", fontSize: "12px", letterSpacing: "1.5px", margin: 0, textTransform: "uppercase" as const },
  h1: { color: "#1c1917", fontSize: "24px", fontWeight: 600, lineHeight: "32px", margin: "8px 0 4px" },
  sub: { color: "#57534e", fontSize: "14px", margin: "0 0 24px" },
  summary: { backgroundColor: "#fafaf9", border: "1px solid #e7e5e4", borderRadius: "6px", padding: "16px", marginBottom: "24px" },
  finding: { borderLeft: "3px solid #d6d3d1", paddingLeft: "14px", marginBottom: "20px" },
  badge: { color: "#1c1917", fontSize: "11px", fontWeight: 700, letterSpacing: "0.6px", margin: "0 0 4px", textTransform: "uppercase" as const },
  url: { color: "#1c1917", fontFamily: "ui-monospace,SFMono-Regular,Menlo,monospace", fontSize: "13px", margin: "0 0 6px", wordBreak: "break-all" as const },
  quote: { color: "#57534e", fontSize: "13px", fontStyle: "italic" as const, lineHeight: "19px", margin: 0 },
  cta: { backgroundColor: "#1c1917", borderRadius: "6px", color: "#ffffff", display: "inline-block", fontSize: "14px", fontWeight: 600, padding: "12px 22px", textDecoration: "none" },
  foot: { color: "#a8a29e", fontSize: "12px", lineHeight: "18px", margin: "6px 0 0" },
};

// Severity is never conveyed by colour alone — the label carries the meaning,
// which also survives grayscale printing and colour-blind readers.
const SEVERITY_COLOR: Record<string, string> = {
  critical: "#b91c1c", high: "#c2410c", medium: "#a16207", low: "#57534e",
};

export function ScanReport({ brand, domain, findings, counts, reportUrl, scannedAt }: ScanReportProps) {
  const top = findings.slice(0, 10);
  const summary = Object.entries(counts).filter(([, n]) => n > 0);

  return (
    <Html>
      <Head />
      <Preview>
        {findings.length > 0
          ? `${findings.length} potential infringement${findings.length === 1 ? "" : "s"} found for ${brand}`
          : `No infringements found for ${brand}`}
      </Preview>
      <Body style={styles.body}>
        <Container style={styles.container}>
          <Text style={styles.brandMark}>Defenex</Text>
          <Heading style={styles.h1}>Brand scan: {brand}</Heading>
          <Text style={styles.sub}>{domain} · scanned {scannedAt}</Text>

          <Section style={styles.summary}>
            {findings.length === 0 ? (
              <Text style={{ ...styles.quote, fontStyle: "normal" }}>
                We found no material we could verify as infringing. That is a real result,
                not an error — we only report findings backed by evidence quoted from the page itself.
              </Text>
            ) : (
              <>
                <Text style={{ ...styles.badge, margin: "0 0 8px" }}>Summary</Text>
                {summary.map(([category, n]) => (
                  <Text key={category} style={{ ...styles.quote, fontStyle: "normal", margin: "0 0 3px" }}>
                    {n} × {category.replace(/_/g, " ").toLowerCase()}
                  </Text>
                ))}
              </>
            )}
          </Section>

          {top.map((f) => (
            <Section key={f.url} style={{ ...styles.finding, borderLeftColor: SEVERITY_COLOR[f.severityLabel] ?? "#d6d3d1" }}>
              <Text style={{ ...styles.badge, color: SEVERITY_COLOR[f.severityLabel] ?? "#1c1917" }}>
                {f.severityLabel} · {f.category.replace(/_/g, " ")} · {f.confidence} confidence
                {f.hasScreenshot ? "" : " · no screenshot"}
              </Text>
              <Text style={styles.url}>{f.url}</Text>
              <Text style={styles.quote}>“{f.evidenceQuote.slice(0, 220)}”</Text>
            </Section>
          ))}

          {findings.length > top.length && (
            <Text style={styles.sub}>+ {findings.length - top.length} more in the full report.</Text>
          )}

          <Hr style={{ borderColor: "#e7e5e4", margin: "24px 0" }} />
          <Link href={reportUrl} style={styles.cta}>View the full report</Link>

          <Text style={styles.foot}>
            Every finding quotes text taken directly from the page it references. Findings
            describe what a page appears to do; they are not legal conclusions.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}

export default ScanReport;
