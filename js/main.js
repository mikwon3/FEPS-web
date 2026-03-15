/* ========================================================================
   main.js  –  FEPS application controller
   Wires up all UI elements, manages model state, handles events.
   ======================================================================== */

(() => {
    'use strict';

    // ── State ─────────────────────────────────────────────────────────────
    let model = FepsParser.createEmpty(2, 2);
    let results = null;
    let nextNodeId = 1;
    let nextEleId = 1;
    let nextMatId = 1;
    let nextProId = 1;
    let editingMatId = null;   // non-null when user clicked ✎ to edit an existing material
    let editingProId = null;   // non-null when user clicked ✎ to edit an existing property
    let drawMode = false;
    let drawNodeQueue = [];
    let polygonNodeList = [];  // ALL unique nodes clicked during draw session (for polygon meshing)
    let selectionMode = null;      // null | 'elements' | 'nodes'
    let undoStack = [];
    let dragStart = null;          // { sx, sy } screen coords of mousedown
    let isDragging = false;
    let justDragged = false;       // true for one click cycle after a box-drag completes
    let createNodeMode = false;    // toggle for node placement on click

    // Pan state
    let isPanning = false;
    let panLast = null;            // { sx, sy }

    // 3D rotate state
    // Ctrl+drag  → orbit  (horizontal = azimuth, vertical = elevation)
    // Alt+drag   → twist  (horizontal = elevation, vertical = azimuth)
    let isRotating = false;   // Ctrl+drag orbit
    let isRotatingAlt = false;   // Alt+drag  twist
    let rotateLast = null;    // { sx, sy } shared by both modes

    // Zoom-window state
    let zoomWindowMode = false;
    let zoomWindowStart = null;    // { sx, sy }
    let zoomWindowDragging = false;

    // Closed polygon points (model coords) for meshing
    let closedPolygon = null;      // array of {x,y}  — outer boundary
    let holePolygons = [];         // array of {x,y}[] — interior holes
    let drawingHole = false;       // true when drawing a hole polygon
    let holeDrawType = 'polygon';  // 'polygon' | 'rectangle' | 'circle'
    let holeDrawDragStart = null;  // { sx, sy, mx, my } — for rect/circle drag
    let holeDrawDragging = false;
    let holePreviewPts = null;     // polygon preview while dragging rect/circle hole

    // ── DOM refs ──────────────────────────────────────────────────────────
    const $ = id => document.getElementById(id);
    const canvas = $('feps-canvas');

    // ── Init ──────────────────────────────────────────────────────────────
    document.addEventListener('DOMContentLoaded', () => {
        FepsRenderer.init(canvas);
        FepsRenderer.setModel(model);
        FepsRenderer.setOpts(getPreOpts());
        FepsRenderer.draw();

        // Tab switching
        document.querySelectorAll('.tab').forEach(tab => {
            tab.addEventListener('click', () => {
                document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                const which = tab.dataset.tab;
                $('panel-pre').classList.toggle('active', which === 'pre');
                $('panel-post').classList.toggle('active', which === 'post');
                // Cancel draw mode when switching tabs so it doesn't bleed into post-process
                if (drawMode) endDrawMode();
                updateOpts(); FepsRenderer.draw();
            });
        });

        // Toolbar
        $('btn-new').addEventListener('click', handleNew);
        $('btn-open').addEventListener('click', () => $('file-input').click());
        $('file-input').addEventListener('change', handleFileOpen);
        $('btn-saveas').addEventListener('click', handleSaveAs);
        $('btn-export').addEventListener('click', handleExport);
        $('btn-run').addEventListener('click', handleRun);
        $('btn-undo').addEventListener('click', performUndo);
        $('btn-delete').addEventListener('click', performDelete);

        // Pre-process panel
        $('btn-add-mat').addEventListener('click', addMaterial);
        $('btn-add-prop').addEventListener('click', addProperty);

        // Draw-mode buttons
        $('btn-create-node').addEventListener('click', toggleCreateNodeMode);
        $('btn-draw-start').addEventListener('click', startDrawMode);
        $('btn-draw-end').addEventListener('click', endDrawMode);
        $('btn-mesh-poly').addEventListener('click', meshPolygon);
        $('btn-add-hole').addEventListener('click', startHoleDrawMode);

        // Unified element type selector — refresh status hint + auto-toggle Close Path
        $('ele-type').addEventListener('change', () => {
            if (drawMode) updateDrawStatus();
            const is1D = ['BAR2', 'BEAM2D', 'BAR3D', 'BEAM3D'].includes($('ele-type').value);
            $('chk-close-path').checked = !is1D;
            FepsRenderer.setClosePolygon(!is1D);
            if (drawMode) FepsRenderer.draw();
        });

        // Close Path checkbox — sync to renderer immediately
        $('chk-close-path').addEventListener('change', () => {
            FepsRenderer.setClosePolygon($('chk-close-path').checked);
            FepsRenderer.draw();
        });

        // Selection buttons
        $('btn-sel-ele').addEventListener('click', () => toggleSelMode('elements'));
        $('btn-sel-nod').addEventListener('click', () => toggleSelMode('nodes'));
        $('btn-clear-sel').addEventListener('click', clearSel);
        $('btn-assign-mat').addEventListener('click', openMatPropDialog);
        $('btn-assign-bc').addEventListener('click', openBCLoadDialog);

        // Modal buttons
        $('dlg-mp-ok').addEventListener('click', applyMatProp);
        $('dlg-mp-cancel').addEventListener('click', closeModal);
        $('dlg-bc-ok').addEventListener('click', applyBCLoad);
        $('dlg-bc-cancel').addEventListener('click', closeModal);
        $('modal-overlay').addEventListener('click', e => { if (e.target === $('modal-overlay')) closeModal(); });

        // Output modal & HTML report
        $('btn-open-output').addEventListener('click', openOutputModal);
        $('btn-report').addEventListener('click', openReport);
        $('btn-output-copy').addEventListener('click', () => {
            navigator.clipboard.writeText($('output-text').textContent).then(() => setStatus('Output copied to clipboard.'));
        });
        $('btn-output-download').addEventListener('click', () => {
            const blob = new Blob([$('output-text').textContent], { type: 'text/plain' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = 'feps_output.txt';
            a.click();
            URL.revokeObjectURL(a.href);
        });
        $('btn-output-close').addEventListener('click', closeModal);

        // Node editor popup (coords + BC + load)
        $('dlg-nc-ok').addEventListener('click', applyNodeCoord);
        $('dlg-nc-cancel').addEventListener('click', closeModal);

        // Element editor popup
        $('dlg-elem-ok').addEventListener('click', applyElemEdit);
        $('dlg-elem-cancel').addEventListener('click', closeModal);

        // Solid element surface load — "Add Face" button
        $('dlg-esurf-add-face').addEventListener('click', () => {
            if (!editingElemId) return;
            const e = model.elements[editingElemId];
            if (!e) return;
            const side = parseInt($('dlg-esurf-side').value, 10) || 1;
            const qx1 = parseFloat($('dlg-esurf-qx1').value) || 0;
            const qy1 = parseFloat($('dlg-esurf-qy1').value) || 0;
            const qx2 = parseFloat($('dlg-esurf-qx2').value) || 0;
            const qy2 = parseFloat($('dlg-esurf-qy2').value) || 0;
            if (!Array.isArray(e.esurf)) e.esurf = [];
            // Replace existing entry for same side, or add
            const existing = e.esurf.findIndex(f => f.side === side);
            const faceData = { side, qx1, qy1, qx2, qy2 };
            if (existing >= 0) e.esurf[existing] = faceData;
            else e.esurf.push(faceData);
            openElemDialog(editingElemId);  // refresh face list
        });

        // Right-click context menu
        canvas.addEventListener('contextmenu', handleContextMenu);

        // Display checkboxes
        ['chk-node-id', 'chk-ele-id', 'chk-bc', 'chk-loads', 'chk-color-mat'].forEach(id => {
            $(id).addEventListener('change', () => { updateOpts(); FepsRenderer.draw(); });
        });

        // Grid snap controls
        $('chk-snap-grid').addEventListener('change', () => { updateOpts(); FepsRenderer.draw(); });
        $('grid-spacing').addEventListener('change', () => { updateOpts(); FepsRenderer.draw(); });
        $('grid-count').addEventListener('change', () => { updateOpts(); FepsRenderer.draw(); });

        // Zoom window button
        $('btn-zoom-window').addEventListener('click', toggleZoomWindowMode);
        // Zoom All button
        $('btn-zoom-all').addEventListener('click', () => FepsRenderer.zoomAll());

        // Post-process controls
        // Deformation scale — slider ↔ number input (bidirectional sync)
        $('scale-slider').addEventListener('input', () => {
            $('scale-input').value = $('scale-slider').value;
            updateOpts(); FepsRenderer.draw();
        });
        $('scale-input').addEventListener('input', () => {
            const v = Math.max(0, +$('scale-input').value || 0);
            // Clamp slider to its own max (1000); input may go beyond that
            $('scale-slider').value = Math.min(v, 1000);
            updateOpts(); FepsRenderer.draw();
        });
        $('scale-input').addEventListener('change', () => {
            // On blur/Enter: re-clamp and normalise display value
            const v = Math.max(0, +$('scale-input').value || 0);
            $('scale-input').value = v;
            $('scale-slider').value = Math.min(v, 1000);
            updateOpts(); FepsRenderer.draw();
        });

        // Diagram scale — slider ↔ number input (bidirectional sync)
        $('diag-slider').addEventListener('input', () => {
            $('diag-input').value = $('diag-slider').value;
            updateOpts(); FepsRenderer.draw();
        });
        $('diag-input').addEventListener('input', () => {
            const v = Math.max(1, +$('diag-input').value || 1);
            $('diag-slider').value = Math.min(v, 500);
            updateOpts(); FepsRenderer.draw();
        });
        $('diag-input').addEventListener('change', () => {
            const v = Math.max(1, +$('diag-input').value || 1);
            $('diag-input').value = v;
            $('diag-slider').value = Math.min(v, 500);
            updateOpts(); FepsRenderer.draw();
        });
        $('chk-deformed').addEventListener('change', () => { updateOpts(); FepsRenderer.draw(); });
        $('chk-ghost').addEventListener('change', () => { updateOpts(); FepsRenderer.draw(); });
        $('result-type').addEventListener('change', () => {
            updateOpts(); FepsRenderer.computeStressRange(); updateColorBar(); FepsRenderer.draw();
        });
        ['chk-reactions', 'chk-applied', 'chk-node-id-post', 'chk-ele-id-post'].forEach(id => {
            $(id).addEventListener('change', () => { updateOpts(); FepsRenderer.draw(); });
        });

        // Canvas interaction
        canvas.addEventListener('mousedown', handleCanvasMouseDown);
        canvas.addEventListener('mousemove', handleCanvasMove);
        canvas.addEventListener('mouseup', handleCanvasMouseUp);
        canvas.addEventListener('click', handleCanvasClick);
        canvas.addEventListener('wheel', handleCanvasWheel, { passive: false });
        canvas.addEventListener('dblclick', () => {
            FepsRenderer.resetView(); FepsRenderer.draw();
            setStatus('View reset');
        });

        // ESC key to exit zoom window mode
        document.addEventListener('keydown', (ev) => {
            if (ev.key === 'Escape' && zoomWindowMode) {
                exitZoomWindowMode();
            }
        });

        setStatus('Ready — open a .inp file or toggle Create Node to place nodes');
    });

    // ── Options ───────────────────────────────────────────────────────────

    function getPreOpts() {
        return {
            showNodeIDs: $('chk-node-id').checked,
            showEleIDs: $('chk-ele-id').checked,
            showBC: $('chk-bc').checked,
            showLoads: $('chk-loads').checked,
            colorByMaterial: $('chk-color-mat').checked,
            showNodeSymbols: true,
            gridSpacing: $('chk-snap-grid').checked ? (parseFloat($('grid-spacing').value) || 1) : 0,
            gridCount: parseInt($('grid-count').value) || 10,
            showDeformed: false, showGhost: false, scaleFactor: 1, resultType: 'none'
        };
    }

    function getPostOpts() {
        return {
            showNodeIDs: $('chk-node-id-post').checked,
            showEleIDs: $('chk-ele-id-post').checked,
            showBC: $('chk-reactions').checked,
            showLoads: $('chk-applied').checked,
            colorByMaterial: false,
            showNodeSymbols: true,
            gridSpacing: $('chk-snap-grid').checked ? (parseFloat($('grid-spacing').value) || 1) : 0,
            gridCount: parseInt($('grid-count').value) || 10,
            showDeformed: $('chk-deformed').checked,
            showGhost: $('chk-ghost').checked,
            scaleFactor: Math.max(0, +$('scale-input').value || 0),
            diagScale: Math.max(1, +$('diag-input').value || 1),
            resultType: $('result-type').value
        };
    }

    function updateOpts() {
        const isPost = $('panel-post').classList.contains('active');
        FepsRenderer.setOpts(isPost ? getPostOpts() : getPreOpts());
    }

    // ══════════════════════════════════════════════════════════════════════
    //  DRAW MODE (polygon / element creation)
    // ══════════════════════════════════════════════════════════════════════

    // Returns true when the selected element type is a 2D solid (mesh) type
    function is2DType() {
        return ['TRIG3', 'TRIG6', 'QUAD4', 'QUAD8'].includes($('ele-type').value);
    }

    // Nodes per element for 1D line-draw mode (unused when is2DType())
    function nodesNeeded() {
        return { BAR2: 2, BEAM2D: 2, BAR3D: 2, BEAM3D: 2, QUAD4: 4, TRIG3: 3, TRIG6: 6, QUAD8: 8 }[$('ele-type').value] || 2;
    }

    function startDrawMode() {
        endSelMode(); closedPolygon = null; holePolygons = []; drawingHole = false;
        FepsRenderer.clearClosedPolygon();
        $('btn-mesh-poly').disabled = true;
        $('btn-add-hole').disabled = true;
        FepsRenderer.setClosePolygon($('chk-close-path').checked);
        drawMode = true; drawNodeQueue = []; polygonNodeList = [];
        FepsRenderer.setDrawMode(true);
        canvas.classList.add('draw-mode');
        $('btn-draw-start').classList.add('active');
        $('btn-draw-start').disabled = true;
        $('btn-draw-end').disabled = false;
        updateDrawStatus(); updateHoleStatus();
        FepsRenderer.draw();
        setStatus('Draw mode — click nodes to define polygon boundary, then End Draw → Mesh Polygon');
    }

    function startHoleDrawMode() {
        if (!closedPolygon) {
            setStatus('⚠ Define outer polygon first (Start Polygon → End Polygon).');
            return;
        }
        holeDrawType = ($('hole-type') && $('hole-type').value) || 'polygon';
        endSelMode(); drawingHole = true;
        holeDrawDragStart = null; holeDrawDragging = false; holePreviewPts = null;

        if (holeDrawType !== 'polygon') {
            // Rect / Circle: simple canvas drag — no drawMode needed
            canvas.classList.add('draw-mode');
            canvas.style.cursor = 'crosshair';
            $('btn-draw-start').disabled = true;
            $('btn-draw-end').disabled = false;
            $('btn-mesh-poly').disabled = true;
            $('btn-add-hole').disabled = true;
            const typeName = holeDrawType === 'rectangle' ? 'Rectangle' : 'Circle';
            setStatus(`${typeName} hole — drag on canvas to define shape. "End Draw" to cancel.`);
            FepsRenderer.draw();
            return;
        }

        // Polygon hole: existing draw-mode flow; force Close Path ON
        $('chk-close-path').checked = true;
        FepsRenderer.setClosePolygon(true);
        drawMode = true; drawNodeQueue = []; polygonNodeList = [];
        FepsRenderer.setDrawMode(true);
        canvas.classList.add('draw-mode');
        $('btn-draw-start').classList.add('active');
        $('btn-draw-start').disabled = true;
        $('btn-draw-end').disabled = false;
        $('btn-mesh-poly').disabled = true;
        $('btn-add-hole').disabled = true;
        updateDrawStatus();
        FepsRenderer.draw();
        setStatus(`Hole mode — click nodes to define interior hole boundary. Click "End Polygon" when done.`);
    }

    function endDrawMode() {
        // If in rect/circle hole drag mode, just cancel it
        if (drawingHole && holeDrawType !== 'polygon') {
            holeDrawDragStart = null; holeDrawDragging = false; holePreviewPts = null;
            FepsRenderer.setHolePreview(null);
            drawingHole = false; holeDrawType = 'polygon';
            canvas.classList.remove('draw-mode');
            canvas.style.cursor = '';
            $('btn-draw-start').disabled = false;
            $('btn-draw-end').disabled = true;
            $('btn-mesh-poly').disabled = !closedPolygon;
            $('btn-add-hole').disabled = !closedPolygon;
            FepsRenderer.draw();
            setStatus('Hole draw cancelled.');
            return;
        }

        const closePath = $('chk-close-path').checked;
        const minNodes = closePath ? 3 : 2;

        // Use polygonNodeList which tracks ALL unique nodes from the draw session
        const polyNodes = polygonNodeList.length >= minNodes ? polygonNodeList : drawNodeQueue;

        if (polyNodes.length >= minNodes) {
            const poly = polyNodes.map(nid => {
                const n = model.nodes[nid];
                return { x: n.x, y: n.y };
            });
            poly._nodeIds = [...polyNodes];
            poly._closed = closePath;

            if (closePath) {
                // ── Closed polygon: verify non-degenerate area ──
                const area = polyArea(poly);
                if (Math.abs(area) < 1e-10) {
                    setStatus('⚠ Polygon has zero area (collinear nodes). Cannot use.');
                } else if (drawingHole) {
                    holePolygons.push(poly);
                    FepsRenderer.addClosedHole([...poly]);       // ← 홀 렌더러에 등록
                    $('btn-mesh-poly').disabled = false;
                    $('btn-add-hole').disabled = false;
                    updateHoleStatus();
                    setStatus(`✓ Hole ${holePolygons.length} added (${polyNodes.length} vertices). Add more holes or click "Mesh Polygon".`);
                } else {
                    closedPolygon = poly;
                    FepsRenderer.setClosedPolygon([...poly]);    // ← 외곽 폴리곤 렌더러에 등록
                    $('btn-mesh-poly').disabled = false;
                    $('btn-add-hole').disabled = false;
                    updateHoleStatus();
                    setStatus(`✓ Outer polygon with ${polyNodes.length} vertices. Add holes with "+ Add Hole" or click "Mesh Polygon".`);
                }
            } else {
                // ── Open polyline: no area check, no holes ──
                closedPolygon = poly;
                FepsRenderer.setClosedPolygon([...poly]);        // ← 오픈 경로도 렌더러에 등록
                $('btn-mesh-poly').disabled = false;
                $('btn-add-hole').disabled = true;
                setStatus(`✓ Open path with ${polyNodes.length} nodes. Click "Mesh Polygon" to create elements.`);
            }
        } else if (polyNodes.length > 0) {
            setStatus(`⚠ Need at least ${minNodes} nodes to form a ${closePath ? 'polygon' : 'path'}.`);
        }
        drawMode = false; drawNodeQueue = []; polygonNodeList = []; drawingHole = false;
        FepsRenderer.setDrawMode(false);
        canvas.classList.remove('draw-mode');
        $('btn-draw-start').classList.remove('active');
        $('btn-draw-start').disabled = false;
        $('btn-draw-end').disabled = true;
        $('draw-status').textContent = '';
        FepsRenderer.draw();
    }

    function updateHoleStatus() {
        const el = $('hole-status');
        if (!el) return;
        if (holePolygons.length === 0) {
            el.textContent = '';
        } else {
            el.textContent = `${holePolygons.length} hole${holePolygons.length > 1 ? 's' : ''} defined`;
        }
    }

    /** Compute signed area of polygon (positive = CCW) */
    function polyArea(pts) {
        let area = 0;
        for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
            area += (pts[j].x + pts[i].x) * (pts[j].y - pts[i].y);
        }
        return area / 2;
    }

    /** Build polygon pts for a rectangle or circle hole from drag endpoints (model coords) */
    function computeHoleShapePts(x0, y0, x1, y1) {
        if (holeDrawType === 'rectangle') {
            return [
                { x: x0, y: y0 },
                { x: x1, y: y0 },
                { x: x1, y: y1 },
                { x: x0, y: y1 }
            ];
        } else { // circle: (x0,y0) = center, radius = dist to (x1,y1)
            const r = Math.sqrt((x1 - x0) ** 2 + (y1 - y0) ** 2);
            if (r < 1e-10) return [];
            const N = 32;
            const pts = [];
            for (let i = 0; i < N; i++) {
                const a = (2 * Math.PI * i) / N;
                pts.push({ x: x0 + r * Math.cos(a), y: y0 + r * Math.sin(a) });
            }
            return pts;
        }
    }

    function updateDrawStatus() {
        const n = polygonNodeList.length;
        const closing = $('chk-close-path').checked;
        const hint = closing ? 'polygon boundary' : 'open path';
        $('draw-status').textContent = n === 0
            ? `Click nodes to define ${hint} — End Draw when done`
            : `${n} node${n > 1 ? 's' : ''} — keep clicking or End Draw`;
    }

    function finalizeElement() {
        const typ = $('ele-type').value;
        const mat = +$('ele-mat').value || 1;
        const pro = +$('ele-prop').value || 1;
        const nodes = [...drawNodeQueue];
        model.elements[nextEleId] = { id: nextEleId, type: typ, mat, pro, nodes, eload: [], angle: 0 };
        model.header.numNod = Object.keys(model.nodes).length;
        syncHeaderFromElements();
        const eid = nextEleId++;
        undoStack.push({ type: 'element', id: eid });
        drawNodeQueue = [];
        FepsRenderer.resetDrawPending();
        FepsRenderer.setModel(model);
        updateOpts(); FepsRenderer.draw(); refreshLists(); updateModelInfo(); updateDrawStatus();
        setStatus(`Element E${eid} (${typ}) created: nodes [${nodes.join(', ')}]`);
    }

    // ══════════════════════════════════════════════════════════════════════
    //  POLYGON MESHING  –  Uses FepsMesher (earcut + subdivision)
    //  Supports: TRIG3, TRIG6, QUAD4, QUAD8
    // ══════════════════════════════════════════════════════════════════════

    async function meshPolygon() {
        const isPathClosed = closedPolygon ? (closedPolygon._closed !== false) : true;
        const minLen = isPathClosed ? 3 : 2;
        if (!closedPolygon || closedPolygon.length < minLen) {
            setStatus(`⚠ No ${isPathClosed ? 'closed polygon' : 'path'} to mesh. Use Start Draw → click nodes → End Draw → Mesh Polygon.`);
            return;
        }
        const meshType = $('ele-type').value;
        const targetLen = +$('mesh-edge-len').value || 0;   // 0 → auto
        const smoothIter = Math.max(0, +$('mesh-smooth').value | 0);
        const mat = +$('ele-mat').value || 1;
        const pro = +$('ele-prop').value || 1;
        const is1D = ['BAR2', 'BEAM2D', 'BAR3D', 'BEAM3D'].includes(meshType);

        if (is1D) {
            // ── 1D type: create line elements along polygon boundary edges ──
            const nodeIds = closedPolygon._nodeIds;
            if (!nodeIds || nodeIds.length < 2) {
                setStatus('⚠ Need at least 2 boundary nodes to create 1D elements.');
                return;
            }
            const createdElemIds = [];
            const loopCount = isPathClosed ? nodeIds.length : nodeIds.length - 1;
            for (let i = 0; i < loopCount; i++) {
                const n1 = nodeIds[i];
                const n2 = nodeIds[(i + 1) % nodeIds.length];   // mod handles wrap for closed; safe for open too
                model.elements[nextEleId] = {
                    id: nextEleId, type: meshType, mat, pro,
                    nodes: [n1, n2], eload: [], angle: 0
                };
                createdElemIds.push(nextEleId);
                nextEleId++;
            }
            model.header.numNod = Object.keys(model.nodes).length;
            if (createdElemIds.length > 0) {
                undoStack.push({
                    type: 'mesh', nodeIds: [], elemIds: createdElemIds,
                    polygon: closedPolygon, holes: []
                });
            }
            syncHeaderFromElements();
            setStatus(`✓ Created ${createdElemIds.length} ${meshType} elements along polygon boundary`);

        } else {
            // ── 2D solid type: generate filled mesh ──
            let meshSuccess = false;
            try {
                // TQMesh WASM only — no JS fallback
                let result;
                const _t0 = performance.now();
                if (typeof FepsTQMesh === 'undefined' || !FepsTQMesh.isAvailable()) {
                    throw new Error('TQMesh WASM 모듈이 로딩되지 않았습니다. 페이지를 새로고침해 주세요.');
                }
                result = await FepsTQMesh.generateMesh(closedPolygon, meshType, targetLen, smoothIter, holePolygons);
                console.log('[Mesh] TQMesh generated', result.nodes.length, 'nodes,',
                    result.elements.length, 'elements in',
                    (performance.now() - _t0).toFixed(0), 'ms');

                // Track what this mesh operation creates for atomic undo
                const createdNodeIds = [];
                const createdElemIds = [];

                // Map mesher output (0-indexed) to model (1-indexed IDs)
                const nodeMap = {};  // mesher index → model node ID
                for (let i = 0; i < result.nodes.length; i++) {
                    const p = result.nodes[i];
                    // Reuse existing node if one sits at the same position
                    let existId = null;
                    for (const nid of Object.keys(model.nodes).map(Number)) {
                        const n = model.nodes[nid];
                        if (Math.abs(n.x - p.x) < 1e-8 && Math.abs(n.y - p.y) < 1e-8) {
                            existId = nid; break;
                        }
                    }
                    if (existId) {
                        nodeMap[i] = existId;
                    } else {
                        model.nodes[nextNodeId] = { id: nextNodeId, x: p.x, y: p.y, z: 0 };
                        createdNodeIds.push(nextNodeId);
                        nodeMap[i] = nextNodeId++;
                    }
                }

                // Create elements
                let countTri = 0, countQuad = 0;
                for (const elem of result.elements) {
                    const mappedNodes = elem.map(i => nodeMap[i]);
                    const nn = mappedNodes.length;

                    // Determine element type based on node count
                    let elType;
                    if (nn === 3) elType = 'TRIG3';
                    else if (nn === 6) elType = 'TRIG6';
                    else if (nn === 4) elType = 'QUAD4';
                    else if (nn === 5) elType = 'QUAD5';
                    else if (nn === 8) elType = 'QUAD8';
                    else if (nn === 9) elType = 'QUAD9';
                    else continue;

                    // Mark leftover tris in a quad mesh (for yellow highlight)
                    const isQuadMesh = (meshType === 'QUAD4' || meshType === 'QUAD8' ||
                                        meshType === 'QUAD5' || meshType === 'QUAD9');
                    const isLeftover = isQuadMesh && (elType === 'TRIG3' || elType === 'TRIG6');
                    model.elements[nextEleId] = {
                        id: nextEleId, type: elType, mat, pro,
                        nodes: mappedNodes, eload: [], angle: 0,
                        _leftover: isLeftover || undefined
                    };
                    createdElemIds.push(nextEleId);
                    nextEleId++;
                    if (nn === 3 || nn === 6) countTri++; else countQuad++;
                }

                model.header.numNod = Object.keys(model.nodes).length;

                // Push a single atomic undo entry for the entire mesh operation.
                // Save the polygon so it can be restored if the user undoes.
                if (createdNodeIds.length > 0 || createdElemIds.length > 0) {
                    undoStack.push({
                        type: 'mesh',
                        nodeIds: createdNodeIds,
                        elemIds: createdElemIds,
                        polygon: closedPolygon,
                        holes: [...holePolygons]
                    });
                }

                syncHeaderFromElements();    // set dofNod / dim for all elements in model

                const total = countTri + countQuad;
                const detail = countQuad > 0 && countTri > 0
                    ? ` (${countQuad} quads, ${countTri} tris)`
                    : '';
                const holeInfo = holePolygons.length > 0 ? ` (${holePolygons.length} hole${holePolygons.length > 1 ? 's' : ''})` : '';
                setStatus(`✓ Meshed: ${total} ${meshType} elements created${detail}${holeInfo}`);
                meshSuccess = true;

            } catch (err) {
                if (err.message !== '사용자가 취소했습니다.') {
                    setStatus(`⚠ Mesh error: ${err.message}`);
                    alert(`메시 생성 실패:\n${err.message}`);
                } else {
                    setStatus('메시 생성이 취소되었습니다.');
                }
                console.error('Mesh generation error:', err);
            }

            // ── Only clean up polygon if mesh succeeded ──
            if (!meshSuccess) {
                // Keep the polygon so the user can retry
                return;
            }
        }

        closedPolygon = null;
        holePolygons = [];
        FepsRenderer.clearClosedPolygon();   // 메시 생성 후 폴리곤/홀 오버레이 제거
        drawingHole = false;
        holeDrawType = 'polygon';
        holeDrawDragStart = null; holeDrawDragging = false; holePreviewPts = null;
        FepsRenderer.setHolePreview(null);
        canvas.classList.remove('draw-mode');
        canvas.style.cursor = '';
        $('btn-draw-start').disabled = false;
        $('btn-draw-end').disabled = true;
        $('btn-mesh-poly').disabled = true;
        $('btn-add-hole').disabled = true;
        updateHoleStatus();
        FepsRenderer.clearPolygon();   // polygon edges now realized as elements — remove overlay
        FepsRenderer.setModel(model);
        updateOpts(); FepsRenderer.draw(); refreshLists(); updateModelInfo();
    }

    // ══════════════════════════════════════════════════════════════════════
    //  SELECTION MODE
    // ══════════════════════════════════════════════════════════════════════

    function toggleSelMode(mode) {
        endDrawMode();
        if (selectionMode === mode) { endSelMode(); return; }
        selectionMode = mode;
        canvas.classList.add('sel-mode');
        $('btn-sel-ele').classList.toggle('active', mode === 'elements');
        $('btn-sel-nod').classList.toggle('active', mode === 'nodes');
        if (mode === 'elements') {
            FepsRenderer.setSelectedNodes(new Set());
        } else {
            FepsRenderer.setSelectedElements(new Set());
        }
        FepsRenderer.draw();
        updateSelInfo();
        setStatus(mode === 'elements'
            ? 'Click or drag to select elements (Shift to add)'
            : 'Click or drag to select nodes (Shift to add)');
    }

    function endSelMode() {
        selectionMode = null;
        canvas.classList.remove('sel-mode');
        $('btn-sel-ele').classList.remove('active');
        $('btn-sel-nod').classList.remove('active');
    }

    function clearSel() {
        FepsRenderer.clearSelection();
        FepsRenderer.draw();
        updateSelInfo();
        $('btn-assign-mat').disabled = true;
        $('btn-assign-bc').disabled = true;
    }

    function updateSelInfo() {
        const ne = FepsRenderer.getSelectedElements().size;
        const nn = FepsRenderer.getSelectedNodes().size;
        const parts = [];
        if (ne > 0) parts.push(`${ne} elem`);
        if (nn > 0) parts.push(`${nn} node${nn > 1 ? 's' : ''}`);
        let info = parts.length > 0 ? `Selected: ${parts.join(', ')}` : 'Click canvas objects to select';
        if (nn > 1 && selectionMode === 'nodes') info += ' – right-click to assign BC/Load';
        $('sel-info').textContent = info;
        $('btn-assign-mat').disabled = ne === 0;
        $('btn-assign-bc').disabled = nn === 0;
    }

    // ══════════════════════════════════════════════════════════════════════
    //  MODAL DIALOGS
    // ══════════════════════════════════════════════════════════════════════

    function openModal(dialogId) {
        ['modal-matprop', 'modal-bcload', 'modal-nodecoord', 'modal-elem', 'modal-output'].forEach(id => $(id).classList.add('hidden'));
        $(dialogId).classList.remove('hidden');
        $('modal-overlay').classList.remove('hidden');
    }

    function closeModal() {
        $('modal-overlay').classList.add('hidden');
        $('modal-matprop').classList.add('hidden');
        $('modal-bcload').classList.add('hidden');
        $('modal-nodecoord').classList.add('hidden');
        $('modal-elem').classList.add('hidden');
        $('modal-output').classList.add('hidden');
    }

    function openMatPropDialog() {
        const sel = FepsRenderer.getSelectedElements();
        if (sel.size === 0) return;
        $('modal-mp-info').textContent = `Assign to ${sel.size} selected element${sel.size > 1 ? 's' : ''}: [${[...sel].join(', ')}]`;
        const matSel = $('dlg-mat'), propSel = $('dlg-prop');
        matSel.innerHTML = ''; propSel.innerHTML = '';
        for (const id of Object.keys(model.materials).sort((a, b) => a - b)) {
            const o = document.createElement('option'); o.value = id;
            o.textContent = `M${id} (E=${model.materials[id].E})`; matSel.appendChild(o);
        }
        for (const id of Object.keys(model.properties).sort((a, b) => a - b)) {
            const o = document.createElement('option'); o.value = id;
            o.textContent = `P${id} (A=${model.properties[id].A})`; propSel.appendChild(o);
        }
        openModal('modal-matprop');
    }

    function applyMatProp() {
        const matId = +$('dlg-mat').value;
        const proId = +$('dlg-prop').value;
        const sel = FepsRenderer.getSelectedElements();
        for (const eid of sel) {
            if (model.elements[eid]) { model.elements[eid].mat = matId; model.elements[eid].pro = proId; }
        }
        closeModal(); refreshLists(); FepsRenderer.draw();
        setStatus(`Assigned M${matId}/P${proId} to ${sel.size} element(s)`);
    }

    function openBCLoadDialog() {
        const sel = FepsRenderer.getSelectedNodes();
        if (sel.size === 0) return;
        $('modal-bc-info').textContent =
            `Assign to ${sel.size} selected node${sel.size > 1 ? 's' : ''}: [${[...sel].join(', ')}]`;
        const cfg = getDofConfig();
        const firstNid = [...sel][0];
        const bc = model.bcs[firstNid] || null;
        buildBCLoadUI('dlg-bc-checks-wrap', 'dlg-bc-load-wrap', bc, cfg);
        openModal('modal-bcload');
    }

    function applyBCLoad() {
        const sel = FepsRenderer.getSelectedNodes();
        const cfg = getDofConfig();
        const { tags, forces, disps } = readBCLoadUI('dlg-bc-checks-wrap', 'dlg-bc-load-wrap', cfg);
        for (const nid of sel) {
            if (!model.nodes[nid]) continue;
            model.bcs[nid] = { node: nid, tags: [...tags], forces: [...forces], disps: [...disps] };
        }
        model.header.numNod = Object.keys(model.nodes).length;
        closeModal(); refreshLists(); FepsRenderer.draw();
        setStatus(`BC/Load assigned to ${sel.size} node(s)`);
    }

    // ══════════════════════════════════════════════════════════════════════
    //  FILE HANDLING
    // ══════════════════════════════════════════════════════════════════════

    function handleNew() {
        if (Object.keys(model.nodes).length > 0) {
            if (!confirm('Create a new model? Current model will be lost.')) return;
        }
        endDrawMode(); endSelMode();
        model = FepsParser.createEmpty(2, 2);
        results = null; undoStack = []; closedPolygon = null;
        nextNodeId = 1; nextEleId = 1; nextMatId = 1; nextProId = 1;
        editingMatId = null; editingProId = null;
        $('btn-add-mat').textContent = 'Add Material';
        $('btn-add-prop').textContent = 'Add Property';
        FepsRenderer.setModel(model); FepsRenderer.setResults(null);
        FepsRenderer.clearSelection(); FepsRenderer.clearPolygon(); FepsRenderer.clearClosedPolygon(); FepsRenderer.resetView();
        updateOpts(); FepsRenderer.draw(); refreshLists(); updateModelInfo();
        $('btn-mesh-poly').disabled = true;
        $('btn-open-output').disabled = true;
        setStatus('New model created');
    }

    function handleFileOpen() {
        const file = $('file-input').files[0];
        if (!file) return;
        endDrawMode(); endSelMode();
        const reader = new FileReader();
        reader.onload = ev => {
            try {
                model = FepsParser.parse(ev.target.result);
                results = null; syncIdsFromModel();
                FepsRenderer.setModel(model); FepsRenderer.setResults(null);
                FepsRenderer.clearPolygon(); FepsRenderer.clearClosedPolygon(); FepsRenderer.resetView();
                updateOpts(); FepsRenderer.draw(); refreshLists(); updateModelInfo();
                $('btn-open-output').disabled = true;
                setStatus(`Loaded: ${file.name}`);
            } catch (err) { setStatus(`Error parsing file: ${err.message}`); }
        };
        reader.readAsText(file);
    }

    function handleSaveAs() {
        model.header.numNod = Object.keys(model.nodes).length;
        syncHeaderFromElements();
        const txt = FepsParser.exportInp(model);
        const blob = new Blob([txt], { type: 'text/plain' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob); a.download = 'model.inp'; a.click();
        URL.revokeObjectURL(a.href); setStatus('Saved as model.inp');
    }

    function handleExport() {
        // Placeholder for future export formats
        const fmt = prompt('Export format:\n1 — MIDAS mct\n2 — SAP2000 $2k\n\nEnter number (not yet implemented):');
        if (fmt === '1') setStatus('MIDAS mct export — coming soon');
        else if (fmt === '2') setStatus('SAP2000 $2k export — coming soon');
        else setStatus('Export cancelled');
    }

    // ── Analysis ──────────────────────────────────────────────────────────

    function handleRun() {
        endDrawMode(); endSelMode();
        if (Object.keys(model.elements).length === 0) { setStatus('No elements.'); return; }
        if (Object.keys(model.materials).length === 0) { setStatus('No materials.'); return; }
        if (Object.keys(model.properties).length === 0) { setStatus('No properties.'); return; }
        model.header.numNod = Object.keys(model.nodes).length;
        syncHeaderFromElements();
        // Read gravity from UI inputs
        model.gravity = {
            gx: parseFloat($('grav-x').value) || 0,
            gy: parseFloat($('grav-y').value) || 0,
            gz: parseFloat($('grav-z').value) || 0
        };
        try {
            setStatus('Running…');
            const t0 = performance.now();
            results = FepsSolver.solve(model);
            const dt = (performance.now() - t0).toFixed(1);
            FepsRenderer.setResults(results);
            updateOpts(); FepsRenderer.draw(); showResultsTable(); updateColorBar();
            $('btn-open-output').disabled = false;
            setStatus(`Analysis complete in ${dt} ms — ${results.nf} DOFs`);
            document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
            document.querySelector('.tab[data-tab="post"]').classList.add('active');
            $('panel-pre').classList.remove('active');
            $('panel-post').classList.add('active');
            updateOpts(); FepsRenderer.draw();
        } catch (err) { setStatus(`Solver error: ${err.message}`); console.error(err); }
    }

    // ── Material / Property ───────────────────────────────────────────────

    function addMaterial() {
        const E = +$('mat-E').value, nu = +$('mat-nu').value;
        const rho = parseFloat($('mat-rho').value) || 0;
        if (editingMatId !== null) {
            // Update existing material in-place (solves the "change E has no effect" bug)
            model.materials[editingMatId] = { id: editingMatId, E, nu, rho };
            setStatus(`Material ${editingMatId} updated`);
            editingMatId = null;
            $('btn-add-mat').textContent = 'Add Material';
        } else {
            model.materials[nextMatId] = { id: nextMatId, E, nu, rho }; nextMatId++;
            setStatus(`Material ${nextMatId - 1} added`);
        }
        refreshLists();
    }

    function addProperty() {
        const A = +$('prop-A').value, t = +$('prop-t').value;
        const Iz = +$('prop-Iz').value, Iy = +$('prop-Iy').value, J = +$('prop-J').value;
        const alpha = parseFloat($('prop-alpha').value) || 0;
        if (editingProId !== null) {
            // Update existing property in-place
            model.properties[editingProId] = { id: editingProId, A, t, Iz, Iy, J, alpha };
            setStatus(`Property ${editingProId} updated`);
            editingProId = null;
            $('btn-add-prop').textContent = 'Add Property';
        } else {
            model.properties[nextProId] = { id: nextProId, A, t, Iz, Iy, J, alpha }; nextProId++;
            setStatus(`Property ${nextProId - 1} added`);
        }
        refreshLists();
    }

    // ── List rendering ────────────────────────────────────────────────────

    function refreshLists() {
        const matList = $('mat-list'); matList.innerHTML = '';
        for (const [id, m] of Object.entries(model.materials)) {
            const mCls = editingMatId === +id ? ' class="item editing"' : ' class="item"';
            matList.innerHTML += `<div${mCls}><span>M${id}: E=${fmtNum(m.E)} ν=${m.nu}</span>
        <button class="edit-btn" data-type="mat" data-id="${id}" title="Edit this material (click again to cancel)">✎</button>
        <button class="del-btn" data-type="mat" data-id="${id}">×</button></div>`;
        }
        const propList = $('prop-list'); propList.innerHTML = '';
        for (const [id, p] of Object.entries(model.properties)) {
            const aStr = p.alpha ? ` α=${fmtNum(p.alpha)}` : '';
            const pCls = editingProId === +id ? ' class="item editing"' : ' class="item"';
            propList.innerHTML += `<div${pCls}><span>P${id}: A=${fmtNum(p.A)} t=${fmtNum(p.t)}${aStr}</span>
        <button class="edit-btn" data-type="prop" data-id="${id}" title="Edit this property (click again to cancel)">✎</button>
        <button class="del-btn" data-type="prop" data-id="${id}">×</button></div>`;
        }
        const eleList = $('ele-list'); eleList.innerHTML = '';
        for (const eid of Object.keys(model.elements).map(Number).sort((a, b) => a - b)) {
            const e = model.elements[eid];
            eleList.innerHTML += `<div class="item"><span>E${eid}: ${e.type} [${e.nodes.join(',')}] M${e.mat}/P${e.pro}</span>
        <button class="del-btn" data-type="ele" data-id="${eid}">×</button></div>`;
        }
        const { bcLabels, fLabels } = getDofConfig();
        const bcList = $('bc-list'); bcList.innerHTML = '';
        for (const [nid, bc] of Object.entries(model.bcs)) {
            const fix = bc.tags.map((t, i) => {
                if (!t) return '';
                const lbl = bcLabels[i] ?? `D${i}`;
                const d = bc.disps ? bc.disps[i] : 0;
                return d !== 0 ? `${lbl}=${fmtNum(d)}` : lbl;
            }).filter(Boolean).join(', ');
            if (!fix) continue;
            bcList.innerHTML += `<div class="item"><span>N${nid}: Fix(${fix})</span>
        <button class="del-btn" data-type="bc" data-id="${nid}">×</button></div>`;
        }
        const loadList = $('load-list'); loadList.innerHTML = '';
        for (const [nid, bc] of Object.entries(model.bcs)) {
            const fs = bc.forces.map((f, i) => f !== 0 ? `${fLabels[i] ?? `F${i}`}=${fmtNum(f)}` : '').filter(Boolean).join(' ');
            if (!fs) continue;
            loadList.innerHTML += `<div class="item"><span>N${nid}: ${fs}</span>
        <button class="del-btn" data-type="load" data-id="${nid}">×</button></div>`;
        }
        syncMatPropSelectors();
        document.querySelectorAll('.del-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const type = btn.dataset.type, id = btn.dataset.id;
                if (type === 'mat') {
                    delete model.materials[id];
                    if (editingMatId === +id) {
                        editingMatId = null;
                        $('btn-add-mat').textContent = 'Add Material';
                    }
                } else if (type === 'prop') {
                    delete model.properties[id];
                    if (editingProId === +id) {
                        editingProId = null;
                        $('btn-add-prop').textContent = 'Add Property';
                    }
                } else if (type === 'ele') delete model.elements[id];
                else if (type === 'bc') { if (model.bcs[id]) model.bcs[id].tags = model.bcs[id].tags.map(() => 0); }
                else if (type === 'load') { if (model.bcs[id]) model.bcs[id].forces = model.bcs[id].forces.map(() => 0); }
                refreshLists(); FepsRenderer.draw(); updateModelInfo();
            });
        });
        document.querySelectorAll('.edit-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const type = btn.dataset.type, id = +btn.dataset.id;
                if (type === 'mat' && model.materials[id]) {
                    if (editingMatId === id) {
                        // Toggle off — cancel edit mode
                        editingMatId = null;
                        $('btn-add-mat').textContent = 'Add Material';
                    } else {
                        // Load material values into input fields
                        const m = model.materials[id];
                        $('mat-E').value = m.E;
                        $('mat-nu').value = m.nu;
                        $('mat-rho').value = m.rho || 0;
                        editingMatId = id;
                        $('btn-add-mat').textContent = `Update M${id}`;
                    }
                    refreshLists();
                } else if (type === 'prop' && model.properties[id]) {
                    if (editingProId === id) {
                        // Toggle off — cancel edit mode
                        editingProId = null;
                        $('btn-add-prop').textContent = 'Add Property';
                    } else {
                        // Load property values into input fields
                        const p = model.properties[id];
                        $('prop-A').value = p.A || 0;
                        $('prop-t').value = p.t || 0;
                        $('prop-Iz').value = p.Iz || 0;
                        $('prop-Iy').value = p.Iy || 0;
                        $('prop-J').value = p.J || 0;
                        $('prop-alpha').value = p.alpha || 0;
                        editingProId = id;
                        $('btn-add-prop').textContent = `Update P${id}`;
                    }
                    refreshLists();
                }
            });
        });
    }

    function syncMatPropSelectors() {
        const matSel = $('ele-mat'), propSel = $('ele-prop');
        const curMat = matSel.value, curProp = propSel.value;
        matSel.innerHTML = ''; propSel.innerHTML = '';
        for (const id of Object.keys(model.materials).sort((a, b) => a - b)) {
            const o = document.createElement('option'); o.value = id; o.textContent = `M${id}`; matSel.appendChild(o);
        }
        for (const id of Object.keys(model.properties).sort((a, b) => a - b)) {
            const o = document.createElement('option'); o.value = id; o.textContent = `P${id}`; propSel.appendChild(o);
        }
        if (model.materials[curMat]) matSel.value = curMat;
        if (model.properties[curProp]) propSel.value = curProp;
    }

    function showResultsTable() {
        if (!results) return;
        const wrap = $('results-table-wrap');
        const nids = Object.keys(model.nodes).map(Number).sort((a, b) => a - b);
        const dofNod = model.header.dofNod;
        const headers = ['Node', 'u', 'v'];
        if (dofNod >= 3) headers.push('θ');
        headers.push('Fx', 'Fy');
        if (dofNod >= 3) headers.push('Mz');
        let html = '<table class="results-table"><thead><tr>';
        for (const h of headers) html += `<th>${h}</th>`;
        html += '</tr></thead><tbody>';
        for (const nid of nids) {
            const u = results.nodeDisp[nid] || [], f = results.nodeForce[nid] || [];
            html += `<tr><td>${nid}</td>`;
            for (let j = 0; j < dofNod; j++) html += `<td>${(u[j] || 0).toExponential(3)}</td>`;
            for (let j = 0; j < dofNod; j++) html += `<td>${(f[j] || 0).toExponential(3)}</td>`;
            html += '</tr>';
        }
        html += '</tbody></table>'; wrap.innerHTML = html;
    }

    function buildOutputText() {
        if (!results) return '';
        const dofNod = model.header.dofNod;
        const dim = model.header.dim || 2;
        const nids = Object.keys(model.nodes).map(Number).sort((a, b) => a - b);
        const eids = Object.keys(model.elements).map(Number).sort((a, b) => a - b);

        const fmt = v => (v == null ? '            ---' : v.toExponential(4).padStart(15));
        const sep = '─'.repeat(72) + '\n';
        const dsep = '═'.repeat(72) + '\n';

        const dispLabels = dofNod >= 6 ? ['u', 'v', 'w', 'θx', 'θy', 'θz']
            : dofNod >= 3 ? ['u', 'v', 'θz'] : ['u', 'v'];
        const forceLabels = dofNod >= 6 ? ['Fx', 'Fy', 'Fz', 'Mx', 'My', 'Mz']
            : dofNod >= 3 ? ['Fx', 'Fy', 'Mz'] : ['Fx', 'Fy'];

        let out = '';

        // ── Header ──────────────────────────────────────────────────────────
        out += dsep;
        out += '  FEPS  –  Finite Element Program for Structure\n';
        out += `  Analysis Output  |  ${new Date().toLocaleString()}\n`;
        out += dsep + '\n';

        // ── Problem Summary ─────────────────────────────────────────────────
        out += '  PROBLEM SUMMARY\n' + sep;
        out += `    Nodes    : ${nids.length}\n`;
        out += `    Elements : ${eids.length}\n`;
        out += `    DOF/Node : ${dofNod}\n`;
        out += `    Dimension: ${dim}D\n`;
        out += `    Free DOFs: ${results.nf}\n`;
        out += `    Fixed DOFs: ${results.nc}\n\n`;

        // ── Nodal Displacements ─────────────────────────────────────────────
        out += '  NODAL DISPLACEMENTS\n' + sep;
        out += '    Node' + dispLabels.map(l => l.padStart(15)).join('') + '\n' + sep;
        for (const nid of nids) {
            const u = results.nodeDisp[nid] || [];
            out += `  ${String(nid).padStart(6)}` + Array.from({ length: dofNod }, (_, j) => fmt(u[j] || 0)).join('') + '\n';
        }
        out += '\n';

        // ── Reaction Forces ─────────────────────────────────────────────────
        const reactNids = nids.filter(nid => {
            const bc = model.bcs[nid];
            return bc && bc.tags && bc.tags.some(Boolean);
        });
        if (reactNids.length > 0) {
            out += '  REACTION FORCES\n' + sep;
            out += '    Node' + forceLabels.map(l => l.padStart(15)).join('') + '\n' + sep;
            for (const nid of reactNids) {
                const bc = model.bcs[nid];
                const f = results.nodeForce[nid] || [];
                const vals = Array.from({ length: dofNod }, (_, j) =>
                    (bc.tags[j] ? fmt(f[j] || 0) : '              0'));
                out += `  ${String(nid).padStart(6)}` + vals.join('') + '\n';
            }
            out += '\n';
        }

        // ── Element Forces ──────────────────────────────────────────────────
        out += '  ELEMENT FORCES\n' + sep;
        for (const eid of eids) {
            const e = model.elements[eid];
            const typ = e.type || '';
            const ef = results.elemForces[eid];
            if (!ef) continue;
            const tag = `  Elem ${String(eid).padStart(4)}  [${typ}]`;
            if (typ === 'BAR2' || typ === 'BAR3D') {
                out += `${tag}  Axial =${fmt(ef.axial)}   Stress =${fmt(ef.stress)}\n`;
            } else if (typ === 'BEAM2D') {
                out += `${tag}  N1 =${fmt(ef.N1)}  V1 =${fmt(ef.V1)}  M1 =${fmt(ef.M1)}\n`;
                out += `${' '.repeat(tag.length)}  N2 =${fmt(ef.N2)}  V2 =${fmt(ef.V2)}  M2 =${fmt(ef.M2)}\n`;
            } else if (typ === 'BEAM3D') {
                out += `${tag}  N1=${fmt(ef.N1)}  Vy1=${fmt(ef.Vy1)}  Vz1=${fmt(ef.Vz1)}  T1=${fmt(ef.T1)}  My1=${fmt(ef.My1)}  Mz1=${fmt(ef.Mz1)}\n`;
                out += `${' '.repeat(tag.length)}  N2=${fmt(ef.N2)}  Vy2=${fmt(ef.Vy2)}  Vz2=${fmt(ef.Vz2)}  T2=${fmt(ef.T2)}  My2=${fmt(ef.My2)}  Mz2=${fmt(ef.Mz2)}\n`;
            }
        }
        out += '\n';

        // ── Nodal Stress (2D elements) ──────────────────────────────────────
        if (results.nodeStress && Object.keys(results.nodeStress).length > 0) {
            out += '  NODAL STRESS (2D elements)\n' + sep;
            out += '    Node' + ['σ_xx', 'σ_yy', 'τ_xy', 'σ_max', 'σ_min', 'Mises'].map(l => l.padStart(15)).join('') + '\n' + sep;
            for (const nid of nids) {
                const s = results.nodeStress[nid]; // array [σxx,σyy,τxy,σmax,σmin,mises]
                if (!s) continue;
                out += `  ${String(nid).padStart(6)}` + [s[0], s[1], s[2], s[3], s[4], s[5]].map(fmt).join('') + '\n';
            }
            out += '\n';
        }

        out += dsep + '  End of output\n' + dsep;
        return out;
    }

    function openOutputModal() {
        if (!results) { setStatus('Run analysis first.'); return; }
        $('output-text').textContent = buildOutputText();
        openModal('modal-output');
    }

    // ══════════════════════════════════════════════════════════════════════
    //  HTML REPORT GENERATOR
    // ══════════════════════════════════════════════════════════════════════
    function generateReport() {
        const dofNod = model.header.dofNod;
        const dim = model.header.dim || 2;
        const nids = Object.keys(model.nodes).map(Number).sort((a, b) => a - b);
        const eids = Object.keys(model.elements).map(Number).sort((a, b) => a - b);
        const mids = Object.keys(model.materials).map(Number).sort((a, b) => a - b);
        const pids = Object.keys(model.properties).map(Number).sort((a, b) => a - b);
        const hasRes = !!results;
        const date = new Date().toLocaleString();

        const fN = v => (v == null || isNaN(v) ? '—' : v.toExponential(4));
        const fG = v => (v == null || isNaN(v) ? '—' : (+v.toPrecision(6)).toString());

        const dLabels = dofNod >= 6 ? ['u', 'v', 'w', 'θx', 'θy', 'θz']
            : dofNod >= 3 ? ['u', 'v', 'θz'] : ['u', 'v'];
        const fLabels = dofNod >= 6 ? ['Fx', 'Fy', 'Fz', 'Mx', 'My', 'Mz']
            : dofNod >= 3 ? ['Fx', 'Fy', 'Mz'] : ['Fx', 'Fy'];
        const bcLabels = dofNod >= 6 ? ['Dx', 'Dy', 'Dz', 'Rx', 'Ry', 'Rz']
            : dofNod >= 3 ? ['Dx', 'Dy', 'Rz'] : ['Dx', 'Dy'];

        // ── Table builder ──────────────────────────────────────────────────
        const tbl = (id, headers, rows) => {
            let h = `<table id="${id}"><thead><tr>${headers.map(c => `<th>${c}</th>`).join('')}</tr></thead><tbody>`;
            rows.forEach((row, ri) => {
                h += `<tr class="${ri % 2 ? 'even' : ''}">${row.map(c => `<td>${c ?? '—'}</td>`).join('')}</tr>`;
            });
            return h + '</tbody></table>';
        };
        const sec = (anchor, num, title, body) =>
            `<section><h2 id="${anchor}"><span class="sec-num">${num}</span>${title}</h2>${body}</section>`;

        // ── 1. Node Information ────────────────────────────────────────────
        const nodeHdr = ['Node ID', 'X', 'Y', ...(dim === 3 ? ['Z'] : []),
            ...bcLabels.map(l => `BC&nbsp;${l}`),
            ...fLabels.map(l => `Load&nbsp;${l}`)];
        const nodeRows = nids.map(nid => {
            const n = model.nodes[nid];
            const bc = model.bcs[nid] || {};
            const tags = bc.tags || Array(dofNod).fill(0);
            const forces = bc.forces || Array(dofNod).fill(0);
            return [
                nid, fG(n.x), fG(n.y), ...(dim === 3 ? [fG(n.z || 0)] : []),
                ...tags.map(t => t ? '<span class="chk">✔</span>' : '<span class="free">–</span>'),
                ...forces.map(f => f ? `<strong>${fN(f)}</strong>` : '0'),
            ];
        });

        // ── 2. Material Information ────────────────────────────────────────
        const matHdr = ['Mat ID', 'E (Young\'s Modulus)', 'ν (Poisson\'s Ratio)'];
        const matRows = mids.map(mid => {
            const m = model.materials[mid];
            return [mid, fN(m.E), fG(m.nu ?? 0)];
        });

        // ── 3. Section Properties ──────────────────────────────────────────
        const is3DB = dofNod === 6;
        const propHdr = ['Prop ID', 'A (Area)',
            ...(is3DB ? ['Iz', 'Iy', 'J (Torsion)'] : dofNod === 3 ? ['Iz'] : []),
            't (Thickness)', 'α (Thermal Exp.)'];
        const propRows = pids.map(pid => {
            const p = model.properties[pid];
            return [pid, fN(p.A),
                ...(is3DB ? [fN(p.Iz), fN(p.Iy), fN(p.J)] : dofNod === 3 ? [fN(p.Iz)] : []),
                fN(p.t), fN(p.alpha)];
        });

        // ── 4. Element Information ─────────────────────────────────────────
        const maxN = Math.max(...eids.map(eid => (model.elements[eid].nodes || []).length), 2);
        const elemHdr = ['Elem ID', 'Type', 'Mat', 'Prop',
            ...Array.from({ length: maxN }, (_, i) => `Node ${i + 1}`),
            ...(dim === 3 ? ['wx', 'wy', 'wz'] : ['wx', 'wy'])];
        const elemRows = eids.map(eid => {
            const e = model.elements[eid];
            const en = e.nodes || [];
            const el = e.eload || [];
            return [eid, `<code>${e.type}</code>`, e.mat, e.pro,
                ...Array.from({ length: maxN }, (_, i) => en[i] ?? '—'),
                ...(dim === 3 ? [el[0] || 0, el[1] || 0, el[2] || 0] : [el[0] || 0, el[1] || 0])];
        });

        // ── 5. Nodal Values (displacements + reactions) ────────────────────
        let nodalBody;
        if (!hasRes) {
            nodalBody = '<p class="no-res">⚠ Run analysis to see nodal results.</p>';
        } else {
            const nrHdr = ['Node', ...dLabels.map(l => `Disp&nbsp;${l}`),
                ...fLabels.map(l => `Reaction&nbsp;${l}`)];
            const nrRows = nids.map(nid => {
                const u = results.nodeDisp[nid] || [];
                const f = results.nodeForce[nid] || [];
                const bc = model.bcs[nid] || {};
                const tags = bc.tags || [];
                const fixed = tags.some(Boolean);
                return [
                    fixed ? `<strong>${nid}</strong>` : nid,
                    ...Array.from({ length: dofNod }, (_, j) => fN(u[j] || 0)),
                    ...Array.from({ length: dofNod }, (_, j) =>
                        tags[j] ? `<strong>${fN(f[j] || 0)}</strong>` : fN(f[j] || 0)),
                ];
            });
            nodalBody = '<p class="note">Bold node = constrained; Bold reaction = at fixed DOF.</p>'
                + tbl('tbl-nodal', nrHdr, nrRows);
        }

        // ── 6. Element Stress/Force (section forces at 5 positions) ──────────
        // Section force interpolation helpers (same formulas as renderer)
        const sfT = [0, 0.25, 0.5, 0.75, 1.0];   // positions along element

        // Mark max-|value| cell in a column of numbers
        const markMax = rows => {
            const nCols = rows[0].length - 2; // skip Elem and x/L
            for (let c = 0; c < nCols; c++) {
                let maxAbs = 0;
                rows.forEach(r => { const v = parseFloat(r[c + 2]); if (!isNaN(v) && Math.abs(v) > maxAbs) maxAbs = Math.abs(v); });
                if (maxAbs < 1e-15) continue;
                rows.forEach(r => {
                    const v = parseFloat(r[c + 2]);
                    if (!isNaN(v) && Math.abs(Math.abs(v) - maxAbs) < 1e-12)
                        r[c + 2] = `<span class="peak">${fN(v)}</span>`;
                });
            }
            return rows;
        };

        // Build a grouped section-force table: each element occupies 5 rows,
        // separated by a full-span header row.
        const sfTbl = (tableId, colHdrs, rowsPerElem) => {
            const allCols = ['Elem', 'x/L', ...colHdrs];
            let h = `<table id="${tableId}" class="sf-table">`;
            h += `<thead><tr>${allCols.map(c => `<th>${c}</th>`).join('')}</tr></thead><tbody>`;
            rowsPerElem.forEach(({ label, rows }, gi) => {
                h += `<tr class="sf-group-hdr"><td colspan="${allCols.length}">${label}</td></tr>`;
                rows.forEach((row, ri) => {
                    h += `<tr class="${ri % 2 ? 'even' : ''}">${row.map(c => `<td>${c ?? '—'}</td>`).join('')}</tr>`;
                });
            });
            h += '</tbody></table>';
            return h;
        };

        let elemValBody;
        if (!hasRes) {
            elemValBody = '<p class="no-res">⚠ Run analysis to see element stress/force.</p>';
        } else {
            const byType = {};
            for (const eid of eids) {
                const t = model.elements[eid].type;
                (byType[t] = byType[t] || []).push(eid);
            }
            let ev = '';
            for (const [typ, ids] of Object.entries(byType)) {
                ev += `<h3>${typ} — Section Forces</h3>`;

                // ── BAR2 / BAR3D (constant axial along element) ────────────
                if (typ === 'BAR2' || typ === 'BAR3D') {
                    const groups = ids.map(eid => {
                        const ef = results.elemForces[eid] || {};
                        const label = `Elem ${eid}  (L = ${fG(ef.L ?? '—')})`;
                        const rows = markMax([
                            [eid, '0.00 ~ 1.00', fN(ef.axial), fN(ef.stress)]
                        ]);
                        return { label, rows };
                    });
                    ev += sfTbl(`tbl-ev-${typ}`, ['N — Axial Force', 'σ — Axial Stress'], groups);

                    // ── BEAM2D (N linear, V linear, M parabolic) ───────────────
                } else if (typ === 'BEAM2D') {
                    const groups = ids.map(eid => {
                        const ef = results.elemForces[eid] || {};
                        const L = ef.L || 1, wy1 = ef.wy1 || 0, wy2 = ef.wy2 || 0;
                        const wLabel = wy1 === wy2 ? `wy=${fG(wy1)}` : `wy=${fG(wy1)}→${fG(wy2)}`;
                        const label = `Elem ${eid}  (L = ${fG(L)},  ${wLabel})`;
                        const rows = markMax(sfT.map(t => {
                            const xp = t * L;
                            const N = ef.N1 + (ef.N2 - ef.N1) * t;
                            const V = ef.V1 + (ef.V2 - ef.V1) * t;
                            const M = ef.M1 + ef.V1 * xp
                                + wy1 * xp * xp / 2
                                + (wy2 - wy1) * xp * xp * xp / (6 * L);
                            return [t === 0 ? eid : '', t.toFixed(2), fN(N), fN(V), fN(M)];
                        }));
                        return { label, rows };
                    });
                    ev += sfTbl('tbl-ev-beam2d', ['N — Axial', 'V — Shear', 'M — Moment'], groups);

                    // ── BEAM3D (N/Vy/Vz/T linear, My/Mz parabolic) ────────────
                } else if (typ === 'BEAM3D') {
                    const groups = ids.map(eid => {
                        const ef = results.elemForces[eid] || {};
                        const L = ef.L || 1;
                        const wy1 = ef.wy1 || 0, wy2 = ef.wy2 || 0;
                        const wz1 = ef.wz1 || 0, wz2 = ef.wz2 || 0;
                        const wyL = wy1 === wy2 ? `wy=${fG(wy1)}` : `wy=${fG(wy1)}→${fG(wy2)}`;
                        const wzL = wz1 === wz2 ? `wz=${fG(wz1)}` : `wz=${fG(wz1)}→${fG(wz2)}`;
                        const label = `Elem ${eid}  (L = ${fG(L)},  ${wyL},  ${wzL})`;
                        const rows = markMax(sfT.map(t => {
                            const xp = t * L;
                            const N = ef.N1 + (ef.N2 - ef.N1) * t;
                            const Vy = ef.Vy1 + (ef.Vy2 - ef.Vy1) * t;
                            const Vz = ef.Vz1 + (ef.Vz2 - ef.Vz1) * t;
                            const T = ef.T1 + (ef.T2 - ef.T1) * t;
                            const My = ef.My1 + ef.Vz1 * xp
                                + wz1 * xp * xp / 2
                                + (wz2 - wz1) * xp * xp * xp / (6 * L);
                            const Mz = ef.Mz1 + ef.Vy1 * xp
                                + wy1 * xp * xp / 2
                                + (wy2 - wy1) * xp * xp * xp / (6 * L);
                            return [t === 0 ? eid : '', t.toFixed(2), fN(N), fN(Vy), fN(Vz), fN(T), fN(My), fN(Mz)];
                        }));
                        return { label, rows };
                    });
                    ev += sfTbl('tbl-ev-beam3d',
                        ['N — Axial', 'Vy — Shear y', 'Vz — Shear z', 'T — Torsion', 'My — Moment y', 'Mz — Moment z'],
                        groups);

                } else {
                    ev += `<p class="note">${typ}: section forces not applicable for 2D solid elements — see Nodal Stress.</p>`;
                }
            }
            elemValBody = ev;
        }

        // ── 7. Nodal Stress ────────────────────────────────────────────────
        let stressSection = '';
        if (hasRes && results.nodeStress && Object.keys(results.nodeStress).length > 0) {
            const sRows = nids.map(nid => {
                const s = results.nodeStress[nid]; // [σxx,σyy,τxy,σmax,σmin,mises]
                if (!s) return null;
                return [nid, fN(s[0]), fN(s[1]), fN(s[2]), fN(s[3]), fN(s[4]), fN(s[5])];
            }).filter(Boolean);
            stressSection = sec('stress', '7. ', 'Nodal Stress (2D Elements)',
                tbl('tbl-stress', ['Node', 'σ_xx', 'σ_yy', 'τ_xy', 'σ_max', 'σ_min', 'von Mises'], sRows));
        }

        // ── Assemble HTML ──────────────────────────────────────────────────
        const tocLinks = [
            ['nodes', '1. Node Information'],
            ['mats', '2. Material Information'],
            ['props', '3. Section Properties'],
            ['elems', '4. Element Information'],
            ['nodal', '5. Nodal Values'],
            ['elemvals', '6. Element Stress/Force'],
            ...(stressSection ? [['stress', '7. Nodal Stress']] : []),
        ].map(([a, t]) => `<a href="#${a}">${t}</a>`).join('');

        return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>FEPS Report</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Segoe UI',Arial,sans-serif;font-size:15px;color:#1a1a1a;background:#f4f6f9;display:flex;min-height:100vh}
nav.sidebar{position:fixed;top:0;left:0;width:220px;height:100vh;background:#1e3a5f;color:#cfe2ff;overflow-y:auto;padding:16px 0;z-index:100;display:flex;flex-direction:column}
nav.sidebar .brand{font-size:17px;font-weight:700;color:#fff;padding:0 16px 12px;border-bottom:1px solid #2d5a8e}
nav.sidebar a{display:block;padding:8px 16px;color:#a8c7f0;text-decoration:none;font-size:14px;border-left:3px solid transparent;transition:all .15s}
nav.sidebar a:hover{color:#fff;background:#2d5a8e;border-left-color:#60a5fa}
nav.sidebar .print-btn{margin:16px;padding:9px;background:#2563eb;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:14px;font-weight:600}
nav.sidebar .print-btn:hover{background:#1d4ed8}
main{margin-left:220px;padding:28px 32px;width:100%;max-width:1300px}
header.rpt-header{background:#1e3a5f;color:#fff;border-radius:8px;padding:20px 24px;margin-bottom:24px}
header.rpt-header h1{font-size:22px;font-weight:700;margin-bottom:4px}
header.rpt-header p{font-size:14px;color:#a8c7f0}
.meta-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px;margin-top:12px}
.meta-card{background:rgba(255,255,255,.12);border-radius:6px;padding:8px 12px}
.meta-card .label{font-size:12px;color:#a8c7f0;text-transform:uppercase;letter-spacing:.5px}
.meta-card .value{font-size:17px;font-weight:700;color:#fff}
section{background:#fff;border-radius:8px;padding:20px 22px;margin-bottom:20px;box-shadow:0 1px 4px rgba(0,0,0,.08)}
section h2{font-size:16px;font-weight:700;color:#1e3a5f;margin-bottom:14px;padding-bottom:8px;border-bottom:2px solid #e2e8f0;display:flex;align-items:center;gap:8px}
.sec-num{display:inline-block;background:#2563eb;color:#fff;border-radius:4px;padding:1px 8px;font-size:13px;font-weight:700}
section h3{font-size:14px;font-weight:700;color:#334155;margin:14px 0 8px;padding:5px 10px;background:#f1f5f9;border-radius:4px;border-left:3px solid #2563eb}
table{width:100%;border-collapse:collapse;font-size:13.5px}
thead tr{background:#1e3a5f;color:#fff}
th{padding:8px 12px;text-align:left;font-weight:600;white-space:nowrap;font-size:13px}
td{padding:6px 12px;border-bottom:1px solid #e8ecf0;white-space:nowrap;font-family:'Courier New',monospace;font-size:13px}
tr.even td{background:#f8fafc}
tbody tr:hover td{background:#eff6ff}
.chk{color:#16a34a;font-size:15px}
.free{color:#94a3b8}
code{background:#f1f5f9;padding:1px 6px;border-radius:3px;font-size:12.5px;color:#1e3a5f}
.no-res{color:#dc2626;font-weight:600;padding:10px;background:#fef2f2;border-radius:6px;border:1px solid #fecaca}
.note{color:#666;font-size:13px;margin-bottom:8px;padding:6px 10px;background:#f8fafc;border-radius:4px;border-left:3px solid #94a3b8}
.sf-table .sf-group-hdr td{background:#dbeafe;color:#1e3a5f;font-weight:700;font-family:'Segoe UI',Arial,sans-serif;font-size:13px;padding:5px 12px;border-top:2px solid #93c5fd}
.sf-table tbody tr:first-child td{border-top:none}
.peak{color:#dc2626;font-weight:700}
@media print{
  nav.sidebar{display:none}
  main{margin-left:0;padding:12px}
  body{background:#fff}
  section{box-shadow:none;break-inside:avoid}
  header.rpt-header{background:#1e3a5f !important;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  thead tr{background:#1e3a5f !important;-webkit-print-color-adjust:exact;print-color-adjust:exact}
}
</style>
</head>
<body>
<nav class="sidebar">
  <div class="brand">FEPS Report</div>
  ${tocLinks}
  <button class="print-btn" onclick="window.print()">🖨 Print / Save PDF</button>
</nav>
<main>
  <header class="rpt-header">
    <h1>FEPS Analysis Report</h1>
    <p>Generated: ${date}</p>
    <div class="meta-grid">
      <div class="meta-card"><div class="label">Nodes</div><div class="value">${nids.length}</div></div>
      <div class="meta-card"><div class="label">Elements</div><div class="value">${eids.length}</div></div>
      <div class="meta-card"><div class="label">DOF / Node</div><div class="value">${dofNod}</div></div>
      <div class="meta-card"><div class="label">Dimension</div><div class="value">${dim}D</div></div>
      <div class="meta-card"><div class="label">Free DOFs</div><div class="value">${hasRes ? results.nf : '—'}</div></div>
      <div class="meta-card"><div class="label">Fixed DOFs</div><div class="value">${hasRes ? results.nc : '—'}</div></div>
      <div class="meta-card"><div class="label">Results</div><div class="value">${hasRes ? '✔ Yes' : '✘ No'}</div></div>
    </div>
  </header>

  ${sec('nodes', '1. ', 'Node Information', tbl('tbl-nodes', nodeHdr, nodeRows))}
  ${sec('mats', '2. ', 'Material Information', tbl('tbl-mats', matHdr, matRows))}
  ${sec('props', '3. ', 'Section Properties', tbl('tbl-props', propHdr, propRows))}
  ${sec('elems', '4. ', 'Element Information', tbl('tbl-elems', elemHdr, elemRows))}
  ${sec('nodal', '5. ', 'Nodal Values (Displacements &amp; Reactions)', nodalBody)}
  ${sec('elemvals', '6. ', 'Element Stress/Force', elemValBody)}
  ${stressSection}
</main>
</body>
</html>`;
    }

    function openReport() {
        const html = generateReport();
        const win = window.open('', '_blank');
        if (!win) { setStatus('Pop-up blocked — please allow pop-ups for this page.'); return; }
        win.document.open();
        win.document.write(html);
        win.document.close();
    }

    function updateColorBar() {
        const bar = $('color-bar'), rt = $('result-type').value;
        if (!results || !['sxx', 'syy', 'txy', 'smax', 'smin', 'mises'].includes(rt)) { bar.classList.add('hidden'); return; }
        FepsRenderer.computeStressRange();
        const range = FepsRenderer.getStressRange();
        if (!range) { bar.classList.add('hidden'); return; }
        // If beam-force contour, override labels to show force quantities
        const names = range.beamForce
            ? { sxx: 'Axial Force (N)', syy: 'Moment (Mz)', txy: 'τ_xy', smax: 'σ_max', smin: 'σ_min', mises: 'Mises' }
            : { sxx: 'σ_xx', syy: 'σ_yy', txy: 'τ_xy', smax: 'σ_max', smin: 'σ_min', mises: 'Mises' };
        let html = `<div class="cb-title">${names[rt]}</div>`;
        for (let i = 0; i < 10; i++) {
            const frac = 1 - i / 9;
            const val = range.min + (range.max - range.min) * frac;
            html += `<div class="cb-band"><div class="cb-swatch" style="background:${FepsRenderer.fracToColor(frac)}"></div>
        <span class="cb-label">${val.toExponential(2)}</span></div>`;
        }
        bar.innerHTML = html; bar.classList.remove('hidden');
    }

    // ══════════════════════════════════════════════════════════════════════
    //  ZOOM WINDOW MODE
    // ══════════════════════════════════════════════════════════════════════

    function toggleZoomWindowMode() {
        if (zoomWindowMode) {
            exitZoomWindowMode();
        } else {
            endSelMode(); endDrawMode();
            createNodeMode = false;
            $('btn-create-node').classList.remove('active');
            zoomWindowMode = true;
            $('btn-zoom-window').classList.add('active');
            canvas.style.cursor = 'crosshair';
            setStatus('Zoom Window mode — drag a rectangle to zoom into that area. ESC to cancel.');
        }
    }

    function exitZoomWindowMode() {
        zoomWindowMode = false;
        zoomWindowStart = null;
        zoomWindowDragging = false;
        $('btn-zoom-window').classList.remove('active');
        FepsRenderer.clearZoomRect();
        canvas.style.cursor = '';
        FepsRenderer.draw();
        setStatus('Zoom Window mode OFF');
    }

    // ══════════════════════════════════════════════════════════════════════
    //  CANVAS INTERACTION — drag selection + click
    // ══════════════════════════════════════════════════════════════════════

    function handleCanvasMouseDown(ev) {
        const rect = canvas.getBoundingClientRect();
        const sx = ev.clientX - rect.left, sy = ev.clientY - rect.top;

        // Middle button: pan.
        // Ctrl+drag: orbit rotation in 3D mode, pan in 2D.
        // Alt+drag:  twist rotation in 3D mode (swapped axes), pan in 2D.
        if (ev.button === 1 ||
            (ev.button === 0 && ev.ctrlKey) ||
            (ev.button === 0 && ev.altKey)) {
            if (ev.altKey && FepsRenderer.is3D()) {
                isRotatingAlt = true;
                rotateLast = { sx, sy };
            } else if (ev.ctrlKey && FepsRenderer.is3D()) {
                isRotating = true;
                rotateLast = { sx, sy };
            } else {
                isPanning = true;
                panLast = { sx, sy };
            }
            ev.preventDefault();
            return;
        }

        // Zoom window mode
        if (zoomWindowMode && ev.button === 0) {
            zoomWindowStart = { sx, sy };
            zoomWindowDragging = false;
            return;
        }

        // Rect/circle hole drag — capture mousedown
        if (drawingHole && holeDrawType !== 'polygon' && ev.button === 0 && !ev.ctrlKey && !ev.altKey) {
            const m = FepsRenderer.toModel(sx, sy);
            holeDrawDragStart = { sx, sy, mx: m.x, my: m.y };
            holeDrawDragging = false;
            ev.preventDefault();
            return;
        }

        if (drawMode) return;

        // Selection drag — left button only
        if (selectionMode && ev.button === 0) {
            dragStart = { sx, sy };
            isDragging = false;
            canvas.style.cursor = 'crosshair';
            return;
        }

        // Default mode: start pan on empty area — left-click only (right-click opens context menu)
        if (!createNodeMode && ev.button === 0) {
            const hitNid = FepsRenderer.hitTestNode(sx, sy, 12);
            if (!hitNid) {
                isPanning = true;
                panLast = { sx, sy };
            }
        }
    }

    function handleCanvasMove(ev) {
        const rect = canvas.getBoundingClientRect();
        const sx = ev.clientX - rect.left, sy = ev.clientY - rect.top;

        // Update cursor coordinates
        if (FepsRenderer.is3D()) {
            $('status-cursor').textContent = '3D view — Ctrl+drag: orbit  |  Alt+drag: twist';
        } else {
            const m = FepsRenderer.toModel(sx, sy);
            $('status-cursor').textContent = `(${m.x.toFixed(2)}, ${m.y.toFixed(2)})`;
        }

        // 3D orbit rotation (Ctrl+drag): horizontal → azimuth, vertical → elevation
        if (isRotating && rotateLast) {
            const dsx = sx - rotateLast.sx, dsy = sy - rotateLast.sy;
            FepsRenderer.applyRotate(dsx * 0.005, -dsy * 0.005);
            rotateLast = { sx, sy };
            FepsRenderer.draw();
            return;
        }

        // 3D twist rotation (Alt+drag): horizontal → elevation, vertical → azimuth
        if (isRotatingAlt && rotateLast) {
            const dsx = sx - rotateLast.sx, dsy = sy - rotateLast.sy;
            FepsRenderer.applyRotate(dsy * 0.005, -dsx * 0.005);
            rotateLast = { sx, sy };
            FepsRenderer.draw();
            return;
        }

        // Panning
        if (isPanning && panLast) {
            const dsx = sx - panLast.sx, dsy = sy - panLast.sy;
            FepsRenderer.applyPan(dsx, dsy);
            panLast = { sx, sy };
            FepsRenderer.draw();
            return;
        }

        // Zoom window drag
        if (zoomWindowMode && zoomWindowStart) {
            const dxs = sx - zoomWindowStart.sx, dys = sy - zoomWindowStart.sy;
            if (!zoomWindowDragging && (Math.abs(dxs) > 4 || Math.abs(dys) > 4)) {
                zoomWindowDragging = true;
            }
            if (zoomWindowDragging) {
                FepsRenderer.setZoomRect({ x1: zoomWindowStart.sx, y1: zoomWindowStart.sy, x2: sx, y2: sy });
                FepsRenderer.draw();
            }
            return;
        }

        // Rect/circle hole drag — live preview
        if (drawingHole && holeDrawType !== 'polygon' && holeDrawDragStart) {
            const dxs = sx - holeDrawDragStart.sx, dys = sy - holeDrawDragStart.sy;
            if (!holeDrawDragging && (Math.abs(dxs) > 4 || Math.abs(dys) > 4)) holeDrawDragging = true;
            if (holeDrawDragging) {
                const m = FepsRenderer.toModel(sx, sy);
                holePreviewPts = computeHoleShapePts(holeDrawDragStart.mx, holeDrawDragStart.my, m.x, m.y);
                FepsRenderer.setHolePreview(holePreviewPts);
                FepsRenderer.draw();
            }
            return;
        }

        // Draw-mode rubber band
        if (drawMode && drawNodeQueue.length > 0) {
            FepsRenderer.setDrawMouse(sx, sy); FepsRenderer.draw();
            return;
        }

        // Drag rectangle for selection
        if (dragStart && selectionMode) {
            const dxs = sx - dragStart.sx, dys = sy - dragStart.sy;
            if (!isDragging && (Math.abs(dxs) > 4 || Math.abs(dys) > 4)) {
                isDragging = true;
            }
            if (isDragging) {
                FepsRenderer.setDragRect({ x1: dragStart.sx, y1: dragStart.sy, x2: sx, y2: sy });
                FepsRenderer.draw();
            }
        }
    }

    function handleCanvasMouseUp(ev) {
        // End 3D orbit rotation (Ctrl+drag)
        if (isRotating) {
            isRotating = false;
            rotateLast = null;
            return;
        }
        // End 3D twist rotation (Alt+drag)
        if (isRotatingAlt) {
            isRotatingAlt = false;
            rotateLast = null;
            return;
        }

        // End panning
        if (isPanning) {
            isPanning = false;
            panLast = null;
            return;
        }

        // Zoom window finalize
        if (zoomWindowMode && zoomWindowStart && zoomWindowDragging) {
            const rect = canvas.getBoundingClientRect();
            const sx = ev.clientX - rect.left, sy = ev.clientY - rect.top;
            FepsRenderer.clearZoomRect();
            FepsRenderer.zoomToRect(zoomWindowStart.sx, zoomWindowStart.sy, sx, sy);
            FepsRenderer.draw();
            // Stay in zoom window mode for multiple zooms, exit with ESC or button
            zoomWindowStart = null;
            zoomWindowDragging = false;
            setStatus('Zoomed to window. Drag again or press ESC / click button to exit.');
            return;
        }
        if (zoomWindowMode) {
            zoomWindowStart = null;
            zoomWindowDragging = false;
            return;
        }

        // Rect/circle hole drag — finalize
        if (drawingHole && holeDrawType !== 'polygon' && holeDrawDragStart) {
            if (holeDrawDragging && holePreviewPts && holePreviewPts.length >= 3) {
                const area = polyArea(holePreviewPts);
                if (Math.abs(area) < 1e-10) {
                    setStatus('⚠ Hole has zero area. Drag further to define a shape.');
                } else {
                    holePolygons.push([...holePreviewPts]);
                    FepsRenderer.addClosedHole([...holePreviewPts]); // ← 홀 렌더러에 등록
                    updateHoleStatus();
                    $('btn-mesh-poly').disabled = false;
                    $('btn-add-hole').disabled = false;
                    const typeName = holeDrawType === 'rectangle' ? 'Rectangle' : 'Circle';
                    setStatus(`✓ ${typeName} hole ${holePolygons.length} added. Drag again to add more, or click "Mesh Polygon".`);
                }
            }
            holeDrawDragStart = null; holeDrawDragging = false; holePreviewPts = null;
            FepsRenderer.setHolePreview(null);
            FepsRenderer.draw();
            return;
        }

        if (!isDragging || !dragStart || !selectionMode) {
            // Not a box-drag — clean up any stale drag rect and let click event handle it
            FepsRenderer.clearDragRect();
            canvas.style.cursor = '';
            dragStart = null; isDragging = false;
            return;
        }

        const rect = canvas.getBoundingClientRect();
        const sx = ev.clientX - rect.left, sy = ev.clientY - rect.top;
        const shift = ev.shiftKey;

        FepsRenderer.clearDragRect();

        if (selectionMode === 'elements') {
            const eids = FepsRenderer.elementsInRect(dragStart.sx, dragStart.sy, sx, sy);
            const sel = shift ? FepsRenderer.getSelectedElements() : new Set();
            for (const eid of eids) sel.add(eid);
            FepsRenderer.setSelectedElements(sel);
            setStatus(`Box selected: ${sel.size} element(s)`);
        } else if (selectionMode === 'nodes') {
            const nids = FepsRenderer.nodesInRect(dragStart.sx, dragStart.sy, sx, sy);
            const sel = shift ? FepsRenderer.getSelectedNodes() : new Set();
            for (const nid of nids) sel.add(nid);
            FepsRenderer.setSelectedNodes(sel);
            setStatus(`Box selected: ${sel.size} node(s)`);
        }

        FepsRenderer.draw();
        updateSelInfo();
        canvas.style.cursor = '';
        justDragged = true;         // suppress the click event that fires right after mouseup
        dragStart = null; isDragging = false;
    }

    function handleCanvasWheel(ev) {
        ev.preventDefault();
        const rect = canvas.getBoundingClientRect();
        const sx = ev.clientX - rect.left, sy = ev.clientY - rect.top;
        const factor = ev.deltaY < 0 ? 1.15 : 1 / 1.15;
        FepsRenderer.applyZoom(factor, sx, sy);
        FepsRenderer.draw();
    }

    function handleCanvasClick(ev) {
        // Skip the spurious click that fires immediately after a box-drag mouseup
        if (justDragged) { justDragged = false; return; }
        // Skip if somehow still in a drag (shouldn't normally happen)
        if (isDragging) return;

        const rect = canvas.getBoundingClientRect();
        const sx = ev.clientX - rect.left, sy = ev.clientY - rect.top;
        const shift = ev.shiftKey;

        // ── DRAW MODE ──
        if (drawMode) {
            const hitNid = FepsRenderer.hitTestNode(sx, sy, 15);
            if (!hitNid) { setStatus('Click on an existing node'); return; }
            if (drawNodeQueue.length > 0 && drawNodeQueue[drawNodeQueue.length - 1] === hitNid) return;
            drawNodeQueue.push(hitNid);
            // Track unique nodes for polygon boundary (not cleared by finalizeElement)
            if (!polygonNodeList.includes(hitNid)) polygonNodeList.push(hitNid);
            FepsRenderer.pushDrawNode(hitNid);
            // Also add model coords so drawPolygon() draws the edge lines
            const _dn = model.nodes[hitNid];
            FepsRenderer.addPolygonPt(_dn.x, _dn.y);
            FepsRenderer.draw(); updateDrawStatus();
            // All types: just collect boundary nodes — element creation happens via Mesh Polygon
            return;
        }

        // ── SELECTION MODE: elements ──
        if (selectionMode === 'elements') {
            const hitEid = FepsRenderer.hitTestElement(sx, sy, 10);
            if (hitEid) {
                const sel = FepsRenderer.getSelectedElements();
                if (shift) { sel.has(hitEid) ? sel.delete(hitEid) : sel.add(hitEid); }
                else { sel.clear(); sel.add(hitEid); }
                FepsRenderer.setSelectedElements(sel);
                FepsRenderer.draw(); updateSelInfo();
                setStatus(`Element E${hitEid} ${sel.has(hitEid) ? 'selected' : 'deselected'}`);
            } else if (!shift) {
                FepsRenderer.setSelectedElements(new Set());
                FepsRenderer.draw(); updateSelInfo();
            }
            return;
        }

        // ── SELECTION MODE: nodes ──
        if (selectionMode === 'nodes') {
            const hitNid = FepsRenderer.hitTestNode(sx, sy, 12);
            if (hitNid) {
                const sel = FepsRenderer.getSelectedNodes();
                if (shift) { sel.has(hitNid) ? sel.delete(hitNid) : sel.add(hitNid); }
                else { sel.clear(); sel.add(hitNid); }
                FepsRenderer.setSelectedNodes(sel);
                FepsRenderer.draw(); updateSelInfo();
                setStatus(`Node ${hitNid} ${sel.has(hitNid) ? 'selected' : 'deselected'}`);
            } else if (!shift) {
                FepsRenderer.setSelectedNodes(new Set());
                FepsRenderer.draw(); updateSelInfo();
            }
            return;
        }

        // ── DEFAULT: hit-test node or place new node ──
        const hitNid = FepsRenderer.hitTestNode(sx, sy, 12);
        if (hitNid) {
            FepsRenderer.setSelectedNode(hitNid);
            FepsRenderer.draw(); setStatus(`Selected node ${hitNid}`);
            return;
        }
        if (!createNodeMode) return; // node placement only when toggle is ON
        const m = FepsRenderer.toModel(sx, sy);
        const snapped = snapCoord(m.x, m.y);
        model.nodes[nextNodeId] = { id: nextNodeId, x: snapped.x, y: snapped.y, z: 0 };
        model.header.numNod = Object.keys(model.nodes).length;
        undoStack.push({ type: 'node', id: nextNodeId });
        nextNodeId++;
        FepsRenderer.setModel(model); updateOpts(); FepsRenderer.draw(); updateModelInfo();
        setStatus(`Node ${nextNodeId - 1} placed at (${snapped.x}, ${snapped.y})`);
    }

    /** Snap coordinates to grid if snap is enabled */
    function snapCoord(x, y) {
        if ($('chk-snap-grid').checked) {
            const gs = parseFloat($('grid-spacing').value) || 1;
            x = Math.round(x / gs) * gs;
            y = Math.round(y / gs) * gs;
        }
        // Round to avoid floating point noise
        x = Math.round(x * 1e8) / 1e8;
        y = Math.round(y * 1e8) / 1e8;
        return { x, y };
    }

    function toggleCreateNodeMode() {
        createNodeMode = !createNodeMode;
        $('btn-create-node').classList.toggle('active', createNodeMode);
        if (createNodeMode) {
            endSelMode(); endDrawMode();
            setStatus('Create Node mode ON — click canvas to place nodes');
        } else {
            setStatus('Create Node mode OFF');
        }
    }

    // ── DOF configuration helper ──────────────────────────────────────────
    /**
     * Returns DOF labels based on model type.
     * dofNod=2,dim=2 → 2D truss/solid   (Fx,Fy)
     * dofNod=3,dim=2 → 2D beam/frame     (Fx,Fy,Mz)
     * dofNod=3,dim=3 → 3D truss (BAR3D) (Fx,Fy,Fz)
     * dofNod=6,dim=3 → 3D beam (BEAM3D) (Fx,Fy,Fz,Mx,My,Mz)
     */
    function getDofConfig() {
        const dofNod = model.header.dofNod || 2;
        const dim = model.header.dim || 2;
        if (dofNod === 2) return {
            bcLabels: ['Ux', 'Uy'],
            fLabels: ['Fx', 'Fy'],
            isMoment: [false, false]
        };
        if (dofNod === 3 && dim === 2) return {
            bcLabels: ['Ux', 'Uy', 'θz'],
            fLabels: ['Fx', 'Fy', 'Mz'],
            isMoment: [false, false, true]
        };
        if (dofNod === 3 && dim === 3) return {
            bcLabels: ['Ux', 'Uy', 'Uz'],
            fLabels: ['Fx', 'Fy', 'Fz'],
            isMoment: [false, false, false]
        };
        if (dofNod === 6) return {
            bcLabels: ['Ux', 'Uy', 'Uz', 'θx', 'θy', 'θz'],
            fLabels: ['Fx', 'Fy', 'Fz', 'Mx', 'My', 'Mz'],
            isMoment: [false, false, false, true, true, true]
        };
        return { bcLabels: [], fLabels: [], isMoment: [] };
    }

    // ── Shared helper: build BC checkboxes + displacement load inputs + force inputs ──
    function buildBCLoadUI(bcWrapId, loadWrapId, bc, cfg) {
        const { bcLabels, fLabels } = cfg;
        const bcWrap = $(bcWrapId);
        bcWrap.innerHTML = '';
        bcLabels.forEach((lbl, j) => {
            // Each DOF row: [✓ Fix Ux] [=] [displacement load input]
            const row = document.createElement('div');
            row.className = 'bc-disp-row';

            const label = document.createElement('label');
            label.className = 'chk';
            const chk = document.createElement('input');
            chk.type = 'checkbox';
            chk.id = `${bcWrapId}-${j}`;
            chk.checked = bc ? !!bc.tags[j] : false;
            label.appendChild(chk);
            label.appendChild(document.createTextNode(` Fix ${lbl}`));

            const eq = document.createElement('span');
            eq.className = 'bc-disp-label';
            eq.textContent = '=';

            const dispInp = document.createElement('input');
            dispInp.type = 'number';
            dispInp.step = 'any';
            dispInp.id = `${bcWrapId}-disp-${j}`;
            dispInp.value = bc ? ((bc.disps && bc.disps[j] != null) ? bc.disps[j] : 0) : 0;
            dispInp.disabled = !chk.checked;
            dispInp.title = 'Displacement load (prescribed displacement). 0 = fully fixed.';

            chk.addEventListener('change', () => {
                dispInp.disabled = !chk.checked;
                if (!chk.checked) dispInp.value = 0;
            });

            row.appendChild(label);
            row.appendChild(eq);
            row.appendChild(dispInp);
            bcWrap.appendChild(row);
        });
        const loadWrap = $(loadWrapId);
        loadWrap.innerHTML = '';
        fLabels.forEach((lbl, j) => {
            const row = document.createElement('div');
            row.className = 'field-row';
            const labelEl = document.createElement('label');
            labelEl.textContent = lbl;
            const inp = document.createElement('input');
            inp.type = 'number'; inp.step = 'any';
            inp.value = bc ? (bc.forces[j] || 0) : 0;
            inp.id = `${loadWrapId}-${j}`;
            row.appendChild(labelEl); row.appendChild(inp);
            loadWrap.appendChild(row);
        });
    }

    function readBCLoadUI(bcWrapId, loadWrapId, cfg) {
        const { bcLabels, fLabels } = cfg;
        const tags = [], forces = [], disps = [];
        bcLabels.forEach((_, j) => {
            const el = $(`${bcWrapId}-${j}`);
            const dispEl = $(`${bcWrapId}-disp-${j}`);
            tags.push(el && el.checked ? 1 : 0);
            disps.push(dispEl ? (parseFloat(dispEl.value) || 0) : 0);
        });
        fLabels.forEach((_, j) => {
            const el = $(`${loadWrapId}-${j}`);
            forces.push(el ? (parseFloat(el.value) || 0) : 0);
        });
        return { tags, forces, disps };
    }

    // ── Right-click context-menu dispatcher ──────────────────────────────

    function handleContextMenu(ev) {
        ev.preventDefault();

        // Ctrl+click / Alt+click in 3D mode are rotation gestures.
        // On macOS the OS fires contextmenu for Ctrl+click, but we must NOT clear
        // the rotation state that mousedown just set – just suppress the menu.
        if ((ev.ctrlKey || ev.altKey) && FepsRenderer.is3D()) return;

        // Clear any drag/zoom/rotate/pan state that was started by the preceding mousedown
        // (mouseup never fires on canvas when a modal intercepts further mouse events)
        dragStart = null;
        isRotating = false;
        isRotatingAlt = false;
        rotateLast = null;
        isPanning = false;
        panLast = null;
        FepsRenderer.clearDragRect();
        FepsRenderer.clearZoomRect();

        const rect = canvas.getBoundingClientRect();
        const sx = ev.clientX - rect.left, sy = ev.clientY - rect.top;

        if (selectionMode === 'elements') {
            const hitEid = FepsRenderer.hitTestElement(sx, sy, 10);
            if (hitEid) { openElemDialog(hitEid); return; }
        }

        // Node editor for both node-selection mode and default mode
        const hitNid = FepsRenderer.hitTestNode(sx, sy, 15);
        if (hitNid) {
            const sel = FepsRenderer.getSelectedNodes();
            if (selectionMode === 'nodes' && sel.size > 1 && sel.has(hitNid)) {
                // Multiple nodes selected → bulk BC/Load editor for all selected
                openBCLoadDialog();
            } else {
                openNodeCoordDialog(hitNid);
            }
        }
    }

    // ── Node Editor (coordinates + BC + load) ────────────────────────────

    let editingNodeId = null;

    function openNodeCoordDialog(nid) {
        editingNodeId = nid;
        const n = model.nodes[nid];
        const bc = model.bcs[nid] || null;
        const cfg = getDofConfig();

        $('modal-nc-info').textContent = `Node ${nid}`;
        $('dlg-nc-x').value = n.x;
        $('dlg-nc-y').value = n.y;
        $('dlg-nc-z').value = n.z || 0;

        buildBCLoadUI('dlg-nc-bc-wrap', 'dlg-nc-load-wrap', bc, cfg);

        $('modal-overlay').classList.remove('hidden');
        $('modal-nodecoord').classList.remove('hidden');
        $('dlg-nc-x').select();
    }

    function applyNodeCoord() {
        if (!editingNodeId || !model.nodes[editingNodeId]) { closeModal(); return; }
        const newX = parseFloat($('dlg-nc-x').value);
        const newY = parseFloat($('dlg-nc-y').value);
        const newZ = parseFloat($('dlg-nc-z').value) || 0;
        if (isNaN(newX) || isNaN(newY)) { setStatus('⚠ Invalid coordinates.'); return; }

        model.nodes[editingNodeId].x = newX;
        model.nodes[editingNodeId].y = newY;
        model.nodes[editingNodeId].z = newZ;

        const cfg = getDofConfig();
        const { tags, forces, disps } = readBCLoadUI('dlg-nc-bc-wrap', 'dlg-nc-load-wrap', cfg);
        const hasBC = tags.some(t => t !== 0) || forces.some(f => f !== 0);
        if (hasBC) {
            model.bcs[editingNodeId] = { node: editingNodeId, tags, forces, disps };
        } else {
            delete model.bcs[editingNodeId];
        }

        closeModal();
        FepsRenderer.setModel(model); updateOpts(); FepsRenderer.draw();
        setStatus(`Node ${editingNodeId} → (${newX}, ${newY}, ${newZ})`);
        editingNodeId = null;
    }

    // ── Element Editor ───────────────────────────────────────────────────

    // Maps element type → number of nodes (used for type-change compatibility filter)
    const ELEM_NODE_COUNT = {
        BAR2: 2, BEAM2D: 2, BAR3D: 2, BEAM3D: 2,
        TRIG3: 3, TRIG6: 6, QUAD4: 4, QUAD8: 8
    };
    // All supported types for the type dropdown
    const ALL_ELEM_TYPES = ['BAR2', 'BEAM2D', 'BAR3D', 'BEAM3D', 'TRIG3', 'TRIG6', 'QUAD4', 'QUAD8'];

    let editingElemId = null;

    function openElemDialog(eid) {
        editingElemId = eid;
        const e = model.elements[eid];

        $('modal-elem-info').textContent = `Element ${eid}`;
        $('dlg-elem-id').textContent = eid;

        // Type dropdown — only show types with same node count
        const nodeCount = e.nodes.length;
        const typeSelect = $('dlg-elem-type');
        typeSelect.innerHTML = '';
        for (const t of ALL_ELEM_TYPES) {
            if ((ELEM_NODE_COUNT[t] || 0) === nodeCount) {
                const opt = document.createElement('option');
                opt.value = t; opt.textContent = t;
                if (t === e.type) opt.selected = true;
                typeSelect.appendChild(opt);
            }
        }

        // Node inputs — one labeled row per node
        const wrap = $('dlg-elem-nodes-wrap');
        wrap.innerHTML = '';
        for (let i = 0; i < e.nodes.length; i++) {
            const row = document.createElement('div');
            row.className = 'field-row';
            const lbl = document.createElement('label');
            lbl.textContent = `N${i + 1}`;
            const inp = document.createElement('input');
            inp.type = 'number'; inp.min = '1'; inp.step = '1';
            inp.value = e.nodes[i];
            inp.id = `dlg-elem-node-${i}`;
            row.appendChild(lbl); row.appendChild(inp);
            wrap.appendChild(row);
        }

        // Material dropdown
        const matSel = $('dlg-elem-mat');
        matSel.innerHTML = '';
        for (const mid of Object.keys(model.materials).map(Number).sort((a, b) => a - b)) {
            const opt = document.createElement('option');
            opt.value = mid;
            const m = model.materials[mid];
            opt.textContent = `${mid} — E=${fmtNum(m.E)}, ν=${m.nu}`;
            if (mid === e.mat) opt.selected = true;
            matSel.appendChild(opt);
        }

        // Property dropdown
        const propSel = $('dlg-elem-prop');
        propSel.innerHTML = '';
        for (const pid of Object.keys(model.properties).map(Number).sort((a, b) => a - b)) {
            const opt = document.createElement('option');
            opt.value = pid;
            const p = model.properties[pid];
            opt.textContent = `${pid} — A=${fmtNum(p.A)}, t=${fmtNum(p.t)}, Iz=${fmtNum(p.Iz)}`;
            if (pid === e.pro) opt.selected = true;
            propSel.appendChild(opt);
        }

        // ── Element loads (eload + esurf) ──────────────────────────────────
        const etyp = e.type;
        const isBeam = ['BAR2', 'BAR3D', 'BEAM2D', 'BEAM3D'].includes(etyp);
        const is3D = etyp === 'BEAM3D';
        const isBar = etyp === 'BAR2' || etyp === 'BAR3D';
        const isSolid = ['QUAD4', 'TRIG3', 'QUAD8', 'TRIG6'].includes(etyp);

        // Show/hide fieldsets
        const setHid = (id, hidden) => { const el = $(id); if (el) el.classList.toggle('hidden', hidden); };
        setHid('dlg-eload-wrap', false);           // always show (beam: wx/wy/temp; solid: ΔT only)
        setHid('dlg-eload-wx-row', isSolid);         // no axial load for solids
        setHid('dlg-eload-wy-row', isSolid || isBar);// no transverse for solids or bars
        setHid('dlg-esurf-beam-wrap', !isBeam);
        setHid('dlg-esurf-solid-wrap', !isSolid);
        setHid('dlg-esurf-3d-rows', !is3D);
        setHid('dlg-eload-wz-row', !is3D);
        // Update legend
        const legend = $('dlg-eload-legend');
        if (legend) legend.textContent = isSolid ? 'Thermal Load' : 'Uniform Dist. Load (local frame)';

        if (isBeam) {
            const el = e.eload || [];
            $('dlg-eload-wx').value = el[0] || 0;
            $('dlg-eload-wy').value = isBar ? 0 : (el[1] || 0);
            $('dlg-eload-wz').value = is3D ? (el[2] || 0) : 0;
            // temp: BAR2/BAR3D → eload[1], BEAM2D → eload[2], BEAM3D → eload[3]
            $('dlg-eload-temp').value = isBar ? (el[1] || 0) : is3D ? (el[3] || 0) : (el[2] || 0);

            // Beam esurf (trapezoidal distributed load)
            const es = (e.esurf && !Array.isArray(e.esurf)) ? e.esurf : {};
            $('dlg-esurf-wy1').value = es.wy1 || 0;
            $('dlg-esurf-wy2').value = es.wy2 || 0;
            $('dlg-esurf-wz1').value = es.wz1 || 0;
            $('dlg-esurf-wz2').value = es.wz2 || 0;
        }

        if (isSolid) {
            // Thermal temperature for solid elements (stored as eload[0])
            const el = e.eload || [];
            $('dlg-eload-temp').value = el[0] || 0;

            // Populate solid edge face list
            const faceList = $('dlg-esurf-face-list');
            if (faceList) {
                faceList.innerHTML = '';
                const faces = Array.isArray(e.esurf) ? e.esurf : [];
                faces.forEach((face, idx) => {
                    const item = document.createElement('div');
                    item.className = 'esurf-face-item';
                    item.innerHTML =
                        `<span>Side ${face.side}: qx(${fmtNum(face.qx1)}→${fmtNum(face.qx2)}) qy(${fmtNum(face.qy1)}→${fmtNum(face.qy2)})</span>` +
                        `<button class="esurf-del-btn" data-idx="${idx}">✕</button>`;
                    item.querySelector('.esurf-del-btn').addEventListener('click', () => {
                        const e2 = model.elements[editingElemId];
                        if (Array.isArray(e2.esurf)) {
                            e2.esurf.splice(idx, 1);
                            if (e2.esurf.length === 0) e2.esurf = null;
                        }
                        openElemDialog(editingElemId);  // re-open to refresh list
                    });
                    faceList.appendChild(item);
                });
            }
        }

        $('modal-overlay').classList.remove('hidden');
        $('modal-elem').classList.remove('hidden');
    }

    function applyElemEdit() {
        if (!editingElemId || !model.elements[editingElemId]) { closeModal(); return; }
        const e = model.elements[editingElemId];

        // Type
        e.type = $('dlg-elem-type').value;

        // Nodes
        for (let i = 0; i < e.nodes.length; i++) {
            const v = parseInt($(`dlg-elem-node-${i}`).value, 10);
            if (!isNaN(v) && v > 0 && model.nodes[v]) {
                e.nodes[i] = v;
            } else {
                setStatus(`⚠ Node ${i + 1}: invalid or non-existent node ID.`);
                return;
            }
        }

        // Material & Property
        e.mat = parseInt($('dlg-elem-mat').value, 10);
        e.pro = parseInt($('dlg-elem-prop').value, 10);

        // ── Element loads ──────────────────────────────────────────────────
        const etyp = e.type;
        const isBeam = ['BAR2', 'BAR3D', 'BEAM2D', 'BEAM3D'].includes(etyp);
        const is3D = etyp === 'BEAM3D';
        const isBar = etyp === 'BAR2' || etyp === 'BAR3D';
        const isSolid = ['QUAD4', 'TRIG3', 'QUAD8', 'TRIG6'].includes(etyp);

        if (isBeam) {
            const wx = parseFloat($('dlg-eload-wx').value) || 0;
            const wy = parseFloat($('dlg-eload-wy').value) || 0;
            const wz = parseFloat($('dlg-eload-wz').value) || 0;
            const temp = parseFloat($('dlg-eload-temp').value) || 0;
            // Build eload matching each element type's convention
            if (isBar) e.eload = [wx, temp];
            else if (is3D) e.eload = [wx, wy, wz, temp];   // BEAM3D: [wx, wy, wz, ΔT]
            else e.eload = [wx, wy, temp];         // BEAM2D

            // Trapezoidal esurf (beam)
            const wy1 = parseFloat($('dlg-esurf-wy1').value) || 0;
            const wy2 = parseFloat($('dlg-esurf-wy2').value) || 0;
            const wz1 = parseFloat($('dlg-esurf-wz1').value) || 0;
            const wz2 = parseFloat($('dlg-esurf-wz2').value) || 0;
            if (wy1 !== 0 || wy2 !== 0 || wz1 !== 0 || wz2 !== 0) {
                e.esurf = { wy1, wy2, wz1, wz2 };
            } else {
                e.esurf = null;
            }
        }
        if (isSolid) {
            // Thermal load for solid elements: stored as eload[0] = ΔT
            const temp = parseFloat($('dlg-eload-temp').value) || 0;
            e.eload = temp ? [temp] : [];
        }
        // (Solid esurf faces are added/removed live via "Add Face" button — already in e.esurf)

        syncHeaderFromElements();
        closeModal();
        FepsRenderer.setModel(model); updateOpts(); FepsRenderer.draw();
        setStatus(`Element ${editingElemId} updated (${e.type}, mat=${e.mat}, prop=${e.pro})`);
        editingElemId = null;
    }

    // ══════════════════════════════════════════════════════════════════════
    //  HEADER SYNC  –  infer correct dofNod/dim/secType from element types
    // ══════════════════════════════════════════════════════════════════════
    function syncHeaderFromElements() {
        if (Object.keys(model.elements).length === 0) return;
        const types = new Set(Object.values(model.elements).map(e => e.type));
        let dofNod = 2, dim = 2;
        if (types.has('BEAM3D')) { dofNod = 6; dim = 3; }
        else if (types.has('BAR3D')) { dofNod = 3; dim = 3; }
        else if (types.has('BEAM2D')) { dofNod = 3; dim = 2; }
        // BAR2, QUAD4, TRIG3, QUAD8, TRIG6 → dofNod=2, dim=2 (default)

        model.header.dofNod = dofNod;
        model.header.dim = dim;
        const secId = dim * dofNod;
        model.header.secType = secId === 6 ? '2DBeam' : secId === 18 ? '3DBeam' : 'Solid';

        // Extend or trim BC tags / forces / disps to match new dofNod
        for (const nid of Object.keys(model.bcs).map(Number)) {
            const bc = model.bcs[nid];
            while (bc.tags.length < dofNod) bc.tags.push(0);
            while (bc.forces.length < dofNod) bc.forces.push(0);
            while (bc.disps.length < dofNod) bc.disps.push(0);
            bc.tags = bc.tags.slice(0, dofNod);
            bc.forces = bc.forces.slice(0, dofNod);
            bc.disps = bc.disps.slice(0, dofNod);
        }
    }

    // ── Helpers ───────────────────────────────────────────────────────────

    function syncIdsFromModel() {
        nextNodeId = Math.max(0, ...Object.keys(model.nodes).map(Number)) + 1;
        nextEleId = Math.max(0, ...Object.keys(model.elements).map(Number)) + 1;
        nextMatId = Math.max(0, ...Object.keys(model.materials).map(Number)) + 1;
        nextProId = Math.max(0, ...Object.keys(model.properties).map(Number)) + 1;
        // Reset material/property edit state when a new model is loaded
        editingMatId = null; editingProId = null;
        $('btn-add-mat').textContent = 'Add Material';
        $('btn-add-prop').textContent = 'Add Property';
        // Sync gravity UI from loaded model
        const g = model.gravity || { gx: 0, gy: 0, gz: 0 };
        $('grav-x').value = g.gx;
        $('grav-y').value = g.gy;
        $('grav-z').value = g.gz;
    }

    function updateModelInfo() {
        $('model-info').textContent =
            `${Object.keys(model.nodes).length} nodes, ${Object.keys(model.elements).length} elements`;
    }

    function fmtNum(v) {
        if (Math.abs(v) >= 1e5 || (Math.abs(v) < 0.01 && v !== 0)) return v.toExponential(2);
        return String(parseFloat(v.toFixed(4)));
    }

    function setStatus(msg) { $('status-msg').textContent = msg; }

    // ── Undo ─────────────────────────────────────────────────────────────

    function performUndo() {
        if (undoStack.length === 0) { setStatus('Nothing to undo'); return; }
        const action = undoStack.pop();
        if (action.type === 'node') {
            const nid = action.id;
            for (const eid of Object.keys(model.elements).map(Number)) {
                if (model.elements[eid].nodes.includes(nid)) delete model.elements[eid];
            }
            delete model.bcs[nid]; delete model.nodes[nid];
            model.header.numNod = Object.keys(model.nodes).length;
            nextNodeId = Math.max(1, ...Object.keys(model.nodes).map(Number), 0) + 1;
            nextEleId = Math.max(1, ...Object.keys(model.elements).map(Number), 0) + 1;
            setStatus(`Undid node ${nid}`);
        } else if (action.type === 'element') {
            delete model.elements[action.id];
            nextEleId = Math.max(1, ...Object.keys(model.elements).map(Number), 0) + 1;
            setStatus(`Undid element E${action.id}`);
        } else if (action.type === 'mesh') {
            // Atomic undo of an entire mesh operation
            for (const eid of action.elemIds) delete model.elements[eid];
            for (const nid of action.nodeIds) { delete model.nodes[nid]; delete model.bcs[nid]; }
            model.header.numNod = Object.keys(model.nodes).length;
            nextNodeId = Math.max(1, ...Object.keys(model.nodes).map(Number), 0) + 1;
            nextEleId = Math.max(1, ...Object.keys(model.elements).map(Number), 0) + 1;
            // Restore the polygon so the user can re-mesh
            closedPolygon = action.polygon || null;
            holePolygons = action.holes || [];
            // 렌더러 오버레이도 복원
            FepsRenderer.clearClosedPolygon();
            if (closedPolygon) FepsRenderer.setClosedPolygon([...closedPolygon]);
            for (const h of holePolygons) FepsRenderer.addClosedHole([...h]);
            $('btn-mesh-poly').disabled = !closedPolygon;
            $('btn-add-hole').disabled = !closedPolygon;
            updateHoleStatus();
            setStatus(`Undid mesh (removed ${action.elemIds.length} elements, ${action.nodeIds.length} nodes)`);
        }
        FepsRenderer.setModel(model);
        updateOpts(); FepsRenderer.draw(); refreshLists(); updateModelInfo();
    }

    function performUnselect() {
        FepsRenderer.clearSelection();
        endSelMode();
        FepsRenderer.draw(); updateSelInfo();
        setStatus('Selection cleared');
    }

    // ── Delete selected ─────────────────────────────────────────────────

    function performDelete() {
        const delType = $('del-type').value;
        const selEle = FepsRenderer.getSelectedElements();
        const selNod = FepsRenderer.getSelectedNodes();
        let count = 0;

        if (delType === 'element') {
            for (const eid of selEle) {
                if (model.elements[eid]) { delete model.elements[eid]; count++; }
            }
            FepsRenderer.setSelectedElements(new Set());
        } else if (delType === 'node') {
            for (const nid of selNod) {
                // Also remove elements referencing this node
                for (const eid of Object.keys(model.elements).map(Number)) {
                    if (model.elements[eid] && model.elements[eid].nodes.includes(nid)) {
                        delete model.elements[eid];
                    }
                }
                delete model.bcs[nid];
                delete model.nodes[nid];
                count++;
            }
            model.header.numNod = Object.keys(model.nodes).length;
            FepsRenderer.setSelectedNodes(new Set());
        } else if (delType === 'line') {
            // "Line" = 1D elements (BAR, BEAM) that are selected
            for (const eid of selEle) {
                const e = model.elements[eid];
                if (e && (e.type.startsWith('BAR') || e.type.startsWith('BEAM'))) {
                    delete model.elements[eid]; count++;
                }
            }
            FepsRenderer.setSelectedElements(new Set());
        }

        if (count === 0) {
            setStatus(`No ${delType}s to delete. Select objects first.`);
            return;
        }

        syncIdsFromModel();
        FepsRenderer.setModel(model);
        updateOpts(); FepsRenderer.draw(); refreshLists(); updateModelInfo(); updateSelInfo();
        setStatus(`Deleted ${count} ${delType}(s)`);
    }

})();
