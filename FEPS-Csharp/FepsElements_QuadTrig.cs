using System;
using MathNet.Numerics.LinearAlgebra;
using MathNet.Numerics.LinearAlgebra.Double;
using static FESEC.FepsUtils;

namespace FESEC;

public partial class FepsElementLibrary
{
    private (double[] s, double[] sx, double[] sy, double det) quad_4m_shape(double xi, double eta, double[] x, double[] y)
    {
        var s = new double[] {
            0.25 * (1 - xi) * (1 - eta),
            0.25 * (1 + xi) * (1 - eta),
            0.25 * (1 + xi) * (1 + eta),
            0.25 * (1 - xi) * (1 + eta)
        };
        var s_xi = new double[] {
            -0.25 * (1 - eta), 0.25 * (1 - eta),  0.25 * (1 + eta), -0.25 * (1 + eta)
        };
        var s_eta = new double[] {
            -0.25 * (1 - xi), -0.25 * (1 + xi),   0.25 * (1 + xi),   0.25 * (1 - xi)
        };

        var J = new DenseMatrix(2, 2);
        for(int i=0; i<4; i++) {
            J[0,0] += s_xi[i] * x[i];
            J[0,1] += s_xi[i] * y[i];
            J[1,0] += s_eta[i] * x[i];
            J[1,1] += s_eta[i] * y[i];
        }

        double det = J.Determinant();
        var J_inv = J.Inverse();
        var sx = new double[4];
        var sy = new double[4];
        for (int i = 0; i < 4; i++)
        {
            sx[i] = J_inv[0, 0] * s_xi[i] + J_inv[0, 1] * s_eta[i];
            sy[i] = J_inv[1, 0] * s_xi[i] + J_inv[1, 1] * s_eta[i];
        }

        return (s, sx, sy, det);
    }

    private (double[] s, double[] sx, double[] sy, double det) quad_8m_shape(double xi, double eta, double[] x, double[] y)
    {
        var s = new double[8];
        s[0] = 0.25 * (1 - xi) * (1 - eta) * (-xi - eta - 1);
        s[1] = 0.25 * (1 + xi) * (1 - eta) * (xi - eta - 1);
        s[2] = 0.25 * (1 + xi) * (1 + eta) * (xi + eta - 1);
        s[3] = 0.25 * (1 - xi) * (1 + eta) * (-xi + eta - 1);
        s[4] = 0.5 * (1 - xi*xi) * (1 - eta);
        s[5] = 0.5 * (1 + xi) * (1 - eta*eta);
        s[6] = 0.5 * (1 - xi*xi) * (1 + eta);
        s[7] = 0.5 * (1 - xi) * (1 - eta*eta);

        var s_xi = new double[8];
        s_xi[0] = 0.25 * (1 - eta) * (2*xi + eta);
        s_xi[1] = 0.25 * (1 - eta) * (2*xi - eta);
        s_xi[2] = 0.25 * (1 + eta) * (2*xi + eta);
        s_xi[3] = 0.25 * (1 + eta) * (2*xi - eta);
        s_xi[4] = -xi * (1 - eta);
        s_xi[5] = 0.5 * (1 - eta*eta);
        s_xi[6] = -xi * (1 + eta);
        s_xi[7] = -0.5 * (1 - eta*eta);

        var s_eta = new double[8];
        s_eta[0] = 0.25 * (1 - xi) * (xi + 2*eta);
        s_eta[1] = 0.25 * (1 + xi) * (-xi + 2*eta);
        s_eta[2] = 0.25 * (1 + xi) * (xi + 2*eta);
        s_eta[3] = 0.25 * (1 - xi) * (-xi + 2*eta);
        s_eta[4] = -0.5 * (1 - xi*xi);
        s_eta[5] = -eta * (1 + xi);
        s_eta[6] = 0.5 * (1 - xi*xi);
        s_eta[7] = -eta * (1 - xi);

        var J = new DenseMatrix(2, 2);
        for(int i=0; i<8; i++) {
            J[0,0] += s_xi[i] * x[i]; J[0,1] += s_xi[i] * y[i];
            J[1,0] += s_eta[i] * x[i]; J[1,1] += s_eta[i] * y[i];
        }

        double det = J.Determinant();
        var J_inv = J.Inverse();
        var sx = new double[8]; var sy = new double[8];
        for (int i = 0; i < 8; i++) {
            sx[i] = J_inv[0, 0] * s_xi[i] + J_inv[0, 1] * s_eta[i];
            sy[i] = J_inv[1, 0] * s_xi[i] + J_inv[1, 1] * s_eta[i];
        }

        return (s, sx, sy, det);
    }

