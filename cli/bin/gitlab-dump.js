#!/usr/bin/env node

import { main } from '../index.js';

main(process.argv).then(
  (code) => process.exit(code),
  (err) => {
    console.error(err.message || err);
    process.exit(1);
  }
);
