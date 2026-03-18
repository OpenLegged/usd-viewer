#!/usr/bin/env python3
"""Compare Isaac Sim truth extracted from original USD vs viewer round-trip USD."""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path
from typing import Any


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Compare Isaac truth from original USD and viewer round-trip USD.")
    parser.add_argument("--original", required=True, help="Path to Isaac truth JSON from the original USD.")
    parser.add_argument("--roundtrip", required=True, help="Path to Isaac truth JSON from the exported round-trip USD.")
    parser.add_argument("--output", required=True, help="Path to write comparison report JSON.")
    parser.add_argument("--pos-threshold", type=float, default=0.01, help="Position error threshold in meters.")
    parser.add_argument("--rot-threshold-deg", type=float, default=1.0, help="Rotation error threshold in degrees.")
    parser.add_argument("--size-abs-threshold", type=float, default=0.01, help="Absolute size threshold in meters.")
    parser.add_argument("--size-rel-threshold", type=float, default=0.15, help="Relative size threshold.")
    parser.add_argument("--axis-angle-threshold-deg", type=float, default=1.0, help="Joint axis angle threshold in degrees.")
    parser.add_argument("--limit-threshold-deg", type=float, default=0.5, help="Joint lower/upper limit threshold in degrees.")
    parser.add_argument("--mass-threshold", type=float, default=1e-4, help="Mass threshold in kg.")
    parser.add_argument("--com-threshold", type=float, default=1e-4, help="Center-of-mass threshold in meters.")
    parser.add_argument("--inertia-threshold", type=float, default=1e-4, help="Diagonal inertia threshold.")
    parser.add_argument(
        "--principal-axes-threshold-deg",
        type=float,
        default=1.0,
        help="Principal-axes angular threshold in degrees.",
    )
    return parser.parse_args()


def _load_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def _normalize_path(value: Any) -> str:
    text = str(value or "").strip().replace("<", "").replace(">", "")
    if not text:
        return ""
    return text if text.startswith("/") else f"/{text}"


def _path_basename(path: str) -> str:
    normalized = _normalize_path(path)
    segments = [segment for segment in normalized.split("/") if segment]
    return segments[-1] if segments else ""


def _to_finite_float(value: Any) -> float | None:
    try:
        numeric = float(value)
    except (TypeError, ValueError):
        return None
    return numeric if math.isfinite(numeric) else None


def _to_vector3(value: Any) -> list[float] | None:
    if not isinstance(value, (list, tuple)) or len(value) < 3:
        return None
    x = _to_finite_float(value[0])
    y = _to_finite_float(value[1])
    z = _to_finite_float(value[2])
    if x is None or y is None or z is None:
        return None
    return [x, y, z]


def _to_quaternion_wxyz(value: Any) -> list[float] | None:
    if not isinstance(value, (list, tuple)) or len(value) < 4:
        return None
    w = _to_finite_float(value[0])
    x = _to_finite_float(value[1])
    y = _to_finite_float(value[2])
    z = _to_finite_float(value[3])
    if w is None or x is None or y is None or z is None:
        return None
    norm = math.sqrt(max(w * w + x * x + y * y + z * z, 0.0))
    if norm <= 1e-12:
        return None
    return [w / norm, x / norm, y / norm, z / norm]


def _quat_angle_deg(lhs: list[float] | None, rhs: list[float] | None) -> float | None:
    left = _to_quaternion_wxyz(lhs)
    right = _to_quaternion_wxyz(rhs)
    if left is None or right is None:
        return None
    dot = abs(sum(float(left[index]) * float(right[index]) for index in range(4)))
    dot = max(-1.0, min(1.0, dot))
    return math.degrees(2.0 * math.acos(dot))


def _vector_distance(lhs: list[float] | None, rhs: list[float] | None) -> float | None:
    if lhs is None or rhs is None:
        return None
    return math.dist([float(lhs[0]), float(lhs[1]), float(lhs[2])], [float(rhs[0]), float(rhs[1]), float(rhs[2])])


def _vector_error(lhs: list[float] | None, rhs: list[float] | None) -> float | None:
    if lhs is None or rhs is None:
        return None
    return math.sqrt(sum((float(lhs[index]) - float(rhs[index])) ** 2 for index in range(3)))


