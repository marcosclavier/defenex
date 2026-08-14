import { Body, Container, Head, Heading, Hr, Html, Link, Preview, Section, Text } from "@react-email/components";

export interface AlertFinding {
  url: string;
  category: string;
  severity: number;
  severityLabel: string;
  evidenceQuote: string;
  isReturning: boolean;
}

export interface NewFindingsProps {
  brand: string;
  findings: AlertFinding[];
  reportUrl: string;
  manageUrl: string;
}

const styles = {
  body: { backgroundColor: "#f5f5f4", fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif", margin: 0, padding: "24px 0" },
  container: { backgroundColor: "#ffffff", border: "1px solid #e7e5e4", borderRadius: "8px", margin: "0 auto", maxWidth: "600px", padding: "32px" },
  mark: { color: "#78716c", fontSize: "12px", letterSpacing: "1.5px", margin: 0, textTransform: "uppercase" as const },
  h1: { color: "#1c1917", fontSize: "22px", fontWeight: 600, lineHeight: "29px", margin: "8px 0 6px" },
  sub: { color: "#57534e", fontSize: "14px", margin: "0 0 24px" },
  item: { borderLeft: "3px solid #d6d3d1", paddingLeft: "14px", marginBottom: "18px" },
  badge: { fontSize: "11px", fontWeight: 700, letterSpacing: "0.6px", margin: "0 0 4px", textTransform: "uppercase" as const },
  url: { color: "#1c1917", fontFamily: "ui-monospace,SFMono-Regular,Menlo,monospace", fontSize: "13px", margin: "0 0 6px", wordBreak: "break-all" as const },
  quote: { color: "#57534e", fontSize: "13px", fontStyle: "italic" as const, lineHeight: "19px", margin: 0 },
  cta: { backgroundColor: "#1c1917", borderRadius: "6px", color: "#ffffff", display: "inline-block", fontSize: "14px", fontWeight: 600, padding: "12px 22px", textDecoration: "none" },
  foot: { color: "#a8a29e", fontSize: "12px", lineHeight: "18px", margin: "8px 0 0" },
};

const TONE: Record<string, string> = {
  critical: "#b91c1c", high: "#c2410c", medium: "#a16207", low: "#57534e",
};

/**
 * Sent only when a scheduled rescan turns up something new or something that
 * had been removed and came back. A digest of the standing list would be
 * ignored within a fortnight; a change feed stays worth opening.
 */
export function NewFindings({ brand, findings, reportUrl, manageUrl }: NewFindingsProps) {
  const returning = findings.filter((f) => f.isReturning).length;

  return (
    <Html>
      <Head />
      <Preview>{`${findings.length} new ${findings.length === 1 ? "finding" : "findings"} for ${brand}`}</Preview>
      <Body style={styles.body}>
        <Container style={styles.container}>
          <Text style={styles.mark}>Defenex</Text>
          <Heading style={styles.h1}>
            {findings.length} new {findings.length === 1 ? "finding" : "findings"} for {brand}
          </Heading>
          <Text style={styles.sub}>
            Found since your last scan. Nothing you have already seen is repeated here.
            {returning > 0 &&
              ` ${returning} of these had been removed and have reappeared — usually a relisting.`}
          </Text>

          {findings.slice(0, 8).map((f) => (
            <Section key={f.url} style={{ ...styles.item, borderLeftColor: TONE[f.severityLabel] ?? "#d6d3d1" }}>
              <Text style={{ ...styles.badge, color: TONE[f.severityLabel] ?? "#1c1917" }}>
                {f.severityLabel} · {f.category.replace(/_/g, " ")}
                {f.isReturning ? " · reappeared" : ""}
              </Text>
              <Text style={styles.url}>{f.url}</Text>
              <Text style={styles.quote}>“{f.evidenceQuote.slice(0, 180)}”</Text>
            </Section>
          ))}

          {findings.length > 8 && (
            <Text style={styles.sub}>+ {findings.length - 8} more in the report.</Text>
          )}

          <Hr style={{ borderColor: "#e7e5e4", margin: "24px 0" }} />
          <Link href={reportUrl} style={styles.cta}>View the full report</Link>

          <Text style={styles.foot}>
            You are getting this because monitoring is on for {brand}.{" "}
            <Link href={manageUrl} style={{ color: "#57534e" }}>Pause monitoring</Link>.
            Findings describe what a page appears to do; they are not legal conclusions.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}

export default NewFindings;
