<!-- Stripe Event Structure -->
{
  "id": "evt_1NG8Du2eZvKYlo2CUI79vXWy",
  "object": "event",
  "api_version": "2019-02-19",
  "created": 1686089970,
  "data": {
    "object": {
      "id": "seti_1NG8Du2eZvKYlo2C9XMqbR0x",
      "object": "setup_intent",
      "application": null,
      "automatic_payment_methods": null,
      "cancellation_reason": null,
      "client_secret": "seti_1NG8Du2eZvKYlo2C9XMqbR0x_secret_O2CdhLwGFh2Aej7bCY7qp8jlIuyR8DJ",
      "created": 1686089970,
      "customer": null,
      "description": null,
      "flow_directions": null,
      "last_setup_error": null,
      "latest_attempt": null,
      "livemode": false,
      "mandate": null,
      "metadata": {},
      "next_action": null,
      "on_behalf_of": null,
      "payment_method": "pm_1NG8Du2eZvKYlo2CYzzldNr7",
      "payment_method_options": {
        "acss_debit": {
          "currency": "cad",
          "mandate_options": {
            "interval_description": "First day of every month",
            "payment_schedule": "interval",
            "transaction_type": "personal"
          },
          "verification_method": "automatic"
        }
      },
      "payment_method_types": [
        "acss_debit"
      ],
      "single_use_mandate": null,
      "status": "requires_confirmation",
      "usage": "off_session"
    }
  },
  "livemode": false,
  "pending_webhooks": 0,
  "request": {
    "id": null,
    "idempotency_key": null
  },
  "type": "setup_intent.created"
}

<!-- Fullstory Event Structure -->
{
  "session": {
    "id": "123456789:1298251231",
    "uid": "xyz123"
  },
  "context": {
    "browser": {
      "url": "https://app.example.com",
      "user_agent": "Example_User_Agent",
      "initial_referrer": "https://referrer.example.com"
    }
  },
  "name": "Support Ticket",
  "timestamp": "2022-03-15T14:23:23Z",
  "properties": {
    "id": 424242,
    "priority": "Normal",
    "source": "Email",
    "title": "Account locked out"
  }
}

<!-- Fullstory Session Event Structure -->
{
  "events": [
    {
      "device_id": "17117",
      "session_id": "5916567459329906423",
      "view_id": "4376064173749384629",
      "event_time": "2024-04-03T17:06:12.290Z",
      "event_type": "navigate",
      "event_properties": {
        "navigate_reason": "navigate",
        "event_definition_id": "Navigate-Login-Event",
        "additional_event_definition_ids": []
      },
      "source_type": "web",
      "source_properties": {
        "user_agent": {
          "raw_user_agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
          "device": "Desktop",
          "operating_system": "OS X",
          "browser": "Chrome",
          "browser_version": "123.0.0.0"
        },
        "url": {
          "full_url": "https://app.fullstory.com/login/?dest=%2Fui",
          "host": "app.fullstory.com",
          "path": "/login/",
          "query": {
            "dest": {
              "values": [
                "/ui"
              ]
            }
          }
        },
        "initial_referrer": null
      }
    }
  ]
}

<!-- Sentry Event Json Payload -->
{
  "event_id": "d03613663a814131976694e8f96e4657",
  "project_id": 12345,
  "timestamp": 1709320220.0,
  "received": 1709320221.5,
  "platform": "python",
  "environment": "production",
  "tags": {
    "server_name": "web-server-01",
    "release": "1.0.4"
  },
  "message": "Optional human-readable message",
  "sdk": {
    "name": "sentry.python",
    "version": "1.2.3"
  }
}

<!-- Sentry Issue Occurance -->
{
  "id": "user-generated-uuid-string",
  "project_id": 12345,
  "fingerprint": ["unique-logic-string"],
  "issue_title": "JSON decoding on the main thread",
  "subtitle": "Large payload detected in UI thread",
  "culprit": "myapp.utils.json_parser",
  "type": 1001, 
  "detection_time": 1709320220.0,
  "level": "error",
  "event": {
    "event_id": "d03613663a814131976694e8f96e4657",
    "project_id": 12345,
    "timestamp": 1709320220.0,
    "received": 1709320221.5,
    "platform": "python",
    "environment": "production",
    "tags": {}
  },
  "evidence_data": {},
  "evidence_display": []
}

