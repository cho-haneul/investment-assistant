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

# 미국 티커 -> 네이버 reutersCode 캐시 (예: AAPL -> AAPL.O, SPY -> SPY)
_US_REUTERS_CACHE = {}

_US_TICKER_RE = re.compile(r"^[A-Z]{1,5}([.-][A-Z]{1,2})?$")


def is_us_ticker(code):
    """미국 주식/ETF 티커 형식(영문 1~5자, 예: AAPL, SPY, BRK.B)인지 판별합니다."""
    if not code:
        return False
    return bool(_US_TICKER_RE.match(str(code).strip().upper()))


def validate_code(code):
    """종목코드가 국내 6자리 숫자 또는 미국 티커(영문 1~5자)인지 검증합니다."""
    if not code:
        return False, "종목코드가 입력되지 않았습니다."
    code_str = str(code).strip().upper()
    if len(code_str) == 6 and code_str.isdigit():
        return True, code_str
    if is_us_ticker(code_str):
        return True, code_str
    return False, f"국내 6자리 숫자 또는 미국 티커(예: AAPL, SPY)를 입력해 주세요. (입력값: '{code}')"

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

    asset_type = "etf" if data.get("stockEndType") == "etf" else "stock"

    change_price = clean_number(data.get("compareToPreviousClosePrice"), int)
    change_rate = clean_number(data.get("fluctuationsRatio"), float)
    dir_code = (data.get("compareToPreviousPrice") or {}).get("code")
    if dir_code == "5":
        if change_price is not None:
            change_price = -abs(change_price)
        if change_rate is not None:
            change_rate = -abs(change_rate)
    elif dir_code == "3":
        change_price = 0
        change_rate = 0.0

    basic_snapshot = {
        "current_price": clean_number(data.get("closePrice"), int),
        "change_price": change_price,
        "change_rate": change_rate,
        "market": data.get("stockExchangeName"),
        "market_status": data.get("marketStatus")
    }

    logger.info(f"[PARSE] 기본 시세 수집 완료 (name={name}, type={asset_type}, current_price={basic_snapshot['current_price']})")
    return {"name": name, "asset_type": asset_type, "snapshot": basic_snapshot}, None


def fetch_stock_name(code):
    """종목코드(국내 6자리 또는 미국 티커)로 공식 종목명(또는 ETF명)만 빠르게 조회합니다."""
    is_valid, validated_code = validate_code(code)
    if not is_valid:
        return str(code or "").strip()
    if is_us_ticker(validated_code):
        us_data, err = fetch_us_basic(validated_code)
        if err or not us_data:
            return validated_code
        return us_data.get("name") or validated_code
    basic_data, err = fetch_basic(validated_code)
    if err or not basic_data:
        return validated_code
    return basic_data.get("name") or validated_code


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

    etf_ind = data.get("etfKeyIndicator") or {}
    deal_trends = data.get("dealTrendInfos") or []
    consensus = data.get("consensusInfo") or {}
    is_etf = data.get("stockEndType") == "etf" or bool(etf_ind)

    dividend_yield = clean_number(info_map.get("dividendYieldRatio"), float)
    if dividend_yield is None and etf_ind.get("dividendYieldTtm") is not None:
        dividend_yield = clean_number(etf_ind.get("dividendYieldTtm"), float)

    foreign_rate = clean_number(info_map.get("foreignRate"), float)
    if foreign_rate is None and deal_trends and isinstance(deal_trends[0], dict):
        foreign_rate = clean_number(deal_trends[0].get("foreignerHoldRatio"), float)

    integration_snapshot = {
        "market_cap": info_map.get("marketValue") or etf_ind.get("marketValue"),
        "per": clean_number(info_map.get("per"), float),
        "cns_per": clean_number(info_map.get("cnsPer"), float),
        "pbr": clean_number(info_map.get("pbr"), float),
        "eps": clean_number(info_map.get("eps"), int),
        "bps": clean_number(info_map.get("bps"), int),
        "high_52w": clean_number(info_map.get("highPriceOf52Weeks"), int),
        "low_52w": clean_number(info_map.get("lowPriceOf52Weeks"), int),
        "dividend_yield": dividend_yield,
        "dividend": clean_number(info_map.get("dividend"), int),
        "foreign_rate": foreign_rate,
        "target_price": clean_number(consensus.get("priceTargetMean"), int),
        "recomm_mean": clean_number(consensus.get("recommMean"), float),
    }

    etf_info = None
    if is_etf:
        dev_rate = clean_number(etf_ind.get("deviationRate"), float)
        if dev_rate is not None and etf_ind.get("deviationSign") == "-":
            dev_rate = -abs(dev_rate)

        total_fee = clean_number(etf_ind.get("totalFee"), float)
        if total_fee is None:
            total_fee = clean_number(info_map.get("fundPay"), float)

        etf_info = {
            "issuer": etf_ind.get("issuerName") or info_map.get("issueName"),
            "base_index": info_map.get("etfBaseIdx"),
            "total_nav": etf_ind.get("totalNav"),
            "nav": clean_number(info_map.get("nav"), float) or clean_number(etf_ind.get("nav"), float),
            "deviation_rate": dev_rate,
            "total_fee": total_fee,
            "return_1m": clean_number(info_map.get("oneMonthEarnRate"), float),
            "return_3m": clean_number(info_map.get("threeMonthEarnRate"), float),
            "return_6m": clean_number(info_map.get("sixMonthEarnRate"), float),
            "return_1y": clean_number(info_map.get("oneYearEarnRate"), float),
            "description": data.get("description"),
        }

    logger.info(
        f"[PARSE] 투자정보 수집 완료 (PER={integration_snapshot['per']}, PBR={integration_snapshot['pbr']}, 시총={integration_snapshot['market_cap']}, is_etf={is_etf})"
    )
    return {"snapshot": integration_snapshot, "etf_info": etf_info}, None


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


