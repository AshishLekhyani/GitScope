import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Compare Repositories — GitScope",
  description: "Side-by-side comparison of GitHub repositories by stars, activity, and health.",
};

export default function CompareLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
