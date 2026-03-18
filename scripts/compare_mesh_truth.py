#!/usr/bin/env python3
"""Compare viewer visual mesh output against Isaac Sim extracted truth."""

from __future__ import annotations

import argparse
import json
import math
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Compare viewer visual mesh dump with Isaac Sim truth JSON.")
    parser.add_argument("--truth", required=True, help="Path to Isaac Sim truth JSON.")
    parser.add_argument("--viewer", required=True, help="Path to viewer mesh dump JSON.")
    parser.add_argument("--output", required=True, help="Path to output comparison report JSON.")
    parser.add_argument("--pos-threshold", type=float, default=0.01, help="Position error threshold in meters.")
    parser.add_argument("--rot-threshold-deg", type=float, default=1.0, help="Rotation error threshold in degrees.")
    parser.add_argument("--size-abs-threshold", type=float, default=0.01, help="Absolute size threshold in meters.")
    parser.add_argument("--size-rel-threshold", type=float, default=0.15, help="Relative size threshold.")
    return parser.parse_args()


def _load_json(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def _matrix_translation(elements: list[float] | None) -> list[float] | None:
    if not elements or len(elements) < 16:
        return None
    return [float(elements[12]), float(elements[13]), float(elements[14])]


def _matrix_quaternion_wxyz(elements: list[float] | None) -> list[float] | None:
    if not elements or len(elements) < 16:
        return None

    # Three.js matrix elements are column-major.
    m11, m12, m13 = float(elements[0]), float(elements[4]), float(elements[8])
    m21, m22, m23 = float(elements[1]), float(elements[5]), float(elements[9])
    m31, m32, m33 = float(elements[2]), float(elements[6]), float(elements[10])

    sx = math.sqrt(max(m11 * m11 + m21 * m21 + m31 * m31, 0.0))
    sy = math.sqrt(max(m12 * m12 + m22 * m22 + m32 * m32, 0.0))
    sz = math.sqrt(max(m13 * m13 + m23 * m23 + m33 * m33, 0.0))
    if sx > 1e-12:
        m11, m21, m31 = m11 / sx, m21 / sx, m31 / sx
    if sy > 1e-12:
        m12, m22, m32 = m12 / sy, m22 / sy, m32 / sy
    if sz > 1e-12:
        m13, m23, m33 = m13 / sz, m23 / sz, m33 / sz

    trace = m11 + m22 + m33
    if trace > 0.0:
        s = math.sqrt(trace + 1.0) * 2.0
        w = 0.25 * s
        x = (m32 - m23) / s
        y = (m13 - m31) / s
        z = (m21 - m12) / s
    elif m11 > m22 and m11 > m33:
        s = math.sqrt(1.0 + m11 - m22 - m33) * 2.0
        w = (m32 - m23) / s
        x = 0.25 * s
        y = (m12 + m21) / s
        z = (m13 + m31) / s
    elif m22 > m33:
        s = math.sqrt(1.0 + m22 - m11 - m33) * 2.0
        w = (m13 - m31) / s
        x = (m12 + m21) / s
        y = 0.25 * s
        z = (m23 + m32) / s
    else:
        s = math.sqrt(1.0 + m33 - m11 - m22) * 2.0
        w = (m21 - m12) / s
        x = (m13 + m31) / s
        y = (m23 + m32) / s
        z = 0.25 * s

    norm = math.sqrt(max(w * w + x * x + y * y + z * z, 0.0))
    if norm <= 1e-12:
        return None
    return [w / norm, x / norm, y / norm, z / norm]


def _matrix_scale(elements: list[float] | None) -> list[float] | None:
    if not elements or len(elements) < 16:
        return None
    sx = math.sqrt(max(float(elements[0]) ** 2 + float(elements[1]) ** 2 + float(elements[2]) ** 2, 0.0))
    sy = math.sqrt(max(float(elements[4]) ** 2 + float(elements[5]) ** 2 + float(elements[6]) ** 2, 0.0))
    sz = math.sqrt(max(float(elements[8]) ** 2 + float(elements[9]) ** 2 + float(elements[10]) ** 2, 0.0))
    return [sx, sy, sz]


def _normalize_quaternion_wxyz(quaternion_wxyz: list[float] | None) -> list[float] | None:
    if quaternion_wxyz is None or len(quaternion_wxyz) < 4:
        return None
    w = float(quaternion_wxyz[0])
    x = float(quaternion_wxyz[1])
    y = float(quaternion_wxyz[2])
    z = float(quaternion_wxyz[3])
    norm = math.sqrt(max(w * w + x * x + y * y + z * z, 0.0))
    if norm <= 1e-12:
        return None
    return [w / norm, x / norm, y / norm, z / norm]


def _quat_angle_deg(lhs_wxyz: list[float] | None, rhs_wxyz: list[float] | None) -> float | None:
    lhs = _normalize_quaternion_wxyz(lhs_wxyz)
    rhs = _normalize_quaternion_wxyz(rhs_wxyz)
    if lhs is None or rhs is None:
        return None
    dot = 0.0
    for index in range(4):
        dot += float(lhs[index]) * float(rhs[index])
    dot = abs(dot)
    dot = max(-1.0, min(1.0, dot))
    return math.degrees(2.0 * math.acos(dot))


def _vector_distance(lhs: list[float] | None, rhs: list[float] | None) -> float | None:
    if lhs is None or rhs is None:
        return None
    return math.dist([float(lhs[0]), float(lhs[1]), float(lhs[2])], [float(rhs[0]), float(rhs[1]), float(rhs[2])])


def _sorted_size(size: list[float] | None) -> list[float] | None:
    if size is None or len(size) < 3:
        return None
    values = [abs(float(size[0])), abs(float(size[1])), abs(float(size[2]))]
    values.sort()
    return values


def _size_errors(viewer_size: list[float] | None, truth_size: list[float] | None) -> tuple[float | None, float | None]:
    left = _sorted_size(viewer_size)
    right = _sorted_size(truth_size)
    if left is None or right is None:
        return None, None

    absolute_errors: list[float] = []
    relative_errors: list[float] = []
    for index in range(3):
        absolute_delta = abs(left[index] - right[index])
        reference = max(abs(right[index]), 1e-9)
        relative_delta = absolute_delta / reference
        absolute_errors.append(absolute_delta)
        relative_errors.append(relative_delta)
    return max(absolute_errors), max(relative_errors)


def _scale_size_by_matrix(size: list[float] | None, matrix_elements: list[float] | None) -> list[float] | None:
    if size is None or len(size) < 3:
        return None
    scale = _matrix_scale(matrix_elements)
    if scale is None:
        return None
    return [
        abs(float(size[0])) * abs(float(scale[0])),
        abs(float(size[1])) * abs(float(scale[1])),
        abs(float(size[2])) * abs(float(scale[2])),
    ]


def _scale_size_by_vector(size: list[float] | None, scale: list[float] | None) -> list[float] | None:
    if size is None or len(size) < 3 or scale is None or len(scale) < 3:
        return None
    return [
        abs(float(size[0])) * abs(float(scale[0])),
        abs(float(size[1])) * abs(float(scale[1])),
        abs(float(size[2])) * abs(float(scale[2])),
    ]


def _extract_truth_world_scale(entry: dict[str, Any]) -> list[float] | None:
    world_scale = entry.get("world_scale")
    if isinstance(world_scale, list) and len(world_scale) >= 3:
        return [abs(float(world_scale[0])), abs(float(world_scale[1])), abs(float(world_scale[2]))]

    world_pose = entry.get("world_pose")
    if isinstance(world_pose, dict):
        pose_scale = world_pose.get("scale")
        if isinstance(pose_scale, list) and len(pose_scale) >= 3:
            return [abs(float(pose_scale[0])), abs(float(pose_scale[1])), abs(float(pose_scale[2]))]
    return None


def _round_signature_number(value: Any, digits: int = 6) -> float | None:
    try:
        numeric = float(value)
    except Exception:
        return None
    if not math.isfinite(numeric):
        return None
    return round(numeric, digits)


def _extract_normalized_category_suffix(path_value: Any) -> str | None:
    path_text = str(path_value or "").strip()
    if not path_text:
        return None
    normalized_path = path_text.replace("\\", "/")
    parts = normalized_path.split("/")
    for index, segment in enumerate(parts):
        lowered = segment.lower()
        if lowered in {"visuals", "meshes", "collisions", "colliders"}:
            suffix = "/".join(part for part in parts[index + 1 :] if part)
            return suffix or None
    return None


def _build_viewer_geometry_signature(viewer_entry: dict[str, Any]) -> tuple[Any, ...] | None:
    local_bounds = viewer_entry.get("local_bounds")
    size_signature = None
    if isinstance(local_bounds, dict):
        size = local_bounds.get("size")
        if isinstance(size, list) and len(size) >= 3:
            size_signature = tuple(_round_signature_number(value) for value in size[:3])
    return size_signature


def _extract_viewer_vertex_count(viewer_entry: dict[str, Any]) -> int | None:
    vertex_count = viewer_entry.get("vertex_count")
    try:
        return int(vertex_count) if vertex_count is not None else None
    except Exception:
        return None


def _normalized_suffixes_match(left: str | None, right: str | None) -> bool:
    if not left or not right:
        return False
    if left == right:
        return True
    return left.endswith(f"/{right}") or right.endswith(f"/{left}")


def _collect_resolved_duplicate_signatures(viewer_entries: list[dict[str, Any]]) -> list[tuple[str, tuple[Any, ...], int | None]]:
    resolved_entries: list[tuple[str, tuple[Any, ...], int | None]] = []
    for viewer_entry in viewer_entries:
        resolved_path_value = viewer_entry.get("resolved_path") or viewer_entry.get("resolved_visual_path")
        resolved_suffix = _extract_normalized_category_suffix(resolved_path_value)
        geometry_signature = _build_viewer_geometry_signature(viewer_entry)
        if not resolved_suffix or geometry_signature is None:
            continue
        resolved_entries.append((resolved_suffix, geometry_signature, _extract_viewer_vertex_count(viewer_entry)))
    return resolved_entries


def _is_duplicate_of_resolved_viewer_entry(
    viewer_entry: dict[str, Any],
    resolved_duplicate_signatures: list[tuple[str, tuple[Any, ...], int | None]],
) -> bool:
    entry_suffix = _extract_normalized_category_suffix(viewer_entry.get("id"))
    entry_signature = _build_viewer_geometry_signature(viewer_entry)
    entry_vertex_count = _extract_viewer_vertex_count(viewer_entry)
    if not entry_suffix or entry_signature is None:
        return False
    loose_matches = 0
    for resolved_suffix, resolved_signature, resolved_vertex_count in resolved_duplicate_signatures:
        if entry_signature != resolved_signature:
            continue
        if entry_vertex_count is not None and resolved_vertex_count is not None and entry_vertex_count == resolved_vertex_count:
            loose_matches += 1
        if _normalized_suffixes_match(entry_suffix, resolved_suffix):
            return True
    return loose_matches == 1 and entry_vertex_count is not None


def _is_tiny_unresolved_fallback_visual(viewer_entry: dict[str, Any]) -> bool:
    primitive_type = str(viewer_entry.get("primitive_fallback_type") or "").lower()
    if primitive_type not in {"sphere", "capsule", "cylinder", "cube", "box"}:
        return False

    local_bounds = viewer_entry.get("local_bounds")
    if not isinstance(local_bounds, dict):
        return False
    size = local_bounds.get("size")
    if not isinstance(size, list) or len(size) < 3:
        return False

    try:
        max_size = max(abs(float(size[0])), abs(float(size[1])), abs(float(size[2])))
    except Exception:
        return False
    return max_size <= 0.01


def _is_unresolved_nonrenderable_visual(viewer_entry: dict[str, Any]) -> bool:
    vertex_count = viewer_entry.get("vertex_count")
    try:
        if int(vertex_count or 0) > 0:
            return False
    except Exception:
        return False

    local_bounds = viewer_entry.get("local_bounds")
    if not isinstance(local_bounds, dict):
        return True

    size = local_bounds.get("size")
    if not isinstance(size, list) or len(size) < 3:
        return True

    try:
        max_size = max(abs(float(size[0])), abs(float(size[1])), abs(float(size[2])))
    except Exception:
        return True
    return max_size <= 1e-9


def _extract_truth_visual_meshes(truth: dict[str, Any]) -> list[dict[str, Any]]:
    meshes_section = truth.get("meshes", {})
    meshes = meshes_section.get("meshes")
    if not isinstance(meshes, list):
        return []

    result: list[dict[str, Any]] = []
    for entry in meshes:
        if not isinstance(entry, dict):
            continue
        if entry.get("category") != "visual":
            continue
        result.append(entry)
    return result


def _extract_viewer_visual_meshes(viewer: dict[str, Any]) -> list[dict[str, Any]]:
    meshes = viewer.get("visuals")
    if not isinstance(meshes, list):
        meshes = viewer.get("meshes")
    if not isinstance(meshes, list):
        return []

    result: list[dict[str, Any]] = []
    for entry in meshes:
        if not isinstance(entry, dict):
            continue
        if entry.get("category") != "visual":
            continue
        result.append(entry)
    return result


def main() -> None:
    args = parse_args()
    truth_path = Path(args.truth).expanduser().resolve()
    viewer_path = Path(args.viewer).expanduser().resolve()
    output_path = Path(args.output).expanduser().resolve()

    truth = _load_json(truth_path)
    viewer = _load_json(viewer_path)

    truth_meshes = _extract_truth_visual_meshes(truth)
    truth_by_path: dict[str, dict[str, Any]] = {}
    for entry in truth_meshes:
        path = entry.get("path")
        if isinstance(path, str) and path:
            truth_by_path[path] = entry

    viewer_visuals = _extract_viewer_visual_meshes(viewer)
    resolved_duplicate_signatures = _collect_resolved_duplicate_signatures(viewer_visuals)

    compared_entries: list[dict[str, Any]] = []
    unresolved_viewer_ids: list[str] = []
    ignored_unresolved_viewers: list[dict[str, Any]] = []
    viewer_resolved_paths: set[str] = set()
    resolved_without_truth: list[dict[str, Any]] = []

    for viewer_entry in viewer_visuals:
        viewer_id = str(viewer_entry.get("id") or "")
        resolved_path_value = viewer_entry.get("resolved_path") or viewer_entry.get("resolved_visual_path")
        resolved_path = str(resolved_path_value) if isinstance(resolved_path_value, str) else None
        if not resolved_path:
            if _is_duplicate_of_resolved_viewer_entry(viewer_entry, resolved_duplicate_signatures):
                ignored_unresolved_viewers.append(
                    {
                        "id": viewer_id,
                        "reason": "duplicate_of_resolved_visual",
                    }
                )
                continue
            if _is_unresolved_nonrenderable_visual(viewer_entry):
                ignored_unresolved_viewers.append(
                    {
                        "id": viewer_id,
                        "vertex_count": viewer_entry.get("vertex_count"),
                        "local_bounds": viewer_entry.get("local_bounds"),
                    }
                )
                continue
            if _is_tiny_unresolved_fallback_visual(viewer_entry):
                ignored_unresolved_viewers.append(
                    {
                        "id": viewer_id,
                        "primitive_fallback_type": viewer_entry.get("primitive_fallback_type"),
                        "local_bounds": viewer_entry.get("local_bounds"),
                    }
                )
                continue
            unresolved_viewer_ids.append(viewer_id)
            continue

        viewer_resolved_paths.add(resolved_path)
        truth_entry = truth_by_path.get(resolved_path)
        if truth_entry is None:
            resolved_without_truth.append({"id": viewer_id, "resolved_path": resolved_path})
            continue

        viewer_matrix = viewer_entry.get("world_matrix")
        viewer_matrix_list = viewer_matrix if isinstance(viewer_matrix, list) else None
        viewer_position = _matrix_translation(viewer_matrix_list)
        viewer_rotation = _matrix_quaternion_wxyz(viewer_matrix_list)

        truth_pose = truth_entry.get("world_pose", {})
        if not isinstance(truth_pose, dict):
            truth_pose = {}
        truth_position = truth_pose.get("position")
        truth_rotation = truth_pose.get("rotation_wxyz")

        viewer_bounds = viewer_entry.get("local_bounds", {})
        if not isinstance(viewer_bounds, dict):
            viewer_bounds = {}
        viewer_size = viewer_bounds.get("size")
        viewer_size_effective = _scale_size_by_matrix(
            viewer_size if isinstance(viewer_size, list) else None,
            viewer_matrix_list,
        )
        truth_size = truth_entry.get("extent_size_local")
        prim_type = str(truth_entry.get("prim_type") or "")
        truth_size_effective = (
            _scale_size_by_vector(
                truth_size if isinstance(truth_size, list) else None,
                _extract_truth_world_scale(truth_entry),
            )
            if prim_type == "mesh"
            else None
        )

        pos_error_m = _vector_distance(
            viewer_position if isinstance(viewer_position, list) else None,
            truth_position if isinstance(truth_position, list) else None,
        )
        rot_error_deg = _quat_angle_deg(
            viewer_rotation if isinstance(viewer_rotation, list) else None,
            truth_rotation if isinstance(truth_rotation, list) else None,
        )
        size_abs_error_m, size_rel_error = _size_errors(
            viewer_size_effective or (viewer_size if isinstance(viewer_size, list) else None),
            truth_size_effective or (truth_size if isinstance(truth_size, list) else None),
        )

        failed_position = pos_error_m is not None and pos_error_m > args.pos_threshold
        failed_size = (
            size_abs_error_m is not None
            and size_rel_error is not None
            and (size_abs_error_m > args.size_abs_threshold and size_rel_error > args.size_rel_threshold)
        )
        rotation_ambiguity_180 = False
        failed_rotation = rot_error_deg is not None and rot_error_deg > args.rot_threshold_deg
        if failed_rotation and rot_error_deg is not None:
            pos_within_threshold = pos_error_m is not None and pos_error_m <= args.pos_threshold
            size_within_threshold = (
                size_abs_error_m is not None
                and size_rel_error is not None
                and size_abs_error_m <= args.size_abs_threshold
                and size_rel_error <= args.size_rel_threshold
            )
            if rot_error_deg >= 179.9 and pos_within_threshold and size_within_threshold:
                failed_rotation = False
                rotation_ambiguity_180 = True

        compared_entries.append(
            {
                "id": viewer_id,
                "resolved_path": resolved_path,
                "pos_error_m": pos_error_m,
                "rot_error_deg": rot_error_deg,
                "size_abs_error_m": size_abs_error_m,
                "size_rel_error": size_rel_error,
                "failed_position": failed_position,
                "failed_rotation": failed_rotation,
                "failed_size": failed_size,
                "rotation_ambiguity_180": rotation_ambiguity_180,
                "viewer_position": viewer_position,
                "truth_position": truth_position,
                "viewer_rotation_wxyz": viewer_rotation,
                "truth_rotation_wxyz": truth_rotation,
                "viewer_size_local": viewer_size,
                "viewer_size_effective": viewer_size_effective,
                "truth_size_local": truth_size,
                "truth_size_effective": truth_size_effective,
            }
        )

    compared_entries.sort(
        key=lambda entry: (
            float(entry.get("pos_error_m") or -1.0),
            float(entry.get("rot_error_deg") or -1.0),
            float(entry.get("size_abs_error_m") or -1.0),
        ),
        reverse=True,
    )

    missing_truth_paths = sorted(path for path in truth_by_path.keys() if path not in viewer_resolved_paths)

    failed_entries = [
        entry
        for entry in compared_entries
        if entry.get("failed_position") or entry.get("failed_rotation") or entry.get("failed_size")
    ]
    rotation_ambiguity_entries = [
        entry
        for entry in compared_entries
        if entry.get("rotation_ambiguity_180")
    ]

    max_pos_error_m = max((float(entry["pos_error_m"]) for entry in compared_entries if entry.get("pos_error_m") is not None), default=0.0)
    max_rot_error_deg = max((float(entry["rot_error_deg"]) for entry in compared_entries if entry.get("rot_error_deg") is not None), default=0.0)
    max_size_abs_error_m = max((float(entry["size_abs_error_m"]) for entry in compared_entries if entry.get("size_abs_error_m") is not None), default=0.0)
    max_size_rel_error = max((float(entry["size_rel_error"]) for entry in compared_entries if entry.get("size_rel_error") is not None), default=0.0)

    report = {
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "source_truth": str(truth_path),
        "source_viewer": str(viewer_path),
        "thresholds": {
            "pos_threshold_m": args.pos_threshold,
            "rot_threshold_deg": args.rot_threshold_deg,
            "size_abs_threshold_m": args.size_abs_threshold,
            "size_rel_threshold": args.size_rel_threshold,
        },
        "summary": {
            "truth_visual_mesh_count": len(truth_by_path),
            "viewer_visual_mesh_count": len(viewer_visuals),
            "compared_count": len(compared_entries),
            "unresolved_viewer_count": len(unresolved_viewer_ids),
            "ignored_unresolved_viewer_count": len(ignored_unresolved_viewers),
            "resolved_without_truth_count": len(resolved_without_truth),
            "missing_truth_paths_count": len(missing_truth_paths),
            "failed_count": len(failed_entries),
            "rotation_ambiguity_180_count": len(rotation_ambiguity_entries),
            "max_pos_error_m": max_pos_error_m,
            "max_rot_error_deg": max_rot_error_deg,
            "max_size_abs_error_m": max_size_abs_error_m,
            "max_size_rel_error": max_size_rel_error,
            "pass": len(failed_entries) == 0 and len(unresolved_viewer_ids) == 0 and len(missing_truth_paths) == 0,
        },
        "unresolved_viewer_ids": sorted(set(unresolved_viewer_ids)),
        "ignored_unresolved_viewers": sorted(
            ignored_unresolved_viewers,
            key=lambda item: str(item.get("id")),
        ),
        "resolved_without_truth": sorted(resolved_without_truth, key=lambda item: (str(item.get("resolved_path")), str(item.get("id")))),
        "missing_truth_paths": missing_truth_paths,
        "top_errors": compared_entries[:40],
    }

    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("w", encoding="utf-8") as handle:
        json.dump(report, handle, ensure_ascii=False, indent=2)
        handle.write("\n")

    print(f"Truth: {truth_path}")
    print(f"Viewer: {viewer_path}")
    print(f"Output: {output_path}")
    print(
        "Summary: "
        f"compared={report['summary']['compared_count']}, "
        f"failed={report['summary']['failed_count']}, "
        f"unresolved={report['summary']['unresolved_viewer_count']}, "
        f"missing_truth={report['summary']['missing_truth_paths_count']}, "
        f"pass={report['summary']['pass']}"
    )


if __name__ == "__main__":
    main()
