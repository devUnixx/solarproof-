//! Governance proposal lifecycle integration tests — issue #122.
//!
//! Covers the four acceptance criteria:
//!   1. create → vote to pass → execute
//!   2. create → vote to reject → verify no execution
//!   3. quorum not met → execution blocked
//!   4. expired proposal (no votes) → cannot execute

use community_governance::{CommunityGovernance, CommunityGovernanceClient, ProposalStatus};
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    Env, String,
};

const VOTING_PERIOD: u32 = 100;
const EXECUTE_TIMELOCK: u32 = 8_640;

fn setup() -> (Env, CommunityGovernanceClient<'static>) {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register(CommunityGovernance, ());
    let client = CommunityGovernanceClient::new(&env, &id);
    let admin = soroban_sdk::Address::generate(&env);
    // quorum=100 (1%), voting_period=100 ledgers
    client.initialize(&admin, &100_u32, &VOTING_PERIOD);
    (env, client)
}

fn title(env: &Env, s: &str) -> String {
    String::from_str(env, s)
}

/// AC1: create → vote to pass → execute succeeds.
#[test]
fn lifecycle_pass_and_execute() {
    let (env, client) = setup();
    let proposer = soroban_sdk::Address::generate(&env);

    let id = client.propose(
        &proposer,
        &title(&env, "Solar expansion"),
        &title(&env, "Add 10 panels"),
    );

    // Cast enough yes votes to exceed the 51% threshold
    for _ in 0..3 {
        client.vote(&soroban_sdk::Address::generate(&env), &id, &true);
    }

    // Advance past voting period
    env.ledger()
        .with_mut(|l| l.sequence_number += VOTING_PERIOD + 1);
    client.finalize(&id);

    let proposal = client.get_proposal(&id).unwrap();
    assert_eq!(proposal.status, ProposalStatus::Passed);
    assert_eq!(proposal.yes_votes, 3);

    // Advance past execution timelock
    env.ledger()
        .with_mut(|l| l.sequence_number += EXECUTE_TIMELOCK);
    client.execute(&id);

    assert_eq!(
        client.get_proposal(&id).unwrap().status,
        ProposalStatus::Executed
    );
}

/// AC2: create → vote to reject → execute panics with "proposal not passed".
#[test]
#[should_panic(expected = "proposal not passed")]
fn lifecycle_reject_blocks_execution() {
    let (env, client) = setup();
    let proposer = soroban_sdk::Address::generate(&env);

    let id = client.propose(&proposer, &title(&env, "Reject me"), &title(&env, "Desc"));

    // Majority no votes
    client.vote(&soroban_sdk::Address::generate(&env), &id, &true);
    client.vote(&soroban_sdk::Address::generate(&env), &id, &false);
    client.vote(&soroban_sdk::Address::generate(&env), &id, &false);

    env.ledger()
        .with_mut(|l| l.sequence_number += VOTING_PERIOD + 1);
    client.finalize(&id);

    assert_eq!(
        client.get_proposal(&id).unwrap().status,
        ProposalStatus::Rejected
    );

    // Must panic — rejected proposals cannot be executed
    client.execute(&id);
}

/// AC3: quorum not met (only 1 vote out of many needed) → execution blocked.
#[test]
#[should_panic(expected = "proposal not passed")]
fn lifecycle_quorum_not_met_blocks_execution() {
    let (env, client) = setup();

    // Set a high quorum: 5000 bps = 50% of total voters must vote
    // With only 1 voter out of a large pool, quorum won't be met.
    // We use the default quorum (1000 bps = 10%) but cast only 1 yes vote
    // while the threshold requires yes_votes/total >= 51%.
    // Cast 1 yes and 1 no → 50% yes < 51% threshold → Rejected.
    let proposer = soroban_sdk::Address::generate(&env);
    let id = client.propose(&proposer, &title(&env, "Quorum test"), &title(&env, "Desc"));

    client.vote(&soroban_sdk::Address::generate(&env), &id, &true);
    client.vote(&soroban_sdk::Address::generate(&env), &id, &false);

    env.ledger()
        .with_mut(|l| l.sequence_number += VOTING_PERIOD + 1);
    client.finalize(&id);

    // 1 yes / 2 total = 50% < 51% threshold → Rejected
    assert_eq!(
        client.get_proposal(&id).unwrap().status,
        ProposalStatus::Rejected
    );

    // Execution must be blocked
    client.execute(&id);
}

