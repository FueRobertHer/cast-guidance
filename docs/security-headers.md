# Security headers (SEC-001)

Cast Guidance is a static, local-first PWA. These response headers add
defense-in-depth on top of the app-level `{@link}` protocol allow-list
(`src/lib/url.ts`) and import validation.

`public/_headers` ships them for hosts that read that file (Cloudflare Pages,
Netlify). Apply the same values on any other host (see below).

## Headers

| Header | Value | Why |
|---|---|---|
| `X-Content-Type-Options` | `nosniff` | Stop MIME sniffing of responses. |
| `X-Frame-Options` | `DENY` | No framing (legacy backstop for `frame-ancestors`). |
| `Referrer-Policy` | `no-referrer` | Never leak the URL to third parties. |
| `Permissions-Policy` | disables camera/mic/geolocation/payment/usb/sensors | The app uses none of them. |
| `Content-Security-Policy-Report-Only` | see below | Constrain what can load/connect. |

## The CSP, and why it ships **report-only** first

```
default-src 'self';
base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self';
img-src 'self' data:;
font-src 'self';
style-src 'self' 'unsafe-inline';        /* React inline style= attributes (HP/progress bars) */
script-src 'self';
worker-src 'self' blob:;                  /* the MiniSearch search worker */
manifest-src 'self';
connect-src 'self' https://cdn.jsdelivr.net https://raw.githubusercontent.com https://api.github.com
```

`connect-src` allows exactly the pinned 5etools data mirror
(`cdn.jsdelivr.net`, `raw.githubusercontent.com`) and the tag-list API
(`api.github.com`) — the only external origins the app contacts
(`src/data5e/config.ts`, `src/data5e/loader.ts`). If those endpoints change,
update this list.

It ships as **`Content-Security-Policy-Report-Only`** so it cannot break the app
before it's been observed against real traffic. **To enforce it:** confirm the
browser console reports no violations during a full session (load, download,
search, build a character, import/export), then rename the header to
`Content-Security-Policy`.

## Applying on other hosts

- **Vercel** — add a `headers` block in `vercel.json` with the same names/values.
- **nginx** — `add_header <Name> "<value>" always;` per header in the server block.
- **Cloudflare Pages / Netlify** — `public/_headers` (this repo) is picked up automatically.
