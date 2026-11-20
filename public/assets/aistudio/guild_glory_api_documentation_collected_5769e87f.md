# Guild Glory API Documentation --- Collected Notes

**Source:** Documentation screenshots/text shared in this conversation,
Parts 1--13.\
**Purpose:** Reference notes for later integration into a separate
website built with Google AI Studio.\
**Important:** This document preserves the endpoints, field names,
examples, and limitations as supplied. Example values are illustrative,
not live account data.

## Security notice

The account-specific API key and the shared master key were pasted into
the conversation in the supplied examples. They are intentionally **not
reproduced in this file**. Treat the exposed account key as compromised
and refresh/regenerate it before integration. Store replacement
credentials only as backend environment secrets; never put them in
browser/frontend code or public repositories.

------------------------------------------------------------------------

## Part 1 --- Setup & Authentication

The documentation states:

-   Your API key is unique to your account.
-   Anyone with your account key can use your credits.
-   There is a **Refresh API Key** action.
-   If you are not logged in, log in first.

### Authentication notes

Part 2 explains that all endpoints require both: 1. Your
account-specific `api_key`. 2. The shared `MASTER_KEY`, sent in the
`x-api-key` header.

The account-specific key is sent as an `api_key` query parameter, while
the shared key is sent in the `x-api-key` header, except where an
endpoint explicitly documents a different requirement (see Signup and
Pricing).

## Part 2 --- Python Setup

The supplied setup says to install `requests`:

``` bash
pip install requests
```

Imports:

``` python
import requests, time
```

Base URL:

``` text
https://ffglory.pro
```

The documentation's helper function is described as:

``` python
def api(method, path, json=None):
    r = requests.request(
        method,
        f"{BASE}{path}",
        params={"api_key": KEY},
        headers=HDR,
        json=json
    )
    r.raise_for_status()
    return r.json()
```

Notes supplied with the example:

-   `MASTER_KEY` (`x-api-key` header) is the same for everyone.
-   `api_key` is unique to your account.
-   All endpoints require both keys.
-   All POST bodies are JSON.
-   All responses are JSON.

**Credential handling:** The literal keys from the examples have been
omitted for security. Do not paste real keys into frontend code.

------------------------------------------------------------------------

## Part 3 --- Account

### `GET /api/auth/me`

Gets account information, including credit balance.

Supplied example call:

``` python
resp = api("GET", "/api/auth/me")
print(
    f"User: {resp['username']}  "
    f"Basic: {resp['basic_credits']}  "
    f"Premium: {resp['premium_credits']}"
)
```

Example response:

``` json
{
  "username": "john",
  "role": "user",
  "basic_credits": 12,
  "premium_credits": 3,
  "max_groups": 10
}
```

Response fields:

-   `username`
-   `role`
-   `basic_credits`
-   `premium_credits`
-   `max_groups`

The values above are documentation examples, not the user's actual
account details.

------------------------------------------------------------------------

## Part 4 --- Signup

### `POST /api/auth/signup`

Registers a new user account.

Fields:

  -----------------------------------------------------------------------
  Field                   Type                    Description
  ----------------------- ----------------------- -----------------------
  `username`              string                  3--20 characters;
                                                  lowercase alphanumeric
                                                  characters and
                                                  underscore

  `password`              string                  Minimum 6 characters
  -----------------------------------------------------------------------

Supplied example:

``` python
resp = requests.post(
    f"{BASE}/api/auth/signup",
    headers=HDR,
    json={
        "username": "customer1",
        "password": "securepass123"
    }
)
print(resp.json())
```

Documentation notes:

-   CAPTCHA is skipped when the `x-api-key` header is provided.
-   Returns HTTP `409` if the username is already taken.
-   No `api_key` parameter is needed for this endpoint; only the
    `x-api-key` header.

------------------------------------------------------------------------

## Part 5 --- Pricing and Regions

### `GET /api/pricing`

Lists available regions and pricing.

The documentation labels this a **public endpoint**; no API key is
needed.

Supplied example:

