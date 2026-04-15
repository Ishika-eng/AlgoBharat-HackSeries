import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { CreditCard, ArrowLeft, ExternalLink, RefreshCw } from 'lucide-react';
import { Link } from 'react-router-dom';
import api from '../api';

const Profile = ({ user }) => {
    const [wallet, setWallet] = useState(null);
    const [loading, setLoading] = useState(false);

    const fetchBalance = async () => {
        if (!user?.walletAddress) return;
        setLoading(true);
        try {
            const res = await api.get(`/wallet/${user.walletAddress}`);
            setWallet(res.data);
        } catch (e) {
            setWallet({ algo: 0, error: 'Unable to fetch balance' });
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchBalance();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [user?.walletAddress]);

    if (!user) return null;

    return (
        <div className="min-h-screen bg-gray-50 p-8">
            <div className="max-w-3xl mx-auto">

                <div className="mb-8">
                    <Link to="/dashboard" className="flex items-center text-gray-500 hover:text-brand-600 transition">
                        <ArrowLeft className="w-5 h-5 mr-2" />
                        Back to Dashboard
                    </Link>
                </div>

                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="bg-white rounded-2xl shadow-sm overflow-hidden"
                >
                    <div className="bg-brand-600 h-32 relative">
                        <div className="absolute -bottom-12 left-8">
                            <div className="w-24 h-24 bg-white rounded-full p-1 shadow-lg">
                                <div className="w-full h-full bg-brand-100 rounded-full flex items-center justify-center text-2xl font-bold text-brand-700 uppercase">
                                    {user.name.charAt(0)}
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="pt-16 pb-8 px-8">
                        <div className="flex justify-between items-start mb-6">
                            <div>
                                <h1 className="text-2xl font-bold text-gray-900">{user.name}</h1>
                                <p className="text-gray-500">{user.email}</p>
                            </div>
                            <div className="bg-brand-50 px-4 py-2 rounded-lg border border-brand-100">
                                <span className="text-xs text-brand-600 font-bold uppercase tracking-wider">Trust Score</span>
                                <div className="text-2xl font-bold text-brand-700">{user.reputationScore}</div>
                            </div>
                        </div>

                        <div className="space-y-6">
                            {/* Wallet */}
                            <div className="p-4 bg-gray-50 rounded-xl">
                                <div className="flex items-center gap-4">
                                    <CreditCard className="text-gray-400 shrink-0" />
                                    <div className="overflow-hidden flex-1">
                                        <p className="text-sm font-medium text-gray-900">Algorand Wallet</p>
                                        <p className="text-xs text-gray-500 font-mono truncate">
                                            {user.walletAddress || 'Not generated'}
                                        </p>
                                    </div>
                                    <button
                                        onClick={fetchBalance}
                                        className="text-gray-400 hover:text-brand-600 p-1"
                                        title="Refresh balance"
                                    >
                                        <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                                    </button>
                                </div>
                                <div className="mt-4 grid grid-cols-2 gap-4">
                                    <div className="p-3 bg-white rounded-lg border border-gray-100">
                                        <p className="text-xs text-gray-500">On-chain Balance</p>
                                        <p className="text-lg font-bold text-gray-900">
                                            {wallet ? `${wallet.algo.toFixed(3)} ALGO` : '—'}
                                        </p>
                                        {wallet?.error && (
                                            <p className="text-[10px] text-amber-600 mt-1">{wallet.error}</p>
                                        )}
                                    </div>
                                    <a
                                        href={wallet?.explorerUrl || `https://testnet.explorer.perawallet.app/address/${user.walletAddress}`}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="p-3 bg-white rounded-lg border border-gray-100 hover:border-brand-300 transition flex flex-col justify-center"
                                    >
                                        <p className="text-xs text-gray-500">Network</p>
                                        <p className="text-sm font-bold text-brand-700 flex items-center gap-1">
                                            Algorand Testnet <ExternalLink className="w-3 h-3" />
                                        </p>
                                    </a>
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div className="p-4 border border-gray-100 rounded-xl">
                                    <p className="text-sm text-gray-500 mb-1">Loan Tier</p>
                                    <p className="font-semibold text-gray-900">
                                        {user.reputationScore >= 70
                                            ? 'Gold · up to 1000'
                                            : user.reputationScore >= 40
                                                ? 'Silver · up to 500'
                                                : 'Not eligible'}
                                    </p>
                                </div>
                                <div className="p-4 border border-gray-100 rounded-xl">
                                    <p className="text-sm text-gray-500 mb-1">Status</p>
                                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                                        Verified Student
                                    </span>
                                </div>
                            </div>
                        </div>
                    </div>
                </motion.div>
            </div>
        </div>
    );
};

export default Profile;
