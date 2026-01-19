import React, { useState } from 'react';

const GeminiAnalytics = ({ selectedMonth }) => {
    const [analysis, setAnalysis] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    const fetchAnalysis = async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await fetch('/api/analyze', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ month: selectedMonth })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.message || 'Error fetching analysis');
            setAnalysis(data.analysis);
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="glass-panel" style={{ padding: '24px', background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.1), rgba(168, 85, 247, 0.1))', border: '1px solid rgba(168, 85, 247, 0.2)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <span style={{ fontSize: '1.5rem' }}>✨</span>
                    <h3 style={{ margin: 0, background: 'linear-gradient(to right, #818cf8, #c084fc)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>AI Аналитика</h3>
                </div>
                {!analysis && !loading && (
                    <button
                        onClick={fetchAnalysis}
                        className="btn-primary"
                        style={{ background: 'linear-gradient(135deg, #6366f1, #a855f7)', padding: '8px 16px', fontSize: '0.9rem' }}
                    >
                        Сгенерировать
                    </button>
                )}
            </div>

            {loading && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', color: 'var(--color-text-muted)' }}>
                    <span className="spinner">⌛</span>
                    Analyzing your finances...
                </div>
            )}

            {error && (
                <div style={{ color: '#f87171', fontSize: '0.9rem', padding: '10px', background: 'rgba(239, 68, 68, 0.1)', borderRadius: '8px' }}>
                    Error: {error}
                </div>
            )}

            {analysis && (
                <div style={{ animation: 'fadeIn 0.5s ease' }}>
                    <div style={{ whiteSpace: 'pre-wrap', lineHeight: '1.6', fontSize: '0.95rem', color: '#e2e8f0' }}>
                        {analysis}
                    </div>
                    <button
                        onClick={fetchAnalysis} // Refresh
                        style={{ marginTop: '16px', background: 'transparent', border: 'none', color: '#818cf8', fontSize: '0.8rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '5px' }}
                    >
                        🔄 Обновить
                    </button>
                </div>
            )}
        </div>
    );
};

export default GeminiAnalytics;
