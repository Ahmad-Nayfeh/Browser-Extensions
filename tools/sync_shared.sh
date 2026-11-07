#!/bin/sh
# Copy shared files into the extensions that use them.
cd "$(dirname "$0")/.." || exit 1
for d in extensions/*/; do cp tools/shared/ui.css "$d/ui.css"; done
for d in extensions/15-test-recorder extensions/16-site-blueprint; do cp tools/shared/zip.js "$d/zip.js"; done
echo "ui.css copied to $(ls -d extensions/*/ | wc -l) extensions, zip.js to 2"
