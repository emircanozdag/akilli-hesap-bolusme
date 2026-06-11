import { useMemo, useRef, useState } from "react";
import { formatCents } from "@ahb/split-engine";
import type { AnalyzedReceipt } from "@ahb/ai-orchestrator";
import {
  analyzedToState,
  computeFromState,
  isValidAmount,
  type PersonRow,
  type SplitState,
} from "./adapter.js";
import { analyzeDemo, analyzeViaServer, fileToBase64 } from "./api.js";
import { buildShareText } from "./share.js";

const CONFIDENCE_THRESHOLD = 0.6;

const PALETTE = [
  "#6366f1",
  "#ec4899",
  "#14b8a6",
  "#f59e0b",
  "#8b5cf6",
  "#ef4444",
  "#0ea5e9",
  "#84cc16",
];

const uid = (): string =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);

/** Başlangıç durumu = DESIGN.md §4 doğrulanmış örneği (Ali/Ayşe/Mehmet → 47.30). */
function seedState(): SplitState {
  const ali = { id: uid(), name: "Ali", color: PALETTE[0]! };
  const ayse = { id: uid(), name: "Ayşe", color: PALETTE[1]! };
  const mehmet = { id: uid(), name: "Mehmet", color: PALETTE[2]! };
  const steak = uid();
  const salata = uid();
  const meze = uid();
  return {
    currency: "₺",
    people: [ali, ayse, mehmet],
    items: [
      { id: steak, name: "Steak", price: "25,00" },
      { id: salata, name: "Salata", price: "8,00" },
      { id: meze, name: "Paylaşılan meze", price: "10,00" },
    ],
    assignments: {
      [steak]: [ali.id],
      [salata]: [ayse.id],
      [meze]: [ali.id, ayse.id, mehmet.id],
    },
    tax: { included: true, value: "" },
    tip: { mode: "proportional", isPercent: true, value: "10" },
  };
}

