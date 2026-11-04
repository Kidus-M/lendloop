#!/bin/sh
# Loads credentials and workflows into n8n, so a fresh checkout needs no clicking.
# Workflow files are the source of truth: re-running this overwrites UI edits.
set -eu

credentials_file="$(mktemp)"
trap 'rm -f "$credentials_file"' EXIT

node /bootstrap/scripts/render-credentials.mjs > "$credentials_file"
n8n import:credentials --input="$credentials_file"
n8n import:workflow --separate --input=/bootstrap/workflows

# The error handler must be published too, or n8n refuses to run it and failures go silent.
for workflow_id in lendloopErrors01 lendloopNotify01 lendloopOverdue1; do
  n8n publish:workflow --id="$workflow_id"
done
