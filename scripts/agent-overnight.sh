#!/usr/bin/env bash

set -uo pipefail
umask 077

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
PLAN="$ROOT/docs/overnight-auth-plan.md"
HANDOFF="$ROOT/docs/overnight-auth-handoff.md"
RUNTIME_DIR="$ROOT/.agent-overnight"
LOG_FILE="$RUNTIME_DIR/overnight.log"
STATE_FILE="$RUNTIME_DIR/state.env"
SESSION_LOG="$RUNTIME_DIR/sessions.tsv"
LOCK_DIR="$RUNTIME_DIR/supervisor.lock"

MAX_ITERATIONS=${MAX_ITERATIONS:-40}
MAX_PROVIDER_RETRIES=${MAX_PROVIDER_RETRIES:-3}
INVOCATION_TIMEOUT_SECONDS=${INVOCATION_TIMEOUT_SECONDS:-1800}
SUCCESS_PAUSE_SECONDS=${SUCCESS_PAUSE_SECONDS:-5}
DRY_RUN=0
RUN_ONCE=0
RESUME_DIRTY=0
ACTIVE_PID=""
WATCHDOG_PID=""
LOCK_HELD=0
LOCAL_DEPLOYMENT=""
LOCAL_AGENT_MODE=""
RUN_ID=$(date -u '+%Y%m%dT%H%M%SZ')-$$

usage() {
  cat <<'EOF'
Usage: scripts/agent-overnight.sh [options]

Options:
  --dry-run          Validate the repository and print the agent prompt without invoking Kit.
  --once             Run at most one Kit invocation.
  --resume-dirty     Allow startup with an existing dirty tree for crash recovery.
  --max-iterations N Override the maximum successful/retried invocation count.
  -h, --help         Show this help.

Environment overrides:
  MAX_PROVIDER_RETRIES          Default: 3
  INVOCATION_TIMEOUT_SECONDS    Default: 1800
  SUCCESS_PAUSE_SECONDS         Default: 5
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=1; shift ;;
    --once) RUN_ONCE=1; shift ;;
    --resume-dirty) RESUME_DIRTY=1; shift ;;
    --max-iterations)
      [ $# -ge 2 ] || { echo "Missing value for --max-iterations" >&2; exit 2; }
      MAX_ITERATIONS=$2
      shift 2
      ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
done

case "$MAX_ITERATIONS:$MAX_PROVIDER_RETRIES:$INVOCATION_TIMEOUT_SECONDS:$SUCCESS_PAUSE_SECONDS" in
  *[!0-9:]*|:*|*::*|*:) echo "Iteration, retry, timeout, and pause values must be non-negative integers." >&2; exit 2 ;;
esac

if [ "$MAX_ITERATIONS" -lt 1 ] || [ "$MAX_PROVIDER_RETRIES" -lt 1 ] || [ "$INVOCATION_TIMEOUT_SECONDS" -lt 60 ]; then
  echo "Require at least one iteration/retry and an invocation timeout of at least 60 seconds." >&2
  exit 2
fi

log() {
  printf '%s %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$*" | tee -a "$LOG_FILE"
}

cleanup() {
  if [ -n "$WATCHDOG_PID" ]; then kill "$WATCHDOG_PID" 2>/dev/null || true; fi
  if [ -n "$ACTIVE_PID" ] && kill -0 -- "-$ACTIVE_PID" 2>/dev/null; then
    kill -TERM -- "-$ACTIVE_PID" 2>/dev/null || true
    sleep 2
    kill -KILL -- "-$ACTIVE_PID" 2>/dev/null || true
  fi
  if [ "$LOCK_HELD" -eq 1 ]; then rm -rf "$LOCK_DIR"; LOCK_HELD=0; fi
}
trap cleanup INT TERM EXIT

require_command() {
  command -v "$1" >/dev/null 2>&1 || { echo "Required command not found: $1" >&2; exit 1; }
}

require_command git
require_command shasum

cd "$ROOT"

[ -f "$PLAN" ] || { echo "Missing plan: $PLAN" >&2; exit 1; }
[ -f "$HANDOFF" ] || { echo "Missing handoff: $HANDOFF" >&2; exit 1; }

