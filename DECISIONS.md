# Webhook Delivery Service: Architectural Decisions

This document outlines the core engineering decisions, trade-offs, and what was deliberately left out for the webhook delivery service.

## 1. Delivery Semantics

**Decision: At-Least-Once Delivery**
The service guarantees that every accepted event will be delivered to the target endpoint at least once.

- **Trade-off:** The primary cost of this approach is the risk of **duplicate deliveries** (e.g., if a network timeout occurs after the target server processes the payload but before our service receives the `200 OK`). Customers must implement idempotency on their end to safely discard duplicate events.

## 2. Retry Behavior

**Decision: Exponential Backoff with a 5-Retry Limit**
When an endpoint is unavailable or returns an error, the system schedules retries using an exponential backoff strategy (1, 5, 30, 120, and 360 minutes).

- **Terminal State:** If an event fails on its 5th retry (after the 6-hour delay), its status is permanently marked as `failed`. This prevents infinite loops and database bloat, ensuring our service does not overwhelm a struggling customer server.

## 3. Handling Long Outages

**Decision: Asynchronous Batch Polling & Independent Execution**
If a customer's endpoint goes down for six hours, their events gracefully cycle through the exponential backoff schedule without blocking the system.

- **Impact:** The system uses a stateless background worker that polls pending events. By using `Promise.allSettled` and a strict 10 second HTTP timeout, a hanging endpoint for one customer does not block the event loop. Other customers webhooks continue to be processed concurrentlyu at full speed.

## 4. Ordering

**Decision: No Strict Ordering**
Events for a given customer are not guaranteed to arrive in the exact order they were produced.

- **Trade-off:** If Event A fails, the system would have to halt Events B and C. By prioritizing throughput, customers might receive events out of sequence (e.g., "User Updated" arriving before "User Created") and must rely on payload timestamps to reconstruct the chronological order.

## 5. Deliberately Left Out

**Decision: SQLite & Polling vs. Message Broker**
To satisfy the single-process constraint and keep the service self-contained, I deliberately omitted external message brokers (like Kafka/RabbitMQ) and heavy databases.

- **Trade-off:** While SQLite and `setTimeout` polling are perfect for this scoped test, this architecture deliberately limits horizontal scalability. If traffic spikes require running multiple worker instances concurrently, SQLite would face database lock issues. A production upgrade would require migrating to PostgreSQL or a Redis queue.
