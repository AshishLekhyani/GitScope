import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Action Items — GitScope",
  description: "Track and resolve security findings and code quality issues across your repositories.",
};

export default function BookmarksLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
