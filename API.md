# StrangerHelp API Documentation

Base URL: `https://strangerhelp.com`

## Authentication

All authenticated requests use cookie-based sessions. The `session` cookie is set automatically on login/register.

**Required headers for all POST/PATCH/DELETE:**
```
Origin: https://strangerhelp.com
Content-Type: application/json
```

---

## Auth Endpoints

### POST /api/auth/register
Create a new account.

**Body:**
```json
{"name": "John", "email": "john@example.com", "password": "min8chars", "city": "Mumbai"}
```

**Validations:** name (max 100), email (valid format), password (min 8), city (required)

**Responses:**
- `201` → `{"id": "abc123", "name": "John"}` + sets session cookie
- `400` → `{"error": "All fields required"}` | `{"error": "Invalid email format"}` | `{"error": "Password must be at least 8 characters"}`
- `409` → `{"error": "Email already registered"}`
- `429` → `{"error": "Too many attempts. Try again later."}`

---

### POST /api/auth/login

**Body:**
```json
{"email": "john@example.com", "password": "mypassword"}
```

**Responses:**
- `200` → `{"id": "abc123", "name": "John"}` + sets session cookie
- `401` → `{"error": "Invalid credentials"}`
- `429` → `{"error": "Too many attempts. Try again later."}`

---

### GET /api/auth/me
Get current logged-in user.

**Responses:**
- `200` → `{"user": {"id", "name", "email", "handle", "avatar", "city", "area", "country", "phone", "bio", "is_admin", "verified", "email_verified"}}`
- `401` → `{"user": null}`

---

### POST /api/auth/logout
Clears session cookie. Redirects to `/`.

---

### POST /api/auth/profile
Update profile. **Multipart form-data.**

| Field | Type | Notes |
|-------|------|-------|
| name | string | |
| handle | string | Unique, lowercase, letters/numbers/underscore, min 3 chars |
| bio | string | |
| city | string | |
| area | string | |
| country | string | |
| phone | string | |
| avatar | File | Image, will be compressed |

**Responses:**
- `200` → `{"ok": true}`
- `409` → `{"error": "This handle is already taken"}`

---

### POST /api/auth/forgot
Request password reset link.

**Body:** `{"email": "john@example.com"}`

**Response (always 200):** `{"ok": true, "message": "If this email is registered, you will receive a reset link."}`

---

### POST /api/auth/reset
Set new password with reset token.

**Body:** `{"token": "abc123...", "password": "newpassword"}`

**Responses:**
- `200` → `{"ok": true, "message": "Password reset successfully."}`
- `400` → `{"error": "Invalid or expired reset link."}`
- `429` → Rate limited

---

### GET /api/auth/google
Initiates Google OAuth flow. Redirects to Google consent screen. After success, redirects to `/dashboard` with session cookie set.

---

### POST /api/auth/verify-email
Resend verification email to logged-in user.

**Response:** `{"ok": true, "message": "Verification email sent"}`

### GET /api/auth/verify-email?token=xxx
Verify email from link. Redirects to `/verify-email?success=true` or `?error=invalid`.

---

## Tasks

### GET /api/tasks
List tasks.

| Param | Type | Description |
|-------|------|-------------|
| category | string | Filter by category |
| mine | "true" | Show user's posted + claimed tasks |
| lat | number | User latitude (for distance sorting) |
| lng | number | User longitude |
| limit | number | Max results (default 20) |

**Response:** Array of task objects:
```json
[{
  "_id": "string",
  "title": "string",
  "description": "string",
  "category": "string",
  "budget": 350,
  "deadline": "Today",
  "location": "Koramangala, Bangalore",
  "city": "Bangalore",
  "lat": 12.9352,
  "lng": 77.6245,
  "anonymous": 0,
  "urgent": 1,
  "status": "open",
  "posterId": "string",
  "posterName": "John",
  "posterVerified": true,
  "claimedBy": null,
  "claimedByName": null,
  "maxClaimers": 1,
  "distance": 2.3,
  "attachments": ["data:image/jpeg;base64,..."],
  "completionProof": [],
  "createdAt": "2026-06-20T10:30:00.000Z"
}]
```

