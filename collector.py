import datetime as dt
import json
import logging
import os
import re
import tempfile
from collections import Counter
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


_DELISTED_KR_CACHE = None
_DELISTED_CACHE_PATH = os.path.join(tempfile.gettempdir(), "krx_delisting_cache.json")


def _get_delisted_kr_map():
    """FinanceDataReader KRX-DELISTING 목록을 조회해 {종목코드: 정보} 딕셔너리로 캐시합니다."""
    global _DELISTED_KR_CACHE
    if _DELISTED_KR_CACHE is not None:
        return _DELISTED_KR_CACHE

    if os.path.exists(_DELISTED_CACHE_PATH):
        try:
            mtime = dt.datetime.fromtimestamp(os.path.getmtime(_DELISTED_CACHE_PATH))
            if (dt.datetime.now() - mtime).total_seconds() < 86400:
                with open(_DELISTED_CACHE_PATH, "r", encoding="utf-8") as f:
                    _DELISTED_KR_CACHE = json.load(f)
                return _DELISTED_KR_CACHE
        except Exception:
            pass

    try:
        import FinanceDataReader as fdr
        df = fdr.StockListing("KRX-DELISTING")
        mapping = {}
        if df is not None and not df.empty:
            for _, row in df.iterrows():
                sym = str(row.get("Symbol") or "").strip()
                nm = str(row.get("Name") or "").strip()
                if not sym or not nm or len(sym) != 6 or not sym.isdigit():
                    continue
                del_dt = row.get("DelistingDate")
                del_str = str(del_dt)[:10] if del_dt is not None and str(del_dt) != "NaT" else ""
                mapping[sym] = {
                    "code": sym,
                    "name": nm,
                    "market": str(row.get("Market") or "KRX").strip(),
                    "delisting_date": del_str,
                    "reason": str(row.get("Reason") or "").strip(),
                }
        _DELISTED_KR_CACHE = mapping
        try:
            with open(_DELISTED_CACHE_PATH, "w", encoding="utf-8") as f:
                json.dump(mapping, f, ensure_ascii=False)
        except Exception:
            pass
        return mapping
    except Exception as e:
        logger.warning(f"[DELISTED] KRX-DELISTING 조회 실패: {e}")
        _DELISTED_KR_CACHE = {}
        return _DELISTED_KR_CACHE


def _search_via_serper(query):
    """네이버 자동완성에 없는 해외/특수 종목명(예: 이노홀딩스 -> INHD)을 Serper 웹검색으로 역추적합니다."""
    api_key = os.getenv("SERPER_API_KEY")
    if not api_key or api_key == "your_serper_api_key_here":
        return []

    try:
        resp = requests.post(
            "https://google.serper.dev/search",
            headers={"X-API-KEY": api_key, "Content-Type": "application/json"},
            json={"q": f"{query} 주가 종목코드 티커", "gl": "kr", "hl": "ko", "num": 5},
            timeout=4,
        )
        resp.raise_for_status()
        data = resp.json()
    except Exception:
        return []

    stop_words = {"USD", "KRW", "ETF", "SEC", "IPO", "CEO", "USA", "KOR", "AI", "MY", "IT", "PC", "TV", "PER", "PBR", "EPS", "BPS", "ROE", "ROA", "NYSE", "AMEX", "KOSPI"}
    q_tokens = [tok for tok in re.split(r"\s+", query.strip().lower()) if len(tok) >= 2]
    q_compact = re.sub(r"\s+", "", query.lower())

    ticker_counts = Counter()
    kr6_counts = Counter()
    for item in (data.get("organic") or []):
        txt = f"{item.get('title', '')} {item.get('snippet', '')}"
        txt_compact = re.sub(r"\s+", "", txt.lower())
        # 검색어 핵심 글자(2자 이상 토큰 또는 앞 2글자)가 실제 결과 스니펫에 포함된 경우만 신뢰
        matched = (q_compact[:2] and q_compact[:2] in txt_compact) or any(tok in txt_compact for tok in q_tokens)
        if not matched:
            continue
        for t in re.findall(r"(?:[(:\s]|^|\b)([A-Z]{2,5})(?:[)\s.,]|$|\b)", txt):
            if t not in stop_words:
                ticker_counts[t] += 1
        for k in re.findall(r"\b(\d{6})\b", txt):
            kr6_counts[k] += 1

    candidates = []
    for t, _ in ticker_counts.most_common(3):
        us_data, err = fetch_us_basic(t)
        if not err and us_data:
            candidates.append({
                "code": t,
                "name": us_data["name"],
                "nation": "USA",
                "market": us_data["snapshot"].get("market") or "US",
            })
            break

    if not candidates:
        for k, _ in kr6_counts.most_common(2):
            kr_data, err = fetch_basic(k)
            if not err and kr_data:
                candidates.append({
                    "code": k,
                    "name": kr_data["name"],
                    "nation": "KOR",
                    "market": kr_data["snapshot"].get("market") or "KRX",
                })
                break

    return candidates


