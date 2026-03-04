// =============================================================================
//  FepsEngine.cs  –  Analysis orchestration
//
//  Ported from feps_engine.py  →  .NET 10
//
//  The single public method run_analysis() mirrors the Python function exactly:
//    1. Validate input file
//    2. Open I/O streams
//    3. read_data → asm_lm_table → print_data
//    4. asm_stiff
//    5. Partition K, solve vf = Kff\(ff - Kfc·vc)
//    6. Compute reactions fc
//    7. map_node_forces
//    8. Post-process bar / beam / 2-D stress
//    9. (Optional) write VTK output
//
//  Returns the populated FepsDataDic or null on error.
// =============================================================================

using static FESEC.G;          // glbal
using static FESEC.FepsProgram;
using MathNet.Numerics.LinearAlgebra;
using MathNet.Numerics.LinearAlgebra.Double;

namespace FESEC;

public static class FepsEngine
{
    /// <summary>
    /// Run a full finite-element analysis from <paramref name="inputFilename"/>.
    /// Returns the data dictionary, or <c>null</c> on failure.
    /// </summary>
    /// <param name="elementLib">
    /// Provider of element stiffness routines (inject real implementation or
    /// <see cref="NotImplementedElementLibrary"/> placeholder).
    /// </param>
    /// <param name="postProcess">
    /// Optional post-processing provider for bar/beam forces and 2-D stress.
    /// Pass <c>null</c> to skip post-processing.
    /// </param>
    public static FepsDataDic? run_analysis(
        string          inputFilename,
        IElementLibrary elementLib,
        IPostProcess?   postProcess = null)
    {
        // Flags from global state (set by caller before invoking)
        bool printFlag = glbal.PrintFlag;
        bool vtkFlag   = glbal.VtkFlag;

        if (string.IsNullOrEmpty(inputFilename) || !File.Exists(inputFilename))
        {
            Console.Error.WriteLine("Error: Input file not provided or does not exist.");
            return null;
        }
        glbal.FileName = inputFilename;

        try
        {
            string   dirPath  = Path.GetDirectoryName(inputFilename) ?? ".";
            string   baseName = Path.GetFileNameWithoutExtension(inputFilename);
            string   outFile  = Path.Combine(dirPath, baseName + ".out");
            glbal.OutFile = outFile;

            using var fid = new StreamReader(inputFilename);
            using var fod = new StreamWriter(outFile);

            glbal.Fid = fid;
            glbal.Fod = fod;

            // ── 1. Read input ──────────────────────────────────────────────
            FepsDataDic d = read_data();

            // ── 2. DOF / LM tables ─────────────────────────────────────────
            glbal.MaxDof = glbal.DofNod * glbal.NumNod;
            var (lmInfo, dofInfo, ff, vv) = asm_lm_table(d);
            d.lm_info  = lmInfo;
            d.dof_info = dofInfo;

            // ── 3. Echo input ──────────────────────────────────────────────
            print_data(d);
            glbal.NumDof = glbal.NFreeDof + glbal.NConstDof;

            int nf = glbal.NFreeDof;
            int nc = glbal.NConstDof;

            // ── 4. Assemble global stiffness ────────────────────────────────
            var (stiff, elefor) = asm_stiff(d, elementLib);

            // ── 5. Partition and solve ──────────────────────────────────────
            // ff0 = ff[:nf] − elefor[:nf]
            var ff0 = DenseVector.Create(nf, i => ff[i, 0] - elefor[i, 0]);

            var vc  = DenseVector.Create(nc, i => vv[i, 0]);

            var kff = DenseMatrix.OfArray(SubMatrix(stiff, 0, nf, 0, nf));
            var kfc = DenseMatrix.OfArray(SubMatrix(stiff, 0, nf, nf, nf + nc));
            var kcf = DenseMatrix.OfArray(SubMatrix(stiff, nf, nf + nc, 0, nf));
            var kcc = DenseMatrix.OfArray(SubMatrix(stiff, nf, nf + nc, nf, nf + nc));

            if (printFlag)
                print_mastif(fod, 0, nf, kff.ToArray(), 2);
            print_eigenvalues(fod, nf, kff.ToArray());

            // vf = Kff \ (ff0 − Kfc·vc)
            var rhs = ff0 - kfc * vc;
            var vf  = kff.Solve(rhs);   // MathNet LU solve

            // ── 6. Reactions ───────────────────────────────────────────────
            var eleforCols = DenseVector.Create(nc,
                i => elefor[nf + i, 0]);
            var fc = kcf * vf + kcc * vc - eleforCols;

            // Wrap as [n,1] arrays to match map_node_forces signature
            var vfArr = ToColumn(vf.ToArray());
            var fcArr = ToColumn(fc.ToArray());

            // ── 7. Map results to nodal arrays ─────────────────────────────
            (d.noddis, d.nodfor) = map_node_forces(
                d.dof_info, vfArr, fcArr, d.noddis, d.nodfor);

            print_node_disp_force(fod, d);

            // ── 8. Post-processing ─────────────────────────────────────────
            if (postProcess is not null)
            {
                if (glbal.NumBar > 0)
                {
                    d.fmem_local = postProcess.OneDimBarForces(d);
                    print_bar_force(fod, d);
                }

                if (glbal.Num3DBeam > 0 || glbal.Num2DBeam > 0)
                {
                    d.fmem_local = postProcess.OneDimBeamForces(d);
                    print_beam_force(fod, d);
                }

                if ((glbal.NumQua + glbal.NumTri) > 0)
                {
                    const string escm = "DIRECT";
                    (d.nodsig, glbal.NodCnt) = postProcess.TwoDimStress(d, escm);
                    print_stress(fod, glbal.LasNod, d.nodxy, d.nodsig, escm);
                }
            }

            // ── 9. VTK output ──────────────────────────────────────────────
            if (vtkFlag)
                postProcess?.CreateVtkFile(d);

            return d;
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"An error occurred during analysis: {ex.Message}");
            Console.Error.WriteLine(ex.StackTrace);
            return null;
        }
        finally
        {
            glbal.Fid = null;
            glbal.Fod = null;
        }
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    /// <summary>Extract a rectangular sub-matrix (row range [r0,r1), col range [c0,c1)).</summary>
    private static double[,] SubMatrix(double[,] src, int r0, int r1, int c0, int c1)
    {
        int rows = r1 - r0, cols = c1 - c0;
        var m = new double[rows, cols];
        for (int i = 0; i < rows; i++)
            for (int j = 0; j < cols; j++)
                m[i, j] = src[r0 + i, c0 + j];
        return m;
    }

