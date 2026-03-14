#***********************************************************
# CMakeLists.txt — Emscripten build for TQMesh WASM bridge
#
# Usage:
#   mkdir -p build && cd build
#   emcmake cmake .. -DCMAKE_BUILD_TYPE=Release
#   emmake make -j4
#***********************************************************
cmake_minimum_required(VERSION 3.10)

project(tqmesh_wasm LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# ── TQMesh source location ──────────────────────────────
# Relative path from FEPS-web/wasm/ to TQMesh/
set(TQMESH_ROOT "${CMAKE_SOURCE_DIR}/../../TQMesh")

# Verify TQMesh exists
if(NOT EXISTS "${TQMESH_ROOT}/src/algorithm/TQMesh.h")
    message(FATAL_ERROR
        "TQMesh not found at ${TQMESH_ROOT}. "
        "Set TQMESH_ROOT to the correct path.")
endif()

# ── Include paths ────────────────────────────────────────
include_directories(
    ${TQMESH_ROOT}/src/algorithm
    ${TQMESH_ROOT}/src/utils
    ${CMAKE_BINARY_DIR}               # TQMeshConfig.h
)

# ── Generate TQMeshConfig.h from template ────────────────
set(TQMesh_VERSION_MAJOR 1)
set(TQMesh_VERSION_MINOR 4)
configure_file(
    ${TQMESH_ROOT}/auxiliary/TQMeshConfig.h.in
    ${CMAKE_BINARY_DIR}/TQMeshConfig.h
)

# ── Compiler flags ───────────────────────────────────────
# Do NOT define TQMESH_USE_EXPRTK — avoids 1.6 MB exprtk dependency
add_compile_options(-Os -DNDEBUG)

# ── Build target ─────────────────────────────────────────
# TQMesh is header-only, so only the bridge file needs compilation
add_executable(tqmesh tqmesh_bridge.cpp)

# ── Emscripten linker flags ──────────────────────────────
set_target_properties(tqmesh PROPERTIES
    SUFFIX ".js"
)

target_link_options(tqmesh PRIVATE
    "--bind"
    "-sMODULARIZE=1"
    "-sEXPORT_NAME=TQMeshModule"
    "-sALLOW_MEMORY_GROWTH=1"
    "-sENVIRONMENT=web"
    "-sFILESYSTEM=0"
    "-sSINGLE_FILE=1"
    "-sINITIAL_MEMORY=16777216"
    "-Os"
)
