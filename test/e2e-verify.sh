#!/usr/bin/env bash
# End-to-end verification of the auth fixes against production.
set -u
B="https://strangerhelp.com"
JAR=$(mktemp)
STAMP=$RANDOM$RANDOM
EMAIL="qa-audit-${STAMP}@example.com"
EMAIL_UPPER=$(printf '%s' "$EMAIL" | tr 'a-z' 'A-Z')
PW="test-password-12345"

req() { # method path datafile jarmode
  local method="$1" path="$2" data="${3:-}" extra="${4:-}"
  if [ -n "$data" ]; then
    curl -s $extra -X "$method" "$B$path" \
      -H 'Content-Type: application/json' -H "Origin: $B" \
      --data-binary "@$data" -o /tmp/qa_body -w '%{http_code}'
  else
    curl -s $extra -X "$method" "$B$path" -H "Origin: $B" -o /tmp/qa_body -w '%{http_code}'
  fi
}

printf '{"name":"QA Audit","email":"%s","password":"%s","city":"Mumbai","address":"1 Main St","country":"India"}\n' \
  "$EMAIL_UPPER" "$PW" > /tmp/qa_reg.json
printf '{"email":"%s","password":"%s"}\n' "$EMAIL" "$PW" > /tmp/qa_login.json
printf '{"email":"%s","password":"wrong-password"}\n' "$EMAIL" > /tmp/qa_bad.json

echo "1. register with UPPERCASE email      -> $(req POST /api/auth/register /tmp/qa_reg.json "-c $JAR")  (expect 201)"
echo "   stored email/country/bio:"
curl -s -b "$JAR" "$B/api/auth/me" | sed 's/.*"email":"\([^"]*\)".*"country":"\([^"]*\)","phone":"[^"]*","bio":"\([^"]*\)".*/     email=\1 country=\2 bio="\3"/'
echo "2. /api/auth/me while logged in       -> $(req GET /api/auth/me '' "-b $JAR")  (expect 200)"
echo "3. logout                             -> $(req POST /api/auth/logout '' "-b $JAR -c $JAR")  (expect 302)"
echo "4. /api/auth/me AFTER logout          -> $(req GET /api/auth/me '' "-b $JAR")  (expect 401)"
echo "5. login with lowercase email         -> $(req POST /api/auth/login /tmp/qa_login.json "-c $JAR")  (expect 200)"
echo "6. login with wrong password          -> $(req POST /api/auth/login /tmp/qa_bad.json)  (expect 401)"
echo "7. malformed JSON to register         -> $(printf 'not json' > /tmp/qa_junk.json; req POST /api/auth/register /tmp/qa_junk.json)  (expect 400)"

echo "QA_EMAIL=$EMAIL"
cp "$JAR" /tmp/qa_jar_final
rm -f "$JAR" /tmp/qa_reg.json /tmp/qa_login.json /tmp/qa_bad.json /tmp/qa_junk.json /tmp/qa_body