**Categories:** Simple Survey, Task, Document Submission, Photo Proof, Parcel Pickup, Queue Standing, Verification, Receipt Collection, Event / Group Work, Other

---

### GET /api/tasks/{id}
Single task detail. Additional fields:
- `claimerVerified`: boolean
- `claimedUsers`: array (for group tasks) `[{"user_id", "user_name", "claimed_at"}]`

---

### POST /api/tasks
Create task. **Multipart form-data.**

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| title | string | ✅ | Max 200 chars |
| description | string | | Max 5000 chars |
| category | string | ✅ | |
| budget | number | ✅ | 1 - 500000 |
| deadline | string | | "Within 1 hour", "Today", "Tomorrow", or custom date |
| location | string | ✅ | |
| lat | number | | GPS latitude |
| lng | number | | GPS longitude |
| anonymous | "true"/"false" | | Default false |
| urgent | "true"/"false" | | Default false |
| max_claimers | number | | For group tasks (2-50) |
| files[] | File[] | | Images or audio attachments |

**Response:** `201` → `{"id": "abc123"}`

---

### PATCH /api/tasks/{id}
Perform action on task.

**Claim task:**
```json
{"action": "claim"}
```
- `200` → `{"ok": true, "status": "claimed"}`
- For group tasks: `{"ok": true, "claimedCount": 3, "maxClaimers": 10}`
- Errors: `"Task not available"`, `"Cannot claim your own task"`, `"All slots are filled"`

**Complete task (multipart):**
Form fields: `action=complete`, `proof=File[]`
- `200` → `{"ok": true, "proofs": ["data:image/..."]}`

---

### DELETE /api/tasks/{id}
Delete task. Only poster or admin.
- `200` → `{"ok": true}`
- `403` → `{"error": "Forbidden"}`

---

## Messages

### GET /api/messages
List conversations for logged-in user.

```json
[{
  "_id": "string",
  "taskId": "string|null",
  "participants": ["userId1", "userId2"],
  "participantNames": ["John", "Jane"],
  "lastMessage": "Thanks!",
  "lastMessageAt": "2026-06-20T10:30:00.000Z"
}]
```

---

### POST /api/messages
Create or get existing conversation.

**Body:** `{"recipientId": "userId", "taskId": "optionalTaskId"}`

**Response:** Conversation object with `_id`.

---

### GET /api/messages/{conversationId}
Get messages in a conversation (only participants can access).

```json
[{
  "_id": "string",
  "conversationId": "string",
  "senderId": "string",
  "senderName": "John",
  "text": "Hello!",
  "attachments": [],
  "type": "text",
  "createdAt": "2026-06-20T10:30:00.000Z"
}]
```

---

### POST /api/messages/{conversationId}
Send message.

**JSON body:** `{"text": "Hello!"}` (max 5000 chars)

**Or multipart:** `text` + `files[]` for image messages.

**Response:** Created message object. Rate limited.

---

## Notifications

### GET /api/notifications
**Query:** `unread=true` (optional)

```json
{
  "notifications": [{"id", "user_id", "type", "title", "message", "link", "read", "created_at"}],
  "unreadCount": 3
}
```

Types: `task_claimed`, `task_completed`, `new_message`, `review`

### PATCH /api/notifications
Mark as read.
- `{"all": true}` — mark all read
- `{"id": "notifId"}` — mark single read

---

## Users (Public Profile)

### GET /api/users/{handleOrId}

```json
{
  "id": "string",
  "name": "John",
  "handle": "john_doe",
  "avatar": "",
  "city": "Mumbai",
  "bio": "Helper since 2026",
  "verified": true,
  "rating": 4.5,
  "totalReviews": 12,
  "tasksPosted": 5,
  "tasksClaimed": 20,
  "tasksCompleted": 18,
  "completionRate": 72,
  "trustScore": 0,
  "memberSince": "2026-06-10T00:00:00.000Z"
}
```

---

## Reviews

### GET /api/reviews
**Query:** `userId=xxx` or `taskId=xxx`

