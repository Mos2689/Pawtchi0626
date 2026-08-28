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
  Row,
  Column,
  Hr,
  Link,
} from "npm:@react-email/components@0.0.12";

interface WeeklySummaryProps {
  ownerName?: string;
  petName?: string;
  weekRange?: string;
  /**
   * One sentence derived from the owner's real numbers, or null when the data
   * does not support one. Never write a fixed string here.
   */
  insight?: string | null;
  stats?: {
    caloriesConsumed: number;
    calorieGoal: number;
    activitiesLogged: number;
    daysLogged?: number;
  };
}

export const WeeklySummaryEmail = ({
  ownerName = "there",
  // Not "your pet": Copy Spec v1 requires the animal's name. A digest that
  // cannot name the animal should not be sent, and the candidate query
  // guarantees one, so this default is only ever a preview placeholder.
  petName = "Milo",
  weekRange = "this past week",
  insight = null,
  stats = {
    caloriesConsumed: 4500,
    calorieGoal: 4200,
    activitiesLogged: 7,
    daysLogged: 6,
  },
}: WeeklySummaryProps) => {
  const daysLogged = stats.daysLogged ?? 0;

  return (
    <Html>
      <Head />
      <Preview>{petName}'s week, in numbers.</Preview>
      <Body style={main}>
        <Container style={container}>
          {/* Header */}
          <Section style={header}>
            <Text style={logoText}>Pawtchi</Text>
            <Text style={weekText}>Weekly recap: {weekRange}</Text>
          </Section>

          {/* Intro Section */}
          <Section style={heroSection}>
            <Text style={heading}>{ownerName}, here is {petName}'s week</Text>
            <Text style={paragraph}>
              {daysLogged} of the last seven days have logs against them. Here is what they add up to.
            </Text>
          </Section>

          {/* Stats Grid */}
          <Section style={statsContainer}>
            <Row>
              <Column style={statCard}>
                <Text style={statLabel}>Calories logged</Text>
                <Text style={statValue}>{stats.caloriesConsumed.toLocaleString()}</Text>
                <Text style={statSubvalue}>
                  {stats.calorieGoal > 0 ? `Target: ${stats.calorieGoal.toLocaleString()}` : "No target set"}
                </Text>
              </Column>
              <Column style={statCardRight}>
                <Text style={statLabel}>Walks logged</Text>
                <Text style={statValue}>{stats.activitiesLogged}</Text>
                <Text style={statSubvalue}>{daysLogged} days logged</Text>
              </Column>
            </Row>
          </Section>

          {/*
            Derived from the owner's actual numbers by notify-weekly-digest, and
            omitted entirely when the data does not support a claim. This block
            used to be a hardcoded string telling every single owner their
            animal was "slightly over the weekly calorie goal", regardless of
            what they had logged.
          */}
          {insight ? (
            <Section style={insightSection}>
              <Text style={insightHeading}>What stood out</Text>
              <Text style={insightText}>{insight}</Text>
            </Section>
          ) : null}

          {/* Action Button */}
          <Section style={buttonContainer}>
            <Button style={button} href="https://pawtchi.com/app/health">
              Open the dashboard
            </Button>
          </Section>

          <Hr style={divider} />

          {/* Footer */}
          <Section style={footer}>
            <Text style={footerText}>
              To stop these, turn off the weekly recap in <Link href="https://pawtchi.com/app/settings" style={link}>notification settings</Link>.
            </Text>
            <Text style={footerCopyright}>
              © 2026 Hey Living Club Pty Ltd. All rights reserved.
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
};

// Styles
const main = {
  backgroundColor: "#f6f9fc",
  fontFamily:
    '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Ubuntu,sans-serif',
};

const container = {
  backgroundColor: "#ffffff",
  margin: "0 auto",
  padding: "20px 0 48px",
  marginBottom: "64px",
  borderRadius: "12px",
  boxShadow: "0 4px 12px rgba(0, 0, 0, 0.05)",
  maxWidth: "600px",
};

const header = {
  padding: "0 48px",
  textAlign: "center" as const,
  borderBottom: "1px solid #f1f5f9",
  paddingBottom: "20px",
  marginBottom: "20px",
};

const logoText = {
  fontSize: "24px",
  fontWeight: "bold",
  color: "#F4F600",
  margin: "0",
};

const weekText = {
  fontSize: "14px",
  color: "#6b7280",
  margin: "4px 0 0",
};

const heroSection = {
  padding: "0 48px",
  textAlign: "center" as const,
};

const heading = {
  fontSize: "22px",
  lineHeight: "1.3",
  fontWeight: "800",
  color: "#1f2937",
  margin: "0 0 12px",
};

const paragraph = {
  margin: "0 0 24px",
  fontSize: "15px",
  lineHeight: "1.5",
  color: "#4b5563",
};

const statsContainer = {
  padding: "0 48px",
  marginBottom: "24px",
};

const statCard = {
  backgroundColor: "#f8fafc",
  padding: "20px",
  borderRadius: "12px",
  marginRight: "8px",
  textAlign: "center" as const,
  width: "48%",
};

const statCardRight = {
  ...statCard,
  marginRight: "0",
  marginLeft: "8px",
};

const statLabel = {
  fontSize: "13px",
  fontWeight: "bold",
  color: "#6b7280",
  textTransform: "uppercase" as const,
  letterSpacing: "0.5px",
  margin: "0 0 8px",
};

const statValue = {
  fontSize: "28px",
  fontWeight: "bold",
  color: "#1f2937",
  margin: "0 0 4px",
};

const statSubvalue = {
  fontSize: "13px",
  color: "#10b981", // Success green
  margin: "0",
};

const insightSection = {
  margin: "0 48px 32px",
  padding: "20px",
  backgroundColor: "#fef3c7", // Light yellow background
  borderRadius: "12px",
  borderLeft: "4px solid #f59e0b", // Pawtchi amber
};

const insightHeading = {
  fontSize: "16px",
  fontWeight: "bold",
  color: "#b45309",
  margin: "0 0 8px",
};

const insightText = {
  fontSize: "14px",
  color: "#92400e",
  margin: "0",
  lineHeight: "1.5",
};

const buttonContainer = {
  padding: "0 48px",
  textAlign: "center" as const,
};

const button = {
  backgroundColor: "#1f2937",
  borderRadius: "8px",
  color: "#ffffff",
  fontSize: "16px",
  fontWeight: "bold",
  textDecoration: "none",
  textAlign: "center" as const,
  display: "block",
  width: "100%",
  padding: "14px 20px",
};

const divider = {
  borderColor: "#e5e7eb",
  margin: "32px 48px",
};

const footer = {
  padding: "0 48px",
  textAlign: "center" as const,
};

const footerText = {
  fontSize: "13px",
  lineHeight: "20px",
  color: "#6b7280",
};

const link = {
  color: "#3b82f6",
  textDecoration: "underline",
};

const footerCopyright = {
  fontSize: "12px",
  color: "#d1d5db",
  marginTop: "16px",
};

export default WeeklySummaryEmail;
