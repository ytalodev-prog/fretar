'use strict';
const fs = require('node:fs');
const path = require('node:path');
const config = require('../server/config');
const store = require('../server/store');

async function main() {
  if (!config.DATABASE_URL) throw new Error('Defina DATABASE_URL no .env antes de importar.');
  const file = path.resolve(process.argv[2] || path.join(__dirname, '..', 'data', 'db.json'));
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  await store.load();
  const result = await store.importLegacyData(data);
  console.log(`Importação concluída: ${result.users} notificantes e ${result.avisos} avisos.`);
}

main().catch((error) => {
  console.error(`Falha na importação: ${error.message}`);
  process.exitCode = 1;
});
