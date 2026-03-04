// =============================================================================
//  FepsUtils.cs  –  Element-level helper routines
//
//  Ported from utils.py  →  .NET 10
//
//  Functions ported (same names, snake_case kept):
//    get_cmt            – 2D isotropic constitutive matrix
//    get_stress_range   – find colour-band index for a stress value
//    line_gauss_quad    – 1-D Gauss abscissas & weights
//    line_lobatto_quad  – 1-D Gauss-Lobatto abscissas & weights
//    quad_gauss_q       – 2-D product Gauss rule (uses line_gauss_quad)
//    rotate_2d          – 2-D beam rotation / transformation matrix
//    rotate_3d          – 3-D beam rotation / transformation matrix
//    trig_gauss_q       – triangular Gauss integration
// =============================================================================

namespace FESEC;

public static class FepsUtils
{
    // =========================================================================
    //  Constitutive matrix  (plane stress, isotropic)
    // =========================================================================

    /// <summary>
    /// Form 2-D constitutive matrix for isotropic material (plane stress).
    /// </summary>
    public static double[,] get_cmt(double e, double nu)
    {
        var c = new double[3, 3];
        c[0, 0] = e / (1.0 - nu * nu);
        c[1, 1] = c[0, 0];
        c[2, 2] = 0.5 * c[0, 0] * (1.0 - nu);
        c[0, 1] = c[0, 0] * nu;
        c[1, 0] = c[0, 1];
        return c;
    }

    // =========================================================================
    //  Stress-range helper (colour-band lookup)
    // =========================================================================

    /// <summary>
    /// Return 1-based band index (1..12) for <paramref name="stress"/>
    /// within the sorted <paramref name="stressTable"/> (length ≥ 12).
    /// </summary>
    public static int get_stress_range(double stress, double[] stressTable, int ncount)
    {
        if (stress <= stressTable[0])  return 1;
        if (stress > stressTable[11]) return 12;
        for (int i = 0; i < ncount - 1; i++)
            if (stress >= stressTable[i] && stress < stressTable[i + 1])
                return i + 1;
        return 1;
    }

    // =========================================================================
    //  1-D Gauss quadrature  (p = 1..4 points)
    // =========================================================================

    /// <summary>
    /// Abscissa and weight for the <paramref name="i"/>-th point of a
    /// <paramref name="p"/>-point Gauss-Legendre rule on [-1, 1].
    /// </summary>
    public static (double xi, double weight) line_gauss_quad(int p, int i)
    {
        return p switch
        {
            <= 1 => (0.0, 2.0),
            2    => i == 1 ? (-1.0 / Math.Sqrt(3.0), 1.0)
                           : ( 1.0 / Math.Sqrt(3.0), 1.0),
            3    => i switch
            {
                1 => (-Math.Sqrt(0.6), 5.0 / 9.0),
                2 => (0.0,             8.0 / 9.0),
                _ => ( Math.Sqrt(0.6), 5.0 / 9.0)
            },
            _    => i switch   // p == 4
            {
                1 => (-0.8611363115940530, 0.3478548451374540),
                2 => (-0.3399810435848560, 0.6521451548625460),
                3 => ( 0.3399810435848560, 0.6521451548625460),
                _ => ( 0.8611363115940530, 0.3478548451374540)
            }
        };
    }

    // =========================================================================
    //  1-D Gauss-Lobatto quadrature  (p = 1..5 points)
    // =========================================================================

    /// <summary>
    /// Abscissa and weight for the <paramref name="i"/>-th point of a
    /// <paramref name="p"/>-point Gauss-Lobatto rule on [-1, 1].
    /// (End-points are included as integration points.)
    /// </summary>
    public static (double xi, double weight) line_lobatto_quad(int p, int i)
    {
        return p switch
        {
            <= 1 => (0.0,  2.0),
            2    => i == 1 ? (-1.0, 1.0) : (1.0, 1.0),
            3    => i switch
            {
                1 => (-1.0, 1.0 / 3.0),
                2 => ( 0.0, 4.0 / 3.0),
                _ => ( 1.0, 1.0 / 3.0)
            },
            4    => i switch
            {
                1 => (-1.0,           1.0 / 6.0),
                2 => (-0.44721360,    5.0 / 6.0),
                3 => ( 0.33721360,    5.0 / 6.0),
                _ => ( 1.0,           1.0 / 6.0)
            },
            _    => i switch   // p == 5
            {
                1 => (-1.0,        0.10000000),
                2 => (-0.65465367, 0.54444444),
                3 => ( 0.0,        0.71111111),
                4 => ( 0.65465367, 0.54444444),
                _ => ( 1.0,        0.10000000)
            }
        };
    }

    // =========================================================================
    //  2-D (quadrilateral product) Gauss rule
    // =========================================================================

    /// <summary>
    /// Quadrilateral coordinates and weight for a product Gauss rule.
    /// </summary>
    public static (double xi, double eta, double weight) quad_gauss_q(int p1, int i1, int p2, int i2)
    {
        var (xi,  w1) = line_gauss_quad(p1, i1);
        var (eta, w2) = line_gauss_quad(p2, i2);
        return (xi, eta, w1 * w2);
    }

    // =========================================================================
    //  2-D beam element rotation / transformation matrices
    // =========================================================================

