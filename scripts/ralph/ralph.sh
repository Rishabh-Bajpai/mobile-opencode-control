#!/bin/bash
# Ralph Wiggum - Long-running AI agent loop
# Usage: ./ralph.sh [max_iterations]

set -e

MAX_ITERATIONS=${1:-10}
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PRD_FILE="$SCRIPT_DIR/prd.json"
PROGRESS_FILE="$SCRIPT_DIR/progress.txt"
ARCHIVE_DIR="$SCRIPT_DIR/archive"
LAST_BRANCH_FILE="$SCRIPT_DIR/.last-branch"
LOG_DIR="${RALPH_LOG_DIR:-$SCRIPT_DIR/logs}"
ITERATION_TIMEOUT_SECONDS="${RALPH_ITERATION_TIMEOUT_SECONDS:-7200}"
MAX_STAGNANT_ITERATIONS="${RALPH_MAX_STAGNANT_ITERATIONS:-5}"
STAGNANT_COUNT=0

get_passed_count() {
  if [ ! -f "$PRD_FILE" ]; then
    echo "-1"
    return
  fi

  local count
  count=$(jq -r '[.userStories[]? | select(.passes == true)] | length' "$PRD_FILE" 2>/dev/null || true)
  if [ -z "$count" ]; then
    echo "-1"
  else
    echo "$count"
  fi
}

get_remaining_count() {
  if [ ! -f "$PRD_FILE" ]; then
    echo "-1"
    return
  fi

  local count
  count=$(jq -r '[.userStories[]? | select(.passes != true)] | length' "$PRD_FILE" 2>/dev/null || true)
  if [ -z "$count" ]; then
    echo "-1"
  else
    echo "$count"
  fi
}

# Archive previous run if branch changed
if [ -f "$PRD_FILE" ] && [ -f "$LAST_BRANCH_FILE" ]; then
  CURRENT_BRANCH=$(jq -r '.branchName // empty' "$PRD_FILE" 2>/dev/null || echo "")
  LAST_BRANCH=$(cat "$LAST_BRANCH_FILE" 2>/dev/null || echo "")

  if [ -n "$CURRENT_BRANCH" ] && [ -n "$LAST_BRANCH" ] && [ "$CURRENT_BRANCH" != "$LAST_BRANCH" ]; then
    # Archive the previous run
    DATE=$(date +%Y-%m-%d)
    # Strip "ralph/" prefix from branch name for folder
    FOLDER_NAME=$(echo "$LAST_BRANCH" | sed 's|^ralph/||')
    ARCHIVE_FOLDER="$ARCHIVE_DIR/$DATE-$FOLDER_NAME"

    echo "Archiving previous run: $LAST_BRANCH"
    mkdir -p "$ARCHIVE_FOLDER"
    [ -f "$PRD_FILE" ] && cp "$PRD_FILE" "$ARCHIVE_FOLDER/"
    [ -f "$PROGRESS_FILE" ] && cp "$PROGRESS_FILE" "$ARCHIVE_FOLDER/"
    echo "   Archived to: $ARCHIVE_FOLDER"

    # Reset progress file for new run
    echo "# Ralph Progress Log" > "$PROGRESS_FILE"
    echo "Started: $(date)" >> "$PROGRESS_FILE"
    echo "---" >> "$PROGRESS_FILE"
  fi
fi

# Track current branch
if [ -f "$PRD_FILE" ]; then
  CURRENT_BRANCH=$(jq -r '.branchName // empty' "$PRD_FILE" 2>/dev/null || echo "")
  if [ -n "$CURRENT_BRANCH" ]; then
    echo "$CURRENT_BRANCH" > "$LAST_BRANCH_FILE"
  fi
fi

# Initialize progress file if it doesn't exist
if [ ! -f "$PROGRESS_FILE" ]; then
  echo "# Ralph Progress Log" > "$PROGRESS_FILE"
  echo "Started: $(date)" >> "$PROGRESS_FILE"
  echo "---" >> "$PROGRESS_FILE"
fi

echo "Starting Ralph - Max iterations: $MAX_ITERATIONS"

mkdir -p "$LOG_DIR"

MODEL_FLAGS=(--model=claude-3-5-sonnet-20241022)

