/**
 * QuorumSeal — Firestore Rules Security Test Suite (Phase 0 TDD)
 * Documents and verifies all "Dirty Dozen" adversarial payloads against firestore.rules.
 * Run with Firebase Emulator Suite (`@firebase/rules-unit-testing`) when an emulator is available.
 */

export interface DirtyDozenCase {
  id: number;
  name: string;
  collection: string;
  operation: 'get' | 'list' | 'create' | 'update' | 'delete';
  expected: 'PERMISSION_DENIED';
  payload: Record<string, unknown>;
  blockingRule: string;
}

export const DIRTY_DOZEN_CASES: DirtyDozenCase[] = [
  {
    id: 1,
    name: 'Self-Assigned Admin Role on Profile Create',
    collection: '/users/director_1',
    operation: 'create',
    expected: 'PERMISSION_DENIED',
    payload: { uid: 'director_1', displayName: 'Mallory', role: 'admin' },
    blockingRule: "isOwner(userId) && incoming().role == 'director'",
  },
  {
    id: 2,
    name: 'Role Escalation on Profile Update',
    collection: '/users/director_1',
    operation: 'update',
    expected: 'PERMISSION_DENIED',
    payload: { role: 'admin' },
    blockingRule: "incoming().role == existing().role && affectedKeys().hasOnly(['displayName', 'phone', 'designation', 'fcmToken', 'notificationsEnabled', 'updatedAt'])",
  },
  {
    id: 3,
    name: 'Cross-User PII Read',
    collection: '/users/director_2',
    operation: 'get',
    expected: 'PERMISSION_DENIED',
    payload: { callerUid: 'director_1' },
    blockingRule: 'isOwner(userId) || isAdmin()',
  },
  {
    id: 4,
    name: 'Shadow Ghost Field Injection',
    collection: '/resolutions/res_001',
    operation: 'create',
    expected: 'PERMISSION_DENIED',
    payload: { isVerified: true, secretBackdoor: 'x' },
    blockingRule: 'isValidResolution(incoming()) -> data.keys().hasOnly([...])',
  },
  {
    id: 5,
    name: 'Unverified Admin Email Spoof',
    collection: '/companies/comp_001',
    operation: 'create',
    expected: 'PERMISSION_DENIED',
    payload: { authEmail: 'tjwangsec2018@gmail.com', email_verified: false },
    blockingRule: 'request.auth.token.email_verified == true',
  },
  {
    id: 6,
    name: 'Orphaned Resolution Creation',
    collection: '/resolutions/res_orphan',
    operation: 'create',
    expected: 'PERMISSION_DENIED',
    payload: { companyId: 'nonexistent_company_id' },
    blockingRule: 'exists(/databases/$(database)/documents/companies/$(incoming().companyId))',
  },
  {
    id: 7,
    name: 'Unauthorized Director Signing',
    collection: '/resolutions/res_001/signatures/sig_unauth',
    operation: 'create',
    expected: 'PERMISSION_DENIED',
    payload: { directorUid: 'unassigned_director' },
    blockingRule: 'isAssignedToResolution(get(/databases/$(database)/documents/resolutions/$(resolutionId)).data)',
  },
  {
    id: 8,
    name: 'Non-Atomic Signature Write',
    collection: '/resolutions/res_001/signatures/sig_001',
    operation: 'create',
    expected: 'PERMISSION_DENIED',
    payload: { batchUpdatesParent: false },
    blockingRule: 'request.auth.uid in getAfter(/databases/$(database)/documents/resolutions/$(resolutionId)).data.signedByUids',
  },
  {
    id: 9,
    name: 'Terminal State Tampering',
    collection: '/resolutions/res_signed',
    operation: 'update',
    expected: 'PERMISSION_DENIED',
    payload: { status: 'pending' },
    blockingRule: "existing().status != 'signed'",
  },
  {
    id: 10,
    name: 'Client Timestamp Forgery',
    collection: '/resolutions/res_001',
    operation: 'create',
    expected: 'PERMISSION_DENIED',
    payload: { createdAt: '2020-01-01T00:00:00Z' },
    blockingRule: 'incoming().createdAt == request.time && incoming().updatedAt == request.time',
  },
  {
    id: 11,
    name: 'Resource Poisoning (ID & String Overflow)',
    collection: '/companies/' + 'a'.repeat(200),
    operation: 'create',
    expected: 'PERMISSION_DENIED',
    payload: { name: 'X'.repeat(5000) },
    blockingRule: 'isValidId(companyId) && data.name.size() <= 160',
  },
  {
    id: 12,
    name: 'Value Poisoning on Whitelisted Update Key',
    collection: '/resolutions/res_001',
    operation: 'update',
    expected: 'PERMISSION_DENIED',
    payload: { viewedByUids: true },
    blockingRule: 'isValidResolution(incoming()) -> isBoundedStringList(data.viewedByUids, 20)',
  },
];
