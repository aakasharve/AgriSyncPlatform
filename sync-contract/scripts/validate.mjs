#!/usr/bin/env node
// sync-contract/scripts/validate.mjs
import { readFile } from 'node:fs/promises';

const json = JSON.parse(await readFile(new URL('../schemas/mutation-types.json', import.meta.url), 'utf8'));

const errors = [];
const seen = new Set();

if (!Array.isArray(json.mutationTypes) || json.mutationTypes.length === 0) {
  errors.push('mutationTypes must be a non-empty array');
}

for (const m of json.mutationTypes ?? []) {
  if (typeof m.name !== 'string' || m.name.trim() !== m.name || m.name.length === 0) {
    errors.push(`invalid name: ${JSON.stringify(m.name)}`);
  }
  if (seen.has(m.name)) errors.push(`duplicate name: ${m.name}`);
  seen.add(m.name);
  if (typeof m.ownerAggregate !== 'string' || m.ownerAggregate.length === 0) {
    errors.push(`${m.name}: ownerAggregate required`);
  }
  if (!/^\d+\.\d+\.\d+$/.test(m.sinceVersion)) {
    errors.push(`${m.name}: sinceVersion must be semver`);
  }
  if (typeof m.payloadSchema !== 'string' || m.payloadSchema.length === 0) {
    errors.push(`${m.name}: payloadSchema required`);
  }
}

if (errors.length) {
  console.error('mutation-types.json failed validation:');
  for (const e of errors) console.error('  - ' + e);
  process.exit(1);
}

console.log(`OK — ${json.mutationTypes.length} mutations validated.`);
