#!/bin/sh
set -eu
test "$(id -u)" -ne 0
test "$(gcc -dumpfullversion)" = 14.2.0
test "$(awk '/^NoNewPrivs:/ {print $2}' /proc/self/status)" = 1
test "$(awk '/^Seccomp:/ {print $2}' /proc/self/status)" = 2
test "$(awk '/^CapEff:/ {print $2}' /proc/self/status)" = 0000000000000000
test "$(cat /sys/fs/cgroup/memory.max)" = 536870912
test "$(cat /sys/fs/cgroup/pids.max)" = 64
case ",$(awk '$2 == "/" {print $4}' /proc/mounts)," in
  *,ro,*) ;;
  *) exit 1 ;;
esac
test "$(ls /sys/class/net | wc -l)" -eq 1
test -d /sys/class/net/lo
if touch /etc/c-forge-should-be-read-only 2>/dev/null; then exit 1; fi
touch /work/probe
rm /work/probe
printf 'c-forge-isolation-ok gcc-14.2.0\n'
