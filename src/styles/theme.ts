import { Platform } from "react-native";

export const THEME = {
  colors: {
    // Neutral charcoal accent — a clean grey/white palette, no color.
    primary: "#1f2937",
    primaryLight: "#4b5563",
    background: "#ffffff",
    backgroundSecondary: "#f8fafc",
    surface: "#f1f5f9",
    border: "#e2e8f0",
    text: "#0f172a",
    textSecondary: "#64748b",
    textMuted: "#94a3b8",
    annotation: "#fef08a",
    annotationBorder: "#eab308",
    success: "#22c55e",
    error: "#ef4444",
    warning: "#f59e0b",
  },
  spacing: {
    xs: 4,
    sm: 8,
    md: 12,
    lg: 16,
    xl: 24,
    xxl: 32,
  },
  radii: {
    sm: 6,
    md: 8,
    lg: 12,
    xl: 16,
    full: 9999,
  },
  fonts: {
    sans: Platform.select({ web: "Inter, system-ui, sans-serif", default: "System" }) as string,
    mono: Platform.select({ web: "JetBrains Mono, monospace", default: "Courier" }) as string,
  },
} as const;
