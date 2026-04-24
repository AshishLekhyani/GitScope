import type { Metadata } from "next";
import { JetBrains_Mono, Space_Grotesk, Instrument_Serif } from "next/font/google";
import { getServerSession } from "next-auth/next";
import { unstable_rethrow } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { AppProviders } from "@/providers/app-providers";
import { ThemeProvider } from "@/providers/theme-provider";
import "./globals.css";

const instrumentSerif = Instrument_Serif({
  variable: "--font-instrument-serif",
  subsets: ["latin"],
  weight: ["400"],
  style: ["normal", "italic"],
});

const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

const APP_URL = (process.env.NEXTAUTH_URL ?? "https://git-scope-pi.vercel.app").replace(/\/$/, "");

export const metadata: Metadata = {
  metadataBase: new URL(APP_URL),
  title: {
    default: "GitScope — Engineering Intelligence Platform",
    template: "%s · GitScope",
  },
  description:
    "AI-powered GitHub analytics. Commit velocity, contributor insights, code health scores, DORA metrics, and security scans — for engineering teams that ship.",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/icon.png", type: "image/png" },
    ],
    apple: "/apple-icon.png",
    shortcut: "/icon.png",
  },
  openGraph: {
    type: "website",
    url: APP_URL,
    siteName: "GitScope",
    title: "GitScope — Engineering Intelligence Platform",
    description:
      "AI-powered GitHub analytics. Commit velocity, contributor insights, code health scores, DORA metrics, and security scans — for engineering teams that ship.",
    images: [{ url: "/opengraph-image", width: 1200, height: 630, alt: "GitScope" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "GitScope — Engineering Intelligence Platform",
    description:
      "AI-powered GitHub analytics. Commit velocity, contributor insights, code health scores, DORA metrics, and security scans — for engineering teams that ship.",
    images: ["/opengraph-image"],
  },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  let session = null;
  try {
    session = await getServerSession(authOptions);
  } catch (error) {
    unstable_rethrow(error);
    console.warn("Auth session check skipped during build or db connection issue:", error);
  }

  return (
    <html lang="en" suppressHydrationWarning>
      <body
        suppressHydrationWarning
        className={`${spaceGrotesk.variable} ${jetbrainsMono.variable} ${instrumentSerif.variable} min-h-screen bg-background font-mono text-foreground antialiased selection:bg-primary/30 selection:text-foreground`}
      >
        <ThemeProvider>
          <AppProviders session={session}>{children}</AppProviders>
        </ThemeProvider>
      </body>
    </html>
  );
}
// Root layout - Space Grotesk + JetBrains Mono loaded
// favicon metadata: icon.png + apple-icon.png
