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

    function appendChatMessage(boxEl, role, text) {
        const msgDiv = document.createElement("div");
        msgDiv.className = `chat-msg ${role}`;
        const bubble = document.createElement("div");
        bubble.className = "chat-bubble";
        bubble.textContent = text;
        msgDiv.appendChild(bubble);
        boxEl.appendChild(msgDiv);
        boxEl.scrollTop = boxEl.scrollHeight;
        return bubble;
    }

    function formatNum(val, suffix = "") {
        if (val === null || val === undefined) return "-";
        return `${Number(val).toLocaleString("ko-KR")}${suffix}`;
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
    const t1CodeInput = document.getElementById("t1-code-input");
    const t1UseTools = document.getElementById("t1-use-tools");
    const t1Error = document.getElementById("t1-error");
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
        });
    });

    t1ResetBtn.addEventListener("click", () => {
        t1ConversationId = null;
        t1ChatBox.innerHTML = "";
        appendChatMessage(t1ChatBox, "bot", "대화가 초기화되었습니다. 종목코드와 질문을 입력해 주세요.");
        hideEl(t1Error);
        hideEl(t1EvidenceWrap);
        console.log("[TAB1] 대화 초기화 완료");
    });

    t1ChatForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const code = t1CodeInput.value.trim();
        const query = t1QueryInput.value.trim();
        const useTools = t1UseTools.checked;

        if (!query) return;
        if (useTools && !/^\d{6}$/.test(code)) {
            showEl(t1Error, "도구 사용 시 종목코드는 6자리 숫자로 입력해 주세요.");
            return;
        }

        hideEl(t1Error);
        appendChatMessage(t1ChatBox, "user", useTools ? `[${code}] ${query}` : `[도구 없음] ${query}`);
        t1QueryInput.value = "";
        t1SendBtn.disabled = true;

        const loadingBubble = appendChatMessage(
            t1ChatBox,
            "bot",
            useTools ? "네이버 금융 + Serper 뉴스 수집 후 Dify가 분석 중입니다..." : "Dify에게 직접 질문 중입니다..."
        );

        try {
            console.log(`[TAB1] POST /api/chat/analysis (code=${code}, use_tools=${useTools})`);
            const resp = await fetch("/api/chat/analysis", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    code,
                    query,
                    use_tools: useTools,
                    conversation_id: t1ConversationId,
                }),
            });
            const data = await resp.json();
            console.log("[TAB1] 응답 수신:", resp.status, data);

            if (data.stock_data) {
                t1EvidenceJson.textContent = JSON.stringify(data.stock_data, null, 2);
                showEl(t1EvidenceWrap);
            }

            if (!resp.ok || data.error) {
                loadingBubble.textContent = `오류: ${data.error || "답변을 받지 못했습니다."}`;
                showEl(t1Error, data.error || "요청 처리 중 오류가 발생했습니다.");
                return;
            }

            t1ConversationId = data.conversation_id || t1ConversationId;
            loadingBubble.textContent = data.answer || "(빈 응답)";
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
            { label: "최적 기대수익률 (연)", value: `${opt.expected_return_pct}%` },
            { label: "최적 변동성 (연)", value: `${opt.volatility_pct}%` },
            { label: "최대 샤프지수", value: `${opt.sharpe_ratio}` },
            { label: "최적 포트폴리오 MDD", value: `${opt.mdd_pct}%` },
            { label: "동일비중 기대수익률", value: `${eq.expected_return_pct}%` },
            { label: "동일비중 샤프 / MDD", value: `${eq.sharpe_ratio} / ${eq.mdd_pct}%` },
        ];

        t2SummaryGrid.innerHTML = "";
        summaryCards.forEach((c) => {
            const card = document.createElement("div");
            card.className = "metric-card";
            card.innerHTML = `<div class="metric-label"></div><div class="metric-value"></div>`;
            card.querySelector(".metric-label").textContent = c.label;
            card.querySelector(".metric-value").textContent = c.value;
            t2SummaryGrid.appendChild(card);
        });

        // 종목별 테이블
        t2AssetsTbody.innerHTML = "";
        const assets = data.assets || [];
        assets.forEach((a) => {
            const tr = document.createElement("tr");
            const vals = [
                a.code,
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
                labels: assets.map((a) => `${a.code} (${a.optimal_weight_pct}%)`),
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

    async function loadTechnicalData(code) {
        if (!/^\d{6}$/.test(code)) {
            showEl(t3Error, "종목코드는 6자리 숫자로 입력해 주세요.");
            return;
        }

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

        t3ChartTitle.textContent = `최신 기술지표 요약 (${data.code} · 기준일 ${latest.date || "-"})`;

        const latestCards = [
            { label: "종가", value: formatNum(latest.close, "원") },
            { label: "MA5 / MA20", value: `${formatNum(latest.ma5)} / ${formatNum(latest.ma20)}` },
            { label: "MA60", value: formatNum(latest.ma60) },
            { label: "RSI (14)", value: latest.rsi14 ?? "-" },
            { label: "MACD / Signal", value: `${latest.macd ?? "-"} / ${latest.macd_signal ?? "-"}` },
            { label: "볼린저 상/하단", value: `${formatNum(latest.bb_upper)} / ${formatNum(latest.bb_lower)}` },
        ];

        t3LatestGrid.innerHTML = "";
        latestCards.forEach((c) => {
            const card = document.createElement("div");
            card.className = "metric-card";
            card.innerHTML = `<div class="metric-label"></div><div class="metric-value"></div>`;
            card.querySelector(".metric-label").textContent = c.label;
            card.querySelector(".metric-value").textContent = c.value;
            t3LatestGrid.appendChild(card);
        });

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
            loadingBubble.textContent = data.answer || "(빈 응답)";
        } catch (err) {
            console.error("[TAB3] 통신 오류:", err);
            loadingBubble.textContent = `서버 통신 오류: ${err.message}`;
            showEl(t3Error, `서버 통신 오류: ${err.message}`);
        } finally {
            t3SendBtn.disabled = false;
        }
    });
});
