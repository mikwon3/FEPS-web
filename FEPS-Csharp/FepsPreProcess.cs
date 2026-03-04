// =============================================================================
//  FepsPreProcess.cs  –  Pre-processing routines
//
//  Provides:
//    • SkiaSharp-based rendering of FE mesh geometry
//    • Boundary condition icons (pins, rollers, fixed)
//    • Nodal load arrows
//    • Element edge drawing & color-by-material
//    • Mesh quality check (aspect ratio / Jacobian)
//    • Deformation view with scale factor and ghost shape
//    • Node / element numbering overlays
//
//  All rendering operates on FepsDataDic + FepsGlobals so it integrates
//  directly with the existing solver pipeline.
// =============================================================================

using System;
using System.Collections.Generic;
using System.Linq;
using SkiaSharp;
using static FESEC.G;
using static FESEC.FepsProgram;

namespace FESEC;

// ─── Render options for the SkiaSharp view ──────────────────────────────────
public class FepsRenderOptions
{
    public double ScaleFactor  { get; set; } = 1.0;
    public bool   ShowGhostShape  { get; set; } = true;
    public bool   ShowNodeIDs     { get; set; } = false;
    public bool   ShowElementIDs  { get; set; } = false;
    public bool   ShowNodeSymbols { get; set; } = true;
    public bool   ShowLoads       { get; set; } = true;
    public bool   ShowBC          { get; set; } = true;
    public bool   ColorByMaterial { get; set; } = false;
    public bool   ShowStressContour { get; set; } = false;
    public int    StressComponent { get; set; } = 0; // 0=σxx, 1=σyy, 2=τxy, 3=σmax, 4=σmin, 5=Mises
    public bool   ShowDeformed    { get; set; } = true;
    public bool   CheckMeshQuality { get; set; } = false;
    public double QualityThreshold { get; set; } = 5.0; // max aspect ratio
}

// ─── Pre-processing and rendering class ─────────────────────────────────────
public class FepsPreProcess
{
    // ── Colour palette for materials ──────────────────────────────────────
    private static readonly SKColor[] MaterialColors = new SKColor[]
    {
        new SKColor(66,  133, 244),  // Blue
        new SKColor(234, 67,  53),   // Red
        new SKColor(251, 188, 4),    // Yellow
        new SKColor(52,  168, 83),   // Green
        new SKColor(171, 71,  188),  // Purple
        new SKColor(255, 112, 67),   // Orange
        new SKColor(0,   172, 193),  // Teal
        new SKColor(158, 157, 36),   // Lime
    };

