# Tarama Benchmark Harness

Tarama hattının doğruluk ve hızını **ölçülebilir** kılar (DESIGN.md §2 başarı kriterleri).
Körlemesine "daha iyi oldu" demek yerine; sağlayıcıları (Document AI, Gemini-flash,
Gemini-pro) aynı altın-set üzerinde koşturup metrikleri karşılaştırır.

## Çalıştırma

```bash
# Ağsız self-test (yalnız rawFixture vakaları; anahtar gerekmez)
npm run bench -w @ahb/ai-orchestrator

# Gerçek görüntülerle Gemini flash + pro karşılaştırması
GEMINI_API_KEY=... npm run bench -w @ahb/ai-orchestrator

# Document AI'ı da dahil et (ADC + DOCAI_* env gerekir)
GEMINI_API_KEY=... DOCAI_PROJECT_ID=... DOCAI_PROCESSOR_ID=... DOCAI_LOCATION=eu \
  npm run bench -w @ahb/ai-orchestrator

# CI kapısı: F1 eşiği altına düşersek exit 1
AHB_BENCH_MIN_F1=0.9 npm run bench -w @ahb/ai-orchestrator
```

## Ölçülen metrikler

- **F1**: kalem precision/recall (fiyat birebir eşleşmesi temelli; isim benzerliğiyle ayrıştırılır).
- **total%**: genel toplamı birebir tutturan vaka oranı.
- **curr%**: para birimi doğru okunan vaka oranı.
- **düzelt**: tahmini manuel düzeltme sayısı (onaya düşen alan + düşük güven + isim-yanlış/eksik kalem).
- **p50ms / p95ms**: uçtan uca süre yüzdelikleri.

## Altın-sete gerçek fiş eklemek

1. Fiş görüntüsünü `bench/golden/images/<id>.jpg` altına koy.
2. `bench/golden/manifest.json`'a vaka ekle:

```json
{
  "id": "kebapci-2026-06",
  "imagePath": "images/kebapci-2026-06.jpg",
  "locale": "tr-TR",
  "expected": {
    "currency": "TRY",
    "totalCents": 47300,
    "items": [
      { "name": "Adana Kebap", "totalPriceCents": 18000 },
      { "name": "Ayran", "totalPriceCents": 3000 }
    ]
  }
}
```

3. `expected` alanını fişe bakarak elle etiketle (kuruş cinsinden). Hedef: 20-30 gerçek fiş.

`rawFixture` modu (önceden yakalanmış ham sağlayıcı çıktısı) yalnız harness'ın kendini
doğrulaması ve regresyon testleri içindir; gerçek kıyas için `imagePath` kullan.

> Not: `bench/golden/images/` Git'e eklenmez (gizlilik). `.gitignore`'a bakın.