def search_stocks(query, limit=8):
    """네이버 증권 자동완성 + KRX 상장폐지 목록 + Serper 웹검색 폴백으로 국내/미국/상장폐지 종목을 검색합니다."""
    q = str(query or "").strip()
    if not q:
        return [], None

    results = []
    seen = set()

    url = "https://ac.stock.naver.com/ac"
    params = {"q": q, "target": "stock,etf,worldstock"}
    try:
        resp = requests.get(url, params=params, headers=HEADERS, timeout=4)
        resp.raise_for_status()
        data = resp.json()
        for item in (data.get("items") or []):
            if not isinstance(item, dict):
                continue
            code = str(item.get("code") or "").strip().upper()
            name = str(item.get("name") or "").strip()
            if not code or not name or code in seen:
                continue
            if not (len(code) == 6 and code.isdigit()) and not is_us_ticker(code):
                continue
            seen.add(code)
            results.append({
                "code": code,
                "name": name,
                "nation": item.get("nationCode") or "KOR",
                "market": item.get("typeName") or item.get("typeCode") or "",
            })
            if len(results) >= limit:
                break
    except (requests.exceptions.RequestException, ValueError) as e:
        logger.warning(f"[SEARCH] 네이버 자동완성 실패: {e}")

    # 2차: 국내 상장폐지/거래정지 이력 종목 검색 (KRX-DELISTING)
    if len(results) < limit:
        q_norm = q.replace(" ", "").lower()
        delisted_map = _get_delisted_kr_map()
        for sym, info in delisted_map.items():
            if sym in seen:
                continue
            nm_norm = info["name"].replace(" ", "").lower()
            if q_norm in nm_norm or q == sym:
                seen.add(sym)
                results.append({
                    "code": sym,
                    "name": info["name"],
                    "nation": "KOR",
                    "market": f"{info['market']} (상장폐지 {info['delisting_date']})",
                })
                if len(results) >= limit:
                    break

    # 3차: 여전히 검색 결과가 없으면 Serper 웹검색으로 티커/코드 역추적 (예: 이노홀딩스 -> INHD)
    if not results:
        for cand in _search_via_serper(q):
            if cand["code"] not in seen:
                seen.add(cand["code"])
                results.append(cand)

    return results, None


def resolve_stock_input(raw_input):
    """
    사용자가 입력한 종목코드(국내 6자리, 미국 티커) 또는 종목명(예: 대성하이텍, 바이오인프라, apple)을
    실제 조회 가능한 종목코드로 변환합니다.
    """
    q = str(raw_input or "").strip()
    if not q:
        return None, "종목명 또는 종목코드를 입력해 주세요."

    q_upper = q.upper()
    if len(q_upper) == 6 and q_upper.isdigit():
        return q_upper, None

    # 영문 소문자 포함 단어(예: apple, tesla)는 티커가 아닌 기업명 검색 우선
    if is_us_ticker(q_upper) and q == q_upper:
        us_basic, err = fetch_us_basic(q_upper)
        if not err and us_basic:
            return q_upper, None

    items, err = search_stocks(q, limit=8)
    if items:
        q_norm = q.replace(" ", "").lower()
        for it in items:
            if (it.get("name") or "").replace(" ", "").lower() == q_norm:
                return it["code"], None
        return items[0]["code"], None

    if is_us_ticker(q_upper):
        return q_upper, None

    return None, f"'{q}'에 해당하는 국내/미국 종목을 찾지 못했습니다."


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

    # 1. 종목코드/종목명 자동 해석 및 검증
    resolved_code, err = resolve_stock_input(code)
    if err or not resolved_code:
        msg = err or f"종목을 찾지 못했습니다: '{code}'"
        result["errors"].append(msg)
        logger.error(f"[ERROR] 종목 해석 실패: {msg}")
        return result

    validated_code = resolved_code
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
        # 상장폐지된 국내 종목인지 확인해 과거 정보 + 뉴스라도 제공
        delisted_info = _get_delisted_kr_map().get(validated_code)
        if delisted_info:
            result["name"] = delisted_info["name"]
            result["asset_type"] = "stock"
            last_px = None
            try:
                import FinanceDataReader as fdr
                df_hist = fdr.DataReader(validated_code)
                if df_hist is not None and not df_hist.empty and "Close" in df_hist.columns:
                    last_px = int(float(df_hist["Close"].dropna().iloc[-1]))
            except Exception:
                pass
            result["snapshot"] = {
                "current_price": last_px,
                "change_price": 0,
                "change_rate": 0.0,
                "market": delisted_info["market"],
                "market_status": f"상장폐지 ({delisted_info['delisting_date']})",
                "delisting_reason": delisted_info.get("reason") or "상장폐지",
            }
            news_data, _ = fetch_news(delisted_info["name"], num=5)
            result["news"] = news_data or []
            return result

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
