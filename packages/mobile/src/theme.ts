/**
 * Tema — sistem temasına uyumlu (koyu + açık palet).
 * Bileşenler renkleri useTheme() üzerinden alır; stiller dinamik kurulur.
 */
import { useColorScheme } from "react-native";

export interface Palette {
  bg: string;
  surface: string;
  surfaceAlt: string;
  border: string;
  text: string;
  textDim: string;
  primary: string;
  primaryText: string;
  success: string;
  warn: string;
  danger: string;
  chipOff: string;
  /** Yarı saydam uyarı/sonuç zeminleri. */
  okBg: string;
  errorBg: string;
  warnBg: string;
}

const dark: Palette = {
  bg: "#0b0e1a",
  surface: "#161a2b",
  surfaceAlt: "#1f2438",
  border: "#2a3050",
  text: "#f3f5ff",
  textDim: "#9aa3c7",
  primary: "#6c8bff",
  primaryText: "#ffffff",
  success: "#3ecf8e",
  warn: "#f5b14c",
  danger: "#ff6b6b",
  chipOff: "#232a44",
  okBg: "rgba(62,207,142,0.15)",
  errorBg: "rgba(255,107,107,0.15)",
  warnBg: "rgba(245,177,76,0.15)",
};

const light: Palette = {
  bg: "#f4f6fb",
  surface: "#ffffff",
  surfaceAlt: "#eef1f9",
  border: "#dde2f0",
  text: "#171c2e",
  textDim: "#6b7494",
  primary: "#4f6ef7",
  primaryText: "#ffffff",
  success: "#13a06b",
  warn: "#c97f12",
  danger: "#d94848",
  chipOff: "#e6eaf6",
  okBg: "rgba(19,160,107,0.12)",
  errorBg: "rgba(217,72,72,0.12)",
  warnBg: "rgba(201,127,18,0.12)",
};

export const radius = { sm: 8, md: 14, lg: 22, pill: 999 } as const;

/** Kişi rozetleri için sabit, her iki temada da okunaklı renkler. */
export const personColors = [
  "#6c8bff",
  "#2fb47f",
  "#e09a2f",
  "#e76a6a",
  "#a06ee8",
  "#3aa7c9",
  "#e87fa0",
  "#7fae5a",
] as const;

export function personColor(index: number): string {
  return personColors[index % personColors.length] as string;
}

/** Sistem temasına göre aktif paleti döndürür. */
export function useTheme(): { colors: Palette; isDark: boolean } {
  const scheme = useColorScheme();
  const isDark = scheme !== "light";
  return { colors: isDark ? dark : light, isDark };
}
