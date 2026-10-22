#!/usr/bin/env bash
# Prepare a FRESH Debian/Ubuntu VPS for Prometheus. Idempotent.
#   - Docker Engine + compose plugin (official convenience script)
#   - ufw: allow SSH, 80, 443 only      (Docker published ports bypass ufw -- we publish nothing else)
#   - swap file, low swappiness
#   - unattended security upgrades
#   - docker log rotation + live-restore
#   - the shared "edge" docker network
# Usage: sudo SSH_PORT=22 SWAP_SIZE=2G ./scripts/bootstrap-vps.sh [--yes]
set -euo pipefail

[ "$(id -u)" -eq 0 ] || { echo "run as root (sudo)"; exit 1; }
SSH_PORT="${SSH_PORT:-22}"
SWAP_SIZE="${SWAP_SIZE:-2G}"
EDGE_NETWORK="${EDGE_NETWORK:-edge}"

if [ "${1:-}" != "--yes" ]; then
  cat <<EOF
This will: install Docker, enable ufw (allow tcp $SSH_PORT, 80, 443, udp 443), create a $SWAP_SIZE swapfile,
enable unattended-upgrades and write /etc/docker/daemon.json (if absent).
Make sure SSH is on port $SSH_PORT or you WILL lock yourself out.
EOF
  read -r -p "Continue? [y/N] " ans
  [ "$ans" = y ] || [ "$ans" = Y ] || exit 1
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y --no-install-recommends ca-certificates curl ufw unattended-upgrades

if ! command -v docker >/dev/null; then
  curl -fsSL https://get.docker.com | sh
fi

if [ ! -f /etc/docker/daemon.json ]; then
  mkdir -p /etc/docker
  cat > /etc/docker/daemon.json <<'EOF'
{
  "log-driver": "json-file",
  "log-opts": { "max-size": "10m", "max-file": "3" },
  "live-restore": true
}
EOF
  systemctl restart docker
fi

if ! swapon --show | grep -q .; then
  fallocate -l "$SWAP_SIZE" /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi
echo 'vm.swappiness=10' > /etc/sysctl.d/99-prm.conf
sysctl -p /etc/sysctl.d/99-prm.conf >/dev/null

ufw default deny incoming
ufw default allow outgoing
ufw allow "$SSH_PORT"/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 443/udp
ufw --force enable

dpkg-reconfigure -f noninteractive unattended-upgrades

docker network inspect "$EDGE_NETWORK" >/dev/null 2>&1 || docker network create "$EDGE_NETWORK"

echo
echo "Done. Next:"
echo "  cp edge/.env.example edge/.env && \$EDITOR edge/.env"
echo "  bin/prm edge up"
echo "  bin/prm new mysite example.com --type drupal"