``` python
resp = requests.get(f"{BASE}/api/pricing").json()
print(
    f"Basic: ${resp['basic_credit_usd']}/credit  "
    f"Premium: ${resp['premium_credit_usd']}/credit"
)
for r in resp["regions"]:
    print(
        f"  {r['id']:6s}  {r['region_name']:15s}  "
        f"tier={r['tier']}  enabled={r['enabled']}"
    )
```

Example response:

``` json
{
  "basic_credit_usd": 1.5,
  "premium_credit_usd": 3.0,
  "regions": [
    {
      "id": "me",
      "region_name": "Middle East",
      "region_code": "ME",
      "tier": "premium",
      "enabled": true
    },
    {
      "id": "bd",
      "region_name": "Bangladesh",
      "region_code": "BD",
      "tier": "basic",
      "enabled": true
    }
  ]
}
```

Response fields:

-   `basic_credit_usd`
-   `premium_credit_usd`
-   `regions[]`
    -   `id`
    -   `region_name`
    -   `region_code`
    -   `tier`
    -   `enabled`

The prices and regions shown are examples from the supplied
documentation; they are not asserted to be the complete or current list.

------------------------------------------------------------------------

## Part 6 --- Launch a Glory Group

### `POST /api/client/auto-clan-group`

Launches a new glory group for a clan.

Fields:

  -----------------------------------------------------------------------
  Field                   Type                    Description
  ----------------------- ----------------------- -----------------------
  `region`                string                  Region ID from
                                                  `/api/pricing`,
                                                  e.g. `"me"` or `"bd"`

  `clan_id`               string                  Clan ID to farm glory
                                                  for
  -----------------------------------------------------------------------

Supplied example:

``` python
resp = api("POST", "/api/client/auto-clan-group", json={
    "region": "me",
    "clan_id": "123456789"
})
print(f"Group launched: {resp['group_id']}")
```

Success response example:

``` json
{
  "success": true,
  "group_id": "abc123",
  "bot_count": 4
}
```

The source example includes an ellipsis after `bot_count`; the complete
response schema was not supplied.

Credit behavior described:

-   Deducts 1 credit.
-   Credit is Basic or Premium depending on the region.

Error codes:

  -----------------------------------------------------------------------
  HTTP status                         Meaning
  ----------------------------------- -----------------------------------
  `402`                               Insufficient credits; response
                                      includes current balance and prices

  `403`                               Maximum groups limit reached or
                                      maximum groups per clan reached

  `409`                               Another operation is in progress
                                      for this account or clan
  -----------------------------------------------------------------------

------------------------------------------------------------------------

## Part 7 --- List My Groups

### `GET /api/client/my-groups`

Lists all groups with status.

Supplied example:

``` python
groups = api("GET", "/api/client/my-groups")
for g in groups:
    print(
        f"  {g['group_id'][:8]}  clan={g['clan_id']}  "
        f"status={g['status']}  region={g['region']}  uptime={g['uptime']}"
    )
```

Example response:

``` json
[
  {
    "group_id": "abc123",
    "clan_id": "123456789",
    "region": "ME",
    "status": "running",
    "container_count": 4,
    "running_count": 4,
    "created_at": "2026-03-28T10:00:00Z",
    "uptime": "2h30m"
  }
]
```

Fields shown:

-   `group_id`
-   `clan_id`
-   `region`
-   `status`
-   `container_count`
-   `running_count`
-   `created_at`
-   `uptime`

------------------------------------------------------------------------

## Part 8 --- Group Actions

### `POST /api/client/group-action`

The documentation describes actions on a group you own.

Fields:

  -----------------------------------------------------------------------
  Field                   Type                    Description
  ----------------------- ----------------------- -----------------------
  `action`                string                  `"restart"`, `"stop"`,
                                                  or `"delete"` in this
                                                  section

  `group_id`              string                  Group ID
  -----------------------------------------------------------------------

Supplied examples:

