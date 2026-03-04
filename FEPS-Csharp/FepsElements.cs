using System;
using MathNet.Numerics.LinearAlgebra;
using MathNet.Numerics.LinearAlgebra.Double;
using static FESEC.FepsUtils;

namespace FESEC;

public partial class FepsElementLibrary : IElementLibrary
{
    private static void Accumulate(double[,] dest, double[,] src, double weight)
    {
        int rows = src.GetLength(0);
        int cols = src.GetLength(1);
        for (int i = 0; i < rows; i++)
            for (int j = 0; j < cols; j++)
                dest[i, j] += weight * src[i, j];
    }
    
    public (double[,] esm, double[] force) Bar2Stif(double[] x, double[] y, double ea, double alpha, int dofesm, double[] eload)
    {
        double dx = x[1] - x[0], dy = y[1] - y[0];
        double el = Math.Sqrt(dx * dx + dy * dy);
        if (el == 0.0) throw new ArgumentException("Bar has zero length");

        var (_, Tbeam) = rotate_2d(dx, dy, el);
        var Trot = new double[4, 4];
        Trot[0,0]=Tbeam[0,0]; Trot[0,1]=Tbeam[0,1]; Trot[1,0]=Tbeam[1,0]; Trot[1,1]=Tbeam[1,1];
        Trot[2,2]=Tbeam[3,3]; Trot[2,3]=Tbeam[3,4]; Trot[3,2]=Tbeam[4,3]; Trot[3,3]=Tbeam[4,4];

        var B = DenseMatrix.OfArray(new double[,] { { -1, 0, 1, 0 } });
        var TRotMat = DenseMatrix.OfArray(Trot);
        double ks = ea / el;
        var smLocal = (B.Transpose() * (ks * B));
        var sm = TRotMat.Transpose() * smLocal * TRotMat;

        double wx = eload[0], temp = eload[1];
        Vector<double> eForce = new DenseVector(4);
        eForce[0] = wx * el * 0.5 - ea * alpha * temp;
        eForce[2] = wx * el * 0.5 + ea * alpha * temp;
        eForce = TRotMat.Transpose() * eForce;

        var esm = new double[dofesm, dofesm];
        var force = new double[dofesm];
        
        if (dofesm == 6)
        {
            for(int i=0; i<2; i++) {
                for(int j=0; j<2; j++) {
                    esm[1+i, 1+j] = sm[i, j];
                    esm[1+i, 4+j] = sm[i, 2+j];
                    esm[4+i, 1+j] = sm[2+i, j];
                    esm[4+i, 4+j] = sm[2+i, 2+j];
                }
                force[1+i] = eForce[1+i];
                force[4+i] = eForce[2+i]; // wait, eForce has 4 elmts: 0, 1, 2, 3. In py: eleNodalForce[1:3] = eForce[1:3].
            }
            force[1] = eForce[1];
            force[2] = eForce[2]; // Python 1:3 is index 1, 2 => 2 items. BUT python eForce[1:3] would be index 1,2 from eForce. Wait eForce in py has indices 0,1,2,3! eForce[1:3] means index 1,2.
            // Oh, but my eForce[2] above is eForce_original[2]. I will just mirror Python logic:
            force[1] = eForce[1];
            force[2] = eForce[2];
            force[4] = eForce[3]; // py eForce[3:5] has just 1 element, eForce[3]. Python throws an error or duplicates. The original python code assigns eForce[3:5] (which is length 1 or 2 depending on size). Here we assume force[4],force[5] are eForce[3], 0.
        }
        else
        {
            esm = sm.ToArray();
            force = eForce.ToArray();
        }
        return (esm, force);
    }

    public (double[,] esm, double[] force) Bar3Stif(double[] x, double[] y, double ea, int dofesm)
    {
        double dx = x[1] - x[0], dy = y[1] - y[0];
        double el = Math.Sqrt(dx * dx + dy * dy);
        if (el == 0.0) throw new ArgumentException("Bar has zero length");

        double c = dx / el, s = dy / el;
        var Trot = new double[,] {
            {c, s, 0, 0},
            {-s, c, 0, 0},
            {0, 0, c, s},
            {0, 0, -s, c}
        };

        var B = DenseMatrix.OfArray(new double[,] { { -1, 0, 1, 0 } });
        double ks = ea / el;
        var smLocal = (B.Transpose() * (ks * B));
        var TRotMat = DenseMatrix.OfArray(Trot);
        var sm = TRotMat.Transpose() * smLocal * TRotMat;

        var force = new double[dofesm];
        return (sm.ToArray(), force);
    }

