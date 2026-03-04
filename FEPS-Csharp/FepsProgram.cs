// =============================================================================
//  FepsProgram.cs  –  Core FEM input / assembly / output routines
//
//  Ported from program.py  →  .NET 10
//
//  Functions (same names, snake_case kept for 1-to-1 traceability):
//    read_data           – parse input file → FepsDataDic
//    asm_lm_table        – build LM & DOF tables, free-DOF force / disp vectors
//    asm_merg            – scatter element K into global K
//    asm_stiff           – loop over elements, form & assemble stiffness
//    el_node             – element-type → node count
//    get_node_dof        – DOF index → (node, local dof)
//    map_node_forces     – solution vector → nodal arrays
//    print_data          – echo input to .out file
//    print_eigenvalues   – print sorted eigenvalues of Kff
//    print_lm_info       – print LM / DOF tables
//    print_mastif        – print stiffness matrix
//    print_node_disp_force – print displacements and reactions
//    print_bar_force     – print truss axial forces
//    print_beam_force    – print beam section forces
//    print_stress        – print averaged nodal stresses
//
//  Data layout:  all arrays 0-based, same index convention as Python.
//  glbal accessed via G.glbal (see FepsGlobals.cs).
// =============================================================================

using static FESEC.G;      // brings glbal into scope
using static FESEC.FepsUtils;

namespace FESEC;

public static class FepsProgram
{
    // =========================================================================
    //  el_node  –  element type string → number of nodes
    // =========================================================================
    public static int el_node(string type) => type.ToUpperInvariant() switch
    {
        "BAR2"   => 2,
        "BAR3"   => 3,
        "BAR3D"  => 2,
        "BEAM2D" => 2,
        "BEAM3D" => 2,
        "QUAD4"  => 4,
        "QUAD8"  => 8,
        "QUAD9"  => 9,
        "TRIG3"  => 3,
        "TRIG6"  => 6,
        "QUAD16" => 16,
        _        => 0
    };

