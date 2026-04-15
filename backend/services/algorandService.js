// algorandService.js
// -------------------------------------------------------------
// Simple Algorand Testnet utility for a student lending DApp.
// Hackspiration '26 - Demo / prototype only, NOT production.
// -------------------------------------------------------------

const algosdk = require('algosdk');

/**
 * Stateful lending application (ASC1) approval program, in TEAL.
 *
 * This contract owns the *trust* logic:
 *  - Global state:
 *      - total_pool_balance : last known escrow balance (updated on borrow)
 *  - Local state (per borrower, keyed by Txn.Sender):
 *      - reputation_score   : simple demo score (currently constant)
 *      - borrowed_amount    : how much this borrower currently owes
 *      - borrow_limit       : hard cap for this borrower
 *
 * Off-chain components can *request* borrows, but the chain enforces:
 *  - borrowed_amount + requested_amount <= borrow_limit
 *  - requested_amount <= escrow account balance (pool safety)
 *
 * This means a backend cannot over-borrow on behalf of a student:
 * the ASC1 will reject any group that violates these rules.
 */
function buildLendingAppApprovalTeal() {
    // NOTE: For hackathon clarity we hard-code a single borrow limit:
    // 5 ALGO in microAlgos = 5_000_000. This lives entirely ON-CHAIN.
    return `#pragma version 6

// Scratch slots:
//  0 -> key_total_pool_balance
//  1 -> key_reputation_score
//  2 -> key_borrowed_amount
//  3 -> key_borrow_limit
//  4 -> requested_amount
//  5 -> current_limit
//  6 -> current_borrowed
//  7 -> escrow_balance

// Preload key strings into scratch for readability.
byte "total_pool_balance"
store 0
byte "reputation_score"
store 1
byte "borrowed_amount"
store 2
byte "borrow_limit"
store 3

// Handle Creation (AppID == 0)
txn ApplicationID
int 0
==
bnz handle_creation

// Branch on OnCompletion type.
txn OnCompletion
int 0 // NoOp
==
bnz handle_noop

txn OnCompletion
int 1 // OptIn
==
bnz handle_optin

// Reject all other OnCompletion types for this demo (close out, clear, etc.).
err

handle_creation:
int 1
return

handle_optin:
// When a borrower opts in, initialise their local state.
// reputation_score := 1
int 0 // Sender
load 1
int 1
app_local_put

// borrowed_amount := 0
int 0 // Sender
load 2
int 0
app_local_put

// borrow_limit := 5 ALGO (fixed demo value)
int 0 // Sender
load 3
int 5000000
app_local_put

int 1
return

handle_noop:
// Require at least one application argument.
txna ApplicationArgs 0
byte "borrow"
==
bnz handle_borrow

// Unknown method -> reject (keeps demo surface area small).
err

handle_borrow:
// Parse requested_amount from args[1] as uint64.
txna ApplicationArgs 1
btoi
store 4

// Load local borrow_limit (key 3) and borrowed_amount (key 2) for Txn.Sender (0).
int 0 // Sender
load 3
app_local_get
store 5 // borrow_limit

int 0 // Sender
load 2
app_local_get
store 6 // borrowed_amount

// Enforce per-user borrowing cap:
//   borrowed_amount (6) + requested_amount (4) <= borrow_limit (5)
load 6
load 4
+
load 5
<=
bnz check_pool_balance

// If the inequality fails (borrow > limit), reject.
err

check_pool_balance:
// accounts[1] must be the escrow account.
// Read its balance.
int 1
balance
store 7 // escrow_balance

// Update global total_pool_balance (key 0) := current escrow balance.
load 0
load 7
app_global_put

// Require requested_amount (4) <= escrow_balance (7) (pool safety).
load 4
load 7
<=
bnz update_borrowed_amount

// If pool doesn't have enough funds, reject.
err

update_borrowed_amount:
// Update borrowed_amount (key 2) for Sender (0).
// New amount = old_borrowed (6) + requested (4).
int 0 // Sender
load 2
load 6
load 4
+
app_local_put

// Approve the transaction.
int 1
return
`;
}

