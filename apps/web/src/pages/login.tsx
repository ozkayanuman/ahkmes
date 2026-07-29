import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Package } from "lucide-react";
import { Button, Input, Label } from "../components/ui";
import { useAuth } from "../lib/auth";

/** Dijitalizasyon temalı, tamamen CSS/SVG ile üretilen arka plan — harici görsel
 * bağımlılığı/telif riski olmadan; devre/ağ düğümleri Endüstri 4.0 imasını taşır. */
function DigitalBackground() {
  return (
    <div className="absolute inset-0 overflow-hidden bg-slate-950">
      <div
        className="absolute inset-0 opacity-20"
        style={{
          backgroundImage:
            "linear-gradient(to right, #1e40af22 1px, transparent 1px), linear-gradient(to bottom, #1e40af22 1px, transparent 1px)",
          backgroundSize: "48px 48px",
        }}
      />
      <div className="absolute inset-0 bg-gradient-to-br from-[#1e3a8a]/50 via-slate-950 to-slate-900" />
      <svg className="absolute inset-0 h-full w-full opacity-40" preserveAspectRatio="none">
        <defs>
          <radialGradient id="glow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.9" />
            <stop offset="100%" stopColor="#3b82f6" stopOpacity="0" />
          </radialGradient>
        </defs>
        {[
          [80, 120, 340, 260],
          [340, 260, 620, 140],
          [620, 140, 900, 320],
          [80, 120, 260, 420],
          [260, 420, 620, 140],
          [900, 320, 1100, 500],
        ].map(([x1, y1, x2, y2], i) => (
          <line
            key={i}
            x1={`${x1 / 12}%`}
            y1={y1}
            x2={`${x2 / 12}%`}
            y2={y2}
            stroke="#60a5fa"
            strokeWidth={1}
            strokeDasharray="4 4"
          />
        ))}
        {[
          [80, 120],
          [340, 260],
          [620, 140],
          [900, 320],
          [260, 420],
          [1100, 500],
        ].map(([x, y], i) => (
          <circle key={i} cx={`${x / 12}%`} cy={y} r={5} fill="url(#glow)" />
        ))}
      </svg>
    </div>
  );
}

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email, password);
      navigate("/");
    } catch {
      setError("E-posta veya şifre hatalı");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center p-4">
      <DigitalBackground />

      <div className="absolute left-6 top-6 flex items-center gap-2 text-white">
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/10 backdrop-blur">
          <Package className="h-5 w-5" />
        </span>
        <div>
          <div className="text-sm font-bold leading-tight">AHK Teknoloji</div>
          <div className="text-xs leading-tight text-white/50">AHKMES</div>
        </div>
      </div>

      <div className="relative w-full max-w-sm rounded-xl bg-white/95 p-8 shadow-2xl backdrop-blur">
        <div className="mb-6 text-center">
          <h1 className="text-xl font-bold text-slate-800">Hoş Geldiniz</h1>
          <p className="mt-1 text-sm text-slate-500">Devam etmek için giriş yapın</p>
        </div>
        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <Label htmlFor="email">E-posta</Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus
            />
          </div>
          <div>
            <Label htmlFor="password">Şifre</Label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? "Giriş yapılıyor…" : "Giriş Yap"}
          </Button>
        </form>
      </div>
    </div>
  );
}
