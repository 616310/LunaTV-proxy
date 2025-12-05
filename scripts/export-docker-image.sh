#!/usr/bin/env bash

# Saves a built LunaTV Proxy Docker image into a gzip archive for release distribution.

set -euo pipefail

IMAGE_TAG="${1:-lunatv-proxy:latest}"
OUTPUT_PATH="${2:-dist/lunatv-proxy-prebuilt.tar.gz}"

if ! command -v docker >/dev/null 2>&1; then
  echo "docker is required but not found in PATH" >&2
  exit 1
fi

if ! docker image inspect "${IMAGE_TAG}" >/dev/null 2>&1; then
  echo "Docker image '${IMAGE_TAG}' not found. Build it first with 'docker build -t ${IMAGE_TAG} .'." >&2
  exit 1
fi

mkdir -p "$(dirname "${OUTPUT_PATH}")"

echo "Exporting Docker image '${IMAGE_TAG}' to '${OUTPUT_PATH}' ..."
docker save "${IMAGE_TAG}" | gzip > "${OUTPUT_PATH}"
echo "Export completed."

echo
echo "Next steps:"
echo "1. Upload '${OUTPUT_PATH}' to your GitHub Release."
echo "2. Customers can download it and run 'docker load -i $(basename "${OUTPUT_PATH}")'."