    // =========================================================================
    //  read_data  –  parse input file, return FepsDataDic
    // =========================================================================
    public static FepsDataDic read_data()
    {
        var fid = glbal.Fid
            ?? throw new InvalidOperationException("glbal.Fid must be set before calling read_data.");

        var d = new FepsDataDic();
        glbal.LasNod = glbal.LasEle = glbal.LasMat = glbal.LasPro = 0;

        // ── Header ────────────────────────────────────────────────────────────
        var hdr = ReadInts(fid);
        glbal.NumNod  = hdr[0];
        glbal.DofNod  = hdr[1];
        glbal.Dim     = hdr[2];
        glbal.MaxNod  = glbal.NumNod * 2;

        d.noddef = new int   [glbal.NumNod];
        d.nodxy  = new double[glbal.Dim, glbal.NumNod];

        if (glbal.NumNod <= 0)
            throw new InvalidDataException("read_data: number of nodes is invalid.");

        // ── Nodes ─────────────────────────────────────────────────────────────
        for (int i = 0; i < glbal.NumNod; i++)
        {
            var tok = ReadTokens(fid);
            int n = int.Parse(tok[0]);
            for (int j = 0; j < glbal.Dim; j++)
                d.nodxy[j, n - 1] = double.Parse(tok[j + 1], System.Globalization.CultureInfo.InvariantCulture);
            if (n < 0 || n >= glbal.MaxNod)
                throw new InvalidDataException($"read_data: node {n} out of bounds.");
            if (d.noddef[n - 1] != 0)
                throw new InvalidDataException($"read_data: node {n} redefined.");
            d.noddef[n - 1] = 1;
            glbal.LasNod = Math.Max(glbal.LasNod, n);
        }

        // ── Materials ─────────────────────────────────────────────────────────
        glbal.NumMat = int.Parse(fid.ReadLine()!.Trim());
        d.matdef = new int   [glbal.NumMat];
        d.matem  = new double[glbal.NumMat];
        d.matnu  = new double[glbal.NumMat];

        if (glbal.NumMat <= 0)
            throw new InvalidDataException("read_data: material count is invalid.");

        for (int i = 0; i < glbal.NumMat; i++)
        {
            var tok = ReadTokens(fid);
            int m = int.Parse(tok[0]);
            d.matem[m - 1] = double.Parse(tok[1], System.Globalization.CultureInfo.InvariantCulture);
            d.matnu[m - 1] = double.Parse(tok[2], System.Globalization.CultureInfo.InvariantCulture);
            if (d.matdef[m - 1] != 0)
                throw new InvalidDataException($"read_data: material {m} repeated.");
            d.matdef[m - 1] = 1;
            glbal.LasMat = Math.Max(glbal.LasMat, m);
        }

        // ── Properties ────────────────────────────────────────────────────────
        glbal.NumPro = int.Parse(fid.ReadLine()!.Trim());
        d.prodef    = new int   [glbal.NumPro];
        d.probar    = new double[glbal.NumPro];
        d.propth    = new double[glbal.NumPro];
        d.propIy    = new double[glbal.NumPro];
        d.propIz    = new double[glbal.NumPro];
        d.propJ     = new double[glbal.NumPro];
        d.propAlpha = new double[glbal.NumPro];

        if (glbal.NumPro <= 0)
            throw new InvalidDataException("read_data: property count is invalid.");

        // Determine section type from dim × dofnod
        string secType = GetSecType();

        for (int i = 0; i < glbal.NumPro; i++)
        {
            var tok = ReadTokens(fid);
            int p = int.Parse(tok[0]);
            d.probar[p - 1]    = P(tok, 1);
            d.propth[p - 1]    = P(tok, 2);
            if (secType == "2DBeam")
            {
                d.propIz   [p - 1] = P(tok, 3);
                d.propAlpha[p - 1] = P(tok, 4);
            }
            else if (secType == "3DBeam")
            {
                d.propIy   [p - 1] = P(tok, 3);
                d.propIz   [p - 1] = P(tok, 4);
                d.propJ    [p - 1] = P(tok, 5);
                d.propAlpha[p - 1] = P(tok, 6);
            }
            else // Solid
                d.propAlpha[p - 1] = P(tok, 3);

            if (p < 0)
                throw new InvalidDataException("read_data: property ID out of range.");
            if (d.prodef[p - 1] != 0)
                throw new InvalidDataException($"read_data: property {p} repeated.");
            d.prodef[p - 1] = 1;
            glbal.LasPro = Math.Max(glbal.LasPro, p);
        }

        // ── Elements ─────────────────────────────────────────────────────────
        glbal.MelNod  = 16;
        glbal.NumBar  = glbal.NumQua  = glbal.NumTri = 0;
        glbal.Num2DBeam = glbal.Num3DBeam = 0;
        glbal.LasEle  = 0;

        glbal.NumEle  = int.Parse(fid.ReadLine()!.Trim());
        glbal.MaxEle  = glbal.NumEle * 2;

        d.eledef        = new int   [glbal.MaxEle];
        d.elenod        = new int   [glbal.MelNod, glbal.MaxEle];
        d.elemat        = new int   [glbal.NumEle];
        d.elepro        = new int   [glbal.NumEle];
        d.eletyp        = new Dictionary<int, string>();
        d.eleload       = new double[glbal.Dim + 1, glbal.NumEle];
        d.section_angle = new double[glbal.NumEle];

        if (glbal.NumEle <= 0)
            throw new InvalidDataException("read_data: element count is invalid.");

        for (int i = 0; i < glbal.NumEle; i++)
        {
            var tok    = ReadTokens(fid);
            string typ = tok[0];
            int e      = int.Parse(tok[1]);

            d.eletyp[e - 1]  = typ;
            d.elemat[e - 1]  = int.Parse(tok[2]);
            d.elepro[e - 1]  = int.Parse(tok[3]);

            int offset = 4;
            if (typ.Equals("BEAM3D", StringComparison.OrdinalIgnoreCase))
            {
                d.section_angle[e - 1] = P(tok, offset);
                offset++;
            }

            int numNodes = el_node(typ);
            if (numNodes <= 0)
                throw new InvalidDataException($"read_data: unknown element type '{typ}'.");

            for (int j = 0; j < numNodes; j++)
                d.elenod[j, e - 1] = int.Parse(tok[j + offset]);
            offset += numNodes;

            // Element loads
            int loadCount = typ.ToUpperInvariant().StartsWith("BAR") ? 3 : glbal.Dim + 1;
            for (int j = 0; j < loadCount; j++)
                d.eleload[j, e - 1] = (j + offset < tok.Length)
                    ? P(tok, j + offset) : 0.0;

            if (e < 0)
                throw new InvalidDataException($"read_data: element {e} invalid.");
            if (d.eledef[e - 1] != 0)
                throw new InvalidDataException($"read_data: element {e} repeated.");

            // Count element types
            string tu = typ.ToUpperInvariant();
            if      (tu.StartsWith("BAR"))   glbal.NumBar++;
            else if (tu.StartsWith("QUAD"))  glbal.NumQua++;
            else if (tu.StartsWith("TRIG"))  glbal.NumTri++;
            else if (tu.StartsWith("BEAM2")) glbal.Num2DBeam++;
            else if (tu.StartsWith("BEAM3")) glbal.Num3DBeam++;

            d.eledef[e - 1] = 1;
            glbal.LasEle = Math.Max(glbal.LasEle, e);
        }

        // ── Boundary conditions / nodal loads ─────────────────────────────────
        int bcNodes = int.Parse(fid.ReadLine()!.Trim());
        d.nodbct = new int   [glbal.DofNod, glbal.LasNod];
        d.nodfor = new double[glbal.DofNod, glbal.LasNod];
        d.noddis = new double[glbal.DofNod, glbal.LasNod];

        if (bcNodes > glbal.NumNod)
            throw new InvalidDataException("read_data: BC node count exceeds total nodes.");

        for (int i = 0; i < bcNodes; i++)
        {
            var tok = ReadTokens(fid);
            int n   = int.Parse(tok[0]);
            if (n < 0 || n > glbal.LasNod)
                throw new InvalidDataException($"read_data: BC node {n} out of range.");
            if (d.noddef[n - 1] == 0)
                throw new InvalidDataException($"read_data: BC references undefined node {n}.");

            for (int j = 0; j < glbal.DofNod; j++)
                d.nodbct[j, n - 1] = int.Parse(tok[j + 1]);
            for (int j = 0; j < glbal.DofNod; j++)
                d.nodfor[j, n - 1] = P(tok, j + 1 + glbal.DofNod);
            for (int j = 0; j < glbal.DofNod; j++)
                d.noddis[j, n - 1] = P(tok, j + 1 + 2 * glbal.DofNod);

            // Validate BC tags (must be 0 or 1)
            for (int j = 0; j < glbal.DofNod; j++)
                if (d.nodbct[j, n - 1] != 0 && d.nodbct[j, n - 1] != 1)
                    throw new InvalidDataException(
                        $"read_data: invalid BC tag at node {n}, DOF {j + 1}.");
        }

        // Deep-copy initial loads/displacements
        d.applied_force = (double[,])d.nodfor.Clone();
        d.applied_displ = (double[,])d.noddis.Clone();

        glbal.NumEle = glbal.LasEle;   // align with Python behaviour
        return d;
    }

