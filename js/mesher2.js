/* ======================================================================
   mesher2.js  –  Advancing-Front Mesh Generator for FEPS
   ======================================================================
   Three-stage pipeline
     Stage 1: Advancing-front triangulation  (boundary-conforming TRIG3)
     Stage 2: Quality tri-to-quad pairing    (interior edges sorted by quality)
     Stage 3: Laplacian smoothing + higher-order mid-nodes (TRIG6 / QUAD8)

   Convention adopted throughout:
     Every directed front-edge (a → b) has the UNMESHED domain on its LEFT.
     • Outer polygon: CCW  → interior is on left of each edge  ✓
     • Hole polygons: CW   → domain (outside hole) is on left  ✓

   Inspired by TQMesh (A. Burkhart, MIT License).
   ====================================================================== */

const FepsMesher2 = (() => {
    'use strict';

    // ══════════════════════════════════════════════════════════════════════
    //  Vec2 helpers
    // ══════════════════════════════════════════════════════════════════════

    const vadd = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
    const vsub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
    const vscl = (a, s) => ({ x: a.x * s,   y: a.y * s   });
    const vlen = (a)    => Math.sqrt(a.x * a.x + a.y * a.y);
    const vdst = (a, b) => vlen(vsub(a, b));
    const vmid = (a, b) => ({ x: (a.x + b.x) * 0.5, y: (a.y + b.y) * 0.5 });
    const vnrm = (a)    => { const l = vlen(a) || 1e-14; return { x: a.x / l, y: a.y / l }; };
    const vlft = (d)    => ({ x: -d.y, y: d.x });   // 90° CCW — points LEFT of d
    const vcrs = (a, b) => a.x * b.y - a.y * b.x;  // 2-D cross product (scalar)
    const vdot = (a, b) => a.x * b.x + a.y * b.y;

    // ══════════════════════════════════════════════════════════════════════
    //  Geometry utilities
    // ══════════════════════════════════════════════════════════════════════

    /** Signed area of a polygon — positive = CCW (standard math axes). */
    function polySignedArea(poly) {
        let s = 0;
        const n = poly.length;
        for (let i = 0, j = n - 1; i < n; j = i++) {
            s += poly[j].x * poly[i].y - poly[i].x * poly[j].y;
        }
        return s * 0.5;
    }

    /** Ray-casting point-in-polygon test. */
    function ptInPoly(p, poly) {
        let inside = false;
        const n = poly.length;
        for (let i = 0, j = n - 1; i < n; j = i++) {
            const xi = poly[i].x, yi = poly[i].y;
            const xj = poly[j].x, yj = poly[j].y;
            if (((yi > p.y) !== (yj > p.y)) &&
                (p.x < (xj - xi) * (p.y - yi) / (yj - yi) + xi))
                inside = !inside;
        }
        return inside;
    }

    /** True if p is inside the meshing domain (outer polygon minus holes). */
    function inDomain(p, outer, holes) {
        if (!ptInPoly(p, outer)) return false;
        for (const h of holes) if (ptInPoly(p, h)) return false;
        return true;
    }

    /**
     * Proper (strict) segment-segment intersection.
     * Returns true only when the two OPEN segments cross — shared endpoints
     * and collinear overlaps return false.
     */
    function segXseg(a, b, c, d) {
        const ab = vsub(b, a), cd = vsub(d, c);
        const d1 = vcrs(ab, vsub(c, a));
        const d2 = vcrs(ab, vsub(d, a));
        const d3 = vcrs(cd, vsub(a, c));
        const d4 = vcrs(cd, vsub(b, c));
        const E = 1e-10;
        return (((d1 > E && d2 < -E) || (d1 < -E && d2 > E)) &&
                ((d3 > E && d4 < -E) || (d3 < -E && d4 > E)));
    }

    // ══════════════════════════════════════════════════════════════════════
    //  Spatial grid  (O(1) expected neighbour queries)
    // ══════════════════════════════════════════════════════════════════════

    function makeGrid(cellSize) {
        const cells = new Map();
        const cs    = cellSize;
        // Simple integer hash — avoids string allocation
        const key   = (ix, iy) => (ix & 0xFFFF) * 100003 + (iy & 0xFFFF);
        const ci    = (v)      => Math.floor(v / cs);

        return {
            add(idx, x, y) {
                const k = key(ci(x), ci(y));
                if (!cells.has(k)) cells.set(k, []);
                cells.get(k).push(idx);
            },
            remove(idx, x, y) {
                const k = key(ci(x), ci(y));
                const cell = cells.get(k);
                if (!cell) return;
                const i = cell.indexOf(idx);
                if (i >= 0) cell.splice(i, 1);
            },
            query(x, y, r) {
                const steps = Math.ceil(r / cs) + 1;
                const cx = ci(x), cy = ci(y);
                const res = [];
                for (let di = -steps; di <= steps; di++)
                    for (let dj = -steps; dj <= steps; dj++) {
                        const cell = cells.get(key(cx + di, cy + dj));
                        if (cell) for (const idx of cell) res.push(idx);
                    }
                return res;
            }
        };
    }

    // ══════════════════════════════════════════════════════════════════════
    //  Boundary discretization
    //  Inserts intermediate nodes along every polygon edge so that each
    //  resulting edge ≤ h.  This gives the front uniform initial spacing.
    // ══════════════════════════════════════════════════════════════════════

    function discretizePoly(poly, h) {
        const result = [];
        const n = poly.length;
        for (let i = 0; i < n; i++) {
            const A = poly[i], B = poly[(i + 1) % n];
            result.push({ x: A.x, y: A.y });
            const d     = vdst(A, B);
            const nseg  = Math.ceil(d / h);
            if (nseg > 1) {
                for (let k = 1; k < nseg; k++) {
                    const t = k / nseg;
                    result.push({ x: A.x + (B.x - A.x) * t,
                                  y: A.y + (B.y - A.y) * t });
                }
            }
        }
        return result;
    }

    // ══════════════════════════════════════════════════════════════════════
    //  Stage 1 — Advancing-Front Triangulation
    // ══════════════════════════════════════════════════════════════════════

    function aftTriangulate(rawOuter, rawHoles, h) {

        // ── 1a.  Orient boundaries ──────────────────────────────────────
        // Outer polygon must be CCW (positive signed area).
        const outerCCW = polySignedArea(rawOuter) > 0
            ? rawOuter.slice()
            : rawOuter.slice().reverse();

        // Holes must be CW (negative signed area) so that the meshing
        // domain is on the LEFT of each directed hole edge.
        const holesCW = rawHoles.map(hole =>
            polySignedArea(hole) < 0 ? hole.slice() : hole.slice().reverse()
        );

        // ── 1b.  Discretize boundaries to target edge length ────────────
        const outer = discretizePoly(outerCCW, h);
        const holes = holesCW.map(hol => discretizePoly(hol, h));

        // ── 1c.  Populate pts[] and initial front ───────────────────────
        const pts  = [];   // { x, y }[]
        const tris = [];   // [i, j, k][]  (all CCW)

        // front[]: directed edge { a, b } — unmeshed domain is on LEFT
        // frontSet: Set<"a_b"> for O(1) membership
        const front    = [];
        const frontSet = new Set();

        const addEdge = (a, b) => { front.push({ a, b }); frontSet.add(`${a}_${b}`); };
        const delEdge = (a, b) => {
            frontSet.delete(`${a}_${b}`);
            const i = front.findIndex(e => e.a === a && e.b === b);
            if (i >= 0) front.splice(i, 1);
        };
        const hasEdge = (a, b) => frontSet.has(`${a}_${b}`);

        // Outer polygon
        for (const p of outer) pts.push({ x: p.x, y: p.y });
        for (let i = 0; i < outer.length; i++)
            addEdge(i, (i + 1) % outer.length);

        // Holes
        for (const hole of holes) {
            const hStart = pts.length;
            for (const p of hole) pts.push({ x: p.x, y: p.y });
            for (let i = 0; i < hole.length; i++)
                addEdge(hStart + i, hStart + (i + 1) % hole.length);
        }

        const numBdryPts = pts.length;  // indices [0, numBdryPts) are boundary

        // ── 1d.  Spatial grid ───────────────────────────────────────────
        const grid = makeGrid(h * 1.5);
        for (let i = 0; i < pts.length; i++) grid.add(i, pts[i].x, pts[i].y);

        // ── 1e.  Triangle formation helper ──────────────────────────────
        //
        //  For CCW triangle (A, B, P) formed from front edge (A → B):
        //    new directed edges leaving the front:  (P → B)  and  (A → P)
        //    • if the REVERSE already exists in front → cancel (interior edge)
        //    • otherwise → add to front
        //
        function applyTriangle(Ai, Bi, Pi) {
            tris.push([Ai, Bi, Pi]);
            delEdge(Ai, Bi);

            // Process new edge (P → B)
            if (hasEdge(Bi, Pi)) delEdge(Bi, Pi);
            else                  addEdge(Pi, Bi);

            // Process new edge (A → P)
            if (hasEdge(Pi, Ai)) delEdge(Pi, Ai);
            else                  addEdge(Ai, Pi);
        }

        // ── 1f.  Validity check ─────────────────────────────────────────
        //
        //  Triangle (A, B, P) is valid when:
        //    (a) P is strictly to the LEFT of directed edge A → B
        //    (b) Triangle centroid is inside the mesh domain (outer − holes)
        //    (c) All three angles ≥ 5° (no degenerate slivers)
        //    (d) The two new edges (P→B) and (A→P) do not properly
        //        intersect any existing front edge (shared endpoints ok)
        //
        function validTri(Ai, Bi, Pi) {
            const A = pts[Ai], B = pts[Bi], P = pts[Pi];

            // (a) CCW orientation: P must be to the left of A→B
            if (vcrs(vsub(B, A), vsub(P, A)) < 1e-12) return false;

            // (b) Triangle centroid must be inside the mesh domain
            //     (rejects cross-hole and out-of-domain triangles)
            const cx = (A.x + B.x + P.x) / 3, cy = (A.y + B.y + P.y) / 3;
            if (!inDomain({ x: cx, y: cy }, outer, holes)) return false;

            // (c) Reject degenerate triangles: no angle < 5°
            const cosMin = Math.cos(Math.PI / 36);   // cos(5°) ≈ 0.9962
            const AB = vsub(B, A), AP = vsub(P, A);
            const cosA = vdot(AB, AP) / (vlen(AB) * vlen(AP) + 1e-14);
            if (cosA > cosMin) return false;
            const BA = vsub(A, B), BP = vsub(P, B);
            const cosB = vdot(BA, BP) / (vlen(BA) * vlen(BP) + 1e-14);
            if (cosB > cosMin) return false;
            const PA = vsub(A, P), PB = vsub(B, P);
            const cosC = vdot(PA, PB) / (vlen(PA) * vlen(PB) + 1e-14);
            if (cosC > cosMin) return false;

            // (d) No intersection with other front edges
            //     Skip edges incident to A, B, or P — shared endpoint ≠ crossing.
            for (const e of front) {
                if (e.a === Ai || e.b === Ai ||
                    e.a === Bi || e.b === Bi ||
                    e.a === Pi || e.b === Pi) continue;
                const EA = pts[e.a], EB = pts[e.b];
                if (segXseg(P, B, EA, EB)) return false;
                if (segXseg(A, P, EA, EB)) return false;
            }
            return true;
        }

        // ── 1g.  Main advancing-front loop ─────────────────────────────
        const MAX_ITER = (numBdryPts + 50) * 1000;
        let stall = 0, iter = 0;

        while (front.length > 0 && iter++ < MAX_ITER) {

            // Pick the shortest front edge first (fills narrow gaps quickly)
            let bestIdx = 0, bestLen = Infinity;
            for (let i = 0; i < front.length; i++) {
                const e = front[i];
                const d = vdst(pts[e.a], pts[e.b]);
                if (d < bestLen) { bestLen = d; bestIdx = i; }
            }

            const edge = front[bestIdx];
            const Ai = edge.a, Bi = edge.b;
            const A  = pts[Ai], B = pts[Bi];
            const elen = bestLen;

            // ── Ideal apex (equilateral triangle relative to h) ─────────
            const edgeDir = vnrm(vsub(B, A));
            const inward  = vlft(edgeDir);  // 90° CCW = left = into domain
            const triH    = Math.sqrt(3) * 0.5 * Math.min(elen, h);
            const mid     = vmid(A, B);
            const Pideal  = vadd(mid, vscl(inward, triH));

            // ── Phase A: find an existing node close to ideal ───────────
            const searchR = h * 0.75;
            let candidates = grid.query(Pideal.x, Pideal.y, searchR)
                .filter(i => i !== Ai && i !== Bi &&
                             vdst(pts[i], Pideal) < searchR);
            candidates.sort((i, j) => vdst(pts[i], Pideal) - vdst(pts[j], Pideal));

            let chosen = -1;
            for (const c of candidates) {
                if (validTri(Ai, Bi, c)) { chosen = c; break; }
            }

            // ── Phase B: insert ideal point (if inside domain) ──────────
            if (chosen < 0 && inDomain(Pideal, outer, holes)) {
                const tooClose = grid.query(Pideal.x, Pideal.y, h * 0.35)
                    .some(i => i !== Ai && i !== Bi &&
                               vdst(pts[i], Pideal) < h * 0.35);
                if (!tooClose) {
                    chosen = pts.length;
                    pts.push({ x: Pideal.x, y: Pideal.y });
                    grid.add(chosen, Pideal.x, Pideal.y);
                    stall = 0;
                }
            }

            // ── Phase C: broad fallback (concave / constrained regions) ─
            if (chosen < 0) {
                const broadR = h * 2.5;
                let broadC = [...new Set(
                    grid.query(Pideal.x, Pideal.y, broadR)
                        .concat(grid.query(A.x, A.y, broadR))
                        .concat(grid.query(B.x, B.y, broadR))
                )].filter(i => i !== Ai && i !== Bi);
                broadC.sort((i, j) => vdst(pts[i], Pideal) - vdst(pts[j], Pideal));
                for (const c of broadC) {
                    if (validTri(Ai, Bi, c)) { chosen = c; break; }
                }
            }

            // ── Stall handling ──────────────────────────────────────────
            if (chosen < 0) {
                stall++;
                if (stall > front.length * 4 + 20) {
                    console.warn(`AFT: gave up with ${front.length} edge(s) remaining`);
                    break;
                }
                // Rotate this edge to the end and try others first
                front.splice(bestIdx, 1);
                front.push(edge);
                continue;
            }

            applyTriangle(Ai, Bi, chosen);
            stall = 0;
        }

        return { pts, tris, numBdryPts };
    }

    // ══════════════════════════════════════════════════════════════════════
    //  Stage 2 — Quality Tri-to-Quad Pairing
    //
    //  Key idea (from TQMesh): sort all interior edges by the MINIMUM
    //  quality of the two triangles sharing that edge (ascending).  Merging
    //  the worst triangles first tends to produce the best quads because
    //  two elongated triangles sharing a long edge typically form a good
    //  parallelogram-like quad.
    // ══════════════════════════════════════════════════════════════════════

    /** Normalised triangle quality ∈ [0, 1].  Equilateral = 1. */
    function triQual(pts, t) {
        const A = pts[t[0]], B = pts[t[1]], C = pts[t[2]];
        const a = vdst(B, C), b = vdst(A, C), c = vdst(A, B);
        const p = a + b + c;
        if (p < 1e-14) return 0;
        // area2 = |cross product| = 2 * triangle_area
        // Normalised formula: 12√3 * area2 / p²  →  1.0 for equilateral
        const area2 = Math.abs(vcrs(vsub(B, A), vsub(C, A)));
        return 12 * Math.sqrt(3) * area2 / (p * p);
    }

    /** Minimum interior angle of a polygon (radians). */
    function minAngle(pts, nodes) {
        let minA = Math.PI;
        const n = nodes.length;
        for (let i = 0; i < n; i++) {
            const A = pts[nodes[(i + n - 1) % n]];
            const B = pts[nodes[i]];
            const C = pts[nodes[(i + 1) % n]];
            const ba = vsub(A, B), bc = vsub(C, B);
            const cos = vdot(ba, bc) / (vlen(ba) * vlen(bc) + 1e-14);
            minA = Math.min(minA, Math.acos(Math.max(-1, Math.min(1, cos))));
        }
        return minA;
    }

    /** True if the quad (4 nodes, CCW order) is strictly convex. */
    function isConvexQuad(pts, q) {
        for (let i = 0; i < 4; i++) {
            const a = pts[q[i]], b = pts[q[(i + 1) % 4]], c = pts[q[(i + 2) % 4]];
            if (vcrs(vsub(b, a), vsub(c, b)) < -1e-10) return false;
        }
        return true;
    }

    /** Order 4 node indices CCW around their centroid. */
    function orderCCW4(pts, a, b, c, d) {
        const nodes = [a, b, c, d];
        const cx = (pts[a].x + pts[b].x + pts[c].x + pts[d].x) * 0.25;
        const cy = (pts[a].y + pts[b].y + pts[c].y + pts[d].y) * 0.25;
        nodes.sort((i, j) =>
            Math.atan2(pts[i].y - cy, pts[i].x - cx) -
            Math.atan2(pts[j].y - cy, pts[j].x - cx)
        );
        return nodes;
    }

    function triToQuad(pts, tris) {
        // Build edge → triangle map  (interior edges appear exactly twice)
        const edgeMap = new Map();
        const eKey    = (a, b) => a < b ? `${a}_${b}` : `${b}_${a}`;

        for (let ti = 0; ti < tris.length; ti++) {
            const t = tris[ti];
            for (let e = 0; e < 3; e++) {
                const na = t[e], nb = t[(e + 1) % 3], nc = t[(e + 2) % 3];
                const k  = eKey(na, nb);
                if (!edgeMap.has(k)) edgeMap.set(k, []);
                edgeMap.get(k).push({ ti, opp: nc });
            }
        }

        // Collect candidate pairs and score them
        const pairs = [];
        for (const [k, info] of edgeMap) {
            if (info.length !== 2) continue;
            const [t1, t2] = info;
            const score = Math.min(triQual(pts, tris[t1.ti]),
                                   triQual(pts, tris[t2.ti]));
            const [ea, eb] = k.split('_').map(Number);
            pairs.push({ ti1: t1.ti, ti2: t2.ti,
                         opp1: t1.opp, opp2: t2.opp,
                         ea, eb, score });
        }

        // Sort ascending by score — pair the WORST triangles first
        pairs.sort((a, b) => a.score - b.score);

        const used   = new Set();
        const result = [];

        for (const p of pairs) {
            if (used.has(p.ti1) || used.has(p.ti2)) continue;

            const quad = orderCCW4(pts, p.opp1, p.ea, p.opp2, p.eb);

            // Quality gates:
            //   • Convex (no re-entrant vertex)
            //   • Minimum interior angle > 36° (π/5)  →  avoids needles
            if (!isConvexQuad(pts, quad))               continue;
            if (minAngle(pts, quad) < Math.PI / 5)      continue;

            result.push(quad);
            used.add(p.ti1);
            used.add(p.ti2);
        }

        // Append unmerged triangles as-is (mixed mesh is acceptable)
        for (let i = 0; i < tris.length; i++) {
            if (!used.has(i)) result.push(tris[i]);
        }
        return result;
    }

    // ══════════════════════════════════════════════════════════════════════
    //  Stage 3a — Laplacian Smoothing
    //  Moves interior nodes toward the centroid of their neighbours.
    //  Boundary nodes (index < numBdryPts) are never moved.
    // ══════════════════════════════════════════════════════════════════════

    function smooth(pts, elems, numBdry, iterations) {
        const N    = pts.length;
        const nbrs = Array.from({ length: N }, () => new Set());

        for (const e of elems) {
            const n = e.length;
            for (let i = 0; i < n; i++) {
                nbrs[e[i]].add(e[(i + 1) % n]);
                nbrs[e[(i + 1) % n]].add(e[i]);
            }
        }

        for (let it = 0; it < iterations; it++) {
            for (let i = numBdry; i < N; i++) {
                let sx = 0, sy = 0, cnt = 0;
                for (const j of nbrs[i]) { sx += pts[j].x; sy += pts[j].y; cnt++; }
                if (cnt > 0) { pts[i].x = sx / cnt; pts[i].y = sy / cnt; }
            }
        }
    }

    // ══════════════════════════════════════════════════════════════════════
    //  Stage 3b — Higher-order mid-nodes
    // ══════════════════════════════════════════════════════════════════════

    function addMidTri(pts, tris) {
        const cache = {};
        const mid   = (a, b) => {
            const k = a < b ? `${a}_${b}` : `${b}_${a}`;
            if (k in cache) return cache[k];
            const idx = pts.length;
            pts.push({ x: (pts[a].x + pts[b].x) * 0.5,
                       y: (pts[a].y + pts[b].y) * 0.5 });
            return (cache[k] = idx);
        };
        return tris.map(t => [
            t[0], t[1], t[2],
            mid(t[0], t[1]), mid(t[1], t[2]), mid(t[2], t[0])
        ]);
    }

    function addMidQuad(pts, elems) {
        const cache = {};
        const mid   = (a, b) => {
            const k = a < b ? `${a}_${b}` : `${b}_${a}`;
            if (k in cache) return cache[k];
            const idx = pts.length;
            pts.push({ x: (pts[a].x + pts[b].x) * 0.5,
                       y: (pts[a].y + pts[b].y) * 0.5 });
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

    // ══════════════════════════════════════════════════════════════════════
    //  Public API
    // ══════════════════════════════════════════════════════════════════════

    /**
     * Generate a 2-D finite element mesh inside a closed polygon.
     *
     * @param {Array<{x,y}>}          polygon   Outer boundary (any winding)
     * @param {string}                elemType  'TRIG3'|'TRIG6'|'QUAD4'|'QUAD8'
     * @param {number}                targetLen Target element edge length in model
     *                                          units.  ≤ 0 → auto (bbox diagonal/8)
     * @param {number}                smoothIter Laplacian iterations  (default 3)
     * @param {Array<Array<{x,y}>>}   holes     Interior hole polygons (any winding)
     * @returns {{ nodes: Array<{x,y}>, elements: Array<number[]> }}
     */
    function generateMesh(polygon, elemType, targetLen, smoothIter, holes) {
        holes      = holes || [];
        // Explicit null/undefined → default 3.  Zero is valid (no smoothing).
        if (smoothIter == null || isNaN(smoothIter)) smoothIter = 3;
        smoothIter = Math.max(0, Math.min(50, smoothIter | 0));

        // Auto edge-length: bounding-box diagonal / 8
        if (!(targetLen > 0)) {
            let xMin = Infinity, xMax = -Infinity,
                yMin = Infinity, yMax = -Infinity;
            for (const p of polygon) {
                if (p.x < xMin) xMin = p.x; if (p.x > xMax) xMax = p.x;
                if (p.y < yMin) yMin = p.y; if (p.y > yMax) yMax = p.y;
            }
            const diag = Math.sqrt((xMax - xMin) ** 2 + (yMax - yMin) ** 2);
            targetLen  = Math.max(diag / 8, 1e-6);
        }

        // ── Stage 1: Advancing-front triangulation ────────────────────
        const { pts, tris, numBdryPts } =
            aftTriangulate(polygon, holes, targetLen);

        if (tris.length === 0) return { nodes: [], elements: [] };

        // ── Stage 2: Tri-to-quad pairing (QUAD types only) ────────────
        const wantQuad = (elemType === 'QUAD4' || elemType === 'QUAD8');
        let elems = wantQuad ? triToQuad(pts, tris) : tris.slice();

        // ── Stage 3a: Laplacian smoothing ─────────────────────────────
        if (smoothIter > 0) smooth(pts, elems, numBdryPts, smoothIter);

        // ── Stage 3b: Higher-order mid-nodes ──────────────────────────
        if      (elemType === 'TRIG6') elems = addMidTri (pts, elems);
        else if (elemType === 'QUAD8') elems = addMidQuad(pts, elems);

        return { nodes: pts, elements: elems };
    }

    return { generateMesh };
})();
