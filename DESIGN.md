# Akıllı Hesap Bölüşme Uygulaması — Tasarım Belgesi

> Durum: Tasarım / planlama aşaması. Kodlama henüz başlamadı.
> Son güncelleme: 2026-06-09

Kullanıcıların restoran adisyonunu telefon kamerasıyla taradığı, yapay zeka tabanlı OCR
ile ürün ve fiyatları ayıkladığı ve bir grup arkadaşın masrafları zahmetsizce bölüştüğü
çok platformlu (iOS + Android + Web) mobil uygulama.

---

## 1. Pazar & Konumlandırma

- **Eski nesil** (Splitwise / Tricount / Settle Up): fiş tarama ya ücretli ya yok.
  Splitwise ücretsiz katmanı kısıtladı (günlük limit + her masrafta zorunlu video reklam).
- **Yeni nesil** (Split Ease, SplitSnap, BillBoss vb.): AI tarama var ama çoğu
  **yalnızca iOS** ve **ABD-merkezli**.
- **Açık / fırsat:** iOS + Android + Web; gerçek **uluslararası yerelleştirme**
  (bölgesel bahşiş kültürü + yerel ödeme yöntemleri).

### Tek cümlelik konumlandırma
AI fiş tarama (ücretsiz) + arkadaşların uygulama indirmeden ödemesi + her ülkenin
bahşiş kültürü ve ödeme yöntemiyle uyumlu, çok platformlu hesap bölüşme.

### İş modeli
- Ücretsiz katman: aylık N tarama + sınırsız manuel giriş.
- Pro: sınırsız tarama (aylık/yıllık abonelik).
- Zorunlu video reklam YOK (rakiplerin en nefret edilen özelliği).

---

## 2. MVP Kapsamı & Yol Haritası

