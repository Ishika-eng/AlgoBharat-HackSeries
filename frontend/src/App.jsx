import { HashRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import Landing from './pages/Landing';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Profile from './pages/Profile';
import { useState, useEffect } from 'react';

function App() {
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const storedUser = localStorage.getItem('user');
        if (storedUser) {
            setUser(JSON.parse(storedUser));
        }
        setLoading(false);
    }, []);

    if (loading) return null;

    return (
        <Router>
            <Toaster position="top-center" toastOptions={{ duration: 3000 }} />
            <Routes>
                <Route path="/" element={user ? <Navigate to="/dashboard" /> : <Landing />} />
                <Route path="/login" element={user ? <Navigate to="/dashboard" /> : <Login setUser={setUser} />} />
                <Route
                    path="/dashboard"
                    element={user ? <Dashboard user={user} setUser={setUser} /> : <Navigate to="/login" />}
                />
                <Route
                    path="/profile"
                    element={user ? <Profile user={user} /> : <Navigate to="/login" />}
                />
                <Route path="*" element={<Navigate to={user ? '/dashboard' : '/login'} replace />} />
            </Routes>
        </Router>
    );
}

export default App;
