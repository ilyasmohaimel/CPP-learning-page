#!/bin/sh
set -eu
umask 077
# The directory contains only validated regular fixture files. It is read-only.
cp -R /fixtures/. /work/
# exec replaces this trusted script. No controller or grading state remains in
# the learner's process namespace. Argument values are never shell interpolated.
exec /program/main "$@"