    /// <summary>Wrap a 1-D array as a column matrix [n, 1].</summary>
    private static double[,] ToColumn(double[] v)
    {
        var m = new double[v.Length, 1];
        for (int i = 0; i < v.Length; i++) m[i, 0] = v[i];
        return m;
    }
}

// =============================================================================
//  IPostProcess  –  injection interface for post-processing routines
//  (Implement when porting post_process.py)
// =============================================================================
public interface IPostProcess
{
    /// <summary>Compute and return member forces for bar elements [lasele, 12].</summary>
    double[,] OneDimBarForces(FepsDataDic d);

    /// <summary>Compute and return member forces for beam elements [lasele, 12].</summary>
    double[,] OneDimBeamForces(FepsDataDic d);

    /// <summary>
    /// Compute averaged nodal stresses.
    /// Returns (nodsig[6, numnod], nodcnt[numnod]).
    /// </summary>
    (double[,] nodsig, int[] nodcnt) TwoDimStress(FepsDataDic d, string escm);

    /// <summary>Write VTK output file.</summary>
    void CreateVtkFile(FepsDataDic d);
}

// =============================================================================
//  NotImplementedElementLibrary  –  placeholder until elements.py is ported
// =============================================================================
public sealed class NotImplementedElementLibrary : IElementLibrary
{
    private static (double[,], double[]) Stub(int dof) =>
        (new double[dof, dof], new double[dof]);

    public (double[,], double[]) Bar2Stif(double[] x, double[] y, double ea, double alpha, int d, double[] eload) => Stub(d);
    public (double[,], double[]) Bar3Stif(double[] x, double[] y, double ea, int d) => Stub(d);
    public (double[,], double[]) Bar2Stif3D(double[] x, double[] y, double[] z, double ea, double alpha, int d, double[] eload) => Stub(d);
    public (double[,], double[]) Beam2_2DStif(double[] x, double[] y, double ea, double ei, double alpha, int d, double[] eload) => Stub(d);
    public (double[,], double[]) Beam2Stif3D(double[] x, double[] y, double[] z, double ea, double ej, double eiy, double eiz, double omega, double alpha, int d, double[] eload) => Stub(d);
    public (double[,], double[]) Quad4MStif(string o, double[] x, double[] y, double[] h, double[,] c, int ng, int d) => Stub(d);
    public (double[,], double[]) Quad8MStif(string o, double[] x, double[] y, double[] h, double[,] c, int ng, int d) => Stub(d);
    public (double[,], double[]) Quad9MStif(string o, double[] x, double[] y, double[] h, double[,] c, int ng, int d) => Stub(d);
    public (double[,], double[]) Trig3MStif(string o, double[] x, double[] y, double[] h, double[,] c, int ng, int d) => Stub(d);
}
