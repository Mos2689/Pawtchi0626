import React from "npm:react@18.2.0";
import {
  Html,
  Head,
  Body,
  Container,
  Text,
  Button,
  Preview,
  Section,
  Hr,
  Link,
} from "npm:@react-email/components@0.0.12";

/**
 * The one owner-facing email template.
 *
 * Every campaign renders through this. `lib/email/copy.ts` already produces a
 * heading, an ordered list of paragraphs and a single call to action, so a
 * per-campaign template would only ever be that same structure with different
 * padding — and it would mean a new campaign needs a new file, a new import and
 * a new branch in send-email. It does not. A campaign is a rules entry plus a
 * copy entry, and this renders it.
 *
 * ── Brand ───────────────────────────────────────────────────────────────────
 *
 * Tokens are copied literally from constants/design.ts rather than imported:
 * this file is compiled by the Deno edge runtime, and design.ts imports
 * `Platform` from react-native. The values are duplicated deliberately and
 * marked, which is the same trade _shared/hydration.ts makes.
 *
 * The contrast rule from the brand book is load-bearing here: yellow is never
 * ink on white. It appears only as a filled block behind navy text — the CTA
 * button and nothing else. Older email templates used off-brand yellow and
 * amber values, neither of which belongs in a brand-yellow role.
 */

// ── Brand tokens (mirrored from constants/design.ts) ───────────────────────
const NAVY = "#07202A";
const YELLOW = "#F4F600";
const CREAM = "#F4F1EC";
const SURFACE = "#FFFFFF";
const SURFACE_SUBTLE = "#F8F7F4";
const INK = "#0f172a";
const SLATE = "#475569";
const SLATE_MUTED = "#64748b";
const HAIRLINE = "#eef2f6";

export interface CampaignEmailProps {
  heading?: string;
  /** Paragraphs, rendered in order. */
  body?: string[];
  preheader?: string;
  ctaLabel?: string;
  /** Absolute https URL. A universal link, so it opens the app when installed. */
  ctaUrl?: string;
  /** One-click unsubscribe target. Omitted for transactional mail. */
  unsubscribeUrl?: string | null;
  /** What the owner is leaving, e.g. "walk reports". */
  unsubscribeLabel?: string;
}

export const CampaignEmail = ({
  heading = "",
  body = [],
  preheader = "",
  ctaLabel = "Open Pawtchi",
  ctaUrl = "https://pawtchi.com",
  unsubscribeUrl = null,
  unsubscribeLabel = "these emails",
}: CampaignEmailProps) => (
  <Html>
    <Head />
    {/* The grey line clients show beside the subject. copy.ts guarantees this
        is never a repeat of the subject — it is the second hook, not an echo. */}
    <Preview>{preheader}</Preview>
    <Body style={main}>
      <Container style={container}>
        <Section style={header}>
          <Text style={logo}>Pawtchi</Text>
        </Section>

        <Section style={content}>
          <Text style={headingStyle}>{heading}</Text>
          {body.map((paragraph, i) => (
            <Text key={i} style={paragraphStyle}>
              {paragraph}
            </Text>
          ))}
        </Section>

        <Section style={buttonWrap}>
          <Button style={button} href={ctaUrl}>
            {ctaLabel}
          </Button>
        </Section>

        <Hr style={divider} />

        <Section style={footer}>
          {/* A visible link is still required alongside the List-Unsubscribe
              headers — the headers satisfy the machines, this satisfies the
              person who went looking for it. Absent on transactional mail. */}
          {unsubscribeUrl ? (
            <Text style={footerText}>
              Do not want {unsubscribeLabel}?{" "}
              <Link href={unsubscribeUrl} style={link}>
                Unsubscribe
              </Link>
              .
            </Text>
          ) : null}
          <Text style={footerFine}>
            Hey Living Club Pty Ltd
          </Text>
        </Section>
      </Container>
    </Body>
  </Html>
);

const main = {
  backgroundColor: SURFACE_SUBTLE,
  fontFamily:
    '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Ubuntu,sans-serif',
  margin: 0,
  padding: 0,
};

const container = {
  backgroundColor: SURFACE,
  margin: "0 auto",
  maxWidth: "560px",
  borderRadius: "16px",
  overflow: "hidden" as const,
  marginTop: "32px",
  marginBottom: "48px",
};

// The one navy block. A brand moment at the top, then an operational white
// surface for the content — the two-surface split the app itself uses.
const header = {
  backgroundColor: NAVY,
  padding: "24px 32px",
};

const logo = {
  color: CREAM,
  fontSize: "18px",
  fontWeight: "700",
  letterSpacing: "-0.01em",
  margin: 0,
};

const content = {
  padding: "32px 32px 8px",
};

const headingStyle = {
  fontSize: "24px",
  lineHeight: "1.3",
  fontWeight: "700",
  letterSpacing: "-0.02em",
  color: INK,
  margin: "0 0 20px",
};

const paragraphStyle = {
  fontSize: "16px",
  lineHeight: "1.65",
  color: SLATE,
  margin: "0 0 16px",
};

const buttonWrap = {
  padding: "16px 32px 8px",
};

// Yellow as a filled block behind navy text. Never yellow ink.
const button = {
  backgroundColor: YELLOW,
  borderRadius: "12px",
  color: NAVY,
  fontSize: "16px",
  fontWeight: "700",
  textDecoration: "none",
  textAlign: "center" as const,
  display: "block",
  padding: "16px 20px",
};

const divider = {
  borderColor: HAIRLINE,
  margin: "32px 32px 0",
};

const footer = {
  padding: "20px 32px 32px",
};

const footerText = {
  fontSize: "13px",
  lineHeight: "1.6",
  color: SLATE_MUTED,
  margin: "0 0 8px",
};

const footerFine = {
  fontSize: "12px",
  color: "#94a3b8",
  margin: 0,
};

const link = {
  color: SLATE_MUTED,
  textDecoration: "underline",
};

export default CampaignEmail;
