/* ========================================================================
   renderer.js  –  Canvas 2D renderer for FEPS
   Handles both pre-process and post-process views.
   ======================================================================== */

const FepsRenderer = (() => {

    let canvas, ctx;
    let _model = null, _results = null, _opts = {};
    let _transform = { ox: 0, oy: 0, scale: 1 };
    // 3-D view state – azimuth/elevation orthographic projection
    let _view3D = { az: Math.PI / 6, el: Math.PI / 6, rx: 0, ry: 0, rz: 0, ux: 0, uy: 0, uz: 0 };


    // ── Selection state ──────────────────────────────────────────────────
    let _selectedElements = new Set();  // set of element IDs
    let _selectedNodes = new Set();     // set of node IDs

    // ── Drag-select rectangle (screen coords) ───────────────────────────
    let _dragRect = null;  // { x1, y1, x2, y2 } or null

    // ── Draw-mode state (element creation by clicking nodes) ──────────────
    let _drawMode = false;
    let _drawPending = [];        // node IDs clicked so far
    let _drawMouseScreen = null;  // last mouse position in screen coords

    // ── Colour palettes ────────────────────────────────────────────────────
    const MAT_COLORS = [
        'rgba(66,133,244,.25)', 'rgba(234,67,53,.25)', 'rgba(251,188,4,.25)',
        'rgba(52,168,83,.25)', 'rgba(171,71,188,.25)', 'rgba(255,112,67,.25)',
    ];
    const MAT_STROKE = [
        '#4285F4', '#EA4335', '#FBBC04', '#34A853', '#AB47BC', '#FF7043',
    ];

    function init(canvasEl) {
        canvas = canvasEl;
        ctx = canvas.getContext('2d');
        _updateView3D();
        resize();
        window.addEventListener('resize', resize);
    }

    function resize() {
        const r = canvas.parentElement.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        canvas.width = r.width * dpr;
        canvas.height = r.height * dpr;
        canvas.style.width = r.width + 'px';
        canvas.style.height = r.height + 'px';
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        draw();
    }

    // True once the first analysis for the current model has run and auto-scale is set.
    // Reset whenever the model geometry changes (new model, file open, undo) so the
    // next analysis recomputes auto-scale.  While locked, re-runs keep the same scale
    // so that visual deformation changes proportionally to actual displacement.
    let _autoScaleLocked = false;

    function setModel(model) {
        _model = model;
        // Geometry changed — unlock so the next analysis auto-scales fresh
        _autoScaleLocked = false;
        _autoDeformScale = 1;
    }
    function setResults(results) {
        _stressRange = null;
        if (!results) {
            // Model cleared — unlock for fresh auto-scale on next analysis
            _results = null;
            _autoScaleLocked = false;
            _autoDeformScale = 1;
            return;
        }
        _results = results;
        if (!_autoScaleLocked) {
            // First analysis after model load / undo: compute scale from geometry + maxDisp
            _computeAutoDeformScale();
            _autoScaleLocked = true;
        }
        // Re-analysis (material/load change): keep scale fixed → visual ∝ actual displacement
    }
    function setOpts(opts) { _opts = { ..._opts, ...opts }; _stressRange = null; }

    // ── Auto deformation scale ────────────────────────────────────────────
    // Computes the scale factor so that at scaleFactor=100 the maximum
    // nodal displacement equals 1/4 of the characteristic model length.
    // For 1D models: characteristic length = average element length.
    // For 2D solid: characteristic length = bounding-box diagonal.
    // Computed ONCE on first analysis; kept fixed for re-runs so visual
    // deformation changes proportionally to actual displacement (e.g. when E changes).
    // Stored in _autoDeformScale; actual applied sf = (scaleFactor/100) * _autoDeformScale.
    let _autoDeformScale = 1;

    function _computeAutoDeformScale() {
        if (!_model || !_results || !_results.nodeDisp) { _autoDeformScale = 1; return; }

        // Max displacement magnitude across all solved nodes
        let maxDisp = 0;
        for (const nid of Object.keys(_results.nodeDisp).map(Number)) {
            const d = _results.nodeDisp[nid] || [];
            const mag = Math.sqrt((d[0] || 0) ** 2 + (d[1] || 0) ** 2 + (d[2] || 0) ** 2);
            if (mag > maxDisp) maxDisp = mag;
        }
        if (maxDisp < 1e-20) { _autoDeformScale = 1; return; }

        // Characteristic model length:
        // — 1D models: average element length
        // — 2D solid: bounding-box diagonal (avoids tiny fallback that made
        //   deformation invisible on large-dimension models)
        const types1Ds = new Set(['BAR2', 'BAR3D', 'BEAM2D', 'BEAM3D']);
        let totalLen = 0, cnt = 0;
        for (const eid of Object.keys(_model.elements).map(Number)) {
            const e = _model.elements[eid];
            if (!types1Ds.has(e.type)) continue;
            const n1 = _model.nodes[e.nodes[0]], n2 = _model.nodes[e.nodes[1]];
            const dx = n2.x - n1.x, dy = n2.y - n1.y, dz = (n2.z || 0) - (n1.z || 0);
            totalLen += Math.sqrt(dx * dx + dy * dy + dz * dz);
            cnt++;
        }

        let avgModelLen;
        if (cnt > 0) {
            avgModelLen = totalLen / cnt;
        } else {
            // 2D solid model: use bounding-box diagonal of all nodes
            let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity;
            for (const nid of Object.keys(_model.nodes).map(Number)) {
                const n = _model.nodes[nid];
                if (n.x < xMin) xMin = n.x; if (n.x > xMax) xMax = n.x;
                if (n.y < yMin) yMin = n.y; if (n.y > yMax) yMax = n.y;
            }
            avgModelLen = Math.max(1e-10,
                Math.sqrt((xMax - xMin) * (xMax - xMin) + (yMax - yMin) * (yMax - yMin)));
        }

        // At scaleFactor=100: max drawn deformation = 0.25 × characteristic model length
        _autoDeformScale = 0.25 * avgModelLen / maxDisp;
    }

    /** Returns the effective deformation multiplier (model units) applied to displacements. */
    function _actualScaleFactor() {
        const sf = (_opts.scaleFactor != null ? _opts.scaleFactor : 100);
        return (sf / 100) * _autoDeformScale;
    }

    // ── Draw-mode API ────────────────────────────────────────────────────
    function setDrawMode(on) {
        _drawMode = on;
        _drawPending = []; _drawMouseScreen = null;
        if (on) _polygonPts = [];   // reset only when STARTING a new session; keep visible after end
    }
    function isDrawMode() { return _drawMode; }
    function getDrawPending() { return _drawPending; }
    function pushDrawNode(nid) { _drawPending.push(nid); }
    function resetDrawPending() { _drawPending = []; }
    function setDrawMouse(sx, sy) { _drawMouseScreen = { x: sx, y: sy }; }

    // ── Coordinate transform ──────────────────────────────────────────────

    /** Compute bbox of all nodes (+ deformed positions) and set _transform to fit. */
    function _fitBBox() {
        if (!_model || !Object.keys(_model.nodes).length) return;
        const nids = Object.keys(_model.nodes).map(Number);
        const mode3d = is3D();
        if (mode3d) _updateView3D();
        let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity;
        for (const id of nids) {
            const n = _model.nodes[id];
            if (mode3d) {
                // Project using view vectors (scale=1, origin=0 so sx_m = projected model coord)
                const z = n.z || 0;
                const sx_m = _view3D.rx * n.x + _view3D.rz * z;
                const sy_m = _view3D.ux * n.x + _view3D.uy * n.y + _view3D.uz * z;
                if (sx_m < xMin) xMin = sx_m; if (sx_m > xMax) xMax = sx_m;
                if (sy_m < yMin) yMin = sy_m; if (sy_m > yMax) yMax = sy_m;
            } else {
                let x = n.x, y = n.y;
                if (x < xMin) xMin = x; if (x > xMax) xMax = x;
                if (y < yMin) yMin = y; if (y > yMax) yMax = y;
                if (_opts.showDeformed && _results && _results.nodeDisp[id]) {
                    const sf = _actualScaleFactor();
                    const dx = x + _results.nodeDisp[id][0] * sf;
                    const dy = y + (_results.nodeDisp[id][1] || 0) * sf;
                    if (dx < xMin) xMin = dx; if (dx > xMax) xMax = dx;
                    if (dy < yMin) yMin = dy; if (dy > yMax) yMax = dy;
                }
            }
        }
        if (xMax <= xMin) { xMin -= 1; xMax += 1; }
        if (yMax <= yMin) { yMin -= 1; yMax += 1; }
        const pad = 0.15;
        const px = (xMax - xMin) * pad, py = (yMax - yMin) * pad;
        xMin -= px; xMax += px; yMin -= py; yMax += py;
        const r = canvas.parentElement.getBoundingClientRect();
        const W = r.width, H = r.height;
        const scale = Math.min(W / (xMax - xMin), H / (yMax - yMin));
        const midMx = (xMin + xMax) / 2, midMy = (yMin + yMax) / 2;
        _transform = { ox: W / 2 - midMx * scale, oy: H / 2 + midMy * scale, scale };
    }

    /** Reset to identity view (no nodes) or fit-all view (nodes exist). */
    function resetView() {
        if (_model && Object.keys(_model.nodes).length > 0) {
            _fitBBox();
        } else {
            _transform = { ox: 0, oy: 0, scale: 1 };
        }
    }

    /** Fit all current nodes into the viewport and redraw. */
    function zoomAll() { _fitBBox(); draw(); }

    function applyPan(dsx, dsy) { _transform.ox += dsx; _transform.oy += dsy; }

    function applyZoom(factor, pivotSx, pivotSy) {
        const newScale = Math.max(0.001, Math.min(1e6, _transform.scale * factor));
        const r = newScale / _transform.scale;
        _transform.ox = pivotSx - r * (pivotSx - _transform.ox);
        _transform.oy = pivotSy - r * (pivotSy - _transform.oy);
        _transform.scale = newScale;
    }

    // ── 3D projection ─────────────────────────────────────────────────────

    /** Recompute right/up view vectors from current az/el angles. */
    function _updateView3D() {
        const { az, el } = _view3D;
        _view3D.rx = Math.cos(az);
        _view3D.ry = 0;                               // Y contributes nothing to screen-X
        _view3D.rz = -Math.sin(az);
        _view3D.ux = -Math.sin(az) * Math.sin(el);
        _view3D.uy = Math.cos(el);
        _view3D.uz = -Math.cos(az) * Math.sin(el);
    }

    /** True when model has BAR3D/BEAM3D elements or any node with z ≠ 0. */
    function is3D() {
        if (!_model) return false;
        for (const e of Object.values(_model.elements)) {
            if (e.type === 'BAR3D' || e.type === 'BEAM3D') return true;
        }
        for (const n of Object.values(_model.nodes)) {
            if (Math.abs(n.z || 0) > 1e-12) return true;
        }
        return false;
    }

    /**
     * Orthographic 3D → 2D screen projection.
     * Right vector:  R = (rx, 0, rz)
     * Up vector:     U = (ux, uy, uz)
     * screen.x = ox + scale * (R · P)
     * screen.y = oy − scale * (U · P)
     */
    function project3D(mx, my, mz) {
        mz = mz || 0;
        const sx_m = _view3D.rx * mx + _view3D.rz * mz;
        const sy_m = _view3D.ux * mx + _view3D.uy * my + _view3D.uz * mz;
        return {
            x: _transform.ox + _transform.scale * sx_m,
            y: _transform.oy - _transform.scale * sy_m
        };
    }

    /** Rotate the 3D view (radians). Elevation clamped to ±89°. */
    function applyRotate(dAz, dEl) {
        _view3D.az += dAz;
        _view3D.el = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, _view3D.el + dEl));
        _updateView3D();
    }

    function toScreen(mx, my) {
        return {
            x: _transform.ox + mx * _transform.scale,
            y: _transform.oy - my * _transform.scale
        };
    }

    function toModel(sx, sy) {
        return {
            x: (sx - _transform.ox) / _transform.scale,
            y: -((sy - _transform.oy) / _transform.scale)
        };
    }

    function nodePos(nid, deformed) {
        const n = _model.nodes[nid];
        let x = n.x, y = n.y, z = n.z || 0;
        if (deformed && _results && _results.nodeDisp[nid]) {
            const sf = _actualScaleFactor();
            x += _results.nodeDisp[nid][0] * sf;
            y += (_results.nodeDisp[nid][1] || 0) * sf;
            z += (_results.nodeDisp[nid][2] || 0) * sf;
        }
        return is3D() ? project3D(x, y, z) : toScreen(x, y);
    }

    // ── Main draw ─────────────────────────────────────────────────────────

    function draw() {
        if (!canvas || !ctx) return;
        const r = canvas.parentElement.getBoundingClientRect();
        const W = r.width, H = r.height;
        ctx.clearRect(0, 0, W, H);

        // Background
        ctx.fillStyle = '#f4f5f7';
        ctx.fillRect(0, 0, W, H);

        // Grid (model-aligned if transform available)
        drawGrid(W, H);

        if (!_model || !Object.keys(_model.nodes).length) {
            drawEmptyState(W, H);
            return;
        }

        const showDef = _opts.showDeformed && _results;

        // Ghost shape
        if (_opts.showGhost && showDef) {
            drawElements(false, true);
        }

        // Elements (current shape)
        drawElements(!!showDef, false);

        // BMD / SFD / AFD overlays (1D beam/truss diagrams)
        if (_results && _opts.resultType && ['bmd', 'sfd', 'axial', 'sfd_z', 'bmd_y', 'torsion'].includes(_opts.resultType)) {
            drawForceDiagram(_opts.resultType);
        }

        // Selection highlights
        drawSelectHighlights(!!showDef);

        // BC icons
        if (_opts.showBC) drawBC(!!showDef);

        // Load arrows (nodal BCs) + element surface loads
        if (_opts.showLoads) { drawLoads(!!showDef); drawEsurfLoads(!!showDef); }

        // Reaction arrows (post-process)
        if (_results && _opts.showBC) drawReactions(!!showDef);

        // Node symbols & labels
        drawNodes(!!showDef);

        // Polygon-in-progress
        if (_polygonPts && _polygonPts.length > 0) {
            drawPolygon();
        }

        // Hole shape preview (rect/circle drag)
        if (_holePreviewPts && _holePreviewPts.length > 0) {
            drawHolePreview();
        }

        // Draw-mode rubber band
        if (_drawMode && _drawPending.length > 0 && _drawMouseScreen) {
            drawRubberBand();
        }

        // Drag-select rectangle
        if (_dragRect) {
            drawDragRect();
        }

        // Zoom-window rectangle
        if (_zoomRect) {
            drawZoomRect();
        }

        // 3D axes indicator (bottom-left corner)
        if (is3D()) {
            drawAxes3D(W, H);
        }
    }

    function drawDragRect() {
        const r = _dragRect;
        const x = Math.min(r.x1, r.x2), y = Math.min(r.y1, r.y2);
        const w = Math.abs(r.x2 - r.x1), h = Math.abs(r.y2 - r.y1);
        ctx.setLineDash([4, 3]);
        ctx.strokeStyle = '#4f8cff';
        ctx.lineWidth = 1.5;
        ctx.fillStyle = 'rgba(79,140,255,.08)';
        ctx.fillRect(x, y, w, h);
        ctx.strokeRect(x, y, w, h);
        ctx.setLineDash([]);
    }

    // ── Zoom-window rectangle ──────────────────────────────────────────────
    let _zoomRect = null; // { x1, y1, x2, y2 } screen coords

    function setZoomRect(rect) { _zoomRect = rect; }
    function clearZoomRect() { _zoomRect = null; }

    function drawZoomRect() {
        const r = _zoomRect;
        const x = Math.min(r.x1, r.x2), y = Math.min(r.y1, r.y2);
        const w = Math.abs(r.x2 - r.x1), h = Math.abs(r.y2 - r.y1);
        // Filled semi-transparent
        ctx.fillStyle = 'rgba(76,175,80,.08)';
        ctx.fillRect(x, y, w, h);
        // Dashed border
        ctx.setLineDash([5, 3]);
        ctx.strokeStyle = '#388E3C';
        ctx.lineWidth = 2;
        ctx.strokeRect(x, y, w, h);
        ctx.setLineDash([]);
        // Magnifier icon in corner
        const ix = x + w - 18, iy = y + 6;
        ctx.strokeStyle = '#388E3C';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(ix, iy + 5, 5, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(ix + 4, iy + 9);
        ctx.lineTo(ix + 8, iy + 13);
        ctx.stroke();
    }

    /** Draw XYZ axes indicator in the bottom-left corner (3D mode). */
    function drawAxes3D(W, H) {
        const size = 70, margin = 16;
        const cx = margin + size / 2;
        const cy = H - margin - size / 2;
        const len = size * 0.37;

        ctx.save();

        // Background circle
        ctx.beginPath();
        ctx.arc(cx, cy, size / 2, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,255,255,0.88)';
        ctx.fill();
        ctx.strokeStyle = '#ccc';
        ctx.lineWidth = 1;
        ctx.stroke();

        // Each axis: [screen-x multiplier, screen-y multiplier (canvas-Y-flipped)]
        // For unit vector along model axis A projected to screen:
        //   dx = view3D.rA * len,  dy = -view3D.uA * len
        const axes = [
            { dx: _view3D.rx,  dy: _view3D.ux, color: '#E53935', label: 'X' },
            { dx: 0,           dy: _view3D.uy, color: '#43A047', label: 'Y' },
            { dx: _view3D.rz,  dy: _view3D.uz, color: '#1E88E5', label: 'Z' },
        ];

        for (const ax of axes) {
            const ex = cx + ax.dx * len;
            const ey = cy - ax.dy * len;   // canvas Y is flipped
            const adx = ex - cx, ady = ey - cy;
            const aLen = Math.sqrt(adx * adx + ady * ady) || 1;
            const ux2 = adx / aLen, uy2 = ady / aLen;

            // Shaft
            ctx.beginPath();
            ctx.moveTo(cx, cy);
            ctx.lineTo(ex, ey);
            ctx.strokeStyle = ax.color;
            ctx.lineWidth = 2.2;
            ctx.stroke();

            // Arrowhead
            const al = 7;
            ctx.beginPath();
            ctx.moveTo(ex, ey);
            ctx.lineTo(ex - al * ux2 + al * 0.38 * uy2, ey - al * uy2 - al * 0.38 * ux2);
            ctx.lineTo(ex - al * ux2 - al * 0.38 * uy2, ey - al * uy2 + al * 0.38 * ux2);
            ctx.closePath();
            ctx.fillStyle = ax.color;
            ctx.fill();

            // Label
            ctx.fillStyle = ax.color;
            ctx.font = 'bold 11px Inter, sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(ax.label, cx + ax.dx * len * 1.38, cy - ax.dy * len * 1.38);
        }

        ctx.restore();
    }

    /** Zoom the view so the screen rectangle [sx1,sy1]-[sx2,sy2] fills the canvas */
    function zoomToRect(sx1, sy1, sx2, sy2) {
        const r = canvas.parentElement.getBoundingClientRect();
        const W = r.width, H = r.height;
        const lx = Math.min(sx1, sx2), ly = Math.min(sy1, sy2);
        const rw = Math.abs(sx2 - sx1), rh = Math.abs(sy2 - sy1);
        if (rw < 5 || rh < 5) return;

        const mTL = toModel(lx, ly);
        const mBR = toModel(lx + rw, ly + rh);
        const mW = Math.abs(mBR.x - mTL.x);
        const mH = Math.abs(mBR.y - mTL.y);
        if (mW < 1e-12 || mH < 1e-12) return;

        const midMx = (mTL.x + mBR.x) / 2;
        const midMy = (mTL.y + mBR.y) / 2;
        const newScale = Math.min(W / mW, H / mH) * 0.95;
        _transform = { ox: W / 2 - midMx * newScale, oy: H / 2 + midMy * newScale, scale: newScale };
    }

    function drawGrid(W, H) {
        // In 3D mode draw a simple background pixel grid (no model-coord projection)
        if (is3D()) {
            const spacing = 40;
            ctx.strokeStyle = '#e0e0e4';
            ctx.lineWidth = 0.5;
            ctx.beginPath();
            for (let x = 0; x < W; x += spacing) { ctx.moveTo(x, 0); ctx.lineTo(x, H); }
            for (let y = 0; y < H; y += spacing) { ctx.moveTo(0, y); ctx.lineTo(W, y); }
            ctx.stroke();
            return;
        }

        const gs = _opts.gridSpacing || 0;
        const gridCount = _opts.gridCount || 10; // number of grid lines each direction from origin
        ctx.strokeStyle = '#e0e0e4';
        ctx.lineWidth = 0.5;

        if (gs > 0 && _transform && _transform.scale) {
            // Grid in model coordinates (aligned to model units)
            const screenSpacing = gs * _transform.scale;

            // Don't draw if grid is too fine (would flood the screen)
            if (screenSpacing < 5) {
                // Fallback: draw sparse screen grid
                const spacing = 40;
                ctx.beginPath();
                for (let x = 0; x < W; x += spacing) { ctx.moveTo(x, 0); ctx.lineTo(x, H); }
                for (let y = 0; y < H; y += spacing) { ctx.moveTo(0, y); ctx.lineTo(W, y); }
                ctx.stroke();
                return;
            }

            // Compute visible model range
            const topLeft = toModel(0, 0);
            const botRight = toModel(W, H);
            const visXMin = Math.min(topLeft.x, botRight.x);
            const visXMax = Math.max(topLeft.x, botRight.x);
            const visYMin = Math.min(topLeft.y, botRight.y);
            const visYMax = Math.max(topLeft.y, botRight.y);

            // Grid covers the visible area (never clips to ±gridCount from origin)
            const drawXMin = Math.floor(visXMin / gs) * gs;
            const drawXMax = Math.ceil(visXMax / gs) * gs;
            const drawYMin = Math.floor(visYMin / gs) * gs;
            const drawYMax = Math.ceil(visYMax / gs) * gs;

            // Safety: bail if too many lines (shouldn't happen but guards edge cases)
            if ((drawXMax - drawXMin) / gs > gridCount * 4 ||
                (drawYMax - drawYMin) / gs > gridCount * 4) {
                const spacing = 40;
                ctx.beginPath();
                for (let x = 0; x < W; x += spacing) { ctx.moveTo(x, 0); ctx.lineTo(x, H); }
                for (let y = 0; y < H; y += spacing) { ctx.moveTo(0, y); ctx.lineTo(W, y); }
                ctx.stroke();
                return;
            }

            // Lines span the full canvas height/width
            const lineTop = 0, lineBot = H, lineLeft = 0, lineRight = W;

            // Draw minor grid lines
            ctx.beginPath();
            for (let mx = drawXMin; mx <= drawXMax; mx += gs) {
                if (Math.abs(mx) < gs * 1e-6) continue; // skip origin
                const sp = toScreen(mx, 0);
                ctx.moveTo(sp.x, lineTop); ctx.lineTo(sp.x, lineBot);
            }
            for (let my = drawYMin; my <= drawYMax; my += gs) {
                if (Math.abs(my) < gs * 1e-6) continue; // skip origin
                const sp = toScreen(0, my);
                ctx.moveTo(lineLeft, sp.y); ctx.lineTo(lineRight, sp.y);
            }
            ctx.stroke();

            // Draw heavier axes at origin
            const oxPt = toScreen(0, 0);
            ctx.strokeStyle = '#999';
            ctx.lineWidth = 1.4;
            ctx.beginPath();
            ctx.moveTo(oxPt.x, lineTop); ctx.lineTo(oxPt.x, lineBot);
            ctx.moveTo(lineLeft, oxPt.y); ctx.lineTo(lineRight, oxPt.y);
            ctx.stroke();

            // Draw coordinate labels along axes
            ctx.font = '10px "JetBrains Mono", monospace';
            ctx.fillStyle = '#888';

            // X-axis labels (along bottom of axes)
            const labelSkip = Math.max(1, Math.ceil(30 / screenSpacing)); // skip labels if too dense
            for (let mx = drawXMin; mx <= drawXMax; mx += gs * labelSkip) {
                if (Math.abs(mx) < gs * 1e-6) continue;
                const sp = toScreen(mx, 0);
                if (sp.x < 10 || sp.x > W - 10) continue;
                ctx.textAlign = 'center';
                ctx.fillText(fmtGridLabel(mx), sp.x, oxPt.y + 14);
            }

            // Y-axis labels (along left of axes)
            for (let my = drawYMin; my <= drawYMax; my += gs * labelSkip) {
                if (Math.abs(my) < gs * 1e-6) continue;
                const sp = toScreen(0, my);
                if (sp.y < 10 || sp.y > H - 10) continue;
                ctx.textAlign = 'right';
                ctx.fillText(fmtGridLabel(my), oxPt.x - 6, sp.y + 4);
            }

            // Origin label
            ctx.textAlign = 'right';
            ctx.fillStyle = '#666';
            ctx.font = 'bold 10px "JetBrains Mono", monospace';
            ctx.fillText('0', oxPt.x - 5, oxPt.y + 13);

            // Draw faint boundary rectangle at ±gridCount*gs from origin (reference domain)
            const domXMin = -gridCount * gs, domXMax = gridCount * gs;
            const domYMin = -gridCount * gs, domYMax = gridCount * gs;
            const bTL = toScreen(domXMin, domYMax);
            const bBR = toScreen(domXMax, domYMin);
            const bx = Math.max(0, bTL.x), by = Math.max(0, bTL.y);
            const bw = Math.min(W, bBR.x) - bx, bh = Math.min(H, bBR.y) - by;
            if (bw > 0 && bh > 0) {
                ctx.strokeStyle = 'rgba(120,120,120,0.25)';
                ctx.lineWidth = 1;
                ctx.setLineDash([4, 4]);
                ctx.strokeRect(bx, by, bw, bh);
                ctx.setLineDash([]);
            }

        } else {
            // Default fixed-pixel grid
            const spacing = 40;
            ctx.beginPath();
            for (let x = 0; x < W; x += spacing) { ctx.moveTo(x, 0); ctx.lineTo(x, H); }
            for (let y = 0; y < H; y += spacing) { ctx.moveTo(0, y); ctx.lineTo(W, y); }
            ctx.stroke();
        }
    }

    /** Format a grid coordinate label compactly */
    function fmtGridLabel(v) {
        const av = Math.abs(v);
        if (av >= 1e4 || (av < 0.01 && av > 0)) return v.toExponential(1);
        // Remove trailing zeros
        let s = v.toFixed(4);
        s = s.replace(/\.?0+$/, '');
        return s;
    }

    function drawEmptyState(W, H) {
        ctx.fillStyle = '#aaa';
        ctx.font = '14px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Open a .inp file or click on the canvas to place nodes', W / 2, H / 2);
        ctx.font = '12px Inter, sans-serif';
        ctx.fillStyle = '#bbb';
        ctx.fillText('Use the Pre-Process panel on the left to define materials, BCs, and loads', W / 2, H / 2 + 24);
    }

    // ── Hermite cubic shape functions (ξ = 0..1) ─────────────────────────
    //   v(ξ) = H1*v1 + H2*(L*θ1) + H3*v2 + H4*(L*θ2)

    function hermiteH1(xi) { return 1 - 3 * xi * xi + 2 * xi * xi * xi; }
    function hermiteH2(xi) { return xi - 2 * xi * xi + xi * xi * xi; }  // multiply by L
    function hermiteH3(xi) { return 3 * xi * xi - 2 * xi * xi * xi; }
    function hermiteH4(xi) { return -xi * xi + xi * xi * xi; }          // multiply by L

    // ── 2D 요소의 렌더링용 코너 절점 수 반환 ─────────────────────────────
    // 고차 요소(QUAD8, QUAD9, TRIG6 등)도 코너만 사용해 외곽선 그리기

    function _solidCorners(typ) {
        const table = {
            QUAD4: 4, QUAD5: 4, QUAD8: 4, QUAD9: 4,
            TRIG3: 3, TRIG6: 3
        };
        if (table[typ] !== undefined) return table[typ];
        // 레지스트리 요소
        if (typeof FepsElementRegistry !== 'undefined' && FepsElementRegistry.has(typ)) {
            const d = FepsElementRegistry.get(typ);
            if (d.category === 'solid2d') return d.cornerNodes || (d.triangular ? 3 : 4);
        }
        return 0;   // 1D 또는 미지 요소
    }

    // ── Draw elements ─────────────────────────────────────────────────────

    function drawElements(deformed, ghost) {
        const eids = Object.keys(_model.elements).map(Number).sort((a, b) => a - b);
        const isStressContour = _results && _opts.resultType && _opts.resultType !== 'none' &&
            !['bmd', 'sfd', 'axial', 'sfd_z', 'bmd_y', 'torsion'].includes(_opts.resultType);
        const compIdx = isStressContour ? { sxx: 0, syy: 1, txy: 2, smax: 3, smin: 4, mises: 5 }[_opts.resultType] : undefined;

        // ── PASS 1: Fill all 2D elements (contour or material color) ──
        if (!ghost) {
            for (const eid of eids) {
                const e = _model.elements[eid];
                const typ = e.type;
                if (typ.startsWith('BAR') || typ.startsWith('BEAM') ||
                    typ.startsWith('TIMBEAM') || typ === 'BAR2_3N') continue;

                const corners = _solidCorners(typ);
                if (corners === 0) continue;
                const pts = [];
                for (let j = 0; j < corners; j++) pts.push(nodePos(e.nodes[j], deformed));

                if (_opts.colorByMaterial) {
                    const mi = (e.mat - 1) % MAT_COLORS.length;
                    ctx.beginPath();
                    ctx.moveTo(pts[0].x, pts[0].y);
                    for (let j = 1; j < corners; j++) ctx.lineTo(pts[j].x, pts[j].y);
                    ctx.closePath();
                    ctx.fillStyle = MAT_COLORS[mi];
                    ctx.fill();
                } else if (isStressContour && compIdx !== undefined && _results.nodeStress) {
                    drawGouraudPoly(pts, e.nodes, compIdx, corners);
                }
            }
        }

        // ── PASS 1b: Beam / Truss contour — colour painted ON element ────
        if (!ghost && isStressContour) {
            // Ensure range is computed (handles beam-only models with no nodeStress)
            if (!_stressRange) computeStressRange();
            if (_stressRange && _stressRange.beamForce) {
                const numSeg = 30;
                for (const eid of eids) {
                    const e  = _model.elements[eid];
                    const typ = e.type;
                    const _isBeamLike = typ.startsWith('BAR') || typ.startsWith('BEAM') ||
                                        typ.startsWith('TIMBEAM');
                    if (!_isBeamLike) continue;
                    const ef = _results.elemForces[eid];
                    if (!ef) continue;

                    const p1 = nodePos(e.nodes[0], deformed);
                    // 끝단 절점: TIMBEAM2D_3N 의 경우 nodes[2]
                    const lastNodeIdx = e.nodes.length - 1;
                    const p2 = nodePos(e.nodes[lastNodeIdx], deformed);

                    // value function: section force at parameter t ∈ [0,1]
                    let valFn;
                    if (typ === 'BAR2' || typ === 'BAR3D' || typ === 'BAR2_3N') {
                        if (_opts.resultType !== 'sxx') continue;
                        valFn = () => ef.axial;
                    } else if (typ === 'BEAM2D') {
                        if (_opts.resultType === 'sxx') {
                            valFn = t => -ef.N1 + (ef.N1 + ef.N2) * t;
                        } else { // syy = moment
                            valFn = t => {
                                const xp = t * ef.L;
                                return -ef.M1 + ef.V1 * xp
                                    + (ef.wy1 || 0) * xp * xp / 2
                                    + ((ef.wy2 || 0) - (ef.wy1 || 0)) * xp * xp * xp / (6 * ef.L);
                            };
                        }
                    } else if (typ === 'BEAM3D') {
                        if (_opts.resultType === 'sxx') {
                            valFn = t => -ef.N1 + (ef.N1 + ef.N2) * t;
                        } else { // syy = moment Mz
                            valFn = t => {
                                const xp = t * ef.L;
                                return -ef.Mz1 + ef.Vy1 * xp
                                    + (ef.wy1 || 0) * xp * xp / 2
                                    + ((ef.wy2 || 0) - (ef.wy1 || 0)) * xp * xp * xp / (6 * ef.L);
                            };
                        }
                    } else if (typ.startsWith('TIMBEAM')) {
                        // 티모셴코 보: 선형 분포 (분포하중 없음)
                        if (_opts.resultType === 'sxx') {
                            valFn = t => (1 - t) * ef.N1 + t * (-ef.N2);
                        } else {
                            valFn = t => (1 - t) * ef.M1 + t * (-ef.M2);
                        }
                    } else { continue; }

                    ctx.lineWidth = 8;
                    ctx.setLineDash([]);
                    for (let i = 0; i < numSeg; i++) {
                        const t0  = i / numSeg, t1 = (i + 1) / numSeg;
                        const col = stressColor(valFn((t0 + t1) * 0.5));
                        ctx.beginPath();
                        ctx.moveTo(p1.x + (p2.x - p1.x) * t0, p1.y + (p2.y - p1.y) * t0);
                        ctx.lineTo(p1.x + (p2.x - p1.x) * t1, p1.y + (p2.y - p1.y) * t1);
                        ctx.strokeStyle = col;
                        ctx.stroke();
                    }
                }
            }
        }

        // ── PASS 2: Draw all element outlines + 1D elements ──
        for (const eid of eids) {
            const e = _model.elements[eid];
            const typ = e.type;
            const nn = FepsSolver.elNode(typ);
            if (nn === 0) continue;

            const is1D = typ.startsWith('BAR') || typ.startsWith('BEAM') ||
                         typ.startsWith('TIMBEAM') || typ === 'BAR2_3N';
            if (is1D) {
                if (ghost) {
                    ctx.setLineDash([5, 4]);
                    ctx.strokeStyle = '#c0c3cc';
                    ctx.lineWidth = 1;
                } else if (_results && _results.elemForces[eid] && typ.startsWith('BAR')) {
                    const f = _results.elemForces[eid].axial || 0;
                    ctx.setLineDash([]);
                    if (isStressContour && _stressRange && _stressRange.beamForce) {
                        ctx.strokeStyle = 'rgba(0,0,0,0.55)';
                        ctx.lineWidth = 1.5;
                    } else {
                        ctx.strokeStyle = f > 1e-10 ? '#E53935' : f < -1e-10 ? '#1E88E5' : '#333';
                        ctx.lineWidth = 2;
                    }
                } else {
                    ctx.setLineDash([]);
                    if (isStressContour && _stressRange && _stressRange.beamForce) {
                        ctx.strokeStyle = 'rgba(0,0,0,0.55)';
                        ctx.lineWidth = 1.5;
                    } else {
                        ctx.strokeStyle = ghost ? '#c0c3cc' : '#333';
                        ctx.lineWidth = ghost ? 1 : 1.5;
                    }
                }

                if (deformed && (typ === 'BEAM2D' || typ === 'TIMBEAM2D_2N') &&
                    _results && _results.nodeDisp) {
                    // Hermite cubic deformed shape for 2-node Timoshenko beam
                    drawBeamCubic(e, ghost);
                } else if (e.nodes.length > 2) {
                    // 다절점 1D 요소 (BAR2_3N, TIMBEAM2D_3N 등): 전체 절점 통과
                    const pts = e.nodes.map(nid => nodePos(nid, deformed));
                    ctx.beginPath();
                    ctx.moveTo(pts[0].x, pts[0].y);
                    for (let k = 1; k < pts.length; k++) ctx.lineTo(pts[k].x, pts[k].y);
                    ctx.stroke();
                } else {
                    const p1 = nodePos(e.nodes[0], deformed);
                    const p2 = nodePos(e.nodes[1], deformed);
                    ctx.beginPath();
                    ctx.moveTo(p1.x, p1.y);
                    ctx.lineTo(p2.x, p2.y);
                    ctx.stroke();
                }
                ctx.setLineDash([]);
            } else {
                // 2D element outline
                const corners = _solidCorners(typ);
                if (corners === 0) continue;
                const pts = [];
                for (let j = 0; j < corners; j++) pts.push(nodePos(e.nodes[j], deformed));

                ctx.beginPath();
                ctx.moveTo(pts[0].x, pts[0].y);
                for (let j = 1; j < corners; j++) ctx.lineTo(pts[j].x, pts[j].y);
                ctx.closePath();

                if (ghost) {
                    ctx.setLineDash([5, 4]);
                    ctx.strokeStyle = '#c0c3cc';
                    ctx.lineWidth = 1;
                    ctx.stroke();
                    ctx.setLineDash([]);
                } else {
                    ctx.strokeStyle = '#333';
                    ctx.lineWidth = 1.2;
                    ctx.stroke();
                }
            }
        }

        // Element IDs
        if (_opts.showEleIDs && !ghost) {
            ctx.font = '14px "JetBrains Mono", monospace';
            ctx.fillStyle = '#888';
            ctx.textAlign = 'center';
            for (const eid of eids) {
                const e = _model.elements[eid];
                const nn2 = FepsSolver.elNode(e.type);
                let cx = 0, cy = 0;
                for (let j = 0; j < nn2; j++) {
                    const p = nodePos(e.nodes[j], deformed);
                    cx += p.x; cy += p.y;
                }
                cx /= nn2; cy /= nn2;
                ctx.fillText('E' + eid, cx, cy + 3);
            }
        }
    }

    /**
     * Draw a BEAM2D element using Hermite cubic polynomial deformed shape.
     * Uses end-node DOFs: (u1, v1, θ1) and (u2, v2, θ2).
     */
    function drawBeamCubic(e, ghost) {
        const nd1 = _model.nodes[e.nodes[0]];
        const nd2 = _model.nodes[e.nodes[1]];
        const dx = nd2.x - nd1.x, dy = nd2.y - nd1.y;
        const L = Math.sqrt(dx * dx + dy * dy);
        if (L < 1e-12) return;
        const cosA = dx / L, sinA = dy / L;
        const sf = _actualScaleFactor();

        // Global DOFs
        const u1g = _results.nodeDisp[e.nodes[0]] || [0, 0, 0];
        const u2g = _results.nodeDisp[e.nodes[1]] || [0, 0, 0];

        // Transform to local: T = [cos, sin; -sin, cos]
        const u1l = cosA * u1g[0] + sinA * u1g[1];    // axial
        const v1l = -sinA * u1g[0] + cosA * u1g[1];   // transverse
        const th1 = u1g[2] || 0;                       // rotation
        const u2l = cosA * u2g[0] + sinA * u2g[1];
        const v2l = -sinA * u2g[0] + cosA * u2g[1];
        const th2 = u2g[2] || 0;

        // Draw cubic curve with N segments
        const N = 24;
        ctx.beginPath();
        for (let i = 0; i <= N; i++) {
            const xi = i / N;
            // Axial: linear interpolation
            const uLocal = (1 - xi) * u1l + xi * u2l;
            // Transverse: Hermite cubic
            const vLocal = hermiteH1(xi) * v1l + hermiteH2(xi) * L * th1
                + hermiteH3(xi) * v2l + hermiteH4(xi) * L * th2;

            // Undeformed position along beam
            const xUndef = nd1.x + xi * dx;
            const yUndef = nd1.y + xi * dy;

            // Global displacement at this point
            const dxGlob = cosA * uLocal - sinA * vLocal;
            const dyGlob = sinA * uLocal + cosA * vLocal;

            // Deformed position
            const xDef = xUndef + sf * dxGlob;
            const yDef = yUndef + sf * dyGlob;

            const sp = toScreen(xDef, yDef);
            if (i === 0) ctx.moveTo(sp.x, sp.y);
            else ctx.lineTo(sp.x, sp.y);
        }
        ctx.stroke();
    }

    // ── Rubber band line for draw-mode ───────────────────────────────────

    function drawRubberBand() {
        const lastNid = _drawPending[_drawPending.length - 1];
        const p = nodePos(lastNid, false);

        // Highlight the pending first node
        ctx.beginPath();
        ctx.arc(p.x, p.y, 8, 0, Math.PI * 2);
        ctx.strokeStyle = '#FF6F00';
        ctx.lineWidth = 2.5;
        ctx.stroke();

        // Rubber band line to cursor
        if (_drawMouseScreen) {
            ctx.setLineDash([6, 4]);
            ctx.strokeStyle = '#FF6F00';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(_drawMouseScreen.x, _drawMouseScreen.y);
            ctx.stroke();
            ctx.setLineDash([]);
        }
    }

    // ── Draw nodes ────────────────────────────────────────────────────────

    function drawNodes(deformed) {
        const nids = Object.keys(_model.nodes).map(Number);
        for (const nid of nids) {
            const p = nodePos(nid, deformed);
            if (_opts.showNodeSymbols !== false) {
                ctx.beginPath();
                ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
                ctx.fillStyle = '#1976D2';
                ctx.fill();
            }
            if (_opts.showNodeIDs) {
                ctx.font = '15px "JetBrains Mono", monospace';
                ctx.fillStyle = '#333';
                ctx.textAlign = 'left';
                ctx.fillText(nid, p.x + 6, p.y - 6);
            }
        }

        // Highlight selected node
        if (_selectedNode && !_drawMode) {
            const p = nodePos(_selectedNode, false);
            ctx.beginPath();
            ctx.arc(p.x, p.y, 7, 0, Math.PI * 2);
            ctx.strokeStyle = '#FF6F00';
            ctx.lineWidth = 2;
            ctx.stroke();
        }

        // Highlight all pending draw-mode nodes
        if (_drawMode) {
            for (const nid of _drawPending) {
                const p = nodePos(nid, false);
                ctx.beginPath();
                ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
                ctx.fillStyle = 'rgba(255,111,0,.3)';
                ctx.fill();
                ctx.strokeStyle = '#FF6F00';
                ctx.lineWidth = 2;
                ctx.stroke();
            }
        }
    }

    // ── Boundary conditions ───────────────────────────────────────────────

    function drawBC(deformed) {
        if (!_model.bcs) return;
        const dofNod = _model.header.dofNod;

        // ── Compute symbol size proportional to the model's screen extent ──
        let bbMinX = Infinity, bbMaxX = -Infinity, bbMinY = Infinity, bbMaxY = -Infinity;
        for (const nid of Object.keys(_model.nodes).map(Number)) {
            const p = nodePos(nid, !!deformed);
            if (p.x < bbMinX) bbMinX = p.x; if (p.x > bbMaxX) bbMaxX = p.x;
            if (p.y < bbMinY) bbMinY = p.y; if (p.y > bbMaxY) bbMaxY = p.y;
        }
        const bbDiag = Math.hypot(bbMaxX - bbMinX, bbMaxY - bbMinY) || 100;
        const sz = Math.max(13, Math.min(41, bbDiag * 0.0385));   // ×0.7 of original

        for (const nid of Object.keys(_model.bcs).map(Number)) {
            const bc = _model.bcs[nid];
            if (!_model.nodes[nid]) continue;
            const p = nodePos(nid, deformed);
            const tags = bc.tags;

            let fixCount = 0;
            for (const t of tags) if (t) fixCount++;
            if (fixCount === 0) continue;
            if (fixCount === dofNod) {
                // Fixed: hatched rectangle
                ctx.strokeStyle = '#B71C1C';
                ctx.lineWidth = 1.5;
                ctx.strokeRect(p.x - sz * 0.4, p.y, sz * 0.8, sz * 0.5);
                for (let xx = p.x - sz * 0.4; xx <= p.x + sz * 0.4; xx += 3) {
                    ctx.beginPath();
                    ctx.moveTo(xx, p.y);
                    ctx.lineTo(xx - 2.5, p.y + sz * 0.5);
                    ctx.stroke();
                }
            } else if (dofNod >= 2 && tags[0] && tags[1]) {
                // Pin: triangle
                ctx.strokeStyle = '#2E7D32';
                ctx.lineWidth = 1.5;
                ctx.beginPath();
                ctx.moveTo(p.x, p.y);
                ctx.lineTo(p.x - sz * 0.35, p.y + sz * 0.6);
                ctx.lineTo(p.x + sz * 0.35, p.y + sz * 0.6);
                ctx.closePath();
                ctx.stroke();
            } else if (tags[0] && !tags[1]) {
                // X roller
                ctx.strokeStyle = '#1565C0';
                ctx.lineWidth = 1.5;
                const r = sz * 0.18;
                ctx.beginPath();
                ctx.arc(p.x - r * 2.5, p.y, r, 0, Math.PI * 2);
                ctx.stroke();
                ctx.beginPath();
                ctx.moveTo(p.x - r * 3.5, p.y - sz * 0.35);
                ctx.lineTo(p.x - r * 3.5, p.y + sz * 0.35);
                ctx.stroke();
            } else if (!tags[0] && tags[1]) {
                // Y roller
                ctx.strokeStyle = '#1565C0';
                ctx.lineWidth = 1.5;
                const r = sz * 0.18;
                ctx.beginPath();
                ctx.arc(p.x, p.y + r * 2.5, r, 0, Math.PI * 2);
                ctx.stroke();
                ctx.beginPath();
                ctx.moveTo(p.x - sz * 0.35, p.y + r * 3.5);
                ctx.lineTo(p.x + sz * 0.35, p.y + r * 3.5);
                ctx.stroke();
            }
        }
    }

    // ── Load arrows ───────────────────────────────────────────────────────

    /** Compute outward offset direction for a node (away from connected elements) */
    function nodeOutwardDir(nid) {
        let ax = 0, ay = 0, count = 0;
        for (const eid of Object.keys(_model.elements).map(Number)) {
            const e = _model.elements[eid];
            const idx = e.nodes.indexOf(nid);
            if (idx < 0) continue;
            // vector from this node toward element centre
            const nn = FepsSolver.elNode(e.type);
            let cx = 0, cy = 0;
            for (let j = 0; j < nn; j++) {
                const p = nodePos(e.nodes[j], false);
                cx += p.x; cy += p.y;
            }
            cx /= nn; cy /= nn;
            const p = nodePos(nid, false);
            ax += cx - p.x; ay += cy - p.y; count++;
        }
        if (count === 0) return { x: 0, y: -1 }; // default: upward
        const len = Math.sqrt(ax * ax + ay * ay);
        if (len < 1e-6) return { x: 0, y: -1 };
        // outward = opposite of toward-element-centre
        return { x: -ax / len, y: -ay / len };
    }

    function drawLoads(deformed) {
        if (!_model.bcs) return;
        const dofNod = _model.header.dofNod;
        const dim    = _model.header.dim || 2;
        const mode3d = is3D();

        // ── DOF label / moment table based on model type ──────────────────
        let fLabels, isMoment;
        if (dofNod === 2) {
            fLabels  = ['Fx', 'Fy'];
            isMoment = [false, false];
        } else if (dofNod === 3 && dim === 2) {
            fLabels  = ['Fx', 'Fy', 'Mz'];
            isMoment = [false, false, true];
        } else if (dofNod === 3 && dim === 3) {          // 3D truss – Fz, NOT Mz
            fLabels  = ['Fx', 'Fy', 'Fz'];
            isMoment = [false, false, false];
        } else if (dofNod === 6) {                        // 3D beam
            fLabels  = ['Fx', 'Fy', 'Fz', 'Mx', 'My', 'Mz'];
            isMoment = [false, false, false, true, true, true];
        } else {
            fLabels  = Array.from({ length: dofNod }, (_, i) => `F${i}`);
            isMoment = new Array(dofNod).fill(false);
        }

        let maxF = 0;
        for (const nid of Object.keys(_model.bcs).map(Number)) {
            const bc = _model.bcs[nid];
            for (let j = 0; j < Math.min(bc.forces.length, dofNod); j++)
                maxF = Math.max(maxF, Math.abs(bc.forces[j]));
        }
        if (maxF < 1e-15) return;

        const gap      = 14;
        const arrowLen = 45;
        ctx.lineWidth  = 2.5;

        // Projected screen directions of each model axis (for 3D mode)
        // X-axis: (rx, -ux),  Y-axis: (0, -uy),  Z-axis: (rz, -uz)
        const AXIS3 = mode3d ? [
            { sx: _view3D.rx, sy: -_view3D.ux },
            { sx: 0,          sy: -_view3D.uy },
            { sx: _view3D.rz, sy: -_view3D.uz },
        ] : null;

        for (const nid of Object.keys(_model.bcs).map(Number)) {
            const bc = _model.bcs[nid];
            if (!_model.nodes[nid]) continue;
            const p      = nodePos(nid, deformed);
            const outDir = nodeOutwardDir(nid);
            const ox     = outDir.x * gap, oy = outDir.y * gap;

            for (let j = 0; j < Math.min(bc.forces.length, dofNod); j++) {
                const f = bc.forces[j];
                if (Math.abs(f) < 1e-15) continue;
                const label   = fLabels[j] || `F${j}`;
                const isMom   = isMoment[j];
                const baseX   = p.x + ox, baseY = p.y + oy;

                if (mode3d) {
                    // ── 3D drawing: project axis onto screen ──────────────
                    const axisIdx = j < 3 ? j : j - 3;   // forces 0-2 → axes 0-2; moments 3-5 → axes 0-2
                    const ad  = AXIS3[axisIdx];
                    const len = Math.sqrt(ad.sx * ad.sx + ad.sy * ad.sy) || 1;
                    const ndx = ad.sx / len, ndy = ad.sy / len;
                    const sign = f > 0 ? 1 : -1;
                    if (isMom) {
                        drawMomentArrow3D(baseX, baseY, ndx, ndy, sign, arrowLen, label, f);
                    } else {
                        drawForceArrow3D(baseX, baseY, ndx, ndy, sign, arrowLen, label, f);
                    }
                } else {
                    // ── 2D drawing (original path) ────────────────────────
                    if (isMom) {
                        // Shift label down when horizontal-force load is also active
                        const fxActive = bc.forces[0] && Math.abs(bc.forces[0]) >= 1e-15;
                        const fxGoesRight = (Math.abs(outDir.x) > 0.1 ? Math.sign(outDir.x) : -1) > 0;
                        const momLabelYShift = (fxActive && fxGoesRight) ? 22 : 0;
                        drawMomentArrow({ x: baseX, y: baseY }, f, label, momLabelYShift);
                        continue;
                    }
                    const sign = f > 0 ? 1 : -1;
                    let lineEndX = baseX, lineEndY = baseY;
                    if (j === 0) {
                        const dir = Math.abs(outDir.x) > 0.1 ? Math.sign(outDir.x) : -1;
                        lineEndX = baseX + dir * arrowLen;
                    } else {
                        const dir = Math.abs(outDir.y) > 0.1 ? Math.sign(outDir.y) : -1;
                        lineEndY = baseY + dir * arrowLen;
                    }
                    let ahX, ahY, ahAngle;
                    if (j === 0) {
                        ahX = sign > 0 ? Math.max(baseX, lineEndX) : Math.min(baseX, lineEndX);
                        ahY = baseY; ahAngle = sign > 0 ? 0 : Math.PI;
                    } else {
                        ahX = baseX;
                        ahY = sign > 0 ? Math.min(baseY, lineEndY) : Math.max(baseY, lineEndY);
                        ahAngle = sign > 0 ? -Math.PI / 2 : Math.PI / 2;
                    }
                    ctx.strokeStyle = '#D50000'; ctx.fillStyle = '#D50000';
                    ctx.beginPath(); ctx.moveTo(baseX, baseY); ctx.lineTo(lineEndX, lineEndY); ctx.stroke();
                    const hl = 14;
                    ctx.beginPath();
                    ctx.moveTo(ahX, ahY);
                    ctx.lineTo(ahX - hl * Math.cos(ahAngle - 0.35), ahY - hl * Math.sin(ahAngle - 0.35));
                    ctx.lineTo(ahX - hl * Math.cos(ahAngle + 0.35), ahY - hl * Math.sin(ahAngle + 0.35));
                    ctx.closePath(); ctx.fill();
                    ctx.font = '17px "JetBrains Mono", monospace';
                    ctx.fillStyle = '#B71C1C';
                    if (j === 0) {
                        const outRight = lineEndX > baseX;
                        ctx.textAlign = outRight ? 'left' : 'right';
                        ctx.fillText(`${label}=${fmtForce(f)}`, lineEndX + (outRight ? 6 : -6), lineEndY - 6);
                    } else {
                        const outDown = lineEndY > baseY;
                        ctx.textAlign = 'left';
                        ctx.fillText(`${label}=${fmtForce(f)}`, lineEndX + 6, lineEndY + (outDown ? 14 : -6));
                    }
                }
            }
        }
    }

    // ── Element surface load visualization ────────────────────────────────
    /**
     * Draw element surface / boundary loads (esurf) in both pre- and post-process.
     * Body forces are NOT drawn here — only explicit esurf entries.
     *
     * Beam (BEAM2D, BAR2): trapezoidal arrows perpendicular to beam axis, local frame.
     * Solid (QUAD4, TRIG3): traction arrows at each loaded edge, global frame.
     */
    function drawEsurfLoads(deformed) {
        if (!_model || !_model.elements) return;

        const BEAM_TYPES = new Set(['BAR2', 'BAR3D', 'BEAM2D', 'BEAM3D']);
        const SOLID_SIDE_PAIRS = {
            QUAD4: [[0,1],[1,2],[2,3],[3,0]],
            TRIG3: [[0,1],[1,2],[2,0]]
        };
        const MAX_ARROW_PX = 44;
        const HL = 7;   // arrowhead half-length in px
        const ESURF_COLOR = '#0D47A1';

        // ── Collect all loads and find global max magnitude for uniform scaling ──
        let maxW = 0;
        const beamItems = [], solidItems = [];

        for (const eid of Object.keys(_model.elements).map(Number)) {
            const e = _model.elements[eid];
            const typ = e.type;

            if (BEAM_TYPES.has(typ)) {
                const isBar = typ === 'BAR2' || typ === 'BAR3D';
                // Uniform distributed load from eload
                const el = e.eload || [];
                const wx = el[0] || 0;
                const eloadWy = (!isBar && el.length > 1) ? (el[1] || 0) : 0;
                // Trapezoidal/variable part from esurf (beam-type esurf is a plain object)
                let esurfWy1 = 0, esurfWy2 = 0;
                if (e.esurf && !Array.isArray(e.esurf)) {
                    esurfWy1 = e.esurf.wy1 || 0;
                    esurfWy2 = e.esurf.wy2 || 0;
                }
                const wy1 = eloadWy + esurfWy1;
                const wy2 = eloadWy + esurfWy2;
                if (Math.abs(wy1) > 1e-15 || Math.abs(wy2) > 1e-15 || Math.abs(wx) > 1e-15) {
                    maxW = Math.max(maxW, Math.abs(wy1), Math.abs(wy2), Math.abs(wx));
                    beamItems.push({ e, wy1, wy2, wx });
                }
            }
            if (SOLID_SIDE_PAIRS[typ] && Array.isArray(e.esurf) && e.esurf.length > 0) {
                for (const face of e.esurf) {
                    maxW = Math.max(maxW, Math.hypot(face.qx1 || 0, face.qy1 || 0),
                                         Math.hypot(face.qx2 || 0, face.qy2 || 0));
                }
                solidItems.push(e);
            }
        }
        if (maxW < 1e-15) return;

        ctx.save();
        ctx.strokeStyle = ESURF_COLOR;
        ctx.fillStyle   = ESURF_COLOR;

        // Helper: draw one arrow tip→base (filled head at base)
        function drawArrow(tipX, tipY, baseX, baseY) {
            ctx.beginPath(); ctx.moveTo(tipX, tipY); ctx.lineTo(baseX, baseY); ctx.stroke();
            const adx = baseX - tipX, ady = baseY - tipY;
            const al  = Math.sqrt(adx*adx + ady*ady) || 1;
            const nx = adx/al, ny = ady/al;
            const px = -ny, py = nx;         // perpendicular
            ctx.beginPath();
            ctx.moveTo(baseX, baseY);
            ctx.lineTo(baseX - HL*nx + HL*0.4*px, baseY - HL*ny + HL*0.4*py);
            ctx.lineTo(baseX - HL*nx - HL*0.4*px, baseY - HL*ny - HL*0.4*py);
            ctx.closePath(); ctx.fill();
        }

        // ── BEAM / BAR: transverse wy arrows + axial wx arrows ──
        ctx.lineWidth = 1.5;
        for (const { e, wy1, wy2, wx } of beamItems) {
            const nid0 = e.nodes[0], nid1 = e.nodes[1];
            const nd0 = _model.nodes[nid0], nd1 = _model.nodes[nid1];
            if (!nd0 || !nd1) continue;

            const p0 = nodePos(nid0, deformed);
            const p1 = nodePos(nid1, deformed);

            // Beam unit vector in screen
            const bdx = p1.x - p0.x, bdy = p1.y - p0.y;
            const bL  = Math.sqrt(bdx*bdx + bdy*bdy);
            if (bL < 1) continue;
            const bex = bdx/bL, bey = bdy/bL;  // screen unit along beam

            // Local +y direction in screen via toScreen offset
            const mdx = nd1.x - nd0.x, mdy = nd1.y - nd0.y;
            const mL  = Math.sqrt(mdx*mdx + mdy*mdy) || 1;
            const lyMx = -mdy/mL, lyMy = mdx/mL;
            const pRef = toScreen(nd0.x, nd0.y);
            const pLy  = toScreen(nd0.x + lyMx, nd0.y + lyMy);
            const lysx = pLy.x - pRef.x, lysy = pLy.y - pRef.y;
            const lysL = Math.sqrt(lysx*lysx + lysy*lysy) || 1;
            const lyx = lysx/lysL, lyy = lysy/lysL;  // screen unit of local +y

            // ── Transverse load (wy) ──
            if (Math.abs(wy1) > 1e-15 || Math.abs(wy2) > 1e-15) {
                const N = 8;
                const tips = [];
                for (let i = 0; i <= N; i++) {
                    const t  = i / N;
                    const w  = wy1 * (1 - t) + wy2 * t;
                    const bx = p0.x + t * bdx, by = p0.y + t * bdy;
                    const len = (Math.abs(w) / maxW) * MAX_ARROW_PX;
                    const sign = w >= 0 ? 1 : -1;
                    const tipX = bx + sign * len * lyx;
                    const tipY = by + sign * len * lyy;
                    tips.push({ bx, by, tipX, tipY, w });
                }
                for (const { bx, by, tipX, tipY, w } of tips) {
                    if (Math.abs(w) < 1e-15) continue;
                    drawArrow(tipX, tipY, bx, by);
                }
                ctx.setLineDash([4, 3]);
                ctx.beginPath();
                let first = true;
                for (const { tipX, tipY, w } of tips) {
                    if (Math.abs(w) < 1e-15) { first = true; continue; }
                    if (first) { ctx.moveTo(tipX, tipY); first = false; }
                    else ctx.lineTo(tipX, tipY);
                }
                ctx.stroke();
                ctx.setLineDash([]);
                const wMid = (wy1 + wy2) * 0.5;
                if (Math.abs(wMid) > 1e-15) {
                    const mLen = (Math.abs(wMid) / maxW) * MAX_ARROW_PX;
                    const sign = wMid >= 0 ? 1 : -1;
                    const mx = (p0.x + p1.x) * 0.5 + sign * mLen * lyx + 4;
                    const my = (p0.y + p1.y) * 0.5 + sign * mLen * lyy - 4;
                    ctx.font = '14px "JetBrains Mono", monospace';
                    ctx.fillStyle = ESURF_COLOR;
                    ctx.textAlign = 'left';
                    const lbl = wy1 === wy2 ? `wy=${fmtForce(wy1)}` : `wy:${fmtForce(wy1)}→${fmtForce(wy2)}`;
                    ctx.fillText(lbl, mx, my);
                    ctx.fillStyle = ESURF_COLOR;
                }
            }

            // ── Axial load (wx) ──
            if (Math.abs(wx) > 1e-15) {
                const axLen = (Math.abs(wx) / maxW) * MAX_ARROW_PX;
                const sign  = wx >= 0 ? 1 : -1;
                const OFF   = 14;   // px perpendicular offset from beam line
                const N     = 6;
                for (let i = 0; i <= N; i++) {
                    const t  = i / N;
                    const bx = p0.x + t * bdx + OFF * lyx;
                    const by = p0.y + t * bdy + OFF * lyy;
                    drawArrow(bx + sign * axLen * bex, by + sign * axLen * bey, bx, by);
                }
                ctx.setLineDash([4, 3]);
                ctx.beginPath();
                ctx.moveTo(p0.x + OFF * lyx, p0.y + OFF * lyy);
                ctx.lineTo(p1.x + OFF * lyx, p1.y + OFF * lyy);
                ctx.stroke();
                ctx.setLineDash([]);
                const mx = (p0.x + p1.x) * 0.5 + OFF * lyx + 4;
                const my = (p0.y + p1.y) * 0.5 + OFF * lyy - 4;
                ctx.font = '14px "JetBrains Mono", monospace';
                ctx.fillStyle = ESURF_COLOR;
                ctx.textAlign = 'left';
                ctx.fillText(`wx=${fmtForce(wx)}`, mx, my);
                ctx.fillStyle = ESURF_COLOR;
            }
        }

        // ── SOLID esurf: traction arrows at each loaded edge ──
        for (const e of solidItems) {
            const pairs = SOLID_SIDE_PAIRS[e.type];
            if (!pairs) continue;
            for (const face of e.esurf) {
                const si = (face.side || 1) - 1;
                if (si < 0 || si >= pairs.length) continue;
                const [ia, ib] = pairs[si];
                const na = _model.nodes[e.nodes[ia]], nb = _model.nodes[e.nodes[ib]];
                if (!na || !nb) continue;

                const pa = nodePos(e.nodes[ia], deformed);
                const pb = nodePos(e.nodes[ib], deformed);

                // Draw traction at a set of points along the edge
                const pts = [
                    { p: pa, qx: face.qx1 || 0, qy: face.qy1 || 0 },
                    { p: { x:(pa.x+pb.x)/2, y:(pa.y+pb.y)/2 },
                      qx: ((face.qx1||0)+(face.qx2||0))/2,
                      qy: ((face.qy1||0)+(face.qy2||0))/2 },
                    { p: pb, qx: face.qx2 || 0, qy: face.qy2 || 0 }
                ];

                // Compute screen direction for model (qx, qy) using delta-toScreen
                ctx.lineWidth = 1.5;
                const tips2 = [];
                for (const { p, qx, qy } of pts) {
                    const mag = Math.hypot(qx, qy);
                    if (mag < 1e-15) { tips2.push(null); continue; }
                    const len = (mag / maxW) * MAX_ARROW_PX;
                    // direction: model (qx, qy) → screen by delta
                    const pO = toScreen(na.x, na.y);
                    const pD = toScreen(na.x + qx/mag, na.y + qy/mag);
                    const sdx = pD.x - pO.x, sdy = pD.y - pO.y;
                    const sL  = Math.sqrt(sdx*sdx + sdy*sdy) || 1;
                    const snx = sdx/sL, sny = sdy/sL;
                    const tipX = p.x + snx * len, tipY = p.y + sny * len;
                    drawArrow(p.x + snx*len*0.1, p.y + sny*len*0.1, p.x, p.y);  // arrow tip→base at surface
                    tips2.push({ tipX, tipY });
                }

                // Envelope along edge tips
                ctx.setLineDash([4, 3]);
                ctx.beginPath();
                let fst = true;
                for (const t of tips2) {
                    if (!t) { fst = true; continue; }
                    if (fst) { ctx.moveTo(t.tipX, t.tipY); fst = false; }
                    else ctx.lineTo(t.tipX, t.tipY);
                }
                ctx.stroke();
                ctx.setLineDash([]);

                // Edge highlight line
                ctx.strokeStyle = 'rgba(13,71,161,0.35)';
                ctx.lineWidth = 3;
                ctx.beginPath(); ctx.moveTo(pa.x, pa.y); ctx.lineTo(pb.x, pb.y); ctx.stroke();
                ctx.strokeStyle = ESURF_COLOR;
                ctx.lineWidth = 1.5;

                // Magnitude label at mid-edge
                const qxM = ((face.qx1||0)+(face.qx2||0))/2;
                const qyM = ((face.qy1||0)+(face.qy2||0))/2;
                const magM = Math.hypot(qxM, qyM);
                if (magM > 1e-15) {
                    const lx = (pa.x+pb.x)/2 + 6, ly = (pa.y+pb.y)/2 - 4;
                    ctx.font = '14px "JetBrains Mono", monospace';
                    ctx.fillStyle = ESURF_COLOR;
                    ctx.textAlign = 'left';
                    ctx.fillText(`|q|=${fmtForce(magM)}`, lx, ly);
                }
            }
        }

        ctx.restore();
    }

    /**
     * Draw a force arrow in 3D projection.
     * ndx/ndy: normalised screen direction of the model axis.
     * sign: +1 or -1 (determines which way arrow points).
     */
    function drawForceArrow3D(bx, by, ndx, ndy, sign, len, label, f) {
        const tipX = bx + sign * ndx * len, tipY = by + sign * ndy * len;
        const ahAngle = Math.atan2(sign * ndy, sign * ndx);
        const hl = 13;
        ctx.strokeStyle = '#D50000'; ctx.fillStyle = '#D50000'; ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(tipX, tipY); ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(tipX, tipY);
        ctx.lineTo(tipX - hl * Math.cos(ahAngle - 0.35), tipY - hl * Math.sin(ahAngle - 0.35));
        ctx.lineTo(tipX - hl * Math.cos(ahAngle + 0.35), tipY - hl * Math.sin(ahAngle + 0.35));
        ctx.closePath(); ctx.fill();
        // Label centred beside the shaft
        ctx.font = '17px "JetBrains Mono", monospace';
        ctx.fillStyle = '#B71C1C'; ctx.textAlign = 'center';
        ctx.fillText(`${label}=${fmtForce(f)}`,
            (bx + tipX) / 2 + ndy * 16,
            (by + tipY) / 2 - ndx * 16);
    }

    /**
     * Draw a 3D beam moment as a double-headed arrow along the projected axis
     * (right-hand rule: arrow direction = moment axis).
     * Two filled arrowheads are stacked at the positive-sign tip.
     */
    function drawMomentArrow3D(bx, by, ndx, ndy, sign, len, label, m) {
        const half = len * 0.55;
        const x1 = bx - ndx * half, y1 = by - ndy * half;
        const x2 = bx + ndx * half, y2 = by + ndy * half;
        // Tip end (in the positive-sign direction)
        const tipX = sign > 0 ? x2 : x1, tipY = sign > 0 ? y2 : y1;
        const ahAngle = Math.atan2(sign * ndy, sign * ndx);
        const hl = 11;

        ctx.strokeStyle = '#6A1B9A'; ctx.fillStyle = '#6A1B9A'; ctx.lineWidth = 2;
        // Shaft
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
        // Double arrowhead (two chevrons stacked)
        for (let k = 0; k < 2; k++) {
            const ox2 = k * sign * ndx * 9, oy2 = k * sign * ndy * 9;
            const tx = tipX - ox2, ty = tipY - oy2;
            ctx.beginPath();
            ctx.moveTo(tx, ty);
            ctx.lineTo(tx - hl * Math.cos(ahAngle - 0.38), ty - hl * Math.sin(ahAngle - 0.38));
            ctx.lineTo(tx - hl * Math.cos(ahAngle + 0.38), ty - hl * Math.sin(ahAngle + 0.38));
            ctx.closePath(); ctx.fill();
        }
        // Label beside the shaft
        ctx.font = '17px "JetBrains Mono", monospace';
        ctx.fillStyle = '#4A148C'; ctx.textAlign = 'center';
        ctx.fillText(`${label}=${fmtForce(m)}`, bx + ndy * 20, by - ndx * 20);
    }

    /** Draw a small curved moment arrow at point p (2D only).
     *  labelYShift: extra vertical offset (px) for the label, used to avoid
     *  overlap when a horizontal-force label occupies the same row.          */
    function drawMomentArrow(p, m, label, labelYShift = 0) {
        const r   = 16;
        const dir = m > 0 ? 1 : -1;
        ctx.strokeStyle = '#6A1B9A'; ctx.fillStyle = '#6A1B9A'; ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, -Math.PI * 0.7, Math.PI * 0.4, dir < 0);
        ctx.stroke();
        const endAngle = dir > 0 ? Math.PI * 0.4 : -Math.PI * 0.7;
        const ex = p.x + r * Math.cos(endAngle), ey = p.y + r * Math.sin(endAngle);
        const hl = 10;
        const tang = endAngle + (dir > 0 ? Math.PI / 2 : -Math.PI / 2);
        ctx.beginPath();
        ctx.moveTo(ex, ey);
        ctx.lineTo(ex - hl * Math.cos(tang - 0.4), ey - hl * Math.sin(tang - 0.4));
        ctx.lineTo(ex - hl * Math.cos(tang + 0.4), ey - hl * Math.sin(tang + 0.4));
        ctx.closePath(); ctx.fill();
        ctx.font = '17px "JetBrains Mono", monospace';
        ctx.fillStyle = '#6A1B9A'; ctx.textAlign = 'left';
        ctx.fillText(`${label || 'Mz'}=${fmtForce(m)}`, p.x + r + 6, p.y - 4 + labelYShift);
    }

    // ── Reaction arrows (post-process) ────────────────────────────────────

    function drawReactions(deformed) {
        if (!_results || !_results.nodeForce) return;
        const dofNod = _model.header.dofNod;
        const mode3d = is3D();

        // Labels and moment flags match the DOF ordering used by the solver/parser:
        //   2D (dofNod=3): Dx Dy Rz  →  forces Rx Ry, moment Mz  (j=2 → 'Mz')
        //   3D (dofNod=6): Dx Dy Dz Rx Ry Rz  →  forces Rx Ry Rz, moments Mx My Mz
        const rLabels  = dofNod === 3
            ? ['Rx', 'Ry', 'Mz']
            : ['Rx', 'Ry', 'Rz', 'Mx', 'My', 'Mz'];
        const isMomArr = [false,  false,  false,  true,   true,   true];

        // Find max reaction magnitude for scaling
        let maxR = 0;
        for (const nid of Object.keys(_model.bcs || {}).map(Number)) {
            const bc = _model.bcs[nid];
            if (!bc) continue;
            const rf = _results.nodeForce[nid];
            if (!rf) continue;
            for (let j = 0; j < dofNod; j++) {
                if (bc.tags[j]) maxR = Math.max(maxR, Math.abs(rf[j] || 0));
            }
        }
        if (maxR < 1e-15) return;
        const gap = 14;
        const arrowLen = 45;

        // Projected screen directions of each model axis (3D mode)
        const AXIS3 = mode3d ? [
            { sx: _view3D.rx, sy: -_view3D.ux },
            { sx: 0,          sy: -_view3D.uy },
            { sx: _view3D.rz, sy: -_view3D.uz },
        ] : null;

        for (const nid of Object.keys(_model.bcs || {}).map(Number)) {
            const bc = _model.bcs[nid];
            if (!bc || !_model.nodes[nid]) continue;
            const rf = _results.nodeForce[nid];
            if (!rf) continue;
            const p      = nodePos(nid, deformed);
            const outDir = nodeOutwardDir(nid);
            const ox     = outDir.x * gap, oy = outDir.y * gap;

            for (let j = 0; j < dofNod; j++) {         // ← was capped at min(dofNod,2)
                if (!bc.tags[j]) continue;
                const f = rf[j] || 0;
                if (Math.abs(f) < 1e-10) continue;

                const label  = rLabels[j]  || `R${j}`;
                const isMom  = j >= 3 || (dofNod === 3 && j === 2); // Mz in 2D; Mx/My/Mz in 3D
                const baseX  = p.x + ox, baseY = p.y + oy;
                const sign   = f > 0 ? 1 : -1;

                // ── 3D mode: use projected-axis arrows ────────────────────
                if (mode3d && AXIS3) {
                    const axisIdx = j < 3 ? j : j - 3;
                    const ad  = AXIS3[axisIdx];
                    const len = Math.sqrt(ad.sx * ad.sx + ad.sy * ad.sy) || 1;
                    const ndx = ad.sx / len, ndy = ad.sy / len;
                    if (isMom) {
                        drawMomentArrow3D(baseX, baseY, ndx, ndy, sign, arrowLen, label, f);
                    } else {
                        drawForceArrow3D(baseX, baseY, ndx, ndy, sign, arrowLen, label, f);
                    }
                    continue;
                }

                // ── 2D mode ───────────────────────────────────────────────
                if (isMom) {
                    // Rotational reaction — curved arc with arrowhead.
                    // Shift the label down when a horizontal-force reaction (Rx)
                    // is also active going rightward, to prevent label overlap.
                    const rxActive = bc.tags[0] && Math.abs(rf[0] || 0) >= 1e-10;
                    const rxGoesRight = (Math.abs(outDir.x) > 0.1 ? Math.sign(outDir.x) : 1) > 0;
                    const momLabelYShift = (rxActive && rxGoesRight) ? 22 : 0;
                    drawMomentArrow({ x: baseX, y: baseY }, f, label, momLabelYShift);
                    continue;
                }

                // Linear force reaction (j = 0 or 1 in 2D)
                let lineEndX = baseX, lineEndY = baseY;
                if (j === 0) {
                    const dir = Math.abs(outDir.x) > 0.1 ? Math.sign(outDir.x) : 1;
                    lineEndX = baseX + dir * arrowLen;
                } else {
                    const dir = Math.abs(outDir.y) > 0.1 ? Math.sign(outDir.y) : 1;
                    lineEndY = baseY + dir * arrowLen;
                }
                let ahX, ahY, ahAngle;
                if (j === 0) {
                    ahX = sign > 0 ? Math.max(baseX, lineEndX) : Math.min(baseX, lineEndX);
                    ahY = baseY; ahAngle = sign > 0 ? 0 : Math.PI;
                } else {
                    ahX = baseX;
                    ahY = sign > 0 ? Math.min(baseY, lineEndY) : Math.max(baseY, lineEndY);
                    ahAngle = sign > 0 ? -Math.PI / 2 : Math.PI / 2;
                }
                ctx.strokeStyle = '#1565C0'; ctx.fillStyle = '#1565C0'; ctx.lineWidth = 2.5;
                ctx.beginPath(); ctx.moveTo(baseX, baseY); ctx.lineTo(lineEndX, lineEndY); ctx.stroke();
                const hl = 14;
                ctx.beginPath();
                ctx.moveTo(ahX, ahY);
                ctx.lineTo(ahX - hl * Math.cos(ahAngle - 0.35), ahY - hl * Math.sin(ahAngle - 0.35));
                ctx.lineTo(ahX - hl * Math.cos(ahAngle + 0.35), ahY - hl * Math.sin(ahAngle + 0.35));
                ctx.closePath(); ctx.fill();

                ctx.font = '17px "JetBrains Mono", monospace';
                ctx.fillStyle = '#0D47A1';
                if (j === 0) {
                    const outRight = lineEndX > baseX;
                    ctx.textAlign = outRight ? 'left' : 'right';
                    ctx.fillText(`${label}=${fmtForce(f)}`, lineEndX + (outRight ? 6 : -6), lineEndY - 6);
                } else {
                    const outDown = lineEndY > baseY;
                    ctx.textAlign = 'left';
                    ctx.fillText(`${label}=${fmtForce(f)}`, lineEndX + 6, lineEndY + (outDown ? 16 : -6));
                }
            }
        }
    }

    function fmtForce(v) {
        if (Math.abs(v) >= 1e5 || (Math.abs(v) < 0.01 && v !== 0)) return v.toExponential(2);
        return parseFloat(v.toFixed(2)).toString();
    }

    // ── Gouraud shading for 2D elements ──────────────────────────────────

    function drawGouraudPoly(pts, nodeIds, compIdx, corners) {
        const vals = [];
        for (let j = 0; j < corners; j++) {
            const s = _results.nodeStress[nodeIds[j]];
            vals.push(s ? s[compIdx] : 0);
        }

        if (corners === 3) {
            fillGouraudTriangle(pts[0], pts[1], pts[2], vals[0], vals[1], vals[2]);
        } else {
            // Quad → 2 triangles
            fillGouraudTriangle(pts[0], pts[1], pts[2], vals[0], vals[1], vals[2]);
            fillGouraudTriangle(pts[0], pts[2], pts[3], vals[0], vals[2], vals[3]);
        }
    }

    function fillGouraudTriangle(A, B, C, vA, vB, vC) {
        // Subdivide into N² sub-triangles using parametric grid.
        // Point(i,j) = (1 - u - v)*A + u*B + v*C  where u=i/N, v=j/N, i+j<=N
        const N = 10;

        function gp(i, j) {
            const u = i / N, v = j / N, w = 1 - u - v;
            return {
                x: w * A.x + u * B.x + v * C.x,
                y: w * A.y + u * B.y + v * C.y,
                s: w * vA + u * vB + v * vC
            };
        }

        for (let i = 0; i < N; i++) {
            for (let j = 0; j < N - i; j++) {
                // Lower triangle: (i,j) → (i+1,j) → (i,j+1)
                const a = gp(i, j), b = gp(i + 1, j), c = gp(i, j + 1);
                const avg1 = (a.s + b.s + c.s) / 3;
                ctx.beginPath();
                ctx.moveTo(a.x, a.y);
                ctx.lineTo(b.x, b.y);
                ctx.lineTo(c.x, c.y);
                ctx.closePath();
                ctx.fillStyle = stressColor(avg1);
                ctx.fill();

                // Upper triangle: (i+1,j) → (i+1,j+1) → (i,j+1)  (only if valid)
                if (i + j + 1 < N) {
                    const d = gp(i + 1, j + 1);
                    const avg2 = (b.s + d.s + c.s) / 3;
                    ctx.beginPath();
                    ctx.moveTo(b.x, b.y);
                    ctx.lineTo(d.x, d.y);
                    ctx.lineTo(c.x, c.y);
                    ctx.closePath();
                    ctx.fillStyle = stressColor(avg2);
                    ctx.fill();
                }
            }
        }
    }

    // ── Selection highlights ──────────────────────────────────────────────

    function drawSelectHighlights(deformed) {
        // Highlight selected elements
        if (_selectedElements.size > 0) {
            for (const eid of _selectedElements) {
                const e = _model.elements[eid];
                if (!e) continue;
                const nn = FepsSolver.elNode(e.type);
                if (e.type.startsWith('BAR') || e.type.startsWith('BEAM')) {
                    const p1 = nodePos(e.nodes[0], false);
                    const p2 = nodePos(e.nodes[1], false);
                    ctx.strokeStyle = '#FFD600';
                    ctx.lineWidth = 6;
                    ctx.setLineDash([]);
                    ctx.beginPath();
                    ctx.moveTo(p1.x, p1.y);
                    ctx.lineTo(p2.x, p2.y);
                    ctx.stroke();
                } else {
                    const corners = e.type.startsWith('TRIG') ? 3 : 4;
                    ctx.beginPath();
                    for (let j = 0; j < corners; j++) {
                        const p = nodePos(e.nodes[j], false);
                        j === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y);
                    }
                    ctx.closePath();
                    ctx.fillStyle = 'rgba(255,214,0,.25)';
                    ctx.fill();
                    ctx.strokeStyle = '#FFD600';
                    ctx.lineWidth = 3;
                    ctx.stroke();
                }
            }
        }
        // Highlight selected nodes
        if (_selectedNodes.size > 0) {
            for (const nid of _selectedNodes) {
                const p = nodePos(nid, false);
                ctx.beginPath();
                ctx.arc(p.x, p.y, 9, 0, Math.PI * 2);
                ctx.fillStyle = 'rgba(76,175,80,.25)';
                ctx.fill();
                ctx.strokeStyle = '#4CAF50';
                ctx.lineWidth = 2.5;
                ctx.stroke();
            }
        }
    }

    // ── Force diagrams (BMD / SFD / AFD) ──────────────────────────────────

    /** Draw a 3D beam/bar diagram band offset from the element in `perp` model-space direction. */
    function _drawBeam3DDiag(n1node, ef, valFn, perp, diagScale, fillCol, strCol) {
        const x1 = n1node.x, y1 = n1node.y, z1 = n1node.z || 0;
        const ex = ef.ex, L = ef.L;
        const numPts = 20;
        const pts = [];
        for (let i = 0; i <= numPts; i++) {
            const t = i / numPts;
            const off = valFn(t) * diagScale;
            pts.push(project3D(
                x1 + ex[0] * t * L + perp[0] * off,
                y1 + ex[1] * t * L + perp[1] * off,
                z1 + ex[2] * t * L + perp[2] * off
            ));
        }
        const s1 = project3D(x1, y1, z1);
        const s2 = project3D(x1 + ex[0] * L, y1 + ex[1] * L, z1 + ex[2] * L);

        // Filled polygon: baseline → diagram → close
        ctx.beginPath();
        ctx.moveTo(s1.x, s1.y);
        for (const p of pts) ctx.lineTo(p.x, p.y);
        ctx.lineTo(s2.x, s2.y);
        ctx.closePath();
        ctx.fillStyle = fillCol;
        ctx.fill();

        // Diagram outline
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
        ctx.strokeStyle = strCol;
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Value labels at element ends
        ctx.font = '15px "JetBrains Mono", monospace';
        ctx.fillStyle = strCol;
        ctx.textAlign = 'center';
        ctx.fillText(valFn(0).toFixed(2), pts[0].x, pts[0].y - 5);
        ctx.fillText(valFn(1).toFixed(2), pts[numPts].x, pts[numPts].y - 5);
    }

    function drawForceDiagram(type) {
        if (!_results || !_results.elemForces) return;
        const eids = Object.keys(_model.elements).map(Number);
        const mode3d = is3D();

        // ── Characteristic element lengths for diagram normalisation ─────────
        // Two separate lengths are needed:
        //   minScreenLen  (px)            – used for 2D elements whose diagrams
        //                                   are drawn directly in screen-space
        //   minModelLen   (model units)   – used for 3D elements whose diagrams
        //                                   are drawn in model-space before
        //                                   projection by project3D()
        // Using MIN guarantees no diagram ever exceeds DIAG_FRACTION of the
        // shortest element on screen.
        const types1D = new Set(['BAR2', 'BAR3D', 'BEAM2D', 'BEAM3D']);
        let minScreenLen = Infinity;
        let minModelLen  = Infinity;
        for (const eid of eids) {
            const e = _model.elements[eid];
            if (!types1D.has(e.type)) continue;
            // Screen-space projected length (2D diagrams / normalisation display)
            const p1 = nodePos(e.nodes[0], false);
            const p2 = nodePos(e.nodes[1], false);
            const ddx = p2.x - p1.x, ddy = p2.y - p1.y;
            const sl = Math.sqrt(ddx * ddx + ddy * ddy);
            if (sl > 1 && sl < minScreenLen) minScreenLen = sl;
            // Model-space Euclidean length (3D diagrams offset in model coords)
            const n1 = _model.nodes[e.nodes[0]], n2 = _model.nodes[e.nodes[1]];
            const mdx = n2.x - n1.x, mdy = n2.y - n1.y, mdz = (n2.z || 0) - (n1.z || 0);
            const ml = Math.sqrt(mdx * mdx + mdy * mdy + mdz * mdz);
            if (ml > 1e-9 && ml < minModelLen) minModelLen = ml;
        }
        // Fallbacks when no valid elements found
        if (!isFinite(minScreenLen) || minScreenLen < 20) minScreenLen = 80;
        if (!isFinite(minModelLen)  || minModelLen  < 1e-9) minModelLen = 1;
        // Max diagram amplitude = 1/4 of minimum element length
        const DIAG_FRACTION = 0.25;

        // ── Find max value for scaling ──────────────────────────────────
        let maxVal = 0;
        for (const eid of eids) {
            const ef = _results.elemForces[eid];
            if (!ef) continue;
            const et = _model.elements[eid].type;
            if (type === 'axial') {
                if (et === 'BAR2' || et === 'BAR3D') maxVal = Math.max(maxVal, Math.abs(ef.axial || 0));
                if (et === 'BEAM2D') maxVal = Math.max(maxVal, Math.abs(ef.N1 || 0), Math.abs(ef.N2 || 0));
                if (et === 'BEAM3D') maxVal = Math.max(maxVal, Math.abs(ef.N1 || 0), Math.abs(ef.N2 || 0));
            }
            if (et === 'BEAM2D') {
                if (type === 'sfd') maxVal = Math.max(maxVal, Math.abs(ef.V1 || 0), Math.abs(ef.V2 || 0));
                if (type === 'bmd') {
                    // Sample 11 points along the curve so distributed-load parabolic peaks are captured
                    for (let k = 0; k <= 10; k++) {
                        const xp = (k / 10) * ef.L;
                        const mv = -ef.M1 + ef.V1 * xp
                            + (ef.wy1 || 0) * xp * xp / 2
                            + ((ef.wy2 || 0) - (ef.wy1 || 0)) * xp * xp * xp / (6 * ef.L);
                        maxVal = Math.max(maxVal, Math.abs(mv));
                    }
                }
            }
            if (et === 'BEAM3D') {
                if (type === 'sfd')     maxVal = Math.max(maxVal, Math.abs(ef.Vy1 || 0), Math.abs(ef.Vy2 || 0));
                if (type === 'sfd_z')   maxVal = Math.max(maxVal, Math.abs(ef.Vz1 || 0), Math.abs(ef.Vz2 || 0));
                if (type === 'torsion') maxVal = Math.max(maxVal, Math.abs(ef.T1  || 0), Math.abs(ef.T2  || 0));
                if (type === 'bmd') {
                    for (let k = 0; k <= 10; k++) {
                        const xp = (k / 10) * ef.L;
                        const mv = -ef.Mz1 + ef.Vy1 * xp
                            + (ef.wy1 || 0) * xp * xp / 2
                            + ((ef.wy2 || 0) - (ef.wy1 || 0)) * xp * xp * xp / (6 * ef.L);
                        maxVal = Math.max(maxVal, Math.abs(mv));
                    }
                }
                if (type === 'bmd_y') {
                    for (let k = 0; k <= 10; k++) {
                        const xp = (k / 10) * ef.L;
                        const mv = -ef.My1 + ef.Vz1 * xp
                            + (ef.wz1 || 0) * xp * xp / 2
                            + ((ef.wz2 || 0) - (ef.wz1 || 0)) * xp * xp * xp / (6 * ef.L);
                        maxVal = Math.max(maxVal, Math.abs(mv));
                    }
                }
            }
        }
        if (maxVal < 1e-15) return;
        // Normalised scale: peak value maps to DIAG_FRACTION × min element screen length,
        // further multiplied by the user's Diagram Scale slider (default 100 = 1×).
        const userDiagMult = (_opts.diagScale != null ? _opts.diagScale : 100) / 100;
        // diagScale   : screen-px / force  → used for 2D elements (BAR2, BEAM2D)
        // diagScale3D : model-len / force  → used for 3D elements (BAR3D, BEAM3D)
        //   The two are consistent: diagScale3D ≈ diagScale / _transform.scale
        //   but computed directly from model lengths so it's view-angle independent.
        const diagScale   = userDiagMult * (DIAG_FRACTION * minScreenLen) / maxVal;
        const diagScale3D = userDiagMult * (DIAG_FRACTION * minModelLen)  / maxVal;

        // ── Draw per element ────────────────────────────────────────────
        for (const eid of eids) {
            const e = _model.elements[eid];
            const ef = _results.elemForces[eid];
            if (!ef) continue;
            const et = e.type;

            // ── BAR2 axial (2D screen) ────────────────────────────────
            if (et === 'BAR2' && type === 'axial') {
                const p1 = nodePos(e.nodes[0], _opts.showDeformed);
                const p2 = nodePos(e.nodes[1], _opts.showDeformed);
                const dx = p2.x - p1.x, dy = p2.y - p1.y;
                const sL = Math.sqrt(dx * dx + dy * dy);
                if (sL < 1) continue;
                const nx = -dy / sL, ny = dx / sL;
                const val = ef.axial * diagScale;
                const fc = ef.axial >= 0 ? 'rgba(244,67,54,.2)' : 'rgba(33,150,243,.2)';
                const sc = ef.axial >= 0 ? '#F44336' : '#2196F3';
                ctx.beginPath();
                ctx.moveTo(p1.x, p1.y);
                ctx.lineTo(p1.x + nx * val, p1.y + ny * val);
                ctx.lineTo(p2.x + nx * val, p2.y + ny * val);
                ctx.lineTo(p2.x, p2.y);
                ctx.closePath();
                ctx.fillStyle = fc; ctx.fill();
                ctx.strokeStyle = sc; ctx.lineWidth = 1.5; ctx.stroke();
                ctx.font = '15px "JetBrains Mono", monospace';
                ctx.fillStyle = sc; ctx.textAlign = 'center';
                ctx.fillText(ef.axial.toFixed(2),
                    (p1.x + p2.x) / 2 + nx * val * 0.5,
                    (p1.y + p2.y) / 2 + ny * val * 0.5 - 4);
            }

            // ── BAR3D axial (3D projected) ────────────────────────────
            if (et === 'BAR3D' && type === 'axial' && ef.ex) {
                const n1 = _model.nodes[e.nodes[0]];
                const fc = ef.axial >= 0 ? 'rgba(244,67,54,.2)' : 'rgba(33,150,243,.2)';
                const sc = ef.axial >= 0 ? '#F44336' : '#2196F3';
                _drawBeam3DDiag(n1, ef, () => ef.axial, ef.ey, diagScale3D, fc, sc);
            }

            // ── BEAM2D (2D screen) ────────────────────────────────────
            if (et === 'BEAM2D') {
                const validTypes = { axial: true, sfd: true, bmd: true };
                if (!validTypes[type]) continue;

                const p1 = nodePos(e.nodes[0], _opts.showDeformed);
                const p2 = nodePos(e.nodes[1], _opts.showDeformed);
                const dx = p2.x - p1.x, dy = p2.y - p1.y;
                const sL = Math.sqrt(dx * dx + dy * dy);
                if (sL < 1) continue;
                const nx = -dy / sL, ny = dx / sL;

                let fc, sc, v1, v2;
                if (type === 'bmd')  { fc = 'rgba(156,39,176,.2)'; sc = '#9C27B0'; v1 = -ef.M1; v2 = ef.M2; }
                else if (type === 'sfd') { fc = 'rgba(33,150,243,.2)';  sc = '#2196F3'; v1 = -ef.V1; v2 = ef.V2; }
                else                 { fc = 'rgba(244,67,54,.2)';  sc = '#F44336'; v1 = -ef.N1; v2 = ef.N2; }

                const numPts = 20;
                ctx.beginPath();
                ctx.moveTo(p1.x, p1.y);
                for (let i = 0; i <= numPts; i++) {
                    const t = i / numPts;
                    let val;
                    if (type === 'bmd') {
                        const xp = t * ef.L;
                        val = -ef.M1 + ef.V1 * xp
                            + (ef.wy1 || 0) * xp * xp / 2
                            + ((ef.wy2 || 0) - (ef.wy1 || 0)) * xp * xp * xp / (6 * ef.L);
                    } else if (type === 'sfd') {
                        const xp = t * ef.L;
                        val = -ef.V1 - (ef.wy1 || 0) * xp
                            - ((ef.wy2 || 0) - (ef.wy1 || 0)) * xp * xp / (2 * ef.L);
                    } else {
                        val = v1 + (v2 - v1) * t;
                    }
                    ctx.lineTo(p1.x + dx * t + nx * val * diagScale,
                               p1.y + dy * t + ny * val * diagScale);
                }
                ctx.lineTo(p2.x, p2.y);
                ctx.closePath();
                ctx.fillStyle = fc; ctx.fill();
                ctx.strokeStyle = sc; ctx.lineWidth = 1.5; ctx.stroke();

                ctx.font = '15px "JetBrains Mono", monospace';
                ctx.fillStyle = sc; ctx.textAlign = 'center';
                ctx.fillText(v1.toFixed(2), p1.x + nx * v1 * diagScale, p1.y + ny * v1 * diagScale - 5);
                ctx.fillText(v2.toFixed(2), p2.x + nx * v2 * diagScale, p2.y + ny * v2 * diagScale - 5);
            }

            // ── BEAM3D (3D projected) ─────────────────────────────────
            if (et === 'BEAM3D' && ef.ex) {
                const n1 = _model.nodes[e.nodes[0]];
                let valFn, perp, fc, sc;

                if (type === 'axial') {
                    valFn = t => -ef.N1 + (ef.N1 + ef.N2) * t;
                    perp = ef.ey; fc = 'rgba(244,67,54,.2)'; sc = '#F44336';
                } else if (type === 'sfd') {
                    valFn = t => { const xp = t * ef.L; return -ef.Vy1 - (ef.wy1||0)*xp - ((ef.wy2||0)-(ef.wy1||0))*xp*xp/(2*ef.L); };
                    perp = ef.ey; fc = 'rgba(33,150,243,.2)'; sc = '#2196F3';
                } else if (type === 'bmd') {
                    valFn = t => { const xp = t * ef.L; return -ef.Mz1 + ef.Vy1 * xp + (ef.wy1||0)*xp*xp/2 + ((ef.wy2||0)-(ef.wy1||0))*xp*xp*xp/(6*ef.L); };
                    perp = ef.ey; fc = 'rgba(156,39,176,.2)'; sc = '#9C27B0';
                } else if (type === 'sfd_z') {
                    valFn = t => { const xp = t * ef.L; return -ef.Vz1 - (ef.wz1||0)*xp - ((ef.wz2||0)-(ef.wz1||0))*xp*xp/(2*ef.L); };
                    perp = ef.ez; fc = 'rgba(0,188,212,.2)'; sc = '#00BCD4';
                } else if (type === 'bmd_y') {
                    valFn = t => { const xp = t * ef.L; return -ef.My1 + ef.Vz1 * xp + (ef.wz1||0)*xp*xp/2 + ((ef.wz2||0)-(ef.wz1||0))*xp*xp*xp/(6*ef.L); };
                    perp = ef.ez; fc = 'rgba(255,152,0,.2)'; sc = '#FF9800';
                } else if (type === 'torsion') {
                    valFn = t => -ef.T1 + (ef.T1 + ef.T2) * t;
                    perp = ef.ey; fc = 'rgba(76,175,80,.2)'; sc = '#4CAF50';
                } else {
                    continue;
                }
                _drawBeam3DDiag(n1, ef, valFn, perp, diagScale3D, fc, sc);
            }
        }
    }

    // ── Stress contour overlay on 2D elements (re-draw with fills) ───────

    function drawStressContour(deformed) {
        // Already handled in drawElements via fillStyle
    }

    // ── Stress coloring ───────────────────────────────────────────────────

    let _stressRange = null;

    function computeStressRange() {
        if (!_results) { _stressRange = null; return; }
        const compIdx = { sxx: 0, syy: 1, txy: 2, smax: 3, smin: 4, mises: 5 }[_opts.resultType];

        // ── Standard 2D solid stress (nodeStress available) ──────────────
        if (compIdx !== undefined &&
                _results.nodeStress && Object.keys(_results.nodeStress).length > 0) {
            let mn = Infinity, mx = -Infinity;
            for (const nid of Object.keys(_results.nodeStress)) {
                const v = _results.nodeStress[nid][compIdx];
                if (v < mn) mn = v; if (v > mx) mx = v;
            }
            if (Math.abs(mx - mn) < 1e-15) { mn -= 1; mx += 1; }
            _stressRange = { min: mn, max: mx, comp: compIdx };
            return;
        }

        // ── Beam / Truss force contour ────────────────────────────────────
        // sxx → Axial Force (N),   syy → Bending Moment (Mz)
        if ((_opts.resultType === 'sxx' || _opts.resultType === 'syy') &&
                _results.elemForces && _model) {
            let mn = Infinity, mx = -Infinity;
            for (const eid of Object.keys(_model.elements)) {
                const e  = _model.elements[+eid];
                const ef = _results.elemForces[+eid];
                if (!ef) continue;
                const typ = e.type;
                if (typ === 'BAR2' || typ === 'BAR3D' || typ === 'BAR2_3N') {
                    if (_opts.resultType === 'sxx') {
                        const v = ef.axial || 0;
                        mn = Math.min(mn, v); mx = Math.max(mx, v);
                    }
                } else if (typ === 'BEAM2D' || typ === 'BEAM3D') {
                    if (_opts.resultType === 'sxx') {
                        mn = Math.min(mn, -ef.N1, ef.N2);
                        mx = Math.max(mx, -ef.N1, ef.N2);
                    } else { // syy → Bending Moment Mz
                        const M1r = typ === 'BEAM2D' ? ef.M1  : ef.Mz1;
                        const V1r = typ === 'BEAM2D' ? ef.V1  : ef.Vy1;
                        for (let k = 0; k <= 10; k++) {
                            const xp = (k / 10) * ef.L;
                            const mv = -M1r + V1r * xp
                                + (ef.wy1 || 0) * xp * xp / 2
                                + ((ef.wy2 || 0) - (ef.wy1 || 0)) * xp * xp * xp / (6 * ef.L);
                            mn = Math.min(mn, mv); mx = Math.max(mx, mv);
                        }
                    }
                } else if (typ.startsWith('TIMBEAM')) {
                    // 티모셴코 보: 끝단 값으로 범위 산정
                    if (_opts.resultType === 'sxx') {
                        mn = Math.min(mn, ef.N1 || 0, ef.N2 || 0);
                        mx = Math.max(mx, ef.N1 || 0, ef.N2 || 0);
                    } else {
                        mn = Math.min(mn, ef.M1 || 0, ef.M2 || 0);
                        mx = Math.max(mx, ef.M1 || 0, ef.M2 || 0);
                    }
                }
            }
            if (!isFinite(mn)) { _stressRange = null; return; }
            if (Math.abs(mx - mn) < 1e-15) { mn -= 1; mx += 1; }
            _stressRange = { min: mn, max: mx, comp: -1, beamForce: true };
            return;
        }

        _stressRange = null;
    }

    function stressColor(val) {
        if (!_stressRange) computeStressRange();
        if (!_stressRange) return '#ccc';
        let frac = (val - _stressRange.min) / (_stressRange.max - _stressRange.min);
        frac = Math.max(0, Math.min(1, frac));
        return fracToColor(frac);
    }

    function fracToColor(f) {
        let r, g, b;
        if (f < 0.25) { const t = f / 0.25; r = 0; g = Math.round(255 * t); b = 255; }
        else if (f < 0.5) { const t = (f - 0.25) / 0.25; r = 0; g = 255; b = Math.round(255 * (1 - t)); }
        else if (f < 0.75) { const t = (f - 0.5) / 0.25; r = Math.round(255 * t); g = 255; b = 0; }
        else { const t = (f - 0.75) / 0.25; r = 255; g = Math.round(255 * (1 - t)); b = 0; }
        return `rgb(${r},${g},${b})`;
    }

    function getStressRange() {
        computeStressRange();
        return _stressRange;
    }

    // ── Polygon drawing (click-to-place nodes) ────────────────────────────

    let _polygonPts = [];
    let _closePolygon = true;   // false = open polyline (for BEAM/BAR chains)
    let _selectedNode = null;
    let _holePreviewPts = null; // polygon preview for rect/circle hole drag

    function setSelectedNode(nid) { _selectedNode = nid; }
    function getPolygonPts() { return _polygonPts; }
    function clearPolygon() { _polygonPts = []; }
    function addPolygonPt(mx, my) { _polygonPts.push({ x: mx, y: my }); }
    function setClosePolygon(flag) { _closePolygon = !!flag; }
    function setHolePreview(pts) { _holePreviewPts = pts || null; }

    function drawHolePreview() {
        if (!_holePreviewPts || _holePreviewPts.length < 2) return;
        ctx.save();
        ctx.strokeStyle = '#E53935';
        ctx.fillStyle = 'rgba(229,57,53,0.15)';
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 3]);
        ctx.beginPath();
        const p0 = toScreen(_holePreviewPts[0].x, _holePreviewPts[0].y);
        ctx.moveTo(p0.x, p0.y);
        for (let i = 1; i < _holePreviewPts.length; i++) {
            const p = toScreen(_holePreviewPts[i].x, _holePreviewPts[i].y);
            ctx.lineTo(p.x, p.y);
        }
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
    }

    function drawPolygon() {
        if (_polygonPts.length === 0) return;

        // Solid orange line segments connecting clicked nodes in order.
        // While still drawing (_drawMode), show an open polyline.
        // After EndDraw (!_drawMode), close the polygon only if _closePolygon is true.
        ctx.strokeStyle = '#FF6F00';
        ctx.lineWidth = 2;

        ctx.beginPath();
        const p0 = toScreen(_polygonPts[0].x, _polygonPts[0].y);
        ctx.moveTo(p0.x, p0.y);
        for (let i = 1; i < _polygonPts.length; i++) {
            const p = toScreen(_polygonPts[i].x, _polygonPts[i].y);
            ctx.lineTo(p.x, p.y);
        }
        if (!_drawMode && _closePolygon && _polygonPts.length > 2) ctx.closePath();
        ctx.stroke();

        // Node dots with sequence numbers
        for (let i = 0; i < _polygonPts.length; i++) {
            const p = toScreen(_polygonPts[i].x, _polygonPts[i].y);
            ctx.beginPath();
            ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
            ctx.fillStyle = '#FF6F00';
            ctx.fill();
            ctx.fillStyle = '#fff';
            ctx.font = '9px Inter';
            ctx.textAlign = 'center';
            ctx.fillText(i + 1, p.x, p.y + 3);
        }
    }

    /** Find the closest node to screen coords (returns nid or null) */
    function hitTestNode(sx, sy, radius) {
        if (!_model) return null;
        radius = radius || 10;
        let best = null, bestDist = radius;
        for (const nid of Object.keys(_model.nodes).map(Number)) {
            const p = nodePos(nid, false);
            const d = Math.sqrt((p.x - sx) ** 2 + (p.y - sy) ** 2);
            if (d < bestDist) { best = nid; bestDist = d; }
        }
        return best;
    }

    // ── Selection API ──────────────────────────────────────────────────────
    function setSelectedElements(set) { _selectedElements = set instanceof Set ? set : new Set(set); }
    function setSelectedNodes(set) { _selectedNodes = set instanceof Set ? set : new Set(set); }
    function getSelectedElements() { return _selectedElements; }
    function getSelectedNodes() { return _selectedNodes; }
    function clearSelection() { _selectedElements.clear(); _selectedNodes.clear(); _selectedNode = null; }

    /** Hit-test for element under screen coords */
    function hitTestElement(sx, sy, tolerance) {
        if (!_model) return null;
        tolerance = tolerance || 8;
        for (const eid of Object.keys(_model.elements).map(Number)) {
            const e = _model.elements[eid];
            if (e.type.startsWith('BAR') || e.type.startsWith('BEAM')) {
                const p1 = nodePos(e.nodes[0], false);
                const p2 = nodePos(e.nodes[1], false);
                const d = distPointToSeg(sx, sy, p1.x, p1.y, p2.x, p2.y);
                if (d < tolerance) return eid;
            } else {
                // 2D elements: point-in-polygon
                const corners = e.type.startsWith('TRIG') ? 3 : 4;
                const pts = [];
                for (let j = 0; j < corners; j++) pts.push(nodePos(e.nodes[j], false));
                if (pointInPoly(sx, sy, pts)) return eid;
            }
        }
        return null;
    }

    function distPointToSeg(px, py, ax, ay, bx, by) {
        const dx = bx - ax, dy = by - ay;
        const lenSq = dx * dx + dy * dy;
        if (lenSq < 1e-12) return Math.sqrt((px - ax) ** 2 + (py - ay) ** 2);
        let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
        t = Math.max(0, Math.min(1, t));
        const cx = ax + t * dx, cy = ay + t * dy;
        return Math.sqrt((px - cx) ** 2 + (py - cy) ** 2);
    }

    function pointInPoly(x, y, pts) {
        let inside = false;
        for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
            const xi = pts[i].x, yi = pts[i].y, xj = pts[j].x, yj = pts[j].y;
            if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi))
                inside = !inside;
        }
        return inside;
    }

    // ── Drag-select API ───────────────────────────────────────────────────
    function setDragRect(rect) { _dragRect = rect; }
    function clearDragRect() { _dragRect = null; }

    /** Find all elements whose centroid is inside screen rect */
    function elementsInRect(x1, y1, x2, y2) {
        const lx = Math.min(x1, x2), ly = Math.min(y1, y2);
        const rx = Math.max(x1, x2), ry = Math.max(y1, y2);
        const result = [];
        for (const eid of Object.keys(_model.elements).map(Number)) {
            const e = _model.elements[eid];
            const nn = FepsSolver.elNode(e.type);
            let cx = 0, cy = 0;
            for (let j = 0; j < nn; j++) {
                const p = nodePos(e.nodes[j], false);
                cx += p.x; cy += p.y;
            }
            cx /= nn; cy /= nn;
            if (cx >= lx && cx <= rx && cy >= ly && cy <= ry) result.push(eid);
        }
        return result;
    }

    /** Find all nodes inside screen rect */
    function nodesInRect(x1, y1, x2, y2) {
        const lx = Math.min(x1, x2), ly = Math.min(y1, y2);
        const rx = Math.max(x1, x2), ry = Math.max(y1, y2);
        const result = [];
        for (const nid of Object.keys(_model.nodes).map(Number)) {
            const p = nodePos(nid, false);
            if (p.x >= lx && p.x <= rx && p.y >= ly && p.y <= ry) result.push(nid);
        }
        return result;
    }

    return {
        init, resize, draw, setModel, setResults, setOpts,
        toModel, toScreen, nodePos, hitTestNode, hitTestElement,
        addPolygonPt, getPolygonPts, clearPolygon, setClosePolygon, setHolePreview,
        setSelectedNode, getStressRange, fracToColor,
        computeStressRange,
        // Draw-mode API
        setDrawMode, isDrawMode, getDrawPending,
        pushDrawNode, resetDrawPending, setDrawMouse,
        // Selection API
        setSelectedElements, setSelectedNodes,
        getSelectedElements, getSelectedNodes, clearSelection,
        // Drag-select API
        setDragRect, clearDragRect, elementsInRect, nodesInRect,
        // Pan/Zoom API
        resetView, applyPan, applyZoom, zoomAll,
        // Zoom-window API
        setZoomRect, clearZoomRect, zoomToRect,
        // 3D API
        is3D, applyRotate, project3D
    };
})();