    // =========================================================================
    //  DrawModel  –  main rendering entry point
    //
    //  Renders the FE model (pre-solve or post-solve) onto an SKCanvas.
    //  viewBounds defines the pixel rectangle available for drawing.
    // =========================================================================
    public void DrawModel(SKCanvas canvas, SKRect viewBounds, FepsDataDic d, FepsRenderOptions opts)
    {
        canvas.Clear(new SKColor(250, 250, 252)); // very light warm grey background

        if (glbal.LasNod == 0) return;

        // ── Compute model bounding box ──────────────────────────────
        double xMin = double.MaxValue, xMax = double.MinValue;
        double yMin = double.MaxValue, yMax = double.MinValue;

        for (int n = 0; n < glbal.LasNod; n++)
        {
            if (d.noddef[n] == 0) continue;
            double x = d.nodxy[0, n];
            double y = glbal.Dim >= 2 ? d.nodxy[1, n] : 0;
            if (x < xMin) xMin = x; if (x > xMax) xMax = x;
            if (y < yMin) yMin = y; if (y > yMax) yMax = y;

            // Also consider deformed shape if showing deformation
            if (opts.ShowDeformed && d.noddis.GetLength(1) > n)
            {
                double dx = x + d.noddis[0, n] * opts.ScaleFactor;
                double dy = y + (glbal.DofNod >= 2 ? d.noddis[1, n] * opts.ScaleFactor : 0);
                if (dx < xMin) xMin = dx; if (dx > xMax) xMax = dx;
                if (dy < yMin) yMin = dy; if (dy > yMax) yMax = dy;
            }
        }

        if (xMax <= xMin) { xMin -= 1; xMax += 1; }
        if (yMax <= yMin) { yMin -= 1; yMax += 1; }

        // ── Padding ─────────────────────────────────────────────────
        double padX = (xMax - xMin) * 0.15;
        double padY = (yMax - yMin) * 0.15;
        xMin -= padX; xMax += padX;
        yMin -= padY; yMax += padY;

        double modelW = xMax - xMin;
        double modelH = yMax - yMin;

        float scaleX = viewBounds.Width  / (float)modelW;
        float scaleY = viewBounds.Height / (float)modelH;
        float scale  = Math.Min(scaleX, scaleY);

        // ── Transform: model → screen  (y-axis inverted) ─────────
        float offsetX = viewBounds.Left + (viewBounds.Width  - (float)modelW * scale) * 0.5f;
        float offsetY = viewBounds.Top  + (viewBounds.Height + (float)modelH * scale) * 0.5f;

        SKPoint ModelToScreen(double mx, double my)
        {
            float sx = offsetX + (float)(mx - xMin) * scale;
            float sy = offsetY - (float)(my - yMin) * scale;
            return new SKPoint(sx, sy);
        }

        SKPoint NodeScreen(int n, bool deformed)
        {
            double x = d.nodxy[0, n];
            double y = glbal.Dim >= 2 ? d.nodxy[1, n] : 0;
            if (deformed && d.noddis.GetLength(1) > n)
            {
                x += d.noddis[0, n] * opts.ScaleFactor;
                y += (glbal.DofNod >= 2 ? d.noddis[1, n] * opts.ScaleFactor : 0);
            }
            return ModelToScreen(x, y);
        }

        // ── Pass 1: Ghost shape (undeformed) ────────────────────────
        if (opts.ShowGhostShape && opts.ShowDeformed)
        {
            using var ghostPaint = new SKPaint
            {
                Style = SKPaintStyle.Stroke,
                Color = new SKColor(200, 200, 210),
                StrokeWidth = 1f,
                IsAntialias = true,
                PathEffect = SKPathEffect.CreateDash(new float[] { 6, 4 }, 0)
            };
            DrawElements(canvas, d, ghostPaint, null, n => NodeScreen(n, false), opts, false);
        }

        // ── Pass 2: Current shape (deformed or undeformed) ──────────
        using var edgePaint = new SKPaint
        {
            Style = SKPaintStyle.Stroke,
            Color = new SKColor(50, 50, 60),
            StrokeWidth = 1.5f,
            IsAntialias = true,
            StrokeCap = SKStrokeCap.Round
        };
        using var fillPaint = new SKPaint
        {
            Style = SKPaintStyle.Fill,
            IsAntialias = true
        };

        bool showDeformed = opts.ShowDeformed;
        DrawElements(canvas, d, edgePaint, fillPaint, n => NodeScreen(n, showDeformed), opts, true);

        // ── Pass 3: Boundary conditions ─────────────────────────────
        if (opts.ShowBC)
            DrawBoundaryConditions(canvas, d, n => NodeScreen(n, showDeformed), scale);

        // ── Pass 4: Loads ───────────────────────────────────────────
        if (opts.ShowLoads)
            DrawLoads(canvas, d, n => NodeScreen(n, showDeformed), scale);

        // ── Pass 5: Node / element labels ───────────────────────────
        if (opts.ShowNodeIDs || opts.ShowElementIDs || opts.ShowNodeSymbols)
            DrawLabels(canvas, d, n => NodeScreen(n, showDeformed), scale, opts);

        // ── Pass 6: Mesh quality overlay ────────────────────────────
        if (opts.CheckMeshQuality)
            DrawMeshQuality(canvas, d, n => NodeScreen(n, false), opts);

        // ── Pass 7: Color bar for stress contours ────────────────────
        if (opts.ShowStressContour && d.nodsig.GetLength(1) >= glbal.LasNod)
            DrawColorBar(canvas, viewBounds, d, opts);
    }

