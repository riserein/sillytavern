# SHA-256 vendor module

`sha256.js` is a browser ESM bundle of `@noble/hashes` **1.8.0**, MIT, used for incremental SHA-256 on HTTPS and HTTP LAN installations. It is about 5 KiB; no network request or WebAssembly is used at runtime. Source, integrity pin and development-only dependency are recorded in package-lock.json. License: noble-hashes-LICENSE.txt.

Rebuild after a reviewed version change:

```sh
npm ci
npm exec --yes --package esbuild@0.25.10 -- esbuild node_modules/@noble/hashes/esm/sha256.js --bundle --format=esm --target=es2022 --minify --legal-comments=inline --outfile=vendor/sha256.js
```

ZIP creation/reading lives in data/zip.js. SHA-256/CRC are corruption checks, not a signature or proof that an imported backup is trusted.
