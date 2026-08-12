# BFL BRED Group — Digital Cash Deposit / Withdrawal Form

A tablet-first web app that replaces the hand-written cash deposit and cash withdrawal slips used at
the counter. The customer fills in the form, has their photo taken, signs on screen, checks a review
sheet, and submits. The app renders a PDF that mirrors the paper form, emails it to
`it.support@bfl.la`, and archives a copy to SharePoint. The customer can optionally receive their own
copy by email. After submitting they are told to wait for the teller to call them.

```
web/      the tablet app  — React + TypeScript + Vite + Tailwind
server/   submission service — Express, email + SharePoint adapters
```

## Running it

```bash
# 1. the app (demo mode — no backend needed)
cd web && npm install && npm run dev        # http://localhost:5173

# 2. optional: the submission service
cd server && npm install && npm start       # http://localhost:8787
```

To point the app at the service, create `web/.env.local`:

```
VITE_API_BASE=http://localhost:8787
```

Without it the app stays in **demo mode**: the PDF is still generated in the browser and can be
downloaded, but nothing is emailed or archived. That makes the whole flow demonstrable on a laptop
with no credentials.

> The camera needs a secure context. `localhost` counts; on a real tablet, serve the app over HTTPS
> or the photo step will report that the camera is unavailable (the flow continues without a photo).

```bash
cd web && npm test        # unit tests: formatting, masks, amount-in-words
cd web && npm run build   # production build
```

## The flow

1. **Start** — Cash Deposit or Cash Withdrawal, plus an EN / ລາວ language toggle.
2. **Details** — the form fields, ending with the electronic-signature confirmation checkbox.
3. **Photo** — live capture from the device camera, with retake.
4. **Signature** — on-screen signature pad (stylus or finger).
5. **Review** — the eight rows below; **Edit** on any of them returns to that step and comes
   straight back to review when saved.
6. **Submit** — asks whether the customer wants a copy of the advice by email, then sends.
7. **Done** — the customer's name, the reference number, and "wait for the teller to call you".

### Fields

| Field | Behaviour |
|---|---|
| Account name | Free text, no hint |
| Account number | Five blocks — 3-7-2-4-2, 18 digits — with auto-advance and no hint |
| Account currency | LAK (default), USD, THB, EUR |
| Amount | Live thousand separators, on the same row as its own currency |
| Amount currency | Follows the account currency until it is changed on its own |
| Source of funds / Purpose of withdrawal | 500 characters, with a live counter |
| Phone number of the person processing | Free text, no hint |

Captured automatically: submission date and time, branch, Device ID and client IP.

### Review rows

Account name · account number — amount · currency — amount in words — source of funds — processed by
phone number — submission date/time · branch — Device ID · IP — photo · signature.

## Device registration

Each tablet is registered to one branch through **Device settings** on the start screen. The branch
and a generated Device ID are stored on the device and printed on every form. Edit `BRANCHES` in
`web/src/lib/device.ts` to match the real branch list.

## Configuring for production

1. **Logo** — replace `web/public/logo-bfl.png` with the real asset. The app tries
   `https://bfl-bred.com/wp-content/uploads/2022/05/BFL-BRED-Group-Logo.png` first and falls back to
   the bundled file, so a branch tablet on a restricted network still prints a logo.
2. **Email and SharePoint** — copy `server/.env.example` to `server/.env` and fill in SMTP plus the
   Microsoft Entra app registration (`Files.ReadWrite.All`, application permission) and the target
   drive. Until they are set, the service writes into `server/outbox/` and logs the recipients it
   would have used. Forms are filed as `CashForms/<year>/<month>/<file>.pdf`.
3. **Branches** — see above.
4. **Lao wording** — the Lao strings in `web/src/i18n/dictionary.ts` and the Lao number words in
   `web/src/lib/amountInWords.ts` should be reviewed by a native speaker before go-live. The English
   wording is authoritative in the meantime; both are printed on the PDF.

## Notes for whoever picks this up

- **Account number mask.** `ACCOUNT_MASK` in `web/src/lib/format.ts` is the single place that
  defines the 3-7-2-4-2 grouping.
- **Amounts.** LAK is treated as a zero-decimal currency; USD, THB and EUR carry two. Grouping is
  standard: `2000000` displays as `2,000,000`.
- **Fonts.** `web/public/fonts` holds Latin and Lao subsets, used both by the UI and embedded into
  the PDF, so screen and document match. Regenerate with `web/scripts/build-fonts.sh`. Two
  deliberate choices are documented there and in `web/src/lib/pdf.ts`: the fonts are embedded whole
  (pdf-lib's runtime subsetter drops glyphs from these faces), and the Latin subsets carry no
  ligature features (a subset "fi" ligature comes out with the wrong advance).
- **Lao in the PDF.** pdf-lib substitutes glyphs but ignores GPOS offsets, which leaves Lao vowel and
  tone marks stranded beside their base letter. `drawShapedText` in `web/src/lib/pdf.ts` lays the
  text out with fontkit and places each glyph itself.
- **PDF weight.** A completed form with a photo and signature is around 160 kB. pdf-lib is loaded on
  demand, so the initial app download stays near 75 kB gzipped.
