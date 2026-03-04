// =============================================================================
//  FepsPostProcess.cs  –  Post-processing routines
//
//  Implements IPostProcess for the FepsEngine:
//    • OneDimBarForces   – bar member forces
//    • OneDimBeamForces  – beam member forces (2D & 3D)
//    • TwoDimStress      – averaged nodal stresses for 2D solid elements
//    • CreateVtkFile     – VTK output for ParaView visualisation
//
//  Ported from post_process.py  →  .NET 10
// =============================================================================

using System;
using System.IO;
using System.Linq;
using MathNet.Numerics.LinearAlgebra;
using MathNet.Numerics.LinearAlgebra.Double;
using static FESEC.G;
using static FESEC.FepsProgram;
using static FESEC.FepsUtils;

namespace FESEC;

public sealed class FepsPostProcess : IPostProcess
{
    // =========================================================================
    //  OneDimBarForces  –  bar element post-processing
    //    Compute local axial force for each bar element.
    //    Result stored in fmem_local[iele, 0] = axial force at end.
    // =========================================================================
    public double[,] OneDimBarForces(FepsDataDic d)
    {
        int lasele = glbal.LasEle;
        // Allocate or reuse fmem_local [lasele, 12]
        var fmem = d.fmem_local.GetLength(0) >= lasele && d.fmem_local.GetLength(1) >= 12
            ? d.fmem_local
            : new double[lasele, 12];

        for (int iele = 0; iele < lasele; iele++)
        {
            if (d.eledef[iele] == 0) continue;
            if (!d.eletyp.TryGetValue(iele, out string? typ)) continue;

            string tu = typ.ToUpperInvariant();
            if (!tu.StartsWith("BAR")) continue;

            int ni = d.elenod[0, iele] - 1;
            int nj = d.elenod[1, iele] - 1;

            int m = d.elemat[iele];
            int p = d.elepro[iele];
            double ea = d.matem[m - 1] * d.probar[p - 1];

            if (tu == "BAR2" || tu == "BAR3")
            {
                // 2D bar
                double x1 = d.nodxy[0, ni], y1 = d.nodxy[1, ni];
                double x2 = d.nodxy[0, nj], y2 = d.nodxy[1, nj];
                double dx = x2 - x1, dy = y2 - y1;
                double el = Math.Sqrt(dx * dx + dy * dy);
                if (el == 0) continue;

                var (R, _) = rotate_2d(dx, dy, el);
                // cos, sin
                double c = R[0, 0], s = R[0, 1];

                // Global displacements at nodes
                double u1 = d.noddis[0, ni], v1 = d.noddis[1, ni];
                double u2 = d.noddis[0, nj], v2 = d.noddis[1, nj];

                // Local displacement = rotation * global
                double uLocal1 = c * u1 + s * v1;
                double uLocal2 = c * u2 + s * v2;

                // Axial force = EA/L * (u2_local - u1_local)
                double axialForce = ea / el * (uLocal2 - uLocal1);

                // Include thermal effect
                double alpha = d.propAlpha[p - 1];
                double temp = d.eleload.GetLength(0) > 1 ? d.eleload[1, iele] : 0.0;
                axialForce -= ea * alpha * temp;

                fmem[iele, 0] = axialForce;
            }
            else if (tu == "BAR3D")
            {
                // 3D bar
                double x1 = d.nodxy[0, ni], y1 = d.nodxy[1, ni], z1 = d.nodxy[2, ni];
                double x2 = d.nodxy[0, nj], y2 = d.nodxy[1, nj], z2 = d.nodxy[2, nj];
                double dx = x2 - x1, dy = y2 - y1, dz = z2 - z1;
                double el = Math.Sqrt(dx * dx + dy * dy + dz * dz);
                if (el == 0) continue;

                double cx = dx / el, cy = dy / el, cz = dz / el;

                // Global displacements
                double u1 = d.noddis[0, ni], v1 = d.noddis[1, ni], w1 = d.noddis[2, ni];
                double u2 = d.noddis[0, nj], v2 = d.noddis[1, nj], w2 = d.noddis[2, nj];

                // Local axial displacements
                double uLocal1 = cx * u1 + cy * v1 + cz * w1;
                double uLocal2 = cx * u2 + cy * v2 + cz * w2;

                double axialForce = ea / el * (uLocal2 - uLocal1);

                // Thermal effect
                double alpha = d.propAlpha[p - 1];
                double temp = d.eleload.GetLength(0) > 1 ? d.eleload[1, iele] : 0.0;
                axialForce -= ea * alpha * temp;

                fmem[iele, 0] = axialForce;
            }
        }

        return fmem;
    }

