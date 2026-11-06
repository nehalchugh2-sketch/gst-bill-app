/* GST Bill PWA — Phase 1 tap-only */
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

  function uid() { return "id_" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36); }

  function defaultStore() {
    return {
      seller: {
        gstin: "", legalName: "", tradeName: "", address: "", pin: "", stateCode: "", stateName: "",
        phone: "", bankName: "", bankAccount: "", bankIfsc: "",
        invoicePrefix: "INV/", nextNumber: 1
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
      return Object.assign(defaultStore(), JSON.parse(raw));
    } catch (e) {
      return defaultStore();
    }
  }

  function save() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  }

  let store = load();
  let draft = emptyDraft();
  let lastBill = null;
  let masterTab = "buyers";

  function emptyDraft() {
    return {
      buyerId: null,
      lines: [], // {itemId, name, hsn, gstRate, unit, qty, rate}
      wantEway: null,
      transporterId: null,
      vehicleNo: "",
      distance: 10,
      transMode: "1"
    };
  }

  /* ---------- GSTIN ---------- */
  const GSTIN_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
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
    g = g.toUpperCase().trim();
    if (!/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(g)) {
      return { ok: false, msg: "GSTIN format galat / invalid" };
    }
    const state = g.slice(0, 2);
    if (!STATES[state]) return { ok: false, msg: "State code invalid" };
    const cd = gstinCheckDigit(g.slice(0, 14));
    if (cd !== g[14]) return { ok: false, msg: "GSTIN checksum galat / invalid" };
    return { ok: true, gstin: g, stateCode: state, stateName: STATES[state] };
  }

  /* ---------- Amount in words (Indian) ---------- */
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
    let parts = [];
    if (crore) parts.push(chunk(crore) + " Crore");
    if (lakh) parts.push(chunk(lakh) + " Lakh");
    if (thousand) parts.push(chunk(thousand) + " Thousand");
    if (rest) parts.push(chunk(rest));
    let s = parts.join(" ") + " Rupees";
    if (paise) s += " and " + twoDigits(paise) + " Paise";
    return s + " Only";
  }

  function round2(n) { return Math.round((Number(n) + Number.EPSILON) * 100) / 100; }

  /* ---------- Tax compute ---------- */
  function computeBill(d) {
    const seller = store.seller;
    const buyer = store.buyers.find((b) => b.id === d.buyerId);
    if (!buyer) throw new Error("Buyer missing");
    const sellerState = seller.stateCode || (seller.gstin || "").slice(0, 2);
    const buyerState = buyer.stateCode || (buyer.gstin || "").slice(0, 2);
    const interState = sellerState && buyerState && sellerState !== buyerState;

    const lines = d.lines.map((ln) => {
      const taxable = round2(ln.qty * ln.rate);
      const rate = Number(ln.gstRate) || 0;
      let cgst = 0, sgst = 0, igst = 0;
      if (interState) igst = round2(taxable * rate / 100);
      else {
        cgst = round2(taxable * (rate / 2) / 100);
        sgst = round2(taxable * (rate / 2) / 100);
      }
      return Object.assign({}, ln, { taxable, cgst, sgst, igst, lineTotal: round2(taxable + cgst + sgst + igst) });
    });

    const taxable = round2(lines.reduce((s, l) => s + l.taxable, 0));
    const cgst = round2(lines.reduce((s, l) => s + l.cgst, 0));
    const sgst = round2(lines.reduce((s, l) => s + l.sgst, 0));
    const igst = round2(lines.reduce((s, l) => s + l.igst, 0));
    const grand = round2(taxable + cgst + sgst + igst);

    // HSN-wise
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
      lines, taxable, cgst, sgst, igst, grand,
      amountWords: amountInWords(grand),
      hsnSummary: Object.values(hsnMap)
    };
  }

  function formatDateDDMMYYYY(d) {
    const dt = d instanceof Date ? d : new Date(d);
    const dd = String(dt.getDate()).padStart(2, "0");
    const mm = String(dt.getMonth() + 1).padStart(2, "0");
    const yyyy = dt.getFullYear();
    return dd + "/" + mm + "/" + yyyy;
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

    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.text("TAX INVOICE", pageW / 2, y, { align: "center" });
    y += 6;
    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    doc.text("(Under Rule 46 of CGST Rules)", pageW / 2, y, { align: "center" });
    y += 8;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.text(bill.seller.tradeName || bill.seller.legalName || "Seller", 14, y);
    y += 5;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    const sellerLines = [
      bill.seller.legalName && bill.seller.legalName !== bill.seller.tradeName ? bill.seller.legalName : null,
      bill.seller.address,
      (bill.seller.stateName || "") + (bill.seller.pin ? " - " + bill.seller.pin : ""),
      "GSTIN: " + (bill.seller.gstin || ""),
      bill.seller.phone ? "Phone: " + bill.seller.phone : null
    ].filter(Boolean);
    sellerLines.forEach((t) => { doc.text(String(t), 14, y); y += 4; });

    doc.setFont("helvetica", "bold");
    doc.text("Invoice No: " + bill.invoiceNo, 120, 28);
    doc.setFont("helvetica", "normal");
    doc.text("Date: " + bill.invoiceDate, 120, 33);
    doc.text("Place of Supply: " + (bill.buyerState || "") + " (" + (STATES[bill.buyerState] || "") + ")", 120, 38);
    doc.text("Reverse Charge: No", 120, 43);

    y = Math.max(y, 50) + 2;
    doc.setDrawColor(200); doc.line(14, y, pageW - 14, y); y += 6;
    doc.setFont("helvetica", "bold");
    doc.text("Bill To / Consignee", 14, y); y += 5;
    doc.setFont("helvetica", "normal");
    doc.text(bill.buyer.name, 14, y); y += 4;
    if (bill.buyer.address) { doc.text(bill.buyer.address, 14, y); y += 4; }
    doc.text((bill.buyer.stateName || "") + (bill.buyer.pin ? " - " + bill.buyer.pin : ""), 14, y); y += 4;
    if (bill.buyer.gstin) { doc.text("GSTIN: " + bill.buyer.gstin, 14, y); y += 4; }

    y += 4;
    const body = bill.lines.map((l, i) => [
      String(i + 1),
      l.name,
      String(l.hsn),
      String(l.qty),
      l.unit || "PCS",
      l.rate.toFixed(2),
      l.taxable.toFixed(2),
      (bill.interState ? l.igst : l.cgst + l.sgst).toFixed(2),
      l.lineTotal.toFixed(2)
    ]);

    doc.autoTable({
      startY: y,
      head: [["#", "Description", "HSN", "Qty", "Unit", "Rate", "Taxable", "Tax", "Total"]],
      body,
      styles: { fontSize: 8, cellPadding: 1.5 },
      headStyles: { fillColor: [11, 95, 255] },
      margin: { left: 14, right: 14 }
    });

    y = doc.lastAutoTable.finalY + 6;
    const boxX = 120;
    doc.setFontSize(9);
    doc.text("Taxable Value:", boxX, y); doc.text(bill.taxable.toFixed(2), pageW - 14, y, { align: "right" }); y += 5;
    if (bill.interState) {
      doc.text("IGST:", boxX, y); doc.text(bill.igst.toFixed(2), pageW - 14, y, { align: "right" }); y += 5;
    } else {
      doc.text("CGST:", boxX, y); doc.text(bill.cgst.toFixed(2), pageW - 14, y, { align: "right" }); y += 5;
      doc.text("SGST:", boxX, y); doc.text(bill.sgst.toFixed(2), pageW - 14, y, { align: "right" }); y += 5;
    }
    doc.setFont("helvetica", "bold");
    doc.text("Grand Total:", boxX, y); doc.text("Rs. " + bill.grand.toFixed(2), pageW - 14, y, { align: "right" }); y += 8;
    doc.setFont("helvetica", "normal");
    const words = doc.splitTextToSize("Amount in words: " + bill.amountWords, pageW - 28);
    doc.text(words, 14, y); y += words.length * 4 + 6;

    if (bill.hsnSummary && bill.hsnSummary.length) {
      doc.setFont("helvetica", "bold");
      doc.text("HSN Summary", 14, y); y += 2;
      doc.autoTable({
        startY: y,
        head: [["HSN", "Taxable", "CGST", "SGST", "IGST"]],
        body: bill.hsnSummary.map((h) => [
          h.hsn, h.taxable.toFixed(2), h.cgst.toFixed(2), h.sgst.toFixed(2), h.igst.toFixed(2)
        ]),
        styles: { fontSize: 8 },
        headStyles: { fillColor: [80, 90, 110] },
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
    doc.setFontSize(8);
    doc.setTextColor(100);
    doc.text("Generated by GST Bill PWA · Taxpayer remains responsible for correctness", 14, 287);
    doc.setTextColor(0);

    return doc;
  }

  /* ---------- E-way JSON (NIC bulk style, version 1.0.0621) ---------- */
  function buildEwayJson(bill) {
    const s = bill.seller;
    const b = bill.buyer;
    const fromState = Number(bill.sellerState);
    const toState = Number(bill.buyerState);
    const itemList = bill.lines.map((l) => {
      const row = {
        productName: l.name,
        productDesc: l.name,
        hsnCode: Number(String(l.hsn).replace(/\D/g, "")) || 0,
        quantity: Number(l.qty),
        qtyUnit: (l.unit || "PCS").toUpperCase().slice(0, 3) === "PCS" ? "PCS" : (l.unit || "NOS").toUpperCase(),
        taxableAmount: l.taxable,
        sgstRate: bill.interState ? 0 : Number(l.gstRate) / 2,
        cgstRate: bill.interState ? 0 : Number(l.gstRate) / 2,
        igstRate: bill.interState ? Number(l.gstRate) : 0,
        cessRate: 0
      };
      // Normalize unit to NIC codes
      const u = (l.unit || "PCS").toUpperCase();
      if (["PCS", "NOS", "MTR", "KGS", "SET", "BAG", "BOX"].includes(u)) row.qtyUnit = u === "PCS" ? "PCS" : u;
      else row.qtyUnit = "NOS";
      return row;
    });

    const transporter = store.transporters.find((t) => t.id === bill.transporterId);
    const entry = {
      userGstin: s.gstin,
      supplyType: "O",
      subSupplyType: 1,
      subSupplyDesc: "",
      docType: "INV",
      docNo: bill.invoiceNo,
      docDate: bill.invoiceDate,
      fromGstin: s.gstin,
      fromTrdName: s.tradeName || s.legalName,
      fromAddr1: (s.address || "").slice(0, 120) || "Address",
      fromAddr2: "",
      fromPlace: (s.stateName || "Place").slice(0, 50),
      fromPincode: Number(s.pin) || 0,
      fromStateCode: fromState,
      actualFromStateCode: fromState,
      toGstin: b.gstin || "URP",
      toTrdName: b.name,
      toAddr1: (b.address || "").slice(0, 120) || "Address",
      toAddr2: "",
      toPlace: (b.stateName || "Place").slice(0, 50),
      toPincode: Number(b.pin) || 0,
      toStateCode: toState,
      actualToStateCode: toState,
      transactionType: 1,
      otherValue: 0,
      totalValue: bill.taxable,
      cgstValue: bill.cgst,
      sgstValue: bill.sgst,
      igstValue: bill.igst,
      cessValue: 0,
      cessNonAdvolValue: 0,
      totInvValue: bill.grand,
      transporterId: transporter && transporter.transporterId ? transporter.transporterId : "",
      transporterName: transporter ? transporter.name : "",
      transDocNo: "",
      transDocDate: "",
      transMode: String(bill.transMode || "1"),
      transDistance: String(bill.distance || "0"),
      vehicleNo: (bill.vehicleNo || "").replace(/\s+/g, "").toUpperCase(),
      vehicleType: "R",
      itemList
    };

    // If no vehicle and transporter ID present, Part A slip style: keep transporterId, blank vehicle
    if (!entry.vehicleNo && entry.transporterId) {
      entry.transMode = "";
      // NIC API note: for Part A with transporterId, vehicle blank — for bulk JSON keep road mode if vehicle present
    }

    return {
      version: "1.0.0621",
      billLists: [entry]
    };
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  function pdfBlob(doc) {
    return doc.output("blob");
  }

  /* ---------- UI helpers ---------- */
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
    if (name === "bill-eway") renderEwayStep();
    if (name === "bill-confirm") renderConfirm();
    if (name === "history") renderHistory();
  }

  function sellerReady() {
    return !!(store.seller.gstin && store.seller.legalName && store.seller.address && store.seller.pin);
  }

  function renderHome() {
    const card = $("#home-seller-card");
    if (!sellerReady()) {
      card.innerHTML = "<h2>Pehle Setup / First setup</h2><p class='hint'>Apna GSTIN aur shop details daalein.</p>" +
        "<button class='btn btn-primary btn-block' data-go='setup'>Open Setup</button>";
    } else {
      card.innerHTML = "<div class='pill ok'>Ready</div><h2 style='margin-top:8px'>" +
        escapeHtml(store.seller.tradeName || store.seller.legalName) +
        "</h2><p class='hint' style='margin:0'>GSTIN " + escapeHtml(store.seller.gstin) +
        " · Next invoice " + escapeHtml((store.seller.invoicePrefix || "INV/") + String(store.seller.nextNumber || 1).padStart(4, "0")) + "</p>";
    }
  }

  function escapeHtml(s) {
    return String(s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function renderSetup() {
    const s = store.seller;
    $("#setup-form").innerHTML = `
      <div class="field"><label>GSTIN *</label><input id="s-gstin" value="${escapeHtml(s.gstin)}" maxlength="15" placeholder="09AAAAA0000A1Z0" /></div>
      <div class="field"><label>Legal Name *</label><input id="s-legal" value="${escapeHtml(s.legalName)}" /></div>
      <div class="field"><label>Trade Name</label><input id="s-trade" value="${escapeHtml(s.tradeName)}" /></div>
      <div class="field"><label>Address *</label><textarea id="s-addr" rows="2">${escapeHtml(s.address)}</textarea></div>
      <div class="row">
        <div class="field"><label>PIN *</label><input id="s-pin" value="${escapeHtml(s.pin)}" maxlength="6" /></div>
        <div class="field"><label>State</label><input id="s-state" value="${escapeHtml((s.stateCode || "") + (s.stateName ? " - " + s.stateName : ""))}" readonly /></div>
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
      <p class="error" id="setup-err"></p>
    `;
    $("#s-gstin").addEventListener("input", () => {
      const v = validateGstin($("#s-gstin").value);
      if (v.ok) $("#s-state").value = v.stateCode + " - " + v.stateName;
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
    store.seller = {
      gstin: g.gstin,
      legalName: legal,
      tradeName: $("#s-trade").value.trim() || legal,
      address: addr,
      pin,
      stateCode: g.stateCode,
      stateName: g.stateName,
      phone: $("#s-phone").value.trim(),
      bankName: $("#s-bank").value.trim(),
      bankAccount: $("#s-ac").value.trim(),
      bankIfsc: $("#s-ifsc").value.trim().toUpperCase(),
      invoicePrefix: $("#s-prefix").value.trim() || "INV/",
      nextNumber: Math.max(1, Number($("#s-next").value) || 1)
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
          `<div class="list-item"><div class="avatar">${escapeHtml(b.name.slice(0,1))}</div><div class="meta"><strong>${escapeHtml(b.name)}</strong><span>${escapeHtml(b.gstin || "URP")} · ${escapeHtml(b.stateName || "")}</span></div></div>`
        ).join("") + "</div>" : "<p class='empty'>No buyers yet</p>") +
        "<button class='btn btn-secondary btn-block' id='m-add-buyer' style='margin-top:10px'>+ Add buyer</button><div id='m-buyer-form'></div>";
      $("#m-add-buyer").onclick = () => showBuyerForm($("#m-buyer-form"), null, () => { renderMasters(); });
    } else if (masterTab === "items") {
      panel.innerHTML = "<h2>Items</h2>" +
        (store.items.length ? "<div class='list'>" + store.items.map((it) =>
          `<div class="list-item"><div class="avatar">₹</div><div class="meta"><strong>${escapeHtml(it.name)}</strong><span>HSN ${escapeHtml(it.hsn)} · GST ${it.gstRate}% · ${escapeHtml(it.unit)}</span></div></div>`
        ).join("") + "</div>" : "<p class='empty'>No items yet</p>") +
        "<button class='btn btn-secondary btn-block' id='m-add-item' style='margin-top:10px'>+ Add item</button><div id='m-item-form'></div>";
      $("#m-add-item").onclick = () => showItemForm($("#m-item-form"), null, () => { renderMasters(); });
    } else {
      panel.innerHTML = "<h2>Transporters</h2>" +
        (store.transporters.length ? "<div class='list'>" + store.transporters.map((t) =>
          `<div class="list-item"><div class="avatar">🚚</div><div class="meta"><strong>${escapeHtml(t.name)}</strong><span>${escapeHtml(t.transporterId || "—")}</span></div></div>`
        ).join("") + "</div>" : "<p class='empty'>No transporters yet</p>") +
        "<button class='btn btn-secondary btn-block' id='m-add-tr' style='margin-top:10px'>+ Add transporter</button><div id='m-tr-form'></div>";
      $("#m-add-tr").onclick = () => showTransporterForm($("#m-tr-form"), null, () => { renderMasters(); });
    }
  }

  function showBuyerForm(container, existing, onSaved) {
    container.classList.remove("hidden");
    container.innerHTML = `
      <div class="field"><label>Name *</label><input id="bf-name" value="${escapeHtml(existing && existing.name || "")}" /></div>
      <div class="field"><label>GSTIN (blank = unregistered)</label><input id="bf-gstin" maxlength="15" value="${escapeHtml(existing && existing.gstin || "")}" /></div>
      <div class="field"><label>Address *</label><textarea id="bf-addr" rows="2">${escapeHtml(existing && existing.address || "")}</textarea></div>
      <div class="row">
        <div class="field"><label>PIN *</label><input id="bf-pin" maxlength="6" value="${escapeHtml(existing && existing.pin || "")}" /></div>
        <div class="field"><label>State</label><input id="bf-state" readonly value="${escapeHtml(existing ? ((existing.stateCode||"")+(existing.stateName?" - "+existing.stateName:"")) : "")}" /></div>
      </div>
      <p class="error" id="bf-err"></p>
      <button class="btn btn-primary btn-block" id="bf-save">Save buyer</button>
    `;
    $("#bf-gstin").addEventListener("input", () => {
      const v = validateGstin($("#bf-gstin").value);
      if (v.ok) $("#bf-state").value = v.stateCode + " - " + v.stateName;
    });
    $("#bf-save").onclick = () => {
      const name = $("#bf-name").value.trim();
      const addr = $("#bf-addr").value.trim();
      const pin = $("#bf-pin").value.trim();
      const gstinRaw = $("#bf-gstin").value.trim();
      if (!name || !addr || !/^\d{6}$/.test(pin)) {
        $("#bf-err").textContent = "Name, address, PIN required";
        return;
      }
      let stateCode = "", stateName = "", gstin = "";
      if (gstinRaw) {
        const v = validateGstin(gstinRaw);
        if (!v.ok) { $("#bf-err").textContent = v.msg; return; }
        gstin = v.gstin; stateCode = v.stateCode; stateName = v.stateName;
      } else {
        // fallback: use seller state for unregistered if same city assumption — ask via PIN heuristic: leave blank state as seller state
        stateCode = store.seller.stateCode || "09";
        stateName = STATES[stateCode] || "";
      }
      const row = { id: existing ? existing.id : uid(), name, gstin, address: addr, pin, stateCode, stateName };
      if (existing) {
        const i = store.buyers.findIndex((b) => b.id === existing.id);
        store.buyers[i] = row;
      } else store.buyers.push(row);
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
        <select id="if-unit">
          ${["PCS","NOS","MTR","SET","BAG","BOX"].map((u) => `<option ${((existing && existing.unit) || "PCS") === u ? "selected" : ""}>${u}</option>`).join("")}
        </select>
      </div>
      <p class="error" id="if-err"></p>
      <button class="btn btn-primary btn-block" id="if-save">Save item</button>
    `;
    $("#if-save").onclick = () => {
      const name = $("#if-name").value.trim();
      const hsn = $("#if-hsn").value.trim();
      const gstRate = Number($("#if-rate").value);
      const unit = $("#if-unit").value;
      if (!name || !hsn || !(gstRate >= 0)) { $("#if-err").textContent = "Name, HSN, rate required"; return; }
      const row = { id: existing ? existing.id : uid(), name, hsn, gstRate, unit };
      if (existing) {
        const i = store.items.findIndex((x) => x.id === existing.id);
        store.items[i] = row;
      } else store.items.push(row);
      save();
      if (onSaved) onSaved(row);
    };
  }

  function showTransporterForm(container, existing, onSaved) {
    container.classList.remove("hidden");
    container.innerHTML = `
      <div class="field"><label>Name *</label><input id="tf-name" value="${escapeHtml(existing && existing.name || "")}" /></div>
      <div class="field"><label>Transporter ID (GSTIN / enrolment)</label><input id="tf-id" value="${escapeHtml(existing && existing.transporterId || "")}" /></div>
      <p class="error" id="tf-err"></p>
      <button class="btn btn-primary btn-block" id="tf-save">Save transporter</button>
    `;
    $("#tf-save").onclick = () => {
      const name = $("#tf-name").value.trim();
      if (!name) { $("#tf-err").textContent = "Name required"; return; }
      const row = { id: existing ? existing.id : uid(), name, transporterId: $("#tf-id").value.trim().toUpperCase() };
      if (existing) {
        const i = store.transporters.findIndex((t) => t.id === existing.id);
        store.transporters[i] = row;
      } else store.transporters.push(row);
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
        <div class="avatar">${escapeHtml(b.name.slice(0,1))}</div>
        <div class="meta"><strong>${escapeHtml(b.name)}</strong><span>${escapeHtml(b.gstin || "Unregistered")} · ${escapeHtml(b.pin || "")}</span></div>
      </button>`).join("") : "<p class='empty'>No buyers — add new</p>";
    $all("#buyer-list [data-buyer]").forEach((btn) => {
      btn.onclick = () => {
        draft.buyerId = btn.dataset.buyer;
        $("#btn-buyer-next").disabled = false;
        renderBuyerStep();
      };
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
      card.querySelector(".q-qty").oninput = (e) => { draft.lines[i].qty = Number(e.target.value) || 0; paintQtyTotals(); };
      card.querySelector(".q-rate").oninput = (e) => { draft.lines[i].rate = Number(e.target.value) || 0; paintQtyTotals(); };
    });
    paintQtyTotals();
  }

  function paintQtyTotals() {
    try {
      const c = computeBill(draft);
      $("#qty-totals").innerHTML = `
        <div class="line"><span>Taxable</span><span>₹ ${c.taxable.toFixed(2)}</span></div>
        ${c.interState
          ? `<div class="line"><span>IGST</span><span>₹ ${c.igst.toFixed(2)}</span></div>`
          : `<div class="line"><span>CGST</span><span>₹ ${c.cgst.toFixed(2)}</span></div>
             <div class="line"><span>SGST</span><span>₹ ${c.sgst.toFixed(2)}</span></div>`}
        <div class="line grand"><span>Total</span><span>₹ ${c.grand.toFixed(2)}</span></div>`;
    } catch (e) {
      $("#qty-totals").innerHTML = "";
    }
  }

  function renderEwayStep() {
    let grand = 0;
    try { grand = computeBill(draft).grand; } catch (e) {}
    const over = grand > 50000;
    const note = $("#eway-note");
    if (over) {
      note.innerHTML = `<span class="pill warn">₹${grand.toFixed(0)} &gt; 50,000 — E-way bill zaroori (Rule 138)</span><br/>Default YES. Aap change kar sakte ho sirf agar exemption lage.`;
      if (draft.wantEway === null) draft.wantEway = true;
    } else {
      note.innerHTML = `<span class="pill">₹${grand.toFixed(0)} ≤ 50,000</span><br/>E-way bill optional — aapki marzi (Yes / No).`;
      if (draft.wantEway === null) draft.wantEway = false;
    }
    $("#eway-yes").classList.toggle("selected", draft.wantEway === true);
    $("#eway-no").classList.toggle("selected", draft.wantEway === false);
    const details = $("#eway-details");
    details.classList.toggle("hidden", draft.wantEway !== true);
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
      <dt>Items</dt><dd>${c.lines.map((l) => escapeHtml(l.name) + " × " + l.qty + " @ ₹" + l.rate).join("<br/>")}</dd>
      <dt>Tax</dt><dd>${c.interState ? "IGST (inter-state)" : "CGST + SGST (intra-state UP)"}</dd>
      <dt>E-Way</dt><dd>${draft.wantEway ? ("YES · " + escapeHtml(tr ? tr.name : "No transporter") + " · " + escapeHtml(draft.vehicleNo || "vehicle later") + " · " + draft.distance + " km") : "NO"}</dd>
      <dt>Amount in words</dt><dd>${escapeHtml(c.amountWords)}</dd>`;
    $("#confirm-totals").innerHTML = `
      <div class="line"><span>Taxable</span><span>₹ ${c.taxable.toFixed(2)}</span></div>
      ${c.interState
        ? `<div class="line"><span>IGST</span><span>₹ ${c.igst.toFixed(2)}</span></div>`
        : `<div class="line"><span>CGST</span><span>₹ ${c.cgst.toFixed(2)}</span></div>
           <div class="line"><span>SGST</span><span>₹ ${c.sgst.toFixed(2)}</span></div>`}
      <div class="line grand"><span>Grand Total</span><span>₹ ${c.grand.toFixed(2)}</span></div>`;
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
    const pdfB = pdfBlob(doc);
    let ewayJson = null;
    if (bill.wantEway) ewayJson = buildEwayJson(bill);

    // persist without heavy blobs — regenerate on demand from stored fields
    store.seller.nextNumber = inv.next;
    store.bills.unshift({
      id: bill.id,
      invoiceNo: bill.invoiceNo,
      invoiceDate: bill.invoiceDate,
      buyerName: bill.buyer.name,
      grand: bill.grand,
      wantEway: bill.wantEway,
      snapshot: bill
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
      try {
        await navigator.share({ files: [file], title: "Tax Invoice " + lastBill.bill.invoiceNo, text: "GST Tax Invoice " + lastBill.bill.invoiceNo });
        return;
      } catch (e) { /* user cancelled or fail */ }
    }
    // fallback download
    downloadPdf();
    alert("Share not available here — PDF downloaded. WhatsApp pe attach karein.");
  }

  function downloadJson() {
    if (!lastBill || !lastBill.ewayJson) return;
    const blob = new Blob([JSON.stringify(lastBill.ewayJson, null, 2)], { type: "application/json" });
    downloadBlob(blob, "EWB_" + lastBill.bill.invoiceNo.replace(/\//g, "-") + ".json");
  }

  function renderHistory() {
    const el = $("#history-list");
    if (!store.bills.length) {
      el.innerHTML = "<p class='empty'>No bills yet</p>";
      return;
    }
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
        const doc = buildPdf(row.snapshot);
        doc.save(row.invoiceNo.replace(/\//g, "-") + ".pdf");
      };
    });
    $all("[data-redl-json]").forEach((btn) => {
      btn.onclick = () => {
        const row = store.bills.find((x) => x.id === btn.dataset.redlJson);
        if (!row) return;
        const json = buildEwayJson(row.snapshot);
        downloadBlob(new Blob([JSON.stringify(json, null, 2)], { type: "application/json" }), "EWB_" + row.invoiceNo.replace(/\//g, "-") + ".json");
      };
    });
  }

  /* ---------- Seed demo data helper (for tests / first run empty) ---------- */
  function seedDemoIfEmpty() {
    // only used by automated test via window.__gstBill.seedDemo()
  }

  function seedDemo() {
    store.seller = {
      gstin: "09AAAAA0000A1Z0",
      legalName: "Demo Textiles Private Limited",
      tradeName: "Shree Silk House",
      address: "Chowk, Varanasi, Uttar Pradesh",
      pin: "221001",
      stateCode: "09",
      stateName: "UP",
      phone: "9999999999",
      bankName: "Demo Bank",
      bankAccount: "1234567890",
      bankIfsc: "DEMO0001234",
      invoicePrefix: "INV/",
      nextNumber: 1
    };
    store.buyers = [{
      id: "buyer_jk",
      name: "Jyoti Krishna Saree Centre",
      gstin: "09BBBBB0000B1ZR",
      address: "Lanka, Varanasi, Uttar Pradesh",
      pin: "221005",
      stateCode: "09",
      stateName: "UP"
    }];
    store.items = [{
      id: "item_saree",
      name: "Saree",
      hsn: "5407",
      gstRate: 5,
      unit: "PCS"
    }];
    store.transporters = [{
      id: "tr_shree",
      name: "Shree Hari Transport",
      transporterId: "09CCCCC1111C1ZC"
    }];
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
      draft.buyerId = row.id;
      card.classList.add("hidden");
      card.innerHTML = "";
      renderBuyerStep();
    });
  };
  $("#btn-buyer-next").onclick = () => showScreen("bill-items");
  $("#buyer-search").oninput = () => renderBuyerStep();

  $("#btn-add-item").onclick = () => {
    const card = $("#item-form-card");
    showItemForm(card, null, () => {
      card.classList.add("hidden");
      card.innerHTML = "";
      renderItemsStep();
    });
  };
  $("#btn-items-next").onclick = () => showScreen("bill-qty");
  $("#item-search").oninput = () => renderItemsStep();

  $("#btn-qty-next").onclick = () => {
    if (draft.lines.some((l) => !(l.qty > 0) || !(l.rate >= 0) || l.rate === 0)) {
      alert("Har item ki qty aur rate daalein");
      return;
    }
    draft.wantEway = null;
    showScreen("bill-eway");
  };

  $("#eway-yes").onclick = () => { draft.wantEway = true; renderEwayStep(); };
  $("#eway-no").onclick = () => { draft.wantEway = false; renderEwayStep(); };
  $("#eway-transporter").onchange = (e) => { draft.transporterId = e.target.value || null; };
  $("#eway-vehicle").oninput = (e) => { draft.vehicleNo = e.target.value; };
  $("#eway-distance").oninput = (e) => { draft.distance = Number(e.target.value) || 0; };
  $("#btn-add-transporter-inline").onclick = () => {
    const card = $("#transporter-form-card");
    showTransporterForm(card, null, (row) => {
      draft.transporterId = row.id;
      card.classList.add("hidden");
      card.innerHTML = "";
      renderEwayStep();
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
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./sw.js").catch(() => {});
    });
  }

  // Expose for Playwright tests
  window.__gstBill = {
    seedDemo,
    validateGstin,
    amountInWords,
    getStore: () => store,
    setStore: (s) => { store = s; save(); },
    computeBill: () => computeBill(draft),
    getDraft: () => draft,
    setDraft: (d) => { draft = d; },
    buildEwayJson,
    buildPdf,
    showScreen,
    startBill,
    generateBill,
    getLastBill: () => lastBill
  };

  renderHome();
})();
