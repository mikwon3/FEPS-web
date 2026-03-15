# FEPS — Finite Element Program for General Structure
## User Manual

> **Version**: v0.1 (Web Edition)
> **Last updated**: 2026-03-14 (SRI shear-locking cure, QUAD4/TRIG3 templates, TQMesh WASM mesh engine, mesh quality display)
> **Platform**: Modern web browsers (Chrome · Firefox · Safari · Edge)
> **Developer**: Minho Kwon, Dept. of Civil Engineering, Gyeongsang National University — kwonm@gnu.ac.kr

---

## Table of Contents

1. [Program Overview](#1-program-overview)
2. [Features and Supported Elements](#2-features-and-supported-elements)
3. [Screen Layout](#3-screen-layout)
4. [Input File Format (.inp)](#4-input-file-format-inp)
5. [Pre-Processing](#5-pre-processing)
6. [Running the Analysis](#6-running-the-analysis)
7. [Post-Processing](#7-post-processing)
8. [Output and Export](#8-output-and-export)
9. [Example Models](#9-example-models)
10. [Units and Notes](#10-units-and-notes)
11. [Element Code Editor (Student Element Development)](#11-element-code-editor-student-element-development)
12. [Debug Mode — Matrix and Force Viewer](#12-debug-mode--matrix-and-force-viewer)
13. [FepsElementCore API Reference](#13-fepselementcore-api-reference)

---

## 1. Program Overview

**FEPS** is a fully browser-based program for **2D plane finite element analysis (FEA) and 2D/3D beam/truss structural analysis**. No installation is required — simply open `index.html` in a browser or deploy to any web server.

### Technology Stack

| Component | Technology |
|-----------|-----------|
| UI / Rendering | Pure HTML5 + Canvas 2D API |
| Analysis engine | JavaScript (synchronous, main thread) |
| Dependencies | None (Vanilla JS) |
| I/O format | `.inp` plain-text file |

---

## 2. Features and Supported Elements

### 2.1 Supported Element Types

#### 1D Elements (Truss / Beam) — Built-in

| Element | Type | Dim | Description |
|---------|------|-----|-------------|
| `BAR2` | Truss | 2D | 2-node truss, axial force only |
| `BAR3D` | Truss | 3D | 2-node 3D truss |
| `BEAM2D` | Beam (Frame) | 2D | 2-node 2D beam (axial + shear + bending), distributed load supported |
| `BEAM3D` | Beam (Frame) | 3D | 2-node 3D beam (6 DOF/node), torsion included |

#### 2D Solid Elements — Built-in

| Element | Nodes | Description |
|---------|-------|-------------|
| `TRIG3` | 3 | 3-node linear triangle (CST) |
| `QUAD4` | 4 | 4-node bilinear quadrilateral |

#### Extended Elements (Student-developed / Plug-in)

These sample elements are auto-loaded at startup and can also be registered via the code editor.

| Element | Nodes | Type | Description |
|---------|-------|------|-------------|
| `QUAD5` | 5 | 2D solid | 5-node bubble-function-enhanced quadrilateral (with center node) |
| `QUAD8` | 8 | 2D solid | 8-node serendipity quadrilateral (quadratic) |
| `QUAD9` | 8★ | 2D solid | 9-node Lagrange quad → **operates as 8-node via static condensation** (center node auto-removed) |
| `TRIG6` | 6 | 2D solid | 6-node Lagrange triangle (quadratic) |
| `BAR2_3N` | 3 | 1D truss | 3-node 2D bar element (quadratic axial) |
| `TIMBEAM2D_2N` | 2 | 1D beam | 2-node Timoshenko beam (shear deformation included) |
| `TIMBEAM2D_3N` | 3 | 1D beam | 3-node Timoshenko beam (quadratic) |

> ★ **Static Condensation**: QUAD9 internally computes the full 9-node stiffness matrix, then condenses the center node (internal DOF) to behave as an 8-node element. The user only inputs 8 nodes in the `.inp` file; internal displacements are automatically recovered for stress computation. Controlled by the `condense` descriptor field (see §11.7).

### 2.2 Analysis Capabilities

- **Linear static analysis**
- **LU decomposition** direct solver (dense matrix)
- **Self-weight** auto-computation (`ρ × A × g`)
- **Distributed loads** (uniform and trapezoidal, `BEAM2D`/`BEAM3D`)
- **Thermal loads** (thermal expansion coefficient `α × ΔT`)
- **Nodal stress smoothing** (node averaging, 2D solid elements)

### 2.3 Pre-Processing

- Interactive canvas: click to create nodes and elements
- Grid snap (adjustable spacing and count)
- Automatic 2D mesh generation (**TQMesh** WASM engine — advancing-front tri/quad mixed mesh)
- Hole support in mesh generation
- Material and section property definition and per-element assignment
- Interactive boundary condition and nodal load input
- `.inp` file open / save

### 2.4 Post-Processing

- **Deformed shape** display (scale slider 0–1000 + direct input field 0–9999)
- **Ghost shape** (undeformed structure shown as dashed outline)
- **2D solid** stress contour color map (σ_xx, σ_yy, τ_xy, σ_max, σ_min, von Mises)
- **Beam/truss** section force diagrams (BMD, SFD, AFD, torsion)
- **Beam/truss color contour** — sxx = axial force, syy = bending moment displayed as gradient color on elements
- **Reaction force arrows** (Rx, Ry, Mz) canvas overlay
- Auto-displayed color legend (Color Bar)
- Nodal displacement result table (left panel)
- HTML comprehensive report output

---

## 3. Screen Layout

```
┌──────────────────────────── Toolbar ───────────────────────────────────────┐
│  FEPS  [New] [Open] [Save As] [Export] | [▶ Run Analysis] [Output] [Report]│
│        [↩ Undo] | [Zoom Win] [Zoom All] | [🗑 Delete]                       │
└─────────────────────────────────────────────────────────────────────────────┘
┌─── Tabs ──────┐
│ Pre-Process │ Post-Process │
├─────────────┴──────────────────────────────────────────────────────────────┐
│  Left Panel               │          Canvas                                 │
│  (Pre / Post panels)      │  (nodes · elements · BC · loads · deform ·     │
│  ─ Material definition    │   diagrams rendered here)                       │
│  ─ Section properties     │                               [Color Legend]    │
│  ─ Gravity setting        │                                                 │
│  ─ Element creation       │                                                 │
│  ─ Selection & assignment │                                                 │
│  ─ Boundary conditions    │                                                 │
│  ─ Nodal loads            │                                                 │
│  ─ Display options        │                                                 │
└───────────────────────────┴─────────────────────────────────────────────────┘
```

### 3.1 Toolbar Buttons

| Button | Function |
|--------|----------|
| **New** | Reset model |
| **Open** | Load a `.inp` file |
| **Save As** | Save current model as a `.inp` file |
| **Export** | Export to external format (VTK, etc.) |
| **▶ Run Analysis** | Execute FE analysis |
| **Output** | Open text result window |
| **Report** | Generate HTML comprehensive report |
| **↩ Undo** | Undo last node/element operation |
| **Zoom Win** | Drag-to-zoom a region |
| **Zoom All** | Fit entire model to view |
| **🗑 Delete** | Delete selected nodes/elements/lines |
| **Element Editor** | Open built-in code editor (write, register, manage custom elements) |
| **Debug** | Toggle debug mode ON/OFF — auto-opens matrix/force viewer after analysis |
| **View Matrix** | Manually open the debug viewer (available after any analysis) |
| **Help** | Open help window — switch between 한국어 / English using the buttons at the top (language preference saved in browser) |

### 3.2 Canvas Mouse Controls

| Action | Result |
|--------|--------|
| Scroll wheel | Zoom in/out |
| Right-click drag | Pan |
| Left-click (Draw mode) | Place node or specify element endpoint |
| Left-click drag (Select mode) | Multi-select |

---

## 4. Input File Format (.inp)

FEPS uses a plain-text input file format. Files can be written in any text editor or saved from the program using **Save As**.

> **Comment support**: Lines starting with `#` are treated as comments and ignored. Blank lines are also skipped automatically.
> ```
> # This is a comment
> 10 2 2      ← actual data starts here
> ```

### 4.1 Overall Structure

```
<header line>
<node definitions>
<material definitions>
<section property definitions>
<element definitions>
<boundary conditions and loads>
[<distributed loads (ESURF)>]
```

### 4.2 Header Line

```
numNod  dofNod  dim  [gx  gy  gz]
```

| Field | Description |
|-------|-------------|
| `numNod` | Total number of nodes |
| `dofNod` | DOFs per node (2D truss=2, 2D beam=3, 3D=6) |
| `dim` | Spatial dimension (2 or 3) |
| `gx gy gz` | (Optional) gravity acceleration vector (e.g. `0 -9.81 0`) |

**Example:**
```
5  3  2          ← 5 nodes, 3 DOF (2D beam), 2D
5  3  2  0  -9.81  0    ← with gravity
```

### 4.3 Node Definitions

```
id  x  y  [z]
```

**Example:**
```
1   0.0   0.0
2   3.0   0.0
3   3.0   4.0
```

### 4.4 Material Definitions

```
numMat
id  E  nu  [rho]
```

| Field | Description |
|-------|-------------|
| `E` | Young's modulus |
| `nu` | Poisson's ratio |
| `rho` | (Optional) mass density |

**Example:**
```
1
1  200e9  0.3  7850
```

### 4.5 Section Property Definitions

```
numProp
id  A  t  [Iz  Iy  J  alpha]
```

| Field | Description |
|-------|-------------|
| `A` | Cross-sectional area |
| `t` | Thickness (2D solid elements) |
| `Iz` | Second moment of area about z-axis |
| `Iy` | Second moment of area about y-axis (3D beam) |
| `J` | Torsional constant (3D beam) |
| `alpha` | Thermal expansion coefficient |

**Example:**
```
1
1  4740e-6  1.0  22e-6  0.0  0.0  0.0
```

### 4.6 Element Definitions

```
numElem
TYPE  id  matId  propId  n1  n2  [n3 ...]  [ΔT  wy1  wy2]
```

#### BAR2 / BAR3D (Truss)

```
BAR2   1  1  1  1  3   0  0
```
`n1 n2 ΔT axialLoad` (axialLoad currently unused)

#### BEAM2D (2D Beam)

```
BEAM2D  2  1  1  3  2   0  25  0
```
`n1 n2 ΔT wy1 wy2`
- `wy1`, `wy2`: distributed load at element start/end (force/length, y-direction, + = upward)

#### BEAM3D (3D Beam)

```
BEAM3D  1  1  1  1  2   0  0  0  0  0
```
`n1 n2 ΔT wy1 wy2 wz1 wz2`

#### TRIG3 / QUAD4 (2D Solid)

```
QUAD4  1  1  1  1  2  3  4
TRIG3  1  1  1  1  2  3
```

#### Extended Elements (QUAD5, QUAD8, QUAD9, TRIG6)

Extended elements use the same format; the number of nodes is determined by element type.

```
QUAD5  1  1  1  1  3  4  2  11      0  0  0
```
`n1 n2 n3 n4 n5` — 5 nodes (4 corners + 1 center)

```
QUAD8  1  1  1  1  3  4  2  5  6  7  8      0  0  0
```
`n1~n8` — 8 nodes (4 corners + 4 mid-side)

```
QUAD9  1  1  1  1  3  4  2  11 12 13 14    0  0  0
```
`n1~n8` — 8 nodes (4 corners + 4 mid-side). **QUAD9 operates as 8-node via static condensation**; the center node is not specified.

```
TRIG6  1  1  1  1  2  3  4  5  6     0  0  0
```
`n1~n6` — 6 nodes (3 corner + 3 mid-side)

> **Note**: Node ordering is counter-clockwise (CCW). Quadrilateral corner ordering corresponds to local coordinates (−1,−1)→(+1,−1)→(+1,+1)→(−1,+1).

### 4.7 Boundary Conditions and Loads

```
numBC
nid  [constraint flags...]  [load values...]
```

**2D beam (dofNod=3): Dx Dy Rz | Fx Fy Mz**
```
1   1  1  1   0.0   0.0   0.0      ← Node 1: fixed support (Dx=Dy=Rz constrained)
3   0  0  0  40.0 -80.0   0.0      ← Node 3: Fx=40, Fy=-80 applied
```

**3D beam (dofNod=6): Dx Dy Dz Rx Ry Rz | Fx Fy Fz Mx My Mz**
```
1   1 1 1 0 0 0   0. 0. 0. 0. 0. 0.
```

> **Constraint flag**: `1` = displacement constrained, `0` = free

### 4.8 Distributed Loads (ESURF Section, Optional)

Appended after the boundary condition block.

```
numESURF
eid  wy1  wy2              ← BEAM2D/BAR2
eid  wy1  wy2  wz1  wz2    ← BEAM3D
eid  side  qx1  qy1  qx2  qy2   ← 2D solid (surface traction)
```

---

## 5. Pre-Processing

### 5.1 Material Definition

1. In the **Materials** section of the left panel, enter `E`, `ν`, `ρ`
2. Click **Add Material** → material added to the list
3. Multiple materials can be added sequentially

#### Editing Materials (Edit-in-Place)

To modify a material already in the list:

1. Click the **✎ (pencil)** button to the right of the entry
   - The entry is highlighted in **blue**, and the button text changes to **`Update M1`**
   - Current values (E, ν, ρ) are automatically loaded into the input fields
2. Edit the values, then click **Update M1** → material updated in-place
3. Clicking ✎ again **cancels editing** (returns to Add Material mode)

> **Important**: After editing a material, **▶ Run Analysis** must be re-run for the new E/ν values to take effect in the results.

### 5.2 Section Property Definition

1. In the **Section Properties** section, enter `A`, `t`, `Iz`, `Iy`, `J`, `α`
2. Click **Add Property** → section added to the list

#### Editing Sections (Edit-in-Place)

Same as material editing: **✎ button** → edit values → click **Update P{id}**.

> **Note for 2D solid elements (QUAD4, TRIG3)**: These elements do not use cross-sectional area `A`; only thickness `t` applies. A tooltip on the `A` field also confirms this.

> **Tip**: 2D solid elements only need `t` (thickness). Beams/trusses require `A` and `Iz`.

### 5.3 Gravity Setting

- Enter `gx`, `gy`, `gz` in the **Gravity** section
- Gravity direction is in model coordinates: if downward is `-y`, set `gy = -9.81`
- Self-weight computation requires material density `ρ`

### 5.4 Element Creation

#### 1D Elements (Beam/Truss) — Interactive Drawing

1. Select `BAR2` / `BEAM2D` / `BAR3D` / `BEAM3D` from the **Type** dropdown
2. Select **Mat** and **Prop**
3. **Uncheck Close Path** (polyline mode)
4. Click **▶ Start Draw**
5. Click node positions on the canvas in order (nodes and elements created automatically)
6. Click **■ End Draw** to finish

> **Snap to Grid**: Enables snap for improved input precision. Spacing and Count are adjustable.

#### 2D Solid Elements — Polygon Mesh Generation

FEPS uses the **TQMesh** library (Florian Sewn, MIT License), compiled to WebAssembly (WASM), as its 2D mesh generation engine. TQMesh is based on an advancing-front algorithm and generates mixed triangular/quadrilateral meshes, supporting complex 2D domains including holes.

> **TQMesh**: <https://github.com/FloSewn/TQMesh>

1. Select `TRIG3` / `TRIG6` / `QUAD4` / `QUAD8` from the **Type** dropdown
2. **Check Close Path** (closed polygon mode)
3. Click **▶ Start Draw** → click polygon vertices in order
4. Click **■ End Draw** to close the polygon
5. Set **Edge Length** (target element size) and **Smooth** (Laplacian smoothing iterations)
6. Click **Mesh Polygon** → TQMesh WASM engine generates the mesh automatically
7. (Optional) Click **+ Add Hole** to define an interior hole, then re-run **Mesh Polygon**

> **Mesh quality display**: Triangular leftover elements are highlighted in **orange**; quads with an interior angle ≥ 150° are highlighted in **red**.

#### Node-Only Creation

- Click **✚ Create Node**, then click on the canvas

#### Undo

- Use **↩ Undo** in the toolbar to delete the last node/element

### 5.5 Selection and Assignment

1. Click **🔲 Select Elem** or **⊙ Select Nodes**
2. Click or drag on the canvas to select objects
3. **Assign Mat/Prop** — reassign material/section to selected elements
4. **Assign BC/Load** — assign boundary conditions/loads to selected nodes

### 5.6 Boundary Conditions and Nodal Loads

Select nodes, then click **Assign BC/Load** to open the dialog.

- **Constraints (BC)**: check constraint checkboxes for each DOF
- **Loads**: enter load values for each DOF
- After setting, **BC icons** and **load arrows** are displayed on the canvas

#### BC Symbol Legend

| Symbol | Meaning |
|--------|---------|
| Green triangle | Pin support (Dx·Dy constrained) |
| Blue circle + line | Roller support (Dx or Dy constrained) |
| Red hatched rectangle | Fixed support (all DOFs constrained) |

> Symbol size scales automatically with the overall model size.

### 5.7 Display Options

| Option | Function |
|--------|----------|
| Node IDs | Show node numbers |
| Element IDs | Show element numbers |
| BC Icons | Show support condition symbols |
| Load Arrows | Show nodal load arrows |
| Color by Material | Color elements by material |

---

## 6. Running the Analysis

### 6.1 How to Run

Click **▶ Run Analysis** in the toolbar.

- When complete, the status bar shows elapsed time and total DOF count
- The view automatically switches to the **Post-Process** tab

### 6.2 Analysis Algorithm

| Step | Description |
|------|-------------|
| Stiffness assembly | Local element stiffness → global stiffness matrix assembly |
| Equivalent nodal loads | Distributed loads and self-weight → equivalent nodal loads |
| Apply boundary conditions | Remove constrained DOFs (Penalty or Elimination) |
| Solve system of equations | LU decomposition (partial pivoting) |
| Post-processing | Reactions, element section forces, nodal stress computation |

### 6.3 Result Storage

- Results are kept in memory; click **Output** to view as text

---

## 7. Post-Processing

### 7.1 Deformed Shape

| Setting | Description |
|---------|-------------|
| **Show Deformed** | Toggle deformed shape display ON/OFF |
| **Ghost Shape** | Show undeformed structure as dashed lines |
| **Scale** (slider + input field) | Adjust deformation magnification factor. Slider range 0–1000; direct numeric input supports values above 9999. |

#### Auto-Scale Behavior

- **First analysis**: auto-scale is computed so that the maximum displacement is approximately 25% of the model's characteristic length.
  - 1D model (beam/truss): average element length used as characteristic length
  - 2D solid model: bounding-box diagonal of all nodes used as characteristic length
- **Re-analysis (after material/load change)**: scale is **locked** to the first-analysis value. Thus doubling E will correctly halve the displayed deformation.
- **Model change (after New/Open/Undo)**: auto-scale lock is released; auto-computed again on next analysis.

> **Manual scale**: Type a value directly in the numeric input field beside the slider to apply a factor beyond the slider maximum (1000). Both controls are bidirectionally synchronized.

### 7.2 Section Force Diagrams (1D Beam/Truss)

Select from the **Result Component** dropdown:

| Item | Description |
|------|-------------|
| **Axial Force (N)** | Axial force diagram (AFD) |
| **Shear Force Vy** | Shear force in y-direction (SFD) |
| **Bending Moment Mz** | Bending moment about z-axis (BMD) |
| **Shear Force Vz (3D)** | 3D shear force in z-direction |
| **Bending Moment My (3D)** | 3D bending moment about y-axis |
| **Torsion T (3D)** | 3D torsion moment |

- Diagram height adjusted by **Diagram Scale** slider (1–500) or the adjacent numeric input field (1–9999)
- Slider and input field are bidirectionally synchronized
- Numerical values auto-displayed at element ends
- BMD correctly represents parabolic shape under distributed loads

#### Sign Convention

- SFD: `V(x) = −V₁ − wy₁·x − (wy₂−wy₁)·x²/(2L)`
- BMD: `M(x) = −M₁ + V₁·x + wy₁·x²/2 + (wy₂−wy₁)·x³/(6L)`
- AFD: `N(x) = −N₁ + (N₁+N₂)·t`

### 7.3 Beam/Truss Color Contour

When `σ_xx` or `σ_yy` is selected in **Result Component** for a beam/truss model:

| Selection | Displayed content |
|-----------|------------------|
| `σ_xx` | **Axial force** shown as gradient color on elements |
| `σ_yy` | **Bending moment (Mz)** shown as gradient color on elements |

- Blue = negative (compression / negative moment), Red = positive (tension / positive moment)
- Continuous gradient using 30 segments per element
- Min/max legend shown in the right **Color Bar**

### 7.4 2D Solid Stress Contour

Select from the **Result Component** dropdown:

| Item | Description |
|------|-------------|
| `σ_xx` | Normal stress in x-direction |
| `σ_yy` | Normal stress in y-direction |
| `τ_xy` | Shear stress |
| `σ_max` | Maximum principal stress |
| `σ_min` | Minimum principal stress |
| **von Mises** | Equivalent stress (design criterion) |

- Smooth contour via node averaging
- Range auto-displayed in the right **Color Bar**

### 7.5 Reaction Force Overlay

In the **Overlays** section:

| Option | Description |
|--------|-------------|
| **Reaction Forces** | Reaction force arrows and values at each support |
| **Applied Loads** | Show applied load arrows |

- Reaction labels: `Rx=`, `Ry=`, `Mz=` (2D models)
- Vertical offset applied automatically to prevent label overlap between horizontal (Rx) and moment (Mz) reactions

---

## 8. Output and Export

### 8.1 Output (Text Results)

Click **Output** in the toolbar → popup window displays:

```
── Node Displacements ──
Node   Ux          Uy          Rz
  1    0.000e+00   0.000e+00   0.000e+00
  2   -1.234e-03  -5.678e-04   2.345e-05
  ...

── Reactions ──
Node   Rx          Ry          Mz
  1    2.503e+01  -5.000e+01   1.739e+01
  ...

── Element Forces ──
Elem  N1       V1       M1       N2       V2       M2
  1   3.002  -25.03  -17.39  -3.002  -20.04   12.90
  ...
```

### 8.2 Report (HTML Report)

Click **Report** in the toolbar → comprehensive report generated in a new browser tab:

- Model information (node, element, material, section tables)
- Nodal displacement results
- Reaction results
- Element section forces (beam/truss)
- Element stresses (2D solid)
- Auto-highlighted max/min values

### 8.3 Export (File Export)

- **VTK format** (`.vtu`) export supported
- Can be visualized in ParaView and other post-processing software

### 8.4 Save As

- Saves the entire current model in FEPS `.inp` format
- Includes boundary conditions, loads, and distributed loads (ESURF)

---

## 9. Example Models

> The following example files can also be loaded directly from the `examples/` folder.
> In FEPS: **Open** → select the `.inp` file → **▶ Run Analysis**

---

### Example 1: Simple Truss (BAR2)

A simple 2D truss with 3 nodes and 3 BAR2 elements.

```
3 2 2
1   0.0   0.0
2   8.0   0.0
3   4.0   3.0
1
1  20000.0  0.0
1
1  1.0  0.0  0.0
3
BAR2  1  1  1  1  3  0  0
BAR2  2  1  1  3  2  0  0
BAR2  3  1  1  1  2  0  0
3
1  1  1   0.0   0.0   0.0   0.0
2  0  1   0.0   0.0   0.0   0.0
3  0  0  40.0 -80.0   0.0   0.0
```

**Model Description**

| Node | Coordinates | BC |
|------|-------------|----|
| 1 | (0, 0) | Pin (Dx·Dy constrained) |
| 2 | (8, 0) | Roller (Dy constrained) |
| 3 | (4, 3) | Fx=40, Fy=−80 point load |

- Header: `dofNod=2` (truss, 2 DOF/node), `dim=2`
- Material: E=20000, ν=0.0
- Section: A=1.0 (t, Iz not needed)
- **Expected result**: downward displacement at node 3; elements 1·2 in tension, element 3 in compression

---

### Example 2: Cantilever Beam (BEAM2D)

5 m cantilever beam with a concentrated load of −10 kN at the free end.

```
2 3 2
1   0.0   0.0
2   5.0   0.0
1
1  200000  0.3
1
1  0.01  1.0  8.333e-6  0.0  0.0  0.0
1
BEAM2D  1  1  1  1  2  0  0  0
2
1  1  1  1   0.0   0.0   0.0   0.0   0.0   0.0
2  0  0  0   0.0 -10.0   0.0   0.0   0.0   0.0
```

**Model Description**

| Node | Coordinates | BC |
|------|-------------|----|
| 1 | (0, 0) | Fixed (Dx·Dy·Rz constrained) |
| 2 | (5, 0) | Fy=−10 kN point load |

- Header: `dofNod=3` (beam, 3 DOF/node)
- Material: E=200000 MPa, ν=0.3
- Section: A=0.01 m², t=1.0, Iz=8.333×10⁻⁶ m⁴ (100mm×100mm square section)
- **Analytical solution**: δ = PL³/(3EI) = 10×5³/(3×200000×8.333×10⁻⁶) ≈ **250 mm**
- **Expected result**: Node 2 Uy≈−250; fixed-end reactions Ry=10, Mz=50

> **Scale tip**: Adjust the `Scale` slider after beam analysis to clearly visualize the deflection shape. Use Diagram Scale to adjust BMD/SFD diagram height.

---

### Example 3: 2D Portal Frame (BEAM2D + Distributed Load)

Single-storey portal frame: 2 columns + 1 beam with uniform distributed load.

```
4 3 2
1   0.0   0.0
2   0.0   4.0
3   6.0   4.0
4   6.0   0.0
1
1  210000  0.3
1
1  0.02  1.0  6.667e-5  0.0  0.0  0.0
3
BEAM2D  1  1  1  1  2  0   0   0
BEAM2D  2  1  1  2  3  0 -20 -20
BEAM2D  3  1  1  3  4  0   0   0
4
1  1  1  1   0.0  0.0  0.0   0.0   0.0   0.0
2  0  0  0   0.0  0.0  0.0   0.0   0.0   0.0
3  0  0  0   0.0  0.0  0.0   0.0   0.0   0.0
4  1  1  1   0.0  0.0  0.0   0.0   0.0   0.0
```

**Model Description**

| Node | Coordinates | BC |
|------|-------------|----|
| 1 | (0, 0) | Fixed |
| 2 | (0, 4) | Free |
| 3 | (6, 4) | Free |
| 4 | (6, 0) | Fixed |

- Element 2 (horizontal beam, nodes 2→3): uniform distributed load wy1=wy2=−20 kN/m (downward)
- Section: A=0.02 m², Iz=6.667×10⁻⁵ m⁴ (approximate IPB 200)
- **Expected result**: maximum deflection at mid-span; BMD shows negative moments at both ends + positive moment at center

---

### Example 4: 2D Solid Cantilever Plate (QUAD4)

1 m thick rectangular cantilever plate, 4×2 QUAD4 mesh.

```
15 2 2
1   0.0   0.0
2   0.0   1.0
3   1.0   0.0
4   1.0   1.0
5   2.0   0.0
6   2.0   1.0
7   3.0   0.0
8   3.0   1.0
9   4.0   0.0
10  4.0   1.0
11  5.0   0.0
12  5.0   1.0
13  6.0   0.0
14  6.0   1.0
15  7.0   0.0
16  7.0   1.0
1
1  1000  0.25
1
1  1.0  1.0  0.0  0.0  0.0  0.0
8
QUAD4  1  1  1   1  3  4  2    0  0  0
QUAD4  2  1  1   3  5  6  4    0  0  0
QUAD4  3  1  1   5  7  8  6    0  0  0
QUAD4  4  1  1   7  9 10  8    0  0  0
QUAD4  5  1  1   9 11 12 10    0  0  0
QUAD4  6  1  1  11 13 14 12    0  0  0
QUAD4  7  1  1  13 15 16 14    0  0  0
QUAD4  8  1  1  15 17 18 16    0  0  0
4
1  1  1   0.0   0.0   0.0   0.0
2  1  1   0.0   0.0   0.0   0.0
```

> **Note**: The above example can be reproduced by typing data directly, or by using FEPS **draw a rectangular polygon → Mesh Polygon** to auto-generate an equivalent mesh.

**Faster method — interactive mesh generation**

1. **Type**: `QUAD4`, **Mat**: M1, **Prop**: P1
2. Check **Close Path**
3. **▶ Start Draw** → click 4 corners on canvas (e.g. (0,0)→(7,0)→(7,1)→(0,1))
4. **■ End Draw**
5. **Div** = 4 → **Mesh Polygon**
6. Select left nodes → **Assign BC/Load** → constrain Dx·Dy
7. Select right nodes → **Assign BC/Load** → apply Fy = −500
8. **▶ Run Analysis**

**Young's Modulus variation experiment (E-change verification)**

| E value | Expected max Uy |
|---------|----------------|
| 1000 | baseline δ₀ |
| 2000 | δ₀ / 2 |
| 500  | δ₀ × 2 |

> Edit material using the ✎ button and re-run analysis — the **deformation scale stays locked**, so the proportional relationship above is visually verified. Stress contours (σ_xx, von Mises) are independent of E.

---

### Example 5: 3D Space Truss (BAR3D)

2-node 3D truss — `dofNod=3`, `dim=3`.

```
4 3 3
1   0.0   0.0   0.0
2   4.0   0.0   0.0
3   4.0   3.0   0.0
4   4.0   0.0   3.0
1
1  200000  0.0
1
1  1.0  0.0  0.0
4
BAR3D  1  1  1  1  2  0  0
BAR3D  2  1  1  1  3  0  0
BAR3D  3  1  1  1  4  0  0
BAR3D  4  1  1  2  3  0  0
4
1  1  1  1   0.0   0.0   0.0   0.0   0.0   0.0
2  0  1  1   0.0   0.0   0.0   0.0   0.0   0.0
3  0  0  1   0.0   0.0   0.0   0.0   0.0   0.0
4  0  0  1   0.0 -100.0   0.0   0.0   0.0   0.0
```

- Header: `dofNod=3` (3D truss), `dim=3`
- Node 1: pinned; nodes 2·3: z-direction constrained; node 4: Fy=−100 load
- 3D rendering displayed as isometric perspective

---

### Example 6: QUAD5 Bubble-Function Cantilever (QUAD5)

Same geometry as Example 4, analyzed using the 5-node bubble element. Each element has an additional center node, totaling 14 nodes.

```
14 2 2
1   0.0   0.0
2   0.0   1.0
3   2.0   0.0
4   2.0   1.0
5   4.0   0.0
6   4.0   1.0
7   6.0   0.0
8   6.0   1.0
9   8.0   0.0
10  8.0   1.0
11  1.0   0.5
12  3.0   0.5
13  5.0   0.5
14  7.0   0.5
1
1  1000.0  0.25
1
1  1.0  1.0  0.0  0.0  0.0  0.0
4
QUAD5  1  1  1   1  3  4  2  11    0  0  0
QUAD5  2  1  1   3  5  6  4  12    0  0  0
QUAD5  3  1  1   5  7  8  6  13    0  0  0
QUAD5  4  1  1   7  9 10  8  14    0  0  0
14
1   1  1   0.0    0.0   0.0   0.0
2   1  1   0.0    0.0   0.0   0.0
3   0  0   0.0    0.0   0.0   0.0
4   0  0   0.0    0.0   0.0   0.0
5   0  0   0.0    0.0   0.0   0.0
6   0  0   0.0    0.0   0.0   0.0
7   0  0   0.0    0.0   0.0   0.0
8   0  0   0.0    0.0   0.0   0.0
9   0  0   0.0  -50.0   0.0   0.0
10  0  0   0.0  -50.0   0.0   0.0
11  0  0   0.0    0.0   0.0   0.0
12  0  0   0.0    0.0   0.0   0.0
13  0  0   0.0    0.0   0.0   0.0
14  0  0   0.0    0.0   0.0   0.0
```

**Model Description**

- Same 8×1 m cantilever, material, and load as Example 4
- Nodes 11–14: center node of each element (average of corner positions)
- QUAD5 solved with all 5 nodes (no static condensation)
- **Comparison point**: observe the effect of the bubble function vs. QUAD4

---

### Example 7: QUAD9 Static Condensation Cantilever (QUAD9)

9-node Lagrange element condensed to 8 nodes. Mid-side nodes and consistent loading are applied.

```
23 2 2
1   0.0   0.0
2   0.0   1.0
3   2.0   0.0
4   2.0   1.0
5   4.0   0.0
6   4.0   1.0
7   6.0   0.0
8   6.0   1.0
9   8.0   0.0
10  8.0   1.0
11  1.0   0.0
12  2.0   0.5
13  1.0   1.0
14  0.0   0.5
15  3.0   0.0
16  4.0   0.5
17  3.0   1.0
18  5.0   0.0
19  6.0   0.5
20  5.0   1.0
21  7.0   0.0
22  8.0   0.5
23  7.0   1.0
1
1  1000.0  0.25
1
1  1.0  1.0  0.0  0.0  0.0  0.0
4
QUAD9  1  1  1   1  3  4  2  11 12 13 14    0  0  0
QUAD9  2  1  1   3  5  6  4  15 16 17 12    0  0  0
QUAD9  3  1  1   5  7  8  6  18 19 20 16    0  0  0
QUAD9  4  1  1   7  9 10  8  21 22 23 19    0  0  0
23
1   1  1   0.0    0.0   0.0   0.0
2   1  1   0.0    0.0   0.0   0.0
3   0  0   0.0    0.0   0.0   0.0
4   0  0   0.0    0.0   0.0   0.0
5   0  0   0.0    0.0   0.0   0.0
6   0  0   0.0    0.0   0.0   0.0
7   0  0   0.0    0.0   0.0   0.0
8   0  0   0.0    0.0   0.0   0.0
9   0  0   0.0  -16.667  0.0   0.0
10  0  0   0.0  -16.667  0.0   0.0
11  0  0   0.0    0.0   0.0   0.0
12  0  0   0.0    0.0   0.0   0.0
13  0  0   0.0    0.0   0.0   0.0
14  1  1   0.0    0.0   0.0   0.0
15  0  0   0.0    0.0   0.0   0.0
16  0  0   0.0    0.0   0.0   0.0
17  0  0   0.0    0.0   0.0   0.0
18  0  0   0.0    0.0   0.0   0.0
19  0  0   0.0    0.0   0.0   0.0
20  0  0   0.0    0.0   0.0   0.0
21  0  0   0.0    0.0   0.0   0.0
22  0  0   0.0  -66.667  0.0   0.0
23  0  0   0.0    0.0   0.0   0.0
```

**Model Description**

| Item | Detail |
|------|--------|
| Nodes 1–10 | Corner nodes (same positions as Example 4) |
| Nodes 11–23 | Mid-side nodes + left-edge midpoint node 14 |
| Left fixed | Nodes 1, 2, 14 (2 corners + 1 mid-side) |
| Right load | Consistent distribution: corners 9,10 receive −16.667, mid-side 22 receives −66.667 (total −100 kN) |

- **Static condensation**: `condense:[8]` on QUAD9 automatically removes the center node (9th)
- **Node input**: only 8 nodes specified (center node auto-generated)
- **Consistent load**: distributed by Simpson's rule along the right edge (P/6 : 4P/6 : P/6)
- **Analytical solution**: δ = PL³/(3EI) = 100×8³/(3×1000×1/12) ≈ **204.8**
- **Expected result**: tip uy ≈ **−204.9** (99.95% of analytical), significantly more accurate than QUAD4's −77.6

> **Comparison**: At the same mesh density, QUAD4 achieves 37.9% of the analytical solution, while QUAD9 (condensed) achieves 99.95%. The superior convergence of higher-order elements is clearly demonstrated.

---

## 10. Units and Notes

### 10.1 Unit System

FEPS uses a **consistent unit system**. Using a unified unit system ensures correct results.

| Quantity | SI unit example | Engineering unit example |
|----------|----------------|-------------------------|
| Length | m | mm |
| Young's modulus E | Pa (N/m²) | MPa (N/mm²) |
| Force | N | N |
| Stress | Pa | MPa |
| Second moment of area | m⁴ | mm⁴ |

> SI unit system: `E = 200e9 Pa`, `F = 1000 N`, `L = 1.0 m`
> mm unit system: `E = 200000 MPa`, `F = 1000 N`, `L = 1000 mm`

### 10.2 Important Notes

1. **DOF count consistency**: The `dofNod` in the header must match the element type used.
   - 2D beam/frame: `dofNod = 3`
   - 2D truss: `dofNod = 2`
   - 3D beam/frame: `dofNod = 6`
   - 3D truss: `dofNod = 3`

2. **Minimum constraints**: Apply sufficient boundary conditions to ensure stability (at least statically determinate). Insufficient constraints result in a singular matrix and analysis failure.

3. **Node numbering**: Sequential numbering from 1 is recommended. Large gaps in node IDs increase matrix size and reduce efficiency.

4. **Beam distributed loads**: `wy1`, `wy2` values are in the **global y-direction**; positive = upward.

5. **Thermal loads (ΔT)**: Set `ΔT` in the element definition AND provide `alpha` in the section properties.

6. **Large models**: This program uses dense-matrix LU decomposition. Computation time increases rapidly for models with thousands of DOFs or more. The program is optimized for educational/research models with up to several hundred to ~1000 DOFs.

---

## 11. Element Code Editor (Student Element Development)

FEPS provides a built-in code editor that allows students or developers to **write new finite elements in JavaScript directly in the browser and immediately use them in analysis**.

### 11.1 Opening the Editor

Click the **Element Editor** button in the toolbar.

### 11.2 Screen Layout

```
┌──────────────────────────────────────────────────────────┐
│  Element Code Editor                                     │
│  User Elem: Dim:[2D▼] DOF/node:[2▼] nNodes:[4▼] [hint] │
│  Slot:[UserElement1▼]  [Load to Editor→]  [▶ Register]  [Reset] │
├─────────────────────────────┬────────────────────────────┤
│  Code Input (JavaScript)    │  Registered Elements       │
│                             │  (💾=saved, 🗑️=delete)     │
│  textarea                   ├────────────────────────────┤
│                             │  Execution Log             │
├─────────────────────────────┴────────────────────────────┤
│  SRI: [☐ Enable shear-locking prevention]                │
│        α hydrostatic (full): [1.0]  β deviatoric: [1.0]  │
│        Reduced order: [auto▼]  [Apply to code]           │
├──────────────────────────────────────────────────────────┤
│  [💾 Export]  [📂 Open File]    [🗑️ Clear Storage]  [Close] │
└──────────────────────────────────────────────────────────┘
```

### 11.3 User Element Panel

The user element panel classifies elements automatically using three inputs — **dimension (dim), DOF/node, and number of nodes** — then loads the matching code template into the editor.

#### Input Fields

| Input | Options | Description |
|-------|---------|-------------|
| **Dimension** | 2D / 3D | Spatial dimension of the element |
| **DOF/node** | 2D → 2 or 3 / 3D → 3 or 6 | Degrees of freedom per node (auto-updated when dimension changes) |
| **Node count** | Dynamically updated by classification | Number of nodes in the element |

Whenever any input changes, the **hint label** shows the auto-classification result.

#### Element Classification Rules

| Dim | DOF/node | Node count | Classification | Description |
|-----|---------|-----------|---------------|-------------|
| 2D | 2 | 2 | 2D Truss (`bar1d`) | 2-node bar/truss element |
| 2D | 2 | 3 ~ 9 | 2D Solid (`solid2d`) | Quad/triangle plane stress or strain |
| 2D | 3 | 2 ~ 3 | 2D Beam (`beam2d_tim`) | Timoshenko beam element |
| 3D | 3 | 2 ~ 3 | 3D Truss (`bar1d`) | Space truss element |
| 3D | 6 | 2 | 3D Beam (`beam3d_custom`) | Space beam — requires custom `computeStiffness()` |

#### Auto-Selected Templates

Based on classification and node count, the following starter code is auto-loaded into the editor:

| Classification | Node count | Inserted template |
|---------------|-----------|-------------------|
| 2D Solid | 3 | TRIG3 |
| 2D Solid | 4 | QUAD4 |
| 2D Solid | 5 | QUAD5 |
| 2D Solid | 6 | TRIG6 |
| 2D Solid | 8 | QUAD8 |
| 2D Solid | 9 | QUAD9 |
| 2D Solid | other | solid2d blank template |
| 2D Truss | 2 | 2-node bar blank template |
| 2D Beam | 2 | TIMBEAM2D_2N |
| 2D Beam | 3 | TIMBEAM2D_3N |
| 3D Truss | 2 ~ 3 | bar3d blank template |
| 3D Beam | 2 | beam3d blank template (`computeStiffness` skeleton) |

#### UserElement Slots

Select one of **UserElement1 – UserElement5** from the slot dropdown. When you click **Load to Editor**:

- The selected slot name is substituted into the `name:` field of the code.
- The chosen node count and DOF/node are substituted into `nNodes:` / `dofPerNode:`.

Re-registering with the same slot name overwrites the existing element.

> **Registered element list sorting**: The element list in the right panel is sorted as QUAD4, QUAD4SRI, QUAD5, QUAD8, QUAD9, TRIG3, TRIG6, … followed by UserElement1 – UserElement5.

### 11.4 Registering an Element

1. After completing the code, click **▶ Register**
2. Check the execution log for success/failure messages
3. Registered elements are immediately available in the element type dropdown
4. **Auto-saved to localStorage**: on successful registration, the code is saved to the browser's local storage and automatically restored after page reload

### 11.5 File Save and Load

| Button | Action |
|--------|--------|
| **💾 Export** | Download the current editor code as a `.js` file |
| **📂 Open File** | Load a local `.js` file into the editor (register separately) |

### 11.6 Managing Saved Elements

- Elements marked with 💾 in the list = saved in localStorage
- Click **🗑️** beside an entry to delete that element from localStorage
- **🗑️ Clear Storage**: delete all saved data and reload the page

> **Tip**: When multiple students access the app simultaneously in class, localStorage is **completely independent per browser**. Each student's code does not affect others.

### 11.7 Element Code Structure

```javascript
FepsElementRegistry.register({
  // ── Required fields ──
  name    : 'MY_ELEM',      // Element type name (uppercase, unique)
  category: 'solid2d',      // 'solid2d' | 'bar1d' | 'beam2d_tim'
  nNodes  : 4,              // Number of nodes
  dofNode : 2,              // DOFs per node

  // ── (Optional) Static condensation ──
  condense: [8],             // 0-based internal node index array to condense

  // ── (Optional) Selective Reduced Integration (SRI) ──
  sri               : true,  // Enable SRI — shear-locking prevention
  sriAlpha          : 1.0,   // α hydrostatic (volumetric) part weight (full integration)
  sriBeta           : 1.0,   // β deviatoric (shear) part weight (reduced integration)
  gaussOrderReduced : 1,     // Reduced integration Gauss order (omit for auto: nGauss-1)

  // ── Stiffness matrix computation ──
  stiffness(nodes, mat, prop) {
    // nodes: [{x, y}, ...], mat: {E, nu, rho}, prop: {A, t, Iz, ...}
    // Returns: { esm: number[][] }  (nDof × nDof matrix, nDof = nNodes × dofNode)
    const esm = /* ... Gauss integration etc. ... */;
    return { esm };
  },

  // ── (Optional) Stress computation ──
  stress(nodes, mat, prop, disp) {
    // disp: [u1, v1, u2, v2, ...] (nodal displacements extracted from global vector)
    // Returns: [{ x, y, sxx, syy, txy, smx, smn, mises }, ...]
    return [];
  }
});
```

#### `condense` — Static Condensation

Automatically removes internal nodes (bubble nodes, center nodes, etc.) at the element level, so the global assembly only handles external nodes.

| Item | Description |
|------|-------------|
| **Format** | `condense: [index, ...]` — 0-based internal node index array |
| **Action** | `K* = K_ee − K_ei · K_ii⁻¹ · K_ie` (condensed stiffness matrix) |
| **nNodes update** | Automatically reduced by the number of condensed nodes |
| **Stress recovery** | `u_i = K_ii⁻¹ · (f_i − K_ie · u_e)` — internal displacements auto-recovered before stress computation |
| **Coordinate recovery** | Internal node coordinates = corner average (or custom `internalNodeCoords()` function) |

**Example — QUAD9 (9-node → 8-node)**:
```javascript
FepsElementRegistry.register({
  name:     'QUAD9',
  category: 'solid2d',
  nNodes:    9,           // original node count
  condense: [8],          // index 8 (9th node = center) condensed
  // → nNodes=8 after registration
  // → parser and solver treat it as an 8-node element
  shapeN(xi, eta)  { /* 9-node shape functions */ },
  shapeDN(xi, eta) { /* 9-node shape function derivatives */ }
});
```

> **Warning**: Static condensation is only correct when the internal DOF stiffness matrix K_ii is positive definite. For bubble-function elements (QUAD5 etc.), diagonal entries of K_ii may become negative — use with caution.

#### `sri` — Selective Reduced Integration (SRI)

Low-order 2D solid elements (especially QUAD4) suffer from **shear locking** in bending-dominated problems, making the element appear far stiffer than it should. SRI splits the constitutive matrix **D** into a hydrostatic (volumetric) part and a deviatoric (shear) part, then integrates each with a different Gauss point count to resolve this issue.

##### Mathematical Principle

The stiffness matrix is expressed as the sum of two parts:

$$K = \alpha \cdot K_\text{vol}(D_\text{vol},\, n_\text{Gauss}) + \beta \cdot K_\text{dev}(D_\text{dev},\, n_\text{Red})$$

| Term | Description |
|------|-------------|
| **D_vol** | Hydrostatic (volumetric) part — full Gauss integration |
| **D_dev** | Deviatoric (shear) part — reduced Gauss integration |
| **α** | Hydrostatic part weight (default 1.0) |
| **β** | Deviatoric part weight (default 1.0) |
| **n_Red** | Reduced Gauss order (default: n_Gauss − 1; auto for triangles) |

**Constitutive matrix decomposition (verified: D_vol + D_dev = D)**

Plane Stress, G = E / (2(1+ν)):

$$D_\text{vol} = \frac{E}{2(1-\nu)} \begin{bmatrix} 1 & 1 & 0 \\ 1 & 1 & 0 \\ 0 & 0 & 0 \end{bmatrix}, \quad D_\text{dev} = G \begin{bmatrix} 1 & -1 & 0 \\ -1 & 1 & 0 \\ 0 & 0 & 1 \end{bmatrix}$$

Plane Strain, λ = Eν / ((1+ν)(1−2ν)), G = E / (2(1+ν)):

$$D_\text{vol} = \lambda \begin{bmatrix} 1 & 1 & 0 \\ 1 & 1 & 0 \\ 0 & 0 & 0 \end{bmatrix}, \quad D_\text{dev} = \begin{bmatrix} 2G & 0 & 0 \\ 0 & 2G & 0 \\ 0 & 0 & G \end{bmatrix}$$

##### How to Enable SRI

**Method 1 — Directly in the element descriptor**:
```javascript
FepsElementRegistry.register({
  name    : 'QUAD4SRI',
  category: 'solid2d',
  nNodes  : 4,
  gaussOrder        : 2,      // full integration order for hydrostatic part
  sri               : true,
  sriAlpha          : 1.0,   // α
  sriBeta           : 1.0,   // β
  gaussOrderReduced : 1,     // reduced integration order for deviatoric part (1×1)
  constitModel      : 'planeStress',
  shapeN(xi, eta)  { /* QUAD4 shape functions */ },
  shapeDN(xi, eta) { /* QUAD4 shape function derivatives */ }
});
```

**Method 2 — Using the SRI panel GUI**:

1. Write/load element code in the code editor
2. Check "Enable shear-locking prevention" in the bottom **SRI panel**
3. Adjust α, β, and reduced order values
4. Click **Apply to code** → SRI-related lines auto-inserted into the textarea
5. Click **▶ Register**

##### QUAD4 vs QUAD4-SRI Performance Comparison

Same pure-bending cantilever model (QUAD4, coarse mesh):

| Element | Tip deflection / analytical |
|---------|---------------------------|
| QUAD4 (standard, 2×2) | ~38% (overly stiff due to shear locking) |
| QUAD4-SRI (α=1, β=1, nRed=1) | ~98% (shear locking eliminated) |

> **Note**: α=1, β=1 is the standard SRI setting. Adjusting α/β controls the relative contribution of each part.

#### Category Reference Table

| category | dofNode | DOFs per node | Usage |
|----------|---------|--------------|-------|
| `solid2d` | 2 | u, v (horizontal · vertical) | 2D plane stress/strain |
| `bar1d` | 2 | u, v (global coordinates) | 2D bar/truss |
| `bar1d` | 3 | u, v, w (global coordinates) | 3D truss (space bar element) |
| `beam2d_tim` | 3 | u, v, θ | 2D Timoshenko beam |
| `beam3d_custom` | 6 | u, v, w, θx, θy, θz | 3D beam — requires custom `computeStiffness()` |

---

## 12. Debug Mode — Matrix and Force Viewer

Debug mode is a tool for students to **numerically verify that a written element's stiffness matrix is correct** and to validate analysis results (displacements, nodal forces, global stiffness matrix).

### 12.1 Activating Debug Mode

1. Click the **Debug** button in the toolbar → button turns green and shows "ON"
2. Run **▶ Run Analysis**
3. When analysis completes, the **debug viewer opens automatically**

> Click the Debug button again to deactivate.
>
> **View Matrix** button: opens the viewer manually at any time after analysis, regardless of debug mode state.

### 12.2 Viewer Tabs

| Tab | Content |
|-----|---------|
| **Summary** | Total DOFs (nDOF), free DOFs (nFree), constrained DOFs (nConst), element count, global K storage status |
| **K_e stiffness** | Selected element stiffness matrix — n×n scrollable table, diagonal entries highlighted, EFT (global DOF numbers) shown |
| **u_e displacements** | Selected element nodal displacements — local DOF / global DOF / node ID / direction / value |
| **f_e nodal forces** | f_e = K_e × u_e — element nodal forces for equilibrium verification |
| **Global K** | Assembled global stiffness matrix (stored and displayed only when nDOF ≤ 200) |

### 12.3 Element Selection

Select an element from the **Element** dropdown at the top of the viewer — the **K_e / u_e / f_e** tab data updates automatically.

```
Dropdown: E3 · TIMBEAM2D_2N · 2 nodes (6DOF)
           ↑elem ID  ↑type         ↑DOF count
```

### 12.4 Reading the Stiffness Matrix Table

```
       i\j    0      1      2      3
        0  [K00]  [K01]  [K02]  [K03]   ← row i=0 (global DOF number)
        1  [K10]  [K11]  ...
```

- **Bold blue cell**: diagonal entry (K_ii)
- **Faded gray cell**: near-zero value (< 1e-14)
- Numbers in row/column headers: EFT (Element Freedom Table) — position in global stiffness matrix

### 12.5 Equilibrium Verification (f_e tab)

Check that `f_e = K_e × u_e` values are in a physically meaningful range.

- Internal forces summing close to zero → correct equilibrium
- An abnormally large nodal force at a specific DOF → possible stiffness matrix error

### 12.6 Global K Storage Limit

| nDOF | Global K storage |
|------|-----------------|
| ≤ 200 | ✅ Stored and displayed |
| > 200 | ⚠️ Omitted to save memory |

It is recommended to verify with small test models (a few elements).

### 12.7 Debug Workflow Example

**Student element verification procedure:**

1. Register the new element in the code editor
2. Create a simple model containing only that element (e.g. a fixed-fixed bar)
3. Debug mode ON → Run Analysis
4. **K_e tab**: verify the stiffness matrix is symmetric and diagonal entries are positive
5. **u_e tab**: verify constrained node displacements are zero
6. **f_e tab**: verify nodal forces match the applied loads
7. **Global K tab**: verify constrained DOF rows/columns are correctly handled

---

## 13. FepsElementCore API Reference

`FepsElementCore` is a collection of utility functions available for use in student element code.

### 13.1 Numerical Integration

#### `gaussPts2D(n)` — 2D Gauss Points

```javascript
const { pts, wts } = FepsElementCore.gaussPts2D(2);
// pts: [[ξ₁,η₁], [ξ₂,η₂], ...] (n² points)
// wts: [w₁, w₂, ...]            (weights)
```

| Argument n | Number of points |
|------------|-----------------|
| 1 | 1 (1×1) |
| 2 | 4 (2×2) |
| 3 | 9 (3×3) |

#### `gaussPts1D(n)` — 1D Gauss Points

```javascript
const { pts, wts } = FepsElementCore.gaussPts1D(3);
// n points on the interval [-1, 1]
```

### 13.2 Shape Functions

#### `shapeQuad4(xi, eta)` — QUAD4 Shape Functions

```javascript
const { N, dN } = FepsElementCore.shapeQuad4(xi, eta);
// N:  [N1, N2, N3, N4]         — shape function values
// dN: [[dN1/dξ, dN1/dη], ...]  — ξ·η partial derivatives
```

#### `shapeTrig3(xi, eta)` — TRIG3 Shape Functions

```javascript
const { N, dN } = FepsElementCore.shapeTrig3(xi, eta);
```

### 13.3 Jacobian and Transformation

#### `jacobian2D(dN, coords)` — 2D Jacobian

```javascript
const { J, detJ, invJ } = FepsElementCore.jacobian2D(dN, coords);
// dN:     [[dN1/dξ, dN1/dη], ...] — shape function natural-coordinate derivatives
// coords: [[x1,y1], [x2,y2], ...]  — nodal physical coordinates
// Returns:
//   J:    2×2 Jacobian matrix
//   detJ: det(J)
//   invJ: inverse J⁻¹
```

#### `bMatrix2D(dN_phys, n)` — 2D B Matrix (strain–displacement)

```javascript
const B = FepsElementCore.bMatrix2D(dN_phys, n);
// dN_phys: [[dNi/dx, dNi/dy], ...] — physical-coordinate derivatives
// n: number of nodes
// Returns: 3×(2n) matrix such that [ε_xx, ε_yy, γ_xy]ᵀ = B × d
```

#### `constitutive2D(E, nu, type)` — Constitutive Matrix

```javascript
const D = FepsElementCore.constitutive2D(E, nu, 'planeStress');
// type: 'planeStress' | 'planeStrain'
// Returns: 3×3 elastic matrix D
```

### 13.4 Beam Element Utilities

#### `beamRotate2D(dx, dy, L, nNodes)` — Coordinate Transformation Matrix

```javascript
const T = FepsElementCore.beamRotate2D(dx, dy, L, nNodes);
// dx, dy: beam element axis direction components (end - start)
// L:      beam element length
// nNodes: number of nodes (2 or 3)
// Returns: (3·nNodes) × (3·nNodes) rotation matrix T
//   global→local transform: u_local = T × u_global
```

### 13.5 Matrix Utilities

#### `matMul(A, B)` — Matrix Multiplication

```javascript
const C = FepsElementCore.matMul(A, B);
// A: m×k, B: k×n → C: m×n
```

#### `matTranspose(A)` — Transpose

```javascript
const At = FepsElementCore.matTranspose(A);
```

#### `matScale(A, s)` — Scalar Multiplication

```javascript
const B = FepsElementCore.matScale(A, 2.0);
```

### 13.6 Static Condensation Utilities

Applied automatically via the `condense` descriptor field, but manual APIs are also provided for advanced users.

#### `staticCondense(K, f, internalDofs)` — Static Condensation

```javascript
const result = FepsElementCore.staticCondense(K, f, internalDofs);
// K:            n×n stiffness matrix (2D jagged array)
// f:            n-vector (load vector)
// internalDofs: 0-based array of DOF indices to condense
//
// Returns:
//   result.esm      — condensed (n-m)×(n-m) stiffness matrix
//   result.force    — condensed load vector
//   result.dofesm   — condensed DOF count
//   result.recovery — { Kii_inv_Kie, Kii_inv_fi, extDofs, intDofs }
```

#### `recoverInternalDofs(recovery, ue)` — Internal Displacement Recovery

```javascript
const uFull = FepsElementCore.recoverInternalDofs(recovery, ue);
// recovery: recovery object returned by staticCondense()
// ue:       external DOF displacement vector
// Returns:  full DOF displacement vector (original DOF order)
```

#### `solveSmall(A, b)` — Small System of Equations Solver

```javascript
const x = FepsElementCore.solveSmall(A, b);
// A: n×n matrix, b: n-vector
// Gaussian elimination with partial pivoting
```

#### `subMatrix(A, rows, cols)` / `subVector(v, indices)` — Submatrix Extraction

```javascript
const Asub = FepsElementCore.subMatrix(A, [0,1], [2,3]);  // 2×2 sub-matrix
const vsub = FepsElementCore.subVector(v, [0,1]);          // sub-vector
```

### 13.7 SRI Utilities

#### `constitSplit(constitModel, E, nu)` — Constitutive Matrix Decomposition

```javascript
const { Dvol, Ddev } = FepsElementCore.constitSplit('planeStress', E, nu);
// constitModel: 'planeStress' | 'planeStrain'
// Returns:
//   Dvol — hydrostatic (volumetric) part of constitutive matrix (3×3, Float64Array)
//   Ddev — deviatoric (shear) part of constitutive matrix (3×3, Float64Array)
//   (Dvol + Ddev == D holds exactly)
```

| `constitModel` | Dvol | Ddev |
|----------------|------|------|
| `planeStress` | E/(2(1-ν)) × [1 1 0; 1 1 0; 0 0 0] | G × [1 -1 0; -1 1 0; 0 0 1] |
| `planeStrain` | λ × [1 1 0; 1 1 0; 0 0 0] | diag(2G, 2G, G) |

#### `isoStiffnessSRI2D(...)` — Quadrilateral Element SRI Stiffness

```javascript
const result = FepsElementCore.isoStiffnessSRI2D(
    shapeN, shapeDN,   // shape functions / derivatives (xi, eta) => { N, dN }
    nNodes, nGauss,    // node count, full Gauss order
    xn, yn,            // nodal x·y coordinate arrays
    t,                 // thickness
    constitModel,      // 'planeStress' | 'planeStrain'
    E, nu,             // material constants
    alpha, beta,       // hydrostatic · deviatoric weights
    nGaussRed          // reduced Gauss order (null → auto: nGauss-1)
);
// Returns: { esm, force, dofesm }
// esm = alpha·K_vol(Dvol, nGauss) + beta·K_dev(Ddev, nGaussRed)
```

#### `isoStiffnessSRI_Tri(...)` — Triangle Element SRI Stiffness

```javascript
const result = FepsElementCore.isoStiffnessSRI_Tri(
    shapeN, shapeDN, nNodes, nGauss, xn, yn, t,
    constitModel, E, nu, alpha, beta, nGaussRed
);
// nGaussRed auto-determined: nGauss >= 6 → 3, otherwise → 1
```

> **When to call directly**: Using `sri: true` in the descriptor causes `_autoWireSolid2D()` to call the SRI stiffness function automatically. Direct calls are only needed for fully custom stiffness computations.

### 13.8 Complete Solid Element Example (QUAD4 Reproduction)

```javascript
FepsElementRegistry.register({
  name    : 'MY_QUAD4',
  category: 'solid2d',
  nNodes  : 4,
  dofNode : 2,

  stiffness(nodes, mat, prop) {
    const { E, nu } = mat;
    const t = prop.t || 1;
    const D = FepsElementCore.constitutive2D(E, nu, 'planeStress');
    const { pts, wts } = FepsElementCore.gaussPts2D(2);
    const coords = nodes.map(n => [n.x, n.y]);
    const nDof = 8;
    const esm = Array.from({ length: nDof }, () => new Array(nDof).fill(0));

    for (let g = 0; g < pts.length; g++) {
      const [xi, eta] = pts[g];
      const { dN } = FepsElementCore.shapeQuad4(xi, eta);
      const { detJ, invJ } = FepsElementCore.jacobian2D(dN, coords);
      // Physical-coordinate derivatives
      const dN_phys = dN.map(([dxi, deta]) => [
        invJ[0][0]*dxi + invJ[0][1]*deta,
        invJ[1][0]*dxi + invJ[1][1]*deta
      ]);
      const B = FepsElementCore.bMatrix2D(dN_phys, 4);
      const BtDB = FepsElementCore.matMul(
        FepsElementCore.matTranspose(B),
        FepsElementCore.matMul(D, B)
      );
      const w = wts[g] * detJ * t;
      for (let i = 0; i < nDof; i++)
        for (let j = 0; j < nDof; j++)
          esm[i][j] += BtDB[i][j] * w;
    }
    return { esm };
  }
});
```

---

## Appendix A: File Structure

```
FEPS-web/
├── index.html                  — Main UI (toolbar, tabs, panels, modals, canvas)
├── css/
│   └── style.css               — Stylesheet
├── js/
│   ├── parser.js               — .inp file parser
│   ├── solver.js               — Browser-based FEA solver
│   ├── renderer.js             — Canvas renderer (pre + post)
│   ├── mesher.js               — Legacy mesh generator (Earcut-based)
│   ├── mesher2.js              — Legacy mesh generator (Delaunay-based)
│   ├── tqmesh.js               — TQMesh WASM module (Emscripten build, binary embedded)
│   ├── tqmesh-wrapper.js       — FepsTQMesh: TQMesh WASM wrapper API
│   ├── main.js                 — App controller / event wiring
│   ├── element-registry.js     — FepsElementRegistry: custom element registration API
│   ├── element-core.js         — FepsElementCore: shape fn, Jacobian, B-matrix, SRI utils
│   ├── element-editor-ui.js    — Element code editor UI logic
│   ├── element-debug.js        — FepsDebug: K_e / global K collector
│   ├── element-debug-ui.js     — FepsDebugUI: matrix viewer modal UI
│   ├── help-ui.js              — Help viewer (opens help.html)
│   └── elements/               — Provided sample student elements
│       ├── quad5.js            — QUAD5 (5-node bubble quadrilateral)
│       ├── quad8.js            — QUAD8 (8-node serendipity)
│       ├── quad9.js            — QUAD9 (9-node Lagrange)
│       ├── trig6.js            — TRIG6 (6-node triangle)
│       ├── bar2_3N.js          — BAR2_3N (3-node bar)
│       ├── TimBeam2D_2N.js     — TIMBEAM2D_2N (2-node Timoshenko)
│       └── TimBeam2D_3N.js     — TIMBEAM2D_3N (3-node Timoshenko)
├── examples/                   — Tutorial example .inp files
│   ├── README.md               — Example descriptions (analytical solutions, experiments)
│   ├── ex01-truss-simple.inp   — Simple 2D truss (BAR2)
│   ├── ex02-cantilever-beam.inp — Cantilever beam analytical verification (BEAM2D)
│   ├── ex03-portal-frame.inp   — Portal frame + distributed load (BEAM2D)
│   ├── ex04-solid-plate-quad4.inp — 2D solid cantilever plate (QUAD4)
│   ├── ex05-solid-plate-trig3.inp — Same geometry, TRIG3 mesh comparison
│   ├── ex06-solid-plate-quad5.inp — QUAD5 bubble-function cantilever
│   └── ex07-solid-plate-quad9.inp — QUAD9 static condensation cantilever (8-node)
├── FEPS-SDD.md                 — Software Design Document
├── FEPS-UserManual.md          — This user manual (English)
├── FEPS-UserManual-Korean.md   — Korean user manual
└── FEPS-Csharp/                — C# reference implementation (Avalonia desktop)
    └── Examples/               — C# example input files
```

---

## Appendix B: Development History (Major Changes)

| Version | Change |
|---------|--------|
| Initial | BAR2, BEAM2D, QUAD4, TRIG3 basic analysis |
| +3D | BAR3D, BEAM3D elements, 3D isometric rendering |
| +Mesh | Earcut-based auto mesh generation, TRIG6/QUAD8 support |
| +Diagrams | SFD/BMD/AFD section force diagram renderer |
| Sign fix | SFD/BMD/AFD sign convention corrected |
| Contour | Beam/truss color contour (sxx=axial, syy=moment) |
| UI improvements | BC symbol size auto-scaled; reaction label overlap resolved |
| Label fix | 2D moment reaction label corrected `Rz → Mz` |
| Font adjustment | Optimized font sizes for diagrams, reactions, loads, nodes, element labels |
| Element plug-in | FepsElementRegistry + FepsElementCore API — custom elements in JavaScript |
| Code editor | Built-in element code editor, localStorage persistence, .js export/import |
| Sample elements | QUAD5/8/9, TRIG6, BAR2_3N, TIMBEAM2D_2N/3N provided as sample elements |
| Debug mode | FepsDebug (K_e · global K collection) + FepsDebugUI (matrix viewer modal) |
| Pre/post extension | TIMBEAM, BAR2_3N deformed shape, color contour, section force diagram support |
| Edit-in-place | ✎ button on material/section lists — update values in-place |
| Auto-scale lock | Re-analysis locks deformation scale; 2D solid characteristic length fixed to bounding-box diagonal |
| Manual scale input | Numeric input field beside Scale / Diagram Scale sliders; supports values beyond slider max; bidirectional sync |
| Section A tooltip | Tooltip added: "Not used by 2D solid elements (QUAD4, TRIG3)" |
| Mesh hole fix | mesher2.js improved — fixed mesh errors for domains with interior holes |
| Comment support | `#` comment line support added to `.inp` parser |
| Static condensation | `staticCondense()`, `recoverInternalDofs()` etc. added to FepsElementCore; `condense` descriptor field auto-wrapping in FepsElementRegistry; applied to QUAD9 (9→8 nodes) |
| Example expansion | ex06 (QUAD5 cantilever), ex07 (QUAD9 static condensation cantilever) added |
| Basic element templates | QUAD4, TRIG3, QUAD4-SRI reference templates added to element editor |
| Element list sorting | Registered element list sorted to match template dropdown order |
| SRI | `constitSplit()`, `isoStiffnessSRI2D()`, `isoStiffnessSRI_Tri()` added to FepsElementCore; `sri`/`sriAlpha`/`sriBeta`/`gaussOrderReduced` descriptor fields; SRI panel in element editor; QUAD4 bending accuracy ~38% → ~98% |
| Mesh quality display | Triangular leftover elements (orange) and bad quads ≥ 150° interior angle (red) highlighted on canvas |
| TQMesh engine | 2D solid mesh engine replaced with TQMesh (FloSewn, MIT) WASM — advancing-front, tri/quad mixed mesh, Edge Length / Smooth parameters, hole support |
| Help language toggle | Korean / English toggle buttons added to the top of help.html; selected language saved in localStorage; TOC and search area refresh automatically on language switch |
| User element panel | Template dropdown replaced with three explicit inputs — dimension (2D/3D), DOF/node, node count — for automatic element classification; five UserElement1–5 slots provided; matching code template auto-loaded based on classification + node count; blank templates added for 3D truss (bar3d) and 3D beam (beam3d) |

---

*FEPS-web v0.1 — Finite element analysis program for education and research*
*Developer: Minho Kwon · Dept. of Civil Engineering, Gyeongsang National University · kwonm@gnu.ac.kr*
