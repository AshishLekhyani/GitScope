"use client";

import { cn } from "@/lib/utils";

interface RadiatingDotProps {
  /** Size of the dot in pixels (default: 8) */
  size?: number;
  /** Color class for the dot (default: "bg-emerald-400") */
  color?: string;
  /** Animation intensity: "subtle" | "normal" | "intense" (default: "normal") */
  intensity?: "subtle" | "normal" | "intense";
  /** Position: absolute positioning relative to parent (default: top-right) */
  position?: "top-right" | "top-left" | "bottom-right" | "bottom-left" | "center";
  /** Additional CSS classes */
  className?: string;
}

/**
 * Radiating Dot Component
 * 
 * Displays an animated pulsing dot with concentric rings that radiate outward.
 * Used to indicate new updates, notifications, or attention-required states.
 * 
 * @example
 * // In navigation bar, top-right of icon:
 * <div className="relative">
 *   <HelpIcon />
 *   <RadiatingDot position="top-right" />
 * </div>
 */
export function RadiatingDot({
  size = 8,
  color = "bg-emerald-400",
  intensity = "normal",
  position = "top-right",
  className,
}: RadiatingDotProps) {
  const intensityConfig = {
    subtle: {
      pingDuration: "1.5s",
      scale: 1.5,
      opacity: 0.4,
    },
    normal: {
      pingDuration: "1s",
      scale: 2,
      opacity: 0.75,
    },
    intense: {
      pingDuration: "0.7s",
      scale: 2.5,
      opacity: 0.9,
    },
  };

  const config = intensityConfig[intensity];

  const positionClasses = {
    "top-right": "-top-0.5 -right-0.5",
    "top-left": "-top-0.5 -left-0.5",
    "bottom-right": "-bottom-0.5 -right-0.5",
    "bottom-left": "-bottom-0.5 -left-0.5",
    center: "top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2",
  };

  return (
    <span
      className={cn(
        "absolute z-10 flex items-center justify-center pointer-events-none",
        positionClasses[position],
        className
      )}
      style={{ width: size, height: size }}
    >
      {/* Outer radiating ring */}
      <span
        className={cn(
          "absolute inline-flex h-full w-full rounded-full opacity-75 animate-ping",
          color
        )}
        style={{
          animationDuration: config.pingDuration,
        }}
      />
      
      {/* Middle ring (slightly delayed) */}
      <span
        className={cn(
          "absolute inline-flex h-full w-full rounded-full opacity-50 animate-ping",
          color
        )}
        style={{
          animationDuration: config.pingDuration,
          animationDelay: "0.3s",
        }}
      />
      
      {/* Core dot */}
      <span
        className={cn(
          "relative inline-flex rounded-full",
          color
        )}
        style={{
          width: size,
          height: size,
          boxShadow: `0 0 ${size}px currentColor`,
        }}
      />
    </span>
  );
}

/**
 * Static Dot variant (no animation) for less urgent notifications
 */
export function StaticDot({
  size = 8,
  color = "bg-emerald-400",
  position = "top-right",
  className,
}: Omit<RadiatingDotProps, "intensity">) {
  const positionClasses = {
    "top-right": "-top-0.5 -right-0.5",
    "top-left": "-top-0.5 -left-0.5",
    "bottom-right": "-bottom-0.5 -right-0.5",
    "bottom-left": "-bottom-0.5 -left-0.5",
    center: "top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2",
  };

  return (
    <span
      className={cn(
        "absolute z-10 rounded-full pointer-events-none",
        positionClasses[position],
        color,
        className
      )}
      style={{
        width: size,
        height: size,
        boxShadow: `0 0 ${size}px currentColor`,
      }}
    />
  );
}
