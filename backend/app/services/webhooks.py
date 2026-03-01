import base64
import hashlib
import hmac
import json
import time
from datetime import datetime, timezone

import stripe
from fastapi import HTTPException, Request, status

_SENTRY_MAX_AGE_SECONDS = 300     # 5 minutes
_FULLSTORY_MAX_AGE_SECONDS = 300  # 5 minutes
_ZENDESK_MAX_AGE_SECONDS = 300    # 5 minutes


async def verify_stripe_webhook(request: Request, secret: str) -> dict:
    """
    Verify Stripe webhook signature.
    Must use raw bytes — never parse JSON first.
    Stripe SDK also enforces a 5-minute timestamp window (replay protection).
    """
    raw_body = await request.body()
    sig_header = request.headers.get("stripe-signature", "")

    try:
        event = stripe.Webhook.construct_event(raw_body, sig_header, secret)
    except stripe.SignatureVerificationError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid Stripe signature"
        )
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid Stripe payload"
        )

    return dict(event)


async def verify_sentry_webhook(request: Request, secret: str) -> dict:
    """
    Verify Sentry webhook HMAC-SHA256 signature and reject stale payloads
    (replay protection — mirrors Stripe's 5-minute window).
    Must use raw bytes — never parse JSON first.
    """
    raw_body = await request.body()
    sentry_sig = request.headers.get("sentry-hook-signature", "")
    timestamp_header = request.headers.get("sentry-hook-timestamp", "")

    # Replay protection: reject events older than 5 minutes
    if timestamp_header:
        try:
            event_ts = float(timestamp_header)
            if abs(time.time() - event_ts) > _SENTRY_MAX_AGE_SECONDS:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Sentry webhook timestamp too old",
                )
        except ValueError:
            pass  # malformed timestamp — let signature check handle it

    expected = hmac.new(secret.encode(), raw_body, hashlib.sha256).hexdigest()

    if not hmac.compare_digest(expected, sentry_sig):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid Sentry signature"
        )

    return json.loads(raw_body)


async def verify_fullstory_webhook(request: Request, secret: str) -> dict:
    """
    Verify FullStory webhook signature.
    Header: Fullstory-Signature: o:{org_id},t:{unix_ts},v:{base64_hmac}
    Message: {raw_body}:{org_id}:{timestamp}
    Algorithm: HMAC-SHA256, base64-encoded digest.
    Includes replay protection via the timestamp component.
    """
    raw_body = await request.body()
    sig_header = request.headers.get("fullstory-signature", "")

    # Parse "o:ORG,t:TIMESTAMP,v:SIG"
    parts: dict[str, str] = {}
    for segment in sig_header.split(","):
        if ":" in segment:
            k, v = segment.split(":", 1)
            parts[k.strip()] = v.strip()

    org_id = parts.get("o", "")
    timestamp_str = parts.get("t", "")
    received_sig = parts.get("v", "")

    if not all([org_id, timestamp_str, received_sig]):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Missing or malformed Fullstory-Signature header",
        )

    # Replay protection
    try:
        event_ts = float(timestamp_str)
        if abs(time.time() - event_ts) > _FULLSTORY_MAX_AGE_SECONDS:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="FullStory webhook timestamp too old",
            )
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid FullStory timestamp",
        )

    # Message: raw_body + ":{org_id}:{timestamp}"
    message = raw_body + f":{org_id}:{timestamp_str}".encode()
    expected = base64.b64encode(
        hmac.new(secret.encode(), message, hashlib.sha256).digest()
    ).decode()

    if not hmac.compare_digest(expected, received_sig):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid FullStory signature",
        )

    return json.loads(raw_body)


async def verify_zendesk_webhook(request: Request, secret: str) -> dict:
    """
    Verify Zendesk webhook signature.
    Header X-Zendesk-Webhook-Signature: Base64(HMAC-SHA256(signing_secret, timestamp + raw_body))
    Header X-Zendesk-Webhook-Signature-Timestamp: ISO-8601 string (e.g. 2024-01-15T10:00:00Z)
    Must use raw bytes — never parse JSON first.
    """
    raw_body = await request.body()
    sig_header = request.headers.get("x-zendesk-webhook-signature", "")
    timestamp_header = request.headers.get("x-zendesk-webhook-signature-timestamp", "")

    if not sig_header or not timestamp_header:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Missing Zendesk signature headers",
        )

    # Replay protection — Zendesk uses ISO-8601 timestamp
    try:
        event_ts = datetime.fromisoformat(
            timestamp_header.replace("Z", "+00:00")
        ).timestamp()
        if abs(time.time() - event_ts) > _ZENDESK_MAX_AGE_SECONDS:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Zendesk webhook timestamp too old",
            )
    except (ValueError, AttributeError):
        pass  # Malformed timestamp — let the signature check catch it

    # Message = timestamp_string (as bytes) + raw_body
    message = timestamp_header.encode() + raw_body
    expected = base64.b64encode(
        hmac.new(secret.encode(), message, hashlib.sha256).digest()
    ).decode()

    if not hmac.compare_digest(expected, sig_header):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid Zendesk signature",
        )

    return json.loads(raw_body)
