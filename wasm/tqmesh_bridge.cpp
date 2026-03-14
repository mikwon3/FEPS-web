/*************************************************************
 * tqmesh_bridge.cpp — Emscripten/Embind bridge for TQMesh
 *
 * Exposes a single function generateMesh() to JavaScript
 * that calls TQMesh's advancing-front triangulation and
 * optional tri-to-quad conversion.
 *
 * Build: emcmake cmake .. && emmake make
 *************************************************************/
#include <algorithm>
#include <cmath>
#include <unordered_map>
#include <vector>

// TQMesh headers (header-only library)
#include "TQMesh.h"

// Emscripten bindings
#include <emscripten/bind.h>
#include <emscripten/val.h>

using namespace TQMesh;
using namespace emscripten;

/*------------------------------------------------------------
 * MeshResult — flat arrays returned to JavaScript
 *------------------------------------------------------------*/
struct MeshResult {
  std::vector<double> coords; // x0,y0, x1,y1, ...
  std::vector<int> triConn;   // v0,v1,v2, v0,v1,v2, ...
  std::vector<int> quadConn;  // v0,v1,v2,v3, ...
  int nVerts = 0;
  int nTris = 0;
  int nQuads = 0;
  std::string error; // empty on success
};

/*------------------------------------------------------------
 * extractMeshResults — copy mesh data into MeshResult
 *------------------------------------------------------------*/
static void extractMeshResults(Mesh &mesh, MeshResult &result) {
  const auto &verts = mesh.vertices();
  const auto &tris = mesh.triangles();
  const auto &quads = mesh.quads();

  result.nVerts = static_cast<int>(mesh.n_vertices());
  result.nTris = static_cast<int>(mesh.n_triangles());
  result.nQuads = static_cast<int>(mesh.n_quads());

  // Build vertex index map (Container order → 0-based)
  std::unordered_map<const Vertex *, int> vMap;
  vMap.reserve(result.nVerts);
  int vi = 0;

  result.coords.reserve(result.nVerts * 2);
  for (const auto &v_ptr : verts) {
    vMap[v_ptr.get()] = vi++;
    result.coords.push_back(v_ptr->x());
    result.coords.push_back(v_ptr->y());
  }

  result.triConn.reserve(result.nTris * 3);
  for (const auto &t_ptr : tris) {
    result.triConn.push_back(vMap[&t_ptr->v1()]);
    result.triConn.push_back(vMap[&t_ptr->v2()]);
    result.triConn.push_back(vMap[&t_ptr->v3()]);
  }

  result.quadConn.reserve(result.nQuads * 4);
  for (const auto &q_ptr : quads) {
    result.quadConn.push_back(vMap[&q_ptr->v1()]);
    result.quadConn.push_back(vMap[&q_ptr->v2()]);
    result.quadConn.push_back(vMap[&q_ptr->v3()]);
    result.quadConn.push_back(vMap[&q_ptr->v4()]);
  }
}

/*------------------------------------------------------------
 * generateMesh — main entry point called from JS
 *
 *  exteriorCoords: flat double[] [x0,y0, x1,y1, ...]  (CCW)
 *  holeCoordsList: array of flat double[] per hole      (CW)
 *  targetSize:     target element edge length
 *  wantQuad:       true → tri-to-quad conversion
 *  smoothIter:     number of mixed smoothing iterations
 *------------------------------------------------------------*/
