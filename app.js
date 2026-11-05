/* 연세춘추 지면 아카이브 뷰어 — 연도별 저장소 공용 코드
 * data/meta.js     → window.CC_META  {year,title,issues:[{i,pages:[{p,r}]}]}
 * data/articles.js → window.CC_ARTS  [{id,i,p,s,t,a,m,b:[[x0,y0,x1,y1]],x}]
 * img/{호}/p{면}.jpg  면 이미지
 */
(() => {
  "use strict";
  // 열람 키워드 SHA-256 (기본 "3893"). 정적 사이트라 실제 보안 장치는 아니며 가벼운 차단용이다.
  const KEY_HASH = "678f2f24525785e9460d8f8599e6006f0187765f6285842f4e8ff74f772ea803";
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const MATCH = { 1: "제목 일치", 2: "제목 유사", 3: "위치 추정·확인 필요", 4: "면 전체 텍스트", 5: "제목 미인식·남은 영역 추정", 6: "도서관 목록 외 기사(자동 추출)", 0: "영역 미검출" };
  const store = {
    get(k) { try { return sessionStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { sessionStorage.setItem(k, v); } catch {} },
  };

  let META, ARTS, byPage = new Map(), issIdx = new Map();
  const st = { iss: null, page: 1, sel: null, zoom: 1, boxes: true, results: [], terms: [], edit: false, rsel: -1, draw: false };
  let EDITS = {};
  const lstore = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); return true; } catch { return false; } },
  };

  /* ---------- 잠금 ---------- */
  async function sha256(s) {
    if (window.crypto && crypto.subtle) {
      const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
      return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
    }
    return s === "3893" ? KEY_HASH : "x"; // 아주 오래된 브라우저 대비
  }
  function loadScript(src) {
    return new Promise((ok, no) => { const s = document.createElement("script"); s.src = src; s.onload = ok; s.onerror = () => no(new Error(src)); document.head.appendChild(s); });
  }
  async function unlock() {
    $("#gateMsg").textContent = "자료를 불러오는 중…";
    try {
      if (!window.CC_ARTS) await loadScript("data/articles.js");
    } catch (e) { $("#gateMsg").textContent = "자료를 불러오지 못했습니다."; return; }
    store.set("cc_ok", "1");
    $("#gate").hidden = true; $("#app").hidden = false;
    init();
  }
  $("#gateForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const v = $("#gateKey").value.trim();
    if ((await sha256(v)) === KEY_HASH) unlock();
    else {
      $("#gateMsg").textContent = "키워드가 맞지 않습니다.";
      const c = $(".gate-card"); c.classList.remove("shake"); void c.offsetWidth; c.classList.add("shake");
      $("#gateKey").select();
    }
  });

  /* ---------- 초기화 ---------- */
  function boot() {
    META = window.CC_META;
    document.title = `${META.title} · 지면 아카이브`;
    $$("[data-bind=title]").forEach((el) => (el.textContent = META.title));
    $$("[data-bind=yearOnly]").forEach((el) => (el.textContent = window.CC_YEARS ? "" : String(META.year)));
    $$("[data-bind=subtitle]").forEach((el) => (el.textContent = `${META.issues[0].i}호 – ${META.issues.at(-1).i}호 · ${META.issues.reduce((n, x) => n + x.pages.length, 0)}면`));
    if (/(^|[#&])u=1(&|$)/.test(location.hash)) store.set("cc_ok", "1");  // 통합 첫 화면에서 넘어온 경우
    if (store.get("cc_ok") === "1") unlock(); else $("#gateKey").focus();
    // 통합 사이트 안에 있으면(../years.js) 연도 전환 메뉴와 '전체' 링크를 보여 준다
    if (window.CC_YEARS) {
      const ys = $("#yearSel");
      ys.innerHTML = CC_YEARS.map((y) => `<option value="${y.year}"${y.year === META.year ? " selected" : ""}>${y.year}</option>`).join("");
      ys.onchange = () => { location.href = (window.CC_YEARURL ? CC_YEARURL.replace("{y}", ys.value) : `../${ys.value}/`) + "index.html#u=1"; };
      if (window.CC_HUBURL) $("#hubLink").href = CC_HUBURL + "index.html#u=1";
      $("#hubLink").hidden = false; ys.hidden = false;
    }
  }

  function init() {
    ARTS = window.CC_ARTS;
    META.issues.forEach((x, k) => issIdx.set(x.i, k));
    for (const a of ARTS) {
      const key = a.i + "-" + a.p;
      if (!byPage.has(key)) byPage.set(key, []);
      byPage.get(key).push(a);
      a._ob = a.b; a._ox = a.x;
    }
    try { EDITS = JSON.parse(lstore.get(ekey()) || "{}") || {}; } catch { EDITS = {}; }
    ARTS.forEach(applyEdit);
    initEdit();
    const sel = $("#issSel");
    sel.innerHTML = META.issues.map((x) => `<option value="${x.i}">제${x.i}호</option>`).join("");
    sel.addEventListener("change", () => go({ iss: sel.value, page: 1 }));
    $("#prevIss").onclick = () => stepIssue(-1);
    $("#nextIss").onclick = () => stepIssue(1);
    $("#zoomIn").onclick = () => setZoom(st.zoom + 0.25);
    $("#zoomOut").onclick = () => setZoom(st.zoom - 0.25);
    $("#boxToggle").addEventListener("change", (e) => { st.boxes = e.target.checked; $("#overlay").classList.toggle("off", !st.boxes); });
    $("#searchForm").addEventListener("submit", (e) => { e.preventDefault(); search($("#q").value); });
    $$(".tab").forEach((t) => (t.onclick = () => showTab(t.dataset.tab)));
    $("#sideBtn").onclick = () => $("#side").classList.toggle("open");
    $$("[data-close]").forEach((el) => (el.onclick = closeDetail));
    $("#dPrev").onclick = () => stepArticle(-1);
    $("#dNext").onclick = () => stepArticle(1);
    $("#cropBoxes").onchange = () => st.sel != null && drawCrop(ARTS[st.sel]);
    $("#cropBox").addEventListener("click", () => $("#cropBox").classList.toggle("zoom"));
    document.addEventListener("keydown", onKey);
    window.addEventListener("hashchange", fromHash);
    $("#pageImg").addEventListener("load", () => { $("#sheetLoading").hidden = true; });
    fromHash(true);
  }

  /* ---------- 라우팅: #i=1308&p=1&a=12 ---------- */
  function fromHash(first) {
    const h = new URLSearchParams(location.hash.slice(1));
    h.delete("u");
    const a = h.get("a") != null ? ARTS[+h.get("a")] : null;
    const iss = a ? a.i : h.get("i") || st.iss || META.issues[0].i;
    const page = a ? a.p : +(h.get("p") || 1);
    if (h.get("q") && first === true) { $("#q").value = h.get("q"); search(h.get("q"), true); }
    else if (first === true) { search("", true); showTab("page"); }
    render(iss, page, a ? a.id : null);
    if (a) openDetail(a.id, true); else closeDetail(true);
  }
  function go({ iss = st.iss, page = st.page, art = null }) {
    const h = new URLSearchParams();
    if (art != null) h.set("a", art); else { h.set("i", iss); h.set("p", page); }
    if (st.terms.length) h.set("q", $("#q").value.trim());
    const next = "#" + h.toString();
    if (location.hash === next) fromHash(); else location.hash = next;
  }

  /* ---------- 면 그리기 ---------- */
  function render(iss, page, selId) {
    const issue = META.issues[issIdx.get(iss)] || META.issues[0];
    iss = issue.i;
    if (!issue.pages.some((x) => x.p === page)) page = issue.pages[0].p;
    const changed = st.iss !== iss || st.page !== page;
    st.iss = iss; st.page = page;
    $("#issSel").value = iss;
    $("#prevIss").disabled = issIdx.get(iss) === 0;
    $("#nextIss").disabled = issIdx.get(iss) === META.issues.length - 1;
    $("#pageBtns").innerHTML = issue.pages.map((x) => `<button class="pg${x.p === page ? " is-on" : ""}" data-p="${x.p}" title="${x.p}면">${x.p}</button>`).join("");
    $$("#pageBtns .pg").forEach((b) => (b.onclick = () => go({ page: +b.dataset.p })));
    const pinfo = issue.pages.find((x) => x.p === page);
    if (changed) {
      const img = $("#pageImg");
      $("#sheetLoading").hidden = false;
      img.src = `${window.CC_IMG_BASE || "img/"}${iss}/p${String(page).padStart(2, "0")}.jpg`;
      img.alt = `연세춘추 제${iss}호 ${page}면`;
      $("#sheet").style.aspectRatio = `1 / ${pinfo.r}`;
    }
    if (st.edit && selId == null && st.sel != null && ARTS[st.sel].i === iss && ARTS[st.sel].p === page) selId = st.sel;
    st.sel = selId;
    drawOverlay(pinfo.r);
    drawPageList();
    if (st.edit) refreshEdit();
    if (selId != null && changed) requestAnimationFrame(() => scrollToArt(selId));
  }

  function drawOverlay(r) {
    const svg = $("#overlay");
    const H = 1000 * r;
    svg.setAttribute("viewBox", `0 0 1000 ${H}`);
    const arts = byPage.get(st.iss + "-" + st.page) || [];
    let k = 0;
    svg.innerHTML = arts.filter((a) => a.b.length).map((a) => {
      k++;
      const on = a.id === st.sel, ed = st.edit && on;
      const rects = a.b.map(([x0, y0, x1, y1], j) => {
        const r = `<rect data-k="${j}" class="${ed && j === st.rsel ? "rsel" : ""}" x="${x0 * 1000}" y="${y0 * H}" width="${(x1 - x0) * 1000}" height="${(y1 - y0) * H}" rx="2"/>`;
        if (!ed || j !== st.rsel) return r;  // 모서리 손잡이는 고른 영역에만
        const hs = [[x0, y0, "nw"], [x1, y0, "ne"], [x0, y1, "sw"], [x1, y1, "se"]].map(([hx, hy, c]) => `<circle class="hdl" data-k="${j}" data-h="${c}" cx="${hx * 1000}" cy="${hy * H}" r="9"/>`).join("");
        return r + hs;
      }).join("");
      const [tx, ty] = a.b[0];
      return `<g data-id="${a.id}" class="${on ? "is-on" : ""}${ed ? " is-edit" : ""}${a.m === 6 ? " auto" : ""}"><title>${esc(a.t)}</title>${rects}<text class="tag" x="${tx * 1000 + 6}" y="${ty * H + 24}">${k}</text></g>`;
    }).join("");
    svg.classList.toggle("off", !st.boxes && !st.edit);
    svg.classList.toggle("drawing", st.edit && st.draw);
    $$("g", svg).forEach((g) => (g.onclick = (e) => { if (st.edit) return; go({ art: +g.dataset.id }); }));
  }

  function drawPageList() {
    const arts = byPage.get(st.iss + "-" + st.page) || [];
    let k = 0;
    $("#pageList").innerHTML = arts.length ? arts.map((a) => {
      const n = a.b.length ? ++k : null;
      return `<button class="item${a.id === st.sel ? " is-on" : ""}" data-id="${a.id}">
        <div class="item-meta">${n ? `<b>${n}</b>` : `<span class="nobox">영역 없음</span>`}${a.a ? `<span>${esc(a.a)}</span>` : ""}${a.m === 6 ? `<span class="auto" title="도서관 기사 목록에 없어 지면에서 자동으로 찾은 기사">자동</span>` : ""}${a.edited ? `<span class="edited">교정됨</span>` : ""}</div>
        <div class="item-title">${esc(a.t)}</div></button>`;
    }).join("") : `<div class="empty">이 면에는 목록에 오른 기사가 없습니다.</div>`;
    $$("#pageList .item").forEach((b) => (b.onclick = () => { $("#side").classList.remove("open"); if (st.edit) selectEdit(+b.dataset.id); else go({ art: +b.dataset.id }); }));
    $$("#resList .item").forEach((b) => b.classList.toggle("is-on", +b.dataset.id === st.sel));
  }

  function scrollToArt(id) {
    const a = ARTS[id]; if (!a || !a.b.length) return;
    const wrap = $("#sheetWrap"), sheet = $("#sheet");
    const y = Math.min(...a.b.map((b) => b[1])) * sheet.offsetHeight;
    wrap.scrollTo({ top: Math.max(0, sheet.offsetTop + y - 80), behavior: "smooth" });
  }

  function setZoom(z) {
    st.zoom = Math.max(1, Math.min(3, z));
    $("#sheet").style.maxWidth = 980 * st.zoom + "px";
    $("#sheet").style.width = st.zoom > 1 ? 980 * st.zoom + "px" : "100%";
    $("#zoomVal").textContent = Math.round(st.zoom * 100) + "%";
  }
  function stepIssue(d) {
    const k = issIdx.get(st.iss) + d;
    if (k >= 0 && k < META.issues.length) go({ iss: META.issues[k].i, page: 1 });
  }

  /* ---------- 검색 ---------- */
  function norm(s) { return String(s).toLowerCase().replace(/\s+/g, ""); }
  function search(q, silent) {
    q = q.trim();
    // 검토용 필터: #자동(도서관 목록 외 자동 추출), #확인(위치 추정·남은 영역·영역 없음)
    const flt = { "#자동": (a) => a.m === 6, "#확인": (a) => a.m === 3 || a.m === 5 || !a.b.length };
    const fs = q.split(/\s+/).filter((t) => flt[t]);
    st.terms = q.split(/\s+/).filter((t) => t && !flt[t]);
    const ts = st.terms.map(norm);
    st.results = ts.length || fs.length ? ARTS.filter((a) => ts.every((t) => a._h.includes(t)) && fs.every((f) => flt[f](a))) : [];
    // 제목에 들어 있으면 위로
    st.results.sort((x, y) => (ts.every((t) => norm(y.t).includes(t)) - ts.every((t) => norm(x.t).includes(t))) || x.id - y.id);
    $("#resCount").textContent = ts.length || fs.length ? st.results.length : "";
    const list = $("#resList");
    const nAuto = ARTS.filter(flt["#자동"]).length, nChk = ARTS.filter(flt["#확인"]).length;
    if (!ts.length && !fs.length) list.innerHTML = `<div class="empty">검색어를 입력하세요.<div class="review">
        <button class="btn btn-ghost" type="button" data-q="#자동">자동 추출 기사 ${nAuto}건 보기</button>
        <button class="btn btn-ghost" type="button" data-q="#확인">확인 필요 기사 ${nChk}건 보기</button></div></div>`;
    else if (!st.results.length) list.innerHTML = `<div class="empty">‘${esc(q)}’에 맞는 기사가 없습니다.</div>`;
    else list.innerHTML = st.results.slice(0, 500).map((a) => `<button class="item" data-id="${a.id}">
        <div class="item-meta"><span>제${a.i}호 ${a.p}면</span>${a.a ? `<span>· ${esc(a.a)}</span>` : ""}${a.m === 6 ? `<span class="auto">자동</span>` : ""}${a.b.length ? "" : `<span class="nobox">영역 없음</span>`}</div>
        <div class="item-title">${hl(a.t)}</div><div class="item-snip">${snippet(a.x)}</div></button>`).join("")
        + (st.results.length > 500 ? `<div class="empty">앞 500건만 표시합니다. 검색어를 더 구체적으로 입력해 보세요.</div>` : "");
    $$("#resList .item").forEach((b) => (b.onclick = () => { $("#side").classList.remove("open"); go({ art: +b.dataset.id }); }));
    $$("#resList [data-q]").forEach((b) => (b.onclick = () => { $("#q").value = b.dataset.q; search(b.dataset.q); }));
    showTab("results");
    if (!silent) $("#side").classList.add("open");
  }
  function termRe() {
    if (!st.terms.length) return null;
    const parts = st.terms.map((t) => [...t].map((c) => c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s*"));
    return new RegExp(parts.join("|"), "gi");
  }
  function hl(s) {
    const re = termRe(); s = esc(s);
    return re ? s.replace(new RegExp(re.source.replace(/&/g, "&amp;"), "gi"), (m) => `<mark>${m}</mark>`) : s;
  }
  function snippet(x) {
    const re = termRe(); if (!x) return "";
    let i = 0; if (re) { const m = re.exec(x); if (m) i = Math.max(0, m.index - 40); }
    return (i ? "…" : "") + hl(x.slice(i, i + 140).replace(/\n/g, " ")) + "…";
  }
  function showTab(t) {
    $$(".tab").forEach((b) => b.classList.toggle("is-on", b.dataset.tab === t));
    $$("[data-pane]").forEach((p) => (p.hidden = p.dataset.pane !== t));
  }

  /* ---------- 기사 상세 ---------- */
  function openDetail(id) {
    const a = ARTS[id]; st.sel = id;
    $("#detail").hidden = false;
    $("#dMeta").textContent = `${META.title} · 제${a.i}호 ${a.p}면`;
    $("#dTitle").textContent = a.t;
    $("#dAuthor").textContent = a.a ? `글 ${a.a}` : "";
    const b = $("#dBadge"); b.className = "badge m" + a.m; b.textContent = MATCH[a.m] || "";
    const paras = (a.x || "").split(/\n+/).filter(Boolean);
    $("#dText").innerHTML = paras.length ? paras.map((p) => `<p>${hl(p)}</p>`).join("") : `<p class="empty">이 기사는 본문을 자동으로 찾지 못했습니다. 지면 원문을 참고하세요.</p>`;
    $("#dText").scrollTop = 0;
    $("#dText").hidden = false; $("#dEditBox").hidden = true;
    $("#cropBox").classList.remove("zoom");
    const list = byPage.get(a.i + "-" + a.p); const k = list.indexOf(a);
    $("#dPrev").disabled = k <= 0; $("#dNext").disabled = k >= list.length - 1;
    const img = $("#pageImg");
    if (img.complete && img.naturalWidth && img.src.includes(`/${a.i}/p${String(a.p).padStart(2, "0")}`)) drawCrop(a);
    else img.addEventListener("load", () => st.sel === id && drawCrop(a), { once: true });
    $$("#overlay g").forEach((g) => g.classList.toggle("is-on", +g.dataset.id === id));
    $$(".item").forEach((el) => el.classList.toggle("is-on", +el.dataset.id === id));
  }
  function closeDetail(silent) {
    if ($("#detail").hidden) return;
    $("#detail").hidden = true;
    if (silent !== true) go({ iss: st.iss, page: st.page });
  }
  function stepArticle(d) {
    const a = ARTS[st.sel]; const list = byPage.get(a.i + "-" + a.p);
    const n = list[list.indexOf(a) + d]; if (n) go({ art: n.id });
  }
  function drawCrop(a) {
    const img = $("#pageImg"), cv = $("#crop"), ctx = cv.getContext("2d");
    const W = img.naturalWidth, H = img.naturalHeight;
    let x0 = 0, y0 = 0, x1 = 1, y1 = 1;
    if (a.b.length) {
      x0 = Math.min(...a.b.map((b) => b[0])); y0 = Math.min(...a.b.map((b) => b[1]));
      x1 = Math.max(...a.b.map((b) => b[2])); y1 = Math.max(...a.b.map((b) => b[3]));
      const px = 0.012, py = 0.008;
      x0 = Math.max(0, x0 - px); y0 = Math.max(0, y0 - py); x1 = Math.min(1, x1 + px); y1 = Math.min(1, y1 + py);
    }
    const sx = x0 * W, sy = y0 * H, sw = (x1 - x0) * W, sh = (y1 - y0) * H;
    cv.width = Math.round(sw); cv.height = Math.round(sh);
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, cv.width, cv.height);
    if (a.b.length && $("#cropBoxes").checked) {
      ctx.strokeStyle = "rgba(200,64,42,.9)"; ctx.lineWidth = Math.max(2, cv.width / 400); ctx.setLineDash([8, 5]);
      a.b.forEach(([bx0, by0, bx1, by1]) => ctx.strokeRect(bx0 * W - sx, by0 * H - sy, (bx1 - bx0) * W, (by1 - by0) * H));
    }
    $("#cropNote").textContent = a.b.length ? "이미지를 누르면 원래 크기로 확대됩니다." : "기사 영역을 찾지 못해 면 전체를 보여줍니다.";
  }

  function onKey(e) {
    if (e.target.matches("input,select,textarea")) return;
    if (!$("#detail").hidden) {
      if (e.key === "Escape") closeDetail();
      else if (e.key === "ArrowLeft") stepArticle(-1);
      else if (e.key === "ArrowRight") stepArticle(1);
    } else if (e.key === "/") { e.preventDefault(); $("#q").focus(); }
  }

  /* ---------- 교정 ---------- */
  function ekey() { return "cc_edits_" + META.year; }
  function akey(a) { return `${a.i}-${a.p}-${a.s}-${norm(a.t).slice(0, 12)}`; }
  function applyEdit(a) {
    const e = EDITS[akey(a)];
    a.b = e && e.b ? e.b : a._ob;
    a.x = e && e.x != null ? e.x : a._ox;
    a.edited = !!e;
    a._h = norm(a.t + " " + a.a + " " + a.x);
  }
  function saveEdit(a, patch) {
    const k = akey(a);
    const e = Object.assign({}, EDITS[k] || {}, patch, { i: a.i, p: a.p, s: a.s, t: a.t });
    if (e.b && JSON.stringify(e.b) === JSON.stringify(a._ob)) delete e.b;
    if (e.x != null && e.x === a._ox) delete e.x;
    if (e.b || e.x != null) EDITS[k] = e; else delete EDITS[k];
    persist(); applyEdit(a); refreshEdit();
  }
  function persist() {
    const ok = lstore.set(ekey(), JSON.stringify(EDITS));
    $("#ebCount").textContent = `교정 ${Object.keys(EDITS).length}건` + (ok ? "" : " · 브라우저 저장 불가(내보내기 필요)");
  }
  function refreshEdit() {
    const pinfo = META.issues[issIdx.get(st.iss)].pages.find((x) => x.p === st.page);
    drawOverlay(pinfo.r); drawPageList();
    const a = st.sel != null ? ARTS[st.sel] : null;
    $("#ebTitle").textContent = a ? `${a.t}${a.b.length ? "" : " (영역 없음 — ‘영역 그리기’로 추가)"}` : "목록이나 면에서 기사를 고르세요";
    $("#ebDel").disabled = !a || st.rsel < 0; $("#ebDraw").disabled = !a; $("#ebText").disabled = !a; $("#ebReset").disabled = !a || !a.edited;
    $("#ebDraw").classList.toggle("is-on", st.draw);
  }
  function selectEdit(id) {
    const a = ARTS[id];
    if (a.i !== st.iss || a.p !== st.page) { go({ iss: a.i, page: a.p }); }
    st.sel = id; st.rsel = a.b.length ? 0 : -1; st.draw = !a.b.length;
    refreshEdit();
  }
  function setEdit(on) {
    st.edit = on; st.draw = false; st.rsel = -1;
    document.body.classList.toggle("editing", on);
    $("#editBtn").setAttribute("aria-pressed", String(on)); $("#editBtn").classList.toggle("is-on", on);
    $("#editBar").hidden = !on;
    if (on) closeDetail(true);
    persist(); refreshEdit();
  }
  function initEdit() {
    $("#editBtn").onclick = () => setEdit(!st.edit);
    $("#ebDraw").onclick = () => { st.draw = !st.draw; refreshEdit(); };
    $("#ebDel").onclick = () => {
      const a = ARTS[st.sel]; if (!a || st.rsel < 0) return;
      const b = a.b.slice(); b.splice(st.rsel, 1); st.rsel = b.length ? 0 : -1; saveEdit(a, { b });
    };
    $("#ebReset").onclick = () => { const a = ARTS[st.sel]; if (!a) return; delete EDITS[akey(a)]; persist(); applyEdit(a); st.rsel = a.b.length ? 0 : -1; refreshEdit(); };
    $("#ebText").onclick = () => { const id = st.sel; if (id == null) return; openDetail(id); startTextEdit(); };
    $("#dEdit").onclick = startTextEdit;
    $("#dCancel").onclick = () => { $("#dEditBox").hidden = true; $("#dText").hidden = false; };
    $("#dSave").onclick = () => {
      const a = ARTS[st.sel]; const v = $("#dTextarea").value.replace(/\n{3,}/g, "\n\n").trim();
      saveEdit(a, { x: v.split(/\n\s*\n/).map((p) => p.replace(/\s*\n\s*/g, " ")).join("\n") });
      openDetail(a.id);
    };
    $("#ebExport").onclick = exportEdits;
    $("#ebImport").onchange = importEdits;
    const svg = $("#overlay");
    svg.addEventListener("pointerdown", onDown);
  }
  function startTextEdit() {
    const a = ARTS[st.sel];
    $("#dTextarea").value = (a.x || "").split("\n").join("\n\n");
    $("#dText").hidden = true; $("#dEditBox").hidden = false; $("#dTextarea").focus();
  }
  // 면 위 영역 끌기
  let drag = null;
  function svgPt(e) {
    const svg = $("#overlay"); const p = svg.createSVGPoint(); p.x = e.clientX; p.y = e.clientY;
    const q = p.matrixTransform(svg.getScreenCTM().inverse());
    const H = svg.viewBox.baseVal.height;
    return [Math.min(1, Math.max(0, q.x / 1000)), Math.min(1, Math.max(0, q.y / H))];
  }
  function onDown(e) {
    if (!st.edit) return;
    const t = e.target, g = t.closest("g"), a = st.sel != null ? ARTS[st.sel] : null;
    const [x, y] = svgPt(e);
    if (a && st.draw && (!g || +g.dataset.id !== a.id || t.tagName !== "circle")) {
      drag = { mode: "new", a, b: a.b.slice(), k: a.b.length, ox: x, oy: y };
      drag.b.push([x, y, x, y]);
    } else if (g && a && +g.dataset.id === a.id) {
      const k = +t.dataset.k; st.rsel = k;
      drag = { mode: t.tagName === "circle" ? t.dataset.h : "move", a, b: a.b.map((r) => r.slice()), k, ox: x, oy: y, r0: a.b[k].slice() };
    } else if (g) {
      selectEdit(+g.dataset.id); return;
    } else return;
    e.preventDefault(); $("#overlay").setPointerCapture(e.pointerId);
    const mv = (ev) => {
      const [px, py] = svgPt(ev); const d = drag; const r = d.b[d.k];
      if (d.mode === "new") { r[0] = Math.min(d.ox, px); r[1] = Math.min(d.oy, py); r[2] = Math.max(d.ox, px); r[3] = Math.max(d.oy, py); }
      else if (d.mode === "move") { const dx = px - d.ox, dy = py - d.oy; r[0] = d.r0[0] + dx; r[1] = d.r0[1] + dy; r[2] = d.r0[2] + dx; r[3] = d.r0[3] + dy; }
      else { if (d.mode.includes("w")) r[0] = Math.min(px, r[2] - 0.005); if (d.mode.includes("e")) r[2] = Math.max(px, r[0] + 0.005);
             if (d.mode.includes("n")) r[1] = Math.min(py, r[3] - 0.003); if (d.mode.includes("s")) r[3] = Math.max(py, r[1] + 0.003); }
      d.a.b = d.b; st.rsel = d.k;
      const pinfo = META.issues[issIdx.get(st.iss)].pages.find((x) => x.p === st.page); drawOverlay(pinfo.r);
    };
    const up = () => {
      $("#overlay").removeEventListener("pointermove", mv); $("#overlay").removeEventListener("pointerup", up);
      const d = drag; drag = null; const r = d.b[d.k];
      if (d.mode === "new" && (r[2] - r[0] < 0.01 || r[3] - r[1] < 0.006)) { d.a.b = d.a._ob; applyEdit(d.a); refreshEdit(); return; }
      if (d.mode === "new") st.draw = false;
      saveEdit(d.a, { b: d.b.map((q) => q.map((v) => Math.round(v * 10000) / 10000)) });
    };
    $("#overlay").addEventListener("pointermove", mv); $("#overlay").addEventListener("pointerup", up);
  }
  function exportEdits() {
    const n = Object.keys(EDITS).length;
    if (!n) { alertMsg("내보낼 교정이 없습니다."); return; }
    const data = { kind: "chunchu-corrections", year: META.year, exported: new Date().toISOString(), count: n, edits: EDITS };
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 1)], { type: "application/json" }));
    a.download = `chunchu_${META.year}_corrections_${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a); a.click(); a.remove();
  }
  function importEdits(e) {
    const f = e.target.files[0]; if (!f) return;
    f.text().then((t) => {
      const d = JSON.parse(t);
      if (d.kind !== "chunchu-corrections" || d.year !== META.year) throw new Error("year");
      Object.assign(EDITS, d.edits); persist(); ARTS.forEach(applyEdit); refreshEdit();
      alertMsg(`${Object.keys(d.edits).length}건을 가져왔습니다.`);
    }).catch(() => alertMsg(`${META.year}년 교정 파일이 아닙니다.`));
    e.target.value = "";
  }
  function alertMsg(m) { $("#ebCount").textContent = m; setTimeout(persist, 2500); }

  boot();
})();
