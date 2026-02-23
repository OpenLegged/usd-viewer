#!/usr/bin/env python3
"""Extract articulation and mesh ground-truth data from a USD using Isaac Sim."""

from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from isaacsim import SimulationApp


def _vec3_to_list(value: Any) -> list[float] | None:
    if value is None:
        return None
    try:
        return [float(value[0]), float(value[1]), float(value[2])]
    except Exception:
        return None


def _quat_to_wxyz(value: Any) -> list[float] | None:
    if value is None:
        return None
    try:
        if hasattr(value, "GetReal") and hasattr(value, "GetImaginary"):
            imag = value.GetImaginary()
            return [float(value.GetReal()), float(imag[0]), float(imag[1]), float(imag[2])]
        return [float(value[0]), float(value[1]), float(value[2]), float(value[3])]
    except Exception:
        return None


def _safe_float(value: Any) -> float | None:
    try:
        return float(value)
    except Exception:
        return None


def _quat_wxyz_norm(value: list[float] | None) -> list[float] | None:
    if value is None or len(value) < 4:
        return None
    try:
        w, x, y, z = float(value[0]), float(value[1]), float(value[2]), float(value[3])
        length = (w * w + x * x + y * y + z * z) ** 0.5
        if length <= 1e-12:
            return None
        return [w / length, x / length, y / length, z / length]
    except Exception:
        return None


def _quat_multiply_wxyz(lhs: list[float] | None, rhs: list[float] | None) -> list[float] | None:
    lhs_norm = _quat_wxyz_norm(lhs)
    rhs_norm = _quat_wxyz_norm(rhs)
    if lhs_norm is None or rhs_norm is None:
        return None

    lw, lx, ly, lz = lhs_norm
    rw, rx, ry, rz = rhs_norm
    return _quat_wxyz_norm(
        [
            lw * rw - lx * rx - ly * ry - lz * rz,
            lw * rx + lx * rw + ly * rz - lz * ry,
            lw * ry - lx * rz + ly * rw + lz * rx,
            lw * rz + lx * ry - ly * rx + lz * rw,
        ]
    )


def _extent_to_bounds(extent_value: Any) -> list[list[float]] | None:
    try:
        if not extent_value or len(extent_value) != 2:
            return None
        minimum = extent_value[0]
        maximum = extent_value[1]
        return [
            [float(minimum[0]), float(minimum[1]), float(minimum[2])],
            [float(maximum[0]), float(maximum[1]), float(maximum[2])],
        ]
    except Exception:
        return None


def _extent_to_size(extent_bounds: list[list[float]] | None) -> list[float] | None:
    if not extent_bounds or len(extent_bounds) != 2:
        return None
    try:
        minimum, maximum = extent_bounds
        return [
            float(maximum[0] - minimum[0]),
            float(maximum[1] - minimum[1]),
            float(maximum[2] - minimum[2]),
        ]
    except Exception:
        return None


def _safe_get_local_to_world(xform_cache: Any, prim: Any) -> Any | None:
    try:
        return xform_cache.GetLocalToWorldTransform(prim)
    except Exception:
        return None


def _matrix_to_pose(matrix: Any) -> dict[str, Any]:
    if matrix is None:
        return {"position": None, "rotation_wxyz": None}

    position = None
    rotation = None
    try:
        t = matrix.ExtractTranslation()
        position = [float(t[0]), float(t[1]), float(t[2])]
    except Exception:
        position = None

    try:
        q = matrix.ExtractRotationQuat()
        rotation = _quat_to_wxyz(q)
    except Exception:
        rotation = None

    return {"position": position, "rotation_wxyz": rotation}


