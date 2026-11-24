import datetime as dt
import io
import json
import logging
import os
import tempfile
import xml.etree.ElementTree as ET
import zipfile
import requests
from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger(__name__)

DART_BASE_URL = "https://opendart.fss.or.kr/api"
_CORP_CACHE_PATH = os.path.join(tempfile.gettempdir(), "dart_corp_codes_cache.json")
_CORP_CACHE = None


def _get_api_key():
    key = (os.getenv("DART_API_KEY") or "").strip()
    if not key or key == "your_dart_api_key_here":
        return None
    return key


def _get_corp_code_map(api_key):
    """
    Open DART corpCode.xml을 내려받아 {6자리 종목코드: {corp_code, corp_name}} 매핑을 반환합니다.
    속도를 위해 임시 폴더에 캐시합니다(24시간 유효).
    """
    global _CORP_CACHE
    if _CORP_CACHE is not None:
        return _CORP_CACHE, None

    # 디스크 캐시 확인 (24시간 이내면 재사용)
    if os.path.exists(_CORP_CACHE_PATH):
        try:
            mtime = dt.datetime.fromtimestamp(os.path.getmtime(_CORP_CACHE_PATH))
            if (dt.datetime.now() - mtime).total_seconds() < 86400:
                with open(_CORP_CACHE_PATH, "r", encoding="utf-8") as f:
                    _CORP_CACHE = json.load(f)
                return _CORP_CACHE, None
        except Exception:
            pass

    logger.info("[DART] corpCode.xml 고유번호 목록 다운로드 시작")
    try:
        resp = requests.get(
            f"{DART_BASE_URL}/corpCode.xml",
            params={"crtfc_key": api_key},
            timeout=15,
        )
        resp.raise_for_status()
        with zipfile.ZipFile(io.BytesIO(resp.content)) as zf:
            xml_name = zf.namelist()[0]
            xml_bytes = zf.read(xml_name)
    except Exception as e:
        return None, f"DART 기업 고유번호 목록 조회 실패: {str(e)}"

    try:
        root = ET.fromstring(xml_bytes)
        mapping = {}
        for item in root.findall("list"):
            stock_code = (item.findtext("stock_code") or "").strip()
            corp_code = (item.findtext("corp_code") or "").strip()
            corp_name = (item.findtext("corp_name") or "").strip()
            if stock_code and corp_code:
                mapping[stock_code] = {
                    "corp_code": corp_code,
                    "corp_name": corp_name,
                }
        _CORP_CACHE = mapping
        try:
            with open(_CORP_CACHE_PATH, "w", encoding="utf-8") as f:
                json.dump(mapping, f, ensure_ascii=False)
        except Exception:
            pass
        logger.info(f"[DART] 고유번호 매핑 완료 ({len(mapping)}개 상장사)")
        return mapping, None
    except Exception as e:
        return None, f"DART 고유번호 XML 파싱 실패: {str(e)}"


def _classify_disclosure(title):
    """공시 제목을 초보자용 카테고리(호재/주주환원, 주의/희석, 실적/정기, 일반)로 분류합니다."""
    t = str(title or "")
    if any(k in t for k in ("유상증자", "전환사채", "신주인수권부사채", "교환사채", "감자", "상장폐지", "관리종목", "불성실공시")):
        return "주의"
    if any(k in t for k in ("자기주식", "배당", "단일판매", "공급계약", "무상증자", "신규시설투자")):
        return "호재"
    if any(k in t for k in ("잠정실적", "매출액또는손익구조", "사업보고서", "분기보고서", "반기보고서", "영업(잠정)")):
        return "실적"
    return "일반"


def _parse_amount_eok(val):
    """원 단위 문자열을 억원(float)으로 변환합니다."""
    if val is None:
        return None
    s = str(val).replace(",", "").strip()
    if not s or s == "-":
        return None
    try:
        return round(float(s) / 100_000_000.0, 1)
    except ValueError:
        return None


