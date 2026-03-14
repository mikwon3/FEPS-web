/* ========================================================================
   element-registry.js  –  FEPS Element Registry

   전역 싱글톤: FepsElementRegistry
   학생/개발자가 커스텀 요소 descriptor를 등록할 수 있는 레지스트리.

   ── 사용법 ─────────────────────────────────────────────────────────────

   ▶ 2D 고체 요소 (category: 'solid2d')
     shapeN(xi, eta)  와 shapeDN(xi, eta) 만 구현하면
     computeStiffness / computeBodyForce / computeStress 가 자동 생성됨.

   ▶ 1D 봉 요소 (category: 'bar1d')
     shapeN1D(xi) 와 shapeDN1D(xi) 만 구현하면 자동 생성됨.

   ▶ 티모셴코 보 요소 (category: 'beam2d_tim')
     nNodes (2 또는 3), kappa(전단보정계수) 만 지정하면 자동 생성됨.
   ======================================================================== */

const FepsElementRegistry = (() => {

    const _registry = new Map();

    // ── 공개 API ────────────────────────────────────────────────────────

    /**
     * 요소 descriptor 등록.
     *
     * 공통 필수 필드:
     *   name        (string) — 요소 타입명 (대소문자 무관, e.g. 'QUAD8')
     *   nNodes      (number) — 요소 절점 수
     *   dofPerNode  (number) — 절점당 자유도 (모델의 dofNod 와 일치해야 함)
     *
     * 카테고리별 필드:
     *
     * [solid2d]  2D 고체 요소 (평면응력/평면변형률)
     *   category     = 'solid2d'
     *   constitModel = 'planeStress' | 'planeStrain'
     *   gaussOrder   (number)  — 방향당 가우스 점 수 (기본 3)
     *   cornerNodes  (number)  — 렌더링에 쓰일 코너 절점 수 (기본 4 또는 3)
     *   triangular   (boolean) — 삼각형 자연좌표계 사용 여부
     *   shapeN(xi, eta)  → Float64Array[nNodes]
     *   shapeDN(xi, eta) → { dxi: Float64Array[nNodes], deta: Float64Array[nNodes] }
     *
     * [bar1d]  1D 봉 요소
     *   category   = 'bar1d'
     *   gaussOrder (number)
     *   shapeN1D(xi)  → Float64Array[nNodes]
     *   shapeDN1D(xi) → Float64Array[nNodes]
     *
     * [beam2d_tim]  2D 티모셴코 보 요소
     *   category = 'beam2d_tim'
     *   kappa    (number)  — 전단보정계수 κ_s (기본 5/6)
     *
     * 직접 제공(선택):
     *   computeStiffness(mat, prop, xn, yn, zn, eload) → { esm, force, dofesm }
     *   computeStress(mat, prop, xn, yn, ue)           → { sxx, syy, txy, smax, smin, mises }
     *   computeBodyForce(mat, prop, xn, yn, zn, gravity) → Float64Array | null
     */
    function register(desc) {
        if (!desc || !desc.name) throw new Error('Element descriptor must have a name');
        const name = desc.name.toUpperCase();

        // ── 카테고리별 자동 와이어링 ──
        if (desc.category === 'solid2d' && !desc.computeStiffness) {
            _autoWireSolid2D(desc);
        }
        if (desc.category === 'bar1d' && !desc.computeStiffness) {
            _autoWireBar1D(desc);
        }
        if (desc.category === 'beam2d_tim' && !desc.computeStiffness) {
            _autoWireTimBeam2D(desc);
        }

        if (!desc.computeStiffness) {
            throw new Error(
                `Element '${name}': computeStiffness() 가 필요합니다 ` +
                `(또는 category + 형상함수를 제공하세요)`
            );
        }

        // ── 정적 축소 래핑 (condense 필드가 있을 때) ──
        if (desc.condense && desc.condense.length > 0) {
            _applyCondensation(desc);
        }

        _registry.set(name, desc);
        const condensedInfo = desc.nNodesFull
            ? `, 축소: ${desc.nNodesFull}→${desc.nNodes}절점`
            : '';
        console.log(
            `[FepsElementRegistry] ✓ 등록: ${name}  ` +
            `(${desc.category || 'custom'}, ${desc.nNodes}절점${condensedInfo})`
        );
        return desc;
    }

    function has(name)   { return _registry.has(name.toUpperCase()); }
    function get(name)   { return _registry.get(name.toUpperCase()); }
    function types()     { return [..._registry.keys()]; }
    function nNodes(n)     { const d = get(n); return d ? d.nNodes : 0; }
    function nNodesFull(n) { const d = get(n); return d ? (d.nNodesFull || d.nNodes) : 0; }

    // ── 자동 와이어링 헬퍼 ────────────────────────────────────────────

    function _autoWireSolid2D(desc) {
        if (!desc.shapeN || !desc.shapeDN) {
            throw new Error(
                `solid2d 요소 '${desc.name}': shapeN() 과 shapeDN() 이 필요합니다`
            );
        }
        const isTri       = !!desc.triangular;
        const stifFn      = isTri ? FepsElementCore.isoStiffnessTri      : FepsElementCore.isoStiffness2D;
        const sriStifFn   = isTri ? FepsElementCore.isoStiffnessSRI_Tri  : FepsElementCore.isoStiffnessSRI2D;
        const bodyForceFn = isTri ? FepsElementCore.isoBodyForceTri      : FepsElementCore.isoBodyForce2D;
        const gOrd        = desc.gaussOrder || 3;

        // 강성행렬 자동 생성
        desc.computeStiffness = function(mat, prop, xn, yn /*, zn, eload */) {
            const D = (desc.constitModel === 'planeStrain')
                ? FepsElementCore.planeStrainD(mat.E, mat.nu)
                : FepsElementCore.planeStressD(mat.E, mat.nu);

            // ── SRI (Selective Reduced Integration) — 전단잠김 방지 ─────────
            if (desc.sri) {
                const alpha = (desc.sriAlpha != null) ? desc.sriAlpha : 1.0;
                const beta  = (desc.sriBeta  != null) ? desc.sriBeta  : 1.0;
                // 축소 적분 차수 기본값: 사각형 → nGauss−1(최소 1), 삼각형 → nGauss≥6?3:1
                const gRed  = (desc.gaussOrderReduced != null)
                    ? desc.gaussOrderReduced
                    : (isTri ? (gOrd >= 6 ? 3 : 1) : Math.max(1, gOrd - 1));
                return sriStifFn(
                    desc.shapeN.bind(desc), desc.shapeDN.bind(desc),
                    desc.nNodes, gOrd, xn, yn, prop.t || 0,
                    desc.constitModel || 'planeStress', mat.E, mat.nu,
                    alpha, beta, gRed
                );
            }

            return stifFn(
                desc.shapeN.bind(desc), desc.shapeDN.bind(desc),
                desc.nNodes, gOrd, D, xn, yn, prop.t || 0
            );
        };

        // 체적력 자동 생성
        if (!desc.computeBodyForce) {
            desc.computeBodyForce = function(mat, prop, xn, yn, zn, gravity) {
                if (!(mat.rho > 0)) return null;
                const gx = gravity.gx || 0, gy = gravity.gy || 0;
                return bodyForceFn(
                    desc.shapeN.bind(desc), desc.shapeDN.bind(desc),
                    desc.nNodes, gOrd, xn, yn, prop.t || 0, mat.rho, gx, gy
                );
            };
        }

        // 응력 자동 생성 (centroid)
        if (!desc.computeStress) {
            desc.computeStress = function(mat, prop, xn, yn, ue) {
                const D = (desc.constitModel === 'planeStrain')
                    ? FepsElementCore.planeStrainD(mat.E, mat.nu)
                    : FepsElementCore.planeStressD(mat.E, mat.nu);
                const xi0  = isTri ? 1/3 : 0;
                const eta0 = isTri ? 1/3 : 0;
                return FepsElementCore.isoStress2D_atPt(
                    desc.shapeDN.bind(desc), desc.nNodes, xi0, eta0, xn, yn, ue, D
                );
            };
        }
    }

    function _autoWireBar1D(desc) {
        if (!desc.shapeN1D || !desc.shapeDN1D) {
            throw new Error(
                `bar1d 요소 '${desc.name}': shapeN1D() 과 shapeDN1D() 이 필요합니다`
            );
        }
        const gOrd = desc.gaussOrder || 3;
        desc.computeStiffness = function(mat, prop, xn, yn /*, zn, eload */) {
            const EA = mat.E * prop.A;
            return FepsElementCore.bar1D_Stif(
                desc.shapeN1D.bind(desc), desc.shapeDN1D.bind(desc),
                desc.nNodes, gOrd, EA, xn, yn
            );
        };
    }

    function _autoWireTimBeam2D(desc) {
        const kappa = (desc.kappa != null) ? desc.kappa : 5 / 6;
        if (desc.nNodes === 2) {
            desc.computeStiffness = function(mat, prop, xn, yn) {
                return FepsElementCore.timoshenko2N_stif(mat, { ...prop, kappa }, xn, yn);
            };
        } else if (desc.nNodes === 3) {
            desc.computeStiffness = function(mat, prop, xn, yn) {
                return FepsElementCore.timoshenko3N_stif(mat, { ...prop, kappa }, xn, yn);
            };
        } else {
            throw new Error(`beam2d_tim 요소 '${desc.name}': nNodes 는 2 또는 3 이어야 합니다`);
        }
    }

    // ── 정적 축소 (Static Condensation) 래핑 ─────────────────────────────

    /**
     * 외부 좌표 → 전체 좌표 복원.
     * 내부 노드 좌표: internalNodeCoords() 가 있으면 사용, 없으면 코너 평균.
     */
    function _reconstructFullCoords(desc, xnExt, ynExt) {
        const { nNodesFull, extNodeIndices, condenseNodes } = desc._condensation;
        const fullXn = new Array(nNodesFull);
        const fullYn = new Array(nNodesFull);

        // 외부 좌표 배치
        for (let i = 0; i < extNodeIndices.length; i++) {
            fullXn[extNodeIndices[i]] = xnExt[i];
            fullYn[extNodeIndices[i]] = ynExt[i];
        }

        // 내부 노드 좌표 계산
        if (desc.internalNodeCoords) {
            const coords = desc.internalNodeCoords(xnExt, ynExt);
            for (let i = 0; i < condenseNodes.length; i++) {
                fullXn[condenseNodes[i]] = coords[i].x;
                fullYn[condenseNodes[i]] = coords[i].y;
            }
        } else {
            // 기본값: 코너 절점의 평균 (중심 노드)
            const nCorners = desc.cornerNodes || 4;
            for (const ni of condenseNodes) {
                let cx = 0, cy = 0;
                for (let j = 0; j < nCorners; j++) {
                    cx += fullXn[extNodeIndices[j]];
                    cy += fullYn[extNodeIndices[j]];
                }
                fullXn[ni] = cx / nCorners;
                fullYn[ni] = cy / nCorners;
            }
        }
        return { fullXn, fullYn };
    }

    /**
     * 정적 축소 래핑 적용.
     * condense: [내부 노드 인덱스 배열] (0-based)
     *
     * computeStiffness / computeBodyForce / computeStress 를 래핑하여
     * 내부 DOF 를 자동으로 축소/복원한다.
     */
    function _applyCondensation(desc) {
        const condenseNodes = desc.condense;
        const nNodesFull    = desc.nNodes;
        const dofPerNode    = desc.dofPerNode || 2;

        // 검증
        for (const ni of condenseNodes) {
            if (ni < 0 || ni >= nNodesFull)
                throw new Error(`Element '${desc.name}': condense 인덱스 ${ni} 범위 초과 [0, ${nNodesFull - 1}]`);
        }
        if (condenseNodes.length >= nNodesFull)
            throw new Error(`Element '${desc.name}': 모든 절점을 축소할 수 없습니다`);

        // 외부/내부 노드 분리
        const intNodeSet = new Set(condenseNodes);
        const extNodeIndices = [];
        for (let i = 0; i < nNodesFull; i++) {
            if (!intNodeSet.has(i)) extNodeIndices.push(i);
        }

        // 내부 DOF 인덱스 계산
        const internalDofs = [];
        for (const ni of condenseNodes) {
            for (let d = 0; d < dofPerNode; d++) {
                internalDofs.push(ni * dofPerNode + d);
            }
        }

        // 축소 메타데이터 저장
        desc._condensation = {
            nNodesFull, extNodeIndices, condenseNodes, internalDofs, dofPerNode
        };
        desc.nNodesFull = nNodesFull;
        desc.nNodes     = extNodeIndices.length;

        // ── computeStiffness 래핑 ──
        const origStiffness = desc.computeStiffness;
        desc.computeStiffness = function(mat, prop, xn, yn, zn, eload) {
            const { fullXn, fullYn } = _reconstructFullCoords(desc, xn, yn);
            // desc.nNodes 를 원래 값으로 임시 복원 (자동 생성 클로저가 사용)
            const saved = desc.nNodes;
            desc.nNodes = nNodesFull;
            const fullResult = origStiffness.call(desc, mat, prop, fullXn, fullYn, zn, eload);
            desc.nNodes = saved;

            // 정적 축소 적용
            const condensed = FepsElementCore.staticCondense(
                fullResult.esm, fullResult.force, internalDofs
            );
            // 복원 데이터 + 전체 좌표 첨부
            condensed._recovery   = condensed.recovery;
            condensed._fullCoords = { xn: fullXn, yn: fullYn };
            return condensed;
        };

        // ── computeBodyForce 래핑 ──
        if (desc.computeBodyForce) {
            const origBodyForce = desc.computeBodyForce;
            desc.computeBodyForce = function(mat, prop, xn, yn, zn, gravity) {
                const { fullXn, fullYn } = _reconstructFullCoords(desc, xn, yn);
                const saved = desc.nNodes;
                desc.nNodes = nNodesFull;
                const fullForce = origBodyForce.call(desc, mat, prop, fullXn, fullYn, zn, gravity);
                desc.nNodes = saved;
                if (!fullForce) return null;

                // 축소 보정: f*_body = f_e − K_ei · K_ii⁻¹ · f_i
                // K 를 재계산하여 보정항 산출
                desc.nNodes = nNodesFull;
                const fullK = origStiffness.call(desc, mat, prop, fullXn, fullYn, zn).esm;
                desc.nNodes = saved;

                const extDofs = [];
                for (const ni of extNodeIndices) {
                    for (let d = 0; d < dofPerNode; d++) extDofs.push(ni * dofPerNode + d);
                }
                const Kei = FepsElementCore.subMatrix(fullK, extDofs, internalDofs);
                const Kii = FepsElementCore.subMatrix(fullK, internalDofs, internalDofs);
                const fi_body = FepsElementCore.subVector(fullForce, internalDofs);
                const fe_body = FepsElementCore.subVector(fullForce, extDofs);

                const Kii_inv_fi = FepsElementCore.solveSmall(Kii, fi_body);
                const correction = FepsElementCore.matVecMul(Kei, Kii_inv_fi);

                const condensedForce = FepsElementCore.vec(fe_body.length);
                for (let i = 0; i < fe_body.length; i++) {
                    condensedForce[i] = fe_body[i] - correction[i];
                }
                return condensedForce;
            };
        }

        // ── computeStress 래핑 ──
        if (desc.computeStress) {
            const origStress = desc.computeStress;
            desc.computeStress = function(mat, prop, xn, yn, ue) {
                const { fullXn, fullYn } = _reconstructFullCoords(desc, xn, yn);

                // 전체 K 재계산 → 축소 → 내부 변위 복원
                const saved = desc.nNodes;
                desc.nNodes = nNodesFull;
                const fullResult = origStiffness.call(desc, mat, prop, fullXn, fullYn);
                desc.nNodes = saved;

                const condensed = FepsElementCore.staticCondense(
                    fullResult.esm, fullResult.force, internalDofs
                );
                const ueFull = FepsElementCore.recoverInternalDofs(
                    condensed.recovery, new Float64Array(ue)
                );

                // 전체 좌표 + 전체 변위로 원본 응력 계산
                desc.nNodes = nNodesFull;
                const result = origStress.call(desc, mat, prop, fullXn, fullYn, Array.from(ueFull));
                desc.nNodes = saved;
                return result;
            };
        }
    }

    return { register, has, get, types, nNodes, nNodesFull };

})();
