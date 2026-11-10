#!/bin/sh
# Builds Flux, installs it in /Applications and signs it.
# An Apple Development identity keeps the same signature from one build to the next, so the
# keychain recognises the app and stops asking again for "Flux Safe Storage". Without one,
# the app is signed ad hoc and the keychain asks after every install.
set -e

pnpm package
rm -rf /Applications/Flux.app
cp -R dist/mac-arm64/Flux.app /Applications/

identity=$(security find-identity -v -p codesigning | awk '/Apple Development/ { print $2; exit }')
codesign --force --deep --sign "${identity:--}" /Applications/Flux.app
