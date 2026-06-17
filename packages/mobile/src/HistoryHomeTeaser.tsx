import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { formatCents } from "./logic";
import {
  formatRelativeTime,
  getHistoryStore,
  statusLabel,
  type ReceiptSummary,
} from "./history/index";
import { radius, type Palette } from "./theme";

const PREVIEW_LIMIT = 2;

export interface HistoryHomeTeaserProps {
  colors: Palette;
  /** Modal kapandığında artır — liste yenilenir. */
  refreshToken: number;
  onOpenAll: () => void;
  onSelect: (summary: ReceiptSummary) => void;
}

export function HistoryHomeTeaser({
  colors,
  refreshToken,
  onOpenAll,
  onSelect,
}: HistoryHomeTeaserProps) {
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [rows, setRows] = useState<ReceiptSummary[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const store = await getHistoryStore();
      setRows(await store.listSummaries());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh, refreshToken]);

  const previews = rows.slice(0, PREVIEW_LIMIT);
  const total = rows.length;
  const latest = rows[0];

  if (loading && total === 0) {
    return (
      <View style={styles.wrap}>
        <View style={[styles.card, styles.cardMuted]}>
          <ActivityIndicator size="small" color={colors.primary} />
        </View>
      </View>
    );
  }

  if (total === 0) {
    return (
      <View style={styles.wrap}>
        <View style={[styles.card, styles.cardMuted]}>
          <View style={styles.iconCircle}>
            <Text style={styles.iconGlyph}>🧾</Text>
          </View>
          <View style={styles.cardBody}>
            <Text style={styles.cardTitle}>Geçmiş fişler</Text>
            <Text style={styles.cardSub}>
              Tara veya elle gir — fişlerin burada otomatik saklanır.
            </Text>
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      <Pressable
        style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
        onPress={onOpenAll}
      >
        <View style={styles.iconCircle}>
          <Text style={styles.iconGlyph}>🧾</Text>
          {total > 0 && (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{total > 99 ? "99+" : total}</Text>
            </View>
          )}
        </View>
        <View style={styles.cardBody}>
          <Text style={styles.cardTitle}>Geçmiş fişler</Text>
          <Text style={styles.cardSub} numberOfLines={1}>
            {total} kayıtlı
            {latest ? ` · Son: ${latest.title}` : ""}
          </Text>
        </View>
        <Text style={styles.chevron}>›</Text>
      </Pressable>

      {previews.length > 0 && (
        <View style={styles.previewList}>
          {previews.map((item) => (
            <Pressable
              key={item.id}
              style={({ pressed }) => [styles.previewRow, pressed && styles.previewPressed]}
              onPress={() => onSelect(item)}
            >
              <View style={styles.previewMain}>
                <Text style={styles.previewTitle} numberOfLines={1}>
                  {item.title}
                </Text>
                <Text style={styles.previewMeta} numberOfLines={1}>
                  {formatRelativeTime(item.updatedAt)} · {item.itemCount} kalem ·{" "}
                  {item.currency}
                  {formatCents(item.grandTotalCents)}
                </Text>
              </View>
              <View
                style={[
                  styles.statusPill,
                  item.status === "draft" ? styles.statusDraft : styles.statusDone,
                ]}
              >
                <Text style={styles.statusPillText}>{statusLabel(item.status)}</Text>
              </View>
            </Pressable>
          ))}
          {total > PREVIEW_LIMIT && (
            <Pressable onPress={onOpenAll} hitSlop={8} style={styles.seeAll}>
              <Text style={styles.seeAllText}>Tümünü gör ({total})</Text>
            </Pressable>
          )}
        </View>
      )}
    </View>
  );
}

function makeStyles(c: Palette) {
  return StyleSheet.create({
    wrap: { gap: 10, marginTop: 8, alignSelf: "stretch" },
    card: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      padding: 14,
      borderRadius: radius.lg,
      backgroundColor: c.surface,
      borderWidth: 1,
      borderColor: c.border,
    },
    cardMuted: {
      opacity: 0.95,
      justifyContent: "center",
      minHeight: 72,
    },
    cardPressed: { opacity: 0.88, transform: [{ scale: 0.99 }] },
    iconCircle: {
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: c.surfaceAlt,
      alignItems: "center",
      justifyContent: "center",
    },
    iconGlyph: { fontSize: 22 },
    badge: {
      position: "absolute",
      top: -4,
      right: -6,
      minWidth: 20,
      height: 20,
      borderRadius: 10,
      paddingHorizontal: 5,
      backgroundColor: c.primary,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: 2,
      borderColor: c.surface,
    },
    badgeText: { color: c.primaryText, fontSize: 11, fontWeight: "800" },
    cardBody: { flex: 1, gap: 3 },
    cardTitle: { color: c.text, fontSize: 16, fontWeight: "700" },
    cardSub: { color: c.textDim, fontSize: 13, lineHeight: 18 },
    chevron: { color: c.textDim, fontSize: 28, fontWeight: "300", marginTop: -2 },
    previewList: { gap: 8 },
    previewRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      paddingVertical: 12,
      paddingHorizontal: 14,
      borderRadius: radius.md,
      backgroundColor: c.surfaceAlt,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
    },
    previewPressed: { opacity: 0.85 },
    previewMain: { flex: 1, gap: 2 },
    previewTitle: { color: c.text, fontSize: 15, fontWeight: "600" },
    previewMeta: { color: c.textDim, fontSize: 12 },
    statusPill: {
      borderRadius: radius.sm,
      paddingHorizontal: 8,
      paddingVertical: 4,
    },
    statusDraft: { backgroundColor: c.warnBg },
    statusDone: { backgroundColor: c.okBg },
    statusPillText: { color: c.textDim, fontSize: 10, fontWeight: "700" },
    seeAll: { alignItems: "center", paddingVertical: 6 },
    seeAllText: { color: c.primary, fontSize: 14, fontWeight: "600" },
  });
}
