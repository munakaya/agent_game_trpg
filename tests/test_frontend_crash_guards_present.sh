#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

# SSE reconnect timer cleanup guard
rg -q 'let reconnectTimer' web/src/net/sseClient.ts || {
  echo "SSE reconnect timer guard 누락"
  exit 1
}
rg -q 'clearTimeout\(reconnectTimer\)' web/src/net/sseClient.ts || {
  echo "SSE reconnect timer clear 누락"
  exit 1
}

# Animation manager lifecycle guard
rg -q 'private clearAllTimers\(\): void' web/src/state/animation/AnimationManager.ts || {
  echo "AnimationManager clearAllTimers 누락"
  exit 1
}
rg -q 'dispose\(\): void' web/src/state/animation/AnimationManager.ts || {
  echo "AnimationManager dispose 누락"
  exit 1
}
rg -q 'managerRef\.current\?\.dispose\(\)' web/src/state/animation/useAnimationQueue.ts || {
  echo "useAnimationQueue cleanup dispose 누락"
  exit 1
}

# requestAnimationFrame cleanup guard
for f in \
  web/src/components/DamageNumber.tsx \
  web/src/components/Projectile.tsx \
  web/src/components/ElementalParticle.tsx \
  web/src/components/SlashEffect.tsx \
  web/src/components/ImpactEffect.tsx; do
  rg -q 'cancelAnimationFrame' "$f" || {
    echo "requestAnimationFrame cleanup 누락: $f"
    exit 1
  }
done

echo "PASS: frontend crash-guard 패턴 확인"