preflight_unchecked_count() {
  awk '
    /^## Manual preflight before starting the overnight runner/ { inside=1; next }
    inside && /^## / { inside=0 }
    inside && /^- \[ \]/ { count++ }
    END { print count+0 }
  ' "$PLAN"
}

handoff_value() {
  local label=$1
  sed -n "s/^- \*\*$label:\*\* //p" "$HANDOFF" | head -1
}

correction_count() {
  local value
  value=$(handoff_value "Correction cycles for current section")
  case "$value" in
    ''|*[!0-9]*) return 1 ;;
    *) printf '%s\n' "$value" ;;
  esac
}

validate_action() {
  case "$1" in
    implement|review|correct|blocked|complete) return 0 ;;
    *) return 1 ;;
  esac
}

validate_local_deployment() {
  local deployment_file="$ROOT/packages/backend/.env.local"
  local count selected
  [ -f "$deployment_file" ] || { echo "Missing local Convex selection at packages/backend/.env.local." >&2; return 1; }
  count=$(grep -Ec '^CONVEX_DEPLOYMENT=' "$deployment_file" || true)
  [ "$count" -eq 1 ] || { echo "Expected exactly one CONVEX_DEPLOYMENT assignment; found $count." >&2; return 1; }
  grep -Eq '^CONVEX_DEPLOYMENT=(local|anonymous):[A-Za-z0-9._-]+$' "$deployment_file" || { echo "Convex deployment is not unambiguously local." >&2; return 1; }
  selected=$(sed -n 's/^CONVEX_DEPLOYMENT=//p' "$deployment_file")
  case "$selected" in
    anonymous:*)
      if [ -n "${CONVEX_AGENT_MODE:-}" ] && [ "$CONVEX_AGENT_MODE" != "anonymous" ]; then
        echo "Inherited CONVEX_AGENT_MODE conflicts with the selected anonymous-local deployment." >&2
        return 1
      fi
      LOCAL_AGENT_MODE=anonymous
      ;;
    local:*)
      if [ -n "${CONVEX_AGENT_MODE:-}" ]; then
        echo "Inherited CONVEX_AGENT_MODE conflicts with the selected local deployment." >&2
        return 1
      fi
      LOCAL_AGENT_MODE=""
      ;;
  esac
  if [ -n "${CONVEX_DEPLOYMENT:-}" ] && [ "$CONVEX_DEPLOYMENT" != "$selected" ]; then
    echo "Inherited CONVEX_DEPLOYMENT conflicts with the selected local deployment." >&2
    return 1
  fi
  if [ -n "$LOCAL_DEPLOYMENT" ] && [ "$LOCAL_DEPLOYMENT" != "$selected" ]; then
    echo "Local deployment selection changed during the run." >&2
    return 1
  fi
  LOCAL_DEPLOYMENT=$selected
}

worktree_fingerprint() {
  {
    git status --porcelain=v1 --untracked-files=all
    git diff --binary
    git diff --cached --binary
    git ls-files --others --exclude-standard | LC_ALL=C sort | while IFS= read -r path; do
      printf 'UNTRACKED %s\n' "$path"
      [ -f "$path" ] && shasum -a 256 "$path"
    done
  } | shasum -a 256 | awk '{ print $1 }'
}

head_commit() {
  git rev-parse HEAD
}

write_state() {
  local temp="$STATE_FILE.tmp"
  cat > "$temp" <<EOF
iteration=$1
provider_failures=$2
no_progress=$3
head=$(head_commit)
fingerprint=$(worktree_fingerprint)
next_action=$(handoff_value "Next action")
last_failure_fingerprint=${last_failure_fingerprint:-}
in_progress=${4:-0}
run_id=$RUN_ID
updated_at=$(date -u '+%Y-%m-%dT%H:%M:%SZ')
EOF
  mv "$temp" "$STATE_FILE"
}

state_value() {
  sed -n "s/^$1=//p" "$STATE_FILE" | head -1
}

