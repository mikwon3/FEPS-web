/**
 * help-ui.js — FEPS 사용자 설명서 뷰어 (v2)
 *
 * Help 버튼 클릭 시 help.html 을 새 창으로 엽니다.
 * 실제 렌더링 로직은 help.html 내부 <script>에 있습니다.
 *
 * ※ index.html 의 인라인 스크립트에서도 동일하게 처리하므로
 *    이 파일은 예비용입니다.
 */

(function () {
    'use strict';
    const btn = document.getElementById('btn-help');
    if (!btn) return;

    btn.addEventListener('click', function () {
        window.open(
            'help.html',
            'feps-help',
            'width=1200,height=820,menubar=no,toolbar=no,' +
            'location=no,status=no,resizable=yes,scrollbars=yes'
        );
    });
})();