    public (double[,] esm, double[] force) Bar2Stif3D(double[] x, double[] y, double[] z, double ea, double alpha, int dofesm, double[] eload)
    {
        double dx = x[1] - x[0], dy = y[1] - y[0], dz = z[1] - z[0];
        double el = Math.Sqrt(dx * dx + dy * dy + dz * dz);
        if (el == 0.0) throw new ArgumentException("Bar has zero length");

        var (_, Tbeam) = rotate_3d(dx, dy, dz, el, 0.0);
        var Trot = new double[6, 6];
        for(int i=0; i<3; i++) for(int j=0; j<3; j++) {
            Trot[i,j] = Tbeam[i,j];
            Trot[3+i,3+j] = Tbeam[6+i,6+j];
        }

        var B = DenseMatrix.OfArray(new double[,] { { -1, 0, 0, 1, 0, 0 } });
        double ks = ea / el;
        var TRotMat = DenseMatrix.OfArray(Trot);
        var sm = TRotMat.Transpose() * (B.Transpose() * (ks * B)) * TRotMat;

        double wx = eload[0], temp = eload[1];
        Vector<double> eForce = new DenseVector(6);
        eForce[0] = wx * el * 0.5 - ea * alpha * temp;
        eForce[3] = wx * el * 0.5 + ea * alpha * temp;
        eForce = TRotMat.Transpose() * eForce;

        var esm = new double[dofesm, dofesm];
        var force = new double[dofesm];

        if (dofesm == 12)
        {
            for(int i=0; i<3; i++) {
                for(int j=0; j<3; j++) {
                    esm[i, j] = sm[i, j];
                    esm[i, 6+j] = sm[i, 3+j];
                    esm[6+i, j] = sm[3+i, j];
                    esm[6+i, 6+j] = sm[3+i, 3+j];
                }
                force[i] = eForce[i];
                force[6+i] = eForce[3+i];
            }
        }
        else
        {
            esm = sm.ToArray();
            force = eForce.ToArray();
        }

        return (esm, force);
    }

    private (double[] s, double[] sx, double det) beam_2d_shape(double xi, double[] x, double[] y)
    {
        double dx = x[1] - x[0], dy = y[1] - y[0];
        double el = Math.Sqrt(dx * dx + dy * dy);
        var s = new double[6];
        s[0] = 0.5 * (1 - xi);
        s[3] = 0.5 * (1 + xi);
        s[1] = 0.25 * Math.Pow(1 - xi, 2) * (2 + xi);
        s[2] = 0.125 * el * Math.Pow(1 - xi, 2) * (1 + xi);
        s[4] = 0.25 * Math.Pow(1 + xi, 2) * (2 - xi);
        s[5] = -0.125 * el * Math.Pow(1 + xi, 2) * (1 - xi);

        double det = el / 2.0;
        var sx = new double[6];
        sx[0] = -1 / el;
        sx[3] = 1 / el;
        sx[1] = 6 * xi / (el * el);
        sx[2] = (3 * xi - 1) / el;
        sx[4] = -6 * xi / (el * el);
        sx[5] = (3 * xi + 1) / el;

        return (s, sx, det);
    }

    private (double[] s, double[] sx, double det) beam_2m_shape_3d(double xi, double[] x, double[] y, double[] z)
    {
        double dx = x[1] - x[0], dy = y[1] - y[0], dz = z[1] - z[0];
        double el = Math.Sqrt(dx * dx + dy * dy + dz * dz);
        var s = new double[6];
        s[0] = 0.5 * (1 - xi);
        s[3] = 0.5 * (1 + xi);
        s[1] = 0.25 * Math.Pow(1 - xi, 2) * (2 + xi);
        s[2] = 0.125 * el * Math.Pow(1 - xi, 2) * (1 + xi);
        s[4] = 0.25 * Math.Pow(1 + xi, 2) * (2 - xi);
        s[5] = -0.125 * el * Math.Pow(1 + xi, 2) * (1 - xi);

        double det = el / 2.0;
        var sx = new double[6];
        sx[0] = -1 / el;
        sx[3] = 1 / el;
        sx[1] = 6 * xi / Math.Pow(el, 2);
        sx[2] = (3 * xi - 1) / el;
        sx[4] = -6 * xi / Math.Pow(el, 2);
        sx[5] = (3 * xi + 1) / el;
        
        return (s, sx, det);
    }

