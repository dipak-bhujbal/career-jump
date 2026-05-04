# Architecture

This folder is the current architecture pack for Career Jump.

It is written to be clear enough for a new architect or engineer to understand the production system, the main runtime flows, and the operational boundaries without reverse-engineering the codebase.

## Contents

- [Infrastructure](./infrastructure.md)
  Deployment topology, external systems, storage, and runtime boundaries.
- [API And Scan Flows](./api-and-scan-flows.md)
  End-to-end request flows for browsing, manual scans, scheduled scans, notifications, and recovery behavior.
- [Runtime State](./runtime-state.md)
  Active runtime data model, lock model, and what lives in KV today.
- [AWS Resource Diagrams](./aws-resource-diagrams.md)
  Concrete AWS service-symbol diagrams and resource maps for the deployed POC.
- [Observability and Logging](./observability-and-logging.md)
  Full observability layer: CloudWatch Log Groups, structured log schemas, metric filters, alarms, two-tier logging model, and implementation checklist for @codex.
- [CQRS Cleanup Gate](./cqrs-cleanup-gate.md)
  Executable deletion gate for the CQRS migration, plus the current trace of legacy paths that must survive until future flag promotion.
- [Release Runbook](../release-runbook.md)
  Step-by-step release and deploy process for developers and agents.

## Current Architectural Position

Career Jump AWS POC v2.2 is currently:

- a GitHub-hosted AWS serverless application
- a CloudFront + S3 static frontend
- a Cognito-protected browser session for the single owner
- a Lambda Function URL API with no API Gateway
- DynamoDB-backed runtime state through a KV-compatible adapter
- Lambda fanout for parallel company scans
- CloudWatch Logs retained for one day
- EventBridge Scheduler running weekday scans every 3 hours, 6am–9pm ET
- integrated with Google Apps Script for email notifications when secrets are configured

## Diagram Format

All diagrams in this folder use Mermaid so they render natively in GitHub and stay easy to update in normal pull requests. AWS nodes are labeled with the corresponding AWS Architecture Icon service names.

## Release Rule

For every production release:

- review this folder
- update any diagram or flow that changed
- keep the diagrams aligned with the actual shipped version
