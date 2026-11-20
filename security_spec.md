# Firestore Security Specification — KAKAROT GLORY PRO

## 1. Data Invariants
1. **No Self-Assigned Roles**: A standard user cannot create or update `/users/{userId}` with `role: 'admin'`, nor write to `/admins/{userId}`.
2. **No Client-Side Credit Tampering**: A standard user cannot directly increment `basicCredits`, `premiumCredits`, or `maxGroups`, or clear `blocked` on `/users/{userId}`.
3. **PII Isolation**: User email addresses reside exclusively in `/users/{userId}/private/{docId}`, readable and writable only by the owner (`request.auth.uid == userId`) or a verified admin.
4. **Strict Ownership & Query Enforcement**: Any `list` query on `/groups`, `/transactions`, `/activity_logs`, or `/coupons` for non-admins MUST enforce `resource.data.userId == request.auth.uid` (or `createdByUid`/`redeemedByUid`).
5. **Immutable Audit Fields**: `createdAt`, `uid`, and `userId` cannot be altered after creation.
6. **Verified Admin Only**: Admin privileges require either an entry in `/admins/{request.auth.uid}` OR the bootstrapped Super Admin email (`kaakru2@gmail.com`) with `email_verified == true`.
7. **Admin-Only API Logs**: `/api_logs/{logId}` is strictly unreadable and unwritable by non-admin users.
8. **Global Settings Protection**: `/settings/{settingId}` (`site`) is publicly readable for branding/maintenance check, and writable ONLY by verified admins.

## 2. The "Dirty Dozen" Attack Payloads
1. **Self-Promote to Admin on Create**: `POST /users/attacker1` `{ "uid": "attacker1", "username": "attacker", "role": "admin", "basicCredits": 0, ... }` -> **PERMISSION_DENIED**.
2. **Self-Grant Credits on Update**: `PATCH /users/user1` `{ "basicCredits": 99999 }` -> **PERMISSION_DENIED**.
3. **Ghost Field Injection (Shadow Update)**: `PATCH /users/user1` `{ "language": "en", "isAdmin": true }` -> **PERMISSION_DENIED**.
4. **Read Another User's PII**: `GET /users/victim/private/profile` as `attacker` -> **PERMISSION_DENIED**.
5. **Unfiltered List Scrape on Transactions**: `LIST /transactions` without `where('userId', '==', uid)` -> **PERMISSION_DENIED**.
6. **Spoofed Admin Email without Verification**: `request.auth.token = { email: "kaakru2@gmail.com", email_verified: false }` writing `/settings/site` -> **PERMISSION_DENIED**.
7. **Client Timestamp Forgery**: `POST /users/user1` with `createdAt: "2020-01-01T00:00:00Z"` instead of `request.time` -> **PERMISSION_DENIED**.
8. **ID Poisoning (Oversized / Invalid Doc ID)**: `SET /groups/../../evil` or 500-char ID -> **PERMISSION_DENIED**.
9. **Terminal Transaction Re-Open**: Standard user changing `status: "approved"` back to `"pending"` -> **PERMISSION_DENIED**.
10. **Unauthorized Coupon Generation by Non-Owner**: `SET /coupons/FREE-9999-9999` with `createdByUid: "someone_else"` -> **PERMISSION_DENIED**.
11. **Non-Admin Writing API Logs**: `POST /api_logs/log1` as regular user -> **PERMISSION_DENIED**.
12. **Non-Admin Modifying Site Settings**: `PATCH /settings/site` `{ "maintenanceMode": true }` as regular user -> **PERMISSION_DENIED**.
