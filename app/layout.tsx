import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Leash: guardrails for AI shopping agents",
  description: "Let an AI agent shop for you with PayPal, inside spending rules it cannot break.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