TIMEOUT_CMD=()
TIMEOUT_ENABLED=0
if [[ "$ITERATION_TIMEOUT_SECONDS" =~ ^[0-9]+$ ]] && [ "$ITERATION_TIMEOUT_SECONDS" -gt 0 ]; then
  if command -v timeout >/dev/null 2>&1; then
    TIMEOUT_CMD=(timeout "$ITERATION_TIMEOUT_SECONDS")
    TIMEOUT_ENABLED=1
  else
    echo "Warning: 'timeout' not found; running without per-iteration timeout."
  fi
else
  ITERATION_TIMEOUT_SECONDS=0
fi

if ! [[ "$MAX_STAGNANT_ITERATIONS" =~ ^[0-9]+$ ]]; then
  MAX_STAGNANT_ITERATIONS=5
fi

OPENCODE_CMD=(opencode run "${MODEL_FLAGS[@]}")
if [ "$TIMEOUT_ENABLED" -eq 1 ]; then
  RUN_CMD=("${TIMEOUT_CMD[@]}" "${OPENCODE_CMD[@]}")
else
  RUN_CMD=("${OPENCODE_CMD[@]}")
fi

for i in $(seq 1 $MAX_ITERATIONS); do
  echo ""
  echo "═══════════════════════════════════════════════════════"
  echo "  Ralph Iteration $i of $MAX_ITERATIONS"
  echo "═══════════════════════════════════════════════════════"

  PASSED_BEFORE=$(get_passed_count)
  ITERATION_LOG="$LOG_DIR/iteration-$i.log"
  echo "  Log: $ITERATION_LOG"

  # Run opencode with the ralph prompt
  # Use 'opencode run' for non-interactive execution (not just 'opencode' which launches TUI)
  # Use Google model if available, otherwise use default
  set +e
  "${RUN_CMD[@]}" < "$SCRIPT_DIR/prompt.md" 2>&1 | tee "$ITERATION_LOG" | tee /dev/stderr
  RUN_STATUS=${PIPESTATUS[0]}
  set -e

  if [ "$TIMEOUT_ENABLED" -eq 1 ] && [ "$RUN_STATUS" -eq 124 ]; then
    {
      echo "## $(date) - Iteration $i"
      echo "- Iteration timed out after ${ITERATION_TIMEOUT_SECONDS}s."
      echo "- Log: $ITERATION_LOG"
      echo "---"
    } >> "$PROGRESS_FILE"
  fi

  TOKEN_SEEN=0
  if grep -q "<promise>COMPLETE</promise>" "$ITERATION_LOG"; then
    TOKEN_SEEN=1
  fi

  REMAINING_COUNT=$(get_remaining_count)
  if [ "$REMAINING_COUNT" -eq 0 ]; then
    echo ""
    echo "Ralph completed all tasks!"
    echo "Completed at iteration $i of $MAX_ITERATIONS"
    exit 0
  fi

  if [ "$TOKEN_SEEN" -eq 1 ]; then
    echo "Completion signal detected, but PRD still has remaining stories."
  fi

  PASSED_AFTER=$(get_passed_count)
  if [ "$PASSED_BEFORE" -ge 0 ] && [ "$PASSED_AFTER" -ge 0 ]; then
    if [ "$PASSED_AFTER" -gt "$PASSED_BEFORE" ]; then
      STAGNANT_COUNT=0
    else
      STAGNANT_COUNT=$((STAGNANT_COUNT + 1))
    fi
  else
    echo "Warning: Unable to read prd.json for progress detection."
  fi

  if [ "$MAX_STAGNANT_ITERATIONS" -gt 0 ] && [ "$STAGNANT_COUNT" -ge "$MAX_STAGNANT_ITERATIONS" ]; then
    {
      echo "## $(date) - Ralph stopped"
      echo "- Reason: No progress for ${STAGNANT_COUNT} consecutive iterations."
      echo "- Log: $ITERATION_LOG"
      echo "---"
    } >> "$PROGRESS_FILE"
    echo ""
    echo "Ralph stopped due to repeated non-progress iterations."
    echo "Check $PROGRESS_FILE and $ITERATION_LOG for details."
    exit 1
  fi

  echo "Iteration $i complete. Continuing..."
  sleep 2
done

echo ""
echo "Ralph reached max iterations ($MAX_ITERATIONS) without completing all tasks."
echo "Check $PROGRESS_FILE for status."
exit 1