    // =========================================================================
    //  OneDimBeamForces  –  beam element post-processing
    //    Compute local forces/moments for each beam element.
    //    2D:  fmem_local[iele, 0..5] = [N1, V1, M1, N2, V2, M2]
    //    3D:  fmem_local[iele, 0..11] = [Nx,Vy,Vz,Mx,My,Mz] × 2 nodes
    // =========================================================================
    public double[,] OneDimBeamForces(FepsDataDic d)
    {
        int lasele = glbal.LasEle;
        var fmem = d.fmem_local.GetLength(0) >= lasele && d.fmem_local.GetLength(1) >= 12
            ? d.fmem_local
            : new double[lasele, 12];

        for (int iele = 0; iele < lasele; iele++)
        {
            if (d.eledef[iele] == 0) continue;
            if (!d.eletyp.TryGetValue(iele, out string? typ)) continue;

            if (typ == "BEAM2D")
            {
                Beam2DForces(d, iele, fmem);
            }
            else if (typ == "BEAM3D")
            {
                Beam3DForces(d, iele, fmem);
            }
        }

        return fmem;
    }

    private void Beam2DForces(FepsDataDic d, int iele, double[,] fmem)
    {
        int ni = d.elenod[0, iele] - 1;
        int nj = d.elenod[1, iele] - 1;
        int m  = d.elemat[iele];
        int p  = d.elepro[iele];

        double x1 = d.nodxy[0, ni], y1 = d.nodxy[1, ni];
        double x2 = d.nodxy[0, nj], y2 = d.nodxy[1, nj];
        double dx = x2 - x1, dy = y2 - y1;
        double el = Math.Sqrt(dx * dx + dy * dy);
        if (el == 0) return;

        double ea = d.matem[m - 1] * d.probar[p - 1];
        double ei = d.matem[m - 1] * d.propIz[p - 1];
        double alpha = d.propAlpha[p - 1];

        // Build transformation matrix
        var (_, Trot) = rotate_2d(dx, dy, el);
        var TRotMat = DenseMatrix.OfArray(Trot);

        // Global nodal displacements → local
        var uGlobal = new DenseVector(6);
        for (int j = 0; j < glbal.DofNod; j++)
        {
            uGlobal[j] = d.noddis[j, ni];
            uGlobal[3 + j] = d.noddis[j, nj];
        }
        var uLocal = TRotMat * uGlobal;

        // Build local stiffness [6×6]
        var ks = DenseMatrix.OfArray(new double[,] { { ea, 0 }, { 0, ei } });
        Matrix<double> smLocal = new DenseMatrix(6, 6);
        int pg = 3;
        var elLib = new FepsElementLibrary();

        for (int i = 0; i < pg; i++)
        {
            var (xi, weight) = line_gauss_quad(pg, i + 1);
            var shapeTuple = Beam2DShape(xi, el);
            double w = shapeTuple.det * weight;

            var B = DenseMatrix.OfArray(new double[,] {
                { shapeTuple.sx[0], 0, 0, shapeTuple.sx[3], 0, 0 },
                { 0, shapeTuple.sx[1], shapeTuple.sx[2], 0, shapeTuple.sx[4], shapeTuple.sx[5] }
            });
            smLocal += w * (B.Transpose() * ks * B);
        }

        // Local force = K_local * u_local
        var fLocal = smLocal * uLocal;

        // Add fixed-end forces from element loads
        double wx = d.eleload[0, iele];
        double wy = d.eleload[1, iele];
        double temp = d.eleload.GetLength(0) > 2 ? d.eleload[2, iele] : 0.0;

        fLocal[0] -= (wx * el * 0.5 - ea * alpha * temp * 0.5);
        fLocal[1] -= (wy * el * 0.5);
        fLocal[2] -= (wy * el * el / 12.0);
        fLocal[3] -= (wx * el * 0.5 + ea * alpha * temp * 0.5);
        fLocal[4] -= (wy * el * 0.5);
        fLocal[5] -= (-wy * el * el / 12.0);

        for (int j = 0; j < 6; j++)
            fmem[iele, j] = fLocal[j];
    }

