document.addEventListener("DOMContentLoaded", () => {
    console.log("[INIT] 나의 투자도우미 3탭 프론트엔드 초기화 완료");

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

    // ==================== 3탭 전환 ====================
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
        });
    });

    // ==================== 탭 1: 종목 심층분석 채팅 ====================
    let t1ConversationId = null;
    let t1CachedStockData = null;

    const t1FetchForm = document.getElementById("t1-fetch-form");
    const t1FetchBtn = document.getElementById("t1-fetch-btn");
    const t1CodeInput = document.getElementById("t1-code-input");
    const t1UseTools = document.getElementById("t1-use-tools");
    const t1Status = document.getElementById("t1-status");
    const t1Error = document.getElementById("t1-error");
    const t1StockView = document.getElementById("t1-stock-view");
    const t1StockNameEl = document.getElementById("t1-stock-name");
    const t1StockMetaEl = document.getElementById("t1-stock-meta");
    const t1CurrentPriceEl = document.getElementById("t1-current-price");
    const t1PriceChangeEl = document.getElementById("t1-price-change");
    const t1SnapshotGridEl = document.getElementById("t1-snapshot-grid");
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

    t1FetchForm.addEventListener("submit", (e) => {
        e.preventDefault();
        runTab1FetchAndAnalyze(t1CodeInput.value.trim());
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

    function renderTab1StockDashboard(data) {
        const snap = data.snapshot || {};
        const isEtf = data.asset_type === "etf";
        const isUs = data.market_region === "US";
        const currency = data.currency || "KRW";
        const etf = data.etf_info || {};

        t1StockNameEl.textContent = `${data.name} (${data.code})`;
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
            renderTab1StockDashboard(stockData);
            showEl(t1StockView);

            t1EvidenceJson.textContent = JSON.stringify(stockData, null, 2);
            showEl(t1EvidenceWrap);

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

    const t2Form = document.getElementById("t2-form");
    const t2CodesInput = document.getElementById("t2-codes-input");
    const t2CalcBtn = document.getElementById("t2-calc-btn");
    const t2Status = document.getElementById("t2-status");
    const t2Error = document.getElementById("t2-error");
    const t2Result = document.getElementById("t2-result");
    const t2SummaryGrid = document.getElementById("t2-summary-grid");
    const t2AssetsTbody = document.getElementById("t2-assets-tbody");

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

        hideEl(t2Error);
        hideEl(t2Result);
        showEl(t2Status, "FinanceDataReader로 최근 1년 주가를 불러와 몬테카를로 시뮬레이션을 계산 중입니다...");
        t2CalcBtn.disabled = true;

        try {
            console.log(`[TAB2] POST /api/rebalance (codes=${rawCodes})`);
            const resp = await fetch("/api/rebalance", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ codes: rawCodes }),
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

        const summaryCards = [
            { label: "최적 기대수익률 (연)", value: `${opt.expected_return_pct}%`, hint: "과거 1년 수익률 기반 연율화" },
            { label: "최적 변동성 (연)", value: `${opt.volatility_pct}%`, hint: "수익률의 연율화 표준편차(위험)" },
            { label: "최대 샤프지수", value: `${opt.sharpe_ratio}`, hint: "위험 대비 초과수익 (높을수록 우수)" },
            { label: "최적 포트폴리오 MDD", value: `${opt.mdd_pct}%`, hint: "고점 대비 최대 하락폭" },
            { label: "동일비중 기대수익률", value: `${eq.expected_return_pct}%`, hint: "모든 종목을 똑같이 나눴을 때" },
            { label: "동일비중 샤프 / MDD", value: `${eq.sharpe_ratio} / ${eq.mdd_pct}%`, hint: "최적 비중과 성과 비교" },
        ];

        renderMetricCards(t2SummaryGrid, summaryCards);

        // 종목별 테이블
        t2AssetsTbody.innerHTML = "";
        const assets = data.assets || [];
        assets.forEach((a) => {
            const tr = document.createElement("tr");
            const displayName = a.name && a.name !== a.code ? `${a.name} (${a.code})` : a.code;
            const vals = [
                displayName,
                `${a.optimal_weight_pct}%`,
                `${a.min_vol_weight_pct}%`,
                `${a.equal_weight_pct}%`,
                `${a.annual_return_pct}%`,
                `${a.annual_volatility_pct}%`,
                `${a.mdd_pct}%`,
            ];
            vals.forEach((v) => {
                const td = document.createElement("td");
                td.textContent = v;
                tr.appendChild(td);
            });
            t2AssetsTbody.appendChild(tr);
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

    t3Form.addEventListener("submit", (e) => {
        e.preventDefault();
        loadTechnicalData(t3CodeInput.value.trim());
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
});
