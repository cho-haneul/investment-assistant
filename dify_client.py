import logging
import os
import time
import requests
from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger(__name__)

PLACEHOLDER_KEYS = {
    "your_dify_analysis_api_key_here",
    "your_dify_tech_api_key_here",
}


def get_dify_base_url():
    """환경변수에서 Dify API 기본 URL을 반환합니다."""
    return (os.getenv("DIFY_BASE_URL") or "https://api.dify.ai/v1").rstrip("/")


def is_valid_api_key(api_key):
    """Dify API Key가 실제 값으로 설정되어 있는지 확인합니다."""
    return bool(api_key and api_key.strip() and api_key.strip() not in PLACEHOLDER_KEYS)


def send_chat_message(
    api_key,
    query,
    inputs=None,
    conversation_id=None,
    user="investment-user",
    timeout=30,
):
    """
    Dify 기본 챗봇(Chat Messages API)을 호출합니다.
    URL: POST {DIFY_BASE_URL}/chat-messages
    반환: ({"answer": str, "conversation_id": str, "message_id": str}, error_message)
    """
    if not is_valid_api_key(api_key):
        return None, "Dify API Key가 설정되지 않았습니다. (.env 파일을 확인해 주세요)"

    if not query or not str(query).strip():
        return None, "질문 내용(query)이 비어 있습니다."

    url = f"{get_dify_base_url()}/chat-messages"
    headers = {
        "Authorization": f"Bearer {api_key.strip()}",
        "Content-Type": "application/json",
    }
    payload = {
        "inputs": inputs or {},
        "query": str(query).strip(),
        "response_mode": "blocking",
        "user": user,
    }
    if conversation_id:
        payload["conversation_id"] = conversation_id

    logger.info(
        f"[DIFY] 챗봇 API 요청 시작 (url={url}, has_conv={bool(conversation_id)}, input_keys={list((inputs or {}).keys())})"
    )

    max_attempts = 3
    data = None
    last_err = None

    for attempt in range(1, max_attempts + 1):
        try:
            response = requests.post(url, headers=headers, json=payload, timeout=timeout)
            if not response.ok:
                err_detail = response.text[:300]
                try:
                    err_json = response.json()
                    err_detail = err_json.get("message") or err_json.get("code") or err_detail
                except ValueError:
                    pass

                lower_err = err_detail.lower()
                is_transient = (
                    response.status_code in (429, 502, 503, 504)
                    or "high demand" in lower_err
                    or "temporary" in lower_err
                    or "overloaded" in lower_err
                    or "rate limit" in lower_err
                )
                logger.warning(f"[DIFY] API 오류 (시도 {attempt}/{max_attempts}, HTTP {response.status_code}): {err_detail}")

                if is_transient and attempt < max_attempts:
                    time.sleep(1.5 * attempt)
                    continue

                if "high demand" in lower_err or "overloaded" in lower_err:
                    return None, (
                        "현재 Dify에 연결된 Gemini AI 모델에 일시적으로 요청이 몰려 응답이 지연되고 있습니다. "
                        "잠시 후 다시 시도하거나, Dify 스튜디오에서 다른 모델(예: Gemini Flash 등)로 변경해 보세요."
                    )
                return None, f"Dify API 호출 실패 (HTTP {response.status_code}): {err_detail}"

            data = response.json()
            break
        except requests.exceptions.Timeout:
            logger.warning(f"[DIFY] API 응답 시간 초과 (시도 {attempt}/{max_attempts})")
            last_err = "Dify 챗봇 응답 시간이 초과되었습니다 (Timeout)."
            if attempt < max_attempts:
                time.sleep(1.5)
                continue
            return None, last_err
        except requests.exceptions.RequestException as e:
            logger.error(f"[DIFY] 네트워크 요청 실패: {e}")
            return None, f"Dify 서버 연결 실패: {str(e)}"
        except ValueError:
            logger.error("[DIFY] 응답 JSON 파싱 실패")
            return None, "Dify 응답(JSON) 파싱에 실패했습니다."

    if data is None:
        return None, last_err or "Dify 응답을 받지 못했습니다."

    result = {
        "answer": data.get("answer", ""),
        "conversation_id": data.get("conversation_id", ""),
        "message_id": data.get("message_id", ""),
    }
    logger.info(f"[DIFY] 챗봇 응답 수신 완료 (answer_len={len(result['answer'])})")
    return result, None


def ask_analysis_bot(query, inputs=None, conversation_id=None, user="investment-user"):
    """탭 1: 종목 심층분석 챗봇(투자종목분석기) 호출"""
    api_key = os.getenv("DIFY_ANALYSIS_API_KEY")
    return send_chat_message(
        api_key=api_key,
        query=query,
        inputs=inputs,
        conversation_id=conversation_id,
        user=user,
    )


def ask_tech_bot(query, inputs=None, conversation_id=None, user="investment-user"):
    """
    탭 3: 기술지표 설명 챗봇(지표해석기) 호출.
    지표해석기 챗봇의 무료 할당량 소진(quota exhausted) 시 투자종목분석기(Gemini)로 자동 폴백합니다.
    """
    api_key = os.getenv("DIFY_TECH_API_KEY")
    res, err = send_chat_message(
        api_key=api_key,
        query=query,
        inputs=inputs,
        conversation_id=conversation_id,
        user=user,
    )
    if err and any(k in err.lower() for k in ("quota", "exhausted", "provider credentials")):
        logger.warning("[DIFY] 지표해석기 할당량 소진 감지 -> 투자종목분석기(Gemini)로 자동 폴백")
        fallback_query = (
            "당신은 주식·ETF 기술지표(이동평균선, RSI, MACD, 볼린저밴드) 전문 해설가입니다.\n"
            f"{query}"
        )
        return ask_analysis_bot(
            query=fallback_query,
            inputs=inputs,
            conversation_id=None,
            user=user,
        )
    return res, err
