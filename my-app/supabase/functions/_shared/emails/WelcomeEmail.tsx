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
  Img,
  Link,
  Hr,
} from "npm:@react-email/components@0.0.12";

interface WelcomeEmailProps {
  ownerName?: string;
  petName?: string;
}

export const WelcomeEmail = ({
  ownerName = "there",
  petName = "your furry friend",
}: WelcomeEmailProps) => {
  return (
    <Html>
      <Head />
      <Preview>Welcome to the Pack! Let's get {petName} on tracking.</Preview>
      <Body style={main}>
        <Container style={container}>
          {/* Header */}
          <Section style={header}>
            <Text style={logoText}>Pawtchi</Text>
          </Section>

          {/* Intro Section */}
          <Section style={heroSection}>
            <Text style={heading}>Welcome to the Pack, {ownerName}! 🐾</Text>
            <Text style={paragraph}>
              We're thrilled to have you and <strong>{petName}</strong> join Pawtchi. 
              Our mission is to help you track meals, monitor vitals, and ensure {petName} 
              is living their happiest, healthiest life.
            </Text>
          </Section>

          {/* Quick Start Guide */}
          <Section style={guideSection}>
            <Text style={subheading}>Your First 3 Steps:</Text>
            
            <Text style={listItem}>
              <strong>1. Complete {petName}'s Profile</strong>
              <br />
              <span style={lighterText}>Add their breed, age, and weight to get accurate daily calorie targets.</span>
            </Text>
            
            <Text style={listItem}>
              <strong>2. Log a Meal</strong>
              <br />
              <span style={lighterText}>Scan a barcode or search our database to start tracking nutrition instantly.</span>
            </Text>
            
            <Text style={listItem}>
              <strong>3. Set an Activity Goal</strong>
              <br />
              <span style={lighterText}>Whether it's a 30-minute walk or a game of fetch, daily movement is key!</span>
            </Text>
          </Section>

          {/* Action Button */}
          <Section style={buttonContainer}>
            <Button style={button} href="https://pawtchi.com/app">
              Open Pawtchi Now
            </Button>
          </Section>

          <Hr style={divider} />

          {/* Footer */}
          <Section style={footer}>
            <Text style={footerText}>
              Have questions? Just hit reply to this email, and our support team will help you out.
            </Text>
            <Text style={footerLinks}>
              <Link href="https://pawtchi.com/privacy" style={link}>Privacy Policy</Link> •{" "}
              <Link href="https://pawtchi.com/terms" style={link}>Terms of Service</Link>
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
};

const logoText = {
  fontSize: "28px",
  fontWeight: "bold",
  color: "#FACC15", // Pawtchi Yellow
  margin: "20px 0",
};

const heroSection = {
  padding: "0 48px",
};

const heading = {
  fontSize: "24px",
  letterSpacing: "-0.5px",
  lineHeight: "1.3",
  fontWeight: "800",
  color: "#1f2937", // Gray-800
  padding: "17px 0 0",
};

const paragraph = {
  margin: "0 0 15px",
  fontSize: "16px",
  lineHeight: "1.5",
  color: "#4b5563", // Gray-600
};

const guideSection = {
  padding: "24px 48px",
  backgroundColor: "#fcfcfc",
  borderTop: "1px solid #f1f5f9",
  borderBottom: "1px solid #f1f5f9",
};

const subheading = {
  fontSize: "18px",
  fontWeight: "bold",
  color: "#1f2937",
  marginBottom: "16px",
};

const listItem = {
  fontSize: "15px",
  lineHeight: "1.5",
  color: "#1f2937",
  marginBottom: "16px",
};

const lighterText = {
  color: "#6b7280",
};

const buttonContainer = {
  padding: "32px 48px",
  textAlign: "center" as const,
};

const button = {
  backgroundColor: "#1f2937", // Dark button
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
  margin: "0 48px",
};

const footer = {
  padding: "32px 48px 0",
  textAlign: "center" as const,
};

const footerText = {
  fontSize: "14px",
  lineHeight: "24px",
  color: "#6b7280",
};

const footerLinks = {
  fontSize: "13px",
  color: "#9ca3af",
  marginTop: "16px",
};

const link = {
  color: "#9ca3af",
  textDecoration: "underline",
};

const footerCopyright = {
  fontSize: "12px",
  color: "#d1d5db",
  marginTop: "8px",
};

export default WelcomeEmail;
