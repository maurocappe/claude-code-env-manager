#!/bin/bash
# Mock macOS security CLI — file-backed keychain
# Storage format in CENV_E2E_KEYCHAIN: one entry per line as service\taccount\tvalue

KEYCHAIN="${CENV_E2E_KEYCHAIN:-/tmp/cenv-e2e-keychain.txt}"
touch "$KEYCHAIN"

# Parse command
CMD="$1"
shift

case "$CMD" in
  add-generic-password)
    # Parse flags: -U -a <account> -s <service> -w <data>
    ACCOUNT="" SERVICE="" DATA=""
    while [ $# -gt 0 ]; do
      case "$1" in
        -a) ACCOUNT="$2"; shift 2 ;;
        -s) SERVICE="$2"; shift 2 ;;
        -w) DATA="$2"; shift 2 ;;
        -U) shift ;;
        *) shift ;;
      esac
    done
    # Remove existing entry for this service+account
    grep -v "^${SERVICE}	${ACCOUNT}	" "$KEYCHAIN" > "${KEYCHAIN}.tmp" 2>/dev/null || true
    mv "${KEYCHAIN}.tmp" "$KEYCHAIN"
    # Add new entry
    printf '%s\t%s\t%s\n' "$SERVICE" "$ACCOUNT" "$DATA" >> "$KEYCHAIN"
    exit 0
    ;;

  find-generic-password)
    # Parse flags: -s <service> -w [-a <account>]
    SERVICE="" ACCOUNT="" WANT_PASSWORD=false
    while [ $# -gt 0 ]; do
      case "$1" in
        -s) SERVICE="$2"; shift 2 ;;
        -a) ACCOUNT="$2"; shift 2 ;;
        -w) WANT_PASSWORD=true; shift ;;
        *) shift ;;
      esac
    done
    if [ "$WANT_PASSWORD" = true ]; then
      if [ -n "$ACCOUNT" ]; then
        RESULT=$(grep "^${SERVICE}	${ACCOUNT}	" "$KEYCHAIN" | head -1 | cut -f3)
      else
        RESULT=$(grep "^${SERVICE}	" "$KEYCHAIN" | head -1 | cut -f3)
      fi
      if [ -n "$RESULT" ]; then
        printf '%s\n' "$RESULT"
        exit 0
      else
        echo "security: SecKeychainSearchCopyNext: The specified item could not be found in the keychain." >&2
        exit 44
      fi
    fi
    exit 0
    ;;

  delete-generic-password)
    ACCOUNT="" SERVICE=""
    while [ $# -gt 0 ]; do
      case "$1" in
        -a) ACCOUNT="$2"; shift 2 ;;
        -s) SERVICE="$2"; shift 2 ;;
        *) shift ;;
      esac
    done
    if grep -q "^${SERVICE}	${ACCOUNT}	" "$KEYCHAIN" 2>/dev/null; then
      grep -v "^${SERVICE}	${ACCOUNT}	" "$KEYCHAIN" > "${KEYCHAIN}.tmp"
      mv "${KEYCHAIN}.tmp" "$KEYCHAIN"
      exit 0
    else
      exit 44
    fi
    ;;

  *)
    echo "mock-security: unknown command $CMD" >&2
    exit 1
    ;;
esac