    // =========================================================================
    //  asm_lm_table  –  build DOF / LM tables
    // =========================================================================
    /// <summary>
    /// Builds <c>lm_info</c> and <c>dof_info</c> tables.
    /// Returns (lm_info, dof_info, ff, vc) matching Python signature.
    /// </summary>
    public static (double[,] lmInfo, double[,] dofInfo, double[,] ff, double[,] vc)
        asm_lm_table(FepsDataDic d)
    {
        int nDof = glbal.DofNod * glbal.NumNod;
        var ff      = new double[nDof, 1];
        var vc      = new double[nDof, 1];
        var lmInfo  = new double[glbal.MelNod * glbal.DofNod, glbal.NumEle];
        var dofInfo = new double[glbal.DofNod, glbal.NumNod];

        // ── Free DOFs first ────────────────────────────────────────────────
        int k = 0;
        for (int i = 0; i < glbal.NumNod; i++)
            for (int j = 0; j < glbal.DofNod; j++)
                if (d.nodbct[j, i] == 0)
                {
                    k++;
                    dofInfo[j, i] = k;
                    ff[k - 1, 0]  = d.nodfor[j, i];
                }
        glbal.NFreeDof = k;

        // ── Constrained DOFs ───────────────────────────────────────────────
        for (int i = 0; i < glbal.NumNod; i++)
            for (int j = 0; j < glbal.DofNod; j++)
                if (d.nodbct[j, i] != 0)
                {
                    k++;
                    dofInfo[j, i] = -k;
                    vc[k - glbal.NFreeDof - 1, 0] = d.noddis[j, i];
                }
        glbal.NConstDof = k - glbal.NFreeDof;

        // ── LM table ──────────────────────────────────────────────────────
        for (int iele = 0; iele < glbal.NumEle; iele++)
        {
            if (!d.eletyp.TryGetValue(iele, out string? typ)) continue;
            int nelnod = el_node(typ);
            for (int ii = 0; ii < nelnod; ii++)
            {
                int n = d.elenod[ii, iele] - 1;
                if (n < 0) continue;
                for (int j = 0; j < glbal.DofNod; j++)
                {
                    int kk = j + ii * glbal.DofNod;
                    lmInfo[kk, iele] = dofInfo[j, n];
                }
            }
        }

        if (glbal.NFreeDof == 0) ff[0, 0] = 0;

        d.lm_info  = lmInfo;
        d.dof_info = dofInfo;
        return (lmInfo, dofInfo, ff, vc);
    }

    // =========================================================================
    //  asm_merg  –  scatter element K into global K
    // =========================================================================
    public static void asm_merg(
        int      dofesm,
        int[]    eft,
        double[,] esm,
        double[,] s,
        double[] eleNodalForce,
        double[,] elefor)
    {
        for (int j = 0; j < dofesm; j++)
        {
            int jj = eft[j] - 1;
            if (jj < 0) continue;
            for (int i = 0; i < dofesm; i++)
            {
                int ii = eft[i] - 1;
                if (ii >= 0)
                    s[ii, jj] += esm[i, j];
            }
            elefor[jj, 0] += eleNodalForce[j];
        }
    }

