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
| Path | Free | Works from GitHub Pages? | Notes |
|------|------|--------------------------|-------|
| **Fetch → paste** (default) | Unlimited | Yes | GST portal has captcha; **CORS blocks** in-app API/captcha calls. App copies GSTIN, opens Search Taxpayer, user pastes result → auto-fill |
| Offline decode | Unlimited | Yes | State, PAN, checksum; saved masters fill instantly |
| Appyflow / gstincheck | 50 / 20 trial | Yes | Optional key in Setup only |
| Direct portal API in-app | — | **No** | No `Access-Control-Allow-Origin`; captcha cookie HttpOnly |

No free unlimited live name/address API without a key was found (checked 2026). Never hardcode secrets.

## E-way JSON upload
ewaybillgst.gov.in → e-Waybill → Generate Bulk. Schema tools: https://docs.ewaybillgst.gov.in/html/formatdownloadnew.html
