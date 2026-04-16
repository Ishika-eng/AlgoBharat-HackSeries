const express = require('express');
const router = express.Router();
const Joi = require('joi');
const User = require('../models/User');
const Pool = require('../models/Pool');
const Loan = require('../models/Loan');
const Contribution = require('../models/Contribution');
const algorandService = require('../services/algorandService');
const logicService = require('../services/logicService');

const isBlockchainStrict = () => process.env.BLOCKCHAIN_STRICT === 'true';

// Build a Pera Testnet explorer URL for a txId (null-safe)
const explorerTxUrl = (txId) =>
    txId && !String(txId).startsWith('offchain-')
        ? `https://testnet.explorer.perawallet.app/tx/${txId}`
        : null;

const explorerAddressUrl = (address) =>
    address ? `https://testnet.explorer.perawallet.app/address/${address}` : null;

// Helper to get or create the single pool
const getPool = async () => {
    let pool = await Pool.findOne();
    if (!pool) {
        pool = new Pool({ balance: 10000 });
        await pool.save();
    }
    return pool;
};
// --- HEALTH CHECK ---
router.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date() });
});

// --- ALGORAND ON-CHAIN STATUS ---
// Tells the frontend (and you) whether pool wallet, app id, and algod
// are all healthy. Used by the Dashboard "Algorand Status" card.
router.get('/status', async (req, res) => {
    try {
        const onchain = await algorandService.getOnChainStatus();
        res.json({
            ...onchain,
            poolExplorerUrl: onchain.poolAddress ? explorerAddressUrl(onchain.poolAddress) : null,
            escrowExplorerUrl: onchain.escrowAddress ? explorerAddressUrl(onchain.escrowAddress) : null,
            appExplorerUrl: onchain.lendingAppId
                ? `https://testnet.explorer.perawallet.app/application/${onchain.lendingAppId}`
                : null,
            strictMode: process.env.BLOCKCHAIN_STRICT === 'true'
        });
    } catch (err) {
        res.status(500).json({ ready: false, error: err.message });
    }
});

// --- AUTH ---

router.post('/signup', async (req, res) => {
    const schema = Joi.object({
        name: Joi.string().min(3).required(),
        email: Joi.string().email().required(),
        password: Joi.string().min(6).required(),
    });

    const { error } = schema.validate(req.body);
    if (error) return res.status(400).json({ msg: error.details[0].message });

    const { name, email, password } = req.body;
    console.log(`Signup attempt for: ${email}`);
    try {
        let user = await User.findOne({ email });
        if (user) {
            console.log(`Signup failed: User ${email} already exists`);
            return res.status(400).json({ msg: 'User already exists' });
        }

        console.log("Generating wallet...");
        // Generate Algorand wallet
        const wallet = algorandService.createWallet();
        console.log(`Wallet generated: ${wallet.walletAddress}`);

        user = new User({
            name,
            email,
            password, // Plain text
            walletAddress: wallet.walletAddress,
            mnemonic: wallet.mnemonic
        });

        await user.save();
        console.log(`User saved successfully: ${user.email}`);

        // Auto-fund the new wallet from the pool so the user can immediately
        // pay tx fees + opt into the lending ASC1. Non-blocking: if the pool
        // isn't configured we log a warning but still return success, and
        // the user will just see off-chain fallback for their actions.
        let fundingTxId = null;
        try {
            const fundResult = await algorandService.fundNewUserWallet(user.walletAddress);
            fundingTxId = fundResult?.txId || null;
        } catch (fundErr) {
            console.warn('Signup funding failed (non-fatal):', fundErr.message);
        }

        res.json({
            _id: user._id,
            name: user.name,
            email: user.email,
            walletAddress: user.walletAddress,
            reputationScore: user.reputationScore,
            fundingTxId,
            fundingExplorerUrl: explorerTxUrl(fundingTxId)
        });
    } catch (err) {
        console.error("Signup Error:", err);
        res.status(500).json({ msg: 'Server error: ' + err.message });
    }
});

router.post('/login', async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) {
        return res.status(400).json({ msg: 'Email and password are required' });
    }

    try {
        const user = await User.findOne({ email });
        if (!user) return res.status(400).json({ msg: 'Invalid credentials' });

        if (user.password === password) {
            res.json({
                _id: user._id,
                name: user.name,
                email: user.email,
                walletAddress: user.walletAddress,
                reputationScore: user.reputationScore
            });
        } else {
            res.status(400).json({ msg: 'Invalid credentials' });
        }
    } catch (err) {
        console.error("Login Error:", err);
        res.status(500).json({ msg: 'Server error: ' + err.message });
    }
});

// --- USER DATA ---

