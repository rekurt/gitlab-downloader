#!/usr/bin/env node

import { main } from '../index.js';

main(process.argv).then(
  (code) => {
    process.exitCode = code;
  },
  (err) => {
    console.error(err.message || err);
    process.exitCode = 1;
  }
);
