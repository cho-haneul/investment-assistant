# 나의 투자도우미 (My Investment Assistant)

국내 주식·ETF, 미국 주식·ETF, 퀀트 포트폴리오 백테스트, 기술지표, 그리고 금융감독원 Open DART 전자공시까지 한 곳에서 조회·분석할 수 있는 초보자 친화형 투자 학습·분석 웹앱입니다.

---

## 주요 기능 (4개 탭)

### 탭 1. 종목 심층분석 채팅 (`Dify: 투자종목분석기`)
- **국내 주식 · 국내 ETF · 미국 주식 · 미국 ETF 통합 지원** (`005930`, `069500`, `AAPL`, `SPY` 등)
- **종목명/티커 자동완성 검색**: 한글/영문 종목명(`삼성전자`, `애플`, `KODEX 200`)으로 검색 가능
- **자산 유형 배지**: `국내 주식` / `미국 주식` / `국내 ETF` / `미국 ETF` 자동 구분
- **시각화 대시보드**:
  - 52주 주가 위치 게이지 바
  - 일반 주식: 연간 매출·영업이익·순이익 막대 차트, 영업이익률·ROE·부채비율(또는 목표주가 비교) 차트
  - ETF: 1·3·6·12개월 수익률 차트, NAV·현재가·52주 범위 비교 차트
- **근거 기반 AI 애널리스트**: 네이버 금융/해외증시 API + Serper 최신 뉴스를 수집해 전문가 프롬프트로 1차 리포트를 생성하고 후속 Q&A 지원

### 탭 2. 리밸런싱 도우미 (`100% Python 퀀트 계산`)
- **몬테카를로 & 효율적 프론티어**: `FinanceDataReader` 데이터로 최대 샤프 비중 및 최소 변동성 비중 계산 (고정 시드로 재현성 보장)
- **백테스트 옵션**: 기간(`1년 / 3년 / 5년`), 리밸런싱 주기(`없음 / 매월 / 분기별 / 매년`), 전략 모드(`정적 자산배분` vs `동적 모멘텀 60일선 추세 방어`), 벤치마크(`KODEX 200` / `SPY`) 선택
- **시각화 & 성과표**: 누적 자산 성장 곡선, 낙폭(MDD) 추이 차트, CAGR(연평균 복리 수익률), 연도별 수익률 비교표
- **실전 매수·매도 수량 계산기**: 총 투자금액(원)과 현재 보유 수량(주) 입력 시 `+N주 매수 / -N주 매도` 즉시 계산 (미국 종목은 `USD/KRW` 환율 자동 반영)
- **대표 전략 프리셋 & 저장**: `60/40`, `영구 포트폴리오`, `올웨더 맛보기` 프리셋 및 `localStorage` 기반 내 포트폴리오 저장/불러오기

### 탭 3. 기술지표 차트 + 채팅 (`Dify: 지표해석기`)
- **기술지표 계산 & 차트**: 이동평균선(`MA5 / MA20 / MA60`), 볼린저밴드(`20, 2`), `RSI(14)`, `MACD(12, 26, 9)` 시각화
- **AI 지표 해석**: 계산된 최신 기술지표 숫자를 백엔드에서 숨김 주입해 초보자 눈높이로 해석

### 탭 4. DART 공시·재무 (`Open DART + AI 번역`)
- **기업 공식 개황**: 대표이사, 상장 시장, 설립일, 결산월, DART 고유번호
- **현금흐름표 & 재무상태**: 영업·투자·재무활동 현금흐름 막대 차트 및 현금흐름 건강도 판정
- **최근 90일 주요 공시 피드**: `호재 / 주의 / 실적 / 일반` 자동 분류 및 DART 원문 링크 연결
- **임원·주요주주 지분 변동**: 최근 내부자 지분 변동 내역 표시
- **AI 공시 번역기**: 공시·현금흐름·지분변동 데이터를 바탕으로 초보자용 요약 및 Q&A 제공

### 공통 기능
- **내 관심종목 즐겨찾기 바 (`localStorage`)**: 자주 보는 종목을 저장해 어느 탭에서든 원클릭 조회
- **초보자용 지표 설명 & 면책 고지**: 주요 지표 카드마다 한 줄 설명 제공

---

## 기술 스택 & 파일 구조

- **Backend**: Python, Flask, Requests, FinanceDataReader, NumPy, Pandas
- **Frontend**: Vanilla JavaScript, Chart.js, Marked + DOMPurify
- **External APIs**: Naver Finance (국내/해외증시), Serper News API, Dify Chatbot API, 금융감독원 Open DART API

```text
investment-assistant/
├── app.py               # Flask 서버 및 API 라우트 (/fetch, /api/search, /api/rebalance, /api/technical, /api/dart, /api/chat/*)
├── collector.py         # 네이버 국내/해외증시 + Serper 뉴스 수집 및 종목 검색
├── quant.py             # FinanceDataReader 기반 퀀트 리밸런싱·백테스트·기술지표 계산
├── dart_client.py       # Open DART API 연동 (고유번호 매핑, 기업개황, 공시, 현금흐름, 지분변동)
├── dify_client.py       # Dify 챗봇 연동 (투자종목분석기, 지표해석기)
├── templates/
│   ├── index.html       # 메인 4탭 대시보드
│   └── test.html        # 1차 원데이터 테스트 화면 (/test)
├── static/
│   ├── app.js           # 프론트엔드 로직 및 Chart.js 차트 렌더링
│   ├── style.css        # 에메랄드·세이지 그린 테마 스타일
│   └── test.js          # /test 화면 스크립트
├── requirements.txt
└── .env.example
```

---

## 설치 및 실행 방법

### 1. 가상환경 생성 및 패키지 설치
```powershell
python -m venv venv
.\venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

### 2. 환경변수 설정 (`.env`)
`.env.example`을 복사해 `.env` 파일을 만들고 API 키를 입력합니다.
```env
SERPER_API_KEY=your_serper_api_key_here
DIFY_BASE_URL=https://api.dify.ai/v1
DIFY_ANALYSIS_API_KEY=your_dify_analysis_api_key_here
DIFY_TECH_API_KEY=your_dify_tech_api_key_here
DART_API_KEY=your_dart_api_key_here
FLASK_DEBUG=false
```

### 3. 서버 실행
```powershell
.\venv\Scripts\python.exe app.py
```
실행 후 브라우저에서 `http://127.0.0.1:5000`으로 접속합니다.

---

> ※ 본 서비스의 시세·재무·공시 데이터는 네이버 금융, FinanceDataReader, Open DART를 기반으로 제공되며, AI 분석 및 퀀트 시뮬레이션 결과는 투자 학습·참고용일 뿐 실제 투자 권유가 아닙니다.