def _fetch_cashflow_and_balance(api_key, corp_code):
    """최근 결산 사업보고서(11011) 기준 현금흐름표 및 요약 재무상태(억원)를 조회합니다."""
    cur_year = dt.date.today().year
    for year in (cur_year - 1, cur_year - 2):
        for fs_div in ("CFS", "OFS"):
            try:
                resp = requests.get(
                    f"{DART_BASE_URL}/fnlttSinglAcntAll.json",
                    params={
                        "crtfc_key": api_key,
                        "corp_code": corp_code,
                        "bsns_year": str(year),
                        "reprt_code": "11011",
                        "fs_div": fs_div,
                    },
                    timeout=8,
                )
                data = resp.json()
                if data.get("status") != "000":
                    continue
                items = data.get("list") or []
                if not items:
                    continue

                cf = {"operating": None, "investing": None, "financing": None}
                bs = {"assets": None, "liabilities": None, "equity": None}

                for row in items:
                    sj = row.get("sj_div")
                    nm = (row.get("account_nm") or "").replace(" ", "")
                    amt = _parse_amount_eok(row.get("thstrm_amount"))
                    if amt is None:
                        continue
                    if sj == "CF":
                        if cf["operating"] is None and ("영업활동현금흐름" in nm or "영업활동으로인한현금흐름" in nm):
                            cf["operating"] = amt
                        elif cf["investing"] is None and ("투자활동현금흐름" in nm or "투자활동으로인한현금흐름" in nm):
                            cf["investing"] = amt
                        elif cf["financing"] is None and ("재무활동현금흐름" in nm or "재무활동으로인한현금흐름" in nm):
                            cf["financing"] = amt
                    elif sj == "BS":
                        if bs["assets"] is None and nm == "자산총계":
                            bs["assets"] = amt
                        elif bs["liabilities"] is None and nm == "부채총계":
                            bs["liabilities"] = amt
                        elif bs["equity"] is None and nm == "자본총계":
                            bs["equity"] = amt

                if any(v is not None for v in cf.values()):
                    op_cf = cf["operating"]
                    inv_cf = cf["investing"]
                    if op_cf is not None and op_cf > 0 and inv_cf is not None and inv_cf < 0:
                        health = "우량 (본업 현금 창출 + 미래 투자)"
                    elif op_cf is not None and op_cf > 0:
                        health = "양호 (본업에서 현금 유입)"
                    elif op_cf is not None and op_cf < 0:
                        health = "주의 (영업활동 현금 유출)"
                    else:
                        health = "판단 보류"

                    return {
                        "bsns_year": str(year),
                        "fs_type": "연결" if fs_div == "CFS" else "별도",
                        "cashflow": cf,
                        "balance": bs,
                        "health_label": health,
                    }
            except Exception:
                continue
    return None


