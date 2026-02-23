import React, { useState, useEffect } from 'react';
import api from '../api';
import { useNavigate, Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { UserCircle } from 'lucide-react';

const Dashboard = ({ user, setUser }) => {
    const [pool, setPool] = useState({ balance: 0 });
    const [loans, setLoans] = useState([]);
    const [loading, setLoading] = useState(true);
    const [amount, setAmount] = useState('');
    const navigate = useNavigate();

    useEffect(() => {
        fetchData();
        // Set up polling to update data every 5 seconds
        const interval = setInterval(fetchData, 5000);
        return () => clearInterval(interval);
    }, []);

    const fetchData = async () => {
        const [poolResult, userResult] = await Promise.allSettled([
            api.get('/pool'),
            api.get(`/user/${user._id}`)
        ]);

        if (poolResult.status === 'fulfilled') {
            setPool(poolResult.value.data);
        } else {
            console.error('Pool fetch failed:', poolResult.reason);
        }

        if (userResult.status === 'fulfilled') {
            setUser(userResult.value.data.user);
            setLoans(userResult.value.data.loans);
        } else {
            console.error('User fetch failed:', userResult.reason);
        }

        setLoading(false);
    };

    const handleLogout = () => {
        localStorage.removeItem('user');
        // Force refresh to clear state and redirect
        window.location.href = '/login';
    };

    const handleContribute = async () => {
        if (!amount || amount <= 0) return toast.error('Enter a valid amount');
        try {
            await api.post('/contribute', { userId: user._id, amount });
            setAmount('');
            fetchData();
            toast.success('Contribution successful! +2 Reputation');
        } catch (err) {
            toast.error(err.response?.data?.msg || 'Error contributing');
        }
    };

    const handleBorrow = async () => {
        if (!amount || amount <= 0) return toast.error('Enter a valid amount');
        try {
            await api.post('/borrow', { userId: user._id, amount });
            setAmount('');
            fetchData();
            toast.success('Loan approved!');
        } catch (err) {
            toast.error(err.response?.data?.msg || 'Error borrowing');
        }
    };

    const handleRepay = async (loanId) => {
        try {
            await api.post('/repay', { loanId });
            fetchData();
            toast.success('Loan repaid! +10 Reputation');
        } catch (err) {
            toast.error(err.response?.data?.msg || 'Error repaying');
        }
    };

    if (loading) return <div className="min-h-screen flex items-center justify-center bg-gray-50">Loading...</div>;

    const activeLoan = loans.find(l => l.status === 'active');

    return (
        <div className="min-h-screen bg-gray-50 font-sans">
            {/* Navbar */}
            <nav className="bg-white shadow-sm sticky top-0 z-10">
                <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="flex justify-between h-16 items-center">
                        <div className="flex items-center">
                            <span className="text-2xl font-bold text-brand-600">CampusTrust</span>
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
                            <span className="ml-2 text-sm text-gray-500">points</span>
                        </div>
                        <p className="mt-1 text-xs text-gray-400">Higher score = better loan rates</p>
                    </div>

                    {/* Pool Balance Card */}
                    <div className="bg-white rounded-xl shadow-sm p-6 border-l-4 border-green-500">
                        <h3 className="text-gray-500 text-sm font-medium uppercase tracking-wide">Global Pool</h3>
                        <div className="mt-2 flex items-baseline">
                            <span className="text-4xl font-extrabold text-gray-900">₹{pool.balance}</span>
                        </div>
                        <p className="mt-1 text-xs text-gray-400">Available for students</p>
                    </div>

                    {/* Active Loan Card */}
                    <div className="bg-white rounded-xl shadow-sm p-6 border-l-4 border-orange-500">
                        <h3 className="text-gray-500 text-sm font-medium uppercase tracking-wide">Your Active Loan</h3>
                        <div className="mt-2 flex items-baseline">
                            <span className="text-4xl font-extrabold text-gray-900">
                                {activeLoan ? `₹${activeLoan.amount}` : 'None'}
                            </span>
                        </div>
                        <p className="mt-1 text-xs text-gray-400">
                            {activeLoan ? 'Repay to boost score' : 'You are debt free!'}
                        </p>
                    </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">

                    {/* Action Center */}
                    <div className="bg-white rounded-xl shadow-sm p-6">
                        <h3 className="text-lg font-bold text-gray-900 mb-4">Action Center</h3>

                        <div className="space-y-6">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-2">Amount (₹)</label>
                                <input
                                    type="number"
                                    value={amount}
                                    onChange={(e) => setAmount(e.target.value)}
                                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-500 outline-none"
                                    placeholder="Enter amount..."
                                />
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <button
                                    onClick={handleContribute}
                                    className="flex items-center justify-center px-4 py-3 border border-transparent text-sm font-medium rounded-lg text-brand-700 bg-brand-100 hover:bg-brand-200 transition"
                                >
                                    Contribute & Earn
                                </button>
                                <button
                                    onClick={handleBorrow}
                                    disabled={!!activeLoan}
                                    className={`flex items-center justify-center px-4 py-3 border border-transparent text-sm font-medium rounded-lg text-white transition ${activeLoan
                                        ? 'bg-gray-300 cursor-not-allowed'
                                        : 'bg-brand-600 hover:bg-brand-700'
                                        }`}
                                >
                                    {activeLoan ? 'Loan Active' : 'Borrow Money'}
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* Recent Activity */}
                    <div className="bg-white rounded-xl shadow-sm p-6">
                        <h3 className="text-lg font-bold text-gray-900 mb-4">Loan History</h3>
                        <div className="flow-root">
                            <ul role="list" className="-my-5 divide-y divide-gray-200">
                                {loans.length === 0 ? (
                                    <li className="py-5 text-center text-gray-500 text-sm">No history yet.</li>
                                ) : (
                                    loans.map((loan) => (
                                        <li key={loan._id} className="py-4">
                                            <div className="flex items-center space-x-4">
                                                <div className="flex-1 min-w-0">
                                                    <p className="text-sm font-medium text-gray-900 truncate">
                                                        Borrowed ₹{loan.amount}
                                                    </p>
                                                    <p className="text-xs text-gray-500 truncate">
                                                        {new Date(loan.createdAt).toLocaleDateString()}
                                                    </p>
                                                </div>
                                                <div>
                                                    {loan.status === 'active' ? (
                                                        <button
                                                            onClick={() => handleRepay(loan._id)}
                                                            className="inline-flex items-center px-2.5 py-1.5 border border-transparent text-xs font-medium rounded text-green-700 bg-green-100 hover:bg-green-200 focus:outline-none"
                                                        >
                                                            Repay Now
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
            </div>
        </div>
    );
};

export default Dashboard;