export function App() {
  const [state, setState] = useState<SplitState>(seedState);
  const [analysis, setAnalysis] = useState<AnalyzedReceipt | null>(null);
  const computed = useMemo(() => computeFromState(state), [state]);
  const money = (cents: number) => `${state.currency}${formatCents(cents)}`;

  const applyAnalyzed = (a: AnalyzedReceipt) => {
    setState((s) => analyzedToState(a, s.people));
    setAnalysis(a);
  };

  const peopleById = useMemo(
    () => Object.fromEntries(state.people.map((p) => [p.id, p] as const)),
    [state.people],
  );

  // --- mutasyon yardımcıları --------------------------------------------------
  const addItem = () =>
    setState((s) => ({
      ...s,
      items: [...s.items, { id: uid(), name: "", price: "" }],
    }));

  const updateItem = (id: string, patch: Partial<{ name: string; price: string }>) =>
    setState((s) => ({
      ...s,
      items: s.items.map((it) => (it.id === id ? { ...it, ...patch } : it)),
    }));

  const removeItem = (id: string) =>
    setState((s) => {
      const { [id]: _drop, ...rest } = s.assignments;
      return { ...s, items: s.items.filter((it) => it.id !== id), assignments: rest };
    });

  const addPerson = (name: string) =>
    setState((s) => {
      const trimmed = name.trim();
      if (!trimmed) return s;
      const person: PersonRow = {
        id: uid(),
        name: trimmed,
        color: PALETTE[s.people.length % PALETTE.length]!,
      };
      return { ...s, people: [...s.people, person] };
    });

  const removePerson = (id: string) =>
    setState((s) => ({
      ...s,
      people: s.people.filter((p) => p.id !== id),
      assignments: Object.fromEntries(
        Object.entries(s.assignments).map(([itemId, ids]) => [
          itemId,
          ids.filter((pid) => pid !== id),
        ]),
      ),
    }));

  const toggleAssign = (itemId: string, personId: string) =>
    setState((s) => {
      const current = s.assignments[itemId] ?? [];
      const next = current.includes(personId)
        ? current.filter((pid) => pid !== personId)
        : [...current, personId];
      return { ...s, assignments: { ...s.assignments, [itemId]: next } };
    });

  const assignAll = (itemId: string) =>
    setState((s) => ({
      ...s,
      assignments: { ...s.assignments, [itemId]: s.people.map((p) => p.id) },
    }));

  return (
    <div className="app">
      <header className="hero">
        <div className="hero__badge">Çevrimdışı çalışır · kuruşu kuruşuna</div>
        <h1>Akıllı Hesap Bölüşme</h1>
        <p>Kalemleri gir, kim ne yedi işaretle — payları anında ve hatasız hesaplayalım.</p>
      </header>

      <main className="layout">
        <div className="col">
          <ScanSection locale="tr-TR" onAnalyzed={applyAnalyzed} />

          {analysis && (
            <div className="banner banner--ok">
              Fiş okundu: <strong>{analysis.meta.merchant ?? "Fiş"}</strong> ·{" "}
              {analysis.receipt.lineItems.length} kalem
              {analysis.meta.currency ? ` · ${analysis.meta.currency}` : ""} · toplam{" "}
              {money(analysis.receipt.charges.totalCents)}
            </div>
          )}

          {analysis && analysis.needsConfirmation.length > 0 && (
            <div className="banner">
              Yapay zeka bazı alanlardan emin olamadı; lütfen kontrol et:{" "}
              {analysis.needsConfirmation
                .map((f) => (f === "currency" ? "para birimi" : f === "total" ? "toplam" : f))
                .join(", ")}
              .
            </div>
          )}

          <PeopleSection
            people={state.people}
            onAdd={addPerson}
            onRemove={removePerson}
          />

          <section className="card">
            <div className="card__head">
              <h2>Kalemler</h2>
              <button className="btn btn--ghost" onClick={addItem}>
                + Kalem ekle
              </button>
            </div>

            {state.items.length === 0 && (
              <p className="empty">Henüz kalem yok. “Kalem ekle” ile başla.</p>
            )}

            <ul className="items">
              {state.items.map((item) => {
                const assigned = state.assignments[item.id] ?? [];
                const shared = assigned.length > 1;
                const priceOk = isValidAmount(item.price);
                const conf = analysis?.itemConfidence[item.id];
                const lowConf = conf !== undefined && conf < CONFIDENCE_THRESHOLD;
                return (
                  <li key={item.id} className={`item ${lowConf ? "item--flagged" : ""}`}>
                    <div className="item__row">
                      <input
                        className="input input--grow"
                        placeholder="Kalem adı"
                        value={item.name}
                        onChange={(e) => updateItem(item.id, { name: e.target.value })}
                      />
                      <div className={`amount ${priceOk ? "" : "amount--bad"}`}>
                        <span className="amount__cur">{state.currency}</span>
                        <input
                          className="input input--amount"
                          inputMode="decimal"
                          placeholder="0,00"
                          value={item.price}
                          onChange={(e) => updateItem(item.id, { price: e.target.value })}
                          aria-invalid={!priceOk}
                        />
                      </div>
                      <button
                        className="icon-btn"
                        aria-label="Kalemi sil"
                        onClick={() => removeItem(item.id)}
                      >
                        ×
                      </button>
                    </div>

                    <div className="chips">
                      {state.people.map((p) => {
                        const on = assigned.includes(p.id);
                        return (
                          <button
                            key={p.id}
                            className={`chip ${on ? "chip--on" : ""}`}
                            style={on ? { background: p.color, borderColor: p.color } : undefined}
                            onClick={() => toggleAssign(item.id, p.id)}
                          >
                            {p.name}
                          </button>
                        );
                      })}
                      {state.people.length > 1 && (
                        <button className="chip chip--all" onClick={() => assignAll(item.id)}>
                          Herkes
                        </button>
                      )}
                      {shared && <span className="tag">paylaşılan · otomatik böl</span>}
                      {assigned.length === 0 && <span className="tag tag--warn">atanmadı</span>}
                      {lowConf && <span className="tag tag--warn">düşük güven · kontrol et</span>}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>

          <ChargesSection state={state} setState={setState} />
        </div>

        <div className="col">
          <SummarySection state={state} computed={computed} peopleById={peopleById} money={money} />
        </div>
      </main>

      <footer className="foot">
        Hesap istemcide, deterministik motorla yapılır — AI’a matematik yaptırılmaz (DESIGN.md §6).
      </footer>
    </div>
  );
}

function ScanSection(props: {
  locale: string;
  onAnalyzed: (a: AnalyzedReceipt) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (fn: () => Promise<AnalyzedReceipt>) => {
    setBusy(true);
    setError(null);
    try {
      props.onAnalyzed(await fn());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Tarama başarısız");
    } finally {
      setBusy(false);
    }
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    const { base64, mimeType } = await fileToBase64(file);
    await run(() => analyzeViaServer(base64, mimeType, props.locale));
  };

  return (
    <section className="card card--scan">
      <div className="card__head">
        <h2>Fiş tara</h2>
        <span className="tag">AI · OCR</span>
      </div>
      <p className="empty">
        Fişin fotoğrafını yükle; yapay zeka kalemleri ve fiyatları çıkarsın. Hesap her zaman
        cihazında, deterministik motorla yapılır.
      </p>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => void onFile(e.target.files?.[0] ?? undefined)}
      />
      <div className="addrow">
        <button
          className="btn btn--primary"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
        >
          {busy ? "Taranıyor…" : "Fiş yükle"}
        </button>
        <button className="btn btn--ghost" disabled={busy} onClick={() => void run(() => analyzeDemo(props.locale))}>
          Demo fiş (çevrimdışı)
        </button>
      </div>
      {error && <div className="banner banner--error">{error}</div>}
    </section>
  );
}

function PeopleSection(props: {
  people: PersonRow[];
  onAdd: (name: string) => void;
  onRemove: (id: string) => void;
}) {
  const [draft, setDraft] = useState("");
  const commit = () => {
    props.onAdd(draft);
    setDraft("");
  };
  return (
    <section className="card">
      <div className="card__head">
        <h2>Kişiler</h2>
        <span className="count">{props.people.length}</span>
      </div>
      <div className="people">
        {props.people.map((p) => (
          <span key={p.id} className="person" style={{ borderColor: p.color }}>
            <span className="person__dot" style={{ background: p.color }} />
            {p.name}
            <button
              className="person__x"
              aria-label={`${p.name} kişisini sil`}
              onClick={() => props.onRemove(p.id)}
            >
              ×
            </button>
          </span>
        ))}
      </div>
      <div className="addrow">
        <input
          className="input input--grow"
          placeholder="İsim ekle"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
          }}
        />
        <button className="btn" onClick={commit} disabled={!draft.trim()}>
          Ekle
        </button>
      </div>
    </section>
  );
}

function ChargesSection(props: {
  state: SplitState;
  setState: React.Dispatch<React.SetStateAction<SplitState>>;
}) {
  const { state, setState } = props;
  return (
    <section className="card">
      <div className="card__head">
        <h2>Vergi & Bahşiş</h2>
      </div>

      <div className="field">
        <label className="switch">
          <input
            type="checkbox"
            checked={state.tax.included}
            onChange={(e) =>
              setState((s) => ({ ...s, tax: { ...s.tax, included: e.target.checked } }))
            }
          />
          <span>KDV fiyatlara dahil</span>
        </label>
        {!state.tax.included && (
          <div className="amount">
            <span className="amount__cur">{state.currency}</span>
            <input
              className="input input--amount"
              inputMode="decimal"
              placeholder="Vergi tutarı"
              value={state.tax.value}
              onChange={(e) =>
                setState((s) => ({ ...s, tax: { ...s.tax, value: e.target.value } }))
              }
            />
          </div>
        )}
      </div>

      <div className="field">
        <div className="seg">
          <button
            className={`seg__btn ${state.tip.isPercent ? "seg__btn--on" : ""}`}
            onClick={() => setState((s) => ({ ...s, tip: { ...s.tip, isPercent: true } }))}
          >
            Yüzde %
          </button>
          <button
            className={`seg__btn ${!state.tip.isPercent ? "seg__btn--on" : ""}`}
            onClick={() => setState((s) => ({ ...s, tip: { ...s.tip, isPercent: false } }))}
          >
            Tutar
          </button>
        </div>
        <div className="amount">
          {!state.tip.isPercent && <span className="amount__cur">{state.currency}</span>}
          <input
            className="input input--amount"
            inputMode="decimal"
            placeholder={state.tip.isPercent ? "Bahşiş %" : "Bahşiş tutarı"}
            value={state.tip.value}
            onChange={(e) => setState((s) => ({ ...s, tip: { ...s.tip, value: e.target.value } }))}
          />
          {state.tip.isPercent && <span className="amount__cur">%</span>}
        </div>
      </div>

      <div className="field">
        <span className="field__label">Bahşiş dağıtımı</span>
        <div className="seg">
          <button
            className={`seg__btn ${state.tip.mode === "proportional" ? "seg__btn--on" : ""}`}
            onClick={() => setState((s) => ({ ...s, tip: { ...s.tip, mode: "proportional" } }))}
          >
            Harcamaya oranlı
          </button>
          <button
            className={`seg__btn ${state.tip.mode === "equal" ? "seg__btn--on" : ""}`}
            onClick={() => setState((s) => ({ ...s, tip: { ...s.tip, mode: "equal" } }))}
          >
            Eşit
          </button>
        </div>
      </div>
    </section>
  );
}

function SummarySection(props: {
  state: SplitState;
  computed: ReturnType<typeof computeFromState>;
  peopleById: Record<string, PersonRow>;
  money: (cents: number) => string;
}) {
  const { state, computed, peopleById, money } = props;
  const [copied, setCopied] = useState(false);

  if (!computed) {
    return (
      <section className="card card--summary">
        <div className="card__head">
          <h2>Özet</h2>
        </div>
        <p className="empty">En az bir kişi ve bir kalem ekleyince bölüşüm burada görünür.</p>
      </section>
    );
  }

  const share = async () => {
    const text = buildShareText(state, computed, peopleById);
    try {
      if (navigator.share) {
        await navigator.share({ title: "Hesap bölüşümü", text });
      } else {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
      }
    } catch {
      /* kullanıcı paylaşımı iptal etti */
    }
  };

  return (
    <section className="card card--summary">
      <div className="card__head">
        <h2>Özet</h2>
        <div className="grand">{money(computed.grandTotalCents)}</div>
      </div>

      <ul className="splits">
        {computed.result.perPerson.map((s) => {
          const person = peopleById[s.personId];
          return (
            <li key={s.personId} className="split">
              <div className="split__top">
                <span className="person__dot" style={{ background: person?.color }} />
                <span className="split__name">{person?.name ?? "Kişi"}</span>
                <span className="split__total">{money(s.totalCents)}</span>
              </div>
              <div className="split__break">
                <span>Kalemler {money(s.itemsCents)}</span>
                {s.taxCents > 0 && <span>Vergi {money(s.taxCents)}</span>}
                {s.tipCents !== 0 && <span>Bahşiş {money(s.tipCents)}</span>}
              </div>
            </li>
          );
        })}
      </ul>

      <div className="totals">
        <div>
          <span>Ara toplam</span>
          <span>{money(computed.subtotalCents)}</span>
        </div>
        {computed.taxCents > 0 && (
          <div>
            <span>Vergi</span>
            <span>{money(computed.taxCents)}</span>
          </div>
        )}
        {computed.tipCents !== 0 && (
          <div>
            <span>Bahşiş</span>
            <span>{money(computed.tipCents)}</span>
          </div>
        )}
        <div className="totals__grand">
          <span>Toplam</span>
          <span>{money(computed.grandTotalCents)}</span>
        </div>
      </div>

      {computed.result.warnings.length > 0 && (
        <ul className="warnings">
          {computed.result.warnings.map((w, i) => (
            <li key={i}>{w.message}</li>
          ))}
        </ul>
      )}

      <button className="btn btn--primary btn--block" onClick={share}>
        {copied ? "Kopyalandı ✓" : "Sonucu paylaş"}
      </button>
    </section>
  );
}
