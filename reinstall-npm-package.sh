#!/usr/bin/env bash
# reinstall the NPM package for keri-ts / tufa
deno task npm:build:all
cd packages/keri
TARBALL="$(cd npm && npm pack --silent | tail -n1)"
npm install -g "$PWD/npm/$TARBALL"