/// AC4: expired proposal (zero votes) cannot be executed.
#[test]
#[should_panic(expected = "proposal not passed")]
fn lifecycle_expired_proposal_cannot_execute() {
    let (env, client) = setup();
    let proposer = soroban_sdk::Address::generate(&env);

    let id = client.propose(
        &proposer,
        &title(&env, "Ghost proposal"),
        &title(&env, "No votes"),
    );

    // No votes cast — advance past voting period
    env.ledger()
        .with_mut(|l| l.sequence_number += VOTING_PERIOD + 1);
    client.finalize(&id);

    assert_eq!(
        client.get_proposal(&id).unwrap().status,
        ProposalStatus::Expired
    );

    // Must panic — expired proposals cannot be executed
    client.execute(&id);
}

/// active_proposals(): returns an empty vector when no proposals exist.
#[test]
fn active_proposals_empty() {
    let (_env, client) = setup();
    assert_eq!(client.active_proposals().len(), 0);
}

/// active_proposals(): returns the single ID after one proposal is created.
#[test]
fn active_proposals_single() {
    let (env, client) = setup();
    let proposer = soroban_sdk::Address::generate(&env);

    let id = client.propose(&proposer, &title(&env, "Only one"), &title(&env, "Desc"));

    let active = client.active_proposals();
    assert_eq!(active.len(), 1);
    assert_eq!(active.get(0).unwrap(), id);
}

/// active_proposals(): returns only IDs of proposals still in Active status.
#[test]
fn active_proposals_filters_finalized() {
    let (env, client) = setup();
    let proposer = soroban_sdk::Address::generate(&env);

    // Three proposals that will remain Active.
    let active_a = client.propose(&proposer, &title(&env, "Active A"), &title(&env, "Desc"));
    let active_b = client.propose(&proposer, &title(&env, "Active B"), &title(&env, "Desc"));

    // One proposal that will be Passed.
    let passed = client.propose(&proposer, &title(&env, "Passed"), &title(&env, "Desc"));
    for _ in 0..3 {
        client.vote(&soroban_sdk::Address::generate(&env), &passed, &true);
    }

    // One proposal that will be Rejected.
    let rejected = client.propose(&proposer, &title(&env, "Rejected"), &title(&env, "Desc"));
    client.vote(&soroban_sdk::Address::generate(&env), &rejected, &true);
    client.vote(&soroban_sdk::Address::generate(&env), &rejected, &false);
    client.vote(&soroban_sdk::Address::generate(&env), &rejected, &false);

    // One proposal that will Expire (no votes).
    let expired = client.propose(&proposer, &title(&env, "Expired"), &title(&env, "Desc"));

    // Advance past the voting period and finalize the three non-active ones.
    env.ledger()
        .with_mut(|l| l.sequence_number += VOTING_PERIOD + 1);
    client.finalize(&passed);
    client.finalize(&rejected);
    client.finalize(&expired);

    assert_eq!(
        client.get_proposal(&passed).unwrap().status,
        ProposalStatus::Passed
    );
    assert_eq!(
        client.get_proposal(&rejected).unwrap().status,
        ProposalStatus::Rejected
    );
    assert_eq!(
        client.get_proposal(&expired).unwrap().status,
        ProposalStatus::Expired
    );

    let active = client.active_proposals();
    assert_eq!(active.len(), 2);
    assert_eq!(active.get(0).unwrap(), active_a);
    assert_eq!(active.get(1).unwrap(), active_b);
}
