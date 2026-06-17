/**
 * Akıllı Hesap Bölüşme — mobil istemci (DESIGN.md §3 akışı).
 * Adım adım: Tara → Kalemleri Onayla → Kişiler → Atama → Özet/Paylaş.
 * Altta yapışkan kişi-başı özet barı; tüm hesap @ahb/split-engine ile deterministik.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import type { AnalyzedReceipt, SuggestResult } from "@ahb/ai-orchestrator";
import { clampWeightsToQty, heuristicSuggest } from "@ahb/ai-orchestrator";
import {
  analyzeViaServer,
  analyzeViaServerStream,
  captureFromCamera,
  checkBackendHealth,
  optimizePickedImage,
  pickFromLibrary,
  prewarmBackend,
  resolveApiBase,
  SCAN_PHASE_MESSAGES,
  type PickedUri,
  type PickedImage,
  type ScanPhase,
  type StreamItem,
} from "./src/api";
import { personColor, radius, useTheme, type Palette } from "./src/theme";
import {
  analyzedToState,
  computeFromState,
  formatCents,
  isValidAmount,
  type SplitState,
} from "./src/logic";
import {
  getItemAssignmentMeta,
  validateStep3Assignments,
} from "./src/assignment-validation";
import { buildSuggestInput, suggestAssignmentsViaServer } from "./src/suggest-api";
import {
  cloneAssignments,
  heuristicItemIds as collectHeuristicItemIds,
  mergeLlmSuggestion,
} from "./src/suggest-merge";
import { HistoryModal } from "./src/HistoryModal";
import { HistoryHomeTeaser } from "./src/HistoryHomeTeaser";
import {
  getHistoryStore,
  hashImageBase64,
  type ReceiptStatus,
  type ReceiptSummary,
} from "./src/history/index";
import type { HistoryStore } from "./src/history/store";
import { useReceiptAutosave } from "./src/useReceiptAutosave";

const LOCALE = "tr-TR";

const STEPS = ["Fişi Tara", "Kalemler", "Kişiler", "Paylaşım", "Özet"] as const;
type Step = 0 | 1 | 2 | 3 | 4;
type SuggestStatus = "idle" | "loading" | "ready" | "error";

let uidCounter = 0;
const uid = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${uidCounter++}`;

/** İsimden 1-2 harflik avatar baş harfi üretir. */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toLocaleUpperCase("tr");
  return (parts[0]![0]! + parts[1]![0]!).toLocaleUpperCase("tr");
}

function initialState(): SplitState {
  return {
    currency: "₺",
    items: [],
    people: [
      { id: uid("p"), name: "Ben", color: personColor(0) },
      { id: uid("p"), name: "Arkadaş", color: personColor(1) },
    ],
    assignments: {},
    discountCents: 0,
    tax: { included: true, value: "" },
    tip: { mode: "proportional", isPercent: true, value: "" },
  };
}

type Banner = { kind: "ok" | "error"; text: string } | null;

