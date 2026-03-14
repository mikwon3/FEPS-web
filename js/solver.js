/* ========================================================================
   solver.js  –  FEPS Finite Element Solver (JavaScript)

   Supports: BAR2, BAR3D, BEAM2D, BEAM3D, QUAD4, TRIG3
   Uses dense matrices (2D arrays) and a simple LU-based solver.
   ======================================================================== */

const FepsSolver = (() => {

    // ────── Linear algebra helpers ──────────────────────────────────────────

    function zeros(r, c) {
        const m = [];
        for (let i = 0; i < r; i++) { m[i] = new Float64Array(c); }
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

    /** Solve Ax = b by LU decomposition (in-place, modifies A and b) */
    function luSolve(A, b) {
        const n = b.length;
        for (let k = 0; k < n; k++) {
            let maxVal = Math.abs(A[k][k]), maxRow = k;
            for (let i = k + 1; i < n; i++) {
                if (Math.abs(A[i][k]) > maxVal) { maxVal = Math.abs(A[i][k]); maxRow = i; }
            }
            if (maxRow !== k) {
                [A[k], A[maxRow]] = [A[maxRow], A[k]];
                [b[k], b[maxRow]] = [b[maxRow], b[k]];
            }
            if (Math.abs(A[k][k]) < 1e-30) continue;
            for (let i = k + 1; i < n; i++) {
                const factor = A[i][k] / A[k][k];
                for (let j = k; j < n; j++) A[i][j] -= factor * A[k][j];
                b[i] -= factor * b[k];
            }
        }
        const x = vec(n);
        for (let i = n - 1; i >= 0; i--) {
            let s = b[i];
            for (let j = i + 1; j < n; j++) s -= A[i][j] * x[j];
            x[i] = Math.abs(A[i][i]) > 1e-30 ? s / A[i][i] : 0;
        }
        return x;
    }

    // ────── 2D rotation matrix ─────────────────────────────────────────────

    function rotate2d(dx, dy, el) {
        const c = dx / el, s = dy / el;
        const R = [[c, s, 0], [-s, c, 0], [0, 0, 1]];
        const T = zeros(6, 6);
        for (let i = 0; i < 3; i++)
            for (let j = 0; j < 3; j++) { T[i][j] = R[i][j]; T[i + 3][j + 3] = R[i][j]; }
        return { R, T };
    }

    function rotate3d(dx, dy, dz, el) {
        const cx = dx / el, cy = dy / el, cz = dz / el;
        let R;
        const eps = 1e-10;
        if (Math.abs(cx) < eps && Math.abs(cy) < eps) {
            R = [[0, 0, cz], [-cz, 0, 0], [0, -1, 0]];
        } else {
            const d = Math.sqrt(cx * cx + cy * cy);
            R = [[cx, cy, cz], [-cy / d, cx / d, 0], [-cx * cz / d, -cy * cz / d, d]];
        }
        const T = zeros(6, 6);
        for (let i = 0; i < 3; i++)
            for (let j = 0; j < 3; j++) { T[i][j] = R[i][j]; T[i + 3][j + 3] = R[i][j]; }
        return { R, T };
    }

    /** Build 12×12 block-diagonal transform from 6×6 T */
    function makeT12(T) {
        const T12 = zeros(12, 12);
        for (let i = 0; i < 6; i++)
            for (let j = 0; j < 6; j++) { T12[i][j] = T[i][j]; T12[i + 6][j + 6] = T[i][j]; }
        return T12;
    }

    // ────── Element stiffness routines ─────────────────────────────────────

    function bar2Stif(x, y, ea, alpha, eload) {
        const dx = x[1] - x[0], dy = y[1] - y[0];
        const el = Math.sqrt(dx * dx + dy * dy);
        const { T } = rotate2d(dx, dy, el);
        const Tb = zeros(4, 4);
        Tb[0][0] = T[0][0]; Tb[0][1] = T[0][1]; Tb[1][0] = T[1][0]; Tb[1][1] = T[1][1];
        Tb[2][2] = T[3][3]; Tb[2][3] = T[3][4]; Tb[3][2] = T[4][3]; Tb[3][3] = T[4][4];

        const ks = ea / el;
        const kl = [[ks, 0, -ks, 0], [0, 0, 0, 0], [-ks, 0, ks, 0], [0, 0, 0, 0]];
        const Tt = transpose(Tb);
        const kg = matMul(Tt, matMul(kl, Tb));

        const wx = eload[0] || 0, temp = eload[1] || 0;
        const fl = [wx * el * 0.5 - ea * alpha * temp, 0,
            wx * el * 0.5 + ea * alpha * temp, 0];
        const fg = matVecMul(Tt, new Float64Array(fl));

        return { esm: kg, force: fg, dofesm: 4, el };
    }

    function beam3dStif(x, y, z, ea, eiy, eiz, gj, alpha, eload) {
        const dx = x[1] - x[0], dy = y[1] - y[0], dz = z[1] - z[0];
        const el = Math.sqrt(dx * dx + dy * dy + dz * dz);
        const el2 = el * el, el3 = el2 * el;
        const { R, T } = rotate3d(dx, dy, dz, el);
        const T12 = makeT12(T);

        const kl = zeros(12, 12);
        const ks = ea / el;
        kl[0][0] = ks;  kl[0][6] = -ks;
        kl[6][0] = -ks; kl[6][6] = ks;

        const kt = gj / el;
        kl[3][3] = kt;  kl[3][9] = -kt;
        kl[9][3] = -kt; kl[9][9] = kt;

        const c1z = 12 * eiz / el3, c2z = 6 * eiz / el2, c3z = 4 * eiz / el, c4z = 2 * eiz / el;
        kl[1][1]  =  c1z; kl[1][5]  =  c2z; kl[1][7]  = -c1z; kl[1][11]  =  c2z;
        kl[5][1]  =  c2z; kl[5][5]  =  c3z; kl[5][7]  = -c2z; kl[5][11]  =  c4z;
        kl[7][1]  = -c1z; kl[7][5]  = -c2z; kl[7][7]  =  c1z; kl[7][11]  = -c2z;
        kl[11][1] =  c2z; kl[11][5] =  c4z; kl[11][7] = -c2z; kl[11][11] =  c3z;

        const c1y = 12 * eiy / el3, c2y = 6 * eiy / el2, c3y = 4 * eiy / el, c4y = 2 * eiy / el;
        kl[2][2]  =  c1y; kl[2][4]  = -c2y; kl[2][8]  = -c1y; kl[2][10]  = -c2y;
        kl[4][2]  = -c2y; kl[4][4]  =  c3y; kl[4][8]  =  c2y; kl[4][10]  =  c4y;
        kl[8][2]  = -c1y; kl[8][4]  =  c2y; kl[8][8]  =  c1y; kl[8][10]  =  c2y;
        kl[10][2] = -c2y; kl[10][4] =  c4y; kl[10][8] =  c2y; kl[10][10] =  c3y;

        const Tt = transpose(T12);
        const kg = matMul(Tt, matMul(kl, T12));

        const wx = eload[0] || 0, wy = eload[1] || 0, wz = eload[2] || 0, temp = eload[3] || 0;
        const fl = vec(12);
        fl[0] = wx * el * 0.5 - ea * alpha * temp;  fl[6] = wx * el * 0.5 + ea * alpha * temp;
        fl[1] = wy * el * 0.5;  fl[5]  =  wy * el2 / 12;  fl[7] = wy * el * 0.5;  fl[11] = -wy * el2 / 12;
        fl[2] = wz * el * 0.5;  fl[4]  = -wz * el2 / 12;  fl[8] = wz * el * 0.5;  fl[10] =  wz * el2 / 12;
        const fg = matVecMul(Tt, fl);

        return { esm: kg, force: fg, dofesm: 12, el, kl, T12, R };
    }

    function bar3dStif(x, y, z, ea, alpha, eload) {
        const dx = x[1] - x[0], dy = y[1] - y[0], dz = z[1] - z[0];
        const el = Math.sqrt(dx * dx + dy * dy + dz * dz);
        const { T } = rotate3d(dx, dy, dz, el);
        const ks = ea / el;
        const kl = zeros(6, 6);
        kl[0][0] = ks; kl[0][3] = -ks; kl[3][0] = -ks; kl[3][3] = ks;
        const Tt = transpose(T);
        const kg = matMul(Tt, matMul(kl, T));

        const wx = eload[0] || 0, temp = eload[1] || 0;
        const fl = vec(6);
        fl[0] = wx * el * 0.5 - ea * alpha * temp;
        fl[3] = wx * el * 0.5 + ea * alpha * temp;
        const fg = matVecMul(Tt, fl);
        return { esm: kg, force: fg, dofesm: 6, el };
    }

    function beam2dStif(x, y, ea, ei, alpha, eload) {
        const dx = x[1] - x[0], dy = y[1] - y[0];
        const el = Math.sqrt(dx * dx + dy * dy);
        const el2 = el * el, el3 = el2 * el;

        const kl = zeros(6, 6);
        kl[0][0] = ea / el; kl[0][3] = -ea / el;
        kl[3][0] = -ea / el; kl[3][3] = ea / el;
        kl[1][1] = 12 * ei / el3; kl[1][2] = 6 * ei / el2;
        kl[1][4] = -12 * ei / el3; kl[1][5] = 6 * ei / el2;
        kl[2][1] = 6 * ei / el2; kl[2][2] = 4 * ei / el;
        kl[2][4] = -6 * ei / el2; kl[2][5] = 2 * ei / el;
        kl[4][1] = -12 * ei / el3; kl[4][2] = -6 * ei / el2;
        kl[4][4] = 12 * ei / el3; kl[4][5] = -6 * ei / el2;
        kl[5][1] = 6 * ei / el2; kl[5][2] = 2 * ei / el;
        kl[5][4] = -6 * ei / el2; kl[5][5] = 4 * ei / el;

        const { T } = rotate2d(dx, dy, el);
        const Tt = transpose(T);
        const kg = matMul(Tt, matMul(kl, T));

        const wx = eload[0] || 0, wy = eload[1] || 0, temp = eload[2] || 0;
        const fl = vec(6);
        fl[0] = wx * el * 0.5 - ea * alpha * temp;   // thermal: full EA·α·ΔT (no * 0.5)
        fl[1] = wy * el * 0.5;
        fl[2] = wy * el2 / 12;
        fl[3] = wx * el * 0.5 + ea * alpha * temp;   // thermal: full EA·α·ΔT (no * 0.5)
        fl[4] = wy * el * 0.5;
        fl[5] = -wy * el2 / 12;
        const fg = matVecMul(Tt, fl);
        return { esm: kg, force: fg, dofesm: 6, el, kl };
    }

    /** Constitutive matrix for plane stress */
    function getCmt(E, nu) {
        const fac = E / (1 - nu * nu);
        return [[fac, fac * nu, 0], [fac * nu, fac, 0], [0, 0, fac * (1 - nu) / 2]];
    }

    function quad4Stif(x, y, h, cmt) {
        const dofesm = 8;
        const esm = zeros(dofesm, dofesm);
        const gp = [-1 / Math.sqrt(3), 1 / Math.sqrt(3)];
        const gw = [1, 1];

        for (let gi = 0; gi < 2; gi++) {
            for (let gj = 0; gj < 2; gj++) {
                const xi = gp[gi], eta = gp[gj], w = gw[gi] * gw[gj];
                const s = [0.25 * (1 - xi) * (1 - eta), 0.25 * (1 + xi) * (1 - eta),
                    0.25 * (1 + xi) * (1 + eta), 0.25 * (1 - xi) * (1 + eta)];
                const dsdx = [-0.25 * (1 - eta), 0.25 * (1 - eta), 0.25 * (1 + eta), -0.25 * (1 + eta)];
                const dsde = [-0.25 * (1 - xi), -0.25 * (1 + xi), 0.25 * (1 + xi), 0.25 * (1 - xi)];

                let J11 = 0, J12 = 0, J21 = 0, J22 = 0;
                for (let k = 0; k < 4; k++) {
                    J11 += dsdx[k] * x[k]; J12 += dsdx[k] * y[k];
                    J21 += dsde[k] * x[k]; J22 += dsde[k] * y[k];
                }
                const det = J11 * J22 - J12 * J21;
                const idet = 1 / det;
                const sx = [], sy = [];
                for (let k = 0; k < 4; k++) {
                    sx[k] = idet * (J22 * dsdx[k] - J12 * dsde[k]);
                    sy[k] = idet * (-J21 * dsdx[k] + J11 * dsde[k]);
                }

                let thick = 0;
                for (let k = 0; k < 4; k++) thick += h[k] * s[k];

                const wt = w * det * thick;
                const B = zeros(3, 8);
                for (let k = 0; k < 4; k++) {
                    B[0][k * 2] = sx[k];
                    B[1][k * 2 + 1] = sy[k];
                    B[2][k * 2] = sy[k];
                    B[2][k * 2 + 1] = sx[k];
                }
                const CB = matMul(cmt, B);
                const BtCB = matMul(transpose(B), CB);
                for (let i = 0; i < dofesm; i++)
                    for (let j = 0; j < dofesm; j++)
                        esm[i][j] += wt * BtCB[i][j];
            }
        }
        return { esm, force: vec(dofesm), dofesm };
    }

    function trig3Stif(x, y, h, cmt) {
        const dofesm = 6;
        const det = (x[1] - x[0]) * (y[2] - y[0]) - (x[2] - x[0]) * (y[1] - y[0]);
        const cdet = 1 / det;
        const sx = [cdet * (y[1] - y[2]), cdet * (y[2] - y[0]), cdet * (y[0] - y[1])];
        const sy = [cdet * (x[2] - x[1]), cdet * (x[0] - x[2]), cdet * (x[1] - x[0])];

        const thick = (h[0] + h[1] + h[2]) / 3;
        const area = 0.5 * Math.abs(det);
        const wt = area * thick;

        const B = zeros(3, 6);
        for (let k = 0; k < 3; k++) {
            B[0][k * 2] = sx[k];
            B[1][k * 2 + 1] = sy[k];
            B[2][k * 2] = sy[k];
            B[2][k * 2 + 1] = sx[k];
        }
        const CB = matMul(cmt, B);
        const BtCB = matMul(transpose(B), CB);
        const esm = zeros(dofesm, dofesm);
        for (let i = 0; i < dofesm; i++)
            for (let j = 0; j < dofesm; j++)
                esm[i][j] = wt * BtCB[i][j];
        return { esm, force: vec(dofesm), dofesm };
    }

    // ────── Element DOF count ──────────────────────────────────────────────

    function elNode(typ) {
        // 레지스트리 우선 조회 (축소된 요소의 올바른 절점 수 반환)
        if (typeof FepsElementRegistry !== 'undefined' && FepsElementRegistry.has(typ))
            return FepsElementRegistry.nNodes(typ);
        const builtIn = {
            BAR2: 2, BAR3: 3, BAR3D: 2, BEAM2D: 2, BEAM3D: 2,
            QUAD4: 4, QUAD8: 8, TRIG3: 3, TRIG6: 6,
            BAR2_3N: 3, TIMBEAM2D_2N: 2, TIMBEAM2D_3N: 3
        };
        return builtIn[typ] !== undefined ? builtIn[typ] : 0;
    }

    // ────── Body force fixed-end forces ───────────────────────────────────
    /**
     * Compute body-force equivalent nodal forces in global frame.
     * gravity = { gx, gy, gz }
     * Returns { fg: Float64Array, wx, wy, wz, wy1, wy2, wz1, wz2 }
     * or null if rho = 0.
     */
    function bodyForceFEF(typ, mat, prop, xn, yn, zn, gravity) {
        const rho = mat.rho || 0;
        if (!rho) return null;
        const gx = gravity.gx || 0, gy = gravity.gy || 0, gz = gravity.gz || 0;

        if (typ === 'BEAM2D') {
            const dx = xn[1] - xn[0], dy = yn[1] - yn[0];
            const L = Math.sqrt(dx * dx + dy * dy);
            const c = dx / L, s = dy / L;
            const rA = rho * prop.A;
            // Local body force per unit length
            const wx = rA * (gx * c + gy * s);
            const wy = rA * (-gx * s + gy * c);
            const L2 = L * L;
            const fl = vec(6);
            fl[0] = wx * L / 2;  fl[1] = wy * L / 2;  fl[2] = wy * L2 / 12;
            fl[3] = wx * L / 2;  fl[4] = wy * L / 2;  fl[5] = -wy * L2 / 12;
            const { T } = rotate2d(dx, dy, L);
            const fg = matVecMul(transpose(T), fl);
            return { fg, wx, wy, wy1: wy, wy2: wy };
        }

        if (typ === 'BAR2') {
            const dx = xn[1] - xn[0], dy = yn[1] - yn[0];
            const L = Math.sqrt(dx * dx + dy * dy);
            const rA = rho * prop.A;
            // Lump equally to translational DOFs
            const fg = new Float64Array(4);
            fg[0] = rA * gx * L / 2;  fg[1] = rA * gy * L / 2;
            fg[2] = rA * gx * L / 2;  fg[3] = rA * gy * L / 2;
            return { fg };
        }

        if (typ === 'BEAM3D') {
            const dx = xn[1] - xn[0], dy = yn[1] - yn[0], dz = (zn[1] || 0) - (zn[0] || 0);
            const L = Math.sqrt(dx * dx + dy * dy + dz * dz);
            const { R, T } = rotate3d(dx, dy, dz, L);
            const rA = rho * prop.A;
            // Local body force per unit length (R rows: beam-axis, local-y, local-z)
            const wx = rA * (R[0][0] * gx + R[0][1] * gy + R[0][2] * gz);
            const wy = rA * (R[1][0] * gx + R[1][1] * gy + R[1][2] * gz);
            const wz = rA * (R[2][0] * gx + R[2][1] * gy + R[2][2] * gz);
            const L2 = L * L;
            const fl = vec(12);
            fl[0] = wx * L / 2;  fl[6] = wx * L / 2;
            fl[1] = wy * L / 2;  fl[5]  =  wy * L2 / 12;  fl[7] = wy * L / 2;  fl[11] = -wy * L2 / 12;
            fl[2] = wz * L / 2;  fl[4]  = -wz * L2 / 12;  fl[8] = wz * L / 2;  fl[10] =  wz * L2 / 12;
            const T12 = makeT12(T);
            const fg = matVecMul(transpose(T12), fl);
            return { fg, wx, wy, wz, wy1: wy, wy2: wy, wz1: wz, wz2: wz };
        }

        if (typ === 'BAR3D') {
            const dx = xn[1] - xn[0], dy = yn[1] - yn[0], dz = (zn[1] || 0) - (zn[0] || 0);
            const L = Math.sqrt(dx * dx + dy * dy + dz * dz);
            const rA = rho * prop.A;
            const fg = new Float64Array(6);
            fg[0] = rA * gx * L / 2;  fg[1] = rA * gy * L / 2;  fg[2] = rA * gz * L / 2;
            fg[3] = rA * gx * L / 2;  fg[4] = rA * gy * L / 2;  fg[5] = rA * gz * L / 2;
            return { fg };
        }

        if (typ === 'TRIG3') {
            const det = (xn[1] - xn[0]) * (yn[2] - yn[0]) - (xn[2] - xn[0]) * (yn[1] - yn[0]);
            const area = 0.5 * Math.abs(det);
            const t = prop.t || 0;
            const fx = rho * t * gx * area / 3;
            const fy = rho * t * gy * area / 3;
            const fg = new Float64Array(6);
            for (let i = 0; i < 3; i++) { fg[i * 2] = fx;  fg[i * 2 + 1] = fy; }
            return { fg };
        }

        if (typ === 'QUAD4') {
            // 2×2 Gauss integration of N^T * rho * g * t * det(J)
            const fg = new Float64Array(8);
            const gp = [-1 / Math.sqrt(3), 1 / Math.sqrt(3)];
            const gw = [1, 1];
            const t = prop.t || 0;
            for (let gi = 0; gi < 2; gi++) {
                for (let gj = 0; gj < 2; gj++) {
                    const xi = gp[gi], eta = gp[gj], w = gw[gi] * gw[gj];
                    const N = [0.25 * (1 - xi) * (1 - eta), 0.25 * (1 + xi) * (1 - eta),
                               0.25 * (1 + xi) * (1 + eta), 0.25 * (1 - xi) * (1 + eta)];
                    const dsdx = [-0.25*(1-eta), 0.25*(1-eta), 0.25*(1+eta), -0.25*(1+eta)];
                    const dsde = [-0.25*(1-xi), -0.25*(1+xi), 0.25*(1+xi), 0.25*(1-xi)];
                    let J11=0, J12=0, J21=0, J22=0;
                    for (let k = 0; k < 4; k++) {
                        J11 += dsdx[k] * xn[k]; J12 += dsdx[k] * yn[k];
                        J21 += dsde[k] * xn[k]; J22 += dsde[k] * yn[k];
                    }
                    const det = J11 * J22 - J12 * J21;
                    const wt = w * det * t * rho;
                    for (let k = 0; k < 4; k++) {
                        fg[k * 2]     += N[k] * gx * wt;
                        fg[k * 2 + 1] += N[k] * gy * wt;
                    }
                }
            }
            return { fg };
        }

        return null;
    }

    // ────── Solid thermal FEF ─────────────────────────────────────────────
    /**
     * Equivalent nodal forces for uniform thermal load on a plane solid element.
     * Plane stress: σ_thermal = E·α·ΔT/(1-ν) · {1, 1, 0}^T
     * f_thermal = ∫ B^T · σ_thermal · t · dA
     *
     * @param {string}  typ   'QUAD4' | 'TRIG3'
     * @param {number[]} x, y  node x/y coordinates
     * @param {number}  t     uniform element thickness
     * @param {number}  E, nu, alpha, temp  material/thermal params
     * @returns {Float64Array|null}
     */
    function solidThermalFEF(typ, x, y, t, E, nu, alpha, temp) {
        if (!alpha || !temp) return null;
        const sth = E * alpha * temp / (1 - nu);   // σ_th = E·α·ΔT/(1-ν)

        if (typ === 'TRIG3') {
            const det = (x[1]-x[0])*(y[2]-y[0]) - (x[2]-x[0])*(y[1]-y[0]);
            const cdet = 1 / det;
            const sx = [cdet*(y[1]-y[2]), cdet*(y[2]-y[0]), cdet*(y[0]-y[1])];
            const sy = [cdet*(x[2]-x[1]), cdet*(x[0]-x[2]), cdet*(x[1]-x[0])];
            const area = 0.5 * Math.abs(det);
            const wt = area * t * sth;
            // f_th[k*2] = sx[k]*wt,  f_th[k*2+1] = sy[k]*wt
            const fg = new Float64Array(6);
            for (let k = 0; k < 3; k++) { fg[k*2] = sx[k]*wt; fg[k*2+1] = sy[k]*wt; }
            return fg;
        }

        if (typ === 'QUAD4') {
            const fg = new Float64Array(8);
            const gp = [-1/Math.sqrt(3), 1/Math.sqrt(3)];
            for (let gi = 0; gi < 2; gi++) {
                for (let gj = 0; gj < 2; gj++) {
                    const xi = gp[gi], eta = gp[gj];
                    const dsdx = [-0.25*(1-eta), 0.25*(1-eta), 0.25*(1+eta), -0.25*(1+eta)];
                    const dsde = [-0.25*(1-xi), -0.25*(1+xi), 0.25*(1+xi),  0.25*(1-xi)];
                    let J11=0, J12=0, J21=0, J22=0;
                    for (let k=0; k<4; k++) { J11+=dsdx[k]*x[k]; J12+=dsdx[k]*y[k]; J21+=dsde[k]*x[k]; J22+=dsde[k]*y[k]; }
                    const det = J11*J22 - J12*J21, idet = 1/det;
                    const wt = det * t * sth;   // w=1*1 for 2×2 rule
                    for (let k=0; k<4; k++) {
                        const sxk = idet*(J22*dsdx[k] - J12*dsde[k]);
                        const syk = idet*(-J21*dsdx[k] + J11*dsde[k]);
                        fg[k*2]   += sxk * wt;
                        fg[k*2+1] += syk * wt;
                    }
                }
            }
            return fg;
        }
        return null;
    }

    // ────── Surface load fixed-end forces ─────────────────────────────────
    /**
     * Compute equivalent nodal forces from element surface / distributed loads.
     *
     * For beams  (esurf = { wy1, wy2, wz1, wz2 }):
     *   Trapezoidal load in LOCAL frame, linear from node-1 to node-2.
     *   Uses consistent (Hermitian) FEF formulas.
     *
     * For solids (esurf = [{ side, qx1, qy1, qx2, qy2 }, ...]):
     *   Global traction on element edge, trapezoidal from start→end node of that side.
     *   Consistent (linear shape) nodal forces.
     *
     * Returns { fg, wy1, wy2, wz1, wz2 } for beams; { fg } for solids; null if no load.
     */
    function surfLoadFEF(typ, prop, xn, yn, zn, esurf) {
        if (!esurf) return null;

        // ── BEAM2D / BAR2 ──
        if (typ === 'BEAM2D' || typ === 'BAR2') {
            const wy1 = esurf.wy1 || 0, wy2 = esurf.wy2 || 0;
            if (wy1 === 0 && wy2 === 0) return null;
            const dx = xn[1] - xn[0], dy = yn[1] - yn[0];
            const L = Math.sqrt(dx * dx + dy * dy);
            const L2 = L * L;
            // Trapezoidal FEF in local frame (Hermitian shape functions)
            const fl = vec(6);
            fl[1] = (7 * wy1 + 3 * wy2) * L / 20;
            fl[2] = (3 * wy1 + 2 * wy2) * L2 / 60;
            fl[4] = (3 * wy1 + 7 * wy2) * L / 20;
            fl[5] = -(2 * wy1 + 3 * wy2) * L2 / 60;
            const { T } = rotate2d(dx, dy, L);
            const fg = matVecMul(transpose(T), fl);
            return { fg, wy1, wy2, wz1: 0, wz2: 0 };
        }

        // ── BEAM3D ──
        if (typ === 'BEAM3D') {
            const wy1 = esurf.wy1 || 0, wy2 = esurf.wy2 || 0;
            const wz1 = esurf.wz1 || 0, wz2 = esurf.wz2 || 0;
            if (wy1 === 0 && wy2 === 0 && wz1 === 0 && wz2 === 0) return null;
            const dx = xn[1] - xn[0], dy = yn[1] - yn[0], dz = (zn[1] || 0) - (zn[0] || 0);
            const L = Math.sqrt(dx * dx + dy * dy + dz * dz);
            const L2 = L * L;
            const fl = vec(12);
            // Transverse y (→ v, θz DOFs: 1, 5, 7, 11)
            fl[1]  = (7 * wy1 + 3 * wy2) * L / 20;
            fl[5]  = (3 * wy1 + 2 * wy2) * L2 / 60;
            fl[7]  = (3 * wy1 + 7 * wy2) * L / 20;
            fl[11] = -(2 * wy1 + 3 * wy2) * L2 / 60;
            // Transverse z (→ w, θy DOFs: 2, 4, 8, 10)
            fl[2]  = (7 * wz1 + 3 * wz2) * L / 20;
            fl[4]  = -(3 * wz1 + 2 * wz2) * L2 / 60;
            fl[8]  = (3 * wz1 + 7 * wz2) * L / 20;
            fl[10] = (2 * wz1 + 3 * wz2) * L2 / 60;
            const { T } = rotate3d(dx, dy, dz, L);
            const T12 = makeT12(T);
            const fg = matVecMul(transpose(T12), fl);
            return { fg, wy1, wy2, wz1, wz2 };
        }

        // ── QUAD4 / TRIG3: edge traction in global frame ──
        if ((typ === 'QUAD4' || typ === 'TRIG3') && Array.isArray(esurf) && esurf.length > 0) {
            const t = prop.t || 0;
            const nn = typ === 'QUAD4' ? 4 : 3;
            // Side → [nodeA_index, nodeB_index] (0-based, CCW ordering)
            const sidePairs = typ === 'QUAD4'
                ? [[0, 1], [1, 2], [2, 3], [3, 0]]
                : [[0, 1], [1, 2], [2, 0]];
            const fg = new Float64Array(nn * 2);
            for (const face of esurf) {
                const si = face.side - 1;  // convert 1-based → 0-based
                if (si < 0 || si >= sidePairs.length) continue;
                const [ia, ib] = sidePairs[si];
                const edgeLen = Math.sqrt((xn[ib]-xn[ia])**2 + (yn[ib]-yn[ia])**2);
                // Consistent trapezoidal: fa = L*t*(2*qa+qb)/6, fb = L*t*(qa+2*qb)/6
                fg[ia * 2]     += edgeLen * t * (2 * face.qx1 + face.qx2) / 6;
                fg[ia * 2 + 1] += edgeLen * t * (2 * face.qy1 + face.qy2) / 6;
                fg[ib * 2]     += edgeLen * t * (face.qx1 + 2 * face.qx2) / 6;
                fg[ib * 2 + 1] += edgeLen * t * (face.qy1 + 2 * face.qy2) / 6;
            }
            return { fg };
        }

        return null;
    }

    // ────── Main solver ────────────────────────────────────────────────────

    function solve(model) {
        const h = model.header;
        const { dofNod, dim } = h;
        const gravity = model.gravity || { gx: 0, gy: 0, gz: 0 };

        const nids = Object.keys(model.nodes).map(Number).sort((a, b) => a - b);
        const eids = Object.keys(model.elements).map(Number).sort((a, b) => a - b);
        const numNod = nids.length;
        h.numNod = numNod;

        const nMap = {};
        nids.forEach((id, i) => nMap[id] = i);

        const maxDof = dofNod * numNod;
        const dofType = new Int8Array(maxDof);
        const dofForce = vec(maxDof);
        const dofDisp = vec(maxDof);

        for (const nid of Object.keys(model.bcs).map(Number)) {
            const bc = model.bcs[nid];
            if (!(nid in nMap)) continue;
            const idx = nMap[nid];
            for (let j = 0; j < dofNod; j++) {
                const dof = idx * dofNod + j;
                if (bc.tags[j]) dofType[dof] = 1;
                dofForce[dof] = bc.forces[j] || 0;
                dofDisp[dof]  = bc.disps[j]  || 0;
            }
        }

        const freeDofs = [], consDofs = [];
        for (let i = 0; i < maxDof; i++) {
            if (dofType[i] === 0) freeDofs.push(i);
            else consDofs.push(i);
        }
        const nf = freeDofs.length, nc = consDofs.length;
        const nd = nf + nc;

        const reorder = new Int32Array(maxDof);
        freeDofs.forEach((d, i) => reorder[d] = i);
        consDofs.forEach((d, i) => reorder[d] = nf + i);

        const K = zeros(nd, nd);
        const F = vec(nd);
        for (let i = 0; i < maxDof; i++) F[reorder[i]] = dofForce[i];

        const elefor = vec(nd);
        const eleInfo = {};

        for (const eid of eids) {
            const e = model.elements[eid];
            const typ = e.type;
            const nn = elNode(typ);
            if (nn === 0) continue;
            const dofesm = dofNod * nn;

            const mat  = model.materials[e.mat]   || { E: 1, nu: 0, rho: 0 };
            const prop = model.properties[e.pro]  || { A: 1, t: 1, Iz: 0, alpha: 0 };

            const xn = [], yn = [], zn = [];
            for (const nid of e.nodes) {
                const nd2 = model.nodes[nid];
                xn.push(nd2.x); yn.push(nd2.y); zn.push(nd2.z || 0);
            }

            let result;
            const eload = e.eload || [];
            switch (typ) {
                case 'BAR2': {
                    result = bar2Stif(xn, yn, mat.E * prop.A, prop.alpha, eload);
                    break;
                }
                case 'BAR3D': {
                    result = bar3dStif(xn, yn, zn, mat.E * prop.A, prop.alpha, eload);
                    break;
                }
                case 'BEAM2D': {
                    result = beam2dStif(xn, yn, mat.E * prop.A, mat.E * prop.Iz, prop.alpha, eload);
                    break;
                }
                case 'BEAM3D': {
                    const ea  = mat.E * prop.A;
                    const eiy = mat.E * (prop.Iy || prop.Iz || 0);
                    const eiz = mat.E * (prop.Iz || 0);
                    const G   = mat.G || mat.E / (2 * (1 + (mat.nu || 0.3)));
                    const gj  = G * (prop.J || ((prop.Iz || 0) + (prop.Iy || prop.Iz || 0)));
                    result = beam3dStif(xn, yn, zn, ea, eiy, eiz, gj, prop.alpha || 0, eload);
                    break;
                }
                case 'QUAD4': {
                    const cmt = getCmt(mat.E, mat.nu);
                    const h4 = [prop.t, prop.t, prop.t, prop.t];
                    result = quad4Stif(xn, yn, h4, cmt);
                    const tf4 = solidThermalFEF('QUAD4', xn, yn, prop.t, mat.E, mat.nu, prop.alpha || 0, eload[0] || 0);
                    if (tf4) for (let i = 0; i < tf4.length; i++) result.force[i] += tf4[i];
                    break;
                }
                case 'TRIG3': {
                    const cmt = getCmt(mat.E, mat.nu);
                    const h3 = [prop.t, prop.t, prop.t];
                    result = trig3Stif(xn, yn, h3, cmt);
                    const tf3 = solidThermalFEF('TRIG3', xn, yn, prop.t, mat.E, mat.nu, prop.alpha || 0, eload[0] || 0);
                    if (tf3) for (let i = 0; i < tf3.length; i++) result.force[i] += tf3[i];
                    break;
                }
                default: {
                    // ── 레지스트리 요소 처리 ──────────────────────────────
                    if (typeof FepsElementRegistry !== 'undefined' && FepsElementRegistry.has(typ)) {
                        const desc = FepsElementRegistry.get(typ);
                        result = desc.computeStiffness(mat, prop, xn, yn, zn, eload);
                    } else {
                        continue;
                    }
                    break;
                }
            }

            eleInfo[eid] = { ...result, xn, yn, zn, typ };

            // EFT (element freedom table)
            const eft = [];
            for (const nid of e.nodes) {
                const idx = nMap[nid];
                for (let j = 0; j < dofNod; j++) eft.push(reorder[idx * dofNod + j]);
            }

            // Scatter stiffness and eload FEF
            for (let i = 0; i < dofesm; i++) {
                elefor[eft[i]] += result.force[i];
                for (let j = 0; j < dofesm; j++) K[eft[i]][eft[j]] += result.esm[i][j];
            }

            // ── Debug hook: 요소 강성행렬 및 EFT 저장 ──────────────────
            if (typeof FepsDebug !== 'undefined' && FepsDebug.isEnabled())
                FepsDebug.storeElem(eid, typ, eft, result.esm, e.nodes);

            // ── Body force contribution ──
            let body_wx = 0, body_wy = 0, body_wz = 0;
            const bf = bodyForceFEF(typ, mat, prop, xn, yn, zn, gravity);
            if (bf) {
                for (let i = 0; i < bf.fg.length; i++) elefor[eft[i]] += bf.fg[i];
                body_wx = bf.wx || 0;
                body_wy = bf.wy || 0;
                body_wz = bf.wz || 0;
            } else if (typeof FepsElementRegistry !== 'undefined' && FepsElementRegistry.has(typ)) {
                // 레지스트리 체적력
                const _rd = FepsElementRegistry.get(typ);
                if (_rd.computeBodyForce) {
                    const rfg = _rd.computeBodyForce(mat, prop, xn, yn, zn, gravity);
                    if (rfg) for (let i = 0; i < rfg.length; i++) elefor[eft[i]] += rfg[i];
                }
            }

            // ── Surface / distributed load contribution (esurf) ──
            let surf_wy1 = 0, surf_wy2 = 0, surf_wz1 = 0, surf_wz2 = 0;
            const sf = surfLoadFEF(typ, prop, xn, yn, zn, e.esurf || null);
            if (sf) {
                for (let i = 0; i < sf.fg.length; i++) elefor[eft[i]] += sf.fg[i];
                surf_wy1 = sf.wy1 || 0;
                surf_wy2 = sf.wy2 || 0;
                surf_wz1 = sf.wz1 || 0;
                surf_wz2 = sf.wz2 || 0;
            }

            // Store combined distributed load params for beam post-processing
            eleInfo[eid].wx_total  = (eload[0] || 0) + body_wx;
            eleInfo[eid].wy1_total = (eload[1] || 0) + body_wy + surf_wy1;
            eleInfo[eid].wy2_total = (eload[1] || 0) + body_wy + surf_wy2;
            eleInfo[eid].wz1_total = (eload[2] || 0) + body_wz + surf_wz1;
            eleInfo[eid].wz2_total = (eload[2] || 0) + body_wz + surf_wz2;
        }

        // ── Solve (partition) ──
        const vc = vec(nc);
        for (let i = 0; i < nc; i++) vc[i] = dofDisp[consDofs[i]];

        const ff = vec(nf);
        for (let i = 0; i < nf; i++) {
            ff[i] = F[i] - elefor[i];
            for (let j = 0; j < nc; j++) ff[i] -= K[i][nf + j] * vc[j];
        }

        // ── Debug hook: 전역 강성행렬 저장 (BC 분리 전) ────────────────
        if (typeof FepsDebug !== 'undefined' && FepsDebug.isEnabled())
            FepsDebug.storeGlobal(K, F, nd, nf, nc);

        const Kff = zeros(nf, nf);
        for (let i = 0; i < nf; i++)
            for (let j = 0; j < nf; j++)
                Kff[i][j] = K[i][j];

        const vf = luSolve(Kff, ff);

        // ── Reactions ──
        const fc = vec(nc);
        for (let i = 0; i < nc; i++) {
            let s = -elefor[nf + i];
            for (let j = 0; j < nf; j++) s += K[nf + i][j] * vf[j];
            for (let j = 0; j < nc; j++) s += K[nf + i][nf + j] * vc[j];
            fc[i] = s;
        }

        // ── Map back to nodal arrays ──
        const nodeDisp = {};
        const nodeForce = {};
        for (const nid of nids) {
            const idx = nMap[nid];
            const u = [], f = [];
            for (let j = 0; j < dofNod; j++) {
                const gdof = idx * dofNod + j;
                const ri = reorder[gdof];
                if (ri < nf) { u.push(vf[ri]);      f.push(0); }
                else         { u.push(dofDisp[gdof]); f.push(fc[ri - nf]); }
            }
            nodeDisp[nid]  = u;
            nodeForce[nid] = f;
        }

        // ── Post-processing: element forces ──
        const elemForces = {};
        for (const eid of eids) {
            const e    = model.elements[eid];
            const info = eleInfo[eid];
            if (!info) continue;
            const { typ, xn, yn, zn, el } = info;
            const mat  = model.materials[e.mat]  || { E: 1, nu: 0.3 };
            const prop = model.properties[e.pro] || { A: 1, Iz: 0, Iy: 0, J: 0 };

            if (typ === 'BAR2') {
                const dx = xn[1] - xn[0], dy = yn[1] - yn[0];
                const L = Math.sqrt(dx * dx + dy * dy);
                const c = dx / L, s = dy / L;
                const u1 = nodeDisp[e.nodes[0]], u2 = nodeDisp[e.nodes[1]];
                const ul1 = c * u1[0] + s * u1[1];
                const ul2 = c * u2[0] + s * u2[1];
                const axial = mat.E * prop.A / L * (ul2 - ul1);
                elemForces[eid] = { axial, stress: axial / prop.A };
            }

            if (typ === 'BAR3D') {
                const dx = xn[1]-xn[0], dy = yn[1]-yn[0], dz = (zn[1]||0)-(zn[0]||0);
                const L = Math.sqrt(dx*dx + dy*dy + dz*dz);
                const { R, T } = rotate3d(dx, dy, dz, L);
                const u1 = nodeDisp[e.nodes[0]], u2 = nodeDisp[e.nodes[1]];
                const ug = vec(6);
                for (let j = 0; j < 3; j++) { ug[j] = u1[j] || 0; ug[3+j] = u2[j] || 0; }
                const ul = matVecMul(T, ug);
                const axial = mat.E * prop.A / L * (ul[3] - ul[0]);
                elemForces[eid] = {
                    axial, stress: axial / prop.A, L,
                    ex: [R[0][0], R[0][1], R[0][2]],
                    ey: [R[1][0], R[1][1], R[1][2]],
                    ez: [R[2][0], R[2][1], R[2][2]]
                };
            }

            if (typ === 'BEAM2D') {
                const dx = xn[1] - xn[0], dy = yn[1] - yn[0];
                const L  = Math.sqrt(dx * dx + dy * dy);
                const L2 = L * L;
                const { T } = rotate2d(dx, dy, L);
                const ea   = mat.E * prop.A;
                const eload = e.eload || [];
                const temp  = eload[2] || 0;

                const ug = vec(6);
                const u1 = nodeDisp[e.nodes[0]], u2 = nodeDisp[e.nodes[1]];
                for (let j = 0; j < dofNod; j++) { ug[j] = u1[j]; ug[3 + j] = u2[j]; }
                const ul = matVecMul(T, ug);
                const fl = matVecMul(info.kl, ul);

                // Total distributed loads (eload + body + esurf), trapezoidal
                const wx1 = info.wx_total  || 0;
                const wy1 = info.wy1_total || 0;
                const wy2 = info.wy2_total || 0;

                // Subtract total FEF (trapezoidal Hermitian formulas)
                fl[0] -= wx1 * L / 2 - ea * prop.alpha * temp;   // thermal: full EA·α·ΔT
                fl[1] -= (7 * wy1 + 3 * wy2) * L / 20;
                fl[2] -= (3 * wy1 + 2 * wy2) * L2 / 60;
                fl[3] -= wx1 * L / 2 + ea * prop.alpha * temp;   // thermal: full EA·α·ΔT
                fl[4] -= (3 * wy1 + 7 * wy2) * L / 20;
                fl[5] -= -(2 * wy1 + 3 * wy2) * L2 / 60;

                elemForces[eid] = {
                    N1: fl[0], V1: fl[1], M1: fl[2],
                    N2: fl[3], V2: fl[4], M2: fl[5],
                    L, wy1, wy2
                };
            }

            if (typ === 'BEAM3D') {
                const { kl, T12, R } = info;
                const L  = el;
                const L2 = L * L;
                const eload = e.eload || [];
                const ea_b3   = mat.E * prop.A;
                const alpha_b3 = prop.alpha || 0;
                const temp_b3  = eload[3] || 0;

                const ug = vec(12);
                const u1 = nodeDisp[e.nodes[0]], u2 = nodeDisp[e.nodes[1]];
                for (let j = 0; j < 6; j++) { ug[j] = u1[j] || 0; ug[6 + j] = u2[j] || 0; }
                const ul = matVecMul(T12, ug);
                const fl = matVecMul(kl, ul);

                // Total distributed loads (eload + body + esurf), trapezoidal
                const wx1  = info.wx_total  || 0;
                const wy1  = info.wy1_total || 0;
                const wy2  = info.wy2_total || 0;
                const wz1  = info.wz1_total || 0;
                const wz2  = info.wz2_total || 0;

                // Subtract total FEF (axial uniform + thermal, transverse trapezoidal)
                fl[0]  -= wx1 * L / 2 - ea_b3 * alpha_b3 * temp_b3;
                fl[6]  -= wx1 * L / 2 + ea_b3 * alpha_b3 * temp_b3;
                fl[1]  -= (7 * wy1 + 3 * wy2) * L / 20;
                fl[5]  -= (3 * wy1 + 2 * wy2) * L2 / 60;
                fl[7]  -= (3 * wy1 + 7 * wy2) * L / 20;
                fl[11] -= -(2 * wy1 + 3 * wy2) * L2 / 60;
                fl[2]  -= (7 * wz1 + 3 * wz2) * L / 20;
                fl[4]  -= -(3 * wz1 + 2 * wz2) * L2 / 60;
                fl[8]  -= (3 * wz1 + 7 * wz2) * L / 20;
                fl[10] -= (2 * wz1 + 3 * wz2) * L2 / 60;

                elemForces[eid] = {
                    N1: fl[0],  Vy1: fl[1], Vz1: fl[2], T1: fl[3],  My1: fl[4],  Mz1: fl[5],
                    N2: fl[6],  Vy2: fl[7], Vz2: fl[8], T2: fl[9],  My2: fl[10], Mz2: fl[11],
                    L, wy1, wy2, wz1, wz2,
                    ex: [R[0][0], R[0][1], R[0][2]],
                    ey: [R[1][0], R[1][1], R[1][2]],
                    ez: [R[2][0], R[2][1], R[2][2]]
                };
            }

            // ── BAR2_3N: 3절점 2차 봉 요소 (끝단→끝단 축력 추출) ──────
            if (typ === 'BAR2_3N') {
                // nodes: [끝단1, 중간, 끝단2]
                const dx = xn[2] - xn[0], dy = yn[2] - yn[0];
                const L  = Math.sqrt(dx * dx + dy * dy);
                const c = dx / L, s = dy / L;
                const u0 = nodeDisp[e.nodes[0]], u2b = nodeDisp[e.nodes[2]];
                const ul0 = c * (u0[0] || 0) + s * (u0[1] || 0);
                const ul2 = c * (u2b[0] || 0) + s * (u2b[1] || 0);
                const axial = mat.E * prop.A / L * (ul2 - ul0);
                elemForces[eid] = { axial, stress: prop.A > 0 ? axial / prop.A : 0 };
            }

            // ── TIMBEAM2D_2N / _3N: 티모셴코 보 요소 절점력 ──────────
            if (typ === 'TIMBEAM2D_2N' || typ === 'TIMBEAM2D_3N') {
                const nNodes = e.nodes.length;
                const last   = nNodes - 1;
                const dx = xn[last] - xn[0], dy = yn[last] - yn[0];
                const L  = Math.sqrt(dx * dx + dy * dy);
                const ndof = nNodes * 3; // 3 DOF/절점

                // 전역 변위 벡터 조립
                const ug = vec(ndof);
                for (let ni = 0; ni < nNodes; ni++) {
                    const u = nodeDisp[e.nodes[ni]] || [0, 0, 0];
                    for (let d = 0; d < 3; d++) ug[ni * 3 + d] = u[d] || 0;
                }

                // fg = Ke × ug  (Ke = 전역 강성행렬, eleInfo[eid].esm)
                const Ke = info.esm;
                const fg = vec(ndof);
                for (let i = 0; i < ndof; i++)
                    for (let j = 0; j < ndof; j++)
                        fg[i] += (Ke[i] ? Ke[i][j] : 0) * ug[j];

                // fl = T × fg  (T 는 element-core.js 의 beamRotate2D)
                // fl = kl × ul と等価 (T は直交行列 → T × Tᵀ × kl × T × ug = kl × ul)
                let fl = fg; // fallback: 회전 없음
                if (typeof FepsElementCore !== 'undefined' &&
                    typeof FepsElementCore.beamRotate2D === 'function') {
                    const T = FepsElementCore.beamRotate2D(dx, dy, L, nNodes);
                    fl = vec(ndof);
                    for (let i = 0; i < ndof; i++)
                        for (let j = 0; j < ndof; j++)
                            fl[i] += T[i][j] * fg[j];
                }

                // 끝단 절점력만 추출 (중간절점 DOF 는 내부 자유도)
                const li = last * 3;
                elemForces[eid] = {
                    N1: fl[0],  V1: fl[1],  M1: fl[2],
                    N2: fl[li], V2: fl[li+1], M2: fl[li+2],
                    L, wy1: 0, wy2: 0
                };
            }

            // ── Registry bar1d 요소 (일반) ──────────────────────────────
            {
                const regDesc = (typeof FepsElementRegistry !== 'undefined')
                    ? FepsElementRegistry.get(typ) : null;
                if (regDesc && regDesc.category === 'bar1d' && !elemForces[eid]) {
                    const last = e.nodes.length - 1;
                    const dx = xn[xn.length-1] - xn[0], dy = yn[yn.length-1] - yn[0];
                    const L  = Math.sqrt(dx * dx + dy * dy);
                    const c  = dx / L, s = dy / L;
                    const u0 = nodeDisp[e.nodes[0]], uL = nodeDisp[e.nodes[last]];
                    const ul0 = c * (u0[0] || 0) + s * (u0[1] || 0);
                    const ulL = c * (uL[0] || 0) + s * (uL[1] || 0);
                    const axial = mat.E * prop.A / L * (ulL - ul0);
                    elemForces[eid] = { axial, stress: prop.A > 0 ? axial / prop.A : 0 };
                }
            }

            // ── Registry beam2d_tim 요소 (일반, TIMBEAM2D_*N 외) ───────
            {
                const regDesc = (typeof FepsElementRegistry !== 'undefined')
                    ? FepsElementRegistry.get(typ) : null;
                if (regDesc && regDesc.category === 'beam2d_tim' && !elemForces[eid] &&
                    typeof FepsElementCore !== 'undefined') {
                    const nNodes = e.nodes.length;
                    const last   = nNodes - 1;
                    const dx = xn[last] - xn[0], dy = yn[last] - yn[0];
                    const L  = Math.sqrt(dx * dx + dy * dy);
                    const ndof = nNodes * 3;
                    const ug = vec(ndof);
                    for (let ni = 0; ni < nNodes; ni++) {
                        const u = nodeDisp[e.nodes[ni]] || [0, 0, 0];
                        for (let d = 0; d < 3; d++) ug[ni * 3 + d] = u[d] || 0;
                    }
                    const Ke = info.esm;
                    const fg = vec(ndof);
                    for (let i = 0; i < ndof; i++)
                        for (let j = 0; j < ndof; j++)
                            fg[i] += (Ke[i] ? Ke[i][j] : 0) * ug[j];
                    let fl = fg;
                    if (typeof FepsElementCore.beamRotate2D === 'function') {
                        const T = FepsElementCore.beamRotate2D(dx, dy, L, nNodes);
                        fl = vec(ndof);
                        for (let i = 0; i < ndof; i++)
                            for (let j = 0; j < ndof; j++)
                                fl[i] += T[i][j] * fg[j];
                    }
                    const li = last * 3;
                    elemForces[eid] = {
                        N1: fl[0], V1: fl[1], M1: fl[2],
                        N2: fl[li], V2: fl[li+1], M2: fl[li+2],
                        L, wy1: 0, wy2: 0
                    };
                }
            }
        }

        // ── Post-processing: 2D stress ──
        const nodeStress = {};
        const nodeCnt = {};
        for (const eid of eids) {
            const e   = model.elements[eid];
            const typ = e.type;
            const mat = model.materials[e.mat] || { E: 1, nu: 0 };
            const prop = model.properties[e.pro] || { t: 1 };

            const isBuiltinSolid = (typ === 'QUAD4' || typ === 'TRIG3');
            const regDesc = (typeof FepsElementRegistry !== 'undefined')
                ? FepsElementRegistry.get(typ) : null;
            const isRegSolid = regDesc && regDesc.category === 'solid2d';

            if (!isBuiltinSolid && !isRegSolid) continue;

            const nn = elNode(typ);
            const xn = [], yn = [], ue = [];
            for (const nid of e.nodes) {
                const nd2 = model.nodes[nid];
                xn.push(nd2.x); yn.push(nd2.y);
                const u = nodeDisp[nid];
                ue.push(u[0], u[1]);
            }

            let sxx, syy, txy;
            if (isBuiltinSolid) {
                // 기존 QUAD4 / TRIG3 처리
                const cmt = getCmt(mat.E, mat.nu);
                let sx, sy;
                if (typ === 'QUAD4') { const r = q4Shape(0, 0, xn, yn); sx = r.sx; sy = r.sy; }
                else                 { const r = t3Shape(xn, yn);        sx = r.sx; sy = r.sy; }
                const strain = [0, 0, 0];
                for (let k = 0; k < nn; k++) {
                    strain[0] += sx[k] * ue[k * 2];
                    strain[1] += sy[k] * ue[k * 2 + 1];
                    strain[2] += sy[k] * ue[k * 2] + sx[k] * ue[k * 2 + 1];
                }
                const sig = [0, 0, 0];
                for (let i = 0; i < 3; i++)
                    for (let j = 0; j < 3; j++) sig[i] += cmt[i][j] * strain[j];
                sxx = sig[0]; syy = sig[1]; txy = sig[2];
            } else {
                // 레지스트리 요소 응력
                const rs = regDesc.computeStress(mat, prop, xn, yn, ue);
                if (!rs) continue;
                sxx = rs.sxx; syy = rs.syy; txy = rs.txy;
            }

            const savg = (sxx + syy) / 2;
            const sdif = (sxx - syy) / 2;
            const rad  = Math.sqrt(sdif * sdif + txy * txy);
            const smax = savg + rad, smin = savg - rad;
            const mises = Math.sqrt(smax * smax - smax * smin + smin * smin);

            for (const nid of e.nodes) {
                if (!nodeStress[nid]) nodeStress[nid] = [0, 0, 0, 0, 0, 0];
                if (!nodeCnt[nid])    nodeCnt[nid] = 0;
                nodeStress[nid][0] += sxx;
                nodeStress[nid][1] += syy;
                nodeStress[nid][2] += txy;
                nodeStress[nid][3] += smax;
                nodeStress[nid][4] += smin;
                nodeStress[nid][5] += mises;
                nodeCnt[nid]++;
            }
        }
        for (const nid of Object.keys(nodeStress).map(Number)) {
            const c = nodeCnt[nid];
            for (let j = 0; j < 6; j++) nodeStress[nid][j] /= c;
        }

        // ── Debug hook: 변위 결과 저장 + UI 이벤트 발생 ────────────────
        if (typeof FepsDebug !== 'undefined' && FepsDebug.isEnabled()) {
            FepsDebug.storeResult(nodeDisp, dofNod);
            setTimeout(() => window.dispatchEvent(new CustomEvent('feps:solved')), 30);
        }

        return { nodeDisp, nodeForce, elemForces, nodeStress, nf, nc };
    }

    // ── Shape function helpers for stress ──
    function q4Shape(xi, eta, x, y) {
        const dsdx = [-0.25*(1-eta), 0.25*(1-eta), 0.25*(1+eta), -0.25*(1+eta)];
        const dsde = [-0.25*(1-xi), -0.25*(1+xi), 0.25*(1+xi), 0.25*(1-xi)];
        let J11=0, J12=0, J21=0, J22=0;
        for (let k = 0; k < 4; k++) {
            J11 += dsdx[k]*x[k]; J12 += dsdx[k]*y[k];
            J21 += dsde[k]*x[k]; J22 += dsde[k]*y[k];
        }
        const det = J11*J22 - J12*J21, idet = 1/det;
        const sx = [], sy = [];
        for (let k = 0; k < 4; k++) {
            sx[k] = idet*(J22*dsdx[k] - J12*dsde[k]);
            sy[k] = idet*(-J21*dsdx[k] + J11*dsde[k]);
        }
        return { sx, sy };
    }

    function t3Shape(x, y) {
        const det = (x[1]-x[0])*(y[2]-y[0]) - (x[2]-x[0])*(y[1]-y[0]);
        const c = 1/det;
        return {
            sx: [c*(y[1]-y[2]), c*(y[2]-y[0]), c*(y[0]-y[1])],
            sy: [c*(x[2]-x[1]), c*(x[0]-x[2]), c*(x[1]-x[0])]
        };
    }

    return { solve, elNode, rotate2d, rotate3d, getCmt };
})();
