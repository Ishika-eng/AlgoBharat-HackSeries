import React, { useState } from 'react';
import api from '../api';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';

const Login = ({ setUser }) => {
    const [isLogin, setIsLogin] = useState(true);
    const [name, setName] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const navigate = useNavigate();

    const handleSubmit = async (e) => {
        e.preventDefault();
        const toastId = toast.loading(isLogin ? 'Signing in...' : 'Creating account...');

        try {
            let res;
            if (isLogin) {
                console.log("Attempting Login to:", api.defaults.baseURL + '/login');
                res = await api.post('/login', { email, password });
            } else {
                console.log("Attempting Signup to:", api.defaults.baseURL + '/signup', { name, email });
                res = await api.post('/signup', { name, email, password });
            }
            console.log("Response received:", res.data);

            setUser(res.data);
            localStorage.setItem('user', JSON.stringify(res.data));

            toast.success(isLogin ? 'Welcome back!' : 'Account created!', { id: toastId });
            navigate('/dashboard');
        } catch (err) {
            const errorMessage =
                err.response?.data?.msg ||
                err.response?.data ||
                (err.response?.status ? `Request failed (${err.response.status})` : err.message) ||
                'An error occurred';
            toast.error(errorMessage, { id: toastId });
        }
    };

    return (
        <div className="min-h-screen bg-[#f0f9ff] flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden">
                <div className="bg-brand-600 p-8 text-white text-center">
                    <h1 className="text-3xl font-bold mb-2">CampusTrust</h1>
                    <p className="opacity-90">Building financial reputation, together.</p>
                </div>

                <div className="p-8">
                    <h2 className="text-2xl font-semibold text-gray-800 mb-6 text-center">
                        {isLogin ? 'Welcome Back' : 'Create Account'}
                    </h2>

                    <form onSubmit={handleSubmit} className="space-y-4">
                        {!isLogin && (
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Full Name</label>
                                <input
                                    type="text"
                                    required
                                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-transparent outline-none transition"
                                    placeholder="Jane Doe"
                                    value={name}
                                    onChange={(e) => setName(e.target.value)}
                                />
                            </div>
                        )}

                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Email Address</label>
                            <input
                                type="email"
                                required
                                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-transparent outline-none transition"
                                placeholder="jane@college.edu"
                                value={email}
                                onChange={(e) => setEmail(e.target.value.trim())}
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
                            <input
                                type="password"
                                required
                                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-transparent outline-none transition"
                                placeholder="••••••••"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                            />
                        </div>

                        <button
                            type="submit"
                            className="w-full bg-brand-600 hover:bg-brand-700 text-white font-semibold py-3 rounded-lg transition duration-200 mt-6 shadow-md hover:shadow-lg"
                        >
                            {isLogin ? 'Sign In' : 'Join CampusTrust'}
                        </button>
                    </form>

                    <div className="mt-6 text-center text-sm text-gray-600">
                        {isLogin ? "Don't have an account? " : "Already have an account? "}
                        <button
                            onClick={() => setIsLogin(!isLogin)}
                            className="text-brand-600 font-semibold hover:underline"
                        >
                            {isLogin ? 'Sign Up' : 'Log In'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default Login;