extract_session_id() {
  local value
  value=$(awk '/^session_id: [A-Za-z0-9_-]+$/ { print $2 }' "$1" | tail -1)
  case "$value" in
    ''|*[!A-Za-z0-9_-]*) printf '%s\n' '-' ;;
    *)
      if [ "${#value}" -le 128 ]; then printf '%s\n' "$value"; else printf '%s\n' '-'; fi
      ;;
  esac
}

record_session() {
  local session_id
  session_id=$(extract_session_id "$7")
  printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
    "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$RUN_ID" "$1" "$2" "$session_id" "$3" "$4" "$5" "$6" "$(basename "$7")" >> "$SESSION_LOG"
}

validate_startup() {
  git rev-parse --show-toplevel >/dev/null 2>&1 || { echo "Not in a Git repository." >&2; exit 1; }

  local branch
  branch=$(git branch --show-current)
  [ -n "$branch" ] || { echo "Refusing unattended work on a detached HEAD." >&2; return 1; }
  if [ "$branch" = "main" ] || [ "$branch" = "master" ]; then
    echo "Refusing unattended work on $branch. Create an overnight branch first." >&2
    return 1
  fi

  git ls-files --error-unmatch "${PLAN#$ROOT/}" >/dev/null 2>&1 || { echo "Plan must be committed before running." >&2; return 1; }
  git ls-files --error-unmatch "${HANDOFF#$ROOT/}" >/dev/null 2>&1 || { echo "Handoff must be committed before running." >&2; return 1; }

  local unchecked
  unchecked=$(preflight_unchecked_count)
  if [ "$unchecked" -ne 0 ]; then
    echo "Manual preflight has $unchecked unchecked item(s). Complete and commit them first." >&2
    return 1
  fi

  local action
  action=$(handoff_value "Next action")
  validate_action "$action" || { echo "Unknown or missing handoff Next action: $action" >&2; return 1; }
  if [ "$action" = "blocked" ]; then
    echo "Handoff is blocked. Resolve its blocking condition before running." >&2
    return 1
  fi
  correction_count >/dev/null || { echo "Invalid correction-cycle count in handoff." >&2; return 1; }

  if [ "$RESUME_DIRTY" -eq 0 ] && [ -n "$(git status --porcelain=v1 --untracked-files=all)" ]; then
    echo "Working tree is dirty. Commit/clean it, or use --resume-dirty only for inspected crash recovery." >&2
    return 1
  fi

  validate_local_deployment || return 1

  return 0
}

