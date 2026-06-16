/**
 * EscalatingProvider — dengeli kademeli tarama stratejisi (DESIGN.md §7).
 *
 * Splipay gibi "hızlı + neredeyse hatasız" uygulamaların hissini hedefler:
 *  1. Birincil (hızlı) model her zaman önce çalışır → düşük gecikme.
 *  2. Sonuç şüpheliyse (şema bozuk / toplam tutmuyor / düşük güven) tek seferlik
 *     güçlü modele yükseltilir; iki sonuçtan kalitece iyisi seçilir → maliyet yalnız
 *     şüpheli fişlerde artar.
 *  3. Birincil model tümüyle erişilemezse (aşırı yük / kota) yedek sağlayıcıya düşülür.
 *
 * Kendisi bir VisionProvider'dır: ham (doğrulanmamış) JSON döndürür; nihai doğrulama
 * yine pipeline'da (orchestrate → analyzeRaw) yapılır. Kalite kararı için gradeRaw'ı
 * (analyzeRaw'ın saf sarmalayıcısı) kullanır → tek doğruluk kaynağı.
 */
import { gradeRaw, isBetterGrade, shouldEscalate, type OrchestrateOptions } from "../pipeline.js";
import {
  ProviderError,
  isStreamingProvider,
  type StreamingVisionProvider,
  type VisionProvider,
} from "../provider.js";
import { extractLineItems, type PartialLineItem } from "../partial-json.js";
import type { AnalyzeInput } from "../types.js";

export interface EscalatingOptions {
  /** Hızlı birincil sağlayıcı (ör. Gemini flash). */
  primary: VisionProvider;
  /** Şüpheli sonuçta denenecek güçlü sağlayıcı (ör. Gemini pro). Yoksa yükseltme yapılmaz. */
  escalation?: VisionProvider;
  /** Birincil erişilemezse düşülecek yedek (ör. Document AI). Yoksa hata yükselir. */
  fallback?: VisionProvider;
  /** gradeRaw'a geçirilecek pipeline seçenekleri (confidence eşiği vb.). */
  orchestrateOptions?: OrchestrateOptions;
  /** Test/gözlem için yükseltme olaylarını dinler. */
  onEscalation?: (info: { reason: "low_quality"; from: string; to: string }) => void;
  onFallback?: (info: { from: string; to: string; cause: string }) => void;
}

/**
 * Yedeğe düşmeyi tetikleyen sağlayıcı sinyalleri:
 *  - Erişilemezlik (aşırı yük / kota / sunucu): HTTP 429/5xx, UNAVAILABLE, overloaded...
 *  - Kimlik/yapılandırma (geçersiz/eksik/engelli anahtar): HTTP 401/403,
 *    API_KEY_*, PERMISSION_DENIED, UNAUTHENTICATED → "anahtar sorunluysa Gemini'ye
 *    geçiş sistemi çökertmesin, DocAI'a zarif düşsün".
 * Şema/parse hataları KAPSAM DIŞIdır (gerçek işleme hatasını maskelemeyelim → yükselir).
 */
const FALLBACK_SIGNAL_RE =
  /HTTP (?:401|403|429|500|502|503|504)|UNAVAILABLE|PERMISSION_DENIED|UNAUTHENTICATED|API[_ ]?KEY|high demand|overloaded|kota/i;

/** Geçici ağ/bağlantı hataları — yedek sağlayıcıya (DocAI) düşülebilir. */
const NETWORK_SIGNAL_RE =
  /akış isteği başarısız|Gemini isteği başarısız|fetch failed|Connect Timeout|UND_ERR|ECONNRESET|ETIMEDOUT|socket hang up/i;

function shouldFallback(err: unknown): boolean {
  if (!(err instanceof ProviderError)) return false;
  if (FALLBACK_SIGNAL_RE.test(err.message) || NETWORK_SIGNAL_RE.test(err.message)) return true;
  let cause: unknown = err.cause;
  while (cause) {
    const msg = cause instanceof Error ? cause.message : String(cause);
    if (FALLBACK_SIGNAL_RE.test(msg) || NETWORK_SIGNAL_RE.test(msg)) return true;
    if (typeof cause === "object" && cause !== null && "code" in cause) {
      const code = String((cause as { code: unknown }).code);
      if (/UND_ERR|ECONNRESET|ETIMEDOUT/i.test(code)) return true;
    }
    cause = cause instanceof Error ? cause.cause : undefined;
  }
  return false;
}

export class EscalatingProvider implements StreamingVisionProvider {
  readonly name: string;

  constructor(private readonly opts: EscalatingOptions) {
    if (!opts.primary) throw new ProviderError("EscalatingProvider primary gerekli", "escalating");
    this.name = `escalating(${opts.primary.name})`;
  }

  async analyze(input: AnalyzeInput): Promise<unknown> {
    const { primary, escalation, fallback, orchestrateOptions } = this.opts;

    let primaryRaw: unknown;
    try {
      primaryRaw = await primary.analyze(input);
    } catch (err) {
      // Birincil erişilemez ya da anahtar/kimlik sorunlu → yedeğe düş (varsa).
      // Şema/parse gibi gerçek işleme hataları yükselir (maskelenmez).
      if (fallback && shouldFallback(err)) {
        this.opts.onFallback?.({
          from: primary.name,
          to: fallback.name,
          cause: err instanceof Error ? err.message : String(err),
        });
        return fallback.analyze(input);
      }
      throw err;
    }

    const primaryGrade = gradeRaw(primaryRaw, input, orchestrateOptions ?? {});

    // Birincil yeterince iyi → hızlı yoldan dön.
    if (!shouldEscalate(primaryGrade)) return primaryRaw;

    // Yükseltme yolu: güçlü modeli dene, iki sonuçtan iyisini seç.
    if (escalation) {
      this.opts.onEscalation?.({ reason: "low_quality", from: primary.name, to: escalation.name });
      try {
        const escalatedRaw = await escalation.analyze(input);
        const escalatedGrade = gradeRaw(escalatedRaw, input, orchestrateOptions ?? {});
        return isBetterGrade(escalatedGrade, primaryGrade) ? escalatedRaw : primaryRaw;
      } catch {
        // Yükseltme başarısız (ağ/kota): elde kalan birincil sonuçla en iyi çabayı sun.
        return primaryRaw;
      }
    }

    return primaryRaw;
  }

  /**
   * Akışlı tarama hız için doğrudan birincil (hızlı) sağlayıcıya delege edilir —
   * yükseltme/yedek mantığı çalışmaz (algılanan gecikme önceliklidir; nihai doğrulama
   * yine pipeline'da). Birincil akış desteklemiyorsa tek-seferlik analize düşer ve
   * kalemleri sonda topluca yayınlar.
   */
  async analyzeStream(
    input: AnalyzeInput,
    onItem: (item: PartialLineItem) => void,
  ): Promise<unknown> {
    const { primary } = this.opts;
    if (isStreamingProvider(primary)) {
      try {
        return await primary.analyzeStream(input, onItem);
      } catch {
        // Akış başarısız (ağ, parse, kota) → tam analiz yoluna düş (yükseltme + DocAI yedek).
        // İstemcinin ikinci istek atmasına gerek kalmaz; zaman aşımı riski azalır.
        const raw = await this.analyze(input);
        for (const it of extractLineItems(JSON.stringify(raw))) onItem(it);
        return raw;
      }
    }
    const raw = await this.analyze(input);
    for (const it of extractLineItems(JSON.stringify(raw))) onItem(it);
    return raw;
  }
}