    // =========================================================================
    //  asm_stiff  –  assemble global stiffness matrix
    // =========================================================================
    /// <summary>
    /// Loops over elements, forms element stiffness, assembles into global K.
    /// Returns (stiff, elefor).
    /// Element stiffness routines are injected via <see cref="IElementLibrary"/>.
    /// </summary>
    public static (double[,] stiff, double[,] elefor) asm_stiff(
        FepsDataDic d,
        IElementLibrary elems)
    {
        int nd = glbal.NumDof;
        var s      = new double[nd, nd];
        var elefor = new double[nd, 1];

        for (int iele = 0; iele < glbal.LasEle; iele++)
        {
            if (d.eledef[iele] == 0) continue;
            if (!d.eletyp.TryGetValue(iele, out string? typ)) continue;

            int nelnod = el_node(typ);
            int dofesm = glbal.DofNod * nelnod;

            // EFT
            var eft = new int[dofesm];
            for (int i = 0; i < dofesm; i++)
                eft[i] = (int)Math.Abs(d.lm_info[i, iele]);

            int m = d.elemat[iele];
            int p = d.elepro[iele];

            var esm             = new double[dofesm, dofesm];
            var eleNodalForce   = new double[dofesm];

            switch (typ.ToUpperInvariant())
            {
                case "BAR2":
                {
                    int ni = d.elenod[0, iele], nj = d.elenod[1, iele];
                    double[] x2 = [d.nodxy[0, ni-1], d.nodxy[0, nj-1]];
                    double[] y2 = [d.nodxy[1, ni-1], d.nodxy[1, nj-1]];
                    double ea   = d.matem[m-1] * d.probar[p-1];
                    double[] eload = EleLoad(d, iele, glbal.Dim);
                    double alpha = d.propAlpha[p-1];
                    (esm, eleNodalForce) = elems.Bar2Stif(x2, y2, ea, alpha, dofesm, eload);
                    break;
                }
                case "BAR3":
                {
                    int ni = d.elenod[0,iele], nj=d.elenod[1,iele], nk=d.elenod[2,iele];
                    double[] x3 = [d.nodxy[0,ni-1], d.nodxy[0,nj-1], d.nodxy[0,nk-1]];
                    double[] y3 = [d.nodxy[1,ni-1], d.nodxy[1,nj-1], d.nodxy[1,nk-1]];
                    double ea   = d.matem[m-1] * d.probar[p-1];
                    (esm, _) = elems.Bar3Stif(x3, y3, ea, dofesm);
                    break;
                }
                case "BAR3D":
                {
                    int ni = d.elenod[0,iele], nj = d.elenod[1,iele];
                    double[] x2=[d.nodxy[0,ni-1],d.nodxy[0,nj-1]];
                    double[] y2=[d.nodxy[1,ni-1],d.nodxy[1,nj-1]];
                    double[] z2=[d.nodxy[2,ni-1],d.nodxy[2,nj-1]];
                    double ea   = d.matem[m-1] * d.probar[p-1];
                    double[] eload = EleLoad(d, iele, glbal.Dim);
                    double alpha = d.propAlpha[p-1];
                    (esm, eleNodalForce) = elems.Bar2Stif3D(x2, y2, z2, ea, alpha, dofesm, eload);
                    break;
                }
                case "BEAM2D":
                {
                    int ni = d.elenod[0,iele], nj = d.elenod[1,iele];
                    double[] x2=[d.nodxy[0,ni-1],d.nodxy[0,nj-1]];
                    double[] y2=[d.nodxy[1,ni-1],d.nodxy[1,nj-1]];
                    double ea   = d.matem[m-1] * d.probar[p-1];
                    double ei   = d.matem[m-1] * d.propIz[p-1];
                    double alpha= d.propAlpha[p-1];
                    double[] eload = EleLoad(d, iele, glbal.Dim + 1);
                    (esm, eleNodalForce) = elems.Beam2_2DStif(x2, y2, ea, ei, alpha, dofesm, eload);
                    break;
                }
                case "BEAM3D":
                {
                    int ni = d.elenod[0,iele], nj = d.elenod[1,iele];
                    double[] x2=[d.nodxy[0,ni-1],d.nodxy[0,nj-1]];
                    double[] y2=[d.nodxy[1,ni-1],d.nodxy[1,nj-1]];
                    double[] z2=[d.nodxy[2,ni-1],d.nodxy[2,nj-1]];
                    double ea   = d.matem[m-1] * d.probar[p-1];
                    double gm   = d.matem[m-1] / (2.0 * (1.0 + d.matnu[m-1]));
                    double ej   = gm * d.propJ[p-1];
                    double eiy  = d.matem[m-1] * d.propIy[p-1];
                    double eiz  = d.matem[m-1] * d.propIz[p-1];
                    double alpha= d.propAlpha[p-1];
                    double[] eload = EleLoad(d, iele, glbal.Dim + 1);
                    double omega = d.section_angle[iele];
                    (esm, eleNodalForce) = elems.Beam2Stif3D(x2,y2,z2,ea,ej,eiy,eiz,omega,alpha,dofesm,eload);
                    break;
                }
                case "QUAD4":
                {
                    int[] nodes = NodeSlice(d, iele, 4);
                    double[] x4 = NodeX(d, nodes); double[] y4 = NodeY(d, nodes);
                    double[] h4 = Fill(d.propth[p-1], 4);
                    double[,] c = get_cmt(d.matem[m-1], d.matnu[m-1]);
                    (esm, _) = elems.Quad4MStif(" ", x4, y4, h4, c, 2, dofesm);
                    break;
                }
                case "QUAD8":
                {
                    int[] nodes = NodeSlice(d, iele, 8);
                    double[] x8 = NodeX(d, nodes); double[] y8 = NodeY(d, nodes);
                    double[] h8 = Fill(d.propth[p-1], 8);
                    double[,] c = get_cmt(d.matem[m-1], d.matnu[m-1]);
                    (esm, _) = elems.Quad8MStif(" ", x8, y8, h8, c, 3, dofesm);
                    break;
                }
                case "QUAD9":
                {
                    int[] nodes = NodeSlice(d, iele, 9);
                    double[] x9 = NodeX(d, nodes); double[] y9 = NodeY(d, nodes);
                    double[] h9 = Fill(d.propth[p-1], 9);
                    double[,] c = get_cmt(d.matem[m-1], d.matnu[m-1]);
                    (esm, _) = elems.Quad9MStif(" ", x9, y9, h9, c, 3, dofesm);
                    break;
                }
                case "TRIG3":
                {
                    int[] nodes = NodeSlice(d, iele, 3);
                    double[] x3 = NodeX(d, nodes); double[] y3 = NodeY(d, nodes);
                    double[] h3 = Fill(d.propth[p-1], 3);
                    double[,] c = get_cmt(d.matem[m-1], d.matnu[m-1]);
                    (esm, _) = elems.Trig3MStif(" ", x3, y3, h3, c, 1, dofesm);
                    break;
                }
                default:
                    throw new InvalidDataException($"asm_stiff: unknown element type '{typ}' in element {iele+1}.");
            }

            asm_merg(dofesm, eft, esm, s, eleNodalForce, elefor);

            if (glbal.PrintFlag && glbal.Fod is not null)
                print_mastif(glbal.Fod, iele + 1, dofesm, esm, 3);
        }
        return (s, elefor);
    }

    // =========================================================================
    //  get_node_dof  –  DOF index → (0-based node, 0-based local dof)
    // =========================================================================
    public static (int node, int dof) get_node_dof(double[,] dofInfo, int dofnod, int givenDof)
    {
        int rows = dofInfo.GetLength(0), cols = dofInfo.GetLength(1);
        for (int i = 0; i < cols; i++)
            for (int j = 0; j < rows; j++)
                if ((int)Math.Abs(dofInfo[j, i]) == givenDof)
                    return (i, j);
        return (0, 0);
    }

