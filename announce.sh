#!/usr/bin/env bash
# Post an announcement to everyone using the site.
#
#   ./announce.sh "New 5x5x5 example is up!"       # new visitors see it for the next 30 min
#   ./announce.sh "Maintenance at 6pm" 120          # ...for the next 120 min
#   ./announce.sh --on-open "Hi!"                   # only shown when someone opens the site,
#                                                   # not pushed live to tabs already open
#   ./announce.sh --sound wilhelm "AAAAH!"          # also play sounds/wilhelm.mp3
#   ./announce.sh --image scare "boo"               # pop images/scare.jpg up full screen (1.5s)
#   ./announce.sh --then-image scare "Everyone reload the page!"
#                                                   # follow-up shown after people who saw
#                                                   # this reload (also --then "msg", --then-sound)
#   ./announce.sh --clear                           # remove the current announcement
#
# Each visitor sees an announcement once, for 10 seconds. People with the site
# open pick it up within ~10s of the deploy finishing (about a minute total),
# unless it was posted with --on-open. Options can be combined.
set -euo pipefail
cd "$(dirname "$0")"

usage() { sed -n '2,17p' "$0" | sed 's/^# \{0,1\}//'; exit 1; }
die() { echo "$1" >&2; exit 1; }

# find_asset <folder> <name> <ext...>: print folder/name.ext for the first that exists.
find_asset() {
  local dir="$1" name="$2"; shift 2
  [[ "$name" =~ ^[a-zA-Z0-9_-]+$ ]] || die "Usage: --${dir%s} <name>  (a file in $dir/)"
  for ext in "$@"; do
    if [[ -f "$dir/$name.$ext" ]]; then echo "$dir/$name.$ext"; return; fi
  done
  die "No ${dir%s} called '$name' in $dir/. Available: $(ls "$dir" 2>/dev/null | sed 's/\.[^.]*$//' | tr '\n' ' ')"
}

if [[ "${1:-}" == "--clear" ]]; then
  jq -n '{id: "", message: "", postedAt: null, showUntil: null}' > announcement.json
  commit_msg="Clear announcement"
else
  on_open=false
  sound=""
  image=""
  then_msg=""
  then_sound=""
  then_image=""
  while [[ "${1:-}" == --* ]]; do
    case "$1" in
      --on-open) on_open=true; shift ;;
      --sound) sound=$(find_asset sounds "${2:-}" mp3 ogg wav); shift 2 ;;
      --image) image=$(find_asset images "${2:-}" jpg jpeg png gif webp); shift 2 ;;
      --then) then_msg="${2:-}"; [[ -n "${then_msg// }" ]] || die "--then needs a message"; shift 2 ;;
      --then-sound) then_sound=$(find_asset sounds "${2:-}" mp3 ogg wav); shift 2 ;;
      --then-image) then_image=$(find_asset images "${2:-}" jpg jpeg png gif webp); shift 2 ;;
      *) usage ;;
    esac
  done

  message="${1:-}"
  minutes="${2:-30}"
  [[ -n "${message// }" ]] || usage
  [[ "$minutes" =~ ^[0-9]+$ && "$minutes" -gt 0 ]] || die "Minutes must be a positive whole number."
  (( ${#message} <= 280 )) || die "Message is ${#message} characters; keep it to 280."

  now=$(date -u +%s)
  iso() { date -u -r "$1" +%Y-%m-%dT%H:%M:%SZ; }
  jq -n \
    --arg id "$now" \
    --arg message "$message" \
    --arg postedAt "$(iso "$now")" \
    --arg showUntil "$(iso $((now + minutes * 60)))" \
    --argjson onOpenOnly "$on_open" \
    --arg sound "$sound" \
    --arg image "$image" \
    --arg thenMsg "$then_msg" \
    --arg thenSound "$then_sound" \
    --arg thenImage "$then_image" \
    '{id: $id, message: $message, postedAt: $postedAt, showUntil: $showUntil, onOpenOnly: $onOpenOnly}
     + (if $sound == "" then {} else {sound: $sound} end)
     + (if $image == "" then {} else {image: $image} end)
     + (if $thenMsg == "" and $thenSound == "" and $thenImage == "" then {} else
         {followUp: ({id: ($id + "-then"), message: (if $thenMsg == "" then "👀" else $thenMsg end)}
           + (if $thenSound == "" then {} else {sound: $thenSound} end)
           + (if $thenImage == "" then {} else {image: $thenImage} end))}
       end)' > announcement.json
  commit_msg="Announcement: $message"
fi

git add announcement.json
git commit -q -m "$commit_msg"
git push -q
echo "Pushed. It'll be live in about a minute."
