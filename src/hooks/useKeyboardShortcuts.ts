"use client";

import { useEffect, useRef } from "react";

export function useKeyboardShortcuts(
  map: Record<string, (e: KeyboardEvent) => void>
) {
  const mapRef = useRef(map);

  useEffect(() => {
    mapRef.current = map;
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const parts: string[] = [];
      if (e.metaKey || e.ctrlKey) parts.push("mod");
      if (e.shiftKey) parts.push("shift");
      if (e.altKey) parts.push("alt");
      parts.push(e.key.toLowerCase());
      const combo = parts.join("+");
      const handler = mapRef.current[combo];
      if (handler) {
        e.preventDefault();
        handler(e);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