agent_prompt() {
  cat <<'EOF'
You are one bounded worker in the Recovery app overnight auth run.

Read, in order:
1. AGENTS.md and any applicable nested AGENTS.md files.
2. docs/architecture.md.
3. docs/overnight-auth-plan.md.
4. docs/overnight-auth-handoff.md.

Then inspect git status, git diff (including staged and untracked work), and git log -5. Verify the handoff against actual repository state; repository state wins.

Perform exactly ONE durable handoff transition: implement, review, or correct. Do not begin a later feature in the same invocation.

IMPLEMENT:
- Activate applicable skills.
- Start with the smallest meaningful behavior test and demonstrate the intended red result. Do not commit red.
- Implement the smallest coherent change, refactor only within scope, rerun focused tests and package checks.
- Update the checklist and handoff with red/green evidence and exact checks.
- Commit tests, production code, checklist, and handoff together while green. Set Next action to review.

REVIEW:
- Use a fresh review lens and applicable review skills/subagents. Do not edit production code.
- Review the last feature/correction commit for correctness, architecture, simplicity, auth security/privacy, Convex authorization, accessibility, product fidelity, and test quality.
- For backend auth code, use Convex-specific review/authz skills.
- Classify findings by scope. A verified package limitation explicitly accepted for feature-level deferral is not a blocker for independent safe work: record the deferral, mark that section complete/deferred, reset the correction count to 0, and advance with Next action implement.
- If a blocking finding affects the current deliverable or remaining safe work and the current correction count is less than 2, increment it by exactly 1, set Next action to correct, and commit only verified review documentation.
- If such a blocking finding remains when the current correction count is already 2, set Next action to blocked; never request a third correction cycle.
- Keep `Correction cycles for current section` as a bare non-negative integer with no explanatory prose.
- If no blocking findings exist, record approval, reset the correction count to 0 for the next section, check/advance only the completed checklist state, set Next action to implement or complete, and commit only the verified review handoff.

CORRECT:
- Turn each blocking finding into a regression test first and demonstrate the intended red result. Do not commit red.
- Apply the smallest fix, rerun focused and package checks, update the handoff, commit while green, preserve the current correction count unchanged, and set Next action to review.
- Stop rather than exceed two correction cycles.

RECOVERY:
- A prior invocation may have failed after edits or a commit. Never assume it succeeded or failed.
- If a valid green commit already completed the transition, do not repeat it; repair/update the handoff and move to review.
- If uncommitted tests or partial code exist, inspect and rerun the smallest focused test, then finish only the current transition when safe.
- Do not use destructive cleanup, reset prior commits, amend, or overwrite unrelated work.

HARD LIMITS:
- Local Convex deployment only. Activate the deployment guard before any deployment-affecting command and stop if the target is not unambiguously local.
- Never run convex deploy, select/switch deployments, use cloud/prod, add Resend/OAuth/groups, expose verification codes to clients, use fixed codes, bypass verification, reveal account/provider existence, edit generated Convex files, or display raw provider errors.
- Do not print secrets or verification codes in your response.
- Use bounded commands and the smallest useful checks.
- Use Next action blocked only when a condition prevents remaining safe work or requires an unapproved product/security decision. An operator-approved feature deferral must not stop independent work.
- If run-wide blocked, record the verified blocker in the handoff when useful, set Next action to blocked, commit documentation only if appropriate, and exit.

End your response with exactly one marker: OVERNIGHT_RESULT=progress, OVERNIGHT_RESULT=blocked, or OVERNIGHT_RESULT=complete.
EOF
}

run_kit_with_timeout() {
  local attempt_log=$1
  local prompt=$2
  : > "$attempt_log"

  CONVEX_DEPLOYMENT="$LOCAL_DEPLOYMENT" CONVEX_AGENT_MODE="$LOCAL_AGENT_MODE" perl -MPOSIX=setsid -e 'setsid() or die "setsid failed: $!"; exec @ARGV or die "exec failed: $!"' -- \
    kit prompt --root "$ROOT" "$prompt" >"$attempt_log" 2>&1 &
  ACTIVE_PID=$!

  (
    sleep "$INVOCATION_TIMEOUT_SECONDS"
    if kill -0 -- "-$ACTIVE_PID" 2>/dev/null; then
      printf '%s\n' 'OVERNIGHT_SUPERVISOR_TIMEOUT' >> "$attempt_log"
      kill -TERM -- "-$ACTIVE_PID" 2>/dev/null || true
      sleep 10
      kill -KILL -- "-$ACTIVE_PID" 2>/dev/null || true
    fi
  ) &
  WATCHDOG_PID=$!

  wait "$ACTIVE_PID"
  local status=$?
  kill "$WATCHDOG_PID" 2>/dev/null || true
  wait "$WATCHDOG_PID" 2>/dev/null || true
  ACTIVE_PID=""
  WATCHDOG_PID=""
  cat "$attempt_log" | tee -a "$LOG_FILE"
  return "$status"
}

is_provider_failure() {
  grep -Eqi 'loop error: provider error: .*stream transport failed|OVERNIGHT_SUPERVISOR_TIMEOUT' "$1"
}

backoff_seconds() {
  case "$1" in
    1) echo 30 ;;
    2) echo 90 ;;
    *) echo 180 ;;
  esac
}

validate_transition() {
  local before_action=$1
  local before_count=$2
  local after_action=$3
  local after_count=$4

  [ "$after_action" = "blocked" ] && return 0
  case "$before_action:$after_action" in
    implement:review|correct:review) [ "$after_count" -eq "$before_count" ] ;;
    review:correct) [ "$after_count" -eq $((before_count + 1)) ] && [ "$after_count" -le 2 ] ;;
    review:implement|review:complete) [ "$after_count" -eq 0 ] ;;
    *) return 1 ;;
  esac
}