```json
{
  "reviews": [{"id", "task_id", "reviewer_id", "reviewer_name", "reviewee_id", "rating", "comment", "created_at"}],
  "avgRating": 4.5,
  "totalReviews": 12
}
```

### POST /api/reviews
```json
{"taskId": "xxx", "revieweeId": "xxx", "rating": 5, "comment": "Great helper!"}
```
- Only task participants can review
- Can only review the other participant
- Rating 1-5
- `409` if already reviewed

---

## Meets (Strangers Meet)

### GET /api/meets
List public meets + user's private meets.

**Query:** `code=inviteCode` — access private meet by invite code.

```json
[{
  "id": "string",
  "title": "Beach Cleanup",
  "description": "...",
  "category": "Cleanup",
  "location": "Marina Beach",
  "date": "2026-07-01",
  "time": "06:00",
  "visibility": "public",
  "invite_code": "a1b2c3d4",
  "max_attendees": 50,
  "host_id": "string",
  "host_name": "John",
  "voice_note": "data:audio/webm;base64,...",
  "attendeeCount": 12
}]
```

### POST /api/meets
Create meet. **Multipart form-data.**

| Field | Type | Required |
|-------|------|----------|
| title | string | ✅ |
| description | string | |
| category | string | ✅ |
| location | string | |
| date | string | |
| time | string | |
| visibility | "public"/"private" | Default "public" |
| max_attendees | number | Default 50 |
| voice_note | File | Audio file (optional) |

**Response:** `201` → `{"id": "xxx", "inviteCode": "a1b2c3d4"}`

---

### GET /api/meets/{id}
Get meet detail (also works with invite_code).

Additional fields: `attendees: [{"user_id", "user_name", "joined_at"}]`

Private meets return `403` unless you're host, attendee, or using invite_code in URL.

---

### POST /api/meets/{id}
Join or leave.

```json
{"action": "join"}
{"action": "leave"}
```
- `409` → "Already joined"
- `400` → "Meet is full" | "Host cannot leave"

---

### DELETE /api/meets/{id}
Delete meet. Host or admin only.

---

## Pulse (Live Map)

### GET /api/pulse
```json
{
  "tasks": [{"_id", "title", "category", "budget", "location", "lat", "lng", "createdAt"}],
  "helpers": [{"user_id", "name", "avatar", "lat", "lng", "city"}]
}
```

### POST /api/pulse
Go online. Body: `{"lat": 12.93, "lng": 77.62}`

### DELETE /api/pulse
Go offline.

---

## Questions (Ask)

### GET /api/questions
**Query:** `category=string`

### POST /api/questions
Body: `{"text": "...", "category": "...", "location": "...", "anonymous": true}`

### GET /api/questions/{id}
Returns question + answers array.

### POST /api/questions/{id}
- Answer: `{"action": "answer", "text": "..."}`
- Vote: `{"action": "vote", "vote": "up"|"down"}`

### DELETE /api/questions/{id}
Poster or admin only.

---

## Reports

### POST /api/reports
```json
{"type": "task|user|question|account_deletion", "targetId": "optional", "reason": "Spam", "description": "optional details"}
```

---

## Push Notifications

### GET /api/push
Returns VAPID public key: `{"publicKey": "BPCk..."}`

### POST /api/push
Save subscription: `{"endpoint": "https://fcm...", "keys": {"p256dh": "...", "auth": "..."}}`

### DELETE /api/push
Remove subscription: `{"endpoint": "https://fcm..."}`

---

## Error Responses

All errors follow: `{"error": "Human readable message"}`

| Code | Meaning |
|------|---------|
| 400 | Bad request / validation error |
| 401 | Not authenticated |
| 403 | Forbidden (authenticated but not authorized) |
| 404 | Not found |
| 409 | Conflict (duplicate) |
| 429 | Rate limited |
| 500 | Server error |

---

## Rate Limits

| Endpoint | Limit |
|----------|-------|
| POST /api/auth/login | 10 per 15 min per IP |
| POST /api/auth/register | 10 per 15 min per IP |
| POST /api/auth/forgot | 10 per 15 min per IP |
| POST /api/auth/reset | 10 per 15 min per IP |
| POST /api/messages/{id} | 10 per 15 min per IP |
