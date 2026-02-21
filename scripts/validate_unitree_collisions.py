#!/usr/bin/env python3
"""Batch-validate Unitree USD mesh/collision alignment using Isaac truth vs viewer runtime."""

from __future__ import annotations

import argparse
import json
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Validate mesh and collision alignment for Unitree USD models.")
    parser.add_argument(
        "--unitree-root",
        default="unitree_model",
        help="Root directory containing Unitree USD assets.",
    )
    parser.add_argument(
        "--server",
        default="http://127.0.0.1:3003",
        help="Viewer server URL used by Playwright dump script.",
    )
    parser.add_argument(
        "--conda-env",
        default="isaaclab22",
        help="Conda env used for Isaac Sim extraction script.",
    )
    parser.add_argument(
        "--output-dir",
        default="output/validation/unitree_collisions",
        help="Directory for generated truth, viewer dumps, and comparison reports.",
    )
    parser.add_argument(
        "--models",
        nargs="*",
        default=None,
        help="Optional list of USD paths (relative to workspace) to validate.",
    )
    parser.add_argument(
        "--pos-threshold",
        type=float,
        default=0.01,
        help="Position error threshold (m) for compare script.",
    )
    parser.add_argument(
        "--rot-threshold-deg",
        type=float,
        default=1.0,
        help="Rotation error threshold (deg) for compare script.",
    )
    parser.add_argument(
        "--size-abs-threshold",
        type=float,
        default=0.01,
        help="Absolute size threshold (m) for compare script.",
    )
    parser.add_argument(
        "--size-rel-threshold",
        type=float,
        default=0.15,
        help="Relative size threshold for compare script.",
    )
    return parser.parse_args()


def _run_command(command: list[str], cwd: Path) -> None:
    subprocess.run(command, cwd=str(cwd), check=True)


def _supports_node_strip_types(workspace: Path) -> bool:
    try:
        completed = subprocess.run(
            ["node", "--experimental-strip-types", "-e", "console.log('ok')"],
            cwd=str(workspace),
            check=False,
            capture_output=True,
            text=True,
        )
    except Exception:
        return False
    return completed.returncode == 0


def _resolve_dump_viewer_runner(workspace: Path, output_dir: Path) -> list[str]:
    if _supports_node_strip_types(workspace):
        return ["node", "--experimental-strip-types", "scripts/dump_viewer_collision_state.ts"]

    compiled_dir = output_dir / "_compiled_scripts"
    compiled_dir.mkdir(parents=True, exist_ok=True)
    compiled_script_path = compiled_dir / "dump_viewer_collision_state.js"
    source_script_path = workspace / "scripts" / "dump_viewer_collision_state.ts"

    should_rebuild = True
    if compiled_script_path.exists():
        try:
            should_rebuild = compiled_script_path.stat().st_mtime < source_script_path.stat().st_mtime
        except OSError:
            should_rebuild = True

    if should_rebuild:
        _run_command(
            [
                "node",
                "node_modules/typescript/bin/tsc",
                str(source_script_path.relative_to(workspace)),
                "--target",
                "ES2021",
                "--module",
                "commonjs",
                "--skipLibCheck",
                "--noCheck",
                "--rootDir",
                "scripts",
                "--outDir",
                str(compiled_dir),
            ],
            workspace,
        )

    return ["node", str(compiled_script_path)]


def _discover_default_models(workspace: Path, unitree_root: Path) -> list[Path]:
    root = workspace / unitree_root
    candidates: list[Path] = []
    for path in root.rglob("*.usd"):
        if "/configuration/" in path.as_posix():
            continue
        candidates.append(path)
    return sorted(candidates)


def _sanitize_model_key(workspace: Path, model_path: Path) -> str:
    relative = model_path.relative_to(workspace).as_posix()
    stem = relative.removesuffix(".usd")
    return stem.replace("/", "__")


