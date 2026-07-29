const path = require('node:path');
const Mocha = require('mocha');

async function run() {
  const mocha = new Mocha({ ui: 'tdd', color: true });
  mocha.addFile(path.resolve(__dirname, 'extension.test.cjs'));
  await mocha.loadFilesAsync();
  return new Promise((resolve, reject) => {
    mocha.run(failures => failures ? reject(new Error(`${failures} test(s) failed`)) : resolve());
  });
}

module.exports = { run };
