#!/usr/bin/env python3
"""Compare viewer joint metadata against Isaac Sim extracted articulation truth."""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path
from typing import Any


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Compare viewer joint metadata with Isaac Sim truth JSON.")
    parser.add_argument("--truth", required=True, help="Path to Isaac Sim truth JSON.")
    parser.add_argument("--viewer", required=True, help="Path to viewer robot metadata JSON.")
    parser.add_argument("--output", required=True, help="Path to write comparison JSON report.")
    parser.add_argument(
        "--axis-angle-threshold-deg",
        type=float,
        default=1.0,
        help="Maximum allowed axis vector angle error in degrees.",
    )
    parser.add_argument(
        "--limit-threshold-deg",
        type=float,
        default=0.5,
        help="Maximum allowed absolute lower/upper limit error in degrees.",
    )
    return parser.parse_args()


def _load_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def _normalize_path(value: Any) -> str:
    text = str(value or "").strip().replace("<", "").replace(">", "")
    if not text:
        return ""
    if not text.startswith("/"):
        return f"/{text}"
    return text


def _normalize_axis_token(value: Any) -> str:
    token = str(value or "").strip().upper()
    if token.startswith("Y"):
        return "Y"
    if token.startswith("Z"):
        return "Z"
    if token.startswith("X"):
        return "X"
    return ""


def _to_finite_float(value: Any) -> float | None:
    try:
        numeric = float(value)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(numeric):
        return None
    return numeric


def _to_vector3(value: Any) -> list[float] | None:
    if isinstance(value, (list, tuple)) and len(value) >= 3:
        x = _to_finite_float(value[0])
        y = _to_finite_float(value[1])
        z = _to_finite_float(value[2])
        if x is None or y is None or z is None:
            return None
        return [x, y, z]
    if isinstance(value, dict):
        x = _to_finite_float(value.get("x", value.get("X")))
        y = _to_finite_float(value.get("y", value.get("Y")))
        z = _to_finite_float(value.get("z", value.get("Z")))
        if x is None or y is None or z is None:
            return None
        return [x, y, z]
    return None


def _to_quaternion_wxyz(value: Any) -> list[float] | None:
    if isinstance(value, (list, tuple)) and len(value) >= 4:
        w = _to_finite_float(value[0])
        x = _to_finite_float(value[1])
        y = _to_finite_float(value[2])
        z = _to_finite_float(value[3])
        if w is None or x is None or y is None or z is None:
            return None
        return [w, x, y, z]
    return None


def _normalize_vector(vector: list[float] | None) -> list[float] | None:
    if not vector:
        return None
    norm = math.sqrt(vector[0] * vector[0] + vector[1] * vector[1] + vector[2] * vector[2])
    if not math.isfinite(norm) or norm <= 1e-12:
        return None
    return [vector[0] / norm, vector[1] / norm, vector[2] / norm]


def _axis_vector_from_token(axis_token: str) -> list[float]:
    if axis_token == "Y":
        return [0.0, 1.0, 0.0]
    if axis_token == "Z":
        return [0.0, 0.0, 1.0]
    return [1.0, 0.0, 0.0]


def _normalize_quaternion_wxyz(quaternion_wxyz: list[float] | None) -> list[float] | None:
    if not quaternion_wxyz:
        return None
    w, x, y, z = quaternion_wxyz
    norm = math.sqrt(w * w + x * x + y * y + z * z)
    if not math.isfinite(norm) or norm <= 1e-12:
        return None
    return [w / norm, x / norm, y / norm, z / norm]


def _rotate_vector_by_quaternion_wxyz(vector: list[float], quaternion_wxyz: list[float] | None) -> list[float]:
    normalized_quat = _normalize_quaternion_wxyz(quaternion_wxyz)
    if not normalized_quat:
        return vector
    w, qx, qy, qz = normalized_quat
    vx, vy, vz = vector

    tx = 2.0 * (qy * vz - qz * vy)
    ty = 2.0 * (qz * vx - qx * vz)
    tz = 2.0 * (qx * vy - qy * vx)

    rx = vx + w * tx + (qy * tz - qz * ty)
    ry = vy + w * ty + (qz * tx - qx * tz)
    rz = vz + w * tz + (qx * ty - qy * tx)
    return [rx, ry, rz]