    private void Beam3DForces(FepsDataDic d, int iele, double[,] fmem)
    {
        int ni = d.elenod[0, iele] - 1;
        int nj = d.elenod[1, iele] - 1;
        int m  = d.elemat[iele];
        int p  = d.elepro[iele];

        double x1 = d.nodxy[0, ni], y1 = d.nodxy[1, ni], z1 = d.nodxy[2, ni];
        double x2 = d.nodxy[0, nj], y2 = d.nodxy[1, nj], z2 = d.nodxy[2, nj];
        double dx = x2 - x1, dy = y2 - y1, dz = z2 - z1;
        double el = Math.Sqrt(dx * dx + dy * dy + dz * dz);
        if (el == 0) return;

        double ea  = d.matem[m - 1] * d.probar[p - 1];
        double gm  = d.matem[m - 1] / (2.0 * (1.0 + d.matnu[m - 1]));
        double ej  = gm * d.propJ[p - 1];
        double eiy = d.matem[m - 1] * d.propIy[p - 1];
        double eiz = d.matem[m - 1] * d.propIz[p - 1];
        double omega = d.section_angle[iele];
        double alpha = d.propAlpha[p - 1];

        var (_, Trot) = rotate_3d(dx, dy, dz, el, omega);
        var TRotMat = DenseMatrix.OfArray(Trot);

        // Global nodal displacements → local
        var uGlobal = new DenseVector(12);
        for (int j = 0; j < glbal.DofNod; j++)
        {
            uGlobal[j] = d.noddis[j, ni];
            uGlobal[6 + j] = d.noddis[j, nj];
        }
        var uLocal = TRotMat * uGlobal;

        // Build local stiffness [12×12]
        var ks = new DenseMatrix(4, 4);
        ks[0, 0] = ea; ks[1, 1] = eiz; ks[2, 2] = eiy; ks[3, 3] = ej;

        Matrix<double> smLocal = new DenseMatrix(12, 12);
        int pg = 3;
        for (int i = 0; i < pg; i++)
        {
            var (xi, weight) = line_gauss_quad(pg, i + 1);
            var shapeTuple = Beam3DShape(xi, el);
            double w = shapeTuple.det * weight;

            var B = new DenseMatrix(4, 12);
            B[0, 0] = shapeTuple.sx[0]; B[0, 6] = shapeTuple.sx[3];
            B[1, 1] = shapeTuple.sx[1]; B[1, 5] = shapeTuple.sx[2];
            B[1, 7] = shapeTuple.sx[4]; B[1, 11] = shapeTuple.sx[5];
            B[2, 2] = shapeTuple.sx[1]; B[2, 4] = -shapeTuple.sx[2];
            B[2, 8] = shapeTuple.sx[4]; B[2, 10] = -shapeTuple.sx[5];
            B[3, 3] = shapeTuple.sx[0]; B[3, 9] = shapeTuple.sx[3];

            smLocal += w * (B.Transpose() * ks * B);
        }

        var fLocal = smLocal * uLocal;

        // Subtract fixed-end forces from element loads
        double wx = d.eleload[0, iele];
        double wy = d.eleload[1, iele];
        double wz = d.eleload.GetLength(0) > 2 ? d.eleload[2, iele] : 0.0;
        double temp = d.eleload.GetLength(0) > 3 ? d.eleload[3, iele] : 0.0;

        fLocal[0]  -= (wx * el * 0.5 - ea * alpha * temp);
        fLocal[1]  -= (wy * el * 0.5);
        fLocal[2]  -= (wz * el * 0.5);
        fLocal[4]  -= (wz * el * el / 12.0);
        fLocal[5]  -= (wy * el * el / 12.0);
        fLocal[6]  -= (wx * el * 0.5 + ea * alpha * temp);
        fLocal[7]  -= (wy * el * 0.5);
        fLocal[8]  -= (wz * el * 0.5);
        fLocal[10] -= (-wz * el * el / 12.0);
        fLocal[11] -= (-wy * el * el / 12.0);

        for (int j = 0; j < 12; j++)
            fmem[iele, j] = fLocal[j];
    }

    // ── Beam shape helpers (local coordinates only, no Jacobian from nodes) ──

    private (double[] s, double[] sx, double det) Beam2DShape(double xi, double el)
    {
        var s = new double[6];
        s[0] = 0.5 * (1 - xi);
        s[3] = 0.5 * (1 + xi);
        s[1] = 0.25 * Math.Pow(1 - xi, 2) * (2 + xi);
        s[2] = 0.125 * el * Math.Pow(1 - xi, 2) * (1 + xi);
        s[4] = 0.25 * Math.Pow(1 + xi, 2) * (2 - xi);
        s[5] = -0.125 * el * Math.Pow(1 + xi, 2) * (1 - xi);

        double det = el / 2.0;
        var sx = new double[6];
        sx[0] = -1.0 / el;
        sx[3] =  1.0 / el;
        sx[1] =  6.0 * xi / (el * el);
        sx[2] = (3.0 * xi - 1.0) / el;
        sx[4] = -6.0 * xi / (el * el);
        sx[5] = (3.0 * xi + 1.0) / el;

        return (s, sx, det);
    }

