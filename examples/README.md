# FEPS Example Files

FEPS에서 **Open** 버튼으로 아래 `.inp` 파일을 불러온 후 **▶ Run Analysis** 를 클릭하세요.

| 파일 | 요소 | 설명 |
|------|------|------|
| `ex01-truss-simple.inp` | BAR2 | 3절점 단순 2D 트러스, 집중하중 |
| `ex02-cantilever-beam.inp` | BEAM2D | 외팔보, 자유단 집중하중, 이론해 확인용 |
| `ex03-portal-frame.inp` | BEAM2D | 2층 포털 라멘, 보 등분포 하중 |
| `ex04-solid-plate-quad4.inp` | QUAD4 | 2D 고체 캔틸레버 플레이트, E 변화 실험용 |
| `ex05-solid-plate-trig3.inp` | TRIG3 | ex04와 동일 형상, TRIG3 메시로 비교 |

## E-change 실험 (ex04 / ex05)

1. 파일을 열어 해석 실행 → 최대 Uy 기록
2. **Materials** 목록에서 M1 의 ✎ 버튼 클릭
3. E 값을 2배로 변경 → **Update M1** → **▶ Run Analysis**
4. 최대 Uy가 정확히 절반으로 줄어드는지 확인
5. 응력 컨투어(von Mises)는 E와 무관하게 동일한지 확인

## 이론해 검증 (ex02)

외팔보 자유단 처짐: `δ = P·L³ / (3·E·I)`

- P = 10 kN, L = 5 m, E = 2×10⁸ kN/m², I = 1.333×10⁻⁴ m⁴
- δ ≈ **0.01563 m (15.6 mm)**

FEPS 해석 결과 Uy (Node 2) 와 비교하세요.