/**
 * Clear-state program for the lending ASC1.
 * For this demo it simply allows clearing local/global state.
 */
function buildLendingAppClearTeal() {
    return `#pragma version 6
int 1
`;
}

/**
 * Minimal stateless TEAL escrow program (as a string template).
 *
 * In this upgraded architecture the *escrow* only checks structure:
 *  - It must be tx #1 in a 2-transaction atomic group.
 *  - Tx #0 must be an ApplicationCall to the lending ASC1.
 *  - The application ID must match the hard-coded ID used at compile time.
 *  - The receiver of the escrow payment must equal the AppCall sender
 *    (the borrowing student).
 *  - No rekey or close-remainder is allowed.
 *
 * The *trust* rules (per-user limits, pool safety) live entirely in the
 * stateful contract above. If that AppCall returns 0, the whole group
 * (including this escrow spend) is rejected by the protocol.
 */
function buildEscrowTealSource(appId) {
    return `#pragma version 6

// Ensure this is a 2-transaction atomic group.
global GroupSize
int 2
==
bnz check_index
err

check_index:
// Escrow spend must be the second transaction in the group (index 1).
txn GroupIndex
int 1
==
bnz check_app_call
err

check_app_call:
// Tx 0 must be an ApplicationCall to the lending ASC1.
gtxn 0 TypeEnum
int appl
==
bnz check_app_id
err

check_app_id:
gtxn 0 ApplicationID
int ${appId}
==
bnz check_receiver_matches_borrower
err

check_receiver_matches_borrower:
// Funds must go to the same address that called the app (the borrower).
gtxn 0 Sender
txn Receiver
==
bnz check_payment_and_safety
err

check_payment_and_safety:
// This (tx 1) must be a simple payment from the escrow to the borrower.
txn TypeEnum
int pay
==
bnz check_safety_fields
err

check_safety_fields:
// Disallow rekeying or closing the escrow in this contract.
txn RekeyTo
global ZeroAddress
==
txn CloseRemainderTo
global ZeroAddress
==
&&
bnz approve
err

approve:
int 1
`;
}

/**
 * Algod Testnet configuration using a public endpoint.
 *
 * This uses AlgoNode's free public Testnet node.
 * Docs: https://algonode.io/
 *
 * You can swap this for another provider if needed.
 */
const ALGOD_CONFIG = {
    token: '',
    server: 'https://testnet-api.4160.nodely.dev', // Switch to Nodely for better sync
    port: 443,
};

/**
 * Pool wallet configuration (env only; no hardcoded secrets).
 * Reads POOL_ADDRESS and POOL_MNEMONIC; trims whitespace and validates.
 * Throws with a clear message if missing or invalid.
 */
function getPoolConfig() {
    const poolAddress = (process.env.POOL_ADDRESS || '').trim();
    const poolMnemonic = (process.env.POOL_MNEMONIC || '').trim();

    if (!poolAddress) {
        throw new Error('Pool wallet not configured: POOL_ADDRESS is missing or empty. Set it in the backend environment.');
    }
    if (!poolMnemonic) {
        throw new Error('Pool wallet not configured: POOL_MNEMONIC is missing or empty. Set it in the backend environment.');
    }
    if (!algosdk.isValidAddress(poolAddress)) {
        throw new Error('POOL_ADDRESS is not a valid Algorand address. Check the value in your environment.');
    }

    return { poolAddress, poolMnemonic };
}

/**
 * Create and return an Algod client instance for Testnet.
 * This is intentionally simple and stateless.
 */
function getAlgodClient() {
    const { token, server, port } = ALGOD_CONFIG;
    return new algosdk.Algodv2(token, server, port);
}

/**
 * Compile the lending ASC1 TEAL programs and create the application on Testnet.
 *
 * For the hackathon demo we use the pool wallet (from mnemonic) as the creator,
 * but once deployed the app itself enforces trust rules on-chain.
 */
