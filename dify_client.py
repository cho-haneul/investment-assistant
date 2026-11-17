import logging
import os
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

    try:
        response = requests.post(url, headers=headers, json=payload, timeout=timeout)
        if not response.ok:
            err_detail = response.text[:300]
            try:
                err_json = response.json()
                err_detail = err_json.get("message") or err_json.get("code") or err_detail
            except ValueError:
                pass
            logger.error(f"[DIFY] API 오류 응답 (HTTP {response.status_code}): {err_detail}")
            return None, f"Dify API 호출 실패 (HTTP {response.status_code}): {err_detail}"

        data = response.json()
    except requests.exceptions.Timeout:
        logger.error("[DIFY] API 응답 시간 초과 (Timeout)")
        return None, "Dify 챗봇 응답 시간이 초과되었습니다 (Timeout)."
    except requests.exceptions.RequestException as e:
        logger.error(f"[DIFY] 네트워크 요청 실패: {e}")
        return None, f"Dify 서버 연결 실패: {str(e)}"
    except ValueError:
        logger.error("[DIFY] 응답 JSON 파싱 실패")
        return None, "Dify 응답(JSON) 파싱에 실패했습니다."

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
    """탭 3: 기술지표 설명 챗봇(지표해석기) 호출"""
    api_key = os.getenv("DIFY_TECH_API_KEY")
    return send_chat_message(
        api_key=api_key,
        query=query,
        inputs=inputs,
        conversation_id=conversation_id,
        user=user,
    )
