/** Statik destek sayfaları — App Store gizlilik URL'si ve destek. */

const BRAND = "SplitTab";
const SUPPORT_EMAIL = "emircanozdag@gmail.com";
const UPDATED = "June 18, 2026";

const PAGE_STYLE = `
  :root {
    color-scheme: light dark;
    --bg: #0b0e1a;
    --card: #141a2e;
    --text: #e8ecf4;
    --muted: #9aa3b8;
    --accent: #6ea8ff;
    --border: #243049;
  }
  @media (prefers-color-scheme: light) {
    :root {
      --bg: #f4f6fb;
      --card: #ffffff;
      --text: #1a2233;
      --muted: #5a6478;
      --accent: #2f6fed;
      --border: #d8deea;
    }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    background: var(--bg);
    color: var(--text);
    line-height: 1.6;
  }
  main { max-width: 720px; margin: 0 auto; padding: 2rem 1.25rem 3rem; }
  h1 { font-size: 1.75rem; margin: 0 0 0.25rem; }
  .updated { color: var(--muted); font-size: 0.9rem; margin-bottom: 2rem; }
  h2 { font-size: 1.1rem; margin: 2rem 0 0.75rem; }
  ul { padding-left: 1.25rem; }
  a { color: var(--accent); }
  .card {
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 1.25rem 1.5rem;
    margin: 1.5rem 0;
  }
  footer {
    margin-top: 2.5rem;
    padding-top: 1.5rem;
    border-top: 1px solid var(--border);
    color: var(--muted);
    font-size: 0.9rem;
  }
`;

function htmlPage(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <style>${PAGE_STYLE}</style>
</head>
<body>${body}</body>
</html>`;
}

export function homePageHtml(): string {
  return htmlPage(
    `${BRAND} — Fişi tara, hesabı adil böl`,
    `<main style="max-width:560px;text-align:center;min-height:100vh;display:flex;flex-direction:column;justify-content:center;margin:0 auto;padding:2rem 1.25rem;">
      <h1>${BRAND}</h1>
      <p style="color:var(--muted);font-size:1.05rem;line-height:1.55;">
        Restoran fişini tara, kalemleri kişilere ata, kişi başı tutarı paylaş.
        <strong style="color:var(--text);display:block;margin-top:0.75rem;">Yalnızca iOS uygulaması — web sürümü yok.</strong>
      </p>
      <p style="margin-top:1.5rem;">
        <a href="/privacy">Gizlilik Politikası</a> · <a href="mailto:${SUPPORT_EMAIL}">Destek</a>
      </p>
    </main>`,
  );
}

export function privacyPageHtml(): string {
  return htmlPage(
    `Privacy Policy — ${BRAND}`,
    `<main>
      <h1>Privacy Policy</h1>
      <p class="updated">Last updated: ${UPDATED}</p>
      <p><strong>${BRAND}</strong> helps you scan restaurant receipts and split the bill among friends. This policy explains what data is processed when you use the app.</p>

      <h2>1. Data we process</h2>
      <p>The app does not require an account. We may process:</p>
      <ul>
        <li><strong>Receipt image:</strong> A photo you take or pick from your library, sent to our server for text extraction (OCR).</li>
        <li><strong>Device identifier:</strong> A random device ID stored on our server for daily scan quota tracking. It is not linked to your identity.</li>
        <li><strong>On-device data:</strong> Names you enter, item assignments, and receipt history stay on your device in a local database.</li>
      </ul>
      <p>We do <strong>not</strong> collect email, phone number, location, payment card, or bank details.</p>

      <h2>2. How receipt images are handled</h2>
      <div class="card">
        <ul>
          <li>Images are compressed on your device, then sent over HTTPS.</li>
          <li>Our server uses them only for processing; images are not stored permanently.</li>
          <li>We may cache a hash of the image and extracted text to speed up repeat scans — not the image itself.</li>
          <li>Text extraction uses Google Gemini.</li>
        </ul>
      </div>

      <h2>3. Where data lives</h2>
      <ul>
        <li><strong>Your device:</strong> Receipt history, settings, and privacy consent preference.</li>
        <li><strong>Our server (Cloudflare Workers):</strong> Quota counters and optional analysis cache.</li>
      </ul>

      <h2>4. Permissions</h2>
      <ul>
        <li><strong>Camera</strong> — to scan receipts.</li>
        <li><strong>Photo library</strong> — to pick a receipt photo.</li>
      </ul>

      <h2>5. Third parties</h2>
      <ul>
        <li><strong>Cloudflare</strong> — API hosting.</li>
        <li><strong>Google (Gemini)</strong> — receipt text extraction.</li>
        <li><strong>Apple / Google</strong> — app store distribution only.</li>
      </ul>
      <p>We do not sell or rent your data for advertising.</p>

      <h2>6. Your rights</h2>
      <p>You can delete receipt history in the app or remove all local data by uninstalling. Server quota records expire automatically.</p>
      <p>Privacy requests: <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a></p>

      <h2>7. Children</h2>
      <p>The app is not directed at children under 13 and we do not knowingly collect their data.</p>

      <h2>8. Changes</h2>
      <p>We may update this policy. Material changes will be reflected in the date above.</p>

      <footer>
        <p><a href="/">← ${BRAND}</a></p>
        <p>© 2026 ${BRAND}</p>
      </footer>
    </main>`,
  );
}

export function htmlResponse(body: string): Response {
  return new Response(body, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
