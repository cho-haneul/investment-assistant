import logging
import os
import re
import requests
from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger(__name__)

# 네이버 서버 문전박대 방지용 매너 명찰 (User-Agent 헤더)
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
}

def clean_number(value, to_type=float):
    """
    텍스트에 포함된 콤마(,), 원, 배, % 등의 단위를 제거하고 순수 숫자(int 또는 float)로 정제합니다.
    데이터가 없거나('-') 오류 발생 시 None을 반환합니다.
    """
    if value is None:
        return None
    val_str = str(value).strip()
    if not val_str or val_str in ("-", "N/A", "NaN", "null"):
        return None
    
    # 콤마 및 통화/단위 기호 제거
    cleaned = re.sub(r"[,\s원배%]", "", val_str)
    try:
        if to_type is int:
            return int(float(cleaned))
        return float(cleaned)
    except (ValueError, TypeError):
        return None

def validate_code(code):
    """종목코드가 문자열 6자리 숫자인지 검증합니다."""
    if not code:
        return False, "종목코드가 입력되지 않았습니다."
    code_str = str(code).strip()
    if len(code_str) != 6 or not code_str.isdigit():
        return False, f"종목코드는 6자리 숫자여야 합니다. (입력값: '{code}')"
    return True, code_str

def fetch_basic(code):
    """
    네이버 basic API에서 공식 종목명과 실시간 시세를 수집합니다.
    URL: https://m.stock.naver.com/api/stock/{code}/basic
    """
    url = f"https://m.stock.naver.com/api/stock/{code}/basic"
    logger.info(f"[NAVER] 네이버 금융 basic API 접근 시작 (code={code})")
    
    try:
        response = requests.get(url, headers=HEADERS, timeout=5)
        if response.status_code == 404:
            return None, f"존재하지 않는 종목코드입니다. (HTTP 404: {code})"
        response.raise_for_status()
        data = response.json()
    except requests.exceptions.Timeout:
        return None, "네이버 금융 서버 응답 시간이 초과되었습니다 (Timeout)."
    except requests.exceptions.RequestException as e:
        return None, f"네이버 금융 접근 실패: {str(e)}"
    except ValueError:
        return None, "네이버 금융 응답(JSON) 파싱 실패"

    name = data.get("stockName")
    if not name:
        return None, "정식 종목명을 확인하지 못했습니다."

    basic_snapshot = {
        "current_price": clean_number(data.get("closePrice"), int),
        "change_price": clean_number(data.get("compareToPreviousClosePrice"), int),
        "change_rate": clean_number(data.get("fluctuationsRatio"), float),
        "market": data.get("stockExchangeName"),
        "market_status": data.get("marketStatus")
    }

    logger.info(f"[PARSE] 기본 시세 수집 완료 (name={name}, current_price={basic_snapshot['current_price']})")
    return {"name": name, "snapshot": basic_snapshot}, None


def fetch_integration(code):
    """
    네이버 integration API에서 투자정보(PER, PBR, 시가총액, 52주 최고/최저 등)를 수집합니다.
    URL: https://m.stock.naver.com/api/stock/{code}/integration
    """
    url = f"https://m.stock.naver.com/api/stock/{code}/integration"
    logger.info(f"[NAVER] 네이버 금융 integration API 접근 시작 (code={code})")

    try:
        response = requests.get(url, headers=HEADERS, timeout=5)
        response.raise_for_status()
        data = response.json()
    except requests.exceptions.Timeout:
        return None, "네이버 금융 투자정보 응답 시간이 초과되었습니다 (Timeout)."
    except requests.exceptions.RequestException as e:
        return None, f"네이버 금융 투자정보 접근 실패: {str(e)}"
    except ValueError:
        return None, "네이버 금융 투자정보 응답(JSON) 파싱 실패"

    total_infos = data.get("totalInfos") or []
    info_map = {
        item.get("code"): item.get("value")
        for item in total_infos
        if isinstance(item, dict) and item.get("code")
    }

    integration_snapshot = {
        "market_cap": info_map.get("marketValue"),
        "per": clean_number(info_map.get("per"), float),
        "pbr": clean_number(info_map.get("pbr"), float),
        "high_52w": clean_number(info_map.get("highPriceOf52Weeks"), int),
        "low_52w": clean_number(info_map.get("lowPriceOf52Weeks"), int),
        "dividend_yield": clean_number(info_map.get("dividendYieldRatio"), float),
        "foreign_rate": clean_number(info_map.get("foreignRate"), float),
    }

    logger.info(
        f"[PARSE] 투자정보 수집 완료 (PER={integration_snapshot['per']}, PBR={integration_snapshot['pbr']}, 시총={integration_snapshot['market_cap']})"
    )
    return integration_snapshot, None