def _extract_us_basic_payload(data, ticker):
    """네이버 해외증시 basic 응답에서 시세와 주요 투자지표(stockItemTotalInfos)를 추출합니다."""
    name = data.get("stockName") or data.get("stockNameEng")
    if not name:
        return None, "미국 종목명을 확인하지 못했습니다."

    asset_type = "etf" if (data.get("stockEndType") == "etf" or data.get("isEtf")) else "stock"

    change_price = clean_number(data.get("compareToPreviousClosePrice"), float)
    change_rate = clean_number(data.get("fluctuationsRatio"), float)
    dir_code = (data.get("compareToPreviousPrice") or {}).get("code")
    if dir_code == "5":
        if change_price is not None:
            change_price = -abs(change_price)
        if change_rate is not None:
            change_rate = -abs(change_rate)
    elif dir_code == "3":
        change_price = 0.0
        change_rate = 0.0

    info_map = {
        item.get("code"): item.get("value")
        for item in (data.get("stockItemTotalInfos") or [])
        if isinstance(item, dict) and item.get("code")
    }

    snapshot = {
        "current_price": clean_number(data.get("closePrice"), float),
        "change_price": change_price,
        "change_rate": change_rate,
        "market": data.get("stockExchangeName") or "US",
        "market_status": data.get("marketStatus"),
        "market_cap": info_map.get("marketValue"),
        "per": clean_number(info_map.get("per"), float),
        "cns_per": None,
        "pbr": clean_number(info_map.get("pbr"), float),
        "eps": clean_number(info_map.get("eps"), float),
        "bps": clean_number(info_map.get("bps"), float),
        "high_52w": clean_number(info_map.get("highPriceOf52Weeks"), float),
        "low_52w": clean_number(info_map.get("lowPriceOf52Weeks"), float),
        "dividend_yield": clean_number(info_map.get("dividendYieldRatio"), float),
        "dividend": clean_number(info_map.get("dividend"), float),
        "foreign_rate": None,
        "target_price": None,
        "recomm_mean": None,
    }

    return {
        "name": name,
        "name_eng": data.get("stockNameEng"),
        "reuters_code": data.get("reutersCode") or ticker,
        "asset_type": asset_type,
        "snapshot": snapshot,
    }, None


