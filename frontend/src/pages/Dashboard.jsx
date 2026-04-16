import React, { useState, useEffect } from 'react';
import api from '../api';
import { useNavigate, Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { UserCircle, ExternalLink, ShieldCheck, AlertCircle } from 'lucide-react';

const TxBadge = ({ blockchain, explorerUrl, txId, label = 'View on Algorand' }) => {
    if (blockchain === 'on-chain' && explorerUrl) {
        return (
            <a
                href={explorerUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 transition"
                title={txId}
            >
                <ShieldCheck className="w-3 h-3" /> On-chain
                <ExternalLink className="w-3 h-3" />
            </a>
        );
    }
    return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200" title="Saved off-chain (Algorand fallback)">
            <AlertCircle className="w-3 h-3" /> Off-chain
        </span>
    );
};

const shortTx = (txId) => {
    if (!txId) return '';
    if (txId.startsWith('offchain-')) return 'off-chain';
    return `${txId.slice(0, 6)}…${txId.slice(-4)}`;
};

const Dashboard = ({ user, setUser }) => {
    const [pool, setPool] = useState({ balance: 0 });
    const [loans, setLoans] = useState([]);
    const [contributions, setContributions] = useState([]);
    const [eligibility, setEligibility] = useState(null);
    const [chainStatus, setChainStatus] = useState(null);
    const [loading, setLoading] = useState(true);
    const [amount, setAmount] = useState('');
    const navigate = useNavigate();
    const [sessionError, setSessionError] = useState(false);

    useEffect(() => {
        if (!user || !user._id) return;
        fetchData();
        const interval = setInterval(fetchData, 8000);
        return () => clearInterval(interval);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [user?._id]);

    useEffect(() => {
        if (sessionError) {
            localStorage.removeItem('user');
            setUser(null);
            navigate('/login', { replace: true });
        }
    }, [sessionError, navigate, setUser]);

    const fetchData = async () => {
        if (!user || !user._id) {
            setLoading(false);
            return;
        }

        const [poolResult, userResult, contribResult, eligResult, statusResult] = await Promise.allSettled([
            api.get('/pool'),
            api.get(`/user/${user._id}`),
            api.get('/contributions?limit=10'),
            api.get(`/eligibility/${user._id}`),
            api.get('/status')
        ]);

        if (poolResult.status === 'fulfilled') setPool(poolResult.value.data);
        if (userResult.status === 'fulfilled') {
            setUser(userResult.value.data.user);
            setLoans(userResult.value.data.loans);
        } else if (userResult.reason?.response?.status === 404) {
            setSessionError(true);
        }
        if (contribResult.status === 'fulfilled') {
            setContributions(contribResult.value.data.contributions || []);
        }
        if (eligResult.status === 'fulfilled') setEligibility(eligResult.value.data);
        if (statusResult.status === 'fulfilled') setChainStatus(statusResult.value.data);

        setLoading(false);
    };

    const handleLogout = () => {
        localStorage.removeItem('user');
        setUser(null);
        navigate('/login', { replace: true });
    };

    const showTxToast = (label, res) => {
        const url = res?.data?.explorerUrl;
        const mode = res?.data?.blockchain;
        if (mode === 'on-chain' && url) {
            toast.success(
                (t) => (
                    <span>
                        {label} ✓
                        <a
                            href={url}
                            target="_blank"
                            rel="noreferrer"
                            className="ml-2 underline text-emerald-700"
                            onClick={() => toast.dismiss(t.id)}
                        >
                            View tx
                        </a>
                    </span>
                ),
                { duration: 6000 }
            );
        } else {
            toast.success(`${label} (off-chain fallback)`);
        }
    };

    const handleContribute = async () => {
        if (!amount || amount <= 0) return toast.error('Enter a valid amount');
        const toastId = toast.loading('Submitting to Algorand…');
        try {
            const res = await api.post('/contribute', { userId: user._id, amount });
            toast.dismiss(toastId);
            setAmount('');
            fetchData();
            showTxToast('Contribution sent', res);
        } catch (err) {
            toast.dismiss(toastId);
            toast.error(err.response?.data?.msg || 'Error contributing');
        }
    };

    const handleBorrow = async () => {
        if (!amount || amount <= 0) return toast.error('Enter a valid amount');
        const toastId = toast.loading('Requesting loan on-chain…');
        try {
            const res = await api.post('/borrow', { userId: user._id, amount });
            toast.dismiss(toastId);
            setAmount('');
            fetchData();
            showTxToast('Loan approved', res);
        } catch (err) {
            toast.dismiss(toastId);
            toast.error(err.response?.data?.msg || 'Error borrowing');
        }
    };

    const handleRepay = async (loanId) => {
        const toastId = toast.loading('Sending repayment…');
        try {
            const res = await api.post('/repay', { loanId });
            toast.dismiss(toastId);
            fetchData();
            showTxToast('Loan repaid', res);
        } catch (err) {
            toast.dismiss(toastId);
            toast.error(err.response?.data?.msg || 'Error repaying');
        }
    };

    if (loading) return <div className="min-h-screen flex items-center justify-center bg-gray-50">Loading...</div>;
    if (!user) return null;

    const activeLoan = loans.find(l => l.status === 'active');
    const tier = eligibility?.tier || '—';
    const maxLoan = eligibility?.maxLoanAmount ?? 0;

    return (
        <div className="min-h-screen bg-gray-50 font-sans">
            {/* Navbar */}
            <nav className="bg-white shadow-sm sticky top-0 z-10">
                <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="flex justify-between h-16 items-center">
                        <div className="flex items-center gap-2">
                            <span className="text-2xl font-bold text-brand-600">CampusTrust</span>
                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 font-medium">
                                Algorand Testnet
                            </span>
                        </div>
                        <div className="flex items-center gap-4">
                            <Link to="/profile" className="flex items-center text-gray-500 hover:text-brand-600 transition">
                                <UserCircle className="w-5 h-5 mr-1" />
                                <span className="hidden sm:inline">Profile</span>
                            </Link>
                            <div className="h-6 w-px bg-gray-200"></div>
                            <button
                                onClick={handleLogout}
                                className="text-gray-500 hover:text-gray-700 text-sm font-medium"
                            >
                                Sign Out
                            </button>
                        </div>
                    </div>
                </div>
            </nav>

            <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">

                {/* Stats Grid */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                    {/* Trust Score Card */}
                    <div className="bg-white rounded-xl shadow-sm p-6 border-l-4 border-brand-500">
                        <h3 className="text-gray-500 text-sm font-medium uppercase tracking-wide">Trust Score</h3>
                        <div className="mt-2 flex items-baseline">
                            <span className="text-4xl font-extrabold text-gray-900">{user.reputationScore}</span>
                            <span className="ml-2 text-sm text-gray-500">/ 1000</span>
                        </div>
                        <p className="mt-1 text-xs text-gray-400">Tier: <span className="font-semibold text-brand-600">{tier}</span></p>
                        <div className="mt-3 h-1.5 w-full bg-gray-100 rounded-full overflow-hidden">
                            <div
                                className="h-full bg-brand-500 transition-all"
                                style={{ width: `${Math.min(100, (user.reputationScore / 100) * 100)}%` }}
                            />
                        </div>
                    </div>

                    {/* Pool Balance Card */}
                    <div className="bg-white rounded-xl shadow-sm p-6 border-l-4 border-green-500">
                        <h3 className="text-gray-500 text-sm font-medium uppercase tracking-wide">Community Pool</h3>
                        <div className="mt-2 flex items-baseline">
                            <span className="text-4xl font-extrabold text-gray-900">{pool.balance}</span>
                            <span className="ml-2 text-sm text-gray-500">ALGO</span>
                        </div>
                        <p className="mt-1 text-xs text-gray-400">Funded by student contributions</p>
                    </div>

                    {/* Active Loan Card */}
                    <div className="bg-white rounded-xl shadow-sm p-6 border-l-4 border-orange-500">
                        <h3 className="text-gray-500 text-sm font-medium uppercase tracking-wide">Your Active Loan</h3>
                        <div className="mt-2 flex items-baseline">
                            <span className="text-4xl font-extrabold text-gray-900">
                                {activeLoan ? `${activeLoan.amount}` : '—'}
                            </span>
                            {activeLoan && <span className="ml-2 text-sm text-gray-500">ALGO</span>}
                        </div>
                        <p className="mt-1 text-xs text-gray-400">
                            {activeLoan ? 'Repay on time for +10 reputation' : 'You are debt free'}
                        </p>
                    </div>
                </div>

                {/* Algorand Status Card */}
                {chainStatus && (
                    <div className={`mb-6 rounded-xl border p-4 ${chainStatus.ready
                        ? 'bg-emerald-50 border-emerald-200'
                        : 'bg-amber-50 border-amber-200'}`}>
                        <div className="flex items-start justify-between gap-4 flex-wrap">
                            <div className="min-w-0">
                                <div className="flex items-center gap-2 mb-1">
                                    <span className={`w-2 h-2 rounded-full ${chainStatus.ready ? 'bg-emerald-500' : 'bg-amber-500'}`} />
                                    <h3 className={`text-sm font-bold ${chainStatus.ready ? 'text-emerald-900' : 'text-amber-900'}`}>
                                        {chainStatus.ready ? 'Algorand Testnet — Live' : 'Algorand — Fallback mode'}
                                    </h3>
                                </div>
                                <p className={`text-xs ${chainStatus.ready ? 'text-emerald-800' : 'text-amber-800'}`}>
                                    {chainStatus.ready
                                        ? <>App ID <span className="font-mono font-semibold">{chainStatus.lendingAppId}</span> · Pool balance on chain <span className="font-semibold">{chainStatus.poolBalanceAlgo?.toFixed(3)} ALGO</span> · Escrow <span className="font-semibold">{chainStatus.escrowBalanceAlgo?.toFixed(3)} ALGO</span> · Round {chainStatus.lastRound}</>
                                        : <>Actions will save off-chain until configuration is fixed. {chainStatus.error}</>}
                                </p>
                            </div>
                            <div className="flex items-center gap-2">
                                {chainStatus.appExplorerUrl && (
                                    <a href={chainStatus.appExplorerUrl} target="_blank" rel="noreferrer"
                                        className="inline-flex items-center gap-1 text-xs font-medium text-emerald-800 bg-white border border-emerald-200 rounded-md px-2 py-1 hover:bg-emerald-100">
                                        ASC1 <ExternalLink className="w-3 h-3" />
                                    </a>
                                )}
                                {chainStatus.poolExplorerUrl && (
                                    <a href={chainStatus.poolExplorerUrl} target="_blank" rel="noreferrer"
                                        className="inline-flex items-center gap-1 text-xs font-medium text-emerald-800 bg-white border border-emerald-200 rounded-md px-2 py-1 hover:bg-emerald-100">
                                        Pool <ExternalLink className="w-3 h-3" />
                                    </a>
                                )}
                                {chainStatus.escrowExplorerUrl && (
                                    <a href={chainStatus.escrowExplorerUrl} target="_blank" rel="noreferrer"
                                        className="inline-flex items-center gap-1 text-xs font-medium text-emerald-800 bg-white border border-emerald-200 rounded-md px-2 py-1 hover:bg-emerald-100">
                                        Escrow <ExternalLink className="w-3 h-3" />
                                    </a>
                                )}
                            </div>
                        </div>
                    </div>
                )}

                {/* Eligibility Banner */}
                {eligibility && (
                    <div className="mb-8 bg-gradient-to-r from-brand-50 to-white border border-brand-100 rounded-xl p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                        <div>
                            <p className="text-sm font-semibold text-brand-700">
                                {eligibility.eligible
                                    ? `You can borrow up to ${maxLoan} ALGO`
                                    : eligibility.hasActiveLoan
                                        ? 'Repay your active loan to borrow again'
                                        : maxLoan === 0
                                            ? 'Reach reputation ≥ 40 to unlock microcredit'
                                            : 'Pool is currently empty — contribute to unlock loans'}
                            </p>
                            <p className="text-xs text-gray-500 mt-1">
                                Rules: +5 for contributing · +10 on-time repay · −15 late repay
                            </p>
                        </div>
                        <div className="text-xs text-gray-500">
                            Pool liquidity: <span className="font-semibold text-gray-900">{eligibility.poolBalance} ALGO</span>
                        </div>
                    </div>
                )}

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">

                    {/* Action Center */}
                    <div className="bg-white rounded-xl shadow-sm p-6">
                        <h3 className="text-lg font-bold text-gray-900 mb-1">Action Center</h3>
                        <p className="text-xs text-gray-500 mb-4">All actions settle on Algorand Testnet</p>

                        <div className="space-y-6">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-2">Amount (ALGO)</label>
                                <input
                                    type="number"
                                    min="0"
                                    value={amount}
                                    onChange={(e) => setAmount(e.target.value)}
                                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-500 outline-none"
                                    placeholder="e.g. 0.05"
                                    step="0.01"
                                />
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <button
                                    onClick={handleContribute}
                                    className="flex items-center justify-center px-4 py-3 border border-transparent text-sm font-medium rounded-lg text-brand-700 bg-brand-100 hover:bg-brand-200 transition"
                                >
                                    Contribute +5 Rep
                                </button>
                                <button
                                    onClick={handleBorrow}
                                    disabled={!!activeLoan || !eligibility?.eligible}
                                    className={`flex items-center justify-center px-4 py-3 border border-transparent text-sm font-medium rounded-lg text-white transition ${(!!activeLoan || !eligibility?.eligible)
                                        ? 'bg-gray-300 cursor-not-allowed'
                                        : 'bg-brand-600 hover:bg-brand-700'
                                        }`}
                                >
                                    {activeLoan ? 'Loan Active' : 'Borrow'}
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* Your Loan History */}
                    <div className="bg-white rounded-xl shadow-sm p-6">
                        <h3 className="text-lg font-bold text-gray-900 mb-4">Your Loan History</h3>
                        <div className="flow-root">
                            <ul role="list" className="-my-5 divide-y divide-gray-200">
                                {loans.length === 0 ? (
                                    <li className="py-5 text-center text-gray-500 text-sm">No loans yet.</li>
                                ) : (
                                    loans.map((loan) => (
                                        <li key={loan._id} className="py-4">
                                            <div className="flex items-center justify-between gap-3">
                                                <div className="flex-1 min-w-0">
                                                    <p className="text-sm font-medium text-gray-900 truncate">
                                                        Borrowed {loan.amount} ALGO
                                                    </p>
                                                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                                                        <span className="text-xs text-gray-500">
                                                            {new Date(loan.createdAt).toLocaleDateString()}
                                                        </span>
                                                        <TxBadge
                                                            blockchain={loan.blockchain}
                                                            explorerUrl={loan.explorerUrl}
                                                            txId={loan.txId}
                                                        />
                                                        {loan.txId && (
                                                            <span className="text-[10px] font-mono text-gray-400">
                                                                {shortTx(loan.txId)}
                                                            </span>
                                                        )}
                                                    </div>
                                                </div>
                                                <div>
                                                    {loan.status === 'active' ? (
                                                        <button
                                                            onClick={() => handleRepay(loan._id)}
                                                            className="inline-flex items-center px-2.5 py-1.5 border border-transparent text-xs font-medium rounded text-green-700 bg-green-100 hover:bg-green-200 focus:outline-none"
                                                        >
                                                            Repay
                                                        </button>
                                                    ) : (
                                                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800">
                                                            Repaid
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                        </li>
                                    ))
                                )}
                            </ul>
                        </div>
                    </div>
                </div>

                {/* Community Fund Activity */}
                <div className="mt-8 bg-white rounded-xl shadow-sm p-6">
                    <div className="flex items-center justify-between mb-4">
                        <div>
                            <h3 className="text-lg font-bold text-gray-900">Community Fund Activity</h3>
                            <p className="text-xs text-gray-500">Latest contributions to the shared microcredit pool</p>
                        </div>
                        <span className="text-xs text-gray-400">{contributions.length} recent</span>
                    </div>
                    {contributions.length === 0 ? (
                        <p className="text-sm text-gray-500 text-center py-6">
                            No contributions yet. Be the first to fund the pool.
                        </p>
                    ) : (
                        <ul className="divide-y divide-gray-100">
                            {contributions.map((c) => (
                                <li key={c._id} className="py-3 flex items-center justify-between gap-3">
                                    <div className="min-w-0">
                                        <p className="text-sm font-medium text-gray-900 truncate">
                                            {c.contributor?.name || 'Anonymous'} contributed {c.amount} ALGO
                                        </p>
                                        <p className="text-xs text-gray-500 font-mono truncate">
                                            {c.contributor?.walletAddress
                                                ? `${c.contributor.walletAddress.slice(0, 8)}…${c.contributor.walletAddress.slice(-6)}`
                                                : ''}
                                            {' · '}
                                            {new Date(c.createdAt).toLocaleString()}
                                        </p>
                                    </div>
                                    <TxBadge blockchain={c.blockchain} explorerUrl={c.explorerUrl} txId={c.txId} />
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            </div>
        </div>
    );
};

export default Dashboard;
