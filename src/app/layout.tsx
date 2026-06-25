import type { Metadata } from "next";
import { Inter, Inter_Tight } from "next/font/google";
import "./globals.css";
import { AuthSessionProvider } from "@/components/session-provider";

// Body + display run the same Inter family at modest weights — the Airtable
// system prefers size and color contrast over heavy weight. Inter is the
// closest open substitute for Haas Grotesk.
const inter = Inter({
  subsets: ["latin"],
  variable: "--font-body",
  display: "swap",
});

// Display — Inter Tight stands in for Haas Groot Disp: tighter, editorial.
const interTight = Inter_Tight({
  subsets: ["latin"],
  variable: "--font-display",
  weight: ["400", "500", "600"],
  display: "swap",
});

// Figures / labels — Inter again (tabular nums) so numbers align cleanly.
const interMono = Inter({
  subsets: ["latin"],
  variable: "--font-mono",
  weight: ["400", "500", "600"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Sourcing Tracker · Lazer Believe",
  description: "Gated China sourcing & import control — every rupee passes a gate.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${interTight.variable} ${interMono.variable}`}
    >
      <body className="min-h-screen bg-base font-body text-body antialiased">
        <AuthSessionProvider>{children}</AuthSessionProvider>
      </body>
    </html>
  );
}