    // =========================================================================
    //  map_node_forces  –  solution vector → nodal displacement / force arrays
    // =========================================================================
    public static (double[,] noddis, double[,] nodfor) map_node_forces(
        double[,] dofInfo,
        double[,] vf,
        double[,] fc,
        double[,] noddis,
        double[,] nodfor)
    {
        for (int i = 0; i < glbal.NFreeDof; i++)
        {
            var (node, dof) = get_node_dof(dofInfo, glbal.DofNod, i + 1);
            noddis[dof, node] = vf[i, 0];
        }
        for (int i = glbal.NFreeDof; i < glbal.NumDof; i++)
        {
            var (node, dof) = get_node_dof(dofInfo, glbal.DofNod, i + 1);
            nodfor[dof, node] = fc[i - glbal.NFreeDof, 0];
        }
        return (noddis, nodfor);
    }

    // =========================================================================
    //  print_data  –  echo input to .out file
    // =========================================================================
    public static void print_data(FepsDataDic d)
    {
        var fod = glbal.Fod
            ?? throw new InvalidOperationException("glbal.Fod is not open.");

        string secType = GetSecType();

        fod.WriteLine("**********************************************************************");
        fod.WriteLine("*     FEPS (Finite Element Analysis Program for General Structure)   *");
        fod.WriteLine("*     Author: Minho Kwon, Sept. 2025 implemented as Python           *");
        fod.WriteLine("*             Ported to C# .NET 10                                  *");
        fod.WriteLine("*             for graduate course in Dept. of Civil Engineering      *");
        fod.WriteLine("*             Gyeongsang National University, Jinju, Korea.          *");
        fod.WriteLine("**********************************************************************\n\n");
        fod.WriteLine($"\n Input file name: {Path.GetFileName(glbal.FileName)}\n\n");

        // ── Nodes ──────────────────────────────────────────────────────────
        fod.WriteLine("  === Node Definition Data ===");
        fod.WriteLine(glbal.Dim == 2
            ? "  Node     x-coord     y-coord"
            : "  Node     x-coord     y-coord     z-coord");
        for (int n = 0; n < glbal.LasNod; n++)
        {
            if (d.noddef[n] == 0) continue;
            fod.Write($"     {n + 1}");
            for (int j = 0; j < glbal.Dim; j++)
                fod.Write($"   {d.nodxy[j, n],9:0.000}");
            fod.WriteLine();
        }
        fod.WriteLine();

        // ── Materials ──────────────────────────────────────────────────────
        fod.WriteLine("  === Material Definition Data ===");
        fod.WriteLine("   Code  El.modulus  Pois.ratio");
        for (int m = 0; m < glbal.LasMat; m++)
            if (d.matdef[m] != 0)
                fod.WriteLine($"    {m + 1}     {d.matem[m],9:0.000e+00}      {d.matnu[m],5:0.000}");
        fod.WriteLine();

        // ── Properties ─────────────────────────────────────────────────────
        fod.WriteLine("  ==== Property Definition Data ====");
        fod.WriteLine("   Code    Bar-area  Plate-thickness       Alpha        Iyy         Izz           J");
        for (int p = 0; p < glbal.LasPro; p++)
        {
            if (d.prodef[p] == 0) continue;
            fod.Write($"     {p + 1}    {d.probar[p],8:0.000e+00}    {d.propth[p],8:0.000e+00}");
            if (secType == "2DBeam")
                fod.WriteLine($"        {d.propAlpha[p],8:0.000e+00}                {d.propIz[p],8:0.000e+00}");
            else if (secType == "3DBeam")
                fod.WriteLine($"       {d.propAlpha[p],8:0.000e+00}    {d.propIy[p],8:0.000e+00}    {d.propIz[p],8:0.000e+00}    {d.propJ[p],8:0.000e+00}");
            else
                fod.WriteLine($"        {d.propAlpha[p],8:0.000e+00}");
        }
        fod.WriteLine();

        // ── Elements ───────────────────────────────────────────────────────
        fod.WriteLine("  ====== Element Definition Data ======");
        fod.WriteLine(secType == "3DBeam"
            ? "  Type      Number   Mcode Pcode  Angle       Node-list ...."
            : "  Type      Number   Mcode Pcode       Node-list ....");
        for (int e = 0; e < glbal.LasEle; e++)
        {
            if (d.eledef[e] == 0) continue;
            string typ = d.eletyp[e];
            int nnod = el_node(typ);
            fod.Write($"  {typ,-6}       {e + 1}       {d.elemat[e]}     {d.elepro[e]}");
            if (secType == "3DBeam") fod.Write($"   {d.section_angle[e],8:0.000e+00}");
            for (int j = 0; j < nnod; j++) fod.Write($"      {d.elenod[j, e]}");
            fod.WriteLine();
        }
        fod.WriteLine();

        // ── Element loads ──────────────────────────────────────────────────
        fod.WriteLine("  Type      Number                      Element Loads");
        fod.WriteLine("                           wx          wy          wz     Temperature");
        for (int e = 0; e < glbal.LasEle; e++)
        {
            if (d.eledef[e] == 0) continue;
            string typ = d.eletyp[e];
            fod.Write($"  {typ,-6}      {e + 1}     ");
            if (typ.ToUpperInvariant().StartsWith("BAR"))
                fod.WriteLine($"   {d.eleload[0, e],8:0.000e+00}                           {d.eleload[1, e],8:0.000e+00}");
            else
            {
                for (int j = 0; j < glbal.Dim; j++) fod.Write($"   {d.eleload[j, e],8:0.000e+00}");
                fod.WriteLine($"               {d.eleload[glbal.Dim, e],8:0.000e+00}");
            }
        }
        fod.WriteLine();

        // ── DOF tables ─────────────────────────────────────────────────────
        if (glbal.PrintFlag)
        {
            fod.WriteLine("  ========= Degree-of-Freedom Definition Data =======");
            print_lm_info(fod, d.eletyp, d.lm_info, d.dof_info);
        }

        // ── Nodal BC / loads ───────────────────────────────────────────────
        fod.WriteLine("  ========= Nodal Boundary Conditions and Nodal Load Data =======");
        fod.WriteLine("  1. Prescribed Nodal Loads");
        PrintBcHeader(fod, secType, "load");
        for (int n = 0; n < glbal.LasNod; n++)
        {
            if (d.noddef[n] == 0) continue;
            fod.Write($"{n + 1,5}");
            for (int j = 0; j < glbal.DofNod; j++) fod.Write($"{d.nodbct[j, n],9:0.000}");
            for (int j = 0; j < glbal.DofNod; j++) fod.Write($"{d.nodfor[j, n],11:0.000e+00}");
            fod.WriteLine();
        }
        fod.WriteLine();

        fod.WriteLine("  2. Prescribed Displacement");
        PrintBcHeader(fod, secType, "disp");
        for (int n = 0; n < glbal.LasNod; n++)
        {
            if (d.noddef[n] == 0) continue;
            fod.Write($"{n + 1,5}");
            for (int j = 0; j < glbal.DofNod; j++) fod.Write($"{d.nodbct[j, n],8:0.000} ");
            for (int j = 0; j < glbal.DofNod; j++) fod.Write($"{d.noddis[j, n],11:0.000e+00}");
            fod.WriteLine();
        }
        fod.WriteLine();
    }

