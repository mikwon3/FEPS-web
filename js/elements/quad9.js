/* ========================================================================
   quad9.js  –  9절점 라그랑지 사각형 요소 (QUAD9)
   ──────────────────────────────────────────────────────────────────────
   학생 작성 요소 예제.

   ▶ 절점 배치 (자연좌표 ξ,η ∈ [-1,1])
        4 ──7── 3
        │       │
        8   9   6        9: 중심절점 (0, 0)
        │       │
        1 ──5── 2
     코너: 1=(−1,−1), 2=(+1,−1), 3=(+1,+1), 4=(−1,+1)
     중간: 5=(0,−1), 6=(+1,0), 7=(0,+1), 8=(−1,0)
     중심: 9=(0, 0)

   ▶ 형상함수 (1D 라그랑지의 텐서곱)
     1D 라그랑지 (ξ 방향):
       L₁(ξ) = ξ(ξ−1)/2    (ξ=−1)
       L₂(ξ) = ξ(ξ+1)/2    (ξ=+1)
       L₃(ξ) = (1−ξ²)       (ξ= 0)
     N_ij = L_a(ξ) · L_b(η)  (절점 위치에 따라 a,b 결정)

   ▶ 가우스 적분: 3×3
   ======================================================================== */

FepsElementRegistry.register({

    name:        'QUAD9',
    category:    'solid2d',
    nNodes:      9,
    dofPerNode:  2,
    cornerNodes: 4,
    condense:    [8],              // 중심절점(9번) 정적 축소 → 8절점 요소로 동작

    constitModel: 'planeStress',   // 'planeStress' | 'planeStrain'
    gaussOrder:   3,

    // ── 형상함수 N(ξ, η) ─────────────────────────────────────────────
    // 텐서곱 라그랑지 기저함수
    // 절점 순서: 1(−1,−1), 2(+1,−1), 3(+1,+1), 4(−1,+1),
    //           5(0,−1), 6(+1,0), 7(0,+1), 8(−1,0), 9(0,0)
    shapeN(xi, eta) {
        // 1D 라그랑지 기저함수
        const L1x = xi * (xi - 1) / 2;   // ξ=−1
        const L2x = xi * (xi + 1) / 2;   // ξ=+1
        const L3x = (1 - xi * xi);        // ξ= 0

        const L1e = eta * (eta - 1) / 2;  // η=−1
        const L2e = eta * (eta + 1) / 2;  // η=+1
        const L3e = (1 - eta * eta);       // η= 0

        const N = new Float64Array(9);
        N[0] = L1x * L1e;   // (−1,−1)
        N[1] = L2x * L1e;   // (+1,−1)
        N[2] = L2x * L2e;   // (+1,+1)
        N[3] = L1x * L2e;   // (−1,+1)
        N[4] = L3x * L1e;   // ( 0,−1)
        N[5] = L2x * L3e;   // (+1, 0)
        N[6] = L3x * L2e;   // ( 0,+1)
        N[7] = L1x * L3e;   // (−1, 0)
        N[8] = L3x * L3e;   // ( 0, 0)
        return N;
    },

    // ── 형상함수 도함수 ∂N/∂ξ, ∂N/∂η ────────────────────────────────
    shapeDN(xi, eta) {
        // 1D 라그랑지 기저함수 및 도함수
        const L1x = xi * (xi - 1) / 2,  dL1x = xi - 0.5;
        const L2x = xi * (xi + 1) / 2,  dL2x = xi + 0.5;
        const L3x = (1 - xi * xi),       dL3x = -2 * xi;

        const L1e = eta * (eta - 1) / 2, dL1e = eta - 0.5;
        const L2e = eta * (eta + 1) / 2, dL2e = eta + 0.5;
        const L3e = (1 - eta * eta),      dL3e = -2 * eta;

        const dxi  = new Float64Array(9);
        const deta = new Float64Array(9);

        dxi[0] = dL1x * L1e;  deta[0] = L1x * dL1e;
        dxi[1] = dL2x * L1e;  deta[1] = L2x * dL1e;
        dxi[2] = dL2x * L2e;  deta[2] = L2x * dL2e;
        dxi[3] = dL1x * L2e;  deta[3] = L1x * dL2e;
        dxi[4] = dL3x * L1e;  deta[4] = L3x * dL1e;
        dxi[5] = dL2x * L3e;  deta[5] = L2x * dL3e;
        dxi[6] = dL3x * L2e;  deta[6] = L3x * dL2e;
        dxi[7] = dL1x * L3e;  deta[7] = L1x * dL3e;
        dxi[8] = dL3x * L3e;  deta[8] = L3x * dL3e;

        return { dxi, deta };
    }
});