    // =========================================================================
    //  DrawElements  –  render element edges (and optional fills)
    // =========================================================================
    private void DrawElements(SKCanvas canvas, FepsDataDic d,
        SKPaint edgePaint, SKPaint? fillPaint,
        Func<int, SKPoint> nodePos, FepsRenderOptions opts, bool applyFill)
    {
        for (int iele = 0; iele < glbal.LasEle; iele++)
        {
            if (d.eledef[iele] == 0) continue;
            if (!d.eletyp.TryGetValue(iele, out string? typ)) continue;

            int nelnod = el_node(typ);
            string tu = typ.ToUpperInvariant();

            // ── 1D elements (BAR / BEAM) ────────────────────────────
            if (tu.StartsWith("BAR") || tu.StartsWith("BEAM"))
            {
                int ni = d.elenod[0, iele] - 1;
                int nj = d.elenod[1, iele] - 1;
                SKPoint p1 = nodePos(ni);
                SKPoint p2 = nodePos(nj);

                // For bars: optionally color by axial force
                if (applyFill && d.fmem_local.GetLength(0) > iele && d.fmem_local.GetLength(1) > 0)
                {
                    double force = d.fmem_local[iele, 0];
                    if (Math.Abs(force) > 1e-12)
                    {
                        using var forcePaint = new SKPaint
                        {
                            Style = SKPaintStyle.Stroke,
                            Color = force > 0
                                ? new SKColor(220, 50, 50)    // Tension = Red
                                : new SKColor(50, 50, 220),   // Compression = Blue
                            StrokeWidth = 2.5f,
                            IsAntialias = true
                        };
                        canvas.DrawLine(p1, p2, forcePaint);
                        continue;
                    }
                }

                canvas.DrawLine(p1, p2, edgePaint);
            }
            // ── 2D elements (QUAD / TRIG) ───────────────────────────
            else if (tu.StartsWith("QUAD") || tu.StartsWith("TRIG"))
            {
                var pts = new SKPoint[nelnod];
                for (int j = 0; j < nelnod; j++)
                    pts[j] = nodePos(d.elenod[j, iele] - 1);

                // Edge path (use only corner nodes for higher-order elements)
                int corners = tu.StartsWith("TRIG") ? 3 : 4;
                var path = new SKPath();
                path.MoveTo(pts[0]);
                for (int j = 1; j < corners; j++)
                    path.LineTo(pts[j]);
                path.Close();

                // Fill
                if (applyFill && fillPaint != null)
                {
                    if (opts.ColorByMaterial)
                    {
                        int matIdx = d.elemat[iele] - 1;
                        fillPaint.Color = MaterialColors[matIdx % MaterialColors.Length].WithAlpha(80);
                        canvas.DrawPath(path, fillPaint);
                    }
                    else if (opts.ShowStressContour && d.nodsig.GetLength(1) >= glbal.LasNod)
                    {
                        // Simple per-element average stress colour
                        double avg = 0;
                        for (int j = 0; j < corners; j++)
                        {
                            int n = d.elenod[j, iele] - 1;
                            avg += d.nodsig[opts.StressComponent, n];
                        }
                        avg /= corners;
                        fillPaint.Color = StressToColor(avg, d, opts);
                        canvas.DrawPath(path, fillPaint);
                    }
                }

                canvas.DrawPath(path, edgePaint);
            }
        }
    }

