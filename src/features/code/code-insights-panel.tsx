"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import dynamic from "next/dynamic";
import { useTheme } from "next-themes";

const MonacoEditor = dynamic(() => import("@monaco-editor/react"), {
  ssr: false,
  loading: () => (
    <div className="bg-muted/40 h-[320px] w-full animate-pulse rounded-none" />
  ),
});

export function CodeInsightsPanel({
  languagesJson,
}: {
  languagesJson: string;
}) {
  const { resolvedTheme } = useTheme();
  const dark = resolvedTheme === "dark";

  return (
    <Card>
      <CardHeader>
        <CardTitle>Raw languages payload</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-hidden rounded-none border">
          <MonacoEditor
            height="320px"
            defaultLanguage="json"
            theme={dark ? "vs-dark" : "light"}
            value={languagesJson}
            options={{
              readOnly: true,
              minimap: { enabled: true },
              folding: true,
              fontSize: 13,
              wordWrap: "on",
            }}
          />
        </div>
        <p className="text-muted-foreground mt-3 text-xs">
          Monaco provides VS Code–style editing, folding, and the minimap. Pair
          with Shiki for static HTML highlights in marketing pages.
        </p>
      </CardContent>
    </Card>
  );
}
