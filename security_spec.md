# QuorumSeal — Firestore Security Specification (Phase 0 TDD)

## 1. Data Invariants
1. **Strict RBAC & Anti-Privilege-Escalation**: Only the bootstrapped firm administrator (`tjwangsec2018@gmail.com` with `email_verified == true`) or UIDs registered in `/admins/{uid}` possess administrative privileges. Standard users creating `/users/{uid}` are forced to `role == 'director'` and cannot escalate `role` on update.
2. **PII Isolation**: `/users/{uid}` stores email, phone, and FCM token. Reads are strictly restricted to `isOwner(userId)` or `isAdmin()`. No blanket `isSignedIn()` reads exist.
3. **Company & Resolution Relational Integrity**:
   - Every `/resolutions/{resolutionId}` MUST reference an existing `/companies/{companyId}` via `exists()` on create.
   - Every `/resolutions/{resolutionId}/signatures/{signatureId}` MUST pass the Master Gate (`get()` on parent resolution verifying the signer is an assigned director and the parent resolution is NOT in terminal `'signed'` state).
4. **Atomicity Guarantee**: Creating a signature document under `/resolutions/{resolutionId}/signatures/{signatureId}` MUST occur in a Firestore `writeBatch` that atomically updates the parent `/resolutions/{resolutionId}` so `getAfter()` confirms `request.auth.uid in parentAfter.signedByUids`.
5. **Terminal State Locking**: Once a resolution reaches `status == 'signed'`, non-admin users are blocked from any further updates or additional signatures.
6. **Temporal Integrity & Immortal Fields**: `createdAt == request.time` on create and immutable on update; `updatedAt == request.time` on create and update; `createdBy`, `companyId`, and `uid` are immutable after creation.
7. **Secure List Queries (Zero O(n) Lookups)**: Every `allow list` rule evaluates `resource.data` directly without `get()` or `exists()` calls.

## 2. The "Dirty Dozen" Adversarial Payloads
1. **Self-Assigned Admin Role**: Director attempts to create `/users/{uid}` with `role: "admin"`. -> **DENIED**.
2. **Role Escalation Update**: Existing director attempts to update `/users/{uid}` changing `role` from `"director"` to `"admin"`. -> **DENIED**.
3. **Cross-User PII Read**: Director A attempts `get` on `/users/{directorB}`. -> **DENIED**.
4. **Shadow Ghost Field Injection**: Admin or Director sends extra undeclared field `isVerified: true` on `/resolutions/{id}`. -> **DENIED** (`hasOnly` rejection).
5. **Unverified Admin Email Spoof**: Caller with `email == "tjwangsec2018@gmail.com"` and `email_verified == false` attempts to create a company. -> **DENIED**.
6. **Orphaned Resolution Creation**: Admin attempts to create a resolution referencing a non-existent `companyId: "nonexistent_co"`. -> **DENIED** (`exists()` failure).
7. **Unauthorized Director Signing**: Unassigned Director C attempts to sign Resolution assigned only to Directors A & B. -> **DENIED** (Master Gate).
8. **Non-Atomic Signature Write**: Assigned Director A creates `/resolutions/{id}/signatures/{sigId}` without updating parent `signedByUids` in the same batch. -> **DENIED** (`getAfter()` failure).
9. **Terminal State Tampering**: Director A attempts to modify a resolution whose `status` is already `'signed'`. -> **DENIED** (Terminal State Lock).
10. **Client Timestamp Forgery**: Caller sends `createdAt` or `updatedAt` backdated to `2020-01-01T00:00:00Z` instead of `serverTimestamp()`. -> **DENIED** (`request.time` check).
11. **Resource Poisoning (ID & String Overflow)**: Caller uses a 200-char document ID with invalid symbols or a 5,000-char `title`. -> **DENIED** (`isValidId` + `.size()` limits).
12. **Value Poisoning on Whitelisted Update Key**: Assigned Director updates `viewedByUids` on a resolution with a boolean `true` instead of a bounded list of strings. -> **DENIED** (`isValidResolution(incoming())` wraps update).
