#!/bin/bash
# Lokale Grunddienste starten (Postgres und Docker), falls sie nicht laufen
pg_ctlcluster 16 main start 2>/dev/null
if ! docker ps >/dev/null 2>&1; then
  pkill containerd 2>/dev/null
  rm -f /var/run/docker.pid /var/run/docker/containerd/containerd.pid 2>/dev/null
  (nohup dockerd > /tmp/dockerd.log 2>&1 &)
  for i in $(seq 1 30); do docker ps >/dev/null 2>&1 && break; sleep 1; done
fi
docker ps >/dev/null 2>&1 && echo "bereit" || echo "Docker läuft nicht"
