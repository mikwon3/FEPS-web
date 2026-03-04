using System;
using System.IO;
using FESEC;

class Program
{
    static void Main(string[] args)
    {
        if (args.Length < 1)
        {
            Console.WriteLine("Usage: FEPS-Csharp <input_file.inp>");
            return;
        }

        string inpFile = args[0];
        if (!File.Exists(inpFile))
        {
            Console.WriteLine($"Error: File not found: {inpFile}");
            return;
        }

        Console.WriteLine($"Reading {inpFile} ...");

        // Reset global state
        FepsGlobals.Instance.Reset();

        // Element library & post-processor
        IElementLibrary elLib    = new FepsElementLibrary();
        IPostProcess    postProc = new FepsPostProcess();

        // Run analysis
        var result = FepsEngine.run_analysis(inpFile, elLib, postProc);
        if (result == null)
        {
            Console.WriteLine("Analysis failed.");
            return;
        }

        Console.WriteLine("Analysis completed successfully.");

        // ── Pre-/Post-process rendering ──────────────────────────
        var prePro   = new FepsPreProcess();
        string dir   = Path.GetDirectoryName(inpFile) ?? ".";
        string baseName = Path.GetFileNameWithoutExtension(inpFile);

        // Pre-process image (undeformed mesh)
        var preOpts = new FepsRenderOptions
        {
            ShowDeformed    = false,
            ShowBC          = true,
            ShowLoads       = true,
            ShowNodeIDs     = true,
            ShowElementIDs  = true,
            ShowNodeSymbols = true,
        };
        string prePng = Path.Combine(dir, baseName + "_pre.png");
        prePro.SaveToPng(result, preOpts, prePng);
        Console.WriteLine($"Pre-process image : {prePng}");

        // Post-process image (deformed + stress)
        bool hasSolid = (FepsGlobals.Instance.NumQua + FepsGlobals.Instance.NumTri) > 0;
        var postOpts = new FepsRenderOptions
        {
            ShowDeformed      = true,
            ScaleFactor       = 100.0,
            ShowGhostShape    = true,
            ShowBC            = true,
            ShowLoads         = false,
            ShowNodeIDs       = false,
            ShowStressContour = hasSolid,
            StressComponent   = 5, // von Mises
        };
        string postPng = Path.Combine(dir, baseName + "_post.png");
        prePro.SaveToPng(result, postOpts, postPng);
        Console.WriteLine($"Post-process image: {postPng}");

        // Mesh quality check
        var issues = prePro.ValidateMesh(result);
        if (issues.Count > 0)
        {
            Console.WriteLine("Mesh quality issues:");
            foreach (var (idx, desc) in issues)
                Console.WriteLine($"  Element {idx}: {desc}");
        }
        else
        {
            Console.WriteLine("Mesh quality: OK");
        }
    }
}