### Aşama 1 — MVP (olmazsa olmaz)
- Kamera ile fiş tarama + AI ayıklama (ürün, adet, fiyat, ara toplam, vergi).
- Düzeltme ekranı (AI'ın emin olmadığı alanlar işaretli — güvenin temeli).
- Kişi ekleme (üyeliksiz, sadece isim).
- Üç bölüşme modu: eşit / kalem-bazlı / paylaşılan kalem (otomatik böl).
- Oransal vergi + bahşiş dağıtımı + kuruş yuvarlama düzeltmesi.
- Sonuç paylaşımı: kişi başı özet link/görsel (WhatsApp vb.).
- Bölgeye duyarlı basit bahşiş davranışı.

### Aşama 2 — İlk büyüme (yapışkanlık)
- Üyelik + kalıcı gruplar + geçmiş adisyonlar.
- Borç takibi + sadeleştirme (A→B, B→C).
- "Bir kişi ödedi, diğerleri borçlu" (running balance).
- Çoklu para birimi + döviz kuru.
- Gerçek zamanlı ortak bölüşme (herkes kendi telefonundan seçer).

### Aşama 3 — Uluslararası ölçek & gelir
- Yerel ödeme derin-linkleri / QR (UPI, PIX, Venmo, IBAN/iyzico — bölgeye göre).
- Tam bölgesel bahşiş/servis motoru (ABD %18-20 vs Asya gizle vs Avrupa "dahil").
- Pro abonelik.
- Çevrimdışı mod + senkronizasyon.

### Başarı kriterleri
- Tarama → paylaşım **< 60 saniye**.
- AI ayıklama sonrası **< 2 manuel düzeltme** ortalama.
- Toplamlar **%100** tutar (yuvarlama dahil hiç hata yok).

---

## 3. Kullanıcı Akışı (MVP)

```
Ana ekran → Kamera/tarama → AI işleme → Düzeltme (şüpheli alan işaretli)
  → Kişi ekle → Ürün atama (paylaşılan otomatik böl) → Vergi+bahşiş
  → Özet (kişi başı döküm) → Paylaşım (link/görsel)
```

### Tasarım ilkeleri
- **Geri dönülebilirlik:** her adımdan öncekine kayıpsız dönüş (özellikle Özet → Atama).
- **Tek baskın aksiyon:** her ekranda net bir "ileri" butonu.
- **Sürtünme yok:** üyelik/giriş MVP'de yok; değer önce, kayıt sonra.
- **Şeffaflık:** her tutarın "neden bu kadar" dökümü açılabilir.

---

## 4. Bölüşme Algoritması

### Altın kural
Her parasal değer **kuruş cinsinden tam sayı** (integer) olarak tutulur. Float yok.
`19,99 TL → 1999`. Hesap tam sayıyla yapılır, sadece ekranda 100'e bölünür.

### 3 katman
Kişinin payı = **kalem payları + vergi payı (oransal) + bahşiş payı (oransal/eşit)**.

### Küsürat: En Büyük Kalan Yöntemi
```
Bir tutarı N kişiye bölmek için:
1. taban = tutar / N   (tam sayı bölme)
2. kalan = tutar % N
3. Herkese 'taban' ver.
4. Artan 'kalan' kuruşu kişilere 1'er dağıt (deterministik sıra).
```
- Oransal katmanlarda artan kuruş **en büyük ondalık küsüratı** olana gider.
- Kalem bölüşmesinde artan kuruş **dönüşümlü** verilir (uzun vadede dengelenir).
- Eşitlik bozulursa isim/ID sırası karar verir.

### Doğrulanmış örnek
3 kişi, 3 kalem + %10 bahşiş (KDV dahil):
- Steak 25.00 → Ali, Salata 8.00 → Ayşe, Paylaşılan meze 10.00 → 3 kişi.
- Kalemler: Ali 28.34, Ayşe 11.33, Mehmet 3.33 (toplam 43.00).
- Bahşiş 4.30 oransal: Ali +2.84, Ayşe +1.13, Mehmet +0.33.
- **Sonuç:** Ali 31.18 + Ayşe 12.46 + Mehmet 3.66 = **47.30 TL** = fişe birebir eşit.

### Kenar durumları
- Atanmamış kalem → engelle ya da "kalan herkese eşit".
- Kalemler toplamı ≠ fiş toplamı → uyar, "fark" satırı önerisi.
- Negatif kalem (indirim) → oransal düşülür.
- Sıfıra bölme koruması.
- Büyük gruplar → en büyük kalan yine toplamı korur.

---

## 5. Veri / OCR Şeması

### OCR çıktısı ("fişte ne var")
`meta` (merchant, date, currency, locale, language) + `line_items`
(her alanda `confidence`, `raw_text`, `flags`, `category`, unit_price + total_price) +
`charges` (subtotal, tax, service_charge, discount, tip, total) +
`validation` (items_sum, declared_total, balanced, discrepancy) +
`regional` (bizim eklediğimiz: tipping_norm, suggested_tip_percentages).

- Tüm tutarlar kuruş (integer).
- KDV dahilse `tax.included_in_items = true` → algoritmada vergi katmanı atlanır.
- `regional` bloğunu AI üretmez; locale'e göre **biz deterministik ekleriz**.

### Atama katmanı ("kullanıcı kararı") — ayrı yapı
`people` (id, name, color) + `assignments` (line_item_id → people_ids) +
`tip` (amount, mode) + `tax_mode`.

OCR ve atama **ayrı tutulur**: tek sorumluluk + tekrar kullanım + AI sınırı net.
Algoritmanın girdisi = OCR çıktısı + atama katmanı.

---

## 6. Sistem Mimarisi

### Kritik kararlar
1. **Bölüşme motoru istemcide & yerel** — anında, çevrimdışı, sunucu maliyeti yok.
   AI'a ASLA matematik yaptırılmaz; hesap deterministik test edilebilir kodda.
2. **İnce backend orkestrasyon** AI çağrısını yönetir — anahtar güvenliği, kullanıcı
   kotası, sağlayıcı-bağımsızlık, önbellek, yeniden deneme.
3. **Görüntü ön-işleme cihazda** — kırp/sıkıştır/kenar → maliyet↓, doğruluk↑.
4. **Önce yerel, sonra bulut** kalıcılık — MVP'de kayıt opsiyonel.
5. **Ödeme taşınmaz, yönlendirilir** — bölgeye uygun ödeme derin-linki/QR üret
   (regülasyon riskinden kaçınma).

### Önerilen yığın
| Katman | Öneri | Neden |
|---|---|---|
| İstemci | React Native veya Flutter | Tek kod → iOS + Android + Web |
| Backend | FastAPI/NestJS veya Supabase (BaaS) | MVP'de hız |
| OCR/AI | Vision-LLM (Gemini/GPT-4o) veya AWS Textract | Sağlayıcı-bağımsız |
| DB | PostgreSQL | İlişkisel model doğal oturur |
| Bölüşme motoru | Saf TS/Dart modülü | Platformdan bağımsız, %100 test edilebilir |

---

## 7. AI / OCR Katmanı

### Karar
**Vision-LLM birincil** (çok dilli, zengin şemayı tek çağrıda üretir),
belge-OCR (Textract/Vision) opsiyonel hibrit hızlandırıcı.

### Prompt mimarisi
- **Sistem talimatı:** kuruş int, her alana confidence, uydurma yok, hesap yapma,
  sadece geçerli JSON, KDV/servis tespiti.
- **Şema sözleşmesi:** structured output / JSON mode ile şema dışına çıkış engellenir.
- **Few-shot:** düşük güven flag'leme, KDV-dahil işaretleme, raw_text doldurma davranışı.

### Güvenilirlik (orkestrasyonda)
Şema doğrulama → aritmetik doğrulama (balanced?) → çapraz kontrol (qty×unit≈total) →
normalizasyon (kuruş int, ISO para birimi) → `regional` deterministik enjeksiyon →
güven eşiği altında kritik alanları (currency/total) zorunlu onaylatma.

### Maliyet kontrolü
Küçük görüntü, kullanıcı kotası (sunucuda), önbellek (görüntü hash), model kademesi
(önce ucuz, gerekirse pahalı), tek çağrı disiplini (düzeltmeler yerel, AI'a gitmez).

---

## 8. Veri Modeli / DB Şeması

### Tasarım ilkeleri
- **MVP'de minimum, Aşama 2'yi kırmadan taşı:** üyelik/grup tabloları şemada vardır
  ama MVP akışında **opsiyoneldir** (nullable FK). Önce yerel, sonra bulut (bkz. §6.4).
- **Para = kuruş int** her sütunda (`BIGINT`), para birimi ayrı `currency` (ISO 4217).
- **OCR ↔ atama ayrımı korunur** (§5): `line_item` ham OCR gerçeğini, `assignment`
  kullanıcı kararını, `split` hesaplanmış sonucu tutar. Üçü karışmaz.
- **Split türetilmiş veridir:** atama/bahşiş değişince yeniden hesaplanır; kaynak
  doğruluk `line_item + assignment`'tedir (denormalize önbellek + paylaşım anlık görüntüsü).
- **Soft-delete + audit:** `created_at`, `updated_at`, `deleted_at` her tabloda.

### Varlıklar ve aşama
| Tablo | Aşama | Rol |
|---|---|---|
| `user` | 2 | Kayıtlı kullanıcı (kimlik, locale, varsayılan para birimi) |
| `group` | 2 | Kalıcı grup (ev arkadaşları, seyahat) |
| `group_member` | 2 | user ↔ group (rol: owner/member) |
| `person` | **1 (MVP)** | Bölüşmedeki katılımcı; üyeliksiz (sadece isim+renk), opsiyonel user'a bağlı |
| `receipt` | **1 (MVP)** | Adisyon başlığı + OCR `charges` + `validation` özeti |
| `line_item` | **1 (MVP)** | Ham OCR kalemi (confidence, flags, raw_text) |
| `assignment` | **1 (MVP)** | line_item ↔ person (M:N), kullanıcı kararı |
| `split` | **1 (MVP)** | Kişi başı hesaplanmış sonuç (kalem+vergi+bahşiş katmanları) |
| `balance` | 2 | Gruplar arası running balance / borç (A→B) |
| `payment_link` | 3 | Bölgesel ödeme derin-link/QR (üretilen, saklanmaz hassas veri) |

### İlişkiler
```
user 1─* group_member *─1 group
group 1─* receipt           (MVP'de receipt.group_id NULL olabilir)
user  1─* receipt           (created_by; MVP'de NULL = anonim oturum)
receipt 1─* person          (bu adisyona özgü katılımcılar; MVP yolu)
group   1─* person          (Aşama 2: kalıcı grup üyesi person)
person  *─1 user            (opsiyonel: misafir person bir user'a bağlanabilir)
receipt 1─* line_item
line_item *─* person   ↔   assignment (junction; shared kalem = çok person)
receipt 1─* split  *─1 person
group   1─* balance         (from_person_id, to_person_id)
```

### Çekirdek alanlar (MVP)

**receipt** — OCR `meta` + `charges` + `validation` özetini taşır:
`id, group_id?, created_by?, merchant, purchased_at, currency, locale,
subtotal_cents, tax_cents, service_charge_cents, discount_cents, tip_cents,
total_cents, tax_included_in_items (bool), tip_mode (proportional|equal),
tax_mode, image_hash, status (draft|confirmed|shared),
items_sum_cents, balanced (bool), discrepancy_cents, timestamps`

**line_item** — ham OCR gerçeği, asla hesap sonucu tutmaz:
`id, receipt_id, name, qty, unit_price_cents, total_price_cents, category,
is_shared (bool), confidence (0-1), raw_text, flags (jsonb), sort_order`

**person** — üyeliksiz katılımcı (sürtünmesiz, §3):
`id, receipt_id?, group_id?, user_id?, name, color, timestamps`

**assignment** — kullanıcı kararı (M:N junction):
`id, line_item_id, person_id, weight (paylaşımda pay ağırlığı, varsayılan 1)`
→ benzersiz `(line_item_id, person_id)`.

**split** — türetilmiş sonuç önbelleği (§4 üç katman):
`id, receipt_id, person_id, items_cents, tax_cents, tip_cents, total_cents,
computed_at` → benzersiz `(receipt_id, person_id)`.
**Değişmez (invariant):** `Σ split.total_cents == receipt.total_cents` (kuruş hatası 0).

### Neden bu şema
- `assignment` ayrı junction → paylaşılan kalem doğal M:N; `weight` ile eşitsiz
  bölüşmeye (ör. biri 2 kişilik aldı) hazır.
- `split` denormalize → paylaşım linki/görseli anlık görüntü; sonradan atama değişse
  bile paylaşılan özet tutarlı kalır (`computed_at` ile sürümlenir).
- `person.user_id` nullable → MVP misafiri ileride hesabına bağlanır (göç kolay).
- `image_hash` → §7 önbellek (aynı fiş ikinci kez AI'a gitmez).

### Kalıcılık stratejisi (§6.4 ile uyumlu)
- **MVP:** istemcide yerel store (SQLite/IndexedDB) aynı şemayı yansıtır; bulut opsiyonel.
- **Aşama 2:** Postgres'e senkron; `id`'ler UUID (çevrimdışı üretilebilir, çakışmaz).
- Şema-uyum: yerel ↔ bulut tablo adları/sütunları **birebir aynı** → senkron basit.

---

## 9. Kesişen Kaygılar (NFR)

Fonksiyonel olmayan ama ürünü ayakta tutan gereksinimler. Üçü de §6 mimari
kararlarından doğal türer: **istemci-merkezli hesap, ince backend, önce yerel**.

### 9.1 Gizlilik & KVKK / GDPR
- **Veri minimizasyonu:** MVP'de üyelik yok → kişisel veri toplanmaz. `person`
  yalnızca **isim + renk** (kullanıcının girdiği takma ad olabilir). E-posta/telefon yok.
- **Fiş görüntüsü = en hassas varlık.** Politika:
  - Cihazda ön-işlenir (§6.3), AI'a **sıkıştırılmış** gider, sunucuda **kalıcı saklanmaz**.
  - Backend yalnızca işler → JSON döner → görüntüyü **işlem sonrası siler** (geçici buffer).
  - Önbellek **görüntünün kendisini değil `image_hash` + çıkarılan JSON'u** tutar.
- **Açık aydınlatma + rıza:** ilk taramada "fiş AI'a gönderilir, saklanmaz" mikro-bilgi.
- **Kullanıcı hakları (Aşama 2 / kayıtlı):** dışa aktar (JSON) + **tek tıkla tüm veriyi sil**
  (right to erasure). Soft-delete sonrası N gün içinde hard-delete job.
- **AI sağlayıcı sözleşmesi:** "veriyle eğitim yapma" (no-training) modunu zorunlu seç;
  bölgesel veri-ikametgâhı (AB kullanıcısı → AB endpoint) Aşama 3'te.
- **Lokalizasyon:** KVKK (TR) + GDPR (AB) + CCPA (ABD) — aynı minimizasyon tabanı hepsini karşılar.

### 9.2 Güvenlik
- **AI anahtarı asla istemcide olmaz** (§6.2). Tüm AI çağrısı ince backend üzerinden;
  istemci backend'e, backend sağlayıcıya konuşur.
- **Kota & kötüye kullanım:** kullanıcı/cihaz başına tarama kotası **sunucuda** uygulanır
  (istemci sayacına güvenilmez); rate-limit + anormal hacim tespiti.
- **Taşımada şifreleme:** her yerde TLS. Yerel store hassas değil (sadece tutarlar/isimler)
  ama kayıtlı modda cihaz şifrelemesine güven; token'lar Keychain/Keystore'da.
- **Girdi doğrulama:** AI çıktısı **güvenilmez girdi** kabul edilir — şema doğrulama +
  aritmetik doğrulama (§7) prompt-injection / bozuk JSON'a karşı ilk savunma.
- **Ödeme regülasyon kaçınması (§6.5):** para taşınmaz, yalnızca derin-link/QR üretilir;
  kart/IBAN gibi finansal sır **hiç saklanmaz**.
- **Backend yetkilendirme:** Aşama 2'de grup verisine erişim `group_member` ile sınırlı
  (satır seviyesi güvenlik / RLS — Supabase kullanılırsa doğal).

### 9.3 Çevrimdışı & Senkronizasyon
- **Bölüşme motoru zaten çevrimdışı** (§6.1): atama, vergi/bahşiş, özet — internetsiz çalışır.
- **Tek istisna = AI taraması** (ağ gerektirir). Çevrimdışıyken: **manuel giriş** her zaman
  açık; tarama "bağlantı gelince işlenecek" diye kuyruğa alınabilir (Aşama 2).
- **Yerel-öncelikli (local-first) model:** yazma önce yerel store'a, sonra arka planda senkron.
  UI asla ağ beklemez (optimistic).
- **ID stratejisi:** UUID istemcide üretilir → çevrimdışı kayıtlar çakışmadan birleşir (§8).
- **Çakışma çözümü:**
  - `receipt` / `line_item` / `assignment`: alan düzeyinde **son-yazan-kazanır** +
    `updated_at` (tek adisyonu genelde tek kişi düzenler → çakışma nadir).
  - `split`: türetilmiş → çakışmaz, kaynaklardan **yeniden hesaplanır**.
  - Aşama 2 ortak bölüşme (herkes kendi telefonundan): kalem-düzeyi sahiplik +
    gerçek-zamanlı yayın (CRDT/sunucu otoritesi) — ayrı tasarım gerektirir.
- **Senkron şeması:** yerel ↔ bulut tabloları birebir aynı (§8) → senkron = basit delta push/pull.

### NFR başarı kriterleri
- Fiş görüntüsü işlem sonrası sunucuda **0 kalıcı kopya**.
- AI anahtarı istemci bundle'ında **hiç görünmez** (sızıntı taraması CI'da).
- Uçak modunda manuel giriş → özet → paylaşım **tam çalışır**.

---

## Kaldığımız Yer / Sıradaki Adımlar

1. ~~**Veri modeli / DB şeması**~~ — ✅ tamamlandı (§8).
2. ~~**Kesişen kaygılar (NFR):** gizlilik/KVKK, güvenlik, çevrimdışı + senkron~~ — ✅ tamamlandı (§9).
3. ~~**Teknik uygulama — bölüşme motoru:** `packages/split-engine` (§4'ün %100 test
   edilebilir saf TS implementasyonu) + 22 test (doğrulanmış örnek + invariant + kenar)~~ — ✅.
4. ~~**Web uygulaması:** `packages/web` — manuel giriş → kişi → atama → vergi/bahşiş →
   kişi başı şeffaf özet → paylaşım. Motoru tüketir, çevrimdışı çalışır (§9 kriteri)~~ — ✅.
5. ~~**AI/OCR orkestrasyonu (§7):** `packages/ai-orchestrator` (sağlayıcı-bağımsız hat:
   şema→aritmetik→normalizasyon→regional→confidence, MockProvider+GeminiProvider) +
   `packages/server` (Hono `/analyze`, kota+image-hash önbellek, Cloudflare Workers hedefi) +
   web'de görsel yükleme/düzeltme. Sağlayıcı: **Gemini Flash**; host: **Cloudflare Workers**~~ — ✅.
6. ~~**Canlı OCR doğrulaması:** gerçek Gemini anahtarıyla gerçek bir fiş (Perkins, indirimli)
   uçtan uca okundu → kalemler/tutarlar/indirim birebir, toplam 50,40 TL, dengeli.
   Çalışan model: **`gemini-2.5-flash`** (bu hesapta `gemini-2.0-flash` ücretsiz kotası 0).
   Perkins fişi kalıcı test örneği olarak eklendi~~ — ✅.
7. ~~**Mobil istemci:** `packages/mobile` — Expo (SDK 54, RN 0.81) + React Native + TypeScript.
   Not: iOS'ta App Store'daki Expo Go şu an SDK 54'te (SDK 55/56 yalnızca TestFlight),
   ayrıca eski iPhone'lar (iOS 15.1+) için en uygun hedef SDK 54 — bu yüzden SDK 56'dan
   SDK 54'e indirildi.
   Kamera/galeri ile fiş tarama (`expo-image-picker`), backend `/analyze` çağrısı
   (LAN IP otomatik tespiti — `expo-constants` hostUri), kalem düzeltme + düşük-güven
   işaretleme, kişi/atama, vergi/bahşiş, deterministik özet (`@ahb/split-engine` doğrudan)
   ve native paylaşım. Monorepo Metro yapılandırması ile `@ahb/*` paketleri paylaşılır;
   iOS bundle (579 modül) doğrulandı, tip kontrolü temiz~~ — ✅.
8. **Sıradaki adaylar:** yerel kalıcılık (§8 local-first, fiş geçmişi · AsyncStorage) ·
   web "düzeltme ekranı"nı zenginleştirme · uygulama ikonu/splash görselleri. **← SIRADAKİ**
