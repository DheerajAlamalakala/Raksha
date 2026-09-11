from functools import wraps
from flask import current_app, jsonify, request
import logging
import hashlib
import hmac


def validate_signature(payload, signature):
    """
    Validate the incoming payload's signature against our expected signature
    """
    # Use the App Secret to hash the payload
    expected_signature = hmac.new(
        bytes(current_app.config["APP_SECRET"], "latin-1"),
        msg=payload.encode("utf-8"),
        digestmod=hashlib.sha256,
    ).hexdigest()

    # Check if the signature matches
    return hmac.compare_digest(expected_signature, signature)


def signature_required(f):
    """
    Decorator to ensure that the incoming requests to our webhook are valid and signed with the correct signature.

    If APP_SECRET isn't configured yet (e.g. local development before real
    Meta credentials are set up), signature checking is skipped rather than
    crashing with a TypeError -- this is what previously required manually
    commenting the decorator out for local testing (see README). A warning
    is logged so it's obvious this must not ship to production unconfigured.
    """

    @wraps(f)
    def decorated_function(*args, **kwargs):
        app_secret = current_app.config.get("APP_SECRET")
        if not app_secret:
            logging.warning(
                "APP_SECRET is not set - skipping webhook signature verification. "
                "Set APP_SECRET in .env before deploying with real WhatsApp traffic."
            )
            return f(*args, **kwargs)

        signature = request.headers.get("X-Hub-Signature-256", "")[
            7:
        ]  # Removing 'sha256='
        if not validate_signature(request.data.decode("utf-8"), signature):
            logging.info("Signature verification failed!")
            return jsonify({"status": "error", "message": "Invalid signature"}), 403
        return f(*args, **kwargs)

    return decorated_function
