#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST_DIR="${ROOT_DIR}/dist"
OUTPUT_NAME="${1:-lunatv-proxy-standalone.tar.gz}"
OUTPUT_PATH="${DIST_DIR}/${OUTPUT_NAME}"

echo "📦 构建 standalone 产物..."
cd "${ROOT_DIR}"
pnpm build

STANDALONE_DIR="${ROOT_DIR}/.next/standalone"
STATIC_DIR="${ROOT_DIR}/.next/static"
TMP_DIR="$(mktemp -d)"

echo "🔧 准备发布目录..."
cp -R "${STANDALONE_DIR}/." "${TMP_DIR}/"
mkdir -p "${TMP_DIR}/.next"
cp -R "${STATIC_DIR}" "${TMP_DIR}/.next/static"
cp -R "${ROOT_DIR}/public" "${TMP_DIR}/public"
cp -R "${ROOT_DIR}/config" "${TMP_DIR}/config"

mkdir -p "${DIST_DIR}"
tar -czf "${OUTPUT_PATH}" -C "${TMP_DIR}" .
rm -rf "${TMP_DIR}"

echo "✅ 已生成 ${OUTPUT_PATH}"
