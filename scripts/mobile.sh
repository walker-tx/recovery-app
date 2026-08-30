#!/bin/sh
set -eu

case ${RECOVERY_EXPO_MODE:-localhost} in
  localhost) unset REACT_NATIVE_PACKAGER_HOSTNAME ;;
  tailnet)
    [ -n "${RECOVERY_EXPO_HOSTNAME:-}" ] || { echo 'RECOVERY_EXPO_HOSTNAME is required in tailnet mode.' >&2; exit 1; }
    export REACT_NATIVE_PACKAGER_HOSTNAME=$RECOVERY_EXPO_HOSTNAME
    ;;
  *) echo 'RECOVERY_EXPO_MODE must be localhost or tailnet.' >&2; exit 1 ;;
esac

exec pnpm --filter @recovery/mobile exec expo start --localhost --port 8081