def fetch_financials(code):
    """
    네이버 finance/annual API에서 연간 재무실적(매출액, 영업이익, 당기순이익, 영업이익률, ROE, 부채비율)을 수집합니다.
    URL: https://m.stock.naver.com/api/stock/{code}/finance/annual
    """
    url = f"https://m.stock.naver.com/api/stock/{code}/finance/annual"
    logger.info(f"[NAVER] 네이버 금융 finance/annual API 접근 시작 (code={code})")

    try:
        response = requests.get(url, headers=HEADERS, timeout=5)
        response.raise_for_status()
        data = response.json()
    except requests.exceptions.Timeout:
        return [], "네이버 금융 재무정보 응답 시간이 초과되었습니다 (Timeout)."
    except requests.exceptions.RequestException as e:
        return [], f"네이버 금융 재무정보 접근 실패: {str(e)}"
    except ValueError:
        return [], "네이버 금융 재무정보 응답(JSON) 파싱 실패"

    finance_info = data.get("financeInfo") or {}
    titles = finance_info.get("trTitleList") or []
    rows = finance_info.get("rowList") or []

    # 행 제목 -> {기간키: 값} 매핑
    row_map = {}
    for row in rows:
        if not isinstance(row, dict):
            continue
        row_title = row.get("title")
        columns = row.get("columns") or {}
        if row_title:
            row_map[row_title] = {
                k: v.get("value") for k, v in columns.items() if isinstance(v, dict)
            }

    financials = []
    for period_info in titles:
        if not isinstance(period_info, dict):
            continue
        p_key = period_info.get("key")
        if not p_key:
            continue
        financials.append({
            "period": period_info.get("title"),
            "is_consensus": period_info.get("isConsensus") == "Y",
            "revenue": clean_number(row_map.get("매출액", {}).get(p_key), int),
            "operating_profit": clean_number(row_map.get("영업이익", {}).get(p_key), int),
            "net_income": clean_number(row_map.get("당기순이익", {}).get(p_key), int),
            "operating_margin": clean_number(row_map.get("영업이익률", {}).get(p_key), float),
            "roe": clean_number(row_map.get("ROE", {}).get(p_key), float),
            "debt_ratio": clean_number(row_map.get("부채비율", {}).get(p_key), float),
        })

    logger.info(f"[PARSE] 재무실적 수집 완료 ({len(financials)}개 기간)")
    return financials, None


def fetch_news(stock_name, num=5):
    """
    Serper News API를 통해 해당 종목의 최신 한국어 뉴스를 수집합니다.
    URL: https://google.serper.dev/news
    """
    api_key = os.getenv("SERPER_API_KEY")
    if not api_key or api_key == "your_serper_api_key_here":
        return [], "SERPER_API_KEY가 설정되지 않았습니다. (.env 파일 확인 필요)"

    url = "https://google.serper.dev/news"
    headers = {
        "X-API-KEY": api_key,
        "Content-Type": "application/json",
    }
    payload = {
        "q": f"{stock_name} 주가",
        "gl": "kr",
        "hl": "ko",
        "num": num,
    }
    logger.info(f"[SERPER] 뉴스 API 검색 시작 (query='{payload['q']}', num={num})")

    try:
        response = requests.post(url, headers=headers, json=payload, timeout=5)
        response.raise_for_status()
        data = response.json()
    except requests.exceptions.Timeout:
        return [], "Serper 뉴스 API 응답 시간이 초과되었습니다 (Timeout)."
    except requests.exceptions.RequestException as e:
        return [], f"Serper 뉴스 API 접근 실패: {str(e)}"
    except ValueError:
        return [], "Serper 뉴스 API 응답(JSON) 파싱 실패"

    news_items = []
    for item in (data.get("news") or [])[:num]:
        if not isinstance(item, dict):
            continue
        news_items.append({
            "title": item.get("title"),
            "link": item.get("link"),
            "source": item.get("source"),
            "date": item.get("date"),
            "snippet": item.get("snippet"),
        })

    logger.info(f"[PARSE] 뉴스 수집 완료 ({len(news_items)}건)")
    return news_items, None


def collect_stock_data(code):
    """
    종목 분석 웹앱을 위한 통합 데이터 수집 함수 (4차: 실시간 시세 + 투자정보 + 재무실적 + 뉴스 수집)
    """
    result = {
        "code": str(code).strip() if code else "",
        "name": None,
        "snapshot": {},
        "financials": [],
        "news": [],
        "errors": []
    }

    # 1. 종목코드 검증
    is_valid, validated_code = validate_code(code)
    if not is_valid:
        result["errors"].append(validated_code)
        logger.error(f"[ERROR] 종목코드 유효성 검증 실패: {validated_code}")
        return result

    result["code"] = validated_code

    # 2. Basic API 수집 (종목명 및 실시간 시세)
    basic_data, err = fetch_basic(validated_code)
    if err:
        result["errors"].append(err)
        logger.error(f"[ERROR] {err}")
        return result

    result["name"] = basic_data["name"]
    result["snapshot"].update(basic_data["snapshot"])

    # 3. Integration API 수집 (PER, PBR, 시가총액, 52주 최고/최저 등 투자정보)
    integration_data, err = fetch_integration(validated_code)
    if err:
        result["errors"].append(err)
        logger.warning(f"[WARN] {err}")
    else:
        result["snapshot"].update(integration_data)

    # 4. Finance Annual API 수집 (매출액, 영업이익, 당기순이익, ROE 등 연간 재무실적)
    financials_data, err = fetch_financials(validated_code)
    if err:
        result["errors"].append(err)
        logger.warning(f"[WARN] {err}")
    else:
        result["financials"] = financials_data

    # 5. Serper News API 수집 (최신 뉴스 5건)
    news_data, err = fetch_news(result["name"], num=5)
    if err:
        result["errors"].append(err)
        logger.warning(f"[WARN] {err}")
    else:
        result["news"] = news_data

    return result