    private (double[] s, double[] sx, double[] sy, double det) quad_9m_shape(double xi, double eta, double[] x, double[] y)
    {
        double[] xi_nodes = {-1, 1, 1, -1, 0, 1, 0, -1, 0};
        double[] eta_nodes = {-1, -1, 1, 1, -1, 0, 1, 0, 0};
        var s = new double[9]; var s_xi = new double[9]; var s_eta = new double[9];

        for (int i = 0; i < 9; i++) {
            double L_xi = 1.0, L_eta = 1.0, dL_xi = 0.0, dL_eta = 0.0;
            for (int j = 0; j < 9; j++) {
                if (i == j) continue;
                if (xi_nodes[i] != xi_nodes[j]) {
                    L_xi *= (xi - xi_nodes[j]) / (xi_nodes[i] - xi_nodes[j]);
                    double temp_dL = 1.0 / (xi_nodes[i] - xi_nodes[j]);
                    for (int k = 0; k < 9; k++) {
                        if (k != i && k != j && xi_nodes[i] != xi_nodes[k])
                            temp_dL *= (xi - xi_nodes[k]) / (xi_nodes[i] - xi_nodes[k]);
                    }
                    dL_xi += temp_dL;
                }
                if (eta_nodes[i] != eta_nodes[j]) {
                    L_eta *= (eta - eta_nodes[j]) / (eta_nodes[i] - eta_nodes[j]);
                    double temp_dL = 1.0 / (eta_nodes[i] - eta_nodes[j]);
                    for (int k = 0; k < 9; k++) {
                        if (k != i && k != j && eta_nodes[i] != eta_nodes[k])
                            temp_dL *= (eta - eta_nodes[k]) / (eta_nodes[i] - eta_nodes[k]);
                    }
                    dL_eta += temp_dL;
                }
            }
            s[i] = L_xi * L_eta;
            s_xi[i] = dL_xi * L_eta;
            s_eta[i] = L_xi * dL_eta;
        }

        var J = new DenseMatrix(2, 2);
        for(int i=0; i<9; i++) {
            J[0,0] += s_xi[i] * x[i]; J[0,1] += s_xi[i] * y[i];
            J[1,0] += s_eta[i] * x[i]; J[1,1] += s_eta[i] * y[i];
        }

        double det = J.Determinant();
        var J_inv = J.Inverse();
        var sx = new double[9]; var sy = new double[9];
        for (int i = 0; i < 9; i++) {
            sx[i] = J_inv[0, 0] * s_xi[i] + J_inv[0, 1] * s_eta[i];
            sy[i] = J_inv[1, 0] * s_xi[i] + J_inv[1, 1] * s_eta[i];
        }

        return (s, sx, sy, det);
    }

    public (double[,] esm, double[] force) Quad4MStif(string opt, double[] x, double[] y, double[] h, double[,] c, int p, int dofesm)
    {
        Matrix<double> smLocMat = new DenseMatrix(dofesm, dofesm);
        var cMat = DenseMatrix.OfArray(c);

        for (int k = 0; k < p; k++) {
            for (int l = 0; l < p; l++) {
                var (xi, eta, weight) = quad_gauss_q(p, k+1, p, l+1);
                var (q_s, qx, qy, det) = quad_4m_shape(xi, eta, x, y);

                double thickness = 0;
                for(int i=0; i<4; ++i) thickness += h[i]*q_s[i];

                double w = weight * det * thickness;
                var B = new DenseMatrix(3, 8);
                for (int m = 0; m < 4; m++) {
                    B[0, m*2] = qx[m];
                    B[1, m*2 + 1] = qy[m];
                    B[2, m*2] = qy[m];
                    B[2, m*2 + 1] = qx[m];
                }
                smLocMat += w * (B.Transpose() * cMat * B);
            }
        }

        var force = new double[dofesm];
        return (smLocMat.ToArray(), force);
    }