    // =========================================================================
    //  DrawBoundaryConditions  –  BC icons at constrained nodes
    //
    //  SDD §2: Rollers, Pins, Fixed supports
    // =========================================================================
    private void DrawBoundaryConditions(SKCanvas canvas, FepsDataDic d,
        Func<int, SKPoint> nodePos, float scale)
    {
        float iconSize = Math.Max(8f, 18f); // fixed screen size

        using var pinPaint = new SKPaint
        {
            Style = SKPaintStyle.Fill,
            Color = new SKColor(46, 125, 50), // Green
            IsAntialias = true
        };
        using var pinStroke = new SKPaint
        {
            Style = SKPaintStyle.Stroke,
            Color = new SKColor(46, 125, 50),
            StrokeWidth = 1.5f,
            IsAntialias = true
        };
        using var rollerPaint = new SKPaint
        {
            Style = SKPaintStyle.Stroke,
            Color = new SKColor(30, 136, 229), // Blue
            StrokeWidth = 1.5f,
            IsAntialias = true
        };
        using var fixedPaint = new SKPaint
        {
            Style = SKPaintStyle.Stroke,
            Color = new SKColor(183, 28, 28), // Dark Red
            StrokeWidth = 2f,
            IsAntialias = true
        };

        for (int n = 0; n < glbal.LasNod; n++)
        {
            if (d.noddef[n] == 0) continue;
            bool hasBC = false;
            int constrainedCount = 0;
            bool[] constrained = new bool[glbal.DofNod];
            for (int j = 0; j < glbal.DofNod; j++)
            {
                if (d.nodbct[j, n] != 0)
                {
                    hasBC = true;
                    constrained[j] = true;
                    constrainedCount++;
                }
            }
            if (!hasBC) continue;

            SKPoint p = nodePos(n);

            if (constrainedCount == glbal.DofNod)
            {
                // ── Fixed support: filled rectangle + hatch lines ────
                float w = iconSize * 0.8f, h = iconSize * 0.6f;
                var rect = new SKRect(p.X - w / 2, p.Y, p.X + w / 2, p.Y + h);
                canvas.DrawRect(rect, fixedPaint);
                // Hatch lines
                for (float xx = rect.Left; xx <= rect.Right; xx += 4)
                    canvas.DrawLine(xx, rect.Top, xx - 3, rect.Bottom, fixedPaint);
            }
            else if (glbal.DofNod >= 2 && constrained[0] && constrained[1])
            {
                // ── Pin support: triangle ─────────────────────────────
                float triH = iconSize * 0.7f;
                float triW = iconSize * 0.6f;
                var triPath = new SKPath();
                triPath.MoveTo(p.X, p.Y);
                triPath.LineTo(p.X - triW / 2, p.Y + triH);
                triPath.LineTo(p.X + triW / 2, p.Y + triH);
                triPath.Close();
                canvas.DrawPath(triPath, pinStroke);
            }
            else if (constrained[0] && !constrained[1])
            {
                // ── Roller (x-constrained, y-free): circle + vertical line
                float r = iconSize * 0.22f;
                canvas.DrawCircle(p.X - r * 2, p.Y, r, rollerPaint);
                canvas.DrawLine(p.X - r * 3, p.Y - iconSize * 0.4f,
                                p.X - r * 3, p.Y + iconSize * 0.4f, rollerPaint);
            }
            else if (!constrained[0] && constrained[1])
            {
                // ── Roller (y-constrained, x-free): circle + horizontal line
                float r = iconSize * 0.22f;
                canvas.DrawCircle(p.X, p.Y + r * 2, r, rollerPaint);
                canvas.DrawLine(p.X - iconSize * 0.4f, p.Y + r * 3,
                                p.X + iconSize * 0.4f, p.Y + r * 3, rollerPaint);
            }
            else
            {
                // ── Generic constraint marker ─────────────────────────
                float r = iconSize * 0.2f;
                canvas.DrawCircle(p.X, p.Y, r, pinPaint);
            }
        }
    }

