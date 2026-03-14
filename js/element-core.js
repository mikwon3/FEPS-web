/* ========================================================================
   element-core.js  –  FEPS 요소 핵심 수학 유틸리티

   학생이 작성하는 커스텀 요소 파일에서 호출하는 공유 함수 모음.
   전역 싱글톤: FepsElementCore

   제공 기능:
     ─ 가우스-르장드르 구적 (1D, 삼각형)
     ─ 구성방정식: planeStressD, planeStrainD
     ─ 2D 아이소파라메트릭 강성 적분 (사각형 / 삼각형)
     ─ 2D 체적력 적분
     ─ 2D 응력 계산 (임의 점)
     ─ 1D 봉 요소 강성
     ─ 티모셴코 보 강성 (2절점, 3절점)
   ======================================================================== */

const FepsElementCore = (() => {

    // ── 선형대수 헬퍼 (독립형) ──────────────────────────────────────────

    function zeros(r, c) {
        const m = [];
        for (let i = 0; i < r; i++) m[i] = new Float64Array(c);
        return m;
    }
    function vec(n) { return new Float64Array(n); }

    function matMul(A, B) {
        const r = A.length, k = B.length, c = B[0].length;
        const C = zeros(r, c);
        for (let i = 0; i < r; i++)
            for (let j = 0; j < c; j++) {
                let s = 0;
                for (let p = 0; p < k; p++) s += A[i][p] * B[p][j];
                C[i][j] = s;
            }
        return C;
    }

    function transpose(A) {
        const r = A.length, c = A[0].length;
        const T = zeros(c, r);
        for (let i = 0; i < r; i++)
            for (let j = 0; j < c; j++) T[j][i] = A[i][j];
        return T;
    }

    function matVecMul(A, v) {
        const r = A.length, c = A[0].length;
        const res = vec(r);
        for (let i = 0; i < r; i++) {
            let s = 0;
            for (let j = 0; j < c; j++) s += A[i][j] * v[j];
            res[i] = s;
        }
        return res;
    }

    // ── 소규모 밀집 연립방정식 풀이 ──────────────────────────────────────

    /**
     * 소규모 밀집 연립방정식 A·x = b 풀이 (가우스 소거법 + 부분 피벗팅).
     * A, b 를 복사하므로 원본을 변경하지 않는다.
     * @param {Array}        A  — n×n 행렬 (2D jagged Float64Array)
     * @param {Float64Array} b  — n-벡터
     * @returns {Float64Array}  x — 해 벡터
     */
    function solveSmall(A, b) {
        const n = b.length;
        const Ac = zeros(n, n);
        for (let i = 0; i < n; i++)
            for (let j = 0; j < n; j++) Ac[i][j] = A[i][j];
        const bc = vec(n);
        for (let i = 0; i < n; i++) bc[i] = b[i];

        // 전진 소거 (부분 피벗팅)
        for (let k = 0; k < n; k++) {
            let maxVal = Math.abs(Ac[k][k]), maxRow = k;
            for (let i = k + 1; i < n; i++) {
                if (Math.abs(Ac[i][k]) > maxVal) { maxVal = Math.abs(Ac[i][k]); maxRow = i; }
            }
            if (maxRow !== k) {
                [Ac[k], Ac[maxRow]] = [Ac[maxRow], Ac[k]];
                [bc[k], bc[maxRow]] = [bc[maxRow], bc[k]];
            }
            if (Math.abs(Ac[k][k]) < 1e-30) continue;
            for (let i = k + 1; i < n; i++) {
                const f = Ac[i][k] / Ac[k][k];
                for (let j = k; j < n; j++) Ac[i][j] -= f * Ac[k][j];
                bc[i] -= f * bc[k];
            }
        }
        // 후진 대입
        const x = vec(n);
        for (let i = n - 1; i >= 0; i--) {
            let s = bc[i];
            for (let j = i + 1; j < n; j++) s -= Ac[i][j] * x[j];
            x[i] = Math.abs(Ac[i][i]) > 1e-30 ? s / Ac[i][i] : 0;
        }
        return x;
    }

    /**
     * 다중 우변 풀이  A·X = B.
     * @param {Array} A — n×n 행렬
     * @param {Array} B — n×m 행렬
     * @returns {Array} X — n×m 해 행렬
     */
    function solveSmallMulti(A, B) {
        const n = A.length, m = B[0].length;
        const X = zeros(n, m);
        for (let j = 0; j < m; j++) {
            const bj = vec(n);
            for (let i = 0; i < n; i++) bj[i] = B[i][j];
            const xj = solveSmall(A, bj);
            for (let i = 0; i < n; i++) X[i][j] = xj[i];
        }
        return X;
    }

    // ── 부분행렬 / 부분벡터 추출 ──────────────────────────────────────────

    /**
     * 부분행렬 추출: A[rows][cols].
     * @param {Array}    A    — 원본 행렬
     * @param {number[]} rows — 행 인덱스
     * @param {number[]} cols — 열 인덱스
     * @returns {Array}  부분행렬
     */
    function subMatrix(A, rows, cols) {
        const r = rows.length, c = cols.length;
        const S = zeros(r, c);
        for (let i = 0; i < r; i++)
            for (let j = 0; j < c; j++) S[i][j] = A[rows[i]][cols[j]];
        return S;
    }

    /**
     * 부분벡터 추출: v[indices].
     * @param {Float64Array|number[]} v       — 원본 벡터
     * @param {number[]}              indices — 인덱스 배열
     * @returns {Float64Array} 부분벡터
     */
    function subVector(v, indices) {
        const s = vec(indices.length);
        for (let i = 0; i < indices.length; i++) s[i] = v[indices[i]];
        return s;
    }

    // ── 정적 축소 (Static Condensation) ───────────────────────────────────

    /**
     * 정적 축소: 내부 자유도를 요소 레벨에서 제거.
     *
     *   K* = K_ee − K_ei · K_ii⁻¹ · K_ie
     *   f* = f_e  − K_ei · K_ii⁻¹ · f_i
     *
     * @param {Array}        K            — nFull × nFull 강성행렬 (2D jagged)
     * @param {Float64Array} f            — nFull 하중벡터
     * @param {number[]}     internalDofs — 내부 DOF 인덱스 배열
     * @returns {{ esm, force, dofesm, recovery }}
     *   recovery: { Kii_inv_Kie, Kii_inv_fi, extDofs, intDofs }
     */
    function staticCondense(K, f, internalDofs) {
        const nFull = K.length;
        const intSet = new Set(internalDofs);

        // 외부 DOF 인덱스 (순서 보존)
        const extDofs = [];
        for (let i = 0; i < nFull; i++) {
            if (!intSet.has(i)) extDofs.push(i);
        }
        const nExt = extDofs.length;

        // 부분행렬 추출
        const Kee = subMatrix(K, extDofs, extDofs);
        const Kei = subMatrix(K, extDofs, internalDofs);
        const Kie = subMatrix(K, internalDofs, extDofs);
        const Kii = subMatrix(K, internalDofs, internalDofs);
        const fe  = subVector(f, extDofs);
        const fi  = subVector(f, internalDofs);

        // K_ii⁻¹ · K_ie  (nInt × nExt)
        const Kii_inv_Kie = solveSmallMulti(Kii, Kie);
        // K_ii⁻¹ · f_i   (nInt)
        const Kii_inv_fi = solveSmall(Kii, fi);

        // K* = Kee − Kei · (Kii⁻¹ · Kie)
        const Kei_x = matMul(Kei, Kii_inv_Kie);
        const Kstar = zeros(nExt, nExt);
        for (let i = 0; i < nExt; i++)
            for (let j = 0; j < nExt; j++)
                Kstar[i][j] = Kee[i][j] - Kei_x[i][j];

        // f* = fe − Kei · (Kii⁻¹ · fi)
        const Kei_fi = matVecMul(Kei, Kii_inv_fi);
        const fstar = vec(nExt);
        for (let i = 0; i < nExt; i++) fstar[i] = fe[i] - Kei_fi[i];

        return {
            esm:    Kstar,
            force:  fstar,
            dofesm: nExt,
            recovery: { Kii_inv_Kie, Kii_inv_fi, extDofs, intDofs: internalDofs }
        };
    }

    /**
     * 내부 변위 복원:
     *   u_i = K_ii⁻¹ · f_i − K_ii⁻¹ · K_ie · u_e
     *
     * @param {{ Kii_inv_Kie, Kii_inv_fi, extDofs, intDofs }} recovery
     * @param {Float64Array|number[]} ue — 외부 변위 (축소 순서)
     * @returns {Float64Array} 전체 변위 벡터 (원래 DOF 순서)
     */
    function recoverInternalDofs(recovery, ue) {
        const { Kii_inv_Kie, Kii_inv_fi, extDofs, intDofs } = recovery;
        const nExt = extDofs.length, nInt = intDofs.length;
        const nFull = nExt + nInt;

        // u_i = Kii_inv_fi − Kii_inv_Kie · ue
        const KKue = matVecMul(Kii_inv_Kie, new Float64Array(ue));
        const ui = vec(nInt);
        for (let i = 0; i < nInt; i++) ui[i] = Kii_inv_fi[i] - KKue[i];

        // 전체 벡터 재조립
        const uFull = vec(nFull);
        for (let i = 0; i < nExt; i++) uFull[extDofs[i]] = ue[i];
        for (let i = 0; i < nInt; i++) uFull[intDofs[i]] = ui[i];
        return uFull;
    }

    // ── 가우스-르장드르 구적 규칙 ([-1, 1] 표준 구간) ─────────────────

    const _GL = {
        1: { pts: [0],                                                          wts: [2] },
        2: { pts: [-0.5773502691896258,  0.5773502691896258],                   wts: [1, 1] },
        3: { pts: [-0.7745966692414834,  0,  0.7745966692414834],
             wts:  [ 0.5555555555555556, 0.8888888888888888, 0.5555555555555556] },
        4: { pts: [-0.8611363115940526, -0.3399810435848563, 0.3399810435848563, 0.8611363115940526],
             wts:  [ 0.3478548451374538,  0.6521451548625461, 0.6521451548625461, 0.3478548451374538] }
    };

    /**
     * 1D 가우스 구적 (n = 1..4)
     * @param {number} n — 가우스 점 수
     * @returns {{ pts: number[], wts: number[] }}
     */
    function gaussQuad1D(n) { return _GL[n] || _GL[2]; }

    // ── 삼각형 가우스 구적 (기준 삼각형: (0,0)-(1,0)-(0,1)) ─────────────
    // 가중치 합 = 0.5 (기준 삼각형 면적)
    const _GT = {
        1: { pts: [[1/3, 1/3]], wts: [0.5] },
        3: { pts: [[1/6, 1/6], [2/3, 1/6], [1/6, 2/3]], wts: [1/6, 1/6, 1/6] },
        6: { // 6-point rule, exact for degree 4
            pts: [
                [0.0915762135098, 0.0915762135098],
                [0.8168475729805, 0.0915762135098],
                [0.0915762135098, 0.8168475729805],
                [0.4459484909160, 0.1081030181681],
                [0.4459484909160, 0.4459484909160],
                [0.1081030181681, 0.4459484909160]
            ],
            wts: [
                0.5 * 0.1099517436553,
                0.5 * 0.1099517436553,
                0.5 * 0.1099517436553,
                0.5 * 0.2233815896780,
                0.5 * 0.2233815896780,
                0.5 * 0.2233815896780
            ]
        }
    };

    /**
     * 삼각형 가우스 구적 (n = 1, 3, 6)
     * @param {number} n — 가우스 점 수
     * @returns {{ pts: number[][], wts: number[] }}
     */
    function gaussQuadTri(n) { return _GT[n] || _GT[3]; }

    // ── 구성방정식 행렬 ───────────────────────────────────────────────────

    /**
     * 평면응력 구성행렬 D (3×3)
     * { σx, σy, τxy }^T = D · { εx, εy, γxy }^T
     *
     * @param {number} E   — 탄성계수
     * @param {number} nu  — 포아송비
     * @returns {Array} 3×3 평면응력 D 행렬
     */
    function planeStressD(E, nu) {
        const f = E / (1 - nu * nu);
        return [
            [f,        f * nu,   0],
            [f * nu,   f,        0],
            [0,        0,        f * (1 - nu) / 2]
        ];
    }

    /**
     * 평면변형률 구성행렬 D (3×3)
     *
     * @param {number} E   — 탄성계수
     * @param {number} nu  — 포아송비
     * @returns {Array} 3×3 평면변형률 D 행렬
     */
    function planeStrainD(E, nu) {
        const f = E / ((1 + nu) * (1 - 2 * nu));
        return [
            [f * (1 - nu),  f * nu,        0],
            [f * nu,        f * (1 - nu),   0],
            [0,             0,              f * (1 - 2 * nu) / 2]
        ];
    }

    // ── 2D 아이소파라메트릭 강성 (사각형 — 텐서곱 가우스) ─────────────

    /**
     * 2D 아이소파라메트릭 고체 요소 강성행렬 계산 (사각형 자연좌표계).
     *
     * @param {Function} shapeN  (xi, eta) → Float64Array[nNodes]
     * @param {Function} shapeDN (xi, eta) → { dxi: Float64Array, deta: Float64Array }
     * @param {number}   nNodes  — 절점 수
     * @param {number}   nGauss  — 방향당 가우스 점 수 (1~4)
     * @param {Array}    D       — 3×3 구성행렬
     * @param {number[]} xn, yn  — 절점 좌표
     * @param {number}   t       — 두께
     * @returns {{ esm, force, dofesm }}
     */
    function isoStiffness2D(shapeN, shapeDN, nNodes, nGauss, D, xn, yn, t) {
        const dofesm = nNodes * 2;
        const esm = zeros(dofesm, dofesm);
        const { pts, wts } = gaussQuad1D(nGauss);

        for (let gi = 0; gi < nGauss; gi++) {
            for (let gj = 0; gj < nGauss; gj++) {
                const xi = pts[gi], eta = pts[gj];
                const { dxi, deta } = shapeDN(xi, eta);

                // 야코비안
                let J11 = 0, J12 = 0, J21 = 0, J22 = 0;
                for (let k = 0; k < nNodes; k++) {
                    J11 += dxi[k] * xn[k];  J12 += dxi[k] * yn[k];
                    J21 += deta[k] * xn[k]; J22 += deta[k] * yn[k];
                }
                const detJ = J11 * J22 - J12 * J21;
                const idet = 1 / detJ;

                // 물리 좌표계 도함수 ∂N/∂x, ∂N/∂y
                const sx = new Float64Array(nNodes);
                const sy = new Float64Array(nNodes);
                for (let k = 0; k < nNodes; k++) {
                    sx[k] = idet * ( J22 * dxi[k] - J12 * deta[k]);
                    sy[k] = idet * (-J21 * dxi[k] + J11 * deta[k]);
                }

                const wt = wts[gi] * wts[gj] * detJ * t;

                // B 행렬 (3 × dofesm)
                const B = zeros(3, dofesm);
                for (let k = 0; k < nNodes; k++) {
                    B[0][k * 2]     = sx[k];
                    B[1][k * 2 + 1] = sy[k];
                    B[2][k * 2]     = sy[k];
                    B[2][k * 2 + 1] = sx[k];
                }

                const DB   = matMul(D, B);
                const BtDB = matMul(transpose(B), DB);
                for (let i = 0; i < dofesm; i++)
                    for (let j = 0; j < dofesm; j++)
                        esm[i][j] += wt * BtDB[i][j];
            }
        }
        return { esm, force: vec(dofesm), dofesm };
    }

    /**
     * 2D 아이소파라메트릭 체적력 (사각형 자연좌표계).
     *
     * @returns {Float64Array} 등가절점하중 벡터 (길이 nNodes*2)
     */
    function isoBodyForce2D(shapeN, shapeDN, nNodes, nGauss, xn, yn, t, rho, gx, gy) {
        const dofesm = nNodes * 2;
        const fg = vec(dofesm);
        const { pts, wts } = gaussQuad1D(nGauss);

        for (let gi = 0; gi < nGauss; gi++) {
            for (let gj = 0; gj < nGauss; gj++) {
                const xi = pts[gi], eta = pts[gj];
                const N = shapeN(xi, eta);
                const { dxi, deta } = shapeDN(xi, eta);

                let J11 = 0, J12 = 0, J21 = 0, J22 = 0;
                for (let k = 0; k < nNodes; k++) {
                    J11 += dxi[k] * xn[k];  J12 += dxi[k] * yn[k];
                    J21 += deta[k] * xn[k]; J22 += deta[k] * yn[k];
                }
                const detJ = J11 * J22 - J12 * J21;
                const wt = wts[gi] * wts[gj] * detJ * t * rho;

                for (let k = 0; k < nNodes; k++) {
                    fg[k * 2]     += N[k] * gx * wt;
                    fg[k * 2 + 1] += N[k] * gy * wt;
                }
            }
        }
        return fg;
    }

    // ── 2D 아이소파라메트릭 강성 (삼각형 — 삼각형 가우스) ───────────

    /**
     * 삼각형 자연좌표계 (ξ,η ∈ [0,1], ξ+η≤1) 에서의 강성행렬 계산.
     *
     * @param {Function} shapeN  (xi, eta) → Float64Array[nNodes]
     * @param {Function} shapeDN (xi, eta) → { dxi: Float64Array, deta: Float64Array }
     * @param {number}   nNodes  — 절점 수
     * @param {number}   nGauss  — 삼각형 가우스 점 수 (1, 3, 6)
     */
    function isoStiffnessTri(shapeN, shapeDN, nNodes, nGauss, D, xn, yn, t) {
        const dofesm = nNodes * 2;
        const esm = zeros(dofesm, dofesm);
        const { pts, wts } = gaussQuadTri(nGauss);

        for (let g = 0; g < pts.length; g++) {
            const [xi, eta] = pts[g];
            const { dxi, deta } = shapeDN(xi, eta);

            let J11 = 0, J12 = 0, J21 = 0, J22 = 0;
            for (let k = 0; k < nNodes; k++) {
                J11 += dxi[k] * xn[k];  J12 += dxi[k] * yn[k];
                J21 += deta[k] * xn[k]; J22 += deta[k] * yn[k];
            }
            const detJ = J11 * J22 - J12 * J21;
            const idet = 1 / detJ;

            const sx = new Float64Array(nNodes);
            const sy = new Float64Array(nNodes);
            for (let k = 0; k < nNodes; k++) {
                sx[k] = idet * ( J22 * dxi[k] - J12 * deta[k]);
                sy[k] = idet * (-J21 * dxi[k] + J11 * deta[k]);
            }

            // wts[g] 는 기준 삼각형 면적 포함 (Σwts = 0.5)
            const wt = wts[g] * detJ * t;

            const B = zeros(3, dofesm);
            for (let k = 0; k < nNodes; k++) {
                B[0][k * 2]     = sx[k];
                B[1][k * 2 + 1] = sy[k];
                B[2][k * 2]     = sy[k];
                B[2][k * 2 + 1] = sx[k];
            }

            const DB   = matMul(D, B);
            const BtDB = matMul(transpose(B), DB);
            for (let i = 0; i < dofesm; i++)
                for (let j = 0; j < dofesm; j++)
                    esm[i][j] += wt * BtDB[i][j];
        }
        return { esm, force: vec(dofesm), dofesm };
    }

    /**
     * 삼각형 자연좌표계 체적력.
     */
    function isoBodyForceTri(shapeN, shapeDN, nNodes, nGauss, xn, yn, t, rho, gx, gy) {
        const dofesm = nNodes * 2;
        const fg = vec(dofesm);
        const { pts, wts } = gaussQuadTri(nGauss);

        for (let g = 0; g < pts.length; g++) {
            const [xi, eta] = pts[g];
            const N = shapeN(xi, eta);
            const { dxi, deta } = shapeDN(xi, eta);

            let J11 = 0, J12 = 0, J21 = 0, J22 = 0;
            for (let k = 0; k < nNodes; k++) {
                J11 += dxi[k] * xn[k];  J12 += dxi[k] * yn[k];
                J21 += deta[k] * xn[k]; J22 += deta[k] * yn[k];
            }
            const detJ = J11 * J22 - J12 * J21;
            const wt = wts[g] * detJ * t * rho;

            for (let k = 0; k < nNodes; k++) {
                fg[k * 2]     += N[k] * gx * wt;
                fg[k * 2 + 1] += N[k] * gy * wt;
            }
        }
        return fg;
    }

    // ── 임의 점에서의 2D 응력 ──────────────────────────────────────────

    /**
     * 아이소파라메트릭 2D 요소의 특정 자연좌표 (xi0, eta0) 에서 응력 계산.
     *
     * @param {Function} shapeDN (xi, eta) → { dxi, deta }
     * @param {number}   nNodes  — 절점 수
     * @param {number}   xi0, eta0 — 평가 자연좌표
     * @param {number[]} xn, yn  — 절점 좌표
     * @param {number[]} ue      — 요소 절점 변위 (flat: u1,v1,u2,v2,...)
     * @param {Array}    D       — 3×3 구성행렬
     * @returns {{ sxx, syy, txy, smax, smin, mises }}
     */
    function isoStress2D_atPt(shapeDN, nNodes, xi0, eta0, xn, yn, ue, D) {
        const { dxi, deta } = shapeDN(xi0, eta0);

        let J11 = 0, J12 = 0, J21 = 0, J22 = 0;
        for (let k = 0; k < nNodes; k++) {
            J11 += dxi[k] * xn[k];  J12 += dxi[k] * yn[k];
            J21 += deta[k] * xn[k]; J22 += deta[k] * yn[k];
        }
        const detJ = J11 * J22 - J12 * J21, idet = 1 / detJ;

        const sx = new Float64Array(nNodes);
        const sy = new Float64Array(nNodes);
        for (let k = 0; k < nNodes; k++) {
            sx[k] = idet * ( J22 * dxi[k] - J12 * deta[k]);
            sy[k] = idet * (-J21 * dxi[k] + J11 * deta[k]);
        }

        const strain = [0, 0, 0];
        for (let k = 0; k < nNodes; k++) {
            strain[0] += sx[k] * ue[k * 2];
            strain[1] += sy[k] * ue[k * 2 + 1];
            strain[2] += sy[k] * ue[k * 2] + sx[k] * ue[k * 2 + 1];
        }

        const sig = [0, 0, 0];
        for (let i = 0; i < 3; i++)
            for (let j = 0; j < 3; j++)
                sig[i] += D[i][j] * strain[j];

        const sxx = sig[0], syy = sig[1], txy = sig[2];
        const savg = (sxx + syy) / 2;
        const sdif = (sxx - syy) / 2;
        const rad  = Math.sqrt(sdif * sdif + txy * txy);
        const smax = savg + rad, smin = savg - rad;
        const mises = Math.sqrt(smax * smax - smax * smin + smin * smin);

        return { sxx, syy, txy, smax, smin, mises };
    }

    // ── 1D 봉 요소 강성 (전역 6×6) ────────────────────────────────────

    /**
     * n-절점 1D 봉 요소 강성행렬 (전역 좌표계, nNodes*2 × nNodes*2).
     *
     * 절점 순서: nodes[0] = 끝단1 (ξ=-1), nodes[1..n-2] = 내부, nodes[n-1] = 끝단2 (ξ=+1)
     *
     * @param {Function} shapeN1D  (xi) → Float64Array[nNodes]  — 1D 라그랑지 형상함수
     * @param {Function} shapeDN1D (xi) → Float64Array[nNodes]  — 도함수
     * @param {number}   nNodes    — 절점 수
     * @param {number}   nGauss    — 가우스 점 수
     * @param {number}   EA        — E * A
     * @param {number[]} xn, yn    — 절점 x, y 좌표
     * @returns {{ esm, force, dofesm }}
     */
    function bar1D_Stif(shapeN1D, shapeDN1D, nNodes, nGauss, EA, xn, yn) {
        const dofesm = 2 * nNodes;
        const esm = zeros(dofesm, dofesm);
        const { pts, wts } = gaussQuad1D(nGauss);

        for (let g = 0; g < nGauss; g++) {
            const xi = pts[g], w = wts[g];
            const dNxi = shapeDN1D(xi);

            // 야코비안 (호 길이 야코비안: J = |dr/dξ|)
            let dxdxi = 0, dydxi = 0;
            for (let k = 0; k < nNodes; k++) {
                dxdxi += dNxi[k] * xn[k];
                dydxi += dNxi[k] * yn[k];
            }
            const J = Math.sqrt(dxdxi * dxdxi + dydxi * dydxi);
            // 가우스 점에서의 방향 여현 (곡선 요소 대응)
            const cg = dxdxi / J, sg = dydxi / J;

            // 축 변형률-변위 행렬 B (1 × 2*nNodes)
            const B = new Float64Array(dofesm);
            for (let k = 0; k < nNodes; k++) {
                B[2 * k]     = cg * dNxi[k] / J;
                B[2 * k + 1] = sg * dNxi[k] / J;
            }

            const wt = w * J;
            for (let i = 0; i < dofesm; i++)
                for (let j = 0; j < dofesm; j++)
                    esm[i][j] += EA * B[i] * B[j] * wt;
        }
        return { esm, force: vec(dofesm), dofesm };
    }

    // ── 티모셴코 보 강성 ──────────────────────────────────────────────

    /**
     * 2절점 티모셴코 2D 보 국소 강성행렬 (6×6).
     * 자유도 순서: [u1, v1, θ1, u2, v2, θ2] (국소 x축 = 보 축)
     *
     * 구성방정식:
     *   N = EA · ε      (축력-축변형률)
     *   M = EI · κ      (모멘트-곡률)
     *   V = κ_s·GA · γ  (전단력-전단변형률, 티모셴코 추가항)
     *
     * φ = 12EI / (κ_s·GA·L²)  (전단유연성 파라미터)
     *
     * @param {number} EA  — E·A
     * @param {number} EI  — E·I (휨 강성)
     * @param {number} GAs — G·κ_s·A (전단 강성 = κ_s·G·A)
     * @param {number} L   — 요소 길이
     * @returns {Array} 6×6 국소 강성행렬
     */
    function timoshenko2DKl(EA, EI, GAs, L) {
        const L2 = L * L, L3 = L2 * L;
        const phi = 12 * EI / (GAs * L2);   // 전단유연성 파라미터
        const psi = 1 / (1 + phi);

        const k = zeros(6, 6);

        // 축 방향
        k[0][0] =  EA / L; k[0][3] = -EA / L;
        k[3][0] = -EA / L; k[3][3] =  EA / L;

        // 횡방향 (티모셴코 정확해)
        const c1 = 12 * EI * psi / L3;
        const c2 =  6 * EI * psi / L2;
        const c3 = EI * psi * (4 + phi) / L;
        const c4 = EI * psi * (2 - phi) / L;

        k[1][1] =  c1; k[1][2] =  c2; k[1][4] = -c1; k[1][5] =  c2;
        k[2][1] =  c2; k[2][2] =  c3; k[2][4] = -c2; k[2][5] =  c4;
        k[4][1] = -c1; k[4][2] = -c2; k[4][4] =  c1; k[4][5] = -c2;
        k[5][1] =  c2; k[5][2] =  c4; k[5][4] = -c2; k[5][5] =  c3;

        return k;
    }

    /**
     * 3절점 티모셴코 2D 보 국소 강성행렬 (9×9).
     * 절점 순서: nodes[0]=끝단1(ξ=-1), nodes[1]=중간절점(ξ=0), nodes[2]=끝단2(ξ=+1)
     * 자유도: [u1,v1,θ1, u_mid,v_mid,θ_mid, u2,v2,θ2]
     *
     * 구현: 아이소파라메트릭 + 선택적 축소 적분 (전단 잠김 방지)
     *   - 축 + 휨: 3-점 가우스 (완전 적분)
     *   - 전단:   2-점 가우스 (축소 적분)
     *
     * @param {number} EA  — E·A
     * @param {number} EI  — E·I
     * @param {number} GAs — G·κ_s·A
     * @param {number} L   — 요소 길이 (끝단1 → 끝단2)
     * @returns {Array} 9×9 국소 강성행렬
     */
    function timoshenko3DKl(EA, EI, GAs, L) {
        // ξ ∈ [-1,+1]; 절점 0 → ξ=-1, 절점 1 → ξ=0, 절점 2 → ξ=+1
        const J = L / 2;   // 직선 등간격 요소: 야코비안 = L/2 (상수)

        // 라그랑지 2차 형상함수 (절점 0,1,2 → ξ=-1,0,+1)
        const N  = (xi) => [xi*(xi-1)/2,  (1-xi*xi),  xi*(xi+1)/2];
        const dN = (xi) => [(2*xi-1)/2,   -2*xi,       (2*xi+1)/2];

        const k = zeros(9, 9);

        // ── 축 강성 (3-점 가우스) ──
        const g3 = gaussQuad1D(3);
        for (let g = 0; g < 3; g++) {
            const xi = g3.pts[g], w = g3.wts[g];
            const dNxi = dN(xi);
            const wt = w * J;
            for (let a = 0; a < 3; a++) {
                const i = a * 3;   // u 자유도 인덱스
                for (let b = 0; b < 3; b++) {
                    const j = b * 3;
                    k[i][j] += EA / (J * J) * dNxi[a] * dNxi[b] * wt;
                }
            }
        }

        // ── 휨 강성 (3-점 가우스) ──
        for (let g = 0; g < 3; g++) {
            const xi = g3.pts[g], w = g3.wts[g];
            const dNxi = dN(xi);
            const wt = w * J;
            for (let a = 0; a < 3; a++) {
                const i = a * 3 + 2;   // θ 자유도
                for (let b = 0; b < 3; b++) {
                    const j = b * 3 + 2;
                    k[i][j] += EI / (J * J) * dNxi[a] * dNxi[b] * wt;
                }
            }
        }

        // ── 전단 강성 (2-점 가우스 — 전단 잠김 방지 축소 적분) ──
        // γ = dv/dx - θ = (1/J)·(dN/dξ)·v_i - N_i·θ_i
        const g2 = gaussQuad1D(2);
        for (let g = 0; g < 2; g++) {
            const xi = g2.pts[g], w = g2.wts[g];
            const Nxi  = N(xi);
            const dNxi = dN(xi);
            const wt = w * J;

            for (let a = 0; a < 3; a++) {
                for (let b = 0; b < 3; b++) {
                    const vi = a * 3 + 1, ti = a * 3 + 2;
                    const vj = b * 3 + 1, tj = b * 3 + 2;

                    // (v_a, v_b)
                    k[vi][vj] += GAs * (dNxi[a] / J) * (dNxi[b] / J) * wt;
                    // (v_a, θ_b)
                    k[vi][tj] -= GAs * (dNxi[a] / J) * Nxi[b] * wt;
                    // (θ_a, v_b)
                    k[ti][vj] -= GAs * Nxi[a] * (dNxi[b] / J) * wt;
                    // (θ_a, θ_b)
                    k[ti][tj] += GAs * Nxi[a] * Nxi[b] * wt;
                }
            }
        }

        return k;
    }

    // ── 2D 보 회전행렬 (n-절점) ───────────────────────────────────────

    /**
     * n-절점 2D 보 요소 변환행렬 (전역 → 국소).
     * 각 절점 블록: [c s 0; -s c 0; 0 0 1]
     * @param {number} dx, dy — 요소 방향 벡터 (끝단1 → 끝단2)
     * @param {number} L      — 요소 길이
     * @param {number} n      — 절점 수
     * @returns {Array} (3n × 3n) 변환행렬
     */
    function beamRotate2D(dx, dy, L, n) {
        const c = dx / L, s = dy / L;
        const size = 3 * n;
        const T = zeros(size, size);
        for (let i = 0; i < n; i++) {
            const o = 3 * i;
            T[o    ][o    ] =  c; T[o    ][o + 1] = s;
            T[o + 1][o    ] = -s; T[o + 1][o + 1] = c;
            T[o + 2][o + 2] =  1;
        }
        return T;
    }

    // ── 완전 요소 강성 (회전 포함) ────────────────────────────────────

    /**
     * 2절점 티모셴코 2D 보 강성 (전역 6×6, 회전 변환 포함).
     *
     * @param {Object} mat   — { E, nu }
     * @param {Object} prop  — { A, Iz, kappa }  (kappa: 전단보정계수, 없으면 5/6)
     * @param {number[]} xn  — [x1, x2]
     * @param {number[]} yn  — [y1, y2]
     * @returns {{ esm: 6×6, force: Float64Array(6), dofesm: 6, el, kl }}
     */
    function timoshenko2N_stif(mat, prop, xn, yn) {
        const dx = xn[1] - xn[0], dy = yn[1] - yn[0];
        const L   = Math.sqrt(dx * dx + dy * dy);
        const EA  = mat.E * prop.A;
        const EI  = mat.E * (prop.Iz || 0);
        const G   = mat.E / (2 * (1 + (mat.nu || 0.3)));
        const kap = (prop.kappa != null) ? prop.kappa : 5 / 6;
        const GAs = G * kap * prop.A;

        const kl = timoshenko2DKl(EA, EI, GAs, L);
        const T  = beamRotate2D(dx, dy, L, 2);
        const Tt = transpose(T);
        const kg = matMul(Tt, matMul(kl, T));

        return { esm: kg, force: vec(6), dofesm: 6, el: L, kl };
    }

    /**
     * 3절점 티모셴코 2D 보 강성 (전역 9×9, 회전 변환 포함).
     *
     * 절점 입력 순서: nodes[0]=끝단1, nodes[1]=중간절점, nodes[2]=끝단2
     *
     * @param {Object} mat   — { E, nu }
     * @param {Object} prop  — { A, Iz, kappa }
     * @param {number[]} xn  — [x1, x_mid, x2]
     * @param {number[]} yn  — [y1, y_mid, y2]
     * @returns {{ esm: 9×9, force: Float64Array(9), dofesm: 9 }}
     */
    function timoshenko3N_stif(mat, prop, xn, yn) {
        // 요소 방향: 끝단1 → 끝단2 (nodes[0] → nodes[2])
        const dx = xn[2] - xn[0], dy = yn[2] - yn[0];
        const L   = Math.sqrt(dx * dx + dy * dy);
        const EA  = mat.E * prop.A;
        const EI  = mat.E * (prop.Iz || 0);
        const G   = mat.E / (2 * (1 + (mat.nu || 0.3)));
        const kap = (prop.kappa != null) ? prop.kappa : 5 / 6;
        const GAs = G * kap * prop.A;

        const kl = timoshenko3DKl(EA, EI, GAs, L);
        const T  = beamRotate2D(dx, dy, L, 3);
        const Tt = transpose(T);
        const kg = matMul(Tt, matMul(kl, T));

        return { esm: kg, force: vec(9), dofesm: 9 };
    }

    // ── SRI: 구성행렬 분해 (정수압 + 전단) ──────────────────────────────

    /**
     * 구성행렬 D를 정수압(체적) 부분과 전단(변형) 부분으로 분해.
     *
     * 평면응력 (planeStress):
     *   D_vol = (E / (2(1−ν))) · [1 1 0 ; 1 1 0 ; 0 0 0]
     *   D_dev = G              · [1 −1 0 ; −1 1 0 ; 0 0 1]
     *
     * 평면변형률 (planeStrain):
     *   D_vol = λ · [1 1 0 ; 1 1 0 ; 0 0 0]   (λ = Eν / ((1+ν)(1−2ν)))
     *   D_dev = [2G 0 0 ; 0 2G 0 ; 0 0 G]
     *
     * 검증: D_vol + D_dev = D  ✓ (두 모델 모두)
     *
     * @param {string} constitModel  'planeStress' | 'planeStrain'
     * @param {number} E             탄성계수
     * @param {number} nu            포아송비
     * @returns {{ Dvol: Array<Float64Array>, Ddev: Array<Float64Array> }}
     */
    function constitSplit(constitModel, E, nu) {
        const G    = E / (2 * (1 + nu));
        const Dvol = [new Float64Array(3), new Float64Array(3), new Float64Array(3)];
        const Ddev = [new Float64Array(3), new Float64Array(3), new Float64Array(3)];

        if (constitModel === 'planeStrain') {
            const lam = E * nu / ((1 + nu) * (1 - 2 * nu));
            // D_vol = λ · m·mᵀ  (m = [1, 1, 0]ᵀ)
            Dvol[0][0] = lam;  Dvol[0][1] = lam;
            Dvol[1][0] = lam;  Dvol[1][1] = lam;
            // D_dev = diag(2G, 2G, G)
            Ddev[0][0] = 2 * G;
            Ddev[1][1] = 2 * G;
            Ddev[2][2] = G;
        } else {                                 // planeStress
            const kappa = E / (2 * (1 - nu));   // 유효 평면응력 정수압 계수
            // D_vol = κ · m·mᵀ
            Dvol[0][0] = kappa;  Dvol[0][1] = kappa;
            Dvol[1][0] = kappa;  Dvol[1][1] = kappa;
            // D_dev = G · [1 −1 0 ; −1 1 0 ; 0 0 1]
            Ddev[0][0] =  G;  Ddev[0][1] = -G;
            Ddev[1][0] = -G;  Ddev[1][1] =  G;
            Ddev[2][2] =  G;
        }
        return { Dvol, Ddev };
    }

    // ── SRI 강성: 사각형 요소 ─────────────────────────────────────────────

    /**
     * 선택적 축소 적분(SRI) 강성행렬 — 사각형(quad) 요소.
     *
     *   K = α · K_vol(D_vol, nGauss) + β · K_dev(D_dev, nGaussRed)
     *
     * α=β=1, nGaussRed=nGauss 이면 일반 full 적분과 동일.
     * α=β=1, nGaussRed<nGauss 이면 SRI → 전단잠김 감소.
     *
     * @param {Function} shapeN        (xi,eta) → Float64Array[nNodes]
     * @param {Function} shapeDN       (xi,eta) → { dxi, deta }
     * @param {number}   nNodes        절점 수
     * @param {number}   nGauss        정수압 부분 가우스 점 수 (full)
     * @param {number[]} xn, yn        절점 좌표
     * @param {number}   t             두께
     * @param {string}   constitModel  'planeStress' | 'planeStrain'
     * @param {number}   E, nu         재료 상수
     * @param {number}   alpha         정수압 부분 반영 비율 (기본 1.0)
     * @param {number}   beta          전단 부분 반영 비율 (기본 1.0)
     * @param {number}   [nGaussRed]   축소 적분 가우스 점 수 (기본 nGauss−1, 최소 1)
     * @returns {{ esm, force, dofesm }}
     */
    function isoStiffnessSRI2D(shapeN, shapeDN, nNodes, nGauss, xn, yn, t,
                                constitModel, E, nu, alpha, beta, nGaussRed) {
        const { Dvol, Ddev } = constitSplit(constitModel, E, nu);
        const nRed = (nGaussRed != null) ? nGaussRed : Math.max(1, nGauss - 1);

        const rVol = isoStiffness2D(shapeN, shapeDN, nNodes, nGauss, Dvol, xn, yn, t);
        const rDev = isoStiffness2D(shapeN, shapeDN, nNodes, nRed,   Ddev, xn, yn, t);

        const dofesm = nNodes * 2;
        const esm    = zeros(dofesm, dofesm);
        for (let i = 0; i < dofesm; i++)
            for (let j = 0; j < dofesm; j++)
                esm[i][j] = alpha * rVol.esm[i][j] + beta * rDev.esm[i][j];

        return { esm, force: vec(dofesm), dofesm };
    }

    // ── SRI 강성: 삼각형 요소 ────────────────────────────────────────────

    /**
     * 선택적 축소 적분(SRI) 강성행렬 — 삼각형(tri) 요소.
     *
     * 삼각형 구적점 수: 1 / 3 / 6 만 유효.
     * nGaussRed 기본값: nGauss≥6 → 3, 그 외 → 1
     *
     * @param {Function} shapeN, shapeDN  형상함수 / 도함수
     * @param {number}   nNodes   절점 수
     * @param {number}   nGauss   정수압 부분 가우스 점 수 (full)
     * @param {number[]} xn, yn   절점 좌표
     * @param {number}   t        두께
     * @param {string}   constitModel
     * @param {number}   E, nu
     * @param {number}   alpha    정수압 비율
     * @param {number}   beta     전단 비율
     * @param {number}   [nGaussRed]  축소 구적점 수 (기본: nGauss≥6→3, 그 외→1)
     * @returns {{ esm, force, dofesm }}
     */
    function isoStiffnessSRI_Tri(shapeN, shapeDN, nNodes, nGauss, xn, yn, t,
                                  constitModel, E, nu, alpha, beta, nGaussRed) {
        const { Dvol, Ddev } = constitSplit(constitModel, E, nu);
        const nRed = (nGaussRed != null) ? nGaussRed : (nGauss >= 6 ? 3 : 1);

        const rVol = isoStiffnessTri(shapeN, shapeDN, nNodes, nGauss, Dvol, xn, yn, t);
        const rDev = isoStiffnessTri(shapeN, shapeDN, nNodes, nRed,   Ddev, xn, yn, t);

        const dofesm = nNodes * 2;
        const esm    = zeros(dofesm, dofesm);
        for (let i = 0; i < dofesm; i++)
            for (let j = 0; j < dofesm; j++)
                esm[i][j] = alpha * rVol.esm[i][j] + beta * rDev.esm[i][j];

        return { esm, force: vec(dofesm), dofesm };
    }

    // ── 공개 API ────────────────────────────────────────────────────────

    return {
        // 가우스 구적
        gaussQuad1D, gaussQuadTri,
        // 구성방정식
        planeStressD, planeStrainD,
        // 구성행렬 분해 (SRI용)
        constitSplit,
        // 2D 아이소파라메트릭 (사각형)
        isoStiffness2D, isoBodyForce2D,
        // 2D 아이소파라메트릭 (삼각형)
        isoStiffnessTri, isoBodyForceTri,
        // SRI 강성 (사각형 / 삼각형)
        isoStiffnessSRI2D, isoStiffnessSRI_Tri,
        // 임의 점 응력
        isoStress2D_atPt,
        // 1D 봉
        bar1D_Stif,
        // 티모셴코 보 국소 강성
        timoshenko2DKl, timoshenko3DKl,
        // 완전 요소 강성 (회전 포함)
        timoshenko2N_stif, timoshenko3N_stif,
        // 저수준 선형대수
        zeros, vec, matMul, transpose, matVecMul,
        // 소규모 연립방정식 풀이
        solveSmall, solveSmallMulti,
        // 부분행렬/벡터 추출
        subMatrix, subVector,
        // 정적 축소 (static condensation)
        staticCondense, recoverInternalDofs
    };

})();
