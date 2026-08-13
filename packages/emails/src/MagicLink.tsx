import { Body, Container, Head, Heading, Html, Link, Preview, Text } from "@react-email/components";

const styles = {
  body: { backgroundColor: "#f5f5f4", fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif", margin: 0, padding: "24px 0" },
  container: { backgroundColor: "#ffffff", border: "1px solid #e7e5e4", borderRadius: "8px", margin: "0 auto", maxWidth: "480px", padding: "32px" },
  mark: { color: "#78716c", fontSize: "12px", letterSpacing: "1.5px", margin: 0, textTransform: "uppercase" as const },
  h1: { color: "#1c1917", fontSize: "20px", fontWeight: 600, margin: "8px 0 16px" },
  text: { color: "#57534e", fontSize: "14px", lineHeight: "21px", margin: "0 0 20px" },
  cta: { backgroundColor: "#1c1917", borderRadius: "6px", color: "#ffffff", display: "inline-block", fontSize: "14px", fontWeight: 600, padding: "12px 22px", textDecoration: "none" },
  foot: { color: "#a8a29e", fontSize: "12px", lineHeight: "18px", margin: "20px 0 0" },
};

export function MagicLink({ url, expiresMinutes = 15 }: { url: string; expiresMinutes?: number }) {
  return (
    <Html>
      <Head />
      <Preview>Your Defenex sign-in link</Preview>
      <Body style={styles.body}>
        <Container style={styles.container}>
          <Text style={styles.mark}>Defenex</Text>
          <Heading style={styles.h1}>Sign in</Heading>
          <Text style={styles.text}>
            This link signs you in and expires in {expiresMinutes} minutes. It can only be
            used once.
          </Text>
          <Link href={url} style={styles.cta}>Sign in to Defenex</Link>
          <Text style={styles.foot}>
            If you did not ask to sign in, ignore this email — nobody can access your
            account without this link.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}

export default MagicLink;