    // =========================================================================
    //  DrawLoads  –  force arrows at loaded nodes
    //
    //  SDD §2: Arrows with length proportional to magnitude
    // =========================================================================
    private void DrawLoads(SKCanvas canvas, FepsDataDic d,
        Func<int, SKPoint> nodePos, float scale)
    {
        // Find maximum load magnitude for scaling arrows
        double maxLoad = 0;
        for (int n = 0; n < glbal.LasNod; n++)
        {
            if (d.noddef[n] == 0) continue;
            for (int j = 0; j < glbal.DofNod; j++)
            {
                double f = Math.Abs(d.applied_force.GetLength(1) > n
                    ? d.applied_force[j, n] : 0);
                if (f > maxLoad) maxLoad = f;
            }
        }
        if (maxLoad < 1e-15) return;

        float arrowMaxLen = 50f; // pixels

        using var arrowPaint = new SKPaint
        {
            Style = SKPaintStyle.Stroke,
            Color = new SKColor(213, 0, 0), // Red
            StrokeWidth = 2f,
            IsAntialias = true,
            StrokeCap = SKStrokeCap.Round
        };
        using var arrowFill = new SKPaint
        {
            Style = SKPaintStyle.Fill,
            Color = new SKColor(213, 0, 0),
            IsAntialias = true
        };

        for (int n = 0; n < glbal.LasNod; n++)
        {
            if (d.noddef[n] == 0) continue;
            SKPoint p = nodePos(n);

            for (int j = 0; j < Math.Min(glbal.DofNod, glbal.Dim); j++)
            {
                double f = d.applied_force.GetLength(1) > n ? d.applied_force[j, n] : 0;
                if (Math.Abs(f) < 1e-15) continue;

                float len = (float)(Math.Abs(f) / maxLoad * arrowMaxLen);
                float sign = f > 0 ? 1f : -1f;

                float dx = 0, dy = 0;
                if (j == 0)      { dx = sign * len; }   // x-direction
                else if (j == 1) { dy = -sign * len; }  // y-direction (screen y is inverted)

                SKPoint tip = new SKPoint(p.X + dx, p.Y + dy);
                SKPoint tail = p;

                // Arrow line (from outside to the node point)
                SKPoint arrowStart = new SKPoint(p.X - dx, p.Y - dy);
                canvas.DrawLine(arrowStart, p, arrowPaint);

                // Arrow head
                float headLen = 5f;
                float angle = (float)Math.Atan2(dy, dx);
                var headPath = new SKPath();
                headPath.MoveTo(p);
                headPath.LineTo(p.X - headLen * (float)Math.Cos(angle - 0.4f),
                                p.Y - headLen * (float)Math.Sin(angle - 0.4f));
                headPath.LineTo(p.X - headLen * (float)Math.Cos(angle + 0.4f),
                                p.Y - headLen * (float)Math.Sin(angle + 0.4f));
                headPath.Close();
                canvas.DrawPath(headPath, arrowFill);
            }
        }
    }