    private (double[] s, double[] sx, double det) Beam3DShape(double xi, double el)
    {
        // Same shape functions for the beam part
        var s = new double[6];
        s[0] = 0.5 * (1 - xi);
        s[3] = 0.5 * (1 + xi);
        s[1] = 0.25 * Math.Pow(1 - xi, 2) * (2 + xi);
        s[2] = 0.125 * el * Math.Pow(1 - xi, 2) * (1 + xi);
        s[4] = 0.25 * Math.Pow(1 + xi, 2) * (2 - xi);
        s[5] = -0.125 * el * Math.Pow(1 + xi, 2) * (1 - xi);

        double det = el / 2.0;
        var sx = new double[6];
        sx[0] = -1.0 / el;
        sx[3] =  1.0 / el;
        sx[1] =  6.0 * xi / (el * el);
        sx[2] = (3.0 * xi - 1.0) / el;
        sx[4] = -6.0 * xi / (el * el);
        sx[5] = (3.0 * xi + 1.0) / el;

        return (s, sx, det);
    }

    // =========================================================================
    //  TwoDimStress  –  compute averaged nodal stresses for 2D solid elements
    //
    //  For each element:
    //    1. Evaluate strain ε = B · u_e at each Gauss point
    //    2. Compute stress σ = C · ε
    //    3. Extrapolate to nodes (or use direct evaluation at nodes)
    //    4. Accumulate and average at shared nodes
    //
    //  nodsig[6, numnod]:
    //    [0] = σ_xx  [1] = σ_yy  [2] = τ_xy
    //    [3] = σ_max [4] = σ_min [5] = von Mises
    // =========================================================================
    public (double[,] nodsig, int[] nodcnt) TwoDimStress(FepsDataDic d, string escm)
    {
        int lasNod = glbal.LasNod;
        var nodsig = new double[6, lasNod];
        var nodcnt = new int[lasNod];

        for (int iele = 0; iele < glbal.LasEle; iele++)
        {
            if (d.eledef[iele] == 0) continue;
            if (!d.eletyp.TryGetValue(iele, out string? typ)) continue;

            string tu = typ.ToUpperInvariant();
            if (!tu.StartsWith("QUAD") && !tu.StartsWith("TRIG")) continue;

            int nelnod = el_node(typ);
            int m = d.elemat[iele];
            int p = d.elepro[iele];

            double[,] c = get_cmt(d.matem[m - 1], d.matnu[m - 1]);

            // Gather nodal coordinates and displacements
            var xn = new double[nelnod];
            var yn = new double[nelnod];
            var ue = new double[nelnod * 2]; // u1,v1,u2,v2,...

            int[] nodeIds = new int[nelnod];
            for (int i = 0; i < nelnod; i++)
            {
                int n = d.elenod[i, iele] - 1;
                nodeIds[i] = n;
                xn[i] = d.nodxy[0, n];
                yn[i] = d.nodxy[1, n];
                ue[i * 2]     = d.noddis[0, n];
                ue[i * 2 + 1] = d.noddis[1, n];
            }

            var uVec = DenseVector.OfArray(ue);
            var cMat = DenseMatrix.OfArray(c);

            if (escm.ToUpperInvariant() == "DIRECT")
            {
                // Evaluate stress directly at each node (natural coordinates)
                for (int inode = 0; inode < nelnod; inode++)
                {
                    // Get shape function derivatives at node position
                    double[] sx, sy;
                    GetShapeDerivativesAtNode(tu, nelnod, inode, xn, yn, out sx, out sy);

                    // Build B matrix
                    var B = new DenseMatrix(3, nelnod * 2);
                    for (int k = 0; k < nelnod; k++)
                    {
                        B[0, k * 2]     = sx[k];
                        B[1, k * 2 + 1] = sy[k];
                        B[2, k * 2]     = sy[k];
                        B[2, k * 2 + 1] = sx[k];
                    }

                    // stress = C * B * u
                    var strain = B * uVec;
                    var stress = cMat * strain;

                    double sxx = stress[0], syy = stress[1], txy = stress[2];

                    // Principal stresses and von Mises
                    double savg = (sxx + syy) / 2.0;
                    double sdif = (sxx - syy) / 2.0;
                    double rad = Math.Sqrt(sdif * sdif + txy * txy);
                    double smax = savg + rad;
                    double smin = savg - rad;
                    double vonMises = Math.Sqrt(smax * smax - smax * smin + smin * smin);

                    int n = nodeIds[inode];
                    nodsig[0, n] += sxx;
                    nodsig[1, n] += syy;
                    nodsig[2, n] += txy;
                    nodsig[3, n] += smax;
                    nodsig[4, n] += smin;
                    nodsig[5, n] += vonMises;
                    nodcnt[n]++;
                }
            }
            else
            {
                // Gauss-point stress evaluation with extrapolation
                // Use centroidal stress assigned to all element nodes
                ComputeGaussStress(tu, nelnod, xn, yn, ue, c, nodeIds, nodsig, nodcnt);
            }
        }

        // Average
        for (int n = 0; n < lasNod; n++)
        {
            if (nodcnt[n] > 0)
            {
                for (int j = 0; j < 6; j++)
                    nodsig[j, n] /= nodcnt[n];
            }
        }

        return (nodsig, nodcnt);
    }

