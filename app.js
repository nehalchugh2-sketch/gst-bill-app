/* GST Bill PWA — Phase 1 tap-only (+ GSTIN autofill + Add/Less) */
(function () {
  "use strict";

  const STORAGE_KEY = "gstBillApp.v1";
  const STATES = {
    "01":"J&K","02":"HP","03":"Punjab","04":"Chandigarh","05":"Uttarakhand","06":"Haryana",
    "07":"Delhi","08":"Rajasthan","09":"UP","10":"Bihar","11":"Sikkim","12":"Arunachal",
    "13":"Nagaland","14":"Manipur","15":"Mizoram","16":"Tripura","17":"Meghalaya","18":"Assam",
    "19":"WB","20":"Jharkhand","21":"Odisha","22":"Chhattisgarh","23":"MP","24":"Gujarat",
    "26":"Dadra","27":"Maharashtra","29":"Karnataka","30":"Goa","32":"Kerala","33":"TN",
    "34":"Puducherry","36":"Telangana","37":"AP","38":"Ladakh"
  };
  const ONES = ["","One","Two","Three","Four","Five","Six","Seven","Eight","Nine","Ten","Eleven","Twelve","Thirteen","Fourteen","Fifteen","Sixteen","Seventeen","Eighteen","Nineteen"];
  const TENS = ["","","Twenty","Thirty","Forty","Fifty","Sixty","Seventy","Eighty","Ninety"];
  const GSTIN_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

  function uid() { return "id_" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36); }
  function round2(n) { return Math.round((Number(n) + Number.EPSILON) * 100) / 100; }
  function escapeHtml(s) {
    return String(s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function defaultStore() {
    return {
      seller: {
        gstin: "", legalName: "", tradeName: "", address: "", pin: "", stateCode: "", stateName: "",
        phone: "", bankName: "", bankAccount: "", bankIfsc: "",
        invoicePrefix: "INV/", nextNumber: 1
      },
      settings: {
        gstLookupProvider: "offline", // offline | appyflow | gstincheck
        gstLookupKey: ""
      },
      buyers: [],
      items: [],
      transporters: [],
      bills: []
    };
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultStore();
      const parsed = JSON.parse(raw);
      const base = defaultStore();
      const out = Object.assign(base, parsed);
      out.seller = Object.assign(base.seller, parsed.seller || {});
      out.settings = Object.assign(base.settings, parsed.settings || {});
      return out;
    } catch (e) {
      return defaultStore();
    }
  }
  function save() { localStorage.setItem(STORAGE_KEY, JSON.stringify(store)); }

  let store = load();
  let draft = emptyDraft();
  let lastBill = null;
  let masterTab = "buyers";

  function emptyDraft() {
    return {
      buyerId: null,
      lines: [],
      addLess: [], // {id, kind:'add'|'less', label, mode:'amount'|'percent', value}
      wantEway: null,
      transporterId: null,
      vehicleNo: "",
      distance: 10,
      transMode: "1"
    };
  }

  /* ---------- GSTIN validate + offline parse ---------- */
  function gstinCheckDigit(gstin14) {
    let factor = 1, sum = 0;
    for (let i = 0; i < 14; i++) {
      const codePoint = GSTIN_CHARS.indexOf(gstin14[i]);
      if (codePoint < 0) return null;
      let digit = factor * codePoint;
      factor = factor === 2 ? 1 : 2;
      digit = (digit / 36 | 0) + (digit % 36);
      sum += digit;
    }
    let cd = 36 - (sum % 36);
    if (cd === 36) cd = 0;
    return GSTIN_CHARS[cd];
  }

  function validateGstin(g) {
    if (!g) return { ok: false, msg: "GSTIN required" };
    g = String(g).toUpperCase().trim();
    if (!/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(g)) {
      return { ok: false, msg: "GSTIN format galat / invalid" };
    }
    const state = g.slice(0, 2);
    if (!STATES[state]) return { ok: false, msg: "State code invalid" };
    const cd = gstinCheckDigit(g.slice(0, 14));
    if (cd !== g[14]) return { ok: false, msg: "GSTIN checksum galat / invalid" };
    return {
      ok: true,
      gstin: g,
      stateCode: state,
      stateName: STATES[state],
      pan: g.slice(2, 12)
    };
  }

  function offlineFromGstin(g) {
    const v = validateGstin(g);
    if (!v.ok) return v;
    return {
      ok: true,
      source: "offline",
      gstin: v.gstin,
      legalName: "",
      tradeName: "",
      address: "",
      pin: "",
      stateCode: v.stateCode,
      stateName: v.stateName,
      pan: v.pan,
      msg: "State/PAN from GSTIN — baaki details type karein ya Fetch dabayein"
    };
  }

  function findMasterByGstin(gstin) {
    const g = String(gstin || "").toUpperCase().trim();
    const buyer = store.buyers.find((b) => (b.gstin || "").toUpperCase() === g);
    if (buyer) {
      return {
        ok: true, source: "master-buyer", gstin: g,
        legalName: buyer.name, tradeName: buyer.name,
        address: buyer.address || "", pin: buyer.pin || "",
        stateCode: buyer.stateCode, stateName: buyer.stateName,
        pan: g.slice(2, 12),
        msg: "Saved buyer se bhari / filled from saved buyer"
      };
    }
    const tr = store.transporters.find((t) => (t.transporterId || "").toUpperCase() === g);
    if (tr) {
      return {
        ok: true, source: "master-transporter", gstin: g,
        legalName: tr.name, tradeName: tr.name,
        address: "", pin: "",
        stateCode: g.slice(0, 2), stateName: STATES[g.slice(0, 2)] || "",
        pan: g.slice(2, 12),
        msg: "Saved transporter se bhari"
      };
    }
    if (store.seller.gstin && store.seller.gstin.toUpperCase() === g) {
      const s = store.seller;
      return {
        ok: true, source: "master-seller", gstin: g,
        legalName: s.legalName, tradeName: s.tradeName,
        address: s.address, pin: s.pin,
        stateCode: s.stateCode, stateName: s.stateName,
        pan: g.slice(2, 12),
        msg: "Seller profile se bhari"
      };
    }
    return null;
  }

  function formatAddress(addr) {
    if (!addr || typeof addr !== "object") return String(addr || "");
    return [addr.bno, addr.flno, addr.bnm, addr.st, addr.loc, addr.dst, addr.city, addr.stcd]
      .filter(Boolean).join(", ");
  }

  function normalizeLookup(raw, provider) {
    // Appyflow: { taxpayerInfo: { lgnm, tradeNam, gstin, pradr: { addr } } }
    // gstincheck: varies — try common shapes { data: {...} } or taxpayer fields at top
    let info = raw;
    if (raw && raw.taxpayerInfo) info = raw.taxpayerInfo;
    else if (raw && raw.data && typeof raw.data === "object") info = raw.data;
    else if (raw && raw.result) info = raw.result;

    if (!info || typeof info !== "object") return null;
    const gstin = (info.gstin || info.GSTIN || "").toUpperCase();
    const legalName = info.lgnm || info.legal_name || info.legalName || info.name || "";
    const tradeName = info.tradeNam || info.trade_name || info.tradeName || legalName;
    const addrObj = (info.pradr && info.pradr.addr) || info.address || info.addr || {};
    const address = typeof addrObj === "string" ? addrObj : formatAddress(addrObj);
    const pin = String((addrObj && (addrObj.pncd || addrObj.pincode || addrObj.pin)) || info.pincode || info.pin || "").replace(/\D/g, "").slice(0, 6);
    const stFromGstin = gstin.slice(0, 2);
    return {
      ok: true,
      source: provider,
      gstin,
      legalName: String(legalName || "").trim(),
      tradeName: String(tradeName || legalName || "").trim(),
      address: String(address || "").trim(),
      pin,
      stateCode: stFromGstin,
      stateName: STATES[stFromGstin] || "",
      pan: gstin.slice(2, 12),
      msg: "Fetched — please check / जाँच लें (editable)"
    };
  }


  function parsePortalText(text, gstinHint) {
    const raw = String(text || "").replace(/\r/g, "\n");
    if (!raw.trim()) return { ok: false, msg: "Paste khali hai — portal se details copy karke yahan chipkayein" };
    const pick = (...labels) => {
      for (const lab of labels) {
        const re = new RegExp(lab + "\\s*[:\\-–]?\\s*([^\\n]+)", "i");
        const m = raw.match(re);
        if (m && m[1].trim()) return m[1].replace(/\s+/g, " ").trim();
      }
      return "";
    };
    let legalName = pick("Legal Name of Business", "Legal Name", "lgnm", "Taxpayer Name", "Name of Business");
    let tradeName = pick("Trade Name", "tradeNam", "Trade name");
    let address = pick(
      "Principal Place of Business", "Principal Place Of Business",
      "Address", "pradr", "Place of Business"
    );
    // Sometimes address spans lines after label
    if (!address) {
      const m = raw.match(/Principal Place of Business\s*[:\-]?\s*([\s\S]{10,220}?)(?:\n\s*\n|Nature of Business|Date of|Status|GSTIN|$)/i);
      if (m) address = m[1].replace(/\s+/g, " ").trim();
    }
    let pin = "";
    const pinM = (address + "\n" + raw).match(/\b([1-9][0-9]{5})\b/);
    if (pinM) pin = pinM[1];
    let gstin = (gstinHint || "").toUpperCase();
    const gM = raw.toUpperCase().match(/\b([0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z])\b/);
    if (gM) gstin = gM[1];
    if (!legalName && !tradeName && !address) {
      // loose: first long line as name
      const lines = raw.split("\n").map((l) => l.trim()).filter((l) => l.length > 3 && !/captcha|search|gstin\/uin/i.test(l));
      if (lines[0] && lines[0].length < 80) legalName = lines[0];
      if (!address && lines.length > 1) address = lines.slice(1).join(", ").slice(0, 200);
    }
    if (!legalName && !tradeName && !address) {
      return { ok: false, msg: "Samajh nahi aaya — Legal Name / Address wala text paste karein" };
    }
    const v = gstin ? validateGstin(gstin) : { ok: false };
    const stateCode = v.ok ? v.stateCode : (gstinHint || "").slice(0, 2);
    return {
      ok: true,
      source: "paste",
      gstin: v.ok ? v.gstin : (gstinHint || "").toUpperCase(),
      legalName: legalName || tradeName,
      tradeName: tradeName || legalName,
      address: address || "",
      pin: pin || "",
      stateCode: stateCode || "",
      stateName: STATES[stateCode] || "",
      pan: v.ok ? v.pan : "",
      msg: "Paste se bhari — please check / जाँच लें (editable)"
    };
  }

  function openFetchHelper(opts) {
    // opts: { panelEl, gstin, onApply, statusEl }
    const g = String(opts.gstin || "").toUpperCase().trim();
    const panel = opts.panelEl;
    if (!panel) return;
    panel.classList.remove("hidden");
    panel.innerHTML = `
      <div class="fetch-box">
        <strong>Free unlimited fetch (no API key)</strong>
        <p class="hint" style="margin:6px 0">Government GST site browser se seedha API allow nahi karti (CORS block). Isliye 2 simple steps:</p>
        <ol class="fetch-steps">
          <li><button type="button" class="btn btn-secondary btn-sm" id="fh-copy">1. Copy GSTIN</button></li>
          <li><button type="button" class="btn btn-secondary btn-sm" id="fh-open">2. Open GST Search</button> → Search → result select/copy</li>
          <li>Neeche paste karein → <strong>Fill</strong></li>
        </ol>
        <textarea id="fh-paste" rows="4" placeholder="Portal se Legal Name, Trade Name, Address yahan paste…"></textarea>
        <div class="row" style="margin-top:8px">
          <button type="button" class="btn btn-ok" id="fh-fill">Fill from paste / भरें</button>
          <button type="button" class="btn btn-ghost" id="fh-close">Close</button>
        </div>
        <p class="hint" style="margin-top:8px">Optional paid/trial API keys Setup ke neeche hain — zaroori nahi.</p>
      </div>`;
    const copyBtn = panel.querySelector("#fh-copy");
    const openBtn = panel.querySelector("#fh-open");
    const fillBtn = panel.querySelector("#fh-fill");
    const closeBtn = panel.querySelector("#fh-close");
    copyBtn.onclick = async () => {
      try {
        await navigator.clipboard.writeText(g);
        if (opts.statusEl) opts.statusEl.innerHTML = statusHtml("ok", "GSTIN copy ho gaya ✓");
      } catch (e) {
        if (opts.statusEl) opts.statusEl.innerHTML = statusHtml("offline", "Copy: " + g + " (manual select)");
      }
    };
    openBtn.onclick = () => {
      window.open("https://services.gst.gov.in/services/searchtp", "_blank", "noopener");
    };
    fillBtn.onclick = () => {
      const parsed = parsePortalText(panel.querySelector("#fh-paste").value, g);
      if (!parsed.ok) {
        if (opts.statusEl) opts.statusEl.innerHTML = statusHtml("err", parsed.msg);
        return;
      }
      opts.onApply(parsed);
      if (opts.statusEl) opts.statusEl.innerHTML = statusHtml("ok", parsed.msg);
      panel.classList.add("hidden");
      panel.innerHTML = "";
    };
    closeBtn.onclick = () => { panel.classList.add("hidden"); panel.innerHTML = ""; };
  }

  async function lookupGstinOnline(gstin) {
    const provider = (store.settings && store.settings.gstLookupProvider) || "offline";
    const key = (store.settings && store.settings.gstLookupKey || "").trim();
    if (provider === "offline" || !key) {
      return { ok: false, msg: "API key / provider set nahi — Settings mein free key daalein, ya manually type karein" };
    }
    try {
      let url, res, data;
      if (provider === "appyflow") {
        url = "https://appyflow.in/api/verifyGST?gstNo=" + encodeURIComponent(gstin) + "&key_secret=" + encodeURIComponent(key);
        res = await fetch(url, { method: "GET" });
        data = await res.json();
        if (data.error) return { ok: false, msg: data.message || "Appyflow error" };
        const n = normalizeLookup(data, "appyflow");
        if (!n) return { ok: false, msg: "Appyflow: unexpected response" };
        return n;
      }
      if (provider === "gstincheck") {
        url = "https://sheet.gstincheck.co.in/check/" + encodeURIComponent(key) + "/" + encodeURIComponent(gstin);
        res = await fetch(url, { method: "GET" });
        data = await res.json();
        if (data.flag === false || data.errorCode) return { ok: false, msg: data.message || "gstincheck error" };
        const n = normalizeLookup(data, "gstincheck");
        if (!n || !n.legalName) {
          // some responses put fields under data
          const n2 = normalizeLookup(data.data ? data : { data }, "gstincheck");
          if (n2 && n2.legalName) return n2;
          return { ok: false, msg: "gstincheck: no taxpayer details in response" };
        }
        return n;
      }
      return { ok: false, msg: "Unknown provider" };
    } catch (e) {
      return { ok: false, msg: "Network/CORS fail: " + (e.message || String(e)) };
    }
  }

  /**
   * Resolve GSTIN details: master reuse → offline state/PAN → optional online API.
   * Fields always remain editable by the caller after apply.
   */
  async function resolveGstinDetails(gstin, opts) {
    opts = opts || {};
    const v = validateGstin(gstin);
    if (!v.ok) return v;
    const master = findMasterByGstin(v.gstin);
    if (master && !opts.forceOnline) return master;
    const off = offlineFromGstin(v.gstin);
    if (opts.online === false) return off;
    const provider = (store.settings && store.settings.gstLookupProvider) || "offline";
    if (provider === "offline" || !(store.settings && store.settings.gstLookupKey)) return off;
    const online = await lookupGstinOnline(v.gstin);
    if (online.ok) return online;
    return Object.assign({}, off, { ok: true, fetchError: online.msg, msg: "Offline fill — fetch fail: " + online.msg });
  }

  /* ---------- Amount in words ---------- */
  function twoDigits(n) {
    if (n < 20) return ONES[n];
    return TENS[Math.floor(n / 10)] + (n % 10 ? " " + ONES[n % 10] : "");
  }
  function amountInWords(num) {
    num = Math.round((Number(num) + Number.EPSILON) * 100) / 100;
    const whole = Math.floor(num);
    const paise = Math.round((num - whole) * 100);
    if (whole === 0 && paise === 0) return "Zero Rupees Only";
    function chunk(n) {
      if (n === 0) return "";
      if (n < 100) return twoDigits(n);
      return ONES[Math.floor(n / 100)] + " Hundred" + (n % 100 ? " " + twoDigits(n % 100) : "");
    }
    let n = whole;
    const crore = Math.floor(n / 10000000); n %= 10000000;
    const lakh = Math.floor(n / 100000); n %= 100000;
    const thousand = Math.floor(n / 1000); n %= 1000;
    const rest = n;
    const parts = [];
    if (crore) parts.push(chunk(crore) + " Crore");
    if (lakh) parts.push(chunk(lakh) + " Lakh");
    if (thousand) parts.push(chunk(thousand) + " Thousand");
    if (rest) parts.push(chunk(rest));
    let s = parts.join(" ") + " Rupees";
    if (paise) s += " and " + twoDigits(paise) + " Paise";
    return s + " Only";
  }

  /* ---------- Tax: GST on NET after Add/Less, apportioned by item taxable ----------
   * Standard practice when multiple GST rates: distribute each add/less amount
   * proportionally across item lines by their taxable share of itemsGross, then
   * levy CGST/SGST or IGST on each line's net taxable. Single-rate bills are a
   * special case of the same rule.
   */
  function resolveAddLessAmounts(addLess, itemsGross) {
    const rows = [];
    let addTotal = 0, lessTotal = 0;
    (addLess || []).forEach((r) => {
      let amt = 0;
      const val = Number(r.value) || 0;
      if (r.mode === "percent") amt = round2(itemsGross * val / 100);
      else amt = round2(val);
      if (!(amt > 0) || !r.label) return;
      if (r.kind === "less") { lessTotal = round2(lessTotal + amt); rows.push({ kind: "less", label: r.label, amount: amt }); }
      else { addTotal = round2(addTotal + amt); rows.push({ kind: "add", label: r.label, amount: amt }); }
    });
    return { rows, addTotal, lessTotal, netAdjust: round2(addTotal - lessTotal) };
  }

  function computeBill(d) {
    const seller = store.seller;
    const buyer = store.buyers.find((b) => b.id === d.buyerId);
    if (!buyer) throw new Error("Buyer missing");
    const sellerState = seller.stateCode || (seller.gstin || "").slice(0, 2);
    const buyerState = buyer.stateCode || (buyer.gstin || "").slice(0, 2);
    const interState = !!(sellerState && buyerState && sellerState !== buyerState);

    const baseLines = (d.lines || []).map((ln) => {
      const taxable = round2(ln.qty * ln.rate);
      return Object.assign({}, ln, { taxableGross: taxable });
    });
    const itemsGross = round2(baseLines.reduce((s, l) => s + l.taxableGross, 0));
    if (!(itemsGross > 0)) throw new Error("Item totals zero");

    const adj = resolveAddLessAmounts(d.addLess, itemsGross);
    // Apportion netAdjust across lines by taxableGross share
    let allocated = 0;
    const lines = baseLines.map((l, idx) => {
      let shareAdj;
      if (idx === baseLines.length - 1) shareAdj = round2(adj.netAdjust - allocated);
      else {
        shareAdj = round2(adj.netAdjust * (l.taxableGross / itemsGross));
        allocated = round2(allocated + shareAdj);
      }
      const taxable = round2(l.taxableGross + shareAdj);
      const rate = Number(l.gstRate) || 0;
      let cgst = 0, sgst = 0, igst = 0;
      if (interState) igst = round2(taxable * rate / 100);
      else {
        cgst = round2(taxable * (rate / 2) / 100);
        sgst = round2(taxable * (rate / 2) / 100);
      }
      return Object.assign({}, l, {
        taxable, shareAdj, cgst, sgst, igst,
        lineTotal: round2(taxable + cgst + sgst + igst)
      });
    });

    const taxable = round2(lines.reduce((s, l) => s + l.taxable, 0));
    const cgst = round2(lines.reduce((s, l) => s + l.cgst, 0));
    const sgst = round2(lines.reduce((s, l) => s + l.sgst, 0));
    const igst = round2(lines.reduce((s, l) => s + l.igst, 0));
    const beforeRound = round2(taxable + cgst + sgst + igst);
    const grand = Math.round(beforeRound); // nearest rupee
    const roundOff = round2(grand - beforeRound);

    const hsnMap = {};
    lines.forEach((l) => {
      const k = l.hsn + "|" + l.gstRate;
      if (!hsnMap[k]) hsnMap[k] = { hsn: l.hsn, gstRate: l.gstRate, taxable: 0, cgst: 0, sgst: 0, igst: 0 };
      hsnMap[k].taxable = round2(hsnMap[k].taxable + l.taxable);
      hsnMap[k].cgst = round2(hsnMap[k].cgst + l.cgst);
      hsnMap[k].sgst = round2(hsnMap[k].sgst + l.sgst);
      hsnMap[k].igst = round2(hsnMap[k].igst + l.igst);
    });

    return {
      seller, buyer, interState, sellerState, buyerState,
      lines, itemsGross,
      addLessRows: adj.rows, addTotal: adj.addTotal, lessTotal: adj.lessTotal,
      taxable, cgst, sgst, igst, beforeRound, roundOff, grand,
      amountWords: amountInWords(grand),
      hsnSummary: Object.values(hsnMap)
    };
  }

  function formatDateDDMMYYYY(d) {
    const dt = d instanceof Date ? d : new Date(d);
    return String(dt.getDate()).padStart(2, "0") + "/" +
      String(dt.getMonth() + 1).padStart(2, "0") + "/" + dt.getFullYear();
  }
  function nextInvoiceNo() {
    const prefix = store.seller.invoicePrefix || "INV/";
    const n = store.seller.nextNumber || 1;
    return { number: prefix + String(n).padStart(4, "0"), next: n + 1 };
  }

  /* ---------- PDF ---------- */
  function buildPdf(bill) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: "mm", format: "a4" });
    const pageW = doc.internal.pageSize.getWidth();
    let y = 14;
    doc.setFont("helvetica", "bold"); doc.setFontSize(14);
    doc.text("TAX INVOICE", pageW / 2, y, { align: "center" }); y += 6;
    doc.setFont("helvetica", "normal"); doc.setFontSize(9);
    doc.text("(Under Rule 46 of CGST Rules)", pageW / 2, y, { align: "center" }); y += 8;
    doc.setFont("helvetica", "bold"); doc.setFontSize(12);
    doc.text(bill.seller.tradeName || bill.seller.legalName || "Seller", 14, y); y += 5;
    doc.setFont("helvetica", "normal"); doc.setFontSize(9);
    [bill.seller.legalName !== bill.seller.tradeName ? bill.seller.legalName : null,
      bill.seller.address,
      (bill.seller.stateName || "") + (bill.seller.pin ? " - " + bill.seller.pin : ""),
      "GSTIN: " + (bill.seller.gstin || ""),
      bill.seller.phone ? "Phone: " + bill.seller.phone : null
    ].filter(Boolean).forEach((t) => { doc.text(String(t), 14, y); y += 4; });
    doc.setFont("helvetica", "bold");
    doc.text("Invoice No: " + bill.invoiceNo, 120, 28);
    doc.setFont("helvetica", "normal");
    doc.text("Date: " + bill.invoiceDate, 120, 33);
    doc.text("Place of Supply: " + (bill.buyerState || "") + " (" + (STATES[bill.buyerState] || "") + ")", 120, 38);
    doc.text("Reverse Charge: No", 120, 43);
    y = Math.max(y, 50) + 2;
    doc.setDrawColor(200); doc.line(14, y, pageW - 14, y); y += 6;
    doc.setFont("helvetica", "bold"); doc.text("Bill To / Consignee", 14, y); y += 5;
    doc.setFont("helvetica", "normal");
    doc.text(bill.buyer.name, 14, y); y += 4;
    if (bill.buyer.address) { doc.text(bill.buyer.address, 14, y); y += 4; }
    doc.text((bill.buyer.stateName || "") + (bill.buyer.pin ? " - " + bill.buyer.pin : ""), 14, y); y += 4;
    if (bill.buyer.gstin) { doc.text("GSTIN: " + bill.buyer.gstin, 14, y); y += 4; }
    y += 4;
    doc.autoTable({
      startY: y,
      head: [["#", "Description", "HSN", "Qty", "Unit", "Rate", "Taxable", "Tax", "Total"]],
      body: bill.lines.map((l, i) => [
        String(i + 1), l.name, String(l.hsn), String(l.qty), l.unit || "PCS",
        Number(l.rate).toFixed(2), l.taxable.toFixed(2),
        (bill.interState ? l.igst : l.cgst + l.sgst).toFixed(2), l.lineTotal.toFixed(2)
      ]),
      styles: { fontSize: 8, cellPadding: 1.5 },
      headStyles: { fillColor: [11, 95, 255] },
      margin: { left: 14, right: 14 }
    });
    y = doc.lastAutoTable.finalY + 6;
    const boxX = 118;
    const right = (label, val, bold) => {
      if (bold) doc.setFont("helvetica", "bold"); else doc.setFont("helvetica", "normal");
      doc.text(label, boxX, y); doc.text(val, pageW - 14, y, { align: "right" }); y += 5;
    };
    right("Items Gross:", bill.itemsGross.toFixed(2));
    (bill.addLessRows || []).forEach((r) => {
      right((r.kind === "less" ? "Less: " : "Add: ") + r.label + ":", (r.kind === "less" ? "-" : "") + r.amount.toFixed(2));
    });
    right("Net Taxable:", bill.taxable.toFixed(2), true);
    if (bill.interState) right("IGST:", bill.igst.toFixed(2));
    else { right("CGST:", bill.cgst.toFixed(2)); right("SGST:", bill.sgst.toFixed(2)); }
    if (bill.roundOff) right("Round Off:", bill.roundOff.toFixed(2));
    right("Grand Total:", "Rs. " + bill.grand.toFixed(2), true);
    y += 2;
    doc.setFont("helvetica", "normal");
    const words = doc.splitTextToSize("Amount in words: " + bill.amountWords, pageW - 28);
    doc.text(words, 14, y); y += words.length * 4 + 6;
    if (bill.hsnSummary && bill.hsnSummary.length) {
      doc.setFont("helvetica", "bold"); doc.text("HSN Summary (net taxable)", 14, y); y += 2;
      doc.autoTable({
        startY: y,
        head: [["HSN", "Taxable", "CGST", "SGST", "IGST"]],
        body: bill.hsnSummary.map((h) => [h.hsn, h.taxable.toFixed(2), h.cgst.toFixed(2), h.sgst.toFixed(2), h.igst.toFixed(2)]),
        styles: { fontSize: 8 }, headStyles: { fillColor: [80, 90, 110] },
        margin: { left: 14, right: 14 }
      });
      y = doc.lastAutoTable.finalY + 8;
    }
    if (bill.seller.bankName) {
      doc.setFont("helvetica", "bold"); doc.text("Bank Details", 14, y); y += 4;
      doc.setFont("helvetica", "normal");
      doc.text(bill.seller.bankName + (bill.seller.bankAccount ? " · A/c " + bill.seller.bankAccount : ""), 14, y); y += 4;
      if (bill.seller.bankIfsc) { doc.text("IFSC: " + bill.seller.bankIfsc, 14, y); y += 4; }
    }
    y = Math.max(y + 10, 250);
    doc.text("Authorized Signatory", pageW - 14, y, { align: "right" });
    doc.setFontSize(8); doc.setTextColor(100);
    doc.text("GST on net taxable after Add/Less · Taxpayer responsible for correctness", 14, 287);
    doc.setTextColor(0);
    return doc;
  }

  /* ---------- E-way JSON (net values) ---------- */
  function buildEwayJson(bill) {
    const s = bill.seller, b = bill.buyer;
    const fromState = Number(bill.sellerState);
    const toState = Number(bill.buyerState);
    const itemList = bill.lines.map((l) => {
      const u = (l.unit || "PCS").toUpperCase();
      const qtyUnit = ["PCS", "NOS", "MTR", "KGS", "SET", "BAG", "BOX"].includes(u) ? (u === "PCS" ? "PCS" : u) : "NOS";
      return {
        productName: l.name, productDesc: l.name,
        hsnCode: Number(String(l.hsn).replace(/\D/g, "")) || 0,
        quantity: Number(l.qty), qtyUnit,
        taxableAmount: l.taxable,
        sgstRate: bill.interState ? 0 : Number(l.gstRate) / 2,
        cgstRate: bill.interState ? 0 : Number(l.gstRate) / 2,
        igstRate: bill.interState ? Number(l.gstRate) : 0,
        cessRate: 0
      };
    });
    const transporter = store.transporters.find((t) => t.id === bill.transporterId);
    const entry = {
      userGstin: s.gstin, supplyType: "O", subSupplyType: 1, subSupplyDesc: "",
      docType: "INV", docNo: bill.invoiceNo, docDate: bill.invoiceDate,
      fromGstin: s.gstin, fromTrdName: s.tradeName || s.legalName,
      fromAddr1: (s.address || "").slice(0, 120) || "Address", fromAddr2: "",
      fromPlace: (s.stateName || "Place").slice(0, 50), fromPincode: Number(s.pin) || 0,
      fromStateCode: fromState, actualFromStateCode: fromState,
      toGstin: b.gstin || "URP", toTrdName: b.name,
      toAddr1: (b.address || "").slice(0, 120) || "Address", toAddr2: "",
      toPlace: (b.stateName || "Place").slice(0, 50), toPincode: Number(b.pin) || 0,
      toStateCode: toState, actualToStateCode: toState,
      transactionType: 1,
      otherValue: bill.roundOff || 0,
      totalValue: bill.taxable,
      cgstValue: bill.cgst, sgstValue: bill.sgst, igstValue: bill.igst,
      cessValue: 0, cessNonAdvolValue: 0, totInvValue: bill.grand,
      transporterId: transporter && transporter.transporterId ? transporter.transporterId : "",
      transporterName: transporter ? transporter.name : "",
      transDocNo: "", transDocDate: "",
      transMode: String(bill.transMode || "1"),
      transDistance: String(bill.distance || "0"),
      vehicleNo: (bill.vehicleNo || "").replace(/\s+/g, "").toUpperCase(),
      vehicleType: "R", itemList
    };
    return { version: "1.0.0621", billLists: [entry] };
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  /* ---------- UI ---------- */
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $all(sel, root) { return Array.from((root || document).querySelectorAll(sel)); }

  function showScreen(name) {
    $all(".screen").forEach((el) => el.classList.remove("active"));
    const el = $("#screen-" + name);
    if (el) el.classList.add("active");
    if (name === "home") renderHome();
    if (name === "setup") renderSetup();
    if (name === "masters") renderMasters();
    if (name === "bill-buyer") renderBuyerStep();
    if (name === "bill-items") renderItemsStep();
    if (name === "bill-qty") renderQtyStep();
    if (name === "bill-addless") renderAddLessStep();
    if (name === "bill-eway") renderEwayStep();
    if (name === "bill-confirm") renderConfirm();
    if (name === "history") renderHistory();
  }

  function sellerReady() {
    return !!(store.seller.gstin && store.seller.legalName && store.seller.address && store.seller.pin);
  }

  function statusHtml(cls, text) {
    return text ? `<div class="fetch-status ${cls}">${escapeHtml(text)}</div>` : "";
  }

  function renderHome() {
    const card = $("#home-seller-card");
    if (!sellerReady()) {
      card.innerHTML = "<h2>Pehle Setup / First setup</h2><p class='hint'>Apna GSTIN aur shop details daalein.</p>" +
        "<button class='btn btn-primary btn-block' data-go='setup'>Open Setup</button>";
    } else {
      const last = store.bills[0];
      card.innerHTML = "<div class='pill ok'>Ready</div><h2 style='margin-top:8px'>" +
        escapeHtml(store.seller.tradeName || store.seller.legalName) +
        "</h2><p class='hint' style='margin:0'>GSTIN " + escapeHtml(store.seller.gstin) +
        " · Next " + escapeHtml((store.seller.invoicePrefix || "INV/") + String(store.seller.nextNumber || 1).padStart(4, "0")) + "</p>" +
        (last ? "<button class='btn btn-secondary btn-block' id='btn-repeat-last' style='margin-top:10px'>Repeat last bill / पिछला दोहराएँ<br/><span style='font-weight:500;font-size:0.8rem'>" +
          escapeHtml(last.buyerName) + " · ₹" + Number(last.grand).toFixed(0) + "</span></button>" : "") +
        "<div class='row' style='margin-top:10px'><button class='btn btn-ghost' id='btn-backup'>Backup</button><button class='btn btn-ghost' id='btn-restore'>Restore</button></div>" +
        "<input type='file' id='restore-file' accept='application/json,.json' class='hidden' />";
      const rep = $("#btn-repeat-last");
      if (rep) rep.onclick = () => repeatLastBill();
      const bak = $("#btn-backup");
      if (bak) bak.onclick = () => backupStore();
      const rst = $("#btn-restore");
      const file = $("#restore-file");
      if (rst && file) {
        rst.onclick = () => file.click();
        file.onchange = () => restoreStore(file.files && file.files[0]);
      }
    }
  }

  function repeatLastBill() {
    const last = store.bills[0];
    if (!last || !last.snapshot) return;
    const snap = last.snapshot;
    if (!sellerReady()) { showScreen("setup"); return; }
    draft = emptyDraft();
    const matchBuyer = store.buyers.find((b) => {
      if (snap.buyer && snap.buyer.gstin && b.gstin && b.gstin === snap.buyer.gstin) return true;
      if (snap.buyer && b.name === snap.buyer.name) return true;
      if (snap.buyerName && b.name === snap.buyerName) return true;
      return false;
    });
    draft.buyerId = matchBuyer ? matchBuyer.id : null;
    if (!draft.buyerId && snap.buyer) {
      // ensure buyer exists
      const b = {
        id: uid(), name: snap.buyer.name, gstin: snap.buyer.gstin || "",
        address: snap.buyer.address || "", pin: snap.buyer.pin || "",
        stateCode: snap.buyer.stateCode || "", stateName: snap.buyer.stateName || ""
      };
      store.buyers.unshift(b); save();
      draft.buyerId = b.id;
    }
    draft.lines = (snap.lines || []).map((l) => ({
      itemId: l.itemId || uid(), name: l.name, hsn: l.hsn, gstRate: l.gstRate, unit: l.unit || "PCS",
      qty: l.qty, rate: l.rate
    }));
    // ensure items in master
    draft.lines.forEach((l) => {
      if (!store.items.some((it) => it.name === l.name && it.hsn === l.hsn)) {
        store.items.push({ id: l.itemId || uid(), name: l.name, hsn: l.hsn, gstRate: l.gstRate, unit: l.unit || "PCS" });
      }
    });
    draft.addLess = (snap.addLessRows || []).map((r) => ({
      id: uid(), kind: r.kind, label: r.label, mode: "amount", value: r.amount
    }));
    draft.wantEway = null;
    draft.transporterId = snap.transporterId || null;
    draft.vehicleNo = snap.vehicleNo || "";
    draft.distance = snap.distance || 10;
    save();
    showScreen("bill-qty");
    renderQtyStep();
  }

  function backupStore() {
    const blob = new Blob([JSON.stringify(store, null, 2)], { type: "application/json" });
    downloadBlob(blob, "gst-bill-backup.json");
  }

  async function restoreStore(file) {
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (!data || !data.seller) throw new Error("Invalid backup");
      store = Object.assign(defaultStore(), data);
      store.seller = Object.assign(defaultStore().seller, data.seller || {});
      store.settings = Object.assign(defaultStore().settings, data.settings || {});
      save();
      renderHome();
      alert("Backup restore ho gaya ✓");
    } catch (e) {
      alert("Restore fail: " + (e.message || e));
    }
  }

  function wireGstinField(opts) {
    // opts: { input, statusEl, onApply, fetchBtn, helperPanel }
    const input = opts.input;
    const applyDet = (det) => {
      opts.onApply(det);
      const cls = (det.source === "offline" || det.fetchError) ? "offline" : "ok";
      opts.statusEl.innerHTML = statusHtml(cls, det.msg + (det.pan ? " · PAN " + det.pan : ""));
    };
    const runSoft = async () => {
      const g = input.value.trim();
      if (g.length < 15) return;
      const v = validateGstin(g);
      if (!v.ok) { opts.statusEl.innerHTML = statusHtml("err", v.msg); return; }
      const master = findMasterByGstin(v.gstin);
      if (master) { applyDet(master); return; }
      opts.onApply({ stateCode: v.stateCode, stateName: v.stateName, pan: v.pan });
      opts.statusEl.innerHTML = statusHtml("offline", "State/PAN OK · Name/Address: Fetch dabayein");
    };
    const runFetch = async () => {
      const g = input.value.trim();
      if (!g || g.length < 15) {
        opts.statusEl.innerHTML = statusHtml("err", "Pehle 15-digit GSTIN type karein");
        return;
      }
      opts.statusEl.innerHTML = statusHtml("loading", "Checking…");
      const v = validateGstin(g);
      if (!v.ok) { opts.statusEl.innerHTML = statusHtml("err", v.msg); return; }

      // 1) master hit
      const master = findMasterByGstin(v.gstin);
      if (master) {
        applyDet(master);
        return;
      }

      // 2) optional API key path
      const provider = (store.settings && store.settings.gstLookupProvider) || "offline";
      const key = (store.settings && store.settings.gstLookupKey || "").trim();
      if (provider !== "offline" && key) {
        const online = await lookupGstinOnline(v.gstin);
        if (online.ok) { applyDet(online); return; }
        opts.statusEl.innerHTML = statusHtml("err", "API fail: " + online.msg);
      }

      // 3) always apply offline state/PAN so Fetch never "does nothing"
      const off = offlineFromGstin(v.gstin);
      opts.onApply({ stateCode: off.stateCode, stateName: off.stateName, pan: off.pan, legalName: "", tradeName: "", address: "", pin: "" });
      opts.statusEl.innerHTML = statusHtml("offline", "State/PAN bhar diya. Name/Address: neeche paste karein (free, unlimited).");
      if (opts.helperPanel) {
        openFetchHelper({
          panelEl: opts.helperPanel,
          gstin: v.gstin,
          statusEl: opts.statusEl,
          onApply: (det) => applyDet(det)
        });
      }
    };
    input.addEventListener("change", () => { runSoft(); });
    // no blur soft-fill — it races with Fetch click and overwrites the helper UX
    if (opts.fetchBtn) {
      opts.fetchBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        runFetch();
      });
    }
  }

  function renderSetup() {
    const s = store.seller;
    const set = store.settings || defaultStore().settings;
    $("#setup-form").innerHTML = `
      <h2>Shop / हमारी फर्म</h2>
      <div class="field"><label>GSTIN *</label>
        <input id="s-gstin" value="${escapeHtml(s.gstin)}" maxlength="15" placeholder="15-digit GSTIN" autocomplete="off" />
      </div>
      <div id="s-status"></div>
      <button type="button" class="btn btn-secondary btn-block" id="s-fetch" style="margin-bottom:10px">Fetch details / डिटेल्स लाओ</button>
      <div id="s-fetch-helper" class="hidden"></div>
      <p class="pan-hint" id="s-pan"></p>
      <div class="field"><label>Legal Name *</label><input id="s-legal" value="${escapeHtml(s.legalName)}" /></div>
      <div class="field"><label>Trade Name</label><input id="s-trade" value="${escapeHtml(s.tradeName)}" /></div>
      <div class="field"><label>Address *</label><textarea id="s-addr" rows="2">${escapeHtml(s.address)}</textarea></div>
      <div class="row">
        <div class="field"><label>PIN *</label><input id="s-pin" value="${escapeHtml(s.pin)}" maxlength="6" /></div>
        <div class="field"><label>State</label><input id="s-state" value="${escapeHtml((s.stateCode || "") + (s.stateName ? " - " + s.stateName : ""))}" /></div>
      </div>
      <div class="field"><label>Phone</label><input id="s-phone" value="${escapeHtml(s.phone)}" /></div>
      <div class="field"><label>Bank Name (optional)</label><input id="s-bank" value="${escapeHtml(s.bankName)}" /></div>
      <div class="row">
        <div class="field"><label>A/c No</label><input id="s-ac" value="${escapeHtml(s.bankAccount)}" /></div>
        <div class="field"><label>IFSC</label><input id="s-ifsc" value="${escapeHtml(s.bankIfsc)}" /></div>
      </div>
      <div class="row">
        <div class="field"><label>Invoice Prefix</label><input id="s-prefix" value="${escapeHtml(s.invoicePrefix || "INV/")}" /></div>
        <div class="field"><label>Next No</label><input id="s-next" type="number" min="1" value="${Number(s.nextNumber) || 1}" /></div>
      </div>
      <hr style="border:none;border-top:1px solid var(--border);margin:16px 0" />
      <h2>GSTIN Lookup (optional API key)</h2>
      <p class="hint">Default free path = Fetch → paste from GST portal (unlimited, no key). Neeche sirf optional trial APIs hain.</p>
      <div class="field"><label>Provider</label>
        <select id="s-provider">
          <option value="offline" ${set.gstLookupProvider === "offline" ? "selected" : ""}>Offline only (free, no key)</option>
          <option value="appyflow" ${set.gstLookupProvider === "appyflow" ? "selected" : ""}>Appyflow (50 free trial)</option>
          <option value="gstincheck" ${set.gstLookupProvider === "gstincheck" ? "selected" : ""}>gstincheck.co.in (20 free)</option>
        </select>
      </div>
      <div class="field"><label>API key / key_secret (phone pe store)</label>
        <input id="s-apikey" type="password" value="${escapeHtml(set.gstLookupKey || "")}" placeholder="Paste free key" autocomplete="off" />
      </div>
      <p class="error" id="setup-err"></p>
    `;
    const apply = (det) => {
      if (det.legalName) $("#s-legal").value = det.legalName;
      if (det.tradeName) $("#s-trade").value = det.tradeName;
      if (det.address) $("#s-addr").value = det.address;
      if (det.pin) $("#s-pin").value = det.pin;
      if (det.stateCode || det.stateName) $("#s-state").value = (det.stateCode || "") + (det.stateName ? " - " + det.stateName : "");
      if (det.pan) $("#s-pan").textContent = "PAN: " + det.pan;
    };
    wireGstinField({
      input: $("#s-gstin"), statusEl: $("#s-status"), fetchBtn: $("#s-fetch"),
      helperPanel: $("#s-fetch-helper"), onApply: apply
    });
  }

  function saveSetup() {
    const g = validateGstin($("#s-gstin").value);
    const err = $("#setup-err");
    if (!g.ok) { err.textContent = g.msg; return; }
    const legal = $("#s-legal").value.trim();
    const addr = $("#s-addr").value.trim();
    const pin = $("#s-pin").value.trim();
    if (!legal || !addr || !/^\d{6}$/.test(pin)) {
      err.textContent = "Legal name, address, 6-digit PIN required";
      return;
    }
    const stateRaw = $("#s-state").value.trim();
    let stateCode = g.stateCode, stateName = g.stateName;
    const m = stateRaw.match(/^(\d{2})/);
    if (m && STATES[m[1]]) { stateCode = m[1]; stateName = STATES[m[1]]; }
    store.seller = {
      gstin: g.gstin, legalName: legal,
      tradeName: $("#s-trade").value.trim() || legal,
      address: addr, pin, stateCode, stateName,
      phone: $("#s-phone").value.trim(),
      bankName: $("#s-bank").value.trim(),
      bankAccount: $("#s-ac").value.trim(),
      bankIfsc: $("#s-ifsc").value.trim().toUpperCase(),
      invoicePrefix: $("#s-prefix").value.trim() || "INV/",
      nextNumber: Math.max(1, Number($("#s-next").value) || 1)
    };
    store.settings = {
      gstLookupProvider: $("#s-provider").value || "offline",
      gstLookupKey: $("#s-apikey").value.trim()
    };
    save();
    showScreen("home");
  }

  /* ---------- Masters ---------- */
  function renderMasters() {
    $all("#master-tabs .chip").forEach((c) => c.classList.toggle("on", c.dataset.master === masterTab));
    const panel = $("#masters-panel");
    if (masterTab === "buyers") {
      panel.innerHTML = "<h2>Buyers</h2>" +
        (store.buyers.length ? "<div class='list'>" + store.buyers.map((b) =>
          `<div class="list-item"><div class="avatar">${escapeHtml(b.name.slice(0, 1))}</div><div class="meta"><strong>${escapeHtml(b.name)}</strong><span>${escapeHtml(b.gstin || "URP")} · ${escapeHtml(b.stateName || "")}</span></div></div>`
        ).join("") + "</div>" : "<p class='empty'>No buyers yet</p>") +
        "<button class='btn btn-secondary btn-block' id='m-add-buyer' style='margin-top:10px'>+ Add buyer</button><div id='m-buyer-form'></div>";
      $("#m-add-buyer").onclick = () => showBuyerForm($("#m-buyer-form"), null, () => renderMasters());
    } else if (masterTab === "items") {
      panel.innerHTML = "<h2>Items</h2>" +
        (store.items.length ? "<div class='list'>" + store.items.map((it) =>
          `<div class="list-item"><div class="avatar">₹</div><div class="meta"><strong>${escapeHtml(it.name)}</strong><span>HSN ${escapeHtml(it.hsn)} · GST ${it.gstRate}%</span></div></div>`
        ).join("") + "</div>" : "<p class='empty'>No items yet</p>") +
        "<button class='btn btn-secondary btn-block' id='m-add-item' style='margin-top:10px'>+ Add item</button><div id='m-item-form'></div>";
      $("#m-add-item").onclick = () => showItemForm($("#m-item-form"), null, () => renderMasters());
    } else {
      panel.innerHTML = "<h2>Transporters</h2>" +
        (store.transporters.length ? "<div class='list'>" + store.transporters.map((t) =>
          `<div class="list-item"><div class="avatar">🚚</div><div class="meta"><strong>${escapeHtml(t.name)}</strong><span>${escapeHtml(t.transporterId || "—")}</span></div></div>`
        ).join("") + "</div>" : "<p class='empty'>No transporters yet</p>") +
        "<button class='btn btn-secondary btn-block' id='m-add-tr' style='margin-top:10px'>+ Add transporter</button><div id='m-tr-form'></div>";
      $("#m-add-tr").onclick = () => showTransporterForm($("#m-tr-form"), null, () => renderMasters());
    }
  }

  function showBuyerForm(container, existing, onSaved) {
    container.classList.remove("hidden");
    container.innerHTML = `
      <div class="field"><label>GSTIN (blank = unregistered)</label>
        <input id="bf-gstin" maxlength="15" value="${escapeHtml(existing && existing.gstin || "")}" autocomplete="off" /></div>
      <div id="bf-status"></div>
      <button type="button" class="btn btn-secondary btn-block" id="bf-fetch" style="margin-bottom:8px">Fetch / डिटेल्स लाओ</button>
      <div id="bf-fetch-helper" class="hidden"></div>
      <p class="pan-hint" id="bf-pan"></p>
      <div class="field"><label>Name *</label><input id="bf-name" value="${escapeHtml(existing && existing.name || "")}" /></div>
      <div class="field"><label>Address *</label><textarea id="bf-addr" rows="2">${escapeHtml(existing && existing.address || "")}</textarea></div>
      <div class="row">
        <div class="field"><label>PIN *</label><input id="bf-pin" maxlength="6" value="${escapeHtml(existing && existing.pin || "")}" /></div>
        <div class="field"><label>State</label><input id="bf-state" value="${escapeHtml(existing ? ((existing.stateCode || "") + (existing.stateName ? " - " + existing.stateName : "")) : "")}" /></div>
      </div>
      <p class="error" id="bf-err"></p>
      <button class="btn btn-primary btn-block" id="bf-save">Save buyer</button>`;
    wireGstinField({
      input: $("#bf-gstin"), statusEl: $("#bf-status"), fetchBtn: $("#bf-fetch"),
      helperPanel: $("#bf-fetch-helper"),
      onApply: (det) => {
        if (det.legalName || det.tradeName) $("#bf-name").value = det.tradeName || det.legalName;
        if (det.address) $("#bf-addr").value = det.address;
        if (det.pin) $("#bf-pin").value = det.pin;
        if (det.stateCode || det.stateName) $("#bf-state").value = (det.stateCode || "") + (det.stateName ? " - " + det.stateName : "");
        if (det.pan) $("#bf-pan").textContent = "PAN: " + det.pan;
      }
    });
    $("#bf-save").onclick = () => {
      const name = $("#bf-name").value.trim();
      const addr = $("#bf-addr").value.trim();
      const pin = $("#bf-pin").value.trim();
      const gstinRaw = $("#bf-gstin").value.trim();
      if (!name || !addr || !/^\d{6}$/.test(pin)) { $("#bf-err").textContent = "Name, address, PIN required"; return; }
      let stateCode = "", stateName = "", gstin = "";
      if (gstinRaw) {
        const v = validateGstin(gstinRaw);
        if (!v.ok) { $("#bf-err").textContent = v.msg; return; }
        gstin = v.gstin; stateCode = v.stateCode; stateName = v.stateName;
        const sm = $("#bf-state").value.trim().match(/^(\d{2})/);
        if (sm && STATES[sm[1]]) { stateCode = sm[1]; stateName = STATES[sm[1]]; }
      } else {
        stateCode = store.seller.stateCode || "09";
        stateName = STATES[stateCode] || "";
      }
      const row = { id: existing ? existing.id : uid(), name, gstin, address: addr, pin, stateCode, stateName };
      if (existing) store.buyers[store.buyers.findIndex((b) => b.id === existing.id)] = row;
      else store.buyers.push(row);
      save();
      if (onSaved) onSaved(row);
    };
  }

  function showItemForm(container, existing, onSaved) {
    container.classList.remove("hidden");
    container.innerHTML = `
      <div class="field"><label>Item name *</label><input id="if-name" value="${escapeHtml(existing && existing.name || "")}" placeholder="Saree" /></div>
      <div class="row">
        <div class="field"><label>HSN *</label><input id="if-hsn" value="${escapeHtml(existing && existing.hsn || "5407")}" /></div>
        <div class="field"><label>GST % *</label><input id="if-rate" type="number" step="0.01" value="${existing ? existing.gstRate : 5}" /></div>
      </div>
      <div class="field"><label>Unit</label>
        <select id="if-unit">${["PCS","NOS","MTR","SET","BAG","BOX"].map((u) =>
          `<option ${((existing && existing.unit) || "PCS") === u ? "selected" : ""}>${u}</option>`).join("")}</select>
      </div>
      <p class="error" id="if-err"></p>
      <button class="btn btn-primary btn-block" id="if-save">Save item</button>`;
    $("#if-save").onclick = () => {
      const name = $("#if-name").value.trim();
      const hsn = $("#if-hsn").value.trim();
      const gstRate = Number($("#if-rate").value);
      const unit = $("#if-unit").value;
      if (!name || !hsn || !(gstRate >= 0)) { $("#if-err").textContent = "Name, HSN, rate required"; return; }
      const row = { id: existing ? existing.id : uid(), name, hsn, gstRate, unit };
      if (existing) store.items[store.items.findIndex((x) => x.id === existing.id)] = row;
      else store.items.push(row);
      save();
      if (onSaved) onSaved(row);
    };
  }

  function showTransporterForm(container, existing, onSaved) {
    container.classList.remove("hidden");
    container.innerHTML = `
      <div class="field"><label>Transporter ID / GSTIN</label>
        <input id="tf-id" value="${escapeHtml(existing && existing.transporterId || "")}" maxlength="15" autocomplete="off" /></div>
      <div id="tf-status"></div>
      <button type="button" class="btn btn-secondary btn-block" id="tf-fetch" style="margin-bottom:8px">Fetch / डिटेल्स लाओ</button>
      <div id="tf-fetch-helper" class="hidden"></div>
      <div class="field"><label>Name *</label><input id="tf-name" value="${escapeHtml(existing && existing.name || "")}" /></div>
      <p class="error" id="tf-err"></p>
      <button class="btn btn-primary btn-block" id="tf-save">Save transporter</button>`;
    wireGstinField({
      input: $("#tf-id"), statusEl: $("#tf-status"), fetchBtn: $("#tf-fetch"),
      helperPanel: $("#tf-fetch-helper"),
      onApply: (det) => {
        if (det.tradeName || det.legalName) $("#tf-name").value = det.tradeName || det.legalName;
      }
    });
    $("#tf-save").onclick = () => {
      const name = $("#tf-name").value.trim();
      if (!name) { $("#tf-err").textContent = "Name required"; return; }
      let tid = $("#tf-id").value.trim().toUpperCase();
      if (tid) {
        const v = validateGstin(tid);
        if (!v.ok) { $("#tf-err").textContent = v.msg; return; }
        tid = v.gstin;
      }
      const row = { id: existing ? existing.id : uid(), name, transporterId: tid };
      if (existing) store.transporters[store.transporters.findIndex((t) => t.id === existing.id)] = row;
      else store.transporters.push(row);
      save();
      if (onSaved) onSaved(row);
    };
  }

  /* ---------- Bill steps ---------- */
  function startBill() {
    if (!sellerReady()) { showScreen("setup"); return; }
    draft = emptyDraft();
    showScreen("bill-buyer");
  }

  function renderBuyerStep() {
    const q = ($("#buyer-search").value || "").toLowerCase();
    const list = store.buyers.filter((b) => !q || b.name.toLowerCase().includes(q) || (b.gstin || "").toLowerCase().includes(q));
    $("#buyer-list").innerHTML = list.length ? list.map((b) => `
      <button class="list-item ${draft.buyerId === b.id ? "selected" : ""}" data-buyer="${b.id}">
        <div class="avatar">${escapeHtml(b.name.slice(0, 1))}</div>
        <div class="meta"><strong>${escapeHtml(b.name)}</strong><span>${escapeHtml(b.gstin || "Unregistered")} · ${escapeHtml(b.pin || "")}</span></div>
      </button>`).join("") : "<p class='empty'>No buyers — add new</p>";
    $all("#buyer-list [data-buyer]").forEach((btn) => {
      btn.onclick = () => { draft.buyerId = btn.dataset.buyer; renderBuyerStep(); };
    });
    $("#btn-buyer-next").disabled = !draft.buyerId;
  }

  function renderItemsStep() {
    const q = ($("#item-search").value || "").toLowerCase();
    const selected = new Set(draft.lines.map((l) => l.itemId));
    const list = store.items.filter((it) => !q || it.name.toLowerCase().includes(q) || it.hsn.includes(q));
    $("#item-list").innerHTML = list.length ? list.map((it) => `
      <button class="list-item ${selected.has(it.id) ? "selected" : ""}" data-item="${it.id}">
        <div class="avatar">₹</div>
        <div class="meta"><strong>${escapeHtml(it.name)}</strong><span>HSN ${escapeHtml(it.hsn)} · ${it.gstRate}%</span></div>
      </button>`).join("") : "<p class='empty'>No items — add Saree etc.</p>";
    $all("#item-list [data-item]").forEach((btn) => {
      btn.onclick = () => {
        const id = btn.dataset.item;
        const it = store.items.find((x) => x.id === id);
        const idx = draft.lines.findIndex((l) => l.itemId === id);
        if (idx >= 0) draft.lines.splice(idx, 1);
        else draft.lines.push({ itemId: it.id, name: it.name, hsn: it.hsn, gstRate: it.gstRate, unit: it.unit, qty: 1, rate: 0 });
        renderItemsStep();
      };
    });
    $("#btn-items-next").disabled = draft.lines.length === 0;
  }

  function renderQtyStep() {
    $("#qty-lines").innerHTML = draft.lines.map((l, i) => `
      <div class="card" data-line="${i}">
        <h2>${escapeHtml(l.name)}</h2>
        <p class="hint">HSN ${escapeHtml(l.hsn)} · GST ${l.gstRate}%</p>
        <div class="row">
          <div class="field"><label>Qty / मात्रा</label><input type="number" min="0.001" step="1" class="q-qty" value="${l.qty}" /></div>
          <div class="field"><label>Rate ₹ / भाव</label><input type="number" min="0" step="0.01" class="q-rate" value="${l.rate}" /></div>
        </div>
      </div>`).join("");
    $all("#qty-lines .card").forEach((card) => {
      const i = Number(card.dataset.line);
      card.querySelector(".q-qty").oninput = (e) => { draft.lines[i].qty = Number(e.target.value) || 0; paintLiveTotals("#qty-totals"); };
      card.querySelector(".q-rate").oninput = (e) => { draft.lines[i].rate = Number(e.target.value) || 0; paintLiveTotals("#qty-totals"); };
    });
    paintLiveTotals("#qty-totals");
  }

  function paintLiveTotals(sel) {
    try {
      const c = computeBill(draft);
      $(sel).innerHTML = `
        <div class="line"><span>Items Gross</span><span>₹ ${c.itemsGross.toFixed(2)}</span></div>
        ${c.addTotal ? `<div class="line"><span>Add</span><span>₹ ${c.addTotal.toFixed(2)}</span></div>` : ""}
        ${c.lessTotal ? `<div class="line"><span>Less</span><span>− ₹ ${c.lessTotal.toFixed(2)}</span></div>` : ""}
        <div class="line"><span>Net Taxable</span><span>₹ ${c.taxable.toFixed(2)}</span></div>
        ${c.interState
          ? `<div class="line"><span>IGST</span><span>₹ ${c.igst.toFixed(2)}</span></div>`
          : `<div class="line"><span>CGST</span><span>₹ ${c.cgst.toFixed(2)}</span></div>
             <div class="line"><span>SGST</span><span>₹ ${c.sgst.toFixed(2)}</span></div>`}
        ${c.roundOff ? `<div class="line"><span>Round Off</span><span>₹ ${c.roundOff.toFixed(2)}</span></div>` : ""}
        <div class="line grand"><span>Total</span><span>₹ ${c.grand.toFixed(2)}</span></div>`;
    } catch (e) { $(sel).innerHTML = ""; }
  }

  function renderAddLessColumn(kind, containerId, placeholder) {
    const root = $(containerId);
    const rows = draft.addLess
      .map((r, i) => ({ r, i }))
      .filter((x) => x.r.kind === kind);
    if (!rows.length) {
      root.innerHTML = "<p class='hint' style='margin:0 0 6px;font-size:0.75rem'>Blank — + row</p>";
      return;
    }
    root.innerHTML = rows.map(({ r, i }) => `
      <div class="addless-line" data-i="${i}">
        <input class="al-label" placeholder="${placeholder}" value="${escapeHtml(r.label)}" />
        <input class="al-val" type="number" min="0" step="0.01" inputmode="decimal" placeholder="₹" value="${r.value || ""}" />
        <button type="button" class="al-del" title="Remove" aria-label="Remove">✕</button>
      </div>`).join("");
    $all(containerId + " .addless-line").forEach((row) => {
      const i = Number(row.dataset.i);
      row.querySelector(".al-label").oninput = (e) => { draft.addLess[i].label = e.target.value; paintLiveTotals("#addless-totals"); };
      row.querySelector(".al-val").oninput = (e) => { draft.addLess[i].value = Number(e.target.value) || 0; paintLiveTotals("#addless-totals"); };
      row.querySelector(".al-del").onclick = () => { draft.addLess.splice(i, 1); renderAddLessStep(); };
    });
  }

  function renderAddLessStep() {
    renderAddLessColumn("add", "#add-rows", "Freight / भाड़ा");
    renderAddLessColumn("less", "#less-rows", "Discount / छूट");
    paintLiveTotals("#addless-totals");
  }

  function renderEwayStep() {
    let grand = 0;
    try { grand = computeBill(draft).grand; } catch (e) {}
    const over = grand > 50000;
    const note = $("#eway-note");
    if (over) {
      note.innerHTML = `<span class="pill warn">₹${grand.toFixed(0)} &gt; 50,000 — E-way bill zaroori (Rule 138)</span><br/>Default YES.`;
      if (draft.wantEway === null) draft.wantEway = true;
    } else {
      note.innerHTML = `<span class="pill">₹${grand.toFixed(0)} ≤ 50,000</span><br/>E-way bill optional — Yes / No.`;
      if (draft.wantEway === null) draft.wantEway = false;
    }
    $("#eway-yes").classList.toggle("selected", draft.wantEway === true);
    $("#eway-no").classList.toggle("selected", draft.wantEway === false);
    $("#eway-details").classList.toggle("hidden", draft.wantEway !== true);
    const sel = $("#eway-transporter");
    sel.innerHTML = "<option value=\"\">— Select / चुनें —</option>" +
      store.transporters.map((t) => `<option value="${t.id}" ${draft.transporterId === t.id ? "selected" : ""}>${escapeHtml(t.name)}</option>`).join("");
    $("#eway-vehicle").value = draft.vehicleNo || "";
    $("#eway-distance").value = draft.distance || 10;
    $("#btn-eway-next").disabled = draft.wantEway === null;
  }

  function renderConfirm() {
    const c = computeBill(draft);
    const tr = store.transporters.find((t) => t.id === draft.transporterId);
    $("#confirm-summary").innerHTML = `
      <dt>Buyer / खरीदार</dt><dd>${escapeHtml(c.buyer.name)} (${escapeHtml(c.buyer.gstin || "URP")})</dd>
      <dt>Items Gross</dt><dd>₹ ${c.itemsGross.toFixed(2)} — ${c.lines.map((l) => escapeHtml(l.name) + " × " + l.qty + " @ ₹" + l.rate).join("; ")}</dd>
      <dt>Add / Less</dt><dd>${(c.addLessRows.length ? c.addLessRows.map((r) => (r.kind === "less" ? "− " : "+ ") + escapeHtml(r.label) + " ₹" + r.amount.toFixed(2)).join("<br/>") : "—")}</dd>
      <dt>Net Taxable</dt><dd>₹ ${c.taxable.toFixed(2)}</dd>
      <dt>Tax</dt><dd>${c.interState ? "IGST" : "CGST + SGST"}</dd>
      <dt>E-Way</dt><dd>${draft.wantEway ? ("YES · " + escapeHtml(tr ? tr.name : "—") + " · " + escapeHtml(draft.vehicleNo || "vehicle later")) : "NO"}</dd>
      <dt>Amount in words</dt><dd>${escapeHtml(c.amountWords)}</dd>`;
    paintLiveTotals("#confirm-totals");
  }

  function generateBill() {
    const inv = nextInvoiceNo();
    const computed = computeBill(draft);
    const bill = Object.assign({}, computed, {
      id: uid(),
      invoiceNo: inv.number,
      invoiceDate: formatDateDDMMYYYY(new Date()),
      createdAt: new Date().toISOString(),
      wantEway: !!draft.wantEway,
      transporterId: draft.transporterId,
      vehicleNo: (draft.vehicleNo || "").replace(/\s+/g, "").toUpperCase(),
      distance: Number(draft.distance) || 0,
      transMode: draft.transMode || "1"
    });
    const doc = buildPdf(bill);
    const pdfB = doc.output("blob");
    let ewayJson = null;
    if (bill.wantEway) ewayJson = buildEwayJson(bill);
    store.seller.nextNumber = inv.next;
    store.bills.unshift({
      id: bill.id, invoiceNo: bill.invoiceNo, invoiceDate: bill.invoiceDate,
      buyerName: bill.buyer.name, grand: bill.grand, wantEway: bill.wantEway, snapshot: bill
    });
    if (store.bills.length > 100) store.bills.length = 100;
    save();
    lastBill = { bill, pdfBlob: pdfB, ewayJson, doc };
    $("#done-inv-no").textContent = bill.invoiceNo + " · ₹" + bill.grand.toFixed(2);
    $("#btn-dl-json").classList.toggle("hidden", !bill.wantEway);
    $("#done-eway-help").classList.toggle("hidden", !bill.wantEway);
    showScreen("bill-done");
  }

  function downloadPdf() {
    if (!lastBill) return;
    lastBill.doc.save(lastBill.bill.invoiceNo.replace(/\//g, "-") + ".pdf");
  }
  async function sharePdf() {
    if (!lastBill) return;
    const file = new File([lastBill.pdfBlob], lastBill.bill.invoiceNo.replace(/\//g, "-") + ".pdf", { type: "application/pdf" });
    if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: "Tax Invoice " + lastBill.bill.invoiceNo, text: "GST Tax Invoice " + lastBill.bill.invoiceNo }); return; }
      catch (e) {}
    }
    downloadPdf();
    alert("Share not available — PDF downloaded. WhatsApp pe attach karein.");
  }
  function downloadJson() {
    if (!lastBill || !lastBill.ewayJson) return;
    downloadBlob(new Blob([JSON.stringify(lastBill.ewayJson, null, 2)], { type: "application/json" }),
      "EWB_" + lastBill.bill.invoiceNo.replace(/\//g, "-") + ".json");
  }

  function renderHistory() {
    const el = $("#history-list");
    if (!store.bills.length) { el.innerHTML = "<p class='empty'>No bills yet</p>"; return; }
    el.innerHTML = store.bills.map((b) => `
      <div class="card">
        <strong>${escapeHtml(b.invoiceNo)}</strong>
        <div class="hint" style="margin:4px 0">${escapeHtml(b.invoiceDate)} · ${escapeHtml(b.buyerName)} · ₹${Number(b.grand).toFixed(2)} ${b.wantEway ? "· EWB" : ""}</div>
        <div class="row">
          <button class="btn btn-secondary" data-redl-pdf="${b.id}">PDF</button>
          ${b.wantEway ? `<button class="btn btn-warn" data-redl-json="${b.id}">JSON</button>` : ""}
        </div>
      </div>`).join("");
    $all("[data-redl-pdf]").forEach((btn) => {
      btn.onclick = () => {
        const row = store.bills.find((x) => x.id === btn.dataset.redlPdf);
        if (!row) return;
        buildPdf(row.snapshot).save(row.invoiceNo.replace(/\//g, "-") + ".pdf");
      };
    });
    $all("[data-redl-json]").forEach((btn) => {
      btn.onclick = () => {
        const row = store.bills.find((x) => x.id === btn.dataset.redlJson);
        if (!row) return;
        downloadBlob(new Blob([JSON.stringify(buildEwayJson(row.snapshot), null, 2)], { type: "application/json" }),
          "EWB_" + row.invoiceNo.replace(/\//g, "-") + ".json");
      };
    });
  }

  function seedDemo() {
    store.seller = {
      gstin: "09AAAAA0000A1Z0", legalName: "Demo Textiles Private Limited", tradeName: "Shree Silk House",
      address: "Chowk, Varanasi, Uttar Pradesh", pin: "221001", stateCode: "09", stateName: "UP",
      phone: "9999999999", bankName: "Demo Bank", bankAccount: "1234567890", bankIfsc: "DEMO0001234",
      invoicePrefix: "INV/", nextNumber: 1
    };
    store.settings = { gstLookupProvider: "offline", gstLookupKey: "" };
    store.buyers = [
      { id: "buyer_jk", name: "Jyoti Krishna Saree Centre", gstin: "09BBBBB0000B1ZR",
        address: "Lanka, Varanasi, Uttar Pradesh", pin: "221005", stateCode: "09", stateName: "UP" },
      { id: "buyer_mh", name: "Mumbai Silk Traders", gstin: "27DDDDD2222D1ZZ",
        address: "Kalbadavi, Mumbai", pin: "400002", stateCode: "27", stateName: "Maharashtra" }
    ];
    store.items = [{ id: "item_saree", name: "Saree", hsn: "5407", gstRate: 5, unit: "PCS" }];
    store.transporters = [{ id: "tr_shree", name: "Shree Hari Transport", transporterId: "09CCCCC1111C1ZC" }];
    save();
  }

  /* ---------- Events ---------- */
  document.addEventListener("click", (e) => {
    const go = e.target.closest("[data-go]");
    if (go) {
      const name = go.dataset.go;
      if (name === "bill-buyer") startBill();
      else showScreen(name);
    }
  });

  $("#btn-save-setup").onclick = saveSetup;
  $("#btn-add-buyer").onclick = () => {
    const card = $("#buyer-form-card");
    showBuyerForm(card, null, (row) => {
      draft.buyerId = row.id; card.classList.add("hidden"); card.innerHTML = ""; renderBuyerStep();
    });
  };
  $("#btn-buyer-next").onclick = () => showScreen("bill-items");
  $("#buyer-search").oninput = () => renderBuyerStep();
  $("#btn-add-item").onclick = () => {
    const card = $("#item-form-card");
    showItemForm(card, null, () => { card.classList.add("hidden"); card.innerHTML = ""; renderItemsStep(); });
  };
  $("#btn-items-next").onclick = () => showScreen("bill-qty");
  $("#item-search").oninput = () => renderItemsStep();
  $("#btn-qty-next").onclick = () => {
    if (draft.lines.some((l) => !(l.qty > 0) || !(l.rate > 0))) {
      alert("Har item ki qty aur rate daalein"); return;
    }
    showScreen("bill-addless");
  };
  $("#btn-add-charge").onclick = () => {
    draft.addLess.push({ id: uid(), kind: "add", label: "Freight", mode: "amount", value: 0 });
    renderAddLessStep();
  };
  $("#btn-add-discount").onclick = () => {
    draft.addLess.push({ id: uid(), kind: "less", label: "Discount", mode: "amount", value: 0 });
    renderAddLessStep();
  };
  $("#btn-addless-next").onclick = () => { draft.wantEway = null; showScreen("bill-eway"); };
  $("#eway-yes").onclick = () => { draft.wantEway = true; renderEwayStep(); };
  $("#eway-no").onclick = () => { draft.wantEway = false; renderEwayStep(); };
  $("#eway-transporter").onchange = (e) => { draft.transporterId = e.target.value || null; };
  $("#eway-vehicle").oninput = (e) => { draft.vehicleNo = e.target.value; };
  $("#eway-distance").oninput = (e) => { draft.distance = Number(e.target.value) || 0; };
  $("#btn-add-transporter-inline").onclick = () => {
    const card = $("#transporter-form-card");
    showTransporterForm(card, null, (row) => {
      draft.transporterId = row.id; card.classList.add("hidden"); card.innerHTML = ""; renderEwayStep();
    });
  };
  $("#btn-eway-next").onclick = () => {
    if (draft.wantEway) {
      draft.transporterId = $("#eway-transporter").value || null;
      draft.vehicleNo = $("#eway-vehicle").value;
      draft.distance = Number($("#eway-distance").value) || 0;
      draft.transMode = $("#eway-mode").value || "1";
    }
    showScreen("bill-confirm");
  };
  $("#btn-generate").onclick = generateBill;
  $("#btn-dl-pdf").onclick = downloadPdf;
  $("#btn-share-pdf").onclick = sharePdf;
  $("#btn-dl-json").onclick = downloadJson;
  $all("#master-tabs .chip").forEach((chip) => {
    chip.onclick = () => { masterTab = chip.dataset.master; renderMasters(); };
  });

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => { navigator.serviceWorker.register("./sw.js").catch(() => {}); });
  }

  window.__gstBill = {
    seedDemo, validateGstin, amountInWords, resolveGstinDetails, offlineFromGstin, parsePortalText,
    getStore: () => store, setStore: (s) => { store = s; save(); },
    computeBill: () => computeBill(draft), getDraft: () => draft, setDraft: (d) => { draft = Object.assign(emptyDraft(), d); },
    buildEwayJson, buildPdf, showScreen, startBill, generateBill, getLastBill: () => lastBill,
    round2
  };

  renderHome();
})();
