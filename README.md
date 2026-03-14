# FEPS — Finite Element Program for General Structure

> **브라우저 기반 2D 유한요소해석 프로그램** | Browser-based 2D Finite Element Analysis

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/Platform-Browser-green.svg)]()
[![Language](https://img.shields.io/badge/Language-Vanilla%20JS-yellow.svg)]()

**FEPS**는 설치 없이 브라우저에서 바로 실행되는 교육용 유한요소해석(FEA) 프로그램입니다.
2D 평면 고체 해석(Solid), 2D/3D 보·트러스 구조 해석을 지원하며, 학생이 직접 JavaScript로 새로운 유한요소를 작성하고 즉시 해석에 활용할 수 있는 **요소 코드 에디터**를 내장하고 있습니다.

---

## 주요 특징

| 기능 | 설명 |
|------|------|
| **설치 불필요** | `index.html`을 브라우저에서 열거나 웹 서버에 올리면 바로 동작 |
| **선형 정적 해석** | LU 분해 직접 해법, 자중·분포하중·온도하중 지원 |
| **2D 자동 메시 생성** | TQMesh (WASM) — advancing-front 삼각형·사각형 혼합 메시, 구멍 지원 |
| **요소 코드 에디터** | JavaScript로 새 유한요소 작성 → 즉시 등록·해석, localStorage 영구 저장 |
| **SRI (전단잠김 방지)** | Selective Reduced Integration — QUAD4 등 저차 요소의 전단잠김 해소 |
| **정적 축소** | Static Condensation — 내부 DOF 자동 제거 (QUAD9 중심절점 등) |
| **후처리 시각화** | 변형 형상, 응력 컬러 컨투어 (von Mises 등), BMD/SFD/AFD 다이어그램 |
| **디버그 뷰어** | 요소 강성행렬 K_e, 절점변위 u_e, 절점력 f_e, 전체 K 행렬 확인 |
| **순수 Vanilla JS** | 외부 의존 없음, 프레임워크 불필요 |

---

## 지원 요소

### 기본 내장 요소

| 요소 | 종류 | 설명 |
|------|------|------|
| `BAR2` | 2D 트러스 | 2절점 봉 요소 (축력) |
| `BAR3D` | 3D 트러스 | 2절점 3차원 봉 요소 |
| `BEAM2D` | 2D 보 | 2절점 오일러-베르누이 보 (분포하중 포함) |
| `BEAM3D` | 3D 보 | 2절점 3차원 보 (비틀림 포함, 6DOF/절점) |
| `TRIG3` | 2D 고체 | 3절점 일차 삼각형 (CST) |
| `QUAD4` | 2D 고체 | 4절점 이중선형 사각형 |

### 플러그인 샘플 요소 (자동 로드)

| 요소 | 설명 |
|------|------|
| `QUAD5` | 5절점 버블 함수 보강 사각형 |
| `QUAD8` | 8절점 세렌디피티 사각형 (이차) |
| `QUAD9` | 9절점 라그랑지 사각형 → 정적 축소로 8절점 동작 |
| `TRIG6` | 6절점 이차 삼각형 |
| `BAR2_3N` | 3절점 이차 2D 봉 요소 |
| `TIMBEAM2D_2N` | 2절점 티모셴코 보 (전단변형 포함) |
| `TIMBEAM2D_3N` | 3절점 티모셴코 보 (이차) |

---

## 빠른 시작

### 로컬에서 실행 (웹 서버 필요)

```bash
# Python 3
python3 -m http.server 8000

# Node.js (npx)
npx serve .
```

브라우저에서 `http://localhost:8000` 접속 후 **Open** 버튼으로 예제 파일을 불러오세요.

> `file://` 프로토콜로 직접 열면 WASM 로딩 및 CORS 제약으로 일부 기능(메시 생성, 도움말)이 작동하지 않습니다.

### GitHub Pages로 배포

저장소 Settings → Pages → Source: `main` 브랜치 루트로 설정하면 됩니다.

---

## 예제 파일 (`examples/`)

| 파일 | 요소 | 설명 |
|------|------|------|
| `ex01-truss-simple.inp` | BAR2 | 단순 2D 트러스, 이론해 검증 |
| `ex02-cantilever-beam.inp` | BEAM2D | 외팔보 처짐 이론해 비교 |
| `ex03-portal-frame.inp` | BEAM2D | 2층 포털 라멘 + 분포하중 |
| `ex04-solid-plate-quad4.inp` | QUAD4 | 2D 고체 캔틸레버 플레이트 |
| `ex05-solid-plate-trig3.inp` | TRIG3 | ex04 동일 형상, TRIG3 메시 비교 |
| `ex06-solid-plate-quad5.inp` | QUAD5 | 버블 함수 보강 — 굽힘 수렴 성능 |
| `ex07-solid-plate-quad9.inp` | QUAD9 | 정적 축소 적용, 이론해의 99.95% |

---

## 요소 코드 에디터

학생이 JavaScript로 직접 유한요소를 구현하고 즉시 해석에 사용할 수 있는 교육 기능입니다.

```javascript
FepsElementRegistry.register({
  name    : 'MY_QUAD4',    // 요소 이름 (고유, 대문자 권장)
  category: 'solid2d',     // 'solid2d' | 'bar1d' | 'beam2d_tim'
  nNodes  : 4,
  dofNode : 2,
  gaussOrder  : 2,
  constitModel: 'planeStress',

  // SRI (전단잠김 방지) — 선택
  sri               : true,
  sriAlpha          : 1.0,   // 정수압 부분 반영 비율
  sriBeta           : 1.0,   // 전단 부분 반영 비율
  gaussOrderReduced : 1,

  // 정적 축소 — 선택 (내부 DOF 자동 제거)
  condense: [8],

  shapeN(xi, eta)  { /* 형상함수 */ },
  shapeDN(xi, eta) { /* 형상함수 미분 */ },
});
```

- 드롭다운에서 참조 템플릿(QUAD4, TRIG3, QUAD4-SRI, QUAD5, QUAD9 등) 선택
- 등록 후 localStorage에 자동 저장 — 새로고침 후에도 복원
- `.js` 파일 내보내기 / 불러오기 지원
- **디버그 모드**로 강성행렬 K_e 수치 검증 가능

---

## 파일 구조

```
FEPS-web/
├── index.html                  — 메인 UI
├── css/style.css               — 스타일시트
├── js/
│   ├── parser.js               — .inp 파일 파서
│   ├── solver.js               — FEA 솔버 (LU 분해)
│   ├── renderer.js             — Canvas 렌더러
│   ├── main.js                 — 앱 컨트롤러
│   ├── element-registry.js     — FepsElementRegistry API
│   ├── element-core.js         — FepsElementCore 유틸 (형상함수·적분·SRI)
│   ├── element-editor-ui.js    — 요소 코드 에디터 UI
│   ├── element-debug.js        — K_e / 전체 K 수집기
│   ├── element-debug-ui.js     — 행렬 뷰어 모달
│   ├── tqmesh.js               — TQMesh WASM 모듈 (메시 엔진)
│   ├── tqmesh-wrapper.js       — FepsTQMesh 래퍼
│   ├── mesher.js / mesher2.js  — 레거시 메시 생성기
│   └── elements/               — 샘플 학생 요소
│       ├── quad5.js / quad8.js / quad9.js
│       ├── trig6.js
│       ├── bar2_3N.js
│       └── TimBeam2D_2N.js / TimBeam2D_3N.js
├── examples/                   — 튜토리얼 .inp 파일 (ex01–ex07)
├── FEPS-UserManual.md          — 사용자 설명서 (Markdown)
└── FEPS-UserManual.html        — 사용자 설명서 (HTML, 내장 도움말용)
```

---

## 기술 스택

| 구성 | 기술 |
|------|------|
| UI / 렌더링 | HTML5 Canvas 2D API |
| 해석 엔진 | Vanilla JavaScript (동기, 메인 스레드) |
| 메시 생성 | [TQMesh](https://github.com/FloSewn/TQMesh) (C++ → Emscripten WASM) |
| 의존 라이브러리 | **없음** |
| 입출력 | `.inp` 텍스트 파일 |

---

## 입력 파일 형식 (`.inp` 개요)

```
# 절점 수  DOF/절점  차원
4  2  2
# 절점 ID  x  y
1  0.0  0.0
2  1.0  0.0
3  1.0  1.0
4  0.0  1.0
# 재료 수
1
# ID  E        nu
1  200000.0  0.3
# 단면 수
1
# ID  A   t
1  1.0  0.1
# 요소 수
1
# TYPE  ID  matID  propID  n1 n2 n3 n4
QUAD4   1   1      1       1  2  3  4
# 경계조건 수
2
# 절점ID  ux uy  Fx Fy
1  1 1  0 0
2  1 0  0 -10
```

자세한 형식은 [사용자 설명서](FEPS-UserManual.md)의 §4를 참조하세요.

---

## 외부 라이브러리 출처

| 라이브러리 | 용도 | 라이선스 |
|-----------|------|---------|
| [TQMesh](https://github.com/FloSewn/TQMesh) (Florian Sewn) | 2D 자동 메시 생성 엔진 (WASM 빌드) | MIT |

---

## 문서

- **[사용자 설명서 (한국어)](FEPS-UserManual.md)** — 전체 기능 설명, API 레퍼런스, 예제 해설
- 프로그램 내 **Help** 버튼으로 인터랙티브 도움말 뷰어 열기 가능

---

## 개발자

**권민호** (Minho Kwon)
경상국립대학교 토목공학과
kwonm@gnu.ac.kr

---

## 라이선스

이 프로젝트는 **MIT License** 하에 배포됩니다.
단, 포함된 외부 라이브러리(TQMesh)도 각각의 라이선스를 따릅니다.
