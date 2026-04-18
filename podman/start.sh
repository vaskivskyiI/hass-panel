#!/bin/sh

set -eu

python3 /usr/local/bin/runtime_config_server.py &

exec nginx -g 'daemon off;'