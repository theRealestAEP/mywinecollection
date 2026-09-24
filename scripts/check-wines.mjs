// Checks a collection file (such as seed/wines.json) against shared/wines.schema.json.
// Run it with: npm run check-wines -- seed/wines.json
// It knows only the schema rules that wines.schema.json uses.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const schema = JSON.parse(readFileSync(new URL('../shared/wines.schema.json', import.meta.url), 'utf8'));

function typeOf(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (Number.isInteger(value)) return 'integer';
  return typeof value;
}

// Returns a list of problems. An empty list means the collection is valid.
export function checkCollection(data) {
  const problems = [];

  function check(value, rule, path) {
    if (rule.$ref) rule = rule.$ref.split('/').slice(1).reduce((node, key) => node[key], schema);
    for (const part of rule.allOf || []) check(value, part, path);
    const type = typeOf(value);
    if (rule.type) {
      const allowed = [].concat(rule.type);
      if (!allowed.includes(type) && !(type === 'integer' && allowed.includes('number'))) {
        problems.push(`${path} is ${type}, but must be ${allowed.join(' or ')}`);
      }
    }
    if (rule.enum && !rule.enum.includes(value)) {
      problems.push(`${path} is ${JSON.stringify(value)}, but must be one of: ${rule.enum.join(', ')}`);
    }
    if (rule.minimum !== undefined && value < rule.minimum) problems.push(`${path} is below ${rule.minimum}`);
    if (rule.maximum !== undefined && value > rule.maximum) problems.push(`${path} is above ${rule.maximum}`);
    if (type === 'array') {
      if (rule.minItems !== undefined && value.length < rule.minItems) problems.push(`${path} needs ${rule.minItems} or more items`);
      if (rule.maxItems !== undefined && value.length > rule.maxItems) problems.push(`${path} allows ${rule.maxItems} items at most`);
      if (rule.items) value.forEach((item, i) => check(item, rule.items, `${path}[${i}]`));
    }
    if (type === 'object') {
      for (const key of rule.required || []) {
        if (!(key in value)) problems.push(`${path} is missing ${key}`);
      }
      for (const [key, item] of Object.entries(value)) {
        if (rule.properties && rule.properties[key]) check(item, rule.properties[key], `${path}.${key}`);
        else if (rule.additionalProperties === false) problems.push(`${path} has an unknown field: ${key}`);
      }
    }
  }

  check(data, schema, 'collection');
  return problems;
}

// When run as a command, check the file named on the command line.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const file = process.argv[2];
  const problems = checkCollection(JSON.parse(readFileSync(file, 'utf8')));
  console.log(problems.length ? problems.join('\n') : `${file} is valid.`);
  process.exit(problems.length ? 1 : 0);
}
