# FEPS — Software Design Document (SDD)

> **버전**: v0.1
> **개발자**: 권민호 (경상국립대학교 토목공학과) — kwonm@gnu.ac.kr
> **최종 수정**: 2026-03-03

**Specification-Driven Development (SDD)** roadmap for this
implementation in **C# / .NET 10**.

Purpose: 2D Finite element program (including 3D beam/truss elements)
         in Web app as well as desktop app (Avalonia UI)

## 1. Core Data Structures (Shared Library)

To ensure the solver, preprocessor, and post-processor all speak the
same language, define these core C# classes:

- **Node:** Holds $(x,y,z)$ coordinates, degrees of freedom, and result
  vectors $(u,v,w)$.

- **Element:** Base class with specialized overrides:

- **Truss/Beam:** Defined by 2 nodes + section properties
  ($A,I_{xx},I_{yy},I_{zz},J,E$).

- **Solid2D (T3, Q4):** Defined by 3, 6, 4, 5, 8, 9 nodes + material
  properties ($\nu,E,t$).

- **MeshModel:** A container for the Node and Element collections,
  including the global stiffness matrix.

## 2. Preprocessing & Interactive Verification (SkiaSharp)

Before solving, the user must visually confirm the input data.

- **Geometry View:** Render element edges. For 3D trusses, use a fixed
  isometric projection.

- **Boundary Condition (BC) Icons:** \* **Rollers/Pins/Fixed:** Small
  circles and circle-tangent line for Roller, and Small triangles for
  Pins at nodes. The tangent line of Roller is perpendicular to the
  support direction.

- **Rollers:** A circle with a line underneath.

- **Loads:** Arrows with length proportional to magnitude, scaled so
  they don't clutter the screen.

- **Property Mapping:** Use a "Color-by-Material" toggle to fill
  elements based on their $E$ or Section ID.

**ª Material & Property Edit-in-Place:**
Each item in the Materials and Section Properties lists has a ✎ (pencil)
button. Clicking it loads the item's values back into the input fields and
switches the "Add" button to "Update M{id}" / "Update P{id}" mode.
Clicking ✎ again (or deleting the item) cancels the edit. This allows
in-place correction of E, ν, ρ, A, t, Iz, etc. without rebuilding the
full model. Note: for 2D solid elements (QUAD4, TRIG3) the Area field `A`
is not used — only thickness `t` is applied.

**ª Input Features:\
Boundary Definition**: Allow users to upload a list of coordinates or
\"click-to-place\" nodes in the SkiaSharp view to define the polygon.

> **Global Seed/Density:** A slider to control the element size. As the
> user slides it, the mesh should visually update in real-time.
>
> **Refinement Points**: Allow users to click a specific area (like a
> corner where stress concentration is expected) to increase mesh
> density locally.
>
> **Mesh Generation**:

(1) **Triangle Generation** (Delaunay & Constrained)

For arbitrary polygons, Constrained Delaunay Triangulation (CDT) is the
standard.

**Recommended Library**: Triangle.NET. It is a C# port of Jonathan
Shewchuk\'s famous \"Triangle\" program. It is highly robust and handles
holes and concave polygons perfectly.

**Implementation**:\
1. Define your polygon boundary as a series of Vertex and Segment
objects.\
2. Set a maximum area constraint (to control mesh density).\
3. The library returns a list of nodes and connectivity (triangles).

(2) **Quadrilateral Generation** (Advancing Front or Q-Morph)

Generating \"all-quad\" meshes for arbitrary polygons is mathematically
more complex than triangles.

**The \"Easy\" Way (Tri-to-Quad):** Generate a triangle mesh first, then
merge adjacent triangles into quadrilaterals. Any remaining triangles
can be split into three quads by adding a centroid node.

**The \"Professional\" Way (Mapped Meshing)**: If the polygon has 4
clear sides (even if curved), you can use Transfinite Interpolation
(TFI). This produces a perfectly structured grid of quads.

**ª Visual Verification**

