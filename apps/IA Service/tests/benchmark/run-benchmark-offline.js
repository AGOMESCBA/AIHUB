'use strict';

const path = require('path');
const {
  loadDataset,
  runDatasetOffline,
} = require('./engine/benchmark-runner');

async function main() {
  const datasetPath = process.argv[2] || path.join(__dirname, 'cases', 'development', 'initial-cases.json');
  const dataset = loadDataset(datasetPath);
  const baseline = await runDatasetOffline(dataset);
  console.log(JSON.stringify(baseline, null, 2));
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
