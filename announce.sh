#!/usr/bin/env bash
# Post an announcement to everyone using the site.
#
#   ./announce.sh "New 5x5x5 example is up!"       # new visitors see it for the next 30 min
#   ./announce.sh "Maintenance at 6pm" 120          # ...for the next 120 min
#   ./announce.sh --on-open "Hi!"                   # only shown when someone opens the site,
#                                                   # not pushed live to tabs already open
#   ./announce.sh --clear                           # remove the current announcement
#
# Each visitor sees an announcement once, for 10 seconds. People with the site
# open pick it up within ~10s of the deploy finishing (about a minute total),
# unless it was posted with --on-open.
set -euo pipefail
cd "$(dirname "$0")"

usage() { sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'; exit 1; }

if [[ "${1:-}" == "--clear" ]]; then
  jq -n '{id: "", message: "", postedAt: null, showUntil: null}' > announcement.json
  commit_msg="Clear announcement"
else
  on_open=false
  if [[ "${1:-}" == "--on-open" ]]; then on_open=true; shift; fi
  message="${1:-}"
  minutes="${2:-30}"
  [[ -n "${message// }" ]] || usage
  [[ "$minutes" =~ ^[0-9]+$ && "$minutes" -gt 0 ]] || { echo "Minutes must be a positive whole number." >&2; exit 1; }
  if (( ${#message} > 280 )); then echo "Message is ${#message} characters; keep it to 280." >&2; exit 1; fi

  now=$(date -u +%s)
  iso() { date -u -r "$1" +%Y-%m-%dT%H:%M:%SZ; }
  jq -n \
    --arg id "$now" \
    --arg message "$message" \
    --arg postedAt "$(iso "$now")" \
    --arg showUntil "$(iso $((now + minutes * 60)))" \
    --argjson onOpenOnly "$on_open" \
    '{id: $id, message: $message, postedAt: $postedAt, showUntil: $showUntil, onOpenOnly: $onOpenOnly}' > announcement.json
  commit_msg="Announcement: $message"
fi

git add announcement.json
git commit -q -m "$commit_msg"
git push -q
echo "Pushed. It'll be live in about a minute."
