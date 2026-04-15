// logicService.js
// Translated from loan_engine.py

const LOAN_DURATION_ROUNDS = 5000;
const MIN_REPUTATION = 0;
const MAX_REPUTATION = 1000;

/**
 * Compute the maximum loan allowed based on reputation.
 * - reputation < 40  -> 0 (borrowing disabled)
 * - 40 <= rep <= 69  -> 500
 * - rep >= 70        -> 1000
 * @param {number} reputationScore 
 * @returns {number} maxAmount
 */
const getLoanLimit = (reputationScore) => {
    if (reputationScore < 40) return 0;
    if (reputationScore <= 69) return 500;
    return 1000;
};

/**
 * Checks if a user is eligible to borrow.
 * @param {Object} user 
 * @param {number} requestedAmount 
 * @param {boolean} hasActiveLoan 
 * @param {number} poolBalance 
 * @returns {Object} { allowed: boolean, reason: string }
 */
const canBorrow = (user, requestedAmount, hasActiveLoan, poolBalance) => {
    if (requestedAmount <= 0) {
        return { allowed: false, reason: "Requested amount must be positive." };
    }

    if (user.reputationScore < 40) {
        return { allowed: false, reason: "Reputation must be at least 40 to borrow." };
    }

    const limit = getLoanLimit(user.reputationScore);
    if (requestedAmount > limit) {
        return { allowed: false, reason: `Requested amount ${requestedAmount} exceeds max allowed ${limit}.` };
    }

    if (hasActiveLoan) {
        return { allowed: false, reason: "User already has an active loan." };
    }

    if (poolBalance < requestedAmount) {
        return { allowed: false, reason: "Insufficient pool balance for this loan." };
    }

    return { allowed: true };
};

/**
 * Calculates new reputation after repayment.
 * @param {number} currentScore 
 * @param {number} currentRound 
 * @param {number} dueRound 
 * @returns {number} newScore
 */
const calculateReputationAfterRepayment = (currentScore, currentRound, dueRound) => {
    let newScore = currentScore;
    const onTime = currentRound <= dueRound;

    if (onTime) {
        newScore += 10;
    } else {
        newScore -= 15;
    }

    // Clamp
    if (newScore < MIN_REPUTATION) newScore = MIN_REPUTATION;
    if (newScore > MAX_REPUTATION) newScore = MAX_REPUTATION;

    return newScore;
};

/**
 * Calculates new reputation after contribution.
 * @param {number} currentScore 
 * @returns {number} newScore
 */
const calculateReputationAfterContribution = (currentScore) => {
    let newScore = currentScore + 5;
    if (newScore > MAX_REPUTATION) newScore = MAX_REPUTATION;
    return newScore;
};

module.exports = {
    LOAN_DURATION_ROUNDS,
    getLoanLimit,
    canBorrow,
    calculateReputationAfterRepayment,
    calculateReputationAfterContribution
};
