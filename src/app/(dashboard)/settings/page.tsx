import { SettingsPanel } from "@/features/settings/settings-panel";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Settings",
};

export default function SettingsPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Profile, account security, appearance, and workspace preferences.
        </p>
      </div>
      <SettingsPanel />
    </div>
  );
}