def _sorted_size(size: list[float] | None) -> list[float] | None:
    if size is None or len(size) < 3:
        return None
    return sorted(float(component) for component in size[:3])


def _size_errors(lhs: list[float] | None, rhs: list[float] | None) -> tuple[float | None, float | None]:
    left = _sorted_size(lhs)
    right = _sorted_size(rhs)
    if left is None or right is None:
        return None, None
    abs_error = max(abs(left[index] - right[index]) for index in range(3))
    rel_error = 0.0
    for index in range(3):
      denom = max(abs(right[index]), 1e-9)
      rel_error = max(rel_error, abs(left[index] - right[index]) / denom)
    return abs_error, rel_error


def _normalize_axis_token(value: Any) -> str:
    token = str(value or "").strip().upper()
    if token.startswith("Y"):
        return "Y"
    if token.startswith("Z"):
        return "Z"
    if token.startswith("X"):
        return "X"
    return ""


def _build_primary_and_fallback_maps(entries: list[dict[str, Any]], path_key: str) -> tuple[dict[str, dict[str, Any]], dict[str, list[dict[str, Any]]]]:
    by_path: dict[str, dict[str, Any]] = {}
    by_basename: dict[str, list[dict[str, Any]]] = {}
    for entry in entries:
        path_value = _normalize_path(entry.get(path_key))
        if path_value and path_value not in by_path:
            by_path[path_value] = entry
        basename = _path_basename(path_value)
        if basename:
            by_basename.setdefault(basename, []).append(entry)
    return by_path, by_basename


def _resolve_matching_entry(entry: dict[str, Any], candidate_by_path: dict[str, dict[str, Any]], candidate_by_basename: dict[str, list[dict[str, Any]]], path_key: str) -> dict[str, Any] | None:
    path_value = _normalize_path(entry.get(path_key))
    if path_value and path_value in candidate_by_path:
        return candidate_by_path[path_value]
    basename = _path_basename(path_value)
    if not basename:
        return None
    matches = candidate_by_basename.get(basename) or []
    return matches[0] if matches else None


def compare_meshes(original: dict[str, Any], roundtrip: dict[str, Any], args: argparse.Namespace) -> dict[str, Any]:
    original_entries = list(original.get("meshes", {}).get("meshes", []))
    roundtrip_entries = list(roundtrip.get("meshes", {}).get("meshes", []))
    roundtrip_by_path, roundtrip_by_basename = _build_primary_and_fallback_maps(roundtrip_entries, "path")
    compared: list[dict[str, Any]] = []
    missing: list[str] = []
    matched_paths: set[str] = set()

    for original_entry in original_entries:
        match = _resolve_matching_entry(original_entry, roundtrip_by_path, roundtrip_by_basename, "path")
        original_path = _normalize_path(original_entry.get("path"))
        if match is None:
            if original_path:
                missing.append(original_path)
            continue
        roundtrip_path = _normalize_path(match.get("path"))
        if roundtrip_path:
            matched_paths.add(roundtrip_path)

        original_pose = original_entry.get("world_pose") or {}
        roundtrip_pose = match.get("world_pose") or {}
        pos_error = _vector_distance(
            _to_vector3(roundtrip_pose.get("position")),
            _to_vector3(original_pose.get("position")),
        )
        rot_error = _quat_angle_deg(
            roundtrip_pose.get("rotation_wxyz"),
            original_pose.get("rotation_wxyz"),
        )
        size_abs_error, size_rel_error = _size_errors(
            _to_vector3(match.get("extent_size_local")),
            _to_vector3(original_entry.get("extent_size_local")),
        )
        failed = False
        if pos_error is not None and pos_error > args.pos_threshold:
            failed = True
        if rot_error is not None and rot_error > args.rot_threshold_deg:
            failed = True
        if size_abs_error is not None and size_abs_error > args.size_abs_threshold:
            failed = True
        if size_rel_error is not None and size_rel_error > args.size_rel_threshold:
            failed = True

        compared.append(
            {
                "path_original": original_path,
                "path_roundtrip": roundtrip_path,
                "category_original": original_entry.get("category"),
                "category_roundtrip": match.get("category"),
                "position_error_m": pos_error,
                "rotation_error_deg": rot_error,
                "size_abs_error_m": size_abs_error,
                "size_rel_error": size_rel_error,
                "failed": failed,
            }
        )

    extra_paths = sorted(path for path in roundtrip_by_path.keys() if path and path not in matched_paths)
    failed_count = sum(1 for entry in compared if bool(entry.get("failed")))
    return {
        "summary": {
            "original_count": len(original_entries),
            "roundtrip_count": len(roundtrip_entries),
            "compared_count": len(compared),
            "missing_count": len(missing),
            "extra_count": len(extra_paths),
            "failed_count": failed_count,
            "passed": failed_count == 0 and not missing,
        },
        "missing_paths": missing,
        "extra_paths": extra_paths,
        "entries": compared,
    }


