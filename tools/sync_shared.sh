#!/bin/sh
# Copy tools/shared/ui.css into every extension.
cd "$(dirname "$0")/.." || exit 1
for d in extensions/*/; do cp tools/shared/ui.css "$d/ui.css"; done
echo "ui.css copied to $(ls -d extensions/*/ | wc -l) extensions"