``` python
# Stop a group
resp = api("POST", "/api/client/group-action", json={
    "action": "stop",
    "group_id": "abc123"
})

# Restart a group
resp = api("POST", "/api/client/group-action", json={
    "action": "restart",
    "group_id": "abc123"
})

# Delete a group (permanent)
resp = api("POST", "/api/client/group-action", json={
    "action": "delete",
    "group_id": "abc123"
})
```

The supplied excerpt does not include response schemas or
action-specific error codes.

**Important:** The documentation explicitly labels `delete` as
permanent.

------------------------------------------------------------------------

## Part 9 --- Additional Group Actions

The same endpoint, `POST /api/client/group-action`, also supports these
documented actions:

### `action: "get-glory"`

Gets current glory points for a running group.

``` python
resp = api("POST", "/api/client/group-action", json={
    "action": "get-glory",
    "group_id": "abc123"
})
print(f"Glory: {resp}")
```

### `action: "get-clan-info"`

Gets clan details (name, level, members) for a running group.

``` python
resp = api("POST", "/api/client/group-action", json={
    "action": "get-clan-info",
    "group_id": "abc123"
})
print(f"Clan: {resp}")
```

The exact response schemas for these two actions were not included in
the supplied excerpt.

------------------------------------------------------------------------

## Part 10 --- Coupons

### 10.1 Create Coupon

#### `POST /api/client/create-coupon`

Creates a coupon using credits. Credits are deducted immediately.

Fields:

  Field               Type      Description
  ------------------- --------- -----------------------------------
  `basic_credits`     integer   Basic credits to include, 0--100
  `premium_credits`   integer   Premium credits to include, 0--20

Supplied example:

``` python
resp = api("POST", "/api/client/create-coupon", json={
    "basic_credits": 5,
    "premium_credits": 0
})
print(f"Coupon: {resp['coupon']['code']}")
```

Example response:

``` json
{
  "success": true,
  "coupon": {
    "code": "AB12-CD34-EF56",
    "basic_credits": 5,
    "premium_credits": 0,
    "status": "active",
    "created_at": "2026-03-28T10:00:00Z"
  }
}
```

Limits and rules:

-   Maximum 100 active coupons per account.
-   At least 1 credit total is required.
-   Credits are deducted immediately.

### 10.2 List Coupons Created by You

#### `GET /api/client/my-coupons`

Lists coupons you created: active, redeemed, and cancelled.

Supplied example:

``` python
coupons = api("GET", "/api/client/my-coupons")
for c in coupons:
    print(
        f"  {c['code']}  status={c['status']}  "
        f"basic={c['basic_credits']}  premium={c['premium_credits']}"
    )
```

Example response:

``` json
[
  {
    "code": "AB12-CD34-EF56",
    "basic_credits": 5,
    "premium_credits": 0,
    "status": "active",
    "created_by": "john",
    "created_at": "2026-03-28T10:00:00Z"
  }
]
```

### 10.3 List Coupons Redeemed by You

#### `GET /api/client/redeemed-coupons`

Lists coupons you have redeemed (received from others).

Supplied example:

``` python
coupons = api("GET", "/api/client/redeemed-coupons")
for c in coupons:
    print(
        f"  {c['code']}  from={c['created_by']}  "
        f"basic={c['basic_credits']}"
    )
```

The supplied excerpt does not include a full response JSON schema for
this endpoint.

### 10.4 Redeem Coupon

#### `POST /api/client/redeem-coupon`

Redeems a coupon code to add credits to your account.

Field:

  Field    Type     Description
  -------- -------- ----------------------------------------
  `code`   string   Coupon code in `XXXX-XXXX-XXXX` format

Supplied example:

``` python
resp = api("POST", "/api/client/redeem-coupon", json={
    "code": "AB12-CD34-EF56"
})
print(
    f"Redeemed! +{resp['basic_credits']} basic, "
    f"+{resp['premium_credits']} premium"
)
```

Rate limit: 5 attempts per 60 seconds.

### 10.5 Cancel Coupon

#### `POST /api/client/cancel-coupon`

Cancels an active coupon you created. Credits are refunded to your
account.

Field:

  Field    Type     Description
  -------- -------- -----------------------
  `code`   string   Coupon code to cancel