router.get('/user/:id', async (req, res) => {
    try {
        const user = await User.findById(req.params.id);
        if (!user) return res.status(404).json({ msg: 'User not found' });

        const loans = await Loan.find({ userId: user._id }).sort({ createdAt: -1 });
        // Attach explorer URLs so frontend can render links directly
        const loansWithLinks = loans.map((l) => ({
            ...l.toObject(),
            explorerUrl: explorerTxUrl(l.txId),
            repayExplorerUrl: explorerTxUrl(l.repayTxId)
        }));
        const userObj = user.toObject();
        delete userObj.mnemonic;
        delete userObj.password;
        res.json({
            user: {
                ...userObj,
                walletExplorerUrl: explorerAddressUrl(user.walletAddress)
            },
            loans: loansWithLinks
        });
    } catch (err) {
        console.error('GET /user/:id error:', err);
        res.status(500).send('Server error');
    }
});

// --- ELIGIBILITY PREVIEW ---
router.get('/eligibility/:userId', async (req, res) => {
    try {
        const user = await User.findById(req.params.userId);
        if (!user) return res.status(404).json({ msg: 'User not found' });

        const activeLoan = await Loan.findOne({ userId: user._id, status: 'active' });
        const pool = await getPool();
        const maxLimit = logicService.getLoanLimit(user.reputationScore);

        let tier = 'None';
        if (user.reputationScore >= 70) tier = 'Gold (max 5 ALGO)';
        else if (user.reputationScore >= 40) tier = 'Silver (max 2 ALGO)';
        else tier = 'Ineligible (<40)';

        res.json({
            reputationScore: user.reputationScore,
            tier,
            maxLoanAmount: maxLimit,
            hasActiveLoan: !!activeLoan,
            poolBalance: pool.balance,
            eligible: !activeLoan && maxLimit > 0 && pool.balance > 0,
            rules: {
                minReputation: 40,
                silverTier: '40–69 → max 2 ALGO',
                goldTier: '≥70 → max 5 ALGO',
                onTimeRepayBonus: '+10 reputation',
                lateRepayPenalty: '−15 reputation',
                contributionBonus: '+5 reputation'
            }
        });
    } catch (err) {
        console.error('Eligibility error:', err);
        res.status(500).json({ msg: 'Server error' });
    }
});

// --- LIVE WALLET BALANCE (Algorand Testnet) ---
router.get('/wallet/:address', async (req, res) => {
    try {
        const { address } = req.params;
        const algod = algorandService.getAlgodClient();
        const info = await algod.accountInformation(address).do();
        const microAlgos = info.amount !== undefined ? info.amount : info['amount'];
        const amount = typeof microAlgos === 'bigint' ? Number(microAlgos) : Number(microAlgos || 0);
        res.json({
            address,
            microAlgos: amount,
            algo: amount / 1_000_000,
            explorerUrl: explorerAddressUrl(address),
            network: 'testnet'
        });
    } catch (err) {
        console.error('Wallet balance error:', err.message);
        res.status(200).json({
            address: req.params.address,
            microAlgos: 0,
            algo: 0,
            explorerUrl: explorerAddressUrl(req.params.address),
            network: 'testnet',
            error: 'Account not found or unfunded on Testnet'
        });
    }
});

// --- COMMUNITY FUND ACTIVITY ---
router.get('/contributions', async (req, res) => {
    try {
        const limit = Math.min(Number(req.query.limit) || 20, 100);
        const contributions = await Contribution.find()
            .populate('userId', 'name walletAddress')
            .sort({ createdAt: -1 })
            .limit(limit);
        const activity = contributions.map((c) => ({
            _id: c._id,
            amount: c.amount,
            txId: c.txId,
            explorerUrl: explorerTxUrl(c.txId),
            blockchain: c.blockchain,
            createdAt: c.createdAt,
            contributor: c.userId
                ? { name: c.userId.name, walletAddress: c.userId.walletAddress }
                : null
        }));
        res.json({ contributions: activity });
    } catch (err) {
        console.error('Contributions fetch error:', err);
        res.status(500).json({ msg: 'Server error' });
    }
});

// --- POOL & LOANS ---

router.get('/pool', async (req, res) => {
    try {
        const pool = await getPool();
        res.json(pool);
    } catch (err) {
        res.status(500).send('Server error');
    }
});

router.post('/contribute', async (req, res) => {
    const { userId, amount } = req.body;

    if (!amount || amount <= 0) {
        return res.status(400).json({ msg: 'Amount must be positive' });
    }

    try {
        const user = await User.findById(userId);
        if (!user) return res.status(404).json({ msg: 'User not found' });

        const pool = await getPool();

        let txResult = null;
        try {
            txResult = await algorandService.contributeToPoolUsingEnv({
                contributorMnemonic: user.mnemonic,
                amountAlgo: amount
            });
        } catch (chainErr) {
            if (isBlockchainStrict()) {
                throw chainErr;
            }
            console.warn('Contribute fallback (off-chain mode):', chainErr.message);
        }

        // DB Updates
        pool.balance += Number(amount);
        await pool.save();

        user.reputationScore = logicService.calculateReputationAfterContribution(user.reputationScore);
        await user.save();

        const blockchain = txResult ? 'on-chain' : 'off-chain-fallback';
        const txId = txResult?.txId || `offchain-${Date.now()}`;

        const contribution = new Contribution({
            userId,
            amount: Number(amount),
            txId,
            blockchain
        });
        await contribution.save();

        res.json({
            pool,
            user,
            contribution,
            txId: txResult?.txId || null,
            explorerUrl: explorerTxUrl(txResult?.txId),
            blockchain
        });
    } catch (err) {
        console.error("Contribute Error:", err);
        res.status(500).json({ msg: err.message || 'Server error' });
    }
});

