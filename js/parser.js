/* ========================================================================
   parser.js  –  FEPS .inp file parser
   Reads the standard FEPS input format into a model object.

   Header line:     numNod  dofNod  dim  [gx  gy  gz]
   Material line:   id  E  nu  [rho]
   ESURF section (after BCs):
     numESURFLines
     Beam (BEAM2D/BAR2): eid  wy1  wy2
     Beam (BEAM3D):      eid  wy1  wy2  wz1  wz2
     Solid (per side):   eid  side  qx1  qy1  qx2  qy2
   ======================================================================== */

const FepsParser = (() => {

  function tokenize(line) {
    return line.trim().split(/[\s,]+/).filter(s => s.length > 0);
  }

  /** True for 1-D beam/bar element types */
  const BEAM_TYPES  = new Set(['BAR2','BAR3','BAR3D','BEAM2D','BEAM3D',
                                'TIMBEAM2D_2N','TIMBEAM2D_3N']);
  const BAR1D_TYPES = new Set(['BAR2_3N']);
  const SOLID_TYPES = new Set(['QUAD4','QUAD5','QUAD8','QUAD9','TRIG3','TRIG6']);

  /**
   * Parse a FEPS .inp file string into a model object.
   * Returns { header, nodes, materials, properties, elements, bcs, gravity }
   */
  function parse(text) {
    const lines = text.replace(/\r\n/g, '\n').split('\n');
    let idx = 0;
    const next = () => {
      while (idx < lines.length) {
        const t = tokenize(lines[idx++]);
        if (t.length > 0) return t;
      }
      return null;
    };

    // ── Header: numNod dofNod dim [gx gy gz] ──
    const hdr = next();
    const numNod = +hdr[0], dofNod = +hdr[1], dim = +hdr[2];
    const gravity = {
      gx: hdr[3] != null ? +hdr[3] : 0,
      gy: hdr[4] != null ? +hdr[4] : 0,
      gz: hdr[5] != null ? +hdr[5] : 0
    };

    // ── Nodes ──
    const nodes = {};
    for (let i = 0; i < numNod; i++) {
      const t = next();
      const id = +t[0];
      const coords = [];
      for (let j = 0; j < dim; j++) coords.push(+t[j + 1]);
      nodes[id] = { id, x: coords[0] || 0, y: coords[1] || 0, z: coords[2] || 0 };
    }

    // ── Materials ──
    const t1 = next();
    const numMat = +t1[0];
    const materials = {};
    for (let i = 0; i < numMat; i++) {
      const t = next();
      const id = +t[0];
      materials[id] = { id, E: +t[1], nu: +t[2], rho: t[3] != null ? +t[3] : 0 };
    }

    // ── Properties ──
    const t2 = next();
    const numPro = +t2[0];
    const properties = {};

    // Determine section type
    const secId = dim * dofNod;
    const secType = secId === 6 ? '2DBeam' : secId === 18 ? '3DBeam' : 'Solid';

    for (let i = 0; i < numPro; i++) {
      const t = next();
      const id = +t[0];
      const p = { id, A: +t[1] || 0, t: +t[2] || 0, Iy: 0, Iz: 0, J: 0, alpha: 0 };
      if (secType === '2DBeam') {
        p.Iz = +t[3] || 0;
        p.alpha = +t[4] || 0;
      } else if (secType === '3DBeam') {
        p.Iy = +t[3] || 0;
        p.Iz = +t[4] || 0;
        p.J  = +t[5] || 0;
        p.alpha = +t[6] || 0;
      } else {
        p.alpha = +t[3] || 0;
      }
      properties[id] = p;
    }

    // ── Elements ──
    const t3 = next();
    const numEle = +t3[0];
    const elements = {};
    const elNode = typ => {
      const t = typ.toUpperCase();
      const tbl = { BAR2: 2, BAR3: 3, BAR3D: 2, BEAM2D: 2, BEAM3D: 2,
                    QUAD4: 4, QUAD5: 5, QUAD8: 8, QUAD9: 9,
                    TRIG3: 3, TRIG6: 6,
                    BAR2_3N: 3, TIMBEAM2D_2N: 2, TIMBEAM2D_3N: 3 };
      if (tbl[t] !== undefined) return tbl[t];
      // 레지스트리 fallback (런타임에 등록된 요소)
      if (typeof FepsElementRegistry !== 'undefined' && FepsElementRegistry.has(t))
        return FepsElementRegistry.nNodes(t);
      return 0;
    };

    for (let i = 0; i < numEle; i++) {
      const t = next();
      const typ = t[0].toUpperCase();
      const id = +t[1];
      const mat = +t[2], pro = +t[3];
      let off = 4;
      let angle = 0;
      if (typ === 'BEAM3D') { angle = +t[off] || 0; off++; }
      const nn = elNode(typ);
      const elnod = [];
      for (let j = 0; j < nn; j++) elnod.push(+t[off + j]);
      off += nn;
      const eload = [];
      for (let j = off; j < t.length; j++) eload.push(+t[j]);
      // esurf: surface/distributed loads (populated from ESURF section below)
      elements[id] = { id, type: typ, mat, pro, nodes: elnod, eload, angle, esurf: null };
    }

    // ── Boundary conditions ──
    const t4 = next();
    const numBC = +t4[0];
    const bcs = {};
    for (let i = 0; i < numBC; i++) {
      const t = next();
      const nid = +t[0];
      const tags = [], forces = [], disps = [];
      for (let j = 0; j < dofNod; j++) tags.push(+t[1 + j]);
      for (let j = 0; j < dofNod; j++) forces.push(+t[1 + dofNod + j] || 0);
      for (let j = 0; j < dofNod; j++) disps.push(+t[1 + 2 * dofNod + j] || 0);
      bcs[nid] = { node: nid, tags, forces, disps };
    }

    // ── ESURF section (optional) ──
    // Surface / distributed loads on element sides.
    // Format per line:
    //   Beam (BEAM2D, BAR2):  eid  wy1  wy2
    //   Beam (BEAM3D):        eid  wy1  wy2  wz1  wz2
    //   Solid (per side):     eid  side  qx1  qy1  qx2  qy2
    const te = next();
    if (te !== null) {
      const numES = +te[0];
      for (let i = 0; i < numES; i++) {
        const t = next();
        if (!t) break;
        const eid = +t[0];
        const el  = elements[eid];
        if (!el) continue;
        const typ = el.type.toUpperCase();
        if (BEAM_TYPES.has(typ)) {
          // Beam: trapezoidal transverse load in local frame
          const wy1 = +t[1] || 0, wy2 = +t[2] || 0;
          const wz1 = t[3] != null ? +t[3] : 0;
          const wz2 = t[4] != null ? +t[4] : 0;
          el.esurf = { wy1, wy2, wz1, wz2 };
        } else if (SOLID_TYPES.has(typ)) {
          // Solid: traction on one side (global frame), trapezoidal end-to-end
          const side = +t[1];
          const qx1 = +t[2] || 0, qy1 = +t[3] || 0;
          const qx2 = +t[4] || 0, qy2 = +t[5] || 0;
          if (!el.esurf) el.esurf = [];
          el.esurf.push({ side, qx1, qy1, qx2, qy2 });
        }
      }
    }

    return {
      header: { numNod, dofNod, dim, secType },
      gravity,
      nodes, materials, properties, elements, bcs
    };
  }

  /**
   * Export the in-memory model back to .inp text format.
   */
  function exportInp(model) {
    const h = model.header;
    const g = model.gravity || { gx: 0, gy: 0, gz: 0 };
    const lines = [];

    // Header (include gravity only if non-zero)
    const hasGrav = g.gx !== 0 || g.gy !== 0 || g.gz !== 0;
    if (hasGrav) {
      lines.push(`${h.numNod} ${h.dofNod} ${h.dim}  ${g.gx} ${g.gy} ${g.gz}`);
    } else {
      lines.push(`${h.numNod} ${h.dofNod} ${h.dim}`);
    }

    // Nodes
    const nids = Object.keys(model.nodes).map(Number).sort((a, b) => a - b);
    for (const id of nids) {
      const n = model.nodes[id];
      if (h.dim === 3) lines.push(`${id}  ${n.x}  ${n.y}  ${n.z}`);
      else lines.push(`${id}  ${n.x}  ${n.y}`);
    }

    // Materials (include rho only if non-zero)
    const mids = Object.keys(model.materials).map(Number).sort((a, b) => a - b);
    lines.push(`${mids.length}`);
    for (const id of mids) {
      const m = model.materials[id];
      if (m.rho) lines.push(`${id} ${m.E} ${m.nu} ${m.rho}`);
      else        lines.push(`${id} ${m.E} ${m.nu}`);
    }

    // Properties
    const pids = Object.keys(model.properties).map(Number).sort((a, b) => a - b);
    lines.push(`${pids.length}`);
    for (const id of pids) {
      const p = model.properties[id];
      if (h.secType === '2DBeam')
        lines.push(`${id}  ${p.A}  ${p.t}  ${p.Iz}  ${p.alpha}`);
      else if (h.secType === '3DBeam')
        lines.push(`${id}  ${p.A}  ${p.t}  ${p.Iy}  ${p.Iz}  ${p.J}  ${p.alpha}`);
      else
        lines.push(`${id}  ${p.A}  ${p.t}  ${p.alpha}`);
    }

    // Elements
    const eids = Object.keys(model.elements).map(Number).sort((a, b) => a - b);
    lines.push(`${eids.length}`);
    for (const id of eids) {
      const e = model.elements[id];
      let s = `${e.type}  ${id}  ${e.mat}  ${e.pro}`;
      if (e.type === 'BEAM3D') s += `  ${e.angle}`;
      s += '  ' + e.nodes.join('  ');
      if (e.eload && e.eload.length) s += '  ' + e.eload.join('  ');
      lines.push(s);
    }

    // BCs
    const bids = Object.keys(model.bcs).map(Number).sort((a, b) => a - b);
    lines.push(`${bids.length}`);
    for (const nid of bids) {
      const b = model.bcs[nid];
      let s = `${nid}`;
      s += '  ' + b.tags.join('  ');
      s += '  ' + b.forces.join('  ');
      s += '  ' + b.disps.join('  ');
      lines.push(s);
    }

    // ESURF section
    // Collect all esurf lines
    const esurfLines = [];
    for (const id of eids) {
      const e = model.elements[id];
      if (!e.esurf) continue;
      const typ = e.type.toUpperCase();
      if (BEAM_TYPES.has(typ)) {
        const s = e.esurf;
        // Only write if any load is non-zero
        if (s.wy1 === 0 && s.wy2 === 0 && s.wz1 === 0 && s.wz2 === 0) continue;
        if (typ === 'BEAM3D') {
          esurfLines.push(`${id}  ${s.wy1}  ${s.wy2}  ${s.wz1}  ${s.wz2}`);
        } else {
          esurfLines.push(`${id}  ${s.wy1}  ${s.wy2}`);
        }
      } else if (SOLID_TYPES.has(typ) && Array.isArray(e.esurf)) {
        for (const face of e.esurf) {
          esurfLines.push(`${id}  ${face.side}  ${face.qx1}  ${face.qy1}  ${face.qx2}  ${face.qy2}`);
        }
      }
    }
    lines.push(`${esurfLines.length}`);
    for (const l of esurfLines) lines.push(l);

    return lines.join('\n') + '\n';
  }

  /**
   * Create an empty model with given parameters.
   */
  function createEmpty(dofNod = 2, dim = 2) {
    const secId = dim * dofNod;
    const secType = secId === 6 ? '2DBeam' : secId === 18 ? '3DBeam' : 'Solid';
    return {
      header: { numNod: 0, dofNod, dim, secType },
      gravity: { gx: 0, gy: 0, gz: 0 },
      nodes: {},
      materials: {},
      properties: {},
      elements: {},
      bcs: {},
      // -- results (filled after solve) --
      results: null
    };
  }

  return { parse, exportInp, createEmpty };
})();
