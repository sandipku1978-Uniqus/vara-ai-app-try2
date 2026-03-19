import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Shield, Zap, TrendingUp, Building2, Monitor, MonitorOff } from 'lucide-react';
import * as THREE from 'three';
import './LandingPage.css';

/* ------------------------------------------------------------------ */
/*  Three.js Glass V Component                                         */
/* ------------------------------------------------------------------ */
function GlassVScene({ enabled }: { enabled: boolean }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<{
    renderer: THREE.WebGLRenderer;
    animId: number;
    dispose: () => void;
  } | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !enabled) return;

    // Scene — darker background for contrast
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#020202');

    const camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.1, 100);
    // Pull camera back and offset slightly right so V sits in left 2/3
    camera.position.set(2.5, 0, 18);
    camera.lookAt(0, 0, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.7;
    container.appendChild(renderer.domElement);

    // Environment map for realistic reflections (procedural)
    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    const envScene = new THREE.Scene();
    // Create a gradient environment
    const envColors = [0x000a1a, 0x001833, 0x002244, 0x111833, 0x1a2244, 0x0a0a1e];
    envColors.forEach((color, i) => {
      const light = new THREE.PointLight(color, 4, 50);
      const angle = (i / envColors.length) * Math.PI * 2;
      light.position.set(Math.cos(angle) * 10, Math.sin(angle * 0.7) * 8, Math.sin(angle) * 10);
      envScene.add(light);
    });
    envScene.add(new THREE.AmbientLight(0x111122, 1));
    const envMap = pmremGenerator.fromScene(envScene, 0.04).texture;
    scene.environment = envMap;

    // V Shape — sized to match reference
    const vShape = new THREE.Shape();
    vShape.moveTo(-2.8, 3.6);
    vShape.lineTo(-1.1, 3.6);
    vShape.lineTo(0.0, -0.9);
    vShape.lineTo(1.1, 3.6);
    vShape.lineTo(2.8, 3.6);
    vShape.lineTo(0.55, -3.6);
    vShape.lineTo(-0.55, -3.6);
    vShape.lineTo(-2.8, 3.6);

    const geometry = new THREE.ExtrudeGeometry(vShape, {
      depth: 1.2,
      bevelEnabled: true,
      bevelThickness: 0.5,
      bevelSize: 0.35,
      bevelSegments: 5,
    });
    geometry.center();

    // Physical glass material — darker, more contrast
    const glassMaterial = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      metalness: 0.05,
      roughness: 0.05,
      transmission: 0.99,
      ior: 2.0,
      thickness: 2.5,
      clearcoat: 1.0,
      clearcoatRoughness: 0.1,
      envMapIntensity: 1.0,
      specularIntensity: 1.0,
      specularColor: new THREE.Color(0x6688cc),
      attenuationColor: new THREE.Color(0x8899bb),
      attenuationDistance: 5.0,
      side: THREE.DoubleSide,
    });

    const vMesh = new THREE.Mesh(geometry, glassMaterial);
    vMesh.position.x = -2.0; // offset left for 2/3 split
    scene.add(vMesh);

    // Lighting — subtle, matching reference darkness
    const ambient = new THREE.AmbientLight(0xffffff, 0.3);
    scene.add(ambient);

    const keyLight = new THREE.DirectionalLight(0xffffff, 2.5);
    keyLight.position.set(5, 5, 8);
    scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0x4466aa, 1.5);
    fillLight.position.set(-6, -3, 6);
    scene.add(fillLight);

    const rimLight = new THREE.PointLight(0xff44aa, 2.0, 25);
    rimLight.position.set(3, -4, 3);
    scene.add(rimLight);

    const topLight = new THREE.PointLight(0x33cc88, 1.5, 25);
    topLight.position.set(-3, 5, 4);
    scene.add(topLight);

    // Background orbs — moderate size, positioned around the V
    const orbData = [
      { color: 0xeeeeee, size: 1.6, pos: [-5, 1.5, -6] },
      { color: 0x00ddbb, size: 1.4, pos: [1, 3, -7] },
      { color: 0x8844dd, size: 1.2, pos: [-1, -3.5, -6] },
      { color: 0xee5599, size: 1.5, pos: [4, -1, -5] },
      { color: 0xddaa33, size: 1.0, pos: [-4, -2, -8] },
    ];
    const orbs: THREE.Mesh[] = [];
    orbData.forEach(d => {
      const geo = new THREE.SphereGeometry(d.size, 32, 32);
      const mat = new THREE.MeshBasicMaterial({ color: d.color });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(d.pos[0], d.pos[1], d.pos[2]);
      scene.add(mesh);
      orbs.push(mesh);
    });

    // Animation
    const clock = new THREE.Clock();
    let animId = 0;
    function animate() {
      animId = requestAnimationFrame(animate);
      const t = clock.getElapsedTime();

      // Slow, dramatic rotation
      vMesh.rotation.y = Math.sin(t * 0.4) * 0.35;
      vMesh.rotation.x = Math.sin(t * 0.25) * 0.12;
      vMesh.rotation.z = Math.sin(t * 0.15) * 0.05;
      vMesh.position.y = Math.sin(t * 1.2) * 0.25;

      // Animate orbs for dynamic refraction
      orbs.forEach((orb, i) => {
        const speed = 0.3 + i * 0.12;
        const phase = i * 1.2;
        orb.position.x = orbData[i].pos[0] + Math.sin(t * speed + phase) * 2.5;
        orb.position.y = orbData[i].pos[1] + Math.cos(t * speed * 0.8 + phase) * 1.5;
      });

      // Animate rim light for prismatic edge flashes
      rimLight.position.x = Math.sin(t * 0.6) * 5;
      topLight.position.y = 3 + Math.sin(t * 0.8) * 3;

      renderer.render(scene, camera);
    }
    animate();

    const handleResize = () => {
      if (!container) return;
      camera.aspect = container.clientWidth / container.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(container.clientWidth, container.clientHeight);
    };
    window.addEventListener('resize', handleResize);

    sceneRef.current = {
      renderer,
      animId,
      dispose: () => {
        cancelAnimationFrame(animId);
        window.removeEventListener('resize', handleResize);
        pmremGenerator.dispose();
        envMap.dispose();
        renderer.dispose();
        if (container.contains(renderer.domElement)) container.removeChild(renderer.domElement);
      },
    };

    return () => {
      sceneRef.current?.dispose();
      sceneRef.current = null;
    };
  }, [enabled]);

  // Cleanup when disabled
  useEffect(() => {
    if (!enabled && sceneRef.current) {
      sceneRef.current.dispose();
      sceneRef.current = null;
    }
  }, [enabled]);

  return <div ref={containerRef} style={{ position: 'absolute', inset: 0, zIndex: 0 }} />;
}

