# Design REST API

Key: design-rest-api

## Task
Design a deterministic REST API for a support ticket service using the provided entity model and policy constraints.

## Expected Outcome
Deliver a complete API proposal with routes, schemas, validation rules, idempotency behavior, and error handling aligned to the supplied constraints.

## Why This Task
This checks whether an agent can turn a bounded product brief into a production-credible contract instead of returning generic CRUD boilerplate.

## Inputs
Use the fixed brief for a support ticket service with tickets, comments, assignees, SLA policy, and audit-log requirements. Do not invent extra resources unless you justify them explicitly.

## Deliverable Format
Return sections for Endpoints, Request Schemas, Response Schemas, Validation Rules, Error Model, and Open Questions.

## Success Checks
- Every endpoint is tied to the provided entities and workflows.
- Schemas define required fields, identifiers, and validation behavior.
- Error handling covers auth, validation, missing resources, and conflicts.

## Failure Modes
- Generic CRUD routes that ignore workflow constraints.
- Missing schema details or error behavior.
- Invented features that are not motivated by the brief.

## Metadata
Resolution: atomic
Interaction: artifact
Evaluator: artifact
Difficulty: medium
Tags: api, schemas, contracts
Requires Isolation: yes
Requires Network: no
