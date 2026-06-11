# @ahb/split-engine

Akıllı Hesap Bölüşme uygulamasının **deterministik bölüşme motoru**.
Saf TypeScript; UI / kamera / ağ / IO bağımlılığı **yoktur**. Bu sayede iOS, Android
ve Web'de aynı kod çalışır ve %100 test edilebilir (bkz. `DESIGN.md` §4, §6).

## İlkeler

- **Para = kuruş-int.** Her tutar tam sayı kuruştur (`19,99 → 1999`); float yok.
- **En büyük kalan yöntemi.** Bölüşmede toplam birebir korunur — kuruş kaybı/fazlası olmaz.
- **OCR ↔ atama ayrımı.** Girdi = OCR çıktısı (`Receipt`) + kullanıcı kararı
  (`people`, `assignments`, `tip`). Çıktı = kişi başı `PersonSplit`.
- **3 katman.** Pay = kalem payı + oransal vergi + oransal/eşit bahşiş.

## Kullanım

```ts
import { computeSplit, toCents } from "@ahb/split-engine";

const result = computeSplit({
  receipt: {
    lineItems: [
      { id: "steak", name: "Steak", qty: 1, totalPriceCents: toCents("25.00") },
      { id: "salata", name: "Salata", qty: 1, totalPriceCents: toCents("8.00") },
      { id: "meze", name: "Meze", qty: 1, totalPriceCents: toCents("10.00") },
    ],
    charges: {
      subtotalCents: 4300, taxCents: 0, serviceChargeCents: 0,
      discountCents: 0, tipCents: 430, totalCents: 4730,
      taxIncludedInItems: true,
    },
  },
  people: [
    { id: "ali", name: "Ali" },
    { id: "ayse", name: "Ayşe" },
    { id: "mehmet", name: "Mehmet" },
  ],
  assignments: [
    { lineItemId: "steak", personId: "ali" },
    { lineItemId: "salata", personId: "ayse" },
    { lineItemId: "meze", personId: "ali" },
    { lineItemId: "meze", personId: "ayse" },
    { lineItemId: "meze", personId: "mehmet" },
  ],
});
// → Ali 3118, Ayşe 1246, Mehmet 366 (toplam 4730 = 47.30 TL)
```

## Komutlar

```bash
npm test          # vitest (22 test: §4 doğrulanmış örnek + invariant + kenar durumları)
npm run typecheck # tsc --noEmit
npm run build     # dist/ üretir
```
