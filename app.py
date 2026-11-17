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
    """탭 1: 종목 데이터(네이버+Serper)를 수집해 Dify 종목분석 챗봇에 전달"""
    body = request.get_json(silent=True) or {}
    code = str(body.get("code") or "").strip()
    query = str(body.get("query") or "").strip()
    conversation_id = body.get("conversation_id") or None
    use_tools = body.get("use_tools", True)

    if not query:
        return jsonify({"error": "질문을 입력해 주세요."}), 400

    stock_data = None
    dify_query = query
    inputs = {}

    if use_tools:
        if not code:
            return jsonify({"error": "도구(데이터 수집) 사용 시 6자리 종목코드를 입력해 주세요."}), 400

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
        dify_query = (
            f"[수집된 종목 근거 JSON]\n{evidence_json}\n\n"
            f"[사용자 질문]\n{query}\n\n"
            "※ 반드시 위 [수집된 종목 근거 JSON]에 있는 수치와 뉴스만을 근거로 답변해 주세요."
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
    """탭 2: Dify 없이 Python(FDR + 몬테카를로/효율적 프론티어)으로 리밸런싱 비중 계산"""
    body = request.get_json(silent=True) or {}
    raw_codes = body.get("codes", [])

    if isinstance(raw_codes, str):
        codes = [c.strip() for c in raw_codes.replace("\n", ",").split(",") if c.strip()]
    elif isinstance(raw_codes, list):
        codes = [str(c).strip() for c in raw_codes if str(c).strip()]
    else:
        return jsonify({"error": "종목코드 목록 형식이 올바르지 않습니다."}), 400

    logger.info(f"[REBALANCE] 리밸런싱 계산 요청 수신 (codes={codes})")
    result, err = calculate_rebalancing(codes)
    if err:
        return jsonify({"error": err}), 400

    return jsonify(result), 200


@app.route("/api/technical", methods=["POST"])
def api_technical():
    """탭 3: FDR 기반 기술지표(MA/RSI/MACD/볼린저밴드) 및 차트 데이터 반환"""
    body = request.get_json(silent=True) or {}
    code = str(body.get("code") or "").strip()
    logger.info(f"[TECHNICAL] 기술지표 계산 요청 수신 (code={code})")

    result, err = calculate_technical_indicators(code)
    if err:
        return jsonify({"error": err}), 400

    return jsonify(result), 200


@app.route("/api/chat/technical", methods=["POST"])
def chat_technical():
    """탭 3: 계산된 기술지표 숫자를 숨김 주입하여 Dify 지표해석기 챗봇 호출"""
    body = request.get_json(silent=True) or {}
    code = str(body.get("code") or "").strip()
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

    indicators_json = json.dumps(latest, ensure_ascii=False)
    inputs = {
        "code": code,
        "indicators": indicators_json,
    }
    dify_query = (
        f"[계산된 최신 기술지표 숫자 (종목코드: {code})]\n{indicators_json}\n\n"
        f"[사용자 질문]\n{query}\n\n"
        "※ 반드시 위 [계산된 최신 기술지표 숫자]만을 근거로 초보자도 이해하기 쉽게 설명해 주세요."
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
