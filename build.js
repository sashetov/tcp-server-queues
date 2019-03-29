#!/bin/node
require('child_process').execSync( 'npm install && npm run jsdoc && npm test;', {stdio: 'inherit'});
