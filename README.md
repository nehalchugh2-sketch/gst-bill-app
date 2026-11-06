# GST Bill — Invoice + E-Way (Phase 1)

Simple installable PWA for Indian traders. Tap-only (no voice). Creates a Rule 46 GST tax invoice PDF and NIC e-way bill bulk-upload JSON on the phone.

## Run locally
```bash
python3 -m http.server 8765
# open http://127.0.0.1:8765
```

## Install on Android
Chrome → menu → **Add to Home screen**. Works offline after first load (service worker).

## Free hosting (GitHub Pages)
Pushes to `main` deploy the repo root with GitHub Actions (`.github/workflows/pages.yml`).

Live site: https://nehalchugh2-sketch.github.io/gst-bill-app/

If the workflow cannot enable Pages, open **Settings → Pages** and set **Source** to **GitHub Actions**.

Or drag the folder to [Cloudflare Pages](https://pages.cloudflare.com/) (free).

## E-way JSON upload
1. Download JSON from the Done screen.
2. Login at https://ewaybillgst.gov.in
3. **e-Waybill → Generate Bulk** → upload JSON.
4. Official schema/tools: https://docs.ewaybillgst.gov.in/html/formatdownloadnew.html

## Demo GSTINs
Fake checksum-valid UP GSTINs used in tests only:
- Seller `09AAAAA0000A1Z0`
- Buyer `09BBBBB0000B1ZR`

Not for real portal submission.