/* ------------------------------------------------------------------ */
/*  Static fallback for when 3D is disabled                            */
/* ------------------------------------------------------------------ */
function StaticVFallback() {
  return (
    <div style={{
      position: 'absolute', inset: 0, zIndex: 0,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: '#080e1a',
    }}>
      {/* Large gradient V as static background */}
      <svg width="420" height="420" viewBox="0 0 24 24" fill="none" style={{ opacity: 0.08 }}>
        <defs>
          <linearGradient id="static-v" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#60A5FA" />
            <stop offset="100%" stopColor="#A78BFA" />
          </linearGradient>
        </defs>
        <path d="M3 4h4.5L12 18 16.5 4H21l-7.5 18h-3L3 4z" fill="url(#static-v)" />
      </svg>
      {/* Glow orbs */}
      <div style={{ position: 'absolute', top: '15%', left: '20%', width: '200px', height: '200px', borderRadius: '50%', background: 'radial-gradient(circle, rgba(59,130,246,0.15) 0%, transparent 70%)' }} />
      <div style={{ position: 'absolute', bottom: '20%', right: '25%', width: '250px', height: '250px', borderRadius: '50%', background: 'radial-gradient(circle, rgba(139,92,246,0.12) 0%, transparent 70%)' }} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main Landing Page                                                  */
/* ------------------------------------------------------------------ */
export default function LandingPage() {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [enable3D, setEnable3D] = useState(true);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    navigate(query.trim() ? `/search?q=${encodeURIComponent(query)}` : '/dashboard');
  };

  return (
    <div className="landing-container">
      {/* Hero Section — split layout */}
      <section className="hero-section" style={{ position: 'relative', overflow: 'hidden', minHeight: '85vh' }}>
        {enable3D ? <GlassVScene enabled={enable3D} /> : <StaticVFallback />}

        {/* 3D Toggle */}
        <button
          onClick={() => setEnable3D(!enable3D)}
          title={enable3D ? 'Disable 3D animation' : 'Enable 3D animation'}
          style={{
            position: 'absolute', top: '16px', right: '16px', zIndex: 10,
            display: 'flex', alignItems: 'center', gap: '6px',
            padding: '6px 12px', borderRadius: '8px',
            background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
            color: '#94A3B8', cursor: 'pointer', fontSize: '0.75rem', fontWeight: 500,
            backdropFilter: 'blur(8px)', transition: 'all 0.2s',
          }}
          onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.1)')}
          onMouseLeave={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.06)')}
        >
          {enable3D ? <Monitor size={14} /> : <MonitorOff size={14} />}
          {enable3D ? '3D On' : '3D Off'}
        </button>

        {/* Hero content — positioned right side */}
        <div className="hero-content" style={{
          position: 'relative', zIndex: 2,
          display: 'flex', flexDirection: 'column',
          alignItems: 'flex-end', textAlign: 'right',
          maxWidth: '1200px', margin: '0 auto', width: '100%',
          padding: '0 48px',
          justifyContent: 'center', minHeight: '85vh',
        }}>
          <div style={{ maxWidth: '520px' }}>
            <div className="badge glass-card" style={{ alignSelf: 'flex-end' }}>
              <SparklesIcon /> <span>Next-Gen SEC Intelligence</span>
            </div>

            <h1 style={{ margin: '0 0 16px 0' }}>
              <span style={{
                fontSize: '5rem', fontWeight: 800, letterSpacing: '0.12em',
                background: 'linear-gradient(135deg, #ffffff 0%, #72a0d8 50%, #A78BFA 100%)',
                WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
                backgroundClip: 'text',
                display: 'block', lineHeight: 1,
              }}>
                VARA
              </span>
              <span style={{
                fontSize: '1.1rem', fontWeight: 500, color: '#94A3B8',
                letterSpacing: '0.25em', textTransform: 'uppercase',
                display: 'block', marginTop: '8px',
              }}>
                AI Data Prism
              </span>
            </h1>

            <p style={{
              fontSize: '1.05rem', color: '#CBD5E1', lineHeight: 1.7,
              marginBottom: '32px',
            }}>
              Research SEC filings, benchmark disclosures across peers, and extract
              insights with AI — built for legal, financial, and compliance professionals.
            </p>

            <form className="hero-search glass-card" onSubmit={handleSearch} style={{ textAlign: 'left' }}>
              <Search className="search-icon" size={20} />
              <input
                type="text"
                placeholder="Search companies, filings, or topics..."
                value={query}
                onChange={e => setQuery(e.target.value)}
              />
              <button type="submit" className="primary-btn">Research</button>
            </form>
          </div>
        </div>
      </section>

      {/* Trusted By — dark minimal strip */}
      <section style={{
        padding: '36px 24px',
        borderTop: '1px solid rgba(255,255,255,0.04)',
        borderBottom: '1px solid rgba(255,255,255,0.04)',
        background: 'rgba(255,255,255,0.01)',
        textAlign: 'center',
      }}>
        <p style={{ fontSize: '0.7rem', fontWeight: 600, letterSpacing: '0.15em', color: '#475569', marginBottom: '20px' }}>
          ANALYZE FILINGS FROM COMPANIES LIKE
        </p>
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '48px', flexWrap: 'wrap' }}>
          {['Apple Inc.', 'Microsoft', 'JPMorgan Chase', 'Alphabet', 'Tesla'].map(name => (
            <span key={name} style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#64748B', fontWeight: 600, fontSize: '0.95rem', transition: 'color 0.2s' }}>
              <Building2 size={18} /> {name}
            </span>
          ))}
        </div>
      </section>

      {/* Features — dark cards with subtle borders */}
      <section style={{ padding: '80px 24px', maxWidth: '1200px', margin: '0 auto', width: '100%' }}>
        <h2 style={{
          textAlign: 'center', fontSize: '2.2rem', fontWeight: 700, marginBottom: '12px', color: 'white',
        }}>
          Everything you need to master SEC disclosures
        </h2>
        <p style={{ textAlign: 'center', color: '#64748B', fontSize: '1rem', marginBottom: '56px', maxWidth: '600px', margin: '0 auto 56px' }}>
          From full-text search to AI-powered analysis, Vara gives you an edge over traditional research tools.
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '16px' }}>
          {[
            { icon: Search, title: 'Advanced Discovery', desc: 'Full-text search across millions of SEC filings with intelligent filtering by type, date, and SIC code.', to: '/search', accent: '#3B82F6' },
            { icon: Zap, title: 'AI-Powered Q&A', desc: 'Chat directly with filings. Our AI extracts entities, summarizes risks, and cites exact document sections.', to: '/search', accent: '#A78BFA' },
            { icon: Shield, title: 'Disclosures Benchmarking', desc: 'Compare how peers disclose risks or ESG metrics side-by-side with visual diffing highlights.', to: '/compare', accent: '#10B981' },
            { icon: TrendingUp, title: 'Market Trends', desc: 'Track emerging topics across industries, monitor competitor activity, and visualize filing volumes.', to: '/dashboard', accent: '#F59E0B' },
          ].map(f => (
            <div
              key={f.title}
              onClick={() => navigate(f.to)}
              style={{
                cursor: 'pointer',
                padding: '28px',
                borderRadius: '14px',
                border: '1px solid rgba(255,255,255,0.06)',
                background: 'rgba(255,255,255,0.02)',
                transition: 'all 0.2s',
                display: 'flex',
                flexDirection: 'column',
                gap: '14px',
              }}
              onMouseEnter={e => {
                e.currentTarget.style.borderColor = `${f.accent}44`;
                e.currentTarget.style.background = `${f.accent}08`;
              }}
              onMouseLeave={e => {
                e.currentTarget.style.borderColor = 'rgba(255,255,255,0.06)';
                e.currentTarget.style.background = 'rgba(255,255,255,0.02)';
              }}
            >
              <div style={{
                width: '44px', height: '44px', borderRadius: '10px',
                background: `${f.accent}15`, display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <f.icon size={22} style={{ color: f.accent }} />
              </div>
              <h3 style={{ fontSize: '1.15rem', fontWeight: 600, color: 'white', margin: 0 }}>{f.title}</h3>
              <p style={{ color: '#94A3B8', fontSize: '0.9rem', lineHeight: 1.6, margin: 0 }}>{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Footer — minimal dark */}
      <footer style={{ borderTop: '1px solid rgba(255,255,255,0.04)', padding: '32px 24px' }}>
        <div style={{ maxWidth: '1200px', margin: '0 auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#475569', fontWeight: 600, fontSize: '0.9rem' }}>
            <VaraLogo size={18} /> Vara AI
          </div>
          <div style={{ display: 'flex', gap: '24px', color: '#334155', fontSize: '0.82rem' }}>
            <span>&copy; 2026 Vara AI Inc.</span>
            <a href="/support" style={{ color: '#475569', textDecoration: 'none' }}>Privacy</a>
            <a href="/support" style={{ color: '#475569', textDecoration: 'none' }}>Terms</a>
          </div>
        </div>
      </footer>
    </div>
  );
}

function SparklesIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="ai-icon">
      <path d="M12 3v18" /><path d="M3 12h18" /><path d="m18 6-6 6" /><path d="m6 6 6 6" />
    </svg>
  );
}

export function VaraLogo({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="vara-grad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#60A5FA" />
          <stop offset="100%" stopColor="#A78BFA" />
        </linearGradient>
      </defs>
      <path d="M3 4h4.5L12 18 16.5 4H21l-7.5 18h-3L3 4z" fill="url(#vara-grad)" opacity="0.9" />
      <path d="M3 4h4.5L12 18 16.5 4H21l-7.5 18h-3L3 4z" fill="none" stroke="white" strokeWidth="0.5" opacity="0.4" />
    </svg>
  );
}