    // =========================================================================
    //  print_eigenvalues
    // =========================================================================
    public static void print_eigenvalues(StreamWriter fod, int msize, double[,] stiff)
    {
        // Build MathNet matrix and compute eigenvalues
        var kMat = MathNet.Numerics.LinearAlgebra.Double.DenseMatrix.OfArray(stiff);
        var evd  = kMat.Evd(MathNet.Numerics.LinearAlgebra.Symmetricity.Symmetric);
        double[] eigvals = evd.EigenValues.Select(c => c.Real).ToArray();
        Array.Sort(eigvals);

        fod.WriteLine(" Eigenvalues of Kff - master stiffness matrix:");
        for (int jRef = 0; jRef < msize; jRef += 8)
        {
            int jEnd = Math.Min(jRef + 8, msize);
            for (int j = jRef; j < jEnd; j++) fod.Write($"{j + 1,14}");
            fod.WriteLine();
            fod.Write($"{1,4}");
            for (int j = jRef; j < jEnd; j++) fod.Write($"{eigvals[j],14:0.000e+00}");
            fod.WriteLine();
        }
        fod.WriteLine();
    }

    // =========================================================================
    //  print_lm_info
    // =========================================================================
    public static void print_lm_info(
        StreamWriter fod,
        Dictionary<int, string> eletyp,
        double[,] lmInfo,
        double[,] dofInfo)
    {
        fod.WriteLine(" Element Mapping Information: LM_info");
        fod.Write("  ele\\dof");
        for (int j = 0; j < (glbal.Dim - 1) * 6; j++) fod.Write($"{j + 1,8}");
        fod.WriteLine("\n-------------------------------------------------------");

        for (int i = 0; i < glbal.NumEle; i++)
        {
            if (!eletyp.TryGetValue(i, out string? typ)) continue;
            int nelnod = el_node(typ);
            int dofesm = glbal.DofNod * nelnod;
            fod.Write($"{i + 1,8}:");
            for (int j = 0; j < dofesm; j++) fod.Write($"{(int)lmInfo[j, i],8}");
            fod.WriteLine(" ");
        }
        fod.WriteLine();

        fod.WriteLine(" Node and Degree of Freedom Table: DOF_info");
        fod.Write(" node\\dof");
        for (int j = 0; j < (glbal.Dim - 1) * 3; j++) fod.Write($"{j + 1,8}");
        fod.WriteLine("\n-------------------------------------------------------");

        int rows = dofInfo.GetLength(0), cols = dofInfo.GetLength(1);
        for (int i = 0; i < cols; i++)
        {
            fod.Write($"{i + 1,8}:");
            for (int j = 0; j < rows; j++) fod.Write($"{(int)dofInfo[j, i],8}");
            fod.WriteLine(" ");
        }
        fod.WriteLine();
    }

    // =========================================================================
    //  print_mastif
    // =========================================================================
    public static void print_mastif(StreamWriter fod, int iele, int msize, double[,] stiff, int opt)
    {
        fod.WriteLine(opt switch
        {
            1 => " Assembled master stiffness matrix:",
            2 => " Kff - master stiffness matrix:",
            _ => $" {iele,5} : Element stiffness matrix :"
        });

        for (int jRef = 0; jRef < msize; jRef += 8)
        {
            for (int j = jRef; j < Math.Min(jRef + 8, msize); j++)
                fod.Write($"   {j + 1,9}");
            fod.WriteLine();
            for (int i = 0; i < msize; i++)
            {
                fod.Write($"{i + 1,5}");
                for (int j = jRef; j < Math.Min(jRef + 8, msize); j++)
                    fod.Write($"  {stiff[i, j],9:0.000} ");
                fod.WriteLine();
            }
        }
        fod.WriteLine();
    }