async function createLendingApp(creatorMnemonic) {
    const algodClient = getAlgodClient();
    const creatorAccount = accountFromMnemonic(creatorMnemonic);
    const creatorAddr =
        typeof creatorAccount.addr === 'string'
            ? creatorAccount.addr
            : creatorAccount.addr.toString();

    console.log("Debug: Creator Mnemonic Length:", creatorMnemonic.split(' ').length);
    console.log("Debug: Creator Address:", creatorAddr);

    const approvalSource = buildLendingAppApprovalTeal();
    const clearSource = buildLendingAppClearTeal();

    const approvalCompiled = await algodClient.compile(approvalSource).do();
    const clearCompiled = await algodClient.compile(clearSource).do();

    const approvalProgram = new Uint8Array(Buffer.from(approvalCompiled.result, 'base64'));
    const clearProgram = new Uint8Array(Buffer.from(clearCompiled.result, 'base64'));

    const suggestedParams = await algodClient.getTransactionParams().do();

    // Global: 1 uint (total_pool_balance), no bytes.
    // Local:  3 uint (reputation_score, borrowed_amount, borrow_limit), no bytes.
    const txn = algosdk.makeApplicationCreateTxnFromObject({
        sender: creatorAddr,
        approvalProgram,
        clearProgram,
        numGlobalInts: 1,
        numGlobalByteSlices: 0,
        numLocalInts: 3,
        numLocalByteSlices: 0,
        onComplete: algosdk.OnApplicationComplete.NoOpOC,
        suggestedParams,
    });

    const signed = txn.signTxn(creatorAccount.sk);

    // Get ID from the transaction object itself
    const txId = txn.txID().toString();
    console.log("Debug: Computed Transaction ID:", txId);

    try {
        const response = await algodClient.sendRawTransaction(signed).do();
        console.log("Debug: sendRawTransaction response:", response);
    } catch (e) {
        console.error("Debug: sendRawTransaction failed:", e);
        throw e;
    }

    const confirmed = await waitForConfirmation(algodClient, txId, 10);
    console.log("Debug: Confirmed Transaction Info:", JSON.stringify(confirmed, (key, value) =>
        typeof value === 'bigint' ? value.toString() : value
        , 2));

    const appId =
        confirmed['application-index'] ||
        confirmed.applicationIndex ||
        confirmed['created-application-index'] ||
        confirmed.createdApplicationIndex;

    if (!appId && appId !== 0) {
        throw new Error('Unable to determine created application ID.');
    }

    return {
        appId,
        txId,
        approvalTeal: approvalSource,
        clearTeal: clearSource,
    };
}

/**
 * Convenience wrapper that creates the lending ASC1 using the pool wallet
 * from environment variables.
 */
async function createLendingAppUsingEnv() {
    const { poolMnemonic } = getPoolConfig();
    return createLendingApp(poolMnemonic);
}

/**
 * Helper to either read an existing lending app ID from env or create one.
 * Backend integration should ideally create the app once and persist the ID
 * (e.g. via LENDING_APP_ID).
 */
async function getLendingAppId() {
    const fromEnv = (process.env.LENDING_APP_ID || '').trim();
    if (fromEnv) {
        const parsed = Number(fromEnv);
        if (!Number.isInteger(parsed) || parsed <= 0) {
            throw new Error('LENDING_APP_ID must be a positive integer application ID.');
        }
        return parsed;
    }

    // We used to auto-create the app on first call, but that's slow (~10s)
    // and burns ALGO on every cold start. Require explicit deployment via
    // `node scripts/deployApp.js` and persistence in .env so the hot path
    // is fast and predictable.
    throw new Error(
        'LENDING_APP_ID is not set. Ask your Algorand teammate for the deployed app ID and put it in backend/.env as LENDING_APP_ID=<number>.'
    );
}

/**
 * Compile the escrow TEAL program for a given lending app ID and return
 * the escrow contract account (logic sig) address.
 *
 * Stateless smart contracts do not need a deploy transaction; compilation
 * is deterministic: same source + same network = same escrow address.
 */
