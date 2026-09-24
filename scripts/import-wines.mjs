// Loads a collection file (in the wines.json format) into the book: sets the
// title and adds the wines. If the book already has wines, add --replace to
// delete them first. Add --prod to load it into the production deployment.
// Run it with: npm run import-wines -- seed/wines.json [--replace] [--prod]

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { checkCollection } from './check-wines.mjs';

const file = process.argv[2];
const replace = process.argv.includes('--replace');
const deployment = process.argv.includes('--prod') ? ['--prod'] : [];
const collection = JSON.parse(readFileSync(file, 'utf8'));
const problems = checkCollection(collection);
if (problems.length) {
  console.log(problems.join('\n'));
  process.exit(1);
}

const { title, wines, wild = [] } = collection;
execFileSync('npx', ['convex', 'run', ...deployment, 'wines:importCollection', JSON.stringify({ title, wines, wild, replace })], { stdio: 'inherit' });
