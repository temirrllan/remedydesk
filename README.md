# RemedyDesk

**A service-recovery desk for indie software teams.** A local AI model reads an incident report, quotes the specific evidence behind an impact classification, and a fixed policy computes a suggested partial refund. A human confirms the action; PayPal Sandbox processes the original test payment and the refund.

This is a new project for the [PayPal AI Hackathon](https://paypalaihackathon.devpost.com/). It is a local prototype using synthetic cases and sandbox money only.

## What works now

- Two synthetic customer incidents with different severity.
- Ollama `qwen2.5:7b-instruct` analysis with strict JSON output and exact-quote validation. An invented quote is rejected.
- Server-side policy: minor 5%, major 15%, critical 25% of the original payment, in integer cents. The model cannot set the amount.
- PayPal Sandbox OAuth, Orders v2 create/capture and Payments v2 partial refund adapters, with stable idempotency keys.
- End-to-end Sandbox checkout and partial refund verified on 28 October 2026: a $49.00 test payment was captured and a $12.25 refund returned `COMPLETED` from PayPal's refund API. No real money was involved.
- Refund blocked until a captured payment matches the case amount and currency; one refund per case.
- Responsive local dashboard and activity log.

## Requirements

- Node.js 20+ (no npm dependencies).
- [Ollama](https://ollama.com/) with `qwen2.5:7b-instruct` installed and running.
- A PayPal Developer account with a **Sandbox** app's client ID and secret for the payment flow. Use sandbox credentials only.
- A PayPal sandbox buyer account to approve the test payment. PayPal creates a personal test account alongside the business test account in the Developer Dashboard.

## Run

```sh
ollama pull qwen2.5:7b-instruct
ollama serve
```

In another terminal:

```sh
cp .env.example .env
# Edit .env locally: PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET from your sandbox app.
set -a; source .env; set +a
npm start
```

Open [http://127.0.0.1:4180/](http://127.0.0.1:4180/). To try the AI before obtaining PayPal credentials, start the app without `.env`; payment controls will stay disabled and visibly explain why.

## Judge walkthrough

1. Open Sample account A and click **Analyze impact**. The model should quote the two-hour sign-in outage and classify its impact. The fixed policy calculates a refund.
2. Click **Create sandbox test payment**. The app creates a PayPal Orders v2 order for the synthetic plan price and opens PayPal's sandbox buyer approval page.
3. Approve the payment with your sandbox buyer. PayPal returns to this local app; the server captures the order and records its capture ID.
4. Click **Approve refund** and confirm. The server checks the capture directly with PayPal and submits a partial refund with an idempotency key.
5. Observe the refund ID and activity trail. Try the same refund again: the action is disabled.
6. Open Sample account B to compare a smaller incident.

For a clean repeat, stop the server and delete `data/store.json`. That file is local and ignored by Git.

## Verified Sandbox run

The full flow was tested with a personal Sandbox buyer and a separate Sandbox merchant app. PayPal returned a completed capture for the $49.00 sample payment, then its refund API independently reported a completed $12.25 partial refund in USD. The dashboard also blocks a second refund for the same case. [Screenshot](docs/sandbox-refund.png).

These are mock transactions. To reproduce the payment and refund, create your own free [PayPal Developer Sandbox accounts](https://developer.paypal.com/sandbox-testing/accounts/) and configure your own credentials in `.env`. Do not commit credentials or test-account passwords.

## Architecture

```text
Incident report → Ollama classification + exact evidence quote
                → deterministic refund policy
                → human approval
                → PayPal Sandbox capture and partial refund
```

PayPal credentials remain on the server. All PayPal API calls use `https://api-m.sandbox.paypal.com`. The server listens only on `127.0.0.1`; a random request token and origin checks protect local write endpoints. It is not configured for public hosting.

## Known limits

- Synthetic incidents and customer accounts only. No real customer data or production payments.
- The service-recovery rates are illustrative and not financial or legal advice.
- No merchant authentication, webhook verification, multi-user roles or production database. Do not expose the local server publicly.
- The included automated PayPal adapter test uses a fake HTTP transport; the separate Sandbox run described above verifies the live test environment. Reproduction requires your own Sandbox credentials.

## Hackathon checklist

- [x] Functional local application and AI analysis.
- [x] PayPal Sandbox API integration implemented.
- [x] PayPal Sandbox end-to-end payment and partial refund verified.
- [ ] Public GitHub repo with MIT license.
- [ ] Public YouTube demo under three minutes.
- [ ] English Devpost description and final submission.

The [official rules](https://paypalaihackathon.devpost.com/rules) require a functional demo, public source with a visible open-source license, and a public YouTube video under three minutes. The submission deadline is **12 November 2026 at 12:00 Pacific Standard Time**.

## Sources

- [PayPal REST authentication](https://developer.paypal.com/api/rest/authentication)
- [PayPal Orders v2 integration](https://developer.paypal.com/api/rest/integration/orders-api)
- [PayPal partial refunds](https://developer.paypal.com/checkout/refund-payment)

## License

MIT; see [LICENSE](LICENSE).