def compare_colliders(original: dict[str, Any], roundtrip: dict[str, Any], args: argparse.Namespace) -> dict[str, Any]:
    original_entries = list(original.get("colliders", {}).get("collision_primitives", []))
    roundtrip_entries = list(roundtrip.get("colliders", {}).get("collision_primitives", []))
    roundtrip_by_path, roundtrip_by_basename = _build_primary_and_fallback_maps(roundtrip_entries, "path")
    compared: list[dict[str, Any]] = []
    missing: list[str] = []
    matched_paths: set[str] = set()

    for original_entry in original_entries:
        match = _resolve_matching_entry(original_entry, roundtrip_by_path, roundtrip_by_basename, "path")
        original_path = _normalize_path(original_entry.get("path"))
        if match is None:
            if original_path:
                missing.append(original_path)
            continue
        roundtrip_path = _normalize_path(match.get("path"))
        if roundtrip_path:
            matched_paths.add(roundtrip_path)

        original_pose = original_entry.get("world_pose") or {}
        roundtrip_pose = match.get("world_pose") or {}
        pos_error = _vector_distance(
            _to_vector3(roundtrip_pose.get("position")),
            _to_vector3(original_pose.get("position")),
        )
        rot_error = _quat_angle_deg(
            roundtrip_pose.get("rotation_wxyz"),
            original_pose.get("rotation_wxyz"),
        )
        size_abs_error, size_rel_error = _size_errors(
            _to_vector3(match.get("extent_size_local")),
            _to_vector3(original_entry.get("extent_size_local")),
        )
        failed = False
        if str(match.get("prim_type") or "") != str(original_entry.get("prim_type") or ""):
            failed = True
        if pos_error is not None and pos_error > args.pos_threshold:
            failed = True
        if rot_error is not None and rot_error > args.rot_threshold_deg:
            failed = True
        if size_abs_error is not None and size_abs_error > args.size_abs_threshold:
            failed = True
        if size_rel_error is not None and size_rel_error > args.size_rel_threshold:
            failed = True

        compared.append(
            {
                "path_original": original_path,
                "path_roundtrip": roundtrip_path,
                "prim_type_original": original_entry.get("prim_type"),
                "prim_type_roundtrip": match.get("prim_type"),
                "position_error_m": pos_error,
                "rotation_error_deg": rot_error,
                "size_abs_error_m": size_abs_error,
                "size_rel_error": size_rel_error,
                "failed": failed,
            }
        )

    extra_paths = sorted(path for path in roundtrip_by_path.keys() if path and path not in matched_paths)
    failed_count = sum(1 for entry in compared if bool(entry.get("failed")))
    return {
        "summary": {
            "original_count": len(original_entries),
            "roundtrip_count": len(roundtrip_entries),
            "compared_count": len(compared),
            "missing_count": len(missing),
            "extra_count": len(extra_paths),
            "failed_count": failed_count,
            "passed": failed_count == 0 and not missing,
        },
        "missing_paths": missing,
        "extra_paths": extra_paths,
        "entries": compared,
    }


