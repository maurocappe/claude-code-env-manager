#!/bin/bash
# Mock claude binary — captures invocation details to JSON
# Uses pure bash/printf to avoid jq dependency

OUTPUT="${CENV_E2E_OUTPUT:-/tmp/cenv-e2e-claude-output.json}"

# Build args JSON array
ARGS="["
FIRST=true
for arg in "$@"; do
  if [ "$FIRST" = true ]; then
    FIRST=false
  else
    ARGS="$ARGS,"
  fi
  # Escape backslashes and double-quotes for JSON
  escaped=$(printf '%s' "$arg" | sed 's/\\/\\\\/g; s/"/\\"/g')
  ARGS="${ARGS}\"${escaped}\""
done
ARGS="${ARGS}]"

# Helper: encode a value as JSON string or null
json_val() {
  local val="$1"
  if [ -z "$val" ]; then
    printf 'null'
  else
    local escaped
    escaped=$(printf '%s' "$val" | sed 's/\\/\\\\/g; s/"/\\"/g')
    printf '"%s"' "$escaped"
  fi
}

# Capture env values
API_KEY_JSON=$(json_val "$ANTHROPIC_API_KEY")
BASE_URL_JSON=$(json_val "$ANTHROPIC_BASE_URL")
OAUTH_TOKEN_JSON=$(json_val "$CLAUDE_CODE_OAUTH_TOKEN")
OAUTH_REFRESH_JSON=$(json_val "$CLAUDE_CODE_OAUTH_REFRESH_TOKEN")
USE_BEDROCK_JSON=$(json_val "$CLAUDE_CODE_USE_BEDROCK")
USE_VERTEX_JSON=$(json_val "$CLAUDE_CODE_USE_VERTEX")

# Write JSON output using printf to avoid heredoc variable expansion issues
printf '{\n  "args": %s,\n  "env": {\n    "ANTHROPIC_API_KEY": %s,\n    "ANTHROPIC_BASE_URL": %s,\n    "CLAUDE_CODE_OAUTH_TOKEN": %s,\n    "CLAUDE_CODE_OAUTH_REFRESH_TOKEN": %s,\n    "CLAUDE_CODE_USE_BEDROCK": %s,\n    "CLAUDE_CODE_USE_VERTEX": %s\n  }\n}\n' \
  "$ARGS" \
  "$API_KEY_JSON" \
  "$BASE_URL_JSON" \
  "$OAUTH_TOKEN_JSON" \
  "$OAUTH_REFRESH_JSON" \
  "$USE_BEDROCK_JSON" \
  "$USE_VERTEX_JSON" \
  > "$OUTPUT"

exit 0