    // =========================================================================
    //  print_node_disp_force
    // =========================================================================
    public static void print_node_disp_force(StreamWriter fod, FepsDataDic d)
    {
        fod.WriteLine("  --------- Computed  Node Displacements  -------");
        fod.WriteLine(
            (glbal.Dim, glbal.DofNod) switch
            {
                (2, 2) => "  Node   x-coord    y-coord     x-displ      y-displ",
                (2, 3) => "  Node   x-coord    y-coord     x-displ      y-displ      Angle",
                (3, 3) => "  Node   x-coord    y-coord     z-coord     x-displ      y-displ      z-displ",
                _      => "  Node   x-coord    y-coord     z-coord     x-displ      y-displ      z-displ     x-angle     y-angle     z-angle"
            });

        for (int n = 0; n < glbal.LasNod; n++)
        {
            if (d.noddef[n] != 0)
            {
                fod.Write($"{n + 1,6}");
                for (int j = 0; j < glbal.Dim;    j++) fod.Write($" {d.nodxy[j,n],11:0.000e+00}");
                for (int j = 0; j < glbal.DofNod; j++) fod.Write($" {d.noddis[j,n],11:0.000e+00}");
            }
            fod.WriteLine();
        }

        fod.WriteLine("  ------------ Computed Node Forces -------------");
        fod.WriteLine(
            (glbal.Dim, glbal.DofNod) switch
            {
                (2, 2) => "  Node   x-coord    y-coord    x-force      y-force",
                (2, 3) => "  Node   x-coord    y-coord    x-force      y-force      Moment",
                (3, 3) => "  Node   x-coord    y-coord     z-coord     x-force      y-force      z-force",
                _      => "  Node   x-coord    y-coord     z-coord     x-force      y-force      z-force     x-moment    y-moment    z-moment"
            });

        for (int n = 0; n < glbal.LasNod; n++)
        {
            if (d.noddef[n] != 0)
            {
                fod.Write($"{n + 1,6}");
                for (int j = 0; j < glbal.Dim;    j++) fod.Write($" {d.nodxy[j,n],11:0.000e+00}");
                for (int j = 0; j < glbal.DofNod; j++) fod.Write($" {d.nodfor[j,n],11:0.000e+00}");
                fod.WriteLine();
            }
        }
        fod.WriteLine();
    }

    // =========================================================================
    //  print_bar_force
    // =========================================================================
    public static void print_bar_force(StreamWriter fod, FepsDataDic d)
    {
        fod.WriteLine(" --------- Bar Axial Forces ---------");
        fod.WriteLine(" Type   Number  Node1  Node2     Force          Stress");
        for (int e = 0; e < glbal.LasEle; e++)
        {
            if (d.eledef[e] == 0) continue;
            if (!d.eletyp.TryGetValue(e, out string? typ)) continue;
            if (typ != "BAR2" && typ != "BAR3" && typ != "BAR3D") continue;

            int ni = d.elenod[0, e], nj = d.elenod[1, e];
            int p  = d.elepro[e];
            double sigmem = d.fmem_local[e, 0] / d.probar[p - 1];
            fod.WriteLine($" {typ,-6} {e + 1,6} {ni,6} {nj,6}   {d.fmem_local[e, 0],12:0.000000}   {sigmem,12:0.000000}");
        }
        fod.WriteLine();
    }

    // =========================================================================
    //  print_beam_force
    // =========================================================================
    public static void print_beam_force(StreamWriter fod, FepsDataDic d)
    {
        fod.WriteLine(" --------- Beam Section Forces Information---------");
        if (glbal.Dim == 2)
            fod.WriteLine(" Type   Number  Node      Force-Local_x   Force-Local_y     Moment");
        else
        {
            fod.WriteLine(" Type   Number  Node      Force-Local_x   Force-Local_y     Force-Local_z");
            fod.WriteLine("                            Moment_xx       Moment_yy         Moment_zz");
        }

        for (int e = 0; e < glbal.LasEle; e++)
        {
            if (!d.eletyp.TryGetValue(e, out string? typ)) continue;
            if (typ == "BEAM2D")
            {
                int ni = d.elenod[0, e], nj = d.elenod[1, e];
                fod.WriteLine($" {typ,-6} {e + 1,6} {ni,6} {d.fmem_local[e,0],15:0.000e+00} {d.fmem_local[e,1],15:0.000e+00} {d.fmem_local[e,2],15:0.000e+00}");
                fod.WriteLine($"               {nj,6} {d.fmem_local[e,3],15:0.000e+00} {d.fmem_local[e,4],15:0.000e+00} {d.fmem_local[e,5],15:0.000e+00}");
            }
            else if (typ == "BEAM3D")
            {
                int ni = d.elenod[0, e], nj = d.elenod[1, e];
                fod.WriteLine($" {typ,-6} {e + 1,6} {ni,6} {d.fmem_local[e,0],15:0.000e+00} {d.fmem_local[e,1],15:0.000e+00} {d.fmem_local[e,2],15:0.000e+00}");
                fod.WriteLine($"                      {d.fmem_local[e,3],15:0.000e+00} {d.fmem_local[e,4],15:0.000e+00} {d.fmem_local[e,5],15:0.000e+00}");
                fod.WriteLine($"               {nj,6} {d.fmem_local[e,6],15:0.000e+00} {d.fmem_local[e,7],15:0.000e+00} {d.fmem_local[e,8],15:0.000e+00}");
                fod.WriteLine($"                      {d.fmem_local[e,9],15:0.000e+00} {d.fmem_local[e,10],15:0.000e+00} {d.fmem_local[e,11],15:0.000e+00}");
            }
        }
        fod.WriteLine();
    }

