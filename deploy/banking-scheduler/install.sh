#!/bin/sh
set -eu

if [ "$(id -u)" != 0 ]; then
    printf '%s\n' 'Run this installation script as root.' >&2
    exit 1
fi
source_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
for executable in /usr/bin/curl /usr/bin/date /usr/bin/grep; do
    test -x "$executable" || { printf 'Missing executable: %s\n' "$executable" >&2; exit 1; }
done
command -v systemd-analyze >/dev/null
command -v systemctl >/dev/null
test -f /usr/share/zoneinfo/Europe/Bucharest
/bin/sh -n "$source_dir/budget-tracker-banking"
systemd-analyze calendar '*-*-* 08,14,20:00:00 Europe/Bucharest' --iterations=4

# Never overwrite an existing installation or an existing secret.
for destination in \
    /etc/budget-tracker-banking \
    /usr/local/libexec/budget-tracker-banking \
    /etc/systemd/system/budget-tracker-banking.service \
    /etc/systemd/system/budget-tracker-banking.timer; do
    if [ -e "$destination" ] || [ -L "$destination" ]; then
        printf 'Already exists; inspect before replacing: %s\n' "$destination" >&2
        exit 1
    fi
done

install -d -o root -g root -m 0700 /etc/budget-tracker-banking
install -o root -g root -m 0600 "$source_dir/curl.conf.example" /etc/budget-tracker-banking/curl.conf
install -d -o root -g root -m 0755 /usr/local/libexec
install -o root -g root -m 0755 "$source_dir/budget-tracker-banking" /usr/local/libexec/budget-tracker-banking
install -o root -g root -m 0644 "$source_dir/budget-tracker-banking.service" /etc/systemd/system/budget-tracker-banking.service
install -o root -g root -m 0644 "$source_dir/budget-tracker-banking.timer" /etc/systemd/system/budget-tracker-banking.timer

systemd-analyze verify /etc/systemd/system/budget-tracker-banking.service /etc/systemd/system/budget-tracker-banking.timer
systemctl daemon-reload
printf '%s\n' 'Installed, but NOT enabled or started. Fill the root-only config, then follow README.md.'
