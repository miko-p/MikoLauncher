#!/usr/bin/env bash
# M9-4：把 plugin-host sidecar 打成「单文件可执行」，并放置到 Tauri externalBin 的
# 预期位置（<src-tauri>/binaries/plugin-host-<triple>）。
#
# 方案 A（发布 runtime 选型）：bun build --compile 内嵌 Bun runtime，
# 因 sidecar 已无任何原生模块（SQLite 用 node:sqlite），可打成纯单文件。
#
# 用法：
#   ./build-binary.sh [target]
#     target  默认 x86_64-unknown-linux-gnu（本机），TTIP 到 bun target：
#             x86_64-unknown-linux-gnu -> bun-linux-x64
#             aarch64-unknown-linux-gnu -> bun-linux-aarch64
#             x86_64-apple-darwin       -> bun-darwin-x64
#             aarch64-apple-darwin      -> bun-darwin-aarch64
#             x86_64-pc-windows-msvc    -> bun-windows-x64
set -euo pipefail

cd "$(dirname "$0")"

TRIPLE="${1:-x86_64-unknown-linux-gnu}"
case "$TRIPLE" in
  x86_64-unknown-linux-gnu)  BUN_TARGET="bun-linux-x64" ;;
  aarch64-unknown-linux-gnu) BUN_TARGET="bun-linux-aarch64" ;;
  x86_64-apple-darwin)       BUN_TARGET="bun-darwin-x64" ;;
  aarch64-apple-darwin)      BUN_TARGET="bun-darwin-aarch64" ;;
  x86_64-pc-windows-msvc)    BUN_TARGET="bun-windows-x64" ;;
  *)
    echo "未知 triple: $TRIPLE" >&2
    exit 1
    ;;
esac

echo "[build-binary] triple=$TRIPLE → bun target=$BUN_TARGET"

# 1) esbuild 打 ESM 单文件 bundle（无 external，纯 JS）
echo "[build-binary] esbuild bundle → dist/main.mjs"
node build.mjs

# 2) bun 内嵌 runtime 打成单文件可执行
OUT=".build/plugin-host-$TRIPLE"
mkdir -p .build
echo "[build-binary] bun compile → $OUT"
bun build dist/main.mjs --compile --outfile "$OUT" --target "$BUN_TARGET"

# 3) 放置到 Tauri externalBin 预期目录（Tauri 按 <name>-<triple> 查找）
DEST="../../apps/desktop/src-tauri/binaries/plugin-host-$TRIPLE"
mkdir -p "$(dirname "$DEST")"
install -m 0755 "$OUT" "$DEST"
echo "[build-binary] 已放置: $DEST"
ls -la "$DEST"
