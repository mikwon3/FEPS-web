/* ========================================================================
   quad5.js  –  5절점 사각형 요소 (QUAD5)
   ──────────────────────────────────────────────────────────────────────
   학생 작성 요소 예제. FepsElementCore 의 유틸리티를 활용합니다.

   ▶ 절점 배치 (자연좌표 ξ,η ∈ [-1,1])
        4 ─────── 3
        │    5    │       5: 중심절점 (0, 0)
        │         │
        1 ─────── 2
     1:(−1,−1)  2:(+1,−1)  3:(+1,+1)  4:(−1,+1)

   ▶ 형상함수
     N_i (코너) = (1/4)(1+ξ_i·ξ)(1+η_i·η) − (1/4)(1−ξ²)(1−η²)
     N_5 (중심) = (1−ξ²)(1−η²)

   ▶ 구성방정식 선택
     constitModel: 'planeStress'  → 평면응력
                   'planeStrain'  → 평면변형률

   ▶ 가우스 적분: 3×3 (버블 함수의 고차 항 대응)
   ======================================================================== */

FepsElementRegistry.register({

    name:        'QUAD5',
    category:    'solid2d',
    nNodes:      5,
    dofPerNode:  2,
    cornerNodes: 4,          // 렌더링에 사용할 코너 절점 수
    // 주의: condense:[4] 를 사용하면 정적 축소 후 강성행렬에 음의 대각 성분이
    //       발생할 수 있음 (버블 함수 N_i = bilinear − bubble/4 의 특성).
    //       다중 요소 조립 시 비양정치 전역 K 를 유발하므로 축소를 적용하지 않음.

    // ── 구성방정식 선택 ──────────────────────────────────────────────
    //   'planeStress' : 평면응력 (얇은 평판)
    //   'planeStrain' : 평면변형률 (긴 구조물의 단면)
    constitModel: 'planeStress',

    gaussOrder: 3,   // 3×3 가우스 적분

    // ── 형상함수 N(ξ, η) ─────────────────────────────────────────────
    shapeN(xi, eta) {
        const N = new Float64Array(5);
        // 버블 함수
        const bub = (1 - xi * xi) * (1 - eta * eta);
        // 코너 절점 (이중선형 − 버블/4)
        N[0] = 0.25 * (1 - xi) * (1 - eta) - 0.25 * bub;
        N[1] = 0.25 * (1 + xi) * (1 - eta) - 0.25 * bub;
        N[2] = 0.25 * (1 + xi) * (1 + eta) - 0.25 * bub;
        N[3] = 0.25 * (1 - xi) * (1 + eta) - 0.25 * bub;
        // 중심 절점 (버블 함수)
        N[4] = bub;
        return N;
    },

    // ── 형상함수 도함수 ∂N/∂ξ, ∂N/∂η ────────────────────────────────
    shapeDN(xi, eta) {
        const dxi  = new Float64Array(5);
        const deta = new Float64Array(5);

        // 버블 함수 도함수
        const dbub_dxi  =  2 * xi  * (eta * eta - 1);   // d/dξ [(1-ξ²)(1-η²)]
        const dbub_deta =  2 * eta * (xi  * xi  - 1);   // d/dη [(1-ξ²)(1-η²)]

        // 코너 절점 도함수
        dxi[0]  = -0.25 * (1 - eta) - 0.25 * dbub_dxi;
        dxi[1]  =  0.25 * (1 - eta) - 0.25 * dbub_dxi;
        dxi[2]  =  0.25 * (1 + eta) - 0.25 * dbub_dxi;
        dxi[3]  = -0.25 * (1 + eta) - 0.25 * dbub_dxi;

        deta[0] = -0.25 * (1 - xi) - 0.25 * dbub_deta;
        deta[1] = -0.25 * (1 + xi) - 0.25 * dbub_deta;
        deta[2] =  0.25 * (1 + xi) - 0.25 * dbub_deta;
        deta[3] =  0.25 * (1 - xi) - 0.25 * dbub_deta;

        // 중심 절점 도함수
        dxi[4]  = -dbub_dxi;
        deta[4] = -dbub_deta;

        return { dxi, deta };
    }
});
