import json
import os
import logging
from flask import Flask, jsonify, render_template, request
from dotenv import load_dotenv
from collector import collect_stock_data
from dify_client import ask_analysis_bot, ask_tech_bot
from quant import calculate_rebalancing, calculate_technical_indicators

# .env 환경변수 로드
load_dotenv()

# 로깅 설정 (print() 대신 logging 사용)
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S"
)
logger = logging.getLogger(__name__)

app = Flask(__name__)


@app.route("/", methods=["GET"])
def index():
    """메인 웹 대시보드 화면 렌더링"""
    return render_template("index.html")


@app.route("/test", methods=["GET"])
def test_page():
    """기존 1차 종목 데이터 수집 테스트 화면 렌더링"""
    return render_template("test.html")

@app.route("/health", methods=["GET"])
def health_check():
    """서버 상태 및 API Key 설정 여부 점검 (키 값 자체는 보안상 반환 금지)"""
    serper_configured = bool(os.getenv("SERPER_API_KEY") and os.getenv("SERPER_API_KEY") != "your_serper_api_key_here")
    gemini_configured = bool(os.getenv("GEMINI_API_KEY") and os.getenv("GEMINI_API_KEY") != "your_gemini_api_key_here")
    dify_analysis_configured = bool(
        os.getenv("DIFY_ANALYSIS_API_KEY") and os.getenv("DIFY_ANALYSIS_API_KEY") != "your_dify_analysis_api_key_here"
    )
    dify_tech_configured = bool(
        os.getenv("DIFY_TECH_API_KEY") and os.getenv("DIFY_TECH_API_KEY") != "your_dify_tech_api_key_here"
    )

    logger.info("[HEALTH] Server health check performed")

    return jsonify({
        "status": "ok",
        "service": "My Investment Assistant",
        "api_keys": {
            "serper_configured": serper_configured,
            "gemini_configured": gemini_configured,
            "dify_analysis_configured": dify_analysis_configured,
            "dify_tech_configured": dify_tech_configured,
        }
    }), 200


@app.route("/fetch", methods=["POST"])
def fetch_stock():
    """종목코드를 JSON({"code": "000660"})으로 받아 시세, 투자지표, 재무실적, 뉴스를 수집해 반환"""
    body = request.get_json(silent=True) or {}
    code = body.get("code") or request.form.get("code") or ""
    logger.info(f"[FETCH] 종목 데이터 요청 수신 (code={code})")

    data = collect_stock_data(code)
    if not data.get("name"):
        return jsonify(data), 400

    return jsonify(data), 200


