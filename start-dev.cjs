process.chdir(__dirname);
process.argv = ['node', 'next', 'dev', '--port', '3006'];
require('./node_modules/next/dist/bin/next');