async function deployEscrowContractForApp(appId) {
    if (!Number.isInteger(appId) || appId <= 0) {
        throw new Error('Cannot deploy escrow: appId must be a positive integer.');
    }

    const algodClient = getAlgodClient();
    const source = buildEscrowTealSource(appId);

    const compileResult = await algodClient.compile(source).do();

    const programBytes = new Uint8Array(Buffer.from(compileResult.result, 'base64'));
    const escrowAddress = compileResult.hash;

    return {
        escrowAddress,
        programBytes,
        tealSource: source,
    };
}

/**
 * Convenience wrapper that compiles the escrow for whichever lending ASC1
 * is active (looked up from LENDING_APP_ID or created on the fly).
 */
async function deployEscrowContractUsingEnv() {
    const appId = await getLendingAppId();
    return deployEscrowContractForApp(appId);
}

// NOTE: deployEscrowContractForPool is intentionally removed in favour of
// app-linked escrows; see deployEscrowContractForApp above.

/**
 * Generate a new Algorand account.
 *
 * Returns:
 *  - walletAddress: public address (string)
 *  - mnemonic: 25-word mnemonic (string) - DEMO ONLY
 *
 * Private keys / mnemonics should NEVER be logged or stored
 * in a real production system. Here it is returned only so
 * the frontend/backend can display it for the hackathon demo.
 */
function createWallet() {
    const account = algosdk.generateAccount();
    const mnemonic = algosdk.secretKeyToMnemonic(account.sk);

    return {
        // Ensure we always expose a plain string address, even if
        // newer algosdk versions wrap it in an Address object.
        walletAddress:
            typeof account.addr === 'string' ? account.addr : account.addr.toString(),
        mnemonic,
    };
}

/**
 * Recover an account object from a mnemonic.
 * Throws a clean error if the mnemonic is invalid.
 */
function accountFromMnemonic(mnemonic) {
    try {
        const account = algosdk.mnemonicToSecretKey(mnemonic);
        return account; // { addr, sk }
    } catch (err) {
        throw new Error('Invalid mnemonic. Cannot recover Algorand account.');
    }
}

/**
 * Convert ALGO to microAlgos.
 * 1 ALGO = 1_000_000 microAlgos.
 */
function algoToMicroAlgo(amountInAlgo) {
    return Math.round(Number(amountInAlgo) * 1_000_000);
}

/**
 * Core helper: create, sign, and send a payment transaction
 * on Algorand Testnet.
 *
 * Parameters:
 *  - senderMnemonic: mnemonic of the sender account (string)
 *  - receiverAddress: address of the receiver (string)
 *  - amountMicroAlgos: integer amount in microAlgos (number)
 *  - noteText (optional): human-readable note string
 *
 * Returns:
 *  - { txId, confirmedRound }
 *
 * Throws user-friendly errors for common failure cases:
 *  - invalid mnemonic
 *  - insufficient balance
 *  - network issues
 */
async function sendPaymentTransaction({
    senderMnemonic,
    receiverAddress,
    amountMicroAlgos,
    noteText,
}) {
    const algodClient = getAlgodClient();

    // Recover sender account from mnemonic
    const senderAccount = accountFromMnemonic(senderMnemonic);

    try {
        // Validate receiver address format
        if (!algosdk.isValidAddress(receiverAddress)) {
            throw new Error('Invalid receiver Algorand address.');
        }

        // Get suggested params from the network (fee, rounds, etc.)
        const suggestedParams = await algodClient.getTransactionParams().do();

        // Optional note field, encoded to Uint8Array
        const note = noteText ? new TextEncoder().encode(noteText) : undefined;

        // Create a standard payment transaction (algosdk v3 uses sender/receiver)
        const senderAddr = typeof senderAccount.addr === 'string' ? senderAccount.addr : senderAccount.addr.toString();
        const txn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
            sender: senderAddr,
            receiver: receiverAddress,
            amount: amountMicroAlgos,
            note,
            suggestedParams,
        });

        // Sign transaction with sender's private key
        const signedTxn = txn.signTxn(senderAccount.sk);

        // Submit to the network
        const response = await algodClient.sendRawTransaction(signedTxn).do();
        const txId = response.txId || response.txid;

        // Wait for confirmation (simple polling)
        const confirmedTxn = await waitForConfirmation(algodClient, txId, 6);

        return {
            txId,
            confirmedRound: confirmedTxn['confirmed-round'],
        };
    } catch (err) {
        console.error("Debug: Original Network Error:", err); // ADDED LOG
        const msg = String(err.message || err);

        if (msg.toLowerCase().includes('overspend') || msg.toLowerCase().includes('underflow')) {
            throw new Error('Transaction failed: insufficient balance in sender account.');
        }
        if (msg.toLowerCase().includes('could not find account') || msg.toLowerCase().includes('no such account')) {
            throw new Error('Transaction failed: sender account not found on Testnet (probably unfunded).');
        }
        if (msg.toLowerCase().includes('network') || msg.toLowerCase().includes('econn')) {
            throw new Error('Network error while contacting Algorand Testnet.');
        }

        // Generic fallback
        throw new Error(`Transaction failed: ${msg}`);
    }
}