def _angle_deg_between_vectors(left: list[float] | None, right: list[float] | None) -> float | None:
    left_n = _normalize_vector(left)
    right_n = _normalize_vector(right)
    if not left_n or not right_n:
        return None
    dot = left_n[0] * right_n[0] + left_n[1] * right_n[1] + left_n[2] * right_n[2]
    dot = max(-1.0, min(1.0, dot))
    return math.degrees(math.acos(dot))


def _extract_truth_joints(truth: dict[str, Any]) -> list[dict[str, Any]]:
    articulation = truth.get("articulation")
    if not isinstance(articulation, dict):
        return []
    joints = articulation.get("joints")
    if not isinstance(joints, list):
        return []
    output: list[dict[str, Any]] = []
    for entry in joints:
        if not isinstance(entry, dict):
            continue
        output.append(
            {
                "joint_path": _normalize_path(entry.get("path")),
                "joint_name": str(entry.get("name") or "").strip(),
                "joint_type": str(entry.get("joint_type") or entry.get("jointType") or "").strip().lower(),
                "axis_token": _normalize_axis_token(entry.get("axis")),
                "body1_path": _normalize_path(entry.get("body1_path")),
                "lower_limit_deg": _to_finite_float(entry.get("lower_limit_deg")),
                "upper_limit_deg": _to_finite_float(entry.get("upper_limit_deg")),
                "local_rot0_wxyz": _to_quaternion_wxyz(entry.get("local_rot0_wxyz")),
                "local_rot1_wxyz": _to_quaternion_wxyz(entry.get("local_rot1_wxyz")),
            }
        )
    output.sort(key=lambda item: (item.get("joint_path", ""), item.get("joint_name", "")))
    return output


def _extract_viewer_joints(viewer: dict[str, Any]) -> list[dict[str, Any]]:
    joints = viewer.get("joints")
    if not isinstance(joints, list):
        joints = viewer.get("jointCatalogEntries")
    if not isinstance(joints, list):
        joints = []
    output: list[dict[str, Any]] = []
    for entry in joints:
        if not isinstance(entry, dict):
            continue
        output.append(
            {
                "joint_path": _normalize_path(entry.get("jointPath") or entry.get("joint_path")),
                "joint_name": str(entry.get("jointName") or entry.get("joint_name") or "").strip(),
                "joint_type": str(entry.get("jointType") or entry.get("joint_type") or "").strip().lower(),
                "link_path": _normalize_path(
                    entry.get("linkPath")
                    or entry.get("childLinkPath")
                    or entry.get("link_path")
                    or entry.get("child_link_path")
                ),
                "axis_token": _normalize_axis_token(entry.get("axisToken") or entry.get("axis")),
                "axis_local": _to_vector3(entry.get("axisLocal") or entry.get("axis_local")),
                "lower_limit_deg": _to_finite_float(entry.get("lowerLimitDeg") or entry.get("lower_limit_deg")),
                "upper_limit_deg": _to_finite_float(entry.get("upperLimitDeg") or entry.get("upper_limit_deg")),
            }
        )
    output.sort(key=lambda item: (item.get("joint_path", ""), item.get("link_path", "")))
    return output

