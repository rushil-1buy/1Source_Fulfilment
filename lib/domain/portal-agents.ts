/**
 * External portals a filing agent can work on our behalf: escrow partners and
 * the customs document portal.
 *
 * TWO IDEAS LIVE HERE, kept deliberately separate from the actions that use
 * them so they can be tested without a database.
 *
 * PARTNERS ARE A REGISTRY, NOT A CONSTANT. Today the escrow partner is HKIN in
 * Hong Kong; the stated plan is more APAC partners as the network grows.
 * Everything downstream — the filing agent, the email button, the UI chip —
 * reads this table, so onboarding the next partner is one entry here, not a
 * hunt through the codebase for a hard-coded 'HKIN'.
 *
 * THE AGENT IS A SCRIPTED PORTAL SESSION, SIMULATED. In this build no real
 * portal is contacted: the agent's steps are the honest script of what the
 * production agent will do (sign in, populate the form from the approved
 * instruction, attach, submit, capture the acknowledgement), executed against
 * a simulator and labelled as such everywhere they appear. What is REAL is the
 * discipline around it: the agent only ever files a document a person has
 * already approved, and every run lands in the integration log, the audit
 * trail and the order's communication thread.
 */

export interface EscrowPartner {
  code: string;
  name: string;
  region: string;
  /** Where the filing agent works. */
  portalUrl: string;
  /** Where the instruction email goes. */
  mailbox: string;
  status: 'ACTIVE' | 'COMING_SOON';
}

/**
 * The escrow partner network. First entry is the default for new filings.
 *
 * Only ACTIVE partners can be filed with; the registry still names where the
 * network is heading so the UI can say "more APAC partners onboarding" from
 * data rather than from marketing copy.
 */
export const ESCROW_PARTNERS: EscrowPartner[] = [
  {
    code: 'HKIN',
    name: 'HKIN Escrow',
    region: 'Hong Kong · APAC',
    portalUrl: 'https://portal.hkin.example',
    mailbox: 'instructions@hkin.example',
    status: 'ACTIVE',
  },
  // The next APAC partners slot in here as entries, not as code changes.
];

export const activeEscrowPartner = (): EscrowPartner =>
  ESCROW_PARTNERS.find((p) => p.status === 'ACTIVE') ?? ESCROW_PARTNERS[0];

export interface AgentStep {
  /** What the agent did, in words an operator can audit. */
  action: string;
  /** Milliseconds into the run — deterministic, so replays are comparable. */
  atMs: number;
}

export interface AgentRun {
  portal: string;
  reference: string;
  steps: AgentStep[];
}

/**
 * Deterministic reference from an id — the same filing never gets two
 * different acknowledgement numbers on a re-render or a retry.
 */
export function portalRef(prefix: string, seedId: string): string {
  let h = 0;
  for (const c of seedId) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return `${prefix}-${String(h % 1_000_000).padStart(6, '0')}`;
}

/** The escrow filing script: what the agent does on the partner's portal. */
export function escrowFilingRun(params: {
  partner: EscrowPartner;
  deliverableId: string;
  orderAlias: string;
  beneficiary: string;
  amountLabel: string;
}): AgentRun {
  const ref = portalRef(`${params.partner.code}-RL`, params.deliverableId);
  const steps: AgentStep[] = [
    { action: `Opened ${params.partner.portalUrl}`, atMs: 0 },
    { action: 'Signed in as the 1BUY operator account', atMs: 900 },
    { action: `Started a new release request against ${params.orderAlias}`, atMs: 1_700 },
    {
      action: `Populated beneficiary "${params.beneficiary}" and amount ${params.amountLabel} from the approved instruction`,
      atMs: 2_600,
    },
    { action: 'Attached the approved release instruction (PDF)', atMs: 3_300 },
    { action: 'Submitted the request', atMs: 4_000 },
    { action: `Captured acknowledgement ${ref}`, atMs: 4_600 },
  ];
  return { portal: params.partner.portalUrl, reference: ref, steps };
}

// ─────────────────────────────────────────────────────────────────────────────
// eSanchit — the CHA's document portal
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Which of the order's documents belong on eSanchit.
 *
 * eSanchit is where supporting documents are lodged BEFORE the Bill of Entry
 * is filed on ICEGATE — each upload returns an IRN the BOE then references.
 * Only these types are supporting documents; a GRN or an inspection report is
 * internal paper and has no business on a customs portal.
 */
export const ESANCHIT_DOC_TYPES = ['SUPPLIER_PI', 'PACKING_LIST', 'COO', 'AWB_LABEL'] as const;

export interface ESanchitUpload {
  docId: string;
  title: string;
  docType: string;
  /** Document Reference Number returned by the portal, quoted on the BOE. */
  drn: string;
}

export function eSanchitUploads(
  docs: { id: string; title: string; docType: string }[],
): ESanchitUpload[] {
  return docs
    .filter((d) => (ESANCHIT_DOC_TYPES as readonly string[]).includes(d.docType))
    .map((d) => ({ docId: d.id, title: d.title, docType: d.docType, drn: portalRef('DRN', d.id) }));
}

/** The eSanchit filing script, one upload step per supporting document. */
export function eSanchitFilingRun(params: {
  orderAlias: string;
  uploads: ESanchitUpload[];
}): AgentRun {
  const steps: AgentStep[] = [
    { action: 'Opened esanchit.icegate.gov.in (simulated)', atMs: 0 },
    { action: 'Signed in with the CHA credential', atMs: 900 },
  ];
  params.uploads.forEach((u, i) => {
    steps.push({
      action: `Uploaded "${u.title}" — portal returned ${u.drn}`,
      atMs: 1_800 + i * 800,
    });
  });
  steps.push({
    action: `Linked ${params.uploads.length} document reference${params.uploads.length === 1 ? '' : 's'} for the Bill of Entry on ${params.orderAlias}`,
    atMs: 1_800 + params.uploads.length * 800 + 700,
  });
  return {
    portal: 'https://esanchit.icegate.gov.in',
    reference: portalRef('ESN', params.orderAlias),
    steps,
  };
}