/**
 * Wait until the transaction is confirmed (or timeout after `maxRounds`).
 *
 * This is a simplified version of the official Algorand SDK pattern.
 */
async function waitForConfirmation(algodClient, txId, maxRounds = 6) {
    let status = await algodClient.status().do();
    // Support both v2 (kebab-case) and v3 (camelCase)
    let lastRound = status['last-round'] !== undefined ? status['last-round'] : status.lastRound;

    if (lastRound === undefined) {
        lastRound = 0n;
    }

    // Ensure lastRound is BigInt for v3
    if (typeof lastRound === 'number') {
        lastRound = BigInt(lastRound);
    }

    const startRound = lastRound;

    while (lastRound < startRound + BigInt(maxRounds)) {
        const pendingInfo = await algodClient.pendingTransactionInformation(txId).do();

        // Support both v2 and v3
        const confirmedRound = pendingInfo['confirmed-round'] !== undefined ? pendingInfo['confirmed-round'] : pendingInfo.confirmedRound;
        const poolError = pendingInfo['pool-error'] !== undefined ? pendingInfo['pool-error'] : pendingInfo.poolError;

        if (confirmedRound !== null && confirmedRound !== undefined && confirmedRound > 0) {
            return pendingInfo;
        }

        if (poolError !== null && poolError !== undefined && poolError.length > 0) {
            throw new Error(`TransactionPool.Remember: ${poolError}`);
        }

        await algodClient.statusAfterBlock(lastRound + 1n).do();
        lastRound++;
    }
    throw new Error(`Transaction ${txId} not confirmed after ${maxRounds} rounds`);
}

// ---------------------------------------------------------------------
// DApp-specific wrappers: contribute, borrow, repay
// NOTE: These are thin wrappers around sendPaymentTransaction.
//       They only encode the "intent" in the note field and
//       provide clearer naming for backend usage.
// ---------------------------------------------------------------------

/**
 * Contribute ALGO to the lending pool.
 *
 * Parameters:
 *  - contributorMnemonic: mnemonic of the contributor (string)
 *  - poolAddress: Algorand address representing the pool (string)
 *  - amountAlgo: amount in ALGO (number or string)
 */
async function contributeToPool({
    contributorMnemonic,
    poolAddress,
    amountAlgo,
}) {
    const amountMicroAlgos = algoToMicroAlgo(amountAlgo);

    // Compile (or effectively "deploy") the escrow that is *bound* to the
    // lending ASC1. This ties all pool funds to on-chain rules.
    const appId = await getLendingAppId();
    const { escrowAddress } = await deployEscrowContractForApp(appId);

    return sendPaymentTransaction({
        senderMnemonic: contributorMnemonic,
        // Funds flow: Contributor -> Escrow (pool funds held by contract account).
        receiverAddress: escrowAddress,
        amountMicroAlgos,
        noteText: 'Hackspiration26: Contribute to pool',
    });
}