    public (double[,] esm, double[] force) Quad8MStif(string opt, double[] x, double[] y, double[] h, double[,] c, int p, int dofesm)
    {
        Matrix<double> smLocMat = new DenseMatrix(dofesm, dofesm);
        var cMat = DenseMatrix.OfArray(c);

        // Quad8 usually integrates differently, or we use a 1D tensor product grid
        for (int k = 0; k < p; k++) {
            for (int l = 0; l < p; l++) {
                var (xi, eta, weight) = quad_gauss_q(p, k+1, p, l+1);
                var (q_s, qx, qy, det) = quad_8m_shape(xi, eta, x, y);

                double thickness = 0;
                for(int i=0; i<8; ++i) thickness += h[i]*q_s[i];

                double w = weight * det * thickness;
                var B = new DenseMatrix(3, 16);
                for (int m = 0; m < 8; m++) {
                    B[0, m*2] = qx[m];
                    B[1, m*2 + 1] = qy[m];
                    B[2, m*2] = qy[m];
                    B[2, m*2 + 1] = qx[m];
                }
                smLocMat += w * (B.Transpose() * cMat * B);
            }
        }
        var force = new double[dofesm];
        return (smLocMat.ToArray(), force);
    }

    public (double[,] esm, double[] force) Quad9MStif(string opt, double[] x, double[] y, double[] h, double[,] c, int p, int dofesm)
    {
        Matrix<double> smLocMat = new DenseMatrix(dofesm, dofesm);
        var cMat = DenseMatrix.OfArray(c);

        for (int k = 0; k < p; k++) {
            for (int l = 0; l < p; l++) {
                var (xi, eta, weight) = quad_gauss_q(p, k+1, p, l+1);
                var (q_s, qx, qy, det) = quad_9m_shape(xi, eta, x, y);

                double thickness = 0;
                for(int i=0; i<9; ++i) thickness += h[i]*q_s[i];

                double w = weight * det * thickness;
                var B = new DenseMatrix(3, 18);
                for (int m = 0; m < 9; m++) {
                    B[0, m*2] = qx[m];
                    B[1, m*2 + 1] = qy[m];
                    B[2, m*2] = qy[m];
                    B[2, m*2 + 1] = qx[m];
                }
                smLocMat += w * (B.Transpose() * cMat * B);
            }
        }
        var force = new double[dofesm];
        return (smLocMat.ToArray(), force);
    }

    private (double[] s, double[] sx, double[] sy, double det) trig_3_shape(double[] zeta, double[] x, double[] y)
    {
        var s = zeta;
        double det = (x[1] - x[0]) * (y[2] - y[0]) - (x[2] - x[0]) * (y[1] - y[0]);
        double cdet = 1.0 / det;
        var sx = new double[] { cdet * (y[1] - y[2]), cdet * (y[2] - y[0]), cdet * (y[0] - y[1]) };
        var sy = new double[] { cdet * (x[2] - x[1]), cdet * (x[0] - x[2]), cdet * (x[1] - x[0]) };
        return (s, sx, sy, det);
    }

    public (double[,] esm, double[] force) Trig3MStif(string opt, double[] x, double[] y, double[] h, double[,] c, int p, int dofesm)
    {
        Matrix<double> smLocMat = new DenseMatrix(dofesm, dofesm);
        var cMat = DenseMatrix.OfArray(c);
        var force = new double[dofesm];

        for (int k = 0; k < Math.Abs(p); k++)
        {
            var (zeta1, zeta2, zeta3, weight) = trig_gauss_q(p, k+1);
            var (q_s, qx, qy, det) = trig_3_shape(new double[]{zeta1, zeta2, zeta3}, x, y);

            double thickness = h[0]*q_s[0] + h[1]*q_s[1] + h[2]*q_s[2];
            double w = weight * (0.5 * det) * thickness;

            var B = new DenseMatrix(3, 6);
            for(int m=0; m<3; ++m) {
                B[0, m*2] = qx[m];
                B[1, m*2+1] = qy[m];
                B[2, m*2] = qy[m];
                B[2, m*2+1] = qx[m];
            }
            smLocMat += w * (B.Transpose() * cMat * B);
        }

        return (smLocMat.ToArray(), force);
    }
}
