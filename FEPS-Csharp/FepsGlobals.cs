// =============================================================================
//  FepsGlobals.cs  –  Global state container
//
//  Ported from feps_globals.py  →  .NET 10
//
//  Design decisions (matching existing C# conventions):
//    • Single shared instance via FepsGlobals.Instance (replaces Python glbal)
//    • Reset() method mirrors Python __init__ / reset()
//    • All field names converted from snake_case to PascalCase
//    • Nullable reference types used throughout (fields start as null)
//    • StreamReader/Writer kept identical to existing FEA_IO.cs pattern
// =============================================================================

namespace FESEC;

/// <summary>
/// Singleton global state container – mirrors Python <c>glbal</c> object.
/// Call <see cref="Reset"/> before each analysis run.
/// </summary>
public sealed class FepsGlobals
{
    // ── Singleton ────────────────────────────────────────────────────────────
    public static readonly FepsGlobals Instance = new();
    private FepsGlobals() => Reset();

    // ── Analysis mesh counts ─────────────────────────────────────────────────
    public int  LasNod   { get; set; }   // highest node  number defined
    public int  LasEle   { get; set; }   // highest element number defined
    public int  LasMat   { get; set; }   // highest material number defined
    public int  LasPro   { get; set; }   // highest property number defined

    public int  NumNod   { get; set; }
    public int  NumEle   { get; set; }   // (== lasele after read)
    public int  NumMat   { get; set; }
    public int  NumPro   { get; set; }
    public int  MaxNod   { get; set; }
    public int  MaxEle   { get; set; }
    public int  MelNod   { get; set; } = 16; // max nodes per element

    public int  DofNod   { get; set; }   // DOFs per node
    public int  Dim      { get; set; }   // spatial dimension (2 or 3)
    public int  MaxDof   { get; set; }   // dofnod * numnod
    public int  NumDof   { get; set; }   // nfreedof + nconstdof
    public int  NFreeDof { get; set; }   // number of free DOFs
    public int  NConstDof{ get; set; }   // number of constrained DOFs

    // ── Element-type counters ─────────────────────────────────────────────────
    public int  NumBar   { get; set; }
    public int  NumQua   { get; set; }
    public int  NumTri   { get; set; }
    public int  Num2DBeam{ get; set; }
    public int  Num3DBeam{ get; set; }

    // ── Nodal stress count array ──────────────────────────────────────────────
    public int[]? NodCnt { get; set; }

    // ── File paths ────────────────────────────────────────────────────────────
    public string? PathName  { get; set; }
    public string? FileName  { get; set; }
    public string? OutFile   { get; set; }

    // ── Control flags ─────────────────────────────────────────────────────────
    public bool PrintFlag { get; set; }
    public bool VtkFlag   { get; set; }

    // ── I/O streams (set by engine before use) ────────────────────────────────
    public StreamReader? Fid { get; set; }
    public StreamWriter? Fod { get; set; }

    // ── Post-processing visualisation state ──────────────────────────────────
    public object?  Diagram           { get; set; }
    public bool     EleNumCheckbox    { get; set; }
    public bool     NodNumCheckbox    { get; set; }
    public bool     NodeSymbolCheckbox{ get; set; }
    public int      ComponentPopup    { get; set; } = 1;
    public bool     DeformCheckbox    { get; set; }
    public bool     OriginCheckbox    { get; set; } = true;
    public bool     StressCheckbox    { get; set; }
    public double   LineWidth         { get; set; } = 1.0;
    public double   Factor            { get; set; } = 1.0;
    public int      NumOfLegend       { get; set; } = 10;
    public int      StressIndex       { get; set; } = 1;
    public bool     ContourFlag       { get; set; }
    public bool     LoadCheckbox      { get; set; }
    public int      BmdIndex          { get; set; } = -1;
    public double?  XMin { get; set; } public double? XMax { get; set; }
    public double?  YMin { get; set; } public double? YMax { get; set; }
    public double?  ZMin { get; set; } public double? ZMax { get; set; }

    // ── Reset (called before each analysis) ──────────────────────────────────
    public void Reset()
    {
        LasNod = LasEle = LasMat = LasPro = 0;
        NumNod = NumEle = NumMat = NumPro = 0;
        MaxNod = MaxEle = 0;
        MelNod = 16;
        DofNod = Dim = MaxDof = NumDof = NFreeDof = NConstDof = 0;
        NumBar = NumQua = NumTri = Num2DBeam = Num3DBeam = 0;
        NodCnt = null;
        PathName = FileName = OutFile = null;
        PrintFlag = VtkFlag = false;
        Fid = null; Fod = null;
        Diagram = null;
        EleNumCheckbox = NodNumCheckbox = NodeSymbolCheckbox = false;
        ComponentPopup = 1;
        DeformCheckbox = false; OriginCheckbox = true;
        StressCheckbox = ContourFlag = LoadCheckbox = false;
        LineWidth = 1.0; Factor = 1.0;
        NumOfLegend = 10; StressIndex = 1;
        BmdIndex = -1;
        XMin = XMax = YMin = YMax = ZMin = ZMax = null;
    }
}

// Convenience alias so ported code can use glbal.Xxx directly
// (identical pattern to the Python  "from feps_globals import glbal")
internal static class G
{
    internal static FepsGlobals glbal => FepsGlobals.Instance;
}
