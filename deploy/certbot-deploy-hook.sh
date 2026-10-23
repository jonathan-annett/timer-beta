#!/bin/sh
# Restart the pairing server after certbot renews the certificate, so it loads the new one.
# Install (as root):
#   cp deploy/certbot-deploy-hook.sh /etc/letsencrypt/renewal-hooks/deploy/timer-remote.sh
#   chmod +x /etc/letsencrypt/renewal-hooks/deploy/timer-remote.sh
# Phones reconnect by themselves after the restart.
systemctl try-restart timer-remote.service