Supplied example:

``` python
resp = api("POST", "/api/client/cancel-coupon", json={
    "code": "AB12-CD34-EF56"
})
print(
    f"Refunded: {resp['refunded_basic']} basic, "
    f"{resp['refunded_premium']} premium"
)
```

Rules:

-   Only works on active coupons.
-   Already redeemed coupons cannot be cancelled.
-   Credits are refunded to your account.

------------------------------------------------------------------------

## Part 11 --- Transactions

### 11.1 List Transactions

#### `GET /api/client/transactions`

Lists purchase history (last 50 transactions).

Supplied example:

``` python
txns = api("GET", "/api/client/transactions")
for t in txns:
    print(
        f"  {t['id'][:8]}  status={t['status']}  "
        f"basic={t['basic_credits']}  premium={t['premium_credits']}"
    )
```

Example response:

``` json
[
  {
    "id": "txn_abc123",
    "order_id": "123456789012345678",
    "basic_credits": 10,
    "premium_credits": 0,
    "status": "approved",
    "created_at": "2026-03-28T10:00:00Z"
  }
]
```

Fields shown:

-   `id`
-   `order_id`
-   `basic_credits`
-   `premium_credits`
-   `status`
-   `created_at`

### 11.2 Cancel Pending Transaction

#### `POST /api/client/cancel-transaction`

Cancels a pending transaction before admin approval.

Field:

  Field              Type     Description
  ------------------ -------- --------------------------
  `transaction_id`   string   Transaction ID to cancel

Supplied example:

``` python
resp = api("POST", "/api/client/cancel-transaction", json={
    "transaction_id": "txn_abc123"
})
print(resp["message"])
```

------------------------------------------------------------------------

## Part 12 --- History & Monitoring

### 12.1 Group History

#### `GET /api/client/group-history`

Gets full group history with glory snapshots.

Supplied example:

``` python
history = api("GET", "/api/client/group-history")
for h in history:
    print(
        f"  {h['group_id'][:8]}  clan={h['clan_id']}  "
        f"glory={h.get('glory_farmed', 0)}  status={h['status']}"
    )
```

Example response:

``` json
[
  {
    "group_id": "abc123",
    "clan_id": "123456789",
    "region": "ME",
    "status": "stopped",
    "glory_farmed": 1250,
    "bot_count": 4,
    "launched_at": "2026-03-27T08:00:00Z",
    "glory_snapshots": [
      {
        "captured_at": "2026-03-27T09:00:00Z",
        "total_glory": 500,
        "uptime_hours": 1.0
      },
      {
        "captured_at": "2026-03-27T10:00:00Z",
        "total_glory": 1250,
        "uptime_hours": 2.0
      }
    ]
  }
]
```

Fields shown:

-   `group_id`
-   `clan_id`
-   `region`
-   `status`
-   `glory_farmed`
-   `bot_count`
-   `launched_at`
-   `glory_snapshots[]` with `captured_at`, `total_glory`,
    `uptime_hours`

### 12.2 Glory Progression

#### `GET /api/client/glory-progression?group_id=X`

Gets a detailed glory timeline for a specific group.

Supplied example:

``` python
resp = api(
    "GET",
    "/api/client/glory-progression?group_id=abc123"
)
print(f"Clan: {resp['clan_id']}  Total: {resp['glory_farmed']}")
for s in resp["snapshots"]:
    print(f"  {s['captured_at']}  glory={s['total_glory']}")
```

Fields shown:

-   `clan_id`
-   `glory_farmed`
-   `snapshots[]` with `captured_at` and `total_glory`

### 12.3 Activity Log

#### `GET /api/client/activity-log`

Gets the account activity log (last 200 events).

Supplied example:

``` python
logs = api("GET", "/api/client/activity-log")
for l in logs:
    print(
        f"  {l['timestamp']}  {l['action']}  "
        f"group={l.get('group_id', '-')}  {l.get('details', '')}"
    )
```

