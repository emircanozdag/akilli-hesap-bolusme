import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import type { ScanPhase } from "./api";
import {
  scanProgressHint,
  scanProgressPercent,
  scanProgressStep,
} from "./scan-progress";
import { radius, type Palette } from "./theme";

export interface ScanProgressBarProps {
  colors: Palette;
  phase: ScanPhase;
  streamItemCount?: number;
  analyzingStartedAt?: number;
  /** analyzing fazında yüzdeyi periyodik yenile (zaman rampası). */
  animate?: boolean;
}

export function ScanProgressBar({
  colors,
  phase,
  streamItemCount = 0,
  analyzingStartedAt,
  animate = true,
}: ScanProgressBarProps) {
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!animate || phase !== "analyzing") return;
    const id = setInterval(() => setTick((t) => t + 1), 800);
    return () => clearInterval(id);
  }, [animate, phase]);

  const step = scanProgressStep(phase);
  const percent = scanProgressPercent({
    phase,
    streamItemCount,
    analyzingStartedAt,
  });
  const hint = scanProgressHint({ phase, streamItemCount, analyzingStartedAt });

  if (!step) return null;

  void tick;

  return (
    <View style={styles.wrap} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: percent }}>
      <View style={styles.head}>
        <ActivityIndicator size="small" color={colors.primary} />
        <View style={styles.headText}>
          <Text style={styles.stepLabel}>
            Adım {step.current} / {step.total} — {step.label}
          </Text>
          {hint ? <Text style={styles.hint}>{hint}</Text> : null}
        </View>
        <Text style={styles.percent}>{percent}%</Text>
      </View>
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${percent}%` }]} />
      </View>
    </View>
  );
}

function makeStyles(c: Palette) {
  return StyleSheet.create({
    wrap: { gap: 8, alignSelf: "stretch" },
    head: { flexDirection: "row", alignItems: "center", gap: 10 },
    headText: { flex: 1, gap: 2 },
    stepLabel: { color: c.text, fontSize: 14, fontWeight: "600" },
    hint: { color: c.textDim, fontSize: 12 },
    percent: { color: c.primary, fontSize: 14, fontWeight: "800", minWidth: 40, textAlign: "right" },
    track: {
      height: 6,
      borderRadius: radius.pill,
      backgroundColor: c.chipOff,
      overflow: "hidden",
    },
    fill: {
      height: "100%",
      borderRadius: radius.pill,
      backgroundColor: c.primary,
    },
  });
}