export function App() {
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [step, setStep] = useState<Step>(0);
  const [state, setState] = useState<SplitState>(initialState);
  const [analysis, setAnalysis] = useState<AnalyzedReceipt | null>(null);
  const [scanPhase, setScanPhase] = useState<ScanPhase>("idle");
  const [backendOk, setBackendOk] = useState<boolean | null>(null);
  const [banner, setBanner] = useState<Banner>(null);
  const [newPerson, setNewPerson] = useState("");
  const [expandedItemId, setExpandedItemId] = useState<string | null>(null);
  const [chargesOpen, setChargesOpen] = useState(false);
  /** true → atamalar yok sayılır, hesap kişi sayısına eşit bölünür (kısayol). */
  const [equalSplit, setEqualSplit] = useState(false);
  const [suggestStatus, setSuggestStatus] = useState<SuggestStatus>("idle");
  const [llmSuggestion, setLlmSuggestion] = useState<SuggestResult | null>(null);
  const [assignmentsBeforeSuggest, setAssignmentsBeforeSuggest] = useState<
    SplitState["assignments"] | null
  >(null);
  const [heuristicItemsSet, setHeuristicItemsSet] = useState<Set<string>>(() => new Set());
  const [userEditedItems, setUserEditedItems] = useState<Set<string>>(() => new Set());
  const [llmAppliedItemIds, setLlmAppliedItemIds] = useState<Set<string>>(() => new Set());
  const [heuristicApplied, setHeuristicApplied] = useState(false);
  const prefetchAbortRef = useRef<AbortController | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyRefreshToken, setHistoryRefreshToken] = useState(0);
  const [activeReceiptId, setActiveReceiptId] = useState<string | null>(null);
  const [receiptStatus, setReceiptStatus] = useState<ReceiptStatus>("draft");
  const [persistedImageHash, setPersistedImageHash] = useState<string | undefined>();
  const [shareTextSnapshot, setShareTextSnapshot] = useState<string | undefined>();
  const [receiptCreatedAt, setReceiptCreatedAt] = useState<string | undefined>();
  const [historyStore, setHistoryStore] = useState<HistoryStore | null>(null);

  const computed = useMemo(
    () => computeFromState(equalSplit ? { ...state, assignments: {} } : state),
    [state, equalSplit],
  );
  const peopleById = useMemo(() => new Map(state.people.map((p) => [p.id, p])), [state.people]);

  // Eşit modda "atanmamış kalem" uyarıları bilinçli tercih olduğundan gizlenir.
  const visibleWarnings = useMemo(
    () =>
      (computed?.result.warnings ?? []).filter(
        (w) => !(equalSplit && w.code === "UNASSIGNED_ITEMS"),
      ),
    [computed, equalSplit],
  );

  const flaggedItemIds = useMemo(() => {
    const ids = new Set<string>();
    if (!analysis) return ids;
    for (const flag of analysis.flags) {
      if (flag.reason === "low_confidence" || flag.reason === "qty_price_mismatch") {
        ids.add(flag.target);
      }
    }
    for (const [id, conf] of Object.entries(analysis.itemConfidence)) {
      if (conf < 0.6) ids.add(id);
    }
    return ids;
  }, [analysis]);

  const step3Validation = useMemo(
    () => (step === 3 && !equalSplit ? validateStep3Assignments(state) : null),
    [step, equalSplit, state],
  );

  const scanBusy = scanPhase !== "idle";
  const scanMessage = scanPhase !== "idle" ? SCAN_PHASE_MESSAGES[scanPhase] : "";

  useEffect(() => {
    prewarmBackend();
    void checkBackendHealth().then(setBackendOk);
    void getHistoryStore().then(setHistoryStore);
  }, []);

  useEffect(() => {
    if (step === 0) setHistoryRefreshToken((t) => t + 1);
  }, [step]);

  const { flush: flushHistory, resetSnapshot: resetHistorySnapshot } = useReceiptAutosave({
    store: historyStore,
    activeReceiptId,
    state,
    step,
    equalSplit,
    status: receiptStatus,
    analysis,
    imageHash: persistedImageHash,
    shareText: shareTextSnapshot,
    createdAt: receiptCreatedAt,
    onIdAssigned: setActiveReceiptId,
  });

  function invalidateSuggestPrefetch() {
    prefetchAbortRef.current?.abort();
    prefetchAbortRef.current = null;
    setSuggestStatus("idle");
    setLlmSuggestion(null);
  }

  function markUserEditedItem(itemId: string) {
    setUserEditedItems((prev) => new Set(prev).add(itemId));
    invalidateSuggestPrefetch();
  }

  function beginStep3Suggestions(currentState: SplitState) {
    invalidateSuggestPrefetch();
    setUserEditedItems(new Set());
    setLlmAppliedItemIds(new Set());
    setAssignmentsBeforeSuggest(cloneAssignments(currentState.assignments));

    const input = buildSuggestInput(currentState, LOCALE);
    const heuristic = heuristicSuggest(input);
    const hIds = collectHeuristicItemIds(heuristic);
    setHeuristicItemsSet(hIds);
    setHeuristicApplied(hIds.size > 0);

    setState((prev) => ({
      ...prev,
      assignments: { ...prev.assignments, ...heuristic.assignments },
    }));

    setSuggestStatus("loading");
    const controller = new AbortController();
    prefetchAbortRef.current = controller;

    void suggestAssignmentsViaServer(input, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        setLlmSuggestion(result);
        setSuggestStatus("ready");
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        if (typeof __DEV__ !== "undefined" && __DEV__) {
          console.warn("[ahb] suggest prefetch failed", err);
        }
        setSuggestStatus("error");
      });
  }

  function applyLlmSuggestion() {
    if (!llmSuggestion) return;
    const merged = mergeLlmSuggestion({
      current: state.assignments,
      llm: llmSuggestion,
      heuristicItems: heuristicItemsSet,
      userEditedItems,
    });
    setState((prev) => ({ ...prev, assignments: merged.assignments }));
    setLlmAppliedItemIds(new Set(merged.appliedItemIds));
    setLlmSuggestion(null);
    setSuggestStatus("idle");
  }

  function dismissLlmSuggestion() {
    setLlmSuggestion(null);
    setSuggestStatus("idle");
  }

  function undoSuggestions() {
    if (assignmentsBeforeSuggest) {
      setState((prev) => ({
        ...prev,
        assignments: cloneAssignments(assignmentsBeforeSuggest),
      }));
    }
    setHeuristicItemsSet(new Set());
    setUserEditedItems(new Set());
    setLlmAppliedItemIds(new Set());
    setHeuristicApplied(false);
    setAssignmentsBeforeSuggest(null);
    invalidateSuggestPrefetch();
  }

  // --- Eylemler -----------------------------------------------------------

  async function loadReceiptFromHistory(summary: ReceiptSummary) {
    const store = await getHistoryStore();
    const saved = await store.load(summary.id);
    if (!saved) {
      Alert.alert("Kayıt bulunamadı", "Bu fiş geçmişten silinmiş olabilir.");
      return;
    }
    invalidateSuggestPrefetch();
    resetHistorySnapshot();
    setActiveReceiptId(saved.id);
    setReceiptStatus(saved.status);
    setPersistedImageHash(saved.imageHash);
    setReceiptCreatedAt(saved.createdAt);
    setShareTextSnapshot(saved.shareText);
    setState(saved.state);
    setEqualSplit(saved.equalSplit);
    setAnalysis(null);
    setBanner({ kind: "ok", text: "Kayıtlı fiş yüklendi — kalemleri kontrol edebilirsin." });
    setExpandedItemId(null);
    setChargesOpen(false);
    setHeuristicItemsSet(new Set());
    setUserEditedItems(new Set());
    setLlmAppliedItemIds(new Set());
    setHeuristicApplied(false);
    setAssignmentsBeforeSuggest(null);
    setScanPhase("idle");
    setStep(1);
    setHistoryOpen(false);
  }

  async function analyzeImage(image: PickedImage, imageHash: string) {
    try {
      setPersistedImageHash(imageHash);
      setReceiptStatus("draft");
      setScanPhase("analyzing");

      let result: AnalyzedReceipt;
      try {
        const streamed: StreamItem[] = [];
        result = await analyzeViaServerStream(image, LOCALE, (item) => {
          streamed.push(item);
          setState((prev) => ({
            ...prev,
            items: streamed.map((it, i) => ({
              id: `li_stream_${i}`,
              name: it.name ?? "",
              price: it.totalPriceCents != null ? formatCents(it.totalPriceCents) : "",
              qty: Math.max(1, Math.round(it.qty ?? 1)),
            })),
          }));
        });
      } catch (streamErr) {
        if (typeof __DEV__ !== "undefined" && __DEV__) {
          console.warn("[ahb] akış başarısız, tek-seferliğe düşülüyor", streamErr);
        }
        result = await analyzeViaServer(image, LOCALE);
      }

      setAnalysis(result);
      setState((prev) => analyzedToState(result, prev.people));
      const count = result.receipt.lineItems.length;
      setBanner({
        kind: "ok",
        text: result.cached
          ? `${count} kalem bulundu (önbellek).`
          : `${count} kalem okundu. Lütfen kontrol et.`,
      });
      void flushHistory();
    } catch (err) {
      setBanner({
        kind: "error",
        text: err instanceof Error ? err.message : "Bir şeyler ters gitti.",
      });
    } finally {
      setScanPhase("idle");
    }
  }

  async function runScan(picker: () => Promise<PickedUri | null>) {
    setBanner(null);
    setScanPhase("picking");
    prewarmBackend();
    try {
      const picked = await picker();
      if (!picked) {
        setScanPhase("idle");
        return;
      }
      setStep(1);
      setScanPhase("preparing");
      const image = await optimizePickedImage(picked);
      const imageHash = await hashImageBase64(image.base64);

      const store = await getHistoryStore();
      const existing = await store.findByImageHash(imageHash);
      if (existing) {
        setScanPhase("idle");
        Alert.alert(
          "Fiş zaten kayıtlı",
          `"${existing.title}" geçmişte var. Açmak ister misin?`,
          [
            {
              text: "Yine de tara",
              onPress: () => {
                void analyzeImage(image, imageHash);
              },
            },
            {
              text: "Aç",
              onPress: () => {
                void loadReceiptFromHistory(existing);
              },
            },
          ],
        );
        return;
      }

      await analyzeImage(image, imageHash);
    } catch (err) {
      setBanner({ kind: "error", text: err instanceof Error ? err.message : "Bir şeyler ters gitti." });
    } finally {
      setScanPhase("idle");
    }
  }

  function startManual() {
    setBanner(null);
    if (state.items.length === 0) addItem();
    setStep(1);
  }

  /** Tarama oturumunu sıfırla; kişiler korunur (yanlış fiş / yeniden tara). */
  function resetScanSession() {
    invalidateSuggestPrefetch();
    setAnalysis(null);
    setBanner(null);
    setExpandedItemId(null);
    setChargesOpen(false);
    setEqualSplit(false);
    setHeuristicItemsSet(new Set());
    setUserEditedItems(new Set());
    setLlmAppliedItemIds(new Set());
    setHeuristicApplied(false);
    setAssignmentsBeforeSuggest(null);
    setActiveReceiptId(null);
    setReceiptStatus("draft");
    setPersistedImageHash(undefined);
    setShareTextSnapshot(undefined);
    setReceiptCreatedAt(undefined);
    resetHistorySnapshot();
    setState((prev) => ({
      ...prev,
      items: [],
      assignments: {},
      discountCents: 0,
      tax: { included: true, value: "" },
      tip: { mode: "proportional", isPercent: true, value: "" },
    }));
  }

  function beginRescan(picker: () => Promise<PickedUri | null>) {
    resetScanSession();
    void runScan(picker);
  }

  function promptRescan() {
    Alert.alert(
      "Fişi yeniden tara",
      "Mevcut kalemler ve atamalar silinir; kişi listesi korunur.",
      [
        { text: "Vazgeç", style: "cancel" },
        { text: "Kamera", onPress: () => beginRescan(captureFromCamera) },
        { text: "Galeri", onPress: () => beginRescan(pickFromLibrary) },
      ],
    );
  }

  function resetAll() {
    void (async () => {
      await flushHistory();
      invalidateSuggestPrefetch();
      resetHistorySnapshot();
      setActiveReceiptId(null);
      setReceiptStatus("draft");
      setPersistedImageHash(undefined);
      setShareTextSnapshot(undefined);
      setReceiptCreatedAt(undefined);
      setState(initialState());
      setAnalysis(null);
      setBanner(null);
      setExpandedItemId(null);
      setChargesOpen(false);
      setEqualSplit(false);
      setHeuristicItemsSet(new Set());
      setUserEditedItems(new Set());
      setLlmAppliedItemIds(new Set());
      setHeuristicApplied(false);
      setAssignmentsBeforeSuggest(null);
      setScanPhase("idle");
      setStep(0);
    })();
  }

  function updateItem(id: string, patch: Partial<{ name: string; price: string }>) {
    setState((prev) => ({
      ...prev,
      items: prev.items.map((it) => (it.id === id ? { ...it, ...patch } : it)),
    }));
  }

  function removeItem(id: string) {
    setState((prev) => {
      const { [id]: _omit, ...rest } = prev.assignments;
      return { ...prev, items: prev.items.filter((it) => it.id !== id), assignments: rest };
    });
    if (expandedItemId === id) setExpandedItemId(null);
  }

  function addItem() {
    const id = uid("i");
    setState((prev) => ({
      ...prev,
      items: [...prev.items, { id, name: "", price: "", qty: 1 }],
    }));
    setExpandedItemId(id);
  }

  /** Kalemin adedini değiştirir (en az 1); azaltınca payları yeni adede sığdırır. */
  function updateQty(itemId: string, delta: number) {
    setState((prev) => {
      const items = prev.items.map((it) =>
        it.id === itemId ? { ...it, qty: Math.max(1, it.qty + delta) } : it,
      );
      const newQty = items.find((it) => it.id === itemId)?.qty ?? 1;
      const current = prev.assignments[itemId];
      if (!current) return { ...prev, items };
      return {
        ...prev,
        items,
        assignments: { ...prev.assignments, [itemId]: clampWeightsToQty(current, newQty) },
      };
    });
  }

  function addPerson() {
    const name = newPerson.trim();
    if (!name) return;
    setState((prev) => ({
      ...prev,
      people: [...prev.people, { id: uid("p"), name, color: personColor(prev.people.length) }],
    }));
    setNewPerson("");
  }

  function removePerson(id: string) {
    setState((prev) => {
      const assignments: Record<string, Record<string, number>> = {};
      for (const [itemId, weights] of Object.entries(prev.assignments)) {
        const { [id]: _omit, ...rest } = weights;
        assignments[itemId] = rest;
      }
      return { ...prev, people: prev.people.filter((p) => p.id !== id), assignments };
    });
  }

  function toggleAssign(itemId: string, personId: string) {
    markUserEditedItem(itemId);
    setState((prev) => {
      const current = prev.assignments[itemId] ?? {};
      const next = { ...current };
      if (next[personId] !== undefined) delete next[personId];
      else next[personId] = 1;
      return { ...prev, assignments: { ...prev.assignments, [itemId]: next } };
    });
  }

  /**
   * Pay (adet/porsiyon) değişimi; en az 1. Adet (qty ≥ 2) biliniyorsa
   * payların toplamı adisyondaki adedi AŞAMAZ.
   */
  function setWeight(itemId: string, personId: string, delta: number) {
    markUserEditedItem(itemId);
    setState((prev) => {
      const current = prev.assignments[itemId] ?? {};
      const item = prev.items.find((it) => it.id === itemId);
      let next = Math.max(1, (current[personId] ?? 1) + delta);
      if (delta > 0 && item && item.qty >= 2) {
        const others = Object.entries(current)
          .filter(([id, w]) => id !== personId && w > 0)
          .reduce((s, [, w]) => s + w, 0);
        if (others + next > item.qty) next = Math.max(1, item.qty - others);
      }
      return {
        ...prev,
        assignments: { ...prev.assignments, [itemId]: { ...current, [personId]: next } },
      };
    });
  }

  async function shareSummary() {
    if (!computed) return;
    const lines = [
      "Akıllı Hesap Bölüşme",
      `Toplam: ${state.currency}${formatCents(computed.grandTotalCents)}`,
      "",
      ...computed.result.perPerson.map((p) => {
        const name = peopleById.get(p.personId)?.name ?? "Kişi";
        return `${name}: ${state.currency}${formatCents(p.totalCents)}`;
      }),
    ];
    const message = lines.join("\n");
    await Share.share({ message });
    setShareTextSnapshot(message);
    setReceiptStatus("shared");
    await flushHistory();
  }

  // --- Adım ilerleme ------------------------------------------------------

  const canContinue =
    !scanBusy &&
    (step === 1 ? state.items.length > 0 :
    step === 2 ? state.people.length > 0 :
    step === 3 && step3Validation ? !step3Validation.blocked :
    true);

  function advanceFromStep3() {
    setReceiptStatus("confirmed");
    setStep(4);
    void flushHistory();
  }

  function nextStep() {
    if (step === 4) {
      void shareSummary();
      return;
    }
    if (step === 3 && step3Validation) {
      if (step3Validation.blocked) return;
      if (step3Validation.needsUnassignedConfirm) {
        const n = step3Validation.unassigned.length;
        const names = step3Validation.unassigned
          .slice(0, 3)
          .map((u) => u.itemName)
          .join(", ");
        const more = n > 3 ? ` ve ${n - 3} kalem daha` : "";
        Alert.alert(
          "Atanmayan kalemler",
          `${n === 1 ? "1 kalem" : `${n} kalem`} (${names}${more}) herkese eşit bölünecek. Devam etmek istiyor musunuz?`,
          [
            { text: "Geri", style: "cancel" },
            { text: "Devam", onPress: advanceFromStep3 },
          ],
        );
        return;
      }
    }
    // Kişilerden normal devam = kalem kalem mod; Adım 3'te heuristik + LLM prefetch.
    if (step === 2) {
      setEqualSplit(false);
      beginStep3Suggestions(state);
      setStep(3);
      return;
    }
    setStep((s) => Math.min(4, s + 1) as Step);
  }

  /** Kısayol: atamayı atla, hesabı kişi sayısına eşit böl ve özete geç. */
  function goEqualSplit() {
    setEqualSplit(true);
    setReceiptStatus("confirmed");
    setStep(4);
    void flushHistory();
  }

  function goBack() {
    // Eşit modda adım 3 atlandığı için özetten geri = Kişiler.
    if (step === 4 && equalSplit) {
      setStep(2);
      return;
    }
    if (step === 3) invalidateSuggestPrefetch();
    // Taramadan gelinen kalemler — geri = fişi iptal, anasayfada hayalet taslak kalmasın.
    if (step === 1 && analysis) resetScanSession();
    setStep((s) => Math.max(0, s - 1) as Step);
  }

  const footerLabel =
    step === 0 ? "Devam" :
    step === 3 ? "Özeti Gör" :
    step === 4 ? "Paylaş" :
    "Devam";

  const showFooterButton = step > 0;
  const showRescanBar = step === 1 && !scanBusy;
  const showRescanLink = (step === 2 || step === 3) && !scanBusy;
  const showMiniBar = computed !== null && step >= 2;

  // --- Render -------------------------------------------------------------

  return (
    <View style={styles.root}>
      <StatusBar style={isDark ? "light" : "dark"} />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        {/* Üst bar: geri + ilerleme */}
        <View style={styles.header}>
          <View style={styles.headerRow}>
            {step > 0 ? (
              <Pressable onPress={goBack} hitSlop={10} style={styles.backBtn}>
                <Text style={styles.backText}>‹</Text>
              </Pressable>
            ) : (
              <View style={styles.backBtn} />
            )}
            <View style={styles.progress}>
              {STEPS.map((_, i) => (
                <View
                  key={i}
                  style={[
                    styles.progressDot,
                    i === step && styles.progressDotActive,
                    i < step && styles.progressDotDone,
                  ]}
                />
              ))}
            </View>
            {step === 4 ? (
              <Pressable onPress={resetAll} hitSlop={10} style={styles.backBtn}>
                <Text style={styles.resetText}>Yeni</Text>
              </Pressable>
            ) : (
              <View style={styles.backBtn} />
            )}
          </View>
          <Text style={styles.stepTitle}>{STEPS[step]}</Text>
        </View>

        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
        >
          {/* ADIM 0 — Tara */}
          {step === 0 && (
            <View style={styles.hero}>
              <Text style={styles.heroTitle}>Hesabı saniyeler içinde bölüş</Text>
              <Text style={styles.heroSub}>
                Fişin fotoğrafını çek; kalemleri okuyalım, sen sadece kimin ne aldığını seç.
              </Text>

              {backendOk === false && (
                <View style={[styles.banner, styles.bannerError]}>
                  <Text style={styles.bannerText}>
                    Backend’e ulaşılamıyor ({resolveApiBase()}). Sunucuyu başlat: npm run dev -w
                    @ahb/server
                  </Text>
                </View>
              )}

              {scanPhase === "picking" ? (
                <View style={styles.heroLoading}>
                  <ActivityIndicator size="large" color={colors.primary} />
                  <Text style={styles.dim}>{scanMessage}</Text>
                </View>
              ) : (
                <View style={styles.heroActions}>
                  <Pressable
                    style={[styles.btn, styles.btnPrimary, styles.btnBig]}
                    onPress={() => runScan(captureFromCamera)}
                  >
                    <Text style={styles.btnPrimaryText}>Fişi Tara</Text>
                  </Pressable>
                  <Pressable
                    style={[styles.btn, styles.btnGhost, styles.btnBig]}
                    onPress={() => runScan(pickFromLibrary)}
                  >
                    <Text style={styles.btnGhostText}>Galeriden Seç</Text>
                  </Pressable>
                  <Pressable onPress={startManual} hitSlop={8}>
                    <Text style={styles.link}>Fiş yok — elle gireceğim</Text>
                  </Pressable>
                </View>
              )}

              {scanPhase === "idle" && (
                <HistoryHomeTeaser
                  colors={colors}
                  refreshToken={historyRefreshToken}
                  onOpenAll={() => setHistoryOpen(true)}
                  onSelect={(summary) => {
                    void loadReceiptFromHistory(summary);
                  }}
                />
              )}

              {banner && (
                <View
                  style={[styles.banner, banner.kind === "ok" ? styles.bannerOk : styles.bannerError]}
                >
                  <Text style={styles.bannerText}>{banner.text}</Text>
                </View>
              )}
            </View>
          )}

          {/* ADIM 1 — Kalemleri onayla */}
          {step === 1 && (
            <>
              {banner && (
                <View
                  style={[styles.banner, banner.kind === "ok" ? styles.bannerOk : styles.bannerError]}
                >
                  <Text style={styles.bannerText}>{banner.text}</Text>
                </View>
              )}
              {analysis && analysis.needsConfirmation.length > 0 && (
                <View style={[styles.banner, styles.bannerWarn]}>
                  <Text style={styles.bannerText}>
                    Kontrol et: {analysis.needsConfirmation.join(", ")}
                  </Text>
                </View>
              )}

              {showRescanBar && (
                <View style={styles.rescanBar}>
                  <View style={styles.rescanCopy}>
                    <Text style={styles.rescanTitle}>Yanlış fiş mi?</Text>
                    <Text style={styles.rescanSub}>Başka fotoğrafla tekrar okutabilirsin</Text>
                  </View>
                  <View style={styles.rescanActions}>
                    <Pressable
                      style={styles.rescanBtn}
                      onPress={() => beginRescan(captureFromCamera)}
                    >
                      <Text style={styles.rescanBtnText}>Kamera</Text>
                    </Pressable>
                    <Pressable
                      style={styles.rescanBtn}
                      onPress={() => beginRescan(pickFromLibrary)}
                    >
                      <Text style={styles.rescanBtnText}>Galeri</Text>
                    </Pressable>
                  </View>
                </View>
              )}

              {scanBusy && scanPhase !== "picking" && state.items.length === 0 && (
                <View style={styles.scanProgress}>
                  <ActivityIndicator size="small" color={colors.primary} />
                  <Text style={styles.dim}>{scanMessage}</Text>
                </View>
              )}

              {scanBusy && state.items.length === 0 ? (
                <View style={styles.list}>
                  {Array.from({ length: 5 }, (_, i) => (
                    <View key={`sk-${i}`} style={styles.skeletonRow}>
                      <View style={styles.skeletonName} />
                      <View style={styles.skeletonPrice} />
                    </View>
                  ))}
                </View>
              ) : (
              <View style={styles.list}>
                {state.items.map((item) => {
                  const flagged = flaggedItemIds.has(item.id);
                  const open = expandedItemId === item.id;
                  const priceInvalid = !isValidAmount(item.price);
                  return (
                    <View key={item.id} style={[styles.itemRow, flagged && styles.itemRowFlagged]}>
                      <Pressable
                        style={styles.itemHead}
                        onPress={() => setExpandedItemId(open ? null : item.id)}
                      >
                        <View style={styles.rowFlex}>
                          {item.qty > 1 && <Text style={styles.qtyBadge}>{item.qty}×</Text>}
                          <Text style={styles.itemName} numberOfLines={1}>
                            {item.name.trim() || "Yeni kalem"}
                          </Text>
                          {flagged && <View style={styles.flagDot} />}
                        </View>
                        <Text style={styles.itemPrice}>
                          {state.currency}
                          {item.price.trim() || "0,00"}
                        </Text>
                      </Pressable>

                      {open && (
                        <View style={styles.itemEditor}>
                          <TextInput
                            style={styles.input}
                            placeholder="Ürün adı"
                            placeholderTextColor={colors.textDim}
                            value={item.name}
                            onChangeText={(t) => updateItem(item.id, { name: t })}
                          />
                          <View style={styles.row}>
                            <TextInput
                              style={[styles.input, styles.flex, priceInvalid && styles.inputError]}
                              placeholder="Tutar (toplam)"
                              placeholderTextColor={colors.textDim}
                              keyboardType="decimal-pad"
                              value={item.price}
                              onChangeText={(t) => updateItem(item.id, { price: t })}
                            />
                            <View style={styles.stepper}>
                              <Pressable
                                style={styles.stepBtn}
                                onPress={() => updateQty(item.id, -1)}
                                hitSlop={6}
                              >
                                <Text style={styles.stepBtnText}>−</Text>
                              </Pressable>
                              <Text style={styles.stepValue}>{item.qty}</Text>
                              <Pressable
                                style={styles.stepBtn}
                                onPress={() => updateQty(item.id, 1)}
                                hitSlop={6}
                              >
                                <Text style={styles.stepBtnText}>+</Text>
                              </Pressable>
                            </View>
                          </View>
                          {flagged && (
                            <Text style={styles.flagText}>
                              Düşük güvenle okundu — adı ve tutarı kontrol et.
                            </Text>
                          )}
                          <Pressable onPress={() => removeItem(item.id)} hitSlop={8}>
                            <Text style={styles.dangerLink}>Kalemi sil</Text>
                          </Pressable>
                        </View>
                      )}
                    </View>
                  );
                })}

                <Pressable style={styles.addRow} onPress={addItem}>
                  <Text style={styles.link}>+ Kalem ekle</Text>
                </Pressable>
              </View>
              )}
            </>
          )}

          {/* ADIM 2 — Kişiler */}
          {step === 2 && (
            <>
              <Text style={styles.sectionHint}>
                Hesabı bölüşecek kişiler. Çıkarmak için avatara dokun.
              </Text>
              <View style={styles.avatarGrid}>
                {state.people.map((p) => (
                  <Pressable key={p.id} style={styles.avatarCell} onPress={() => removePerson(p.id)}>
                    <View style={[styles.avatar, { backgroundColor: p.color }]}>
                      <Text style={styles.avatarText}>{initials(p.name)}</Text>
                      <View style={styles.avatarRemove}>
                        <Text style={styles.avatarRemoveText}>×</Text>
                      </View>
                    </View>
                    <Text style={styles.avatarName} numberOfLines={1}>
                      {p.name}
                    </Text>
                  </Pressable>
                ))}
              </View>
              <View style={styles.row}>
                <TextInput
                  style={[styles.input, styles.flex]}
                  placeholder="İsim yaz"
                  placeholderTextColor={colors.textDim}
                  value={newPerson}
                  onChangeText={setNewPerson}
                  onSubmitEditing={addPerson}
                  returnKeyType="done"
                />
                <Pressable style={[styles.btn, styles.btnGhost]} onPress={addPerson}>
                  <Text style={styles.btnGhostText}>Ekle</Text>
                </Pressable>
              </View>
              {showRescanLink && (
                <Pressable onPress={promptRescan} hitSlop={8} style={styles.rescanLinkWrap}>
                  <Text style={styles.rescanLinkText}>Fişi yeniden tara</Text>
                </Pressable>
              )}
            </>
          )}

          {/* ADIM 3 — Atama */}
          {step === 3 && (
            <>
              <Text style={styles.sectionHint}>
                Her kalem için alan kişileri seç. Seçilmeyenler herkese eşit bölünür.
              </Text>
              {heuristicApplied && (
                <View style={[styles.banner, styles.bannerOk, styles.suggestStrip]}>
                  <Text style={styles.bannerText}>Otomatik öneriler uygulandı</Text>
                  {assignmentsBeforeSuggest && (
                    <Pressable onPress={undoSuggestions} hitSlop={8}>
                      <Text style={styles.link}>Geri al</Text>
                    </Pressable>
                  )}
                </View>
              )}
              {suggestStatus === "loading" && (
                <View style={[styles.banner, styles.suggestStrip, styles.suggestLoadingRow]}>
                  <ActivityIndicator size="small" color={colors.primary} />
                  <Text style={styles.bannerText}>AI önerisi hazırlanıyor…</Text>
                </View>
              )}
              {suggestStatus === "ready" && llmSuggestion && (
                <View style={[styles.banner, styles.bannerOk, styles.suggestStrip]}>
                  <Text style={styles.bannerText}>
                    {llmSuggestion.partial
                      ? "AI önerisi hazır — bazı kalemler belirsiz"
                      : "AI önerisi hazır"}
                  </Text>
                  <View style={styles.suggestActions}>
                    <Pressable style={[styles.btn, styles.btnPrimary, styles.btnCompact]} onPress={applyLlmSuggestion}>
                      <Text style={styles.btnPrimaryText}>Uygula</Text>
                    </Pressable>
                    <Pressable style={[styles.btn, styles.btnGhost, styles.btnCompact]} onPress={dismissLlmSuggestion}>
                      <Text style={styles.btnGhostText}>Yoksay</Text>
                    </Pressable>
                  </View>
                </View>
              )}
              {suggestStatus === "error" && (
                <View style={[styles.banner, styles.bannerWarn, styles.suggestStrip]}>
                  <Text style={styles.bannerText}>AI önerisi alınamadı — elle atayabilirsiniz</Text>
                </View>
              )}
              <Pressable onPress={goEqualSplit} hitSlop={8}>
                <Text style={styles.link}>Atamayla uğraşma — hepsini eşit böl</Text>
              </Pressable>
              <View style={styles.list}>
                {state.items.map((item) => {
                  const assigned = state.assignments[item.id] ?? {};
                  const meta = getItemAssignmentMeta(item.qty, assigned);
                  const {
                    assignedIds,
                    atCap,
                    needsQtyAttention,
                    qtyFullyAllocated,
                    showWeightSteppers,
                    remaining,
                  } = meta;
                  return (
                    <View
                      key={item.id}
                      style={[
                        styles.itemRow,
                        needsQtyAttention && styles.itemRowQtyWarn,
                        llmAppliedItemIds.has(item.id) && styles.itemRowSuggested,
                      ]}
                    >
                      <View style={styles.itemHead}>
                        <View style={styles.rowFlex}>
                          {item.qty > 1 && <Text style={styles.qtyBadge}>{item.qty}×</Text>}
                          <Text style={styles.itemName} numberOfLines={1}>
                            {item.name.trim() || "Kalem"}
                          </Text>
                        </View>
                        <Text style={styles.itemPrice}>
                          {state.currency}
                          {item.price.trim() || "0,00"}
                        </Text>
                      </View>

                      <View style={styles.assignAvatars}>
                        {state.people.map((p) => {
                          const on = assigned[p.id] !== undefined;
                          const pay = assigned[p.id] ?? 0;
                          return (
                            <Pressable
                              key={p.id}
                              onPress={() => toggleAssign(item.id, p.id)}
                              style={styles.assignAvatarWrap}
                            >
                              <View
                                style={[
                                  styles.avatarSm,
                                  { backgroundColor: on ? p.color : colors.chipOff },
                                  on && styles.avatarSmOn,
                                ]}
                              >
                                <Text
                                  style={[
                                    styles.avatarSmText,
                                    { color: on ? "#fff" : colors.textDim },
                                  ]}
                                >
                                  {initials(p.name)}
                                </Text>
                                {on && item.qty >= 2 && (
                                  <View style={[styles.avatarPayBadge, { backgroundColor: p.color }]}>
                                    <Text style={styles.avatarPayBadgeText}>{pay}</Text>
                                  </View>
                                )}
                              </View>
                              <Text style={styles.assignName} numberOfLines={1}>
                                {p.name}
                              </Text>
                            </Pressable>
                          );
                        })}
                      </View>

                      {assignedIds.length === 0 && (
                        <Text style={styles.unassignedHint}>Atanmadı — herkese eşit bölünür.</Text>
                      )}

                      {item.qty === 1 && assignedIds.length >= 1 && (
                        <Text style={styles.unassignedHint}>
                          1 adet — seçilenler arasında eşit bölünür.
                        </Text>
                      )}

                      {needsQtyAttention && (
                        <View style={[styles.banner, styles.bannerWarn, styles.qtyWarnBanner]}>
                          <Text style={styles.bannerText}>
                            {remaining} adet henüz dağıtılmadı
                          </Text>
                          <Text style={styles.qtyWarnSub}>Payları artırın veya kişi ekleyin</Text>
                        </View>
                      )}

                      {qtyFullyAllocated && (
                        <View style={[styles.banner, styles.bannerOk, styles.qtyOkBanner]}>
                          <Text style={styles.bannerText}>{item.qty} adet dağıtıldı</Text>
                        </View>
                      )}

                      {showWeightSteppers && (
                        <View style={styles.weights}>
                          <Text style={styles.weightHint}>Pay / adet</Text>
                          {assignedIds.map((pid) => {
                            const person = peopleById.get(pid);
                            return (
                              <View key={pid} style={styles.weightRow}>
                                <View style={styles.rowFlex}>
                                  <View
                                    style={[
                                      styles.dot,
                                      { backgroundColor: person?.color ?? colors.primary },
                                    ]}
                                  />
                                  <Text style={styles.weightName}>{person?.name ?? "Kişi"}</Text>
                                </View>
                                <View style={styles.stepper}>
                                  <Pressable
                                    style={styles.stepBtn}
                                    onPress={() => setWeight(item.id, pid, -1)}
                                    hitSlop={6}
                                  >
                                    <Text style={styles.stepBtnText}>−</Text>
                                  </Pressable>
                                  <Text style={styles.stepValue}>{assigned[pid]}</Text>
                                  <Pressable
                                    style={[styles.stepBtn, atCap && styles.stepBtnDisabled]}
                                    disabled={atCap}
                                    onPress={() => setWeight(item.id, pid, 1)}
                                    hitSlop={6}
                                  >
                                    <Text style={styles.stepBtnText}>+</Text>
                                  </Pressable>
                                </View>
                              </View>
                            );
                          })}
                        </View>
                      )}
                    </View>
                  );
                })}
              </View>
              {showRescanLink && (
                <Pressable onPress={promptRescan} hitSlop={8} style={styles.rescanLinkWrap}>
                  <Text style={styles.rescanLinkText}>Fişi yeniden tara</Text>
                </Pressable>
              )}
            </>
          )}

          {/* ADIM 4 — Özet */}
          {step === 4 && (
            <>
              {computed ? (
                <>
                  {equalSplit && (
                    <View style={[styles.banner, styles.bannerOk, styles.equalStrip]}>
                      <Text style={styles.bannerText}>
                        Hesap {state.people.length} kişiye eşit bölündü.
                      </Text>
                      <Pressable
                        onPress={() => {
                          setEqualSplit(false);
                          setStep(3);
                        }}
                        hitSlop={8}
                      >
                        <Text style={styles.link}>Kalem kalem bölüştür</Text>
                      </Pressable>
                    </View>
                  )}
                  {visibleWarnings.length > 0 && (
                    <View style={[styles.banner, styles.bannerWarn]}>
                      {visibleWarnings.map((w, i) => (
                        <Text key={`${w.code}-${i}`} style={styles.bannerText}>
                          {w.message}
                        </Text>
                      ))}
                    </View>
                  )}

                  <View style={styles.list}>
                    {computed.result.perPerson.map((p) => {
                      const person = peopleById.get(p.personId);
                      return (
                        <View key={p.personId} style={styles.summaryCard}>
                          <View style={styles.rowFlex}>
                            <View
                              style={[
                                styles.avatarSm,
                                { backgroundColor: person?.color ?? colors.primary },
                              ]}
                            >
                              <Text style={[styles.avatarSmText, { color: "#fff" }]}>
                                {initials(person?.name ?? "?")}
                              </Text>
                            </View>
                            <View style={styles.flex}>
                              <Text style={styles.summaryName}>{person?.name ?? "Kişi"}</Text>
                              <Text style={styles.summaryDetail}>
                                Kalem {state.currency}
                                {formatCents(p.itemsCents)}
                                {p.taxCents > 0 &&
                                  ` · KDV ${state.currency}${formatCents(p.taxCents)}`}
                                {p.tipCents > 0 &&
                                  ` · Bahşiş ${state.currency}${formatCents(p.tipCents)}`}
                              </Text>
                            </View>
                          </View>
                          <Text style={styles.summaryAmount}>
                            {state.currency}
                            {formatCents(p.totalCents)}
                          </Text>
                        </View>
                      );
                    })}
                  </View>

                  {computed.discountCents > 0 && (
                    <View style={styles.totalRow}>
                      <Text style={styles.dim}>İndirim (oransal)</Text>
                      <Text style={styles.dim}>
                        −{state.currency}
                        {formatCents(computed.discountCents)}
                      </Text>
                    </View>
                  )}

                  <View style={styles.totalRow}>
                    <Text style={styles.totalLabel}>Toplam</Text>
                    <Text style={styles.totalAmount}>
                      {state.currency}
                      {formatCents(computed.grandTotalCents)}
                    </Text>
                  </View>
                </>
              ) : (
                <Text style={styles.dim}>Kişi ve kalem ekleyince bölüşüm burada görünür.</Text>
              )}

              {/* Vergi & Bahşiş — katlanabilir */}
              <Pressable style={styles.collapseHead} onPress={() => setChargesOpen((v) => !v)}>
                <Text style={styles.collapseTitle}>Vergi & Bahşiş</Text>
                <Text style={styles.collapseChevron}>{chargesOpen ? "▾" : "▸"}</Text>
              </Pressable>
              {chargesOpen && (
                <View style={styles.collapseBody}>
                  <View style={styles.switchRow}>
                    <Text style={styles.label}>KDV fiyatlara dahil</Text>
                    <Switch
                      value={state.tax.included}
                      onValueChange={(v) =>
                        setState((prev) => ({ ...prev, tax: { ...prev.tax, included: v } }))
                      }
                      trackColor={{ true: colors.primary, false: colors.chipOff }}
                    />
                  </View>
                  {!state.tax.included && (
                    <TextInput
                      style={styles.input}
                      placeholder="KDV tutarı"
                      placeholderTextColor={colors.textDim}
                      keyboardType="decimal-pad"
                      value={state.tax.value}
                      onChangeText={(t) =>
                        setState((prev) => ({ ...prev, tax: { ...prev.tax, value: t } }))
                      }
                    />
                  )}

                  <View style={styles.switchRow}>
                    <Text style={styles.label}>Bahşiş yüzde olarak</Text>
                    <Switch
                      value={state.tip.isPercent}
                      onValueChange={(v) =>
                        setState((prev) => ({ ...prev, tip: { ...prev.tip, isPercent: v } }))
                      }
                      trackColor={{ true: colors.primary, false: colors.chipOff }}
                    />
                  </View>
                  <TextInput
                    style={styles.input}
                    placeholder={state.tip.isPercent ? "Bahşiş %" : "Bahşiş tutarı"}
                    placeholderTextColor={colors.textDim}
                    keyboardType="decimal-pad"
                    value={state.tip.value}
                    onChangeText={(t) =>
                      setState((prev) => ({ ...prev, tip: { ...prev.tip, value: t } }))
                    }
                  />
                  <View style={styles.row}>
                    {(["proportional", "equal"] as const).map((mode) => {
                      const on = state.tip.mode === mode;
                      return (
                        <Pressable
                          key={mode}
                          style={[styles.segment, on && styles.segmentOn]}
                          onPress={() =>
                            setState((prev) => ({ ...prev, tip: { ...prev.tip, mode } }))
                          }
                        >
                          <Text style={[styles.segmentText, on && styles.segmentTextOn]}>
                            {mode === "proportional" ? "Orantılı bahşiş" : "Eşit bahşiş"}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
              )}
            </>
          )}
        </ScrollView>

        {/* Yapışkan alt bar: kişi-başı mini özet + ana buton */}
        <View style={styles.footer}>
          {showMiniBar && computed && (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.miniBar}
            >
              {computed.result.perPerson.map((p) => {
                const person = peopleById.get(p.personId);
                return (
                  <View key={p.personId} style={styles.miniChip}>
                    <View
                      style={[styles.miniDot, { backgroundColor: person?.color ?? colors.primary }]}
                    />
                    <Text style={styles.miniName}>{person?.name ?? "?"}</Text>
                    <Text style={styles.miniAmount}>
                      {state.currency}
                      {formatCents(p.totalCents)}
                    </Text>
                  </View>
                );
              })}
            </ScrollView>
          )}
          {step === 2 && (
            <Pressable
              style={[styles.btn, styles.btnGhost, styles.btnBig, !canContinue && styles.btnDisabled]}
              disabled={!canContinue || scanBusy}
              onPress={goEqualSplit}
            >
              <Text style={styles.btnGhostText}>
                Eşit Böl ve Özeti Gör ({state.people.length} kişi)
              </Text>
            </Pressable>
          )}
          {step === 3 && step3Validation?.footerHint && (
            <Text
              style={[
                styles.footerHint,
                step3Validation.blocked && styles.footerHintWarn,
              ]}
            >
              {step3Validation.footerHint}
            </Text>
          )}
          {showFooterButton && (
            <Pressable
              style={[styles.btn, styles.btnPrimary, styles.btnBig, !canContinue && styles.btnDisabled]}
              disabled={!canContinue || scanBusy}
              onPress={nextStep}
            >
              <Text style={styles.btnPrimaryText}>{footerLabel}</Text>
            </Pressable>
          )}
        </View>
      </KeyboardAvoidingView>

      <HistoryModal
        visible={historyOpen}
        colors={colors}
        onClose={() => {
          setHistoryOpen(false);
          setHistoryRefreshToken((t) => t + 1);
        }}
        onSelect={(summary) => {
          void loadReceiptFromHistory(summary);
        }}
        onNewReceipt={() => {
          resetAll();
        }}
      />
    </View>
  );
}

// --- Stiller (tema paletine göre kurulur) ---------------------------------

function makeStyles(c: Palette) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: c.bg },
    flex: { flex: 1 },
    content: { padding: 20, paddingBottom: 24, gap: 14 },

    header: { paddingTop: 56, paddingHorizontal: 20, paddingBottom: 10, gap: 10 },
    headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
    backBtn: { width: 44, alignItems: "flex-start", justifyContent: "center" },
    backText: { color: c.text, fontSize: 30, fontWeight: "600", lineHeight: 32 },
    resetText: { color: c.primary, fontSize: 15, fontWeight: "700" },
    progress: { flexDirection: "row", gap: 6, alignItems: "center" },
    progressDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: c.chipOff },
    progressDotActive: { width: 22, backgroundColor: c.primary },
    progressDotDone: { backgroundColor: c.primary, opacity: 0.45 },
    stepTitle: { color: c.text, fontSize: 24, fontWeight: "800" },

    // Hero (Adım 0)
    hero: { gap: 14, paddingTop: 24 },
    heroTitle: { color: c.text, fontSize: 22, fontWeight: "800", textAlign: "center" },
    heroSub: { color: c.textDim, fontSize: 15, textAlign: "center", lineHeight: 21 },
    heroActions: { gap: 10, marginTop: 12, alignItems: "center" },
    heroLoading: { alignItems: "center", gap: 10, marginTop: 24 },
    scanProgress: { flexDirection: "row", alignItems: "center", gap: 10 },
    skeletonRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingVertical: 14,
      paddingHorizontal: 14,
      borderRadius: radius.md,
      backgroundColor: c.surface,
    },
    skeletonName: {
      height: 14,
      width: "55%",
      borderRadius: 6,
      backgroundColor: c.chipOff,
      opacity: 0.6,
    },
    skeletonPrice: {
      height: 14,
      width: 56,
      borderRadius: 6,
      backgroundColor: c.chipOff,
      opacity: 0.6,
    },

    // Genel
    row: { flexDirection: "row", gap: 10, alignItems: "center" },
    rowFlex: { flexDirection: "row", alignItems: "center", gap: 8, flexShrink: 1, flex: 1 },
    dim: { color: c.textDim, fontSize: 14 },
    sectionHint: { color: c.textDim, fontSize: 14, lineHeight: 20 },
    link: { color: c.primary, fontWeight: "700", fontSize: 15 },
    dangerLink: { color: c.danger, fontWeight: "700", fontSize: 14 },
    list: { gap: 10 },

    btn: {
      paddingVertical: 13,
      paddingHorizontal: 18,
      borderRadius: radius.md,
      alignItems: "center",
      justifyContent: "center",
    },
    btnBig: { paddingVertical: 16, alignSelf: "stretch" },
    btnPrimary: { backgroundColor: c.primary },
    btnPrimaryText: { color: c.primaryText, fontWeight: "700", fontSize: 16 },
    btnGhost: { backgroundColor: c.surfaceAlt, borderWidth: 1, borderColor: c.border },
    btnGhostText: { color: c.text, fontWeight: "600", fontSize: 16 },
    btnDisabled: { opacity: 0.4 },

    banner: { borderRadius: radius.md, padding: 12 },
    bannerOk: { backgroundColor: c.okBg, borderWidth: 1, borderColor: c.success },
    bannerError: { backgroundColor: c.errorBg, borderWidth: 1, borderColor: c.danger },
    bannerWarn: { backgroundColor: c.warnBg, borderWidth: 1, borderColor: c.warn },
    bannerText: { color: c.text, fontSize: 13, lineHeight: 18 },
    equalStrip: { gap: 6 },

    rescanBar: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 12,
      padding: 12,
      borderRadius: radius.md,
      backgroundColor: c.surfaceAlt,
      borderWidth: 1,
      borderColor: c.border,
    },
    rescanCopy: { flex: 1, gap: 2 },
    rescanTitle: { color: c.text, fontSize: 14, fontWeight: "700" },
    rescanSub: { color: c.textDim, fontSize: 12, lineHeight: 16 },
    rescanActions: { flexDirection: "row", gap: 8 },
    rescanBtn: {
      paddingVertical: 8,
      paddingHorizontal: 12,
      borderRadius: radius.sm,
      backgroundColor: c.surface,
      borderWidth: 1,
      borderColor: c.border,
    },
    rescanBtnText: { color: c.primary, fontWeight: "700", fontSize: 13 },
    rescanLinkWrap: { alignItems: "center", paddingVertical: 8 },
    rescanLinkText: { color: c.textDim, fontSize: 14, fontWeight: "600" },

    input: {
      backgroundColor: c.surfaceAlt,
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: radius.md,
      paddingHorizontal: 14,
      paddingVertical: 11,
      color: c.text,
      fontSize: 15,
    },
    inputError: { borderColor: c.danger },

    // Kalem satırı
    itemRow: {
      backgroundColor: c.surface,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: c.border,
      overflow: "hidden",
    },
    itemRowFlagged: { borderColor: c.warn },
    itemRowQtyWarn: { borderColor: c.warn, borderWidth: 1.5 },
    itemHead: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: 14,
      paddingVertical: 13,
      gap: 10,
    },
    itemName: { color: c.text, fontSize: 15, fontWeight: "600", flexShrink: 1 },
    itemPrice: { color: c.text, fontSize: 15, fontWeight: "700" },
    qtyBadge: { color: c.primary, fontSize: 14, fontWeight: "800" },
    flagDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: c.warn },
    flagText: { color: c.warn, fontSize: 12 },
    itemEditor: {
      gap: 10,
      paddingHorizontal: 14,
      paddingBottom: 14,
      borderTopWidth: 1,
      borderTopColor: c.border,
      paddingTop: 12,
    },
    addRow: { alignItems: "center", paddingVertical: 12 },

    // Avatarlar (Adım 2)
    avatarGrid: { flexDirection: "row", flexWrap: "wrap", gap: 16 },
    avatarCell: { alignItems: "center", width: 68, gap: 6 },
    avatar: {
      width: 56,
      height: 56,
      borderRadius: 28,
      alignItems: "center",
      justifyContent: "center",
    },
    avatarText: { color: "#fff", fontSize: 19, fontWeight: "800" },
    avatarRemove: {
      position: "absolute",
      top: -3,
      right: -3,
      width: 18,
      height: 18,
      borderRadius: 9,
      backgroundColor: c.surface,
      borderWidth: 1,
      borderColor: c.border,
      alignItems: "center",
      justifyContent: "center",
    },
    avatarRemoveText: { color: c.textDim, fontSize: 12, lineHeight: 13, fontWeight: "700" },
    avatarName: { color: c.text, fontSize: 13, fontWeight: "600" },

    // Atama (Adım 3)
    assignAvatars: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 12,
      paddingHorizontal: 14,
      paddingBottom: 12,
    },
    assignAvatarWrap: { alignItems: "center", gap: 4, width: 56 },
    avatarSm: {
      width: 40,
      height: 40,
      borderRadius: 20,
      alignItems: "center",
      justifyContent: "center",
      position: "relative",
    },
    avatarSmOn: { borderWidth: 2, borderColor: c.text },
    avatarSmText: { fontSize: 14, fontWeight: "800" },
    avatarPayBadge: {
      position: "absolute",
      bottom: -4,
      right: -4,
      minWidth: 18,
      height: 18,
      borderRadius: 9,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: 4,
      borderWidth: 2,
      borderColor: c.surface,
    },
    avatarPayBadgeText: { color: "#fff", fontSize: 10, fontWeight: "800" },
    assignName: { color: c.textDim, fontSize: 11, fontWeight: "600" },
    unassignedHint: {
      color: c.textDim,
      fontSize: 12,
      paddingHorizontal: 14,
      paddingBottom: 12,
      fontStyle: "italic",
    },
    qtyWarnBanner: { marginHorizontal: 14, marginBottom: 4, gap: 2 },
    qtyWarnSub: { color: c.textDim, fontSize: 12 },
    qtyOkBanner: { marginHorizontal: 14, marginBottom: 4, paddingVertical: 8 },
    itemRowSuggested: {
      borderColor: c.primary,
      borderWidth: 1,
    },
    suggestStrip: {
      marginHorizontal: 16,
      marginBottom: 8,
      gap: 8,
    },
    suggestLoadingRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
    },
    suggestActions: {
      flexDirection: "row",
      gap: 8,
      flexWrap: "wrap",
    },
    btnCompact: {
      paddingVertical: 8,
      paddingHorizontal: 14,
      minWidth: 0,
    },

    // Pay ayarı
    weights: {
      gap: 6,
      borderTopWidth: 1,
      borderTopColor: c.border,
      paddingTop: 10,
      paddingHorizontal: 14,
      paddingBottom: 12,
    },
    weightHint: { color: c.textDim, fontSize: 12 },
    weightRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
    weightName: { color: c.text, fontSize: 14, fontWeight: "600" },
    dot: { width: 10, height: 10, borderRadius: 5 },
    stepper: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      backgroundColor: c.chipOff,
      borderRadius: radius.pill,
      paddingHorizontal: 6,
      paddingVertical: 4,
    },
    stepBtn: {
      width: 30,
      height: 30,
      borderRadius: 15,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: c.surface,
    },
    stepBtnDisabled: { opacity: 0.35 },
    stepBtnText: { color: c.text, fontSize: 18, fontWeight: "700", lineHeight: 20 },
    stepValue: {
      color: c.text,
      fontSize: 16,
      fontWeight: "700",
      minWidth: 16,
      textAlign: "center",
    },

    // Özet (Adım 4)
    summaryCard: {
      backgroundColor: c.surface,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: c.border,
      padding: 14,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 10,
    },
    summaryName: { color: c.text, fontSize: 16, fontWeight: "700" },
    summaryDetail: { color: c.textDim, fontSize: 12, marginTop: 2 },
    summaryAmount: { color: c.text, fontSize: 17, fontWeight: "800" },
    totalRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      paddingHorizontal: 4,
      paddingTop: 4,
    },
    totalLabel: { color: c.text, fontSize: 18, fontWeight: "800" },
    totalAmount: { color: c.success, fontSize: 22, fontWeight: "800" },

    // Vergi & Bahşiş (katlanabilir)
    collapseHead: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      paddingVertical: 12,
      paddingHorizontal: 4,
    },
    collapseTitle: { color: c.textDim, fontSize: 15, fontWeight: "700" },
    collapseChevron: { color: c.textDim, fontSize: 14 },
    collapseBody: { gap: 12 },
    switchRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
    label: { color: c.text, fontSize: 15 },
    segment: {
      flex: 1,
      paddingVertical: 11,
      borderRadius: radius.md,
      alignItems: "center",
      backgroundColor: c.chipOff,
      borderWidth: 1,
      borderColor: c.border,
    },
    segmentOn: { backgroundColor: c.primary, borderColor: c.primary },
    segmentText: { color: c.textDim, fontWeight: "600", fontSize: 14 },
    segmentTextOn: { color: c.primaryText },

    // Yapışkan alt bar
    footer: {
      paddingHorizontal: 20,
      paddingTop: 10,
      paddingBottom: 28,
      gap: 10,
      borderTopWidth: 1,
      borderTopColor: c.border,
      backgroundColor: c.surface,
    },
    miniBar: { gap: 8, paddingRight: 8 },
    miniChip: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      backgroundColor: c.surfaceAlt,
      borderRadius: radius.pill,
      paddingVertical: 6,
      paddingHorizontal: 12,
      borderWidth: 1,
      borderColor: c.border,
    },
    miniDot: { width: 8, height: 8, borderRadius: 4 },
    miniName: { color: c.textDim, fontSize: 13, fontWeight: "600" },
    miniAmount: { color: c.text, fontSize: 13, fontWeight: "800" },
    footerHint: { color: c.textDim, fontSize: 13, textAlign: "center", lineHeight: 18 },
    footerHintWarn: { color: c.warn, fontWeight: "600" },
  });
}
