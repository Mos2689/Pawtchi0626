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
  stats?: {
    caloriesConsumed: number;
    calorieGoal: number;
    activitiesLogged: number;
    waterIntakeScore: string; 
  };
}

export const WeeklySummaryEmail = ({
  ownerName = "there",
  petName = "your pet",
  weekRange = "this past week",
  stats = {
    caloriesConsumed: 4500,
    calorieGoal: 4200,
    activitiesLogged: 7,
    waterIntakeScore: "Excellent",
  },
}: WeeklySummaryProps) => {
  // Simple logic to see if they hit their activity goal
  const activityStatus = stats.activitiesLogged >= 5 ? "On target" : "Room to improve";

  return (
    <Html>
      <Head />
      <Preview>{petName}'s weekly health summary is ready.</Preview>
      <Body style={main}>
        <Container style={container}>
          {/* Header */}
          <Section style={header}>
            <Text style={logoText}>Pawtchi</Text>
            <Text style={weekText}>Weekly Summary: {weekRange}</Text>
          </Section>

          {/* Intro Section */}
          <Section style={heroSection}>
            <Text style={heading}>Hey {ownerName}, here is {petName}'s week in review!</Text>
            <Text style={paragraph}>
              Tracking nutrition and activity consistently is the best way to ensure {petName} lives a long, healthy life. Let's look at the numbers.
            </Text>
          </Section>

          {/* Stats Grid */}
          <Section style={statsContainer}>
            <Row>
              <Column style={statCard}>
                <Text style={statLabel}>Calories Consumed</Text>
                <Text style={statValue}>{stats.caloriesConsumed.toLocaleString()}</Text>
                <Text style={statSubvalue}>Goal: {stats.calorieGoal.toLocaleString()}</Text>
              </Column>
              <Column style={statCardRight}>
                <Text style={statLabel}>Activities Logged</Text>
                <Text style={statValue}>{stats.activitiesLogged}</Text>
                <Text style={statSubvalue}>{activityStatus}</Text>
              </Column>
            </Row>
          </Section>

          <Section style={insightSection}>
            <Text style={insightHeading}>What we noticed this week</Text>
            <Text style={insightText}>
              {petName} is slightly over the weekly calorie goal. Extending the evening walk by 10 minutes would help balance the intake.
            </Text>
          </Section>

          {/* Action Button */}
          <Section style={buttonContainer}>
            <Button style={button} href="https://pawtchi.com/app/health">
              View Full Dashboard
            </Button>
          </Section>

          <Hr style={divider} />

          {/* Footer */}
          <Section style={footer}>
            <Text style={footerText}>
              Keep up the great work. If you want to unsubscribe from weekly summaries, you can adjust your <Link href="https://pawtchi.com/app/settings" style={link}>notification preferences</Link>.
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
  color: "#FACC15", 
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