def fetch_us_basic(ticker):
    """네이버 해외증시 basic API로 미국 주식/ETF 시세 및 기본 투자지표를 수집합니다."""
    ticker = str(ticker).strip().upper()
    candidates = [_US_REUTERS_CACHE[ticker]] if ticker in _US_REUTERS_CACHE else [
        ticker, f"{ticker}.O", f"{ticker}.N", f"{ticker}.K"
    ]

    for cand in candidates:
        url = f"https://api.stock.naver.com/stock/{cand}/basic"
        try:
            resp = requests.get(url, headers=HEADERS, timeout=5)
            if resp.status_code != 200:
                continue
            data = resp.json()
            if not data.get("stockName") and not data.get("stockNameEng"):
                continue
            _US_REUTERS_CACHE[ticker] = data.get("reutersCode") or cand
            parsed, err = _extract_us_basic_payload(data, ticker)
            if err:
                return None, err
            logger.info(f"[NAVER-US] 기본 시세 수집 완료 (ticker={ticker}, reuters={_US_REUTERS_CACHE[ticker]}, price={parsed['snapshot']['current_price']})")
            return parsed, None
        except (requests.exceptions.RequestException, ValueError):
            continue

    return None, f"미국 종목/ETF '{ticker}'을(를) 네이버 해외증시에서 찾지 못했습니다."


def fetch_us_integration(reuters_code):
    """네이버 해외증시 integration API에서 증권가 목표주가(컨센서스) 및 기업 개요를 수집합니다."""
    url = f"https://api.stock.naver.com/stock/{reuters_code}/integration"
    try:
        resp = requests.get(url, headers=HEADERS, timeout=5)
        resp.raise_for_status()
        data = resp.json()
    except (requests.exceptions.RequestException, ValueError) as e:
        return None, f"미국 종목 투자정보 조회 실패: {str(e)}"

    consensus = data.get("consensusInfo") or {}
    return {
        "target_price": clean_number(consensus.get("priceTargetMean"), float),
        "recomm_mean": clean_number(consensus.get("recommMean"), float),
        "overview": data.get("corporateOverview"),
    }, None


def fetch_us_financials(reuters_code):
    """네이버 해외증시 finance/annual API에서 연간 재무실적(USD 백만 단위)을 수집합니다."""
    url = f"https://api.stock.naver.com/stock/{reuters_code}/finance/annual"
    try:
        resp = requests.get(url, headers=HEADERS, timeout=5)
        resp.raise_for_status()
        data = resp.json()
    except (requests.exceptions.RequestException, ValueError) as e:
        return [], f"미국 종목 재무정보 조회 실패: {str(e)}"

    titles = data.get("trTitleList") or []
    rows = data.get("rowList") or []
    row_map = {}
    for row in rows:
        if not isinstance(row, dict):
            continue
        title = row.get("title")
        cols = row.get("columns") or {}
        if title:
            row_map[title] = {k: v.get("value") for k, v in cols.items() if isinstance(v, dict)}

    financials = []
    for period_info in titles:
        if not isinstance(period_info, dict):
            continue
        p_key = period_info.get("key")
        if not p_key:
            continue
        rev = clean_number(row_map.get("매출액", {}).get(p_key), float)
        ebit = clean_number(row_map.get("EBIT", {}).get(p_key), float)
        net = clean_number(row_map.get("당기순이익", {}).get(p_key), float)
        op_margin = round((ebit / rev) * 100.0, 2) if (rev and ebit is not None) else None
        financials.append({
            "period": period_info.get("title"),
            "is_consensus": period_info.get("isConsensus") == "Y",
            "revenue": rev,
            "operating_profit": ebit,
            "net_income": net,
            "operating_margin": op_margin,
            "roe": clean_number(row_map.get("ROE", {}).get(p_key), float),
            "debt_ratio": clean_number(row_map.get("부채비율", {}).get(p_key), float),
        })

    logger.info(f"[NAVER-US] 재무실적 수집 완료 ({len(financials)}개 기간)")
    return financials, None


