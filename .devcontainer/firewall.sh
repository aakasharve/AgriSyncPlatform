#!/usr/bin/env bash
# firewall.sh — Network-egress allowlist for AgriSync devcontainer
# runbook: _COFOUNDER/runbooks/devcontainer.md
# Runs as postStartCommand; requires root or CAP_NET_ADMIN

set -uo pipefail

# Skip if not running as root (e.g., Codespaces without elevated privs)
[ "$(id -u)" -ne 0 ] && echo "[firewall] Skipping — not root." && exit 0
command -v iptables &>/dev/null || { echo "[firewall] iptables not available — skipping."; exit 0; }

LOG_FILE="/tmp/firewall-blocked.log"

# Allow loopback
iptables -A OUTPUT -o lo -j ACCEPT

# Allow established connections
iptables -A OUTPUT -m state --state ESTABLISHED,RELATED -j ACCEPT

# Allow DNS
iptables -A OUTPUT -p udp --dport 53 -j ACCEPT
iptables -A OUTPUT -p tcp --dport 53 -j ACCEPT

# Allowlist: GitHub
iptables -A OUTPUT -d api.github.com -j ACCEPT
iptables -A OUTPUT -d github.com -j ACCEPT
iptables -A OUTPUT -d objects.githubusercontent.com -j ACCEPT

# Allowlist: NuGet
iptables -A OUTPUT -d api.nuget.org -j ACCEPT
iptables -A OUTPUT -d globalcdn.nuget.org -j ACCEPT

# Allowlist: npm
iptables -A OUTPUT -d registry.npmjs.org -j ACCEPT
iptables -A OUTPUT -d registry.npmjs.com -j ACCEPT

# Allowlist: Anthropic API
iptables -A OUTPUT -d api.anthropic.com -j ACCEPT

# Allowlist: Gemini API
iptables -A OUTPUT -d generativelanguage.googleapis.com -j ACCEPT

# Allowlist: Sarvam (future)
iptables -A OUTPUT -d api.sarvam.ai -j ACCEPT

# Default deny + log
iptables -A OUTPUT -j LOG --log-prefix "[firewall-blocked] " --log-level 4
iptables -A OUTPUT -j REJECT

echo "[firewall] Egress allowlist active. Blocked attempts logged to $LOG_FILE"