def main() -> None:
    args = parse_args()
    truth_path = Path(args.truth).expanduser().resolve()
    viewer_path = Path(args.viewer).expanduser().resolve()
    output_path = Path(args.output).expanduser().resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)

    truth = _load_json(truth_path)
    viewer = _load_json(viewer_path)
    truth_joints = _extract_truth_joints(truth)
    viewer_joints = _extract_viewer_joints(viewer)
    expected_axis_frame = "local_rot1_wxyz"

    viewer_by_joint_path: dict[str, dict[str, Any]] = {}
    viewer_by_link_path: dict[str, list[dict[str, Any]]] = {}
    for viewer_joint in viewer_joints:
        joint_path = str(viewer_joint.get("joint_path") or "")
        link_path = str(viewer_joint.get("link_path") or "")
        if joint_path and joint_path not in viewer_by_joint_path:
            viewer_by_joint_path[joint_path] = viewer_joint
        if link_path:
            viewer_by_link_path.setdefault(link_path, []).append(viewer_joint)

    compared_entries: list[dict[str, Any]] = []
    failed_entries: list[dict[str, Any]] = []
    missing_truth_joint_paths: list[str] = []
    matched_viewer_keys: set[str] = set()

    for truth_joint in truth_joints:
        truth_joint_path = str(truth_joint.get("joint_path") or "")
        truth_joint_name = str(truth_joint.get("joint_name") or "")
        truth_joint_type = str(truth_joint.get("joint_type") or "").strip().lower()
        truth_body1_path = str(truth_joint.get("body1_path") or "")
        truth_axis_token = _normalize_axis_token(truth_joint.get("axis_token"))

        viewer_joint = viewer_by_joint_path.get(truth_joint_path) if truth_joint_path else None
        matched_by = "joint_path"
        if viewer_joint is None and truth_body1_path:
            candidates = viewer_by_link_path.get(truth_body1_path, [])
            if candidates:
                viewer_joint = candidates[0]
                matched_by = "link_path"

        if viewer_joint is None:
            missing_truth_joint_paths.append(truth_joint_path or truth_joint_name)
            continue

        viewer_key = str(viewer_joint.get("joint_path") or viewer_joint.get("link_path") or truth_joint_name)
        if viewer_key:
            matched_viewer_keys.add(viewer_key)

        viewer_axis_token = _normalize_axis_token(viewer_joint.get("axis_token"))
        viewer_joint_type = str(viewer_joint.get("joint_type") or "").strip().lower()
        axis_token_match = not truth_axis_token or viewer_axis_token == truth_axis_token

        expected_axis_local = None
        if truth_axis_token:
            expected_axis_local = _axis_vector_from_token(truth_axis_token or "X")
            expected_axis_local = _rotate_vector_by_quaternion_wxyz(
                expected_axis_local,
                _to_quaternion_wxyz(truth_joint.get(expected_axis_frame)),
            )
        viewer_axis_local = _to_vector3(viewer_joint.get("axis_local"))
        axis_angle_error_deg = _angle_deg_between_vectors(viewer_axis_local, expected_axis_local)

        truth_lower = _to_finite_float(truth_joint.get("lower_limit_deg"))
        truth_upper = _to_finite_float(truth_joint.get("upper_limit_deg"))
        viewer_lower = _to_finite_float(viewer_joint.get("lower_limit_deg"))
        viewer_upper = _to_finite_float(viewer_joint.get("upper_limit_deg"))
        lower_limit_error_deg = (
            abs(viewer_lower - truth_lower)
            if viewer_lower is not None and truth_lower is not None
            else None
        )
        upper_limit_error_deg = (
            abs(viewer_upper - truth_upper)
            if viewer_upper is not None and truth_upper is not None
            else None
        )

        axis_angle_failed = (
            axis_angle_error_deg is not None
            and axis_angle_error_deg > float(args.axis_angle_threshold_deg)
        )
        lower_limit_failed = (
            lower_limit_error_deg is not None
            and lower_limit_error_deg > float(args.limit_threshold_deg)
        )
        upper_limit_failed = (
            upper_limit_error_deg is not None
            and upper_limit_error_deg > float(args.limit_threshold_deg)
        )
        axis_token_failed = not axis_token_match

        entry = {
            "joint_name": truth_joint_name,
            "truth_joint_path": truth_joint_path or None,
            "truth_body1_path": truth_body1_path or None,
            "truth_joint_type": truth_joint_type or None,
            "viewer_joint_path": viewer_joint.get("joint_path"),
            "viewer_link_path": viewer_joint.get("link_path"),
            "viewer_joint_type": viewer_joint_type or None,
            "matched_by": matched_by,
            "truth_axis_token": truth_axis_token,
            "viewer_axis_token": viewer_axis_token,
            "axis_token_match": axis_token_match,
            "expected_axis_frame": expected_axis_frame,
            "viewer_axis_local": viewer_axis_local,
            "expected_axis_local": expected_axis_local,
            "axis_angle_error_deg": axis_angle_error_deg,
            "truth_lower_limit_deg": truth_lower,
            "viewer_lower_limit_deg": viewer_lower,
            "lower_limit_error_deg": lower_limit_error_deg,
            "truth_upper_limit_deg": truth_upper,
            "viewer_upper_limit_deg": viewer_upper,
            "upper_limit_error_deg": upper_limit_error_deg,
            "axis_token_failed": axis_token_failed,
            "axis_angle_failed": axis_angle_failed,
            "lower_limit_failed": lower_limit_failed,
            "upper_limit_failed": upper_limit_failed,
            "pass": not (axis_token_failed or axis_angle_failed or lower_limit_failed or upper_limit_failed),
        }
        compared_entries.append(entry)
        if not entry["pass"]:
            failed_entries.append(entry)

    unresolved_viewer_entries: list[dict[str, Any]] = []
    for viewer_joint in viewer_joints:
        viewer_key = str(viewer_joint.get("joint_path") or viewer_joint.get("link_path") or "")
        if not viewer_key or viewer_key in matched_viewer_keys:
            continue
        unresolved_viewer_entries.append(
            {
                "joint_path": viewer_joint.get("joint_path"),
                "link_path": viewer_joint.get("link_path"),
                "joint_name": viewer_joint.get("joint_name"),
            }
        )

    max_axis_angle_error = max(
        (float(entry.get("axis_angle_error_deg")) for entry in compared_entries if entry.get("axis_angle_error_deg") is not None),
        default=0.0,
    )
    max_lower_limit_error = max(
        (float(entry.get("lower_limit_error_deg")) for entry in compared_entries if entry.get("lower_limit_error_deg") is not None),
        default=0.0,
    )
    max_upper_limit_error = max(
        (float(entry.get("upper_limit_error_deg")) for entry in compared_entries if entry.get("upper_limit_error_deg") is not None),
        default=0.0,
    )

    report = {
        "source_truth": str(truth_path),
        "source_viewer": str(viewer_path),
        "viewer_snapshot_source": str(
            viewer.get("snapshot_source")
            or viewer.get("snapshotSource")
            or viewer.get("source")
            or ""
        ),
        "thresholds": {
            "axis_angle_threshold_deg": float(args.axis_angle_threshold_deg),
            "limit_threshold_deg": float(args.limit_threshold_deg),
        },
        "summary": {
            "truth_joint_count": len(truth_joints),
            "viewer_joint_count": len(viewer_joints),
            "compared_count": len(compared_entries),
            "failed_count": len(failed_entries),
            "missing_truth_joint_count": len(missing_truth_joint_paths),
            "unresolved_viewer_count": len(unresolved_viewer_entries),
            "max_axis_angle_error_deg": max_axis_angle_error,
            "max_lower_limit_error_deg": max_lower_limit_error,
            "max_upper_limit_error_deg": max_upper_limit_error,
            "pass": len(failed_entries) == 0
            and len(missing_truth_joint_paths) == 0
            and len(unresolved_viewer_entries) == 0,
        },
        "failed_entries": failed_entries,
        "missing_truth_joint_paths": sorted(set(missing_truth_joint_paths)),
        "unresolved_viewer_entries": sorted(
            unresolved_viewer_entries,
            key=lambda item: (str(item.get("joint_path") or ""), str(item.get("link_path") or "")),
        ),
        "compared_entries": compared_entries,
    }
    output_path.write_text(f"{json.dumps(report, ensure_ascii=False, indent=2)}\n", encoding="utf-8")

    print(f"Truth: {truth_path}")
    print(f"Viewer: {viewer_path}")
    print(f"Output: {output_path}")
    print(
        "Summary: "
        f"truth={report['summary']['truth_joint_count']}, "
        f"viewer={report['summary']['viewer_joint_count']}, "
        f"compared={report['summary']['compared_count']}, "
        f"failed={report['summary']['failed_count']}, "
        f"missing={report['summary']['missing_truth_joint_count']}, "
        f"unresolved={report['summary']['unresolved_viewer_count']}, "
        f"pass={report['summary']['pass']}"
    )


if __name__ == "__main__":
    main()