> **Before sending the data to the solver, use your SkiaSharp logic
> to**:
>
> Highlight Jacobian or Aspect Ratio issues. Color elements red if they
> are too distorted.
>
> Verify that the boundary segments match the intended geometry.

## 3. Interactive Post-Processing Module

This module converts FEA results into the visual insights you specified.

### A. Deformation & Scaling

- **Real-time Update:** The slider ($0.0 \rightarrow 1000.0$) **and
  companion number-input field** update the display coordinates in
  real-time. The number input accepts values beyond the slider max
  (up to 9999), allowing fine manual control.
- **Auto-Scale Lock:** On the *first* analysis of a model the renderer
  computes an automatic scale so the maximum displacement is ≈ 25 % of
  the model's characteristic length (bounding-box diagonal for 2D
  solids, average element length for 1D models). Subsequent re-analyses
  **keep this scale fixed** so that visual displacement changes are
  proportional to actual displacement changes (e.g. changing E halves
  displacements visually). `setModel()` resets the lock so a new
  geometry triggers a fresh auto-scale.
- **Toggle:** "Show Ghost Shape" (Draw the undeformed structure in a
  light grey dashed line).

### B. Contour Fills (2D Solids)

- **Hardware Interpolation:** Use `SKCanvas.DrawVertices`.

- **Components:** Switchable via dropdown:

- **Stress:** $\sigma_{xx},\sigma_{yy},\tau_{xy}$.

- **Strain:** $\epsilon_{xx},\epsilon_{yy},\gamma_{xy}$.

- **Color Bar:** A vertical legend showing the range from $Min$ (Blue)
  to $Max$ (Red).

### C. 1D Force Diagrams (Beams/Trusses)

- **Axial Force (Truss):** Color the truss members directly (e.g., Red
  for Tension, Blue for Compression).
- **BMD/SFD (Beam):** Draw a secondary path perpendicular to the beam
  axis to represent the moment/shear magnitude. (Cubic polynomial
  function should be used for smooth drawing in deformation plot and
  bending moment diagram in beam element.

## 4. UI Component Specification (Blazor & Avalonia)

To keep the code "Universal," the UI logic should be identical:

  ------------------------------------------------------------------------
  Feature                 Control Type            Logic
  ----------------------- ----------------------- ------------------------
  **Deformation Scale**   Slider (0–1000)         Updates a global
                          + Number Input          `double ScaleFactor` and
                          (0–9999)                triggers
                                                  `Canvas.Invalidate()`.
                                                  Slider and input are
                                                  bidirectionally synced.
                                                  Values > 1000 accepted
                                                  via the input field.

  **Diagram Scale**       Slider (1–500)          Updates `DiagScale` for
                          + Number Input          SFD/BMD/AFD diagram
                          (1–9999)                height. Bidirectional
                                                  sync same as above.

  **Labels**              Checkbox                Toggles a boolean
                                                  `ShowNodeIDs`.

  **Result Type**         Dropdown                Switches the data source
                                                  for the `DrawVertices`
                                                  color array.

  **Force Overlay**       Checkbox                Toggles the rendering of
                                                  $R$ (Reaction) and $F$
                                                  (Applied) vectors.
  ------------------------------------------------------------------------

## 5. Development Strategy

1.  **Phase 1 (The Engine):** Finalize your C# Solver as a standalone
    Library.
2.  **Phase 2 (The Shared Painter):** Build the `SkiaPainter` class that
    takes a `MeshModel` and `RenderOptions`.
3.  **Phase 3 (Web Front-end):** Set up the Blazor WebAssembly project
    to host the `SkiaPainter`.
4.  **Phase 4 (Mac Front-end):** Wrap the same `SkiaPainter` in an
    Avalonia window for your Mac Studio.

### Pro-Tip for your M4 Max:

When compiling for **Blazor**, ensure you enable **AOT (Ahead-of-Time)**
compilation in your `.csproj`. It significantly speeds up matrix
operations in the browser, making your FEA solver feel like a native
desktop application.

FE Core source is in "FEPS-Csharp" folder.