load_resume_state() {
  [ -f "$STATE_FILE" ] || { echo "Cannot resume: missing $STATE_FILE." >&2; return 1; }
  local saved_head saved_fingerprint saved_action
  saved_head=$(state_value head)
  saved_fingerprint=$(state_value fingerprint)
  saved_action=$(state_value next_action)
  saved_in_progress=$(state_value in_progress)
  if [ "$saved_in_progress" != "1" ]; then
    [ "$saved_head" = "$(head_commit)" ] || { echo "Cannot resume: HEAD differs from saved state. Inspect manually." >&2; return 1; }
    [ "$saved_fingerprint" = "$(worktree_fingerprint)" ] || { echo "Cannot resume: working tree differs from saved state. Inspect manually." >&2; return 1; }
    [ "$saved_action" = "$(handoff_value "Next action")" ] || { echo "Cannot resume: handoff differs from saved state. Inspect manually." >&2; return 1; }
  else
    echo "Adopting inspected repository state from an interrupted invocation." >&2
  fi
  iteration=$(state_value iteration)
  provider_failures=$(state_value provider_failures)
  no_progress=$(state_value no_progress)
  last_failure_fingerprint=$(state_value last_failure_fingerprint)
  case "$iteration:$provider_failures:$no_progress" in
    *[!0-9:]*) echo "Cannot resume: invalid saved counters." >&2; return 1 ;;
  esac
}

PROMPT=$(agent_prompt)

if ! validate_startup; then
  exit 1
fi

if [ "$DRY_RUN" -eq 1 ]; then
  echo "Dry run passed; Kit will not be invoked."
  echo "Root: $ROOT"
  echo "Branch: $(git branch --show-current)"
  echo "Manual preflight unchecked: $(preflight_unchecked_count)"
  echo "Handoff next action: $(handoff_value "Next action")"
  echo "--- Prompt ---"
  printf '%s\n' "$PROMPT"
  exit 0
fi

require_command kit
require_command perl
mkdir -p "$RUNTIME_DIR"
chmod 700 "$RUNTIME_DIR"
if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  echo "Another supervisor lock exists at $LOCK_DIR. Confirm no live run exists before removing it manually." >&2
  exit 1
fi
LOCK_HELD=1
printf '%s\n' "$$" > "$LOCK_DIR/pid"
touch "$LOG_FILE" "$SESSION_LOG"
if [ ! -s "$SESSION_LOG" ]; then
  printf 'timestamp\trun_id\titeration\taction\tsession_id\texit_status\tstart_head\tend_head\tnext_action\tattempt_log\n' > "$SESSION_LOG"
fi
chmod 600 "$LOG_FILE" "$SESSION_LOG"
find "$RUNTIME_DIR" -type f -exec chmod 600 {} +

iteration=0
provider_failures=0
no_progress=0
last_failure_fingerprint=""
if [ "$RESUME_DIRTY" -eq 1 ]; then
  load_resume_state || exit 1
  log "Resuming inspected state at iteration $iteration."
else
  : > "$STATE_FILE"
fi
log "Supervisor started on branch $(git branch --show-current), max iterations $MAX_ITERATIONS."