    // ── Shape function derivatives at natural nodal coordinates ──────────────
    private void GetShapeDerivativesAtNode(string tu, int nelnod, int inode,
        double[] xn, double[] yn, out double[] sx, out double[] sy)
    {
        var elLib = new FepsElementLibrary();

        if (tu == "QUAD4")
        {
            // Natural coordinates of QUAD4 nodes
            double[,] natCoords = { {-1,-1}, {1,-1}, {1,1}, {-1,1} };
            double xi  = natCoords[inode, 0];
            double eta = natCoords[inode, 1];
            var result = InvokeQuad4Shape(xi, eta, xn, yn);
            sx = result.sx; sy = result.sy;
        }
        else if (tu == "QUAD8")
        {
            double[,] natCoords = { {-1,-1}, {1,-1}, {1,1}, {-1,1},
                                    {0,-1},  {1,0},  {0,1}, {-1,0} };
            double xi  = natCoords[inode, 0];
            double eta = natCoords[inode, 1];
            var result = InvokeQuad8Shape(xi, eta, xn, yn);
            sx = result.sx; sy = result.sy;
        }
        else if (tu == "QUAD9")
        {
            double[,] natCoords = { {-1,-1}, {1,-1}, {1,1}, {-1,1},
                                    {0,-1},  {1,0},  {0,1}, {-1,0}, {0,0} };
            double xi  = natCoords[inode, 0];
            double eta = natCoords[inode, 1];
            var result = InvokeQuad9Shape(xi, eta, xn, yn);
            sx = result.sx; sy = result.sy;
        }
        else if (tu == "TRIG3")
        {
            // For TRIG3, derivatives are constant (linear element)
            double[,] zetas = { {1,0,0}, {0,1,0}, {0,0,1} };
            double[] zeta = { zetas[inode, 0], zetas[inode, 1], zetas[inode, 2] };
            var result = InvokeTrig3Shape(zeta, xn, yn);
            sx = result.sx; sy = result.sy;
        }
        else
        {
            // Fallback: centroidal evaluation
            sx = new double[nelnod];
            sy = new double[nelnod];
        }
    }

    // ── Gauss-point stress (centroidal assignment for averaging) ─────────────
    private void ComputeGaussStress(string tu, int nelnod,
        double[] xn, double[] yn, double[] ue, double[,] c,
        int[] nodeIds, double[,] nodsig, int[] nodcnt)
    {
        var cMat = DenseMatrix.OfArray(c);
        var uVec = DenseVector.OfArray(ue);

        // Use 1 Gauss point at centroid for simplicity
        double[] sx, sy;
        if (tu == "QUAD4")
        {
            var result = InvokeQuad4Shape(0, 0, xn, yn);
            sx = result.sx; sy = result.sy;
        }
        else if (tu == "TRIG3")
        {
            var result = InvokeTrig3Shape(new double[]{1.0/3, 1.0/3, 1.0/3}, xn, yn);
            sx = result.sx; sy = result.sy;
        }
        else
        {
            sx = new double[nelnod]; sy = new double[nelnod];
        }

        var B = new DenseMatrix(3, nelnod * 2);
        for (int k = 0; k < nelnod; k++)
        {
            B[0, k * 2]     = sx[k];
            B[1, k * 2 + 1] = sy[k];
            B[2, k * 2]     = sy[k];
            B[2, k * 2 + 1] = sx[k];
        }

        var strain = B * uVec;
        var stress = cMat * strain;

        double sxx = stress[0], syy = stress[1], txy = stress[2];
        double savg = (sxx + syy) / 2.0;
        double sdif = (sxx - syy) / 2.0;
        double rad = Math.Sqrt(sdif * sdif + txy * txy);
        double smax = savg + rad;
        double smin = savg - rad;
        double vonMises = Math.Sqrt(smax * smax - smax * smin + smin * smin);

        // Assign centroidal stress to all element nodes
        for (int i = 0; i < nelnod; i++)
        {
            int n = nodeIds[i];
            nodsig[0, n] += sxx;
            nodsig[1, n] += syy;
            nodsig[2, n] += txy;
            nodsig[3, n] += smax;
            nodsig[4, n] += smin;
            nodsig[5, n] += vonMises;
            nodcnt[n]++;
        }
    }

    // ── Wrappers invoking FepsElementLibrary shape function methods ──────────
    // These use reflection-free approach: we directly compute the shape functions
    // using the same formulas as FepsElementLibrary.

