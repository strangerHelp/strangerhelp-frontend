#!/usr/bin/env bash
# Full marketplace lifecycle test against production, using two real accounts.
set -u
B="https://strangerhelp.com"
S=$RANDOM
P_JAR=$(mktemp); H_JAR=$(mktemp)
POSTER="qaflow-poster-${S}@example.com"
HELPER="qaflow-helper-${S}@example.com"
PW="test-password-12345"
pass=0; fail=0

chk() { # label expected actual
  if [ "$2" = "$3" ]; then printf "  ok    %-46s %s\n" "$1" "$3"; pass=$((pass+1));
  else printf "  FAIL  %-46s got=%s want=%s\n" "$1" "$3" "$2"; fail=$((fail+1)); fi
}

post() { # jar path jsonfile -> status, body in /tmp/b
  curl -s -c "$1" -b "$1" -X POST "$B$2" -H 'Content-Type: application/json' -H "Origin: $B" \
    --data-binary "@$3" -o /tmp/b -w '%{http_code}'
}
patch() {
  curl -s -b "$1" -X PATCH "$B$2" -H 'Content-Type: application/json' -H "Origin: $B" \
    --data-binary "@$3" -o /tmp/b -w '%{http_code}'
}
get() { curl -s -b "$1" "$B$2" -o /tmp/b -w '%{http_code}'; }

# --- accounts ---
printf '{"name":"QA Poster","email":"%s","password":"%s","city":"Mumbai"}' "$POSTER" "$PW" > /tmp/p.json
printf '{"name":"QA Helper","email":"%s","password":"%s","city":"Mumbai"}' "$HELPER" "$PW" > /tmp/h.json
chk "register poster" 201 "$(post $P_JAR /api/auth/register /tmp/p.json)"
chk "register helper" 201 "$(post $H_JAR /api/auth/register /tmp/h.json)"

# --- task creation (multipart, as the UI does) ---
TASK=$(curl -s -b $P_JAR -X POST "$B/api/tasks" -H "Origin: $B" \
  -F 'title=QA lifecycle task' -F 'category=Errand' -F 'budget=250' \
  -F 'location=Bandra, Mumbai' -F 'deadline=Today' \
  | sed 's/.*"id":"\([^"]*\)".*/\1/')
[ -n "$TASK" ] && { printf "  ok    %-46s %s\n" "created task" "$TASK"; pass=$((pass+1)); } \
               || { printf "  FAIL  %-46s\n" "created task"; fail=$((fail+1)); }

chk "task is publicly readable" 200 "$(get /dev/null /api/tasks/$TASK)"

# --- authorization checks ---
printf '{"action":"claim"}' > /tmp/claim.json
chk "poster cannot claim own task" 400 "$(patch $P_JAR /api/tasks/$TASK /tmp/claim.json)"
chk "helper can request claim" 200 "$(patch $H_JAR /api/tasks/$TASK /tmp/claim.json)"
chk "duplicate claim request rejected" 409 "$(patch $H_JAR /api/tasks/$TASK /tmp/claim.json)"

printf '{"action":"edit","title":"Hijacked"}' > /tmp/edit.json
chk "helper cannot edit poster's task" 403 "$(patch $H_JAR /api/tasks/$TASK /tmp/edit.json)"
chk "poster can edit own open task" 200 "$(patch $P_JAR /api/tasks/$TASK /tmp/edit.json)"

# --- approve claim ---
HID=$(get $H_JAR /api/auth/me >/dev/null; sed 's/.*"id":"\([^"]*\)".*/\1/' /tmp/b)
printf '{"action":"approve_claim","requesterId":"%s"}' "$HID" > /tmp/appr.json
chk "helper cannot approve own claim" 403 "$(patch $H_JAR /api/tasks/$TASK /tmp/appr.json)"
chk "poster approves claim" 200 "$(patch $P_JAR /api/tasks/$TASK /tmp/appr.json)"

# --- completion flow (the hardened path) ---
printf '{"action":"complete"}' > /tmp/comp.json
chk "complete refused without proof" 400 "$(patch $H_JAR /api/tasks/$TASK /tmp/comp.json)"
chk "poster cannot self-complete as helper" 403 "$(patch $P_JAR /api/tasks/$TASK /tmp/comp.json)"

