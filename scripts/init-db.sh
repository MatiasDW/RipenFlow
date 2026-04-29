#!/bin/sh

set -eu

sh scripts/run-bun.sh run db:push
sh scripts/run-bun.sh run db:seed:ripening-cycles