    private (double[] s, double[] sx, double[] sy, double det) InvokeQuad4Shape(
        double xi, double eta, double[] x, double[] y)
    {
        var s = new double[] {
            0.25 * (1 - xi) * (1 - eta),
            0.25 * (1 + xi) * (1 - eta),
            0.25 * (1 + xi) * (1 + eta),
            0.25 * (1 - xi) * (1 + eta)
        };
        var s_xi = new double[] {
            -0.25 * (1 - eta), 0.25 * (1 - eta), 0.25 * (1 + eta), -0.25 * (1 + eta)
        };
        var s_eta = new double[] {
            -0.25 * (1 - xi), -0.25 * (1 + xi), 0.25 * (1 + xi), 0.25 * (1 - xi)
        };

        var J = new DenseMatrix(2, 2);
        for (int i = 0; i < 4; i++) {
            J[0,0] += s_xi[i]*x[i]; J[0,1] += s_xi[i]*y[i];
            J[1,0] += s_eta[i]*x[i]; J[1,1] += s_eta[i]*y[i];
        }
        double det = J.Determinant();
        var Jinv = J.Inverse();
        var sx = new double[4]; var sy = new double[4];
        for (int i = 0; i < 4; i++) {
            sx[i] = Jinv[0,0]*s_xi[i] + Jinv[0,1]*s_eta[i];
            sy[i] = Jinv[1,0]*s_xi[i] + Jinv[1,1]*s_eta[i];
        }
        return (s, sx, sy, det);
    }

    private (double[] s, double[] sx, double[] sy, double det) InvokeQuad8Shape(
        double xi, double eta, double[] x, double[] y)
    {
        var s = new double[8];
        s[0] = 0.25*(1-xi)*(1-eta)*(-xi-eta-1);
        s[1] = 0.25*(1+xi)*(1-eta)*(xi-eta-1);
        s[2] = 0.25*(1+xi)*(1+eta)*(xi+eta-1);
        s[3] = 0.25*(1-xi)*(1+eta)*(-xi+eta-1);
        s[4] = 0.5*(1-xi*xi)*(1-eta);
        s[5] = 0.5*(1+xi)*(1-eta*eta);
        s[6] = 0.5*(1-xi*xi)*(1+eta);
        s[7] = 0.5*(1-xi)*(1-eta*eta);

        var s_xi = new double[8];
        s_xi[0]=0.25*(1-eta)*(2*xi+eta); s_xi[1]=0.25*(1-eta)*(2*xi-eta);
        s_xi[2]=0.25*(1+eta)*(2*xi+eta); s_xi[3]=0.25*(1+eta)*(2*xi-eta);
        s_xi[4]=-xi*(1-eta); s_xi[5]=0.5*(1-eta*eta);
        s_xi[6]=-xi*(1+eta); s_xi[7]=-0.5*(1-eta*eta);

        var s_eta = new double[8];
        s_eta[0]=0.25*(1-xi)*(xi+2*eta); s_eta[1]=0.25*(1+xi)*(-xi+2*eta);
        s_eta[2]=0.25*(1+xi)*(xi+2*eta); s_eta[3]=0.25*(1-xi)*(-xi+2*eta);
        s_eta[4]=-0.5*(1-xi*xi); s_eta[5]=-eta*(1+xi);
        s_eta[6]=0.5*(1-xi*xi); s_eta[7]=-eta*(1-xi);

        var J = new DenseMatrix(2, 2);
        for(int i=0; i<8; i++) {
            J[0,0]+=s_xi[i]*x[i]; J[0,1]+=s_xi[i]*y[i];
            J[1,0]+=s_eta[i]*x[i]; J[1,1]+=s_eta[i]*y[i];
        }
        double det = J.Determinant();
        var Jinv = J.Inverse();
        var sx = new double[8]; var sy = new double[8];
        for(int i=0; i<8; i++) {
            sx[i]=Jinv[0,0]*s_xi[i]+Jinv[0,1]*s_eta[i];
            sy[i]=Jinv[1,0]*s_xi[i]+Jinv[1,1]*s_eta[i];
        }
        return (s, sx, sy, det);
    }

