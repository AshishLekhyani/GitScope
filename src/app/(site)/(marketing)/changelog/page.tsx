import type { Metadata } from "next";
import { ChangelogContent } from "./changelog-content";

export const metadata: Metadata = {
  title: "Changelog — GitScope",
  description:
    "Full version history for GitScope. See every new feature, improvement, and fix across all releases from v0.1.0.0 to v1.0.0.0.",
};

export default function ChangelogPage() {
  return <ChangelogContent />;
}