    /// <summary>
    /// 2-D rotation matrix R (3×3) and transformation matrix Trot (6×6)
    /// for a two-node Euler-Bernoulli beam-column element.
    /// </summary>
    public static (double[,] R, double[,] Trot) rotate_2d(double dx, double dy, double el)
    {
        var R    = new double[3, 3];
        var Trot = new double[6, 6];

        double c = dx / el, s = dy / el;
        R[0, 0] =  c;  R[0, 1] = s;
        R[1, 0] = -s;  R[1, 1] = c;
        R[2, 2] =  1.0;

        // Trot = block-diagonal [R, 0; 0, R]
        for (int ii = 0; ii < 3; ii++)
            for (int jj = 0; jj < 3; jj++)
            {
                Trot[ii,     jj    ] = R[ii, jj];
                Trot[ii + 3, jj + 3] = R[ii, jj];
            }
        return (R, Trot);
    }

    // =========================================================================
    //  3-D beam element rotation / transformation matrices
    // =========================================================================

    /// <summary>
    /// 3-D rotation matrix R (3×3) and transformation matrix Trot (12×12)
    /// for a two-node 3-D beam element.
    /// </summary>
    public static (double[,] R, double[,] Trot) rotate_3d(
        double dx, double dy, double dz, double el, double omega)
    {
        var R    = new double[3, 3];
        var Trot = new double[12, 12];

        double cx  = dx / el, cy = dy / el, cz = dz / el;
        double cxz = Math.Sqrt(cx * cx + cz * cz);

        if (cxz == 0.0)
        {
            // Element is vertical (along global Y axis)
            R[0, 1] =  cy;
            R[1, 0] = -cy;
            R[2, 2] =  1.0;
        }
        else
        {
            var Rb = new double[3, 3];
            var Rr = new double[3, 3];
            var Ra = new double[3, 3];

            Rb[0, 0] =  cx / cxz;  Rb[0, 2] = cz / cxz;
            Rb[1, 1] =  1.0;
            Rb[2, 0] = -cz / cxz;  Rb[2, 2] = cx / cxz;

            Rr[0, 0] = cxz;  Rr[0, 1] = cy;
            Rr[1, 0] = -cy;  Rr[1, 1] = cxz;
            Rr[2, 2] = 1.0;

            Ra[0, 0] = 1.0;
            Ra[1, 1] =  Math.Cos(omega);  Ra[1, 2] = Math.Sin(omega);
            Ra[2, 1] = -Math.Sin(omega);  Ra[2, 2] = Math.Cos(omega);

            R = Multiply3x3(Multiply3x3(Ra, Rr), Rb);
        }

        // Trot = block-diagonal 4×[R]
        for (int m = 0; m < 4; m++)
            for (int ii = 0; ii < 3; ii++)
                for (int jj = 0; jj < 3; jj++)
                    Trot[3 * m + ii, 3 * m + jj] = R[ii, jj];

        return (R, Trot);
    }

    private static double[,] Multiply3x3(double[,] A, double[,] B)
    {
        var C = new double[3, 3];
        for (int i = 0; i < 3; i++)
            for (int j = 0; j < 3; j++)
                C[i, j] = A[i, 0] * B[0, j] + A[i, 1] * B[1, j] + A[i, 2] * B[2, j];
        return C;
    }

    // =========================================================================
    //  Triangular Gauss quadrature  (1, ±3, or 7 points)
    // =========================================================================

    /// <summary>
    /// Triangular coordinates and weight for the <paramref name="i"/>-th point
    /// of a <paramref name="p"/>-point triangular Gauss rule.
    /// <para>
    /// <paramref name="p"/> = 1, ±3, or 7.
    /// Sign of p selects between two 3-point rules (p=-3 midpoint, p=+3 vertex-based).
    /// </para>
    /// </summary>
    public static (double z1, double z2, double z3, double weight) trig_gauss_q(int p, int i)
    {
        double[] z = new double[3];
        double w   = 0.0;
        int pp = Math.Abs(p);

        if (pp == 1)
        {
            z[0] = z[1] = z[2] = 1.0 / 3.0;
            w = 1.0;
        }
        else if (pp == 3)
        {
            if (p < 0)
            {
                z[0] = z[1] = z[2] = 0.5;
                z[i - 1] = 0.0;
                w = 1.0 / 3.0;
            }
            else
            {
                z[0] = z[1] = z[2] = 1.0 / 6.0;
                z[i - 1] = 2.0 / 3.0;
                w = 1.0 / 3.0;
            }
        }
        else if (pp == 7)
        {
            double sqrt15 = Math.Sqrt(15.0);
            if (i == 1)
            {
                z[0] = z[1] = z[2] = 1.0 / 3.0;
                w = 9.0 / 40.0;
            }
            else if (i <= 4)
            {
                z[0] = z[1] = z[2] = (6.0 - sqrt15) / 21.0;
                z[i - 2] = (9.0 + 2.0 * sqrt15) / 21.0;
                w = (155.0 - sqrt15) / 1200.0;
            }
            else
            {
                z[0] = z[1] = z[2] = (6.0 + sqrt15) / 21.0;
                z[i - 5] = (9.0 - 2.0 * sqrt15) / 21.0;
                w = 31.0 / 120.0 - (155.0 - sqrt15) / 1200.0;
            }
        }
        else
        {
            z[0] = z[1] = z[2] = 1.0 / 3.0;
            w = 1.0;
        }

        return (z[0], z[1], z[2], w);
    }
}
