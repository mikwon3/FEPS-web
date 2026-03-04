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

        _registry.set(name, desc);
        console.log(
            `[FepsElementRegistry] ✓ 등록: ${name}  ` +
            `(${desc.category || 'custom'}, ${desc.nNodes}절점)`
        );
        return desc;
    }

    function has(name)   { return _registry.has(name.toUpperCase()); }
    function get(name)   { return _registry.get(name.toUpperCase()); }
    function types()     { return [..._registry.keys()]; }
    function nNodes(n)   { const d = get(n); return d ? d.nNodes : 0; }

    // ── 자동 와이어링 헬퍼 ────────────────────────────────────────────

    function _autoWireSolid2D(desc) {
        if (!desc.shapeN || !desc.shapeDN) {
            throw new Error(
                `solid2d 요소 '${desc.name}': shapeN() 과 shapeDN() 이 필요합니다`
            );
        }
        const isTri     = !!desc.triangular;
        const stifFn    = isTri ? FepsElementCore.isoStiffnessTri   : FepsElementCore.isoStiffness2D;
        const bodyForceFn = isTri ? FepsElementCore.isoBodyForceTri : FepsElementCore.isoBodyForce2D;
        const gOrd      = desc.gaussOrder || 3;

        // 강성행렬 자동 생성
        desc.computeStiffness = function(mat, prop, xn, yn /*, zn, eload */) {
            const D = (desc.constitModel === 'planeStrain')
                ? FepsElementCore.planeStrainD(mat.E, mat.nu)
                : FepsElementCore.planeStressD(mat.E, mat.nu);
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

    return { register, has, get, types, nNodes };

})();