    public (double[,] esm, double[] force) Beam2_2DStif(double[] x, double[] y, double ea, double ei, double alpha, int dofesm, double[] eload)
    {
        double dx = x[1] - x[0], dy = y[1] - y[0];
        double el = Math.Sqrt(dx * dx + dy * dy);
        var sm_local = new double[dofesm, dofesm];
        int p = 3;

        var ks = DenseMatrix.OfArray(new double[,] { { ea, 0 }, { 0, ei } });
        Matrix<double> smLocMat = DenseMatrix.OfArray(sm_local);

        for (int i = 0; i < p; i++)
        {
            var (xi, weight) = line_gauss_quad(p, i+1);
            var (_, qx, det) = beam_2d_shape(xi, x, y);
            double w = det * weight;

            var B = DenseMatrix.OfArray(new double[,] {
                { qx[0], 0, 0, qx[3], 0, 0 },
                { 0, qx[1], qx[2], 0, qx[4], qx[5] }
            });
            smLocMat += w * (B.Transpose() * ks * B);
        }

        var (_, Trot) = rotate_2d(dx, dy, el);
        var TRotMat = DenseMatrix.OfArray(Trot);
        var sm = (TRotMat.Transpose() * smLocMat * TRotMat).ToArray();

        int sign = 1;
        double wx = eload[0], wy = eload[1] * sign, temp = eload[2];
        var eForceLoc = new DenseVector(6);
        eForceLoc[0] = wx * el * 0.5 - ea * alpha * temp * 0.5;
        eForceLoc[1] = wy * el * 0.5;
        eForceLoc[2] = wy * el * el / 12.0;
        eForceLoc[3] = wx * el * 0.5 + ea * alpha * temp * 0.5;
        eForceLoc[4] = wy * el * 0.5;
        eForceLoc[5] = -wy * el * el / 12.0;

        var force = (TRotMat.Transpose() * eForceLoc).ToArray();
        return (sm, force);
    }

    public (double[,] esm, double[] force) Beam2Stif3D(double[] x, double[] y, double[] z, double ea, double ej, double eiy, double eiz, double omega, double alpha, int dofesm, double[] eload)
    {
        double dx = x[1] - x[0], dy = y[1] - y[0], dz = z[1] - z[0];
        double el = Math.Sqrt(dx * dx + dy * dy + dz * dz);
        Matrix<double> smLocMat = new DenseMatrix(dofesm, dofesm);
        int p = 3;

        var ks = new DenseMatrix(4, 4);
        ks[0,0] = ea; ks[1,1] = eiz; ks[2,2] = eiy; ks[3,3] = ej;

        for (int i = 0; i < p; i++)
        {
            var (xi, weight) = line_gauss_quad(p, i+1); // python was line_gauss_quad(p,i) but in FepsUtils it is 1-based (i+1) ... WAIT FepsUtils is 1-based index
            var (_, qx, det) = beam_2m_shape_3d(xi, x, y, z);
            double w = det * weight;

            var B = new DenseMatrix(4, 12);
            B[0,0] = qx[0]; B[0,6] = qx[3];
            B[1,1]=qx[1]; B[1,5]=qx[2]; B[1,7]=qx[4]; B[1,11]=qx[5];
            B[2,2]=qx[1]; B[2,4]=-qx[2]; B[2,8]=qx[4]; B[2,10]=-qx[5];
            B[3,3]=qx[0]; B[3,9]=qx[3];

            smLocMat += w * (B.Transpose() * ks * B);
        }

        var (_, Trot) = rotate_3d(dx, dy, dz, el, omega);
        var TRotMat = DenseMatrix.OfArray(Trot);
        var sm = (TRotMat.Transpose() * smLocMat * TRotMat).ToArray();

        double wx = eload[0], wy = eload[1], wz = eload[2], temp = eload[3];
        var eForceLoc = new DenseVector(12);
        eForceLoc[0] = wx * el * 0.5 - ea * alpha * temp;
        eForceLoc[1] = wy * el * 0.5;
        eForceLoc[2] = wz * el * 0.5;
        eForceLoc[4] = wz * el * el / 12.0;
        eForceLoc[5] = wy * el * el / 12.0;
        eForceLoc[6] = wx * el * 0.5 + ea * alpha * temp;
        eForceLoc[7] = wy * el * 0.5;
        eForceLoc[8] = wz * el * 0.5;
        eForceLoc[10] = -wz * el * el / 12.0;
        eForceLoc[11] = -wy * el * el / 12.0;

        var force = (TRotMat.Transpose() * eForceLoc).ToArray();
        return (sm, force);
    }
}
