#!/usr/bin/env bash
set -euo pipefail

if [[ $# != 3 || "$3" != /* || -e "$3" ]]; then
  echo "Usage: bash stage-doyle-workspace.sh <Doyle checkout> <ref> <new absolute release directory>" >&2
  exit 1
fi

repo=$1
ref=$2
release=$3
stage=$(mktemp -d "${release}.XXXXXX")
trap 'rmdir -- "$stage" 2>/dev/null || true' EXIT
pages=(tournaments.html rooms.html admin.html crm.html)
assets=(js lib svg_playing_cards assets/DOYLE-CMK.png assets/logo.png
  assets/apple-touch-icon-admin.png assets/felt-1.jpg assets/felt-2.jpg assets/felt-3.jpg assets/sfx assets/voice)
git -c safe.directory="$repo" -C "$repo" archive "$ref" -- "${pages[@]}" "${assets[@]}" | tar -x -C "$stage"

initializer='supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY, { global: { fetch: window.sbFetchFailover } })'
for page in "${pages[@]}"; do
  if [[ $(grep -Fc "$initializer" "$stage/$page") != 1 ]]; then
    echo "Unsupported Doyle client initialization in $page" >&2
    exit 1
  fi
done
if [[ -n $(find "$stage" -type l -print -quit) ]]; then
  echo "The Doyle workspace archive contains a symbolic link" >&2
  exit 1
fi
chmod -R a+rX "$stage"
chmod 755 "$stage"
mv -T --no-clobber "$stage" "$release"
test ! -d "$stage"