    private (double[] s, double[] sx, double[] sy, double det) InvokeQuad9Shape(
        double xi, double eta, double[] x, double[] y)
    {
        // Simplified: use Lagrangian products
        double[] xi_n = {-1, 1, 1, -1, 0, 1, 0, -1, 0};
        double[] eta_n = {-1, -1, 1, 1, -1, 0, 1, 0, 0};
        var s = new double[9]; var s_xi = new double[9]; var s_eta = new double[9];

        for (int i = 0; i < 9; i++) {
            double L_xi = 1.0, L_eta = 1.0, dL_xi = 0.0, dL_eta = 0.0;
            for (int j = 0; j < 9; j++) {
                if (i == j) continue;
                if (xi_n[i] != xi_n[j]) {
                    L_xi *= (xi - xi_n[j]) / (xi_n[i] - xi_n[j]);
                    double tmp = 1.0 / (xi_n[i] - xi_n[j]);
                    for (int k = 0; k < 9; k++)
                        if (k != i && k != j && xi_n[i] != xi_n[k])
                            tmp *= (xi - xi_n[k]) / (xi_n[i] - xi_n[k]);
                    dL_xi += tmp;
                }
                if (eta_n[i] != eta_n[j]) {
                    L_eta *= (eta - eta_n[j]) / (eta_n[i] - eta_n[j]);
                    double tmp = 1.0 / (eta_n[i] - eta_n[j]);
                    for (int k = 0; k < 9; k++)
                        if (k != i && k != j && eta_n[i] != eta_n[k])
                            tmp *= (eta - eta_n[k]) / (eta_n[i] - eta_n[k]);
                    dL_eta += tmp;
                }
            }
            s[i] = L_xi * L_eta;
            s_xi[i] = dL_xi * L_eta;
            s_eta[i] = L_xi * dL_eta;
        }

        var J = new DenseMatrix(2, 2);
        for(int i=0; i<9; i++) {
            J[0,0]+=s_xi[i]*x[i]; J[0,1]+=s_xi[i]*y[i];
            J[1,0]+=s_eta[i]*x[i]; J[1,1]+=s_eta[i]*y[i];
        }
        double det = J.Determinant();
        var Jinv = J.Inverse();
        var sx = new double[9]; var sy = new double[9];
        for(int i=0; i<9; i++) {
            sx[i]=Jinv[0,0]*s_xi[i]+Jinv[0,1]*s_eta[i];
            sy[i]=Jinv[1,0]*s_xi[i]+Jinv[1,1]*s_eta[i];
        }
        return (s, sx, sy, det);
    }

    private (double[] s, double[] sx, double[] sy, double det) InvokeTrig3Shape(
        double[] zeta, double[] x, double[] y)
    {
        var s = zeta;
        double det = (x[1]-x[0])*(y[2]-y[0]) - (x[2]-x[0])*(y[1]-y[0]);
        double cdet = 1.0 / det;
        var sx = new double[] { cdet*(y[1]-y[2]), cdet*(y[2]-y[0]), cdet*(y[0]-y[1]) };
        var sy = new double[] { cdet*(x[2]-x[1]), cdet*(x[0]-x[2]), cdet*(x[1]-x[0]) };
        return (s, sx, sy, det);
    }

