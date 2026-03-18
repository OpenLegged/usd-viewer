import fs from 'node:fs/promises';
import path from 'node:path';
import {
  extractJointRecordsFromLayerText,
  parseColliderEntriesFromLayerText,
  parseGuideCollisionReferencesFromLayerText,
  parseLinkDynamicsPatchesFromLayerText,
  parseVisualSemanticChildNamesFromLayerText,
  parseXformOpFallbacksFromLayerText,
} from '../packages/usd-text-parser/dist/index.js';

const fixturePath = path.join(process.cwd(), 'packages/usd-text-parser/fixtures/robot-snippet.usda');
const text = await fs.readFile(fixturePath, 'utf8');

const colliders = parseColliderEntriesFromLayerText(text);
const guideColliders = parseGuideCollisionReferencesFromLayerText(text);
const joints = extractJointRecordsFromLayerText(text);
const linkDynamics = parseLinkDynamicsPatchesFromLayerText(text);
const visuals = parseVisualSemanticChildNamesFromLayerText(text);
const xformFallbacks = parseXformOpFallbacksFromLayerText(text);

const summary = {
  fixture: 'packages/usd-text-parser/fixtures/robot-snippet.usda',
  colliderLinks: colliders.size,
  guideColliderLinks: guideColliders.size,
  jointCount: joints.length,
  linkDynamicsCount: linkDynamics.size,
  visualSemanticLinks: visuals.size,
  xformFallbackPrimCount: xformFallbacks.size,
};

console.log(JSON.stringify(summary));

if (
  summary.colliderLinks <= 0
  || summary.guideColliderLinks <= 0
  || summary.jointCount <= 0
  || summary.linkDynamicsCount <= 0
  || summary.visualSemanticLinks <= 0
  || summary.xformFallbackPrimCount <= 0
) {
  throw new Error('usd-text-parser smoke check did not extract expected structured data');
}