def compare_joints(original: dict[str, Any], roundtrip: dict[str, Any], args: argparse.Namespace) -> dict[str, Any]:
    original_entries = list(original.get("articulation", {}).get("joints", []))
    roundtrip_entries = list(roundtrip.get("articulation", {}).get("joints", []))
    roundtrip_by_path, roundtrip_by_basename = _build_primary_and_fallback_maps(roundtrip_entries, "path")
    compared: list[dict[str, Any]] = []
    missing: list[str] = []
    matched_paths: set[str] = set()

    for original_entry in original_entries:
        match = _resolve_matching_entry(original_entry, roundtrip_by_path, roundtrip_by_basename, "path")
        original_path = _normalize_path(original_entry.get("path"))
        if match is None:
            if original_path:
                missing.append(original_path)
            continue
        roundtrip_path = _normalize_path(match.get("path"))
        if roundtrip_path:
            matched_paths.add(roundtrip_path)

        axis_error_deg = None
        original_axis = _to_vector3(original_entry.get("axis_world"))
        roundtrip_axis = _to_vector3(match.get("axis_world"))
        if original_axis is not None and roundtrip_axis is not None:
            original_norm = math.sqrt(sum(component * component for component in original_axis))
            roundtrip_norm = math.sqrt(sum(component * component for component in roundtrip_axis))
            if original_norm > 1e-12 and roundtrip_norm > 1e-12:
                dot = sum((roundtrip_axis[index] / roundtrip_norm) * (original_axis[index] / original_norm) for index in range(3))
                dot = max(-1.0, min(1.0, abs(dot)))
                axis_error_deg = math.degrees(math.acos(dot))

        lower_limit_error_deg = None
        upper_limit_error_deg = None
        original_lower = _to_finite_float(original_entry.get("lower_limit_deg"))
        roundtrip_lower = _to_finite_float(match.get("lower_limit_deg"))
        original_upper = _to_finite_float(original_entry.get("upper_limit_deg"))
        roundtrip_upper = _to_finite_float(match.get("upper_limit_deg"))
        if original_lower is not None and roundtrip_lower is not None:
            lower_limit_error_deg = abs(roundtrip_lower - original_lower)
        if original_upper is not None and roundtrip_upper is not None:
            upper_limit_error_deg = abs(roundtrip_upper - original_upper)

        failed = False
        if _normalize_axis_token(match.get("axis")) != _normalize_axis_token(original_entry.get("axis")):
            failed = True
        if axis_error_deg is not None and axis_error_deg > args.axis_angle_threshold_deg:
            failed = True
        if lower_limit_error_deg is not None and lower_limit_error_deg > args.limit_threshold_deg:
            failed = True
        if upper_limit_error_deg is not None and upper_limit_error_deg > args.limit_threshold_deg:
            failed = True

        compared.append(
            {
                "path_original": original_path,
                "path_roundtrip": roundtrip_path,
                "axis_original": original_entry.get("axis"),
                "axis_roundtrip": match.get("axis"),
                "axis_angle_error_deg": axis_error_deg,
                "lower_limit_error_deg": lower_limit_error_deg,
                "upper_limit_error_deg": upper_limit_error_deg,
                "failed": failed,
            }
        )

    extra_paths = sorted(path for path in roundtrip_by_path.keys() if path and path not in matched_paths)
    failed_count = sum(1 for entry in compared if bool(entry.get("failed")))
    return {
        "summary": {
            "original_count": len(original_entries),
            "roundtrip_count": len(roundtrip_entries),
            "compared_count": len(compared),
            "missing_count": len(missing),
            "extra_count": len(extra_paths),
            "failed_count": failed_count,
            "passed": failed_count == 0 and not missing,
        },
        "missing_paths": missing,
        "extra_paths": extra_paths,
        "entries": compared,
    }