while [ "$iteration" -lt "$MAX_ITERATIONS" ]; do
  validate_local_deployment || { log "Local deployment validation failed; stopping."; exit 2; }
  action=$(handoff_value "Next action")
  validate_action "$action" || { log "Invalid handoff action: $action"; exit 2; }
  count=$(correction_count) || { log "Invalid correction-cycle count."; exit 2; }
  if [ "$action" = "complete" ]; then
    log "Handoff reports complete."
    write_state "$iteration" "$provider_failures" "$no_progress"
    exit 0
  fi
  if [ "$action" = "blocked" ]; then
    log "Handoff reports blocked; stopping."
    write_state "$iteration" "$provider_failures" "$no_progress"
    exit 3
  fi
  if [ "$action" = "correct" ] && [ "$count" -gt 2 ]; then
    log "Correction-cycle limit exceeded; stopping."
    exit 3
  fi

  iteration=$((iteration + 1))
  before_head=$(head_commit)
  before_fingerprint=$(worktree_fingerprint)
  before_handoff=$(shasum -a 256 "$HANDOFF" | awk '{ print $1 }')
  attempt_log="$RUNTIME_DIR/$RUN_ID-attempt-$(printf '%03d' "$iteration").log"
  log "Iteration $iteration starting action=$action head=$before_head."
  write_state "$iteration" "$provider_failures" "$no_progress" 1

  run_kit_with_timeout "$attempt_log" "$PROMPT"
  status=$?
  after_head=$(head_commit)
  after_fingerprint=$(worktree_fingerprint)
  after_action=$(handoff_value "Next action")
  record_session "$iteration" "$action" "$status" "$before_head" "$after_head" "$after_action" "$attempt_log"
  validate_local_deployment || { log "Deployment selection changed or became ambiguous during invocation; stopping."; exit 2; }

  if [ "$status" -ne 0 ]; then
    if is_provider_failure "$attempt_log"; then
      provider_failures=$((provider_failures + 1))
      log "Provider stream failure $provider_failures/$MAX_PROVIDER_RETRIES; repository changed=$([ "$before_fingerprint" != "$after_fingerprint" ] && echo yes || echo no)."
      write_state "$iteration" "$provider_failures" "$no_progress"
      if [ "$RUN_ONCE" -eq 1 ]; then
        log "--once requested; not retrying the failed invocation."
        exit 4
      fi
      if [ "$provider_failures" -ge "$MAX_PROVIDER_RETRIES" ]; then
        log "Provider retry budget exhausted; preserving current state."
        exit 4
      fi
      delay=$(backoff_seconds "$provider_failures")
      log "Backing off for ${delay}s before a fresh recovery invocation."
      sleep "$delay"
      continue
    fi
    log "Non-provider Kit failure (status $status); not retrying blindly."
    write_state "$iteration" "$provider_failures" "$no_progress"
    exit "$status"
  fi

  provider_failures=0
  clean=0
  [ -z "$(git status --porcelain=v1 --untracked-files=all)" ] && clean=1
  durable=0
  if [ "$before_head" != "$after_head" ] && [ "$clean" -eq 1 ]; then
    commit_count=$(git rev-list --count "$before_head..$after_head")
    after_count=$(correction_count) || { log "Invalid correction count after invocation."; exit 7; }
    validate_action "$after_action" || { log "Invalid handoff action after invocation: $after_action"; exit 7; }
    if [ "$commit_count" -eq 1 ] && validate_transition "$action" "$count" "$after_action" "$after_count"; then
      durable=1
    else
      log "Invalid durable transition: $action/$count -> $after_action/$after_count with $commit_count commits."
      write_state "$iteration" "$provider_failures" "$no_progress"
      exit 7
    fi
  fi

  if [ "$durable" -eq 0 ]; then
    failure_fingerprint=$(printf '%s' "$action:$before_head:$before_fingerprint:$before_handoff" | shasum -a 256 | awk '{ print $1 }')
    if [ "$failure_fingerprint" = "$last_failure_fingerprint" ]; then no_progress=$((no_progress + 1)); else no_progress=1; last_failure_fingerprint=$failure_fingerprint; fi
    log "Invocation did not produce one clean, valid transition commit ($no_progress/2)."
    write_state "$iteration" "$provider_failures" "$no_progress"
    if [ "$RUN_ONCE" -eq 1 ] || [ "$no_progress" -ge 2 ]; then
      log "No-progress budget exhausted; preserving current state."
      exit 5
    fi
    continue
  fi

  no_progress=0
  last_failure_fingerprint=""
  log "Iteration $iteration committed valid transition $action -> $after_action."
  write_state "$iteration" "$provider_failures" "$no_progress"
  if [ "$after_action" = "blocked" ]; then exit 3; fi
  if [ "$after_action" = "complete" ]; then exit 0; fi
  if [ "$RUN_ONCE" -eq 1 ]; then log "--once requested; stopping after one invocation."; exit 0; fi
  sleep "$SUCCESS_PAUSE_SECONDS"
done

log "Maximum iteration count reached; preserving current state."
write_state "$iteration" "$provider_failures" "$no_progress"
exit 6
