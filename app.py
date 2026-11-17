import os
import logging
from flask import Flask, jsonify, render_template, request
from dotenv import load_dotenv
from collector import collect_stock_data

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

@app.route("/health", methods=["GET"])
def health_check():
    """서버 상태 및 API Key 설정 여부 점검 (키 값 자체는 보안상 반환 금지)"""
    serper_configured = bool(os.getenv("SERPER_API_KEY") and os.getenv("SERPER_API_KEY") != "your_serper_api_key_here")
    gemini_configured = bool(os.getenv("GEMINI_API_KEY") and os.getenv("GEMINI_API_KEY") != "your_gemini_api_key_here")
    
    logger.info("[HEALTH] Server health check performed")
    
    return jsonify({
        "status": "ok",
        "service": "Stock Data Collector & Briefing Tool",
        "api_keys": {
            "serper_configured": serper_configured,
            "gemini_configured": gemini_configured
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

if __name__ == "__main__":
    debug_mode = os.getenv("FLASK_DEBUG", "false").lower() == "true"
    logger.info(f"[START] Starting Flask server on http://127.0.0.1:5000 (debug={debug_mode})")
    app.run(host="127.0.0.1", port=5000, debug=debug_mode)