def compare_inertial(original: dict[str, Any], roundtrip: dict[str, Any], args: argparse.Namespace) -> dict[str, Any]:
    original_entries = list(original.get("inertial", {}).get("links", []))
    roundtrip_entries = list(roundtrip.get("inertial", {}).get("links", []))
    roundtrip_by_path, roundtrip_by_basename = _build_primary_and_fallback_maps(roundtrip_entries, "path")
    compared: list[dict[str, Any]] = []
    missing: list[str] = []
    matched_paths: set[str] = set()

    for original_entry in original_entries:
        match = _resolve_matching_entry(original_entry, roundtrip_by_path, roundtrip_by_basename, "path")
        original_path = _normalize_path(original_entry.get("path"))
        if match is None:
            if original_path:
                missing.append(original_path)
            continue
        roundtrip_path = _normalize_path(match.get("path"))
        if roundtrip_path:
            matched_paths.add(roundtrip_path)

        mass_original = _to_finite_float(original_entry.get("mass"))
        mass_roundtrip = _to_finite_float(match.get("mass"))
        mass_error = abs(mass_roundtrip - mass_original) if mass_original is not None and mass_roundtrip is not None else None
        com_error = _vector_error(
            _to_vector3(match.get("center_of_mass_local")),
            _to_vector3(original_entry.get("center_of_mass_local")),
        )
        inertia_error = _vector_error(
            _to_vector3(match.get("diagonal_inertia")),
            _to_vector3(original_entry.get("diagonal_inertia")),
        )
        principal_axes_error_deg = _quat_angle_deg(
            match.get("principal_axes_local_wxyz"),
            original_entry.get("principal_axes_local_wxyz"),
        )

        failed = False
        if mass_error is not None and mass_error > args.mass_threshold:
            failed = True
        if com_error is not None and com_error > args.com_threshold:
            failed = True
        if inertia_error is not None and inertia_error > args.inertia_threshold:
            failed = True
        if principal_axes_error_deg is not None and principal_axes_error_deg > args.principal_axes_threshold_deg:
            failed = True

        compared.append(
            {
                "path_original": original_path,
                "path_roundtrip": roundtrip_path,
                "mass_error": mass_error,
                "com_error_m": com_error,
                "inertia_error": inertia_error,
                "principal_axes_error_deg": principal_axes_error_deg,
                "failed": failed,
            }
        )

    extra_paths = sorted(path for path in roundtrip_by_path.keys() if path and path not in matched_paths)
    failed_count = sum(1 for entry in compared if bool(entry.get("failed")))
    return {
        "summary": {
            "original_count": len(original_entries),
            "roundtrip_count": len(roundtrip_entries),
            "compared_count": len(compared),
            "missing_count": len(missing),
            "extra_count": len(extra_paths),
            "failed_count": failed_count,
            "passed": failed_count == 0 and not missing,
        },
        "missing_paths": missing,
        "extra_paths": extra_paths,
        "entries": compared,
    }


def main() -> None:
    args = parse_args()
    original_path = Path(args.original).expanduser().resolve()
    roundtrip_path = Path(args.roundtrip).expanduser().resolve()
    output_path = Path(args.output).expanduser().resolve()

    original = _load_json(original_path)
    roundtrip = _load_json(roundtrip_path)

    mesh_report = compare_meshes(original, roundtrip, args)
    collider_report = compare_colliders(original, roundtrip, args)
    joint_report = compare_joints(original, roundtrip, args)
    inertial_report = compare_inertial(original, roundtrip, args)

    passed = all(
        section["summary"]["passed"]
        for section in [mesh_report, collider_report, joint_report, inertial_report]
    )

    report = {
        "inputs": {
            "original": str(original_path),
            "roundtrip": str(roundtrip_path),
        },
        "thresholds": {
            "pos_threshold": args.pos_threshold,
            "rot_threshold_deg": args.rot_threshold_deg,
            "size_abs_threshold": args.size_abs_threshold,
            "size_rel_threshold": args.size_rel_threshold,
            "axis_angle_threshold_deg": args.axis_angle_threshold_deg,
            "limit_threshold_deg": args.limit_threshold_deg,
            "mass_threshold": args.mass_threshold,
            "com_threshold": args.com_threshold,
            "inertia_threshold": args.inertia_threshold,
            "principal_axes_threshold_deg": args.principal_axes_threshold_deg,
        },
        "summary": {
            "passed": passed,
            "mesh_passed": mesh_report["summary"]["passed"],
            "collider_passed": collider_report["summary"]["passed"],
            "joint_passed": joint_report["summary"]["passed"],
            "inertial_passed": inertial_report["summary"]["passed"],
        },
        "meshes": mesh_report,
        "colliders": collider_report,
        "joints": joint_report,
        "inertial": inertial_report,
    }

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(f"{json.dumps(report, indent=2, ensure_ascii=False)}\n", encoding="utf-8")
    print(f"Original: {original_path}")
    print(f"Roundtrip: {roundtrip_path}")
    print(f"Output: {output_path}")
    print(
        "Summary: "
        f"passed={passed} "
        f"meshes={mesh_report['summary']['failed_count']}failed "
        f"colliders={collider_report['summary']['failed_count']}failed "
        f"joints={joint_report['summary']['failed_count']}failed "
        f"inertial={inertial_report['summary']['failed_count']}failed"
    )
    if not passed:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
