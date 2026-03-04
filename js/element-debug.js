/* ========================================================================
   element-debug.js  —  FEA 디버그 데이터 수집기
   ========================================================================
   FepsDebug 는 Solver.solve() 와 연동하여 다음 데이터를 수집합니다:
     • 각 요소의 강성행렬 K_e (element stiffness matrix)
     • 요소 자유도 테이블 EFT (element freedom table)
     • 조합된 전체 강성행렬 K (global stiffness, nDOF ≤ 200 인 경우)
     • 외력 벡터 F, 변위 벡터 U
     • 요소 절점변위 u_e, 요소 절점력 f_e = K_e × u_e

   사용법:
     FepsDebug.enable();   // 디버그 모드 활성화 (다음 Solve 에 적용)
     FepsDebug.disable();  // 비활성화
     FepsDebug.getData();  // 수집 데이터 조회
   ======================================================================== */

const FepsDebug = (() => {

    let _enabled = false;
    let _data    = null;

    // ── 내부 초기화 ──────────────────────────────────────────────────────

    function _reset() {
        _data = {
            elements : {},      // eid → { typ, nodes, eft, Ke, ue, fe }
            K_global : null,    // nd × nd (nDOF ≤ 200 일 때만 저장)
            F_global : null,    // nd × 1  하중 벡터
            nd       : 0,       // 총 자유도 수
            nf       : 0,       // 자유 자유도 수
            nc       : 0        // 구속 자유도 수
        };
    }

    // ── 공개 API ─────────────────────────────────────────────────────────

    function enable()    { _enabled = true;  _reset(); }
    function disable()   { _enabled = false; }
    function isEnabled() { return _enabled;  }
    function getData()   { return _data;     }

    /**
     * 요소 강성행렬 및 EFT 저장 (assembly 루프 내에서 요소마다 호출)
     * @param {number}     eid   요소 ID
     * @param {string}     typ   요소 유형 문자열
     * @param {number[]}   eft   element freedom table (전역 자유도 인덱스 배열)
     * @param {number[][]} Ke    요소 강성행렬 (n × n)
     * @param {number[]}   nodes 요소 절점 ID 배열
     */
    function storeElem(eid, typ, eft, Ke, nodes) {
        if (!_enabled || !_data) return;
        // Ke 는 solver 에서 직접 사용 중이므로 deep-copy
        const KeCopy = Ke.map(row => (row instanceof Float64Array
            ? Array.from(row)
            : [...row]));
        _data.elements[eid] = {
            typ,
            nodes : [...nodes],
            eft   : [...eft],
            Ke    : KeCopy,
            ue    : null,   // storeResult() 에서 채워짐
            fe    : null
        };
    }

    /**
     * 전체 강성행렬 저장 (assembly 완료, luSolve 직전에 호출)
     * @param {number[][]} K   전체 강성행렬 (nd × nd)
     * @param {number[]}   F   하중 벡터
     * @param {number}     nd  총 자유도 수
     * @param {number}     nf  자유 자유도 수
     * @param {number}     nc  구속 자유도 수
     */
    function storeGlobal(K, F, nd, nf, nc) {
        if (!_enabled || !_data) return;
        _data.nd = nd;
        _data.nf = nf;
        _data.nc = nc;
        _data.F_global = [...F];
        // K 가 너무 크면 메모리/성능 문제 → 200 이하만 저장
        if (nd <= 200) {
            _data.K_global = K.map(row => [...row]);
        } else {
            _data.K_global = null;
        }
    }

    /**
     * 해석 결과 저장 + 요소 절점변위·절점력 계산 (solve() 리턴 직전에 호출)
     * @param {Object} nodeDisp  { nid: [u, v, θ, ...] }
     * @param {number} nDofPerNode  절점당 자유도 수 (dofNod)
     */
    function storeResult(nodeDisp, nDofPerNode) {
        if (!_enabled || !_data) return;

        const dpn = nDofPerNode || 2; // fallback

        for (const [eidStr, el] of Object.entries(_data.elements)) {
            const { nodes, Ke } = el;
            const n = Ke.length;

            // ue : 전역 변위 벡터에서 요소 절점 변위 추출
            const ue = [];
            for (const nid of nodes) {
                const u = nodeDisp[nid] || [];
                // 실제 dofPerNode 는 Ke.length / nodes.length
                const dpnElem = Math.round(n / nodes.length);
                for (let d = 0; d < dpnElem; d++) ue.push(u[d] || 0);
            }
            el.ue = ue;

            // fe = Ke × ue  (요소 절점력)
            const fe = new Array(n).fill(0);
            for (let i = 0; i < n; i++)
                for (let j = 0; j < n; j++)
                    fe[i] += (Ke[i][j] || 0) * (ue[j] || 0);
            el.fe = fe;
        }
    }

    return {
        enable, disable, isEnabled, getData,
        storeElem, storeGlobal, storeResult
    };

})();