def _transform_local_point(
    xform_cache: Any,
    stage: Any,
    gf_module: Any,
    body_path: str | None,
    local_pos: Any,
) -> list[float] | None:
    if not body_path or local_pos is None:
        return None

    body_prim = stage.GetPrimAtPath(body_path)
    if not body_prim or not body_prim.IsValid():
        return None

    matrix = _safe_get_local_to_world(xform_cache, body_prim)
    if matrix is None:
        return None

    try:
        local_vec = gf_module.Vec3d(float(local_pos[0]), float(local_pos[1]), float(local_pos[2]))
        world_vec = matrix.Transform(local_vec)
        return [float(world_vec[0]), float(world_vec[1]), float(world_vec[2])]
    except Exception:
        return None


def _count_types(prims: list[Any]) -> dict[str, int]:
    counter: Counter[str] = Counter()
    for prim in prims:
        type_name = prim.GetTypeName() or "<None>"
        counter[type_name] += 1
    return dict(sorted(counter.items(), key=lambda item: (-item[1], item[0])))


def _resolve_paths(usd_path: str, output_path: str) -> tuple[Path, Path]:
    source = Path(usd_path).expanduser().resolve()
    target = Path(output_path).expanduser().resolve()
    return source, target


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Extract link/joint/mesh ground-truth from USD via Isaac Sim."
    )
    parser.add_argument(
        "--usd",
        default="unitree_model/G1/29dof/usd/g1_29dof_rev_1_0/g1_29dof_rev_1_0.usd",
        help="Path to source USD file.",
    )
    parser.add_argument(
        "--output",
        default="output/dev/g1_29dof_truth_isaacsim.json",
        help="Path to output JSON file.",
    )
    parser.add_argument(
        "--indent",
        type=int,
        default=2,
        help="JSON indent level. Use 0 for compact JSON.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    usd_path, output_path = _resolve_paths(args.usd, args.output)
    if not usd_path.exists():
        raise FileNotFoundError(f"USD file not found: {usd_path}")

    # Prevent custom script args from being forwarded to Kit.
    sys.argv = [sys.argv[0]]

    app = SimulationApp({"headless": True})
    try:
        from pxr import Gf, Usd, UsdGeom, UsdPhysics

        try:
            from pxr import UsdSkel
        except Exception:
            UsdSkel = None

        # Prefer direct Stage.Open because some assets can crash via omni.usd context.open_stage.
        stage = Usd.Stage.Open(str(usd_path))
        if stage is None:
            raise RuntimeError(f"Failed to open USD stage: {usd_path}")

        default_prim = stage.GetDefaultPrim()
        if not default_prim or not default_prim.IsValid():
            raise RuntimeError("Stage has no valid default prim.")

        default_prim_path = default_prim.GetPath().pathString
        xform_cache = UsdGeom.XformCache(Usd.TimeCode.Default())

        default_prims = list(stage.Traverse())
        proxy_prims = list(Usd.PrimRange(stage.GetPseudoRoot(), Usd.TraverseInstanceProxies()))

        # Link extraction from default prim's direct children.
        links: list[dict[str, Any]] = []
        for child in default_prim.GetChildren():
            if child.GetName() in {"Looks", "joints"}:
                continue
            if child.GetTypeName() != "Xform":
                continue
            pose = _matrix_to_pose(_safe_get_local_to_world(xform_cache, child))
            links.append(
                {
                    "name": child.GetName(),
                    "path": child.GetPath().pathString,
                    "world_pose": pose,
                }
            )
        links.sort(key=lambda item: item["name"])

        # Link inertial extraction from PhysicsMassAPI on link prims.
        inertials: list[dict[str, Any]] = []
        inertial_by_link_name: dict[str, dict[str, Any]] = {}
        for child in default_prim.GetChildren():
            if child.GetName() in {"Looks", "joints"}:
                continue
            if child.GetTypeName() != "Xform":
                continue

            mass_api = UsdPhysics.MassAPI(child)
            mass = _safe_float(mass_api.GetMassAttr().Get())
            center_of_mass_local = _vec3_to_list(mass_api.GetCenterOfMassAttr().Get())
            diagonal_inertia = _vec3_to_list(mass_api.GetDiagonalInertiaAttr().Get())
            principal_axes_local_wxyz = _quat_to_wxyz(mass_api.GetPrincipalAxesAttr().Get())

            has_center = bool(center_of_mass_local and any(abs(component) > 1e-12 for component in center_of_mass_local))
            has_diagonal = bool(diagonal_inertia and any(abs(component) > 1e-12 for component in diagonal_inertia))
            principal_axes_normalized = _quat_wxyz_norm(principal_axes_local_wxyz)
            has_principal_axes = bool(
                principal_axes_normalized
                and (
                    abs(principal_axes_normalized[0] - 1.0) > 1e-6
                    or abs(principal_axes_normalized[1]) > 1e-6
                    or abs(principal_axes_normalized[2]) > 1e-6
                    or abs(principal_axes_normalized[3]) > 1e-6
                )
            )
            if mass is None and not has_center and not has_diagonal and not has_principal_axes:
                continue

            link_path = child.GetPath().pathString
            world_pose = _matrix_to_pose(_safe_get_local_to_world(xform_cache, child))
            center_of_mass_world = _transform_local_point(xform_cache, stage, Gf, link_path, center_of_mass_local)
            principal_axes_world_wxyz = _quat_multiply_wxyz(world_pose.get("rotation_wxyz"), principal_axes_local_wxyz)

            entry = {
                "name": child.GetName(),
                "path": link_path,
                "mass": mass,
                "center_of_mass_local": center_of_mass_local if center_of_mass_local is not None else [0.0, 0.0, 0.0],
                "center_of_mass_world": center_of_mass_world,
                "diagonal_inertia": diagonal_inertia if diagonal_inertia is not None else [0.0, 0.0, 0.0],
                "principal_axes_local_wxyz": principal_axes_local_wxyz if principal_axes_local_wxyz is not None else [1.0, 0.0, 0.0, 0.0],
                "principal_axes_world_wxyz": principal_axes_world_wxyz if principal_axes_world_wxyz is not None else [1.0, 0.0, 0.0, 0.0],
            }
            inertials.append(entry)
            inertial_by_link_name[child.GetName()] = {
                "path": link_path,
                "mass": entry["mass"],
                "center_of_mass_local": entry["center_of_mass_local"],
                "center_of_mass_world": entry["center_of_mass_world"],
                "diagonal_inertia": entry["diagonal_inertia"],
                "principal_axes_local_wxyz": entry["principal_axes_local_wxyz"],
                "principal_axes_world_wxyz": entry["principal_axes_world_wxyz"],
            }
        inertials.sort(key=lambda item: item["name"])

        # Joint extraction from physics articulation joints.
        joints: list[dict[str, Any]] = []
        body0_paths: set[str] = set()
        body1_paths: set[str] = set()

        for prim in default_prims:
            if prim.GetTypeName() != "PhysicsRevoluteJoint":
                continue

            joint = UsdPhysics.RevoluteJoint(prim)
            body0_targets = [str(path) for path in joint.GetBody0Rel().GetTargets()]
            body1_targets = [str(path) for path in joint.GetBody1Rel().GetTargets()]
            body0_path = body0_targets[0] if body0_targets else None
            body1_path = body1_targets[0] if body1_targets else None

            if body0_path:
                body0_paths.add(body0_path)
            if body1_path:
                body1_paths.add(body1_path)

            local_pos0 = joint.GetLocalPos0Attr().Get()
            local_pos1 = joint.GetLocalPos1Attr().Get()
            world_pos0 = _transform_local_point(xform_cache, stage, Gf, body0_path, local_pos0)
            world_pos1 = _transform_local_point(xform_cache, stage, Gf, body1_path, local_pos1)

            if world_pos0 and world_pos1:
                world_position = [
                    (world_pos0[0] + world_pos1[0]) * 0.5,
                    (world_pos0[1] + world_pos1[1]) * 0.5,
                    (world_pos0[2] + world_pos1[2]) * 0.5,
                ]
            else:
                world_position = world_pos0 or world_pos1

            joints.append(
                {
                    "name": prim.GetName(),
                    "path": prim.GetPath().pathString,
                    "axis": str(joint.GetAxisAttr().Get()),
                    "lower_limit_deg": _safe_float(joint.GetLowerLimitAttr().Get()),
                    "upper_limit_deg": _safe_float(joint.GetUpperLimitAttr().Get()),
                    "body0_path": body0_path,
                    "body1_path": body1_path,
                    "local_pos0": _vec3_to_list(local_pos0),
                    "local_pos1": _vec3_to_list(local_pos1),
                    "local_rot0_wxyz": _quat_to_wxyz(joint.GetLocalRot0Attr().Get()),
                    "local_rot1_wxyz": _quat_to_wxyz(joint.GetLocalRot1Attr().Get()),
                    "world_pos_from_body0": world_pos0,
                    "world_pos_from_body1": world_pos1,
                    "world_position": world_position,
                }
            )
        joints.sort(key=lambda item: item["name"])

        # Mesh extraction must include instance proxies.
        meshes: list[dict[str, Any]] = []
        for prim in proxy_prims:
            if prim.GetTypeName() != "Mesh":
                continue

            path = prim.GetPath().pathString
            if not path.startswith(f"{default_prim_path}/"):
                continue

            relative = path[len(default_prim_path) + 1 :]
            segments = relative.split("/")
            link_name = segments[0] if segments else None

            if "/visuals/" in path:
                category = "visual"
            elif "/collisions/" in path:
                category = "collision"
            else:
                category = "other"

            matrix = _safe_get_local_to_world(xform_cache, prim)
            pose = _matrix_to_pose(matrix)

            extent_local = None
            try:
                extent = UsdGeom.Mesh(prim).GetExtentAttr().Get()
                extent_local = _extent_to_bounds(extent)
            except Exception:
                extent_local = None

            meshes.append(
                {
                    "path": path,
                    "link_name": link_name,
                    "category": category,
                    "is_instance_proxy": bool(prim.IsInstanceProxy()),
                    "parent_path": prim.GetParent().GetPath().pathString,
                    "world_pose": pose,
                    "extent_local": extent_local,
                    "extent_size_local": _extent_to_size(extent_local),
                }
            )
        meshes.sort(key=lambda item: item["path"])

        visual_mesh_count = sum(1 for mesh in meshes if mesh["category"] == "visual")
        collision_mesh_count = sum(1 for mesh in meshes if mesh["category"] == "collision")

        # Collision primitive extraction (mesh + analytic primitives).
        supported_collision_types = {"Mesh", "Cube", "Sphere", "Cylinder", "Capsule"}
        collision_primitives: list[dict[str, Any]] = []
        seen_collision_paths: set[str] = set()
        for prim in proxy_prims:
            prim_type_name = prim.GetTypeName()
            if prim_type_name not in supported_collision_types:
                continue

            path = prim.GetPath().pathString
            if path in seen_collision_paths:
                continue
            if not path.startswith(f"{default_prim_path}/"):
                continue
            if "/collisions/" not in path:
                continue

            seen_collision_paths.add(path)

            relative = path[len(default_prim_path) + 1 :]
            segments = relative.split("/")
            link_name = segments[0] if segments else None

            world_matrix = _safe_get_local_to_world(xform_cache, prim)
            world_pose = _matrix_to_pose(world_matrix)

            extent_local = None
            extent_attr = prim.GetAttribute("extent")
            if extent_attr:
                extent_local = _extent_to_bounds(extent_attr.Get())

            primitive_type = prim_type_name.lower()
            if primitive_type == "cube":
                primitive_type = "box"

            geometry: dict[str, Any] = {
                "type": primitive_type,
                "axis": None,
                "radius": None,
                "height": None,
                "size": None,
            }
            if prim_type_name == "Cube":
                geometry["size"] = _safe_float(prim.GetAttribute("size").Get())
            elif prim_type_name in {"Sphere", "Cylinder", "Capsule"}:
                geometry["radius"] = _safe_float(prim.GetAttribute("radius").Get())
                if prim_type_name in {"Cylinder", "Capsule"}:
                    geometry["height"] = _safe_float(prim.GetAttribute("height").Get())
                    try:
                        axis_value = prim.GetAttribute("axis").Get()
                        geometry["axis"] = str(axis_value) if axis_value is not None else None
                    except Exception:
                        geometry["axis"] = None

            collision_primitives.append(
                {
                    "path": path,
                    "link_name": link_name,
                    "is_instance_proxy": bool(prim.IsInstanceProxy()),
                    "parent_path": prim.GetParent().GetPath().pathString,
                    "prim_type": primitive_type,
                    "world_pose": world_pose,
                    "extent_local": extent_local,
                    "extent_size_local": _extent_to_size(extent_local),
                    "geometry": geometry,
                }
            )

        collision_primitives.sort(key=lambda item: item["path"])
        collision_primitive_type_counts = Counter(item["prim_type"] for item in collision_primitives)

        root_link_paths = sorted(path for path in body0_paths if path not in body1_paths)

        usd_skeleton_paths: list[str] = []
        if UsdSkel is not None:
            for prim in proxy_prims:
                if prim.GetTypeName() == "Skeleton":
                    usd_skeleton_paths.append(prim.GetPath().pathString)
        usd_skeleton_paths = sorted(set(usd_skeleton_paths))

        result = {
            "generated_at_utc": datetime.now(timezone.utc).isoformat(),
            "source_usd": str(usd_path),
            "stage": {
                "default_prim": default_prim_path,
                "default_prim_count": len(default_prims),
                "instance_proxy_prim_count": len(proxy_prims),
                "default_type_counts": _count_types(default_prims),
                "instance_proxy_type_counts": _count_types(proxy_prims),
            },
            "skeleton": {
                "usd_skeleton_count": len(usd_skeleton_paths),
                "usd_skeleton_paths": usd_skeleton_paths,
                "note": (
                    "This USD uses PhysicsRevoluteJoint articulation. "
                    "UsdSkel Skeleton prims are not present."
                    if not usd_skeleton_paths
                    else "UsdSkel Skeleton prims detected."
                ),
            },
            "articulation": {
                "link_count": len(links),
                "root_link_paths": root_link_paths,
                "joint_count": len(joints),
                "links": links,
                "joints": joints,
            },
            "inertial": {
                "link_inertial_count": len(inertials),
                "links": inertials,
                "inertial_by_link_name": inertial_by_link_name,
            },
            "meshes": {
                "mesh_count": len(meshes),
                "visual_mesh_count": visual_mesh_count,
                "collision_mesh_count": collision_mesh_count,
                "meshes": meshes,
            },
            "colliders": {
                "collision_primitive_count": len(collision_primitives),
                "collision_primitive_type_counts": dict(sorted(collision_primitive_type_counts.items())),
                "collision_primitives": collision_primitives,
            },
        }

        output_path.parent.mkdir(parents=True, exist_ok=True)
        indent = None if args.indent <= 0 else args.indent
        with output_path.open("w", encoding="utf-8") as handle:
            json.dump(result, handle, ensure_ascii=False, indent=indent)
            handle.write("\n")

        print(f"USD: {usd_path}")
        print(f"Output: {output_path}")
        print(
            "Summary: "
            f"links={len(links)}, joints={len(joints)}, meshes={len(meshes)} "
            f"(visual={visual_mesh_count}, collision={collision_mesh_count}), "
            f"colliders={len(collision_primitives)}, "
            f"usd_skeletons={len(usd_skeleton_paths)}"
        )
    finally:
        app.close()


if __name__ == "__main__":
    main()
