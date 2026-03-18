import { Euler, Matrix4, Quaternion } from 'three';
import { toArrayLike, toFiniteQuaternionWxyzTuple, toFiniteVector3Tuple } from './shared-basic.js?v=20260318a';
export function getAngleInRadians(value) {
    return value * Math.PI / 180;
}
export function createMatrixFromXformOp(opName, value) {
    const opMatrix = new Matrix4();
    const arrayValue = toArrayLike(value);
    if (opName.startsWith('xformOp:transform')) {
        if (!arrayValue || arrayValue.length < 16)
            return null;
        const matrixValues = Array.from(arrayValue).slice(0, 16).map((entry) => toFiniteNumber(entry) ?? 0);
        opMatrix.fromArray(matrixValues);
        opMatrix.transpose();
        return opMatrix;
    }
    if (opName.startsWith('xformOp:translate')) {
        const translate = toFiniteVector3Tuple(value);
        if (!translate)
            return null;
        opMatrix.makeTranslation(translate[0], translate[1], translate[2]);
        return opMatrix;
    }
    if (opName.startsWith('xformOp:scale')) {
        const scale = toFiniteVector3Tuple(value);
        if (!scale)
            return null;
        opMatrix.makeScale(scale[0], scale[1], scale[2]);
        return opMatrix;
    }
    if (opName.startsWith('xformOp:rotateXYZ')) {
        const rotate = toFiniteVector3Tuple(value);
        if (!rotate)
            return null;
        opMatrix.makeRotationFromEuler(new Euler(getAngleInRadians(rotate[0]), getAngleInRadians(rotate[1]), getAngleInRadians(rotate[2]), 'XYZ'));
        return opMatrix;
    }
    if (opName.startsWith('xformOp:rotateXZY')) {
        const rotate = toFiniteVector3Tuple(value);
        if (!rotate)
            return null;
        opMatrix.makeRotationFromEuler(new Euler(getAngleInRadians(rotate[0]), getAngleInRadians(rotate[1]), getAngleInRadians(rotate[2]), 'XZY'));
        return opMatrix;
    }
    if (opName.startsWith('xformOp:rotateYXZ')) {
        const rotate = toFiniteVector3Tuple(value);
        if (!rotate)
            return null;
        opMatrix.makeRotationFromEuler(new Euler(getAngleInRadians(rotate[0]), getAngleInRadians(rotate[1]), getAngleInRadians(rotate[2]), 'YXZ'));
        return opMatrix;
    }
    if (opName.startsWith('xformOp:rotateYZX')) {
        const rotate = toFiniteVector3Tuple(value);
        if (!rotate)
            return null;
        opMatrix.makeRotationFromEuler(new Euler(getAngleInRadians(rotate[0]), getAngleInRadians(rotate[1]), getAngleInRadians(rotate[2]), 'YZX'));
        return opMatrix;
    }
    if (opName.startsWith('xformOp:rotateZXY')) {
        const rotate = toFiniteVector3Tuple(value);
        if (!rotate)
            return null;
        opMatrix.makeRotationFromEuler(new Euler(getAngleInRadians(rotate[0]), getAngleInRadians(rotate[1]), getAngleInRadians(rotate[2]), 'ZXY'));
        return opMatrix;
    }
    if (opName.startsWith('xformOp:rotateZYX')) {
        const rotate = toFiniteVector3Tuple(value);
        if (!rotate)
            return null;
        opMatrix.makeRotationFromEuler(new Euler(getAngleInRadians(rotate[0]), getAngleInRadians(rotate[1]), getAngleInRadians(rotate[2]), 'ZYX'));
        return opMatrix;
    }
    if (opName.startsWith('xformOp:rotateX')) {
        const angle = toFiniteNumber(value);
        if (angle === undefined)
            return null;
        opMatrix.makeRotationX(getAngleInRadians(angle));
        return opMatrix;
    }
    if (opName.startsWith('xformOp:rotateY')) {
        const angle = toFiniteNumber(value);
        if (angle === undefined)
            return null;
        opMatrix.makeRotationY(getAngleInRadians(angle));
        return opMatrix;
    }
    if (opName.startsWith('xformOp:rotateZ')) {
        const angle = toFiniteNumber(value);
        if (angle === undefined)
            return null;
        opMatrix.makeRotationZ(getAngleInRadians(angle));
        return opMatrix;
    }
    if (opName.startsWith('xformOp:orient')) {
        const orientation = toFiniteQuaternionWxyzTuple(value);
        if (!orientation)
            return null;
        const quaternion = new Quaternion(orientation[1], orientation[2], orientation[3], orientation[0]);
        if (Number.isFinite(quaternion.lengthSq()) && quaternion.lengthSq() > 0) {
            quaternion.normalize();
        }
        opMatrix.makeRotationFromQuaternion(quaternion);
        return opMatrix;
    }
    return null;
}
export function normalizeHydraPath(value) {
    if (value === null || value === undefined)
        return '';
    if (typeof value === 'string')
        return value;
    const pathLike = value;
    try {
        if (typeof pathLike.GetAsString === 'function') {
            const asString = pathLike.GetAsString();
            if (typeof asString === 'string' && asString.length > 0)
                return asString;
        }
    }
    catch { }
    try {
        if (typeof pathLike.GetString === 'function') {
            const asString = pathLike.GetString();
            if (typeof asString === 'string' && asString.length > 0)
                return asString;
        }
    }
    catch { }
    try {
        if (typeof pathLike.pathString === 'string' && pathLike.pathString.length > 0) {
            return pathLike.pathString;
        }
    }
    catch { }
    try {
        const asString = String(value);
        if (typeof asString === 'string' && asString.length > 0 && asString !== '[object Object]') {
            return asString;
        }
    }
    catch { }
    return '';
}
export function toFiniteNumber(value) {
    if (value === null || value === undefined)
        return undefined;
    if (typeof value === 'string' && value.trim() === '')
        return undefined;
    const numeric = Number(value);
    if (!Number.isFinite(numeric))
        return undefined;
    return numeric;
}
export function clamp01(value) {
    return Math.max(0, Math.min(1, value));
}
export function nearlyEqual(a, b, epsilon = 1e-4) {
    return Math.abs(Number(a) - Number(b)) <= epsilon;
}
export function toColorArray(value) {
    const arrayValue = toArrayLike(value);
    if (!arrayValue || arrayValue.length < 3)
        return null;
    const r = toFiniteNumber(arrayValue[0]);
    const g = toFiniteNumber(arrayValue[1]);
    const b = toFiniteNumber(arrayValue[2]);
    if (r === undefined || g === undefined || b === undefined)
        return null;
    return [clamp01(r), clamp01(g), clamp01(b)];
}
