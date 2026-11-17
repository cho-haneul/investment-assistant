document.addEventListener("DOMContentLoaded", () => {
    console.log("[INIT] Stock Data Collector & Briefing Tool 프론트엔드 초기화 완료");

    const searchForm = document.getElementById("search-form");
    const codeInput = document.getElementById("code-input");
    const searchBtn = document.getElementById("search-btn");
    const statusBox = document.getElementById("status-box");
    const errorBox = document.getElementById("error-box");
    const resultSection = document.getElementById("result-section");

    const stockNameEl = document.getElementById("stock-name");
    const stockMetaEl = document.getElementById("stock-meta");
    const currentPriceEl = document.getElementById("current-price");
    const priceChangeEl = document.getElementById("price-change");
    const snapshotGridEl = document.getElementById("snapshot-grid");
    const financialsTbodyEl = document.getElementById("financials-tbody");
    const newsListEl = document.getElementById("news-list");

    // 예시 종목 버튼 클릭 이벤트
    document.querySelectorAll(".sample-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
            const sampleCode = btn.dataset.code;
            console.log(`[UI] 예시 종목 클릭: ${sampleCode}`);
            codeInput.value = sampleCode;
            fetchStockData(sampleCode);
        });
    });

    // 검색 폼 제출 이벤트
    searchForm.addEventListener("submit", (event) => {
        event.preventDefault();
        const code = codeInput.value.trim();
        console.log(`[UI] 검색 폼 제출: code='${code}'`);
        fetchStockData(code);
    });

    function showStatus(message) {
        statusBox.textContent = message;
        statusBox.classList.remove("hidden");
    }

    function hideStatus() {
        statusBox.classList.add("hidden");
        statusBox.textContent = "";
    }

    function showErrors(errors) {
        if (!errors || errors.length === 0) {
            errorBox.classList.add("hidden");
            errorBox.textContent = "";
            return;
        }
        errorBox.textContent = errors.join(" / ");
        errorBox.classList.remove("hidden");
    }

    function formatNumber(val, suffix = "") {
        if (val === null || val === undefined) return "-";
        return `${Number(val).toLocaleString("ko-KR")}${suffix}`;
    }

    async function fetchStockData(code) {
        if (!/^\d{6}$/.test(code)) {
            console.warn(`[VALIDATION] 잘못된 종목코드 입력: '${code}'`);
            showErrors(["종목코드는 숫자 6자리로 입력해 주세요. (예: 000660)"]);
            return;
        }

        showErrors([]);
        showStatus(`종목코드 ${code} 데이터를 수집하는 중입니다...`);
        searchBtn.disabled = true;
        resultSection.classList.add("hidden");

        try {
            console.log(`[FETCH] POST /fetch 요청 시작 (code=${code})`);
            const response = await fetch("/fetch", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({ code }),
            });

            const data = await response.json();
            console.log("[FETCH] 서버 응답 수신:", response.status, data);

            hideStatus();

            if (!response.ok || !data.name) {
                console.error("[FETCH] 데이터 수집 실패:", data.errors);
                showErrors(data.errors && data.errors.length ? data.errors : ["종목 데이터를 불러오지 못했습니다."]);
                return;
            }

            if (data.errors && data.errors.length > 0) {
                console.warn("[FETCH] 일부 영역 경고:", data.errors);
                showErrors(data.errors);
            }

            renderStockData(data);
            resultSection.classList.remove("hidden");
        } catch (err) {
            console.error("[ERROR] 네트워크 또는 스크립트 오류:", err);
            hideStatus();
            showErrors([`서버 통신 중 오류가 발생했습니다: ${err.message}`]);
        } finally {
            searchBtn.disabled = false;
        }
    }

    function renderStockData(data) {
        const snap = data.snapshot || {};

        // 1. 종목명 & 현재가
        stockNameEl.textContent = `${data.name} (${data.code})`;
        stockMetaEl.textContent = `${snap.market || "-"} · 장 상태: ${snap.market_status || "-"}`;
        currentPriceEl.textContent = formatNumber(snap.current_price, "원");

        const changePrice = snap.change_price;
        const changeRate = snap.change_rate;
        priceChangeEl.className = "price-change";

        if (changePrice > 0) {
            priceChangeEl.classList.add("up");
            priceChangeEl.textContent = `▲ ${formatNumber(changePrice, "원")} (+${changeRate ?? 0}%)`;
        } else if (changePrice < 0) {
            priceChangeEl.classList.add("down");
            priceChangeEl.textContent = `▼ ${formatNumber(Math.abs(changePrice), "원")} (${changeRate ?? 0}%)`;
        } else {
            priceChangeEl.classList.add("flat");
            priceChangeEl.textContent = `0원 (0.00%)`;
        }

        // 2. 투자지표 스냅샷 카드
        const metrics = [
            { label: "시가총액", value: snap.market_cap || "-" },
            { label: "PER", value: formatNumber(snap.per, "배") },
            { label: "PBR", value: formatNumber(snap.pbr, "배") },
            { label: "52주 최고", value: formatNumber(snap.high_52w, "원") },
            { label: "52주 최저", value: formatNumber(snap.low_52w, "원") },
            { label: "배당수익률", value: formatNumber(snap.dividend_yield, "%") },
            { label: "외국인 소진율", value: formatNumber(snap.foreign_rate, "%") },
        ];

        snapshotGridEl.innerHTML = "";
        metrics.forEach((m) => {
            const card = document.createElement("div");
            card.className = "metric-card";

            const labelEl = document.createElement("div");
            labelEl.className = "metric-label";
            labelEl.textContent = m.label;

            const valueEl = document.createElement("div");
            valueEl.className = "metric-value";
            valueEl.textContent = m.value;

            card.appendChild(labelEl);
            card.appendChild(valueEl);
            snapshotGridEl.appendChild(card);
        });

        // 3. 연간 재무실적 표
        financialsTbodyEl.innerHTML = "";
        const financials = data.financials || [];
        if (financials.length === 0) {
            const tr = document.createElement("tr");
            const td = document.createElement("td");
            td.colSpan = 7;
            td.textContent = "수집된 재무실적 데이터가 없습니다.";
            td.style.textAlign = "center";
            tr.appendChild(td);
            financialsTbodyEl.appendChild(tr);
        } else {
            financials.forEach((row) => {
                const tr = document.createElement("tr");
                if (row.is_consensus) {
                    tr.classList.add("row-consensus");
                }

                const periodTd = document.createElement("td");
                periodTd.textContent = `${row.period || "-"} `;
                if (row.is_consensus) {
                    const badge = document.createElement("span");
                    badge.className = "badge-consensus";
                    badge.textContent = "추정(E)";
                    periodTd.appendChild(badge);
                }
                tr.appendChild(periodTd);

                const cells = [
                    formatNumber(row.revenue),
                    formatNumber(row.operating_profit),
                    formatNumber(row.net_income),
                    formatNumber(row.operating_margin, "%"),
                    formatNumber(row.roe, "%"),
                    formatNumber(row.debt_ratio, "%"),
                ];
                cells.forEach((text) => {
                    const td = document.createElement("td");
                    td.textContent = text;
                    tr.appendChild(td);
                });

                financialsTbodyEl.appendChild(tr);
            });
        }

        // 4. 최신 뉴스 리스트
        newsListEl.innerHTML = "";
        const news = data.news || [];
        if (news.length === 0) {
            const li = document.createElement("li");
            li.className = "news-item";
            li.textContent = "수집된 최신 뉴스가 없습니다.";
            newsListEl.appendChild(li);
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
                    const snippet = document.createElement("p");
                    snippet.className = "news-snippet";
                    snippet.textContent = item.snippet;
                    li.appendChild(snippet);
                }

                newsListEl.appendChild(li);
            });
        }

        console.log("[RENDER] 화면 렌더링 완료");
    }
});