    // =========================================================================
    //  DrawLabels  –  node IDs, element IDs, node symbols
    // =========================================================================
    private void DrawLabels(SKCanvas canvas, FepsDataDic d,
        Func<int, SKPoint> nodePos, float scale, FepsRenderOptions opts)
    {
        using var font = new SKFont { Size = 11f };
        using var textPaint = new SKPaint
        {
            Color = new SKColor(33, 33, 33),
            IsAntialias = true
        };
        using var nodeDotPaint = new SKPaint
        {
            Style = SKPaintStyle.Fill,
            Color = new SKColor(25, 118, 210),
            IsAntialias = true
        };

        // Node symbols and IDs
        for (int n = 0; n < glbal.LasNod; n++)
        {
            if (d.noddef[n] == 0) continue;
            SKPoint p = nodePos(n);

            if (opts.ShowNodeSymbols)
                canvas.DrawCircle(p.X, p.Y, 3f, nodeDotPaint);

            if (opts.ShowNodeIDs)
                canvas.DrawText($"{n + 1}", p.X + 6, p.Y - 6, SKTextAlign.Left, font, textPaint);
        }

        // Element IDs at centroid
        if (opts.ShowElementIDs)
        {
            using var elemFont = new SKFont { Size = 10f };
            using var elemPaint = new SKPaint
            {
                Color = new SKColor(120, 120, 130),
                IsAntialias = true
            };

            for (int iele = 0; iele < glbal.LasEle; iele++)
            {
                if (d.eledef[iele] == 0) continue;
                if (!d.eletyp.TryGetValue(iele, out string? typ)) continue;
                int nelnod = el_node(typ);

                float cx = 0, cy = 0;
                for (int j = 0; j < nelnod; j++)
                {
                    SKPoint p = nodePos(d.elenod[j, iele] - 1);
                    cx += p.X; cy += p.Y;
                }
                cx /= nelnod; cy /= nelnod;
                canvas.DrawText($"E{iele + 1}", cx, cy, SKTextAlign.Center, elemFont, elemPaint);
            }
        }
    }

    // =========================================================================
    //  DrawMeshQuality  –  highlight distorted elements
    //
    //  SDD §2: "Highlight Jacobian or Aspect Ratio issues.
    //           Color elements red if they are too distorted."
    // =========================================================================
    private void DrawMeshQuality(SKCanvas canvas, FepsDataDic d,
        Func<int, SKPoint> nodePos, FepsRenderOptions opts)
    {
        using var badPaint = new SKPaint
        {
            Style = SKPaintStyle.Fill,
            Color = new SKColor(244, 67, 54, 100), // semi-transparent red
            IsAntialias = true
        };

        for (int iele = 0; iele < glbal.LasEle; iele++)
        {
            if (d.eledef[iele] == 0) continue;
            if (!d.eletyp.TryGetValue(iele, out string? typ)) continue;
            string tu = typ.ToUpperInvariant();
            if (!tu.StartsWith("QUAD") && !tu.StartsWith("TRIG")) continue;

            int nelnod = el_node(typ);
            int corners = tu.StartsWith("TRIG") ? 3 : 4;

            // Compute aspect ratio from corner nodes
            double maxEdge = 0, minEdge = double.MaxValue;
            for (int j = 0; j < corners; j++)
            {
                int n1 = d.elenod[j, iele] - 1;
                int n2 = d.elenod[(j + 1) % corners, iele] - 1;
                double dx = d.nodxy[0, n2] - d.nodxy[0, n1];
                double dy = d.nodxy[1, n2] - d.nodxy[1, n1];
                double edgeLen = Math.Sqrt(dx * dx + dy * dy);
                if (edgeLen > maxEdge) maxEdge = edgeLen;
                if (edgeLen < minEdge) minEdge = edgeLen;
            }

            double aspectRatio = minEdge > 1e-15 ? maxEdge / minEdge : 999;
            if (aspectRatio > opts.QualityThreshold)
            {
                var path = new SKPath();
                for (int j = 0; j < corners; j++)
                {
                    SKPoint p = nodePos(d.elenod[j, iele] - 1);
                    if (j == 0) path.MoveTo(p); else path.LineTo(p);
                }
                path.Close();
                canvas.DrawPath(path, badPaint);
            }
        }
    }

