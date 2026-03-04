/* ========================================================================
   element-debug-ui.js  —  FEA 디버그 뷰어 UI
   ========================================================================
   [🔍 디버그] 버튼 → 디버그 모드 토글
   해석 완료(feps:solved 이벤트) 후 디버그 모달 자동 오픈

   탭 구성:
     [요약]      — nDOF / nFree / nConst / 요소 수 등
     [K_e]       — 선택된 요소의 강성행렬 (n × n 표)
     [u_e]       — 요소 절점변위 벡터
     [f_e]       — 요소 절점력  f_e = K_e × u_e
     [전체 K]    — 조합된 전역 강성행렬 (nDOF ≤ 200 일 때)
   ======================================================================== */

(function () {

    // ── DOM 참조 ─────────────────────────────────────────────────────────

    const btnDebug    = document.getElementById('btn-debug');
    const overlay     = document.getElementById('modal-debug-overlay');
    const btnClose    = document.getElementById('dbg-close');
    const selElem     = document.getElementById('dbg-elem-select');
    const spanStatus  = document.getElementById('dbg-status');

    // Tab buttons & panes
    const tabBtns = overlay ? overlay.querySelectorAll('.dbg-tab-btn') : [];
    const panesMap = {
        summary : document.getElementById('dbg-pane-summary'),
        ke      : document.getElementById('dbg-pane-ke'),
        ue      : document.getElementById('dbg-pane-ue'),
        fe      : document.getElementById('dbg-pane-fe'),
        kglob   : document.getElementById('dbg-pane-kglob'),
    };

    // ── 디버그 모드 토글 ─────────────────────────────────────────────────

    let _active = false;

    if (btnDebug) {
        btnDebug.addEventListener('click', () => {
            _active = !_active;
            _setDebugActive(_active);
        });
    }

    function _setDebugActive(on) {
        _active = on;
        if (btnDebug) {
            btnDebug.classList.toggle('accent', on);
            btnDebug.title = on
                ? '디버그 모드 ON — 해석 실행 후 행렬 뷰어가 열립니다'
                : '디버그 모드 활성화';
        }
        if (typeof FepsDebug !== 'undefined') {
            if (on) FepsDebug.enable();
            else    FepsDebug.disable();
        }
        if (spanStatus) spanStatus.textContent = on ? 'ON' : '';
    }

    // ── feps:solved 이벤트 → 뷰어 자동 오픈 ────────────────────────────

    window.addEventListener('feps:solved', () => {
        if (_active) _openViewer();
    });

    // ── 뷰어 열기 / 닫기 ────────────────────────────────────────────────

    function _openViewer() {
        const data = (typeof FepsDebug !== 'undefined') ? FepsDebug.getData() : null;
        if (!data) return;
        _populateElemSelect(data);
        _renderSummary(data);
        _renderKGlobal(data);
        _switchTab('summary');
        if (overlay) overlay.classList.remove('hidden');
    }

    if (btnClose) btnClose.addEventListener('click', () => {
        if (overlay) overlay.classList.add('hidden');
    });

    if (overlay) overlay.addEventListener('mousedown', e => {
        if (e.target === overlay) overlay.classList.add('hidden');
    });

    document.addEventListener('keydown', e => {
        if (e.key === 'Escape' && overlay && !overlay.classList.contains('hidden'))
            overlay.classList.add('hidden');
    });

    // 뷰어 열기 버튼 (분석 후 수동으로도 열 수 있음)
    const btnOpenViewer = document.getElementById('btn-debug-viewer');
    if (btnOpenViewer) btnOpenViewer.addEventListener('click', _openViewer);

    // ── 탭 전환 ──────────────────────────────────────────────────────────

    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => _switchTab(btn.dataset.tab));
    });

    function _switchTab(tabId) {
        tabBtns.forEach(b => b.classList.toggle('active', b.dataset.tab === tabId));
        Object.entries(panesMap).forEach(([id, el]) => {
            if (el) el.classList.toggle('hidden', id !== tabId);
        });
    }

    // ── 요소 선택 목록 채우기 ────────────────────────────────────────────

    function _populateElemSelect(data) {
        if (!selElem) return;
        selElem.innerHTML = '<option value="">— 요소 선택 —</option>';
        for (const [eid, el] of Object.entries(data.elements)) {
            const opt = document.createElement('option');
            opt.value = eid;
            opt.textContent = `E${eid} · ${el.typ} · ${el.nodes.length}절점 (${el.Ke.length}DOF)`;
            selElem.appendChild(opt);
        }
    }

    if (selElem) selElem.addEventListener('change', () => {
        const data = (typeof FepsDebug !== 'undefined') ? FepsDebug.getData() : null;
        if (!data || !selElem.value) return;
        const el = data.elements[selElem.value];
        if (!el) return;
        _renderKe(el);
        _renderUe(el);
        _renderFe(el);
    });

    // ── 탭별 렌더러 ──────────────────────────────────────────────────────

    /** 요약 탭 */
    function _renderSummary(data) {
        const p = panesMap.summary;
        if (!p) return;
        const nElem = Object.keys(data.elements).length;
        const types = [...new Set(Object.values(data.elements).map(e => e.typ))].join(', ');
        p.innerHTML = `
            <h4 class="dbg-section-title">모델 자유도 정보</h4>
            <table class="dbg-info-table">
                <tr><th>총 자유도 (nDOF)</th><td>${data.nd}</td></tr>
                <tr><th>자유 자유도 (nFree)</th><td>${data.nf}</td></tr>
                <tr><th>구속 자유도 (nConst)</th><td>${data.nc}</td></tr>
                <tr><th>요소 수</th><td>${nElem}</td></tr>
                <tr><th>요소 유형</th><td>${types || '—'}</td></tr>
                <tr><th>전체 K 저장 여부</th><td>${
                    data.K_global
                        ? `✅ ${data.nd}×${data.nd} 행렬 저장됨`
                        : `⚠️ nDOF=${data.nd} > 200 — 저장 생략 (소규모 모델에서 확인)`
                }</td></tr>
            </table>
            <p class="dbg-hint" style="margin-top:10px">
                ← 좌측에서 요소를 선택하면 K_e · u_e · f_e 탭에서 행렬을 확인할 수 있습니다.
            </p>`;
    }

    /** K_e 탭 */
    function _renderKe(el) {
        const p = panesMap.ke;
        if (!p) return;
        const label = `K_e — ${el.typ} (요소 E${el.nodes[0]}…, ${el.Ke.length}×${el.Ke.length})`;
        _renderMatrix(p, el.Ke, label, el.eft);
        _switchTab('ke');
    }

    /** u_e 탭 */
    function _renderUe(el) {
        const p = panesMap.ue;
        if (!p) return;
        const dpn = el.Ke.length / el.nodes.length;
        _renderVector(p, el.ue, `u_e — 요소 절점변위 (${el.Ke.length}개 자유도)`, el.eft, dpn, el.nodes);
    }

    /** f_e 탭 */
    function _renderFe(el) {
        const p = panesMap.fe;
        if (!p) return;
        const dpn = el.Ke.length / el.nodes.length;
        _renderVector(p, el.fe, `f_e = K_e × u_e — 요소 절점력 (평형 검증용)`, el.eft, dpn, el.nodes);
    }

    /** 전체 K 탭 */
    function _renderKGlobal(data) {
        const p = panesMap.kglob;
        if (!p) return;
        if (data.K_global) {
            _renderMatrix(p, data.K_global,
                `전체 강성행렬 K (${data.nd}×${data.nd})  — BC 적용 전`);
        } else {
            p.innerHTML = `<p class="dbg-warn">
                ⚠️ nDOF = ${data.nd}  >  200 이므로 전체 K는 저장되지 않았습니다.<br>
                소규모 테스트 모델 (nDOF ≤ 200)에서 확인하세요.
            </p>`;
        }
    }

    // ── 공통 렌더 유틸리티 ───────────────────────────────────────────────

    /**
     * 행렬을 스크롤 가능한 HTML 테이블로 렌더링
     * @param {HTMLElement} container
     * @param {number[][]}  M       행렬 데이터
     * @param {string}      title
     * @param {number[]}    [eft]   행/열 헤더에 표시할 전역 자유도 번호
     */
    function _renderMatrix(container, M, title, eft) {
        if (!container || !M || !M.length) return;
        const n = M.length;

        let html = `<div class="dbg-section-title">${_esc(title)}</div>`;
        if (eft) {
            html += `<div class="dbg-eft-label">EFT (전역 자유도 번호): [${eft.join(', ')}]</div>`;
        }
        html += '<div class="dbg-mat-wrap"><table class="dbg-mat">';

        // 헤더 행 (열 번호)
        html += '<thead><tr><th class="dbg-idx">i\\j</th>';
        for (let j = 0; j < n; j++)
            html += `<th class="dbg-idx">${eft ? eft[j] : j}</th>`;
        html += '</tr></thead><tbody>';

        // 데이터 행
        for (let i = 0; i < n; i++) {
            html += `<tr><th class="dbg-idx">${eft ? eft[i] : i}</th>`;
            for (let j = 0; j < n; j++) {
                const v = M[i] ? M[i][j] : 0;
                const isDiag = (i === j);
                const isZero = Math.abs(v) < 1e-14;
                const cls = isZero ? 'dbg-zero' : isDiag ? 'dbg-diag' : '';
                html += `<td class="${cls}">${_fmt(v)}</td>`;
            }
            html += '</tr>';
        }

        html += '</tbody></table></div>';
        container.innerHTML = html;
    }

    /**
     * 벡터를 표로 렌더링 (DOF 번호 / 절점 / 방향 / 값)
     */
    function _renderVector(container, vec, title, eft, dpn, nodes) {
        if (!container || !vec) return;
        const dofNames = ['u (Δx)', 'v (Δy)', 'θ (rot)', 'w (Δz)', 'θy', 'θz'];
        let html = `<div class="dbg-section-title">${_esc(title)}</div>`;
        html += '<table class="dbg-info-table">';
        html += '<tr><th>로컬 DOF</th><th>전역 DOF</th><th>절점 ID</th><th>방향</th><th>값</th></tr>';
        const dof = dpn || Math.round(vec.length / (nodes ? nodes.length : 1));
        for (let i = 0; i < vec.length; i++) {
            const nodeIdx = nodes ? nodes[Math.floor(i / dof)] : '—';
            const dir = dofNames[i % dof] || `d${i % dof}`;
            const v = vec[i];
            const isZero = Math.abs(v) < 1e-14;
            html += `<tr>
                <td>${i}</td>
                <td>${eft ? eft[i] : '—'}</td>
                <td>${nodeIdx}</td>
                <td>${_esc(dir)}</td>
                <td class="${isZero ? 'dbg-zero' : ''}">${_fmt(v)}</td>
            </tr>`;
        }
        html += '</table>';
        container.innerHTML = html;
    }

    /** 수치 포맷: 과학적 표기 또는 유효숫자 5자리 */
    function _fmt(v) {
        if (v === undefined || v === null || isNaN(v)) return '—';
        if (Math.abs(v) < 1e-14) return '<span class="dbg-zero">0</span>';
        const a = Math.abs(v);
        if (a >= 1e6 || a < 1e-3) return v.toExponential(4);
        return parseFloat(v.toPrecision(6)).toString();
    }

    function _esc(s) {
        return String(s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }

    // ── 공개 API ─────────────────────────────────────────────────────────

    window.FepsDebugUI = {
        open   : _openViewer,
        setActive : _setDebugActive
    };

})();
