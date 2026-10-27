import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Agent Nexus V2 | SMC Trading Agent",
  description: "Autonomous SMC Trading Agent with Gemini AI Analyst",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
