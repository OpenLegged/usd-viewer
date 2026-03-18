#!/usr/bin/env python3
"""Compare viewer link inertial metadata against Isaac Sim extracted truth."""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path
from typing import Any


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Compare viewer link inertial metadata with Isaac Sim truth JSON.")
    parser.add_argument("--truth", required=True, help="Path to Isaac Sim truth JSON.")
    parser.add_argument("--viewer", required=True, help="Path to viewer robot metadata JSON.")
    parser.add_argument("--output", required=True, help="Path to write comparison JSON report.")
    parser.add_argument(
        "--mass-threshold",
        type=float,
        default=1e-4,
        help="Maximum allowed absolute mass error (kg).",
    )
    parser.add_argument(
        "--com-threshold",
        type=float,
        default=1e-4,
        help="Maximum allowed center-of-mass position error (m).",
    )
    parser.add_argument(
        "--inertia-threshold",
        type=float,
        default=1e-4,
        help="Maximum allowed diagonal inertia vector error (kg*m^2, L2 norm).",
    )
    parser.add_argument(
        "--principal-axes-threshold-deg",
        type=float,
        default=1.0,
        help="Maximum allowed principal-axes quaternion angular error (deg).",
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


def _path_basename(path: str) -> str:
    normalized = _normalize_path(path)
    if not normalized:
        return ""
    segments = [segment for segment in normalized.split("/") if segment]
    return segments[-1] if segments else ""


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


def _to_quaternion_xyzw_as_wxyz(value: Any) -> list[float] | None:
    if isinstance(value, (list, tuple)) and len(value) >= 4:
        x = _to_finite_float(value[0])
        y = _to_finite_float(value[1])
        z = _to_finite_float(value[2])
        w = _to_finite_float(value[3])
        if w is None or x is None or y is None or z is None:
            return None
        return [w, x, y, z]
    return None


def _normalize_quaternion_wxyz(value: list[float] | None) -> list[float] | None:
    if value is None or len(value) < 4:
        return None
    w, x, y, z = value
    norm = math.sqrt(w * w + x * x + y * y + z * z)
    if not math.isfinite(norm) or norm <= 1e-12:
        return None
    return [w / norm, x / norm, y / norm, z / norm]


def _vector3_error(left: list[float] | None, right: list[float] | None) -> float | None:
    if left is None or right is None:
        return None
    dx = left[0] - right[0]
    dy = left[1] - right[1]
    dz = left[2] - right[2]
    return math.sqrt(dx * dx + dy * dy + dz * dz)


def _quaternion_angular_error_deg(left_wxyz: list[float] | None, right_wxyz: list[float] | None) -> float | None:
    left = _normalize_quaternion_wxyz(left_wxyz)
    right = _normalize_quaternion_wxyz(right_wxyz)
    if left is None or right is None:
        return None
    dot = abs(left[0] * right[0] + left[1] * right[1] + left[2] * right[2] + left[3] * right[3])
    dot = max(-1.0, min(1.0, dot))
    return 2.0 * math.degrees(math.acos(dot))


def _extract_truth_inertials(truth: dict[str, Any]) -> list[dict[str, Any]]:
    inertial_section = truth.get("inertial")
    if not isinstance(inertial_section, dict):
        return []
    links = inertial_section.get("links")
    if not isinstance(links, list):
        return []
    output: list[dict[str, Any]] = []
    for entry in links:
        if not isinstance(entry, dict):
            continue
        output.append(
            {
                "link_path": _normalize_path(entry.get("path")),
                "link_name": str(entry.get("name") or "").strip(),
                "mass": _to_finite_float(entry.get("mass")),
                "center_of_mass_local": _to_vector3(entry.get("center_of_mass_local")),
                "diagonal_inertia": _to_vector3(entry.get("diagonal_inertia")),
                "principal_axes_local_wxyz": _to_quaternion_wxyz(entry.get("principal_axes_local_wxyz")),
            }
        )
    output.sort(key=lambda item: item.get("link_path", ""))
    return output


def _extract_viewer_inertials(viewer: dict[str, Any]) -> list[dict[str, Any]]:
    raw_entries = viewer.get("link_dynamics")
    if not isinstance(raw_entries, list):
        raw_entries = viewer.get("linkDynamicsEntries")
    if not isinstance(raw_entries, list):
        raw_entries = []
    output: list[dict[str, Any]] = []
    for entry in raw_entries:
        if not isinstance(entry, dict):
            continue
        output.append(
            {
                "link_path": _normalize_path(entry.get("linkPath") or entry.get("link_path")),
                "link_name": _path_basename(str(entry.get("linkPath") or entry.get("link_path") or "")),
                "mass": _to_finite_float(entry.get("mass")),
                "center_of_mass_local": _to_vector3(entry.get("centerOfMassLocal") or entry.get("center_of_mass_local")),
                "diagonal_inertia": _to_vector3(entry.get("diagonalInertia") or entry.get("diagonal_inertia")),
                "principal_axes_local_wxyz": (
                    _to_quaternion_wxyz(entry.get("principalAxesLocalWxyz") or entry.get("principal_axes_local_wxyz"))
                    or _to_quaternion_xyzw_as_wxyz(entry.get("principalAxesLocal") or entry.get("principal_axes_local"))
                ),
            }
        )
    output.sort(key=lambda item: item.get("link_path", ""))
    return output


def _resolve_viewer_entry_for_truth(
    truth_entry: dict[str, Any],
    viewer_by_path: dict[str, dict[str, Any]],
    viewer_by_basename: dict[str, list[dict[str, Any]]],
) -> dict[str, Any] | None:
    truth_path = str(truth_entry.get("link_path") or "")
    if truth_path and truth_path in viewer_by_path:
        return viewer_by_path[truth_path]

    truth_basename = _path_basename(truth_path) or str(truth_entry.get("link_name") or "")
    if not truth_basename:
        return None
    basename_matches = viewer_by_basename.get(truth_basename, [])
    if len(basename_matches) == 1:
        return basename_matches[0]
    return None


def main() -> None:
    args = parse_args()
    truth_path = Path(args.truth).expanduser().resolve()
    viewer_path = Path(args.viewer).expanduser().resolve()
    output_path = Path(args.output).expanduser().resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)

    truth = _load_json(truth_path)
    viewer = _load_json(viewer_path)
    truth_inertials = _extract_truth_inertials(truth)
    viewer_inertials = _extract_viewer_inertials(viewer)

    viewer_by_path: dict[str, dict[str, Any]] = {}
    viewer_by_basename: dict[str, list[dict[str, Any]]] = {}
    for entry in viewer_inertials:
        link_path = str(entry.get("link_path") or "")
        if link_path and link_path not in viewer_by_path:
            viewer_by_path[link_path] = entry
        basename = _path_basename(link_path) or str(entry.get("link_name") or "")
        if not basename:
            continue
        viewer_by_basename.setdefault(basename, []).append(entry)

    compared_entries: list[dict[str, Any]] = []
    missing_truth_paths: list[str] = []
    matched_viewer_paths: set[str] = set()

    for truth_entry in truth_inertials:
        viewer_entry = _resolve_viewer_entry_for_truth(truth_entry, viewer_by_path, viewer_by_basename)
        truth_path_key = str(truth_entry.get("link_path") or "")
        if viewer_entry is None:
            if truth_path_key:
                missing_truth_paths.append(truth_path_key)
            continue

        viewer_path_key = str(viewer_entry.get("link_path") or "")
        if viewer_path_key:
            matched_viewer_paths.add(viewer_path_key)

        mass_truth = _to_finite_float(truth_entry.get("mass"))
        mass_viewer = _to_finite_float(viewer_entry.get("mass"))
        mass_abs_error = (
            abs(mass_viewer - mass_truth)
            if mass_truth is not None and mass_viewer is not None
            else None
        )

        com_truth = _to_vector3(truth_entry.get("center_of_mass_local"))
        com_viewer = _to_vector3(viewer_entry.get("center_of_mass_local"))
        com_error_m = _vector3_error(com_viewer, com_truth)

        inertia_truth = _to_vector3(truth_entry.get("diagonal_inertia"))
        inertia_viewer = _to_vector3(viewer_entry.get("diagonal_inertia"))
        inertia_error = _vector3_error(inertia_viewer, inertia_truth)

        principal_truth_wxyz = _to_quaternion_wxyz(truth_entry.get("principal_axes_local_wxyz"))
        principal_viewer_wxyz = _to_quaternion_wxyz(viewer_entry.get("principal_axes_local_wxyz"))
        principal_axes_error_deg = _quaternion_angular_error_deg(principal_viewer_wxyz, principal_truth_wxyz)

        failed = False
        if mass_abs_error is not None and mass_abs_error > args.mass_threshold:
            failed = True
        if com_error_m is not None and com_error_m > args.com_threshold:
            failed = True
        if inertia_error is not None and inertia_error > args.inertia_threshold:
            failed = True
        if principal_axes_error_deg is not None and principal_axes_error_deg > args.principal_axes_threshold_deg:
            failed = True

        compared_entries.append(
            {
                "link_path_truth": truth_path_key,
                "link_path_viewer": viewer_path_key,
                "mass_truth": mass_truth,
                "mass_viewer": mass_viewer,
                "mass_abs_error": mass_abs_error,
                "center_of_mass_local_truth": com_truth,
                "center_of_mass_local_viewer": com_viewer,
                "com_error_m": com_error_m,
                "diagonal_inertia_truth": inertia_truth,
                "diagonal_inertia_viewer": inertia_viewer,
                "inertia_error": inertia_error,
                "principal_axes_local_truth_wxyz": principal_truth_wxyz,
                "principal_axes_local_viewer_wxyz": principal_viewer_wxyz,
                "principal_axes_error_deg": principal_axes_error_deg,
                "failed": failed,
            }
        )

    extra_viewer_paths = sorted(
        path for path in viewer_by_path.keys()
        if path and path not in matched_viewer_paths
    )

    compared_entries.sort(
        key=lambda entry: (
            float(entry.get("principal_axes_error_deg") or 0.0),
            float(entry.get("com_error_m") or 0.0),
            float(entry.get("inertia_error") or 0.0),
            float(entry.get("mass_abs_error") or 0.0),
        ),
        reverse=True,
    )

    max_mass_error = max((float(entry["mass_abs_error"]) for entry in compared_entries if entry.get("mass_abs_error") is not None), default=0.0)
    max_com_error_m = max((float(entry["com_error_m"]) for entry in compared_entries if entry.get("com_error_m") is not None), default=0.0)
    max_inertia_error = max((float(entry["inertia_error"]) for entry in compared_entries if entry.get("inertia_error") is not None), default=0.0)
    max_principal_axes_error_deg = max(
        (float(entry["principal_axes_error_deg"]) for entry in compared_entries if entry.get("principal_axes_error_deg") is not None),
        default=0.0,
    )
    failed_count = sum(1 for entry in compared_entries if bool(entry.get("failed")))

    report = {
        "inputs": {
            "truth": str(truth_path),
            "viewer": str(viewer_path),
        },
        "thresholds": {
            "mass_threshold": args.mass_threshold,
            "com_threshold": args.com_threshold,
            "inertia_threshold": args.inertia_threshold,
            "principal_axes_threshold_deg": args.principal_axes_threshold_deg,
        },
        "summary": {
            "pass": (
                failed_count == 0
                and len(missing_truth_paths) == 0
                and len(extra_viewer_paths) == 0
            ),
            "truth_count": len(truth_inertials),
            "viewer_count": len(viewer_inertials),
            "compared_count": len(compared_entries),
            "failed_count": failed_count,
            "missing_truth_count": len(missing_truth_paths),
            "extra_viewer_count": len(extra_viewer_paths),
            "max_mass_error": max_mass_error,
            "max_com_error_m": max_com_error_m,
            "max_inertia_error": max_inertia_error,
            "max_principal_axes_error_deg": max_principal_axes_error_deg,
        },
        "missing_truth_paths": sorted(missing_truth_paths),
        "extra_viewer_paths": extra_viewer_paths,
        "top_errors": compared_entries[:40],
        "compared_entries": compared_entries,
    }

    output_path.write_text(f"{json.dumps(report, ensure_ascii=False, indent=2)}\n", encoding="utf-8")
    summary = report["summary"]
    print(
        "Inertial comparison summary: "
        f"pass={summary['pass']}, compared={summary['compared_count']}, "
        f"failed={summary['failed_count']}, missing={summary['missing_truth_count']}, "
        f"extra={summary['extra_viewer_count']}, "
        f"max_mass={summary['max_mass_error']:.6g}, "
        f"max_com_m={summary['max_com_error_m']:.6g}, "
        f"max_inertia={summary['max_inertia_error']:.6g}, "
        f"max_principal_axes_deg={summary['max_principal_axes_error_deg']:.6g}"
    )
    print(f"Report: {output_path}")


if __name__ == "__main__":
    main()