@app.route("/api/chat/analysis", methods=["POST"])
def chat_analysis():
    """탭 1: 종목 데이터(네이버+Serper)를 수집해 전문가 프롬프트로 Dify 종목분석 챗봇에 전달"""
    body = request.get_json(silent=True) or {}
    code = str(body.get("code") or "").strip().upper()
    query = str(body.get("query") or "").strip()
    conversation_id = body.get("conversation_id") or None
    use_tools = body.get("use_tools", True)
    cached_stock_data = body.get("stock_data")
    mode = body.get("mode", "chat")  # "init" (초기 전문가 종합분석) or "chat" (후속 대화)

    if mode == "init" and not query:
        is_cached_etf = isinstance(cached_stock_data, dict) and cached_stock_data.get("asset_type") == "etf"
        if is_cached_etf:
            query = (
                "수집된 최신 ETF 데이터(현재가·NAV·괴리율·총보수·기간별 수익률·운용정보·뉴스)만을 근거로 "
                "전문 ETF 애널리스트 관점에서 심층 분석 리포트를 작성해 주세요.\n"
                "다음 4개 항목으로 구조화해 주세요:\n"
                "1. **현재가 및 ETF 기본 지표** (현재가, NAV, 괴리율, 52주 고저 대비 위치, 시가총액·순자산총액)\n"
                "2. **운용 구조 및 수익률 추이** (기초지수, 운용사, 총보수, 최근 1개월·3개월·6개월·1년 수익률, 분배금 수익률)\n"
                "3. **최신 뉴스 및 기초지수·시장 모멘텀**\n"
                "4. **종합 의견 (장점·투자 포인트 vs 리스크 요인)**"
            )
        else:
            query = (
                "수집된 최신 종목 데이터(시세·밸류에이션·컨센서스·연간 재무실적·뉴스)만을 근거로 "
                "전문 애널리스트 관점에서 종목 심층 분석 리포트를 작성해 주세요.\n"
                "다음 4개 항목으로 구조화해 주세요:\n"
                "1. **현재 주가 및 밸류에이션** (PER, 추정PER, PBR, EPS, BPS, 52주 고저 대비 위치, 시가총액, 증권가 목표주가)\n"
                "2. **재무 실적 추이** (매출·영업이익·순이익·영업이익률·ROE·부채비율, 확정치와 추정(E) 구분)\n"
                "3. **최신 뉴스 핵심 이슈 및 모멘텀**\n"
                "4. **종합 의견 (긍정 요인 vs 리스크 요인)**"
            )

    if not query:
        return jsonify({"error": "질문을 입력해 주세요."}), 400

    stock_data = None
    dify_query = query
    inputs = {}

    if use_tools:
        cache_matches_code = (
            isinstance(cached_stock_data, dict)
            and cached_stock_data.get("name")
            and (not code or cached_stock_data.get("code") == code)
        )
        if cache_matches_code:
            stock_data = cached_stock_data
        else:
            if not code:
                return jsonify({"error": "도구(데이터 수집) 사용 시 종목코드(국내 6자리 또는 미국 티커 예: AAPL)를 입력해 주세요."}), 400
            if isinstance(cached_stock_data, dict) and cached_stock_data.get("code") != code:
                conversation_id = None
            logger.info(f"[CHAT-ANALYSIS] 종목 데이터 수집 후 Dify 호출 (code={code})")
            stock_data = collect_stock_data(code)
            if not stock_data.get("name"):
                return jsonify({
                    "error": "종목 데이터 수집에 실패했습니다.",
                    "details": stock_data.get("errors", []),
                }), 400

        evidence_json = json.dumps(stock_data, ensure_ascii=False)
        inputs = {
            "code": stock_data["code"],
            "stock_name": stock_data["name"],
            "stock_data": evidence_json,
        }

        hypothetical_rule = (
            "[가정·시뮬레이션 질문 응답 규칙]\n"
            "- 사용자가 '만약 ~라면', '가상으로 ○○만 원이 있다면 얼마를 투자할 것인가'처럼 가정 질문을 하면 "
            "'AI라서 결정할 수 없다'거나 '투자 권고는 적절하지 않다'고 회피하지 마세요.\n"
            "- 수집된 데이터(실적·밸류에이션·주가·뉴스 리스크)만을 근거로 가상 시나리오상 구체적인 금액/선택(예: 0원 또는 ○○만 원)과 이유를 첫 답변에서 바로 명확히 제시하고, "
            "마지막에 한 줄로 '※ 본 답변은 제공된 데이터 기반의 가상 시뮬레이션이며 실제 투자 권유가 아닙니다.'라고 덧붙이세요.\n\n"
        )

        is_etf = stock_data.get("asset_type") == "etf"
        is_us = stock_data.get("market_region") == "US"
        market_label = "미국 주식·ETF" if is_us else "한국 주식·ETF"
        currency_note = "통화는 USD(달러), 재무제표 금액 단위는 '백만 USD'입니다. 원화(원/억원)로 착각하지 마세요." if is_us else "통화는 원(KRW), 재무제표 금액 단위는 '억원'입니다."

        if not conversation_id or mode == "init":
            if is_etf:
                dify_query = (
                    f"당신은 {market_label} 시장 전문 애널리스트입니다.\n"
                    f"이 종목은 일반 개별 기업이 아닌 ETF(상장지수펀드)입니다. {currency_note}\n"
                    "아래 [수집된 종목 근거 JSON]에 포함된 실제 숫자(현재가, 시가총액, 52주 고저, NAV/괴리율/총보수/수익률 등 제공된 항목)와 뉴스만을 근거로 답변하세요. "
                    "JSON에 없는 수치나 사실은 절대 추측해 지어내지 마세요.\n\n"
                    f"{hypothetical_rule}"
                    f"[수집된 종목 근거 JSON]\n{evidence_json}\n\n"
                    f"[요청 사항]\n{query}"
                )
            else:
                dify_query = (
                    f"당신은 {market_label} 시장 전문 애널리스트입니다.\n"
                    f"{currency_note}\n"
                    "아래 [수집된 종목 근거 JSON]에 포함된 실제 숫자와 뉴스만을 근거로 답변하세요. "
                    "JSON에 없는 수치나 사실은 절대 추측해 지어내지 마세요. "
                    "실적 중 `is_consensus: true` 항목은 반드시 '추정(E)'으로 구분해 설명하세요.\n\n"
                    f"{hypothetical_rule}"
                    f"[수집된 종목 근거 JSON]\n{evidence_json}\n\n"
                    f"[요청 사항]\n{query}"
                )
        else:
            dify_query = (
                f"[현재 분석 대상 종목: {stock_data['name']} ({stock_data['code']})]\n"
                f"{hypothetical_rule}"
                f"[후속 질문]\n{query}\n\n"
                "※ 앞서 전달된 종목 근거 데이터에 기반하여 답변해 주세요."
            )
    else:
        logger.info("[CHAT-ANALYSIS] 도구 없이 Dify 직접 호출 (비교 모드)")

    dify_res, err = ask_analysis_bot(
        query=dify_query,
        inputs=inputs,
        conversation_id=conversation_id,
    )
    if err:
        return jsonify({
            "error": err,
            "used_tools": bool(use_tools),
            "stock_data": stock_data,
        }), 502

    return jsonify({
        "answer": dify_res["answer"],
        "conversation_id": dify_res["conversation_id"],
        "used_tools": bool(use_tools),
        "stock_data": stock_data,
    }), 200


