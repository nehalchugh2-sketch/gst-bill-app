# GST Bill — Invoice + E-Way (Phase 1)

Simple installable PWA for Indian traders. Tap-only. Creates a Rule 46 GST tax invoice PDF and NIC e-way bill bulk-upload JSON.

## Features
- **GSTIN autofill** for seller, buyer, transporter: offline state/PAN/checksum always; saved masters fill instantly; optional free API key in Setup for name/address fetch (Appyflow 50 free / gstincheck 20 free). All fields stay editable.
- **Add / Less**: Freight, Packing, Insurance, Discount, etc. (₹ or % of items). **GST is on NET taxable** (items + add − less). Multi-rate bills apportion add/less by each line’s share of items gross (standard practice).
- Invoice PDF shows items gross, each add/less, net taxable, CGST/SGST or IGST, round off, grand total, amount in words.
- E-way JSON uses the same net `totalValue` / tax / `totInvValue` (`otherValue` = round off).

## Run locally
```bash
python3 -m http.server 8765
# http://127.0.0.1:8765
```

## Free hosting
GitHub Pages / Cloudflare Pages. Live example: https://nehalchugh2-sketch.github.io/gst-bill-app/

## GSTIN lookup (honest limits)
| Provider | Free | CORS from browser | Notes |
|----------|------|-------------------|-------|
| Offline (built-in) | Unlimited | n/a | State, PAN, checksum; master reuse |
| [Appyflow](https://appyflow.in/verify-gst/) | **50** one-time trial | Yes (reflects Origin) | `key_secret` in query; then ~₹0.40–0.50/call |
| [gstincheck.co.in](https://gstincheck.co.in/) | **20** free | Yes (`*`) | Key in URL path |
| gstinapi.in | ~75 credits | **No** (no CORS) | Not usable from static PWA without a proxy |

Never hardcode a paid secret — paste key only in Setup (stored in phone `localStorage`).

## E-way JSON upload
ewaybillgst.gov.in → e-Waybill → Generate Bulk. Schema tools: https://docs.ewaybillgst.gov.in/html/formatdownloadnew.html