    // =========================================================================
    //  CreateVtkFile  –  write VTK unstructured grid for ParaView
    // =========================================================================
    public void CreateVtkFile(FepsDataDic d)
    {
        string baseName = Path.GetFileNameWithoutExtension(glbal.FileName ?? "output");
        string dirPath  = Path.GetDirectoryName(glbal.FileName) ?? ".";
        string vtkFile  = Path.Combine(dirPath, baseName + ".vtu");

        using var w = new StreamWriter(vtkFile);

        int numPoints = glbal.LasNod;
        int numCells  = 0;
        for (int e = 0; e < glbal.LasEle; e++)
            if (d.eledef[e] != 0) numCells++;

        w.WriteLine("<VTKFile type=\"UnstructuredGrid\" version=\"1.0\" byte_order=\"LittleEndian\" header_type=\"UInt64\"> ");
        w.WriteLine("  <UnstructuredGrid> ");
        w.WriteLine("    <FieldData> ");
        w.WriteLine("      <DataArray type=\"Float64\" Name=\"TimeValue\" NumberOfTuples=\"1\" format=\"ascii\"> ");
        w.WriteLine("        1 ");
        w.WriteLine("      </DataArray> ");
        w.WriteLine("    </FieldData> ");
        w.WriteLine($" <Piece NumberOfPoints=\"{numPoints,4}\" NumberOfCells=\"{numCells,4}\">");

        // ── PointData ─────────────────────────────
        w.WriteLine("      <PointData Vectors=\"Nodal Vectors\">");

        // Displacements
        w.WriteLine("        <DataArray type=\"Float32\" Name=\"Displacement\" NumberOfComponents=\"3\" format=\"ascii\" >");
        for (int n = 0; n < numPoints; n++)
        {
            double ux = d.noddis[0, n];
            double uy = glbal.DofNod >= 2 ? d.noddis[1, n] : 0;
            double uz = glbal.Dim == 3 ? d.noddis[2, n] : 0;
            w.WriteLine($"            {ux,12:0.000e+00}   {uy,12:0.000e+00}  {uz,12:0.000e+00} ");
        }
        w.WriteLine("        </DataArray> ");

        // Forces
        w.WriteLine("        <DataArray type=\"Float32\" Name=\"Forces\" NumberOfComponents=\"3\" format=\"ascii\">");
        for (int n = 0; n < numPoints; n++)
        {
            double fx = d.nodfor[0, n];
            double fy = glbal.DofNod >= 2 ? d.nodfor[1, n] : 0;
            double fz = glbal.Dim == 3 ? d.nodfor[2, n] : 0;
            w.WriteLine($"            {fx,12:0.000e+00}   {fy,12:0.000e+00}  {fz,12:0.000e+00} ");
        }
        w.WriteLine("        </DataArray> ");

        // Stresses (if computed)
        if (d.nodsig.GetLength(0) >= 3 && d.nodsig.GetLength(1) >= numPoints)
        {
            w.WriteLine("        <DataArray type=\"Float32\" Name=\"Stress\" NumberOfComponents=\"3\" format=\"ascii\">");
            for (int n = 0; n < numPoints; n++)
                w.WriteLine($"            {d.nodsig[0,n],12:0.000e+00}   {d.nodsig[1,n],12:0.000e+00}   {d.nodsig[2,n],12:0.000e+00} ");
            w.WriteLine("        </DataArray> ");

            // Principal stresses
            if (d.nodsig.GetLength(0) >= 6)
            {
                w.WriteLine("        <DataArray type=\"Float32\" Name=\"Principal Stress\" NumberOfComponents=\"3\" format=\"ascii\">");
                for (int n = 0; n < numPoints; n++)
                    w.WriteLine($"            {d.nodsig[3,n],12:0.000e+00}  {d.nodsig[4,n],12:0.000e+00}  {d.nodsig[5,n],12:0.000e+00} ");
                w.WriteLine("        </DataArray> ");
            }
        }

        w.WriteLine("      </PointData> ");

        // ── Points ────────────────────────────────
        w.WriteLine("      <Points> ");
        w.WriteLine("        <DataArray type=\"Float32\" Name=\"Points\" NumberOfComponents=\"3\" format=\"ascii\"> ");
        for (int n = 0; n < numPoints; n++)
        {
            double px = d.nodxy[0, n];
            double py = glbal.Dim >= 2 ? d.nodxy[1, n] : 0;
            double pz = glbal.Dim == 3 ? d.nodxy[2, n] : 0;
            w.WriteLine($"            {px,12:0.000e+00}   {py,12:0.000e+00}  {pz,12:0.000e+00} ");
        }
        w.WriteLine("        </DataArray> ");
        w.WriteLine("      </Points> ");

        // ── Cells ─────────────────────────────────
        w.WriteLine("      <Cells> ");

        // Connectivity
        w.Write("        <DataArray type=\"Int64\" Name=\"connectivity\" format=\"ascii\"> ");
        for (int e = 0; e < glbal.LasEle; e++)
        {
            if (d.eledef[e] == 0) continue;
            if (!d.eletyp.TryGetValue(e, out string? typ)) continue;
            int nelnod = el_node(typ);
            w.Write("\n               ");
            for (int j = 0; j < nelnod; j++)
                w.Write($" {d.elenod[j, e] - 1,5}");
        }
        w.WriteLine("        </DataArray> ");

        // Offsets
        w.Write("        <DataArray type=\"Int64\" Name=\"offsets\" format=\"ascii\"> ");
        int offset = 0;
        w.Write("\n               ");
        for (int e = 0; e < glbal.LasEle; e++)
        {
            if (d.eledef[e] == 0) continue;
            if (!d.eletyp.TryGetValue(e, out string? typ)) continue;
            offset += el_node(typ);
            w.Write($"{offset,5}");
        }
        w.WriteLine();
        w.WriteLine("        </DataArray> ");

        // VTK cell types
        w.Write("        <DataArray type=\"UInt8\" Name=\"types\" format=\"ascii\"> ");
        w.Write("\n            ");
        for (int e = 0; e < glbal.LasEle; e++)
        {
            if (d.eledef[e] == 0) continue;
            if (!d.eletyp.TryGetValue(e, out string? typ)) continue;
            int vtkType = typ.ToUpperInvariant() switch
            {
                "BAR2"  or "BAR3D" => 3,   // VTK_LINE
                "BAR3"             => 21,  // VTK_QUADRATIC_EDGE
                "BEAM2D" or "BEAM3D" => 3, // VTK_LINE
                "TRIG3"            => 5,   // VTK_TRIANGLE
                "TRIG6"            => 22,  // VTK_QUADRATIC_TRIANGLE
                "QUAD4"            => 9,   // VTK_QUAD
                "QUAD8"            => 23,  // VTK_QUADRATIC_QUAD
                "QUAD9"            => 28,  // VTK_BIQUADRATIC_QUAD
                _                  => 7    // VTK_POLYGON
            };
            w.Write($"  {vtkType}");
        }
        w.WriteLine();
        w.WriteLine("        </DataArray> ");

        w.WriteLine("      </Cells> ");
        w.WriteLine("    </Piece> ");
        w.WriteLine("  </UnstructuredGrid> ");
        w.WriteLine("</VTKFile> ");

        Console.WriteLine($"VTK file written: {vtkFile}");
    }
}
