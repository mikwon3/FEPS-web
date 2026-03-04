// =============================================================================
//  FepsDataDic.cs  –  Typed replacement for Python data_dic dictionary
//
//  Python used a plain dict with string keys.  Here every key becomes a
//  strongly-typed property with the SAME name (snake_case kept for 1-to-1
//  mapping back to the Python source).
//
//  Array layouts follow the Python / existing-C# 0-based convention:
//    nodxy   [dim, numnod]
//    nodbct  [dofnod, numnod]
//    elenod  [melnod, maxele]
//    lm_info [melnod*dofnod, lasele]
//    dof_info[dofnod, numnod]
//    fmem_local [lasele, 12]   (transposed vs Python's [12, lasele])
//    nodsig  [6, numnod]
// =============================================================================

namespace FESEC;

/// <summary>
/// Typed data dictionary – replaces Python <c>data_dic</c>.
/// All arrays use 0-based indexing (Python convention).
/// </summary>
public sealed class FepsDataDic
{
    // ── Node data ─────────────────────────────────────────────────────────────
    public int[]     noddef  = [];         // [numnod]
    public double[,] nodxy   = new double[0,0]; // [dim, numnod]
    public int[,]    nodbct  = new int[0,0];    // [dofnod, numnod]
    public double[,] nodfor  = new double[0,0]; // [dofnod, numnod]
    public double[,] noddis  = new double[0,0]; // [dofnod, numnod]
    public double[,] applied_force = new double[0,0];
    public double[,] applied_displ = new double[0,0];

    // ── Material data ────────────────────────────────────────────────────────
    public int[]    matdef = [];
    public double[] matem  = [];   // Young's modulus
    public double[] matnu  = [];   // Poisson's ratio

    // ── Section / property data ───────────────────────────────────────────────
    public int[]    prodef    = [];
    public double[] probar    = [];   // cross-section area
    public double[] propth    = [];   // thickness (or used as t)
    public double[] propIy    = [];   // 2nd moment about y
    public double[] propIz    = [];   // 2nd moment about z
    public double[] propJ     = [];   // torsional constant
    public double[] propAlpha = [];   // thermal expansion coeff

    // ── Element data ─────────────────────────────────────────────────────────
    public int[]     eledef        = [];
    public int[]     elemat        = [];
    public int[]     elepro        = [];
    public int[,]    elenod        = new int[0,0];    // [melnod, maxele]
    public double[,] eleload       = new double[0,0]; // [dim+1, maxele]
    public double[]  section_angle = [];
    /// <summary>Element type names, keyed by 0-based element index.</summary>
    public Dictionary<int, string> eletyp = new();

    // ── Assembled tables (filled by AsmLmTable) ───────────────────────────────
    public double[,] lm_info  = new double[0,0]; // [melnod*dofnod, lasele]
    public double[,] dof_info = new double[0,0]; // [dofnod, numnod]

    // ── Results ───────────────────────────────────────────────────────────────
    /// <summary>Member forces: [lasele, 12]</summary>
    public double[,] fmem_local = new double[0,0];
    /// <summary>Averaged nodal stresses: [6, numnod]</summary>
    public double[,] nodsig = new double[0,0];
}
