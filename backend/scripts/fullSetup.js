#!/usr/bin/env node
/**
 * fullSetup.js — One-shot Algorand Testnet bootstrap for CampusTrust.
 *
 * What this does (in order):
 *  1. Generates a new pool wallet (if POOL_ADDRESS is blank in .env)
 *  2. Waits for you to fund it via the Testnet dispenser
 *  3. Deploys the lending ASC1 smart contract (if LENDING_APP_ID is blank)
 *  4. Pre-funds the escrow logic-sig account above its 0.1 ALGO min balance
 *  5. Prints the exact lines to paste into backend/.env
 *
 * Usage:
 *   cd backend
 *   node scripts/fullSetup.js
 *
 * Prerequisites:
 *   - Node.js installed
 *   - `npm install` already run in backend/
 *   - Internet access (talks to Algorand Testnet via AlgoNode)
 */

const path = require('path');
const fs = require('fs');
const readline = require('readline');

// Load .env from backend/
const envPath = path.resolve(__dirname, '../.env');
require('dotenv').config({ path: envPath });

const algosdk = require('algosdk');
const service = require('../services/algorandService');

// Helpers
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise((resolve) => rl.question(q, resolve));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function updateEnvFile(key, value) {
    let content = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf-8') : '';
    const regex = new RegExp(`^${key}=.*$`, 'm');
    const line = `${key}=${value}`;
    if (regex.test(content)) {
        content = content.replace(regex, line);
    } else {
        content = content.trimEnd() + '\n' + line + '\n';
    }
    fs.writeFileSync(envPath, content);
    process.env[key] = value;
    console.log(`   [.env] ${key} saved.`);
}

async function waitForFunding(address, label = 'account') {
    const algod = service.getAlgodClient();
    console.log(`\n   Waiting for ${label} (${address}) to be funded on Testnet...`);
    console.log(`   (Checking every 5 seconds — take your time in the browser)\n`);
    while (true) {
        try {
            const info = await algod.accountInformation(address).do();
            const micro = info.amount !== undefined ? info.amount : info['amount'];
            const algo = Number(typeof micro === 'bigint' ? micro : (micro || 0)) / 1_000_000;
            if (algo >= 1) {
                console.log(`   ${label} balance: ${algo.toFixed(3)} ALGO — funded!\n`);
                return algo;
            }
            if (algo > 0) {
                console.log(`   ${label} balance: ${algo.toFixed(3)} ALGO — need at least 1 ALGO, please dispense more.`);
            }
        } catch (e) {
            // Account doesn't exist yet on chain — not funded
        }
        await sleep(5000);
    }
}