def collect_dart_data(stock_code):
    """
    6자리 국내 상장 종목코드(또는 종목명)를 받아 Open DART에서
    기업 개황, 최근 90일 공시 목록, 현금흐름표, 임원·대주주 지분 변동을 수집합니다.
    """
    raw = str(stock_code or "").strip().upper()
    if len(raw) != 6 or not raw.isdigit():
        from collector import resolve_stock_input
        resolved, r_err = resolve_stock_input(stock_code)
        if resolved and len(resolved) == 6 and resolved.isdigit():
            code = resolved
        else:
            return None, "DART 공시는 국내 상장 6자리 숫자 종목코드(또는 국내 상장사 이름)만 지원합니다. (예: 005930, 삼성전자)"
    else:
        code = raw

    api_key = _get_api_key()
    if not api_key:
        return None, "DART_API_KEY가 설정되지 않았습니다. (.env 파일을 확인해 주세요)"

    corp_map, err = _get_corp_code_map(api_key)
    if err:
        return None, err

    corp_info = corp_map.get(code)
    if not corp_info:
        return None, f"종목코드 '{code}'에 해당하는 DART 상장 법인을 찾지 못했습니다. (ETF·미국주식은 DART 공시 대상이 아닙니다)"

    corp_code = corp_info["corp_code"]
    logger.info(f"[DART] 데이터 수집 시작 (code={code}, corp_code={corp_code}, name={corp_info['corp_name']})")

    # 1. 기업 개황
    company = {}
    try:
        r_comp = requests.get(
            f"{DART_BASE_URL}/company.json",
            params={"crtfc_key": api_key, "corp_code": corp_code},
            timeout=5,
        ).json()
        if r_comp.get("status") == "000":
            cls_map = {"Y": "유가증권(코스피)", "K": "코스닥", "N": "코넥스", "E": "기타"}
            company = {
                "corp_name": r_comp.get("corp_name"),
                "ceo_name": r_comp.get("ceo_nm"),
                "market": cls_map.get(r_comp.get("corp_cls"), r_comp.get("corp_cls")),
                "est_dt": r_comp.get("est_dt"),
                "acc_mt": r_comp.get("acc_mt"),
                "hm_url": r_comp.get("hm_url"),
            }
    except Exception as e:
        logger.warning(f"[DART] company.json 실패: {e}")

    # 2. 최근 90일 공시 목록 (최대 15건)
    disclosures = []
    end_d = dt.date.today()
    bgn_d = end_d - dt.timedelta(days=90)
    try:
        r_list = requests.get(
            f"{DART_BASE_URL}/list.json",
            params={
                "crtfc_key": api_key,
                "corp_code": corp_code,
                "bgn_de": bgn_d.strftime("%Y%m%d"),
                "end_de": end_d.strftime("%Y%m%d"),
                "page_count": 15,
            },
            timeout=6,
        ).json()
        if r_list.get("status") == "000":
            for item in (r_list.get("list") or []):
                rcept_no = item.get("rcept_no")
                title = item.get("report_nm")
                disclosures.append({
                    "rcept_dt": item.get("rcept_dt"),
                    "report_nm": title,
                    "tag": _classify_disclosure(title),
                    "flr_nm": item.get("flr_nm"),
                    "url": f"https://dart.fss.or.kr/dsaf001/main.do?rcpNo={rcept_no}" if rcept_no else "#",
                })
    except Exception as e:
        logger.warning(f"[DART] list.json 실패: {e}")

    # 3. 현금흐름표 & 요약 재무상태
    financial_health = _fetch_cashflow_and_balance(api_key, corp_code)

    # 4. 임원·주요주주 소유상황 (elestock.json, 최근 8건)
    insider_trades = []
    try:
        r_ele = requests.get(
            f"{DART_BASE_URL}/elestock.json",
            params={"crtfc_key": api_key, "corp_code": corp_code},
            timeout=5,
        ).json()
        if r_ele.get("status") == "000":
            for item in (r_ele.get("list") or [])[-8:][::-1]:
                insider_trades.append({
                    "rcept_dt": item.get("rcept_dt"),
                    "repror": item.get("repror"),
                    "position": item.get("isu_exctv_ofcps") or item.get("isu_main_shrholdr") or "-",
                    "shares": item.get("sp_stock_lmp_cnt"),
                    "shares_diff": item.get("sp_stock_lmp_irds_cnt"),
                    "rate": item.get("sp_stock_lmp_rate"),
                    "rate_diff": item.get("sp_stock_lmp_irds_rate"),
                })
    except Exception as e:
        logger.warning(f"[DART] elestock.json 실패: {e}")

    # 5. 대량보유 상황보고 (majorstock.json, 최근 5건)
    major_holders = []
    try:
        r_maj = requests.get(
            f"{DART_BASE_URL}/majorstock.json",
            params={"crtfc_key": api_key, "corp_code": corp_code},
            timeout=5,
        ).json()
        if r_maj.get("status") == "000":
            for item in (r_maj.get("list") or [])[-5:][::-1]:
                major_holders.append({
                    "rcept_dt": item.get("rcept_dt"),
                    "repror": item.get("repror"),
                    "rate": item.get("stkrt"),
                    "rate_diff": item.get("stkrt_irds"),
                    "reason": item.get("report_resn"),
                })
    except Exception as e:
        logger.warning(f"[DART] majorstock.json 실패: {e}")

    return {
        "code": code,
        "corp_code": corp_code,
        "name": company.get("corp_name") or corp_info["corp_name"],
        "company": company,
        "disclosures": disclosures,
        "financial_health": financial_health,
        "insider_trades": insider_trades,
        "major_holders": major_holders,
    }, None
