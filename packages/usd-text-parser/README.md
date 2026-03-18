# @openlegged/usd-text-parser

零依赖的 USD / USDA 文本解析工具，面向机器人资产中的：

- 资产引用提取
- `colliders` / `visuals` 语义结构解析
- Physics Joint 文本提取
- link inertial patch 提取
- `xformOp:*` fallback 文本提取

## 安装

```bash
npm install @openlegged/usd-text-parser
```

## 用法

```ts
import {
  extractJointRecordsFromLayerText,
  parseColliderEntriesFromLayerText,
  parseXformOpFallbacksFromLayerText,
} from "@openlegged/usd-text-parser";

const joints = extractJointRecordsFromLayerText(layerText);
const colliders = parseColliderEntriesFromLayerText(layerText);
const xformFallbacks = parseXformOpFallbacksFromLayerText(layerText);
```

## 当前导出

- `normalizeUsdPathToken`
- `extractUsdAssetReferencesFromLayerText`
- `extractReferencePrimTargets`
- `findMatchingClosingBraceIndex`
- `extractScopeBodyText`
- `parseVisualSemanticChildNamesFromLayerText`
- `parseGuideCollisionReferencesFromLayerText`
- `parseColliderEntriesFromLayerText`
- `extractJointRecordsFromLayerText`
- `parseLinkDynamicsPatchesFromLayerText`
- `parseXformOpFallbacksFromLayerText`
