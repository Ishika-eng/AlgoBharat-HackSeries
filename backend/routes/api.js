const express = require('express');
const router = express.Router();
const Joi = require('joi');
const User = require('../models/User');
const Pool = require('../models/Pool');
const Loan = require('../models/Loan');
const algorandService = require('../services/algorandService');
const logicService = require('../services/logicService');

const isBlockchainStrict = () => process.env.BLOCKCHAIN_STRICT === 'true';

// Helper to get or create the single pool
const getPool = async () => {
    let pool = await Pool.findOne();
    if (!pool) {
        pool = new Pool({ balance: 10000 });
        await pool.save();
    }
    return pool;
};

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
    try {
        let user = await User.findOne({ email });
        if (user) return res.status(400).json({ msg: 'User already exists' });

        // Generate Algorand wallet
        const wallet = algorandService.createWallet();

        user = new User({
            name,
            email,
            password, // Plain text
            walletAddress: wallet.walletAddress,
            mnemonic: wallet.mnemonic
        });

        await user.save();

        res.json({
            _id: user._id,
            name: user.name,
            email: user.email,
            walletAddress: user.walletAddress,
            reputationScore: user.reputationScore
        });
    } catch (err) {
        console.error(err);
        res.status(500).send('Server error');
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
        console.error('Login error:', err);
        res.status(500).json({ msg: 'Server error' });
    }
});

// --- USER DATA ---

router.get('/user/:id', async (req, res) => {
    try {
        const user = await User.findById(req.params.id);
        if (!user) return res.status(404).json({ msg: 'User not found' });

        const loans = await Loan.find({ userId: user._id });
        res.json({ user, loans });
    } catch (err) {
        res.status(500).send('Server error');
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

        res.json({
            pool,
            user,
            txId: txResult?.txId || null,
            blockchain: txResult ? 'on-chain' : 'off-chain-fallback'
        });
    } catch (err) {
        console.error('Contribute error:', err);
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
        loan.txId = txResult?.txId || loan.txId;
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
            blockchain: txResult ? 'on-chain' : 'off-chain-fallback'
        });
    } catch (err) {
        console.error('Repay error:', err);
        res.status(500).json({ msg: err.message || 'Server error' });
    }
});

module.exports = router;