(async () => {
    try {
        console.log('\n========================================');
        console.log('  CampusTrust — Algorand Full Setup');
        console.log('========================================\n');

        // ─── Step 1: Pool Wallet ───────────────────────────
        let poolAddress = (process.env.POOL_ADDRESS || '').trim();
        let poolMnemonic = (process.env.POOL_MNEMONIC || '').trim();

        if (poolAddress && poolMnemonic) {
            console.log('Step 1: Pool wallet already configured.');
            console.log(`   POOL_ADDRESS = ${poolAddress}`);
        } else {
            console.log('Step 1: Generating a new pool wallet...');
            const account = algosdk.generateAccount();
            const mnemonic = algosdk.secretKeyToMnemonic(account.sk);
            poolAddress = typeof account.addr === 'string' ? account.addr : account.addr.toString();
            poolMnemonic = mnemonic;

            updateEnvFile('POOL_ADDRESS', poolAddress);
            updateEnvFile('POOL_MNEMONIC', poolMnemonic);

            console.log(`\n   NEW POOL WALLET GENERATED:`);
            console.log(`   Address:  ${poolAddress}`);
            console.log(`   Mnemonic: ${poolMnemonic}`);
            console.log(`\n   IMPORTANT: The mnemonic is now in backend/.env.`);
            console.log(`   NEVER share it or commit it to git.\n`);
        }

        // ─── Step 2: Fund Pool Wallet ──────────────────────
        console.log('Step 2: Fund the pool wallet on Algorand Testnet.');
        console.log('');
        console.log('   Open this URL in your browser:');
        console.log('');
        console.log(`   https://bank.testnet.algorand.network/?account=${poolAddress}`);
        console.log('');
        console.log('   Paste the pool address if it is not pre-filled,');
        console.log('   complete the captcha, and click "Dispense".');
        console.log('   You should dispense at least 10 ALGO (click it a few times).');
        console.log('');

        await ask('   Press ENTER after you have dispensed ALGO in the browser... ');
        await waitForFunding(poolAddress, 'Pool wallet');

        // ─── Step 3: Deploy Lending ASC1 ──────────────────
        let appId = (process.env.LENDING_APP_ID || '').trim();
        if (appId && Number(appId) > 0) {
            console.log(`Step 3: Lending ASC1 already deployed.`);
            console.log(`   LENDING_APP_ID = ${appId}`);
            appId = Number(appId);
        } else {
            console.log('Step 3: Deploying the lending ASC1 smart contract...');
            console.log('   (This sends a transaction — may take ~10 seconds)');
            const app = await service.createLendingApp(poolMnemonic);
            appId = app.appId;
            console.log(`   Lending ASC1 deployed! App ID: ${appId}`);
            console.log(`   Tx ID: ${app.txId}`);
            console.log(`   Explorer: https://testnet.explorer.perawallet.app/application/${appId}`);
            updateEnvFile('LENDING_APP_ID', String(appId));
        }

        // ─── Step 4: Fund Escrow ───────────────────────────
        console.log('\nStep 4: Pre-funding the escrow logic-sig account...');
        const { escrowAddress } = await service.deployEscrowContractForApp(Number(appId));
        console.log(`   Escrow address: ${escrowAddress}`);

        // Check if escrow already has enough
        const algod = service.getAlgodClient();
        let escrowFunded = false;
        try {
            const einfo = await algod.accountInformation(escrowAddress).do();
            const em = einfo.amount !== undefined ? einfo.amount : einfo['amount'];
            const en = Number(typeof em === 'bigint' ? em : (em || 0)) / 1_000_000;
            if (en >= 0.1) {
                console.log(`   Escrow balance: ${en.toFixed(3)} ALGO — already funded.`);
                escrowFunded = true;
            }
        } catch (e) { /* not funded */ }

        if (!escrowFunded) {
            console.log('   Sending 1 ALGO from pool to escrow...');
            const fundResult = await service.sendPaymentTransaction({
                senderMnemonic: poolMnemonic,
                receiverAddress: escrowAddress,
                amountMicroAlgos: 1_000_000,
                noteText: 'CampusTrust: initial escrow funding'
            });
            console.log(`   Escrow funded! Tx: ${fundResult.txId}`);
        }

        // ─── Done ──────────────────────────────────────────
        console.log('\n========================================');
        console.log('  SETUP COMPLETE');
        console.log('========================================');
        console.log('');
        console.log('  Your backend/.env now has:');
        console.log(`    POOL_ADDRESS=${poolAddress}`);
        console.log(`    POOL_MNEMONIC=${poolMnemonic.split(' ').slice(0, 3).join(' ')}... (hidden)`);
        console.log(`    LENDING_APP_ID=${appId}`);
        console.log('');
        console.log('  Escrow address: ' + escrowAddress);
        console.log('');
        console.log('  Explorer links:');
        console.log(`    Pool:   https://testnet.explorer.perawallet.app/address/${poolAddress}`);
        console.log(`    App:    https://testnet.explorer.perawallet.app/application/${appId}`);
        console.log(`    Escrow: https://testnet.explorer.perawallet.app/address/${escrowAddress}`);
        console.log('');
        console.log('  Next steps:');
        console.log('    1. Restart backend:  cd backend && npm start');
        console.log('    2. Restart frontend: cd frontend && npm run dev');
        console.log('    3. Dashboard status card should turn GREEN');
        console.log('    4. Sign up a fresh user and test contribute → borrow → repay');
        console.log('');
        console.log('  Once everything works, flip BLOCKCHAIN_STRICT=true in .env');
        console.log('  and restart to remove the off-chain fallback for the demo.');
        console.log('');

        rl.close();
    } catch (err) {
        console.error('\nSetup failed:', err.message);
        console.error('Fix the issue above and run this script again — it resumes where it left off.');
        rl.close();
        process.exit(1);
    }
})();
