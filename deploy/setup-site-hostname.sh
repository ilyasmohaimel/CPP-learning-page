#!/usr/bin/env bash
# Add only a C Forge TLS virtual host on the existing HTTPS gateway port.
set -euo pipefail
test "$(id -u)" -eq 0
cforge_host=c-forge.51.170.138.252.sslip.io
cforge_acme=/etc/c-forge/acme
cforge_webroot=/var/lib/immich-acme
cforge_certificate="$cforge_acme/live/c-forge-sites-hostname"
cforge_certbot=$(command -v certbot || true)
if [ -z "$cforge_certbot" ] && [ -x /snap/bin/certbot ]; then cforge_certbot=/snap/bin/certbot; fi
test -x "$cforge_certbot"
test -d "$cforge_webroot"
test -f /opt/c-forge/.c-forge-managed
getent ahostsv4 "$cforge_host" | awk '$1=="51.170.138.252" {found=1} END {exit !found}'
# The separate ACME configuration cannot run existing VPN certificate hooks.
install -d -m 700 "$cforge_acme" /var/lib/c-forge-acme /var/log/c-forge-acme
"$cforge_certbot" certonly --webroot -w "$cforge_webroot" \
  --config-dir "$cforge_acme" --work-dir /var/lib/c-forge-acme --logs-dir /var/log/c-forge-acme \
  --cert-name c-forge-sites-hostname -d "$cforge_host" \
  --non-interactive --agree-tos --register-unsafely-without-email --no-directory-hooks
openssl x509 -in "$cforge_certificate/cert.pem" -noout -dates -ext subjectAltName
cforge_site=/etc/nginx/sites-available/c-forge-sites
cforge_enabled=/etc/nginx/sites-enabled/zz-c-forge-sites
# Keep the original IP-address server first: IP TLS clients omit SNI.
if [ -L /etc/nginx/sites-enabled/c-forge-sites ] && [ "$(readlink -f /etc/nginx/sites-enabled/c-forge-sites)" = "$cforge_site" ]; then
  rm /etc/nginx/sites-enabled/c-forge-sites
fi
if [ -e "$cforge_site" ] && ! head -1 "$cforge_site" | grep -q '^# Managed C Forge Site hostname'; then
  echo 'Preserving an unrelated configuration at the requested path.' >&2; exit 1
fi
cforge_previous=$(mktemp /var/tmp/c-forge-nginx.XXXXXX)
cforge_had_site=false
if [ -f "$cforge_site" ]; then cp -p "$cforge_site" "$cforge_previous"; cforge_had_site=true; fi
trap 'rm -f "$cforge_previous"' EXIT
cat > "$cforge_site" <<NGINX
# Managed C Forge Site hostname: independent SNI virtual host; no VPN listeners.
server {
    listen 8445 ssl http2;
    server_name $cforge_host;
    ssl_certificate $cforge_certificate/fullchain.pem;
    ssl_certificate_key $cforge_certificate/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    add_header Strict-Transport-Security "max-age=31536000" always;
    include /etc/nginx/snippets/c-forge-location.conf;
    location / { return 404; }
}
NGINX
chmod 644 "$cforge_site"
ln -sfn "$cforge_site" "$cforge_enabled"
if ! nginx -t; then
  if "$cforge_had_site"; then cp -p "$cforge_previous" "$cforge_site"; else rm -f "$cforge_enabled" "$cforge_site"; fi
  exit 1
fi
systemctl reload nginx
# Validate the new certificate and route, without insecure TLS fallbacks.
curl --fail --silent --show-error --retry 5 --retry-all-errors --retry-delay 1 --max-time 20 --resolve "$cforge_host:8445:127.0.0.1" "https://$cforge_host:8445/forge/api/health"
cat > /etc/systemd/system/c-forge-acme.service <<UNIT
[Unit]
Description=Renew only C Forge Site backend HTTPS certificate
After=network-online.target nginx.service
Wants=network-online.target
[Service]
Type=oneshot
ExecStart=$cforge_certbot renew --config-dir $cforge_acme --work-dir /var/lib/c-forge-acme --logs-dir /var/log/c-forge-acme --non-interactive --no-directory-hooks --deploy-hook "/usr/sbin/nginx -t && /usr/bin/systemctl reload nginx"
TimeoutStartSec=300
Nice=10
UNIT
cat > /etc/systemd/system/c-forge-acme.timer <<'UNIT'
[Unit]
Description=Check C Forge HTTPS certificate renewal daily
[Timer]
OnCalendar=daily
RandomizedDelaySec=1h
Persistent=true
[Install]
WantedBy=timers.target
UNIT
systemctl daemon-reload
systemctl enable --now c-forge-acme.timer
printf '\nC Forge hostname configured; existing IP certificate, VPN services, ports and tunnels unchanged.\n'