/**
 * Borrow ALGO from the lending pool.
 *
 * Parameters:
 *  - borrowerMnemonic: mnemonic of the borrowing student (string)
 *  - borrowerAddress (optional): Algorand address of the borrowing student (string)
 *  - amountAlgo: amount in ALGO (number or string)
 */
async function borrowFromPool({
    borrowerMnemonic,
    borrowerAddress,
    amountAlgo,
}) {
    if (!borrowerMnemonic) {
        throw new Error(
            'borrowFromPool now requires borrowerMnemonic so that eligibility is enforced on-chain by the lending ASC1.'
        );
    }

    const amountMicroAlgos = algoToMicroAlgo(amountAlgo);

    const algodClient = getAlgodClient();

    // Recover borrower account from mnemonic; this account will:
    //  - own the local state in the lending ASC1
    //  - receive funds from the escrow if approved.
    const borrowerAccount = accountFromMnemonic(borrowerMnemonic);
    const borrowerAddr =
        typeof borrowerAccount.addr === 'string'
            ? borrowerAccount.addr
            : borrowerAccount.addr.toString();

    if (borrowerAddress && borrowerAddress !== borrowerAddr) {
        throw new Error('borrowerAddress does not match the provided borrowerMnemonic.');
    }

    // Identify the lending ASC1 and its linked escrow contract.
    const appId = await getLendingAppId();
    const { escrowAddress, programBytes } = await deployEscrowContractForApp(appId);

    // Suggested params for both transactions in the group.
    const suggestedParams = await algodClient.getTransactionParams().do();

    // Ensure borrower has opted into the lending app (so local state exists).
    try {
        await algodClient.accountApplicationInformation(borrowerAddr, appId).do();
    } catch {
        const optInTxn = algosdk.makeApplicationOptInTxnFromObject({
            sender: borrowerAddr,
            appIndex: appId,
            suggestedParams,
        });
        const signedOptIn = optInTxn.signTxn(borrowerAccount.sk);
        const optInResponse = await algodClient.sendRawTransaction(signedOptIn).do();
        const optInTxId = optInResponse.txId || optInResponse.txid;
        await waitForConfirmation(algodClient, optInTxId, 6);
    }

    // Tx 0: ApplicationCall that enforces:
    //  - borrowed_amount + requested_amount <= borrow_limit (local state)
    //  - requested_amount <= escrow balance (global pool safety)
    const appArgs = [
        new TextEncoder().encode('borrow'),
        algosdk.encodeUint64(amountMicroAlgos),
    ];

    const appCallTxn = algosdk.makeApplicationNoOpTxnFromObject({
        sender: borrowerAddr,
        appIndex: appId,
        appArgs,
        // accounts[1] inside TEAL will be the escrow account, whose balance is checked.
        accounts: [escrowAddress],
        suggestedParams,
    });

    // Tx 1: actual payment from escrow contract account to borrower.
    const escrowPaymentTxn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
        sender: escrowAddress,
        receiver: borrowerAddr,
        amount: amountMicroAlgos,
        note: new TextEncoder().encode('Hackspiration26: Borrow from pool via ASC1 escrow'),
        suggestedParams,
    });

    // Group them so TEAL can see both transactions.
    algosdk.assignGroupID([appCallTxn, escrowPaymentTxn]);

    // Sign tx 0 with the borrower private key (they own the local state).
    const signedAppCall = appCallTxn.signTxn(borrowerAccount.sk);

    // Sign tx 1 with the escrow logic sig (compiled TEAL program).
    const lsig = new algosdk.LogicSigAccount(programBytes);
    const signedEscrow = algosdk.signLogicSigTransactionObject(escrowPaymentTxn, lsig);

    // Submit group to Testnet.
    const response = await algodClient
        .sendRawTransaction([signedAppCall, signedEscrow.blob])
        .do();

    console.log("Debug: Group Transaction Response:", response); // LOGGING
    const txId = response.txId || response.txid;
    console.log("Debug: Extracted TxId:", txId);

    const confirmedTxn = await waitForConfirmation(algodClient, txId, 6);

    return {
        txId,
        confirmedRound: confirmedTxn['confirmed-round'],
        escrowAddress,
    };
}