    // =========================================================================
    //  print_stress
    // =========================================================================
    public static void print_stress(
        StreamWriter fod, int lasNod, double[,] nodxy, double[,] nodsig, string escm)
    {
        fod.WriteLine($"\n Element stress computation method: {escm}\n");
        fod.WriteLine("  --------------------------- Averaged Nodal Stresses -------------------------------------------------");
        fod.WriteLine("   Node    x-coord     y-coord    Sigma-xx     Sigma-yy     Tau-xy    Sigma-max    Sigma-min    Mises");
        for (int n = 0; n < lasNod; n++)
            fod.WriteLine($"{n+1,6} {nodxy[0,n],11:0.000} {nodxy[1,n],11:0.000}  " +
                          $"{nodsig[0,n],11:0.0000} {nodsig[1,n],11:0.0000} {nodsig[2,n],11:0.0000} " +
                          $"{nodsig[3,n],11:0.0000} {nodsig[4,n],11:0.0000} {nodsig[5,n],11:0.0000}");
    }

    // =========================================================================
    //  Private helpers
    // =========================================================================

    internal static string GetSecType()
    {
        int id = glbal.Dim * glbal.DofNod;
        return id == 6 ? "2DBeam" : id == 18 ? "3DBeam" : "Solid";
    }

    private static double P(string[] tok, int idx) =>
        idx < tok.Length
            ? double.Parse(tok[idx], System.Globalization.CultureInfo.InvariantCulture)
            : 0.0;

    private static string[] ReadTokens(StreamReader r)
    {
        string line = r.ReadLine() ?? throw new EndOfStreamException();
        return line.Split(new char[]{' ', '\t', ','}, StringSplitOptions.RemoveEmptyEntries);
    }

    private static int[] ReadInts(StreamReader r)
    {
        var tok = ReadTokens(r);
        return tok.Select(int.Parse).ToArray();
    }

    private static double[] EleLoad(FepsDataDic d, int iele, int count)
    {
        var arr = new double[count];
        for (int i = 0; i < count; i++)
            arr[i] = i < d.eleload.GetLength(0) ? d.eleload[i, iele] : 0.0;
        return arr;
    }

    private static int[] NodeSlice(FepsDataDic d, int iele, int count)
    {
        var arr = new int[count];
        for (int i = 0; i < count; i++) arr[i] = d.elenod[i, iele] - 1; // 0-based
        return arr;
    }

    private static double[] NodeX(FepsDataDic d, int[] nodes)
        => nodes.Select(n => d.nodxy[0, n]).ToArray();

    private static double[] NodeY(FepsDataDic d, int[] nodes)
        => nodes.Select(n => d.nodxy[1, n]).ToArray();

    private static double[] Fill(double val, int count)
    {
        var a = new double[count]; Array.Fill(a, val); return a;
    }

    private static void PrintBcHeader(StreamWriter fod, string secType, string mode)
    {
        bool isLoad = mode == "load";
        string fx = isLoad ? "Fx" : "Ux", fy = isLoad ? "Fy" : "Uy",
               fz = isLoad ? "Fz" : "Uz", mzz= isLoad ? "Mzz": "Rzz",
               mxx= isLoad ? "Mxx": "Rxx", myy= isLoad ? "Myy": "Ryy";
        if      (secType == "Solid"  && glbal.Dim == 2)
        { fod.WriteLine($"  Node  x-BCtag y-BCtag  Prescribed\n                         {fx}         {fy}"); }
        else if (secType == "2DBeam")
        { fod.WriteLine($"  Node  x-BCtag y-BCtag th-BCtag       Prescribed\n                                  {fx}         {fy}        {mzz}"); }
        else if (secType == "Solid"  && glbal.Dim == 3)
        { fod.WriteLine($"  Node  x-BCtag y-BCtag z-BCtag        Prescribed               \n                                  {fx}         {fy}         {fz}"); }
        else
        { fod.WriteLine($"  Node  x-BCtag y-BCtag z-BCtag  thx-BC  thy-BC  thz-BC                 Prescribed\n                                                         {fx}         {fy}         {fz}         {mxx}        {myy}        {mzz}"); }
    }
}

// =============================================================================
//  IElementLibrary  –  injection interface for element stiffness routines
//  (Implement in Elements.cs when porting elements.py)
// =============================================================================
public interface IElementLibrary
{
    (double[,] esm, double[] force) Bar2Stif(double[] x, double[] y, double ea, double alpha, int dofesm, double[] eload);
    (double[,] esm, double[] force) Bar3Stif(double[] x, double[] y, double ea, int dofesm);
    (double[,] esm, double[] force) Bar2Stif3D(double[] x, double[] y, double[] z, double ea, double alpha, int dofesm, double[] eload);
    (double[,] esm, double[] force) Beam2_2DStif(double[] x, double[] y, double ea, double ei, double alpha, int dofesm, double[] eload);
    (double[,] esm, double[] force) Beam2Stif3D(double[] x, double[] y, double[] z, double ea, double ej, double eiy, double eiz, double omega, double alpha, int dofesm, double[] eload);
    (double[,] esm, double[] force) Quad4MStif(string opt, double[] x, double[] y, double[] h, double[,] c, int nGauss, int dofesm);
    (double[,] esm, double[] force) Quad8MStif(string opt, double[] x, double[] y, double[] h, double[,] c, int nGauss, int dofesm);
    (double[,] esm, double[] force) Quad9MStif(string opt, double[] x, double[] y, double[] h, double[,] c, int nGauss, int dofesm);
    (double[,] esm, double[] force) Trig3MStif(string opt, double[] x, double[] y, double[] h, double[,] c, int nGauss, int dofesm);
}
