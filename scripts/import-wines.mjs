// Loads a collection file (in the wines.json format) into a cellar: sets the
// cellar's title and adds the wines. If the cellar already has wines, add
// --replace to delete them first. Add --prod to load it into the production
// deployment. Find the cellar's ID with `npx convex run cellars:list`.
// Run it with: npm run import-wines -- seed/wines.json --cellar <ID> [--replace] [--prod]

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { checkCollection } from './check-wines.mjs';

const file = process.argv[2];
const cellarId = process.argv[process.argv.indexOf('--cellar') + 1];
const replace = process.argv.includes('--replace');
const deployment = process.argv.includes('--prod') ? ['--prod'] : [];
const collection = JSON.parse(readFileSync(file, 'utf8'));
const problems = checkCollection(collection);
if (problems.length) {
  console.log(problems.join('\n'));
  process.exit(1);
}

const { title, wines, wild = [] } = collection;
execFileSync('npx', ['convex', 'run', ...deployment, 'wines:importCollection', JSON.stringify({ cellarId, title, wines, wild, replace })], { stdio: 'inherit' });