/**
 * Repay a loan back to the lending pool.
 *
 * Parameters:
 *  - borrowerMnemonic: mnemonic of the borrower (string)
 *  - poolAddress: Algorand address representing the pool (string)
 *  - amountAlgo: amount in ALGO (number or string)
 */
async function repayLoan({
    borrowerMnemonic,
    poolAddress,
    amountAlgo,
}) {
    const amountMicroAlgos = algoToMicroAlgo(amountAlgo);

    // Repayment is a normal payment from borrower to the escrow,
    // NOT back to the pool EOA. This keeps funds inside the contract.
    const appId = await getLendingAppId();
    const { escrowAddress } = await deployEscrowContractForApp(appId);

    return sendPaymentTransaction({
        senderMnemonic: borrowerMnemonic,
        receiverAddress: escrowAddress,
        amountMicroAlgos,
        noteText: 'Hackspiration26: Repay loan',
    });
}

// ---------------------------------------------------------------------
// Convenience wrappers that automatically use the pool wallet from env.
// These are optional but make backend usage simpler:
//  - contributeToPoolUsingEnv   : caller only passes contributor mnemonic
//  - borrowFromPoolUsingEnv     : caller only passes borrower mnemonic
//  - repayLoanUsingEnv          : caller only passes borrower mnemonic
// ---------------------------------------------------------------------

async function contributeToPoolUsingEnv({ contributorMnemonic, amountAlgo }) {
    const { poolAddress } = getPoolConfig();
    return contributeToPool({ contributorMnemonic, poolAddress, amountAlgo });
}

async function borrowFromPoolUsingEnv({ borrowerMnemonic, amountAlgo }) {
    return borrowFromPool({ borrowerMnemonic, amountAlgo });
}

async function repayLoanUsingEnv({ borrowerMnemonic, amountAlgo }) {
    const { poolAddress } = getPoolConfig();
    return repayLoan({ borrowerMnemonic, poolAddress, amountAlgo });
}

// ---------------------------------------------------------------------
// Optional: fund an address via AlgoKit TestNet Dispenser (requires token).
// Set ALGOKIT_DISPENSER_ACCESS_TOKEN (e.g. from `algokit dispenser login --ci`) to enable.
// ---------------------------------------------------------------------
async function fundFromDispenserAsync(receiverAddress, amountMicroAlgos) {
    const token = (process.env.ALGOKIT_DISPENSER_ACCESS_TOKEN || '').trim();
    if (!token) return null;
    const https = require('https');
    const body = JSON.stringify({ receiver: receiverAddress, amount: amountMicroAlgos });
    return new Promise((resolve, reject) => {
        const req = https.request(
            'https://api.dispenser.algorandfoundation.tools/fund/0',
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            },
            (res) => {
                let data = '';
                res.on('data', (c) => (data += c));
                res.on('end', () => {
                    try {
                        const j = JSON.parse(data);
                        if (res.statusCode === 200) resolve(j);
                        else reject(new Error(j.message || 'Dispenser fund failed'));
                    } catch (e) { reject(e); }
                });
            }
        );
        req.on('error', reject);
        req.write(body);
        req.end();
    }).catch((err) => { console.error('  Dispenser fund error:', err.message); return null; });
}

// ---------------------------------------------------------------------
// Exports: reusable from your backend API layer
// ---------------------------------------------------------------------

async function getCurrentRound() {
    const algod = getAlgodClient();
    const status = await algod.status().do();
    return status['last-round'];
}

/**
 * Report whether on-chain mode is fully configured and (if so) what the
 * current pool balance / app id are. Used by /api/status and the frontend
 * "Algorand Status" card so we can see at a glance whether actions will
 * actually hit the chain.
 */
