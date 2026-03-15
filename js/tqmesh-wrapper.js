/* ======================================================================
   tqmesh-wrapper.js  –  JavaScript wrapper for TQMesh WASM module
   ======================================================================
   Provides FepsTQMesh.generateMesh() with the SAME signature and
   return format as FepsMesher2.generateMesh(), making it a drop-in
   replacement.

   Depends on:  tqmesh.js  (Emscripten SINGLE_FILE build; defines TQMeshModule)
   ====================================================================== */

const FepsTQMesh = (() => {
    'use strict';

    let _module = null;   // Cached WASM module instance
    let _loading = null;  // Promise while loading
    let _loadFailed = false;

    // ──────────────────────────────────────────────────────────────
    //  WASM module loading (SINGLE_FILE — binary embedded in JS)
    // ──────────────────────────────────────────────────────────────

    /** Lazy-load the WASM module (first call only). */
    async function ensureLoaded() {
        if (_module) return;

        if (_loading) {
            try { await _loading; return; }
            catch { _loading = null; }
        }

        if (_loadFailed) {
            throw new Error('TQMesh WASM 로딩이 이전에 실패했습니다. 페이지를 새로고침해 주세요.');
        }

        if (typeof TQMeshModule === 'undefined') {
            throw new Error('TQMeshModule not found — tqmesh.js not loaded');
        }

        console.log('[TQMesh] Initializing WASM module…');

        const loadPromise = TQMeshModule().then(mod => {
            console.log('[TQMesh] Module ready, generateMesh:', typeof mod.generateMesh);
            return mod;
        });

        const timeout = new Promise((_, reject) =>
            setTimeout(() => reject(new Error('TQMesh WASM 로딩 타임아웃 (10초)')), 10000)
        );

        _loading = loadPromise;
        try {
            _module = await Promise.race([loadPromise, timeout]);
        } catch (e) {
            _loading = null;
            _module = null;
            _loadFailed = true;
            console.error('[TQMesh] Loading failed:', e.message);
            throw e;
        }
        _loading = null;
    }

    /** Check whether the WASM module is available. */
    function isAvailable() {
        return typeof TQMeshModule !== 'undefined';
    }

    // ──────────────────────────────────────────────────────────────
    //  Geometry helpers
    // ──────────────────────────────────────────────────────────────

    /** Signed area — positive = CCW. */
    function signedArea(poly) {
        let s = 0;
        const n = poly.length;
        for (let i = 0, j = n - 1; i < n; j = i++) {
            s += poly[j].x * poly[i].y - poly[i].x * poly[j].y;
        }
        return s * 0.5;
    }

    /** Ensure polygon is in the given winding order. */
    function ensureWinding(poly, ccw) {
        const area = signedArea(poly);
        if ((ccw && area < 0) || (!ccw && area > 0)) {
            return poly.slice().reverse();
        }
        return poly;
    }

    /** Remove duplicate adjacent points (distance < eps). */
    function cleanPoints(poly) {
        const clean = [];
        for (let i = 0; i < poly.length; i++) {
            const p1 = poly[i];
            const p2 = poly[(i + 1) % poly.length];
            const distSq = (p1.x - p2.x) ** 2 + (p1.y - p2.y) ** 2;
            if (distSq > 1e-12) {
                clean.push(p1);
            }
        }
        return clean;
    }

    /** Convert [{x,y}, ...] to flat [x0,y0, x1,y1, ...] with optional offset. */
    function flatten(poly, ofsX = 0, ofsY = 0) {
        const clean = cleanPoints(poly);
        const arr = new Array(clean.length * 2);
        for (let i = 0; i < clean.length; i++) {
            arr[i * 2]     = clean[i].x - ofsX;
            arr[i * 2 + 1] = clean[i].y - ofsY;
        }
        return arr;
    }

    // ──────────────────────────────────────────────────────────────
    //  Embind vector → JS array helper
    // ──────────────────────────────────────────────────────────────

    function vecToArray(v, n) {
        if (!v) return [];
        if (typeof v.size === 'function' && typeof v.get === 'function') {
            const len = (n != null) ? n : v.size();
            const a = new Array(len);
            for (let i = 0; i < len; i++) a[i] = v.get(i);
            return a;
        }
        if (Array.isArray(v)) return v;
        return Array.from(v);
    }

    /** Safely delete an Embind handle. */
    function safeDelete(obj) {
        if (obj && typeof obj.delete === 'function') {
            try { obj.delete(); } catch (_) { /* already deleted */ }
        }
    }

    // ──────────────────────────────────────────────────────────────
    //  Mid-node insertion  (for TRIG6 / QUAD8)
    // ──────────────────────────────────────────────────────────────

    function addMidTri(pts, tris) {
        const cache = {};
        const mid = (a, b) => {
            const k = a < b ? `${a}_${b}` : `${b}_${a}`;
            if (k in cache) return cache[k];
            const idx = pts.length;
            pts.push({
                x: (pts[a].x + pts[b].x) * 0.5,
                y: (pts[a].y + pts[b].y) * 0.5
            });
            return (cache[k] = idx);
        };
        return tris.map(t => [
            t[0], t[1], t[2],
            mid(t[0], t[1]), mid(t[1], t[2]), mid(t[2], t[0])
        ]);
    }

    function addMidQuad(pts, elems) {
        const cache = {};
        const mid = (a, b) => {
            const k = a < b ? `${a}_${b}` : `${b}_${a}`;
            if (k in cache) return cache[k];
            const idx = pts.length;
            pts.push({
                x: (pts[a].x + pts[b].x) * 0.5,
                y: (pts[a].y + pts[b].y) * 0.5
            });
            return (cache[k] = idx);
        };
        return elems.map(e =>
            e.length === 4
                ? [e[0], e[1], e[2], e[3],
                   mid(e[0], e[1]), mid(e[1], e[2]),
                   mid(e[2], e[3]), mid(e[3], e[0])]
                : [e[0], e[1], e[2],
                   mid(e[0], e[1]), mid(e[1], e[2]), mid(e[2], e[0])]
        );
    }

    /** QUAD5: add center node to each quad; leave leftover tris as TRIG3. */
    function addCenterQuad(pts, elems) {
        return elems.map(e => {
            if (e.length !== 4) return e;  // leftover tri → keep as TRIG3
            const ci = pts.length;
            pts.push({
                x: (pts[e[0]].x + pts[e[1]].x + pts[e[2]].x + pts[e[3]].x) * 0.25,
                y: (pts[e[0]].y + pts[e[1]].y + pts[e[2]].y + pts[e[3]].y) * 0.25
            });
            return [e[0], e[1], e[2], e[3], ci];
        });
    }

    /** QUAD9: add mid-side + center nodes to quads; leftover tris → TRIG6. */
    function addMidAndCenterQuad(pts, elems) {
        const cache = {};
        const mid = (a, b) => {
            const k = a < b ? `${a}_${b}` : `${b}_${a}`;
            if (k in cache) return cache[k];
            const idx = pts.length;
            pts.push({
                x: (pts[a].x + pts[b].x) * 0.5,
                y: (pts[a].y + pts[b].y) * 0.5
            });
            return (cache[k] = idx);
        };
        return elems.map(e => {
            if (e.length === 4) {
                const m01 = mid(e[0], e[1]), m12 = mid(e[1], e[2]);
                const m23 = mid(e[2], e[3]), m30 = mid(e[3], e[0]);
                const ci = pts.length;
                pts.push({
                    x: (pts[e[0]].x + pts[e[1]].x + pts[e[2]].x + pts[e[3]].x) * 0.25,
                    y: (pts[e[0]].y + pts[e[1]].y + pts[e[2]].y + pts[e[3]].y) * 0.25
                });
                return [e[0], e[1], e[2], e[3], m01, m12, m23, m30, ci];
            } else {
                // leftover triangle → TRIG6
                return [e[0], e[1], e[2],
                        mid(e[0], e[1]), mid(e[1], e[2]), mid(e[2], e[0])];
            }
        });
    }

    // ──────────────────────────────────────────────────────────────
    //  All-quad subdivision
    //
    //  Converts a mixed tri/quad mesh to a pure-quad mesh:
    //    Triangle (3 nodes) → 3 quads (via centroid + edge midpoints)
    //    Quad     (4 nodes) → 4 quads (via centroid + edge midpoints)
    //
    //  Edge midpoints are shared via cache → conformal mesh.
    // ──────────────────────────────────────────────────────────────

    function allQuadSubdivision(pts, elems) {
        const midCache = {};
        const newElems = [];

        function getMid(a, b) {
            const k = a < b ? `${a}_${b}` : `${b}_${a}`;
            if (k in midCache) return midCache[k];
            const idx = pts.length;
            pts.push({
                x: (pts[a].x + pts[b].x) * 0.5,
                y: (pts[a].y + pts[b].y) * 0.5
            });
            midCache[k] = idx;
            return idx;
        }

        for (const elem of elems) {
            if (elem.length === 3) {
                const [a, b, c] = elem;
                const mab = getMid(a, b);
                const mbc = getMid(b, c);
                const mca = getMid(c, a);
                const g = pts.length;
                pts.push({
                    x: (pts[a].x + pts[b].x + pts[c].x) / 3,
                    y: (pts[a].y + pts[b].y + pts[c].y) / 3
                });
                newElems.push([a, mab, g, mca]);
                newElems.push([b, mbc, g, mab]);
                newElems.push([c, mca, g, mbc]);

            } else if (elem.length === 4) {
                const [a, b, c, d] = elem;
                const mab = getMid(a, b);
                const mbc = getMid(b, c);
                const mcd = getMid(c, d);
                const mda = getMid(d, a);
                const g = pts.length;
                pts.push({
                    x: (pts[a].x + pts[b].x + pts[c].x + pts[d].x) / 4,
                    y: (pts[a].y + pts[b].y + pts[c].y + pts[d].y) / 4
                });
                newElems.push([a, mab, g, mda]);
                newElems.push([b, mbc, g, mab]);
                newElems.push([c, mcd, g, mbc]);
                newElems.push([d, mda, g, mcd]);
            }
        }
        return newElems;
    }

    // ──────────────────────────────────────────────────────────────
    //  Public API — same signature as FepsMesher2.generateMesh()
    // ──────────────────────────────────────────────────────────────

    /**
     * Generate a 2-D finite element mesh inside a closed polygon.
     *
     * @param {Array<{x,y}>}          polygon    Outer boundary (any winding)
     * @param {string}                elemType   'TRIG3'|'TRIG6'|'QUAD4'|'QUAD8'
     * @param {number}                targetLen  Target edge length (<=0 -> auto)
     * @param {number}                smoothIter Smoothing iterations (default 3)
     * @param {Array<Array<{x,y}>>}   holes      Interior hole polygons
     * @returns {Promise<{ nodes: Array<{x,y}>, elements: Array<number[]> }>}
     */
    async function generateMesh(polygon, elemType, targetLen, smoothIter, holes) {
        await ensureLoaded();

        holes = holes || [];
        if (smoothIter == null || isNaN(smoothIter)) smoothIter = 3;
        smoothIter = Math.max(0, Math.min(50, smoothIter | 0));

        const wantQuad = (elemType === 'QUAD4' || elemType === 'QUAD8' ||
                          elemType === 'QUAD5' || elemType === 'QUAD9');

        // ── Compute bounding box ─────────────────────────────
        let xMin = Infinity, xMax = -Infinity,
            yMin = Infinity, yMax = -Infinity;
        for (const p of polygon) {
            if (p.x < xMin) xMin = p.x;
            if (p.x > xMax) xMax = p.x;
            if (p.y < yMin) yMin = p.y;
            if (p.y > yMax) yMax = p.y;
        }

        // Auto edge-length: consider both polygon size and hole gaps
        if (!(targetLen > 0)) {
            const diag = Math.sqrt((xMax - xMin) ** 2 + (yMax - yMin) ** 2);
            let autoLen = diag / 8;

            // When holes exist, ensure edge length fits in the
            // narrowest gap between hole and exterior boundary.
            for (const h of holes) {
                let hxMin = Infinity, hxMax = -Infinity;
                let hyMin = Infinity, hyMax = -Infinity;
                for (const p of h) {
                    if (p.x < hxMin) hxMin = p.x;
                    if (p.x > hxMax) hxMax = p.x;
                    if (p.y < hyMin) hyMin = p.y;
                    if (p.y > hyMax) hyMax = p.y;
                }
                // Edge length ≤ 1/3 of smallest hole dimension
                const holeMinDim = Math.min(hxMax - hxMin, hyMax - hyMin);
                if (holeMinDim > 0) autoLen = Math.min(autoLen, holeMinDim / 3);

                // Edge length ≤ 1/2 of narrowest gap to exterior
                const minGap = Math.min(
                    hxMin - xMin, xMax - hxMax,
                    hyMin - yMin, yMax - hyMax
                );
                if (minGap > 0) autoLen = Math.min(autoLen, minGap / 2);
            }

            targetLen = Math.max(autoLen, 1e-6);
        }

        // ── Translate geometry to origin ─────────────────────
        //    TQMesh's quadtree works better with coordinates near origin.
        const ofsX = (xMin + xMax) * 0.5;
        const ofsY = (yMin + yMax) * 0.5;

        // Ensure correct winding: exterior CCW, holes CW
        const extPoly = ensureWinding(polygon, true);   // CCW
        const extFlat = flatten(extPoly, ofsX, ofsY);

        const holeFlatList = holes.map(h => {
            const cwHole = ensureWinding(h, false);  // CW
            return flatten(cwHole, ofsX, ofsY);
        });

        // ── Safety check ─────────────────────────────────────
        {
            const area = Math.abs(signedArea(polygon));
            const estElems = Math.round(area / (targetLen * targetLen));
            console.log('[TQMesh] generateMesh:',
                'verts=' + (extFlat.length / 2),
                'holes=' + holeFlatList.length,
                'edgeLen=' + targetLen.toFixed(3),
                'quad=' + wantQuad,
                'smooth=' + smoothIter,
                '~' + estElems + ' elements');

            if (estElems > 500000) {
                throw new Error(
                    `예상 요소 수가 너무 많습니다 (~${estElems.toLocaleString()}개). ` +
                    `Edge Length를 늘리거나 폴리곤을 줄여주세요.`);
            }
            if (estElems > 50000) {
                const ok = confirm(
                    `예상 요소 수가 많습니다 (~${estElems.toLocaleString()}개).\n` +
                    `메시 생성에 다소 시간이 걸릴 수 있습니다.\n` +
                    `계속하시겠습니까?`);
                if (!ok) throw new Error('사용자가 취소했습니다.');
            }
        }

        // ── Call WASM ────────────────────────────────────────
        console.log('[TQMesh] Calling WASM generateMesh…');
        const res = _module.generateMesh(extFlat, holeFlatList,
                                         targetLen, wantQuad, smoothIter);

        // ── Check for errors ─────────────────────────────────
        const errStr = res.error;
        if (errStr && errStr.length > 0) {
            safeDelete(res);
            throw new Error(errStr);
        }

        // ── Read results ─────────────────────────────────────
        const nVerts = res.nVerts;
        const nTris  = res.nTris;
        const nQuads = res.nQuads;

        const rawCoords   = vecToArray(res.coords,   nVerts * 2);
        const rawTriConn  = vecToArray(res.triConn,   nTris  * 3);
        const rawQuadConn = vecToArray(res.quadConn,  nQuads * 4);

        safeDelete(res);

        console.log('[TQMesh] Result: verts=' + nVerts,
                    'tris=' + nTris, 'quads=' + nQuads);

        // ── Build nodes (translate back to original position) ─
        const pts = [];
        for (let i = 0; i < nVerts; i++) {
            pts.push({
                x: rawCoords[i * 2]     + ofsX,
                y: rawCoords[i * 2 + 1] + ofsY
            });
        }

        // ── Build elements (collect tri3 and quad4) ──────────
        let elems = [];
        for (let i = 0; i < nTris; i++) {
            elems.push([
                rawTriConn[i * 3],
                rawTriConn[i * 3 + 1],
                rawTriConn[i * 3 + 2]
            ]);
        }
        for (let i = 0; i < nQuads; i++) {
            elems.push([
                rawQuadConn[i * 4],
                rawQuadConn[i * 4 + 1],
                rawQuadConn[i * 4 + 2],
                rawQuadConn[i * 4 + 3]
            ]);
        }

        // ── Validate ─────────────────────────────────────────
        if (pts.length === 0 || elems.length === 0) {
            throw new Error('TQMesh returned empty mesh (0 nodes or 0 elements)');
        }
        if (isNaN(pts[0].x) || isNaN(pts[0].y)) {
            throw new Error('TQMesh returned invalid coordinates (NaN)');
        }

        // ── Post-processing by element type ──────────────────
        //
        //  QUAD4: Keep TQMesh's tri2quad mixed mesh as-is.
        //         Remaining tris stay as TRIG3 (rendered yellow).
        //         This gives better element quality than
        //         allQuadSubdivision which creates degenerate quads.
        //
        //  QUAD8: Add mid-side nodes to quads (→QUAD8) and
        //         remaining tris (→TRIG6).
        //
        //  TRIG3: Use as-is (triangles from TQMesh).
        //
        //  TRIG6: Add mid-side nodes to all triangles.
        //
        if (elemType === 'QUAD4') {
            const nTrisLeft = elems.filter(e => e.length === 3).length;
            if (nTrisLeft > 0) {
                console.log('[TQMesh] Mixed mesh: ' + nTrisLeft +
                    ' leftover tris (will be TRIG3, shown in yellow)');
            }
        } else if (elemType === 'QUAD5') {
            // Add center node to quads → 5-node; leftover tris stay as TRIG3
            elems = addCenterQuad(pts, elems);
        } else if (elemType === 'QUAD8') {
            // addMidQuad handles both tris (→6-node) and quads (→8-node)
            elems = addMidQuad(pts, elems);
        } else if (elemType === 'QUAD9') {
            // Add mid-side + center nodes to quads → 9-node; leftover tris → TRIG6
            elems = addMidAndCenterQuad(pts, elems);
        } else if (elemType === 'TRIG6') {
            elems = addMidTri(pts, elems);
        }
        // TRIG3: no post-processing needed

        console.log('[TQMesh] Final: nodes=' + pts.length,
                    'elements=' + elems.length, 'type=' + elemType);

        return { nodes: pts, elements: elems };
    }

    /** Pre-load the WASM module without generating any mesh. */
    async function preload() {
        try { await ensureLoaded(); } catch (_) { /* non-critical */ }
    }

    return { generateMesh, isAvailable, preload };
})();

// ── Auto-preload WASM at page load ──────────────────────────────
setTimeout(() => {
    if (typeof FepsTQMesh !== 'undefined' && FepsTQMesh.isAvailable()) {
        const t0 = performance.now();
        console.log('[TQMesh] Preloading WASM module…');
        FepsTQMesh.preload().then(() => {
            console.log('[TQMesh] WASM ready  (' + (performance.now() - t0).toFixed(0) + ' ms)');
        });
    }
}, 0);
