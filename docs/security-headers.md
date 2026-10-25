# Security headers (SEC-001)

Cast Guidance is a static, local-first PWA. These response headers add
defense in depth on top of the app-level `{@link}` protocol allow-list
(`src/lib/url.ts`) and import validation.

## Where they live

- **`vercel.json` is the source of truth.** Vercel serves the app and applies
  the `headers` block there to every path (`"source": "/(.*)"`). Vercel ignores
  `public/_headers`.
- **`public/_headers`** carries the same headers for hosts that read that file
  (Cloudflare Pages, Netlify). Vite copies it into `dist/`.
- `src/app/securityHeaders.test.ts` fails if the two files differ, so change
  both together.

## Headers

| Header | Value | Why |
|---|---|---|
| `X-Content-Type-Options` | `nosniff` | Stop MIME sniffing of responses. |
| `X-Frame-Options` | `DENY` | No framing (legacy backstop for `frame-ancestors`). |
| `Referrer-Policy` | `no-referrer` | Never leak the URL to third parties. |
| `Permissions-Policy` | disables camera/mic/geolocation/payment/usb/sensors | The app uses none of them. |
| `Content-Security-Policy` | see below | Constrain what can load, run, and connect. |

## The enforced CSP

```
default-src 'self';
base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self';
img-src 'self' data:;
font-src 'self';
style-src 'self' 'unsafe-inline';   /* vaul injects a <style> element */
script-src 'self';
worker-src 'self';                   /* the search worker and the service worker */
manifest-src 'self';
connect-src 'self'
  https://cdn.jsdelivr.net https://raw.githubusercontent.com   /* data mirror */
  https://api.github.com                                       /* release list */
  https://gist.githubusercontent.com                           /* homebrew URL import */
```

What each directive was checked against in the built `dist/`:

- **Scripts:** `index.html` has no inline script (the test checks the source,
  and the build adds only `src=` module scripts). There is no `eval` or
  `new Function` in the bundle. Vercel Web Analytics loads
  `/_vercel/insights/script.js` and reports to `/_vercel/insights/*` in
  production, both same-origin.
- **Workers:** the search worker is `/assets/search.worker-*.js` and the
  service worker is `/sw.js`, which imports `/workbox-*.js`. Nothing builds a
  worker from a `blob:` URL, so `blob:` is gone from `worker-src`.
- **Styles:** vaul inserts a `<style>` element at runtime, which needs
  `'unsafe-inline'`. React `style={}` props go through the CSSOM and do not.
- **Fonts and images:** system fonts only, no `@font-face` or `url()` in the
  CSS, and the only image is `favicon.svg`.
- **Downloads** use a `blob:` URL on an anchor, which CSP does not govern.

### Connect hosts

| Origin | Used by |
|---|---|
| `https://cdn.jsdelivr.net` | data mirror, first choice (`ENDPOINTS` in `src/data5e/config.ts`) |
| `https://raw.githubusercontent.com` | data mirror fallback, and homebrew URL import |
| `https://api.github.com` | compatible release list (`TAGS_API_URL`) |
| `https://gist.githubusercontent.com` | homebrew URL import |

Homebrew URL import fetches only from `HOMEBREW_FETCH_ORIGINS` in
`src/features/homebrew/homebrewUrl.ts`: raw GitHub files, gists, and jsDelivr.
It checks a URL before making any request (https only, no credentials, origin
compared exactly), rewrites `github.com/.../blob/...` and `.../raw/...` page
links and `gist.github.com/.../raw/...` links to the raw host, and answers any
other URL with guidance: a link to open the file, and the file import, which
works for any source.

### Adding a host

1. Add the origin where the code that contacts it gets it from:
   `src/data5e/config.ts` for data, `HOMEBREW_FETCH_ORIGINS` for homebrew.
2. Add it to `connect-src` in `vercel.json` **and** `public/_headers`.
3. Run `bunx vitest run src/app/securityHeaders.test.ts`. It compares
   `connect-src` exactly against the origins built from those constants, and
   scans production source for any `http(s)://` URL that is neither in
   `connect-src` nor listed, with a reason, as never fetched.

## Why the policy is shaped this way

Homebrew and 5etools data are rendered as text and sanitized links; nothing in
them can run script, so the CSP is not what stands between untrusted content
and code execution. `script-src 'self'` is a backstop for a rendering bug.

A closed `connect-src` matters mainly against a compromised dependency: code
that does run in the page could otherwise send characters and homebrew
anywhere. Allowing `https:` for the convenience of importing homebrew from any
site would give that up, so the import has a short host list instead and the
file import covers the rest.

## Header changes reach installed copies only through an update

The service worker answers navigations with the precached `index.html`, and
the cached response keeps the headers it was fetched with, CSP included. A
precached file is only refetched when its revision changes, so the build writes
a digest of the `vercel.json` headers into `index.html`
(`<meta name="cg-headers">`, from `src/app/headersMeta.ts`). Any header change
changes the file and its revision.

That cuts both ways for a **rollback**: reverting a bad policy means a new
deploy, and installed copies keep the old policy until the player accepts the
update prompt (or every tab closes and the new service worker takes over).
Vercel's instant rollback to an older deployment is no faster: its `sw.js`
differs from the one installed, so it too arrives as an update the player has
to accept.

## Vercel preview deployments

Vercel injects its preview toolbar (`vercel.live` scripts) into preview
deployments. The enforced policy blocks it, so previews show CSP errors in the
console and no toolbar. Do not widen the production policy for it; turn the
toolbar off in the project settings or ignore those errors on previews.

## Verifying

- Locally: `bun run build`, serve `dist/` with the `vercel.json` headers, and
  watch for `securitypolicyviolation` events through a cold load, a data
  download, a search, the homebrew page, and a service worker install.
- In production: `curl -sI https://<prod-domain>/ | grep -i '^content-security-policy:'`
  should print the policy above, and the browser console should stay free of
  CSP errors through the same session.

## Applying on other hosts

- **Cloudflare Pages / Netlify:** `public/_headers` is picked up automatically.
- **nginx:** `add_header <Name> "<value>" always;` per header in the server block.
