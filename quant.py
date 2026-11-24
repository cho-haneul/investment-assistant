import datetime as dt
import logging
import FinanceDataReader as fdr
import numpy as np
import pandas as pd
from collector import fetch_stock_name, is_us_ticker, validate_code

logger = logging.getLogger(__name__)


def _clean_codes(codes):
    """종목코드 리스트(국내 6자리 또는 미국 티커)를 정제하고 중복을 제거합니다."""
    cleaned = []
    seen = set()
    for c in codes:
        raw = str(c).strip()
        if not raw:
            continue
        ok, validated = validate_code(raw)
        if not ok:
            return None, validated
        if validated not in seen:
            seen.add(validated)
            cleaned.append(validated)
    return cleaned, None


def _compute_mdd(daily_returns):
    """일별 수익률 시리즈에서 최대낙폭(MDD, %)을 계산합니다."""
    if daily_returns.empty:
        return 0.0
    cum_curve = (1.0 + daily_returns).cumprod()
    running_max = cum_curve.cummax()
    drawdown = (cum_curve - running_max) / running_max
    return round(float(drawdown.min() * 100.0), 2)


def _simulate_portfolio_curve(price_df, weights, rebalance_freq="none", initial_capital=10_000_000):
    """
    일별 종가 DataFrame과 목표 비중으로 리밸런싱 주기를 반영한 자산 성장 곡선, CAGR, MDD 시계열을 계산합니다.
    rebalance_freq: 'none' (리밸런싱 없음), 'M' (월간), 'Q' (분기), 'Y' (연간)
    """
    prices = price_df.values.astype(float)
    dates = price_df.index
    n_days = len(dates)
    if n_days == 0:
        return np.array([]), np.array([]), 0.0, 0.0

    shares = (initial_capital * weights) / prices[0]
    values = np.empty(n_days, dtype=float)

    def _period_key(d):
        if rebalance_freq == "M":
            return (d.year, d.month)
        if rebalance_freq == "Q":
            return (d.year, (d.month - 1) // 3)
        if rebalance_freq == "Y":
            return d.year
        return None

    prev_key = _period_key(dates[0]) if rebalance_freq != "none" else None
    for t in range(n_days):
        total_val = float(np.dot(shares, prices[t]))
        values[t] = total_val
        if rebalance_freq != "none" and t > 0:
            cur_key = _period_key(dates[t])
            if cur_key != prev_key:
                shares = (total_val * weights) / prices[t]
                prev_key = cur_key

    running_max = np.maximum.accumulate(values)
    dd_series = (values - running_max) / running_max * 100.0
    mdd_pct = round(float(dd_series.min()), 2)

    years_elapsed = max(n_days - 1, 1) / 252.0
    cagr_pct = round(float(((values[-1] / initial_capital) ** (1.0 / years_elapsed) - 1.0) * 100.0), 2)
    return values, dd_series, cagr_pct, mdd_pct


def calculate_rebalancing(
    codes,
    num_portfolios=2500,
    risk_free_rate=0.035,
    years=1,
    rebalance_freq="none",
    initial_capital=10_000_000,
):
    """
    FinanceDataReader 종가 데이터를 바탕으로
    몬테카를로·효율적 프론티어 적정 비중, 누적 수익률 곡선, CAGR, MDD, 목표 투자금을 계산합니다.
    """
    cleaned_codes, err = _clean_codes(codes)
    if err:
        return None, err

    if len(cleaned_codes) < 2:
        return None, "리밸런싱 계산을 위해 서로 다른 종목/ETF 코드를 2개 이상 입력해 주세요."

    try:
        years = int(years)
    except (TypeError, ValueError):
        years = 1
    if years not in (1, 3, 5):
        years = 1

    rebalance_freq = str(rebalance_freq or "none").upper()
    if rebalance_freq not in ("NONE", "M", "Q", "Y"):
        rebalance_freq = "none"
    elif rebalance_freq == "NONE":
        rebalance_freq = "none"

    try:
        initial_capital = max(100_000, float(initial_capital))
    except (TypeError, ValueError):
        initial_capital = 10_000_000.0

    end_date = dt.date.today()
    start_date = end_date - dt.timedelta(days=365 * years)
    start_str = start_date.strftime("%Y-%m-%d")
    end_str = end_date.strftime("%Y-%m-%d")

    logger.info(f"[QUANT] 리밸런싱 데이터 수집 시작 (codes={cleaned_codes}, {start_str}~{end_str}, freq={rebalance_freq})")

    series_map = {}
    for code in cleaned_codes:
        try:
            df = fdr.DataReader(code, start_str, end_str)
        except Exception as e:
            logger.error(f"[QUANT] FDR 조회 실패 (code={code}): {e}")
            return None, f"종목코드 '{code}'의 주가 데이터를 가져오지 못했습니다: {str(e)}"

        if df is None or df.empty or "Close" not in df.columns:
            return None, f"종목코드 '{code}'의 최근 1년 주가 데이터가 존재하지 않습니다."

        close_series = df["Close"].dropna()
        if len(close_series) < 30:
            return None, f"종목코드 '{code}'의 거래일 데이터가 부족합니다 ({len(close_series)}일)."

        series_map[code] = close_series

    price_df = pd.concat(series_map, axis=1, join="inner").dropna()
    if len(price_df) < 30:
        return None, "입력한 종목들의 공통 거래일 데이터가 부족합니다."

    returns = price_df.pct_change().dropna()
    n_assets = len(cleaned_codes)
    mean_returns = returns.mean().values * 252.0
    cov_matrix = returns.cov().values * 252.0

    # 몬테카를로 시뮬레이션 (고정 시드로 동일 입력에 대해 일관된 결과 보장)
    rng = np.random.default_rng(42)
    weights_matrix = rng.dirichlet(np.ones(n_assets), size=num_portfolios)
    port_returns = weights_matrix @ mean_returns
    port_vols = np.sqrt(np.einsum("ij,jk,ik->i", weights_matrix, cov_matrix, weights_matrix))
    sharpe_ratios = np.where(port_vols > 0, (port_returns - risk_free_rate) / port_vols, 0.0)

    max_sharpe_idx = int(np.argmax(sharpe_ratios))
    min_vol_idx = int(np.argmin(port_vols))

    best_weights = weights_matrix[max_sharpe_idx]
    min_vol_weights = weights_matrix[min_vol_idx]
    equal_weights = np.full(n_assets, 1.0 / n_assets)

    # 동일 비중 지표
    eq_ret = float(equal_weights @ mean_returns)
    eq_vol = float(np.sqrt(equal_weights.T @ cov_matrix @ equal_weights))
    eq_sharpe = (eq_ret - risk_free_rate) / eq_vol if eq_vol > 0 else 0.0

    # 백테스트 곡선 (리밸런싱 주기 및 초기 투자금 반영)
    opt_curve, opt_dd, opt_cagr, opt_sim_mdd = _simulate_portfolio_curve(
        price_df, best_weights, rebalance_freq=rebalance_freq, initial_capital=initial_capital
    )
    eq_curve, eq_dd, eq_cagr, eq_sim_mdd = _simulate_portfolio_curve(
        price_df, equal_weights, rebalance_freq=rebalance_freq, initial_capital=initial_capital
    )

    # 차트 시각화용 성장 곡선 및 MDD 샘플링 (최대 120포인트)
    curve_step = max(1, len(price_df) // 120)
    curve_indices = list(range(0, len(price_df), curve_step))
    if curve_indices and curve_indices[-1] != len(price_df) - 1:
        curve_indices.append(len(price_df) - 1)
    equity_curve = [
        {
            "date": price_df.index[i].strftime("%Y-%m-%d") if hasattr(price_df.index[i], "strftime") else str(price_df.index[i]),
            "optimal_value": round(float(opt_curve[i]), 0),
            "equal_value": round(float(eq_curve[i]), 0),
            "optimal_dd_pct": round(float(opt_dd[i]), 2),
            "equal_dd_pct": round(float(eq_dd[i]), 2),
        }
        for i in curve_indices
    ]

    # 개별 종목 요약 (연율화 수익률, 변동성, 최적 비중, 목표 투자금)
    assets_summary = []
    for i, code in enumerate(cleaned_codes):
        asset_daily = returns[code]
        asset_ret = float(mean_returns[i] * 100.0)
        asset_vol = float(np.sqrt(cov_matrix[i, i]) * 100.0)
        opt_w_pct = round(float(best_weights[i] * 100.0), 2)
        assets_summary.append({
            "code": code,
            "name": fetch_stock_name(code),
            "optimal_weight_pct": opt_w_pct,
            "target_amount": round(float(initial_capital * best_weights[i]), 0),
            "min_vol_weight_pct": round(float(min_vol_weights[i] * 100.0), 2),
            "equal_weight_pct": round(float(equal_weights[i] * 100.0), 2),
            "annual_return_pct": round(asset_ret, 2),
            "annual_volatility_pct": round(asset_vol, 2),
            "mdd_pct": _compute_mdd(asset_daily),
        })

    # 차트 시각화용 프론티어 점 샘플링 (최대 150개)
    sample_step = max(1, num_portfolios // 150)
    frontier_points = [
        {
            "volatility_pct": round(float(port_vols[i] * 100.0), 2),
            "return_pct": round(float(port_returns[i] * 100.0), 2),
            "sharpe": round(float(sharpe_ratios[i]), 3),
        }
        for i in range(0, num_portfolios, sample_step)
    ]

    result = {
        "period": {
            "start": start_str,
            "end": end_str,
            "years": years,
            "rebalance_freq": rebalance_freq,
            "trading_days": int(len(returns)),
        },
        "initial_capital": round(float(initial_capital), 0),
        "num_simulations": int(num_portfolios),
        "risk_free_rate_pct": round(risk_free_rate * 100.0, 2),
        "assets": assets_summary,
        "optimal_portfolio": {
            "expected_return_pct": round(float(port_returns[max_sharpe_idx] * 100.0), 2),
            "cagr_pct": opt_cagr,
            "final_value": round(float(opt_curve[-1]), 0) if len(opt_curve) else round(float(initial_capital), 0),
            "volatility_pct": round(float(port_vols[max_sharpe_idx] * 100.0), 2),
            "sharpe_ratio": round(float(sharpe_ratios[max_sharpe_idx]), 3),
            "mdd_pct": opt_sim_mdd,
        },
        "min_vol_portfolio": {
            "expected_return_pct": round(float(port_returns[min_vol_idx] * 100.0), 2),
            "volatility_pct": round(float(port_vols[min_vol_idx] * 100.0), 2),
            "sharpe_ratio": round(float(sharpe_ratios[min_vol_idx]), 3),
        },
        "equal_portfolio": {
            "expected_return_pct": round(eq_ret * 100.0, 2),
            "cagr_pct": eq_cagr,
            "final_value": round(float(eq_curve[-1]), 0) if len(eq_curve) else round(float(initial_capital), 0),
            "volatility_pct": round(eq_vol * 100.0, 2),
            "sharpe_ratio": round(float(eq_sharpe), 3),
            "mdd_pct": eq_sim_mdd,
        },
        "equity_curve": equity_curve,
        "frontier_points": frontier_points,
    }

    logger.info(
        f"[QUANT] 리밸런싱 계산 완료 (최적 샤프={result['optimal_portfolio']['sharpe_ratio']}, MDD={result['optimal_portfolio']['mdd_pct']}%)"
    )
    return result, None


def _safe_round(val, digits=2):
    """NaN/None 값을 JSON 직렬화 가능한 None 또는 반올림 float로 변환합니다."""
    if val is None or pd.isna(val):
        return None
    return round(float(val), digits)


def calculate_technical_indicators(code, days=365, chart_points=120):
    """
    FinanceDataReader 최근 주가 데이터를 바탕으로
    이동평균(MA5/20/60), RSI(14), MACD(12,26,9), 볼린저밴드(20,2)를 계산합니다.
    """
    ok, code_str = validate_code(code)
    if not ok:
        return None, code_str

    is_us = is_us_ticker(code_str)
    price_digits = 2 if is_us else 0

    end_date = dt.date.today()
    start_date = end_date - dt.timedelta(days=days)
    start_str = start_date.strftime("%Y-%m-%d")
    end_str = end_date.strftime("%Y-%m-%d")

    logger.info(f"[QUANT] 기술지표 데이터 수집 시작 (code={code_str}, {start_str}~{end_str})")

    try:
        df = fdr.DataReader(code_str, start_str, end_str)
    except Exception as e:
        logger.error(f"[QUANT] FDR 기술지표 조회 실패 (code={code_str}): {e}")
        return None, f"종목코드 '{code_str}'의 주가 데이터를 가져오지 못했습니다: {str(e)}"

    if df is None or df.empty or "Close" not in df.columns:
        return None, f"종목코드 '{code_str}'의 주가 데이터가 존재하지 않습니다."

    df = df.copy()
    close = df["Close"].astype(float)

    # 이동평균선
    df["ma5"] = close.rolling(window=5).mean()
    df["ma20"] = close.rolling(window=20).mean()
    df["ma60"] = close.rolling(window=60).mean()

    # RSI (14)
    delta = close.diff()
    gain = delta.clip(lower=0.0)
    loss = (-delta).clip(lower=0.0)
    avg_gain = gain.rolling(window=14).mean()
    avg_loss = loss.rolling(window=14).mean()
    rs = avg_gain / avg_loss.replace(0.0, np.nan)
    df["rsi14"] = 100.0 - (100.0 / (1.0 + rs))
    df.loc[(avg_loss == 0.0) & (avg_gain > 0.0), "rsi14"] = 100.0

    # MACD (12, 26, 9)
    ema12 = close.ewm(span=12, adjust=False).mean()
    ema26 = close.ewm(span=26, adjust=False).mean()
    df["macd"] = ema12 - ema26
    df["macd_signal"] = df["macd"].ewm(span=9, adjust=False).mean()
    df["macd_hist"] = df["macd"] - df["macd_signal"]

    # 볼린저밴드 (20, 2)
    std20 = close.rolling(window=20).std()
    df["bb_upper"] = df["ma20"] + 2.0 * std20
    df["bb_lower"] = df["ma20"] - 2.0 * std20

    recent_df = df.tail(chart_points)
    series = []
    for idx, row in recent_df.iterrows():
        date_str = idx.strftime("%Y-%m-%d") if hasattr(idx, "strftime") else str(idx)
        series.append({
            "date": date_str,
            "close": _safe_round(row["Close"], price_digits),
            "volume": int(row["Volume"]) if "Volume" in row and not pd.isna(row["Volume"]) else 0,
            "ma5": _safe_round(row["ma5"], 2),
            "ma20": _safe_round(row["ma20"], 2),
            "ma60": _safe_round(row["ma60"], 2),
            "rsi14": _safe_round(row["rsi14"], 2),
            "macd": _safe_round(row["macd"], 2),
            "macd_signal": _safe_round(row["macd_signal"], 2),
            "macd_hist": _safe_round(row["macd_hist"], 2),
            "bb_upper": _safe_round(row["bb_upper"], 2),
            "bb_lower": _safe_round(row["bb_lower"], 2),
        })

    latest = series[-1] if series else {}
    logger.info(
        f"[QUANT] 기술지표 계산 완료 (code={code_str}, close={latest.get('close')}, rsi14={latest.get('rsi14')}, macd={latest.get('macd')})"
    )

    return {
        "code": code_str,
        "name": fetch_stock_name(code_str),
        "currency": "USD" if is_us else "KRW",
        "latest": latest,
        "series": series,
    }, None