def main() -> None:
    args = parse_args()
    workspace = Path.cwd().resolve()
    output_dir = (workspace / args.output_dir).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    dump_viewer_runner = _resolve_dump_viewer_runner(workspace, output_dir)

    if args.models:
        model_paths = []
        for raw_model in args.models:
            path = (workspace / raw_model).resolve()
            if not path.exists():
                raise FileNotFoundError(f"Model USD not found: {path}")
            model_paths.append(path)
    else:
        model_paths = _discover_default_models(workspace, Path(args.unitree_root))

    if not model_paths:
        raise RuntimeError("No model USD files found to validate.")

    summaries: list[dict[str, Any]] = []
    for model_path in model_paths:
        model_key = _sanitize_model_key(workspace, model_path)
        model_dir = output_dir / model_key
        model_dir.mkdir(parents=True, exist_ok=True)

        relative_model_path = model_path.relative_to(workspace).as_posix()
        viewer_file_arg = f"/{relative_model_path}"

        truth_output = model_dir / "truth_isaacsim.json"
        viewer_visual_output = model_dir / "viewer_visual_dump.json"
        viewer_collision_output = model_dir / "viewer_collision_dump.json"
        collision_report_output = model_dir / "collision_compare_report.json"
        mesh_report_output = model_dir / "mesh_compare_report.json"

        print(f"[validate] model={relative_model_path}")

        _run_command(
            [
                "conda",
                "run",
                "-n",
                args.conda_env,
                "python",
                "-u",
                "scripts/extract_isaacsim_truth.py",
                "--usd",
                relative_model_path,
                "--output",
                str(truth_output),
                "--indent",
                "0",
            ],
            workspace,
        )

        # Dump visual state in a single-mode pass to avoid mixed-load transient states.
        _run_command(
            [
                *dump_viewer_runner,
                "--server",
                args.server,
                "--file",
                viewer_file_arg,
                "--output",
                str(viewer_visual_output),
                "--show-visuals",
                "1",
                "--show-collisions",
                "0",
            ],
            workspace,
        )

        # Dump collision state in a dedicated pass for deterministic comparison.
        _run_command(
            [
                *dump_viewer_runner,
                "--server",
                args.server,
                "--file",
                viewer_file_arg,
                "--output",
                str(viewer_collision_output),
                "--show-visuals",
                "0",
                "--show-collisions",
                "1",
            ],
            workspace,
        )

        _run_command(
            [
                "python",
                "scripts/compare_collision_truth.py",
                "--truth",
                str(truth_output),
                "--viewer",
                str(viewer_collision_output),
                "--output",
                str(collision_report_output),
                "--pos-threshold",
                str(args.pos_threshold),
                "--rot-threshold-deg",
                str(args.rot_threshold_deg),
                "--size-abs-threshold",
                str(args.size_abs_threshold),
                "--size-rel-threshold",
                str(args.size_rel_threshold),
            ],
            workspace,
        )

        _run_command(
            [
                "python",
                "scripts/compare_mesh_truth.py",
                "--truth",
                str(truth_output),
                "--viewer",
                str(viewer_visual_output),
                "--output",
                str(mesh_report_output),
                "--pos-threshold",
                str(args.pos_threshold),
                "--rot-threshold-deg",
                str(args.rot_threshold_deg),
                "--size-abs-threshold",
                str(args.size_abs_threshold),
                "--size-rel-threshold",
                str(args.size_rel_threshold),
            ],
            workspace,
        )

        collision_report = json.loads(collision_report_output.read_text(encoding="utf-8"))
        mesh_report = json.loads(mesh_report_output.read_text(encoding="utf-8"))
        collision_summary = collision_report.get("summary", {})
        mesh_summary = mesh_report.get("summary", {})
        collision_pass = bool(collision_summary.get("pass"))
        mesh_pass = bool(mesh_summary.get("pass"))
        overall_pass = collision_pass and mesh_pass
        summary = {
            "model": relative_model_path,
            "pass": overall_pass,
            "collision_pass": collision_pass,
            "mesh_pass": mesh_pass,
            "collision_report": str(collision_report_output.relative_to(workspace)),
            "mesh_report": str(mesh_report_output.relative_to(workspace)),
            "viewer_visual_dump": str(viewer_visual_output.relative_to(workspace)),
            "viewer_collision_dump": str(viewer_collision_output.relative_to(workspace)),
            "collision_failed_count": int(collision_summary.get("failed_count", 0)),
            "mesh_failed_count": int(mesh_summary.get("failed_count", 0)),
            "collision_unresolved_viewer_count": int(collision_summary.get("unresolved_viewer_count", 0)),
            "mesh_unresolved_viewer_count": int(mesh_summary.get("unresolved_viewer_count", 0)),
            "collision_missing_truth_paths_count": int(collision_summary.get("missing_truth_paths_count", 0)),
            "mesh_missing_truth_paths_count": int(mesh_summary.get("missing_truth_paths_count", 0)),
            "collision_max_pos_error_m": float(collision_summary.get("max_pos_error_m", 0.0)),
            "mesh_max_pos_error_m": float(mesh_summary.get("max_pos_error_m", 0.0)),
            "collision_max_rot_error_deg": float(collision_summary.get("max_rot_error_deg", 0.0)),
            "mesh_max_rot_error_deg": float(mesh_summary.get("max_rot_error_deg", 0.0)),
            "collision_max_size_abs_error_m": float(collision_summary.get("max_size_abs_error_m", 0.0)),
            "mesh_max_size_abs_error_m": float(mesh_summary.get("max_size_abs_error_m", 0.0)),
            "collision_max_size_rel_error": float(collision_summary.get("max_size_rel_error", 0.0)),
            "mesh_max_size_rel_error": float(mesh_summary.get("max_size_rel_error", 0.0)),
        }
        summaries.append(summary)

    summaries.sort(key=lambda item: item["model"])
    aggregate = {
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "server": args.server,
        "conda_env": args.conda_env,
        "model_count": len(summaries),
        "passed_count": sum(1 for item in summaries if item["pass"]),
        "failed_count": sum(1 for item in summaries if not item["pass"]),
        "models": summaries,
    }

    aggregate_output = output_dir / "summary.json"
    aggregate_output.write_text(f"{json.dumps(aggregate, ensure_ascii=False, indent=2)}\n", encoding="utf-8")

    print(f"[validate] summary={aggregate_output}")
    print(
        "[validate] result: "
        f"models={aggregate['model_count']}, "
        f"passed={aggregate['passed_count']}, "
        f"failed={aggregate['failed_count']}"
    )


if __name__ == "__main__":
    main()
