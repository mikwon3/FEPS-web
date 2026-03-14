/* ========================================================================
   element-editor-ui.js  –  요소 코드 에디터 UI 로직

   ▶ 학생이 웹 브라우저에서 직접 요소 코드를 작성·등록할 수 있는 에디터.
   ▶ FepsElementRegistry.register(...) 를 eval()로 실행하여 즉시 등록.
   ▶ 템플릿 코드 제공, 로그 출력, 등록 요소 목록 표시.
   ======================================================================== */

(function () {

    // ── 템플릿 코드 저장소 ──────────────────────────────────────────────

    const TEMPLATES = {

        quad4: `/* QUAD4 — 4절점 사각형 요소 (쌍선형, Bilinear)
 * 절점: 코너 4개
 *   4(−1,+1) ── 3(+1,+1)
 *       |             |
 *   1(−1,−1) ── 2(+1,−1)
 * 구성방정식: constitModel 을 변경하세요
 *   'planeStress'  → 평면응력  (σz = 0)   ← 박판, 평면 문제
 *   'planeStrain'  → 평면변형률 (εz = 0)  ← 단면, 댐, 터널 등
 * 주의: 굽힘 지배 문제에서 전단잠김 발생 → QUAD4-SRI 사용 권장
 */
FepsElementRegistry.register({
  name: 'QUAD4',
  category: 'solid2d',
  nNodes: 4,
  dofPerNode: 2,
  cornerNodes: 4,

  constitModel: 'planeStress',  // ← 여기를 변경
  gaussOrder: 2,                // 2×2 가우스 구적 (표준)

  // 형상함수 N(ξ, η) — 쌍선형 (bilinear)
  shapeN(xi, eta) {
    const N = new Float64Array(4);
    N[0] = 0.25*(1-xi)*(1-eta);   // 절점 1 (−1,−1)
    N[1] = 0.25*(1+xi)*(1-eta);   // 절점 2 (+1,−1)
    N[2] = 0.25*(1+xi)*(1+eta);   // 절점 3 (+1,+1)
    N[3] = 0.25*(1-xi)*(1+eta);   // 절점 4 (−1,+1)
    return N;
  },

  // 형상함수 도함수 ∂N/∂ξ, ∂N/∂η
  shapeDN(xi, eta) {
    const dxi  = new Float64Array(4);
    const deta = new Float64Array(4);
    dxi[0]  = -0.25*(1-eta);  deta[0] = -0.25*(1-xi);
    dxi[1]  =  0.25*(1-eta);  deta[1] = -0.25*(1+xi);
    dxi[2]  =  0.25*(1+eta);  deta[2] =  0.25*(1+xi);
    dxi[3]  = -0.25*(1+eta);  deta[3] =  0.25*(1-xi);
    return { dxi, deta };
  }
});`,

        quad4_sri: `/* QUAD4-SRI — 4절점 사각형 요소 + 전단잠김 방지 (SRI)
 * ──────────────────────────────────────────────────────────────────
 * SRI (Selective Reduced Integration):
 *   구성행렬 D = D_vol (정수압) + D_dev (전단)
 *
 *   D_vol (full 가우스) — 체적변화 정확 표현
 *   D_dev (축소 가우스) — 전단잠김(shear locking) 제거
 *
 *   K = α·K_vol(D_vol, gaussOrder) + β·K_dev(D_dev, gaussOrderReduced)
 *
 * 권장값: α=1.0, β=1.0, gaussOrderReduced=1 (2×2 → 1×1 축소)
 *
 * 구성방정식: constitModel 을 변경하세요
 *   'planeStress'  → 평면응력  (σz = 0)   ← 박판, 평면 문제
 *   'planeStrain'  → 평면변형률 (εz = 0)  ← 단면, 댐, 터널 등
 * ──────────────────────────────────────────────────────────────────
 */
FepsElementRegistry.register({
  name: 'QUAD4SRI',
  category: 'solid2d',
  nNodes: 4,
  dofPerNode: 2,
  cornerNodes: 4,

  constitModel: 'planeStress',  // ← 여기를 변경
  gaussOrder: 2,                // full 적분 차수 (사각형: 2×2)

  sri: true,               // SRI 활성화 — 전단잠김 방지
  sriAlpha: 1.0,           // 정수압 부분 반영 비율 (full 적분)
  sriBeta: 1.0,            // 전단 부분 반영 비율 (축소 적분)
  gaussOrderReduced: 1,    // 축소 적분 차수 (1×1 가우스)

  // 형상함수 N(ξ, η) — 쌍선형 (bilinear)
  shapeN(xi, eta) {
    const N = new Float64Array(4);
    N[0] = 0.25*(1-xi)*(1-eta);
    N[1] = 0.25*(1+xi)*(1-eta);
    N[2] = 0.25*(1+xi)*(1+eta);
    N[3] = 0.25*(1-xi)*(1+eta);
    return N;
  },

  // 형상함수 도함수 ∂N/∂ξ, ∂N/∂η
  shapeDN(xi, eta) {
    const dxi  = new Float64Array(4);
    const deta = new Float64Array(4);
    dxi[0]  = -0.25*(1-eta);  deta[0] = -0.25*(1-xi);
    dxi[1]  =  0.25*(1-eta);  deta[1] = -0.25*(1+xi);
    dxi[2]  =  0.25*(1+eta);  deta[2] =  0.25*(1+xi);
    dxi[3]  = -0.25*(1+eta);  deta[3] =  0.25*(1-xi);
    return { dxi, deta };
  }
});`,

        quad5: `/* QUAD5 — 5절점 사각형 요소 (버블 함수)
 * 절점: 4코너 (±1,±1) + 1중심 (0,0)
 * 구성방정식: constitModel 을 변경하세요
 *   'planeStress'  → 평면응력  (σz = 0)
 *   'planeStrain'  → 평면변형률 (εz = 0)
 */
FepsElementRegistry.register({
  name: 'QUAD5',
  category: 'solid2d',
  nNodes: 5,
  dofPerNode: 2,
  cornerNodes: 4,

  constitModel: 'planeStress',  // ← 여기를 변경
  gaussOrder: 3,

  // 형상함수 N(ξ, η)
  shapeN(xi, eta) {
    const N = new Float64Array(5);
    const bub = (1 - xi*xi) * (1 - eta*eta);
    N[0] = 0.25*(1-xi)*(1-eta) - 0.25*bub;
    N[1] = 0.25*(1+xi)*(1-eta) - 0.25*bub;
    N[2] = 0.25*(1+xi)*(1+eta) - 0.25*bub;
    N[3] = 0.25*(1-xi)*(1+eta) - 0.25*bub;
    N[4] = bub;
    return N;
  },

  // 형상함수 도함수 ∂N/∂ξ, ∂N/∂η
  shapeDN(xi, eta) {
    const dxi = new Float64Array(5), deta = new Float64Array(5);
    const db_dxi  =  2*xi  * (eta*eta - 1);
    const db_deta =  2*eta * (xi*xi  - 1);
    dxi[0]  = -0.25*(1-eta) - 0.25*db_dxi;
    dxi[1]  =  0.25*(1-eta) - 0.25*db_dxi;
    dxi[2]  =  0.25*(1+eta) - 0.25*db_dxi;
    dxi[3]  = -0.25*(1+eta) - 0.25*db_dxi;
    deta[0] = -0.25*(1-xi)  - 0.25*db_deta;
    deta[1] = -0.25*(1+xi)  - 0.25*db_deta;
    deta[2] =  0.25*(1+xi)  - 0.25*db_deta;
    deta[3] =  0.25*(1-xi)  - 0.25*db_deta;
    dxi[4]  = -db_dxi;
    deta[4] = -db_deta;
    return { dxi, deta };
  }
});`,

        quad8: `/* QUAD8 — 8절점 세렌디피티 사각형 요소
 * 절점: 코너 4 + 변중점 4
 * 1:(−1,−1) 2:(+1,−1) 3:(+1,+1) 4:(−1,+1)
 * 5:(0,−1)  6:(+1,0)  7:(0,+1)  8:(−1,0)
 */
FepsElementRegistry.register({
  name: 'QUAD8',
  category: 'solid2d',
  nNodes: 8,
  dofPerNode: 2,
  cornerNodes: 4,

  constitModel: 'planeStress',  // 'planeStress' | 'planeStrain'
  gaussOrder: 3,

  shapeN(xi, eta) {
    const N = new Float64Array(8);
    // 코너 (세렌디피티)
    N[0] = 0.25*(1-xi)*(1-eta)*(-xi-eta-1);
    N[1] = 0.25*(1+xi)*(1-eta)*( xi-eta-1);
    N[2] = 0.25*(1+xi)*(1+eta)*( xi+eta-1);
    N[3] = 0.25*(1-xi)*(1+eta)*(-xi+eta-1);
    // 변중점
    N[4] = 0.5*(1-xi*xi)*(1-eta);
    N[5] = 0.5*(1+xi)*(1-eta*eta);
    N[6] = 0.5*(1-xi*xi)*(1+eta);
    N[7] = 0.5*(1-xi)*(1-eta*eta);
    return N;
  },

  shapeDN(xi, eta) {
    const dxi = new Float64Array(8), deta = new Float64Array(8);
    dxi[0]  =  0.25*(1-eta)*(2*xi+eta);
    dxi[1]  =  0.25*(1-eta)*(2*xi-eta);
    dxi[2]  =  0.25*(1+eta)*(2*xi+eta);
    dxi[3]  =  0.25*(1+eta)*(2*xi-eta);
    deta[0] =  0.25*(1-xi)*(xi+2*eta);
    deta[1] =  0.25*(1+xi)*(-xi+2*eta);
    deta[2] =  0.25*(1+xi)*(xi+2*eta);
    deta[3] =  0.25*(1-xi)*(-xi+2*eta);
    dxi[4]  = -xi*(1-eta);
    dxi[5]  =  0.5*(1-eta*eta);
    dxi[6]  = -xi*(1+eta);
    dxi[7]  = -0.5*(1-eta*eta);
    deta[4] = -0.5*(1-xi*xi);
    deta[5] = -(1+xi)*eta;
    deta[6] =  0.5*(1-xi*xi);
    deta[7] = -(1-xi)*eta;
    return { dxi, deta };
  }
});`,

        quad9: `/* QUAD9 — 9절점 라그랑지 사각형 요소
 * 형상함수: 1D 라그랑지의 텐서곱
 * 절점 9개: 코너4 + 변중점4 + 중심1
 */
FepsElementRegistry.register({
  name: 'QUAD9',
  category: 'solid2d',
  nNodes: 9,
  dofPerNode: 2,
  cornerNodes: 4,

  constitModel: 'planeStress',  // 'planeStress' | 'planeStrain'
  gaussOrder: 3,

  shapeN(xi, eta) {
    // 1D 라그랑지 기저
    const L1x = xi*(xi-1)/2, L2x = xi*(xi+1)/2, L3x = 1-xi*xi;
    const L1e = eta*(eta-1)/2, L2e = eta*(eta+1)/2, L3e = 1-eta*eta;
    const N = new Float64Array(9);
    N[0]=L1x*L1e; N[1]=L2x*L1e; N[2]=L2x*L2e; N[3]=L1x*L2e;
    N[4]=L3x*L1e; N[5]=L2x*L3e; N[6]=L3x*L2e; N[7]=L1x*L3e;
    N[8]=L3x*L3e;
    return N;
  },

  shapeDN(xi, eta) {
    const L1x=xi*(xi-1)/2, L2x=xi*(xi+1)/2, L3x=1-xi*xi;
    const dL1x=xi-0.5,     dL2x=xi+0.5,     dL3x=-2*xi;
    const L1e=eta*(eta-1)/2, L2e=eta*(eta+1)/2, L3e=1-eta*eta;
    const dL1e=eta-0.5,      dL2e=eta+0.5,      dL3e=-2*eta;
    const dxi=new Float64Array(9), deta=new Float64Array(9);
    dxi[0]=dL1x*L1e; deta[0]=L1x*dL1e;
    dxi[1]=dL2x*L1e; deta[1]=L2x*dL1e;
    dxi[2]=dL2x*L2e; deta[2]=L2x*dL2e;
    dxi[3]=dL1x*L2e; deta[3]=L1x*dL2e;
    dxi[4]=dL3x*L1e; deta[4]=L3x*dL1e;
    dxi[5]=dL2x*L3e; deta[5]=L2x*dL3e;
    dxi[6]=dL3x*L2e; deta[6]=L3x*dL2e;
    dxi[7]=dL1x*L3e; deta[7]=L1x*dL3e;
    dxi[8]=dL3x*L3e; deta[8]=L3x*dL3e;
    return { dxi, deta };
  }
});`,

        trig3: `/* TRIG3 — 3절점 삼각형 요소 (선형, CST)
 * CST: Constant Strain Triangle — 요소 내 변형률 일정
 * 기준삼각형: (0,0)-(1,0)-(0,1)  (ξ, η ≥ 0, ξ+η ≤ 1)
 * 절점:
 *   1:(0,0)  2:(1,0)  3:(0,1)
 * 면적 좌표: L1=1−ξ−η, L2=ξ, L3=η
 * 구성방정식: constitModel 을 변경하세요
 *   'planeStress'  → 평면응력  (σz = 0)
 *   'planeStrain'  → 평면변형률 (εz = 0)
 */
FepsElementRegistry.register({
  name: 'TRIG3',
  category: 'solid2d',
  nNodes: 3,
  dofPerNode: 2,
  cornerNodes: 3,
  triangular: true,             // 삼각형 자연좌표계 사용

  constitModel: 'planeStress',  // ← 여기를 변경
  gaussOrder: 1,                // 1점 구적 (선형 요소에 충분)

  // 형상함수 N(ξ, η)
  shapeN(xi, eta) {
    const N = new Float64Array(3);
    N[0] = 1 - xi - eta;   // L1: 절점 1
    N[1] = xi;              // L2: 절점 2
    N[2] = eta;             // L3: 절점 3
    return N;
  },

  // 형상함수 도함수 ∂N/∂ξ, ∂N/∂η (상수)
  shapeDN(xi, eta) {
    const dxi  = new Float64Array(3);
    const deta = new Float64Array(3);
    dxi[0]  = -1;  deta[0] = -1;   // ∂L1/∂ξ = −1,  ∂L1/∂η = −1
    dxi[1]  =  1;  deta[1] =  0;   // ∂L2/∂ξ = +1,  ∂L2/∂η =  0
    dxi[2]  =  0;  deta[2] =  1;   // ∂L3/∂ξ =  0,  ∂L3/∂η = +1
    return { dxi, deta };
  }
});`,

        trig6: `/* TRIG6 — 6절점 2차 삼각형 요소
 * 기준삼각형: (0,0)-(1,0)-(0,1)
 * 절점: 코너3 + 변중점3
 * 1:(0,0)  2:(1,0)  3:(0,1)
 * 4:(0.5,0) 5:(0.5,0.5) 6:(0,0.5)
 * 면적 좌표: L1=1-ξ-η, L2=ξ, L3=η
 */
FepsElementRegistry.register({
  name: 'TRIG6',
  category: 'solid2d',
  nNodes: 6,
  dofPerNode: 2,
  cornerNodes: 3,
  triangular: true,

  constitModel: 'planeStress',  // 'planeStress' | 'planeStrain'
  gaussOrder: 3,

  shapeN(xi, eta) {
    const L1=1-xi-eta, L2=xi, L3=eta;
    const N = new Float64Array(6);
    N[0] = L1*(2*L1-1);  N[1] = L2*(2*L2-1);  N[2] = L3*(2*L3-1);
    N[3] = 4*L1*L2;      N[4] = 4*L2*L3;      N[5] = 4*L1*L3;
    return N;
  },

  shapeDN(xi, eta) {
    const L1=1-xi-eta, L2=xi, L3=eta;
    const dxi=new Float64Array(6), deta=new Float64Array(6);
    dxi[0]  = 1-4*L1;    deta[0] = 1-4*L1;
    dxi[1]  = 4*L2-1;    deta[1] = 0;
    dxi[2]  = 0;          deta[2] = 4*L3-1;
    dxi[3]  = 4*(L1-L2); deta[3] = -4*L2;
    dxi[4]  = 4*L3;       deta[4] = 4*L2;
    dxi[5]  = -4*L3;      deta[5] = 4*(L1-L3);
    return { dxi, deta };
  }
});`,

        bar2_3n: `/* BAR2_3N — 3절점 2D 봉 요소
 * 절점: ①(끝단1)──③(중간)──②(끝단2)
 * 자유도: [u1,v1, u3,v3, u2,v2]
 * 구성방정식: N = EA·ε  (축력-축변형률)
 */
FepsElementRegistry.register({
  name: 'BAR2_3N',
  category: 'bar1d',
  nNodes: 3,
  dofPerNode: 2,
  gaussOrder: 3,

  // 1D 라그랑지 2차 형상함수 (ξ=-1: 끝단1, ξ=0: 중간, ξ=+1: 끝단2)
  shapeN1D(xi) {
    const N = new Float64Array(3);
    N[0] = xi*(xi-1)/2;   // ξ=-1
    N[1] = (1-xi*xi);     // ξ= 0
    N[2] = xi*(xi+1)/2;   // ξ=+1
    return N;
  },

  // 도함수 dN/dξ
  shapeDN1D(xi) {
    const dN = new Float64Array(3);
    dN[0] = xi - 0.5;   // (2ξ-1)/2
    dN[1] = -2*xi;
    dN[2] = xi + 0.5;   // (2ξ+1)/2
    return dN;
  }
});`,

        timbeam2n: `/* TIMBEAM2D_2N — 2절점 티모셴코 2D 보 요소
 * 자유도: [u1, v1, θ1, u2, v2, θ2]
 * 구성방정식:
 *   N = EA·ε          (축력-축변형률)
 *   M = EI·κ          (모멘트-곡률)
 *   V = κs·GA·γ       (전단력-전단변형률)  ← 베르누이 보에 없는 항
 *
 * κ_s (전단보정계수):
 *   직사각형 단면: 5/6 ≈ 0.833
 *   원형 단면:     0.9
 */
FepsElementRegistry.register({
  name: 'TIMBEAM2D_2N',
  category: 'beam2d_tim',
  nNodes: 2,
  dofPerNode: 3,
  kappa: 5/6     // ← 전단보정계수 κ_s 수정 가능
});`,

        timbeam3n: `/* TIMBEAM2D_3N — 3절점 티모셴코 2D 보 요소
 * 절점: ①(끝단1)──③(중간)──②(끝단2)
 * 자유도: [u1,v1,θ1, u3,v3,θ3, u2,v2,θ2]  (총 9)
 * 구성방정식:
 *   N = EA·ε  /  M = EI·κ  /  V = κs·GA·γ
 * 전단 잠김 방지: 전단 항은 2점 가우스 축소 적분 적용
 */
FepsElementRegistry.register({
  name: 'TIMBEAM2D_3N',
  category: 'beam2d_tim',
  nNodes: 3,
  dofPerNode: 3,
  kappa: 5/6
});`,

        blank_solid: `/* 새 2D 고체 요소 템플릿 — 이름과 형상함수를 작성하세요 */
FepsElementRegistry.register({
  name: 'MY_ELEM',          // ← 요소 타입명 (대문자 권장)
  category: 'solid2d',
  nNodes: 4,                // ← 절점 수
  dofPerNode: 2,
  cornerNodes: 4,           // ← 렌더링용 코너 절점 수
  triangular: false,        // 삼각형 자연좌표계 사용 시 true

  constitModel: 'planeStress',  // 'planeStress' | 'planeStrain'
  gaussOrder: 2,                // 가우스 점 수 (방향당)

  // 형상함수: 자연좌표 (xi, eta) → Float64Array[nNodes]
  shapeN(xi, eta) {
    const N = new Float64Array(this.nNodes);
    // TODO: 형상함수 구현
    return N;
  },

  // 도함수: → { dxi: Float64Array[nNodes], deta: Float64Array[nNodes] }
  shapeDN(xi, eta) {
    const dxi  = new Float64Array(this.nNodes);
    const deta = new Float64Array(this.nNodes);
    // TODO: 도함수 구현
    return { dxi, deta };
  }
});`,

        blank_bar: `/* 새 1D 봉 요소 템플릿 */
FepsElementRegistry.register({
  name: 'MY_BAR',
  category: 'bar1d',
  nNodes: 2,          // ← 절점 수
  dofPerNode: 2,
  gaussOrder: 2,

  // 1D 형상함수 (xi ∈ [-1,+1]) → Float64Array[nNodes]
  shapeN1D(xi) {
    const N = new Float64Array(this.nNodes);
    // TODO: 구현
    return N;
  },

  // 도함수 dN/dξ → Float64Array[nNodes]
  shapeDN1D(xi) {
    const dN = new Float64Array(this.nNodes);
    // TODO: 구현
    return dN;
  }
});`,

        blank_beam: `/* 새 티모셴코 보 요소 템플릿 */
FepsElementRegistry.register({
  name: 'MY_BEAM',
  category: 'beam2d_tim',
  nNodes: 2,          // 2 또는 3
  dofPerNode: 3,
  kappa: 5/6          // 전단보정계수
});`
    };

    // ── DOM 참조 ────────────────────────────────────────────────────────

    const overlay  = document.getElementById('modal-editor-overlay');
    const modal    = document.getElementById('modal-elem-editor');
    const btnOpen  = document.getElementById('btn-elem-editor');
    const btnClose = document.getElementById('ee-close');
    const btnReg   = document.getElementById('ee-register');
    const btnLoadTpl   = document.getElementById('ee-load-tpl');
    const btnClearCode = document.getElementById('ee-clear-code');
    const btnClearAll  = document.getElementById('ee-clear-all');
    const btnExport    = document.getElementById('ee-export');
    const btnImport    = document.getElementById('ee-import');
    const fileInput    = document.getElementById('ee-file-input');
    const selTpl   = document.getElementById('ee-template');
    const codeArea = document.getElementById('ee-code');
    const logDiv   = document.getElementById('ee-log');
    const listDiv  = document.getElementById('ee-elem-list');

    // ── SRI 패널 DOM 참조 ───────────────────────────────────────────────

    const chkSRIEnable = document.getElementById('ee-sri-enable');
    const divSRICtrls  = document.getElementById('ee-sri-controls');
    const inpAlpha     = document.getElementById('ee-sri-alpha');
    const inpBeta      = document.getElementById('ee-sri-beta');
    const selGRed      = document.getElementById('ee-sri-gred');
    const btnSRIApply  = document.getElementById('ee-sri-apply');
    const spanSRIHint  = document.getElementById('ee-sri-hint');

    // ── localStorage 키 접두사 ───────────────────────────────────────────
    const STORAGE_PREFIX = 'feps_elem_v1_';

    // ── 모달 열기/닫기 ──────────────────────────────────────────────────

    if (btnOpen) btnOpen.addEventListener('click', () => {
        overlay.classList.remove('hidden');
        _refreshElemList();
        _syncSriPanelFromCode();
        _log('요소 에디터 열림. 템플릿을 선택하거나 직접 코드를 작성하세요.', 'info');
        // 포커스를 코드 입력창으로 이동
        if (codeArea) setTimeout(() => codeArea.focus(), 50);
    });

    const _closeEditor = () => overlay.classList.add('hidden');

    if (btnClose) btnClose.addEventListener('click', _closeEditor);

    // 오버레이 배경 클릭 시 닫기 (dialog 바깥)
    if (overlay) overlay.addEventListener('mousedown', (e) => {
        if (e.target === overlay) _closeEditor();
    });

    // Escape 키로 닫기
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !overlay.classList.contains('hidden')) _closeEditor();
    });

    // ── SRI 패널 로직 ────────────────────────────────────────────────────

    /**
     * 코드에서 SRI 관련 속성을 파싱하여 { sri, alpha, beta, gRed } 반환.
     * 속성이 없으면 기본값: alpha=1.0, beta=1.0, gRed=null(자동).
     */
    function _parseSriFromCode(code) {
        const sri   = /\bsri\s*:\s*true\b/.test(code);
        const alphaM = code.match(/\bsriAlpha\s*:\s*([\d.]+)/);
        const betaM  = code.match(/\bsriBeta\s*:\s*([\d.]+)/);
        const gRedM  = code.match(/\bgaussOrderReduced\s*:\s*(\d+)/);
        return {
            sri,
            alpha: alphaM ? parseFloat(alphaM[1]) : 1.0,
            beta:  betaM  ? parseFloat(betaM[1])  : 1.0,
            gRed:  gRedM  ? gRedM[1]              : ''
        };
    }

    /**
     * 코드에 SRI 속성을 삽입(또는 갱신).
     * - 기존 sri/sriAlpha/sriBeta/gaussOrderReduced 라인을 제거한 뒤 재삽입.
     * - gaussOrder: 행 뒤 또는 constitModel: 행 뒤에 삽입.
     * - enabled=false 이면 SRI 라인만 제거하고 반환.
     */
    function _injectSriIntoCode(code, enabled, alpha, beta, gRed) {
        // 기존 SRI 속성 라인 제거 (있을 경우)
        ['sri', 'sriAlpha', 'sriBeta', 'gaussOrderReduced'].forEach(key => {
            code = code.replace(
                new RegExp(`\\n[ \\t]*${key}\\s*:[^\\n]*`, 'g'), ''
            );
        });
        if (!enabled) return code;

        // 삽입할 SRI 블록 생성
        const gRedLine = gRed
            ? `\n  gaussOrderReduced: ${gRed},    // 축소 가우스 점 수`
            : '';
        const block =
            `\n  sri: true,               // SRI 활성화 — 전단잠김 방지` +
            `\n  sriAlpha: ${alpha.toFixed(2)},        // α 정수압 부분 반영 비율 (full 적분)` +
            `\n  sriBeta: ${beta.toFixed(2)},         // β 전단 부분 반영 비율 (축소 적분)` +
            gRedLine;

        // gaussOrder 또는 constitModel 행 뒤에 삽입
        if (/\bgaussOrder\s*:/.test(code)) {
            return code.replace(
                /([ \t]*\bgaussOrder\s*:\s*\d+[^\n]*)/,
                `$1${block}`
            );
        }
        if (/\bconstitModel\s*:/.test(code)) {
            return code.replace(
                /([ \t]*\bconstitModel\s*:\s*'[^']*'[^\n]*)/,
                `$1${block}`
            );
        }
        // 마지막 수단: FepsElementRegistry.register({ 바로 뒤에 삽입
        return code.replace(
            /(FepsElementRegistry\.register\s*\(\s*\{)/,
            `$1${block}`
        );
    }

    /** SRI 패널 UI를 코드에서 읽은 값으로 갱신 */
    function _syncSriPanelFromCode() {
        if (!codeArea || !chkSRIEnable) return;
        const { sri, alpha, beta, gRed } = _parseSriFromCode(codeArea.value);
        chkSRIEnable.checked = sri;
        divSRICtrls.style.display = sri ? 'flex' : 'none';
        if (inpAlpha)  inpAlpha.value = alpha.toFixed(2);
        if (inpBeta)   inpBeta.value  = beta.toFixed(2);
        if (selGRed)   selGRed.value  = gRed;
        _updateSriHint();
    }

    /** hint 텍스트 갱신: 유효 축소 가우스 수 표시 */
    function _updateSriHint() {
        if (!spanSRIHint || !chkSRIEnable || !chkSRIEnable.checked) return;
        const gFull = (function() {
            const m = codeArea.value.match(/\bgaussOrder\s*:\s*(\d+)/);
            return m ? parseInt(m[1]) : 2;
        })();
        const gRedVal = selGRed ? selGRed.value : '';
        const effectiveRed = gRedVal ? parseInt(gRedVal) : Math.max(1, gFull - 1);
        spanSRIHint.textContent =
            `(full ${gFull}점 → 축소 ${effectiveRed}점)`;
    }

    // SRI 활성화 체크박스
    if (chkSRIEnable) {
        chkSRIEnable.addEventListener('change', () => {
            divSRICtrls.style.display = chkSRIEnable.checked ? 'flex' : 'none';
            _updateSriHint();
        });
    }

    // α, β, gRed 변경 시 hint 갱신
    [inpAlpha, inpBeta, selGRed].forEach(el => {
        if (el) el.addEventListener('input', _updateSriHint);
    });

    // "코드에 적용" 버튼
    if (btnSRIApply) {
        btnSRIApply.addEventListener('click', () => {
            if (!codeArea) return;
            const enabled = chkSRIEnable ? chkSRIEnable.checked : false;
            const alpha   = inpAlpha ? parseFloat(inpAlpha.value) || 1.0 : 1.0;
            const beta    = inpBeta  ? parseFloat(inpBeta.value)  || 1.0 : 1.0;
            const gRed    = selGRed  ? selGRed.value : '';
            codeArea.value = _injectSriIntoCode(codeArea.value, enabled, alpha, beta, gRed);
            _log(enabled
                ? `✅ SRI 설정 적용 — α=${alpha.toFixed(2)}, β=${beta.toFixed(2)}, 축소=${gRed||'자동'}`
                : `ℹ️ SRI 비활성화 — SRI 관련 속성 제거됨`, 'info');
        });
    }

    // 코드가 바뀔 때 SRI 패널 동기화
    if (codeArea) {
        codeArea.addEventListener('input', _syncSriPanelFromCode);
    }

    // ── 탭(Tab) 키를 들여쓰기로 사용 ────────────────────────────────────

    if (codeArea) {
        codeArea.addEventListener('keydown', (e) => {
            if (e.key === 'Tab') {
                e.preventDefault();
                const s = codeArea.selectionStart, end = codeArea.selectionEnd;
                const val = codeArea.value;
                codeArea.value = val.substring(0, s) + '  ' + val.substring(end);
                codeArea.selectionStart = codeArea.selectionEnd = s + 2;
            }
        });
    }

    // ── 템플릿 불러오기 ──────────────────────────────────────────────────

    if (btnLoadTpl) btnLoadTpl.addEventListener('click', () => {
        const key = selTpl.value;
        if (!key) { _log('템플릿을 선택하세요.', 'warn'); return; }
        const tpl = TEMPLATES[key];
        if (!tpl) { _log('해당 템플릿을 찾을 수 없습니다.', 'error'); return; }
        if (codeArea.value.trim() && !confirm('현재 코드를 지우고 템플릿을 불러올까요?')) return;
        codeArea.value = tpl;
        _syncSriPanelFromCode();
        _log(`템플릿 "${selTpl.options[selTpl.selectedIndex].text}" 불러옴.`, 'info');
    });

    // ── 코드 초기화 ──────────────────────────────────────────────────────

    if (btnClearCode) btnClearCode.addEventListener('click', () => {
        if (!codeArea.value.trim() || confirm('코드를 초기화할까요?')) {
            codeArea.value = '';
        }
    });

    // ── 등록 (Register) ──────────────────────────────────────────────────

    if (btnReg) btnReg.addEventListener('click', _doRegister);

    function _doRegister() {
        const code = codeArea.value.trim();
        if (!code) { _log('코드가 비어 있습니다.', 'warn'); return; }

        _log('─────────────────────────', 'info');
        _log('코드 실행 중...', 'info');

        // 기존 콘솔 로그를 가로채서 에디터 로그에 표시
        const _origLog = console.log;
        const _origWarn = console.warn;
        const _origError = console.error;
        console.log   = (...args) => { _log(args.join(' '), 'info');  _origLog(...args); };
        console.warn  = (...args) => { _log(args.join(' '), 'warn');  _origWarn(...args); };
        console.error = (...args) => { _log(args.join(' '), 'error'); _origError(...args); };

        try {
            // eval 컨텍스트에서 FepsElementRegistry, FepsElementCore 접근 가능
            // eslint-disable-next-line no-eval
            eval(code);
            _log('✅ 등록 완료!', 'success');

            // ── localStorage 자동 저장 ──────────────────────────────────
            const name = _extractElementName(code);
            if (name) {
                _saveToStorage(name, code);
                _log(`💾 "${name}" 저장됨 → 페이지 새로고침 후에도 자동 복원.`, 'info');
            } else {
                _log('⚠️ name: 속성을 찾지 못해 localStorage 저장 생략.', 'warn');
            }

            _refreshElemList();
        } catch (err) {
            _log(`❌ 오류: ${err.message}`, 'error');
        } finally {
            console.log   = _origLog;
            console.warn  = _origWarn;
            console.error = _origError;
        }
    }

    // ── 전체 등록 초기화 ─────────────────────────────────────────────────

    // ── 저장 초기화 (localStorage 삭제 + 새로고침) ──────────────────────

    if (btnClearAll) btnClearAll.addEventListener('click', () => {
        const saved = _getSavedElemNames();
        const types = FepsElementRegistry.types();
        if (saved.size === 0 && types.length === 0) {
            _log('저장된 요소가 없습니다.', 'info'); return;
        }
        const savedList = [...saved].join(', ') || '없음';
        if (!confirm(
            `localStorage에 저장된 요소를 모두 삭제합니다.\n` +
            `저장된 요소: ${savedList}\n\n` +
            `삭제 후 페이지가 새로고침됩니다. 계속하시겠습니까?`
        )) return;
        saved.forEach(name => _deleteFromStorage(name));
        _log('💾 저장된 요소를 모두 삭제했습니다. 새로고침 중...', 'warn');
        setTimeout(() => location.reload(), 1000);
    });

    // ── 내보내기: 현재 코드 → .js 파일 다운로드 ─────────────────────────

    if (btnExport) btnExport.addEventListener('click', () => {
        const code = codeArea ? codeArea.value.trim() : '';
        if (!code) { _log('내보낼 코드가 없습니다.', 'warn'); return; }
        const name = _extractElementName(code) || 'MyElement';
        const blob = new Blob([code], { type: 'text/javascript;charset=utf-8' });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href = url;
        a.download = `${name}.js`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        _log(`💾 "${name}.js" 파일로 저장했습니다.`, 'success');
    });

    // ── 파일 열기: .js 파일 → 에디터 로드 ──────────────────────────────

    if (btnImport) btnImport.addEventListener('click', () => {
        if (fileInput) fileInput.click();
    });

    if (fileInput) fileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        if (codeArea && codeArea.value.trim() &&
            !confirm('현재 코드를 지우고 파일을 불러올까요?')) {
            fileInput.value = '';
            return;
        }
        const reader = new FileReader();
        reader.onload = (ev) => {
            if (codeArea) codeArea.value = ev.target.result;
            _syncSriPanelFromCode();
            _log(`📂 "${file.name}" 불러옴. [▶ 등록]으로 실행하세요.`, 'info');
            fileInput.value = ''; // 같은 파일 재선택 허용
        };
        reader.onerror = () => _log('파일 읽기 실패.', 'error');
        reader.readAsText(file, 'UTF-8');
    });

    // ── localStorage 헬퍼 ────────────────────────────────────────────────

    /** code에서 name: 'XXX' 를 추출 */
    function _extractElementName(code) {
        const m = code.match(/\bname\s*:\s*['"]([A-Za-z0-9_]+)['"]/);
        return m ? m[1].toUpperCase() : null;
    }

    /** localStorage에 저장된 요소 이름 Set 반환 */
    function _getSavedElemNames() {
        const names = new Set();
        try {
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key && key.startsWith(STORAGE_PREFIX))
                    names.add(key.slice(STORAGE_PREFIX.length));
            }
        } catch (_) { /* 프라이빗 브라우징 등 접근 불가 시 무시 */ }
        return names;
    }

    /** 요소 코드를 localStorage에 저장 */
    function _saveToStorage(name, code) {
        try {
            localStorage.setItem(STORAGE_PREFIX + name, code);
            return true;
        } catch (e) {
            _log(`⚠️ localStorage 저장 실패: ${e.message}`, 'warn');
            return false;
        }
    }

    /** localStorage에서 요소 삭제 */
    function _deleteFromStorage(name) {
        try { localStorage.removeItem(STORAGE_PREFIX + name); } catch (_) {}
    }

    /**
     * 페이지 로드 시 localStorage에 저장된 요소를 자동으로 eval() 하여 복원.
     * 스크립트 태그로 미리 등록된 빌트인 요소가 있어도 덮어쓰기 가능.
     */
    function _loadAllFromStorage() {
        const saved = _getSavedElemNames();
        if (saved.size === 0) return;
        let ok = 0, fail = 0;
        saved.forEach(name => {
            const code = localStorage.getItem(STORAGE_PREFIX + name);
            if (!code) return;
            try {
                // eslint-disable-next-line no-eval
                eval(code);
                ok++;
            } catch (e) {
                console.warn(`[FEPS] 저장된 요소 "${name}" 로드 실패:`, e);
                fail++;
            }
        });
        if (ok > 0)
            console.log(`[FEPS] localStorage에서 요소 ${ok}개 자동 복원됨`);
        if (fail > 0)
            console.warn(`[FEPS] localStorage에서 요소 ${fail}개 로드 실패 (코드 오류)`);
    }

    // ── 등록 요소 목록 갱신 ─────────────────────────────────────────────

    // 템플릿 드롭다운과 동일한 우선 순서
    const _ELEM_ORDER = [
        'QUAD4', 'QUAD4SRI',
        'QUAD5', 'QUAD8', 'QUAD9',
        'TRIG3', 'TRIG6',
        'BAR2_3N',
        'TIMBEAM2D_2N', 'TIMBEAM2D_3N'
    ];

    function _refreshElemList() {
        if (!listDiv) return;
        const types = FepsElementRegistry.types();
        // 템플릿 순서에 맞춰 정렬, 모르는 요소는 뒤에 추가
        types.sort((a, b) => {
            const ia = _ELEM_ORDER.indexOf(a);
            const ib = _ELEM_ORDER.indexOf(b);
            if (ia === -1 && ib === -1) return 0;
            if (ia === -1) return 1;
            if (ib === -1) return -1;
            return ia - ib;
        });
        const saved = _getSavedElemNames();

        if (types.length === 0) {
            listDiv.innerHTML = '<span style="color:var(--text-dim,#8b909c)">(없음)</span>';
            return;
        }

        listDiv.innerHTML = '';
        types.forEach(t => {
            const d   = FepsElementRegistry.get(t);
            const cat = d ? (d.category || '?') : '?';
            const nn  = d ? d.nNodes : '?';
            const catColors = {
                solid2d: '#2563eb', bar1d: '#d97706',
                beam2d_tim: '#7c3aed', custom: '#059669'
            };
            const dotColor  = catColors[cat] || '#888';
            const isSaved   = saved.has(t);

            const row = document.createElement('div');
            row.style.cssText = 'display:flex;align-items:center;gap:4px;margin-bottom:4px';

            // 색상 점
            const dot = document.createElement('span');
            dot.style.cssText =
                `width:8px;height:8px;border-radius:2px;background:${dotColor};flex-shrink:0`;
            row.appendChild(dot);

            // 요소 이름
            const nameEl = document.createElement('span');
            nameEl.style.cssText = 'font-weight:600;flex:1;font-size:11px';
            nameEl.textContent = t;
            row.appendChild(nameEl);

            // 절점 수
            const nnEl = document.createElement('span');
            nnEl.style.cssText = 'color:#999;font-size:10px';
            nnEl.textContent = `${nn}절점`;
            row.appendChild(nnEl);

            if (isSaved) {
                // 저장 아이콘
                const icon = document.createElement('span');
                icon.title = 'localStorage에 저장됨';
                icon.textContent = '💾';
                icon.style.cssText = 'font-size:11px;cursor:default';
                row.appendChild(icon);

                // 삭제 버튼
                const del = document.createElement('button');
                del.textContent = '🗑️';
                del.title = `"${t}"를 localStorage에서 삭제`;
                del.style.cssText =
                    'background:none;border:none;cursor:pointer;font-size:10px;' +
                    'padding:0 2px;line-height:1;color:#f87171';
                del.addEventListener('click', () => {
                    if (!confirm(`"${t}" 저장 데이터를 삭제할까요?\n(레지스트리 등록은 유지됩니다. 새로고침 시 재등록 안 됨)`)) return;
                    _deleteFromStorage(t);
                    _refreshElemList();
                    _log(`🗑️ "${t}" localStorage에서 삭제됨.`, 'warn');
                });
                row.appendChild(del);
            }

            listDiv.appendChild(row);
        });
    }

    // ── 로그 출력 ────────────────────────────────────────────────────────

    function _log(msg, level = 'info') {
        if (!logDiv) return;
        const colors = { info: '#90ee90', warn: '#ffd700', error: '#ff6b6b', success: '#00ff7f' };
        const color = colors[level] || '#90ee90';
        const now = new Date().toLocaleTimeString('ko-KR', { hour12: false });
        const line = document.createElement('div');
        line.style.color = color;
        line.textContent = `[${now}] ${msg}`;
        logDiv.appendChild(line);
        logDiv.scrollTop = logDiv.scrollHeight;
    }

    // ── 초기화: localStorage 자동 복원 + 목록 갱신 ──────────────────────

    window.addEventListener('load', () => {
        _loadAllFromStorage();   // ← 저장된 요소 자동 재등록
        _refreshElemList();
    });

    // ── Ctrl+Enter 단축키로 등록 ─────────────────────────────────────────

    if (codeArea) {
        codeArea.addEventListener('keydown', (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                e.preventDefault();
                _doRegister();
            }
        });
    }

})();