def collect_stock_data(code):
    """
    종목 분석 웹앱을 위한 통합 데이터 수집 함수 (국내 주식·ETF + 미국 주식·ETF 지원)
    """
    result = {
        "code": str(code).strip() if code else "",
        "name": None,
        "asset_type": "stock",
        "market_region": "KR",
        "currency": "KRW",
        "finance_unit": "억원",
        "snapshot": {},
        "etf_info": None,
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

    # 미국 주식/ETF 분기
    if is_us_ticker(validated_code):
        result["market_region"] = "US"
        result["currency"] = "USD"
        result["finance_unit"] = "백만 USD"

        us_basic, err = fetch_us_basic(validated_code)
        if err:
            result["errors"].append(err)
            logger.error(f"[ERROR] {err}")
            return result

        result["name"] = us_basic["name"]
        result["asset_type"] = us_basic["asset_type"]
        result["snapshot"].update(us_basic["snapshot"])
        reuters_code = us_basic["reuters_code"]

        us_integ, err = fetch_us_integration(reuters_code)
        if err:
            result["errors"].append(err)
            logger.warning(f"[WARN] {err}")
        elif us_integ:
            if us_integ.get("target_price") is not None:
                result["snapshot"]["target_price"] = us_integ["target_price"]
            if us_integ.get("recomm_mean") is not None:
                result["snapshot"]["recomm_mean"] = us_integ["recomm_mean"]
            if result["asset_type"] == "etf":
                result["etf_info"] = {
                    "issuer": None,
                    "base_index": None,
                    "total_nav": None,
                    "nav": None,
                    "deviation_rate": None,
                    "total_fee": None,
                    "return_1m": None,
                    "return_3m": None,
                    "return_6m": None,
                    "return_1y": None,
                    "description": us_integ.get("overview"),
                }

        if result["asset_type"] != "etf":
            us_fin, err = fetch_us_financials(reuters_code)
            if err:
                result["errors"].append(err)
                logger.warning(f"[WARN] {err}")
            else:
                result["financials"] = us_fin

        news_query = f"{validated_code} {result['name']}" if result["asset_type"] == "stock" else f"{validated_code} ETF"
        news_data, err = fetch_news(news_query, num=5)
        if err:
            result["errors"].append(err)
            logger.warning(f"[WARN] {err}")
        else:
            result["news"] = news_data
        return result

    # 2. 국내 주식/ETF Basic API 수집
    basic_data, err = fetch_basic(validated_code)
    if err:
        result["errors"].append(err)
        logger.error(f"[ERROR] {err}")
        return result

    result["name"] = basic_data["name"]
    result["asset_type"] = basic_data.get("asset_type", "stock")
    result["snapshot"].update(basic_data["snapshot"])

    # 3. Integration API 수집 (PER, PBR, 시가총액, 52주 최고/최저 및 ETF 전용 지표)
    integration_data, err = fetch_integration(validated_code)
    if err:
        result["errors"].append(err)
        logger.warning(f"[WARN] {err}")
    else:
        result["snapshot"].update(integration_data["snapshot"])
        if integration_data.get("etf_info"):
            result["asset_type"] = "etf"
            result["etf_info"] = integration_data["etf_info"]

    # 4. Finance Annual API 수집 (ETF는 기업 재무제표가 없으므로 생략)
    if result["asset_type"] != "etf":
        financials_data, err = fetch_financials(validated_code)
        if err:
            result["errors"].append(err)
            logger.warning(f"[WARN] {err}")
        else:
            result["financials"] = financials_data
    else:
        logger.info(f"[PARSE] ETF 종목이므로 기업 재무실적 조회 생략 (code={validated_code})")

    # 5. Serper News API 수집 (최신 뉴스 5건)
    news_query = result["name"]
    if result["asset_type"] == "etf" and "ETF" not in news_query.upper():
        news_query = f"{news_query} ETF"
    news_data, err = fetch_news(news_query, num=5)
    if err:
        result["errors"].append(err)
        logger.warning(f"[WARN] {err}")
    else:
        result["news"] = news_data

    return result