Documented actions:

  Action      Meaning
  ----------- -----------------
  `start`     Group launched
  `stop`      Group stopped
  `delete`    Group deleted
  `restart`   Group restarted
  `refund`    Credit refunded

### 12.4 Notifications

#### `GET /api/client/notifications`

Gets pending notifications.

Important behavior stated in the documentation:

-   Notifications are cleared/deleted after fetching.
-   This is a one-time read.
-   The documentation says to poll periodically to catch them.

Supplied example:

``` python
notifs = api("GET", "/api/client/notifications")
for n in notifs:
    print(f"  [{n['type']}] {n['title']}: {n['message']}")
```

The supplied excerpt does not include a complete response schema.

------------------------------------------------------------------------

## Part 13 --- Recipes

### 13.1 Launch & Monitor Glory

The supplied recipe demonstrates this sequence:

1.  Launch a group with `POST /api/client/auto-clan-group`.
2.  Save the returned `group_id`.
3.  Poll `GET /api/client/my-groups` every 5 minutes
    (`time.sleep(300)`).
4.  Check whether the group still exists and whether its status is
    `running`.
5.  Request glory using `POST /api/client/group-action` with action
    `get-glory`.
6.  The example sets `TARGET_GLORY = 5000` and shows a commented-out
    conditional to stop the group once the target is reached.

The documentation says to adjust the stop condition based on the actual
glory response format. The supplied sample leaves that condition
commented out; it does not provide a confirmed glory response schema.

### 13.2 Bulk Coupon Distribution

The supplied recipe demonstrates:

1.  Check balance with `GET /api/client/balance`.
2.  Create 10 coupons, each containing 1 Basic credit, using
    `POST /api/client/create-coupon`.
3.  Collect and print the coupon codes.

**Important source detail:** `GET /api/client/balance` appears in this
recipe, but no separate endpoint documentation or response schema for it
was supplied in the collected material. The recipe reads `basic_credits`
and `premium_credits` from its response.

------------------------------------------------------------------------

## Error Handling

The documentation says all errors return JSON with an `error` field.

Example:

``` json
{
  "error": "Insufficient premium credits"
}
```

Common HTTP status codes:

  Code    Meaning
  ------- ----------------------------------------------------------
  `200`   Success
  `400`   Bad request (missing/invalid params)
  `401`   Unauthorized (invalid API key)
  `402`   Insufficient credits
  `403`   Forbidden (missing `x-api-key` header, or limit reached)
  `404`   Not found (group doesn't exist or isn't yours)
  `409`   Conflict (operation already in progress)
  `429`   Rate limited

------------------------------------------------------------------------

## Items to verify before implementation

These are gaps or details not fully specified in the supplied excerpts;
they are listed as questions, not assumptions:

1.  The exact response schema for `get-glory`.
2.  The exact response schema for `get-clan-info`.
3.  The response schemas for `stop`, `restart`, and `delete`.
4.  The full response schema for `GET /api/client/redeemed-coupons`.
5.  The full response schema for `GET /api/client/notifications`.
6.  The exact response schema for `GET /api/client/balance`, which
    appears only in the bulk coupon recipe.
7.  The full response schema for `POST /api/client/auto-clan-group` (the
    supplied example contains an ellipsis).
8.  Whether the shared master key is intended to be provided to website
    operators by the API provider and how it should be securely
    provisioned.
9.  The documentation says both keys are required for all endpoints,
    while Signup says it needs only the `x-api-key` header and Pricing
    says it is public. Follow each endpoint's explicit note and verify
    any ambiguity with the API provider before production use.

## Integration security reminders

-   Keep both API credentials on the server only.
-   Never expose credentials in browser JavaScript, HTML, client-side
    environment variables, screenshots, or public repositories.
-   Use environment secrets on the backend.
-   Do not log API keys or full credential-bearing request URLs.
-   Validate user input and enforce per-user authorization on the
    backend.
-   Confirm destructive actions such as permanent group deletion before
    sending the API request.
-   Handle rate limits and API errors without repeatedly retrying
    sensitive operations.
-   Because the account key was exposed in the shared examples,
    refresh/regenerate it before using this integration.