    // =========================================================================
    //  DrawColorBar  –  stress legend
    //
    //  SDD §3B: "A vertical legend showing the range from Min (Blue)
    //            to Max (Red)."
    // =========================================================================
    private void DrawColorBar(SKCanvas canvas, SKRect viewBounds, FepsDataDic d,
        FepsRenderOptions opts)
    {
        // Find min/max for the chosen stress component
        int comp = opts.StressComponent;
        double sMin = double.MaxValue, sMax = double.MinValue;
        for (int n = 0; n < glbal.LasNod; n++)
        {
            if (d.noddef[n] == 0) continue;
            double val = d.nodsig[comp, n];
            if (val < sMin) sMin = val;
            if (val > sMax) sMax = val;
        }
        if (Math.Abs(sMax - sMin) < 1e-15) { sMin -= 1; sMax += 1; }

        // Draw the vertical color bar
        float barX = viewBounds.Right - 40;
        float barTop = viewBounds.Top + 30;
        float barH = viewBounds.Height * 0.6f;
        float barW = 16;

        int numBands = glbal.NumOfLegend > 0 ? glbal.NumOfLegend : 10;
        float bandH = barH / numBands;

        using var font = new SKFont { Size = 9f };
        using var textPaint = new SKPaint { Color = SKColors.Black, IsAntialias = true };

        for (int i = 0; i < numBands; i++)
        {
            float frac = 1f - (float)i / (numBands - 1);
            SKColor color = FractionToColor(frac);
            using var bandPaint = new SKPaint { Style = SKPaintStyle.Fill, Color = color };

            float y = barTop + i * bandH;
            canvas.DrawRect(new SKRect(barX, y, barX + barW, y + bandH), bandPaint);

            // Label
            double val = sMin + (sMax - sMin) * (1.0 - (double)i / (numBands - 1));
            canvas.DrawText($"{val:0.00e+00}", barX + barW + 4, y + bandH / 2 + 3,
                            SKTextAlign.Left, font, textPaint);
        }

        // Title
        string[] compNames = { "σxx", "σyy", "τxy", "σmax", "σmin", "Mises" };
        string title = comp >= 0 && comp < compNames.Length ? compNames[comp] : "Stress";
        canvas.DrawText(title, barX + barW / 2, barTop - 8, SKTextAlign.Center, font, textPaint);
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    private SKColor StressToColor(double val, FepsDataDic d, FepsRenderOptions opts)
    {
        int comp = opts.StressComponent;
        double sMin = double.MaxValue, sMax = double.MinValue;
        for (int n = 0; n < glbal.LasNod; n++)
        {
            if (d.noddef[n] == 0) continue;
            double v = d.nodsig[comp, n];
            if (v < sMin) sMin = v;
            if (v > sMax) sMax = v;
        }

        double range = sMax - sMin;
        if (range < 1e-15) range = 1.0;
        double frac = (val - sMin) / range;
        frac = Math.Max(0, Math.Min(1, frac));
        return FractionToColor((float)frac);
    }

    /// <summary>
    /// Maps a fraction [0..1] to a Blue → Cyan → Green → Yellow → Red colour ramp.
    /// </summary>
    private static SKColor FractionToColor(float frac)
    {
        frac = Math.Max(0f, Math.Min(1f, frac));
        byte r, g, b;

        if (frac < 0.25f)
        {
            float t = frac / 0.25f;
            r = 0; g = (byte)(255 * t); b = 255;
        }
        else if (frac < 0.5f)
        {
            float t = (frac - 0.25f) / 0.25f;
            r = 0; g = 255; b = (byte)(255 * (1 - t));
        }
        else if (frac < 0.75f)
        {
            float t = (frac - 0.5f) / 0.25f;
            r = (byte)(255 * t); g = 255; b = 0;
        }
        else
        {
            float t = (frac - 0.75f) / 0.25f;
            r = 255; g = (byte)(255 * (1 - t)); b = 0;
        }

        return new SKColor(r, g, b);
    }

    // =========================================================================
    //  ValidateMesh  –  mesh quality report (aspect ratio + Jacobian sign)
    //
    //  Returns a list of (element index, issue description) for elements
    //  that fail the quality checks.
    // =========================================================================
    public List<(int eleIdx, string issue)> ValidateMesh(FepsDataDic d)
    {
        var issues = new List<(int, string)>();

        for (int iele = 0; iele < glbal.LasEle; iele++)
        {
            if (d.eledef[iele] == 0) continue;
            if (!d.eletyp.TryGetValue(iele, out string? typ)) continue;
            string tu = typ.ToUpperInvariant();
            if (!tu.StartsWith("QUAD") && !tu.StartsWith("TRIG")) continue;

            int nelnod = el_node(typ);
            int corners = tu.StartsWith("TRIG") ? 3 : 4;

            // Aspect ratio check
            double maxEdge = 0, minEdge = double.MaxValue;
            for (int j = 0; j < corners; j++)
            {
                int n1 = d.elenod[j, iele] - 1;
                int n2 = d.elenod[(j + 1) % corners, iele] - 1;
                double dx = d.nodxy[0, n2] - d.nodxy[0, n1];
                double dy = d.nodxy[1, n2] - d.nodxy[1, n1];
                double edgeLen = Math.Sqrt(dx * dx + dy * dy);
                if (edgeLen > maxEdge) maxEdge = edgeLen;
                if (edgeLen < minEdge) minEdge = edgeLen;
            }

            double ar = minEdge > 1e-15 ? maxEdge / minEdge : 999;
            if (ar > 5.0)
                issues.Add((iele + 1, $"High aspect ratio: {ar:F2}"));

            // Jacobian sign check (for quads)
            if (tu.StartsWith("QUAD") && corners == 4)
            {
                double[] x = new double[4], y = new double[4];
                for (int j = 0; j < 4; j++)
                {
                    int n = d.elenod[j, iele] - 1;
                    x[j] = d.nodxy[0, n];
                    y[j] = d.nodxy[1, n];
                }

                // Check Jacobian at 4 corners
                double[,] natCoords = { {-1,-1}, {1,-1}, {1,1}, {-1,1} };
                for (int j = 0; j < 4; j++)
                {
                    double xi = natCoords[j, 0], eta = natCoords[j, 1];
                    double[] s_xi = {
                        -0.25*(1-eta), 0.25*(1-eta), 0.25*(1+eta), -0.25*(1+eta)
                    };
                    double[] s_eta = {
                        -0.25*(1-xi), -0.25*(1+xi), 0.25*(1+xi), 0.25*(1-xi)
                    };
                    double J11 = 0, J12 = 0, J21 = 0, J22 = 0;
                    for (int k = 0; k < 4; k++)
                    {
                        J11 += s_xi[k] * x[k]; J12 += s_xi[k] * y[k];
                        J21 += s_eta[k] * x[k]; J22 += s_eta[k] * y[k];
                    }
                    double det = J11 * J22 - J12 * J21;
                    if (det <= 0)
                    {
                        issues.Add((iele + 1, $"Negative/zero Jacobian at corner {j + 1}: det = {det:E3}"));
                        break;
                    }
                }
            }
        }

        return issues;
    }

    // =========================================================================
    //  RenderToImage  –  convenience method to render to a PNG bitmap
    // =========================================================================
    public SKBitmap RenderToImage(FepsDataDic d, FepsRenderOptions opts, int width = 1200, int height = 800)
    {
        var bitmap = new SKBitmap(width, height);
        using var canvas = new SKCanvas(bitmap);
        var bounds = new SKRect(0, 0, width, height);
        DrawModel(canvas, bounds, d, opts);
        return bitmap;
    }

    /// <summary>
    /// Saves the rendered model to a PNG file.
    /// </summary>
    public void SaveToPng(FepsDataDic d, FepsRenderOptions opts, string outputPath,
        int width = 1200, int height = 800)
    {
        using var bitmap = RenderToImage(d, opts, width, height);
        using var image = SKImage.FromBitmap(bitmap);
        using var data = image.Encode(SKEncodedImageFormat.Png, 95);
        using var stream = File.OpenWrite(outputPath);
        data.SaveTo(stream);
    }
}
