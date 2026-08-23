# coturn for Milox video calls

Milox reads these API env vars:

- `STUN_URLS` — optional; Google STUN used when empty
- `TURN_URLS` — comma-separated TURN/TURNS URLs
- `TURN_SECRET` — coturn `static-auth-secret` (preferred; time-limited REST creds)
- `TURN_USERNAME` / `TURN_PASSWORD` — fallback static TURN auth when secret is empty
- `TURN_CREDENTIAL_TTL_SEC` — REST credential lifetime (default 86400)

Prefer time-limited TURN credentials by configuring the same shared secret in
coturn and `TURN_SECRET`.

Example `/etc/turnserver.conf`:

```ini
listening-port=3478
tls-listening-port=5349
fingerprint
use-auth-secret
static-auth-secret=replace-with-the-same-value-as-TURN_SECRET
realm=turn.example.com
server-name=turn.example.com
total-quota=1200
stale-nonce=600
no-multicast-peers
no-loopback-peers
cert=/etc/letsencrypt/live/turn.example.com/fullchain.pem
pkey=/etc/letsencrypt/live/turn.example.com/privkey.pem
```

Example API environment:

```dotenv
STUN_URLS=stun:turn.example.com:3478
TURN_URLS=turn:turn.example.com:3478?transport=udp,turns:turn.example.com:5349?transport=tcp
TURN_SECRET=replace-with-a-long-random-secret
TURN_CREDENTIAL_TTL_SEC=86400
```

Allow inbound UDP/TCP 3478, TCP 5349, and the coturn relay UDP range (49152–
65535 by default). Restart coturn after changing the secret and verify both
Wi-Fi-to-cellular and cellular-to-cellular calls.
