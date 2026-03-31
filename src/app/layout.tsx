import type { Metadata } from "next";
import { Inter, JetBrains_Mono, Space_Grotesk } from "next/font/google";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { AppProviders } from "@/providers/app-providers";
import { ThemeProvider } from "@/providers/theme-provider";
import "./globals.css";

const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: {
    default: "GitScope — GitHub analytics dashboard",
    template: "%s · GitScope",
  },
  description:
    "Search repositories, explore contributors, languages, and commit activity with a polished analytics UI.",
  icons: {
    icon: "/icon.png",
    apple: "/apple-icon.png",
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
    console.warn("Auth session check skipped during build or db connection issue:", error);
  }

  return (
    <html lang="en" suppressHydrationWarning>
      <body
        suppressHydrationWarning
        className={`${inter.variable} ${spaceGrotesk.variable} ${jetbrainsMono.variable} min-h-screen bg-background font-sans text-foreground antialiased selection:bg-primary/30 selection:text-foreground`}
      >
        <ThemeProvider>
          <AppProviders session={session}>{children}</AppProviders>
        </ThemeProvider>
      </body>
    </html>
  );
}
// Root layout - Space Grotesk + Inter loaded
// favicon metadata: icon.png + apple-icon.png