@app.route("/api/rebalance", methods=["POST"])
def api_rebalance():
    """탭 2: Dify 없이 Python(FDR + 몬테카를로/효율적 프론티어 + 백테스트)으로 리밸런싱 비중 계산"""
    body = request.get_json(silent=True) or {}
    raw_codes = body.get("codes", [])
    years = body.get("years", 1)
    rebalance_freq = body.get("rebalance_freq", "none")
    initial_capital = body.get("initial_capital", 10_000_000)

    if isinstance(raw_codes, str):
        codes = [c.strip() for c in raw_codes.replace("\n", ",").split(",") if c.strip()]
    elif isinstance(raw_codes, list):
        codes = [str(c).strip() for c in raw_codes if str(c).strip()]
    else:
        return jsonify({"error": "종목코드 목록 형식이 올바르지 않습니다."}), 400

    logger.info(f"[REBALANCE] 리밸런싱 계산 요청 수신 (codes={codes}, years={years}, freq={rebalance_freq})")
    result, err = calculate_rebalancing(
        codes,
        years=years,
        rebalance_freq=rebalance_freq,
        initial_capital=initial_capital,
    )
    if err:
        return jsonify({"error": err}), 400

    return jsonify(result), 200


@app.route("/api/technical", methods=["POST"])
def api_technical():
    """탭 3: FDR 기반 기술지표(MA/RSI/MACD/볼린저밴드) 및 차트 데이터 반환"""
    body = request.get_json(silent=True) or {}
    code = str(body.get("code") or "").strip().upper()
    logger.info(f"[TECHNICAL] 기술지표 계산 요청 수신 (code={code})")

    result, err = calculate_technical_indicators(code)
    if err:
        return jsonify({"error": err}), 400

    return jsonify(result), 200


@app.route("/api/chat/technical", methods=["POST"])
def chat_technical():
    """탭 3: 계산된 기술지표 숫자를 숨김 주입하여 Dify 지표해석기 챗봇 호출"""
    body = request.get_json(silent=True) or {}
    code = str(body.get("code") or "").strip().upper()
    stock_name = str(body.get("stock_name") or "").strip()
    query = str(body.get("query") or "").strip()
    conversation_id = body.get("conversation_id") or None
    latest = body.get("indicators")

    if not query:
        return jsonify({"error": "질문을 입력해 주세요."}), 400

    if not isinstance(latest, dict) or not latest:
        if not code:
            return jsonify({"error": "종목코드(6자리)를 먼저 조회해 주세요."}), 400
        tech_res, err = calculate_technical_indicators(code)
        if err:
            return jsonify({"error": err}), 400
        latest = tech_res.get("latest", {})
        if not stock_name:
            stock_name = tech_res.get("name") or ""

    display_target = f"{stock_name} ({code})" if stock_name else code
    indicators_json = json.dumps(latest, ensure_ascii=False)
    inputs = {
        "code": code,
        "stock_name": stock_name or code,
        "indicators": indicators_json,
    }
    dify_query = (
        f"[계산된 최신 기술지표 숫자 (대상: {display_target})]\n{indicators_json}\n\n"
        f"[사용자 질문]\n{query}\n\n"
        "※ 반드시 위 [계산된 최신 기술지표 숫자]만을 근거로 주식을 잘 모르는 초보자도 이해하기 쉽게 설명해 주세요."
    )

    logger.info(f"[CHAT-TECH] 기술지표 숫자 주입 후 Dify 지표해석기 호출 (code={code})")
    dify_res, err = ask_tech_bot(
        query=dify_query,
        inputs=inputs,
        conversation_id=conversation_id,
    )
    if err:
        return jsonify({
            "error": err,
            "injected_indicators": latest,
        }), 502

    return jsonify({
        "answer": dify_res["answer"],
        "conversation_id": dify_res["conversation_id"],
        "injected_indicators": latest,
    }), 200

if __name__ == "__main__":
    debug_mode = os.getenv("FLASK_DEBUG", "false").lower() == "true"
    logger.info(f"[START] Starting Flask server on http://127.0.0.1:5000 (debug={debug_mode})")
    app.run(host="127.0.0.1", port=5000, debug=debug_mode)