router.post('/borrow', async (req, res) => {
    const { userId, amount } = req.body;

    if (!amount || amount <= 0) {
        return res.status(400).json({ msg: 'Amount must be positive' });
    }

    try {
        // Logic Layer check
        const user = await User.findById(userId);
        if (!user) return res.status(404).json({ msg: 'User not found' });

        const pool = await getPool();
        const activeLoan = await Loan.findOne({ userId, status: 'active' });

        const eligibility = logicService.canBorrow(
            user,
            Number(amount),
            !!activeLoan,
            pool.balance
        );

        if (!eligibility.allowed) {
            return res.status(400).json({ msg: eligibility.reason });
        }

        let txResult = null;
        try {
            txResult = await algorandService.borrowFromPoolUsingEnv({
                borrowerMnemonic: user.mnemonic,
                amountAlgo: amount
            });
        } catch (chainErr) {
            if (isBlockchainStrict()) {
                throw chainErr;
            }
            console.warn('Borrow fallback (off-chain mode):', chainErr.message);
        }

        let currentRound = 0;
        try {
            const currentRoundRaw = await algorandService.getCurrentRound();
            const parsedRound = Number(currentRoundRaw);
            if (!Number.isFinite(parsedRound)) {
                throw new Error('Invalid round value from Algorand node');
            }
            currentRound = parsedRound;
        } catch (roundErr) {
            if (isBlockchainStrict()) {
                throw roundErr;
            }
            console.warn('Borrow round fallback (off-chain mode):', roundErr.message);
            currentRound = 0;
        }

        const loan = new Loan({
            userId,
            amount: Number(amount),
            txId: txResult?.txId || `offchain-${Date.now()}`,
            blockchain: txResult ? 'on-chain' : 'off-chain-fallback',
            status: 'active',
            dueRound: currentRound + logicService.LOAN_DURATION_ROUNDS
        });
        await loan.save();

        pool.balance -= Number(amount);
        await pool.save();

        res.json({
            pool,
            loan,
            txId: txResult?.txId || null,
            explorerUrl: explorerTxUrl(txResult?.txId),
            blockchain: txResult ? 'on-chain' : 'off-chain-fallback'
        });
    } catch (err) {
        console.error('Borrow error:', err);
        res.status(500).json({ msg: err.message || 'Server error' });
    }
});

router.post('/repay', async (req, res) => {
    const { loanId } = req.body;
    try {
        const loan = await Loan.findById(loanId);
        if (!loan) return res.status(404).json({ msg: 'Loan not found' });
        if (loan.status === 'repaid') return res.status(400).json({ msg: 'Loan already repaid' });

        const user = await User.findById(loan.userId);
        if (!user) return res.status(404).json({ msg: 'User not found' });

        let txResult = null;
        try {
            txResult = await algorandService.repayLoanUsingEnv({
                borrowerMnemonic: user.mnemonic,
                amountAlgo: loan.amount
            });
        } catch (chainErr) {
            if (isBlockchainStrict()) {
                throw chainErr;
            }
            console.warn('Repay fallback (off-chain mode):', chainErr.message);
        }

        // DB Updates
        const pool = await getPool();
        pool.balance += loan.amount;
        await pool.save();

        loan.status = 'repaid';
        loan.repayTxId = txResult?.txId || `offchain-${Date.now()}`;
        if (txResult) loan.blockchain = 'on-chain';
        await loan.save();

        // Increase reputation
        let currentRound = 0;
        try {
            const currentRoundRaw = await algorandService.getCurrentRound();
            const parsedRound = Number(currentRoundRaw);
            if (!Number.isFinite(parsedRound)) {
                throw new Error('Invalid round value from Algorand node');
            }
            currentRound = parsedRound;
        } catch (roundErr) {
            if (isBlockchainStrict()) {
                throw roundErr;
            }
            console.warn('Repay round fallback (off-chain mode):', roundErr.message);
            currentRound = 0;
        }
        user.reputationScore = logicService.calculateReputationAfterRepayment(
            user.reputationScore,
            currentRound,
            loan.dueRound || currentRound // Fallback if dueRound is 0/missing
        );
        await user.save();

        res.json({
            pool,
            loan,
            user,
            txId: txResult?.txId || null,
            explorerUrl: explorerTxUrl(txResult?.txId),
            blockchain: txResult ? 'on-chain' : 'off-chain-fallback'
        });
    } catch (err) {
        console.error('Repay error:', err);
        res.status(500).json({ msg: err.message || 'Server error' });
    }
});

module.exports = router;