# submit proof via multipart, then complete
echo "proof" > /tmp/proof.txt
curl -s -b $H_JAR -X PATCH "$B/api/tasks/$TASK" -H "Origin: $B" \
  -F 'action=complete' -F 'proof=@/tmp/proof.txt;type=image/png' -o /dev/null
chk "helper completes after proof" 200 "$(patch $H_JAR /api/tasks/$TASK /tmp/comp.json)"

printf '{"action":"accept_completion"}' > /tmp/acc.json
chk "helper cannot accept completion" 403 "$(patch $H_JAR /api/tasks/$TASK /tmp/acc.json)"
chk "poster accepts completion" 200 "$(patch $P_JAR /api/tasks/$TASK /tmp/acc.json)"

# --- reviews ---
printf '{"taskId":"%s","revieweeId":"%s","rating":5,"comment":"great"}' "$TASK" "$HID" > /tmp/rev.json
chk "poster reviews helper" 201 "$(post $P_JAR /api/reviews /tmp/rev.json)"
chk "duplicate review rejected" 409 "$(post $P_JAR /api/reviews /tmp/rev.json)"
printf '{"taskId":"%s","revieweeId":"%s","rating":9}' "$TASK" "$HID" > /tmp/badrev.json
chk "invalid rating rejected" 400 "$(post $P_JAR /api/reviews /tmp/badrev.json)"

# --- questions + vote dedup ---
printf '{"text":"QA: is this open?","category":"General","location":"Mumbai"}' > /tmp/q.json
QID=$(post $P_JAR /api/questions /tmp/q.json >/dev/null; sed 's/.*"id":"\([^"]*\)".*/\1/' /tmp/b)
printf '{"action":"vote","vote":"up"}' > /tmp/v.json
for i in 1 2 3 4 5; do post $H_JAR /api/questions/$QID /tmp/v.json > /dev/null; done
VOTES=$(get /dev/null /api/questions/$QID >/dev/null; sed 's/.*"votes":\([0-9-]*\).*/\1/' /tmp/b)
chk "5 votes from one user counts once" 1 "$VOTES"
printf '{"action":"vote","vote":"sideways"}' > /tmp/vbad.json
chk "invalid vote direction rejected" 400 "$(post $H_JAR /api/questions/$QID /tmp/vbad.json)"
printf '{"action":"answer","text":""}' > /tmp/abad.json
chk "empty answer rejected" 400 "$(post $H_JAR /api/questions/$QID /tmp/abad.json)"

# --- messaging isolation ---
chk "helper cannot read foreign conversation" 404 "$(get $H_JAR /api/messages/nonexistent-conv)"
chk "notifications require auth" 401 "$(get /dev/null /api/notifications)"
chk "helper sees own notifications" 200 "$(get $H_JAR /api/notifications)"

# --- admin lockout ---
chk "non-admin blocked from admin api" 403 "$(get $P_JAR '/api/admin?resource=stats')"
chk "non-admin blocked from admin support" 403 "$(get $P_JAR /api/admin/support)"
printf '{"key":"guess"}' > /tmp/setup.json
chk "admin setup rejects wrong key" 403 "$(post $P_JAR /api/admin/setup /tmp/setup.json)"

# --- report validation ---
python3 -c "import json;print(json.dumps({'type':'user','reason':'spam','description':'x'*6000}))" > /tmp/rbig.json
chk "oversized report rejected" 400 "$(post $P_JAR /api/reports /tmp/rbig.json)"
printf '{"type":"verification","reason":"forged"}' > /tmp/rver.json
chk "forged verification report rejected" 400 "$(post $P_JAR /api/reports /tmp/rver.json)"

echo
echo "  passed=$pass failed=$fail"
echo "CLEANUP_TAG=qaflow-%s" "$S"
echo "QA_TASK=$TASK"
rm -f $P_JAR $H_JAR /tmp/p.json /tmp/h.json /tmp/claim.json /tmp/edit.json /tmp/appr.json \
      /tmp/comp.json /tmp/acc.json /tmp/rev.json /tmp/badrev.json /tmp/q.json /tmp/v.json \
      /tmp/vbad.json /tmp/abad.json /tmp/setup.json /tmp/rbig.json /tmp/rver.json /tmp/proof.txt /tmp/b
