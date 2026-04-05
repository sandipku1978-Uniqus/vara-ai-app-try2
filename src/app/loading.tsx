export default function GlobalLoading() {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      minHeight: '60vh', padding: '48px',
    }}>
      <div style={{
        width: '36px', height: '36px', border: '3px solid rgba(255,255,255,0.1)',
        borderTopColor: '#B31F7E', borderRadius: '50%',
        animation: 'spin 0.8s linear infinite',
      }} />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