MeshResult generateMesh(val exteriorCoords, val holeCoordsList,
                        double targetSize, bool wantQuad, int smoothIter) {
  MeshResult result;

  try {
    // ── 1. Parse exterior boundary from JS ──────────────
    const unsigned extLen = exteriorCoords["length"].as<unsigned>();
    if (extLen < 6) {
      result.error = "Exterior boundary needs at least 3 vertices";
      return result;
    }

    std::vector<Vec2d> extPts;
    extPts.reserve(extLen / 2);
    double xMin = 1e30, xMax = -1e30, yMin = 1e30, yMax = -1e30;

    for (unsigned i = 0; i < extLen; i += 2) {
      double x = exteriorCoords[i].as<double>();
      double y = exteriorCoords[i + 1].as<double>();
      extPts.push_back({x, y});
      xMin = std::min(xMin, x);
      xMax = std::max(xMax, x);
      yMin = std::min(yMin, y);
      yMax = std::max(yMax, y);
    }

    // ── 2. Parse all hole boundaries ────────────────────
    std::vector<std::vector<Vec2d>> allHolePts;
    const unsigned nHoles = holeCoordsList["length"].as<unsigned>();
    for (unsigned h = 0; h < nHoles; ++h) {
      val holeCoords = holeCoordsList[h];
      const unsigned hLen = holeCoords["length"].as<unsigned>();
      if (hLen < 6)
        continue; // skip degenerate holes

      std::vector<Vec2d> holePts;
      holePts.reserve(hLen / 2);
      for (unsigned i = 0; i < hLen; i += 2) {
        holePts.push_back(
            {holeCoords[i].as<double>(), holeCoords[i + 1].as<double>()});
      }
      allHolePts.push_back(std::move(holePts));
    }

    // ── 3. Compute quadtree scale from bounding box ─────
    double diag = std::sqrt((xMax - xMin) * (xMax - xMin) +
                            (yMax - yMin) * (yMax - yMin));
    double qtScale = std::max(diag * 2.0, 1.0);

    // ── 4. Retry loop — halve edge length on failure ────
    //    TQMesh's advancing-front can fail if the edge
    //    length is too large for narrow gaps (e.g., between
    //    hole and exterior boundary).  Retrying with a
    //    smaller size typically resolves this.
    double sz = targetSize;
    const int maxAttempts = 4;

    for (int attempt = 0; attempt < maxAttempts; ++attempt) {
      if (attempt > 0)
        sz *= 0.5;

      TQMeshSetup::get_instance().set_quadtree_scale(qtScale);

      UserSizeFunction sizeFn = [sz](const Vec2d & /*p*/) { return sz; };
      Domain domain{sizeFn};

      // Exterior boundary (CCW)
      Boundary &bExt = domain.add_exterior_boundary();
      std::vector<int> extColors(extPts.size(), 1);
      bExt.set_shape_from_coordinates(extPts, extColors);

      // Hole boundaries (CW)
      for (const auto &holePts : allHolePts) {
        Boundary &bInt = domain.add_interior_boundary();
        std::vector<int> holeColors(holePts.size(), 2);
        bInt.set_shape_from_coordinates(holePts, holeColors);
      }

      // Create mesh
      MeshGenerator generator;
      Mesh &mesh = generator.new_mesh(domain);

      if (!generator.is_valid(mesh))
        continue; // invalid — retry with smaller size

      // Triangulation (advancing front)
      bool ok = generator.triangulation(mesh).generate_elements();
      if (!ok)
        continue; // incomplete — retry with smaller size

      // Tri-to-quad conversion (optional)
      if (wantQuad) {
        generator.tri2quad_modification(mesh).modify();
      }

      // Mixed smoothing
      if (smoothIter > 0) {
        generator.mixed_smoothing(mesh).smooth(smoothIter);
      }

      // Extract results and return (success)
      extractMeshResults(mesh, result);
      return result;
    }

    // All attempts failed
    result.error =
        "Triangulation failed after " + std::to_string(maxAttempts) +
        " attempts (last edge length: " + std::to_string(sz) +
        "). Try a smaller Edge Length or simplify the geometry.";

  } catch (const std::exception &e) {
    result.error = std::string("TQMesh error: ") + e.what();
  } catch (...) {
    result.error = "TQMesh: unknown error";
  }

  return result;
}

/*------------------------------------------------------------
 * Embind — register types and functions for JS access
 *
 * NOTE: MeshResult MUST be registered as class_, NOT value_object.
 * value_object's fromWireType destructs the struct immediately after
 * reading fields, which destroys the std::vector members before JS
 * can iterate them with .get().  class_ keeps the struct alive
 * until JS explicitly calls .delete().
 *------------------------------------------------------------*/
EMSCRIPTEN_BINDINGS(tqmesh_module) {

  register_vector<double>("VectorDouble");
  register_vector<int>("VectorInt");

  class_<MeshResult>("MeshResult")
      .property("coords", &MeshResult::coords)
      .property("triConn", &MeshResult::triConn)
      .property("quadConn", &MeshResult::quadConn)
      .property("nVerts", &MeshResult::nVerts)
      .property("nTris", &MeshResult::nTris)
      .property("nQuads", &MeshResult::nQuads)
      .property("error", &MeshResult::error);

  function("generateMesh", &generateMesh);
}
