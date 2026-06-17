import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { formatCents } from "./logic";
import {
  formatRelativeTime,
  getHistoryStore,
  statusLabel,
  type ReceiptSummary,
} from "./history/index";
import { radius, type Palette } from "./theme";

export interface HistoryModalProps {
  visible: boolean;
  colors: Palette;
  onClose: () => void;
  onSelect: (summary: ReceiptSummary) => void;
  onNewReceipt: () => void;
}

export function HistoryModal({
  visible,
  colors,
  onClose,
  onSelect,
  onNewReceipt,
}: HistoryModalProps) {
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [rows, setRows] = useState<ReceiptSummary[]>([]);
  const [loading, setLoading] = useState(false);

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
    if (visible) void refresh();
  }, [visible, refresh]);

  function confirmDelete(item: ReceiptSummary) {
    Alert.alert("Fişi sil", `"${item.title}" geçmişten silinsin mi?`, [
      { text: "Vazgeç", style: "cancel" },
      {
        text: "Sil",
        style: "destructive",
        onPress: () => {
          void (async () => {
            const store = await getHistoryStore();
            await store.remove(item.id);
            await refresh();
          })();
        },
      },
    ]);
  }

  function confirmClearAll() {
    if (rows.length === 0) return;
    Alert.alert(
      "Tüm geçmişi sil",
      `${rows.length} kayıt kalıcı olarak silinecek.`,
      [
        { text: "Vazgeç", style: "cancel" },
        {
          text: "Sil",
          style: "destructive",
          onPress: () => {
            void (async () => {
              const store = await getHistoryStore();
              await store.clear();
              await refresh();
            })();
          },
        },
      ],
    );
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.root}>
        <View style={styles.header}>
          <Pressable onPress={onClose} hitSlop={10}>
            <Text style={styles.close}>Kapat</Text>
          </Pressable>
          <Text style={styles.title}>Geçmiş</Text>
          <View style={styles.headerSpacer} />
        </View>

        {loading && rows.length === 0 ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : rows.length === 0 ? (
          <View style={styles.center}>
            <Text style={styles.emptyTitle}>Henüz kayıtlı fiş yok</Text>
            <Text style={styles.emptySub}>
              Tara veya manuel gir — otomatik kaydedilir.
            </Text>
          </View>
        ) : (
          <FlatList
            data={rows}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.listContent}
            renderItem={({ item }) => (
              <View style={styles.rowWrap}>
                <Pressable
                  style={styles.row}
                  onPress={() => onSelect(item)}
                >
                  <View style={styles.rowMain}>
                    <Text style={styles.rowTitle} numberOfLines={1}>
                      {item.title}
                    </Text>
                    <Text style={styles.rowMeta}>
                      {formatRelativeTime(item.updatedAt)} · {item.personCount} kişi ·{" "}
                      {item.itemCount} kalem
                    </Text>
                    <Text style={styles.rowTotal}>
                      {item.currency}
                      {formatCents(item.grandTotalCents)}
                    </Text>
                  </View>
                  <View style={[styles.badge, badgeStyle(item.status, colors)]}>
                    <Text style={styles.badgeText}>{statusLabel(item.status)}</Text>
                  </View>
                </Pressable>
                <Pressable
                  style={styles.deleteBtn}
                  onPress={() => confirmDelete(item)}
                  hitSlop={8}
                >
                  <Text style={styles.deleteText}>Sil</Text>
                </Pressable>
              </View>
            )}
          />
        )}

        <View style={styles.footer}>
          <Pressable
            style={[styles.btn, styles.btnPrimary]}
            onPress={() => {
              onClose();
              onNewReceipt();
            }}
          >
            <Text style={styles.btnPrimaryText}>+ Yeni fiş</Text>
          </Pressable>
          {rows.length > 0 && (
            <Pressable style={styles.btnGhost} onPress={confirmClearAll}>
              <Text style={styles.btnGhostText}>Tümünü sil</Text>
            </Pressable>
          )}
        </View>
      </View>
    </Modal>
  );
}

function badgeStyle(status: ReceiptSummary["status"], colors: Palette) {
  switch (status) {
    case "draft":
      return { backgroundColor: colors.warnBg };
    case "shared":
      return { backgroundColor: colors.okBg };
    default:
      return { backgroundColor: colors.surfaceAlt };
  }
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.bg },
    header: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: 16,
      paddingTop: 56,
      paddingBottom: 12,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    close: { color: colors.primary, fontSize: 16, fontWeight: "600" },
    title: { color: colors.text, fontSize: 18, fontWeight: "700" },
    headerSpacer: { width: 48 },
    center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
    emptyTitle: { color: colors.text, fontSize: 17, fontWeight: "600", marginBottom: 8 },
    emptySub: { color: colors.textDim, fontSize: 14, textAlign: "center" },
    listContent: { padding: 16, paddingBottom: 120 },
    rowWrap: {
      flexDirection: "row",
      alignItems: "stretch",
      marginBottom: 10,
      gap: 8,
    },
    row: {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: colors.surface,
      borderRadius: radius.md,
      padding: 14,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    rowMain: { flex: 1, marginRight: 8 },
    rowTitle: { color: colors.text, fontSize: 16, fontWeight: "600", marginBottom: 4 },
    rowMeta: { color: colors.textDim, fontSize: 13, marginBottom: 4 },
    rowTotal: { color: colors.text, fontSize: 15, fontWeight: "700" },
    badge: { borderRadius: radius.sm, paddingHorizontal: 8, paddingVertical: 4 },
    badgeText: { color: colors.textDim, fontSize: 11, fontWeight: "600" },
    deleteBtn: {
      justifyContent: "center",
      paddingHorizontal: 12,
      backgroundColor: colors.errorBg,
      borderRadius: radius.md,
    },
    deleteText: { color: colors.danger, fontSize: 13, fontWeight: "600" },
    footer: {
      position: "absolute",
      left: 0,
      right: 0,
      bottom: 0,
      padding: 16,
      paddingBottom: 32,
      backgroundColor: colors.bg,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
      gap: 10,
    },
    btn: { borderRadius: radius.md, paddingVertical: 14, alignItems: "center" },
    btnPrimary: { backgroundColor: colors.primary },
    btnPrimaryText: { color: colors.primaryText, fontWeight: "700", fontSize: 16 },
    btnGhost: { alignItems: "center", paddingVertical: 8 },
    btnGhostText: { color: colors.danger, fontWeight: "600", fontSize: 14 },
  });
}