async function getOnChainStatus() {
    const status = {
        network: 'testnet',
        algodServer: ALGOD_CONFIG.server,
        poolConfigured: false,
        poolAddress: null,
        lendingAppId: null,
        escrowAddress: null,
        poolBalanceAlgo: null,
        escrowBalanceAlgo: null,
        lastRound: null,
        ready: false,
        error: null
    };
    try {
        const { poolAddress } = getPoolConfig();
        status.poolConfigured = true;
        status.poolAddress = poolAddress;
    } catch (e) {
        status.error = e.message;
        return status;
    }
    try {
        const appId = await getLendingAppId();
        status.lendingAppId = appId;
    } catch (e) {
        status.error = e.message;
        return status;
    }
    try {
        const algod = getAlgodClient();
        const sys = await algod.status().do();
        status.lastRound = Number(sys['last-round'] || sys.lastRound || 0);
    } catch (e) {
        status.error = `Algod node unreachable: ${e.message}`;
        return status;
    }
    try {
        const algod = getAlgodClient();
        const info = await algod.accountInformation(status.poolAddress).do();
        const micro = info.amount !== undefined ? info.amount : info['amount'];
        const n = typeof micro === 'bigint' ? Number(micro) : Number(micro || 0);
        status.poolBalanceAlgo = n / 1_000_000;
    } catch (e) {
        status.error = `Pool account not found on Testnet (probably unfunded): ${e.message}`;
    }
    try {
        const { escrowAddress } = await deployEscrowContractForApp(status.lendingAppId);
        status.escrowAddress = escrowAddress;
        const algod = getAlgodClient();
        try {
            const einfo = await algod.accountInformation(escrowAddress).do();
            const em = einfo.amount !== undefined ? einfo.amount : einfo['amount'];
            const en = typeof em === 'bigint' ? Number(em) : Number(em || 0);
            status.escrowBalanceAlgo = en / 1_000_000;
        } catch {
            status.escrowBalanceAlgo = 0;
        }
    } catch (e) {
        status.error = status.error || `Escrow compile failed: ${e.message}`;
    }
    status.ready = !status.error && status.poolBalanceAlgo !== null;
    return status;
}

/**
 * Send a small amount of ALGO from the pool wallet to a newly created
 * user wallet so it can immediately pay fees, opt into the lending app,
 * and make its first transaction. Called from /signup. Non-blocking:
 * if the pool isn't configured this returns null and logs a warning
 * instead of failing signup.
 *
 * Algorand min-balance math for a fresh user who will borrow:
 *   0.1  account min balance
 * + 0.1  opt-in to lending app
 * + 0.002 fees for the borrow atomic group (2 txns)
 * ≈ 0.21 ALGO required before any user action works.
 * We send 0.3 ALGO to leave headroom for contribute/repay fees.
 */
async function fundNewUserWallet(receiverAddress) {
    try {
        const { poolMnemonic } = getPoolConfig();
        if (!algosdk.isValidAddress(receiverAddress)) {
            throw new Error('Receiver is not a valid Algorand address.');
        }
        const result = await sendPaymentTransaction({
            senderMnemonic: poolMnemonic,
            receiverAddress,
            amountMicroAlgos: 300_000, // 0.3 ALGO
            noteText: 'CampusTrust: welcome funding'
        });
        console.log(`[signup-fund] Sent 0.3 ALGO to ${receiverAddress}: ${result.txId}`);
        return result;
    } catch (err) {
        console.warn(`[signup-fund] Could not fund ${receiverAddress}: ${err.message}`);
        return null;
    }
}

module.exports = {
    getAlgodClient,
    getPoolConfig,
    createWallet,
    accountFromMnemonic,
    buildLendingAppApprovalTeal,
    buildLendingAppClearTeal,
    buildEscrowTealSource,
    createLendingApp,
    createLendingAppUsingEnv,
    getLendingAppId,
    deployEscrowContractForApp,
    deployEscrowContractUsingEnv,
    sendPaymentTransaction,
    contributeToPool,
    borrowFromPool,
    repayLoan,
    contributeToPoolUsingEnv,
    borrowFromPoolUsingEnv,
    repayLoanUsingEnv,
    algoToMicroAlgo,
    getCurrentRound,
    getOnChainStatus,
    fundNewUserWallet,
};
