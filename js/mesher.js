/* ======================================================================
   mesher.js  –  2D Mesh Generator for FEPS
   Supports: TRIG3, TRIG6, QUAD4, QUAD8
   Uses earcut algorithm for polygon triangulation, then subdivision
   and mid-node insertion for higher-order elements.
   ====================================================================== */

const FepsMesher = (() => {
    'use strict';

    // ══════════════════════════════════════════════════════════════════════
    //  EARCUT  – Polygon triangulation (MapBox earcut, MIT License)
    //  Simplified browser version – supports polygons with no holes.
    // ══════════════════════════════════════════════════════════════════════

    function earcut(data, holeIndices, dim) {
        dim = dim || 2;
        const hasHoles = holeIndices && holeIndices.length;
        const outerLen = hasHoles ? holeIndices[0] * dim : data.length;
        let outerNode = linkedList(data, 0, outerLen, dim, true);
        const triangles = [];
        if (!outerNode || outerNode.next === outerNode.prev) return triangles;
        if (hasHoles) outerNode = eliminateHoles(data, holeIndices, outerNode, dim);
        let minX, minY, maxX, maxY, x, y, invSize;
        if (data.length > 80 * dim) {
            minX = maxX = data[0]; minY = maxY = data[1];
            for (let i = dim; i < outerLen; i += dim) {
                x = data[i]; y = data[i + 1];
                if (x < minX) minX = x; if (y < minY) minY = y;
                if (x > maxX) maxX = x; if (y > maxY) maxY = y;
            }
            invSize = Math.max(maxX - minX, maxY - minY);
            invSize = invSize !== 0 ? 32767 / invSize : 0;
        }
        earcutLinked(outerNode, triangles, dim, minX, minY, invSize, 0);
        return triangles;
    }

    function linkedList(data, start, end, dim, clockwise) {
        let i, last;
        if (clockwise === (signedArea(data, start, end, dim) > 0)) {
            for (i = start; i < end; i += dim) last = insertNode(i, data[i], data[i + 1], last);
        } else {
            for (i = end - dim; i >= start; i -= dim) last = insertNode(i, data[i], data[i + 1], last);
        }
        if (last && equals(last, last.next)) { removeNode(last); last = last.next; }
        if (!last) return null;
        last.next.prev = last; last.prev.next = last;
        return last;
    }

    function filterPoints(start, end) {
        if (!start) return start;
        if (!end) end = start;
        let p = start, again;
        do {
            again = false;
            if (!p.steiner && (equals(p, p.next) || area(p.prev, p, p.next) === 0)) {
                removeNode(p); p = end = p.prev;
                if (p === p.next) break;
                again = true;
            } else { p = p.next; }
        } while (again || p !== end);
        return end;
    }

    function earcutLinked(ear, triangles, dim, minX, minY, invSize, pass) {
        if (!ear) return;
        if (!pass && invSize) indexCurve(ear, minX, minY, invSize);
        let stop = ear, prev, next;
        while (ear.prev !== ear.next) {
            prev = ear.prev; next = ear.next;
            if (invSize ? isEarHashed(ear, minX, minY, invSize) : isEar(ear)) {
                triangles.push(prev.i / dim | 0);
                triangles.push(ear.i / dim | 0);
                triangles.push(next.i / dim | 0);
                removeNode(ear);
                ear = next.next; stop = next.next;
                continue;
            }
            ear = next;
            if (ear === stop) {
                if (!pass) earcutLinked(filterPoints(ear), triangles, dim, minX, minY, invSize, 1);
                else if (pass === 1) {
                    ear = cureLocalIntersections(filterPoints(ear), triangles, dim);
                    earcutLinked(ear, triangles, dim, minX, minY, invSize, 2);
                } else if (pass === 2) splitEarcut(ear, triangles, dim, minX, minY, invSize);
                break;
            }
        }
    }

    function isEar(ear) {
        const a = ear.prev, b = ear, c = ear.next;
        if (area(a, b, c) >= 0) return false;
        const ax = a.x, bx = b.x, cx = c.x, ay = a.y, by = b.y, cy = c.y;
        const x0 = ax < bx ? (ax < cx ? ax : cx) : (bx < cx ? bx : cx);
        const y0 = ay < by ? (ay < cy ? ay : cy) : (by < cy ? by : cy);
        const x1 = ax > bx ? (ax > cx ? ax : cx) : (bx > cx ? bx : cx);
        const y1 = ay > by ? (ay > cy ? ay : cy) : (by > cy ? by : cy);
        let p = c.next;
        while (p !== a) {
            if (p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1 &&
                pointInTriangle(ax, ay, bx, by, cx, cy, p.x, p.y) &&
                area(p.prev, p, p.next) >= 0) return false;
            p = p.next;
        }
        return true;
    }

    function isEarHashed(ear, minX, minY, invSize) {
        const a = ear.prev, b = ear, c = ear.next;
        if (area(a, b, c) >= 0) return false;
        const ax = a.x, bx = b.x, cx = c.x, ay = a.y, by = b.y, cy = c.y;
        const x0 = ax < bx ? (ax < cx ? ax : cx) : (bx < cx ? bx : cx);
        const y0 = ay < by ? (ay < cy ? ay : cy) : (by < cy ? by : cy);
        const x1 = ax > bx ? (ax > cx ? ax : cx) : (bx > cx ? bx : cx);
        const y1 = ay > by ? (ay > cy ? ay : cy) : (by > cy ? by : cy);
        const minZ = zOrder(x0, y0, minX, minY, invSize);
        const maxZ = zOrder(x1, y1, minX, minY, invSize);
        let p = ear.prevZ, n = ear.nextZ;
        while (p && p.z >= minZ && n && n.z <= maxZ) {
            if (p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1 && p !== a && p !== c &&
                pointInTriangle(ax, ay, bx, by, cx, cy, p.x, p.y) && area(p.prev, p, p.next) >= 0) return false;
            p = p.prevZ;
            if (n.x >= x0 && n.x <= x1 && n.y >= y0 && n.y <= y1 && n !== a && n !== c &&
                pointInTriangle(ax, ay, bx, by, cx, cy, n.x, n.y) && area(n.prev, n, n.next) >= 0) return false;
            n = n.nextZ;
        }
        while (p && p.z >= minZ) {
            if (p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1 && p !== a && p !== c &&
                pointInTriangle(ax, ay, bx, by, cx, cy, p.x, p.y) && area(p.prev, p, p.next) >= 0) return false;
            p = p.prevZ;
        }
        while (n && n.z <= maxZ) {
            if (n.x >= x0 && n.x <= x1 && n.y >= y0 && n.y <= y1 && n !== a && n !== c &&
                pointInTriangle(ax, ay, bx, by, cx, cy, n.x, n.y) && area(n.prev, n, n.next) >= 0) return false;
            n = n.nextZ;
        }
        return true;
    }

    function cureLocalIntersections(start, triangles, dim) {
        let p = start;
        do {
            const a = p.prev, b = p.next.next;
            if (!equals(a, b) && intersects(a, p, p.next, b) && locallyInside(a, b) && locallyInside(b, a)) {
                triangles.push(a.i / dim | 0);
                triangles.push(p.i / dim | 0);
                triangles.push(b.i / dim | 0);
                removeNode(p); removeNode(p.next);
                p = start = b;
            }
            p = p.next;
        } while (p !== start);
        return filterPoints(p);
    }

    function splitEarcut(start, triangles, dim, minX, minY, invSize) {
        let a = start;
        do {
            let b = a.next.next;
            while (b !== a.prev) {
                if (a.i !== b.i && isValidDiagonal(a, b)) {
                    let c = splitPolygon(a, b);
                    a = filterPoints(a, a.next);
                    c = filterPoints(c, c.next);
                    earcutLinked(a, triangles, dim, minX, minY, invSize, 0);
                    earcutLinked(c, triangles, dim, minX, minY, invSize, 0);
                    return;
                }
                b = b.next;
            }
            a = a.next;
        } while (a !== start);
    }

    function eliminateHoles(data, holeIndices, outerNode, dim) {
        const queue = [];
        for (let i = 0, len = holeIndices.length; i < len; i++) {
            const start = holeIndices[i] * dim;
            const end = i < len - 1 ? holeIndices[i + 1] * dim : data.length;
            const list = linkedList(data, start, end, dim, false);
            if (list === list.next) list.steiner = true;
            queue.push(getLeftmost(list));
        }
        queue.sort((a, b) => a.x - b.x);
        for (let i = 0; i < queue.length; i++) {
            outerNode = eliminateHole(queue[i], outerNode);
        }
        return outerNode;
    }

    function eliminateHole(hole, outerNode) {
        const bridge = findHoleBridge(hole, outerNode);
        if (!bridge) return outerNode;
        const bridgeReverse = splitPolygon(bridge, hole);
        filterPoints(bridgeReverse, bridgeReverse.next);
        return filterPoints(bridge, bridge.next);
    }

    function findHoleBridge(hole, outerNode) {
        let p = outerNode, hx = hole.x, hy = hole.y, qx = -Infinity, m;
        do {
            if (hy <= p.y && hy >= p.next.y && p.next.y !== p.y) {
                const x = p.x + (hy - p.y) / (p.next.y - p.y) * (p.next.x - p.x);
                if (x <= hx && x > qx) {
                    qx = x; m = p.x < p.next.x ? p : p.next;
                    if (x === hx) return m;
                }
            }
            p = p.next;
        } while (p !== outerNode);
        if (!m) return null;
        const stop = m; let tanMin = Infinity, s;
        p = m;
        do {
            if (hx >= p.x && p.x >= m.x && hx !== p.x &&
                pointInTriangle(hy < m.y ? hx : qx, hy, m.x, m.y, hy < m.y ? qx : hx, hy, p.x, p.y)) {
                const tan = Math.abs(hy - p.y) / (hx - p.x);
                if (locallyInside(p, hole) && (tan < tanMin || (tan === tanMin && (p.x > s.x || sectorContainsSector(s, p))))) {
                    s = p; tanMin = tan;
                }
            }
            p = p.next;
        } while (p !== stop);
        return s;
    }

    function sectorContainsSector(m, p) { return area(m.prev, m, p.prev) < 0 && area(p.next, m, m.next) < 0; }
    function indexCurve(start, minX, minY, invSize) {
        let p = start;
        do { if (p.z === 0) p.z = zOrder(p.x, p.y, minX, minY, invSize); p.prevZ = p.prev; p.nextZ = p.next; p = p.next; } while (p !== start);
        p.prevZ.nextZ = null; p.prevZ = null; sortLinked(p);
    }

    function sortLinked(list) {
        let inSize = 1, numMerges, p, q, e, tail, pSize, qSize;
        do {
            p = list; list = null; tail = null; numMerges = 0;
            while (p) {
                numMerges++; q = p; pSize = 0;
                for (let i = 0; i < inSize; i++) { pSize++; q = q.nextZ; if (!q) break; }
                qSize = inSize;
                while (pSize > 0 || (qSize > 0 && q)) {
                    if (pSize !== 0 && (qSize === 0 || !q || p.z <= q.z)) { e = p; p = p.nextZ; pSize--; }
                    else { e = q; q = q.nextZ; qSize--; }
                    if (tail) tail.nextZ = e; else list = e;
                    e.prevZ = tail; tail = e;
                }
                p = q;
            }
            tail.nextZ = null; inSize *= 2;
        } while (numMerges > 1);
        return list;
    }

    function zOrder(x, y, minX, minY, invSize) {
        x = ((x - minX) * invSize) | 0; y = ((y - minY) * invSize) | 0;
        x = (x | (x << 8)) & 0x00FF00FF; x = (x | (x << 4)) & 0x0F0F0F0F;
        x = (x | (x << 2)) & 0x33333333; x = (x | (x << 1)) & 0x55555555;
        y = (y | (y << 8)) & 0x00FF00FF; y = (y | (y << 4)) & 0x0F0F0F0F;
        y = (y | (y << 2)) & 0x33333333; y = (y | (y << 1)) & 0x55555555;
        return x | (y << 1);
    }

    function getLeftmost(start) { let p = start, leftmost = start; do { if (p.x < leftmost.x || (p.x === leftmost.x && p.y < leftmost.y)) leftmost = p; p = p.next; } while (p !== start); return leftmost; }
    function pointInTriangle(ax, ay, bx, by, cx, cy, px, py) { return (cx - px) * (ay - py) - (ax - px) * (cy - py) >= 0 && (ax - px) * (by - py) - (bx - px) * (ay - py) >= 0 && (bx - px) * (cy - py) - (cx - px) * (by - py) >= 0; }
    function isValidDiagonal(a, b) { return a.next.i !== b.i && a.prev.i !== b.i && !intersectsPolygon(a, b) && (locallyInside(a, b) && locallyInside(b, a) && middleInside(a, b) && (area(a.prev, a, b.prev) || area(a, b.prev, b))); }
    function area(p, q, r) { return (q.y - p.y) * (r.x - q.x) - (q.x - p.x) * (r.y - q.y); }
    function equals(p1, p2) { return p1.x === p2.x && p1.y === p2.y; }
    function intersects(p1, q1, p2, q2) { const o1 = sign(area(p1, q1, p2)), o2 = sign(area(p1, q1, q2)), o3 = sign(area(p2, q2, p1)), o4 = sign(area(p2, q2, q1)); if (o1 !== o2 && o3 !== o4) return true; if (o1 === 0 && onSegment(p1, p2, q1)) return true; if (o2 === 0 && onSegment(p1, q2, q1)) return true; if (o3 === 0 && onSegment(p2, p1, q2)) return true; if (o4 === 0 && onSegment(p2, q1, q2)) return true; return false; }
    function onSegment(p, q, r) { return q.x <= Math.max(p.x, r.x) && q.x >= Math.min(p.x, r.x) && q.y <= Math.max(p.y, r.y) && q.y >= Math.min(p.y, r.y); }
    function sign(num) { return num > 0 ? 1 : num < 0 ? -1 : 0; }
    function intersectsPolygon(a, b) { let p = a; do { if (p.i !== a.i && p.next.i !== a.i && p.i !== b.i && p.next.i !== b.i && intersects(p, p.next, a, b)) return true; p = p.next; } while (p !== a); return false; }
    function locallyInside(a, b) { return area(a.prev, a, a.next) < 0 ? area(a, b, a.next) >= 0 && area(a, a.prev, b) >= 0 : area(a, b, a.prev) < 0 || area(a, a.next, b) < 0; }
    function middleInside(a, b) { let p = a, inside = false; const px = (a.x + b.x) / 2, py = (a.y + b.y) / 2; do { if (((p.y > py) !== (p.next.y > py)) && p.next.y !== p.y && (px < (p.next.x - p.x) * (py - p.y) / (p.next.y - p.y) + p.x)) inside = !inside; p = p.next; } while (p !== a); return inside; }
    function splitPolygon(a, b) { const a2 = createNode(a.i, a.x, a.y), b2 = createNode(b.i, b.x, b.y), an = a.next, bp = b.prev; a.next = b; b.prev = a; a2.next = an; an.prev = a2; b2.next = a2; a2.prev = b2; bp.next = b2; b2.prev = bp; return b2; }
    function insertNode(i, x, y, last) { const p = createNode(i, x, y); if (!last) { p.prev = p; p.next = p; } else { p.next = last.next; p.prev = last; last.next.prev = p; last.next = p; } return p; }
    function removeNode(p) { p.next.prev = p.prev; p.prev.next = p.next; if (p.prevZ) p.prevZ.nextZ = p.nextZ; if (p.nextZ) p.nextZ.prevZ = p.prevZ; }
    function createNode(i, x, y) { return { i, x, y, prev: null, next: null, z: 0, prevZ: null, nextZ: null, steiner: false }; }
    function signedArea(data, start, end, dim) { let sum = 0; for (let i = start, j = end - dim; i < end; i += dim) { sum += (data[j] - data[i]) * (data[i + 1] + data[j + 1]); j = i; } return sum; }

    // ══════════════════════════════════════════════════════════════════════
    //  MESH GENERATION API
    // ══════════════════════════════════════════════════════════════════════

    /**
     * Grid-based mesher for polygons with holes.
     *
     * Builds a regular rectangular grid over the polygon bounding box.
     * Each grid cell is split into two triangles using a diagonal.
     *
     * forQuad = false  (TRIG mode)
     *   Alternating diagonal direction for a symmetric triangle mesh.
     *   Returns { nodes, quads:[], tris }.
     *
     * forQuad = true   (QUAD mode)
     *   Consistent diagonal n00→n11 for every cell.
     *   When BOTH half-triangles of a cell are inside the domain, the cell is
     *   promoted directly to a QUAD4 — no triToQuad step needed, no cross-cell
     *   confusion.  Only boundary cells that straddle the polygon edge yield an
     *   orphan triangle.
     *   Returns { nodes, quads, tris:orphans }.
     *
     * @param {Array<{x,y}>} polygon
     * @param {Array<Array<{x,y}>>} holes
     * @param {number} divX  — number of cells in x direction (columns)
     * @param {number} divY  — number of cells in y direction (rows)
     * @param {boolean} forQuad
     * @returns {{ nodes, quads, tris }}
     */
    function generateGridMesh(polygon, holes, divX, divY, forQuad) {
        // Bounding box
        let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity;
        for (const p of polygon) {
            if (p.x < xMin) xMin = p.x; if (p.x > xMax) xMax = p.x;
            if (p.y < yMin) yMin = p.y; if (p.y > yMax) yMax = p.y;
        }
        const W = xMax - xMin, H = yMax - yMin;
        if (W < 1e-12 || H < 1e-12) return { nodes: [], quads: [], tris: [] };

        // Auto-adapt grid resolution so each hole spans ≥ 5 cells in both directions.
        // This guarantees at least one centroid falls inside even small holes.
        if (holes.length > 0) {
            for (const hole of holes) {
                let hxMin = Infinity, hxMax = -Infinity, hyMin = Infinity, hyMax = -Infinity;
                for (const p of hole) {
                    if (p.x < hxMin) hxMin = p.x; if (p.x > hxMax) hxMax = p.x;
                    if (p.y < hyMin) hyMin = p.y; if (p.y > hyMax) hyMax = p.y;
                }
                const holeW = hxMax - hxMin, holeH = hyMax - hyMin;
                if (holeW > 1e-12) divX = Math.max(divX, Math.ceil(W / holeW * 5));
                if (holeH > 1e-12) divY = Math.max(divY, Math.ceil(H / holeH * 5));
            }
            divX = Math.min(divX, 200);
            divY = Math.min(divY, 200);
        }

        // Independent x/y spacing — divX cells wide, divY cells tall
        const hx = W / divX;
        const hy = H / divY;
        const nx = divX + 1;   // nodes in x direction
        const ny = divY + 1;   // nodes in y direction

        const pts = [];
        for (let j = 0; j < ny; j++)
            for (let i = 0; i < nx; i++)
                pts.push({ x: xMin + i * hx, y: yMin + j * hy });

        const ptIdx = (i, j) => j * nx + i;

        // Returns true if the triangle belongs to the domain (inside outer polygon, outside holes).
        // Checks centroid + all 3 vertices so small holes smaller than a grid cell are still detected.
        function inDomain(n0, n1, n2) {
            const cx = (pts[n0].x + pts[n1].x + pts[n2].x) / 3;
            const cy = (pts[n0].y + pts[n1].y + pts[n2].y) / 3;
            if (!ptInPolygon(cx, cy, polygon)) return false;
            for (const hole of holes) {
                if (ptInPolygon(cx, cy, hole) ||
                    ptInPolygon(pts[n0].x, pts[n0].y, hole) ||
                    ptInPolygon(pts[n1].x, pts[n1].y, hole) ||
                    ptInPolygon(pts[n2].x, pts[n2].y, hole)) return false;
            }
            return true;
        }

        const quads = [], tris = [];

        for (let j = 0; j < ny - 1; j++) {
            for (let i = 0; i < nx - 1; i++) {
                const n00 = ptIdx(i,   j  );  // bottom-left
                const n10 = ptIdx(i+1, j  );  // bottom-right
                const n01 = ptIdx(i,   j+1);  // top-left
                const n11 = ptIdx(i+1, j+1);  // top-right

                if (forQuad) {
                    // Consistent diagonal n00→n11.
                    // Lower tri: [n00,n10,n11]  Upper tri: [n00,n11,n01]
                    // Both inside → QUAD;  one inside → TRIG (orphan)
                    const lo = inDomain(n00, n10, n11);
                    const hi = inDomain(n00, n11, n01);
                    if      (lo && hi) quads.push([n00, n10, n11, n01]);
                    else if (lo)       tris.push([n00, n10, n11]);
                    else if (hi)       tris.push([n00, n11, n01]);
                } else {
                    // Alternating diagonal for a symmetric TRIG mesh
                    if ((i + j) % 2 === 0) {
                        if (inDomain(n00, n10, n11)) tris.push([n00, n10, n11]);
                        if (inDomain(n00, n11, n01)) tris.push([n00, n11, n01]);
                    } else {
                        if (inDomain(n00, n10, n01)) tris.push([n00, n10, n01]);
                        if (inDomain(n10, n11, n01)) tris.push([n10, n11, n01]);
                    }
                }
            }
        }

        // Compact: remove unused grid nodes and remap indices
        const used = new Set([...quads.flat(), ...tris.flat()]);
        const remap = {};
        const finalPts = [];
        [...used].sort((a, b) => a - b).forEach(o => {
            remap[o] = finalPts.length;
            finalPts.push(pts[o]);
        });

        return {
            nodes: finalPts,
            quads: quads.map(q => q.map(n => remap[n])),
            tris:  tris.map(t => t.map(n => remap[n]))
        };
    }

    /**
     * Generate a mesh inside a closed polygon, optionally with holes.
     * @param {Array<{x,y}>} polygon  — vertices of the outer boundary (CCW or CW)
     * @param {string} elemType       — 'TRIG3', 'TRIG6', 'QUAD4', 'QUAD8'
     * @param {number} divX           — number of cells in x direction (columns)
     * @param {number} divY           — number of cells in y direction (rows)
     * @param {Array<Array<{x,y}>>} holes — optional array of hole polygons
     * @returns {{ nodes: Array<{x,y}>, elements: Array<number[]> }}
     */
    function generateMesh(polygon, elemType, divX, divY, holes) {
        divX = Math.max(1, Math.round(divX) || 4);
        divY = Math.max(1, Math.round(divY) || 4);
        holes = holes || [];

        const wantQuad = elemType === 'QUAD4' || elemType === 'QUAD8';
        let allPts, elements;

        if (holes.length > 0 || divX !== divY) {
            // Grid-based meshing:
            //  • always for polygons with holes (avoids earcut bridge artefact)
            //  • also when divX ≠ divY (anisotropic spacing)
            const g = generateGridMesh(polygon, holes, divX, divY, wantQuad);
            allPts = g.nodes;

            if (wantQuad) {
                // g.quads  — complete cells, already pure QUAD4
                // g.tris   — orphan boundary triangles; try to pair adjacent ones
                const merged = g.tris.length > 0 ? triToQuad(allPts, g.tris) : [];
                const allElems = [...g.quads, ...merged];
                elements = elemType === 'QUAD8' ? addMidNodes_Quad(allPts, allElems) : allElems;
            } else {
                // Flatten quads → 2 triangles each, then combine with orphan tris
                const tris = [...g.tris];
                for (const q of g.quads) {
                    tris.push([q[0], q[1], q[2]]);
                    tris.push([q[0], q[2], q[3]]);
                }
                elements = elemType === 'TRIG6' ? addMidNodes_Tri(allPts, tris) : tris;
            }
        } else {
            // Earcut + uniform subdivision for simple (hole-free) isotropic polygons.
            // divX == divY here, use as uniform subdivision level.
            const divisions = divX;
            const flatCoords = [];
            for (const p of polygon) { flatCoords.push(p.x, p.y); }
            const earcutIndices = earcut(flatCoords, null);

            allPts = [];
            for (let i = 0; i < flatCoords.length; i += 2)
                allPts.push({ x: flatCoords[i], y: flatCoords[i + 1] });

            let tris = [];
            for (let i = 0; i < earcutIndices.length; i += 3)
                tris.push([earcutIndices[i], earcutIndices[i + 1], earcutIndices[i + 2]]);

            if (divisions > 1) {
                const refined = { pts: [...allPts], tris: [] };
                for (const tri of tris) subdivideTri(refined, tri, divisions);
                allPts.length = 0;
                allPts.push(...refined.pts);
                tris = refined.tris;
            }

            if      (elemType === 'TRIG3') elements = tris;
            else if (elemType === 'TRIG6') elements = addMidNodes_Tri(allPts, tris);
            else if (elemType === 'QUAD4') elements = triToQuad(allPts, tris);
            else if (elemType === 'QUAD8') elements = addMidNodes_Quad(allPts, triToQuad(allPts, tris));
            else                           elements = tris;
        }

        return { nodes: allPts, elements };
    }

    /**
     * Subdivide a triangle into N² sub-triangles.
     */
    function subdivideTri(mesh, tri, N) {
        const A = mesh.pts[tri[0]], B = mesh.pts[tri[1]], C = mesh.pts[tri[2]];

        // Create grid of points inside triangle
        const grid = []; // grid[i][j] = nodeIndex
        for (let i = 0; i <= N; i++) {
            grid[i] = [];
            for (let j = 0; j <= N - i; j++) {
                const u = i / N, v = j / N, w = 1 - u - v;
                const x = w * A.x + u * B.x + v * C.x;
                const y = w * A.y + u * B.y + v * C.y;

                // Reuse boundary vertices
                if (i === 0 && j === 0) { grid[i][j] = tri[0]; continue; }
                if (i === N && j === 0) { grid[i][j] = tri[1]; continue; }
                if (i === 0 && j === N) { grid[i][j] = tri[2]; continue; }

                // Check if point already exists (dedup)
                let found = -1;
                for (let k = 0; k < mesh.pts.length; k++) {
                    if (Math.abs(mesh.pts[k].x - x) < 1e-10 && Math.abs(mesh.pts[k].y - y) < 1e-10) {
                        found = k; break;
                    }
                }
                if (found >= 0) {
                    grid[i][j] = found;
                } else {
                    grid[i][j] = mesh.pts.length;
                    mesh.pts.push({ x, y });
                }
            }
        }

        // Create sub-triangles
        for (let i = 0; i < N; i++) {
            for (let j = 0; j < N - i; j++) {
                // Lower triangle
                mesh.tris.push([grid[i][j], grid[i + 1][j], grid[i][j + 1]]);
                // Upper triangle
                if (i + j + 1 < N) {
                    mesh.tris.push([grid[i + 1][j], grid[i + 1][j + 1], grid[i][j + 1]]);
                }
            }
        }
    }

    /**
     * Convert triangles to quads by merging pairs that share an edge.
     * Remaining unmatched triangles stay as triangles (returned as 3-node).
     */
    function triToQuad(pts, tris) {
        const used = new Set();
        const quads = [];

        // Build edge → triangle map
        const edgeMap = {};
        function edgeKey(a, b) { return Math.min(a, b) + '_' + Math.max(a, b); }

        for (let ti = 0; ti < tris.length; ti++) {
            const t = tris[ti];
            for (let e = 0; e < 3; e++) {
                const key = edgeKey(t[e], t[(e + 1) % 3]);
                if (!edgeMap[key]) edgeMap[key] = [];
                edgeMap[key].push(ti);
            }
        }

        // Merge triangle pairs sharing an edge
        for (const key of Object.keys(edgeMap)) {
            const pair = edgeMap[key];
            if (pair.length !== 2) continue;
            const ti1 = pair[0], ti2 = pair[1];
            if (used.has(ti1) || used.has(ti2)) continue;

            const t1 = tris[ti1], t2 = tris[ti2];
            const [a, b] = key.split('_').map(Number);

            // Find the opposite vertices
            const opp1 = t1.find(n => n !== a && n !== b);
            const opp2 = t2.find(n => n !== a && n !== b);

            // Form a quad: a → opp1 → b → opp2 (or rearrange for good ordering)
            // Ensure CCW ordering
            const quad = orderQuadCCW(pts, a, opp1, b, opp2);
            if (quad && quadQuality(pts, quad) > 0.3) {
                quads.push(quad);
                used.add(ti1);
                used.add(ti2);
            }
        }

        // Add remaining unmatched triangles as TRIG3
        for (let ti = 0; ti < tris.length; ti++) {
            if (!used.has(ti)) quads.push(tris[ti]);
        }

        return quads;
    }

    function orderQuadCCW(pts, a, b, c, d) {
        // Order 4 points in CCW order around their centroid
        const nodes = [a, b, c, d];
        const cx = (pts[a].x + pts[b].x + pts[c].x + pts[d].x) / 4;
        const cy = (pts[a].y + pts[b].y + pts[c].y + pts[d].y) / 4;
        nodes.sort((i, j) => {
            return Math.atan2(pts[i].y - cy, pts[i].x - cx) - Math.atan2(pts[j].y - cy, pts[j].x - cx);
        });
        return nodes;
    }

    function quadQuality(pts, q) {
        // Simple aspect ratio check: ratio of shortest to longest diagonal
        if (q.length < 4) return 1;
        const d1 = dist(pts[q[0]], pts[q[2]]);
        const d2 = dist(pts[q[1]], pts[q[3]]);
        return Math.min(d1, d2) / Math.max(d1, d2);
    }

    function dist(a, b) { return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2); }

    /**
     * Add mid-side nodes to triangles → TRIG6 (6-node triangle).
     * Node order: [n0, n1, n2, m01, m12, m20]
     */
    function addMidNodes_Tri(pts, tris) {
        const midCache = {};
        function getMid(a, b) {
            const key = Math.min(a, b) + '_' + Math.max(a, b);
            if (midCache[key] !== undefined) return midCache[key];
            const mx = (pts[a].x + pts[b].x) / 2;
            const my = (pts[a].y + pts[b].y) / 2;
            const idx = pts.length;
            pts.push({ x: mx, y: my });
            midCache[key] = idx;
            return idx;
        }

        return tris.map(t => [
            t[0], t[1], t[2],
            getMid(t[0], t[1]),
            getMid(t[1], t[2]),
            getMid(t[2], t[0])
        ]);
    }

    /**
     * Add mid-side nodes to quads → QUAD8 (8-node quad).
     * Node order: [n0, n1, n2, n3, m01, m12, m23, m30]
     * For leftover triangles, generates TRIG6 instead.
     */
    function addMidNodes_Quad(pts, elems) {
        const midCache = {};
        function getMid(a, b) {
            const key = Math.min(a, b) + '_' + Math.max(a, b);
            if (midCache[key] !== undefined) return midCache[key];
            const mx = (pts[a].x + pts[b].x) / 2;
            const my = (pts[a].y + pts[b].y) / 2;
            const idx = pts.length;
            pts.push({ x: mx, y: my });
            midCache[key] = idx;
            return idx;
        }

        return elems.map(e => {
            if (e.length === 4) {
                return [
                    e[0], e[1], e[2], e[3],
                    getMid(e[0], e[1]), getMid(e[1], e[2]),
                    getMid(e[2], e[3]), getMid(e[3], e[0])
                ];
            } else {
                // Triangle → TRIG6
                return [
                    e[0], e[1], e[2],
                    getMid(e[0], e[1]), getMid(e[1], e[2]),
                    getMid(e[2], e[0])
                ];
            }
        });
    }

    // ── Geometry helpers ──────────────────────────────────────────────────

    function polyBBox(pts) {
        let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity;
        for (const p of pts) {
            xMin = Math.min(xMin, p.x); xMax = Math.max(xMax, p.x);
            yMin = Math.min(yMin, p.y); yMax = Math.max(yMax, p.y);
        }
        return { xMin, xMax, yMin, yMax };
    }

    function ptInPolygon(x, y, pts) {
        let inside = false;
        for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
            const xi = pts[i].x, yi = pts[i].y, xj = pts[j].x, yj = pts[j].y;
            if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi))
                inside = !inside;
        }
        return inside;
    }

    // ── Public API ────────────────────────────────────────────────────────

    return { generateMesh };
})();
