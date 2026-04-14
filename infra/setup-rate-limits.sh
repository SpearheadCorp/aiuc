#!/usr/bin/env bash
# infra/setup-rate-limits.sh
#
# Applies AWS-side rate limiting and cost controls for the AIUC Lambda function.
# Run once after each deployment, or whenever you change LAMBDA_FUNCTION_NAME.
#
# Prerequisites:
#   - AWS CLI v2 installed and configured (aws configure / AWS_PROFILE set)
#   - jq installed (for JSON parsing)
#   - SNS topic already exists, or set SNS_TOPIC_ARN to "" to skip email alerts
#
# Usage:
#   export LAMBDA_FUNCTION_NAME=aiuc-lambda       # your Lambda function name
#   export SNS_TOPIC_ARN=arn:aws:sns:us-east-1:123456789012:aiuc-billing-alerts
#   export AWS_REGION=us-east-2                   # region where Lambda lives
#   bash infra/setup-rate-limits.sh

set -euo pipefail

# ── Configuration ─────────────────────────────────────────────────────────────
LAMBDA_FUNCTION_NAME="${LAMBDA_FUNCTION_NAME:?ERROR: set LAMBDA_FUNCTION_NAME}"
AWS_REGION="${AWS_REGION:-us-east-2}"
SNS_TOPIC_ARN="${SNS_TOPIC_ARN:-}"   # leave empty to skip alarm actions

# Lambda reserved concurrency — hard cap on simultaneous Bedrock invocations.
# Each search invocation calls Bedrock twice (embedding + Nova Lite).
# 5 allows ~5 concurrent searches; tune upward if users see frequent throttles.
RESERVED_CONCURRENCY="${RESERVED_CONCURRENCY:-5}"

# Billing alarm threshold in USD — alert when estimated charges exceed this.
# CloudWatch billing metrics are only available in us-east-1.
BILLING_ALARM_THRESHOLD="${BILLING_ALARM_THRESHOLD:-50}"

# Lambda throttle alarm — fires when the concurrency cap rejects requests.
# Helps you know if RESERVED_CONCURRENCY is set too low.
THROTTLE_ALARM_THRESHOLD="${THROTTLE_ALARM_THRESHOLD:-10}"  # throttles per 5-min period

# ── 1. Lambda reserved concurrency ───────────────────────────────────────────
echo ""
echo "==> Setting reserved concurrency for ${LAMBDA_FUNCTION_NAME} to ${RESERVED_CONCURRENCY}..."
aws lambda put-function-concurrency \
    --function-name "${LAMBDA_FUNCTION_NAME}" \
    --reserved-concurrent-executions "${RESERVED_CONCURRENCY}" \
    --region "${AWS_REGION}"
echo "    Done."

# ── 2. CloudWatch billing alarm (us-east-1 only) ─────────────────────────────
echo ""
echo "==> Creating billing alarm (threshold: \$${BILLING_ALARM_THRESHOLD} USD)..."

ALARM_ACTIONS=""
if [[ -n "${SNS_TOPIC_ARN}" ]]; then
    ALARM_ACTIONS="--alarm-actions ${SNS_TOPIC_ARN} --ok-actions ${SNS_TOPIC_ARN}"
fi

# shellcheck disable=SC2086
aws cloudwatch put-metric-alarm \
    --region us-east-1 \
    --alarm-name "aiuc-estimated-charges-usd" \
    --alarm-description "AIUC: AWS estimated charges exceeded \$${BILLING_ALARM_THRESHOLD}" \
    --namespace "AWS/Billing" \
    --metric-name EstimatedCharges \
    --dimensions Name=Currency,Value=USD \
    --statistic Maximum \
    --period 86400 \
    --evaluation-periods 1 \
    --threshold "${BILLING_ALARM_THRESHOLD}" \
    --comparison-operator GreaterThanOrEqualToThreshold \
    --treat-missing-data notBreaching \
    ${ALARM_ACTIONS}
echo "    Done."

# ── 3. Lambda throttle alarm ─────────────────────────────────────────────────
echo ""
echo "==> Creating Lambda throttle alarm (threshold: ${THROTTLE_ALARM_THRESHOLD} throttles/5min)..."

# shellcheck disable=SC2086
aws cloudwatch put-metric-alarm \
    --region "${AWS_REGION}" \
    --alarm-name "aiuc-lambda-throttles" \
    --alarm-description "AIUC Lambda: throttle count exceeded ${THROTTLE_ALARM_THRESHOLD} in a 5-minute window (concurrency cap may be too low)" \
    --namespace "AWS/Lambda" \
    --metric-name Throttles \
    --dimensions Name=FunctionName,Value="${LAMBDA_FUNCTION_NAME}" \
    --statistic Sum \
    --period 300 \
    --evaluation-periods 1 \
    --threshold "${THROTTLE_ALARM_THRESHOLD}" \
    --comparison-operator GreaterThanOrEqualToThreshold \
    --treat-missing-data notBreaching \
    ${ALARM_ACTIONS}
echo "    Done."

# ── 4. Summary ────────────────────────────────────────────────────────────────
echo ""
echo "=== Rate-limiting setup complete ==="
echo ""
echo "Lambda concurrency cap : ${RESERVED_CONCURRENCY} concurrent executions"
echo "Billing alarm          : fires at \$${BILLING_ALARM_THRESHOLD} USD (us-east-1 / daily)"
echo "Throttle alarm         : fires at ${THROTTLE_ALARM_THRESHOLD} throttles per 5-minute window"
if [[ -n "${SNS_TOPIC_ARN}" ]]; then
    echo "SNS notifications      : ${SNS_TOPIC_ARN}"
else
    echo "SNS notifications      : NONE (set SNS_TOPIC_ARN to enable email/SMS alerts)"
fi
echo ""
echo "To adjust in-Lambda sliding-window limits, set these env vars on the function:"
echo "  SEARCH_RATE_LIMIT_MAX=10         (requests per user per window)"
echo "  SEARCH_RATE_LIMIT_WINDOW_MS=60000 (window size in ms)"
echo ""
echo "To update Lambda env vars:"
echo "  aws lambda update-function-configuration \\"
echo "    --function-name ${LAMBDA_FUNCTION_NAME} \\"
echo "    --environment 'Variables={SEARCH_RATE_LIMIT_MAX=10,SEARCH_RATE_LIMIT_WINDOW_MS=60000}' \\"
echo "    --region ${AWS_REGION}"
