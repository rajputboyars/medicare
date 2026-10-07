# DawaDost brand guide

**Name:** DawaDost, written in Devanagari as **दवा दोस्त**. *Dawa* means medicine and *dost* means friend, so it reads as "the friend who gets your medicine". Short, easy to say in Hindi and English, and friendly rather than clinical.

**Tagline:** Medicines, delivered locally. (Hindi: दवाइयाँ, आपके अपने शहर से।)

> Name checks (trademark, domain and app-store availability) have not been done. Run them before launch. Alternates if needed: *DawaDwar*, *SehatSaathi*, *Dawa Ghar*.

## The mark

A **map pin** (local, nearby, delivered to you) holding a **medical cross** (pharmacy), on a rounded teal tile. The small **amber ellipse** under the pin is the "delivery point". It is the only warm note in the identity.

| File | Use |
|---|---|
| `public/brand/logo-mark.svg` | Mark only, master source |
| `public/brand/logo-lockup.svg` / `.png` | Mark + wordmark on light backgrounds |
| `public/brand/logo-lockup-dark.svg` / `.png` | Mark + wordmark on dark backgrounds |
| `public/favicon.svg`, `public/favicon.ico` | Browser tab (SVG, plus 16/32/48 ICO). Uses a slightly bolder pin so it stays legible at 16px |
| `public/icons/icon-192|512.png` | Android / PWA "any" icons |
| `public/icons/icon-maskable-512.png` | Android adaptive icon (pin inside the 70% safe zone) |
| `public/icons/apple-touch-icon.png` | iOS home screen |
| `public/icons/rider-*.png` | Rider app: darker teal tile with an amber tick badge |
| `public/brand/og.png` | Social share image, 1200×630 |

Regenerate everything with `npm run brand`.

## Colour

| Role | Hex | Notes |
|---|---|---|
| DawaDost Teal | `#0f766e` | Primary. Tile, buttons, "Dost" in the wordmark |
| Deep Teal | `#0d5f59` | Rider app, hover states, dark surfaces |
| Dawa Ink | `#14232a` | "Dawa" in the wordmark, body text |
| Delivery Amber | `#f59e0b` | Accent for the delivery point only. Never for text |
| Mint | `#5eead4` | "Dost" on dark backgrounds |
| Emergency Red | `#b91c1c` | Reserved for urgent and error states, never branding |

Teal on white is 5.5:1, which passes WCAG AA for normal text.

## Typography

Wordmark: heavy sans (Segoe UI / Helvetica Neue / Arial, weight 800, tight tracking). The app UI uses the system font stack plus Noto Sans Devanagari / Nirmala UI for Hindi, which keeps pages light on slow connections.

## Rules

- **Clear space:** at least half the pin's width on every side.
- **Minimum size:** mark 16px, lockup 120px wide.
- **Do:** keep the tile teal, keep the cross inside the pin, use the dark lockup on dark backgrounds.
- **Don't:** recolour the pin, stretch the mark, add shadows or gradients, put the amber ellipse on its own, or write the name as "Dawa Dost" or "DAWADOST".
