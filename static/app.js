document.addEventListener("DOMContentLoaded", () => {
    console.log("[INIT] 나의 투자도우미 4탭 프론트엔드 초기화 완료");
    if (window.Chart) {
        window.Chart.defaults.color = "#cbd5e1";
        window.Chart.defaults.borderColor = "rgba(255, 255, 255, 0.08)";
    }

    // ==================== 공통 유틸 ====================
    function showEl(el, text = null) {
        if (text !== null) el.textContent = text;
        el.classList.remove("hidden");
    }

    function hideEl(el) {
        el.classList.add("hidden");
    }

    function renderMarkdown(el, text) {
        const raw = text || "";
        if (window.marked && window.DOMPurify) {
            window.marked.setOptions({ breaks: true, gfm: true });
            el.classList.add("markdown-body");
            el.innerHTML = window.DOMPurify.sanitize(window.marked.parse(raw));
        } else {
            el.textContent = raw;
        }
    }

    function appendChatMessage(boxEl, role, text, isMarkdown = false) {
        const msgDiv = document.createElement("div");
        msgDiv.className = `chat-msg ${role}`;
        const bubble = document.createElement("div");
        bubble.className = "chat-bubble";
        if (isMarkdown && role === "bot") {
            renderMarkdown(bubble, text);
        } else {
            bubble.textContent = text;
        }
        msgDiv.appendChild(bubble);
        boxEl.appendChild(msgDiv);
        boxEl.scrollTop = boxEl.scrollHeight;
        return bubble;
    }

    function formatNum(val, suffix = "") {
        if (val === null || val === undefined) return "-";
        return `${Number(val).toLocaleString("ko-KR")}${suffix}`;
    }

    function formatPrice(val, currency = "KRW") {
        if (val === null || val === undefined) return "-";
        const num = Number(val);
        if (currency === "USD") {
            return `$${num.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
        }
        return `${num.toLocaleString("ko-KR")}원`;
    }

    function isValidSymbol(code) {
        const s = String(code || "").trim().toUpperCase();
        return /^\d{6}$/.test(s) || /^[A-Z]{1,5}([.-][A-Z]{1,2})?$/.test(s);
    }

    async function resolveCodeOrSearch(rawInput) {
        const val = String(rawInput || "").trim();
        if (!val) return "";
        if (/^\d{6}$/.test(val)) return val;
        // 대문자 티커(예: AAPL, SPY)는 그대로 사용하고, 한글 종목명이나 소문자 영문(apple 등)은 검색 API로 우선 해석
        if (/^[A-Z]{1,5}([.-][A-Z]{1,2})?$/.test(val)) return val;
        try {
            const resp = await fetch(`/api/search?q=${encodeURIComponent(val)}`);
            const data = await resp.json();
            const items = data.items || [];
            if (items.length > 0) {
                const norm = val.replace(/\s+/g, "").toLowerCase();
                const exact = items.find((it) => (it.name || "").replace(/\s+/g, "").toLowerCase() === norm);
                return (exact || items[0]).code;
            }
        } catch (err) {
            console.warn("[SEARCH] 자동 코드 변환 실패:", err);
        }
        return val;
    }

    function setupAutocomplete(inputEl, listEl, onSelect) {
        if (!inputEl || !listEl) return;
        let timer = null;

        inputEl.addEventListener("input", () => {
            const q = inputEl.value.trim();
            clearTimeout(timer);
            if (!q || /^\d{6}$/.test(q)) {
                hideEl(listEl);
                return;
            }
            timer = setTimeout(async () => {
                try {
                    const resp = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
                    const data = await resp.json();
                    const items = data.items || [];
                    if (items.length === 0) {
                        hideEl(listEl);
                        return;
                    }
                    listEl.innerHTML = "";
                    items.forEach((item) => {
                        const row = document.createElement("div");
                        row.className = "autocomplete-item";
                        row.innerHTML = `<span class="ac-name"></span><span class="autocomplete-meta"></span>`;
                        row.querySelector(".ac-name").textContent = `${item.name} (${item.code})`;
                        row.querySelector(".autocomplete-meta").textContent = item.market || item.nation;
                        row.addEventListener("mousedown", (e) => {
                            e.preventDefault();
                            hideEl(listEl);
                            onSelect(item);
                        });
                        listEl.appendChild(row);
                    });
                    showEl(listEl);
                } catch (err) {
                    hideEl(listEl);
                }
            }, 250);
        });

        inputEl.addEventListener("blur", () => {
            setTimeout(() => hideEl(listEl), 150);
        });
    }

    // ==================== 공통 관심종목 즐겨찾기 (localStorage) ====================
    const WATCHLIST_KEY = "mia_watchlist_v1";
    const PORTFOLIOS_KEY = "mia_portfolios_v1";
    const watchlistItemsEl = document.getElementById("watchlist-items");
    const t1FavBtn = document.getElementById("t1-fav-btn");
    const t3FavBtn = document.getElementById("t3-fav-btn");
    const t4FavBtn = document.getElementById("t4-fav-btn");

    function loadWatchlist() {
        try {
            return JSON.parse(localStorage.getItem(WATCHLIST_KEY) || "[]");
        } catch {
            return [];
        }
    }

    function saveWatchlist(list) {
        localStorage.setItem(WATCHLIST_KEY, JSON.stringify(list));
    }

    function isFavorite(code) {
        return loadWatchlist().some((x) => x.code === code);
    }

    function syncFavButton(btn, code, name) {
        if (!btn || !code) return;
        const active = isFavorite(code);
        btn.classList.toggle("active", active);
        btn.textContent = active ? "★ 즐겨찾기됨" : "☆ 즐겨찾기";
        btn.dataset.code = code;
        btn.dataset.name = name || code;
        showEl(btn);
    }

    function toggleFavorite(code, name) {
        if (!code) return;
        const list = loadWatchlist();
        const idx = list.findIndex((x) => x.code === code);
        if (idx >= 0) {
            list.splice(idx, 1);
        } else {
            list.unshift({ code, name: name || code });
        }
        saveWatchlist(list);
        renderWatchlistBar();
        if (t1FavBtn && t1FavBtn.dataset.code === code) syncFavButton(t1FavBtn, code, name);
        if (t3FavBtn && t3FavBtn.dataset.code === code) syncFavButton(t3FavBtn, code, name);
        if (t4FavBtn && t4FavBtn.dataset.code === code) syncFavButton(t4FavBtn, code, name);
    }

    function renderWatchlistBar() {
        if (!watchlistItemsEl) return;
        const list = loadWatchlist();
        watchlistItemsEl.innerHTML = "";
        if (list.length === 0) {
            const span = document.createElement("span");
            span.className = "unit-note";
            span.textContent = "아직 저장된 관심종목이 없습니다. 종목 조회 후 ☆ 즐겨찾기를 눌러보세요!";
            watchlistItemsEl.appendChild(span);
            return;
        }
        list.forEach((item) => {
            const chip = document.createElement("span");
            chip.className = "fav-chip";

            const btn = document.createElement("button");
            btn.type = "button";
            btn.className = "fav-chip-btn";
            btn.textContent = `${item.name} (${item.code})`;
            btn.addEventListener("click", () => {
                const activeTab = document.querySelector(".tab-btn.active")?.dataset.tab;
                if (activeTab === "tab-technical") {
                    t3CodeInput.value = item.code;
                    loadTechnicalData(item.code);
                } else if (activeTab === "tab-dart") {
                    if (/^\d{6}$/.test(item.code)) {
                        t4CodeInput.value = item.code;
                        runTab4DartAndAnalyze(item.code);
                    } else {
                        showEl(t4Error, "DART 공시는 국내 상장 6자리 종목만 조회할 수 있습니다.");
                    }
                } else if (activeTab === "tab-rebalance") {
                    const cur = t2CodesInput.value.split(",").map((s) => s.trim()).filter(Boolean);
                    if (!cur.includes(item.code)) {
                        cur.push(item.code);
                        t2CodesInput.value = cur.join(", ");
                    }
                } else {
                    t1CodeInput.value = item.code;
                    runTab1FetchAndAnalyze(item.code);
                }
            });

            const del = document.createElement("button");
            del.type = "button";
            del.className = "fav-chip-del";
            del.title = "삭제";
            del.textContent = "×";
            del.addEventListener("click", () => toggleFavorite(item.code, item.name));

            chip.appendChild(btn);
            chip.appendChild(del);
            watchlistItemsEl.appendChild(chip);
        });
    }

    [t1FavBtn, t3FavBtn, t4FavBtn].forEach((btn) => {
        if (!btn) return;
        btn.addEventListener("click", () => {
            toggleFavorite(btn.dataset.code, btn.dataset.name);
        });
    });

    renderWatchlistBar();

    // ==================== 4탭 전환 ====================
    const tabButtons = document.querySelectorAll(".tab-btn");
    const tabPanels = document.querySelectorAll(".tab-panel");

    tabButtons.forEach((btn) => {
        btn.addEventListener("click", () => {
            const targetId = btn.dataset.tab;
            console.log(`[TAB] 탭 전환: ${targetId}`);
            tabButtons.forEach((b) => b.classList.remove("active"));
            tabPanels.forEach((p) => p.classList.remove("active"));
            btn.classList.add("active");
            document.getElementById(targetId).classList.add("active");
            if (typeof renderJumpRemote === "function") renderJumpRemote(targetId);
        });
    });

    // ==================== 탭 1: 종목 심층분석 채팅 ====================
    let t1ConversationId = null;
    let t1CachedStockData = null;
    let t1Chart1 = null;
    let t1Chart2 = null;
    let t1PriceHistoryChart = null;
    let t1CurrentRange = "3m";

    const t1FetchForm = document.getElementById("t1-fetch-form");
    const t1FetchBtn = document.getElementById("t1-fetch-btn");
    const t1CodeInput = document.getElementById("t1-code-input");
    const t1AcList = document.getElementById("t1-ac-list");
    const t1UseTools = document.getElementById("t1-use-tools");
    const t1Status = document.getElementById("t1-status");
    const t1Error = document.getElementById("t1-error");
    const t1AllocCard = document.getElementById("t1-alloc-card");
    const t1AllocTarget = document.getElementById("t1-alloc-target");
    const t1AllocAmount = document.getElementById("t1-alloc-amount");
    const t1AllocBar = document.getElementById("t1-alloc-bar");
    const t1AllocReason = document.getElementById("t1-alloc-reason");
    const t1StockView = document.getElementById("t1-stock-view");
    const t1StockNameEl = document.getElementById("t1-stock-name");
    const t1AssetBadgeEl = document.getElementById("t1-asset-badge");
    const t1StockMetaEl = document.getElementById("t1-stock-meta");
    const t1CurrentPriceEl = document.getElementById("t1-current-price");
    const t1PriceChangeEl = document.getElementById("t1-price-change");
    const t1SnapshotGridEl = document.getElementById("t1-snapshot-grid");
    const t1GaugeEl = document.getElementById("t1-52w-gauge");
    const t1PriceCardEl = document.getElementById("t1-price-card");
    const t1PriceCurrencyNoteEl = document.getElementById("t1-price-currency-note");
    const t1PriceRangeChangeEl = document.getElementById("t1-price-range-change");
    const t1ChartsRowEl = document.getElementById("t1-charts-row");
    const t1Chart1TitleEl = document.getElementById("t1-chart-1-title");
    const t1Chart2TitleEl = document.getElementById("t1-chart-2-title");
    const t1FinancialsCardEl = document.getElementById("t1-financials-card");
    const t1FinanceUnitNoteEl = document.getElementById("t1-finance-unit-note");
    const t1FinancialsTbodyEl = document.getElementById("t1-financials-tbody");
    const t1EtfCardEl = document.getElementById("t1-etf-card");
    const t1EtfMetaEl = document.getElementById("t1-etf-meta");
    const t1EtfReturnsGridEl = document.getElementById("t1-etf-returns-grid");
    const t1EtfDescEl = document.getElementById("t1-etf-desc");
    const t1NewsListEl = document.getElementById("t1-news-list");

    const t1ChatBox = document.getElementById("t1-chat-box");
    const t1ChatForm = document.getElementById("t1-chat-form");
    const t1QueryInput = document.getElementById("t1-query-input");
    const t1SendBtn = document.getElementById("t1-send-btn");
    const t1ResetBtn = document.getElementById("t1-reset-btn");
    const t1EvidenceWrap = document.getElementById("t1-evidence-wrap");
    const t1EvidenceJson = document.getElementById("t1-evidence-json");

    document.querySelectorAll(".t1-sample").forEach((btn) => {
        btn.addEventListener("click", () => {
            t1CodeInput.value = btn.dataset.code;
            console.log(`[TAB1] 예시 종목 선택: ${btn.dataset.code}`);
            runTab1FetchAndAnalyze(btn.dataset.code);
        });
    });

    setupAutocomplete(t1CodeInput, t1AcList, (item) => {
        t1CodeInput.value = item.code;
        runTab1FetchAndAnalyze(item.code);
    });

    t1FetchForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const resolved = await resolveCodeOrSearch(t1CodeInput.value);
        t1CodeInput.value = resolved;
        runTab1FetchAndAnalyze(resolved);
    });

    t1ResetBtn.addEventListener("click", () => {
        t1ConversationId = null;
        t1ChatBox.innerHTML = "";
        appendChatMessage(t1ChatBox, "bot", "대화가 초기화되었습니다. 상단에서 종목을 조회하거나 질문을 입력해 주세요.", true);
        hideEl(t1Error);
        console.log("[TAB1] 대화 초기화 완료");
    });

    function renderMetricCards(gridEl, metrics) {
        gridEl.innerHTML = "";
        metrics.forEach((m) => {
            const card = document.createElement("div");
            card.className = "metric-card";
            card.innerHTML = `<div class="metric-label"></div><div class="metric-value"></div>`;
            card.querySelector(".metric-label").textContent = m.label;
            card.querySelector(".metric-value").textContent = m.value;
            if (m.hint) {
                const hintEl = document.createElement("div");
                hintEl.className = "metric-hint";
                hintEl.textContent = m.hint;
                card.appendChild(hintEl);
            }
            gridEl.appendChild(card);
        });
    }

    function formatReturnRate(val) {
        if (val === null || val === undefined) return "-";
        const num = Number(val);
        const sign = num > 0 ? "+" : "";
        return `${sign}${num.toLocaleString("ko-KR")}%`;
    }

    function renderTab1Visuals(data) {
        if (t1Chart1) { t1Chart1.destroy(); t1Chart1 = null; }
        if (t1Chart2) { t1Chart2.destroy(); t1Chart2 = null; }

        // 1. 52주 가격 위치 게이지
        const snap = data.snapshot || {};
        const currency = data.currency || "KRW";
        const low52 = snap.low_52w;
        const high52 = snap.high_52w;
        const curPrice = snap.current_price;

        if (low52 !== null && high52 !== null && curPrice !== null && high52 > low52) {
            const pct = Math.max(0, Math.min(100, ((curPrice - low52) / (high52 - low52)) * 100));
            const pctRound = pct.toFixed(1);
            t1GaugeEl.innerHTML = `
                <div class="range-gauge-header">
                    <span>52주 주가 위치 게이지</span>
                    <span>현재가 위치: <strong>${pctRound}%</strong> (0%=신저가 · 100%=신고가)</span>
                </div>
                <div class="range-track">
                    <div class="range-marker" style="left: ${pctRound}%;"></div>
                </div>
                <div class="range-labels">
                    <span>52주 최저 ${formatPrice(low52, currency)}</span>
                    <span>현재 ${formatPrice(curPrice, currency)}</span>
                    <span>52주 최고 ${formatPrice(high52, currency)}</span>
                </div>
            `;
            showEl(t1GaugeEl);
        } else {
            hideEl(t1GaugeEl);
        }

        const isEtf = data.asset_type === "etf";
        const financials = data.financials || [];
        const etf = data.etf_info || {};

        if (!isEtf && financials.length > 0) {
            showEl(t1ChartsRowEl);
            const labels = financials.map((r) => (r.is_consensus ? `${r.period}(E)` : r.period));
            const unitLabel = data.finance_unit || "억원";

            t1Chart1TitleEl.textContent = `연간 매출 · 영업이익 · 순이익 추이 (${unitLabel})`;
            t1Chart1 = new Chart(document.getElementById("t1-chart-1"), {
                type: "bar",
                data: {
                    labels,
                    datasets: [
                        { label: "매출액", data: financials.map((r) => r.revenue), backgroundColor: "rgba(37, 99, 235, 0.7)" },
                        { label: "영업이익", data: financials.map((r) => r.operating_profit), backgroundColor: "rgba(16, 185, 129, 0.75)" },
                        { label: "당기순이익", data: financials.map((r) => r.net_income), backgroundColor: "rgba(245, 158, 11, 0.75)" },
                    ],
                },
                options: { responsive: true, maintainAspectRatio: false },
            });

            const hasRoeOrDebt = financials.some((r) => r.roe !== null || r.debt_ratio !== null);
            if (hasRoeOrDebt) {
                t1Chart2TitleEl.textContent = "수익성(ROE·영업이익률) & 안정성(부채비율) (%)";
                t1Chart2 = new Chart(document.getElementById("t1-chart-2"), {
                    type: "line",
                    data: {
                        labels,
                        datasets: [
                            { label: "영업이익률 (%)", data: financials.map((r) => r.operating_margin), borderColor: "#2563eb", borderWidth: 2 },
                            { label: "ROE (%)", data: financials.map((r) => r.roe), borderColor: "#10b981", borderWidth: 2 },
                            { label: "부채비율 (%)", data: financials.map((r) => r.debt_ratio), borderColor: "#ef4444", borderDash: [4, 4], borderWidth: 2 },
                        ],
                    },
                    options: { responsive: true, maintainAspectRatio: false },
                });
            } else {
                t1Chart2TitleEl.textContent = `현재가 vs 증권가 목표주가 (${currency})`;
                t1Chart2 = new Chart(document.getElementById("t1-chart-2"), {
                    type: "bar",
                    data: {
                        labels: ["52주 최저", "현재가", "목표주가(컨센서스)", "52주 최고"],
                        datasets: [{
                            label: `가격 (${currency})`,
                            data: [snap.low_52w, snap.current_price, snap.target_price, snap.high_52w],
                            backgroundColor: ["#94a3b8", "#2563eb", "#10b981", "#ef4444"],
                        }],
                    },
                    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } },
                });
            }
        } else if (isEtf && (etf.return_1m !== null || etf.return_3m !== null || etf.return_1y !== null)) {
            showEl(t1ChartsRowEl);
            const retVals = [etf.return_1m, etf.return_3m, etf.return_6m, etf.return_1y];
            t1Chart1TitleEl.textContent = "ETF 기간별 수익률 비교 (%)";
            t1Chart1 = new Chart(document.getElementById("t1-chart-1"), {
                type: "bar",
                data: {
                    labels: ["1개월", "3개월", "6개월", "1년"],
                    datasets: [{
                        label: "수익률 (%)",
                        data: retVals,
                        backgroundColor: retVals.map((v) => (v >= 0 ? "rgba(220, 38, 38, 0.7)" : "rgba(37, 99, 235, 0.7)")),
                    }],
                },
                options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } },
            });

            t1Chart2TitleEl.textContent = `현재가 · NAV · 52주 범위 비교 (${currency})`;
            t1Chart2 = new Chart(document.getElementById("t1-chart-2"), {
                type: "bar",
                data: {
                    labels: ["52주 최저", "NAV", "현재가", "52주 최고"],
                    datasets: [{
                        label: `가격 (${currency})`,
                        data: [snap.low_52w, etf.nav, snap.current_price, snap.high_52w],
                        backgroundColor: ["#94a3b8", "#10b981", "#2563eb", "#ef4444"],
                    }],
                },
                options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } },
            });
        } else {
            hideEl(t1ChartsRowEl);
        }
    }

    function renderTab1StockDashboard(data) {
        const snap = data.snapshot || {};
        const isEtf = data.asset_type === "etf";
        const isUs = data.market_region === "US";
        const currency = data.currency || "KRW";
        const etf = data.etf_info || {};

        t1StockNameEl.textContent = `${data.name} (${data.code})`;
        syncFavButton(t1FavBtn, data.code, data.name);
        if (t1AssetBadgeEl) {
            t1AssetBadgeEl.className = "asset-badge";
            if (isEtf) {
                t1AssetBadgeEl.classList.add("badge-etf");
                t1AssetBadgeEl.textContent = isUs ? "미국 ETF" : "국내 ETF";
            } else {
                t1AssetBadgeEl.classList.add("badge-stock");
                t1AssetBadgeEl.textContent = isUs ? "미국 주식" : "국내 주식";
            }
            showEl(t1AssetBadgeEl);
        }
        t1StockMetaEl.textContent = `${isUs ? "미국 · " : ""}${isEtf ? "ETF · " : ""}${snap.market || "-"} · 장 상태: ${snap.market_status || "-"}`;
        t1CurrentPriceEl.textContent = formatPrice(snap.current_price, currency);

        const cp = snap.change_price;
        const cr = snap.change_rate;
        t1PriceChangeEl.className = "price-change";
        if (cp > 0) {
            t1PriceChangeEl.classList.add("up");
            t1PriceChangeEl.textContent = `▲ ${formatPrice(cp, currency)} (+${cr ?? 0}%)`;
        } else if (cp < 0) {
            t1PriceChangeEl.classList.add("down");
            t1PriceChangeEl.textContent = `▼ ${formatPrice(Math.abs(cp), currency)} (${cr ?? 0}%)`;
        } else {
            t1PriceChangeEl.classList.add("flat");
            t1PriceChangeEl.textContent = `${formatPrice(0, currency)} (0.00%)`;
        }

        const metrics = isEtf
            ? (isUs
                ? [
                    { label: "시가총액", value: snap.market_cap || "-", hint: "시장에서 거래되는 전체 규모" },
                    { label: "분배금 수익률 (주당)", value: `${formatNum(snap.dividend_yield, "%")} (${formatPrice(snap.dividend, currency)})`, hint: "최근 1년 배당(분배금) 비율" },
                    { label: "52주 최고", value: formatPrice(snap.high_52w, currency) },
                    { label: "52주 최저", value: formatPrice(snap.low_52w, currency) },
                ]
                : [
                    { label: "시가총액", value: snap.market_cap || "-", hint: "시장에서 거래되는 전체 규모" },
                    { label: "순자산총액(AUM)", value: etf.total_nav || "-", hint: "펀드가 보유한 실제 순자산 합계" },
                    { label: "NAV (순자산가치)", value: formatPrice(etf.nav, currency), hint: "1주(좌)당 실제 내재가치" },
                    { label: "괴리율", value: formatReturnRate(etf.deviation_rate), hint: "시장가와 NAV의 차이 (0%에 가까울수록 적정)" },
                    { label: "총보수 (연)", value: formatNum(etf.total_fee, "%"), hint: "연간 운용 수수료 (낮을수록 유리)" },
                    { label: "분배금 수익률", value: formatNum(snap.dividend_yield, "%"), hint: "최근 1년 배당(분배금) 비율" },
                    { label: "52주 최고", value: formatPrice(snap.high_52w, currency) },
                    { label: "52주 최저", value: formatPrice(snap.low_52w, currency) },
                ])
            : [
                { label: "시가총액", value: snap.market_cap || "-", hint: "기업의 전체 시장 가치" },
                { label: "증권가 목표주가", value: formatPrice(snap.target_price, currency), hint: "애널리스트 평균 목표가 (컨센서스)" },
                { label: "PER / 추정PER", value: `${formatNum(snap.per, "배")} / ${formatNum(snap.cns_per, "배")}`, hint: "주가÷이익 (낮을수록 저평가 경향)" },
                { label: "PBR", value: formatNum(snap.pbr, "배"), hint: "주가÷순자산 (1배 미만이면 자산가치 대비 저평가)" },
                { label: "EPS / BPS", value: `${formatPrice(snap.eps, currency)} / ${formatPrice(snap.bps, currency)}`, hint: "주당순이익 / 주당순자산" },
                { label: "52주 최고 / 최저", value: `${formatPrice(snap.high_52w, currency)} / ${formatPrice(snap.low_52w, currency)}` },
                { label: "배당수익률 (주당)", value: `${formatNum(snap.dividend_yield, "%")} (${formatPrice(snap.dividend, currency)})` },
                ...(!isUs ? [{ label: "외국인 소진율", value: formatNum(snap.foreign_rate, "%"), hint: "외국인 투자자 보유 비중" }] : []),
            ];
        renderMetricCards(t1SnapshotGridEl, metrics);

        if (isEtf) {
            hideEl(t1FinancialsCardEl);
            showEl(t1EtfCardEl);
            if (isUs) {
                t1EtfMetaEl.textContent = `미국 상장 ETF · ${snap.market || "US"}`;
                t1EtfReturnsGridEl.innerHTML = "";
            } else {
                t1EtfMetaEl.textContent = `운용사: ${etf.issuer || "-"} · 기초지수: ${etf.base_index || "-"}`;
                renderMetricCards(t1EtfReturnsGridEl, [
                    { label: "기초지수", value: etf.base_index || "-" },
                    { label: "최근 1개월 수익률", value: formatReturnRate(etf.return_1m) },
                    { label: "최근 3개월 수익률", value: formatReturnRate(etf.return_3m) },
                    { label: "최근 6개월 수익률", value: formatReturnRate(etf.return_6m) },
                    { label: "최근 1년 수익률", value: formatReturnRate(etf.return_1y) },
                ]);
            }
            t1EtfDescEl.textContent = etf.description || "ETF 운용 설명이 제공되지 않았습니다.";
        } else {
            hideEl(t1EtfCardEl);
            showEl(t1FinancialsCardEl);
            if (t1FinanceUnitNoteEl) {
                t1FinanceUnitNoteEl.textContent = `단위: ${data.finance_unit || "억원"} / %`;
            }
        }

        renderTab1Visuals(data);

        t1FinancialsTbodyEl.innerHTML = "";
        const financials = data.financials || [];
        if (financials.length === 0) {
            const tr = document.createElement("tr");
            tr.innerHTML = `<td colspan="7" style="text-align:center;">수집된 재무실적 데이터가 없습니다.</td>`;
            t1FinancialsTbodyEl.appendChild(tr);
        } else {
            financials.forEach((row) => {
                const tr = document.createElement("tr");
                if (row.is_consensus) tr.classList.add("row-consensus");

                const periodTd = document.createElement("td");
                periodTd.textContent = `${row.period || "-"} `;
                if (row.is_consensus) {
                    const badge = document.createElement("span");
                    badge.className = "badge-consensus";
                    badge.textContent = "추정(E)";
                    periodTd.appendChild(badge);
                }
                tr.appendChild(periodTd);

                [
                    formatNum(row.revenue),
                    formatNum(row.operating_profit),
                    formatNum(row.net_income),
                    formatNum(row.operating_margin, "%"),
                    formatNum(row.roe, "%"),
                    formatNum(row.debt_ratio, "%"),
                ].forEach((val) => {
                    const td = document.createElement("td");
                    td.textContent = val;
                    tr.appendChild(td);
                });
                t1FinancialsTbodyEl.appendChild(tr);
            });
        }

        t1NewsListEl.innerHTML = "";
        const news = data.news || [];
        if (news.length === 0) {
            const li = document.createElement("li");
            li.className = "news-item";
            li.textContent = "수집된 최신 뉴스가 없습니다.";
            t1NewsListEl.appendChild(li);
        } else {
            news.forEach((item) => {
                const li = document.createElement("li");
                li.className = "news-item";

                const link = document.createElement("a");
                link.className = "news-title";
                link.href = item.link || "#";
                link.target = "_blank";
                link.rel = "noopener noreferrer";
                link.textContent = item.title || "(제목 없음)";

                const meta = document.createElement("div");
                meta.className = "news-meta";
                meta.textContent = `${item.source || "출처 미상"} · ${item.date || ""}`;

                li.appendChild(link);
                li.appendChild(meta);
                if (item.snippet) {
                    const sn = document.createElement("p");
                    sn.className = "news-snippet";
                    sn.textContent = item.snippet;
                    li.appendChild(sn);
                }
                t1NewsListEl.appendChild(li);
            });
        }
    }

    async function loadTab1PriceChart(code, rangeKey = "3m") {
        if (!t1PriceCardEl || !code) return;
        try {
            const resp = await fetch("/api/price_history", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ code, range: rangeKey }),
            });
            const data = await resp.json();
            if (!resp.ok || !data.series || data.series.length === 0) {
                hideEl(t1PriceCardEl);
                return;
            }
            showEl(t1PriceCardEl);

            const pct = data.change_pct;
            const isUp = pct === null || pct >= 0;
            const lineColor = isUp ? "#dc2626" : "#2563eb";
            const fillTop = isUp ? "rgba(220, 38, 38, 0.22)" : "rgba(37, 99, 235, 0.22)";
            const fillBottom = isUp ? "rgba(220, 38, 38, 0.0)" : "rgba(37, 99, 235, 0.0)";

            if (t1PriceCurrencyNoteEl) {
                t1PriceCurrencyNoteEl.textContent = data.currency === "USD" ? "(단위: 달러 USD · $)" : "(단위: 원화 KRW · 원)";
            }

            if (t1PriceRangeChangeEl) {
                t1PriceRangeChangeEl.className = `price-change ${isUp ? "up" : "down"}`;
                t1PriceRangeChangeEl.textContent = pct !== null
                    ? `${pct >= 0 ? "+" : ""}${pct}% (${rangeKey.toUpperCase()})`
                    : "-";
            }

            const canvas = document.getElementById("t1-price-history-chart");
            const ctx = canvas.getContext("2d");
            const grad = ctx.createLinearGradient(0, 0, 0, 320);
            grad.addColorStop(0, fillTop);
            grad.addColorStop(1, fillBottom);

            if (t1PriceHistoryChart) t1PriceHistoryChart.destroy();
            t1PriceHistoryChart = new Chart(ctx, {
                type: "line",
                data: {
                    labels: data.series.map((p) => p.date),
                    datasets: [{
                        label: `종가 (${data.currency})`,
                        data: data.series.map((p) => p.close),
                        borderColor: lineColor,
                        backgroundColor: grad,
                        fill: true,
                        borderWidth: 2.4,
                        tension: 0.15,
                        pointRadius: 0,
                        pointHoverRadius: 5,
                        pointHoverBackgroundColor: lineColor,
                    }],
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    interaction: { mode: "index", intersect: false },
                    plugins: {
                        legend: { display: false },
                        tooltip: {
                            callbacks: {
                                label: (c) => ` 종가: ${formatPrice(c.parsed.y, data.currency)}`,
                            },
                        },
                    },
                    scales: {
                        x: { grid: { display: false }, ticks: { maxTicksLimit: 7 } },
                        y: {
                            grid: { color: "rgba(148, 163, 184, 0.18)" },
                            ticks: {
                                callback: (value) => formatPrice(value, data.currency),
                            },
                        },
                    },
                },
            });
        } catch (err) {
            hideEl(t1PriceCardEl);
        }
    }

    document.querySelectorAll(".range-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
            document.querySelectorAll(".range-btn").forEach((b) => b.classList.remove("active"));
            btn.classList.add("active");
            t1CurrentRange = btn.dataset.range || "3m";
            if (t1CachedStockData && t1CachedStockData.code) {
                loadTab1PriceChart(t1CachedStockData.code, t1CurrentRange);
            }
        });
    });

    async function runTab1FetchAndAnalyze(rawCode) {
        const code = String(rawCode || "").trim().toUpperCase();
        if (!isValidSymbol(code)) {
            showEl(t1Error, "국내 6자리 숫자 또는 미국 티커(예: AAPL, SPY)를 입력해 주세요.");
            return;
        }
        t1CodeInput.value = code;

        hideEl(t1Error);
        showEl(t1Status, `1단계: 종목코드 ${code}의 시세·재무·뉴스 데이터를 수집하는 중입니다...`);
        t1FetchBtn.disabled = true;
        t1SendBtn.disabled = true;

        try {
            console.log(`[TAB1] POST /fetch 시작 (code=${code})`);
            const fetchResp = await fetch("/fetch", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ code }),
            });
            const stockData = await fetchResp.json();
            if (!fetchResp.ok || !stockData.name) {
                hideEl(t1Status);
                showEl(t1Error, (stockData.errors && stockData.errors.join(" / ")) || "종목 데이터 수집에 실패했습니다.");
                return;
            }

            t1CachedStockData = stockData;
            t1ConversationId = null;
            if (typeof recordRecentStock === "function") recordRecentStock(stockData.code, stockData.name);
            renderTab1StockDashboard(stockData);
            showEl(t1StockView);
            loadTab1PriceChart(stockData.code, t1CurrentRange);

            t1EvidenceJson.textContent = JSON.stringify(stockData, null, 2);
            showEl(t1EvidenceWrap);

            // 100만원 가상 투자 추천 위젯 비동기 호출 (검색창 바로 아래 최상단 표시)
            if (t1AllocCard) {
                t1AllocTarget.textContent = `(${stockData.name})`;
                t1AllocAmount.textContent = "계산 중...";
                t1AllocBar.style.width = "0%";
                t1AllocReason.textContent = "AI가 수집된 데이터를 바탕으로 0~100만원 추천 투자금을 계산 중입니다...";
                showEl(t1AllocCard);

                fetch("/api/allocate", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ code: stockData.code, stock_data: stockData }),
                })
                    .then((r) => r.json().then((d) => ({ ok: r.ok, d })))
                    .then(({ ok, d }) => {
                        if (!ok || d.error || d.amount_manwon === null || d.amount_manwon === undefined) {
                            t1AllocAmount.textContent = "-";
                            t1AllocReason.textContent = d.error || "추천 금액을 산출하지 못했습니다.";
                            return;
                        }
                        t1AllocAmount.textContent = `${d.amount_manwon}만원`;
                        t1AllocBar.style.width = `${d.amount_manwon}%`;
                        const hue = Math.round((d.amount_manwon / 100) * 140); // 0=빨강 -> 50=노랑/연두 -> 100=초록
                        const barColor = `hsl(${hue}, 74%, 42%)`;
                        t1AllocBar.style.backgroundColor = barColor;
                        t1AllocAmount.style.color = `hsl(${hue}, 78%, 34%)`;
                        t1AllocReason.textContent = d.reason || "";
                    })
                    .catch((err) => {
                        t1AllocAmount.textContent = "-";
                        t1AllocReason.textContent = `추천 계산 오류: ${err.message}`;
                    });
            }

            // 2단계: 전문가 프롬프트로 1차 종합 분석 요청
            showEl(t1Status, `2단계: ${stockData.name}(${stockData.code}) 수집 데이터를 바탕으로 AI 애널리스트 1차 분석을 생성 중입니다...`);
            t1ChatBox.innerHTML = "";
            appendChatMessage(t1ChatBox, "user", `[${stockData.name} (${stockData.code})] 수집된 최신 데이터 기반 종합 분석 요청`);
            const loadingBubble = appendChatMessage(t1ChatBox, "bot", "전문가 리포트를 작성 중입니다...");

            const chatResp = await fetch("/api/chat/analysis", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    code: stockData.code,
                    mode: "init",
                    use_tools: t1UseTools.checked,
                    stock_data: stockData,
                }),
            });
            const chatData = await chatResp.json();
            hideEl(t1Status);

            if (!chatResp.ok || chatData.error) {
                loadingBubble.textContent = `오류: ${chatData.error || "분석 리포트를 생성하지 못했습니다."}`;
                showEl(t1Error, chatData.error || "Dify 분석 호출 실패");
                return;
            }

            t1ConversationId = chatData.conversation_id || null;
            renderMarkdown(loadingBubble, chatData.answer || "(빈 응답)");
            console.log("[TAB1] 1차 전문가 분석 완료, conversation_id:", t1ConversationId);
        } catch (err) {
            console.error("[TAB1] 조회/분석 오류:", err);
            hideEl(t1Status);
            showEl(t1Error, `서버 통신 오류: ${err.message}`);
        } finally {
            t1FetchBtn.disabled = false;
            t1SendBtn.disabled = false;
        }
    }

    t1ChatForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const code = t1CodeInput.value.trim().toUpperCase();
        const query = t1QueryInput.value.trim();
        const useTools = t1UseTools.checked;

        if (!query) return;
        if (useTools && t1CachedStockData && code && t1CachedStockData.code !== code) {
            t1CachedStockData = null;
            t1ConversationId = null;
        }
        if (useTools && !t1CachedStockData && !isValidSymbol(code)) {
            showEl(t1Error, "도구 사용 시 국내 6자리 또는 미국 티커(예: AAPL)를 입력해 주세요.");
            return;
        }

        hideEl(t1Error);
        appendChatMessage(t1ChatBox, "user", useTools ? query : `[도구 없음] ${query}`);
        t1QueryInput.value = "";
        t1SendBtn.disabled = true;

        const loadingBubble = appendChatMessage(
            t1ChatBox,
            "bot",
            useTools ? "수집된 종목 근거를 바탕으로 답변을 작성 중입니다..." : "Dify에게 직접 질문 중입니다..."
        );

        try {
            console.log(`[TAB1] POST /api/chat/analysis 후속 질문 (code=${code}, use_tools=${useTools})`);
            const resp = await fetch("/api/chat/analysis", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    code,
                    query,
                    mode: "chat",
                    use_tools: useTools,
                    conversation_id: t1ConversationId,
                    stock_data: useTools ? t1CachedStockData : null,
                }),
            });
            const data = await resp.json();
            console.log("[TAB1] 응답 수신:", resp.status, data);

            if (data.stock_data && !t1CachedStockData) {
                t1CachedStockData = data.stock_data;
                renderTab1StockDashboard(data.stock_data);
                showEl(t1StockView);
                t1EvidenceJson.textContent = JSON.stringify(data.stock_data, null, 2);
                showEl(t1EvidenceWrap);
            }

            if (!resp.ok || data.error) {
                loadingBubble.textContent = `오류: ${data.error || "답변을 받지 못했습니다."}`;
                showEl(t1Error, data.error || "요청 처리 중 오류가 발생했습니다.");
                return;
            }

            t1ConversationId = data.conversation_id || t1ConversationId;
            renderMarkdown(loadingBubble, data.answer || "(빈 응답)");
        } catch (err) {
            console.error("[TAB1] 통신 오류:", err);
            loadingBubble.textContent = `서버 통신 오류: ${err.message}`;
            showEl(t1Error, `서버 통신 오류: ${err.message}`);
        } finally {
            t1SendBtn.disabled = false;
        }
    });

    // ==================== 탭 2: 리밸런싱 도우미 ====================
    let t2WeightsChart = null;
    let t2FrontierChart = null;
    let t2EquityChart = null;
    let t2DdChart = null;
    let t2HoldingsMap = {};

    const t2Form = document.getElementById("t2-form");
    const t2CodesInput = document.getElementById("t2-codes-input");
    const t2SearchInput = document.getElementById("t2-search-input");
    const t2AcList = document.getElementById("t2-ac-list");
    const t2YearsInput = document.getElementById("t2-years");
    const t2FreqInput = document.getElementById("t2-freq");
    const t2StrategyInput = document.getElementById("t2-strategy");
    const t2BenchmarkInput = document.getElementById("t2-benchmark");
    const t2CapitalInput = document.getElementById("t2-capital");
    const t2SaveNameInput = document.getElementById("t2-save-name");
    const t2SaveBtn = document.getElementById("t2-save-btn");
    const t2SavedListEl = document.getElementById("t2-saved-list");
    const t2CalcBtn = document.getElementById("t2-calc-btn");

    function loadSavedPortfolios() {
        try {
            return JSON.parse(localStorage.getItem(PORTFOLIOS_KEY) || "[]");
        } catch {
            return [];
        }
    }

    function savePortfolios(list) {
        localStorage.setItem(PORTFOLIOS_KEY, JSON.stringify(list));
    }

    function renderSavedPortfolios() {
        if (!t2SavedListEl) return;
        const list = loadSavedPortfolios();
        t2SavedListEl.innerHTML = "";
        list.forEach((p, idx) => {
            const chip = document.createElement("span");
            chip.className = "fav-chip";
            const btn = document.createElement("button");
            btn.type = "button";
            btn.className = "fav-chip-btn";
            btn.textContent = p.name;
            btn.addEventListener("click", () => {
                t2CodesInput.value = p.codes || "";
                if (t2YearsInput && p.years) t2YearsInput.value = String(p.years);
                if (t2FreqInput && p.freq) t2FreqInput.value = p.freq;
                if (t2StrategyInput && p.strategy) t2StrategyInput.value = p.strategy;
                if (t2BenchmarkInput && p.benchmark) t2BenchmarkInput.value = p.benchmark;
                if (t2CapitalInput && p.capital) t2CapitalInput.value = String(p.capital);
                t2HoldingsMap = p.holdings && typeof p.holdings === "object" ? { ...p.holdings } : {};
                t2Form.requestSubmit();
            });
            const del = document.createElement("button");
            del.type = "button";
            del.className = "fav-chip-del";
            del.textContent = "×";
            del.title = "삭제";
            del.addEventListener("click", () => {
                const next = loadSavedPortfolios();
                next.splice(idx, 1);
                savePortfolios(next);
                renderSavedPortfolios();
            });
            chip.appendChild(btn);
            chip.appendChild(del);
            t2SavedListEl.appendChild(chip);
        });
    }

    if (t2SaveBtn) {
        t2SaveBtn.addEventListener("click", () => {
            const name = (t2SaveNameInput?.value || "").trim() || `포트폴리오 ${loadSavedPortfolios().length + 1}`;
            const entry = {
                name,
                codes: t2CodesInput.value.trim(),
                years: t2YearsInput ? t2YearsInput.value : "1",
                freq: t2FreqInput ? t2FreqInput.value : "none",
                strategy: t2StrategyInput ? t2StrategyInput.value : "static",
                benchmark: t2BenchmarkInput ? t2BenchmarkInput.value : "069500",
                capital: t2CapitalInput ? t2CapitalInput.value : "10000000",
                holdings: { ...t2HoldingsMap },
            };
            const list = loadSavedPortfolios().filter((x) => x.name !== name);
            list.unshift(entry);
            savePortfolios(list);
            if (t2SaveNameInput) t2SaveNameInput.value = "";
            renderSavedPortfolios();
        });
    }

    renderSavedPortfolios();
    const t2Status = document.getElementById("t2-status");
    const t2Error = document.getElementById("t2-error");
    const t2Result = document.getElementById("t2-result");
    const t2SummaryGrid = document.getElementById("t2-summary-grid");
    const t2FxNote = document.getElementById("t2-fx-note");
    const t2AssetsTbody = document.getElementById("t2-assets-tbody");
    const t2YearlyCard = document.getElementById("t2-yearly-card");
    const t2YearlyBenchTh = document.getElementById("t2-yearly-bench-th");
    const t2YearlyTbody = document.getElementById("t2-yearly-tbody");

    setupAutocomplete(t2SearchInput, t2AcList, (item) => {
        const cur = t2CodesInput.value.split(",").map((s) => s.trim()).filter(Boolean);
        if (!cur.includes(item.code)) {
            cur.push(item.code);
            t2CodesInput.value = cur.join(", ");
        }
        t2SearchInput.value = "";
    });

    document.querySelectorAll(".t2-preset").forEach((btn) => {
        btn.addEventListener("click", () => {
            t2CodesInput.value = btn.dataset.codes;
            console.log(`[TAB2] 추천 조합 선택: ${btn.dataset.codes}`);
        });
    });

    t2Form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const rawCodes = t2CodesInput.value.trim();
        if (!rawCodes) return;
        const years = Number(t2YearsInput ? t2YearsInput.value : 1) || 1;
        const rebalanceFreq = t2FreqInput ? t2FreqInput.value : "none";
        const strategyMode = t2StrategyInput ? t2StrategyInput.value : "static";
        const benchmark = t2BenchmarkInput ? t2BenchmarkInput.value : "069500";
        const initialCapital = Number(t2CapitalInput ? t2CapitalInput.value : 10000000) || 10000000;

        hideEl(t2Error);
        hideEl(t2Result);
        showEl(t2Status, `FinanceDataReader로 최근 ${years}년 주가를 불러와 백테스트 및 몬테카를로 시뮬레이션을 계산 중입니다...`);
        t2CalcBtn.disabled = true;

        try {
            console.log(`[TAB2] POST /api/rebalance (codes=${rawCodes}, years=${years}, freq=${rebalanceFreq}, mode=${strategyMode}, bench=${benchmark})`);
            const resp = await fetch("/api/rebalance", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    codes: rawCodes,
                    years,
                    rebalance_freq: rebalanceFreq,
                    strategy_mode: strategyMode,
                    benchmark,
                    initial_capital: initialCapital,
                }),
            });
            const data = await resp.json();
            console.log("[TAB2] 응답 수신:", resp.status, data);
            hideEl(t2Status);

            if (!resp.ok || data.error) {
                showEl(t2Error, data.error || "리밸런싱 계산에 실패했습니다.");
                return;
            }

            renderRebalanceResult(data);
            showEl(t2Result);
        } catch (err) {
            console.error("[TAB2] 통신 오류:", err);
            hideEl(t2Status);
            showEl(t2Error, `서버 통신 오류: ${err.message}`);
        } finally {
            t2CalcBtn.disabled = false;
        }
    });

    function renderRebalanceResult(data) {
        const opt = data.optimal_portfolio || {};
        const eq = data.equal_portfolio || {};
        const bench = data.benchmark || null;
        const period = data.period || {};
        const fxRate = data.usd_krw_rate || 1400;

        if (t2FxNote) {
            t2FxNote.textContent = data.usd_krw_rate
                ? `보유 수량(주)을 입력하면 매매 수량을 즉시 계산합니다 (적용 환율: 1 USD = ${formatNum(fxRate, "원")})`
                : "보유 수량(주)을 입력하면 목표 비중에 필요한 매매 수량을 즉시 계산합니다";
        }

        const summaryCards = [
            { label: period.strategy_mode === "momentum" ? "동적 모멘텀 CAGR" : "최적 연평균 복리(CAGR)", value: `${opt.cagr_pct ?? opt.expected_return_pct}%`, hint: `${period.years || 1}년 백테스트 기준 실제 복리 수익률` },
            { label: "최적 최종 평가액", value: formatNum(opt.final_value, "원"), hint: `초기 ${formatNum(data.initial_capital, "원")} 투자 시` },
            { label: "최대 샤프지수 / MDD", value: `${opt.sharpe_ratio} / ${opt.mdd_pct}%`, hint: "위험 대비 초과수익 / 최대 낙폭" },
            { label: "동일비중 CAGR / MDD", value: `${eq.cagr_pct ?? eq.expected_return_pct}% / ${eq.mdd_pct}%`, hint: `최종 ${formatNum(eq.final_value, "원")}` },
            ...(bench ? [{ label: `벤치마크 (${bench.name})`, value: `${bench.cagr_pct}% / ${bench.mdd_pct}%`, hint: `CAGR / MDD (최종 ${formatNum(bench.final_value, "원")})` }] : []),
        ];

        renderMetricCards(t2SummaryGrid, summaryCards);

        // 종목별 테이블 + 실전 매수/매도 수량 계산기
        t2AssetsTbody.innerHTML = "";
        const assets = data.assets || [];
        assets.forEach((a) => {
            const tr = document.createElement("tr");
            const displayName = a.name && a.name !== a.code ? `${a.name} (${a.code})` : a.code;
            const unitPriceKrw = a.currency === "USD" ? (a.latest_price * fxRate) : a.latest_price;
            const targetShares = unitPriceKrw > 0 ? Math.floor(a.target_amount / unitPriceKrw) : 0;

            const nameTd = document.createElement("td");
            nameTd.textContent = displayName;
            tr.appendChild(nameTd);

            const pxTd = document.createElement("td");
            pxTd.textContent = formatPrice(a.latest_price, a.currency || "KRW");
            tr.appendChild(pxTd);

            const wTd = document.createElement("td");
            wTd.textContent = `${a.optimal_weight_pct}%`;
            tr.appendChild(wTd);

            const amtTd = document.createElement("td");
            amtTd.textContent = formatNum(a.target_amount, "원");
            tr.appendChild(amtTd);

            const tgtQtyTd = document.createElement("td");
            tgtQtyTd.textContent = `${targetShares.toLocaleString("ko-KR")}주`;
            tr.appendChild(tgtQtyTd);

            const curQtyTd = document.createElement("td");
            const qtyInput = document.createElement("input");
            qtyInput.type = "number";
            qtyInput.min = "0";
            qtyInput.value = String(t2HoldingsMap[a.code] ?? 0);
            qtyInput.className = "qty-input";
            curQtyTd.appendChild(qtyInput);
            tr.appendChild(curQtyTd);

            const diffTd = document.createElement("td");
            const updateDiff = () => {
                const curQty = Math.max(0, parseInt(qtyInput.value || "0", 10) || 0);
                t2HoldingsMap[a.code] = curQty;
                const diff = targetShares - curQty;
                diffTd.className = "";
                if (diff > 0) {
                    diffTd.classList.add("action-buy");
                    diffTd.textContent = `+${diff.toLocaleString("ko-KR")}주 매수`;
                } else if (diff < 0) {
                    diffTd.classList.add("action-sell");
                    diffTd.textContent = `${diff.toLocaleString("ko-KR")}주 매도`;
                } else {
                    diffTd.classList.add("action-hold");
                    diffTd.textContent = "유지 (0주)";
                }
            };
            updateDiff();
            qtyInput.addEventListener("input", updateDiff);
            tr.appendChild(diffTd);

            [
                `${a.annual_return_pct}%`,
                `${a.annual_volatility_pct}%`,
                `${a.mdd_pct}%`,
            ].forEach((v) => {
                const td = document.createElement("td");
                td.textContent = v;
                tr.appendChild(td);
            });
            t2AssetsTbody.appendChild(tr);
        });

        // 연도별 수익률 표
        const yearly = data.yearly_returns || [];
        if (yearly.length > 0 && t2YearlyCard && t2YearlyTbody) {
            showEl(t2YearlyCard);
            if (t2YearlyBenchTh) {
                t2YearlyBenchTh.textContent = bench ? `벤치마크 (${bench.name})` : "벤치마크";
            }
            t2YearlyTbody.innerHTML = "";
            yearly.forEach((yr) => {
                const tr = document.createElement("tr");
                [
                    `${yr.year}년`,
                    formatReturnRate(yr.optimal_pct),
                    formatReturnRate(yr.equal_pct),
                    yr.benchmark_pct !== null ? formatReturnRate(yr.benchmark_pct) : "-",
                ].forEach((val) => {
                    const td = document.createElement("td");
                    td.textContent = val;
                    tr.appendChild(td);
                });
                t2YearlyTbody.appendChild(tr);
            });
        } else if (t2YearlyCard) {
            hideEl(t2YearlyCard);
        }

        // 누적 자산 성장 곡선 & MDD 추이 차트 (벤치마크 포함)
        const eqCurve = data.equity_curve || [];
        const eqLabels = eqCurve.map((p) => p.date);
        const eqDatasets = [
            { label: period.strategy_mode === "momentum" ? "동적 모멘텀 전략" : "최적 비중 (최대 샤프)", data: eqCurve.map((p) => p.optimal_value), borderColor: "#2563eb", borderWidth: 2, pointRadius: 0 },
            { label: "동일 비중", data: eqCurve.map((p) => p.equal_value), borderColor: "#10b981", borderWidth: 1.8, borderDash: [4, 4], pointRadius: 0 },
        ];
        if (bench) {
            eqDatasets.push({
                label: `벤치마크 (${bench.name})`,
                data: eqCurve.map((p) => p.benchmark_value),
                borderColor: "#f59e0b",
                borderWidth: 1.8,
                borderDash: [2, 2],
                pointRadius: 0,
            });
        }
        if (t2EquityChart) t2EquityChart.destroy();
        t2EquityChart = new Chart(document.getElementById("t2-equity-chart"), {
            type: "line",
            data: { labels: eqLabels, datasets: eqDatasets },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: "index", intersect: false },
            },
        });

        const ddDatasets = [
            { label: "최적/모멘텀 낙폭 (%)", data: eqCurve.map((p) => p.optimal_dd_pct), borderColor: "#dc2626", backgroundColor: "rgba(220,38,38,0.12)", fill: true, borderWidth: 1.8, pointRadius: 0 },
            { label: "동일 비중 낙폭 (%)", data: eqCurve.map((p) => p.equal_dd_pct), borderColor: "#64748b", borderDash: [4, 4], borderWidth: 1.5, pointRadius: 0 },
        ];
        if (bench) {
            ddDatasets.push({
                label: `벤치마크 (${bench.name}) 낙폭 (%)`,
                data: eqCurve.map((p) => p.benchmark_dd_pct),
                borderColor: "#f59e0b",
                borderDash: [2, 2],
                borderWidth: 1.5,
                pointRadius: 0,
            });
        }
        if (t2DdChart) t2DdChart.destroy();
        t2DdChart = new Chart(document.getElementById("t2-dd-chart"), {
            type: "line",
            data: { labels: eqLabels, datasets: ddDatasets },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: "index", intersect: false },
            },
        });

        // 비중 도넛 차트
        if (t2WeightsChart) t2WeightsChart.destroy();
        const palette = ["#2563eb", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4"];
        t2WeightsChart = new Chart(document.getElementById("t2-weights-chart"), {
            type: "doughnut",
            data: {
                labels: assets.map((a) => `${a.name && a.name !== a.code ? a.name : a.code} (${a.optimal_weight_pct}%)`),
                datasets: [{
                    data: assets.map((a) => a.optimal_weight_pct),
                    backgroundColor: assets.map((_, i) => palette[i % palette.length]),
                }],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { position: "bottom" } },
            },
        });

        // 효율적 프론티어 산점도
        if (t2FrontierChart) t2FrontierChart.destroy();
        const points = (data.frontier_points || []).map((p) => ({
            x: p.volatility_pct,
            y: p.return_pct,
        }));
        t2FrontierChart = new Chart(document.getElementById("t2-frontier-chart"), {
            type: "scatter",
            data: {
                datasets: [
                    {
                        label: "시뮬레이션 포트폴리오",
                        data: points,
                        backgroundColor: "rgba(37, 99, 235, 0.35)",
                        pointRadius: 3,
                    },
                    {
                        label: "최대 샤프 (최적)",
                        data: [{ x: opt.volatility_pct, y: opt.expected_return_pct }],
                        backgroundColor: "#dc2626",
                        pointRadius: 8,
                    },
                    {
                        label: "동일 비중",
                        data: [{ x: eq.volatility_pct, y: eq.expected_return_pct }],
                        backgroundColor: "#10b981",
                        pointRadius: 7,
                    },
                ],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    x: { title: { display: true, text: "연 변동성 (%)" } },
                    y: { title: { display: true, text: "연 기대수익률 (%)" } },
                },
            },
        });
    }

    // ==================== 탭 3: 기술지표 차트 + 채팅 ====================
    let t3CurrentCode = "";
    let t3CurrentName = "";
    let t3LatestIndicators = null;
    let t3ConversationId = null;
    let t3PriceChart = null;
    let t3RsiChart = null;
    let t3MacdChart = null;

    const t3Form = document.getElementById("t3-form");
    const t3CodeInput = document.getElementById("t3-code-input");
    const t3AcList = document.getElementById("t3-ac-list");
    const t3LoadBtn = document.getElementById("t3-load-btn");
    const t3Status = document.getElementById("t3-status");
    const t3Error = document.getElementById("t3-error");
    const t3Result = document.getElementById("t3-result");
    const t3ChartTitle = document.getElementById("t3-chart-title");
    const t3LatestGrid = document.getElementById("t3-latest-grid");
    const t3ChatBox = document.getElementById("t3-chat-box");
    const t3ChatForm = document.getElementById("t3-chat-form");
    const t3QueryInput = document.getElementById("t3-query-input");
    const t3SendBtn = document.getElementById("t3-send-btn");
    const t3ResetBtn = document.getElementById("t3-reset-btn");

    document.querySelectorAll(".t3-sample").forEach((btn) => {
        btn.addEventListener("click", () => {
            t3CodeInput.value = btn.dataset.code;
            console.log(`[TAB3] 예시 종목 선택: ${btn.dataset.code}`);
            loadTechnicalData(btn.dataset.code);
        });
    });

    setupAutocomplete(t3CodeInput, t3AcList, (item) => {
        t3CodeInput.value = item.code;
        loadTechnicalData(item.code);
    });

    t3Form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const resolved = await resolveCodeOrSearch(t3CodeInput.value);
        t3CodeInput.value = resolved;
        loadTechnicalData(resolved);
    });

    t3ResetBtn.addEventListener("click", () => {
        t3ConversationId = null;
        t3ChatBox.innerHTML = "";
        appendChatMessage(t3ChatBox, "bot", "지표해석기 대화가 초기화되었습니다. 질문을 입력해 주세요.");
        console.log("[TAB3] 대화 초기화 완료");
    });

    async function loadTechnicalData(rawCode) {
        const code = String(rawCode || "").trim().toUpperCase();
        if (!isValidSymbol(code)) {
            showEl(t3Error, "국내 6자리 숫자 또는 미국 티커(예: AAPL, QQQ)를 입력해 주세요.");
            return;
        }
        t3CodeInput.value = code;

        hideEl(t3Error);
        showEl(t3Status, `종목코드 ${code}의 주가 및 기술지표를 계산 중입니다...`);
        t3LoadBtn.disabled = true;

        try {
            console.log(`[TAB3] POST /api/technical (code=${code})`);
            const resp = await fetch("/api/technical", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ code }),
            });
            const data = await resp.json();
            console.log("[TAB3] 기술지표 수신:", resp.status, data.latest);
            hideEl(t3Status);

            if (!resp.ok || data.error) {
                showEl(t3Error, data.error || "기술지표 조회에 실패했습니다.");
                return;
            }

            t3CurrentCode = data.code;
            t3CurrentName = data.name || data.code;
            t3LatestIndicators = data.latest;
            t3ConversationId = null;

            renderTechnicalCharts(data);
            showEl(t3Result);
        } catch (err) {
            console.error("[TAB3] 통신 오류:", err);
            hideEl(t3Status);
            showEl(t3Error, `서버 통신 오류: ${err.message}`);
        } finally {
            t3LoadBtn.disabled = false;
        }
    }

    function renderTechnicalCharts(data) {
        const latest = data.latest || {};
        const series = data.series || [];
        const labels = series.map((s) => s.date);

        const displayTarget = data.name && data.name !== data.code ? `${data.name} (${data.code})` : data.code;
        t3ChartTitle.textContent = `최신 기술지표 요약 (${displayTarget} · 기준일 ${latest.date || "-"})`;
        syncFavButton(t3FavBtn, data.code, data.name || data.code);

        const latestCards = [
            { label: "종가", value: formatPrice(latest.close, data.currency || "KRW"), hint: "최근 거래일 마감 가격" },
            { label: "MA5 / MA20", value: `${formatNum(latest.ma5)} / ${formatNum(latest.ma20)}`, hint: "5일(단기) / 20일(중기) 이동평균선" },
            { label: "MA60", value: formatNum(latest.ma60), hint: "60일(수급) 이동평균선" },
            { label: "RSI (14)", value: latest.rsi14 ?? "-", hint: "70↑ 과매수(과열) / 30↓ 과매도(침체)" },
            { label: "MACD / Signal", value: `${latest.macd ?? "-"} / ${latest.macd_signal ?? "-"}`, hint: "추세 전환 지표 (MACD > Signal이면 상승세)" },
            { label: "볼린저 상/하단", value: `${formatNum(latest.bb_upper)} / ${formatNum(latest.bb_lower)}`, hint: "주가 변동 범위(상단 과열 / 하단 침체)" },
        ];

        renderMetricCards(t3LatestGrid, latestCards);

        // 1. 주가 + MA + 볼린저 차트
        if (t3PriceChart) t3PriceChart.destroy();
        t3PriceChart = new Chart(document.getElementById("t3-price-chart"), {
            type: "line",
            data: {
                labels,
                datasets: [
                    { label: "종가", data: series.map((s) => s.close), borderColor: "#0f172a", borderWidth: 2, pointRadius: 0 },
                    { label: "MA5", data: series.map((s) => s.ma5), borderColor: "#ef4444", borderWidth: 1.5, pointRadius: 0 },
                    { label: "MA20", data: series.map((s) => s.ma20), borderColor: "#f59e0b", borderWidth: 1.5, pointRadius: 0 },
                    { label: "MA60", data: series.map((s) => s.ma60), borderColor: "#10b981", borderWidth: 1.5, pointRadius: 0 },
                    { label: "볼린저 상단", data: series.map((s) => s.bb_upper), borderColor: "#94a3b8", borderDash: [4, 4], borderWidth: 1, pointRadius: 0 },
                    { label: "볼린저 하단", data: series.map((s) => s.bb_lower), borderColor: "#94a3b8", borderDash: [4, 4], borderWidth: 1, pointRadius: 0 },
                ],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: "index", intersect: false },
            },
        });

        // 2. RSI 차트
        if (t3RsiChart) t3RsiChart.destroy();
        t3RsiChart = new Chart(document.getElementById("t3-rsi-chart"), {
            type: "line",
            data: {
                labels,
                datasets: [
                    { label: "RSI (14)", data: series.map((s) => s.rsi14), borderColor: "#2563eb", borderWidth: 2, pointRadius: 0 },
                    { label: "과매수 (70)", data: labels.map(() => 70), borderColor: "#ef4444", borderDash: [4, 4], borderWidth: 1, pointRadius: 0 },
                    { label: "과매도 (30)", data: labels.map(() => 30), borderColor: "#10b981", borderDash: [4, 4], borderWidth: 1, pointRadius: 0 },
                ],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: { y: { min: 0, max: 100 } },
            },
        });

        // 3. MACD 차트
        if (t3MacdChart) t3MacdChart.destroy();
        t3MacdChart = new Chart(document.getElementById("t3-macd-chart"), {
            type: "bar",
            data: {
                labels,
                datasets: [
                    {
                        type: "line",
                        label: "MACD",
                        data: series.map((s) => s.macd),
                        borderColor: "#2563eb",
                        borderWidth: 2,
                        pointRadius: 0,
                    },
                    {
                        type: "line",
                        label: "Signal",
                        data: series.map((s) => s.macd_signal),
                        borderColor: "#f59e0b",
                        borderWidth: 1.5,
                        pointRadius: 0,
                    },
                    {
                        type: "bar",
                        label: "Histogram",
                        data: series.map((s) => s.macd_hist),
                        backgroundColor: series.map((s) => (s.macd_hist >= 0 ? "rgba(220,38,38,0.45)" : "rgba(37,99,235,0.45)")),
                    },
                ],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
            },
        });
    }

    t3ChatForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const query = t3QueryInput.value.trim();
        if (!query) return;
        if (!t3CurrentCode || !t3LatestIndicators) {
            showEl(t3Error, "먼저 위에서 '차트 & 지표 불러오기'를 실행해 주세요.");
            return;
        }

        hideEl(t3Error);
        appendChatMessage(t3ChatBox, "user", query);
        t3QueryInput.value = "";
        t3SendBtn.disabled = true;

        const loadingBubble = appendChatMessage(t3ChatBox, "bot", "계산된 기술지표를 바탕으로 설명을 생성 중입니다...");

        try {
            console.log(`[TAB3] POST /api/chat/technical (code=${t3CurrentCode}, hidden indicators injected)`);
            const resp = await fetch("/api/chat/technical", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    code: t3CurrentCode,
                    stock_name: t3CurrentName,
                    query,
                    indicators: t3LatestIndicators,
                    conversation_id: t3ConversationId,
                }),
            });
            const data = await resp.json();
            console.log("[TAB3] 응답 수신:", resp.status, data);

            if (!resp.ok || data.error) {
                loadingBubble.textContent = `오류: ${data.error || "답변을 받지 못했습니다."}`;
                showEl(t3Error, data.error || "요청 처리 중 오류가 발생했습니다.");
                return;
            }

            t3ConversationId = data.conversation_id || t3ConversationId;
            renderMarkdown(loadingBubble, data.answer || "(빈 응답)");
        } catch (err) {
            console.error("[TAB3] 통신 오류:", err);
            loadingBubble.textContent = `서버 통신 오류: ${err.message}`;
            showEl(t3Error, `서버 통신 오류: ${err.message}`);
        } finally {
            t3SendBtn.disabled = false;
        }
    });

    // ==================== 탭 4: DART 공시·재무 ====================
    let t4CachedDartData = null;
    let t4ConversationId = null;
    let t4CfChart = null;
    let t4ShareholderChart = null;

    const t4Form = document.getElementById("t4-form");
    const t4CodeInput = document.getElementById("t4-code-input");
    const t4AcList = document.getElementById("t4-ac-list");
    const t4LoadBtn = document.getElementById("t4-load-btn");
    const t4ResetBtn = document.getElementById("t4-reset-btn");
    const t4Status = document.getElementById("t4-status");
    const t4Error = document.getElementById("t4-error");
    const t4Result = document.getElementById("t4-result");
    const t4CompanyTitle = document.getElementById("t4-company-title");
    const t4HomepageLink = document.getElementById("t4-homepage-link");
    const t4CompanyGrid = document.getElementById("t4-company-grid");
    const t4CfCard = document.getElementById("t4-cf-card");
    const t4CfTitle = document.getElementById("t4-cf-title");
    const t4CfBadge = document.getElementById("t4-cf-badge");
    const t4CfGrid = document.getElementById("t4-cf-grid");
    const t4DiscTbody = document.getElementById("t4-disc-tbody");
    const t4InsiderTbody = document.getElementById("t4-insider-tbody");
    const t4ShareholderCard = document.getElementById("t4-shareholder-card");
    const t4ShareholderTitle = document.getElementById("t4-shareholder-title");
    const t4ShareholderTotal = document.getElementById("t4-shareholder-total");
    const t4ShareholderTbody = document.getElementById("t4-shareholder-tbody");
    const t4OrgCard = document.getElementById("t4-org-card");
    const t4OrgTitle = document.getElementById("t4-org-title");
    const t4OrgTree = document.getElementById("t4-org-tree");
    const t4ExecTbody = document.getElementById("t4-exec-tbody");
    const t4ChatBox = document.getElementById("t4-chat-box");
    const t4ChatForm = document.getElementById("t4-chat-form");
    const t4QueryInput = document.getElementById("t4-query-input");
    const t4SendBtn = document.getElementById("t4-send-btn");

    document.querySelectorAll(".t4-sample").forEach((btn) => {
        btn.addEventListener("click", () => {
            t4CodeInput.value = btn.dataset.code;
            runTab4DartAndAnalyze(btn.dataset.code);
        });
    });

    setupAutocomplete(t4CodeInput, t4AcList, (item) => {
        t4CodeInput.value = item.code;
        runTab4DartAndAnalyze(item.code);
    });

    t4Form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const resolved = await resolveCodeOrSearch(t4CodeInput.value);
        t4CodeInput.value = resolved;
        runTab4DartAndAnalyze(resolved);
    });

    t4ResetBtn.addEventListener("click", () => {
        t4ConversationId = null;
        t4ChatBox.innerHTML = "";
        appendChatMessage(t4ChatBox, "bot", "DART 공시 대화가 초기화되었습니다. 상단에서 기업을 조회하거나 질문을 입력해 주세요.", true);
        hideEl(t4Error);
    });

    function renderTab4DartDashboard(data) {
        const comp = data.company || {};
        t4CompanyTitle.textContent = `${data.name} (${data.code}) · DART 공식 개황`;
        syncFavButton(t4FavBtn, data.code, data.name);
        if (comp.hm_url) {
            const url = comp.hm_url.startsWith("http") ? comp.hm_url : `https://${comp.hm_url}`;
            t4HomepageLink.href = url;
            showEl(t4HomepageLink);
        } else {
            hideEl(t4HomepageLink);
        }

        const estFormatted = comp.est_dt && comp.est_dt.length === 8
            ? `${comp.est_dt.slice(0, 4)}-${comp.est_dt.slice(4, 6)}-${comp.est_dt.slice(6, 8)}`
            : (comp.est_dt || "-");

        renderMetricCards(t4CompanyGrid, [
            { label: "대표이사", value: comp.ceo_name || "-" },
            { label: "상장 시장", value: comp.market || "-" },
            { label: "설립일", value: estFormatted },
            { label: "결산월", value: comp.acc_mt ? `${comp.acc_mt}월` : "-" },
            { label: "DART 고유번호", value: data.corp_code || "-" },
        ]);

        // 현금흐름표 & 재무상태
        const fh = data.financial_health;
        if (fh && fh.cashflow) {
            showEl(t4CfCard);
            const cf = fh.cashflow;
            const bs = fh.balance || {};
            t4CfTitle.textContent = `현금흐름표 & 재무상태 (${fh.bsns_year}년 ${fh.fs_type} 기준 · 단위: 억원)`;
            t4CfBadge.textContent = fh.health_label || "-";

            renderMetricCards(t4CfGrid, [
                { label: "영업활동 현금흐름", value: formatNum(cf.operating, "억"), hint: "본업으로 실제 들어온 현금 (+일수록 우수)" },
                { label: "투자활동 현금흐름", value: formatNum(cf.investing, "억"), hint: "설비/미래 투자 (-면 적극 투자 중)" },
                { label: "재무활동 현금흐름", value: formatNum(cf.financing, "억"), hint: "차입/상환/배당 (+면 자금 조달, -면 빚 상환·배당)" },
                { label: "자산총계", value: formatNum(bs.assets, "억") },
                { label: "부채총계", value: formatNum(bs.liabilities, "억") },
                { label: "자본총계", value: formatNum(bs.equity, "억") },
            ]);

            if (t4CfChart) t4CfChart.destroy();
            const cfVals = [cf.operating, cf.investing, cf.financing];
            t4CfChart = new Chart(document.getElementById("t4-cf-chart"), {
                type: "bar",
                data: {
                    labels: ["영업활동 현금흐름", "투자활동 현금흐름", "재무활동 현금흐름"],
                    datasets: [{
                        label: "현금흐름 (억원)",
                        data: cfVals,
                        backgroundColor: cfVals.map((v) => (v !== null && v >= 0 ? "rgba(16, 185, 129, 0.75)" : "rgba(239, 68, 68, 0.75)")),
                    }],
                },
                options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } },
            });
        } else {
            hideEl(t4CfCard);
        }

        // 최근 공시 피드
        t4DiscTbody.innerHTML = "";
        const discs = data.disclosures || [];
        if (discs.length === 0) {
            t4DiscTbody.innerHTML = `<tr><td colspan="4" style="text-align:center;">최근 90일 내 공시가 없습니다.</td></tr>`;
        } else {
            const tagClassMap = {
                "호재": "disc-tag-good",
                "주의": "disc-tag-warn",
                "실적": "disc-tag-perf",
                "일반": "disc-tag-etc",
            };
            discs.forEach((d) => {
                const tr = document.createElement("tr");
                const dtStr = d.rcept_dt && d.rcept_dt.length === 8
                    ? `${d.rcept_dt.slice(0, 4)}-${d.rcept_dt.slice(4, 6)}-${d.rcept_dt.slice(6, 8)}`
                    : (d.rcept_dt || "-");

                const dtTd = document.createElement("td");
                dtTd.textContent = dtStr;
                tr.appendChild(dtTd);

                const tagTd = document.createElement("td");
                const tagSpan = document.createElement("span");
                tagSpan.className = `disc-tag ${tagClassMap[d.tag] || "disc-tag-etc"}`;
                tagSpan.textContent = d.tag || "일반";
                tagTd.appendChild(tagSpan);
                tr.appendChild(tagTd);

                const nmTd = document.createElement("td");
                const a = document.createElement("a");
                a.href = d.url || "#";
                a.target = "_blank";
                a.rel = "noopener noreferrer";
                a.textContent = d.report_nm || "-";
                a.style.color = "#1d4ed8";
                a.style.textDecoration = "none";
                nmTd.appendChild(a);
                tr.appendChild(nmTd);

                const flrTd = document.createElement("td");
                flrTd.textContent = d.flr_nm || "-";
                tr.appendChild(flrTd);

                t4DiscTbody.appendChild(tr);
            });
        }

        // 임원·주요주주 지분 변동
        t4InsiderTbody.innerHTML = "";
        const insiders = data.insider_trades || [];
        if (insiders.length === 0) {
            t4InsiderTbody.innerHTML = `<tr><td colspan="6" style="text-align:center;">최근 임원·주요주주 지분 변동 보고 내역이 없습니다.</td></tr>`;
        } else {
            insiders.forEach((row) => {
                const tr = document.createElement("tr");
                const dtStr = row.rcept_dt && row.rcept_dt.length === 8
                    ? `${row.rcept_dt.slice(0, 4)}-${row.rcept_dt.slice(4, 6)}-${row.rcept_dt.slice(6, 8)}`
                    : (row.rcept_dt || "-");
                [
                    dtStr,
                    row.repror || "-",
                    row.position || "-",
                    row.shares || "-",
                    row.shares_diff || "-",
                    row.rate ? `${row.rate}%` : "-",
                ].forEach((v) => {
                    const td = document.createElement("td");
                    td.textContent = v;
                    tr.appendChild(td);
                });
                t4InsiderTbody.appendChild(tr);
            });
        }

        // 최대주주 및 특수관계인 지분율
        const gov = data.governance || {};
        const shList = gov.shareholders || [];
        if (shList.length > 0 && t4ShareholderCard) {
            showEl(t4ShareholderCard);
            if (t4ShareholderTitle) {
                t4ShareholderTitle.textContent = `최대주주 및 특수관계인 지분율 (${gov.bsns_year || ""}년 사업보고서 기준)`;
            }
            if (t4ShareholderTotal) {
                t4ShareholderTotal.textContent = `최대주주 측 합계 ${gov.total_major_rate_pct ?? 0}%`;
            }
            t4ShareholderTbody.innerHTML = "";
            shList.forEach((s) => {
                const tr = document.createElement("tr");
                [s.name, s.relation, s.shares, `${s.rate_pct}%`].forEach((v) => {
                    const td = document.createElement("td");
                    td.textContent = v;
                    tr.appendChild(td);
                });
                t4ShareholderTbody.appendChild(tr);
            });

            const topSh = shList.slice(0, 6);
            const topSum = topSh.reduce((acc, x) => acc + x.rate_pct, 0);
            const otherRate = Math.max(0, Number((100 - topSum).toFixed(2)));
            const chartLabels = [...topSh.map((x) => `${x.name} (${x.rate_pct}%)`), `기타 주주 (${otherRate}%)`];
            const chartVals = [...topSh.map((x) => x.rate_pct), otherRate];
            const palette = ["#7c3aed", "#38bdf8", "#a78bfa", "#0ea5e9", "#c4b5fd", "#7dd3fc", "#3f3f46"];

            if (t4ShareholderChart) t4ShareholderChart.destroy();
            t4ShareholderChart = new Chart(document.getElementById("t4-shareholder-chart"), {
                type: "doughnut",
                data: {
                    labels: chartLabels,
                    datasets: [{
                        data: chartVals,
                        backgroundColor: chartVals.map((_, i) => palette[i % palette.length]),
                        borderColor: "#09090b",
                        borderWidth: 2,
                    }],
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: { legend: { position: "bottom" } },
                },
            });
        } else if (t4ShareholderCard) {
            hideEl(t4ShareholderCard);
        }

        // 조직도 · 사업부문 & 현재 임원 현황
        const execList = gov.executives || [];
        const orgList = gov.org_divisions || [];
        if ((execList.length > 0 || orgList.length > 0) && t4OrgCard) {
            showEl(t4OrgCard);
            if (t4OrgTitle) {
                t4OrgTitle.textContent = `조직도 · 사업부문 & 현재 임원 현황 (${gov.bsns_year || ""}년 기준)`;
            }

            // 조직도 트리 렌더링
            t4OrgTree.innerHTML = "";
            const ceoNames = execList
                .filter((e) => (e.role_type || "").includes("사내이사"))
                .slice(0, 4)
                .map((e) => `${e.name} ${e.position}`)
                .join(" · ");

            const rootDiv = document.createElement("div");
            rootDiv.className = "org-root";
            rootDiv.innerHTML = `<div class="org-root-title"></div><div class="org-root-sub"></div>`;
            rootDiv.querySelector(".org-root-title").textContent = `${data.name} (대표: ${comp.ceo_name || "-"})`;
            rootDiv.querySelector(".org-root-sub").textContent = ceoNames ? `사내이사: ${ceoNames}` : `등기임원 ${execList.length}명`;
            t4OrgTree.appendChild(rootDiv);

            if (orgList.length > 0) {
                const conn = document.createElement("div");
                conn.className = "org-connector";
                t4OrgTree.appendChild(conn);

                const branches = document.createElement("div");
                branches.className = "org-branches";
                orgList.forEach((d) => {
                    const node = document.createElement("div");
                    node.className = "org-node";
                    node.innerHTML = `<div class="org-node-title"></div><div class="org-node-meta"></div>`;
                    node.querySelector(".org-node-title").textContent = d.division;
                    node.querySelector(".org-node-meta").textContent =
                        `임직원 ${d.total_employees.toLocaleString("ko-KR")}명` +
                        (d.avg_tenure ? ` · 평균근속 ${d.avg_tenure}년` : "");
                    branches.appendChild(node);
                });
                t4OrgTree.appendChild(branches);
            }

            // 현재 임원 테이블
            t4ExecTbody.innerHTML = "";
            if (execList.length === 0) {
                t4ExecTbody.innerHTML = `<tr><td colspan="5" style="text-align:center;">조회된 등기임원 현황이 없습니다.</td></tr>`;
            } else {
                execList.forEach((ex) => {
                    const tr = document.createElement("tr");
                    [ex.name, ex.position, `${ex.role_type} (${ex.full_time})`, ex.job, ex.tenure].forEach((v) => {
                        const td = document.createElement("td");
                        td.textContent = v;
                        tr.appendChild(td);
                    });
                    t4ExecTbody.appendChild(tr);
                });
            }
        } else if (t4OrgCard) {
            hideEl(t4OrgCard);
        }
    }

    async function runTab4DartAndAnalyze(rawCode) {
        const code = String(rawCode || "").trim().toUpperCase();
        if (!/^\d{6}$/.test(code)) {
            showEl(t4Error, "DART 공시는 국내 상장 6자리 숫자 종목코드만 지원합니다. (예: 005930)");
            return;
        }
        t4CodeInput.value = code;
        hideEl(t4Error);
        showEl(t4Status, `1단계: Open DART에서 ${code}의 공식 공시·현금흐름표·지분변동 데이터를 수집 중입니다...`);
        t4LoadBtn.disabled = true;
        t4SendBtn.disabled = true;

        try {
            const resp = await fetch("/api/dart", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ code }),
            });
            const dartData = await resp.json();
            if (!resp.ok || dartData.error) {
                hideEl(t4Status);
                showEl(t4Error, dartData.error || "DART 데이터 조회에 실패했습니다.");
                return;
            }

            t4CachedDartData = dartData;
            t4ConversationId = null;
            renderTab4DartDashboard(dartData);
            showEl(t4Result);

            showEl(t4Status, `2단계: ${dartData.name}(${dartData.code}) DART 공시를 AI가 초보자 눈높이로 번역·분석 중입니다...`);
            t4ChatBox.innerHTML = "";
            appendChatMessage(t4ChatBox, "user", `[${dartData.name} (${dartData.code})] DART 공시 · 현금흐름 · 지분변동 AI 분석 요청`);
            const loadingBubble = appendChatMessage(t4ChatBox, "bot", "공식 공시와 현금흐름표를 분석 중입니다...");

            const chatResp = await fetch("/api/chat/dart", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    code: dartData.code,
                    mode: "init",
                    dart_data: dartData,
                }),
            });
            const chatData = await chatResp.json();
            hideEl(t4Status);

            if (!chatResp.ok || chatData.error) {
                loadingBubble.textContent = `오류: ${chatData.error || "AI 공시 분석을 생성하지 못했습니다."}`;
                showEl(t4Error, chatData.error || "DART AI 분석 실패");
                return;
            }

            t4ConversationId = chatData.conversation_id || null;
            renderMarkdown(loadingBubble, chatData.answer || "(빈 응답)");
        } catch (err) {
            hideEl(t4Status);
            showEl(t4Error, `서버 통신 오류: ${err.message}`);
        } finally {
            t4LoadBtn.disabled = false;
            t4SendBtn.disabled = false;
        }
    }

    t4ChatForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const code = t4CodeInput.value.trim().toUpperCase();
        const query = t4QueryInput.value.trim();
        if (!query) return;

        if (t4CachedDartData && code && t4CachedDartData.code !== code) {
            t4CachedDartData = null;
            t4ConversationId = null;
        }
        if (!t4CachedDartData && !/^\d{6}$/.test(code)) {
            showEl(t4Error, "국내 6자리 종목코드를 먼저 조회해 주세요.");
            return;
        }

        hideEl(t4Error);
        appendChatMessage(t4ChatBox, "user", query);
        t4QueryInput.value = "";
        t4SendBtn.disabled = true;

        const loadingBubble = appendChatMessage(t4ChatBox, "bot", "DART 공시 근거를 바탕으로 답변을 작성 중입니다...");

        try {
            const resp = await fetch("/api/chat/dart", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    code,
                    query,
                    mode: "chat",
                    conversation_id: t4ConversationId,
                    dart_data: t4CachedDartData,
                }),
            });
            const data = await resp.json();
            if (!resp.ok || data.error) {
                loadingBubble.textContent = `오류: ${data.error || "답변을 받지 못했습니다."}`;
                showEl(t4Error, data.error || "요청 처리 중 오류가 발생했습니다.");
                return;
            }
            t4ConversationId = data.conversation_id || t4ConversationId;
            renderMarkdown(loadingBubble, data.answer || "(빈 응답)");
        } catch (err) {
            loadingBubble.textContent = `서버 통신 오류: ${err.message}`;
            showEl(t4Error, `서버 통신 오류: ${err.message}`);
        } finally {
            t4SendBtn.disabled = false;
        }
    });

    // ==================== 좌우 사이드 위젯 로직 ====================
    // 1. 주요 시장 지수 & 환율
    const sideIndicesList = document.getElementById("side-indices-list");
    const sideIndicesRefresh = document.getElementById("side-indices-refresh");

    async function loadMarketIndices() {
        if (!sideIndicesList) return;
        try {
            const resp = await fetch("/api/market_indices");
            const data = await resp.json();
            const items = data.items || [];
            if (items.length === 0) {
                sideIndicesList.innerHTML = `<div class="unit-note">지수 정보를 불러오지 못했습니다.</div>`;
                return;
            }
            sideIndicesList.innerHTML = "";
            items.forEach((it) => {
                const row = document.createElement("div");
                row.className = "side-index-row";
                const isUp = it.change_pct > 0;
                const isDown = it.change_pct < 0;
                const cls = isUp ? "up" : isDown ? "down" : "flat";
                const sign = isUp ? "+" : "";
                row.innerHTML = `
                    <span class="side-index-name"></span>
                    <div class="side-index-val">
                        <div class="idx-px"></div>
                        <div class="idx-chg ${cls}" style="font-size:0.74rem;"></div>
                    </div>
                `;
                row.querySelector(".side-index-name").textContent = it.name;
                row.querySelector(".idx-px").textContent = Number(it.price).toLocaleString("ko-KR", { maximumFractionDigits: 2 });
                row.querySelector(".idx-chg").textContent = `${sign}${it.change_pct}%`;
                sideIndicesList.appendChild(row);
            });
        } catch {
            sideIndicesList.innerHTML = `<div class="unit-note">지수 조회 실패</div>`;
        }
    }

    if (sideIndicesRefresh) {
        sideIndicesRefresh.addEventListener("click", loadMarketIndices);
    }
    loadMarketIndices();

    // 2. 최근 조회 종목 히스토리
    const RECENT_KEY = "mia_recent_v1";
    const sideRecentList = document.getElementById("side-recent-list");
    const sideRecentClear = document.getElementById("side-recent-clear");

    function loadRecentStocks() {
        try { return JSON.parse(localStorage.getItem(RECENT_KEY) || "[]"); }
        catch { return []; }
    }

    function renderRecentStocks() {
        if (!sideRecentList) return;
        const list = loadRecentStocks();
        sideRecentList.innerHTML = "";
        if (list.length === 0) {
            sideRecentList.innerHTML = `<div class="unit-note">조회한 종목이 여기에 쌓입니다.</div>`;
            return;
        }
        list.forEach((it) => {
            const btn = document.createElement("button");
            btn.type = "button";
            btn.className = "side-recent-btn";
            btn.innerHTML = `<span class="r-name"></span><span class="unit-note"></span>`;
            btn.querySelector(".r-name").textContent = it.name;
            btn.querySelector(".unit-note").textContent = it.code;
            btn.addEventListener("click", () => {
                document.querySelector('.tab-btn[data-tab="tab-analysis"]')?.click();
                t1CodeInput.value = it.code;
                runTab1FetchAndAnalyze(it.code);
            });
            sideRecentList.appendChild(btn);
        });
    }

    function recordRecentStock(code, name) {
        if (!code) return;
        const next = [{ code, name: name || code }, ...loadRecentStocks().filter((x) => x.code !== code)].slice(0, 7);
        localStorage.setItem(RECENT_KEY, JSON.stringify(next));
        renderRecentStocks();
    }

    if (sideRecentClear) {
        sideRecentClear.addEventListener("click", () => {
            localStorage.removeItem(RECENT_KEY);
            renderRecentStocks();
        });
    }
    renderRecentStocks();

    // 3. 빠른 이동 리모컨 (활성 탭에 맞춰 동적 변경)
    const TAB_JUMP_MAP = {
        "tab-analysis": [
            { label: "↑ 맨 위로", target: "top" },
            { label: "종목 검색 & 100만원 추천", target: "tab-analysis" },
            { label: "주가 변동 그래프", target: "t1-price-card" },
            { label: "스냅샷 · 재무 · 뉴스", target: "t1-stock-view" },
            { label: "AI 애널리스트 채팅", target: "t1-chat-box" },
        ],
        "tab-rebalance": [
            { label: "↑ 맨 위로", target: "top" },
            { label: "종목 조합 & 백테스트 설정", target: "tab-rebalance" },
            { label: "누적 성장 · MDD 차트", target: "t2-equity-chart" },
            { label: "적정 비중 · 프론티어", target: "t2-weights-chart" },
            { label: "매수/매도 수량 계산기", target: "t2-assets-tbody" },
            { label: "연도별 수익률 비교", target: "t2-yearly-card" },
        ],
        "tab-technical": [
            { label: "↑ 맨 위로", target: "top" },
            { label: "종목 선택 & 지표 요약", target: "tab-technical" },
            { label: "주가 · 이동평균 · 볼린저", target: "t3-price-chart" },
            { label: "RSI · MACD 차트", target: "t3-rsi-chart" },
            { label: "지표해석기 AI 채팅", target: "t3-chat-box" },
        ],
        "tab-dart": [
            { label: "↑ 맨 위로", target: "top" },
            { label: "기업 개황 & 현금흐름", target: "t4-company-title" },
            { label: "최근 90일 주요 공시", target: "t4-disc-tbody" },
            { label: "임원 지분변동 & 주주 지분율", target: "t4-insider-tbody" },
            { label: "조직도 & 현재 임원", target: "t4-org-card" },
            { label: "DART AI 공시 채팅", target: "t4-chat-box" },
        ],
    };

    const sideJumpList = document.querySelector(".side-jump-list");
    function renderJumpRemote(tabId) {
        if (!sideJumpList) return;
        const items = TAB_JUMP_MAP[tabId] || TAB_JUMP_MAP["tab-analysis"];
        sideJumpList.innerHTML = "";
        items.forEach((item) => {
            const btn = document.createElement("button");
            btn.type = "button";
            btn.className = "side-jump-btn";
            btn.textContent = item.label;
            btn.addEventListener("click", () => {
                if (item.target === "top") {
                    window.scrollTo({ top: 0, behavior: "smooth" });
                    return;
                }
                const el = document.getElementById(item.target);
                if (!el) return;
                const scrollTarget = el.closest(".card") || el;
                scrollTarget.scrollIntoView({ behavior: "smooth", block: "start" });
            });
            sideJumpList.appendChild(btn);
        });
    }
    renderJumpRemote(document.querySelector(".tab-btn.active")?.dataset.tab || "tab-analysis");

    // 4. 물타기 · 평단가 계산기
    const calcCurPrice = document.getElementById("calc-cur-price");
    const calcCurQty = document.getElementById("calc-cur-qty");
    const calcAddPrice = document.getElementById("calc-add-price");
    const calcAddQty = document.getElementById("calc-add-qty");
    const calcResult = document.getElementById("calc-result");

    function updateAvgCalculator() {
        if (!calcResult) return;
        const p1 = parseFloat(calcCurPrice?.value || "0") || 0;
        const q1 = parseFloat(calcCurQty?.value || "0") || 0;
        const p2 = parseFloat(calcAddPrice?.value || "0") || 0;
        const q2 = parseFloat(calcAddQty?.value || "0") || 0;
        const totalQty = q1 + q2;
        if (totalQty <= 0 || (p1 <= 0 && p2 <= 0)) {
            calcResult.textContent = "평단가와 수량을 입력하면 자동 계산됩니다.";
            return;
        }
        const totalCost = p1 * q1 + p2 * q2;
        const newAvg = totalCost / totalQty;
        const diffPct = p1 > 0 ? ((newAvg - p1) / p1) * 100 : 0;
        calcResult.innerHTML = `
            <div>새 평단가: <strong>${newAvg.toLocaleString("ko-KR", { maximumFractionDigits: 2 })}</strong> (${diffPct >= 0 ? "+" : ""}${diffPct.toFixed(1)}%)</div>
            <div>총 수량: <strong>${totalQty.toLocaleString("ko-KR")}주</strong> · 총액: <strong>${Math.round(totalCost).toLocaleString("ko-KR")}</strong></div>
        `;
    }

    [calcCurPrice, calcCurQty, calcAddPrice, calcAddQty].forEach((el) => {
        if (el) el.addEventListener("input", updateAvgCalculator);
    });

    // 5. 내 투자 메모장
    const MEMO_KEY = "mia_memo_v1";
    const sideMemoInput = document.getElementById("side-memo-input");
    const sideMemoStatus = document.getElementById("side-memo-status");
    if (sideMemoInput) {
        sideMemoInput.value = localStorage.getItem(MEMO_KEY) || "";
        sideMemoInput.addEventListener("input", () => {
            localStorage.setItem(MEMO_KEY, sideMemoInput.value);
            if (sideMemoStatus) sideMemoStatus.textContent = "저장됨 ✓";
        });
    }

    // 6. 초보자 용어 미니사전 (내장 사전 + AI 검색 폴백)
    const GLOSSARY_DICT = {
        "PER": "주가수익비율(주가÷주당순이익). 회사가 버는 이익 대비 주가가 몇 배인지 나타내며, 보통 낮을수록 저평가로 봅니다.",
        "PBR": "주가순자산비율(주가÷주당순자산). 회사 순자산(청산가치) 대비 주가 수준이며, 1배 미만이면 자산가치보다 싸게 거래된다는 뜻입니다.",
        "ROE": "자기자본이익률. 회사가 자기자본을 활용해 1년간 얼마의 순이익을 냈는지 보여주는 수익성 지표로 높을수록 좋습니다.",
        "EPS": "주당순이익(순이익÷총주식수). 주식 1주가 1년 동안 벌어들이는 순이익 금액입니다.",
        "BPS": "주당순자산가치(순자산÷총주식수). 회사가 지금 청산될 때 주식 1주당 돌아갈 수 있는 장부상 가치입니다.",
        "시가총액": "현재 주가 × 상장주식수. 시장에서 평가하는 기업의 전체 몸값입니다.",
        "배당수익률": "현재 주가 대비 1년간 받는 배당금 비율(%)입니다. 예금 이자율과 비교해 볼 수 있습니다.",
        "컨센서스": "증권사 애널리스트들이 추정한 실적·목표주가의 평균 예측치입니다.",
        "ETF": "상장지수펀드. 코스피200, S&P500 같은 지수나 테마를 추종하며 주식처럼 실시간 거래할 수 있는 펀드입니다.",
        "NAV": "순자산가치. ETF 1좌(1주)가 실제로 보유한 자산들의 순수한 가치입니다.",
        "괴리율": "ETF의 시장 거래 가격과 실제 가치(NAV) 사이의 차이(%)입니다. 0%에 가까울수록 제값에 거래되는 것입니다.",
        "총보수": "ETF 운용사가 1년 동안 떼어가는 관리 수수료율(%)입니다. 장기 투자할수록 낮을수록 유리합니다.",
        "분배금": "ETF가 보유한 주식의 배당금 등을 모아 투자자에게 나눠주는 돈(주식 배당과 같은 개념)입니다.",
        "MDD": "최대낙폭(Maximum Drawdown). 투자 기간 중 고점 대비 가장 크게 떨어졌던 하락 폭(%)입니다.",
        "샤프지수": "위험(변동성) 1단위당 얻은 초과수익입니다. 숫자가 높을수록 같은 위험 대비 성과가 좋은 포트폴리오입니다.",
        "CAGR": "연평균 복리 수익률. 여러 해 동안의 수익을 매년 똑같은 복리로 불어났다고 환산한 실질 성장률입니다.",
        "리밸런싱": "주가가 오르내려 틀어진 포트폴리오 비중을 원래 목표 비중으로 다시 맞추는 작업입니다.",
        "모멘텀": "주가가 상승하거나 하락하는 추세의 힘입니다. 보통 이동평균선 위면 상승 모멘텀으로 봅니다.",
        "이동평균선": "최근 N일간의 종가 평균을 이은 선(MA5, MA20, MA60 등)으로 주가의 흐름과 지지/저항을 봅니다.",
        "RSI": "상대강도지수(0~100). 보통 70 이상이면 단기 과매수(과열), 30 이하면 과매도(침체) 구간으로 해석합니다.",
        "MACD": "단기 이동평균과 장기 이동평균의 차이로 추세 전환을 포착하는 지표입니다. Signal선을 상향 돌파하면 매수 신호로 봅니다.",
        "볼린저밴드": "이동평균선 위아래로 표준편차 범위를 그린 밴드입니다. 주가가 상단에 닿으면 과열, 하단에 닿으면 침체 가능성을 봅니다.",
        "유상증자": "회사가 새 주식을 발행해 돈을 받고 자본금을 늘리는 것입니다. 기존 주주 지분이 희석될 수 있어 목적을 꼭 확인해야 합니다.",
        "전환사채": "CB. 일정 조건에서 주식으로 바꿀 수 있는 채권입니다. 추후 주식으로 전환되면 물량이 늘어 주가에 부담이 될 수 있습니다.",
        "자사주": "회사가 자기 회사의 주식을 직접 사들이는 것입니다. 소각하면 유통 주식 수가 줄어 주주에게 호재로 작용합니다.",
        "영업활동현금흐름": "회사가 본업(제품·서비스 판매)으로 실제 현금을 얼마나 벌어들였는지 보여주는 지표입니다.",
        "액면분할": "1주를 여러 주로 쪼개어 주가를 낮추고 거래를 활발하게 만드는 조치입니다. 기업 가치 자체는 변하지 않습니다.",
        "공매도": "주식을 빌려서 먼저 판 뒤 주가가 떨어지면 싸게 사서 갚아 차익을 노리는 투자 기법입니다.",
        "배당락일": "배당을 받을 권리가 사라지는 날입니다. 보통 배당락일 전날까지 주식을 보유해야 배당을 받습니다.",
    };

    const sideGlossaryForm = document.getElementById("side-glossary-form");
    const sideGlossaryInput = document.getElementById("side-glossary-input");
    const sideGlossaryResult = document.getElementById("side-glossary-result");

    async function lookupGlossaryTerm(rawTerm) {
        if (!sideGlossaryResult) return;
        const term = String(rawTerm || "").trim();
        if (!term) return;
        if (sideGlossaryInput) sideGlossaryInput.value = term;

        const norm = term.replace(/\s+/g, "").toUpperCase();
        let matchedKey = Object.keys(GLOSSARY_DICT).find((k) => k.replace(/\s+/g, "").toUpperCase() === norm);
        if (!matchedKey) {
            matchedKey = Object.keys(GLOSSARY_DICT).find((k) => {
                const kn = k.replace(/\s+/g, "").toUpperCase();
                return kn.includes(norm) || norm.includes(kn);
            });
        }

        if (matchedKey) {
            sideGlossaryResult.innerHTML = `<strong style="color:#c4b5fd;">${matchedKey}</strong><br>${GLOSSARY_DICT[matchedKey]}`;
            return;
        }

        sideGlossaryResult.textContent = `'${term}' 뜻을 AI 사전에서 찾는 중입니다...`;
        try {
            const resp = await fetch("/api/glossary", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ term }),
            });
            const data = await resp.json();
            if (!resp.ok || data.error) {
                sideGlossaryResult.textContent = data.error || "용어 설명을 가져오지 못했습니다.";
                return;
            }
            sideGlossaryResult.innerHTML = `<strong style="color:#7dd3fc;">${data.term}</strong><br>${data.meaning}`;
        } catch (err) {
            sideGlossaryResult.textContent = `사전 검색 오류: ${err.message}`;
        }
    }

    if (sideGlossaryForm) {
        sideGlossaryForm.addEventListener("submit", (e) => {
            e.preventDefault();
            lookupGlossaryTerm(sideGlossaryInput?.value);
        });
    }

    document.querySelectorAll(".glossary-chip").forEach((btn) => {
        btn.addEventListener("click", () => lookupGlossaryTerm(btn.dataset.term));
    });
});
